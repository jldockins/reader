'use strict';

/* ============================================================
   Reader — track books and reading speed (words per minute)
   All data lives in this browser's localStorage on your phone.
   ============================================================ */

const STORAGE_KEY = 'reader.v1';
const MIN_SECONDS_FOR_WPM = 60; // shorter sessions are too noisy to score

const defaultState = () => ({
  books: [],      // {id, title, author, totalPages, currentPage, wordsPerPage, status, createdAt, finishedAt}
  sessions: [],   // {id, bookId, date, durationSec, startPage, endPage, pages, words, wpm}
  active: null,   // {bookId, startPage, startedAt, accumulatedMs, runningSince}
  settings: { defaultWordsPerPage: 250 },
  ui: { tab: 'books', bookFilter: 'reading', statsBook: 'all' },
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      ui: { ...base.ui, ...(parsed.ui || {}) },
    };
  } catch (e) {
    console.error('Could not load saved data', e);
    return defaultState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save — storage may be full or blocked.');
  }
}

/* ---------- helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const num = (n) => Math.round(n).toLocaleString();
const getBook = (id) => state.books.find((b) => b.id === id);

function fmtClock(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function fmtDuration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (!h) return `${m} min`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function fmtDate(ts, opts = { month: 'short', day: 'numeric' }) {
  return new Date(ts).toLocaleDateString(undefined, opts);
}

function calcWpm(pages, wordsPerPage, durationSec) {
  if (pages <= 0 || durationSec < MIN_SECONDS_FOR_WPM) return null;
  return (pages * wordsPerPage) / (durationSec / 60);
}

/** Weighted average: total words read ÷ total minutes (only scored sessions). */
function summarize(sessions) {
  let sec = 0, words = 0, pages = 0, scoredSec = 0, scoredWords = 0, best = 0;
  for (const s of sessions) {
    sec += s.durationSec;
    pages += s.pages;
    words += s.words;
    if (s.wpm != null) {
      scoredSec += s.durationSec;
      scoredWords += s.words;
      best = Math.max(best, s.wpm);
    }
  }
  return {
    count: sessions.length,
    sec, words, pages, best,
    avgWpm: scoredSec ? scoredWords / (scoredSec / 60) : null,
  };
}

const sessionsFor = (bookId) => state.sessions.filter((s) => s.bookId === bookId).sort((a, b) => b.date - a.date);

function activeElapsedMs() {
  const a = state.active;
  if (!a) return 0;
  return a.accumulatedMs + (a.runningSince ? Date.now() - a.runningSince : 0);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

/* ---------- main views ---------- */

function render() {
  const tab = state.ui.tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#view-title').textContent = { books: 'Books', stats: 'Reading speed', settings: 'Settings' }[tab];
  $('#add-book-btn').hidden = tab !== 'books';
  const view = $('#view');
  if (tab === 'books') view.innerHTML = renderBooks();
  if (tab === 'stats') { view.innerHTML = renderStats(); bindChart(); }
  if (tab === 'settings') view.innerHTML = renderSettings();
  renderBanner();
}

function renderBooks() {
  const f = state.ui.bookFilter;
  const filters = [['reading', 'Reading'], ['want', 'Want to read'], ['finished', 'Finished']];
  const books = state.books
    .filter((b) => b.status === f)
    .sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt));

  const seg = `<div class="segmented" role="tablist">${filters
    .map(([k, label]) => {
      const n = state.books.filter((b) => b.status === k).length;
      return `<button data-action="filter" data-filter="${k}" class="${k === f ? 'active' : ''}">${label}${n ? ` (${n})` : ''}</button>`;
    })
    .join('')}</div>`;

  if (!state.books.length) {
    return `${seg}<div class="empty"><div class="big">📖</div>
      <p><strong>No books yet</strong></p>
      <p>Add the book you're reading, then start a timed session to measure your words per minute.</p>
      <button class="btn" data-action="add-book">Add your first book</button></div>`;
  }
  if (!books.length) {
    return `${seg}<div class="empty"><p>Nothing here yet.</p></div>`;
  }

  return seg + books.map(bookCard).join('');
}

function bookCard(b) {
  const st = summarize(sessionsFor(b.id));
  const pct = b.totalPages ? Math.min(100, (b.currentPage / b.totalPages) * 100) : 0;
  return `<button class="card book-card" data-action="open-book" data-id="${b.id}">
    <div class="row">
      <div><h3>${esc(b.title)}</h3>${b.author ? `<div class="author">${esc(b.author)}</div>` : ''}</div>
      ${st.avgWpm ? `<div class="wpm">${num(st.avgWpm)} <small>wpm</small></div>` : ''}
    </div>
    <div class="progress"><span style="width:${pct.toFixed(1)}%"></span></div>
    <div class="meta"><span>Page ${b.currentPage} of ${b.totalPages}</span><span>${Math.round(pct)}%${st.sec ? ` · ${fmtDuration(st.sec)} read` : ''}</span></div>
  </button>`;
}

function renderStats() {
  const filterId = state.ui.statsBook;
  const all = state.sessions.filter((s) => filterId === 'all' || s.bookId === filterId);
  const st = summarize(all);
  const booksWithSessions = state.books.filter((b) => state.sessions.some((s) => s.bookId === b.id));

  if (!state.sessions.length) {
    return `<div class="empty"><div class="big">⏱️</div>
      <p><strong>No reading sessions yet</strong></p>
      <p>Open a book and tap <em>Start reading</em>. When you stop, enter the page you reached and Reader works out your words per minute.</p></div>`;
  }

  const select = `<label class="field"><span>Show</span><select data-action="stats-book">
      <option value="all">All books</option>
      ${booksWithSessions.map((b) => `<option value="${b.id}" ${b.id === filterId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}
    </select></label>`;

  const last7 = summarize(all.filter((s) => s.date > Date.now() - 7 * 864e5));
  const recent = [...all].sort((a, b) => b.date - a.date).slice(0, 15);

  return `${select}
    <div class="stat hero">
      <div class="label">Average reading speed</div>
      <div class="value">${st.avgWpm ? num(st.avgWpm) : '—'} <small>wpm</small></div>
      <div class="label">${last7.avgWpm ? `Last 7 days: ${num(last7.avgWpm)} wpm` : 'Based on all timed sessions'}</div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="label">Time reading</div><div class="value">${fmtDuration(st.sec)}</div></div>
      <div class="stat"><div class="label">Pages read</div><div class="value">${num(st.pages)}</div></div>
      <div class="stat"><div class="label">Sessions</div><div class="value">${st.count}</div></div>
      <div class="stat"><div class="label">Fastest session</div><div class="value">${st.best ? num(st.best) : '—'} <small>wpm</small></div></div>
    </div>
    <div class="section-title">Speed over time</div>
    <div class="card">${chartSvg(all, st.avgWpm)}</div>
    <div class="section-title">Recent sessions</div>
    <div class="list">${recent.map((s) => sessionRow(s, filterId === 'all')).join('')}</div>`;
}

function sessionRow(s, showBook) {
  const b = getBook(s.bookId);
  const title = showBook && b ? esc(b.title) : fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric' });
  const sub = `${showBook ? fmtDate(s.date) + ' · ' : ''}${fmtDuration(s.durationSec)} · pp. ${s.startPage}–${s.endPage} (${s.pages} pages)`;
  return `<div class="list-item">
    <div><div class="primary">${title}</div><div class="secondary">${sub}</div></div>
    <div class="num">${s.wpm != null ? `${num(s.wpm)} wpm` : '<span class="secondary">too short</span>'}</div>
    <button class="del" data-action="delete-session" data-id="${s.id}" aria-label="Delete session">×</button>
  </div>`;
}

function renderSettings() {
  const st = summarize(state.sessions);
  return `
    <div class="card">
      <label class="field"><span>Default words per page for new books</span>
        <input type="number" inputmode="numeric" min="50" max="1000" value="${state.settings.defaultWordsPerPage}" data-action="default-wpp"></label>
      <div class="prose"><p>A typical paperback has about 250–300 words per page. You can set a different number for each book.</p></div>
    </div>
    <div class="section-title">Your data</div>
    <div class="card">
      <div class="prose"><p>${state.books.length} books · ${st.count} sessions. Your data is stored only on this device. Export a backup now and then so you don't lose it if you clear your browser.</p></div>
      <button class="btn secondary" data-action="export">Export backup</button>
      <button class="btn secondary" data-action="import">Import backup</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
      <button class="btn danger" data-action="reset">Erase all data</button>
    </div>
    <div class="section-title">Install on your phone</div>
    <div class="card prose">
      <p><strong>iPhone:</strong> open this page in Safari, tap the Share button, then <em>Add to Home Screen</em>.</p>
      <p><strong>Android:</strong> open it in Chrome, tap the ⋮ menu, then <em>Install app</em> or <em>Add to Home screen</em>.</p>
      <p>Once installed it opens full screen and works offline.</p>
    </div>`;
}

/* ---------- chart ---------- */

const CHART = { w: 600, h: 200, l: 40, r: 10, t: 12, b: 24 };
let chartPoints = [];

function niceMax(v) {
  if (v <= 0) return 100;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

function chartSvg(sessions, avg) {
  const pts = sessions.filter((s) => s.wpm != null).sort((a, b) => a.date - b.date).slice(-30);
  if (!pts.length) {
    chartPoints = [];
    return `<div class="prose"><p>Read for at least a minute in a session to see your speed here.</p></div>`;
  }
  // Draw at the card's real pixel width so text stays readable on phones.
  CHART.w = Math.max(260, Math.min(600, ($('#view').clientWidth || 360) - 32 - 32));
  const { w, h, l, r, t, b } = CHART;
  const yMax = niceMax(Math.max(...pts.map((p) => p.wpm)) * 1.1);
  const x = (i) => (pts.length === 1 ? l + (w - l - r) / 2 : l + (i * (w - l - r)) / (pts.length - 1));
  const y = (v) => t + (h - t - b) * (1 - v / yMax);
  chartPoints = pts.map((p, i) => ({ x: x(i), y: y(p.wpm), s: p }));

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const grid = ticks.map((v) => `<line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  const yLabels = ticks.map((v) => `<text x="${l - 6}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`).join('');
  const xLabels = pts.length > 1
    ? `<text x="${x(0)}" y="${h - 6}" text-anchor="start">${fmtDate(pts[0].date)}</text>
       <text x="${x(pts.length - 1)}" y="${h - 6}" text-anchor="end">${fmtDate(pts[pts.length - 1].date)}</text>`
    : `<text x="${x(0)}" y="${h - 6}" text-anchor="middle">${fmtDate(pts[0].date)}</text>`;
  const path = chartPoints.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const dots = pts.length <= 20 ? chartPoints.map((p) => `<circle class="dot" cx="${p.x}" cy="${p.y}" r="4"/>`).join('') : '';
  const avgLine = avg
    ? `<line class="avg" x1="${l}" x2="${w - r}" y1="${y(avg)}" y2="${y(avg)}"/>`
    : '';

  return `<div class="chart-wrap">
    <svg id="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Words per minute for your last ${pts.length} sessions">
      <g class="grid">${grid}</g>
      <g class="axis">${yLabels}${xLabels}</g>
      ${avgLine}
      <path class="series" d="${path}"/>
      ${dots}
      <line class="crosshair" id="crosshair" y1="${t}" y2="${h - b}" visibility="hidden"/>
      <circle class="focus" id="focus" r="6" visibility="hidden"/>
      <rect id="hit" x="${l}" y="0" width="${w - l - r}" height="${h}" fill="transparent"/>
    </svg>
    <div class="tooltip" id="tooltip" hidden></div>
  </div>
  <div class="legend"><span><i></i>Words per minute</span>${avg ? `<span><i class="dash"></i>Average ${num(avg)}</span>` : ''}</div>`;
}

function bindChart() {
  const svg = $('#chart');
  if (!svg || !chartPoints.length) return;
  const tip = $('#tooltip'), cross = $('#crosshair'), focus = $('#focus');

  const show = (evt) => {
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / CHART.w;
    const vx = (evt.clientX - rect.left) / scale;
    let best = chartPoints[0];
    for (const p of chartPoints) if (Math.abs(p.x - vx) < Math.abs(best.x - vx)) best = p;
    cross.setAttribute('x1', best.x); cross.setAttribute('x2', best.x);
    cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', best.x); focus.setAttribute('cy', best.y);
    focus.setAttribute('visibility', 'visible');
    const b = getBook(best.s.bookId);
    tip.innerHTML = `<strong>${num(best.s.wpm)} wpm</strong><br>${fmtDate(best.s.date)} · ${fmtDuration(best.s.durationSec)}${b ? `<br>${esc(b.title)}` : ''}`;
    tip.hidden = false;
    const px = Math.min(Math.max(best.x * scale, 70), rect.width - 70);
    tip.style.left = `${px}px`;
    tip.style.top = `${best.y * scale}px`;
  };
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    focus.setAttribute('visibility', 'hidden');
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

/* ---------- active-session banner ---------- */

function renderBanner() {
  const el = $('#active-banner');
  const a = state.active;
  const sheetOpen = !$('#sheet').hidden;
  if (!a || sheetOpen) { el.hidden = true; return; }
  const b = getBook(a.bookId);
  el.hidden = false;
  el.innerHTML = `<div style="min-width:0">
      <div class="title">${a.runningSince ? 'Reading' : 'Paused'} · ${esc(b ? b.title : '')}</div>
      <div class="time" data-clock>${fmtClock(activeElapsedMs())}</div>
    </div>
    <button data-action="open-timer">Open</button>`;
}

/* ---------- sheets ---------- */

let sheetOnClose = null;

function openSheet(html, onClose) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="grabber"></div>${html}`;
  sheet.hidden = false;
  $('#sheet-backdrop').hidden = false;
  sheet.scrollTop = 0;
  sheetOnClose = onClose || null;
  document.body.style.overflow = 'hidden';
  render(); // keep the page behind the sheet current
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  document.body.style.overflow = '';
  const cb = sheetOnClose;
  sheetOnClose = null;
  if (cb) cb();
  render();
}

function bookFormSheet(book) {
  const b = book || {
    title: '', author: '', totalPages: '', currentPage: 0,
    wordsPerPage: state.settings.defaultWordsPerPage, status: 'reading',
  };
  openSheet(`
    <div class="sheet-head"><h2>${book ? 'Edit book' : 'Add a book'}</h2>
      <button class="link-btn" data-action="close">Cancel</button></div>
    <form id="book-form" autocomplete="off">
      <label class="field"><span>Title</span><input name="title" required value="${esc(b.title)}" placeholder="e.g. The Hobbit"></label>
      <label class="field"><span>Author (optional)</span><input name="author" value="${esc(b.author)}"></label>
      <div class="row-2">
        <label class="field"><span>Total pages</span><input name="totalPages" type="number" inputmode="numeric" min="1" required value="${b.totalPages}"></label>
        <label class="field"><span>Current page</span><input name="currentPage" type="number" inputmode="numeric" min="0" value="${b.currentPage}"></label>
      </div>
      <label class="field"><span>Words per page</span>
        <input name="wordsPerPage" type="number" inputmode="numeric" min="20" max="2000" required value="${b.wordsPerPage}">
        <div class="hint">Used to turn pages into words. <button type="button" class="link-btn" data-action="toggle-estimator">Estimate it for this book</button></div>
      </label>
      <div class="estimator" id="estimator" hidden>
        Count the words on 3 full lines, then count the lines on a full page.
        <div class="row-2">
          <label class="field"><span>Words in 3 lines</span><input id="est-words" type="number" inputmode="numeric" min="1"></label>
          <label class="field"><span>Lines per page</span><input id="est-lines" type="number" inputmode="numeric" min="1"></label>
        </div>
        <button type="button" class="btn secondary" data-action="apply-estimate">Use estimate</button>
      </div>
      <label class="field"><span>Status</span><select name="status">
        ${[['reading', 'Reading'], ['want', 'Want to read'], ['finished', 'Finished']]
          .map(([k, l]) => `<option value="${k}" ${b.status === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
      <button class="btn" type="submit">${book ? 'Save changes' : 'Add book'}</button>
      ${book ? `<button class="btn danger" type="button" data-action="delete-book" data-id="${book.id}">Delete book</button>` : ''}
    </form>`);

  $('#book-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const totalPages = Math.max(1, int(fd.get('totalPages')));
    const data = {
      title: String(fd.get('title')).trim(),
      author: String(fd.get('author')).trim(),
      totalPages,
      currentPage: Math.min(totalPages, Math.max(0, int(fd.get('currentPage')))),
      wordsPerPage: Math.max(20, int(fd.get('wordsPerPage')) || state.settings.defaultWordsPerPage),
      status: String(fd.get('status')),
    };
    if (!data.title) return;
    if (book) {
      if (data.status === 'finished' && book.status !== 'finished') data.finishedAt = Date.now();
      Object.assign(book, data);
      save();
      bookDetailSheet(book.id);
    } else {
      const nb = { id: uid(), createdAt: Date.now(), finishedAt: data.status === 'finished' ? Date.now() : null, ...data };
      state.books.push(nb);
      state.ui.bookFilter = nb.status;
      save();
      bookDetailSheet(nb.id);
    }
  });
}

function bookDetailSheet(id) {
  const b = getBook(id);
  if (!b) return closeSheet();
  const sessions = sessionsFor(id);
  const st = summarize(sessions);
  const pct = Math.min(100, (b.currentPage / b.totalPages) * 100);
  const remainingWords = Math.max(0, b.totalPages - b.currentPage) * b.wordsPerPage;
  const remainingSec = st.avgWpm ? (remainingWords / st.avgWpm) * 60 : null;
  const isActiveHere = state.active && state.active.bookId === id;
  const otherActive = state.active && !isActiveHere;

  openSheet(`
    <div class="sheet-head">
      <div><h2>${esc(b.title)}</h2>${b.author ? `<div class="sub">${esc(b.author)}</div>` : ''}</div>
      <button class="link-btn" data-action="close">Done</button>
    </div>
    <div class="progress"><span style="width:${pct.toFixed(1)}%"></span></div>
    <div class="meta" style="margin-bottom:14px"><span>Page ${b.currentPage} of ${b.totalPages}</span><span>${Math.round(pct)}%</span></div>

    <div class="stat-grid">
      <div class="stat"><div class="label">Avg speed</div><div class="value">${st.avgWpm ? num(st.avgWpm) : '—'} <small>wpm</small></div></div>
      <div class="stat"><div class="label">Time read</div><div class="value">${st.sec ? fmtDuration(st.sec) : '—'}</div></div>
      <div class="stat"><div class="label">Time left (est.)</div><div class="value">${b.status === 'finished' ? 'Done' : remainingSec != null ? fmtDuration(remainingSec) : '—'}</div></div>
      <div class="stat"><div class="label">Words / page</div><div class="value">${b.wordsPerPage}</div></div>
    </div>

    ${isActiveHere
      ? `<button class="btn" data-action="open-timer">Back to timer · <span data-clock>${fmtClock(activeElapsedMs())}</span></button>`
      : `<button class="btn" data-action="start-session" data-id="${id}" ${otherActive ? 'disabled' : ''}>▶ Start reading</button>
         ${otherActive ? `<div class="hint" style="text-align:center;margin-top:6px">Finish your other session first.</div>` : ''}`}
    <div class="btn-row">
      <button class="btn secondary" data-action="manual-session" data-id="${id}">Log past session</button>
      <button class="btn secondary" data-action="edit-book" data-id="${id}">Edit book</button>
    </div>
    ${b.status !== 'finished' ? `<button class="btn secondary" data-action="finish-book" data-id="${id}">Mark as finished</button>` : ''}

    <div class="section-title">Sessions</div>
    ${sessions.length
      ? `<div class="list">${sessions.map((s) => sessionRow(s, false)).join('')}</div>`
      : `<div class="prose"><p>No sessions yet. Start the timer when you sit down to read.</p></div>`}
  `);
}

function startSession(bookId) {
  const b = getBook(bookId);
  if (!b || state.active) return;
  if (b.status !== 'reading') { b.status = 'reading'; b.finishedAt = null; }
  state.active = { bookId, startPage: b.currentPage, startedAt: Date.now(), accumulatedMs: 0, runningSince: Date.now() };
  save();
  timerSheet();
}

function timerSheet() {
  const a = state.active;
  if (!a) return closeSheet();
  const b = getBook(a.bookId);
  if (!b) { state.active = null; save(); return closeSheet(); }
  const running = !!a.runningSince;
  openSheet(`
    <div class="sheet-head">
      <div><h2>${esc(b.title)}</h2><div class="sub">Reading session</div></div>
      <button class="link-btn" data-action="close">Minimize</button>
    </div>
    <div class="timer">
      <div class="clock" data-clock>${fmtClock(activeElapsedMs())}</div>
      <div class="state">${running ? 'Timer running — keep reading' : 'Paused'}</div>
    </div>
    <label class="field"><span>Started on page</span>
      <input id="start-page" type="number" inputmode="numeric" min="0" max="${b.totalPages}" value="${a.startPage}"></label>
    <div class="btn-row">
      <button class="btn secondary" data-action="${running ? 'pause' : 'resume'}">${running ? 'Pause' : 'Resume'}</button>
      <button class="btn" data-action="stop">Stop &amp; log pages</button>
    </div>
    <button class="btn danger" data-action="discard">Discard session</button>
    <div class="prose" style="margin-top:8px"><p>You can lock your phone or close the app — the timer keeps counting.</p></div>
  `);
  $('#start-page').addEventListener('change', (e) => {
    state.active.startPage = Math.max(0, int(e.target.value));
    save();
  });
}

function pauseSession() {
  const a = state.active;
  if (!a || !a.runningSince) return;
  a.accumulatedMs += Date.now() - a.runningSince;
  a.runningSince = null;
  save();
}

function stopSheet() {
  pauseSession();
  const a = state.active;
  const b = getBook(a.bookId);
  const durationSec = Math.round(a.accumulatedMs / 1000);
  openSheet(`
    <div class="sheet-head">
      <div><h2>Nice reading!</h2><div class="sub">${esc(b.title)} · ${fmtDuration(durationSec)}</div></div>
    </div>
    <div class="row-2">
      <label class="field"><span>Started on page</span><input id="sp" type="number" inputmode="numeric" min="0" value="${a.startPage}"></label>
      <label class="field"><span>Stopped on page</span><input id="ep" type="number" inputmode="numeric" min="0" max="${b.totalPages}" placeholder="Page you reached" autofocus></label>
    </div>
    <div class="result" id="result"><div class="label">Enter the page you reached</div></div>
    <button class="btn" id="save-session" disabled>Save session</button>
    <button class="btn secondary" data-action="resume-from-stop">Keep reading</button>
  `);

  const update = () => {
    const sp = int($('#sp').value), ep = int($('#ep').value);
    const pages = ep - sp;
    const ok = $('#ep').value !== '' && pages > 0;
    $('#save-session').disabled = !ok;
    const wpm = ok ? calcWpm(pages, b.wordsPerPage, durationSec) : null;
    $('#result').innerHTML = !ok
      ? `<div class="label">${$('#ep').value === '' ? 'Enter the page you reached' : 'End page must be after the start page'}</div>`
      : wpm != null
        ? `<div class="value">${num(wpm)} wpm</div><div class="label">${pages} pages · ~${num(pages * b.wordsPerPage)} words</div>`
        : `<div class="label">${pages} pages. Sessions under a minute are saved without a speed.</div>`;
  };
  $('#sp').addEventListener('input', update);
  $('#ep').addEventListener('input', update);
  $('#save-session').addEventListener('click', () => {
    const sp = int($('#sp').value), ep = Math.min(b.totalPages, int($('#ep').value));
    recordSession(b, { date: a.startedAt, durationSec, startPage: sp, endPage: ep });
    state.active = null;
    save();
    bookDetailSheet(b.id);
  });
}

function recordSession(b, { date, durationSec, startPage, endPage }) {
  const pages = Math.max(0, endPage - startPage);
  const words = pages * b.wordsPerPage;
  const wpm = calcWpm(pages, b.wordsPerPage, durationSec);
  state.sessions.push({ id: uid(), bookId: b.id, date, durationSec, startPage, endPage, pages, words, wpm });
  b.currentPage = Math.max(b.currentPage, endPage);
  if (b.currentPage >= b.totalPages && b.status !== 'finished') {
    b.status = 'finished';
    b.finishedAt = Date.now();
    toast(`🎉 You finished ${b.title}!`);
  } else if (b.status === 'want') {
    b.status = 'reading';
  }
  if (wpm != null && b.status !== 'finished') toast(`Saved · ${num(wpm)} wpm`);
}

function manualSessionSheet(bookId) {
  const b = getBook(bookId);
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  openSheet(`
    <div class="sheet-head"><h2>Log a past session</h2><button class="link-btn" data-action="back-to-book" data-id="${bookId}">Cancel</button></div>
    <form id="manual-form">
      <label class="field"><span>Date</span><input name="date" type="date" value="${localDate}" max="${localDate}" required></label>
      <label class="field"><span>Minutes read</span><input name="minutes" type="number" inputmode="decimal" min="1" step="any" required></label>
      <div class="row-2">
        <label class="field"><span>Start page</span><input name="sp" type="number" inputmode="numeric" min="0" value="${b.currentPage}" required></label>
        <label class="field"><span>End page</span><input name="ep" type="number" inputmode="numeric" min="1" max="${b.totalPages}" required></label>
      </div>
      <button class="btn" type="submit">Save session</button>
    </form>`);
  $('#manual-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const sp = int(fd.get('sp')), ep = Math.min(b.totalPages, int(fd.get('ep')));
    const minutes = parseFloat(fd.get('minutes'));
    if (!(ep > sp)) return toast('End page must be after the start page.');
    if (!(minutes > 0)) return toast('Enter how many minutes you read.');
    const [y, m, d] = String(fd.get('date')).split('-').map(Number);
    const date = new Date(y, m - 1, d, 12).getTime();
    recordSession(b, { date, durationSec: Math.round(minutes * 60), startPage: sp, endPage: ep });
    save();
    bookDetailSheet(bookId);
  });
}

/* ---------- backup ---------- */

function exportData() {
  const data = { app: 'reader', version: 1, exportedAt: new Date().toISOString(), books: state.books, sessions: state.sessions, settings: state.settings };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reader-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.books) || !Array.isArray(data.sessions)) throw new Error('bad file');
      if (!confirm(`Replace your current data with ${data.books.length} books and ${data.sessions.length} sessions from this backup?`)) return;
      state.books = data.books;
      state.sessions = data.sessions;
      if (data.settings) state.settings = { ...state.settings, ...data.settings };
      state.active = null;
      save();
      render();
      toast('Backup imported');
    } catch {
      toast("That file doesn't look like a Reader backup.");
    }
  };
  reader.readAsText(file);
}

/* ---------- events ---------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], .tab');
  if (!el) return;
  if (el.classList.contains('tab')) {
    state.ui.tab = el.dataset.tab;
    save();
    window.scrollTo(0, 0);
    return render();
  }
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'filter': state.ui.bookFilter = el.dataset.filter; save(); render(); break;
    case 'add-book': bookFormSheet(); break;
    case 'open-book': bookDetailSheet(id); break;
    case 'edit-book': bookFormSheet(getBook(id)); break;
    case 'back-to-book': bookDetailSheet(id); break;
    case 'close': closeSheet(); break;
    case 'finish-book': {
      const b = getBook(id);
      b.status = 'finished'; b.finishedAt = Date.now(); b.currentPage = b.totalPages;
      save(); toast(`🎉 You finished ${b.title}!`); bookDetailSheet(id);
      break;
    }
    case 'delete-book': {
      const b = getBook(id);
      if (!confirm(`Delete "${b.title}" and all of its reading sessions?`)) return;
      state.books = state.books.filter((x) => x.id !== id);
      state.sessions = state.sessions.filter((s) => s.bookId !== id);
      if (state.active && state.active.bookId === id) state.active = null;
      save(); closeSheet();
      break;
    }
    case 'delete-session': {
      if (!confirm('Delete this session?')) return;
      const s = state.sessions.find((x) => x.id === id);
      state.sessions = state.sessions.filter((x) => x.id !== id);
      save();
      if (!$('#sheet').hidden && s) bookDetailSheet(s.bookId); else render();
      break;
    }
    case 'toggle-estimator': $('#estimator').hidden = !$('#estimator').hidden; break;
    case 'apply-estimate': {
      const w = int($('#est-words').value), l = int($('#est-lines').value);
      if (w > 0 && l > 0) {
        document.querySelector('#book-form [name=wordsPerPage]').value = Math.round((w / 3) * l);
        $('#estimator').hidden = true;
      } else toast('Fill in both numbers first.');
      break;
    }
    case 'start-session': startSession(id); break;
    case 'open-timer': timerSheet(); break;
    case 'pause': pauseSession(); timerSheet(); break;
    case 'resume':
    case 'resume-from-stop':
      if (state.active && !state.active.runningSince) { state.active.runningSince = Date.now(); save(); }
      timerSheet();
      break;
    case 'stop': stopSheet(); break;
    case 'discard':
      if (!confirm('Discard this session? The time will not be saved.')) return;
      state.active = null; save(); closeSheet();
      break;
    case 'manual-session': manualSessionSheet(id); break;
    case 'export': exportData(); break;
    case 'import': $('#import-file').click(); break;
    case 'reset':
      if (!confirm('Erase all books and sessions on this device? This cannot be undone. Export a backup first if you want to keep them.')) return;
      state = defaultState(); save(); render(); toast('All data erased');
      break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.action === 'stats-book') { state.ui.statsBook = t.value; save(); render(); }
  if (t.dataset.action === 'default-wpp') {
    const v = int(t.value);
    if (v >= 20) { state.settings.defaultWordsPerPage = v; save(); toast('Saved'); }
  }
  if (t.id === 'import-file' && t.files[0]) { importData(t.files[0]); t.value = ''; }
});

$('#add-book-btn').addEventListener('click', () => bookFormSheet());
$('#sheet-backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

// Live clocks — computed from timestamps, so they stay right after the phone sleeps.
setInterval(() => {
  if (!state.active) return;
  const text = fmtClock(activeElapsedMs());
  document.querySelectorAll('[data-clock]').forEach((el) => (el.textContent = text));
}, 500);

// Re-read storage when returning to the app (e.g. another tab changed it).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('#sheet').hidden) { state = load(); render(); }
});

if (state.ui.statsBook !== 'all' && !getBook(state.ui.statsBook)) state.ui.statsBook = 'all';
render();
if (state.active) timerSheet();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
