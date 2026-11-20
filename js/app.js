import * as db from './db.js';
import { openViewer, closeViewer } from './viewer.js';

/* ---------- helpers ---------- */

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fmtSize = b => b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';

const SCORE_EXT = /\.(pdf|png|jpe?g|webp|gif)$/i;
const XMAS = /christmas|xmas|carol|\bno[eë]l\b|nowell|advent|nativity|bethlehem|manger|santa|jingle|sleigh|reindeer|rudolph|mistletoe|holly|wenceslas|while shepherds|wise men|three kings|silent night|holy night|stille nacht|frosty|snowman|winter wonderland|let it snow|yule|emmanuel|immanuel|little donkey|all ye faithful|adeste|herald angels|joy to the world|midwinter|god rest ye|deck the hall|little town|royal david|twelve days|ding dong merrily|drummer boy|mary'?s boy child|it came upon|in dulci|gaudete|coventry|cherry tree|angels from the realms|infant holy|tannenbaum|feliz navidad|mince pie/i;

const DEFAULT_CATEGORIES = () => [{ id: 'current', name: 'Current' }, { id: 'christmas', name: 'Christmas' }];

// Earlier versions had a Non-Christmas category (id 'general'); those songs are now just uncategorised.
function dropNonChristmas() {
  state.categories = state.categories.filter(c => c.id !== 'general');
  for (const s of Object.values(state.songs)) s.cats = s.cats.filter(c => c !== 'general');
  for (const b of Object.values(state.pending || {})) b.cats = (b.cats || []).filter(c => c !== 'general');
}

/* ---------- state ---------- */

let state;
const ui = { tab: 'songs', q: '', cat: 'all', select: null, progId: null, progEdit: false };

async function loadState() {
  state = await db.get('kv', 'state').catch(() => null);
  if (!state) state = { categories: DEFAULT_CATEGORIES(), songs: {}, programmes: [], settings: {} };
  state.settings = { fit: 'width', fullscreen: true, ...state.settings };
  // Added in a later version: give existing libraries the Current category once (it can be deleted).
  if (!state.addedCurrent) {
    if (!state.categories.some(c => c.id === 'current')) state.categories.unshift({ id: 'current', name: 'Current' });
    state.addedCurrent = true;
    save();
  }
  if (!state.capitalisedTitles) {
    capitaliseOldTitles();
    state.capitalisedTitles = true;
    save();
  }
  if (!state.removedNonChristmas) {
    dropNonChristmas();
    state.removedNonChristmas = true;
    save();
  }
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 200);
}
function flush() {
  clearTimeout(saveTimer);
  return db.put('kv', 'state', state).catch(err => toast('Could not save: ' + err.message));
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

const songs = () => Object.values(state.songs);
const catName = id => state.categories.find(c => c.id === id)?.name ?? '';
const programme = id => state.programmes.find(p => p.id === id);

function filterSongs(q, cat) {
  const words = norm(q).split(' ').filter(Boolean);
  return songs()
    .filter(s => cat === 'all' || (cat === 'none' ? !s.cats.length : s.cats.includes(cat)))
    .filter(s => { const t = norm(s.title + ' ' + s.file + ' ' + (s.notes || '')); return words.every(w => t.includes(w)); })
    .sort((a, b) => collator.compare(a.title, b.title));
}

/* ---------- Android back button: each sheet / sub-screen / viewer is a history entry ---------- */

const layers = [];
let ignorePops = 0;
function pushLayer(close) {
  layers.push(close);
  history.pushState({ layer: layers.length }, '');
}
function replaceTopLayer(close) { layers[layers.length - 1] = close; }
function back() { if (layers.length) history.back(); }
function dropAllLayers() {
  if (!layers.length) return;
  const n = layers.length;
  layers.length = 0;
  ignorePops++;
  history.go(-n);
}
window.addEventListener('popstate', () => {
  if (ignorePops) { ignorePops--; return; }
  const close = layers.pop();
  close?.();
});

/* ---------- toast & sheet ---------- */

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

let sheetOpen = false, sheetLocked = false, sheetOnClose = null;
function openSheet(html, { locked = false, onClose = null } = {}) {
  // Start from a fresh element so click handlers from the previous sheet don't carry over.
  const old = $('#sheet-body');
  const body = old.cloneNode(false);
  old.replaceWith(body);
  body.innerHTML = html;
  sheetLocked = locked;
  sheetOnClose = onClose;
  if (!sheetOpen) {
    sheetOpen = true;
    $('#sheet').hidden = false;
    $('#sheet-backdrop').hidden = false;
    pushLayer(hideSheet);
  }
  $('#sheet').scrollTop = 0;
}
function hideSheet() {
  sheetOpen = false;
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  $('#sheet-body').innerHTML = '';
  const cb = sheetOnClose;
  sheetOnClose = null;
  cb?.();
}
function closeSheet() { if (sheetOpen) back(); }
$('#sheet-backdrop').addEventListener('click', () => { if (!sheetLocked) closeSheet(); });

/* ---------- viewer ---------- */

async function getSong(id) {
  const s = state.songs[id];
  if (!s) return null;
  const blob = await db.get('files', id);
  return blob ? { title: s.title, kind: s.kind, blob } : null;
}

function openSong(id) {
  const s = state.songs[id];
  if (!s) return;
  viewSongs([{ songId: id, title: s.title }], 0, '');
}

// Redraw on the way out, so notes added in the viewer show in the list.
function closeViewerAndRefresh() { closeViewer(); render(); }

function viewSongs(items, index, label) {
  if (sheetOpen) {
    // Close the sheet without leaving its history entry, then let the viewer own that entry.
    sheetOpen = false;
    $('#sheet').hidden = true;
    $('#sheet-backdrop').hidden = true;
    sheetOnClose = null;
    replaceTopLayer(closeViewerAndRefresh);
  } else {
    pushLayer(closeViewerAndRefresh);
  }
  openViewer($('#viewer'), {
    items, index, label, getSong,
    fit: state.settings.fit,
    fullscreen: state.settings.fullscreen,
    onFit: fit => { state.settings.fit = fit; save(); },
    getNotes: id => state.songs[id]?.notes ?? '',
    onNotes: (id, text) => { const s = state.songs[id]; if (s) { s.notes = text; save(); } },
    onClose: back
  });
  $('#viewer [data-v="notes"]').hidden = false; // hidden while viewing an edit's preview
}

/* ---------- top bar & tabs ---------- */

function setTop(title, { backBtn = false, actions = '' } = {}) {
  $('#title').textContent = title;
  $('#back').hidden = !backBtn;
  $('#top-actions').innerHTML = actions;
}
$('#back').addEventListener('click', back);

document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => {
  dropAllLayers();
  if (sheetOpen) hideSheet();
  ui.tab = b.dataset.tab;
  ui.progId = null;
  ui.progEdit = false;
  ui.select = null;
  render();
  window.scrollTo(0, 0);
}));

function render() {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  document.body.classList.toggle('selecting', !!ui.select);
  if (ui.tab === 'songs') renderSongs();
  else if (ui.tab === 'programmes') ui.progId && programme(ui.progId) ? renderProgramme() : renderProgrammes();
  else renderLibrary();
}

const view = $('#view');

/* ---------- Songs tab ---------- */

function categoryChips(counts, current, attr = 'data-cat') {
  const chip = (id, label, n) =>
    `<button class="chip ${current === id ? 'on' : ''}" ${attr}="${esc(id)}">${esc(label)} <span class="n">${n}</span></button>`;
  return chip('all', 'All', counts.all) +
    state.categories.map(c => chip(c.id, c.name, counts[c.id] || 0)).join('') +
    (counts.none ? chip('none', 'Uncategorised', counts.none) : '');
}

function countByCat() {
  const counts = { all: 0, none: 0 };
  for (const s of songs()) {
    counts.all++;
    if (!s.cats.length) counts.none++;
    for (const c of s.cats) counts[c] = (counts[c] || 0) + 1;
  }
  return counts;
}

// Tag colours: fixed for the built-in categories, then a cycle for any you add.
const FIXED_COLOURS = { christmas: 'red', current: 'blue' };
const EXTRA_COLOURS = ['green', 'amber', 'purple', 'teal'];
function catColour(id) {
  if (FIXED_COLOURS[id]) return FIXED_COLOURS[id];
  const extras = state.categories.filter(c => !FIXED_COLOURS[c.id]);
  const i = extras.findIndex(c => c.id === id);
  return i < 0 ? '' : EXTRA_COLOURS[i % EXTRA_COLOURS.length];
}
function notesSnippet(s) {
  const n = (s.notes || '').trim();
  return n ? `<span class="row-notes">📝 ${esc(n.replace(/\s+/g, ' '))}</span>` : '';
}
function catTags(s) {
  return s.cats.map(c => `<span class="tag ${catColour(c)}">${esc(catName(c))}</span>`).join('');
}

function renderSongs() {
  const total = songs().length;
  if (!total) {
    setTop('Songs');
    view.innerHTML = `
      <div class="welcome">
        <div class="welcome-art" aria-hidden="true">𝄞</div>
        <h2>Add your scores</h2>
        <p>Import a folder of scores from this phone, or download them from GitHub. The app copies the PDFs and pictures into its own storage on this phone, so they open instantly, even offline.</p>
        <button class="btn primary big" data-act="import-folder">Import scores</button>
        <button class="btn primary big" data-act="github-import">Download from GitHub</button>
        <button class="btn" data-act="import-files">Choose files instead</button>
        <p class="hint">In the picker, open the folder to import. If you can only pick files, open that folder, then use ⋮ › <b>Select all</b>.</p>
      </div>`;
    return;
  }
  setTop('Songs', {
    actions: ui.select
      ? `<button class="btn small" data-act="select-all">All</button><button class="btn small" data-act="select-done">Done</button>`
      : `<button class="btn small" data-act="select-start">Select</button>`
  });
  view.innerHTML = `
    <div class="sticky-tools">
      <input id="q" class="search" type="search" placeholder="Search ${plural(total, 'song')}" value="${esc(ui.q)}" autocomplete="off">
      <div class="chips" id="cat-chips"></div>
    </div>
    <ul class="list song-list" id="song-list"></ul>
    <div id="select-bar" class="select-bar" ${ui.select ? '' : 'hidden'}></div>`;
  $('#q').addEventListener('input', e => { ui.q = e.target.value; updateSongList(); });
  updateSongList();
}

function updateSongList() {
  if (ui.cat !== 'all' && ui.cat !== 'none' && !state.categories.some(c => c.id === ui.cat)) ui.cat = 'all';
  const counts = countByCat();
  if (ui.cat === 'none' && !counts.none) ui.cat = 'all';
  $('#cat-chips').innerHTML = categoryChips(counts, ui.cat);
  const list = filterSongs(ui.q, ui.cat);
  $('#song-list').innerHTML = list.length ? list.map(s => `
    <li class="row ${ui.select?.has(s.id) ? 'selected' : ''}" data-song="${s.id}">
      ${ui.select ? '<span class="check" aria-hidden="true"></span>' : ''}
      <button class="row-main" data-open="${s.id}">
        <span class="row-title song-title">${esc(s.title)}</span>
        <span class="row-meta">${catTags(s)}<span class="kind">${s.kind === 'pdf' ? 'PDF' : 'Image'}</span>${s.source === 'github' ? '<span class="kind">· ☁ GitHub</span>' : s.folder && s.folder.toLowerCase() !== '_bfs' ? `<span class="kind">· 📁 ${esc(s.folder)}</span>` : ''}</span>
        ${notesSnippet(s)}
      </button>
      ${ui.select ? '' : `<button class="icon-btn" data-more="${s.id}" aria-label="Options for ${esc(s.title)}">⋯</button>`}
    </li>`).join('') : `<li class="empty">No songs match.</li>`;
  updateSelectBar();
}

function updateSelectBar() {
  const bar = $('#select-bar');
  if (!bar) return;
  bar.hidden = !ui.select;
  if (!ui.select) return;
  const n = ui.select.size;
  bar.innerHTML = `
    <span class="sel-count">${n} selected</span>
    <button class="btn small" data-act="sel-cat" ${n ? '' : 'disabled'}>Category</button>
    <button class="btn small" data-act="sel-prog" ${n ? '' : 'disabled'}>Add to programme</button>
    <button class="btn small danger" data-act="sel-del" ${n ? '' : 'disabled'} aria-label="Remove selected">🗑</button>`;
}

function songSheet(id) {
  const s = state.songs[id];
  if (!s) return;
  const progs = state.programmes.filter(p => p.items.some(i => i.songId === id));
  const fileName = s.file.split('/').pop();
  const fileTitle = titleFromFile(fileName);
  openSheet(`
    <h2 id="s-head">${esc(s.title)}</h2>
    <label class="field">Name in the app<input id="s-title" value="${esc(s.title)}" autocomplete="off" enterkeyhint="done"></label>
    <div class="file-link">
      <span class="muted small">Linked to the file <b>${esc(s.file)}</b>${s.source === 'github' ? ' on GitHub' : ''} · ${s.kind === 'pdf' ? 'PDF' : 'Image'} · ${fmtSize(s.size)}</span>
      <button class="link small" id="s-reset" ${s.title === fileTitle ? 'hidden' : ''}>Use the file name</button>
    </div>
    <p class="hint">Renaming only changes the name shown here. The file itself isn't renamed, and it stays linked, so re-importing keeps your name.</p>
    <div class="field">Categories
      <div class="chips wrap">${state.categories.map(c =>
        `<button class="chip ${s.cats.includes(c.id) ? 'on' : ''}" data-toggle-cat="${c.id}">${esc(c.name)}</button>`).join('')}</div>
    </div>
    <label class="field">Notes<textarea id="s-notes" rows="4" placeholder="e.g. key, tempo, repeats, who sings which verse…">${esc(s.notes || '')}</textarea></label>
    ${progs.length ? `<p class="muted small">In: ${progs.map(p => esc(p.name)).join(', ')}</p>` : ''}
    <div class="stack">
      <button class="btn primary" data-act="sheet-open" data-id="${id}">Open score</button>
      <button class="btn" data-act="sheet-addprog" data-id="${id}">Add to programme…</button>
      ${s.source === 'github' && s.kind === 'pdf' ? `<button class="btn" data-act="sheet-edit-ly" data-id="${id}">Edit LilyPond source${state.drafts?.[id] ? ' (draft)' : ''}</button>` : ''}
      <button class="btn danger" data-act="sheet-delsong" data-id="${id}">Remove from app</button>
    </div>`, { onClose: render });
  const input = $('#s-title');
  const setTitle = t => {
    s.title = t;
    $('#s-head').textContent = t;
    $('#s-reset').hidden = t === fileTitle;
    save();
  };
  // Save as you type, so closing the sheet straight away doesn't lose the new name.
  input.addEventListener('input', () => { const t = input.value.trim(); if (t) setTitle(t); });
  input.addEventListener('change', () => { if (!input.value.trim()) input.value = s.title; });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  $('#s-reset').addEventListener('click', () => { input.value = fileTitle; setTitle(fileTitle); });
  $('#s-notes').addEventListener('input', e => { s.notes = e.target.value; save(); });
  $('#sheet-body').addEventListener('click', e => {
    const b = e.target.closest('[data-toggle-cat]');
    if (!b) return;
    const c = b.dataset.toggleCat;
    s.cats = s.cats.includes(c) ? s.cats.filter(x => x !== c) : [...s.cats, c];
    b.classList.toggle('on', s.cats.includes(c));
    save();
  });
}

function bulkCategorySheet(ids) {
  const draw = () => {
    const sel = ids.map(id => state.songs[id]).filter(Boolean);
    $('#sheet-body').innerHTML = `
      <h2>Category for ${plural(sel.length, 'song')}</h2>
      <p class="muted small">Tap to add or remove a category for all selected songs.</p>
      <div class="stack">${state.categories.map(c => {
        const n = sel.filter(s => s.cats.includes(c.id)).length;
        const mark = n === sel.length ? 'on' : n ? 'some' : '';
        return `<button class="btn toggle ${mark}" data-bulk-cat="${c.id}"><span class="box"></span>${esc(c.name)}<span class="muted small">${n}/${sel.length}</span></button>`;
      }).join('')}</div>
      <button class="btn primary" data-act="close-sheet">Done</button>`;
  };
  openSheet('', { onClose: render });
  draw();
  $('#sheet-body').addEventListener('click', e => {
    const b = e.target.closest('[data-bulk-cat]');
    if (!b) return;
    const c = b.dataset.bulkCat;
    const sel = ids.map(id => state.songs[id]).filter(Boolean);
    const all = sel.every(s => s.cats.includes(c));
    for (const s of sel) s.cats = all ? s.cats.filter(x => x !== c) : s.cats.includes(c) ? s.cats : [...s.cats, c];
    save();
    draw();
  });
}

function addToProgrammeSheet(ids) {
  const progs = [...state.programmes].sort(progSort);
  openSheet(`
    <h2>Add ${ids.length === 1 ? '“' + esc(state.songs[ids[0]]?.title) + '”' : plural(ids.length, 'song')} to…</h2>
    <div class="stack">
      ${progs.map(p => `<button class="btn list-btn" data-add-to="${p.id}"><b>${esc(p.name)}</b><span class="muted small">${[fmtDate(p.date), plural(songCount(p), 'song')].filter(Boolean).join(' · ')}</span></button>`).join('')}
      <button class="btn primary" data-act="new-prog-with">+ New programme</button>
    </div>`, { onClose: render });
  $('#sheet-body').addEventListener('click', e => {
    const b = e.target.closest('[data-add-to]');
    if (b) {
      const p = programme(b.dataset.addTo);
      const added = addSongsToProgramme(p, ids);
      ui.select = null;
      toast(added ? `Added ${plural(added, 'song')} to “${p.name}”` : `Already in “${p.name}”`);
      closeSheet();
    } else if (e.target.closest('[data-act="new-prog-with"]')) {
      programmeDetailsSheet(null, ids);
    }
  });
}

function addSongsToProgramme(p, ids) {
  let n = 0;
  for (const id of ids) {
    const s = state.songs[id];
    if (!s || p.items.some(i => i.songId === id)) continue;
    p.items.push({ id: uid(), songId: id, title: s.title });
    n++;
  }
  p.updated = Date.now();
  save();
  return n;
}

async function deleteSongs(ids) {
  for (const id of ids) {
    delete state.songs[id];
    await db.del('files', id).catch(() => {});
  }
  await flush();
}

/* ---------- Programmes tab ---------- */

const songCount = p => p.items.filter(i => i.songId).length;
const progSort = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.updated || 0) - (a.updated || 0);

function renderProgrammes() {
  setTop('Programmes', { actions: `<button class="btn small primary" data-act="new-prog">+ New</button>` });
  const progs = [...state.programmes].sort(progSort);
  view.innerHTML = progs.length ? `
    <ul class="list">${progs.map(p => `
      <li class="row"><button class="row-main" data-prog="${p.id}">
        <span class="row-title">${esc(p.name)}</span>
        <span class="row-meta">${[fmtDate(p.date), p.venue, plural(songCount(p), 'song')].filter(Boolean).map(esc).join(' · ')}</span>
      </button><span class="chev" aria-hidden="true">›</span></li>`).join('')}
    </ul>` : `
    <div class="welcome">
      <div class="welcome-art" aria-hidden="true">☰</div>
      <h2>No programmes yet</h2>
      <p>A programme is the list of songs for a concert, in the order you'll perform them. Open it on the night and step from one score to the next.</p>
      <button class="btn primary big" data-act="new-prog">+ New programme</button>
    </div>`;
}

function openProgramme(id) {
  ui.progId = id;
  ui.progEdit = false;
  pushLayer(() => { ui.progId = null; ui.progEdit = false; render(); });
  render();
  window.scrollTo(0, 0);
}

function programmeItemsForViewer(p) {
  const out = [];
  let notes = [];
  for (const it of p.items) {
    if (it.note != null) { notes.push(it.note); continue; }
    const s = state.songs[it.songId];
    out.push({ songId: it.songId, title: s?.title ?? it.title, notes, itemId: it.id });
    notes = [];
  }
  return out;
}

function renderProgramme() {
  const p = programme(ui.progId);
  setTop(p.name, {
    backBtn: true,
    actions: `<button class="btn small" data-act="prog-edit">${ui.progEdit ? 'Done' : 'Edit'}</button>`
  });
  let n = 0;
  const rows = p.items.map((it, idx) => {
    const handle = ui.progEdit ? `<span class="handle" data-handle="${idx}" aria-label="Drag to reorder">≡</span>` : '';
    const remove = ui.progEdit ? `<button class="icon-btn" data-remove-item="${it.id}" aria-label="Remove">✕</button>` : '';
    if (it.note != null) {
      return `<li class="row note-row" data-idx="${idx}">${handle}<button class="row-main" data-edit-note="${it.id}"><span class="note-text">${esc(it.note)}</span></button>${remove}</li>`;
    }
    n++;
    const s = state.songs[it.songId];
    return `<li class="row" data-idx="${idx}">${handle}<span class="num">${n}</span>
      <button class="row-main" data-play="${it.id}" ${s ? '' : 'disabled'}>
        <span class="row-title song-title">${esc(s?.title ?? it.title)}</span>
        <span class="row-meta">${s ? catTags(s) : '<span class="tag warn">Not in library</span>'}</span>
        ${s ? notesSnippet(s) : ''}
      </button>${remove}</li>`;
  }).join('');
  view.innerHTML = `
    <div class="prog-head">
      <p class="muted">${[fmtDate(p.date), p.venue].filter(Boolean).map(esc).join(' · ') || 'No date set'}</p>
      ${p.notes ? `<p class="prog-notes">${esc(p.notes)}</p>` : ''}
      <div class="prog-actions">
        <button class="btn primary" data-act="prog-start" ${songCount(p) ? '' : 'disabled'}>▶ Start</button>
        <button class="btn" data-act="prog-add">+ Songs</button>
        <button class="btn" data-act="prog-more" aria-label="More options">⋯</button>
      </div>
    </div>
    ${p.items.length ? `<ol class="list prog-list ${ui.progEdit ? 'editing' : ''}" id="prog-list">${rows}</ol>`
      : `<p class="empty">No songs yet. Tap <b>+ Songs</b> to pick them in performance order.</p>`}
    ${ui.progEdit ? `<p class="hint">Drag ≡ to change the order. <button class="link" data-act="prog-note">+ Add a note</button> (such as “Interval”).</p>`
      : p.items.length ? `<p class="hint">${plural(songCount(p), 'song')}. Tap a title to open it; tap <b>Edit</b> to reorder.</p>` : ''}`;
  if (ui.progEdit) setupDrag(p);
}

function programmeDetailsSheet(id, songIds = null) {
  const p = id ? programme(id) : { name: '', date: '', venue: '', notes: '' };
  openSheet(`
    <h2>${id ? 'Programme details' : 'New programme'}</h2>
    <label class="field">Name<input id="p-name" value="${esc(p.name)}" placeholder="e.g. Christmas Concert 2026"></label>
    <label class="field">Date<input id="p-date" type="date" value="${esc(p.date)}"></label>
    <label class="field">Venue<input id="p-venue" value="${esc(p.venue)}" placeholder="Optional"></label>
    <label class="field">Notes<textarea id="p-notes" rows="2" placeholder="Optional">${esc(p.notes)}</textarea></label>
    <button class="btn primary" id="p-save">${id ? 'Save' : 'Create'}</button>`);
  $('#p-name').focus();
  $('#p-save').addEventListener('click', () => {
    const name = $('#p-name').value.trim();
    if (!name) { $('#p-name').focus(); toast('Give the programme a name'); return; }
    Object.assign(p, { name, date: $('#p-date').value, venue: $('#p-venue').value.trim(), notes: $('#p-notes').value.trim(), updated: Date.now() });
    if (!id) {
      Object.assign(p, { id: uid(), items: [], created: Date.now() });
      state.programmes.push(p);
      if (songIds) addSongsToProgramme(p, songIds);
    }
    save();
    if (id) { closeSheet(); return; }
    // New programme: go to it, and if it's empty open the song picker straight away.
    ui.select = null;
    sheetOnClose = null;
    const goTo = () => {
      ui.tab = 'programmes';
      openProgramme(p.id);
      if (!p.items.length) pickSongsSheet(p.id);
    };
    sheetOnClose = goTo;
    closeSheet();
  });
}

function pickSongsSheet(progId) {
  const p = programme(progId);
  let q = '', cat = 'all';
  openSheet(`
    <div class="pick-head">
      <h2>Add songs <span class="muted small" id="pick-count"></span></h2>
      <button class="btn small primary" data-act="close-sheet">Done</button>
    </div>
    <p class="muted small">Tap songs in the order they'll be performed. Tap again to remove.</p>
    <input id="pick-q" class="search" type="search" placeholder="Search" autocomplete="off">
    <div class="chips" id="pick-chips"></div>
    <ul class="list pick-list" id="pick-list"></ul>`, { onClose: render });
  const draw = () => {
    $('#pick-chips').innerHTML = categoryChips(countByCat(), cat, 'data-pick-cat');
    const order = new Map(p.items.filter(i => i.songId).map((i, n) => [i.songId, n + 1]));
    $('#pick-count').textContent = `· ${plural(order.size, 'song')}`;
    const list = filterSongs(q, cat);
    $('#pick-list').innerHTML = list.length ? list.map(s => `
      <li class="row ${order.has(s.id) ? 'picked' : ''}"><button class="row-main" data-pick="${s.id}">
        <span class="pick-num">${order.get(s.id) ?? '+'}</span>
        <span class="row-title song-title">${esc(s.title)}</span>
      </button></li>`).join('') : `<li class="empty">${songs().length ? 'No songs match.' : 'Your library is empty. Import scores from the Library tab first.'}</li>`;
  };
  draw();
  $('#pick-q').addEventListener('input', e => { q = e.target.value; draw(); });
  $('#sheet-body').addEventListener('click', e => {
    const c = e.target.closest('[data-pick-cat]');
    if (c) { cat = c.dataset.pickCat; draw(); return; }
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const id = b.dataset.pick;
    const at = p.items.findIndex(i => i.songId === id);
    if (at >= 0) p.items.splice(at, 1);
    else addSongsToProgramme(p, [id]);
    p.updated = Date.now();
    save();
    draw();
  });
}

function noteSheet(progId, itemId = null) {
  const p = programme(progId);
  const it = itemId ? p.items.find(i => i.id === itemId) : null;
  openSheet(`
    <h2>${it ? 'Edit note' : 'Add a note'}</h2>
    <p class="muted small">Notes appear between songs, e.g. “Interval”, “Audience sing-along” or “Reading”.</p>
    <label class="field">Note<input id="n-text" value="${esc(it?.note ?? '')}" placeholder="Interval"></label>
    <div class="stack">
      <button class="btn primary" id="n-save">${it ? 'Save' : 'Add to end'}</button>
      ${it ? `<button class="btn danger" id="n-del">Delete note</button>` : ''}
    </div>`);
  $('#n-text').focus();
  $('#n-save').addEventListener('click', () => {
    const text = $('#n-text').value.trim() || 'Interval';
    if (it) it.note = text; else p.items.push({ id: uid(), note: text });
    p.updated = Date.now();
    save();
    sheetOnClose = render;
    closeSheet();
  });
  $('#n-del')?.addEventListener('click', () => {
    p.items = p.items.filter(i => i !== it);
    save();
    sheetOnClose = render;
    closeSheet();
  });
}

function programmeMoreSheet(id) {
  openSheet(`
    <h2>${esc(programme(id).name)}</h2>
    <div class="stack">
      <button class="btn" data-act="prog-details">Edit name, date &amp; venue</button>
      <button class="btn" data-act="prog-note">Add a note (e.g. Interval)</button>
      <button class="btn" data-act="prog-share">Share or copy song list</button>
      <button class="btn" data-act="prog-dup">Duplicate programme</button>
      <button class="btn danger" data-act="prog-del">Delete programme</button>
    </div>`);
}

function programmeText(p) {
  let n = 0;
  const lines = [p.name, [fmtDate(p.date), p.venue].filter(Boolean).join(', '), ''];
  for (const it of p.items) {
    if (it.note != null) lines.push(`— ${it.note} —`);
    else lines.push(`${++n}. ${state.songs[it.songId]?.title ?? it.title}`);
  }
  return lines.filter((l, i) => l || i === 2).join('\n');
}

async function shareProgramme(p) {
  const text = programmeText(p);
  try {
    if (navigator.share) { await navigator.share({ title: p.name, text }); return; }
  } catch (err) { if (err.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Song list copied'); }
  catch { toast('Could not share or copy'); }
}

// Drag-to-reorder for the programme list (touch and mouse).
function setupDrag(p) {
  const list = $('#prog-list');
  if (!list) return;
  list.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-handle]');
    if (!h) return;
    e.preventDefault();
    const row = h.closest('li');
    const rows = [...list.children];
    const from = rows.indexOf(row);
    const rowH = row.getBoundingClientRect().height;
    const mids = rows.map(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 + window.scrollY; });
    const startY = e.clientY + window.scrollY;
    let to = from, lastY = e.clientY, raf = 0;
    row.classList.add('dragging');
    h.setPointerCapture(e.pointerId);
    const update = () => {
      const y = lastY + window.scrollY;
      row.style.transform = `translateY(${y - startY}px)`;
      const centre = mids[from] + (y - startY);
      to = mids.filter((m, i) => i !== from && m < centre).length;
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -rowH;
        if (from > to && i >= to && i < from) shift = rowH;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const autoScroll = () => {
      const edge = 70;
      const vh = window.innerHeight;
      const dy = lastY < edge ? -8 : lastY > vh - edge - 64 ? 8 : 0;
      if (dy) { window.scrollBy(0, dy); update(); }
      raf = requestAnimationFrame(autoScroll);
    };
    raf = requestAnimationFrame(autoScroll);
    const move = ev => { lastY = ev.clientY; update(); };
    const up = () => {
      cancelAnimationFrame(raf);
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      if (to !== from) {
        const [it] = p.items.splice(from, 1);
        p.items.splice(to, 0, it);
        p.updated = Date.now();
        save();
      }
      render();
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  });
}

/* ---------- Library tab ---------- */

async function renderLibrary() {
  const newDrafts = Object.entries(state.drafts || {}).filter(([id]) => isNewId(id)).sort((a, b) => (b[1].created || 0) - (a[1].created || 0));
  setTop('Library');
  const all = songs();
  const pdfs = all.filter(s => s.kind === 'pdf').length;
  const bytes = all.reduce((t, s) => t + (s.size || 0), 0);
  view.innerHTML = `
    <section class="card">
      <h2>Scores</h2>
      <p>${all.length ? `${plural(all.length, 'song')} (${pdfs} PDF, ${all.length - pdfs} image) · ${fmtSize(bytes)}` : 'No scores imported yet.'}</p>
      <h3>From this phone</h3>
      <div class="stack">
        <button class="btn primary" data-act="import-folder">Import from phone</button>
        <button class="btn" data-act="import-files">Add individual files</button>
      </div>
      <p class="hint">In the picker, open the folder to import. Only the scores directly in the folder you choose are imported, not those in its sub-folders. To add a sub-folder's scores, tap <b>Import from phone</b> again and open that sub-folder instead. Re-import whenever you add or change scores: new files are added and changed ones updated, and your titles, categories and programmes are kept. If you can only pick files, open the folder and use ⋮ › <b>Select all</b>.</p>
      <h3>From GitHub</h3>
      <p class="muted small">${esc(ghConfig().owner)}/${esc(ghLabel(ghConfig()))}${ghConfig().token ? ' · token saved' : ''}</p>
      <div class="stack">
        <button class="btn primary" data-act="github-import">${all.some(s => s.source === 'github') ? 'Update from GitHub' : 'Download from GitHub'}</button>
        <button class="btn" data-act="github-settings">GitHub settings</button>
      </div>
      <p class="hint">Downloads the scores in that GitHub folder (not its sub-folders). Tap <b>Update from GitHub</b> after changing scores there: only new and changed files are downloaded, and your titles, categories and programmes are kept. A private repository needs an access token: see <b>GitHub settings</b>.</p>
      <p class="muted small" id="engine-info"></p>
    </section>
    <section class="card">
      <h2>Import and convert</h2>
      <p class="hint">Photograph a score, or choose PDFs, pictures or music files (MusicXML, ABC or LilyPond) from the phone or Google Drive, and Claude (Anthropic's AI model) writes it as a LilyPond file in the BFS house style. You check it and correct it in the editor, then publish it to GitHub, which makes the PDF. Uses your own Claude API key; each conversion costs a little.</p>
      <div class="stack">
        <button class="btn primary" data-act="photo-camera">Take photos</button>
        <button class="btn" data-act="photo-pick">Choose photos</button>
        <button class="btn" data-act="photo-file">Choose files (phone or Google Drive)</button>
        <button class="btn" data-act="claude-settings">Claude API key${claudeKey() ? ' · saved' : ''}</button>
      </div>
      ${newDrafts.length ? `<h3>Not published yet</h3><ul class="list">${newDrafts.map(([id, d]) => `
        <li class="row"><button class="row-main" data-new-draft="${esc(id)}"><span class="row-title song-title">${esc(d.title)}</span>
        <span class="row-meta">${esc(d.lyPath)} · ${esc(d.originals || plural(d.photos || 0, 'photo'))}</span></button><span class="chev" aria-hidden="true">›</span></li>`).join('')}</ul>` : ''}
    </section>
    <section class="card">
      <h2>Categories</h2>
      <ul class="list cat-list">${state.categories.map(c => `
        <li class="row"><span class="row-main static"><span class="row-title">${esc(c.name)}</span>
        <span class="row-meta">${plural(all.filter(s => s.cats.includes(c.id)).length, 'song')}</span></span>
        <button class="icon-btn" data-cat-rename="${c.id}" aria-label="Rename ${esc(c.name)}">✎</button>
        <button class="icon-btn" data-cat-del="${c.id}" aria-label="Delete ${esc(c.name)}">✕</button></li>`).join('')}
      </ul>
      <button class="btn" data-act="cat-add">+ Add category</button>
      ${all.length ? `<button class="btn" data-act="auto-cat">Re-guess Christmas songs…</button>` : ''}
      <p class="hint">Use <b>Current</b> for the songs you're rehearsing now: tap ⋯ beside a song, or <b>Select</b> several on the Songs tab, then <b>Category</b>. New songs whose titles look Christmassy, such as “Silent Night” or “Jingle Bells”, go in Christmas automatically; everything else starts uncategorised. To fix one, tap ⋯ beside it, or use <b>Select</b> on the Songs tab to change many at once.</p>
    </section>
    <section class="card">
      <h2>Viewing</h2>
      <label class="switch"><input type="checkbox" id="set-fs" ${state.settings.fullscreen ? 'checked' : ''}> Open scores full screen</label>
      <p class="hint">In a score: pinch or double-tap to zoom. Tap the right or left edge to go forward or back a screen (at the end of a song in a programme, this moves to the next song). Tap the middle to show the controls. ↕/↔ switches between whole-page and fit-to-width. Bluetooth page-turner pedals work too. The screen stays on while a score is open.</p>
    </section>
    <section class="card">
      <h2>Backup</h2>
      <p class="hint">Saves your programmes, categories and song titles (not the score files, which stay on your phone or on GitHub). After restoring on a new phone, import your scores or download them from GitHub again and everything will match up. Your GitHub access token isn't included: enter it again in GitHub settings.</p>
      <div class="stack">
        <button class="btn" data-act="backup">Download backup</button>
        <button class="btn" data-act="restore">Restore from backup…</button>
      </div>
      <p class="muted small" id="storage-info"></p>
    </section>
    ${all.length ? `<section class="card">
      <h2>Remove all scores</h2>
      <p class="hint">Clears every score from the app to free up space or start again. The original files on your phone or on GitHub aren't touched, and programmes and categories are kept.</p>
      <button class="btn danger" data-act="wipe">Remove all scores…</button>
    </section>` : ''}`;
  $('#set-fs').addEventListener('change', e => { state.settings.fullscreen = e.target.checked; save(); });
  showEngineInfo();
  if (navigator.storage?.estimate) {
    const [est, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted?.() ?? false]);
    const el = $('#storage-info');
    if (el) el.textContent = `Storage used: ${fmtSize(est.usage || 0)}${persisted ? ' · protected from automatic clean-up' : ''}`;
  }
}

/* ---------- importing ---------- */

// A song's key is its path including the chosen folder's name, e.g. "_bfs/silent night.pdf"
// or "christmas/silent night.pdf", so the same file name in different folders stays separate.
// Libraries from before folders were tracked stored just "silent night.pdf".
const fileKey = f => (f.webkitRelativePath || f.name).toLowerCase();
const baseName = key => key.split('/').pop();
const sameKey = (oldKey, key) => oldKey === key || (!oldKey.includes('/') && key.split('/').length === 2 && baseName(key) === oldKey);
// How earlier versions turned a file name into a title (kept to recognise titles nobody has renamed).
const rawTitleFromFile = name => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

// Song names: every word starts with a capital letter, including short words like "of" and "the".
// Words that already contain a capital letter are left as they are, e.g. "BWV" or "McCartney".
const CONTRACTIONS = { heres: 'here’s', theres: 'there’s', twas: '’twas', tis: '’tis', dont: 'don’t', wont: 'won’t', cant: 'can’t', im: 'i’m', ive: 'i’ve', youre: 'you’re', whats: 'what’s', thats: 'that’s', oer: 'o’er', neer: 'ne’er', eer: 'e’er' };
const capFirst = w => w.replace(/^([^a-z]*)([a-z])/, (m, pre, c) => pre + c.toUpperCase());
function titleCase(text) {
  const words = text.split(' ');
  return words.map((w, i) => {
    if (i === 0 && w === 'its') w = 'it’s'; // "its time to go now"
    w = CONTRACTIONS[w] ?? w;
    if (w === 'i' || w === 'o') return w.toUpperCase();
    // Each part of a hyphenated word too ("Ding-Dong"); parts with a capital already are kept.
    return w.split('-').map(part => /[A-Z]/.test(part) ? part : capFirst(part)).join('-');
  }).join(' ');
}
const titleFromFile = name => titleCase(rawTitleFromFile(name));

// A title from a backup: if it was just the old lower-case file name, capitalise it.
function savedTitle(b, s) {
  const name = s.file.split('/').pop();
  return b.title === rawTitleFromFile(name) ? titleFromFile(name) : b.title;
}

// Songs imported before titles were capitalised: fix the ones still using their file name.
function capitaliseOldTitles() {
  const fixed = new Map();
  for (const s of songs()) {
    const name = s.file.split('/').pop();
    if (s.title !== rawTitleFromFile(name)) continue;
    const t = titleFromFile(name);
    if (t !== s.title) { s.title = t; fixed.set(s.id, t); }
  }
  for (const p of state.programmes) for (const i of p.items) if (fixed.has(i.songId)) i.title = fixed.get(i.songId);
  return fixed.size;
}

function guessCategory(text) {
  return XMAS.test(text) ? ['christmas'] : [];
}
const hasDefaultCats = () => state.categories.some(c => c.id === 'christmas');

async function importFiles(fileList) {
  const all = [...fileList];
  const isScore = f => SCORE_EXT.test(f.name) && !f.name.startsWith('.');
  // Folder imports only take files directly inside the chosen folder; sub-folders are skipped
  // and can be imported on their own by choosing them in the picker.
  const folder = all.find(f => f.webkitRelativePath)?.webkitRelativePath.split('/')[0] ?? null;
  const skipped = new Map();
  const files = all.filter(f => {
    const parts = (f.webkitRelativePath || f.name).split('/');
    if (parts.length > 2) {
      if (isScore(f)) skipped.set(parts[1], (skipped.get(parts[1]) || 0) + 1);
      return false;
    }
    return isScore(f);
  });
  if (!files.length && !skipped.size) { toast('No PDF or picture files found there'); return; }
  navigator.storage?.persist?.().catch(() => {});

  const byKey = new Map(songs().map(s => [s.key, s]));
  // Songs imported before folders were tracked: match them by file name (when unambiguous).
  const legacy = songs().filter(s => s.folder === undefined && !s.key.includes('/'));
  const nameCount = new Map();
  for (const s of legacy) nameCount.set(s.key, (nameCount.get(s.key) || 0) + 1);
  const byName = new Map(legacy.filter(s => nameCount.get(s.key) === 1).map(s => [s.key, s]));

  let added = 0, updated = 0, same = 0, failed = 0;
  const seen = new Set();
  openSheet(`<h2>Importing scores…</h2><progress id="imp-bar" max="${files.length}" value="0"></progress><p class="muted small" id="imp-file"></p>`, { locked: true });
  for (const [i, f] of files.entries()) {
    $('#imp-bar') && ($('#imp-bar').value = i);
    $('#imp-file') && ($('#imp-file').textContent = `${i + 1} of ${files.length}: ${f.name}`);
    const key = fileKey(f);
    const existing = byKey.get(key) || (folder && byName.get(baseName(key)));
    if (existing) seen.add(existing.id);
    try {
      if (existing && existing.size === f.size && existing.modified === f.lastModified) {
        Object.assign(existing, { key, file: f.webkitRelativePath || f.name, folder: folder ?? '' });
        same++;
        continue;
      }
      const kind = /\.pdf$/i.test(f.name) ? 'pdf' : 'image';
      const blob = new Blob([await f.arrayBuffer()], { type: f.type || (kind === 'pdf' ? 'application/pdf' : 'image/*') });
      const id = existing?.id || uid();
      await db.put('files', id, blob);
      const meta = { key, file: f.webkitRelativePath || f.name, folder: folder ?? '', kind, size: f.size, modified: f.lastModified };
      if (existing) { Object.assign(existing, meta); updated++; }
      else {
        const title = titleFromFile(f.name);
        state.songs[id] = { id, title, cats: hasDefaultCats() ? guessCategory(key + ' ' + title) : [], added: Date.now(), ...meta };
        seen.add(id);
        byKey.set(key, state.songs[id]);
        added++;
      }
    } catch (err) {
      console.error(f.name, err);
      failed++;
    }
  }
  applyPending();
  await flush();
  const missing = folder ? songs().filter(s => s.source !== 'github' && s.folder === folder && !seen.has(s.id)) : [];
  const subs = [...skipped].sort((a, b) => collator.compare(a[0], b[0]));
  importSummary({
    from: folder ?? 'the chosen files', counts: { added, updated, same, failed }, missing,
    subsHtml: subs.length ? `<p>${plural(subs.reduce((t, [, n]) => t + n, 0), 'score')} in sub-folders skipped:</p>
      <ul class="sub-list">${subs.map(([name, n]) => `<li><b>${esc(name)}</b> <span class="muted small">${plural(n, 'score')}</span></li>`).join('')}</ul>
      <p class="muted small">To add one, tap <b>Import from phone</b> (Library tab) again and open that folder in the picker.</p>` : ''
  });
}

// The "Import finished" sheet, shared by folder and GitHub imports.
function importSummary({ from, counts: { added, updated, same, failed }, missing, subsHtml = '' }) {
  const parts = [added && `${added} added`, updated && `${updated} updated`, same && `${same} unchanged`, failed && `${failed} couldn't be read`].filter(Boolean);
  openSheet(`
    <h2>Import finished</h2>
    <p>${parts.length ? `From <b>${esc(from)}</b>: ${parts.join(', ')}.` : `No scores directly inside <b>${esc(from)}</b>.`}</p>
    ${subsHtml}
    ${added && hasDefaultCats() ? `<p class="muted small">Songs that look Christmassy from their titles were put in Christmas. Check the Christmas list and fix any mistakes with ⋯ or Select.</p>` : ''}
    ${missing.length ? `<p>${plural(missing.length, 'song')} in the app ${missing.length === 1 ? 'is' : 'are'} no longer in that folder.</p>
      <button class="btn" data-act="remove-missing">Remove ${missing.length === 1 ? 'it' : 'them'} from the app</button>` : ''}
    <button class="btn primary" data-act="close-sheet">OK</button>`, { onClose: render });
  sheetLocked = false;
  $('[data-act="remove-missing"]')?.addEventListener('click', async e => {
    e.stopPropagation();
    await deleteSongs(missing.map(s => s.id));
    toast(`Removed ${plural(missing.length, 'song')}`);
    closeSheet();
  });
}

$('#pick-folder').addEventListener('change', e => { const f = e.target.files; if (f?.length) importFiles(f); e.target.value = ''; });
$('#pick-files').addEventListener('change', e => { const f = e.target.files; if (f?.length) importFiles(f); e.target.value = ''; });

// Library: whether the LilyPond engine for previews is on this phone yet.
async function showEngineInfo(progress) {
  const el = $('#engine-info');
  if (!el) return;
  if (progress) { el.textContent = progress; return; }
  el.innerHTML = await engineDownloaded()
    ? 'LilyPond for previewing edits: on this phone, works offline.'
    : 'LilyPond for previewing edits: not downloaded yet (30 MB, once only). It downloads the first time you preview an edit, or <button class="link small" data-act="engine-download">download it now</button>.';
}

async function downloadEngine() {
  try {
    await lilyEngine(({ loadedBytes, totalBytes }) => showEngineInfo(`Downloading LilyPond… ${Math.round(loadedBytes / 1e6)} of ${Math.round(totalBytes / 1e6)} MB`));
    toast('LilyPond downloaded');
  } catch (err) {
    toast('Couldn’t download LilyPond: ' + err.message, 5000);
  } finally {
    if (!E.open) disposeEngine();
    showEngineInfo();
  }
}

/* ---------- downloading from GitHub ---------- */

// Scores can also come from a folder in a GitHub repository. A private repository needs a
// personal access token, which is kept only in this app's storage (never in backups).
const GH_DEFAULT = { owner: 'richardtoller', repo: 'BFS', branch: 'main', path: 'pdf', srcPath: 'src', token: '' };
const ghConfig = () => ({ ...GH_DEFAULT, ...state.settings.github });
const ghLabel = g => [g.repo, g.path].filter(Boolean).join('/');
const ghPathUrl = (g, path) => `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/contents/` +
  path.split('/').filter(Boolean).map(encodeURIComponent).join('/') + (g.branch ? `?ref=${encodeURIComponent(g.branch)}` : '');
const ghHeaders = (g, accept) => ({ Accept: accept, ...(g.token ? { Authorization: `Bearer ${g.token}` } : {}) });

function ghErrorMessage(res, g) {
  const where = `${g.owner}/${ghLabel(g)}${g.branch ? ` (branch ${g.branch})` : ''}`;
  if (res.status === 401) return 'GitHub didn’t accept the access token. Check it’s typed correctly and hasn’t expired.';
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    return g.token ? 'GitHub’s download limit was reached. Try again in an hour.'
      : 'GitHub’s hourly limit for downloads without a token was reached. Add an access token, or try again in an hour.';
  }
  if (res.status === 403) return `The access token isn’t allowed to read ${where}. Give it read access to that repository’s contents.`;
  if (res.status === 404) return `Couldn’t find ${where}. Check the names${g.token ? ', and that the token can read this repository' : '. If the repository is private, add an access token'}.`;
  return `GitHub replied with an error (${res.status}).`;
}

function githubSheet() {
  const g = ghConfig();
  const field = (id, label, value, extra = '') =>
    `<label class="field">${label}<input id="${id}" value="${esc(value)}" autocomplete="off" autocapitalize="off" spellcheck="false" ${extra}></label>`;
  openSheet(`
    <h2>Download from GitHub</h2>
    <p class="muted small">Downloads the scores in a folder of a GitHub repository and stores them on this phone, so they open instantly, even offline.</p>
    ${field('gh-owner', 'Owner (GitHub user name)', g.owner, 'placeholder="richardtoller"')}
    ${field('gh-repo', 'Repository', g.repo, 'placeholder="BFS"')}
    ${field('gh-path', 'Folder', g.path, 'placeholder="pdf (leave empty for the top level)"')}
    ${field('gh-branch', 'Branch', g.branch, 'placeholder="main (leave empty for the default branch)"')}
    ${field('gh-src', 'LilyPond source folder', g.srcPath, 'placeholder="src"')}
    <p class="hint">Used for <b>Edit LilyPond source</b>: the score <i>pdf/name.pdf</i> is edited as <i>src/name.ly</i>.</p>
    ${field('gh-token', 'Access token', g.token, 'type="password" placeholder="Needed if the repository is private"')}
    <p class="hint">A private repository needs a token. On GitHub, go to <b>Settings › Developer settings › Personal access tokens › Fine-grained tokens</b>, choose <b>Generate new token</b>, pick <b>Only select repositories</b> and your scores repository, and under <b>Permissions</b> set <b>Contents</b> to <b>Read-only</b>, or to <b>Read and write</b> if you want to edit scores’ LilyPond source in the app. Copy the token here. It is stored only in this app on this phone and isn’t included in backups.</p>
    <div class="stack">
      <button class="btn primary" id="gh-go">Save and download</button>
      <button class="btn" id="gh-save">Save</button>
    </div>`, { onClose: render });
  const read = () => {
    const v = id => $(id).value.trim();
    state.settings.github = { owner: v('#gh-owner'), repo: v('#gh-repo'), path: v('#gh-path').replace(/^\/+|\/+$/g, ''), branch: v('#gh-branch'), srcPath: v('#gh-src').replace(/^\/+|\/+$/g, ''), token: v('#gh-token') };
    save();
    return state.settings.github.owner && state.settings.github.repo;
  };
  $('#gh-save').addEventListener('click', () => {
    if (!read()) { toast('Fill in the owner and repository'); return; }
    toast('GitHub settings saved');
    closeSheet();
  });
  $('#gh-go').addEventListener('click', () => {
    if (!read()) { toast('Fill in the owner and repository'); return; }
    importFromGitHub();
  });
}

function githubFailed(msg) {
  openSheet(`<h2>Couldn’t download from GitHub</h2><p>${esc(msg)}</p>
    <div class="stack"><button class="btn primary" data-act="github-settings">GitHub settings</button><button class="btn" data-act="close-sheet">Close</button></div>`, { onClose: render });
}

async function importFromGitHub() {
  const g = ghConfig();
  if (!g.owner || !g.repo) return githubSheet();
  const from = ghLabel(g);
  openSheet(`<h2>Checking GitHub…</h2><p class="muted small">${esc(g.owner)}/${esc(from)}</p>`, { locked: true });

  let entries;
  try {
    const res = await fetch(ghPathUrl(g, g.path), { headers: ghHeaders(g, 'application/vnd.github+json'), cache: 'no-store' });
    if (!res.ok) return githubFailed(ghErrorMessage(res, g));
    entries = await res.json();
    if (!Array.isArray(entries)) return githubFailed(`“${g.path}” is a file, not a folder.`);
  } catch (err) {
    console.error(err);
    return githubFailed('Couldn’t connect to GitHub. Check you have an internet connection.');
  }

  const files = entries.filter(e => e.type === 'file' && SCORE_EXT.test(e.name) && !e.name.startsWith('.'));
  const dirs = entries.filter(e => e.type === 'dir').map(e => e.name).sort(collator.compare);
  navigator.storage?.persist?.().catch(() => {});

  const byKey = new Map(songs().map(s => [s.key, s]));
  let added = 0, updated = 0, same = 0, failed = 0;
  const seen = new Set();
  openSheet(`<h2>Downloading scores…</h2><progress id="imp-bar" max="${files.length}" value="0"></progress><p class="muted small" id="imp-file"></p>`, { locked: true });
  for (const [i, f] of files.entries()) {
    $('#imp-bar') && ($('#imp-bar').value = i);
    $('#imp-file') && ($('#imp-file').textContent = `${i + 1} of ${files.length}: ${f.name}`);
    const key = `github:${g.owner}/${g.repo}/${f.path}`.toLowerCase();
    const existing = byKey.get(key);
    if (existing) seen.add(existing.id);
    const meta = { key, file: `${g.repo}/${f.path}`, folder: from, source: 'github', ghOwner: g.owner, ghRepo: g.repo, ghPath: f.path, kind: /\.pdf$/i.test(f.name) ? 'pdf' : 'image', size: f.size, sha: f.sha };
    try {
      // The git blob hash changes whenever the file does, so unchanged scores aren't downloaded again.
      if (existing && existing.sha === f.sha && await db.get('files', existing.id)) {
        Object.assign(existing, meta);
        same++;
        continue;
      }
      // With a token, use the API (works for private repositories); without one, the public raw file.
      const res = g.token
        ? await fetch(f.url, { headers: ghHeaders(g, 'application/vnd.github.raw'), cache: 'no-store' })
        : await fetch(f.download_url, { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 401 || res.headers.get('x-ratelimit-remaining') === '0') {
          await flush();
          return githubFailed(ghErrorMessage(res, g) + (added + updated ? ` ${plural(added + updated, 'score')} were downloaded before this happened.` : ''));
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.blob();
      const blob = new Blob([data], { type: meta.kind === 'pdf' ? 'application/pdf' : (data.type || 'image/*') });
      const id = existing?.id || uid();
      await db.put('files', id, blob);
      meta.size = blob.size;
      if (existing) { Object.assign(existing, meta); updated++; }
      else {
        const title = titleFromFile(f.name);
        state.songs[id] = { id, title, cats: hasDefaultCats() ? guessCategory(f.path + ' ' + title) : [], added: Date.now(), ...meta };
        seen.add(id);
        byKey.set(key, state.songs[id]);
        added++;
      }
    } catch (err) {
      console.error(f.name, err);
      failed++;
    }
  }
  applyPending();
  await flush();
  const missing = songs().filter(s => s.source === 'github' && s.key.startsWith(`github:${g.owner}/${g.repo}/`.toLowerCase())
    && s.folder === from && !seen.has(s.id));
  importSummary({
    from: `GitHub: ${from}`, counts: { added, updated, same, failed }, missing,
    subsHtml: dirs.length ? `<p class="muted small">Sub-folders not downloaded: ${dirs.map(d => `<b>${esc(d)}</b>`).join(', ')}. To download one, change the folder in GitHub settings.</p>` : ''
  });
}

/* ---------- editing a score's LilyPond source on GitHub ---------- */

// A GitHub score pdf/name.pdf is engraved from src/name.ly. Preview pushes the edit to a
// preview/name branch, where the repository's "Preview score" workflow engraves it and
// commits the PDF and LilyPond's messages to preview-output/. Publish commits the .ly to
// the main branch, where "Build PDFs" rebuilds the PDFs. Unpublished edits are kept as drafts.

class GhError extends Error { constructor(msg, status = 0) { super(msg); this.status = status; } }
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ghSource(s) {
  const g = { ...ghConfig() };
  g.owner = s.ghOwner || g.owner;
  g.repo = s.ghRepo || g.repo;
  const pdfPath = s.ghPath || (s.file.startsWith(g.repo + '/') ? s.file.slice(g.repo.length + 1) : s.file);
  const name = pdfPath.split('/').pop().replace(/\.[^.]+$/, '');
  return { g, name, lyPath: [g.srcPath, name + '.ly'].filter(Boolean).join('/') };
}

async function ghApi(g, path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}${path ? '/' + path : ''}`, {
      method, cache: 'no-store',
      headers: { ...ghHeaders(g, accept), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch { throw new GhError('Couldn’t connect to GitHub. Check you have an internet connection.'); }
  if (res.ok) return res;
  let detail = '';
  try { detail = (await res.json()).message || ''; } catch { /* no JSON */ }
  if (res.status === 401) throw new GhError('GitHub didn’t accept the access token. Check it in GitHub settings.', 401);
  if (res.status === 403 && /not accessible|permission/i.test(detail)) {
    throw new GhError('Your access token isn’t allowed to make changes. On GitHub, edit the token and set Contents to Read and write.', 403);
  }
  throw new GhError(`GitHub replied: ${detail || 'error ' + res.status}`, res.status);
}
const ghJson = async (...a) => (await ghApi(...a)).json();
const ghBranch = async g => g.branch || (await ghJson(g, '')).default_branch;

function b64utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const unb64utf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

// LilyPond messages look like "bold_riley.ly:20:4: error: syntax error, unexpected '.'".
function lilyMessages(log) {
  return [...log.matchAll(/^(.+?\.i?ly):(\d+):(\d+): (fatal error|error|warning): (.+)$/gm)]
    .map(m => ({ file: m[1], line: +m[2], col: +m[3], kind: m[4] === 'warning' ? 'warning' : 'error', msg: m[5] }));
}

const E = { open: false }; // the editor's state

// A new score (from photos) has the id 'new:<name>' and exists only as a draft until it is published.
const isNewId = id => String(id).startsWith('new:');
function newSource(name) {
  const g = { ...ghConfig() };
  return { g, name, lyPath: [g.srcPath, name + '.ly'].filter(Boolean).join('/') };
}

async function openEditor(id) {
  const s = isNewId(id) ? state.drafts?.[id] && { title: state.drafts[id].title } : state.songs[id];
  if (!s) return;
  if (sheetOpen) {
    // Like the viewer: take over the song sheet's history entry.
    sheetOpen = false;
    $('#sheet').hidden = true;
    $('#sheet-backdrop').hidden = true;
    sheetOnClose = null;
    replaceTopLayer(closeEditor);
  } else pushLayer(closeEditor);
  const src = isNewId(id) ? newSource(id.slice(4)) : ghSource(s);
  Object.assign(E, { open: true, id, song: s, src, d: null, run: null, preview: E.pendingPreview || null });
  E.pendingPreview = null;
  const root = $('#editor');
  root.innerHTML = `
    <div class="ed-bar">
      <button class="icon-btn" data-ed="close" aria-label="Close editor">✕</button>
      <div class="ed-title"><strong>${esc(s.title)}</strong><span>${esc(src.lyPath)}</span></div>
      <button class="icon-btn" data-ed="more" aria-label="More options">⋯</button>
    </div>
    <textarea class="ed-text" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="${state.settings.edWrap ? 'soft' : 'off'}" disabled></textarea>
    <div class="ed-panel">
      <div class="ed-status" aria-live="polite">Loading from GitHub…</div>
      <div class="ed-actions">
        <button class="btn" data-ed="preview" disabled>Preview</button>
        <button class="btn" data-ed="view" hidden>View preview</button>
        <button class="btn primary" data-ed="publish" disabled>Publish</button>
      </div>
    </div>`;
  root.hidden = false;
  document.body.classList.add('editor-open');
  const ta = $('.ed-text', root);
  ta.addEventListener('input', () => {
    E.d.text = ta.value;
    state.drafts ||= {};
    if (E.d.text !== E.d.base) state.drafts[E.id] = E.d; else delete state.drafts[E.id];
    save();
    if (!E.run) edStatus();
  });

  loadEditorSource();
}

// Fill the editor from the draft, or from GitHub.
async function loadEditorSource() {
  const { id, src } = E;
  const root = $('#editor'), ta = $('.ed-text', root);
  const draft = state.drafts?.[id];
  if (draft) E.d = draft;
  else {
    ta.disabled = true;
    edStatus('Loading from GitHub…');
    try {
      const g = src.g;
      const branch = await ghBranch(g);
      const c = await ghJson(g, `contents/${encPath(src.lyPath)}?ref=${encodeURIComponent(branch)}`);
      const text = unb64utf8(c.content || '');
      E.d = { text, base: text, baseSha: c.sha, lyPath: src.lyPath };
    } catch (err) {
      if (!E.open || E.id !== id) return;
      edStatus(err.status === 404
        ? `There’s no <b>${esc(src.lyPath)}</b> in ${esc(src.g.owner)}/${esc(src.g.repo)}, so this score can’t be edited here.`
        : esc(err.message), 'bad');
      return;
    }
  }
  if (!E.open || E.id !== id) return;
  ta.value = E.d.text;
  ta.disabled = false;
  root.querySelector('[data-ed="preview"]').disabled = false;
  root.querySelector('[data-ed="publish"]').disabled = false;
  edStatus();
}

function closeEditor() {
  if (!E.open) return;
  E.open = false;
  E.run?.abort?.abort();
  E.run = null; // stops a preview that's running or waiting
  disposeEngine();
  $('#editor').hidden = true;
  $('#editor').innerHTML = '';
  document.body.classList.remove('editor-open');
  if (E.d && E.d.text !== E.d.base) toast('Your changes are kept as a draft');
  flush();
  render();
}

// The status panel: progress, or the result of the last preview, or the draft state.
function edStatus(html, tone = '') {
  const el = $('#editor .ed-status');
  if (!el) return;
  const viewBtn = $('#editor [data-ed="view"]');
  if (html != null) { el.innerHTML = html; el.className = `ed-status ${tone}`; return; }
  const p = E.preview, changed = E.d && E.d.text !== E.d.base;
  viewBtn.hidden = !p?.pdf;
  const head = E.d?.isNew ? `<p class="ed-notes"><span class="tag amber">New score</span> Not published yet. Check it against the ${draftKinds(E.d).every(k => k === 'image') ? 'photos (⋯ › <b>View the photos</b>)' : 'originals'}, then tap <b>Publish</b>.</p>${E.d.notes ? `<p class="ed-notes"><b>Claude’s notes:</b> ${esc(E.d.notes)}</p>` : ''}` : '';
  let out = E.d?.isNew ? '' : changed ? '<span class="tag amber">Draft</span> Not published yet.' : 'No changes yet. Edit the LilyPond source above, then tap <b>Preview</b>.';
  if (p) {
    const errs = p.messages.filter(m => m.kind === 'error'), warns = p.messages.filter(m => m.kind === 'warning');
    const stale = p.text !== E.d.text ? ' <span class="muted">(you’ve edited since)</span>' : '';
    out = (errs.length || !p.pdf
      ? `<b class="bad">✕ LilyPond found ${plural(errs.length || 1, 'error')}${p.pdf ? '' : ' and made no PDF'}.</b>${stale}`
      : `<b class="good">✓ Engraved without errors${warns.length ? ` (${plural(warns.length, 'warning')})` : ''}.</b>${stale}`) +
      (p.messages.length ? `<ul class="ed-msgs">${p.messages.slice(0, 30).map(m =>
        `<li><button class="link ${m.kind}" data-line="${m.line}" data-col="${m.col}" ${m.file.endsWith(E.src.name + '.ly') ? '' : 'disabled'}>${m.file.endsWith(E.src.name + '.ly') ? `Line ${m.line}` : esc(m.file) + ':' + m.line}: ${esc(m.msg)}</button></li>`).join('')}</ul>` : '') +
      `<details><summary>LilyPond’s full output</summary><pre>${esc(p.log)}</pre></details>`;
  }
  el.innerHTML = head + out;
  el.className = 'ed-status';
}

function gotoLine(line, col) {
  const ta = $('#editor .ed-text');
  const lines = ta.value.split('\n');
  let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  pos = Math.min(ta.value.length, pos + Math.max(0, col - 1));
  ta.focus();
  ta.setSelectionRange(pos, Math.min(ta.value.length, pos + 1));
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, (line - 4) * lh);
}

/* Previewing on the phone, with LilyPond 2.26 compiled to WebAssembly (vendor/lilypond-wasm).
   The scores repository builds its PDFs with the same version, so the preview matches. */

const ENGINE_CACHE = 'lilypond-engine-2.26.0'; // keep in step with sw.js
const ENGINE_URL = new URL('../vendor/lilypond-wasm/src/index.mjs', import.meta.url).href;
const ENGINE_WASM = new URL('../vendor/lilypond-wasm/dist/lilypond.wasm', import.meta.url).href;
let lilyCompiler = null;

async function lilyEngine(onProgress) {
  if (typeof WebAssembly !== 'object' || typeof DecompressionStream !== 'function' || typeof Worker !== 'function') {
    throw new Error('This browser can’t run LilyPond.');
  }
  if (!lilyCompiler) lilyCompiler = (await import(ENGINE_URL)).createReusableCompiler();
  await lilyCompiler.preload({ onProgress });
  return lilyCompiler;
}
// Frees the engine's memory (it is unpacked again, from the cache, next time).
function disposeEngine() { lilyCompiler?.dispose(); lilyCompiler = null; }

async function engineDownloaded() {
  try { return !!(await (await caches.open(ENGINE_CACHE)).match(ENGINE_WASM)); } catch { return false; }
}

const normPath = p => {
  const out = [];
  for (const part of p.split('/')) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); }
  return out.join('/');
};
// The engine's files live under /input and it runs from /output, so font paths written
// relative to the build folder (src/, as in the repository's workflows) are made absolute.
const fixFontPaths = (text, dir) => text.replace(/(ly:font-config-add-font\s+")([^"]+)"/g,
  (m, head, path) => `${head}${path.startsWith('/') ? path : '/input/' + normPath(`${dir}/${path}`)}"`);

// The files a score needs besides itself: the repository's include files (.ily) and fonts,
// at their repository paths. Kept on the phone so previews work offline; refreshed when online.
async function lilySupportFiles(g) {
  const repo = `${g.owner}/${g.repo}`.toLowerCase();
  let cache = await db.get('kv', 'lyfiles').catch(() => null);
  if (!cache || cache.repo !== repo) cache = { repo, files: {}, updated: 0 };
  if (Date.now() - cache.updated > 5 * 60e3) {
    try {
      const branch = await ghBranch(g);
      const head = (await ghJson(g, `git/ref/heads/${encPath(branch)}`)).object.sha;
      const tree = await ghJson(g, `git/trees/${head}?recursive=1`);
      const files = {};
      for (const t of tree.tree.filter(t => t.type === 'blob' && /\.(ily|ttf|otf)$/i.test(t.path) && t.size < 10e6)) {
        const old = cache.files[t.path];
        if (old?.sha === t.sha) { files[t.path] = old; continue; }
        const blob = await ghJson(g, `git/blobs/${t.sha}`);
        const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0));
        files[t.path] = { sha: t.sha, data: /\.ily$/i.test(t.path) ? new TextDecoder().decode(bytes) : bytes };
      }
      cache = { repo, files, updated: Date.now() };
      await db.put('kv', 'lyfiles', cache);
    } catch (err) {
      if (!cache.updated) throw err; // never fetched: can't preview yet
      console.warn('Using saved style files and fonts', err); // offline: use the saved copies
    }
  }
  return cache.files;
}

// Engrave one score with the repository's include files and fonts. Returns LilyPond's
// output, and the PDF if it made one; LilyPond errors in the score don't throw.
async function compileLy(compiler, support, text, lyPath, signal) {
  const dir = lyPath.includes('/') ? lyPath.slice(0, lyPath.lastIndexOf('/')) : '';
  const files = {};
  for (const [path, f] of Object.entries(support)) {
    if (path !== lyPath) files[path] = typeof f.data === 'string' ? fixFontPaths(f.data, dir) : f.data;
  }
  try {
    const r = await compiler.compile(fixFontPaths(text, dir), {
      format: 'pdf', filename: lyPath, files, includePaths: dir ? [dir] : [], signal
    });
    return { log: r.logs.join('\n'), pdf: new Blob([r.files['score.pdf']], { type: 'application/pdf' }) };
  } catch (err) {
    if (!Array.isArray(err.logs)) throw err; // not a LilyPond error in the score
    return { log: err.logs.join('\n'), pdf: null };
  }
}

async function previewHere() {
  if (E.run) return;
  const run = E.run = { abort: new AbortController() };
  const alive = () => E.run === run;
  const btn = $('#editor [data-ed="preview"]');
  btn.textContent = 'Cancel preview';
  const { g, lyPath } = E.src;
  const text = E.d.text;
  let tick = 0;
  try {
    edStatus('Getting the style file and fonts…');
    const support = await lilySupportFiles(g);
    if (!alive()) return;
    edStatus('Starting LilyPond…');
    const compiler = await lilyEngine(({ loadedBytes, totalBytes }) => {
      if (alive()) edStatus(`Downloading LilyPond for previews (once only)… ${Math.round(loadedBytes / 1e6)} of ${Math.round(totalBytes / 1e6)} MB`);
    });
    if (!alive()) return;
    const start = Date.now();
    const engraving = () => edStatus(`Engraving on this phone… ${Math.round((Date.now() - start) / 1000)} s`);
    engraving();
    tick = setInterval(() => alive() && engraving(), 1000);
    const { log, pdf } = await compileLy(compiler, support, text, lyPath, run.abort.signal);
    if (!alive()) return;
    E.preview = { text, log, pdf, messages: lilyMessages(log) };
    E.run = null;
    edStatus();
    if (pdf && !E.preview.messages.some(m => m.kind === 'error')) viewPreview();
  } catch (err) {
    if (err?.name === 'AbortError' || !alive()) return;
    console.error(err);
    disposeEngine(); // a failed engine is started afresh next time
    E.run = null;
    edStatus(`Couldn’t preview on this phone: ${esc(err.message)}<br><button class="link" data-ed="preview-github">Preview on GitHub instead</button>`, 'bad');
  } finally {
    clearInterval(tick);
    if (!E.run && E.open) btn.textContent = 'Preview';
  }
}

// Preview on GitHub: the fallback when the phone can't run LilyPond.
async function previewEdit() {
  if (E.run) return;
  const run = E.run = {};
  const { g, name, lyPath } = E.src;
  const text = E.d.text;
  const btn = $('#editor [data-ed="preview"]');
  btn.textContent = 'Cancel preview';
  const alive = () => E.run === run;
  try {
    edStatus('Sending your edit to GitHub…');
    const branch = await ghBranch(g);
    const head = (await ghJson(g, `git/ref/heads/${encPath(branch)}`)).object.sha;
    const baseTree = (await ghJson(g, `git/commits/${head}`)).tree.sha;
    const tree = (await ghJson(g, 'git/trees', { method: 'POST', body: { base_tree: baseTree, tree: [{ path: lyPath, mode: '100644', type: 'blob', content: text }] } })).sha;
    const commit = (await ghJson(g, 'git/commits', { method: 'POST', body: { message: `Preview edit of ${lyPath} (from the BFS app)`, tree, parents: [head] } })).sha;
    const ref = `preview/${name}`;
    try { await ghApi(g, `git/refs/heads/${encPath(ref)}`, { method: 'PATCH', body: { sha: commit, force: true } }); }
    catch (err) {
      if (err.status !== 422 && err.status !== 404) throw err;
      await ghApi(g, 'git/refs', { method: 'POST', body: { ref: `refs/heads/${ref}`, sha: commit } });
    }
    // Wait for the workflow to commit its output on top of the edit.
    const start = Date.now();
    let out = null;
    while (!out) {
      if (!alive()) return;
      const secs = Math.round((Date.now() - start) / 1000);
      edStatus(`Engraving on GitHub… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}<br><span class="muted small">This usually takes about a minute. You can keep editing.</span>`);
      if (secs > 480) throw new GhError('No preview came back after 8 minutes. Check that the repository has the “Preview score” workflow, and look at its Actions tab on GitHub.');
      await sleep(4000);
      if (!alive()) return;
      const tip = (await ghJson(g, `git/ref/heads/${encPath(ref)}`)).object.sha;
      if (tip === commit) continue;
      const c = await ghJson(g, `git/commits/${tip}`);
      if (c.parents[0]?.sha !== commit) throw new GhError('The preview branch was changed by something else. Tap Preview again.');
      out = tip;
    }
    const raw = 'application/vnd.github.raw';
    const log = await (await ghApi(g, `contents/preview-output/${encodeURIComponent(name)}.log?ref=${out}`, { accept: raw })).text();
    let pdf = null;
    try {
      pdf = new Blob([await (await ghApi(g, `contents/preview-output/${encodeURIComponent(name)}.pdf?ref=${out}`, { accept: raw })).blob()], { type: 'application/pdf' });
    } catch (err) { if (err.status !== 404) throw err; }
    if (!alive()) return;
    E.preview = { text, log, pdf, messages: lilyMessages(log) };
    E.run = null;
    edStatus();
    if (pdf && !E.preview.messages.some(m => m.kind === 'error')) viewPreview();
  } catch (err) {
    console.error(err);
    if (alive()) { E.run = null; edStatus(esc(err.message), 'bad'); }
  } finally {
    if (!E.run && E.open) btn.textContent = 'Preview';
  }
}

function viewPreview() {
  const p = E.preview;
  if (!p?.pdf) return;
  pushLayer(closeViewer);
  openViewer($('#viewer'), {
    items: [{ songId: 'preview', title: `Preview: ${E.song.title}` }], index: 0, label: '',
    getSong: async () => ({ title: E.song.title, kind: 'pdf', blob: p.pdf }),
    fit: state.settings.fit, fullscreen: false,
    onFit: fit => { state.settings.fit = fit; save(); },
    onClose: back
  });
  $('#viewer [data-v="notes"]').hidden = true;
}

function publishSheet() {
  const { lyPath } = E.src;
  if (E.d.text === E.d.base) { toast('There are no changes to publish'); return; }
  const p = E.preview;
  const warn = !p || p.text !== E.d.text ? 'You haven’t previewed this version of your edit.'
    : !p.pdf || p.messages.some(m => m.kind === 'error') ? 'The preview of this version had errors.' : '';
  openSheet(`
    <h2>${E.d.isNew ? 'Publish this new score?' : 'Publish your edit?'}</h2>
    <p>This ${E.d.isNew ? 'adds' : 'commits'} <b>${esc(lyPath)}</b> to ${esc(E.src.g.owner)}/${esc(E.src.g.repo)} on GitHub. GitHub then rebuilds the PDFs, which takes a couple of minutes.</p>
    ${warn ? `<p class="bad">⚠ ${warn}</p>` : ''}
    <label class="field">Description of the change<input id="pub-msg" value="${esc(`${E.d.isNew ? 'Add' : 'Edit'} ${E.song.title}`)}" autocomplete="off"></label>
    <div class="stack">
      <button class="btn primary" id="pub-go">Publish</button>
      <button class="btn" data-act="close-sheet">Cancel</button>
    </div>`);
  $('#pub-go').addEventListener('click', () => publishEdit($('#pub-msg').value.trim() || `${E.d.isNew ? 'Add' : 'Edit'} ${E.song.title}`));
}

async function publishEdit(message, overwrite = false) {
  const { g, name, lyPath } = E.src;
  const { id, song } = E;
  const text = E.d.text;
  openSheet(`<h2>Publishing…</h2><p class="muted">Sending ${E.d.isNew ? 'the new score' : 'your edit'} to GitHub.</p>`, { locked: true });
  let res;
  try {
    const branch = await ghBranch(g);
    let sha = E.d.baseSha;
    if (overwrite) sha = (await ghJson(g, `contents/${encPath(lyPath)}?ref=${encodeURIComponent(branch)}`)).sha;
    res = await ghJson(g, `contents/${encPath(lyPath)}`, { method: 'PUT', body: { message, content: b64utf8(text), ...(sha ? { sha } : {}), branch } });
  } catch (err) {
    if (E.d.isNew && err.status === 422) {
      openSheet(`<h2>Name already used</h2><p>There’s already a <b>${esc(lyPath)}</b> on GitHub. Discard this new score and convert the photos again: the app will pick a free name.</p><button class="btn primary" data-act="close-sheet">OK</button>`);
    } else if (err.status === 409) {
      openSheet(`<h2>Changed on GitHub</h2>
        <p><b>${esc(lyPath)}</b> has been changed on GitHub since you started editing, so publishing would replace that change.</p>
        <div class="stack">
          <button class="btn danger" id="pub-over">Publish mine anyway</button>
          <button class="btn" data-act="close-sheet">Cancel</button>
        </div>
        <p class="hint">To keep both, cancel, copy your edit somewhere safe, then use ⋯ › <b>Discard my changes</b> to load the latest version and redo your edit.</p>`);
      $('#pub-over').addEventListener('click', () => publishEdit(message, true));
    } else {
      openSheet(`<h2>Couldn’t publish</h2><p>${esc(err.message)}</p><button class="btn primary" data-act="close-sheet">OK</button>`);
    }
    return;
  }
  ghApi(g, `git/refs/heads/${encPath(`preview/${name}`)}`, { method: 'DELETE' }).catch(() => {});
  // If this exact text was previewed, use that PDF straight away; the next
  // Update from GitHub replaces it with the one GitHub builds.
  const p = E.preview;
  const wasNew = E.d.isNew;
  let usePreview = p?.pdf && p.text === text && (wasNew || state.songs[id]);
  if (wasNew && usePreview) {
    // Add the new score to the library straight away, as if downloaded from GitHub.
    const pdfPath = [g.path, name + '.pdf'].filter(Boolean).join('/');
    const sid = uid();
    state.songs[sid] = {
      id: sid, title: song.title, cats: hasDefaultCats() ? guessCategory(name + ' ' + song.title) : [], added: Date.now(),
      key: `github:${g.owner}/${g.repo}/${pdfPath}`.toLowerCase(), file: `${g.repo}/${pdfPath}`, folder: ghLabel(g),
      source: 'github', ghOwner: g.owner, ghRepo: g.repo, ghPath: pdfPath, kind: 'pdf', size: p.pdf.size, sha: 'edited-in-app'
    };
    await db.put('files', sid, p.pdf);
  } else if (usePreview) {
    await db.put('files', id, p.pdf);
    Object.assign(song, { size: p.pdf.size, sha: 'edited-in-app' });
  }
  if (wasNew) await deletePhotos(name);
  Object.assign(E.d, { base: text, baseSha: res.content.sha, isNew: false, notes: '' });
  if (state.drafts) delete state.drafts[id];
  await flush();
  edStatus();
  openSheet(`<h2>Published</h2>
    <p>${wasNew ? 'The new score' : 'Your edit to'} <b>${esc(lyPath)}</b> is on GitHub. GitHub is now rebuilding the PDFs, which takes a couple of minutes.</p>
    <p>${wasNew ? (usePreview ? 'It’s in your Songs list already, with the previewed PDF. ' : 'It will appear in your Songs list after the next update. ') : usePreview ? 'The app is already showing your previewed PDF. ' : ''}Tap <b>Update from GitHub</b> (Library tab) in a few minutes to get the PDF GitHub builds.</p>
    <button class="btn primary" data-act="close-sheet">OK</button>`, wasNew ? { onClose: () => setTimeout(back, 0) } : {});
}

function editorMoreSheet() {
  openSheet(`
    <h2>${esc(E.src.lyPath)}</h2>
    <div class="stack">
      ${E.d?.photos && draftKinds(E.d).some(k => k !== 'text') ? `<button class="btn" id="ed-photos">${draftKinds(E.d).every(k => k === 'image') ? 'View the photos' : 'View the originals'}</button>` : ''}
      <button class="btn" id="ed-wrap">${state.settings.edWrap ? 'Don’t wrap long lines' : 'Wrap long lines'}</button>
      <button class="btn" id="ed-gh">Preview on GitHub instead</button>
      <button class="btn danger" id="ed-discard" ${E.d && E.d.text !== E.d.base ? '' : 'disabled'}>${E.d?.isNew ? 'Discard this new score' : 'Discard my changes'}</button>
    </div>
    <p class="hint"><b>Preview</b> engraves the score on this phone with LilyPond 2.26, the same version GitHub uses to build the PDFs. If that doesn’t work on this phone, <b>Preview on GitHub instead</b> engraves it on GitHub (about a minute), using a temporary <b>preview/${esc(E.src.name)}</b> branch that is deleted when you publish. Discarding loads the latest version from GitHub.</p>`);
  $('#ed-gh').addEventListener('click', () => { sheetOnClose = () => previewEdit(); closeSheet(); });
  $('#ed-wrap').addEventListener('click', () => {
    state.settings.edWrap = !state.settings.edWrap;
    save();
    $('#editor .ed-text')?.setAttribute('wrap', state.settings.edWrap ? 'soft' : 'off');
    closeSheet();
  });
  $('#ed-photos')?.addEventListener('click', () => { sheetOnClose = () => viewPhotos(E.src.name, E.song.title, draftKinds(E.d)); closeSheet(); });
  $('#ed-discard').addEventListener('click', async () => {
    if (E.d?.isNew) {
      if (!confirm('Discard this new score? Its photos or files and the LilyPond text are deleted from the app.')) return;
      delete state.drafts[E.id];
      await deletePhotos(E.src.name);
      E.d = null;
      await flush();
      sheetOnClose = () => setTimeout(back, 0);
      closeSheet();
      return;
    }
    if (state.drafts) delete state.drafts[E.id];
    flush();
    Object.assign(E, { d: null, preview: null, run: null });
    closeSheet();
    loadEditorSource();
  });
}

$('#editor').addEventListener('click', e => {
  const b = e.target.closest('[data-ed], [data-line]');
  if (!b || b.disabled) return;
  if (b.dataset.line) return gotoLine(+b.dataset.line, +b.dataset.col);
  switch (b.dataset.ed) {
    case 'close': return back();
    case 'more': return editorMoreSheet();
    case 'preview':
      if (E.run) { E.run.abort?.abort(); E.run = null; edStatus(); b.textContent = 'Preview'; return; }
      return previewHere();
    case 'preview-github': return previewEdit();
    case 'view': return viewPreview();
    case 'publish': return publishSheet();
  }
});

/* ---------- new scores from photos (Claude) ---------- */

// Photos of a score are sent to Claude with the house style file and an example score; Claude
// writes a LilyPond file, the app checks it with LilyPond (one repair round if it has errors),
// and it opens in the editor as a new, unpublished score.

const CLAUDE_MODEL = 'claude-opus-5-5';
const SDK_URL = new URL('../vendor/anthropic-sdk/anthropic-sdk.mjs', import.meta.url).href;
const claudeKey = () => state.settings.claude?.apiKey || '';
const photos = { pages: [] }; // JPEG Blobs for the score being photographed

const TRANSCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    file_name: { type: 'string', description: 'Lower-case words from the title joined by underscores, without .ly' },
    title: { type: 'string', description: 'The title as printed' },
    lilypond: { type: 'string', description: 'The whole LilyPond file' },
    notes: { type: 'string', description: 'Short plain sentences about anything uncertain or worth checking, with bar numbers; empty if none' }
  },
  required: ['file_name', 'title', 'lilypond', 'notes'],
  additionalProperties: false
};

function transcriptionPrompt(styleFiles, example) {
  return `You transcribe sheet music into LilyPond source files for the BFS choir's collection of scores. The music comes as photographs, as scanned or printed PDFs, or as notation files (MusicXML, ABC or LilyPond). Each file is engraved with LilyPond 2.26.0 from the repository's src/ folder, together with the shared house style file below.

Write the file in the house conventions that the example score shows:
- Start with \\version "2.26.0", then \\include "_bfs-style.ily", then the verseSize line with its comment, as in the example.
- A \\header with the title, and subtitle / subsubtitle for the source, the words and music credits and the arranger, as printed. Where the page credits M Norman or Matt Norman, write Matt Norman. Add copyright = "© ..." only when the page shows a copyright notice, copying it (with Matt Norman in full).
- The music in variables that use \\global (key, time, \\partial) and \\fixed, one variable per voice, with lyrics under the notes in \\lyricmode, and a score layout like the example's, adjusted to the parts on the page.
- Verses printed below the music go in \\markup \\verseColumn or \\verseColumns, one string per line, each line starting with a capital letter, with " " between verses.
- LilyPond 2.26 syntax only. Put a bar check (|) at every barline.

Transcribe exactly what is in the original: pitches, rhythms, rests, key and time signatures and their changes, ties, slurs, dynamics, tempo marks, repeats and endings, lyrics with their syllable division, and any verse text. Don't add to or "correct" the music. Where something is hard to read, choose the most likely reading and say so in notes, with the bar number. Photos and PDF pages are given in order. A notation file already holds the exact music: carry it over faithfully and rewrite it in the house conventions.

${styleFiles.map(([path, text]) => `<style_file path="${path}">\n${text}\n</style_file>`).join('\n')}
<example_score path="${example.path}">
${example.text}
</example_score>`;
}

function claudeSheet(then) {
  openSheet(`
    <h2>Claude API key</h2>
    <p class="muted small">Turning photos and files into LilyPond uses Claude, Anthropic's AI model, through your own API key.</p>
    <label class="field">API key<input id="cl-key" type="password" value="${esc(claudeKey())}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…"></label>
    <p class="hint">Create a key at <b>platform.claude.com</b> › <b>Settings</b> › <b>API keys</b>, and add some credit under <b>Billing</b>. Each conversion is charged to that account: typically well under $1 for a few pages. The key is stored only in this app on this phone, is sent only to Anthropic, and isn't included in backups.</p>
    <div class="stack">
      <button class="btn primary" id="cl-save">Save</button>
      ${claudeKey() ? '<button class="btn danger" id="cl-del">Remove the key</button>' : ''}
    </div>`, { onClose: render });
  $('#cl-save').addEventListener('click', () => {
    const key = $('#cl-key').value.trim();
    if (!key) { toast('Paste your API key first'); return; }
    state.settings.claude = { ...state.settings.claude, apiKey: key };
    save();
    toast('Claude API key saved');
    sheetOnClose = then || render;
    closeSheet();
  });
  $('#cl-del')?.addEventListener('click', () => {
    delete state.settings.claude;
    save();
    toast('Claude API key removed');
    closeSheet();
  });
}

// Phone photos are large: scale to at most 2000 px on the long side, as JPEG.
async function shrinkPhoto(file, maxSide = 2000) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Couldn’t read the photo')), 'image/jpeg', 0.88));
}

// What a chosen file is, for Claude: a picture, a PDF, or a text notation file.
const NOTATION_EXT = /\.(musicxml|xml|abc|ly|ily|txt)$/i;
function sourceKind(f) {
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) return 'pdf';
  if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name)) return 'image';
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|zip|mxl|mscz|sib|mid|midi)$/i.test(f.name)) return null; // binary formats
  if (NOTATION_EXT.test(f.name) || ['text/plain', 'text/xml', 'application/xml', 'application/vnd.recordare.musicxml+xml'].includes(f.type)) return 'text';
  return null;
}
const MAX_PDF = 20e6, MAX_TEXT = 2e6;

// photos.pages holds the originals for one score: { kind: 'image' | 'pdf' | 'text', blob, name }.
async function addPhotos(fileList) {
  const files = [...fileList];
  // Read every file now, while the app still has access to it: a file from Google Drive (or another
  // cloud provider) is only fetched when it's read, and reading it later can fail ("network error").
  const reading = `Reading ${files.length === 1 ? files[0].name : plural(files.length, 'file')}…`;
  if (files.length) toast(reading, 60000);
  for (const f of files) {
    const kind = sourceKind(f);
    try {
      if (/\.mxl$/i.test(f.name)) { toast(`${f.name} is compressed MusicXML. Export it as uncompressed MusicXML (.musicxml) instead.`, 6000); continue; }
      if (!kind) { toast(`${f.name} can’t be read. Choose a PDF, a picture, or a MusicXML, ABC or LilyPond file.`, 6000); continue; }
      if (kind === 'image') photos.pages.push({ kind, name: f.name, blob: await shrinkPhoto(f) });
      else if (kind === 'pdf') {
        if (f.size > MAX_PDF) { toast(`${f.name} is too big (over 20 MB).`, 5000); continue; }
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') { toast(`${f.name} isn’t a PDF the app can read.`, 5000); continue; }
        photos.pages.push({ kind, name: f.name, blob: new Blob([bytes], { type: 'application/pdf' }) });
      } else {
        if (f.size > MAX_TEXT) { toast(`${f.name} is too big (over 2 MB).`, 5000); continue; }
        photos.pages.push({ kind, name: f.name, blob: new Blob([await f.text()], { type: 'text/plain' }) });
      }
    } catch (err) {
      console.error(err);
      toast(`Couldn’t read ${f.name}. If it’s on Google Drive, check you’re online and try again, or make it available offline in the Drive app first.`, 8000);
    }
  }
  if ($('#toast').textContent === reading) $('#toast').hidden = true; // keep any message about a file that failed
  photoSheet();
}

// "2 photos", "1 PDF", "1 photo, 1 MusicXML file"…
function originalsLabel(items) {
  const n = k => items.filter(i => i.kind === k).length;
  return [n('image') && plural(n('image'), 'photo'), n('pdf') && plural(n('pdf'), 'PDF'), n('text') && plural(n('text'), 'notation file')].filter(Boolean).join(', ');
}

let photoUrls = [];
function photoSheet() {
  photoUrls.forEach(u => URL.revokeObjectURL(u));
  photoUrls = photos.pages.map(p => p.kind === 'image' ? URL.createObjectURL(p.blob) : '');
  const n = photos.pages.length;
  const tile = (p, i) => p.kind === 'image'
    ? `<img src="${photoUrls[i]}" alt="Page ${i + 1}"><figcaption>${i + 1}. Photo</figcaption>`
    : `<div class="file-tile"><span aria-hidden="true">${p.kind === 'pdf' ? '📄' : '🎼'}</span>${esc(p.name)}</div><figcaption>${i + 1}. ${p.kind === 'pdf' ? 'PDF' : 'Notation file'}</figcaption>`;
  openSheet(`
    <h2>Import and convert</h2>
    <p class="muted small">${n ? `${originalsLabel(photos.pages)}, in this order. Add one photo per page, or a file with the whole score.` : 'Nothing added yet.'}</p>
    <div class="photo-grid">${photos.pages.map((p, i) => `
      <figure>${tile(p, i)}
        <button class="icon-btn" data-photo-del="${i}" aria-label="Remove ${i + 1}">✕</button></figure>`).join('')}</div>
    <div class="stack">
      <button class="btn" data-act="photo-camera">${n ? 'Photograph another page' : 'Take a photo'}</button>
      <button class="btn" data-act="photo-pick">Add from your photos</button>
      <button class="btn" data-act="photo-file">Add files (phone or Google Drive)</button>
      <button class="btn primary" id="ph-go" ${n ? '' : 'disabled'}>Convert to LilyPond</button>
    </div>
    <p class="hint">Files can be PDFs of the score, pictures, or MusicXML, ABC or LilyPond files. To use Google Drive: if your phone first offers Camera or Files, choose <b>Files</b>; then tap <b>☰</b> (top left), choose <b>Drive</b>, open the folder and select the files (touch and hold to select several). Notation files give the most accurate result; for photos, photograph each page flat and square-on, in good light, filling the frame. Claude reads them, the app checks the result with LilyPond, and it opens in the editor for you to compare with the originals and correct before publishing.</p>`,
    { onClose: () => { photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls = []; render(); } });
  $('#ph-go').addEventListener('click', convertPhotos);
  $('#sheet-body').addEventListener('click', e => {
    const b = e.target.closest('[data-photo-del]');
    if (!b) return;
    photos.pages.splice(+b.dataset.photoDel, 1);
    photoSheet();
  });
}

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const photoKey = (name, i) => `photo:${name}:${i}`;
// Drafts made before files were supported have only a photo count.
const draftKinds = d => d.kinds || Array(d.photos || 0).fill('image');
async function savePhotos(name, pages) { for (const [i, p] of pages.entries()) await db.put('files', photoKey(name, i), p.blob); }
async function deletePhotos(name) { for (let i = 0; i < 40; i++) await db.del('files', photoKey(name, i)).catch(() => {}); }
// kinds: one entry per original ('image' | 'pdf' | 'text'); notation files can't be shown.
function viewPhotos(name, title, kinds) {
  const items = kinds.map((k, i) => ({ k, i })).filter(({ k }) => k !== 'text')
    .map(({ k, i }) => ({ songId: photoKey(name, i), title: `${title}: ${k === 'pdf' ? 'PDF' : 'photo'} ${i + 1}` }));
  if (!items.length) { toast('The original is a notation file, which can’t be shown here'); return; }
  pushLayer(closeViewer);
  openViewer($('#viewer'), {
    items, index: 0, label: 'Originals',
    getSong: async id => { const blob = await db.get('files', id); return blob ? { title, kind: blob.type === 'application/pdf' ? 'pdf' : 'image', blob } : null; },
    fit: state.settings.fit, fullscreen: false,
    onFit: fit => { state.settings.fit = fit; save(); },
    onClose: back
  });
  $('#viewer [data-v="notes"]').hidden = true;
}

// A file name that isn't used on GitHub or by another new score.
function freeName(raw, taken) {
  const base = String(raw || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'new_score';
  let name = base;
  for (let n = 2; taken.has(name) || state.drafts?.['new:' + name]; n++) name = `${base}_${n}`;
  return name;
}

// The example score shown to Claude, and the names already used in the source folder.
async function exampleScore(g) {
  const branch = await ghBranch(g);
  const list = await ghJson(g, `contents/${encPath(g.srcPath || '')}?ref=${encodeURIComponent(branch)}`.replace('contents/?', 'contents?'));
  const lys = list.filter(f => f.type === 'file' && /\.ly$/.test(f.name)).map(f => f.name);
  const pick = lys.includes('bold_riley.ly') ? 'bold_riley.ly' : lys.find(n => n !== 'template.ly');
  if (!pick) throw new Error(`There are no scores in ${g.srcPath || 'the repository'} to show Claude as an example.`);
  const path = [g.srcPath, pick].filter(Boolean).join('/');
  const text = await (await ghApi(g, `contents/${encPath(path)}?ref=${encodeURIComponent(branch)}`, { accept: 'application/vnd.github.raw' })).text();
  return { example: { path, text }, taken: new Set(lys.map(n => n.slice(0, -3))) };
}

async function askClaude(Anthropic, client, system, messages, signal, status) {
  try {
    return await askClaudeOnce(Anthropic, client, system, messages, signal, status);
  } catch (err) {
    if (signal.aborted || !isDroppedConnection(Anthropic, err)) throw err;
    console.warn('Connection dropped; retrying once', err);
    status('The connection dropped. Trying again…');
    await sleep(3000);
    return askClaudeOnce(Anthropic, client, system, messages, signal, status);
  }
}

async function askClaudeOnce(Anthropic, client, system, messages, signal, status) {
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // if the request is declined, the API retries it on a suitable model
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: TRANSCRIPTION_SCHEMA } },
    cache_control: { type: 'ephemeral' }, // the repair round reuses the photos and prompt
    system,
    messages
  }, { signal });
  let chars = 0;
  stream.on('text', t => { chars += t.length; status(`Writing the LilyPond file… ${(chars / 1000).toFixed(1)}k characters`); });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to transcribe this score.');
  if (msg.stop_reason === 'max_tokens') throw new Error('The score was too long to transcribe in one go. Try fewer pages at a time.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('Claude’s reply couldn’t be read. Please try again.'); }
  return { ...out, content: msg.content };
}

// The connection dropped part-way (e.g. the phone slept, the app went into the background or the
// network changed). The SDK retries failures before a reply starts; a drop mid-reply surfaces as a
// plain TypeError ("network error") from reading the stream.
const isDroppedConnection = (Anthropic, err) =>
  (Anthropic && err instanceof Anthropic.APIConnectionError) ||
  (!(Anthropic && err instanceof Anthropic.APIError && err.status) && /network ?error|failed to fetch|load failed|connection (error|reset|closed)|terminated/i.test(String(err?.message)));
const DROPPED = 'The connection to Anthropic failed or dropped. Check you’re online. A connection can also drop while Claude is working if the phone’s screen turns off, the app goes into the background, or the phone switches between Wi-Fi and mobile data, so keep the app open with the screen on, and try again.';

function claudeErrorMessage(Anthropic, err) {
  if (isDroppedConnection(Anthropic, err)) return DROPPED;
  if (!Anthropic) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic didn’t accept the API key. Check it in Claude API key settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key isn’t allowed to use Claude. Check the key and your account in the Claude Console.';
  if (err instanceof Anthropic.RateLimitError) return 'Too many requests, or the account’s usage limit was reached. Wait a minute and try again, or check Billing in the Claude Console.';
  if (err instanceof Anthropic.BadRequestError) return `Anthropic couldn’t process the request: ${err.message}. If it mentions credit or billing, add credit in the Claude Console.`;
  if (err instanceof Anthropic.APIError) return `Anthropic replied with an error (${err.status ?? 'unknown'}). Try again in a minute.`;
  return err.message;
}

async function convertPhotos() {
  if (!photos.pages.length) return;
  if (!claudeKey()) { claudeSheet(() => photoSheet()); return; }
  const g = ghConfig();
  if (!g.token) {
    openSheet(`<h2>GitHub settings needed</h2><p>New scores are written in your repository’s house style and published to GitHub, so the app needs your GitHub settings and access token first.</p>
      <button class="btn primary" data-act="github-settings">GitHub settings</button>`);
    return;
  }
  const abort = new AbortController();
  openSheet(`<h2>Converting to LilyPond…</h2><p id="cv-status" aria-live="polite">Starting…</p>
    <p class="muted small">This usually takes one to a few minutes. Keep the app open.</p>
    <button class="btn" id="cv-cancel">Cancel</button>`, { locked: true });
  $('#cv-cancel').addEventListener('click', () => { abort.abort(); sheetLocked = false; photoSheet(); });
  const status = t => { const el = $('#cv-status'); if (el) el.textContent = t; };
  let Anthropic, step = 'getting the house style from GitHub', wakeLock = null;
  // Keep the screen on: if the phone sleeps, the connection to Claude can drop.
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or not allowed */ }
  try {
    status('Getting the house style from GitHub…');
    const support = await lilySupportFiles(g);
    const { example, taken } = await exampleScore(g);
    const styleFiles = Object.entries(support).filter(([, f]) => typeof f.data === 'string').map(([p, f]) => [p, f.data]);
    step = 'preparing the photos and files';
    status('Preparing the originals…');
    const pages = photos.pages;
    if (pages.reduce((t, p) => t + p.blob.size, 0) > 22e6) throw new Error('Together, the photos and files are too big to send (over 22 MB). Try fewer at a time.');
    const blocks = await Promise.all(pages.map(async (p, i) => {
      if (p.kind === 'image') return [{ type: 'text', text: `Page ${i + 1} (photo):` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(p.blob) } }];
      if (p.kind === 'pdf') return [{ type: 'text', text: `${i + 1}. PDF ${p.name}:` }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await blobToBase64(p.blob) } }];
      return [{ type: 'text', text: `${i + 1}. Notation file ${p.name}:\n<file name="${p.name}">\n${await p.blob.text()}\n</file>` }];
    }));
    Anthropic = (await import(SDK_URL)).default;
    const client = new Anthropic({ apiKey: claudeKey(), dangerouslyAllowBrowser: true });
    const system = transcriptionPrompt(styleFiles, example);
    const messages = [{
      role: 'user',
      content: [
        ...blocks.flat(),
        { type: 'text', text: `Transcribe this score (${originalsLabel(pages)}) into a LilyPond file in the house style.` }
      ]
    }];
    step = 'waiting for Claude';
    status('Claude is reading the score…');
    let result = await askClaude(Anthropic, client, system, messages, abort.signal, status);

    step = 'checking it with LilyPond';
    status('Checking it with LilyPond…');
    const compiler = await lilyEngine(({ loadedBytes, totalBytes }) => status(`Downloading LilyPond for checking (once only)… ${Math.round(loadedBytes / 1e6)} of ${Math.round(totalBytes / 1e6)} MB`));
    const name = freeName(result.file_name || result.title, taken);
    const lyPath = [g.srcPath, name + '.ly'].filter(Boolean).join('/');
    let check = await compileLy(compiler, support, result.lilypond, lyPath, abort.signal);
    const errors = c => lilyMessages(c.log).filter(m => m.kind === 'error');
    if (errors(check).length || !check.pdf) {
      step = 'waiting for Claude to fix LilyPond’s errors';
      status('LilyPond found problems. Asking Claude to fix them…');
      const report = errors(check).slice(0, 40).map(m => `${m.file.split('/').pop()}:${m.line}:${m.col}: ${m.msg}`).join('\n') || check.log.slice(-3000);
      messages.push(
        { role: 'assistant', content: result.content },
        { role: 'user', content: `LilyPond 2.26.0 reported these errors in your file:\n\n${report}\n\nFix them and give the whole corrected file in the same format. Keep the transcription the same apart from the fixes.` }
      );
      const fixed = await askClaude(Anthropic, client, system, messages, abort.signal, status);
      result = { ...fixed, title: fixed.title || result.title, notes: [result.notes, fixed.notes].filter(Boolean).join(' ') };
      step = 'checking it with LilyPond';
      status('Checking it with LilyPond again…');
      check = await compileLy(compiler, support, result.lilypond, lyPath, abort.signal);
    }
    disposeEngine();
    step = 'saving the new score';

    const id = 'new:' + name;
    await savePhotos(name, photos.pages);
    state.drafts ||= {};
    state.drafts[id] = {
      text: result.lilypond, base: '', baseSha: null, lyPath, isNew: true,
      title: titleCase((result.title || name.replace(/_/g, ' ')).trim().replace(/\s+/g, ' ')), notes: result.notes || '', created: Date.now(),
      photos: pages.length, kinds: pages.map(p => p.kind), originals: originalsLabel(pages)
    };
    await flush();
    photos.pages = [];
    E.pendingPreview = { text: result.lilypond, log: check.log, pdf: check.pdf, messages: lilyMessages(check.log) };
    sheetLocked = false;
    openEditor(id);
  } catch (err) {
    disposeEngine();
    if (abort.signal.aborted) return;
    console.error(err);
    sheetLocked = false;
    openSheet(`<h2>Couldn’t convert the score</h2><p>${esc(claudeErrorMessage(Anthropic, err))}</p>
      <p class="muted small">This happened while ${esc(step)}.</p>
      <div class="stack"><button class="btn primary" id="cv-back">Back</button><button class="btn" data-act="claude-settings">Claude API key</button></div>`);
    $('#cv-back').addEventListener('click', photoSheet);
  } finally {
    wakeLock?.release().catch(() => {});
  }
}

$('#pick-camera').addEventListener('change', e => { const f = e.target.files; if (f?.length) addPhotos(f); e.target.value = ''; });
$('#pick-photos').addEventListener('change', e => { const f = e.target.files; if (f?.length) addPhotos(f); e.target.value = ''; });
$('#pick-any').addEventListener('change', e => { const f = e.target.files; if (f?.length) addPhotos(f); e.target.value = ''; });

/* ---------- backup ---------- */

function downloadBackup() {
  const data = {
    app: 'scores', version: 1, exported: new Date().toISOString(),
    categories: state.categories,
    programmes: state.programmes,
    songs: songs().map(({ id, key, file, title, cats, notes }) => ({ id, key, file, title, cats, notes })),
    // Never put the GitHub access token in a backup file.
    settings: { ...state.settings, claude: undefined, github: state.settings.github && { ...state.settings.github, token: undefined } }
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `scores-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('That file isn\'t a backup'); return; }
  if (data.app !== 'scores' || !Array.isArray(data.programmes)) { toast('That file isn\'t a Scores backup'); return; }
  // Categories: add any that don't exist yet.
  for (const c of data.categories || []) if (!state.categories.some(x => x.id === c.id)) state.categories.push(c);
  // Songs: songs already imported get their saved title and categories; others are remembered for when they're imported.
  const idMap = new Map();
  for (const b of data.songs || []) {
    const s = songs().find(x => sameKey(b.key, x.key));
    if (s) { s.title = savedTitle(b, s); s.cats = b.cats || []; if (b.notes) s.notes = b.notes; idMap.set(b.id, s.id); }
    else idMap.set(b.id, b.id);
    if (!s) {
      state.pending ||= {};
      state.pending[b.key] = b;
    }
  }
  for (const p of data.programmes) {
    p.items = p.items.map(i => i.songId ? { ...i, songId: idMap.get(i.songId) ?? i.songId } : i);
    const at = state.programmes.findIndex(x => x.id === p.id);
    if (at >= 0) state.programmes[at] = p; else state.programmes.push(p);
  }
  if (data.settings) {
    const token = state.settings.github?.token, claude = state.settings.claude;
    state.settings = { ...state.settings, ...data.settings, claude };
    if (state.settings.github && token && !state.settings.github.token) state.settings.github.token = token;
  }
  dropNonChristmas(); // older backups include it
  await flush();
  toast(`Restored ${plural(data.programmes.length, 'programme')}`);
  render();
}

// Songs restored from a backup before their files were imported: match them up on import.
function applyPending() {
  if (!state.pending) return;
  for (const s of songs()) {
    const pk = Object.keys(state.pending).find(k => sameKey(k, s.key));
    const b = pk && state.pending[pk];
    if (!b) continue;
    s.title = savedTitle(b, s);
    s.cats = b.cats || [];
    if (b.notes) s.notes = b.notes;
    for (const p of state.programmes) for (const i of p.items) if (i.songId === b.id) i.songId = s.id;
    delete state.pending[pk];
  }
  if (!Object.keys(state.pending).length) delete state.pending;
  save();
}

$('#pick-backup').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) restoreBackup(f); e.target.value = ''; });

/* ---------- categories ---------- */

function categorySheet(id = null) {
  const c = id ? state.categories.find(x => x.id === id) : null;
  openSheet(`
    <h2>${c ? 'Rename category' : 'New category'}</h2>
    <label class="field">Name<input id="c-name" value="${esc(c?.name ?? '')}" placeholder="e.g. Hymns"></label>
    <button class="btn primary" id="c-save">${c ? 'Save' : 'Add'}</button>`, { onClose: render });
  $('#c-name').focus();
  $('#c-save').addEventListener('click', () => {
    const name = $('#c-name').value.trim();
    if (!name) return;
    if (c) c.name = name; else state.categories.push({ id: uid(), name });
    save();
    closeSheet();
  });
}

function confirmSheet(title, body, okLabel, onOk) {
  openSheet(`<h2>${title}</h2><p>${body}</p>
    <div class="stack"><button class="btn danger" id="ok">${okLabel}</button><button class="btn" data-act="close-sheet">Cancel</button></div>`);
  $('#ok').addEventListener('click', async () => {
    sheetOnClose = render;
    await onOk();
    closeSheet();
  });
}

/* ---------- one click handler for everything ---------- */

document.addEventListener('click', e => {
  const t = e.target;
  const act = t.closest('[data-act]')?.dataset.act;
  const p = ui.progId && programme(ui.progId);

  if (t.closest('[data-open]')) {
    const id = t.closest('[data-open]').dataset.open;
    if (ui.select) {
      ui.select.has(id) ? ui.select.delete(id) : ui.select.add(id);
      t.closest('li').classList.toggle('selected', ui.select.has(id));
      updateSelectBar();
    } else openSong(id);
    return;
  }
  if (t.closest('[data-more]')) return songSheet(t.closest('[data-more]').dataset.more);
  if (t.closest('[data-new-draft]')) return openEditor(t.closest('[data-new-draft]').dataset.newDraft);
  if (t.closest('[data-cat]')) { ui.cat = t.closest('[data-cat]').dataset.cat; updateSongList(); return; }
  if (t.closest('[data-prog]')) return openProgramme(t.closest('[data-prog]').dataset.prog);
  if (t.closest('[data-play]') && p) {
    const items = programmeItemsForViewer(p);
    const idx = items.findIndex(i => i.itemId === t.closest('[data-play]').dataset.play);
    return viewSongs(items, Math.max(0, idx), p.name);
  }
  if (t.closest('[data-remove-item]') && p) {
    p.items = p.items.filter(i => i.id !== t.closest('[data-remove-item]').dataset.removeItem);
    save();
    return render();
  }
  if (t.closest('[data-edit-note]') && p) return noteSheet(p.id, t.closest('[data-edit-note]').dataset.editNote);
  if (t.closest('[data-cat-rename]')) return categorySheet(t.closest('[data-cat-rename]').dataset.catRename);
  if (t.closest('[data-cat-del]')) {
    const c = state.categories.find(x => x.id === t.closest('[data-cat-del]').dataset.catDel);
    const n = songs().filter(s => s.cats.includes(c.id)).length;
    return confirmSheet(`Delete “${esc(c.name)}”?`, n ? `${plural(n, 'song')} will lose this category. The songs themselves are kept.` : 'No songs use it.', 'Delete category', () => {
      state.categories = state.categories.filter(x => x !== c);
      for (const s of songs()) s.cats = s.cats.filter(x => x !== c.id);
      return flush();
    });
  }

  switch (act) {
    case 'close-sheet': return closeSheet();
    case 'import-folder': return $('#pick-folder').click();
    case 'import-files': return $('#pick-files').click();
    case 'github-import': return state.settings.github ? importFromGitHub() : githubSheet(); // first time: confirm the settings
    case 'github-settings': return githubSheet();
    case 'engine-download': return downloadEngine();
    case 'photo-camera': return $('#pick-camera').click();
    case 'photo-pick': return $('#pick-photos').click();
    case 'photo-file': return $('#pick-any').click();
    case 'claude-settings': return claudeSheet();
    case 'sheet-edit-ly': return openEditor(t.closest('[data-id]').dataset.id);
    case 'select-start': ui.select = new Set(); return render();
    case 'select-done': ui.select = null; return render();
    case 'select-all': filterSongs(ui.q, ui.cat).forEach(s => ui.select.add(s.id)); return updateSongList();
    case 'sel-cat': return bulkCategorySheet([...ui.select]);
    case 'sel-prog': return addToProgrammeSheet([...ui.select]);
    case 'sel-del': {
      const ids = [...ui.select];
      return confirmSheet(`Remove ${plural(ids.length, 'song')}?`, 'They\'ll be removed from this app and from any programmes that use them. The original files on your phone or on GitHub are not touched.', 'Remove', async () => {
        await deleteSongs(ids);
        ui.select = null;
      });
    }
    case 'sheet-open': return openSong(t.closest('[data-id]').dataset.id);
    case 'sheet-addprog': return addToProgrammeSheet([t.closest('[data-id]').dataset.id]);
    case 'sheet-delsong': {
      const id = t.closest('[data-id]').dataset.id;
      return confirmSheet(`Remove “${esc(state.songs[id].title)}”?`, 'It will be removed from this app. The original file on your phone or on GitHub is not touched; import it again to bring it back.', 'Remove', () => deleteSongs([id]));
    }
    case 'new-prog': return programmeDetailsSheet(null);
    case 'prog-edit': ui.progEdit = !ui.progEdit; return render();
    case 'prog-start': return viewSongs(programmeItemsForViewer(p), 0, p.name);
    case 'prog-add': return pickSongsSheet(p.id);
    case 'prog-more': return programmeMoreSheet(p.id);
    case 'prog-details': return programmeDetailsSheet(p.id);
    case 'prog-note': return noteSheet(p.id);
    case 'prog-share': return shareProgramme(p);
    case 'prog-dup': {
      const copy = { ...structuredClone(p), id: uid(), name: p.name + ' (copy)', created: Date.now(), updated: Date.now() };
      copy.items = copy.items.map(i => ({ ...i, id: uid() }));
      state.programmes.push(copy);
      save();
      toast('Programme duplicated');
      sheetOnClose = () => { ui.progId = copy.id; render(); };
      return closeSheet();
    }
    case 'prog-del':
      return confirmSheet(`Delete “${esc(p.name)}”?`, 'The programme is deleted. Its songs stay in your library.', 'Delete programme', async () => {
        state.programmes = state.programmes.filter(x => x !== p);
        await flush();
        sheetOnClose = null;
        setTimeout(back, 50); // leave the programme screen too
      });
    case 'cat-add': return categorySheet();
    case 'auto-cat':
      return confirmSheet('Re-guess Christmas songs?', 'Every song whose title or folder looks Christmassy is put in Christmas, and every other song is taken out of it. Any changes you made to the Christmas category will be replaced. Other categories are kept.', 'Re-guess', () => {
        if (!state.categories.some(c => c.id === 'christmas')) state.categories.splice(1, 0, { id: 'christmas', name: 'Christmas' });
        for (const s of songs()) s.cats = [...s.cats.filter(c => c !== 'christmas'), ...guessCategory(s.key + ' ' + s.title)];
        return flush();
      });
    case 'backup': return downloadBackup();
    case 'restore': return $('#pick-backup').click();
    case 'wipe':
      return confirmSheet('Remove all scores?', `All ${plural(songs().length, 'score')} are removed from this app, freeing their storage. The original files on your phone or on GitHub are not touched. Programmes and categories are kept: if you import the scores again, their titles, categories and places in programmes come back.`, 'Remove all scores', async () => {
        // Remember each song so a later import reconnects it (see applyPending).
        state.pending ||= {};
        for (const x of songs()) state.pending[x.key] = { id: x.id, key: x.key, title: x.title, cats: x.cats, notes: x.notes };
        await db.clear('files');
        state.songs = {};
        ui.select = null;
        await flush();
        toast('All scores removed');
      });
  }
});

/* ---------- start ---------- */

await loadState();
applyPending();
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
