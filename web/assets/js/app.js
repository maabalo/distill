/* ==========================================================================
   Distill — app.js (web interface)
   --------------------------------------------------------------------------
   Talks only to app.py on this Mac (same origin), which talks to Ollama:
     GET  /api/status     → is Ollama running, which models are installed
     POST /api/summarize  → a stream of JSON lines: progress, text, done | error
   Plain script (no modules), like the other Web_Page projects.

   TABLE OF CONTENTS
     01  Settings
     02  DOM references
     03  Small helpers
     04  State & saved preferences
     05  Ollama status & models (and the online preview)
     06  Text input (typing, files, drag & drop)
     07  Summarizing (request + stream)
     08  Showing the summary & errors
     09  Copy & download
     10  Dialogs
     11  Toast & screen-reader announcements
     12  Theme
     13  Keyboard shortcuts
     14  Init
   ========================================================================== */
(function () {
  'use strict';

  /* ==========================================================================
     01  SETTINGS
     ========================================================================== */
  const THEME_KEY = 'distill-theme'; // also read by theme-init.js
  const PREFS_KEY = 'distill-prefs';
  const THEMES = ['auto', 'light', 'dark'];
  /** Browser-bar color (meta theme-color) for a manually chosen theme. Matches --surface. */
  const THEME_BAR_COLORS = { light: '#ffffff', dark: '#101317' };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_CHARS = 400000; // same limit as MAX_CHARS in summarize.py
  const MAX_FILE_BYTES = 2000000; // a text file bigger than this is almost certainly not plain text
  const MIN_WORDS = 25; // same as summarize.py (it also accepts long text without spaces)
  const TOAST_MS = 2400;
  /** A line that starts like a bullet: "- ", "* ", "• " or "1. ". */
  const BULLET_PATTERN = /^\s*(?:[-*•]|\d+[.)])\s+/;
  const LENGTHS = ['short', 'medium', 'long'];
  /** Addresses where app.py runs. Anywhere else (e.g. GitHub Pages) the page is an online preview. */
  const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

  /** For the online preview: a made-up news article and the summary llama3.2:3b really wrote for it. */
  const EXAMPLE = {
    text: 'Cebu City Launches Pilot Program for Electric Jeepneys\n\nCebu City officials announced on Monday a six-month pilot program that will put 40 electric jeepneys on three of the city\'s busiest routes, starting in March 2026. The program is funded by a 120-million-peso grant from the Department of Transportation and a partnership with two local cooperatives.\n\nMayor Elena Santos said the pilot aims to cut fuel costs for drivers and reduce air pollution along the routes between Carbon Market, IT Park and Talamban. "Drivers spend almost half of what they earn on diesel," she said. "Electric units can cut that cost by more than 60 percent."\n\nEach electric jeepney carries up to 22 passengers and can travel about 120 kilometers on a full charge, enough for a typical day of service. The city will install eight charging stations at terminals, with overnight charging at the cooperatives\' depots. Fares will stay the same as traditional jeepneys during the pilot.\n\nNot everyone is convinced. The Cebu Jeepney Drivers Association warned that the units cost nearly three times as much as a traditional jeepney, and that many drivers cannot afford them without long-term financing. The association\'s president, Ramon Dela Cruz, asked the city to guarantee loans for drivers who want to switch after the pilot ends.\n\nTransport researchers from the University of San Carlos will track ridership, charging times, breakdowns and driver income throughout the six months. Their findings, due in October 2026, will decide whether the program expands to all 18 major routes in the city.\n\nThe city also plans public consultations in April to collect feedback from commuters, especially on comfort, waiting times and safety at night. Officials said routes may be adjusted based on what riders report.',
    summary:
      '- Cebu City will launch a six-month pilot program for electric jeepneys starting in March 2026, with 40 units on three busy routes.\n- The program aims to cut fuel costs for drivers by more than 60 percent and reduce air pollution.\n- Each electric jeepney can carry up to 22 passengers and travel 120 kilometers on a full charge.\n- The city will install eight charging stations and conduct public consultations in April to collect feedback from commuters.',
    model: 'llama3.2:3b',
  };
  const FORMATS = ['bullets', 'paragraph'];

  /* ==========================================================================
     02  DOM REFERENCES
     ========================================================================== */
  const byId = (id) => document.getElementById(id);

  const els = {
    statusPill: byId('statusPill'),
    previewNote: byId('previewNote'),
    exampleBtn: byId('exampleBtn'),
    statusText: byId('statusText'),
    helpBtn: byId('helpBtn'),
    themeBtn: byId('themeBtn'),
    inputCard: byId('inputCard'),
    textInput: byId('textInput'),
    countText: byId('countText'),
    openFileBtn: byId('openFileBtn'),
    clearBtn: byId('clearBtn'),
    fileInput: byId('fileInput'),
    modelSelect: byId('modelSelect'),
    runBtn: byId('runBtn'),
    runHint: byId('runHint'),
    stopBtn: byId('stopBtn'),
    outputCard: byId('outputCard'),
    output: byId('output'),
    progressText: byId('progressText'),
    statsText: byId('statsText'),
    errorBox: byId('errorBox'),
    errorText: byId('errorText'),
    errorHint: byId('errorHint'),
    copyBtn: byId('copyBtn'),
    downloadBtn: byId('downloadBtn'),
    helpDialog: byId('helpDialog'),
    toast: byId('toast'),
    announcer: byId('announcer'),
  };

  /* ==========================================================================
     03  SMALL HELPERS
     ========================================================================== */
  /** Create an element with optional class and text (text is never parsed as HTML). */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** <svg class="icon"><use href="#i-NAME"/></svg> */
  function svgIcon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  /** localStorage read that never throws (blocked storage → null). */
  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('Distill: storage is not available', error);
      return null;
    }
  }

  /** localStorage write that never throws (settings then last only for this visit). */
  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn('Distill: could not save settings', error);
    }
  }

  /** Words separated by whitespace (same rule as summarize.py). */
  function wordCount(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  /** 1234 → "1,234" */
  function formatNumber(value) {
    return value.toLocaleString('en-US');
  }

  /** The checked radio's value in a group. */
  function radioValue(name) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : '';
  }

  /** Enable/disable a button with aria-disabled (it stays focusable and can explain itself). */
  function setDisabled(button, disabled) {
    button.setAttribute('aria-disabled', String(disabled));
  }

  /* ==========================================================================
     04  STATE & SAVED PREFERENCES
     ========================================================================== */
  const state = {
    theme: 'auto',
    status: 'checking', // checking | ok | offline
    models: [],
    controller: null, // AbortController of the summary being written, or null
    summary: '', // text of the current/last summary
    format: 'bullets', // format the current summary was asked in
    model: '', // model the current summary was asked from (the dropdown may change meanwhile)
  };

  /** Saved length / format / model, checked against the allowed values. */
  function readPrefs() {
    try {
      const prefs = JSON.parse(readStorage(PREFS_KEY) || '{}');
      return {
        length: LENGTHS.includes(prefs.length) ? prefs.length : 'short',
        format: FORMATS.includes(prefs.format) ? prefs.format : 'bullets',
        model: typeof prefs.model === 'string' ? prefs.model : '',
      };
    } catch (error) {
      console.warn('Distill: saved settings were damaged and have been reset', error);
      return { length: 'short', format: 'bullets', model: '' };
    }
  }

  /** Put the saved length and format into the radio buttons. */
  function applyPrefs(prefs) {
    document.querySelector(`input[name="length"][value="${prefs.length}"]`).checked = true;
    document.querySelector(`input[name="format"][value="${prefs.format}"]`).checked = true;
  }

  /** Remember the current options. */
  function savePrefs() {
    const prefs = {
      length: radioValue('length'),
      format: radioValue('format'),
      model: els.modelSelect.value,
    };
    writeStorage(PREFS_KEY, JSON.stringify(prefs));
  }

  /* ==========================================================================
     05  OLLAMA STATUS & MODELS
     ========================================================================== */
  /** True when the page is served by app.py on this computer (not an online copy). */
  function isLocalServer() {
    return LOCAL_HOSTS.includes(location.hostname);
  }

  /** Online copy (GitHub Pages): no AI here, so explain how to run it instead of showing errors. */
  function enterPreviewMode() {
    setStatus('preview', 'preview'); // short: it must fit a phone's top bar (the note explains the rest)
    els.statusPill.setAttribute('aria-label', 'Online preview: Distill runs on your own computer. Show how');
    els.modelSelect.replaceChildren(el('option', '', 'runs locally'));
    els.previewNote.hidden = false;
  }

  /** Clicking summarize (or the pill) in the preview: point at the how-to note. */
  function showPreviewNote() {
    els.previewNote.scrollIntoView({ block: 'nearest' });
    els.previewNote.focus();
    showToast('Distill runs on your own computer — see the steps');
  }

  /** "see an example summary": a real result, clearly labelled as an example. */
  function showExample() {
    els.textInput.value = EXAMPLE.text; // not setText(): focus stays on the button, the summary comes into view
    updateCount();
    state.summary = EXAMPLE.summary;
    state.format = 'bullets';
    state.model = EXAMPLE.model;
    els.output.classList.remove('is-empty');
    renderSummary(EXAMPLE.summary);
    els.statsText.textContent = `example · ${wordCount(EXAMPLE.text)} words → ${wordCount(EXAMPLE.summary)} words · real output from ${EXAMPLE.model}`;
    els.statsText.hidden = false;
    [els.copyBtn, els.downloadBtn].forEach((button) => setDisabled(button, false));
    els.output.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    announce('Example summary shown');
  }

  /** Ask app.py whether Ollama is running; update the pill and the model list. */
  async function checkStatus() {
    if (!isLocalServer()) {
      enterPreviewMode();
      return;
    }
    setStatus('checking', 'checking ollama…');
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      const data = await response.json();
      if (!data.ok) {
        setStatus('offline', 'ollama offline');
        showError(data.error, data.hint);
        return;
      }
      fillModels(data.models, data.default);
    } catch (error) {
      console.error('Distill: the local server is not reachable', error);
      setStatus('offline', 'server stopped');
      showError("Can't reach Distill's local server.", 'In Terminal, run:  python3 app.py');
    }
  }

  /** Update the status pill (data-state drives the dot color). */
  function setStatus(status, label) {
    state.status = status;
    els.statusPill.dataset.state = status;
    els.statusText.textContent = label;
    els.statusPill.setAttribute('aria-label', `Ollama status: ${label}. Check again`);
  }

  /** Fill the model dropdown, keeping the saved choice when it's still installed. */
  function fillModels(models, fallback) {
    state.models = models;
    if (!models.length) {
      els.modelSelect.replaceChildren(el('option', '', 'no models'));
      setStatus('offline', 'no models');
      showError(
        'No AI models are downloaded yet.',
        'In Terminal, run:  ollama pull llama3.2:3b\nThen reload.',
      );
      return;
    }
    els.modelSelect.replaceChildren(...models.map((name) => el('option', '', name)));
    const saved = readPrefs().model;
    els.modelSelect.value = models.includes(saved) ? saved : models.includes(fallback) ? fallback : models[0];
    setStatus('ok', `ollama · ${models.length} model${models.length === 1 ? '' : 's'}`);
    if (els.errorBox.dataset.source === 'status') clearError();
  }

  /* ==========================================================================
     06  TEXT INPUT (typing, files, drag & drop)
     ========================================================================== */
  /** "1,240 words · 7,312 characters" under the text box. */
  function updateCount() {
    const text = els.textInput.value;
    const over = text.length > MAX_CHARS;
    const words = `${formatNumber(wordCount(text))} words`;
    els.countText.textContent = over
      ? `${words} · too long (limit ${formatNumber(MAX_CHARS)} characters)`
      : `${words} · ${formatNumber(text.length)} characters`;
    els.countText.classList.toggle('is-over', over);
  }

  /** Put text into the box (from a file), as if it had been typed. */
  function setText(text) {
    els.textInput.value = text;
    updateCount();
    els.textInput.focus();
  }

  /** Read a dropped or chosen file, refusing anything that isn't plain text. */
  async function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showToast('That file is too large for a text file (2 MB at most)');
      return;
    }
    try {
      const text = await file.text();
      if (text.includes('\u0000')) throw new Error('binary file');
      setText(text);
      showToast(`Opened ${file.name}`);
    } catch (error) {
      console.warn('Distill: could not read the file', error);
      showToast('That file could not be read as text (use .txt or .md)');
    }
  }

  /** "open file" button → the hidden file picker. */
  function chooseFile() {
    els.fileInput.value = ''; // picking the same file again still fires "change"
    els.fileInput.click();
  }

  /** Drag & drop on the text card: highlight while dragging, read the file on drop. */
  function bindDropZone() {
    const card = els.inputCard;
    ['dragenter', 'dragover'].forEach((type) =>
      card.addEventListener(type, (event) => {
        if (!event.dataTransfer || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        card.classList.add('is-dragover');
      }),
    );
    card.addEventListener('dragleave', (event) => {
      if (!card.contains(event.relatedTarget)) card.classList.remove('is-dragover');
    });
    card.addEventListener('drop', (event) => {
      card.classList.remove('is-dragover');
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      loadFile(event.dataTransfer.files[0]);
    });
  }

  /** "clear": empty the text box. */
  function clearText() {
    setText('');
    showToast('Text cleared');
  }

  /* ==========================================================================
     07  SUMMARIZING (request + stream)
     ========================================================================== */
  /** Check the input on this side first, so simple mistakes get an instant message. */
  function inputProblem(text) {
    if (!text.trim()) return ['Nothing to summarize yet.', 'Paste some text, or open a file.'];
    if (wordCount(text) < MIN_WORDS && text.trim().length < 150) {
      return [`That's only ${wordCount(text)} words — too short to summarize.`, ''];
    }
    if (text.length > MAX_CHARS) {
      return ['The text is too long.', `The limit is ${formatNumber(MAX_CHARS)} characters.`];
    }
    if (state.status !== 'ok') return ['Ollama isn’t ready.', 'Check the status pill, then try again.'];
    return null;
  }

  /** True when a summary can start; otherwise explain why not (preview note or error message). */
  function readyToRun() {
    if (state.status === 'preview') {
      showPreviewNote();
      return false;
    }
    const problem = inputProblem(els.textInput.value);
    if (!problem) return true;
    showError(problem[0], problem[1]);
    if (state.status !== 'ok') checkStatus();
    return false;
  }

  /** "summarize": send the text and show the summary as it streams in. */
  async function startSummary() {
    if (state.controller || !readyToRun()) return;
    const text = els.textInput.value;
    const request = {
      text,
      length: radioValue('length'),
      format: radioValue('format'),
      model: els.modelSelect.value,
    };
    beginRun(request);
    try {
      await sendRequest(request);
    } catch (error) {
      handleRunError(error);
    } finally {
      endRun();
    }
  }

  /** POST the request; a 400 answer is shown as an error, a 200 answer is read as a stream. */
  async function sendRequest(request) {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: state.controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      showError(data.error || `The server answered ${response.status}.`, data.hint || '');
      return;
    }
    await readStream(response.body);
  }

  /** Read the JSON-lines stream and handle each event as soon as its line is complete. */
  async function readStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // the last piece may be an unfinished line
      lines.filter((line) => line.trim()).forEach((line) => handleEvent(JSON.parse(line)));
    }
  }

  /** One event from app.py. */
  function handleEvent(event) {
    if (event.type === 'progress') {
      els.progressText.textContent = `reading part ${event.part} of ${event.total}…`;
      els.progressText.hidden = false;
    } else if (event.type === 'text') {
      els.progressText.hidden = true;
      state.summary += event.content;
      renderSummary(state.summary);
    } else if (event.type === 'done') {
      showStats(event);
      announce('Summary ready');
    } else if (event.type === 'error') {
      showError(event.error, event.hint);
    }
  }

  /** A failed or stopped run. Stopping keeps whatever was already written. */
  function handleRunError(error) {
    if (error.name === 'AbortError') {
      showToast(state.summary ? 'Stopped — the partial summary is kept' : 'Stopped');
      return;
    }
    console.error('Distill: summarizing failed', error);
    showError(
      'The summary was interrupted.',
      'Check that Distill is still running in Terminal, then try again.',
    );
  }

  /** "stop" (or Esc): cancel the request; app.py then stops Ollama as well. */
  function stopSummary() {
    if (state.controller) state.controller.abort();
  }

  /** Switch the page into "writing" mode for this request. */
  function beginRun(request) {
    state.controller = new AbortController();
    state.summary = '';
    state.format = request.format;
    state.model = request.model;
    clearError();
    els.statsText.hidden = true;
    els.progressText.hidden = true;
    els.output.replaceChildren();
    els.output.classList.remove('is-empty');
    els.output.classList.add('is-streaming');
    els.outputCard.setAttribute('aria-busy', 'true');
    swapRunButtons(true);
    [els.copyBtn, els.downloadBtn].forEach((button) => setDisabled(button, true));
  }

  /** Back to idle mode after a run (finished, stopped or failed). */
  function endRun() {
    state.controller = null;
    els.progressText.hidden = true;
    els.output.classList.remove('is-streaming');
    els.outputCard.setAttribute('aria-busy', 'false');
    swapRunButtons(false);
    const hasSummary = Boolean(state.summary.trim());
    [els.copyBtn, els.downloadBtn].forEach((button) => setDisabled(button, !hasSummary));
    if (!hasSummary) showPlaceholder();
  }

  /** Show "stop" while writing and "summarize" otherwise, keeping keyboard focus on the visible one. */
  function swapRunButtons(running) {
    const hadFocus = document.activeElement === els.runBtn || document.activeElement === els.stopBtn;
    els.runBtn.hidden = running;
    els.stopBtn.hidden = !running;
    if (hadFocus) (running ? els.stopBtn : els.runBtn).focus();
  }

  /* ==========================================================================
     08  SHOWING THE SUMMARY & ERRORS
     Bullet lines become a list, other lines paragraphs. Always textContent,
     so nothing the model writes is ever run as HTML.
     ========================================================================== */
  /** Draw the summary (called for every streamed piece). */
  function renderSummary(text) {
    const blocks = [];
    let list = null;
    text.split('\n').forEach((line) => {
      if (!line.trim()) return;
      if (BULLET_PATTERN.test(line)) {
        if (!list) blocks.push((list = el('ul')));
        list.append(el('li', '', line.replace(BULLET_PATTERN, '')));
      } else {
        list = null;
        blocks.push(el('p', '', line.trim()));
      }
    });
    els.output.replaceChildren(...blocks);
    els.output.scrollTop = els.output.scrollHeight;
  }

  /** The empty-state message. */
  function showPlaceholder() {
    els.output.classList.add('is-empty');
    els.output.replaceChildren(el('p', 'output-placeholder', 'Your summary will appear here.'));
  }

  /** "1,240 words → 68 words · 5.2 s · llama3.2:3b" */
  function showStats({ words_in: wordsIn, words_out: wordsOut, seconds }) {
    els.statsText.textContent = `${formatNumber(wordsIn)} words → ${formatNumber(wordsOut)} words · ${seconds} s · ${state.model}`;
    els.statsText.hidden = false;
  }

  /**
   * Show a problem above the summary.
   * @param {string} message what went wrong
   * @param {string} [hint] how to fix it (may contain line breaks)
   */
  function showError(message, hint = '') {
    els.errorText.textContent = message;
    els.errorHint.textContent = hint;
    els.errorBox.dataset.source = state.status === 'ok' ? 'run' : 'status';
    els.errorBox.hidden = false;
  }

  /** Hide the problem box. */
  function clearError() {
    els.errorBox.hidden = true;
    delete els.errorBox.dataset.source;
  }

  /* ==========================================================================
     09  COPY & DOWNLOAD
     ========================================================================== */
  /** Copy the summary as plain text (with an older method as fallback when the browser refuses). */
  async function copySummary() {
    const text = state.summary.trim();
    if (!text || state.controller) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Summary copied');
    } catch (error) {
      console.warn('Distill: clipboard API refused, trying the fallback', error);
      const copied = copyWithSelection(text);
      showToast(copied ? 'Summary copied' : 'Copy was blocked — select the summary and press ⌘C');
    }
  }

  /** Fallback copy: put the text in a hidden box, select it, and ask the browser to copy the selection. */
  function copyWithSelection(text) {
    const area = el('textarea', 'sr-only');
    area.value = text;
    area.setAttribute('readonly', '');
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      console.warn('Distill: fallback copy failed', error);
    }
    area.remove();
    els.copyBtn.focus(); // selecting moved focus into the hidden box
    return copied;
  }

  /** Save the summary as summary-2026-11-01-1430.txt. */
  function downloadSummary() {
    if (!state.summary.trim() || state.controller) return;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const blob = new Blob([`${state.summary.trim()}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `summary-${stamp}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Summary saved');
  }

  /* ==========================================================================
     10  DIALOGS — native <dialog>: Esc and focus trap come from the browser
     ========================================================================== */
  const returnFocus = new WeakMap();

  /** Open a dialog and remember where focus should return. */
  function openDialog(dialog) {
    if (dialog.open) return;
    returnFocus.set(dialog, document.activeElement);
    dialog.showModal();
  }

  /** Close buttons, backdrop click and focus restore. */
  function bindDialog(dialog) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
    });
    dialog.addEventListener('close', () => {
      const previous = returnFocus.get(dialog);
      if (previous && document.contains(previous)) previous.focus();
      returnFocus.delete(dialog);
    });
  }

  /* ==========================================================================
     11  TOAST & SCREEN-READER ANNOUNCEMENTS
     ========================================================================== */
  const supportsPopover = typeof HTMLElement.prototype.showPopover === 'function';
  let toastTimer = 0;

  /** A short message at the bottom of the screen (also read by screen readers). */
  function showToast(message) {
    els.toast.textContent = message;
    setToastVisible(false);
    setToastVisible(true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToastVisible(false), TOAST_MS);
    announce(message);
  }

  /** Popover API when available (shows above dialogs), else the hidden attribute. */
  function setToastVisible(visible) {
    if (!supportsPopover) {
      els.toast.hidden = !visible;
      return;
    }
    const isOpen = els.toast.matches(':popover-open');
    if (visible && !isOpen) els.toast.showPopover();
    if (!visible && isOpen) els.toast.hidePopover();
  }

  /** Read a message to screen-reader users (inside an open dialog when there is one). */
  function announce(message) {
    const openDialogEl = document.querySelector('dialog[open]');
    const region = (openDialogEl && openDialogEl.querySelector('.dialog-status')) || els.announcer;
    region.textContent = '';
    setTimeout(() => {
      region.textContent = message;
    }, 50);
  }

  /* ==========================================================================
     12  THEME (auto → light → dark)
     ========================================================================== */
  /** Saved theme, or "auto". */
  function readTheme() {
    const saved = readStorage(THEME_KEY);
    return THEMES.includes(saved) ? saved : 'auto';
  }

  /** Apply a theme to the page, the browser bar and the theme button. */
  function applyTheme(theme) {
    state.theme = theme;
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      if (!meta.dataset.default) meta.dataset.default = meta.content;
      meta.content = THEME_BAR_COLORS[theme] || meta.dataset.default;
    });
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    els.themeBtn.replaceChildren(svgIcon(`theme-${theme}`));
    els.themeBtn.setAttribute('aria-label', `Theme: ${theme}. Switch to ${next}`);
    els.themeBtn.title = `Theme: ${theme} (click for ${next})`;
  }

  /** Theme button. */
  function cycleTheme() {
    const theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    applyTheme(theme);
    writeStorage(THEME_KEY, theme);
    showToast(`Theme: ${theme}`);
  }

  /* ==========================================================================
     13  KEYBOARD SHORTCUTS — keep in sync with the help dialog and README
     ========================================================================== */
  /** True while typing in a field (single-key shortcuts must not fire). */
  function isTyping(target) {
    return target.matches('textarea, select, input:not([type="radio"], [type="checkbox"])');
  }

  /** ⌘/Ctrl+Enter = summarize · Esc = stop · ? = help. */
  function handleShortcuts(event) {
    if (document.querySelector('dialog[open]')) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      startSummary();
    } else if (event.key === 'Escape' && state.controller) {
      event.preventDefault();
      stopSummary();
    } else if (event.key === '?' && !isTyping(event.target)) {
      event.preventDefault();
      openDialog(els.helpDialog);
    }
  }

  /* ==========================================================================
     14  INIT
     ========================================================================== */
  /** Wire every control. */
  function bindEvents() {
    bindTopbar();
    els.textInput.addEventListener('input', updateCount);
    els.openFileBtn.addEventListener('click', chooseFile);
    els.fileInput.addEventListener('change', () => loadFile(els.fileInput.files[0]));
    els.clearBtn.addEventListener('click', clearText);
    els.runBtn.addEventListener('click', startSummary);
    els.stopBtn.addEventListener('click', stopSummary);
    els.copyBtn.addEventListener('click', copySummary);
    els.downloadBtn.addEventListener('click', downloadSummary);
    document.querySelectorAll('input[name="length"], input[name="format"]').forEach((radio) => {
      radio.addEventListener('change', savePrefs);
    });
    els.modelSelect.addEventListener('change', savePrefs);
    document.addEventListener('keydown', handleShortcuts);
    window.addEventListener('focus', () => {
      if (state.status === 'offline') checkStatus(); // e.g. after opening the Ollama app
    });
    bindDialog(els.helpDialog);
    bindDropZone();
  }

  /** Status pill (checks again, or shows the how-to note in the preview), help, theme, example. */
  function bindTopbar() {
    els.statusPill.addEventListener('click', () =>
      state.status === 'preview' ? showPreviewNote() : checkStatus(),
    );
    els.helpBtn.addEventListener('click', () => openDialog(els.helpDialog));
    els.themeBtn.addEventListener('click', cycleTheme);
    els.exampleBtn.addEventListener('click', showExample);
  }

  /** Start: theme, saved options, keyboard hint, events, then check Ollama. */
  function init() {
    applyTheme(readTheme());
    if (supportsPopover) {
      els.toast.setAttribute('popover', 'manual');
      els.toast.hidden = false;
    }
    applyPrefs(readPrefs());
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) {
      els.runHint.firstElementChild.textContent = 'Ctrl';
    }
    updateCount();
    bindEvents();
    checkStatus();
  }

  init();
})();
