
// ── DOM helpers ──────────────────────────────────────────────────────────────

function el(tag, props) {
  const e = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
  }
  return e;
}

function append(parent) {
  for (let i = 1; i < arguments.length; i++) {
    const c = arguments[i];
    if (typeof c === 'string') parent.appendChild(document.createTextNode(c));
    else if (c instanceof Node) parent.appendChild(c);
  }
  return parent;
}

// ── SVG icons (no innerHTML — all shapes via createElementNS) ────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

// Icon definitions: array of [tagName, {attributes}]
const ICON_SHAPES = {
  image: [
    ['rect',     { x:'3', y:'3', width:'18', height:'18', rx:'2' }],
    ['circle',   { cx:'8.5', cy:'8.5', r:'1.5' }],
    ['polyline', { points:'21 15 16 10 5 21' }],
  ],
  audio: [
    ['path',   { d:'M9 18V5l12-2v13' }],
    ['circle', { cx:'6', cy:'18', r:'3' }],
    ['circle', { cx:'18', cy:'16', r:'3' }],
  ],
  video: [
    ['rect', { x:'2', y:'2', width:'20', height:'20', rx:'2.18' }],
    ['line', { x1:'7',  y1:'2',  x2:'7',  y2:'22' }],
    ['line', { x1:'17', y1:'2',  x2:'17', y2:'22' }],
    ['line', { x1:'2',  y1:'12', x2:'22', y2:'12' }],
    ['line', { x1:'2',  y1:'7',  x2:'7',  y2:'7'  }],
    ['line', { x1:'2',  y1:'17', x2:'7',  y2:'17' }],
    ['line', { x1:'17', y1:'17', x2:'22', y2:'17' }],
    ['line', { x1:'17', y1:'7',  x2:'22', y2:'7'  }],
  ],
  document: [
    ['path',     { d:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
    ['polyline', { points:'14 2 14 8 20 8' }],
    ['line',     { x1:'16', y1:'13', x2:'8', y2:'13' }],
    ['line',     { x1:'16', y1:'17', x2:'8', y2:'17' }],
  ],
  archive: [
    ['polyline', { points:'21 8 21 21 3 21 3 8' }],
    ['rect',     { x:'1', y:'3', width:'22', height:'5' }],
    ['line',     { x1:'10', y1:'12', x2:'14', y2:'12' }],
  ],
  code: [
    ['polyline', { points:'16 18 22 12 16 6' }],
    ['polyline', { points:'8 6 2 12 8 18' }],
  ],
  generic: [
    ['path',     { d:'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' }],
    ['polyline', { points:'13 2 13 9 20 9' }],
  ],
  folder: [
    ['path', { d:'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h11a2 2 0 0 1 2 2z' }],
  ],
  dl: [
    ['path',     { d:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points:'7 10 12 15 17 10' }],
    ['line',     { x1:'12', y1:'15', x2:'12', y2:'3' }],
  ],
  trash: [
    ['polyline', { points:'3 6 5 6 21 6' }],
    ['path',     { d:'M19 6l-1 14H6L5 6' }],
    ['path',     { d:'M10 11v6' }],
    ['path',     { d:'M14 11v6' }],
    ['path',     { d:'M9 6V4h6v2' }],
  ],
  rename: [
    ['path', { d:'M12 20h9' }],
    ['path', { d:'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' }],
  ],
  chevL: [['polyline', { points:'15 18 9 12 15 6' }]],
  chevR: [['polyline', { points:'9 18 15 12 9 6' }]],
  play: [['polygon', { points:'5 3 19 12 5 21 5 3' }]],
  pause: [
    ['rect', { x:'6', y:'4', width:'4', height:'16' }],
    ['rect', { x:'14', y:'4', width:'4', height:'16' }],
  ],
  close: [
    ['line', { x1:'18', y1:'6', x2:'6', y2:'18' }],
    ['line', { x1:'6', y1:'6', x2:'18', y2:'18' }],
  ],
  volume: [
    ['polygon', { points:'11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['path', { d:'M15.54 8.46a5 5 0 0 1 0 7.07' }],
    ['path', { d:'M19.07 4.93a10 10 0 0 1 0 14.14' }],
  ],
  volumeMute: [
    ['polygon', { points:'11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['line', { x1:'23', y1:'9', x2:'17', y2:'15' }],
    ['line', { x1:'17', y1:'9', x2:'23', y2:'15' }],
  ],
};

function makeIcon(name, size, color) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width',            String(size || 18));
  svg.setAttribute('height',           String(size || 18));
  svg.setAttribute('viewBox',          '0 0 24 24');
  svg.setAttribute('fill',             'none');
  svg.setAttribute('stroke',           color || '#666');
  svg.setAttribute('stroke-width',     '2');
  svg.setAttribute('stroke-linecap',   'round');
  svg.setAttribute('stroke-linejoin',  'round');
  svg.setAttribute('aria-hidden',      'true');
  for (const [tag, attrs] of (ICON_SHAPES[name] || ICON_SHAPES.generic)) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    svg.appendChild(shape);
  }
  return svg;
}

function makeFilledIcon(name, size, color) {
  const fill = color || '#2a2a2a';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size || 18));
  svg.setAttribute('height', String(size || 18));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', fill);
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of (ICON_SHAPES[name] || ICON_SHAPES.generic)) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    shape.setAttribute('fill', fill);
    shape.setAttribute('stroke', 'none');
    svg.appendChild(shape);
  }
  return svg;
}

// ── File type detection ───────────────────────────────────────────────────────

const TYPE_MAP = {
  image:    ['jpg','jpeg','png','gif','webp','svg','bmp','heic','avif','tiff'],
  audio:    ['mp3','wav','flac','ogg','m4a','aiff','aac','opus'],
  video:    ['mp4','mkv','mov','avi','webm','m4v','flv','wmv'],
  document: ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','rtf','odt','pages','numbers','key','md','pro','cho'],
  archive:  ['zip','rar','7z','tar','gz','bz2','xz','dmg'],
  code:     ['js','ts','jsx','tsx','html','css','json','py','rb','go','java','c','cpp','h','sh','yml','yaml','xml','php','swift','kt','rs'],
};
const TYPE_COLORS = {
  image:'#4aef8f', audio:'#b04aff', video:'#ff9f4a',
  document:'#4a9eff', archive:'#ffdf4a', code:'#ff6b9d', generic:'#555',
  folder:'#e8b84a',
};

function fileType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  for (const [type, exts] of Object.entries(TYPE_MAP)) {
    if (exts.includes(ext)) return type;
  }
  return 'generic';
}

const TEXT_EXTENSIONS = new Set([
  'txt','md','pro','cho',
  ...TYPE_MAP.code,
]);
const EDITABLE_EXTENSIONS = new Set(['txt','md','pro','cho']);
const NEW_SHEET_EXTENSIONS = [
  { value: '.md', label: '.md' },
  { value: '.txt', label: '.txt' },
  // ChordPro — enable when viewer support lands
  // { value: '.pro', label: '.pro' },
  // { value: '.cho', label: '.cho' },
];

function fileExt(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

function isTextFile(name) {
  return TEXT_EXTENSIONS.has(fileExt(name));
}

function isEditableFile(name) {
  return EDITABLE_EXTENSIONS.has(fileExt(name));
}

function isPdfFile(name) {
  return fileExt(name) === 'pdf';
}

function parentDirFromPath(relPath) {
  const idx = relPath.lastIndexOf('/');
  return idx >= 0 ? relPath.slice(0, idx) : '';
}

// ── Tag color ─────────────────────────────────────────────────────────────────

const TAG_PALETTE = ['#4a9eff','#4aef8f','#ff9f4a','#b04aff','#ffdf4a','#ff6b9d','#4aefef','#ff7777'];
function tagColor(id) { return TAG_PALETTE[((id - 1) % TAG_PALETTE.length)]; }

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  page: 1,
  tagFilter: 'all',
  view: 'browse',
  tags: [],
  currentDir: '',
  listMode: 'browse',
  inlineRename: null,
  query: '',
  sort: 'modified',
  order: 'desc',
  excludeTags: [],
  showTags: [],
  shareDir: '',
};

const VALID_SORTS = ['name', 'size', 'modified', 'downloads'];
const SETUP_RESET_CONFIRM = 'fileshare';
const EXCLUDE_TAGS_KEY = 'fileshare-exclude-tags';
const SHOW_TAGS_KEY = 'fileshare-show-tags';
let settingsMigrated = false;
let setupIsReset = false;

function loadLocalCategoryTagIds() {
  try {
    const exclude = JSON.parse(localStorage.getItem(EXCLUDE_TAGS_KEY) || '[]');
    const show = JSON.parse(localStorage.getItem(SHOW_TAGS_KEY) || '[]');
    const parse = (arr) => (Array.isArray(arr) ? arr : [])
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id) && id > 0);
    return { excludeTags: parse(exclude), showTags: parse(show) };
  } catch {
    return { excludeTags: [], showTags: [] };
  }
}

function clearLocalCategoryTagIds() {
  try {
    localStorage.removeItem(EXCLUDE_TAGS_KEY);
    localStorage.removeItem(SHOW_TAGS_KEY);
  } catch { /* ignore */ }
}

function applyCategorySettings(settings) {
  if (!settings) return;
  state.excludeTags = settings.excludeTags || [];
  state.showTags = settings.showTags || [];
  if (settings.shareDir) syncSharePath(settings.shareDir);
}

function syncSharePath(shareDir) {
  if (!shareDir) return;
  state.shareDir = shareDir;
  const el = document.getElementById('header-path');
  if (el) {
    el.textContent = shareDir;
    el.title = shareDir;
  }
  updateSettingsShareDir(shareDir);
}

function markShareUnconfigured() {
  state.shareDir = '';
  const el = document.getElementById('header-path');
  if (el) {
    el.textContent = 'Not configured';
    el.title = '';
  }
  updateSettingsShareDir('');
}

async function fetchSetupStatus() {
  const res = await fetch('/api/setup', { cache: 'no-store' });
  if (!res.ok) throw new Error('Setup check failed');
  return res.json();
}

async function bootstrapApp() {
  try {
    const data = await fetchSetupStatus();
    if (data.configured && data.shareDir) {
      syncSharePath(data.shareDir);
      hideSetupModal();
      await maybeMigrateLocalSettings();
      await loadFiles();
      return;
    }
    markShareUnconfigured();
    showSetupModal({ suggested: data.suggested || '' });
  } catch {
    showToast('Could not reach server', 'error');
  }
}

function updateSettingsShareDir(shareDir) {
  const el = document.getElementById('settings-share-dir');
  if (!el) return;
  el.textContent = shareDir || 'Not configured';
}

function showSetupModal(options = {}) {
  const { suggested = '', isReset = false } = options;
  setupIsReset = isReset;
  const modal = document.getElementById('setup-modal');
  const input = document.getElementById('setup-path-input');
  const errEl = document.getElementById('setup-error');
  const titleEl = document.getElementById('setup-modal-title');
  const descEl = document.getElementById('setup-modal-desc');
  errEl.textContent = '';
  input.value = suggested;
  titleEl.textContent = isReset ? 'Choose a new storage folder' : 'Choose storage folder';
  descEl.textContent = isReset
    ? 'Pick the folder Fileshare should use now. Existing files in the previous folder stay on disk but will not appear until you point back at that path.'
    : 'Pick a folder on this PC where uploaded files will be stored. This is saved in the database and only needs to be set once.';
  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 50);
}

function hideSetupModal() {
  document.getElementById('setup-modal').style.display = 'none';
}

async function checkSetup() {
  try {
    const data = await fetchSetupStatus();
    if (data.configured && data.shareDir) {
      syncSharePath(data.shareDir);
      hideSetupModal();
      return true;
    }
    if (!state.shareDir) {
      markShareUnconfigured();
      showSetupModal({ suggested: data.suggested || '' });
    }
    return false;
  } catch {
    showToast('Could not reach server', 'error');
    return false;
  }
}

async function submitSetup() {
  const input = document.getElementById('setup-path-input');
  const errEl = document.getElementById('setup-error');
  const btn = document.getElementById('setup-submit-btn');
  const shareDir = input.value.trim();
  if (!shareDir) {
    errEl.textContent = 'Enter a folder path';
    return;
  }
  errEl.textContent = '';
  btn.disabled = true;
  try {
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareDir }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = data.error || 'Setup failed';
      return;
    }
    hideSetupModal();
    syncSharePath(data.shareDir);
    showToast(setupIsReset ? 'Storage folder updated' : 'Storage folder configured', 'success');
    setupIsReset = false;
    await loadFiles();
  } catch {
    errEl.textContent = 'Could not reach server';
  } finally {
    btn.disabled = false;
  }
}

async function saveCategorySettings() {
  try {
    const r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        excludeTags: state.excludeTags,
        showTags: state.showTags,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Failed to save settings');
    applyCategorySettings(data);
  } catch (err) {
    showToast(err.message || 'Failed to save settings', 'error');
  }
}

async function maybeMigrateLocalSettings() {
  if (settingsMigrated) return;
  settingsMigrated = true;
  const local = loadLocalCategoryTagIds();
  if (!local.excludeTags.length && !local.showTags.length) return;
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) return;
    const server = await r.json();
    if ((server.excludeTags && server.excludeTags.length) || (server.showTags && server.showTags.length)) {
      clearLocalCategoryTagIds();
      return;
    }
    const put = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(local),
    });
    if (put.ok) clearLocalCategoryTagIds();
  } catch { /* ignore */ }
}

// ── URL routing (History API) ─────────────────────────────────────────────────

function hrefForState(partial = {}) {
  const s = {
    currentDir: state.currentDir,
    tagFilter: state.tagFilter,
    view: state.view,
    page: state.page,
    query: state.query,
    sort: state.sort,
    order: state.order,
    ...partial,
  };
  const q = new URLSearchParams();
  if (s.currentDir) q.set('dir', s.currentDir);
  if (s.tagFilter !== 'all') q.set('tag', String(s.tagFilter));
  if (s.view === 'sheets') q.set('view', 'sheets');
  if (s.page > 1) q.set('page', String(s.page));
  if (s.query) q.set('q', s.query);
  if (s.sort !== 'modified') q.set('sort', s.sort);
  if (s.order !== 'desc') q.set('order', s.order);
  const qs = q.toString();
  const path = location.pathname;
  return qs ? path + '?' + qs : path;
}

function readUrlIntoState() {
  const q = new URLSearchParams(location.search);
  state.currentDir = q.get('dir') || '';
  const t = q.get('tag');
  state.tagFilter = t != null && t !== '' ? t : 'all';
  state.view = q.get('view') === 'sheets' ? 'sheets' : 'browse';
  const pg = parseInt(q.get('page'), 10);
  state.page = Number.isFinite(pg) && pg >= 1 ? pg : 1;
  state.query = q.get('q') || '';
  const sort = q.get('sort');
  state.sort = VALID_SORTS.includes(sort) ? sort : 'modified';
  state.order = q.get('order') === 'asc' ? 'asc' : 'desc';
}

function pushAppHistory() {
  history.pushState(null, '', hrefForState());
}

function replaceAppHistoryIfNeeded() {
  const next = hrefForState();
  const cur = location.pathname + location.search;
  if (cur !== next) history.replaceState(null, '', next);
}

function renderBreadcrumbs(items, hideNav) {
  const nav = document.getElementById('breadcrumbs');
  nav.replaceChildren();
  if (hideNav) {
    nav.style.display = 'none';
    return;
  }
  nav.style.display = '';
  if (!items || !items.length) return;
  for (let i = 0; i < items.length; i++) {
    const bc = items[i];
    if (i > 0) nav.appendChild(append(el('span', { class: 'bc-sep' }), '/'));
    const a = el('a', {
      href: bc.clearFilter ? hrefForState({ currentDir: '', tagFilter: 'all', view: 'browse', page: 1 }) : hrefForState({ currentDir: bc.path, view: 'browse', page: 1 }),
      title: bc.path || 'Home',
      onclick: (e) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (bc.clearFilter) {
          if (state.tagFilter === 'all' && state.currentDir === '' && state.view === 'browse' && state.page === 1) return;
          state.tagFilter = 'all';
          state.view = 'browse';
          state.currentDir = '';
          state.page = 1;
        } else {
          if (state.currentDir === bc.path && state.page === 1 && state.tagFilter === 'all' && state.view === 'browse') return;
          state.view = 'browse';
          state.currentDir = bc.path;
          state.page = 1;
        }
        pushAppHistory();
        loadFiles();
      },
    });
    a.textContent = bc.name;
    nav.appendChild(a);
  }
}

function renderListBanner(listMode, filterLabel) {
  const banner = document.getElementById('flat-filter-banner');
  if (listMode === 'sheets') {
    banner.style.display = 'block';
    banner.replaceChildren();
    banner.appendChild(document.createTextNode('All sheets '));
    const strong = el('strong');
    strong.textContent = '(.md, .txt)';
    banner.appendChild(strong);
    banner.appendChild(document.createTextNode(' across folders'));
    if (filterLabel) {
      banner.appendChild(document.createTextNode(', tagged '));
      const tagStrong = el('strong');
      tagStrong.textContent = filterLabel;
      banner.appendChild(tagStrong);
    }
    banner.appendChild(document.createTextNode('. Tap a folder name to browse there.'));
    return;
  }
  if (!filterLabel) {
    banner.style.display = 'none';
    banner.replaceChildren();
    return;
  }
  banner.style.display = 'block';
  banner.replaceChildren();
  banner.appendChild(document.createTextNode('Showing all files tagged '));
  const strong = el('strong');
  strong.textContent = filterLabel;
  banner.appendChild(strong);
  banner.appendChild(document.createTextNode('. Tap a folder path to browse there.'));
}

function renderViewTabs() {
  document.getElementById('view-tab-browse').classList.toggle('active', state.view === 'browse');
  document.getElementById('view-tab-sheets').classList.toggle('active', state.view === 'sheets');
}

function setView(view) {
  if (state.view === view && state.page === 1) return;
  state.view = view;
  state.page = 1;
  if (view === 'sheets') {
    state.currentDir = '';
  } else {
    state.tagFilter = 'all';
  }
  pushAppHistory();
  loadFiles();
}

function navigateToFolder(dirPath) {
  state.view = 'browse';
  state.tagFilter = 'all';
  state.currentDir = dirPath;
  state.page = 1;
  pushAppHistory();
  loadFiles();
}

// ── Toast ─────────────────────────────────────────────────────────────────────

const toastEl = document.getElementById('toast');
let toastTimer;
function showToast(msg, type) {
  toastEl.textContent = msg;
  toastEl.className = 'show ' + (type || 'success');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 3000);
}

let confirmResolve = null;

function showConfirm(options = {}) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    document.getElementById('confirm-modal-title').textContent = options.title || 'Confirm';
    document.getElementById('confirm-modal-desc').textContent = options.message || '';
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    confirmBtn.textContent = options.confirmLabel || 'Confirm';
    confirmBtn.className = options.danger ? 'btn-secondary settings-danger-btn' : 'btn';
    document.getElementById('confirm-modal').style.display = 'flex';
    setTimeout(() => confirmBtn.focus(), 50);
  });
}

function closeConfirmModal(result) {
  document.getElementById('confirm-modal').style.display = 'none';
  if (confirmResolve) {
    confirmResolve(!!result);
    confirmResolve = null;
  }
}

function initNewSheetExtSelect() {
  const sel = document.getElementById('new-sheet-ext-select');
  sel.replaceChildren();
  for (const opt of NEW_SHEET_EXTENSIONS) {
    const elOpt = el('option', { value: opt.value });
    elOpt.textContent = opt.label;
    sel.appendChild(elOpt);
  }
}

function newSheetFilename() {
  const raw = document.getElementById('new-sheet-name-input').value.trim();
  const base = raw.replace(/\.(md|txt|pro|cho)$/i, '') || 'untitled';
  return base + document.getElementById('new-sheet-ext-select').value;
}

function openNewSheetModal() {
  const input = document.getElementById('new-sheet-name-input');
  const errEl = document.getElementById('new-sheet-error');
  input.value = 'untitled';
  document.getElementById('new-sheet-ext-select').value = '.md';
  errEl.textContent = '';
  document.getElementById('new-sheet-modal').style.display = 'flex';
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function closeNewSheetModal() {
  document.getElementById('new-sheet-modal').style.display = 'none';
}

async function submitNewSheet() {
  const input = document.getElementById('new-sheet-name-input');
  const errEl = document.getElementById('new-sheet-error');
  const btn = document.getElementById('new-sheet-create-btn');
  const filename = newSheetFilename();
  errEl.textContent = '';
  btn.disabled = true;
  try {
    const r = await fetch('/api/files/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: state.currentDir, filename }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = data.error || 'Create failed';
      return;
    }
    closeNewSheetModal();
    showToast('Created ' + data.name);
    await loadFiles();
    openViewer({ relPath: data.path, name: data.name, tags: [], modified: data.modified }, true);
  } catch {
    errEl.textContent = 'Could not reach server';
  } finally {
    btn.disabled = false;
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

function formatDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

function formatDateFull(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function modifiedCell(iso) {
  const td = el('td', { class: 'col-modified', title: formatDateFull(iso) });
  td.textContent = formatDateShort(iso);
  return td;
}

function renderSortHeaders() {
  document.querySelectorAll('#file-table thead th[data-sort]').forEach((th) => {
    const col = th.dataset.sort;
    th.classList.remove('sort-asc', 'sort-desc');
    th.classList.add('sortable');
    if (state.sort === col) th.classList.add(state.order === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

function onSortColumn(col) {
  if (!VALID_SORTS.includes(col)) return;
  if (state.sort === col) {
    state.order = state.order === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort = col;
    state.order = col === 'name' ? 'asc' : 'desc';
  }
  state.page = 1;
  pushAppHistory();
  loadFiles();
}

document.querySelectorAll('#file-table thead th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => onSortColumn(th.dataset.sort));
});

const listSearchEl = document.getElementById('list-search');
let searchTimer;
listSearchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const val = listSearchEl.value.trim();
    if (val === state.query) return;
    state.query = val;
    state.page = 1;
    pushAppHistory();
    loadFiles();
  }, 300);
});

function renderCategoryToggles() {
  const wrap = document.getElementById('category-toggles');
  const outer = document.getElementById('category-toggles-wrap');
  if (state.tagFilter !== 'all' || !state.excludeTags.length) {
    outer.style.display = 'none';
    wrap.replaceChildren();
    return;
  }
  outer.style.display = 'flex';
  wrap.replaceChildren();
  for (const id of state.excludeTags) {
    const tag = state.tags.find((t) => t.id === id);
    if (!tag) continue;
    const visible = state.showTags.includes(id);
    const c = tagColor(tag.id);
    const btn = el('button', {
      type: 'button',
      class: 'category-toggle' + (visible ? ' active' : ''),
      title: visible ? 'Click to hide ' + tag.name : 'Click to show ' + tag.name,
      style: visible ? { background: c + '18', borderColor: c + '55', color: c } : {},
      onclick: async () => {
        if (visible) state.showTags = state.showTags.filter((x) => x !== id);
        else state.showTags.push(id);
        await saveCategorySettings();
        renderCategoryToggles();
        loadFiles();
      },
    });
    btn.textContent = tag.name;
    wrap.appendChild(btn);
  }
}

function renderExcludeTagsSettings() {
  const wrap = document.getElementById('exclude-tags-settings');
  wrap.replaceChildren();
  if (!state.tags.length) {
    const empty = el('div', { class: 'settings-check-empty' });
    empty.textContent = 'Create tags below to configure hidden categories.';
    wrap.appendChild(empty);
    return;
  }
  for (const t of state.tags) {
    const label = el('label', { class: 'settings-check-row' });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = state.excludeTags.includes(t.id);
    cb.addEventListener('change', async () => {
      if (cb.checked) {
        if (!state.excludeTags.includes(t.id)) state.excludeTags.push(t.id);
      } else {
        state.excludeTags = state.excludeTags.filter((id) => id !== t.id);
        state.showTags = state.showTags.filter((id) => id !== t.id);
      }
      await saveCategorySettings();
      renderCategoryToggles();
      loadFiles();
    });
    const dot = el('span', { class: 'tag-dot', style: { background: tagColor(t.id) } });
    label.appendChild(cb);
    label.appendChild(dot);
    label.appendChild(document.createTextNode(t.name));
    wrap.appendChild(label);
  }
}

// ── Tag pills ─────────────────────────────────────────────────────────────────

function renderTagPills(tags) {
  const wrap = document.getElementById('tag-pills');
  wrap.replaceChildren();
  const defs = [
    { id: 'all',      label: 'All',      color: '#4a9eff' },
    { id: 'untagged', label: 'Untagged', color: '#666'    },
    ...tags.map(t => ({ id: String(t.id), label: t.name, color: tagColor(t.id) })),
  ];
  for (const p of defs) {
    const btn = el('button', {
      class: 'tag-pill' + (state.tagFilter === p.id ? ' active' : ''),
      style: { '--pill-color': p.color },
      onclick: () => {
        if (state.tagFilter === p.id && state.page === 1) return;
        state.tagFilter = p.id;
        state.page = 1;
        if (p.id !== 'all') state.currentDir = '';
        pushAppHistory();
        loadFiles();
      },
    });
    btn.textContent = p.label;
    wrap.appendChild(btn);
  }
}

// ── Pagination ────────────────────────────────────────────────────────────────

function renderPagination(pag, slot) {
  const wrap = document.getElementById('pagination-' + slot);
  wrap.replaceChildren();
  if (pag.totalPages <= 1) return;

  const { page, totalPages } = pag;

  const prevBtn = append(el('button', {
    class: 'page-btn',
    disabled: page <= 1 ? '' : null,
    onclick: page > 1 ? () => { state.page = page - 1; pushAppHistory(); loadFiles(); } : null,
  }), makeIcon('chevL', 14, 'currentColor'), 'Prev');
  wrap.appendChild(prevBtn);

  const pages = buildPageRange(page, totalPages);
  for (const p of pages) {
    if (p === '…') {
      wrap.appendChild(append(el('span', { class: 'page-ellipsis' }), '…'));
    } else {
      const btn = el('button', {
        class: 'page-btn' + (p === page ? ' active' : ''),
        onclick: p !== page ? () => { state.page = p; pushAppHistory(); loadFiles(); } : null,
      });
      btn.textContent = String(p);
      wrap.appendChild(btn);
    }
  }

  const nextBtn = append(el('button', {
    class: 'page-btn',
    disabled: page >= totalPages ? '' : null,
    onclick: page < totalPages ? () => { state.page = page + 1; pushAppHistory(); loadFiles(); } : null,
  }), 'Next', makeIcon('chevR', 14, 'currentColor'));
  wrap.appendChild(nextBtn);
}

function buildPageRange(page, total) {
  if (total <= 7) {
    const r = [];
    for (let i = 1; i <= total; i++) r.push(i);
    return r;
  }
  const r = [1];
  if (page > 3) r.push('…');
  for (let i = Math.max(2, page - 1); i <= Math.min(total - 1, page + 1); i++) r.push(i);
  if (page < total - 2) r.push('…');
  r.push(total);
  return r;
}

// ── Floating tag dropdown ─────────────────────────────────────────────────────

const tagDropdown = document.getElementById('tag-dropdown');
let tagDropdownContext = null;

function renderFileTagsCell(tagTd, f) {
  const wrap = el('div', { class: 'tag-badges-wrap' });
  const tags = f.tags || [];
  for (const tag of tags) {
    const c = tagColor(tag.id);
    const badge = el('span', {
      class: 'tag-badge',
      style: { background: c + '18', borderColor: c + '55', color: c },
      title: tag.name,
      onclick: (e) => { e.stopPropagation(); openTagDropdown(e.currentTarget, f.relPath, tags); },
    });
    badge.textContent = tag.name;
    wrap.appendChild(badge);
  }
  if (tags.length < 2) {
    const addBtn = el('span', {
      class: 'tag-badge-empty',
      title: 'Add tag',
      onclick: (e) => { e.stopPropagation(); openTagDropdown(e.currentTarget, f.relPath, tags); },
    });
    addBtn.textContent = '+ tag';
    wrap.appendChild(addBtn);
  }
  tagTd.appendChild(wrap);
}

function openTagDropdown(anchorEl, relPath, currentTags) {
  closeTagDropdown();
  tagDropdown.replaceChildren();
  tagDropdownContext = { relPath, currentTags: currentTags || [] };

  const currentTagsList = tagDropdownContext.currentTags;
  const currentIds = currentTagsList.map((t) => t.id);

  if (currentIds.length) {
    const clearRow = el('div', {
      class: 'tag-drop-item tag-drop-none',
      onclick: async () => {
        closeTagDropdown();
        await toggleFileTag(relPath, null);
      },
    });
    clearRow.textContent = 'Clear all tags';
    tagDropdown.appendChild(clearRow);
  }

  for (const t of state.tags) {
    const selected = currentIds.includes(t.id);
    const atMax = currentIds.length >= 2 && !selected;
    const row = el('div', {
      class: 'tag-drop-item' + (selected ? ' selected' : '') + (atMax ? ' tag-drop-disabled' : ''),
      onclick: async () => {
        if (atMax) {
          showToast('Maximum 2 tags per file', 'error');
          return;
        }
        closeTagDropdown();
        await toggleFileTag(relPath, t.id);
      },
    });
    const dot = el('span', { class: 'tag-dot', style: { background: tagColor(t.id) } });
    row.appendChild(dot);
    row.appendChild(document.createTextNode(t.name + (selected ? ' ✓' : '')));
    tagDropdown.appendChild(row);
  }

  const createWrap = el('div', { class: 'tag-drop-create' });
  createWrap.addEventListener('click', (e) => e.stopPropagation());
  const createInput = el('input', {
    type: 'text',
    placeholder: 'New tag…',
    maxlength: '32',
    'aria-label': 'New tag name',
  });
  const createBtn = el('button', {
    type: 'button',
    class: 'tag-drop-create-btn',
  });
  createBtn.textContent = 'Create';
  const submitCreate = async () => {
    const name = createInput.value.trim();
    if (!name) return;
    createInput.disabled = true;
    createBtn.disabled = true;
    try {
      await createTagAndMaybeAssign(name, relPath, currentTagsList);
      closeTagDropdown();
    } catch (err) {
      showToast(err.message || 'Failed to create tag', 'error');
      createInput.disabled = false;
      createBtn.disabled = false;
      createInput.focus();
    }
  };
  createBtn.addEventListener('click', submitCreate);
  createInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCreate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeTagDropdown();
    }
  });
  createWrap.appendChild(createInput);
  createWrap.appendChild(createBtn);
  tagDropdown.appendChild(createWrap);

  const rect   = anchorEl.getBoundingClientRect();
  const itemCount = (currentIds.length ? 1 : 0) + state.tags.length + 1;
  const dropH  = itemCount * 36 + 52;
  const below  = window.innerHeight - rect.bottom - 8;
  const top    = below >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
  const left   = Math.min(rect.left, window.innerWidth - 220);
  tagDropdown.style.top     = Math.max(8, top) + 'px';
  tagDropdown.style.left    = Math.max(8, left) + 'px';
  tagDropdown.style.display = 'block';
  setTimeout(() => createInput.focus(), 0);
}

function closeTagDropdown() {
  tagDropdown.style.display = 'none';
  tagDropdownContext = null;
}

document.addEventListener('click', e => {
  if (!tagDropdown.contains(e.target) && !e.target.closest('.tag-badge,.tag-badge-empty,.viewer-tags,.viewer-tag-badge')) {
    closeTagDropdown();
  }
  if (viewerState.volAnchor && !viewerState.volAnchor.contains(e.target)) {
    closeVolumePopover();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('tag-modal').style.display !== 'none') {
      closeSettingsModal();
      return;
    }
    closeTagDropdown();
    if (state.inlineRename) {
      cancelInlineRename();
      return;
    }
    if (isVolumePopoverOpen()) {
      closeVolumePopover();
      return;
    }
    if (!tryCloseViewer()) closeRestartModal();
  }
});

async function toggleFileTag(relPath, tagId) {
  try {
    const r = await fetch('/api/files/tag', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath, tag_id: tagId }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Failed to update tag');
    if (viewerState.relPath === relPath) {
      viewerState.tags = data.tags || [];
      updateViewerTags();
    }
    loadFiles();
  } catch (err) {
    showToast(err.message || 'Failed to update tag', 'error');
  }
}

function splitFilename(name) {
  const dot = name.lastIndexOf('.');
  if (dot > 0) return { base: name.slice(0, dot), ext: name.slice(dot) };
  return { base: name, ext: '' };
}

function inlineRenameFullName(edit) {
  return edit.input.value.trim() + edit.ext;
}

function cancelInlineRename() {
  if (!state.inlineRename) return;
  const { editWrap, nameGroup } = state.inlineRename;
  editWrap.remove();
  nameGroup.style.display = '';
  state.inlineRename = null;
}

async function commitInlineRename() {
  const edit = state.inlineRename;
  if (!edit || edit.committing) return;
  const newBase = edit.input.value.trim();
  if (!newBase) {
    showToast('Name cannot be empty', 'error');
    edit.input.focus();
    return;
  }
  const newName = newBase + edit.ext;
  if (newName === edit.originalName) {
    cancelInlineRename();
    return;
  }
  edit.committing = true;
  edit.input.disabled = true;
  const relPath = edit.originalPath;
  try {
    const r = await fetch('/api/files/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath, newName }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Rename failed');
    cancelInlineRename();
    showToast('Renamed to ' + data.name);
    if (viewerState.relPath === relPath) {
      viewerState.relPath = data.path;
      viewerState.name = data.name;
      if (typeof viewerFilename !== 'undefined') viewerFilename.textContent = data.name;
      if (viewerState.audioEl) {
        viewerState.audioEl.src = '/api/preview?path=' + encodeURIComponent(data.path);
      }
    }
    await loadFiles();
  } catch (err) {
    if (state.inlineRename) {
      state.inlineRename.committing = false;
      state.inlineRename.input.disabled = false;
      state.inlineRename.input.focus();
    }
    showToast(err.message || 'Rename failed', 'error');
  }
}

function startInlineRename(relPath, currentName, context, nameRow, nameGroup) {
  cancelInlineRename();

  const { base, ext } = splitFilename(currentName);
  const editWrap = el('div', {
    class: (context === 'viewer' ? 'viewer-name-edit-wrap ' : '') + 'file-name-edit-wrap' + (ext ? '' : ' file-name-edit-wrap--no-ext'),
  });
  const input = el('input', {
    type: 'text',
    class: context === 'viewer' ? 'viewer-name-input' : 'file-name-input',
    value: base,
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInlineRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineRename();
    }
  });
  input.addEventListener('blur', () => {
    if (!state.inlineRename || state.inlineRename.input !== input) return;
    const newName = inlineRenameFullName(state.inlineRename);
    if (newName && newName !== state.inlineRename.originalName) commitInlineRename();
    else cancelInlineRename();
  });
  editWrap.appendChild(input);
  if (ext) {
    const extSpan = el('span', { class: 'file-name-ext' });
    extSpan.textContent = ext;
    editWrap.appendChild(extSpan);
  }

  nameGroup.style.display = 'none';
  nameRow.insertBefore(editWrap, nameGroup.nextSibling);
  state.inlineRename = {
    originalPath: relPath,
    originalName: currentName,
    ext,
    context,
    input,
    editWrap,
    nameGroup,
    nameRow,
  };
  input.focus();
  input.select();
}

function buildFileNameCell(f) {
  const nameSpan = el('span', { class: 'file-name-cell', title: f.relPath });
  nameSpan.textContent = f.name;
  return nameSpan;
}

// ── File viewer ───────────────────────────────────────────────────────────────

const viewerModal = document.getElementById('viewer-modal');
const viewerBody = document.getElementById('viewer-body');
const viewerLoading = document.getElementById('viewer-loading');
const viewerFilename = document.getElementById('viewer-filename');
const viewerFolder = document.getElementById('viewer-folder');
const viewerEditBtn = document.getElementById('viewer-edit-btn');
const viewerSaveBtn = document.getElementById('viewer-save-btn');
const viewerCancelEditBtn = document.getElementById('viewer-cancel-edit-btn');
const viewerTags = document.getElementById('viewer-tags');
const viewerMeta = document.getElementById('viewer-meta');
const viewerDownloadBtn = document.getElementById('viewer-download-btn');
const viewerNameEditBtn = document.getElementById('viewer-name-edit-btn');
const viewerNameRow = document.getElementById('viewer-name-row');
const viewerNameGroup = document.getElementById('viewer-name-group');
const viewerCloseBtn = document.getElementById('viewer-close-btn');

function closeVolumePopover() {
  if (!viewerState.volAnchor) return;
  const wrap = viewerState.volAnchor.closest('.viewer-audio-wrap');
  wrap?.querySelector('.ap-vol-popover')?.classList.remove('open');
  wrap?.querySelector('.ap-vol-scrim')?.classList.remove('open');
}

function openVolumePopover() {
  if (!viewerState.volAnchor) return;
  const wrap = viewerState.volAnchor.closest('.viewer-audio-wrap');
  wrap?.querySelector('.ap-vol-popover')?.classList.add('open');
  wrap?.querySelector('.ap-vol-scrim')?.classList.add('open');
}

function isVolumePopoverOpen() {
  return !!viewerState.volAnchor?.querySelector('.ap-vol-popover.open');
}

const viewerState = {
  relPath: '',
  name: '',
  modified: '',
  tags: [],
  editable: false,
  editing: false,
  dirty: false,
  savedContent: '',
  audioEl: null,
  volAnchor: null,
};

function setViewerLoading(on) {
  viewerLoading.classList.toggle('show', on);
}

function formatAudioTime(sec, padMinutes) {
  if (!Number.isFinite(sec) || sec < 0) return padMinutes ? '00:00' : '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (padMinutes) return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

const VOLUME_STORAGE_KEY = 'fileshare-volume';

function getStoredVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw == null) return 1;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.min(1, Math.max(0, n / 100));
  } catch {
    return 1;
  }
}

function storeVolume(fraction) {
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(Math.round(fraction * 100)));
  } catch { /* ignore quota */ }
}

function clearViewerBody() {
  const keep = viewerLoading;
  viewerBody.replaceChildren(keep);
  viewerBody.className = 'viewer-body';
  if (viewerState.audioEl) {
    viewerState.audioEl.pause();
    viewerState.audioEl = null;
  }
  if (viewerState.volAnchor) {
    closeVolumePopover();
    viewerState.volAnchor = null;
  }
  viewerBody.classList.remove('has-audio');
  document.getElementById('viewer-panel').classList.remove('has-audio-player');
}

function updateViewerTags() {
  viewerTags.replaceChildren();
  for (const tag of viewerState.tags) {
    const c = tagColor(tag.id);
    const badge = el('button', {
      type: 'button',
      class: 'viewer-tag-badge has-tag',
      style: { background: c + '18', borderColor: c + '55', color: c },
      title: tag.name,
    });
    badge.textContent = tag.name;
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      openTagDropdown(e.currentTarget, viewerState.relPath, viewerState.tags);
    });
    viewerTags.appendChild(badge);
  }
  if (viewerState.tags.length < 2) {
    const addBtn = el('button', { type: 'button', class: 'viewer-tag-badge', title: 'Add tag' });
    addBtn.textContent = '+ tag';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTagDropdown(e.currentTarget, viewerState.relPath, viewerState.tags);
    });
    viewerTags.appendChild(addBtn);
  }
}

function updateViewerMeta() {
  viewerMeta.textContent = viewerState.modified ? formatDateFull(viewerState.modified) : '';
}

function setViewerEditMode(editing) {
  viewerState.editing = editing;
  viewerEditBtn.style.display = (!editing && viewerState.editable) ? '' : 'none';
  viewerSaveBtn.style.display = editing ? '' : 'none';
  viewerCancelEditBtn.style.display = editing ? '' : 'none';
}

function renderViewerText(content, editing, name = viewerState.name) {
  clearViewerBody();
  viewerBody.classList.add('has-text');
  if (editing) {
    const ta = el('textarea', { id: 'viewer-textarea' });
    ta.value = content;
    ta.addEventListener('input', () => {
      viewerState.dirty = ta.value !== viewerState.savedContent;
    });
    viewerBody.appendChild(ta);
    ta.focus();
  } else if (fileExt(name) === 'md' && typeof marked !== 'undefined') {
    const div = el('div', { class: 'viewer-markdown' });
    div.innerHTML = marked.parse(content, { breaks: true, gfm: true });
    viewerBody.appendChild(div);
  } else {
    const pre = el('pre', { class: 'viewer-text-pre' });
    pre.textContent = content;
    viewerBody.appendChild(pre);
  }
}

function renderViewerAudio(relPath) {
  clearViewerBody();
  viewerBody.classList.add('has-audio');
  document.getElementById('viewer-panel').classList.add('has-audio-player');

  const wrap = el('div', { class: 'viewer-audio-wrap' });
  const volScrim = el('div', { class: 'ap-vol-scrim', title: 'Close volume' });
  const audio = el('audio', { preload: 'metadata' });
  audio.src = '/api/preview?path=' + encodeURIComponent(relPath);
  const savedVolume = getStoredVolume();
  audio.volume = savedVolume;
  viewerState.audioEl = audio;

  const player = el('div', { class: 'ap-player' });
  const AUDIO_ICON = '#e8e8e8';

  const seek = el('input', {
    type: 'range',
    class: 'ap-seek',
    min: '0',
    max: '1000',
    value: '0',
    'aria-label': 'Seek',
  });

  const timeCurrent = el('span', { class: 'ap-time-current' });
  timeCurrent.textContent = '00:00';
  const timeRemaining = el('span', { class: 'ap-time-remaining' });
  timeRemaining.textContent = '-00:00';

  const playBtn = el('button', { type: 'button', class: 'ap-play', title: 'Play / pause' });
  playBtn.appendChild(makeFilledIcon('play', 26, AUDIO_ICON));

  const volAnchor = el('div', { class: 'ap-volume' });
  const volBtn = el('button', { type: 'button', class: 'ap-vol-btn', title: 'Volume' });
  const volPopover = el('div', { class: 'ap-vol-popover' });
  const volWrap = el('div', { class: 'ap-vol-wrap' });
  const vol = el('input', {
    type: 'range',
    class: 'ap-vol-slider',
    min: '0',
    max: '100',
    value: String(Math.round(savedVolume * 100)),
    'aria-label': 'Volume',
  });
  volWrap.appendChild(vol);
  volPopover.appendChild(volWrap);
  volAnchor.appendChild(volBtn);
  volAnchor.appendChild(volPopover);

  function syncVolIcon() {
    const muted = audio.muted || audio.volume === 0;
    volBtn.replaceChildren(makeIcon(muted ? 'volumeMute' : 'volume', 18, '#ccc'));
  }

  function syncSeek() {
    if (!audio.duration) {
      timeCurrent.textContent = formatAudioTime(audio.currentTime, true);
      timeRemaining.textContent = '-00:00';
      return;
    }
    seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
    const remaining = Math.max(0, audio.duration - audio.currentTime);
    timeCurrent.textContent = formatAudioTime(audio.currentTime, true);
    timeRemaining.textContent = '-' + formatAudioTime(remaining, true);
  }

  function syncPlayIcon() {
    playBtn.replaceChildren(makeFilledIcon(audio.paused ? 'play' : 'pause', 26, AUDIO_ICON));
  }

  playBtn.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(() => showToast('Could not play audio', 'error'));
    else audio.pause();
  });

  audio.addEventListener('play', syncPlayIcon);
  audio.addEventListener('pause', syncPlayIcon);
  audio.addEventListener('loadedmetadata', syncSeek);
  audio.addEventListener('timeupdate', syncSeek);
  audio.addEventListener('ended', syncSeek);

  seek.addEventListener('input', () => {
    if (!audio.duration) return;
    audio.currentTime = (parseInt(seek.value, 10) / 1000) * audio.duration;
    syncSeek();
  });

  vol.addEventListener('input', () => {
    const level = parseInt(vol.value, 10) / 100;
    audio.volume = level;
    audio.muted = level === 0;
    storeVolume(level);
    syncVolIcon();
  });

  volBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isVolumePopoverOpen()) closeVolumePopover();
    else openVolumePopover();
  });

  volScrim.addEventListener('click', (e) => {
    e.stopPropagation();
    closeVolumePopover();
  });

  volPopover.addEventListener('click', (e) => e.stopPropagation());

  viewerState.volAnchor = volAnchor;

  syncVolIcon();
  syncPlayIcon();
  syncSeek();

  player.appendChild(append(el('div', { class: 'ap-progress' }), seek));
  player.appendChild(append(el('div', { class: 'ap-times' }), timeCurrent, timeRemaining));
  player.appendChild(append(el('div', { class: 'ap-bottom' }), playBtn, volAnchor));

  wrap.appendChild(audio);
  wrap.appendChild(volScrim);
  wrap.appendChild(player);
  viewerBody.appendChild(wrap);
}

function renderViewerFallback(name, type) {
  clearViewerBody();
  const color = TYPE_COLORS[type] || TYPE_COLORS.generic;
  const wrap = el('div', { class: 'viewer-fallback' });
  const iconWrap = append(el('div', { class: 'viewer-fallback-icon' }), makeIcon(type, 48, color));
  const nameEl = el('div', { class: 'viewer-fallback-name' });
  nameEl.textContent = name;
  const hint = el('div', { class: 'viewer-fallback-hint' });
  hint.textContent = 'Preview not available for this file type.';
  wrap.appendChild(iconWrap);
  wrap.appendChild(nameEl);
  wrap.appendChild(hint);
  viewerBody.appendChild(wrap);
}

async function openViewer(fileMeta, startInEdit) {
  cancelInlineRename();
  const relPath = fileMeta.relPath;
  const name = fileMeta.name || relPath.split('/').pop();
  const type = fileType(name);

  viewerState.relPath = relPath;
  viewerState.name = name;
  viewerState.modified = fileMeta.modified || '';
  viewerState.tags = fileMeta.tags || [];
  viewerState.editable = isEditableFile(name);
  viewerState.editing = false;
  viewerState.dirty = false;
  viewerState.savedContent = '';

  viewerFilename.textContent = name;
  const parent = parentDirFromPath(relPath);
  viewerFolder.textContent = parent || 'Home';
  updateViewerTags();
  updateViewerMeta();
  setViewerEditMode(false);
  viewerEditBtn.style.display = viewerState.editable ? '' : 'none';

  clearViewerBody();
  setViewerLoading(true);
  viewerModal.style.display = 'flex';

  try {
    if (type === 'image') {
      clearViewerBody();
      const img = el('img', { id: 'viewer-img', src: '/api/preview?path=' + encodeURIComponent(relPath), alt: name });
      viewerBody.appendChild(img);
    } else if (isPdfFile(name)) {
      clearViewerBody();
      const iframe = el('iframe', { id: 'viewer-pdf', src: '/api/preview?path=' + encodeURIComponent(relPath), title: name });
      viewerBody.appendChild(iframe);
    } else if (type === 'video') {
      clearViewerBody();
      const video = el('video', { id: 'viewer-video', controls: '', src: '/api/preview?path=' + encodeURIComponent(relPath) });
      viewerBody.appendChild(video);
    } else if (type === 'audio') {
      renderViewerAudio(relPath);
    } else if (isTextFile(name)) {
      const r = await fetch('/api/content?path=' + encodeURIComponent(relPath));
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load file');
      }
      const data = await r.json();
      viewerState.savedContent = data.content;
      viewerState.editable = !!data.editable;
      if (data.modified) viewerState.modified = data.modified;
      updateViewerMeta();
      viewerEditBtn.style.display = data.editable ? '' : 'none';
      renderViewerText(data.content, !!startInEdit, name);
      if (startInEdit) setViewerEditMode(true);
    } else {
      renderViewerFallback(name, type);
    }
  } catch (err) {
    renderViewerFallback(name, type);
    showToast(err.message || 'Failed to open file', 'error');
  } finally {
    setViewerLoading(false);
  }
}

async function tryCloseViewer() {
  if (viewerModal.style.display === 'none') return false;
  if (viewerState.editing && viewerState.dirty) {
    const ok = await showConfirm({
      title: 'Discard changes?',
      message: 'You have unsaved edits. Discard them and close the viewer?',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return true;
  }
  closeViewer();
  return true;
}

function closeViewer() {
  cancelInlineRename();
  viewerModal.style.display = 'none';
  clearViewerBody();
  viewerState.relPath = '';
  viewerState.modified = '';
  viewerState.tags = [];
  viewerState.editing = false;
  viewerState.dirty = false;
  updateViewerMeta();
  updateViewerTags();
  setViewerEditMode(false);
}

viewerModal.addEventListener('click', e => { if (e.target === viewerModal) tryCloseViewer(); });
document.getElementById('viewer-panel').addEventListener('click', e => {
  e.stopPropagation();
  if (viewerState.volAnchor && !viewerState.volAnchor.contains(e.target)) {
    closeVolumePopover();
  }
});
viewerCloseBtn.appendChild(makeIcon('close', 14, 'currentColor'));
viewerNameEditBtn.appendChild(makeIcon('rename', 14, 'currentColor'));
viewerDownloadBtn.insertBefore(makeIcon('dl', 14, 'currentColor'), viewerDownloadBtn.firstChild);
viewerCloseBtn.addEventListener('click', () => tryCloseViewer());

viewerNameEditBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!viewerState.relPath) return;
  startInlineRename(viewerState.relPath, viewerState.name, 'viewer', viewerNameRow, viewerNameGroup);
});

viewerDownloadBtn.addEventListener('click', () => {
  if (!viewerState.relPath) return;
  window.location.href = '/api/download?path=' + encodeURIComponent(viewerState.relPath);
});

viewerEditBtn.addEventListener('click', () => {
  renderViewerText(viewerState.savedContent, true, viewerState.name);
  setViewerEditMode(true);
});

viewerCancelEditBtn.addEventListener('click', async () => {
  if (viewerState.dirty) {
    const ok = await showConfirm({
      title: 'Discard changes?',
      message: 'You have unsaved edits. Discard them?',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return;
  }
  renderViewerText(viewerState.savedContent, false, viewerState.name);
  viewerState.dirty = false;
  setViewerEditMode(false);
});

viewerSaveBtn.addEventListener('click', async () => {
  const ta = document.getElementById('viewer-textarea');
  if (!ta || !viewerState.relPath) return;
  viewerSaveBtn.disabled = true;
  try {
    const r = await fetch('/api/files/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: viewerState.relPath, content: ta.value }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Save failed');
    }
    const saved = await r.json().catch(() => ({}));
    if (saved.modified) {
      viewerState.modified = saved.modified;
      updateViewerMeta();
    }
    viewerState.savedContent = ta.value;
    viewerState.dirty = false;
    renderViewerText(ta.value, false, viewerState.name);
    setViewerEditMode(false);
    showToast('Saved ' + viewerState.name);
    loadFiles();
  } catch (err) {
    showToast(err.message || 'Save failed', 'error');
  } finally {
    viewerSaveBtn.disabled = false;
  }
});

function createNewSheet() {
  if (state.listMode === 'flat') {
    showToast('Clear the tag filter to create a sheet in a folder', 'error');
    return;
  }
  openNewSheetModal();
}

document.getElementById('view-tab-browse').addEventListener('click', () => setView('browse'));
document.getElementById('view-tab-sheets').addEventListener('click', () => setView('sheets'));
document.getElementById('new-sheet-btn').addEventListener('click', createNewSheet);

// ── Render table ──────────────────────────────────────────────────────────────

function renderTable(items, flatList) {
  const tbody = document.getElementById('file-list');
  tbody.replaceChildren();

  if (!items.length) {
    const tr = el('tr');
    const td = el('td', { colspan: '7', class: 'empty-state' });
    if (state.query) td.textContent = 'No items match your search.';
    else if (state.listMode === 'sheets') td.textContent = 'No sheets yet. Create one with New sheet, or upload .md or .txt files.';
    else if (flatList) td.textContent = 'No files match this filter.';
    else td.textContent = 'This folder is empty.';
    tbody.appendChild(append(tr, td));
    return;
  }

  for (const item of items) {
    if (item.kind === 'folder') {
      const iconTd = el('td', { class: 'col-icon' });
      iconTd.appendChild(append(el('div', { class: 'file-type-icon' }), makeIcon('folder', 22, TYPE_COLORS.folder)));

      const nameTd = el('td', { class: 'col-name' });
      const nameSpan = el('span', { class: 'file-name-cell', title: item.relPath });
      nameSpan.textContent = item.name;
      nameTd.appendChild(nameSpan);

      const sizeTd = el('td', { class: 'col-size' });
      sizeTd.textContent = formatSize(item.size || 0);
      const modTd = modifiedCell(item.modified);
      const dlCntTd = el('td', { class: 'col-downloads' });
      dlCntTd.textContent = '—';
      const tagTd = el('td', { class: 'col-tag' });
      const actionsTd = el('td', { class: 'col-actions' });

      const row = append(el('tr', { class: 'row-folder' }),
        iconTd, nameTd, sizeTd, modTd, dlCntTd, tagTd, actionsTd);
      row.addEventListener('click', () => {
        if (state.currentDir === item.relPath && state.page === 1) return;
        state.currentDir = item.relPath;
        state.page = 1;
        pushAppHistory();
        loadFiles();
      });
      tbody.appendChild(row);
      continue;
    }

    const f = item;
    const type  = fileType(f.name);
    const color = TYPE_COLORS[type];
    const isImg = type === 'image';
    const openFile = (e) => {
      if (e.target.closest('.action-btn,.tag-badge,.tag-badge-empty,.tag-badges-wrap,a')) return;
      openViewer(f);
    };

    const iconTd = el('td', { class: 'col-icon' });
    if (isImg) {
      const thumb = el('img', {
        class: 'file-thumb',
        src: '/api/preview?path=' + encodeURIComponent(f.relPath),
        alt: f.name,
        title: 'Click to preview',
        loading: 'lazy',
        onclick: (e) => { e.stopPropagation(); openViewer(f); },
      });
      iconTd.appendChild(thumb);
    } else {
      const iconWrap = append(el('div', { class: 'file-type-icon clickable' }), makeIcon(type, 22, color));
      iconWrap.addEventListener('click', (e) => { e.stopPropagation(); openViewer(f); });
      iconTd.appendChild(iconWrap);
    }

    const nameTd = el('td', { class: 'col-name' });
    nameTd.appendChild(buildFileNameCell(f));
    if (flatList && f.dirLabel) {
      const dirLabel = el('span', { class: 'file-dir-label' });
      const link = el('a', {
        href: '#',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigateToFolder(f.dirLabel);
        },
      });
      link.textContent = f.dirLabel;
      dirLabel.appendChild(link);
      nameTd.appendChild(dirLabel);
    }

    const sizeTd = el('td', { class: 'col-size' });
    sizeTd.textContent = formatSize(f.size);

    const modTd = modifiedCell(f.modified);

    const dlCntTd = el('td', { class: 'col-downloads' });
    dlCntTd.textContent = String(f.downloadCount);

    const tagTd = el('td', { class: 'col-tag' });
    renderFileTagsCell(tagTd, f);

    const dlBtn = append(
      el('button', { class: 'action-btn', title: 'Download',
        onclick: (e) => {
          e.stopPropagation();
          window.location.href = '/api/download?path=' + encodeURIComponent(f.relPath);
        } }),
      makeIcon('dl', 15, 'currentColor')
    );
    const delBtn = append(
      el('button', { class: 'action-btn danger', title: 'Delete',
        onclick: async (e) => {
          e.stopPropagation();
          const ok = await showConfirm({
            title: 'Delete file?',
            message: 'Delete "' + f.name + '"? This cannot be undone.',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (!ok) return;
          const r = await fetch('/api/files?path=' + encodeURIComponent(f.relPath), { method: 'DELETE' });
          if (r.ok) { showToast('Deleted ' + f.name); loadFiles(); }
          else showToast('Delete failed', 'error');
        }
      }),
      makeIcon('trash', 15, 'currentColor')
    );
    const actionsTd = append(el('td', { class: 'col-actions' }),
      append(el('div', { class: 'file-actions' }), dlBtn, delBtn)
    );

    const row = append(el('tr', { class: 'row-file' + (flatList ? ' row-file-mobile-meta' : '') }),
      iconTd, nameTd, sizeTd, modTd, dlCntTd, tagTd, actionsTd);
    row.addEventListener('click', openFile);
    tbody.appendChild(row);
  }
}

// ── Load files ────────────────────────────────────────────────────────────────

async function loadFiles() {
  try {
    const params = new URLSearchParams({
      page: String(state.page),
      tag: state.tagFilter,
      dir: state.currentDir,
      sort: state.sort,
      order: state.order,
    });
    if (state.query) params.set('q', state.query);
    if (state.view === 'sheets') params.set('view', 'sheets');
    const res  = await fetch('/api/files?' + params.toString());
    if (res.status === 503) {
      const data = await res.json().catch(() => ({}));
      if (data.needsSetup) {
        const ok = await checkSetup();
        if (ok) return loadFiles();
      }
      return;
    }
    const data = await res.json();
    if (data.shareDir) syncSharePath(data.shareDir);
    state.page = data.pagination.page;
    state.tags = data.tags;
    state.listMode = data.mode || 'browse';
    applyCategorySettings(data.settings);
    if (data.sort) state.sort = data.sort;
    if (data.order) state.order = data.order;

    const flatList = state.listMode === 'flat' || state.listMode === 'sheets';
    listSearchEl.value = state.query;
    renderViewTabs();
    renderSortHeaders();
    renderBreadcrumbs(data.breadcrumbs || [{ name: 'Home', path: '' }], flatList);
    renderListBanner(state.listMode, data.filterLabel);
    document.getElementById('new-sheet-btn').style.display = state.listMode === 'flat' ? 'none' : '';
    renderTagPills(data.tags);
    renderCategoryToggles();
    updateUploadTagSelect(data.tags);
    renderPagination(data.pagination, 'top');
    renderTable(data.items || [], flatList);
    renderPagination(data.pagination, 'bottom');
    replaceAppHistoryIfNeeded();
  } catch {
    const tbody = document.getElementById('file-list');
    tbody.replaceChildren();
    const tr = el('tr');
    const td = el('td', { colspan: '7', class: 'empty-state', style: { color: '#ff7777' } });
    td.textContent = 'Failed to load files';
    tbody.appendChild(append(tr, td));
  }
}

// ── Upload tag select ─────────────────────────────────────────────────────────

function updateUploadTagSelect(tags) {
  const sel = document.getElementById('upload-tag-select');
  const cur = sel.value;
  sel.replaceChildren();
  const none = el('option', { value: '' });
  none.textContent = 'No tag';
  sel.appendChild(none);
  for (const t of tags) {
    const opt = el('option', { value: String(t.id) });
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
  if (cur && tags.find(t => String(t.id) === cur)) sel.value = cur;

  // Inline "create tag" hint when empty
  const wrap = document.getElementById('tag-select-wrap');
  if (!tags.length) {
    if (!document.getElementById('create-tag-inline')) {
      const link = el('a', {
        id: 'create-tag-inline',
        href: '#',
        style: { color: '#4a9eff', fontSize: '0.8rem', textDecoration: 'none' },
        onclick: (e) => { e.preventDefault(); openSettingsModal(); },
      });
      link.textContent = '+ Create a tag';
      wrap.appendChild(link);
    }
  } else {
    const existing = document.getElementById('create-tag-inline');
    if (existing) existing.remove();
  }
}

// ── Settings modal ────────────────────────────────────────────────────────────

function openSettingsModal() {
  renderExcludeTagsSettings();
  renderTagManager();
  updateSettingsShareDir(state.shareDir);
  document.getElementById('change-storage-btn').style.display = state.shareDir ? '' : 'none';
  document.getElementById('tag-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('new-tag-input').focus(), 50);
}
function closeSettingsModal() {
  document.getElementById('tag-modal').style.display = 'none';
}

function openResetStorageModal() {
  const input = document.getElementById('reset-storage-confirm-input');
  const btn = document.getElementById('reset-storage-confirm-btn');
  const errEl = document.getElementById('reset-storage-error');
  input.value = '';
  errEl.textContent = '';
  btn.disabled = true;
  document.getElementById('reset-storage-modal').style.display = 'flex';
  setTimeout(() => input.focus(), 50);
}

function closeResetStorageModal() {
  document.getElementById('reset-storage-modal').style.display = 'none';
}

function updateResetStorageConfirmBtn() {
  const input = document.getElementById('reset-storage-confirm-input');
  const btn = document.getElementById('reset-storage-confirm-btn');
  btn.disabled = input.value.trim().toLowerCase() !== SETUP_RESET_CONFIRM;
}

async function executeResetStorage() {
  const input = document.getElementById('reset-storage-confirm-input');
  const errEl = document.getElementById('reset-storage-error');
  const btn = document.getElementById('reset-storage-confirm-btn');
  const confirm = input.value.trim();
  if (confirm.toLowerCase() !== SETUP_RESET_CONFIRM) {
    errEl.textContent = 'Type fileshare to confirm';
    return;
  }
  errEl.textContent = '';
  btn.disabled = true;
  try {
    const r = await fetch('/api/setup/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = data.error || 'Reset failed';
      updateResetStorageConfirmBtn();
      return;
    }
    closeResetStorageModal();
    closeSettingsModal();
    markShareUnconfigured();
    showSetupModal({ isReset: true });
    const tbody = document.getElementById('file-list');
    tbody.replaceChildren();
    const tr = el('tr');
    const td = el('td', { colspan: '7', class: 'empty-state' });
    td.textContent = 'Choose a storage folder to continue';
    tbody.appendChild(append(tr, td));
    showToast('Choose a new storage folder', 'success');
  } catch {
    errEl.textContent = 'Could not reach server';
    updateResetStorageConfirmBtn();
  }
}

function renderTagManager() {
  const list = document.getElementById('tag-manager-list');
  list.replaceChildren();

  if (!state.tags.length) {
    const empty = el('div', { class: 'tag-manager-empty' });
    empty.textContent = 'No tags yet. Create one below.';
    list.appendChild(empty);
    return;
  }

  for (const t of state.tags) {
    const dot  = el('span', { class: 'tag-dot', style: { background: tagColor(t.id) } });
    const name = document.createTextNode(t.name);
    const cnt  = el('span', { class: 'tag-count' });
    cnt.textContent = t.file_count + ' file' + (t.file_count !== 1 ? 's' : '');

    const nameWrap = append(el('div', { class: 'tag-manager-name' }), dot, name, cnt);
    const delBtn   = append(
      el('button', { class: 'action-btn danger', title: 'Delete tag',
        onclick: () => handleDeleteTag(t) }),
      makeIcon('trash', 14, 'currentColor')
    );
    list.appendChild(append(el('div', { class: 'tag-manager-item' }), nameWrap, delBtn));
  }
}

async function handleDeleteTag(tag) {
  const noun = tag.file_count === 1 ? '1 file will become' : tag.file_count + ' files will become';
  const ok = await showConfirm({
    title: 'Delete tag?',
    message: 'Delete tag "' + tag.name + '"?\n' + noun + ' untagged.',
    confirmLabel: 'Delete tag',
    danger: true,
  });
  if (!ok) return;
  const r = await fetch('/api/tags/' + tag.id, { method: 'DELETE' });
  if (r.ok) {
    showToast('Deleted tag "' + tag.name + '"');
    state.excludeTags = state.excludeTags.filter((id) => id !== tag.id);
    state.showTags = state.showTags.filter((id) => id !== tag.id);
    await saveCategorySettings();
    if (state.tagFilter === String(tag.id)) { state.tagFilter = 'all'; state.page = 1; }
    await loadFiles();
    renderExcludeTagsSettings();
    renderTagManager();
  } else {
    showToast('Failed to delete tag', 'error');
  }
}

async function createTagByName(name) {
  const r = await fetch('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Failed to create tag');
  return data;
}

async function createTagAndMaybeAssign(name, relPath, currentTags) {
  const tag = await createTagByName(name);
  await loadFiles();
  const currentIds = (currentTags || []).map((t) => t.id);
  if (relPath && currentIds.length < 2 && !currentIds.includes(tag.id)) {
    await toggleFileTag(relPath, tag.id);
    showToast('Created and tagged "' + name + '"');
  } else {
    showToast('Created tag "' + name + '"');
  }
}

async function handleCreateTag() {
  const input = document.getElementById('new-tag-input');
  const name  = input.value.trim();
  if (!name) return;
  try {
    await createTagByName(name);
    input.value = '';
    showToast('Created tag "' + name + '"');
    await loadFiles();
    renderExcludeTagsSettings();
    renderTagManager();
  } catch (err) {
    showToast(err.message || 'Failed to create tag', 'error');
  }
}

async function waitForServerBack(maxMs) {
  const start = Date.now();
  const q = new URLSearchParams({ page: '1', tag: 'all', dir: '' });
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch('/api/files?' + q.toString(), { cache: 'no-store' });
      if (r.ok) return true;
    } catch (_) { /* server down */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function openRestartModal() {
  document.getElementById('restart-modal').style.display = 'flex';
}
function closeRestartModal() {
  document.getElementById('restart-modal').style.display = 'none';
}

async function executeRestartServer() {
  closeRestartModal();
  let r;
  try {
    r = await fetch('/api/admin/restart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    showToast('Could not reach server', 'error');
    return;
  }

  let data = {};
  try {
    data = await r.json();
  } catch (_) { /* empty body */ }

  if (!r.ok) {
    showToast(data.error || 'Restart failed', 'error');
    return;
  }

  showToast('Restarting server…', 'success');
  const ok = await waitForServerBack(60000);
  if (ok) {
    showToast('Server is back — reloading page', 'success');
    setTimeout(() => {
      location.reload();
    }, 450);
  } else {
    showToast('Server did not respond — refreshing page', 'error');
    setTimeout(() => location.reload(), 1500);
  }
}

document.getElementById('restart-btn').addEventListener('click', openRestartModal);
document.getElementById('close-restart-modal').addEventListener('click', closeRestartModal);
document.getElementById('restart-cancel-btn').addEventListener('click', closeRestartModal);
document.getElementById('restart-confirm-btn').addEventListener('click', executeRestartServer);
document.getElementById('restart-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('restart-modal')) closeRestartModal();
});
document.getElementById('restart-modal-box').addEventListener('click', (e) => e.stopPropagation());
document.getElementById('gear-btn').addEventListener('click', openSettingsModal);
document.getElementById('close-tag-modal').addEventListener('click', closeSettingsModal);
document.getElementById('tag-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('tag-modal')) closeSettingsModal();
});
document.getElementById('tag-modal-box').addEventListener('click', e => e.stopPropagation());
document.getElementById('create-tag-btn').addEventListener('click', handleCreateTag);
document.getElementById('new-tag-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleCreateTag();
});

// ── Upload ────────────────────────────────────────────────────────────────────

const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const queue     = document.getElementById('queue');
const notice    = document.getElementById('multi-file-notice');

function uploadFiles(files) {
  const tagId = document.getElementById('upload-tag-select').value || null;
  const arr   = Array.from(files);
  notice.style.display = arr.length > 1 ? 'block' : 'none';

  arr.forEach(file => {
    const nameDiv = el('div', { class: 'name' });
    nameDiv.textContent = file.name;
    const fill = el('div', { class: 'progress-fill', style: { width: '0%' } });
    const item = append(el('div', { class: 'queue-item' }), nameDiv, append(el('div', { class: 'progress-bar' }), fill));
    queue.appendChild(item);

    const fd = new FormData();
    fd.append('files', file);
    if (tagId) fd.append('tag_id', tagId);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?dir=' + encodeURIComponent(state.currentDir));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) fill.style.width = Math.round(e.loaded / e.total * 100) + '%';
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        item.classList.add('status-done');
        fill.style.width = '100%';
        let msg = 'Uploaded ' + file.name;
        try {
          const data = JSON.parse(xhr.responseText);
          const norm = (data.normalized || []).find((n) => n.from === file.name);
          if (norm) msg = 'Saved as ' + norm.to;
        } catch (_) { /* ignore */ }
        showToast(msg);
        loadFiles();
        setTimeout(() => { item.remove(); if (!queue.children.length) notice.style.display = 'none'; }, 2500);
      } else {
        item.classList.add('status-error');
        showToast('Upload failed: ' + file.name, 'error');
      }
    };
    xhr.onerror = () => { item.classList.add('status-error'); showToast('Network error', 'error'); };
    xhr.send(fd);
  });
}

browseBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files.length) uploadFiles(fileInput.files); fileInput.value = ''; });
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});

document.getElementById('close-confirm-modal').addEventListener('click', () => closeConfirmModal(false));
document.getElementById('confirm-modal-cancel-btn').addEventListener('click', () => closeConfirmModal(false));
document.getElementById('confirm-modal-confirm-btn').addEventListener('click', () => closeConfirmModal(true));
document.getElementById('confirm-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('confirm-modal')) closeConfirmModal(false);
});
document.getElementById('confirm-modal-box').addEventListener('click', (e) => e.stopPropagation());

document.getElementById('close-new-sheet-modal').addEventListener('click', closeNewSheetModal);
document.getElementById('new-sheet-cancel-btn').addEventListener('click', closeNewSheetModal);
document.getElementById('new-sheet-create-btn').addEventListener('click', submitNewSheet);
document.getElementById('new-sheet-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitNewSheet();
});
document.getElementById('new-sheet-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('new-sheet-modal')) closeNewSheetModal();
});
document.getElementById('new-sheet-modal-box').addEventListener('click', (e) => e.stopPropagation());

document.getElementById('change-storage-btn').addEventListener('click', openResetStorageModal);
document.getElementById('close-reset-storage-modal').addEventListener('click', closeResetStorageModal);
document.getElementById('reset-storage-cancel-btn').addEventListener('click', closeResetStorageModal);
document.getElementById('reset-storage-confirm-btn').addEventListener('click', executeResetStorage);
document.getElementById('reset-storage-confirm-input').addEventListener('input', updateResetStorageConfirmBtn);
document.getElementById('reset-storage-confirm-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !document.getElementById('reset-storage-confirm-btn').disabled) executeResetStorage();
});
document.getElementById('reset-storage-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('reset-storage-modal')) closeResetStorageModal();
});
document.getElementById('reset-storage-modal-box').addEventListener('click', (e) => e.stopPropagation());

document.getElementById('setup-submit-btn').addEventListener('click', submitSetup);
document.getElementById('setup-path-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitSetup();
});
document.getElementById('setup-modal-box').addEventListener('click', (e) => e.stopPropagation());

// ── Init ──────────────────────────────────────────────────────────────────────

readUrlIntoState();
initNewSheetExtSelect();
bootstrapApp();
window.addEventListener('popstate', () => {
  readUrlIntoState();
  loadFiles();
});
setInterval(() => {
  if (viewerModal.style.display !== 'none' && viewerState.editing) return;
  if (state.inlineRename) return;
  loadFiles();
}, 10000);
