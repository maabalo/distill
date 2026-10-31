# Distill — AI Text Summarizer

Summarizes text with a **local AI model** through [Ollama](https://ollama.com). There are two ways to use it:

- **In your browser:** run `python3 app.py`. Paste text or drop a file, choose the options, and watch the summary appear.
- **In the Terminal:** run `python3 summarize.py`. Paste text, pass a file, or pipe something in.

Both use the same summarizing code (`summarize.py`), so they always give the same results.

- **Private:** the AI runs on your Mac, and your text never goes to the internet.
- **Free:** there's no API key and no usage cost.
- **Nothing to install with pip:** it uses only Python's standard library (Python 3.9+).

```
$ python3 summarize.py article.txt
Summarizing 1,240 words with llama3.2:3b…
- The company's quarterly revenue rose 12%, driven by new markets.
- Online sales grew faster than in-store sales for the first time.
- …
1,240 words → 68 words
```

---

## Setup (once)

You need **Python 3.9 or newer** (macOS: `python3 --version` in Terminal) and about 2 GB of free space.

1. **Get the code.** Either:
   - click the green **Code** button on GitHub, choose **Download ZIP**, and unzip it, or
   - run `git clone https://github.com/maabalo/distill.git` in Terminal.
2. **Install Ollama.** Download it from [ollama.com/download](https://ollama.com/download) (macOS, Windows or Linux) and open it. On a Mac, a llama icon in the menu bar means it's running.
3. **Download a model** (about 2 GB) in Terminal:
   ```sh
   ollama pull llama3.2:3b
   ```
4. **Start Distill** from the project folder:
   ```sh
   cd distill        # the folder you downloaded or cloned
   python3 app.py    # opens Distill in your browser
   ```
   On Windows, use `python` instead of `python3`.

### Optional: a short `summarize` command
Add this line to `~/.zshrc` (change the path to where you put the folder), then open a new Terminal window:
```sh
alias summarize="python3 ~/distill/summarize.py"
```
Now `summarize`, `summarize notes.txt` and `pbpaste | summarize` work from any folder.

---

## Web interface

```sh
cd distill        # the project folder
python3 app.py
```

Your browser opens **http://127.0.0.1:8765**. Leave the Terminal window open while you use it, and press **Ctrl+C** there to stop.

- **Input:** paste text into **01 text**, or use **open file** (or drop a `.txt` / `.md` file onto it). The word count updates as you type.
- **Options:** pick the **length** (short, medium, long), the **format** (bullets or paragraph) and the **model**. Your choices are remembered.
- **Summarize:** click **summarize** or press **⌘ + Enter**. The summary appears as it's written. Long text shows "reading part 1 of 3". Use **stop** or **Esc** to cancel; whatever was already written is kept.
- **Output:** **copy** or save as **.txt**. The line under the summary shows the word counts, the time taken and the model used.
- **Status pill:** shows whether Ollama is running and how many models you have. Click it to check again.
- Light, dark and auto themes, plus a help guide (**?**).

Options: `python3 app.py --port 9000` uses another port, and `--no-browser` stops it opening a tab.

**Security:**
- The server only listens on your own Mac (`127.0.0.1`), and refuses requests from other websites (it checks the Host and Origin headers).
- It serves only the files in `web/`, and the page may only run its own scripts (Content-Security-Policy).

## Terminal usage

| Command | What it does |
|---|---|
| `python3 summarize.py` | Paste text, then press **Enter** and **Ctrl+D** |
| `python3 summarize.py article.txt` | Summarize a file |
| `pbpaste \| python3 summarize.py` | Summarize whatever you copied |
| `python3 summarize.py notes.txt -o summary.txt` | Also save the summary to a file |
| `python3 summarize.py notes.txt > summary.txt` | Save **only** the summary (status messages still show on screen) |
| `python3 summarize.py --list-models` | Show the models you've downloaded |
| `python3 summarize.py --help` | All options |

**Options**

| Option | Result |
|---|---|
| `--short` (default) | 3–5 bullet points, or 2–3 sentences |
| `--medium` | 5–8 bullet points, or 4–6 sentences |
| `--long` | 8–12 bullet points, or 2–3 paragraphs |
| `--bullets` (default) or `--paragraph` | Bullet points or flowing prose |
| `-m MODEL`, `--model MODEL` | Use another Ollama model for this run |
| `-o FILE`, `--output FILE` | Also save the summary to a file |

Press **Ctrl+C** at any time to cancel.

### Choosing a model
Your Mac (M4, 16 GB) runs these comfortably:

| Model | Download | Speed | Summary quality |
|---|---|---|---|
| `llama3.2:3b` (default) | ~2 GB | Fast | Good for articles, emails and notes |
| `llama3.1:8b` | ~5 GB | Slower | Better at long or technical text |
| `qwen2.5:7b` | ~5 GB | Slower | Strong, and good with non-English text |

Download one with `ollama pull NAME`, then use it with `--model NAME`. To make it the default, set `export SUMMARIZER_MODEL=NAME` in `~/.zshrc`.

---

## How it works

1. **Checks Ollama first.** If it isn't running or the model isn't downloaded, you get the exact fix before you paste anything.
2. **Reads and checks the text.** It refuses empty or very short text, and anything over about 400,000 characters.
3. **Builds the prompt.**
   - A system prompt tells the model to summarize only what the text says, keep names, numbers and dates exact, and answer in the text's language.
   - The text goes inside `<text>` tags so that instructions hidden in it aren't followed (basic prompt-injection protection).
4. **Handles long text in parts.**
   - Local models can only read so much at once, so text over about 16,000 characters is split at paragraph breaks.
   - Each part is condensed to at most 6 bullet points. If the combined notes are still too long, they're condensed again, for up to 3 rounds.
   - Then they're summarized together, so nothing is silently cut off.
   - The length you asked for is repeated *after* the text, because small models follow the last instruction they read.
5. **Streams the answer.** The summary appears as it's written: only the summary goes to standard output, and progress goes to standard error.

## Settings (top of `summarize.py`, section 01)

| Setting | Default | Meaning |
|---|---|---|
| `DEFAULT_MODEL` | `llama3.2:3b` | Or set the `SUMMARIZER_MODEL` environment variable |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Or set the `OLLAMA_HOST` environment variable |
| `CONTEXT_TOKENS` | 8192 | How much the model reads at once |
| `CHUNK_CHARS` | 16000 | Size of each part for long text |
| `TEMPERATURE` | 0.2 | Lower values stick closer to the text |
| `OUTPUT_TOKENS` | 350 / 600 / 1000 | The most the model may write for short, medium or long, so small models can't ramble |
| `MAX_ROUNDS` | 3 | How many times notes from long text may be condensed again |

## Troubleshooting

| Message | Fix |
|---|---|
| *Can't reach Ollama* | Open the Ollama app (llama icon in the menu bar), or run `ollama serve` |
| *The model "…" isn't downloaded yet* | Run the `ollama pull …` command it shows, or use a model you already have |
| *too short to summarize* | Give it at least a few sentences (25 words or more) |
| The summary is slow | Normal for the first run, while the model loads; later runs are faster. You can also use a smaller model |
| The summary gets a detail wrong | Small models can mix up facts, especially when the text covers several topics. Use a 7–8B model (`--model qwen2.5:7b`), and always check important facts against the original |

### Measured on a MacBook Air M4 (16 GB) with `llama3.2:3b`
- **A 290-word news article:** about 5 seconds including loading the model. The summary was accurate, with names, numbers and dates correct.
- **About 4,000 words (2 parts):** about 35 seconds. In one test, 8 of 8 facts checked against the source were correct.
- **Known weakness:** with three different documents joined together, the 3B model mixed up details between them and left one out. A larger model does better at this.

---

## Project structure

```
Text_Summarizer/
├── summarize.py        The summarizer: Terminal command + shared logic (standard library only)
├── app.py              Web interface server: serves web/ and streams summaries
├── web/
│   ├── index.html      The page (with the help guide)
│   └── assets/
│       ├── css/style.css
│       └── js/
│           ├── app.js         Page behaviour: status, input, streaming, copy/download
│           └── theme-init.js  Sets the saved theme before the first paint
├── test_summarize.py   29 tests for the summarizer, with a fake Ollama server
├── test_app.py         19 tests for the web server: API, streaming, security, Stop
├── pyproject.toml      Python checks (Ruff)
├── package.json        Web page checks (html-validate, Stylelint, ESLint, Prettier)
└── README.md           This file
```

## Code checks

```sh
python3 -m unittest -v          # 48 tests: no Ollama or internet needed
ruff format . && ruff check .   # Python formatting + lint (install with: pip install ruff)
npm install && npm run lint     # web page: HTML, CSS, JavaScript + formatting
```

## Standards followed

- **Python 3.9+, standard library only.** It uses type hints, and every function has a docstring and is no longer than 25 lines.
- **Errors are written for people.**
  - Every known problem shows a plain message and the fix, not a Python traceback.
  - Exit codes: 0 means OK, 1 an error, 2 bad options, and 130 that you cancelled.
- **Unix-friendly.**
  - Output is clean, so pipes and redirects work.
  - Colors only appear in a real terminal, and `NO_COLOR` is respected.
- **Private by design.** The script only connects to Ollama on your own Mac.
