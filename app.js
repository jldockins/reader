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

/* Small line icons (drawn with currentColor so they follow the theme). */
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  book: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
  chart: '<path d="M4 19h16"/><path d="M5 15l4-5 4 3 6-7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
};
const icon = (name, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

/* A cover image, with a colored placeholder underneath that shows when there is no image. */
function coverHtml(b, cls = '') {
  let h = 0;
  for (const ch of b.title || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = [158, 18, 210, 280, 35, 340, 190];
  const hue = hues[h % hues.length];
  return `<div class="cover ${cls}" style="--hue:${hue}">
    <span class="cover-title">${esc(b.title)}</span>
    ${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
  </div>`;
}

function lastReadAt(bookId) {
  let t = 0;
  for (const s of state.sessions) if (s.bookId === bookId && s.date > t) t = s.date;
  return t;
}

function featuredCard(b) {
  const st = summarize(sessionsFor(b.id));
  const pct = Math.min(100, (b.currentPage / b.totalPages) * 100);
  const left = Math.max(0, b.totalPages - b.currentPage);
  const remainingSec = st.avgWpm ? ((left * b.wordsPerPage) / st.avgWpm) * 60 : null;
  const isActive = state.active && state.active.bookId === b.id;
  const otherActive = state.active && !isActive;
  return `<div class="feature">
    <div class="feature-label">Continue reading</div>
    <div class="feature-body" data-action="open-book" data-id="${b.id}">
      ${coverHtml(b, 'cover-lg')}
      <div class="grow">
        <h2>${esc(b.title)}</h2>
        ${b.author ? `<div class="author">${esc(b.author)}</div>` : ''}
        <div class="feature-stats">
          <span><strong>${Math.round(pct)}%</strong> done</span>
          ${st.avgWpm ? `<span><strong>${num(st.avgWpm)}</strong> wpm</span>` : ''}
          ${remainingSec != null ? `<span><strong>${fmtDuration(remainingSec)}</strong> left</span>` : `<span><strong>${left}</strong> pages left</span>`}
        </div>
      </div>
    </div>
    <div class="progress"><span style="width:${pct.toFixed(1)}%"></span></div>
    ${isActive
      ? `<button class="btn" data-action="open-timer">Back to timer · <span data-clock>${fmtClock(activeElapsedMs())}</span></button>`
      : `<button class="btn" data-action="start-session" data-id="${b.id}" ${otherActive ? 'disabled' : ''}>${icon('play')} Start reading</button>`}
  </div>`;
}

function renderBooks() {
  const f = state.ui.bookFilter;
  const filters = [['reading', 'Reading'], ['want', 'To read'], ['finished', 'Finished']];

  if (!state.books.length) {
    return `<div class="empty">
      <div class="empty-art">${icon('book', 'ic-xl')}</div>
      <h2>Start your reading log</h2>
      <p>Add the book you're reading — scan its barcode to fill in the details — then time a session to see your words per minute.</p>
      <button class="btn" data-action="add-book">${icon('plus')} Add your first book</button></div>`;
  }

  const reading = state.books.filter((b) => b.status === 'reading');
  const featured = state.active
    ? getBook(state.active.bookId)
    : reading.sort((a, b) => (lastReadAt(b.id) || b.createdAt) - (lastReadAt(a.id) || a.createdAt))[0];

  const books = state.books
    .filter((b) => b.status === f && b !== featured)
    .sort((a, b) => (b.finishedAt || lastReadAt(b.id) || b.createdAt) - (a.finishedAt || lastReadAt(a.id) || a.createdAt));

  const seg = `<div class="segmented" role="tablist">${filters
    .map(([k, label]) => {
      const n = state.books.filter((b) => b.status === k).length;
      return `<button data-action="filter" data-filter="${k}" class="${k === f ? 'active' : ''}">${label}${n ? `<span class="count">${n}</span>` : ''}</button>`;
    })
    .join('')}</div>`;

  const emptyText = { reading: featured ? 'No other books in progress.' : 'Nothing in progress.', want: 'Add books you plan to read next.', finished: 'Finished books will show up here.' }[f];
  return (featured ? featuredCard(featured) : '') + seg +
    (books.length ? `<div class="shelf">${books.map(bookCard).join('')}</div>` : `<div class="empty small"><p>${emptyText}</p></div>`);
}

function bookCard(b) {
  const st = summarize(sessionsFor(b.id));
  const pct = b.totalPages ? Math.min(100, (b.currentPage / b.totalPages) * 100) : 0;
  const right = b.status === 'finished'
    ? `Finished ${b.finishedAt ? fmtDate(b.finishedAt) : ''}`
    : b.status === 'want' ? `${b.totalPages} pages` : `${Math.round(pct)}%`;
  return `<button class="book-card" data-action="open-book" data-id="${b.id}">
    ${coverHtml(b)}
    <div class="grow">
      <h3>${esc(b.title)}</h3>
      ${b.author ? `<div class="author">${esc(b.author)}</div>` : ''}
      ${b.status === 'reading' ? `<div class="progress"><span style="width:${pct.toFixed(1)}%"></span></div>` : ''}
      <div class="meta"><span>${right}</span>${st.avgWpm ? `<span class="pill">${num(st.avgWpm)} wpm</span>` : ''}</div>
    </div>
  </button>`;
}

function renderStats() {
  const filterId = state.ui.statsBook;
  const all = state.sessions.filter((s) => filterId === 'all' || s.bookId === filterId);
  const st = summarize(all);
  const booksWithSessions = state.books.filter((b) => state.sessions.some((s) => s.bookId === b.id));

  if (!state.sessions.length) {
    return `<div class="empty"><div class="empty-art">${icon('chart', 'ic-xl')}</div>
      <h2>No reading sessions yet</h2>
      <p>Open a book and tap <em>Start reading</em>. When you stop, enter the page you reached and Reader works out your words per minute.</p></div>`;
  }

  const select = `<label class="field"><span>Show</span><select data-action="stats-book">
      <option value="all">All books</option>
      ${booksWithSessions.map((b) => `<option value="${b.id}" ${b.id === filterId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}
    </select></label>`;

  const last7 = summarize(all.filter((s) => s.date > Date.now() - 7 * 864e5));
  const recent = [...all].sort((a, b) => b.date - a.date).slice(0, 15);

  return `${select}
    <div class="hero">
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

/** A round step (1, 2, 2.5 or 5 × a power of ten) that splits 0..v into about `parts` pieces. */
function niceStep(v, parts = 4) {
  const raw = Math.max(v, 1) / parts;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
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
  const step = niceStep(Math.max(...pts.map((p) => p.wpm)) * 1.1);
  const yMax = Math.ceil((Math.max(...pts.map((p) => p.wpm)) * 1.1) / step) * step;
  const x = (i) => (pts.length === 1 ? l + (w - l - r) / 2 : l + (i * (w - l - r)) / (pts.length - 1));
  const y = (v) => t + (h - t - b) * (1 - v / yMax);
  chartPoints = pts.map((p, i) => ({ x: x(i), y: y(p.wpm), s: p }));

  const ticks = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
  const grid = ticks.map((v) => `<line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  const yLabels = ticks.map((v) => `<text x="${l - 6}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`).join('');
  const xLabels = pts.length > 1
    ? `<text x="${x(0)}" y="${h - 6}" text-anchor="start">${fmtDate(pts[0].date)}</text>
       <text x="${x(pts.length - 1)}" y="${h - 6}" text-anchor="end">${fmtDate(pts[pts.length - 1].date)}</text>`
    : `<text x="${x(0)}" y="${h - 6}" text-anchor="middle">${fmtDate(pts[0].date)}</text>`;
  const path = chartPoints.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const area = pts.length > 1
    ? `<path class="area" d="${path}L${chartPoints[chartPoints.length - 1].x.toFixed(1)},${y(0)}L${chartPoints[0].x.toFixed(1)},${y(0)}Z"/>`
    : '';
  const dots = pts.length <= 20 ? chartPoints.map((p) => `<circle class="dot" cx="${p.x}" cy="${p.y}" r="4"/>`).join('') : '';
  const avgLine = avg
    ? `<line class="avg" x1="${l}" x2="${w - r}" y1="${y(avg)}" y2="${y(avg)}"/>`
    : '';

  return `<div class="chart-wrap">
    <svg id="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Words per minute for your last ${pts.length} sessions">
      <g class="grid">${grid}</g>
      <g class="axis">${yLabels}${xLabels}</g>
      <defs><linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--chart-line);stop-opacity:.22"/>
        <stop offset="1" style="stop-color:var(--chart-line);stop-opacity:0"/>
      </linearGradient></defs>
      ${area}
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
      <button type="button" class="btn scan-btn" data-action="scan">${icon('camera')} Scan the barcode</button>
      <div class="or"><span>or enter the details</span></div>
      <div class="lookup-row">
        <label class="field"><span>ISBN (optional)</span>
          <input name="isbn" inputmode="numeric" value="${esc(b.isbn || '')}" placeholder="978…"></label>
        <button type="button" class="btn secondary" data-action="lookup-isbn">Look up</button>
      </div>
      <div class="lookup-status" id="lookup-status" ${b.publisher || b.year ? '' : 'hidden'}>${esc(editionLine(b))}</div>
      <input type="hidden" name="cover" value="${esc(b.cover || '')}">
      <input type="hidden" name="publisher" value="${esc(b.publisher || '')}">
      <input type="hidden" name="year" value="${esc(b.year || '')}">
      <label class="field"><span>Title</span><input name="title" required value="${esc(b.title)}" placeholder="e.g. The Hobbit"></label>
      <label class="field"><span>Author (optional)</span><input name="author" value="${esc(b.author)}"></label>
      <div class="row-2">
        <label class="field"><span>Total pages</span><input name="totalPages" type="number" inputmode="numeric" min="1" required value="${b.totalPages}"></label>
        <label class="field"><span>Current page</span><input name="currentPage" type="number" inputmode="numeric" min="0" value="${b.currentPage}"></label>
      </div>
      <label class="field"><span>Words per page</span>
        <input name="wordsPerPage" type="number" inputmode="numeric" min="20" max="2000" required value="${b.wordsPerPage}">
        <div class="hint">Used to turn pages into words. <button type="button" class="link-btn" data-action="toggle-estimator">Work it out for this book</button></div>
      </label>
      <div class="estimator" id="estimator" hidden>
        <p class="est-title">Most accurate: count one full page</p>
        <p class="est-help">Pick a page in the middle of a chapter with no breaks and count every word.</p>
        <div class="lookup-row">
          <label class="field"><span>Words on one full page</span><input id="est-page" type="number" inputmode="numeric" min="1"></label>
          <button type="button" class="btn secondary" data-action="apply-estimate" data-method="page">Use</button>
        </div>
        <p class="est-title">Quicker: sample 3 lines</p>
        <div class="row-2">
          <label class="field"><span>Words in 3 lines</span><input id="est-words" type="number" inputmode="numeric" min="1"></label>
          <label class="field"><span>Lines per page</span><input id="est-lines" type="number" inputmode="numeric" min="1"></label>
        </div>
        <button type="button" class="btn secondary" data-action="apply-estimate" data-method="lines">Use 3-line estimate</button>
        <p class="est-title">If you know the book's total word count</p>
        <p class="est-help">Divided by the total pages above (your edition's page count from the scan).</p>
        <div class="lookup-row">
          <label class="field"><span>Total words in the book</span><input id="est-total" type="number" inputmode="numeric" min="1"></label>
          <button type="button" class="btn secondary" data-action="apply-estimate" data-method="total">Use</button>
        </div>
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
      isbn: normalizeIsbn(String(fd.get('isbn') || '')) || String(fd.get('isbn') || '').trim(),
      cover: String(fd.get('cover') || ''),
      publisher: String(fd.get('publisher') || ''),
      year: String(fd.get('year') || ''),
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
      ${coverHtml(b, 'cover-md')}
      <div class="grow"><h2>${esc(b.title)}</h2>${b.author ? `<div class="sub">${esc(b.author)}</div>` : ''}
        ${editionLine(b) ? `<div class="edition">${esc(editionLine(b))}</div>` : ''}</div>
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
      : `<button class="btn" data-action="start-session" data-id="${id}" ${otherActive ? 'disabled' : ''}>${icon('play')} Start reading</button>
         ${otherActive ? `<div class="hint" style="text-align:center;margin-top:6px">Finish your other session first.</div>` : ''}`}
    <div class="btn-row">
      <button class="btn secondary" data-action="manual-session" data-id="${id}">Log session</button>
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
      <div class="state">${running ? '<span class="live-dot"></span>Timer running — keep reading' : 'Paused'}</div>
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

/* ---------- barcode scanning & ISBN lookup ---------- */

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';

function editionLine(b) {
  return [b.publisher, b.year, b.isbn && `ISBN ${b.isbn}`].filter(Boolean).join(' · ');
}

/** Returns a 13-digit ISBN, or '' if the text isn't a valid ISBN-10/13. */
function normalizeIsbn(text) {
  const s = String(text).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 13 && /^97[89]\d{10}$/.test(s)) {
    const sum = [...s.slice(0, 12)].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : '';
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((acc, d, i) => acc + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
    if (sum % 11) return '';
    const core = '978' + s.slice(0, 9);
    const sum13 = [...core].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
    return core + ((10 - (sum13 % 10)) % 10);
  }
  return '';
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the barcode scanner. Are you online?'));
    document.head.appendChild(s);
  });
}

/** Opens a full-screen camera view and resolves with an ISBN, or null if cancelled. */
function scanBarcode() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'scanner';
    overlay.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="scanner-frame" aria-hidden="true"></div>
      <div class="scanner-text">Point the camera at the barcode on the back of the book</div>
      <button class="btn secondary scanner-cancel">Cancel</button>`;
    document.body.appendChild(overlay);
    const video = $('video', overlay);
    const text = $('.scanner-text', overlay);
    let stream = null, zxControls = null, timer = null, done = false;

    const finish = (isbn) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      if (zxControls) zxControls.stop();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
      resolve(isbn);
    };
    const onCode = (raw) => {
      const isbn = normalizeIsbn(raw);
      if (isbn) {
        if (navigator.vibrate) navigator.vibrate(60);
        finish(isbn);
      } else {
        text.textContent = "That barcode isn't an ISBN. Try the main barcode (starts with 978 or 979).";
      }
    };
    const fail = (err) => {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      text.textContent = denied
        ? 'Camera access was blocked. Allow camera access for this site in your browser settings, or type the ISBN instead.'
        : (err && err.message) || 'Could not start the camera. You can type the ISBN instead.';
    };
    $('.scanner-cancel', overlay).addEventListener('click', () => finish(null));

    (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("This browser can't use the camera here. Type the ISBN instead.");
        }
        const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
        const supported = 'BarcodeDetector' in window
          ? await window.BarcodeDetector.getSupportedFormats().catch(() => [])
          : [];
        const native = supported.includes('ean_13');
        if (native) {
          // Built into Chrome on Android — fast and needs no download.
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (done) return finish(null);
          video.srcObject = stream;
          await video.play();
          const detector = new window.BarcodeDetector({ formats: ['ean_13', 'upc_a'].filter((f) => supported.includes(f)) });
          let busy = false;
          timer = setInterval(async () => {
            if (busy || done || video.readyState < 2) return;
            busy = true;
            try {
              const codes = await detector.detect(video);
              if (codes.length) onCode(codes[0].rawValue);
            } catch { /* keep trying */ }
            busy = false;
          }, 200);
        } else {
          // iPhone Safari and others: use the ZXing library.
          if (!window.ZXingBrowser) await loadScript(ZXING_URL);
          if (done) return;
          const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
          zxControls = await reader.decodeFromConstraints(constraints, video, (result) => {
            if (result && !done) onCode(result.getText());
          });
          if (done) zxControls.stop();
        }
      } catch (err) {
        fail(err);
      }
    })();
  });
}

async function fetchJson(url, retries = 1) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // Free book APIs fail now and then; one quick retry usually fixes it.
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 800));
      return fetchJson(url, retries - 1);
    }
    throw err;
  }
}

/** Looks the edition up in Open Library, then Google Books for anything missing. */
async function lookupIsbn(isbn) {
  const info = { isbn };
  try {
    const d = await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const b = d[`ISBN:${isbn}`];
    if (b) {
      info.title = b.subtitle ? `${b.title}: ${b.subtitle}` : b.title;
      info.author = (b.authors || []).map((a) => a.name).join(', ');
      info.pages = b.number_of_pages || null;
      info.cover = (b.cover && (b.cover.medium || b.cover.small)) || '';
      info.publisher = (b.publishers || [])[0]?.name || '';
      info.year = ((b.publish_date || '').match(/\d{4}/) || [''])[0];
      info.source = 'Open Library';
    }
  } catch { /* try the next source */ }

  if (!info.title || !info.pages) {
    try {
      const d = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
      const v = d.items && d.items[0] && d.items[0].volumeInfo;
      if (v) {
        info.title = info.title || v.title;
        info.author = info.author || (v.authors || []).join(', ');
        info.pages = info.pages || v.pageCount || null;
        info.cover = info.cover || (v.imageLinks && (v.imageLinks.thumbnail || '').replace('http:', 'https:')) || '';
        info.publisher = info.publisher || v.publisher || '';
        info.year = info.year || (v.publishedDate || '').slice(0, 4);
        info.source = info.source ? `${info.source} + Google Books` : 'Google Books';
      }
    } catch { /* ignore */ }
  }
  return info.title ? info : null;
}

async function scanAndFill() {
  const isbn = await scanBarcode();
  if (isbn) lookupAndFill(isbn);
}

async function lookupAndFill(raw) {
  const form = $('#book-form');
  if (!form) return;
  const status = $('#lookup-status');
  const isbn = normalizeIsbn(raw);
  form.elements.isbn.value = isbn || raw;
  status.hidden = false;
  if (!isbn) { status.textContent = "That doesn't look like a valid ISBN. Check the digits under the barcode."; return; }
  if (!navigator.onLine) { status.textContent = "You're offline — fill in the details by hand, or look it up later."; return; }
  status.textContent = `Looking up ${isbn}…`;
  const info = await lookupIsbn(isbn);
  if (!$('#book-form')) return; // sheet was closed meanwhile
  if (!info) {
    status.textContent = `Couldn't find ISBN ${isbn}. Fill in the details by hand.`;
    return;
  }
  const f = form.elements;
  f.title.value = info.title || f.title.value;
  f.author.value = info.author || f.author.value;
  if (info.pages) f.totalPages.value = info.pages;
  f.cover.value = info.cover || '';
  f.publisher.value = info.publisher || '';
  f.year.value = info.year || '';
  status.innerHTML = `${info.cover ? `<img src="${esc(info.cover)}" alt="" onerror="this.remove()">` : ''}
    <div><strong>Found it</strong> (${esc(info.source)})<br>${esc(editionLine(info))}<br>
    ${info.pages
      ? `${info.pages} pages in this edition — check it against the last numbered page in your copy.`
      : 'No page count listed — enter it from your copy.'}</div>`;
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
      const form = $('#book-form');
      let wpp = 0;
      if (el.dataset.method === 'page') wpp = int($('#est-page').value);
      if (el.dataset.method === 'lines') {
        const w = int($('#est-words').value), l = int($('#est-lines').value);
        if (w > 0 && l > 0) wpp = Math.round((w / 3) * l);
      }
      if (el.dataset.method === 'total') {
        const pages = int(form.elements.totalPages.value);
        if (!pages) { toast('Enter the total pages first.'); break; }
        wpp = Math.round(int($('#est-total').value) / pages);
      }
      if (wpp >= 20) {
        form.elements.wordsPerPage.value = wpp;
        $('#estimator').hidden = true;
        toast(`Words per page set to ${wpp}`);
      } else toast('Fill in the numbers for that method first.');
      break;
    }
    case 'scan': scanAndFill(); break;
    case 'lookup-isbn': lookupAndFill($('#book-form').elements.isbn.value); break;
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
