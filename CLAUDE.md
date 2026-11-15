# Distill — notes for Claude

Read this first when working here. Update it whenever the process, a decision or a rule changes (what changed goes in CHANGELOG.md).

## What it is
- AI text summarizer using a **local model through Ollama**: private (text never leaves the Mac) and free (no API key). Web interface (`python3 app.py`) and terminal command (`python3 summarize.py`), sharing the same summarizing code.
- Online preview (interface + an example summary, no AI): https://maabalo.github.io/distill/ · Repo: github.com/maabalo/distill (**public**). Track: **Small tool**.

## Stack and structure
- Python standard library only (3.9+), no pip installs: `summarize.py` (core + CLI), `app.py` (local web server), `web/` (the interface), `index.html` (the online preview page).
- Ollama at `OLLAMA_HOST` (default `http://127.0.0.1:11434`); default model `llama3.2:3b` (`SUMMARIZER_MODEL` to change).
- Tests: `test_summarize.py`, `test_app.py` (with a fake Ollama server, so no model is needed).

## Run, test, deploy
- Tests: `python3 -m unittest` in this folder.
- Python lint: Ruff settings are in `pyproject.toml` (Ruff isn't installed on this Mac: ask before installing). Web lint: `npm run lint` in a temporary copy, then delete it.
- `__pycache__/` is created by tests: delete it after testing (test clean-up rule).
- **Push only when the user says so.**

## Decisions (don't undo without asking)
- Local model instead of a cloud AI API (user's choice, 2026-10-31: free and private).
- Same house style as the other tools (Inter + JetBrains Mono, green accent), mobile-first, WCAG AA.
