"""
Tests for app.py (the web interface's server) — run with:  python3 -m unittest -v

Each test starts the real app server on a free port, pointed at the fake
Ollama from test_summarize.py, and talks to it over HTTP like the page does.
"""

from __future__ import annotations

import http.client
import json
import socket
import threading

import app
import summarize
from test_summarize import SAMPLE, ServerTestCase


class AppTestCase(ServerTestCase):
    """A fake Ollama (from ServerTestCase) plus a real app.py server in front of it."""

    def setUp(self):
        super().setUp()
        self.app = app.start_server(0)
        threading.Thread(target=self.app.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        self.port = self.app.server_port

    def tearDown(self):
        self.app.shutdown()
        self.app.server_close()
        super().tearDown()

    def request(self, method, path, body=None, headers=None):
        """One HTTP request to the app; returns (status, headers, body text)."""
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        all_headers = {"Host": f"127.0.0.1:{self.port}", **(headers or {})}
        payload = json.dumps(body).encode() if isinstance(body, dict) else body
        if payload is not None:
            all_headers.setdefault("Content-Type", "application/json")
        connection.request(method, path, body=payload, headers=all_headers)
        response = connection.getresponse()
        result = (response.status, dict(response.getheaders()), response.read().decode("utf-8"))
        connection.close()
        return result

    def summarize_events(self, **overrides):
        """POST /api/summarize and return the list of streamed events."""
        body = {"text": SAMPLE, "length": "short", "format": "bullets", "model": "llama3.2:3b", **overrides}
        status, _, text = self.request("POST", "/api/summarize", body)
        self.assertEqual(status, 200, text)
        return [json.loads(line) for line in text.splitlines() if line.strip()]


class Pages(AppTestCase):
    def test_index_is_served_with_security_headers(self):
        status, headers, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("<title>Distill", body)
        self.assertIn("script-src 'self'", headers["Content-Security-Policy"])
        self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_assets_are_served_with_the_right_type(self):
        status, headers, _ = self.request("GET", "/assets/js/app.js")
        self.assertEqual((status, headers["Content-Type"]), (200, "text/javascript; charset=utf-8"))

    def test_files_outside_web_are_never_served(self):
        for path in ["/../summarize.py", "/..%2Fsummarize.py", "/assets/../../app.py", "/missing.html"]:
            status, _, body = self.request("GET", path)
            self.assertEqual(status, 404, path)
            self.assertNotIn("import", body)


class Security(AppTestCase):
    def test_other_host_names_are_refused(self):
        status, _, _ = self.request("GET", "/", headers={"Host": "evil.example:8765"})
        self.assertEqual(status, 403)

    def test_posts_from_other_websites_are_refused(self):
        body = {"text": SAMPLE, "model": "llama3.2:3b"}
        status, _, _ = self.request(
            "POST", "/api/summarize", body, headers={"Origin": "https://evil.example"}
        )
        self.assertEqual(status, 403)
        self.assertEqual(self.server.requests, [])  # nothing reached Ollama

    def test_own_origin_is_allowed(self):
        origin = f"http://localhost:{self.port}"
        body = {"text": SAMPLE, "model": "llama3.2:3b"}
        status, _, _ = self.request("POST", "/api/summarize", body, headers={"Origin": origin})
        self.assertEqual(status, 200)

    def test_oversized_request_is_refused_without_reading_it(self):
        status, _, text = self.request(
            "POST", "/api/summarize", b"{}", headers={"Content-Length": str(app.MAX_BODY_BYTES + 1)}
        )
        self.assertEqual(status, 400)
        self.assertIn("too long", text)


class Status(AppTestCase):
    def test_lists_models_and_default(self):
        _, _, body = self.request("GET", "/api/status")
        data = json.loads(body)
        self.assertEqual(
            data, {"ok": True, "models": ["llama3.2:3b", "qwen2.5:7b"], "default": "llama3.2:3b"}
        )

    def test_reports_ollama_offline_with_a_hint(self):
        summarize.OLLAMA_URL = "http://127.0.0.1:9"
        data = json.loads(self.request("GET", "/api/status")[2])
        self.assertFalse(data["ok"])
        self.assertIn("Open the Ollama app", data["hint"])


class Summaries(AppTestCase):
    def test_streams_text_then_done(self):
        events = self.summarize_events()
        texts = [event["content"] for event in events if event["type"] == "text"]
        self.assertEqual("".join(texts), "- Sales rose 12%.")
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(events[-1]["words_out"], 4)

    def test_options_reach_ollama(self):
        self.summarize_events(length="long", format="paragraph", model="qwen2.5:7b")
        sent = self.server.requests[0]
        self.assertEqual(sent["model"], "qwen2.5:7b")
        self.assertIn("two or three paragraphs", sent["messages"][1]["content"])

    def test_long_text_sends_progress(self):
        text = "\n\n".join(SAMPLE for _ in range(60))
        events = self.summarize_events(text=text)
        progress = [event for event in events if event["type"] == "progress"]
        self.assertEqual(len(progress), len(summarize.split_into_parts(text)))

    def test_error_while_streaming_becomes_an_error_event(self):
        self.server.mode = "error-event"
        events = self.summarize_events()
        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("out of memory", events[-1]["error"])


class BadRequests(AppTestCase):
    def check_400(self, body, expected):
        """POST a bad request and check the 400 answer mentions `expected`."""
        status, _, text = self.request("POST", "/api/summarize", body)
        self.assertEqual(status, 400, text)
        self.assertIn(expected, json.loads(text)["error"])

    def test_short_text(self):
        self.check_400({"text": "too short", "model": "llama3.2:3b"}, "too short")

    def test_unknown_option(self):
        self.check_400({"text": SAMPLE, "model": "llama3.2:3b", "length": "huge"}, "Unknown length")

    def test_missing_model(self):
        self.check_400({"text": SAMPLE, "model": "mistral"}, "isn't downloaded")

    def test_not_json(self):
        status, _, text = self.request(
            "POST", "/api/summarize", b"text=hello", {"Content-Type": "text/plain"}
        )
        self.assertEqual(status, 400)
        self.assertIn("Expected a JSON request", text)

    def test_broken_json(self):
        status, _, text = self.request(
            "POST", "/api/summarize", b"{nope", {"Content-Type": "application/json"}
        )
        self.assertEqual(status, 400)
        self.assertIn("valid JSON", text)


class Stopping(AppTestCase):
    def test_closing_the_connection_mid_stream_keeps_the_server_working(self):
        self.server.reply = ["word "] * 2000  # a long stream
        body = json.dumps({"text": SAMPLE, "model": "llama3.2:3b"}).encode()
        raw = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        head = f"POST /api/summarize HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
        head += f"Content-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n"
        raw.sendall(head.encode() + body)
        self.assertIn(b"200", raw.recv(64))  # the stream started…
        raw.close()  # …then the page "pressed Stop"
        status, _, _ = self.request("GET", "/api/status")
        self.assertEqual(status, 200)  # the server carries on
