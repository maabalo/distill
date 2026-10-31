#!/usr/bin/env python3
"""
Distill — web interface.

A small local web server (Python standard library only) that shows the
Distill page in your browser and passes summaries through to Ollama. All the
summarizing logic lives in summarize.py, so the web page and the Terminal
version always behave the same.

    python3 app.py                  # opens http://127.0.0.1:8765 in your browser
    python3 app.py --port 9000      # use another port
    python3 app.py --no-browser     # don't open a browser tab

The server only listens on this Mac (127.0.0.1) and refuses requests that
come from other websites, so nothing else can use it.

API (used by web/assets/js/app.js):
    GET  /api/status      → {"ok": true, "models": [...], "default": "llama3.2:3b"}
                            or {"ok": false, "error": "...", "hint": "..."}
    POST /api/summarize   ← {"text", "length", "format", "model"}
                          → a stream of JSON lines (one event per line):
                            {"type": "progress", "part": 1, "total": 2}
                            {"type": "text", "content": "- Sales rose"}
                            {"type": "done", "words_in": 1240, "words_out": 68, "seconds": 5.2}
                            {"type": "error", "error": "...", "hint": "..."}

TABLE OF CONTENTS
  01  Settings
  02  Request handler: routing & security checks
  03  Static files (the web page)
  04  API: status
  05  API: summarize (streaming)
  06  Starting the server
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import summarize as core

# =============================================================================
# 01  SETTINGS
# =============================================================================
HOST = "127.0.0.1"  # this Mac only — never reachable from the network
DEFAULT_PORT = 8765
PORT_TRIES = 10  # if the port is busy, try the next few
WEB_ROOT = (Path(__file__).resolve().parent / "web").resolve()
MAX_BODY_BYTES = core.MAX_CHARS * 4 + 4096  # UTF-8 can use up to 4 bytes per character
MAX_MODEL_NAME = 100
FORMATS = ("bullets", "paragraph")

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}

# Sent with every response. The page may only run its own scripts and talk to this server.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    ),
}


# =============================================================================
# 02  REQUEST HANDLER: ROUTING & SECURITY CHECKS
# =============================================================================
class DistillHandler(BaseHTTPRequestHandler):
    """Serves the page and the two API routes."""

    server_version = "Distill"

    def log_message(self, *args) -> None:
        """Keep the Terminal quiet: only problems are printed (see send_error_json)."""

    def do_GET(self) -> None:
        """GET: the status API, or a file of the web page."""
        if not self.host_allowed():
            self.send_error_json(403, "This server only answers requests made to itself.")
        elif self.route() == "/api/status":
            self.handle_status()
        else:
            self.serve_static()

    def do_POST(self) -> None:
        """POST: only /api/summarize, and only from this page."""
        if not (self.host_allowed() and self.origin_allowed()):
            self.send_error_json(403, "Requests from other websites are not allowed.")
        elif self.route() == "/api/summarize":
            self.handle_summarize()
        else:
            self.send_error_json(404, "Not found.")

    def route(self) -> str:
        """The path without any ?query."""
        return self.path.split("?", 1)[0]

    def own_origins(self) -> set[str]:
        """The addresses this server can be reached at, e.g. 127.0.0.1:8765 and localhost:8765."""
        port = self.server.server_port
        return {f"{HOST}:{port}", f"localhost:{port}"}

    def host_allowed(self) -> bool:
        """Block "DNS rebinding": a web page reaching this server through a borrowed domain name."""
        return self.headers.get("Host", "") in self.own_origins()

    def origin_allowed(self) -> bool:
        """POSTs must come from this page itself (browsers always send Origin on cross-site POSTs)."""
        origin = self.headers.get("Origin")
        return origin is None or origin in {f"http://{address}" for address in self.own_origins()}

    def send_json(self, status: int, data: dict) -> None:
        """A complete JSON response."""
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_security_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: int, message: str, hint: str = "") -> None:
        """An error the page can show: {"error": "...", "hint": "..."}."""
        self.send_json(status, {"error": message, "hint": hint})

    def send_security_headers(self) -> None:
        """Add the headers from SECURITY_HEADERS."""
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)

    # =========================================================================
    # 03  STATIC FILES (the web page)
    # =========================================================================
    def serve_static(self) -> None:
        """Send a file from web/ — and only from web/ (no "../" tricks)."""
        relative = self.route().lstrip("/") or "index.html"
        target = (WEB_ROOT / relative).resolve()
        inside = target == WEB_ROOT or WEB_ROOT in target.parents
        if not (inside and target.is_file() and target.suffix in STATIC_TYPES):
            self.send_error_json(404, "Not found.")
            return
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", STATIC_TYPES[target.suffix])
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_security_headers()
        self.end_headers()
        self.wfile.write(body)

    # =========================================================================
    # 04  API: STATUS
    # =========================================================================
    def handle_status(self) -> None:
        """Is Ollama running, and which models are downloaded?"""
        try:
            models = core.installed_models()
        except core.SummarizerError as error:
            self.send_json(200, {"ok": False, "error": str(error), "hint": error.hint})
            return
        self.send_json(200, {"ok": True, "models": models, "default": core.DEFAULT_MODEL})

    # =========================================================================
    # 05  API: SUMMARIZE (streaming)
    # Problems found before the summary starts get a normal 400 response.
    # Once streaming has started, problems arrive as an "error" event.
    # =========================================================================
    def handle_summarize(self) -> None:
        """Check the request, then stream the summary as JSON lines."""
        try:
            request = self.read_request()
            text = core.check_text(request["text"])
            core.ensure_model(request["model"])
        except core.SummarizerError as error:
            self.send_error_json(400, str(error), error.hint)
            return
        self.start_stream()
        self.stream_summary(text, request)

    def read_request(self) -> dict:
        """The JSON body, checked field by field."""
        size = int(self.headers.get("Content-Length") or 0)
        if size > MAX_BODY_BYTES:
            raise core.SummarizerError(
                "The text is too long.", f"The limit is {core.MAX_CHARS:,} characters."
            )
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise core.SummarizerError("Expected a JSON request.")
        try:
            data = json.loads(self.rfile.read(size) or b"{}")
        except ValueError:
            raise core.SummarizerError("The request wasn't valid JSON.") from None
        return validate_request(data)

    def start_stream(self) -> None:
        """Headers for a streamed reply (no length: it ends when the connection closes)."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_security_headers()
        self.end_headers()

    def send_event(self, event: dict) -> None:
        """One line of the stream."""
        self.wfile.write(json.dumps(event).encode("utf-8") + b"\n")
        self.wfile.flush()

    def stream_summary(self, text: str, request: dict) -> None:
        """Stream progress, text pieces, then a "done" (or "error") event."""
        started = time.monotonic()

        def report(part: int, total: int) -> None:
            """Tell the page which part of a long text is being read."""
            self.send_event({"type": "progress", "part": part, "total": total})

        pieces = core.summarize(text, request["model"], request["length"], request["format"], report)
        try:
            with contextlib.closing(pieces):  # closing it also closes the connection to Ollama
                summary = "".join(self.forward(pieces)).strip()
            if not summary:
                raise core.SummarizerError(
                    "The model returned an empty summary.", "Try again, or use another model."
                )
            seconds = round(time.monotonic() - started, 1)
            self.send_event(done_event(text, summary, seconds))
        except core.SummarizerError as error:
            self.send_event({"type": "error", "error": str(error), "hint": error.hint})
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page pressed Stop or was closed: Ollama stops generating as well

    def forward(self, pieces):
        """Send each text piece to the page as it arrives, and pass it on."""
        for piece in pieces:
            if piece:
                self.send_event({"type": "text", "content": piece})
            yield piece


def validate_request(data: object) -> dict:
    """Only known options and sensible values get through."""
    if not isinstance(data, dict):
        raise core.SummarizerError("The request wasn't a JSON object.")
    text, model = data.get("text"), data.get("model")
    length, form = data.get("length", "short"), data.get("format", "bullets")
    if not isinstance(text, str):
        raise core.SummarizerError("No text to summarize.")
    if length not in core.LENGTHS or form not in FORMATS:
        raise core.SummarizerError("Unknown length or format.")
    if not isinstance(model, str) or not model or len(model) > MAX_MODEL_NAME:
        raise core.SummarizerError("Choose a model first.")
    return {"text": text, "model": model, "length": length, "format": form}


def done_event(text: str, summary: str, seconds: float) -> dict:
    """The final event: word counts and time taken."""
    return {
        "type": "done",
        "words_in": core.word_count(text),
        "words_out": core.word_count(summary),
        "seconds": seconds,
    }


# =============================================================================
# 06  STARTING THE SERVER
# =============================================================================
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Command-line options for the web app."""
    parser = argparse.ArgumentParser(prog="app.py", description="Distill in your browser (local only).")
    parser.add_argument(
        "--port", type=int, default=DEFAULT_PORT, help=f"port to use (default {DEFAULT_PORT})"
    )
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    return parser.parse_args(argv)


def start_server(port: int) -> ThreadingHTTPServer:
    """A server on the first free port from `port` on (port 0 = any free port, used by the tests)."""
    tries = 1 if port == 0 else PORT_TRIES
    for candidate in range(port, port + tries):
        try:
            return ThreadingHTTPServer((HOST, candidate), DistillHandler)
        except OSError:
            continue
    raise core.SummarizerError(
        f"Ports {port}–{port + tries - 1} are all busy.", "Try:  python3 app.py --port 9000"
    )


def main(argv: list[str] | None = None) -> int:
    """Start the server, open the page, and run until Ctrl+C."""
    args = parse_args(argv)
    try:
        server = start_server(args.port)
    except core.SummarizerError as error:
        core.show_error(error)
        return core.EXIT_ERROR
    url = f"http://{HOST}:{server.server_port}/"
    print(f"Distill is running at {url}  (press Ctrl+C to stop)", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return core.EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
