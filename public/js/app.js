import { renderChordProHtml } from './chordpro.js';
import {
  el, append, makeIcon, makeFilledIcon, fileType, fileExt, isTextFile, isEditableFile, isPdfFile,
  parentDirFromPath, formatSize, formatDateFull, modifiedCell, tagColor, TYPE_COLORS, NEW_SHEET_EXTENSIONS,
} from './util.js';
import { showToast } from './ui/toast.js';
import {
  state, VALID_SORTS, SETUP_RESET_CONFIRM, EXCLUDE_TAGS_KEY, SHOW_TAGS_KEY,
  loadWorkspaceFromStorage, persistWorkspace,
} from './state.js';
import { applyWorkspaceChrome, initWorkspaceSwitcher, applySongwritingEnabledFromSettings } from './ui/workspace.js';
import { initUpload, uploadFilesForSong, triggerSongAudioUpload } from './ui/upload.js';

// ── State (see state.js) ──────────────────────────────────────────────────────
let settingsMigrated = false;
let setupIsReset = false;
// True when the server reports it is running in Docker. In that case the storage
// location is fixed by the container's bind mount, so the setup dialog cannot save
// a path — it shows the user the exact .env change to make instead.
let setupIsDocker = false;

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
      if (state.appView === 'settings') {
        try {
          const sr = await fetch('/api/settings');
          const settings = await sr.json();
          applyCategorySettings(settings);
          await applySongwritingEnabledFromSettings(settings, { saveSettings: saveCategorySettings });
        } catch { /* ignore */ }
        refreshSettingsPage();
        applyWorkspaceChrome();
        return;
      }
      await loadFiles();
      return;
    }
    setupIsDocker = !!data.docker;
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
  const btn = document.getElementById('setup-submit-btn');
  errEl.textContent = '';
  hideDockerSetupInstructions();
  if (setupIsDocker) {
    // Docker: the path can't be saved here — collect the desired host folder and
    // show the exact .env change. Don't prefill the container path (`suggested`).
    input.value = '';
    titleEl.textContent = 'Storage folder (Docker)';
    descEl.textContent = 'Fileshare is running in Docker, so its storage location is set by the container’s bind mount — not saved here. Type the folder on your machine where you want files kept and I’ll show you exactly what to change.';
    btn.textContent = 'Show setup steps';
  } else {
    input.value = suggested;
    titleEl.textContent = isReset ? 'Choose a new storage folder' : 'Choose storage folder';
    descEl.textContent = isReset
      ? 'Pick the folder Fileshare should use now. Existing files in the previous folder stay on disk but will not appear until you point back at that path.'
      : 'Pick a folder on this machine where uploaded files will be stored. This is saved in the database and only needs to be set once.';
    btn.textContent = 'Continue';
  }
  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 50);
}

function hideDockerSetupInstructions() {
  const box = document.getElementById('setup-docker-instructions');
  if (box) { box.replaceChildren(); box.style.display = 'none'; }
}

// Build (at runtime, from the path the user typed) the exact .env lines + command
// needed to relocate storage in Docker. No host path is ever hard-coded in source.
function renderDockerSetupInstructions(hostPath) {
  const box = document.getElementById('setup-docker-instructions');
  if (!box) return;
  const mountSource = hostPath.replace(/\\/g, '/'); // compose bind mounts use forward slashes
  const envLines = `SHARE_HOST_DIR=${mountSource}\nDISPLAY_SHARE_DIR=${hostPath}`;

  const intro = el('p', { class: 'modal-desc', style: { marginTop: '4px' } });
  append(intro, `To store files at ${hostPath}, add these two lines to your `, append(el('code'), '.env'),
    ' file (next to docker-compose.yml):');

  const pre = append(el('pre', { style: {
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '10px 0', padding: '10px 12px',
    borderRadius: '6px', background: 'rgba(255,255,255,0.06)', fontFamily: 'monospace',
    fontSize: '13px', userSelect: 'all',
  } }), envLines);

  const copyBtn = el('button', { type: 'button', class: 'btn-secondary btn-sm', onclick: () => {
    navigator.clipboard?.writeText(envLines).then(
      () => showToast('Copied .env lines', 'success'),
      () => showToast('Copy failed', 'error'),
    );
  } });
  append(copyBtn, 'Copy .env lines');

  const cmd = el('p', { class: 'modal-desc', style: { marginTop: '10px' } });
  append(cmd, 'Then apply it with ', append(el('code'), 'docker compose up -d'), '.');

  box.replaceChildren();
  append(box, intro, pre, copyBtn, cmd);
  box.style.display = 'block';
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
      setupIsDocker = !!data.docker;
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
  if (setupIsDocker) {
    // Can't save a host path into the container — show the user what to change instead.
    renderDockerSetupInstructions(shareDir);
    return;
  }
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

async function saveCategorySettings(patch = {}) {
  try {
    const r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        excludeTags: state.excludeTags,
        showTags: state.showTags,
        songwritingEnabled: state.songwritingEnabled,
        ...patch,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Failed to save settings');
    applyCategorySettings(data);
    await applySongwritingEnabledFromSettings(data, { saveSettings: saveCategorySettings });
    applyWorkspaceChrome();
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
    appView: state.appView,
    workspace: state.workspace,
    songDetailId: state.songDetailId,
    songLayout: state.songLayout,
    studioAssetPath: state.studioAssetPath,
    page: state.page,
    query: state.query,
    sort: state.sort,
    order: state.order,
    ...partial,
  };
  const q = new URLSearchParams();
  if (s.appView === 'settings') {
    q.set('view', 'settings');
    const qs = q.toString();
    return location.pathname + (qs ? '?' + qs : '');
  }
  if (s.workspace === 'songwriting') q.set('workspace', 'songwriting');
  if (s.currentDir) q.set('dir', s.currentDir);
  if (s.tagFilter !== 'all') q.set('tag', String(s.tagFilter));
  if (s.view === 'documents') q.set('view', 'documents');
  if (s.songDetailId) {
    q.set('view', 'songs');
    q.set('song', String(s.songDetailId));
    if (s.studioAssetPath) q.set('asset', s.studioAssetPath);
  } else if (s.view === 'songs') {
    q.set('view', 'songs');
  }
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
  const viewParam = q.get('view');
  if (viewParam === 'settings') {
    state.appView = 'settings';
    return;
  }
  state.appView = 'main';
  state.view = (viewParam === 'documents' || viewParam === 'sheets') ? 'documents'
    : viewParam === 'songs' ? 'songs' : 'browse';
  const songId = parseInt(q.get('song'), 10);
  state.songDetailId = Number.isFinite(songId) && songId > 0 ? songId : null;
  if (state.songDetailId) state.view = 'songs';
  state.songLayout = 'studio';
  state.studioAssetPath = q.get('asset') || '';
  const pg = parseInt(q.get('page'), 10);
  state.page = Number.isFinite(pg) && pg >= 1 ? pg : 1;
  state.query = q.get('q') || '';
  const sort = q.get('sort');
  state.sort = VALID_SORTS.includes(sort) ? sort : 'modified';
  state.order = q.get('order') === 'asc' ? 'asc' : 'desc';
  const ws = q.get('workspace');
  if (ws === 'songwriting' || ws === 'files') state.workspace = ws;
  else if (!location.search) state.workspace = loadWorkspaceFromStorage();
  if (state.workspace === 'songwriting' && !state.songDetailId && state.view !== 'songs') {
    state.view = 'songs';
  }
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

function openSongAddSheet() {
  const sheet = document.getElementById('songwriting-add-sheet');
  if (sheet) sheet.style.display = 'flex';
}

function closeSongAddSheet() {
  const sheet = document.getElementById('songwriting-add-sheet');
  if (sheet) sheet.style.display = 'none';
}

async function goBackToSongsList() {
  if (!(await confirmStudioUnsaved())) return;
  state.songDetailId = null;
  state.songLayout = 'studio';
  state.studioAssetPath = '';
  state.query = '';
  listSearchEl.value = '';
  studioState.editing = false;
  studioState.dirty = false;
  updateListSearchPlaceholder();
  pushAppHistory();
  loadFiles();
}

function renderSongContextHeader(song) {
  const banner = document.getElementById('flat-filter-banner');
  banner.style.display = 'block';
  banner.replaceChildren();

  const row = el('div', { class: 'song-context-row' });
  const crumbs = el('nav', { class: 'song-breadcrumb', 'aria-label': 'Song navigation' });

  const songsLink = el('a', { href: '#', class: 'song-breadcrumb-link' });
  songsLink.textContent = 'Songs';
  songsLink.addEventListener('click', async (e) => {
    e.preventDefault();
    await goBackToSongsList();
  });
  crumbs.appendChild(songsLink);

  if (song) {
    crumbs.appendChild(append(el('span', { class: 'song-breadcrumb-sep' }), '/'));
    const title = append(el('span', { class: 'song-breadcrumb-current' }), song.name);
    crumbs.appendChild(title);
    const renameBtn = el('button', {
      type: 'button',
      class: 'song-banner-btn',
      title: 'Rename song',
      'aria-label': 'Rename song',
    });
    renameBtn.appendChild(makeIcon('rename', 14, 'currentColor'));
    renameBtn.addEventListener('click', () => renameSongGroup(song.id, song.name));
    crumbs.appendChild(renameBtn);
  }

  row.appendChild(crumbs);

  const actions = el('div', { class: 'song-context-actions' });
  if (song) {
    const addBtn = el('button', { type: 'button', class: 'btn btn-sm' });
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => openSongAddSheet());
    actions.appendChild(addBtn);
  } else {
    const newBtn = el('button', { type: 'button', class: 'btn btn-sm' });
    newBtn.textContent = '+ New song';
    newBtn.addEventListener('click', async () => {
      const created = await createNewSongGroup();
      if (created) {
        state.songDetailId = created.id;
        await loadFiles();
      }
    });
    actions.appendChild(newBtn);
  }
  row.appendChild(actions);
  banner.appendChild(row);

  if (song) {
    const meta = el('div', { class: 'song-context-meta' });
    meta.appendChild(renderSongTagsRow(song));
    meta.appendChild(renderSongNotesRow(song));
    banner.appendChild(meta);
  }
}

function renderListBanner(listMode, filterLabel) {
  const banner = document.getElementById('flat-filter-banner');
  if (listMode === 'songs' && state.workspace === 'songwriting' && !state.songDetailId) {
    renderSongContextHeader(null);
    return;
  }
  if (listMode === 'songs') {
    banner.style.display = 'block';
    banner.replaceChildren(document.createTextNode('Song groups — click a song to view its assets'));
    return;
  }
  if (listMode === 'documents') {
    banner.style.display = 'block';
    banner.replaceChildren();
    banner.appendChild(document.createTextNode('All documents '));
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
  document.getElementById('view-tab-sheets').classList.toggle('active', state.view === 'documents');
  const songsTab = document.getElementById('view-tab-songs');
  if (songsTab) songsTab.classList.toggle('active', state.view === 'songs');
}

async function setView(view) {
  if (state.workspace === 'songwriting' && view !== 'songs') return;
  if (state.view === view && state.page === 1 && !state.songDetailId) return;
  if (!(await confirmStudioUnsaved())) return;
  state.appView = 'main';
  state.view = view;
  state.page = 1;
  state.songDetailId = null;
  state.songLayout = 'studio';
  state.studioAssetPath = '';
  if (view === 'documents' || view === 'songs') {
    state.currentDir = '';
    state.tagFilter = 'all';
  } else {
    state.tagFilter = 'all';
  }
  pushAppHistory();
  applyWorkspaceChrome();
  loadFiles();
}

async function setWorkspace(workspace) {
  if (workspace === 'songwriting' && !state.songwritingEnabled) return;
  if (state.workspace === workspace && state.appView === 'main') return;
  if (!(await confirmStudioUnsaved())) return;
  state.appView = 'main';
  state.workspace = workspace;
  persistWorkspace(workspace);
  if (workspace === 'songwriting') {
    state.view = 'songs';
    state.tagFilter = 'all';
    state.currentDir = '';
    state.page = 1;
  } else {
    state.view = 'browse';
    state.songDetailId = null;
    state.studioAssetPath = '';
    state.songLayout = 'studio';
    state.page = 1;
  }
  pushAppHistory();
  applyWorkspaceChrome();
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

let choiceResolve = null;

function showChoice(options = {}) {
  return new Promise((resolve) => {
    choiceResolve = resolve;
    document.getElementById('choice-modal-title').textContent = options.title || 'Choose';
    document.getElementById('choice-modal-desc').textContent = options.message || '';
    const footer = document.getElementById('choice-modal-actions');
    footer.replaceChildren();

    const cancelBtn = el('button', { type: 'button', class: 'btn-secondary' });
    cancelBtn.textContent = options.cancelLabel || 'Cancel';
    cancelBtn.addEventListener('click', () => closeChoiceModal(null));
    footer.appendChild(cancelBtn);

    for (const action of options.actions || []) {
      const btn = el('button', {
        type: 'button',
        class: action.danger ? 'btn-secondary settings-danger-btn' : 'btn',
        'data-choice-value': action.value,
      });
      btn.textContent = action.label;
      btn.addEventListener('click', () => closeChoiceModal(action.value));
      footer.appendChild(btn);
    }

    document.getElementById('choice-modal').style.display = 'flex';
    let focusBtn = options.focusValue
      ? footer.querySelector('[data-choice-value="' + options.focusValue + '"]')
      : null;
    if (!focusBtn) focusBtn = footer.querySelector('.btn:not(.btn-secondary)') || footer.lastElementChild;
    if (focusBtn) setTimeout(() => focusBtn.focus(), 50);
  });
}

function closeChoiceModal(result) {
  document.getElementById('choice-modal').style.display = 'none';
  if (choiceResolve) {
    choiceResolve(result ?? null);
    choiceResolve = null;
  }
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

const fileTableHeadRow = document.querySelector('#file-table thead tr');
const defaultTableHeadHtml = fileTableHeadRow.innerHTML;

function restoreTableHeaders() {
  fileTableHeadRow.innerHTML = defaultTableHeadHtml;
  renderSortHeaders();
}

function setSongTableHeaders() {
  fileTableHeadRow.replaceChildren(
    append(el('th', { class: 'col-drag', title: 'Drag to reorder' }), '⠿'),
    el('th', { class: 'col-icon' }),
    append(el('th', { class: 'col-role' }), 'Type'),
    append(el('th', { class: 'col-name' }), 'File'),
    append(el('th', { class: 'col-size' }), 'Size'),
    append(el('th', { class: 'col-modified' }), 'Modified'),
    el('th', { class: 'col-actions' }),
  );
}

const SONG_TYPE_PRESETS = [
  'Demo 1', 'Demo 2', 'Rough mix', 'Final mix', 'Stems', 'Playthrough',
  'Lyrics', 'Lyrics revised', 'Chord chart', 'Video', 'Video playthrough', 'Reference',
];

const TRACK_LABEL_PRESETS = [
  'Best version', 'Reference', 'Rough', 'Final', 'Alternate', 'Scratch', 'Keep',
];

const SONG_ASSET_GROUPS = [
  { id: 'audio', label: 'Audio' },
  { id: 'lyrics', label: 'Lyrics & charts' },
  { id: 'video', label: 'Video' },
  { id: 'other', label: 'Other' },
];

function classifySongAsset(asset) {
  const type = fileType(asset.name);
  const r = (asset.role || '').toLowerCase();
  if (type === 'audio' || /\b(demo|mix|stem|playthrough|rough|final|audio)\b/.test(r)) return 'audio';
  if (type === 'video' || /\bvideo\b/.test(r)) return 'video';
  const ext = fileExt(asset.name);
  if (['md', 'txt', 'pro', 'cho'].includes(ext) || /\b(lyric|chord|chart)\b/.test(r)) return 'lyrics';
  return 'other';
}

function groupSongAssets(assets) {
  const buckets = Object.fromEntries(SONG_ASSET_GROUPS.map((g) => [g.id, []]));
  for (const a of assets) {
    buckets[classifySongAsset(a)].push(a);
  }
  return SONG_ASSET_GROUPS.filter((g) => buckets[g.id].length).map((g) => ({
    ...g,
    items: buckets[g.id],
  }));
}

const listSearchEl = document.getElementById('list-search');
const LIST_SEARCH_DEFAULT = 'Search name…';
const LIST_SEARCH_SONG_DETAIL = 'Filter assets…';

function updateListSearchPlaceholder() {
  listSearchEl.placeholder = state.songDetailId ? LIST_SEARCH_SONG_DETAIL : LIST_SEARCH_DEFAULT;
}

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
const songTypeDropdown = document.getElementById('song-type-dropdown');
let tagDropdownContext = null;

function renderFileTagsCell(tagTd, f) {
  const isFolder = f.kind === 'folder';
  const wrap = el('div', { class: 'tag-badges-wrap' });
  const tags = f.tags || [];
  for (const tag of tags) {
    const c = tagColor(tag.id);
    const badge = el('span', {
      class: 'tag-badge',
      style: { background: c + '18', borderColor: c + '55', color: c },
      title: tag.name,
      onclick: (e) => { e.stopPropagation(); openTagDropdown(e.currentTarget, f.relPath, tags, isFolder); },
    });
    badge.textContent = tag.name;
    wrap.appendChild(badge);
  }
  if (tags.length < 2) {
    const addBtn = el('span', {
      class: 'tag-badge-empty',
      title: 'Add tag',
      onclick: (e) => { e.stopPropagation(); openTagDropdown(e.currentTarget, f.relPath, tags, isFolder); },
    });
    addBtn.textContent = '+ tag';
    wrap.appendChild(addBtn);
  }
  tagTd.appendChild(wrap);
}

function openTagDropdown(anchorEl, relPath, currentTags, isFolder) {
  void openTagDropdownAsync(anchorEl, relPath, currentTags, isFolder);
}

async function openTagDropdownAsync(anchorEl, relPath, currentTags, isFolder) {
  closeTagDropdown();
  await loadTags();
  tagDropdown.replaceChildren();
  tagDropdownContext = { relPath, currentTags: currentTags || [], isFolder: !!isFolder };

  const currentTagsList = tagDropdownContext.currentTags;
  const currentIds = currentTagsList.map((t) => t.id);

  if (currentIds.length) {
    const clearRow = el('div', {
      class: 'tag-drop-item tag-drop-none',
      onclick: async () => {
        closeTagDropdown();
        await toggleFileTag(relPath, null, tagDropdownContext?.isFolder);
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
          showToast('Maximum 2 tags per ' + (tagDropdownContext?.isFolder ? 'folder' : 'file'), 'error');
          return;
        }
        closeTagDropdown();
        await toggleFileTag(relPath, t.id, tagDropdownContext?.isFolder);
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

function positionFloatingNearAnchor(dropdown, anchorEl, scrollEl) {
  if (dropdown.parentElement !== document.body) document.body.appendChild(dropdown);

  const margin = 8;
  dropdown.style.visibility = 'hidden';
  dropdown.style.display = 'block';
  dropdown.style.maxHeight = '';
  if (scrollEl) scrollEl.style.maxHeight = '';

  const anchor = anchorEl.getBoundingClientRect();
  const dropW = dropdown.offsetWidth;
  const fullH = dropdown.offsetHeight;

  let top = anchor.bottom + 4;
  let maxH = fullH;
  const spaceBelow = window.innerHeight - margin - top;

  if (fullH > spaceBelow) {
    const topAbove = anchor.top - fullH - 4;
    const spaceAbove = anchor.top - margin - 4;
    if (topAbove >= margin && fullH <= spaceAbove) {
      top = topAbove;
    } else {
      top = anchor.bottom + 4;
      maxH = Math.max(120, spaceBelow);
    }
  }

  if (scrollEl && maxH < fullH) {
    const filterEl = dropdown.querySelector('.song-type-filter');
    const filterH = filterEl ? filterEl.offsetHeight + 8 : 44;
    scrollEl.style.maxHeight = Math.max(80, maxH - filterH) + 'px';
    dropdown.style.maxHeight = maxH + 'px';
  }

  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - dropW - margin));
  dropdown.style.top = top + 'px';
  dropdown.style.left = left + 'px';
  dropdown.style.visibility = '';
}

document.addEventListener('click', e => {
  if (!tagDropdown.contains(e.target) && !e.target.closest('.tag-badge,.tag-badge-empty,.viewer-tags,.viewer-tag-badge')) {
    closeTagDropdown();
  }
  if (!songTypeDropdown.contains(e.target) && !e.target.closest('.song-asset-role')) {
    closeSongTypeDropdown();
  }
  if (viewerState.volAnchor && !viewerState.volAnchor.contains(e.target)) {
    closeVolumePopover();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (songTypeDropdown.style.display !== 'none') {
      closeSongTypeDropdown();
      return;
    }
    if (state.appView === 'settings') {
      leaveSettings();
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

async function toggleFileTag(relPath, tagId, isFolder) {
  try {
    const url = isFolder ? '/api/folders/tag' : '/api/files/tag';
    const r = await fetch(url, {
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

async function toggleSongTag(songId, tagId) {
  try {
    const r = await fetch('/api/songs/tag', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_id: songId, tag_id: tagId }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Failed to update tag');
    if (state.songDetailId === songId) {
      if (studioState.song) studioState.song.tags = data.tags || [];
      const oldTags = document.querySelector('#flat-filter-banner .song-banner-tags');
      if (oldTags) {
        oldTags.replaceWith(renderSongTagsRow({ id: songId, tags: data.tags || [] }));
      }
    } else {
      await loadFiles();
    }
  } catch (err) {
    showToast(err.message || 'Failed to update tag', 'error');
  }
}

function openSongTagDropdown(anchorEl, songId, currentTags) {
  void openSongTagDropdownAsync(anchorEl, songId, currentTags);
}

async function openSongTagDropdownAsync(anchorEl, songId, currentTags) {
  closeTagDropdown();
  await loadTags();
  tagDropdown.replaceChildren();
  tagDropdownContext = { kind: 'song', songId, currentTags: currentTags || [] };

  const currentTagsList = tagDropdownContext.currentTags;
  const currentIds = currentTagsList.map((t) => t.id);

  const filterTagRows = (query) => {
    const q = query.trim().toLowerCase();
    tagDropdown.querySelectorAll('.tag-drop-item.tag-drop-tag').forEach((row) => {
      const text = row.dataset.tagName || '';
      row.style.display = !q || text.includes(q) ? '' : 'none';
    });
  };

  if (currentIds.length) {
    const clearRow = el('div', {
      class: 'tag-drop-item tag-drop-none',
      onclick: async () => {
        closeTagDropdown();
        await toggleSongTag(songId, null);
      },
    });
    clearRow.textContent = 'Clear all tags';
    tagDropdown.appendChild(clearRow);
  }

  for (const t of state.tags) {
    const selected = currentIds.includes(t.id);
    const atMax = currentIds.length >= 2 && !selected;
    const row = el('div', {
      class: 'tag-drop-item tag-drop-tag' + (selected ? ' selected' : '') + (atMax ? ' tag-drop-disabled' : ''),
      'data-tag-name': t.name.toLowerCase(),
      onclick: async () => {
        if (atMax) {
          showToast('Maximum 2 tags per song', 'error');
          return;
        }
        closeTagDropdown();
        await toggleSongTag(songId, t.id);
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
    placeholder: 'Search or create tag…',
    maxlength: '32',
    'aria-label': 'Search or create tag',
  });
  const createBtn = el('button', { type: 'button', class: 'tag-drop-create-btn' });
  createBtn.textContent = 'Create';
  const submitCreate = async () => {
    const name = createInput.value.trim();
    if (!name) return;
    createInput.disabled = true;
    createBtn.disabled = true;
    try {
      const existing = state.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      const tag = existing || await createTagByName(name);
      if (state.songDetailId === songId) {
        if (!state.tags.some((t) => t.id === tag.id)) {
          state.tags = [...state.tags, tag].sort((a, b) => a.name.localeCompare(b.name));
        }
        if (currentIds.length < 2 && !currentIds.includes(tag.id)) {
          await toggleSongTag(songId, tag.id);
          showToast(existing ? 'Tagged "' + name + '"' : 'Created and tagged "' + name + '"');
        } else {
          showToast(existing ? 'Tag "' + name + '" already exists' : 'Created tag "' + name + '"');
        }
      } else {
        await loadTags();
        if (currentIds.length < 2 && !currentIds.includes(tag.id)) {
          await toggleSongTag(songId, tag.id);
          showToast(existing ? 'Tagged "' + name + '"' : 'Created and tagged "' + name + '"');
        } else {
          showToast(existing ? 'Tag "' + name + '" already exists' : 'Created tag "' + name + '"');
        }
      }
      closeTagDropdown();
    } catch (err) {
      showToast(err.message || 'Failed to create tag', 'error');
      createInput.disabled = false;
      createBtn.disabled = false;
      createInput.focus();
    }
  };
  createBtn.addEventListener('click', submitCreate);
  createInput.addEventListener('input', () => filterTagRows(createInput.value));
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

  const rect = anchorEl.getBoundingClientRect();
  const itemCount = (currentIds.length ? 1 : 0) + state.tags.length + 1;
  const dropH = itemCount * 36 + 52;
  const below = window.innerHeight - rect.bottom - 8;
  const top = below >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
  const left = Math.min(rect.left, window.innerWidth - 220);
  tagDropdown.style.top = Math.max(8, top) + 'px';
  tagDropdown.style.left = Math.max(8, left) + 'px';
  tagDropdown.style.display = 'block';
  setTimeout(() => createInput.focus(), 0);
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
  } else if ((fileExt(name) === 'pro' || fileExt(name) === 'cho') && !editing) {
    const div = el('div', { class: 'viewer-chordpro' });
    div.innerHTML = renderChordProHtml(content);
    viewerBody.appendChild(div);
  } else if (fileExt(name) === 'md' && typeof marked !== 'undefined' && !editing) {
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
    afterOpenViewer();
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

document.getElementById('view-tab-browse').addEventListener('click', () => setView('browse'));
document.getElementById('view-tab-sheets')?.addEventListener('click', () => setView('documents'));
document.getElementById('view-tab-songs')?.addEventListener('click', () => setView('songs'));
document.getElementById('new-sheet-btn').addEventListener('click', createNewSheetViaModal);

// ── Render table ──────────────────────────────────────────────────────────────

function renderTable(items, flatList) {
  const tbody = document.getElementById('file-list');
  tbody.replaceChildren();

  if (!items.length) {
    const tr = el('tr');
    const td = el('td', { colspan: '7', class: 'empty-state' });
    if (state.songDetailId && state.query) td.textContent = 'No assets match your search.';
    else if (state.query) td.textContent = 'No items match your search.';
    else if (state.listMode === 'songs') td.textContent = 'No songs yet. Create one with + New song or add files from Browse.';
    else if (state.listMode === 'documents') td.textContent = 'No documents yet. Create one with New document, or upload .md, .txt, .pro, or .cho files.';
    else if (flatList) td.textContent = 'No files match this filter.';
    else td.textContent = 'This folder is empty.';
    tbody.appendChild(append(tr, td));
    return;
  }

  for (const item of items) {
    if (item.kind === 'song') {
      const iconTd = el('td', { class: 'col-icon' });
      iconTd.appendChild(append(el('div', { class: 'file-type-icon' }), makeIcon('audio', 22, '#b04aff')));
      const nameTd = el('td', { class: 'col-name' });
      const nameSpan = el('span', { class: 'file-name-cell' });
      nameSpan.textContent = item.name;
      nameTd.appendChild(nameSpan);
      const cnt = el('span', { class: 'song-asset-count' });
      cnt.textContent = (item.assetCount || 0) + ' asset' + ((item.assetCount || 0) !== 1 ? 's' : '');
      nameTd.appendChild(cnt);
      const renameBtn = append(
        el('button', { class: 'action-btn', title: 'Rename',
          onclick: (e) => { e.stopPropagation(); renameSongGroup(item.id, item.name); } }),
        makeIcon('rename', 15, 'currentColor')
      );
      const actionsTd = append(el('td', { class: 'col-actions' }),
        append(el('div', { class: 'file-actions' }), renameBtn));
      const tagTd = el('td', { class: 'col-tag' });
      tagTd.appendChild(renderSongTagsRow({ id: item.id, tags: item.tags || [] }));
      const row = append(el('tr', { class: 'row-song' }),
        iconTd, nameTd,
        append(el('td', { class: 'col-size' }), '—'),
        modifiedCell(item.modified),
        append(el('td', { class: 'col-downloads' }), '—'),
        tagTd,
        actionsTd);
      row.addEventListener('click', () => openSongAssets(item.id, { pushHistory: true }));
      tbody.appendChild(row);
      continue;
    }
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
      renderFileTagsCell(tagTd, { relPath: item.relPath, tags: item.tags || [], kind: 'folder' });
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
            title: 'Delete from library?',
            message: 'Permanently delete "' + f.name + '" from disk? This cannot be undone.',
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
  if (state.appView === 'settings') {
    applyWorkspaceChrome();
    return;
  }
  try {
    const params = new URLSearchParams({
      page: String(state.page),
      tag: state.tagFilter,
      dir: state.currentDir,
      sort: state.sort,
      order: state.order,
    });
    if (state.query) params.set('q', state.query);
    if (state.view === 'documents') params.set('view', 'documents');
    if (state.view === 'songs') params.set('view', 'songs');
    if (state.songDetailId) {
      await loadTags();
      await openSongAssets(state.songDetailId);
      return;
    }
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
    await applySongwritingEnabledFromSettings(data.settings, { saveSettings: saveCategorySettings });
    if (data.sort) state.sort = data.sort;
    if (data.order) state.order = data.order;

    const flatList = state.listMode === 'flat' || state.listMode === 'documents' || state.listMode === 'songs';
    listSearchEl.value = state.query;
    renderViewTabs();
    renderSortHeaders();
    renderBreadcrumbs(data.breadcrumbs || [{ name: 'Home', path: '' }], flatList);
    renderListBanner(state.listMode, data.filterLabel);
    document.getElementById('new-sheet-btn').style.display = (state.listMode === 'flat' || state.listMode === 'songs') ? 'none' : '';
    let newSongBtn = document.getElementById('new-song-btn');
    if (!newSongBtn) {
      newSongBtn = el('button', { type: 'button', id: 'new-song-btn', class: 'btn-secondary btn-sm' });
      newSongBtn.textContent = '+ New song';
      newSongBtn.addEventListener('click', async () => {
        const song = await createNewSongGroup();
        if (song) { state.songDetailId = song.id; await loadFiles(); }
      });
      document.querySelector('.files-header-actions')?.prepend(newSongBtn);
    }
    newSongBtn.style.display = state.listMode === 'songs' && !state.songDetailId ? '' : 'none';
    if (!state.songDetailId) {
      restoreTableHeaders();
    }
    applyWorkspaceChrome();
    updateListSearchPlaceholder();
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

// ── Settings page ─────────────────────────────────────────────────────────────

function refreshSettingsPage() {
  renderExcludeTagsSettings();
  renderTagManager();
  updateSettingsShareDir(state.shareDir);
  const changeBtn = document.getElementById('change-storage-btn');
  if (changeBtn) changeBtn.style.display = state.shareDir ? '' : 'none';
  const cb = document.getElementById('songwriting-enabled-cb');
  if (cb) cb.checked = state.songwritingEnabled;
}

async function goToSettings() {
  if (!(await confirmStudioUnsaved())) return;
  state.appView = 'settings';
  refreshSettingsPage();
  applyWorkspaceChrome();
  pushAppHistory();
}

function leaveSettings() {
  if (history.length > 1) {
    history.back();
    return;
  }
  state.appView = 'main';
  applyWorkspaceChrome();
  loadFiles();
}

function openSettingsModal() {
  goToSettings();
}
function closeSettingsModal() {
  leaveSettings();
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

async function loadTags() {
  try {
    const r = await fetch('/api/tags');
    if (r.ok) state.tags = await r.json();
  } catch { /* ignore */ }
}

async function createTagByName(name) {
  const trimmed = name.trim();
  const r = await fetch('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: trimmed }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok) return data;
  if (r.status === 409) {
    await loadTags();
    const existing = state.tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
  }
  throw new Error(data.error || 'Failed to create tag');
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
  let sawDown = false;
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch('/api/setup', { cache: 'no-store' });
      if (r.ok) {
        if (sawDown) return true;
      } else {
        sawDown = true;
      }
    } catch {
      sawDown = true;
    }
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
  } catch { /* empty body */ }

  if (!r.ok) {
    showToast(data.error || 'Restart failed', 'error');
    return;
  }

  if (data.restarting === false) {
    showToast(data.message || 'Restart is not available', 'error');
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
document.getElementById('songwriting-enabled-cb')?.addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  state.songwritingEnabled = enabled;
  if (!enabled && state.workspace === 'songwriting') {
    await setWorkspace('files');
  }
  await saveCategorySettings({ songwritingEnabled: enabled });
});
document.getElementById('create-tag-btn').addEventListener('click', handleCreateTag);
document.getElementById('new-tag-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleCreateTag();
});

// ── Upload (see ui/upload.js) ─────────────────────────────────────────────────

let pendingUploadFiles = null;
let pendingAfterSongPick = null;

async function promptSongForUpload(files, afterSongPick) {
  pendingUploadFiles = files;
  pendingAfterSongPick = typeof afterSongPick === 'function' ? afterSongPick : null;
  try {
    const r = await fetch('/api/songs');
    const songs = await r.json();
    if (!songs.length) {
      const song = await createNewSongGroup();
      if (song && pendingUploadFiles) {
        await uploadFilesForSong(song.id, pendingUploadFiles);
        pendingUploadFiles = null;
      }
      return;
    }
    openUploadPickSongModal(songs);
  } catch {
    showToast('Could not load songs', 'error');
    pendingUploadFiles = null;
  }
}

function openUploadPickSongModal(songs) {
  const modal = document.getElementById('upload-pick-song-modal');
  const list = document.getElementById('upload-pick-song-list');
  if (!modal || !list) {
    if (songs.length === 1 && pendingUploadFiles) {
      uploadFilesForSong(songs[0].id, pendingUploadFiles);
      pendingUploadFiles = null;
    }
    return;
  }
  list.replaceChildren();
  for (const s of songs) {
    const btn = el('button', { type: 'button', class: 'add-song-option' });
    btn.textContent = s.name;
    btn.addEventListener('click', async () => {
      modal.style.display = 'none';
      const files = pendingUploadFiles;
      const afterPick = pendingAfterSongPick;
      pendingUploadFiles = null;
      pendingAfterSongPick = null;
      if (files?.length) {
        await uploadFilesForSong(s.id, files);
      } else if (afterPick) {
        const input = document.getElementById('song-any-input');
        if (input) {
          input.dataset.songId = String(s.id);
          afterPick();
        }
      } else {
        state.songDetailId = s.id;
        pushAppHistory();
        await openSongAssets(s.id);
      }
    });
    list.appendChild(btn);
  }
  modal.style.display = 'flex';
}

document.getElementById('close-confirm-modal').addEventListener('click', () => closeConfirmModal(false));
document.getElementById('confirm-modal-cancel-btn').addEventListener('click', () => closeConfirmModal(false));
document.getElementById('confirm-modal-confirm-btn').addEventListener('click', () => closeConfirmModal(true));
document.getElementById('confirm-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('confirm-modal')) closeConfirmModal(false);
});
document.getElementById('confirm-modal-box').addEventListener('click', (e) => e.stopPropagation());

document.getElementById('close-choice-modal').addEventListener('click', () => closeChoiceModal(null));
document.getElementById('choice-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('choice-modal')) closeChoiceModal(null);
});
document.getElementById('choice-modal-box').addEventListener('click', (e) => e.stopPropagation());

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


// ── Feature extensions (name modal, songs, PDF, folder tags) ─────────────────

let nameInputResolve = null;

function showNameInput(options = {}) {
  return new Promise((resolve) => {
    nameInputResolve = resolve;
    document.getElementById('name-input-title').textContent = options.title || 'Name';
    const descEl = document.getElementById('name-input-desc');
    descEl.textContent = options.description || '';
    descEl.style.display = options.description ? '' : 'none';
    const field = document.getElementById('name-input-field');
    const suffix = document.getElementById('name-input-suffix');
    const errEl = document.getElementById('name-input-error');
    errEl.textContent = '';
    field.value = options.defaultValue || '';
    const suffixes = options.suffixes || null;
    if (suffixes && suffixes.length) {
      suffix.style.display = '';
      suffix.replaceChildren();
      for (const s of suffixes) {
        const opt = el('option', { value: s.value });
        opt.textContent = s.label;
        suffix.appendChild(opt);
      }
      suffix.value = options.defaultSuffix || suffixes[0].value;
    } else {
      suffix.style.display = 'none';
    }
    document.getElementById('name-input-confirm-btn').textContent = options.confirmLabel || 'Confirm';
    document.getElementById('name-input-modal').style.display = 'flex';
    setTimeout(() => { field.focus(); field.select(); }, 50);
  });
}

function closeNameInputModal(result) {
  document.getElementById('name-input-modal').style.display = 'none';
  if (nameInputResolve) {
    nameInputResolve(result ?? null);
    nameInputResolve = null;
  }
}

function initNameInputModal() {
  document.getElementById('close-name-input-modal').addEventListener('click', () => closeNameInputModal(null));
  document.getElementById('name-input-cancel-btn').addEventListener('click', () => closeNameInputModal(null));
  document.getElementById('name-input-confirm-btn').addEventListener('click', () => {
    const raw = document.getElementById('name-input-field').value.trim();
    const errEl = document.getElementById('name-input-error');
    if (!raw) {
      errEl.textContent = 'Enter a name';
      return;
    }
    const suffix = document.getElementById('name-input-suffix');
    const value = suffix.style.display !== 'none' ? raw.replace(/\.(md|txt|pro|cho)$/i, '') + suffix.value : raw;
    closeNameInputModal(value);
  });
  document.getElementById('name-input-field').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('name-input-confirm-btn').click();
  });
  document.getElementById('name-input-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('name-input-modal')) closeNameInputModal(null);
  });
  document.getElementById('name-input-modal-box').addEventListener('click', (e) => e.stopPropagation());
}

function exportViewerPdf() {
  window.print();
}

let addSongTargetPath = '';
let addSongModalState = { songs: [], query: '' };
let addSongSearchTimer = null;

function songNameFromModalState(songId) {
  const s = addSongModalState.songs.find((x) => x.id === songId);
  return s?.name || 'song';
}

function renderAddSongList() {
  const list = document.getElementById('add-song-list');
  list.replaceChildren();
  const q = addSongModalState.query.toLowerCase();
  const filtered = addSongModalState.songs.filter((s) =>
    !q || s.name.toLowerCase().includes(q)
  );
  if (!addSongModalState.songs.length) {
    list.appendChild(append(el('div', { class: 'modal-desc' }), 'No songs yet — use + New song above.'));
    return;
  }
  if (!filtered.length) {
    list.appendChild(append(el('div', { class: 'modal-desc' }), 'No songs match your search.'));
    return;
  }
  for (const s of filtered) {
    const btn = el('button', {
      type: 'button',
      class: 'add-song-option',
      onclick: () => addFileToSong(s.id),
    });
    btn.textContent = s.name + (s.asset_count ? ` (${s.asset_count} assets)` : '');
    list.appendChild(btn);
  }
}

async function openAddSongModal(relPath) {
  addSongTargetPath = relPath;
  addSongModalState.query = '';
  const errEl = document.getElementById('add-song-error');
  errEl.textContent = '';
  const searchEl = document.getElementById('add-song-search');
  searchEl.value = '';
  const fileName = relPath.split('/').pop() || relPath;
  const isAudio = fileType(fileName) === 'audio';
  const moveWrap = document.getElementById('add-song-move-wrap');
  const moveHint = document.getElementById('add-song-move-hint');
  const descEl = document.getElementById('add-song-desc');
  if (isAudio) {
    moveWrap.style.display = '';
    moveHint.style.display = '';
    document.getElementById('add-song-move').checked = true;
    document.getElementById('add-song-move-label').textContent = 'Move into song folder when adding';
    moveHint.textContent = 'When checked, the recording is moved into the chosen song\'s folder (not copied). Unchecked = link only; the file stays where it is.';
    descEl.textContent = 'Choose a song. Audio will be linked — and moved into that song\'s folder if the box below is checked.';
  } else {
    moveWrap.style.display = 'none';
    moveHint.style.display = 'none';
    descEl.textContent = 'Choose a song group or create a new one. Adds a link only; the file stays where it is on disk.';
  }
  try {
    const r = await fetch('/api/songs');
    const songs = await r.json();
    addSongModalState.songs = songs;
    renderAddSongList();
    document.getElementById('add-song-modal').style.display = 'flex';
    setTimeout(() => searchEl.focus(), 50);
  } catch {
    errEl.textContent = 'Could not load songs';
    addSongModalState.songs = [];
    renderAddSongList();
  }
}

function closeAddSongModal() {
  document.getElementById('add-song-modal').style.display = 'none';
  addSongTargetPath = '';
  addSongModalState = { songs: [], query: '' };
}

async function goToSongAfterAdd(songId, assetPath, songName, options = {}) {
  if (viewerModal.style.display !== 'none') {
    if (viewerState.editing && viewerState.dirty) {
      const ok = await showConfirm({
        title: 'Discard changes?',
        message: 'You have unsaved edits. Discard them and open the song?',
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) {
        closeAddSongModal();
        showToast('Added to "' + songName + '"');
        if (viewerState.relPath === assetPath) loadViewerSongBar(assetPath);
        return;
      }
    }
    closeViewer();
  }
  closeAddSongModal();
  state.songDetailId = songId;
  state.view = 'songs';
  state.songLayout = 'studio';
  state.studioAssetPath = assetPath;
  pushAppHistory();
  showToast(options.toast || ('Added to "' + songName + '"'));
  await openSongAssets(songId, { selectPath: assetPath });
}

async function addFileToSong(songId, options = {}) {
  const errEl = document.getElementById('add-song-error');
  const path = addSongTargetPath;
  if (!path) return;
  const songName = songNameFromModalState(songId);
  const fileName = path.split('/').pop() || path;
  const moveEl = document.getElementById('add-song-move');
  const moveChecked = moveEl && moveEl.offsetParent !== null && moveEl.checked;
  try {
    let finalPath = path;
    let moved = false;
    if (moveChecked && fileType(fileName) === 'audio') {
      const sr = await fetch('/api/songs/' + songId);
      const songData = await sr.json().catch(() => ({}));
      if (!sr.ok) {
        errEl.textContent = songData.error || 'Could not load song';
        return;
      }
      const targetDir = resolveSongAssetDir(songData, songData.assets || []);
      if (shouldMoveIntoSongFolder(path, targetDir, true)) {
        const moveResult = await moveFileIntoSongFolder(path, targetDir);
        finalPath = moveResult.path;
        moved = moveResult.moved;
      }
    }
    const r = await fetch('/api/songs/' + songId + '/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: finalPath }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = data.error || 'Failed to add';
      return;
    }
    const toastMsg = moved ? 'Moved and added to "' + songName + '"' : 'Added to "' + songName + '"';
    if (options.navigate !== false) {
      await goToSongAfterAdd(songId, finalPath, songName, { toast: toastMsg });
    } else {
      closeAddSongModal();
      showToast(toastMsg);
      if (viewerState.relPath === path) {
        if (finalPath !== path) viewerState.relPath = finalPath;
        loadViewerSongBar(finalPath);
      }
    }
  } catch (e) {
    errEl.textContent = e.message || 'Could not reach server';
  }
}

async function createNewSongGroup() {
  const name = await showNameInput({
    title: 'New song',
    description: 'Name this song group (e.g. "All Lonely").',
    defaultValue: 'Untitled song',
    confirmLabel: 'Create',
  });
  if (!name) return null;
  const r = await fetch('/api/songs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    showToast(data.error || 'Create failed', 'error');
    return null;
  }
  return data;
}

async function loadViewerSongBar(relPath) {
  const bar = document.getElementById('viewer-song-bar');
  if (!bar) return;
  bar.replaceChildren();
  bar.classList.remove('show');
  try {
    const r = await fetch('/api/songs/by-file?path=' + encodeURIComponent(relPath));
    const data = await r.json();
    if (!data.song || !data.assets.length) return;
    bar.classList.add('show');
    bar.appendChild(append(el('span', { class: 'viewer-song-label' }), data.song.name + ':'));
    for (const asset of data.assets) {
      const chip = el('button', {
        type: 'button',
        class: 'viewer-song-chip' + (asset.path === relPath ? ' active' : ''),
        onclick: () => {
          if (asset.path === relPath) return;
          openViewer({ relPath: asset.path, name: asset.name, tags: [], modified: asset.modified });
        },
      });
      chip.appendChild(document.createTextNode(asset.name));
      if (asset.role) chip.appendChild(append(el('span', { class: 'role' }), asset.role));
      bar.appendChild(chip);
    }
  } catch { /* ignore */ }
}

async function renameSongGroup(songId, currentName) {
  const name = await showNameInput({
    title: 'Rename song',
    description: 'Enter a new name for this song group.',
    defaultValue: currentName,
    confirmLabel: 'Save',
  });
  if (!name || name.trim() === currentName) return;
  try {
    const r = await fetch('/api/songs/' + songId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(data.error || 'Rename failed', 'error');
      return;
    }
    showToast('Song renamed');
    if (state.songDetailId === songId) {
      await openSongAssets(songId);
    } else {
      await loadFiles();
    }
  } catch {
    showToast('Could not reach server', 'error');
  }
}

function renderSongTagsRow(song) {
  const wrap = el('div', { class: 'song-banner-tags tag-badges-wrap' });
  const tags = song.tags || [];
  for (const tag of tags) {
    const c = tagColor(tag.id);
    const badge = el('span', {
      class: 'tag-badge',
      style: { background: c + '18', borderColor: c + '55', color: c },
      title: tag.name,
      onclick: (e) => { e.stopPropagation(); openSongTagDropdown(e.currentTarget, song.id, tags); },
    });
    badge.textContent = tag.name;
    wrap.appendChild(badge);
  }
  if (tags.length < 2) {
    const addBtn = el('span', {
      class: 'tag-badge-empty',
      title: 'Add tag',
      onclick: (e) => { e.stopPropagation(); openSongTagDropdown(e.currentTarget, song.id, tags); },
    });
    addBtn.textContent = '+ tag';
    wrap.appendChild(addBtn);
  }
  return wrap;
}

let songNotesSaveTimer = null;

function renderSongNotesRow(song) {
  const wrap = el('div', { class: 'song-notes-wrap' });
  const label = el('label', { class: 'song-notes-label', for: 'song-notes-input' });
  label.textContent = 'Notes';
  const ta = el('textarea', {
    id: 'song-notes-input',
    class: 'song-notes-input',
    rows: '2',
    placeholder: 'Production notes — rework bridge, change lyrics, etc.',
  });
  ta.value = song.notes || '';
  ta.addEventListener('input', () => {
    clearTimeout(songNotesSaveTimer);
    songNotesSaveTimer = setTimeout(() => saveSongNotes(song.id, ta.value), 500);
  });
  wrap.appendChild(label);
  wrap.appendChild(ta);
  return wrap;
}

async function saveSongNotes(songId, notes) {
  try {
    const r = await fetch('/api/songs/' + songId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      showToast(data.error || 'Could not save notes', 'error');
    }
  } catch {
    showToast('Could not save notes', 'error');
  }
}

function renderSongDetailBanner(song) {
  if (state.workspace === 'songwriting') {
    renderSongContextHeader(song);
    return;
  }
  const banner = document.getElementById('flat-filter-banner');
  banner.style.display = 'block';
  banner.replaceChildren();
  const topRow = el('div', { class: 'song-banner-row' });
  const back = el('a', { href: '#', class: 'song-banner-link' });
  back.textContent = '← All songs';
  back.addEventListener('click', async (e) => {
    e.preventDefault();
    await goBackToSongsList();
  });
  topRow.appendChild(back);
  topRow.appendChild(document.createTextNode(' · Song: '));
  topRow.appendChild(append(el('strong'), song.name));
  const renameBtn = el('button', { type: 'button', class: 'song-banner-btn', title: 'Rename', 'aria-label': 'Rename song' });
  renameBtn.appendChild(makeIcon('rename', 14, 'currentColor'));
  renameBtn.addEventListener('click', () => renameSongGroup(song.id, song.name));
  topRow.appendChild(renameBtn);
  banner.appendChild(topRow);
  banner.appendChild(renderSongTagsRow(song));
  banner.appendChild(renderSongNotesRow(song));
}

function filterSongAssets(assets, query) {
  if (!query) return assets;
  const q = query.toLowerCase();
  return assets.filter((a) => {
    const role = (a.role || '').toLowerCase();
    return a.name.toLowerCase().includes(q) || role.includes(q);
  });
}

function closeSongTypeDropdown() {
  songTypeDropdown.style.display = 'none';
  songTypeDropdown.style.maxHeight = '';
  songTypeDropdown.replaceChildren();
}

function renderSongTypeOptions(filterInput, listEl, onPick) {
  listEl.replaceChildren();
  const q = filterInput.value.trim();
  const ql = q.toLowerCase();
  const presets = SONG_TYPE_PRESETS.filter((p) => !ql || p.toLowerCase().includes(ql));
  for (const preset of presets) {
    const row = el('div', {
      class: 'tag-drop-item',
      onclick: (e) => { e.stopPropagation(); onPick(preset); },
    });
    row.textContent = preset;
    listEl.appendChild(row);
  }
  if (q && !presets.some((p) => p.toLowerCase() === ql)) {
    const custom = el('div', {
      class: 'tag-drop-item song-type-custom',
      onclick: (e) => { e.stopPropagation(); onPick(q); },
    });
    custom.textContent = 'Use “' + q + '”';
    listEl.appendChild(custom);
  }
  if (!presets.length && !q) {
    listEl.appendChild(append(el('div', { class: 'tag-drop-item tag-drop-disabled' }), 'No matches'));
  }
}

function openSongTypeDropdown(roleSpan, songId, asset) {
  closeSongTypeDropdown();

  const filterInput = el('input', {
    type: 'text',
    class: 'song-type-filter',
    placeholder: 'Search or type custom…',
    value: asset.role || '',
    maxlength: '32',
    'aria-label': 'Asset type',
  });
  const listEl = el('div', { class: 'song-type-list' });

  const pick = (type) => applySongAssetType(songId, asset, roleSpan, type);
  filterInput.addEventListener('input', () => renderSongTypeOptions(filterInput, listEl, pick));
  filterInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(filterInput.value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSongTypeDropdown();
    }
  });
  filterInput.addEventListener('click', (e) => e.stopPropagation());

  songTypeDropdown.appendChild(filterInput);
  songTypeDropdown.appendChild(listEl);
  renderSongTypeOptions(filterInput, listEl, pick);

  positionFloatingNearAnchor(songTypeDropdown, roleSpan, listEl);
  setTimeout(() => { filterInput.focus(); filterInput.select(); }, 0);
}

async function applySongAssetType(songId, asset, roleSpan, type) {
  closeSongTypeDropdown();
  const role = type || '';
  if (role === (asset.role || '')) return;
  try {
    const r = await fetch('/api/songs/' + songId + '/assets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: asset.path, role: role || null }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(data.error || 'Could not update type', 'error');
      return;
    }
    asset.role = role;
    roleSpan.textContent = role || 'Add type…';
    roleSpan.classList.toggle('empty', !role);
  } catch {
    showToast('Could not update type', 'error');
  }
}

let songDragPath = null;

async function reorderSongAssets(songId, allAssets, dragPath, dropPath) {
  const paths = allAssets.map((a) => a.path);
  const from = paths.indexOf(dragPath);
  const to = paths.indexOf(dropPath);
  if (from < 0 || to < 0 || from === to) return;
  paths.splice(from, 1);
  paths.splice(to, 0, dragPath);
  try {
    const r = await fetch('/api/songs/' + songId + '/assets/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: paths }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      showToast(data.error || 'Reorder failed', 'error');
      return;
    }
    await openSongAssets(songId);
  } catch {
    showToast('Reorder failed', 'error');
  }
}

function renderSongAssetTable(songId, assets, allAssetsForReorder) {
  const tbody = document.getElementById('file-list');
  tbody.replaceChildren();
  const reorderSource = allAssetsForReorder || assets;
  const canReorder = !state.query;
  const groups = groupSongAssets(assets);

  for (const group of groups) {
    const headerTr = el('tr', { class: 'song-group-header' });
    headerTr.appendChild(append(el('td', { colspan: '7' }), group.label));
    tbody.appendChild(headerTr);

    for (const asset of group.items) {
      const type = fileType(asset.name);
      const color = TYPE_COLORS[type] || TYPE_COLORS.generic;
      const openFile = () => openViewer({
        relPath: asset.path,
        name: asset.name,
        tags: [],
        modified: asset.modified,
      });

      const dragTd = append(el('td', { class: 'col-drag song-drag-handle', title: canReorder ? 'Drag to reorder' : '' }), canReorder ? '⠿' : '');
      const iconTd = el('td', { class: 'col-icon' });
      iconTd.appendChild(append(el('div', { class: 'file-type-icon clickable' }), makeIcon(type, 22, color)));
      iconTd.querySelector('.file-type-icon').addEventListener('click', (e) => {
        e.stopPropagation();
        openFile();
      });

      const roleTd = el('td', { class: 'col-role' });
      const roleSpan = el('span', {
        class: 'song-asset-role' + (asset.role ? '' : ' empty'),
        title: 'Click to edit type',
      });
      roleSpan.textContent = asset.role || 'Add type…';
      roleSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        openSongTypeDropdown(roleSpan, songId, asset);
      });
      roleTd.appendChild(roleSpan);

      const nameTd = el('td', { class: 'col-name' });
      const nameSpan = el('span', { class: 'file-name-cell', title: asset.path });
      nameSpan.textContent = asset.name;
      nameTd.appendChild(nameSpan);
      const dir = parentDirFromPath(asset.path);
      if (dir) {
        const dirLabel = el('span', { class: 'file-dir-label' });
        dirLabel.textContent = dir;
        nameTd.appendChild(dirLabel);
      }

      const sizeTd = append(el('td', { class: 'col-size' }), formatSize(asset.size || 0));
      const modTd = modifiedCell(asset.modified);

      const openBtn = append(
        el('button', { class: 'action-btn', title: 'Open',
          onclick: (e) => { e.stopPropagation(); openFile(); } }),
        makeIcon('generic', 15, 'currentColor')
      );
      const removeBtn = append(
        el('button', { class: 'action-btn song-remove', title: 'Remove from song or delete file',
          onclick: async (e) => {
            e.stopPropagation();
            await promptRemoveOrDeleteSongAsset(asset, songId);
          } }),
        makeIcon('trash', 15, 'currentColor')
      );
      const actionsTd = append(el('td', { class: 'col-actions' }),
        append(el('div', { class: 'file-actions' }), openBtn, removeBtn));

      const row = append(el('tr', { class: 'song-asset-row' }),
        dragTd, iconTd, roleTd, nameTd, sizeTd, modTd, actionsTd);

      row.draggable = canReorder;
      if (canReorder) {
        row.addEventListener('dragstart', (e) => {
          songDragPath = asset.path;
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          tbody.querySelectorAll('.drag-over').forEach((r) => r.classList.remove('drag-over'));
          songDragPath = null;
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('drag-over');
          if (songDragPath && songDragPath !== asset.path) {
            reorderSongAssets(songId, reorderSource, songDragPath, asset.path);
          }
        });
      }
      row.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn,.song-asset-role,.song-drag-handle')) return;
        openFile();
      });

      tbody.appendChild(row);
    }
  }
}

// ── Song studio ───────────────────────────────────────────────────────────────

const songStudioAudioEl = document.getElementById('song-studio-audio');
const songStudioRailEl = document.getElementById('song-studio-rail');
const songStudioToolbarEl = document.getElementById('song-studio-toolbar');
const songStudioMainEl = document.getElementById('song-studio-main');

const studioState = {
  songId: null,
  song: null,
  assets: [],
  assetPath: '',
  name: '',
  editing: false,
  dirty: false,
  savedContent: '',
  editable: false,
};

let studioEditOnLoad = false;

const STUDIO_AUDIO_KEY = 'fileshare-studio-audio';
const STUDIO_FONT_SCALE_KEY = 'fileshare-studio-preview-font-scale';
const STUDIO_FONT_SCALES = [0.85, 0.95, 1, 1.1, 1.25, 1.4];

function studioAudioStorageKey(songId) {
  return STUDIO_AUDIO_KEY + '-' + songId;
}

function studioFontScaleStorageKey(relPath) {
  return STUDIO_FONT_SCALE_KEY + ':' + relPath;
}

function getStudioPreviewFontScaleIndex(relPath = studioState.assetPath) {
  if (!relPath) return STUDIO_FONT_SCALES.indexOf(1);
  try {
    const raw = localStorage.getItem(studioFontScaleStorageKey(relPath));
    if (raw == null) return STUDIO_FONT_SCALES.indexOf(1);
    const n = parseFloat(raw);
    const idx = STUDIO_FONT_SCALES.findIndex((s) => s === n);
    return idx >= 0 ? idx : STUDIO_FONT_SCALES.indexOf(1);
  } catch {
    return STUDIO_FONT_SCALES.indexOf(1);
  }
}

function getStudioPreviewFontScale(relPath = studioState.assetPath) {
  return STUDIO_FONT_SCALES[getStudioPreviewFontScaleIndex(relPath)];
}

function setStudioPreviewFontScaleIndex(index, relPath = studioState.assetPath) {
  const idx = Math.max(0, Math.min(STUDIO_FONT_SCALES.length - 1, index));
  if (relPath) {
    try { localStorage.setItem(studioFontScaleStorageKey(relPath), String(STUDIO_FONT_SCALES[idx])); } catch { /* ignore */ }
  }
  return idx;
}

function migrateStudioFontScale(oldPath, newPath) {
  if (!oldPath || !newPath || oldPath === newPath) return;
  try {
    const key = studioFontScaleStorageKey(oldPath);
    const val = localStorage.getItem(key);
    if (val != null) {
      localStorage.setItem(studioFontScaleStorageKey(newPath), val);
      localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}

function isStudioPreviewScalable(name) {
  const ext = fileExt(name);
  return ext === 'md' || ext === 'pro' || ext === 'cho';
}

function applyStudioPreviewScaleToElement(div) {
  div.style.setProperty('--studio-preview-scale', String(getStudioPreviewFontScale()));
}

function applyStudioPreviewScaleToMain() {
  const preview = songStudioMainEl.querySelector('.viewer-markdown, .viewer-chordpro');
  if (preview) applyStudioPreviewScaleToElement(preview);
}

function adjustStudioPreviewFontScale(delta) {
  const scrollTop = songStudioMainEl.scrollTop;
  const idx = setStudioPreviewFontScaleIndex(getStudioPreviewFontScaleIndex() + delta);
  applyStudioPreviewScaleToMain();
  updateStudioToolbar();
  songStudioMainEl.scrollTop = scrollTop;
  return STUDIO_FONT_SCALES[idx];
}

async function confirmStudioUnsaved() {
  if (!studioState.editing || !studioState.dirty) return true;
  return showConfirm({
    title: 'Discard changes?',
    message: 'You have unsaved edits. Discard them?',
    confirmLabel: 'Discard',
    danger: true,
  });
}

function clearStudioMain() {
  songStudioMainEl.replaceChildren();
  songStudioMainEl.className = 'song-studio-main';
}

function renderStudioTextContent(content, editing, name) {
  clearStudioMain();
  if (editing) {
    const ta = el('textarea', { id: 'studio-textarea' });
    ta.value = content;
    ta.addEventListener('input', () => {
      studioState.dirty = ta.value !== studioState.savedContent;
      updateStudioToolbar();
    });
    songStudioMainEl.appendChild(ta);
    ta.focus();
  } else if ((fileExt(name) === 'pro' || fileExt(name) === 'cho')) {
    const div = el('div', { class: 'viewer-chordpro' });
    div.innerHTML = renderChordProHtml(content);
    applyStudioPreviewScaleToElement(div);
    songStudioMainEl.appendChild(div);
  } else if (fileExt(name) === 'md' && typeof marked !== 'undefined') {
    const div = el('div', { class: 'viewer-markdown' });
    div.innerHTML = marked.parse(content, { breaks: true, gfm: true });
    applyStudioPreviewScaleToElement(div);
    songStudioMainEl.appendChild(div);
  } else {
    const pre = el('pre', { class: 'viewer-text-pre' });
    pre.textContent = content;
    songStudioMainEl.appendChild(pre);
  }
}

function studioTextBtn(label, title, disabled, onClick) {
  const btn = el('button', {
    type: 'button',
    class: 'studio-text-btn',
    title,
    'aria-label': title,
  });
  btn.textContent = label;
  if (disabled) btn.disabled = true;
  else btn.addEventListener('click', onClick);
  return btn;
}

function studioIconBtn(icon, title, active, onClick, extraClass = '') {
  const btn = el('button', {
    type: 'button',
    class: 'studio-icon-btn' + (active ? ' active' : '') + (extraClass ? ' ' + extraClass : ''),
    title,
    'aria-label': title,
  });
  btn.appendChild(makeIcon(icon, 15, 'currentColor'));
  btn.addEventListener('click', onClick);
  return btn;
}

function enterStudioEditMode() {
  renderStudioTextContent(studioState.savedContent, true, studioState.name);
  studioState.editing = true;
  studioState.dirty = false;
  updateStudioToolbar();
}

async function leaveStudioEditMode() {
  if (studioState.dirty && !(await confirmStudioUnsaved())) return false;
  studioState.editing = false;
  studioState.dirty = false;
  renderStudioTextContent(studioState.savedContent, false, studioState.name);
  updateStudioToolbar();
  return true;
}

async function renameStudioAsset() {
  const asset = studioState.assets.find((a) => a.path === studioState.assetPath);
  if (!asset || !(await confirmStudioUnsaved())) return;

  const { base, ext } = splitFilename(asset.name);
  const newBase = await showNameInput({
    title: 'Rename file',
    description: 'Enter a new name. The extension stays the same.',
    defaultValue: base,
    confirmLabel: 'Rename',
  });
  if (!newBase) return;

  const newName = newBase.trim() + ext;
  if (newName === asset.name) return;

  try {
    const r = await fetch('/api/files/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: asset.path, newName }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Rename failed');
    migrateStudioFontScale(asset.path, data.path);
    showToast('Renamed to ' + data.name);
    state.studioAssetPath = data.path;
    studioState.editing = false;
    studioState.dirty = false;
    await openSongAssets(studioState.songId, { selectPath: data.path });
  } catch (err) {
    showToast(err.message || 'Rename failed', 'error');
  }
}

async function promptRemoveOrDeleteSongAsset(asset, songId, song, assets) {
  song = song || studioState.song || { name: '' };
  assets = assets || (studioState.songId === songId ? studioState.assets : []);

  const inSongFolder = isAssetInSongFolder(asset, song, assets);
  const isAudio = fileType(asset.name) === 'audio';
  const isDoc = isEditableFile(asset.name);
  const locationPath = asset.path;

  let message;
  let focusValue;
  let actions;

  if (isDoc && inSongFolder) {
    message = 'What would you like to do with "' + asset.name + '"?\n\n'
      + 'This document lives in this song\'s folder at ' + locationPath + '.\n\n'
      + 'Remove from this song — Unlinks it here; the file stays on disk at the same path.\n\n'
      + 'Delete from library — Permanently deletes the file from disk.';
    focusValue = 'delete';
    actions = [
      { label: 'Remove from this song', value: 'unlink' },
      { label: 'Delete from library', value: 'delete', danger: true },
    ];
  } else if (isAudio) {
    message = 'What would you like to do with "' + asset.name + '"?\n\n'
      + 'The recording stays at ' + locationPath + ' on disk unless you delete it.\n\n'
      + 'Remove from this song — Unlinks only; the file is not moved or deleted.\n\n'
      + 'Delete from library — Permanently deletes the file from disk everywhere.';
    focusValue = 'unlink';
    actions = [
      { label: 'Delete from library', value: 'delete', danger: true },
      { label: 'Remove from this song', value: 'unlink' },
    ];
  } else {
    message = 'What would you like to do with "' + asset.name + '"?\n\n'
      + 'The file stays at ' + locationPath + ' on disk unless you delete it.\n\n'
      + 'Remove from this song — Unlinks only; the file is not moved or deleted.\n\n'
      + 'Delete from library — Permanently deletes the file from disk everywhere.';
    focusValue = 'unlink';
    actions = [
      { label: 'Delete from library', value: 'delete', danger: true },
      { label: 'Remove from this song', value: 'unlink' },
    ];
  }

  const choice = await showChoice({
    title: 'Remove or delete?',
    message,
    actions,
    focusValue,
  });
  if (!choice) return;

  if (choice === 'unlink') {
    const r = await fetch('/api/songs/' + songId + '/assets?path=' + encodeURIComponent(asset.path), {
      method: 'DELETE',
    });
    if (r.ok) {
      showToast('Removed from song');
      state.studioAssetPath = '';
      studioState.editing = false;
      studioState.dirty = false;
      await openSongAssets(songId);
    } else {
      showToast('Remove failed', 'error');
    }
    return;
  }

  if (choice === 'delete') {
    const r = await fetch('/api/files?path=' + encodeURIComponent(asset.path), { method: 'DELETE' });
    if (r.ok) {
      showToast('Deleted ' + asset.name);
      state.studioAssetPath = '';
      studioState.editing = false;
      studioState.dirty = false;
      await openSongAssets(songId);
    } else {
      showToast('Delete failed', 'error');
    }
  }
}

async function removeStudioAsset() {
  const asset = studioState.assets.find((a) => a.path === studioState.assetPath);
  if (!asset || !studioState.songId) return;
  if (!(await confirmStudioUnsaved())) return;
  await promptRemoveOrDeleteSongAsset(asset, studioState.songId, studioState.song, studioState.assets);
}

function updateStudioToolbar() {
  songStudioToolbarEl.replaceChildren();
  const asset = studioState.assets.find((a) => a.path === studioState.assetPath);
  if (!asset) return;

  const titleWrap = el('div', { class: 'studio-filename-wrap' });
  if (asset.role) {
    titleWrap.appendChild(append(el('span', { class: 'studio-filename-role' }), asset.role));
    titleWrap.appendChild(append(el('span', { class: 'studio-filename-sep' }), '·'));
  }
  const nameBtn = el('button', {
    type: 'button',
    class: 'studio-filename-btn',
    title: 'Rename file',
    'aria-label': 'Rename ' + asset.name,
  });
  nameBtn.textContent = asset.name;
  nameBtn.addEventListener('click', () => renameStudioAsset());
  titleWrap.appendChild(nameBtn);
  songStudioToolbarEl.appendChild(titleWrap);

  const actions = el('div', { class: 'studio-toolbar-actions' });
  const fileName = studioState.name || asset.name;

  if (studioState.editable) {
    const isMd = fileExt(fileName) === 'md';

    if (isMd) {
      const toggle = el('div', { class: 'studio-mode-toggle', role: 'group', 'aria-label': 'Content view' });
      toggle.appendChild(studioIconBtn('eye', 'Preview markdown', !studioState.editing, async () => {
        if (studioState.editing) await leaveStudioEditMode();
      }));
      toggle.appendChild(studioIconBtn('edit', 'Edit source', studioState.editing, () => {
        if (!studioState.editing) enterStudioEditMode();
      }));
      actions.appendChild(toggle);
    } else if (!studioState.editing) {
      actions.appendChild(studioIconBtn('edit', 'Edit source', false, () => enterStudioEditMode()));
    }

    if (studioState.editing) {
      const saveBtn = el('button', { type: 'button', class: 'btn-primary btn-sm', id: 'studio-save-btn' });
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => saveStudioContent());
      actions.appendChild(saveBtn);
      const cancelBtn = el('button', { type: 'button', class: 'btn-secondary btn-sm' });
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => leaveStudioEditMode());
      actions.appendChild(cancelBtn);
    } else if (isStudioPreviewScalable(fileName)) {
      const scaleIdx = getStudioPreviewFontScaleIndex();
      const fontToggle = el('div', { class: 'studio-font-toggle', role: 'group', 'aria-label': 'Font size' });
      fontToggle.appendChild(studioTextBtn('A−', 'Smaller text', scaleIdx <= 0, () => adjustStudioPreviewFontScale(-1)));
      fontToggle.appendChild(studioTextBtn('A+', 'Larger text', scaleIdx >= STUDIO_FONT_SCALES.length - 1, () => adjustStudioPreviewFontScale(1)));
      actions.appendChild(fontToggle);
    }
  }

  if (studioState.editable && studioState.songId) {
    actions.appendChild(studioTextBtn('Clone', 'Clone as new document', false, () => cloneStudioDocument()));
  }

  actions.appendChild(studioIconBtn('trash', 'Remove from song or delete file', false, () => removeStudioAsset(), 'danger'));

  songStudioToolbarEl.appendChild(actions);
}

async function cloneStudioDocument() {
  if (!(await confirmStudioUnsaved())) return;
  const asset = studioState.assets.find((a) => a.path === studioState.assetPath);
  if (!asset || !studioState.songId) return;
  if (!isEditableFile(asset.name)) {
    showToast('Only text documents can be cloned', 'error');
    return;
  }
  const ext = '.' + fileExt(asset.name);
  try {
    const cr = await fetch('/api/content?path=' + encodeURIComponent(asset.path));
    const contentData = await cr.json().catch(() => ({}));
    if (!cr.ok) throw new Error(contentData.error || 'Could not read file');

    const base = asset.name.slice(0, asset.name.length - ext.length);
    const defaultName = base.replace(/-copy\d*$/i, '') + '-copy';
    const filename = await showNameInput({
      title: 'Clone document',
      description: 'Creates a copy in the song folder and links it to this song.',
      defaultValue: defaultName,
      suffixes: NEW_SHEET_EXTENSIONS,
      defaultSuffix: ext,
      confirmLabel: 'Clone',
    });
    if (!filename) return;

    const targetDir = resolveSongAssetDir(studioState.song, studioState.assets);
    let createName = filename;
    let fileData = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dir: targetDir,
          filename: createName,
          content: contentData.content,
        }),
      });
      fileData = await r.json().catch(() => ({}));
      if (r.ok) break;
      if (r.status !== 409) {
        showToast(fileData.error || 'Create failed', 'error');
        return;
      }
      const stem = createName.slice(0, createName.length - ext.length);
      createName = stem + '-2' + ext;
    }
    if (!fileData?.path) {
      showToast('Could not create copy', 'error');
      return;
    }

    const role = asset.role || (ext === '.md' || ext === '.pro' || ext === '.cho' ? 'Lyrics' : null);
    const body = { path: fileData.path };
    if (role) body.role = role.endsWith(' (copy)') ? role : role + ' (copy)';
    const addR = await fetch('/api/songs/' + studioState.songId + '/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const addData = await addR.json().catch(() => ({}));
    if (!addR.ok) {
      showToast(addData.error || 'Could not add to song', 'error');
      return;
    }
    showToast('Cloned as ' + fileData.name);
    state.studioAssetPath = fileData.path;
    pushAppHistory();
    await openSongAssets(studioState.songId, { selectPath: fileData.path });
  } catch (e) {
    showToast(e.message || 'Clone failed', 'error');
  }
}

async function saveStudioContent() {
  const ta = document.getElementById('studio-textarea');
  if (!ta || !studioState.assetPath) return;
  const saveBtn = document.getElementById('studio-save-btn');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const r = await fetch('/api/files/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: studioState.assetPath, content: ta.value }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Save failed');
    }
    studioState.savedContent = ta.value;
    studioState.dirty = false;
    studioState.editing = false;
    renderStudioTextContent(ta.value, false, studioState.name);
    updateStudioToolbar();
    showToast('Saved ' + studioState.name);
  } catch (err) {
    showToast(err.message || 'Save failed', 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function captureStudioAudioPlayback() {
  const audio = songStudioAudioEl.querySelector('audio');
  const select = songStudioAudioEl.querySelector('select');
  if (!audio) return null;
  return {
    path: select?.value || '',
    currentTime: audio.currentTime,
    playing: !audio.paused,
    volume: audio.volume,
  };
}

function renderSongStudioAudioBar(assets, songId, playback = null) {
  songStudioAudioEl.replaceChildren();
  songStudioAudioEl.classList.remove('empty', 'sticky-audio');
  const audioAssets = assets.filter((a) => classifySongAsset(a) === 'audio');
  if (!audioAssets.length) {
    songStudioAudioEl.classList.add('empty');
    songStudioAudioEl.appendChild(append(el('span'), 'No audio tracks yet.'));
    const uploadBtn = el('button', { type: 'button', class: 'btn btn-sm' });
    uploadBtn.textContent = 'Upload recording';
    uploadBtn.addEventListener('click', () => triggerSongAudioUpload(songId));
    songStudioAudioEl.appendChild(uploadBtn);
    const linkBtn = el('button', { type: 'button', class: 'btn-secondary btn-sm' });
    linkBtn.textContent = 'Link existing';
    linkBtn.addEventListener('click', () => {
      const songName = studioState.song?.name || '';
      openSongAddAssetsModal(songId, songName, assets.map((a) => a.path), { filter: 'audio' });
    });
    return;
  }

  songStudioAudioEl.classList.add('sticky-audio');
  songStudioAudioEl.appendChild(append(el('span', { class: 'song-studio-audio-label' }), 'Audio'));
  const select = el('select', { 'aria-label': 'Audio track' });
  let storedPath = '';
  try { storedPath = sessionStorage.getItem(studioAudioStorageKey(songId)) || ''; } catch { /* ignore */ }
  const resumePath = playback?.path && audioAssets.some((a) => a.path === playback.path)
    ? playback.path
    : '';
  const defaultAsset = audioAssets.find((a) => a.path === resumePath)
    || audioAssets.find((a) => a.path === storedPath)
    || audioAssets[0];

  for (const a of audioAssets) {
    const opt = el('option', { value: a.path });
    opt.textContent = (a.role ? a.role + ' — ' : '') + a.name;
    select.appendChild(opt);
  }
  select.value = defaultAsset.path;

  const audio = el('audio', { controls: '', preload: 'metadata' });
  audio.src = '/api/preview?path=' + encodeURIComponent(defaultAsset.path);
  if (playback?.volume != null) audio.volume = playback.volume;

  const resumePlayback = playback && playback.path === defaultAsset.path;
  if (resumePlayback) {
    audio.addEventListener('loadedmetadata', () => {
      if (playback.currentTime > 0) {
        audio.currentTime = Math.min(playback.currentTime, audio.duration || playback.currentTime);
      }
      if (playback.playing) audio.play().catch(() => {});
    }, { once: true });
  }

  select.addEventListener('change', () => {
    const path = select.value;
    const wasPlaying = !audio.paused;
    const t = audio.currentTime;
    audio.src = '/api/preview?path=' + encodeURIComponent(path);
    if (wasPlaying) {
      audio.addEventListener('loadedmetadata', () => {
        audio.currentTime = Math.min(t, audio.duration || t);
        audio.play().catch(() => {});
      }, { once: true });
    }
    try { sessionStorage.setItem(studioAudioStorageKey(songId), path); } catch { /* ignore */ }
  });

  songStudioAudioEl.appendChild(select);
  songStudioAudioEl.appendChild(audio);
}

function renderSongStudioRailFooter(songId) {
  const footer = document.getElementById('song-studio-rail-footer');
  if (!footer) return;
  footer.replaceChildren();
  const songName = studioState.song?.name || '';
  const assetPaths = studioState.assets.map((a) => a.path);

  const audioBtn = el('button', { type: 'button', class: 'song-studio-rail-add-btn' });
  audioBtn.textContent = '+ Upload recording';
  audioBtn.addEventListener('click', () => triggerSongAudioUpload(songId));

  const linkAudioBtn = el('button', { type: 'button', class: 'song-studio-rail-add-btn' });
  linkAudioBtn.textContent = '+ Link audio';
  linkAudioBtn.addEventListener('click', () => openSongAddAssetsModal(songId, songName, assetPaths, { filter: 'audio' }));

  const docBtn = el('button', { type: 'button', class: 'song-studio-rail-add-btn' });
  docBtn.textContent = '+ Add document';
  docBtn.addEventListener('click', () => createDocumentForSong(songId));

  const footerRow = el('div', { class: 'song-studio-rail-footer-row' });
  footerRow.appendChild(audioBtn);
  footerRow.appendChild(linkAudioBtn);
  footerRow.appendChild(docBtn);
  footer.appendChild(footerRow);
}

function renderSongStudioRail(songId, assets) {
  songStudioRailEl.replaceChildren();
  if (!assets.length) {
    songStudioRailEl.appendChild(append(el('div', { class: 'song-studio-empty' }), 'No assets yet.'));
  } else {
    for (const group of groupSongAssets(assets)) {
      songStudioRailEl.appendChild(append(el('div', { class: 'song-studio-rail-group' }), group.label));
      for (const asset of group.items) {
        const btn = el('button', {
          type: 'button',
          class: 'song-studio-rail-item' + (asset.path === studioState.assetPath ? ' active' : ''),
        });
        btn.appendChild(document.createTextNode(asset.role || asset.name));
        if (asset.role && asset.role !== asset.name) {
          btn.appendChild(append(el('span', { class: 'role' }), asset.name));
        }
        const trackLabels = asset.trackLabels || [];
        if (trackLabels.length) {
          btn.appendChild(append(el('span', { class: 'track-label-badge' }), trackLabels[0]));
        }
        btn.addEventListener('click', () => selectStudioAsset(songId, asset.path));
        songStudioRailEl.appendChild(btn);
      }
    }
  }
  renderSongStudioRailFooter(songId);
}

async function selectStudioAsset(songId, path, options = {}) {
  if (path === studioState.assetPath && !options.force) return;
  if (!(await confirmStudioUnsaved())) return;

  studioState.editing = false;
  studioState.dirty = false;
  studioState.assetPath = path;
  state.studioAssetPath = path;
  replaceAppHistoryIfNeeded();

  const asset = studioState.assets.find((a) => a.path === path);
  if (!asset) return;

  studioState.name = asset.name;
  renderSongStudioRail(songId, studioState.assets);
  await renderStudioMainPanel(asset, options.startEdit);
}

let trackNotesSaveTimer = null;

function syncStudioAssetFields(path, fields) {
  const asset = studioState.assets.find((a) => a.path === path);
  if (asset) Object.assign(asset, fields);
}

async function patchSongAssetMeta(songId, path, body) {
  const r = await fetch('/api/songs/' + songId + '/assets', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Save failed');
  const updated = data.assets?.find((a) => a.path === path);
  if (updated) syncStudioAssetFields(path, { notes: updated.notes, trackLabels: updated.trackLabels });
  return data;
}

async function saveTrackNotes(songId, path, notes) {
  try {
    await patchSongAssetMeta(songId, path, { notes });
  } catch (err) {
    showToast(err.message || 'Could not save track notes', 'error');
  }
}

async function saveTrackLabels(songId, path, trackLabels, chipsWrap, asset) {
  try {
    await patchSongAssetMeta(songId, path, { trackLabels });
    asset.trackLabels = [...trackLabels];
    renderTrackLabelChips(songId, asset, chipsWrap);
    renderSongStudioRail(songId, studioState.assets);
  } catch (err) {
    showToast(err.message || 'Could not save track labels', 'error');
  }
}

function renderTrackLabelChips(songId, asset, chipsWrap) {
  chipsWrap.replaceChildren();
  const labels = asset.trackLabels || [];
  const labelSet = new Set(labels);

  for (const preset of TRACK_LABEL_PRESETS) {
    const active = labelSet.has(preset);
    const chip = el('button', {
      type: 'button',
      class: 'track-label-chip' + (active ? ' active' : ''),
    });
    chip.textContent = preset;
    chip.addEventListener('click', () => {
      const next = active
        ? labels.filter((l) => l !== preset)
        : labels.length >= 5 ? labels : [...labels, preset];
      if (!active && labels.length >= 5) {
        showToast('Maximum 5 track labels', 'error');
        return;
      }
      saveTrackLabels(songId, asset.path, next, chipsWrap, asset);
    });
    chipsWrap.appendChild(chip);
  }

  for (const custom of labels.filter((l) => !TRACK_LABEL_PRESETS.includes(l))) {
    const chip = el('button', {
      type: 'button',
      class: 'track-label-chip active custom',
      title: 'Click to remove',
    });
    chip.textContent = custom;
    chip.addEventListener('click', () => {
      saveTrackLabels(songId, asset.path, labels.filter((l) => l !== custom), chipsWrap, asset);
    });
    chipsWrap.appendChild(chip);
  }

  if (labels.length < 5) {
    const addBtn = el('button', { type: 'button', class: 'track-label-chip track-label-add' });
    addBtn.textContent = '+ Label';
    addBtn.addEventListener('click', async () => {
      const name = await showNameInput({
        title: 'Track label',
        description: 'Labels are per track in this song (not file tags).',
        defaultValue: '',
        confirmLabel: 'Add',
      });
      if (!name) return;
      const trimmed = name.trim().slice(0, 32);
      if (!trimmed || labelSet.has(trimmed)) return;
      if (labels.length >= 5) {
        showToast('Maximum 5 track labels', 'error');
        return;
      }
      saveTrackLabels(songId, asset.path, [...labels, trimmed], chipsWrap, asset);
    });
    chipsWrap.appendChild(addBtn);
  }
}

function renderStudioAudioPanel(songId, asset) {
  const panel = el('div', { class: 'studio-track-panel' });
  panel.appendChild(append(el('p', { class: 'studio-track-hint' }), 'Playback is in the audio bar above.'));

  const notesLabel = el('label', { class: 'studio-track-label' });
  notesLabel.textContent = 'Track notes';
  const notesInput = el('textarea', {
    class: 'studio-track-notes',
    rows: '4',
    placeholder: 'Mix notes, take comparison, what to fix…',
  });
  notesInput.value = asset.notes || '';
  notesInput.addEventListener('input', () => {
    clearTimeout(trackNotesSaveTimer);
    trackNotesSaveTimer = setTimeout(() => saveTrackNotes(songId, asset.path, notesInput.value), 500);
  });
  panel.appendChild(notesLabel);
  panel.appendChild(notesInput);

  const labelsLabel = el('div', { class: 'studio-track-label' });
  labelsLabel.textContent = 'Track labels';
  panel.appendChild(labelsLabel);
  const labelsHint = el('p', { class: 'studio-track-label-hint' });
  labelsHint.textContent = 'Song-specific markers — not the same as file or song tags.';
  panel.appendChild(labelsHint);
  const chipsWrap = el('div', { class: 'track-label-chips' });
  renderTrackLabelChips(songId, asset, chipsWrap);
  panel.appendChild(chipsWrap);

  songStudioMainEl.appendChild(panel);
}

async function renderStudioMainPanel(asset, startEdit = false) {
  if (!asset) return;
  studioState.name = asset.name;
  clearStudioMain();
  songStudioToolbarEl.replaceChildren();
  const type = fileType(asset.name);
  studioState.editable = isEditableFile(asset.name);
  studioState.savedContent = '';

  if (type === 'audio') {
    renderStudioAudioPanel(studioState.songId, asset);
    updateStudioToolbar();
    return;
  }

  if (type === 'image') {
    const img = el('img', { src: '/api/preview?path=' + encodeURIComponent(asset.path), alt: asset.name });
    songStudioMainEl.appendChild(img);
    updateStudioToolbar();
    return;
  }
  if (isPdfFile(asset.name)) {
    const iframe = el('iframe', { src: '/api/preview?path=' + encodeURIComponent(asset.path), title: asset.name });
    songStudioMainEl.appendChild(iframe);
    updateStudioToolbar();
    return;
  }
  if (type === 'video') {
    const video = el('video', { controls: '', src: '/api/preview?path=' + encodeURIComponent(asset.path) });
    songStudioMainEl.appendChild(video);
    updateStudioToolbar();
    return;
  }

  if (isTextFile(asset.name)) {
    try {
      const r = await fetch('/api/content?path=' + encodeURIComponent(asset.path));
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load file');
      }
      const data = await r.json();
      studioState.savedContent = data.content;
      studioState.editable = !!data.editable;
      const edit = startEdit && data.editable;
      studioState.editing = edit;
      renderStudioTextContent(data.content, edit, asset.name);
      updateStudioToolbar();
    } catch (err) {
      songStudioMainEl.appendChild(append(el('div', { class: 'song-studio-empty' }), err.message || 'Could not load file'));
      updateStudioToolbar();
    }
    return;
  }

  songStudioMainEl.appendChild(append(el('div', { class: 'song-studio-empty' }), 'Preview not available for this file type.'));
  updateStudioToolbar();
}

function pickDefaultStudioAsset(assets, preferredPath) {
  if (preferredPath && assets.some((a) => a.path === preferredPath)) return preferredPath;
  const lyrics = assets.find((a) => classifySongAsset(a) === 'lyrics');
  if (lyrics) return lyrics.path;
  return assets[0]?.path || '';
}

async function renderSongStudio(songId, data, options = {}) {
  studioState.songId = songId;
  studioState.song = data;
  studioState.assets = data.assets;

  const audioPlayback = captureStudioAudioPlayback();
  renderSongStudioAudioBar(data.assets, songId, audioPlayback);
  renderSongStudioRail(songId, data.assets);

  const preferred = options.selectPath || state.studioAssetPath;
  const path = pickDefaultStudioAsset(data.assets, preferred);
  if (!path) {
    clearStudioMain();
    songStudioToolbarEl.replaceChildren();
    songStudioMainEl.appendChild(append(el('div', { class: 'song-studio-empty' }),
      'No assets yet. Use + Add document or + Add audio in the sidebar.'));
    return;
  }

  studioState.assetPath = path;
  state.studioAssetPath = path;
  const asset = data.assets.find((a) => a.path === path);
  studioState.name = asset?.name || '';
  const startEdit = studioEditOnLoad || options.startEdit;
  studioEditOnLoad = false;
  await renderStudioMainPanel(asset, startEdit);
  renderSongStudioRail(songId, data.assets);
}

/* List view disabled for now
async function switchSongLayout(layout) {
  if (layout === state.songLayout) return;
  if (!(await confirmStudioUnsaved())) return;
  state.songLayout = layout;
  studioState.editing = false;
  studioState.dirty = false;
  pushAppHistory();
  await openSongAssets(state.songDetailId);
}
*/

function defaultNewSheetContent(filename, title) {
  const t = String(title || '').trim() || 'Untitled';
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '.md';
  if (ext === '.md') return `# ${t}\n\n`;
  if (ext === '.pro' || ext === '.cho') {
    return `{title: ${t}}\n{artist: }\n\n{start_of_verse}\n[Am]Line with [G]chords\n{end_of_verse}\n`;
  }
  return '';
}

function songFolderName(name) {
  let cleaned = String(name || 'Untitled').normalize('NFKC');
  cleaned = cleaned.replace(/[<>:"/\\|?*]/g, '').replace(/[\u2013\u2014]/g, '-');
  cleaned = [...cleaned].filter((ch) => {
    const code = ch.charCodeAt(0);
    return code > 31;
  }).join('').trim().replace(/[. ]+$/, '');
  return cleaned || 'Untitled';
}

function resolveSongAssetDir(song, assets) {
  const items = assets || [];
  if (items.length) {
    const counts = new Map();
    for (const asset of items) {
      const dir = parentDirFromPath(asset.path);
      counts.set(dir, (counts.get(dir) || 0) + 1);
    }
    let bestDir = '';
    let bestCount = 0;
    for (const [dir, count] of counts) {
      if (count > bestCount) {
        bestDir = dir;
        bestCount = count;
      }
    }
    return bestDir;
  }
  return songFolderName(song?.name);
}

function songFolderDisplayLabel(dir) {
  return dir ? dir + '/' : '(library root)';
}

function isAssetInSongFolder(asset, song, assets) {
  const songDir = resolveSongAssetDir(song, assets);
  return parentDirFromPath(asset.path) === songDir;
}

function shouldMoveIntoSongFolder(path, targetDir, moveChecked) {
  if (!moveChecked) return false;
  return parentDirFromPath(path) !== targetDir;
}

async function moveFileIntoSongFolder(path, targetDir) {
  const r = await fetch('/api/files/move', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, dir: targetDir }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Move failed');
  return { path: data.path, moved: !!data.moved };
}

function updateSongAddAssetsMoveUi() {
  const isAudio = songAddAssetsState.fileFilter === 'audio';
  const wrap = document.getElementById('song-add-assets-move-wrap');
  const hint = document.getElementById('song-add-assets-move-hint');
  const desc = document.getElementById('song-add-assets-desc');
  const moveCb = document.getElementById('song-add-assets-move');
  if (!wrap || !hint || !desc || !moveCb) return;
  if (!isAudio) {
    wrap.style.display = 'none';
    hint.style.display = 'none';
    desc.textContent = 'Search your library and add files to this song. Adds a link only; file location on disk is unchanged.';
    return;
  }
  wrap.style.display = '';
  hint.style.display = '';
  const dirLabel = songFolderDisplayLabel(songAddAssetsState.targetDir);
  document.getElementById('song-add-assets-move-label').textContent = 'Move into song folder (' + dirLabel + ')';
  moveCb.checked = true;
  desc.textContent = 'Search for recordings to add. Checked = file is moved into ' + dirLabel + ' (not copied). Unchecked = link only.';
  hint.textContent = 'Moving updates the file for every song that links to it.';
}

async function createDocumentForSong(songId) {
  const song = studioState.songId === songId ? studioState.song : null;
  const assets = studioState.songId === songId ? studioState.assets : [];
  const songTitle = song?.name || '';
  const targetDir = resolveSongAssetDir(song, assets);
  const dirLabel = targetDir || '(library root)';
  const filename = await showNameInput({
    title: 'New document',
    description: 'Creates a new file on disk in ' + dirLabel + ' and links it to this song as Lyrics.',
    defaultValue: 'lyrics',
    suffixes: NEW_SHEET_EXTENSIONS,
    defaultSuffix: '.md',
    confirmLabel: 'Create',
  });
  if (!filename) return;
  try {
    const r = await fetch('/api/files/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dir: targetDir,
        filename,
        content: defaultNewSheetContent(filename, songTitle),
      }),
    });
    const fileData = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(fileData.error || 'Create failed', 'error');
      return;
    }
    const addR = await fetch('/api/songs/' + songId + '/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fileData.path, role: 'Lyrics' }),
    });
    const addData = await addR.json().catch(() => ({}));
    if (!addR.ok) {
      showToast(addData.error || 'Could not add to song', 'error');
      return;
    }
    showToast('Created ' + fileData.name);
    state.songLayout = 'studio';
    state.studioAssetPath = fileData.path;
    studioEditOnLoad = true;
    pushAppHistory();
    await openSongAssets(songId);
  } catch {
    showToast('Could not reach server', 'error');
  }
}

async function openSongAssets(songId, options = {}) {
  state.songDetailId = songId;
  state.view = 'songs';
  state.songLayout = 'studio';
  renderViewTabs();
  try {
    const r = await fetch('/api/songs/' + songId);
    const data = await r.json();
    if (!r.ok) throw new Error();
    renderSongDetailBanner(data);
    const newSongBtnEl = document.getElementById('new-song-btn');
    if (newSongBtnEl) newSongBtnEl.style.display = 'none';
    document.getElementById('new-sheet-btn').style.display = 'none';

    await renderSongStudio(songId, data, {
      selectPath: options.selectPath || state.studioAssetPath,
      startEdit: options.startEdit,
    });
    applyWorkspaceChrome();
    if (options.pushHistory) pushAppHistory();
    else replaceAppHistoryIfNeeded();

    /* List view disabled for now
    listSearchEl.value = state.query;
    updateListSearchPlaceholder();
    setSongTableHeaders();
    const filtered = filterSongAssets(data.assets, state.query);
    const tbody = document.getElementById('file-list');
    tbody.replaceChildren();
    if (!filtered.length) {
      const msg = state.query
        ? 'No assets match your search.'
        : 'No assets yet. Use + New document, + Add assets, or add files from Browse or the viewer.';
      tbody.appendChild(append(el('tr'), append(el('td', { colspan: '7', class: 'empty-state' }), msg)));
      if (options.pushHistory) pushAppHistory();
      else replaceAppHistoryIfNeeded();
      return;
    }
    renderSongAssetTable(songId, filtered, data.assets);
    if (options.pushHistory) pushAppHistory();
    else replaceAppHistoryIfNeeded();
    */
  } catch {
    showToast('Could not load song', 'error');
  }
}

let songAddAssetsState = { songId: null, songName: '', assetPaths: new Set(), fileFilter: null, targetDir: '' };
let songAddAssetsSearchTimer = null;

function renderSongAddAssetsResults(items) {
  const list = document.getElementById('song-add-assets-list');
  list.replaceChildren();
  let files = items.filter((i) => i.kind !== 'folder' && i.relPath);
  if (songAddAssetsState.fileFilter === 'audio') {
    files = files.filter((f) => fileType(f.name) === 'audio');
  } else if (songAddAssetsState.fileFilter === 'document') {
    files = files.filter((f) => isEditableFile(f.name));
  }
  if (!files.length) {
    const msg = songAddAssetsState.fileFilter === 'audio'
      ? 'No audio files found.'
      : songAddAssetsState.fileFilter === 'document'
        ? 'No documents found.'
        : 'No files found.';
    list.appendChild(append(el('div', { class: 'modal-desc' }), msg));
    return;
  }
  for (const f of files) {
    const row = el('div', { class: 'song-add-asset-row' });
    const info = el('div', { class: 'song-add-asset-info' });
    info.appendChild(append(el('span', { class: 'song-add-asset-name' }), f.name));
    const dir = parentDirFromPath(f.relPath);
    if (dir) info.appendChild(append(el('span', { class: 'song-add-asset-dir' }), dir));
    if (songAddAssetsState.fileFilter === 'audio'
      && parentDirFromPath(f.relPath) === songAddAssetsState.targetDir) {
      info.appendChild(append(el('span', { class: 'song-add-asset-note' }), 'Already in song folder'));
    }
    row.appendChild(info);
    if (songAddAssetsState.assetPaths.has(f.relPath)) {
      row.appendChild(append(el('span', { class: 'song-add-asset-in' }), 'In song'));
    } else {
      const btn = el('button', { type: 'button', class: 'btn-secondary btn-sm' });
      btn.textContent = '+ Add';
      btn.addEventListener('click', () => addAssetToSongFromModal(f.relPath, btn));
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
}

async function runSongAddAssetsSearch(query) {
  const errEl = document.getElementById('song-add-assets-error');
  errEl.textContent = '';
  try {
    const params = new URLSearchParams({
      view: 'library',
      page: '1',
      pageSize: '50',
      sort: 'name',
      order: 'asc',
    });
    if (query) params.set('q', query);
    const r = await fetch('/api/files?' + params.toString());
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Search failed');
    renderSongAddAssetsResults(data.items || []);
  } catch (e) {
    errEl.textContent = e.message || 'Search failed';
    document.getElementById('song-add-assets-list').replaceChildren();
  }
}

async function addAssetToSongFromModal(path, btn) {
  const songId = songAddAssetsState.songId;
  const errEl = document.getElementById('song-add-assets-error');
  errEl.textContent = '';
  btn.disabled = true;
  const roleEl = document.getElementById('song-add-assets-role');
  const role = roleEl?.value.trim() || null;
  const moveEl = document.getElementById('song-add-assets-move');
  const moveChecked = moveEl && moveEl.offsetParent !== null && moveEl.checked;
  try {
    let finalPath = path;
    let moved = false;
    if (shouldMoveIntoSongFolder(path, songAddAssetsState.targetDir, moveChecked)) {
      const moveResult = await moveFileIntoSongFolder(path, songAddAssetsState.targetDir);
      finalPath = moveResult.path;
      moved = moveResult.moved;
    }
    const r = await fetch('/api/songs/' + songId + '/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: finalPath, role }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = data.error || 'Failed to add';
      btn.disabled = false;
      return;
    }
    songAddAssetsState.assetPaths.add(finalPath);
    showToast(moved ? 'Moved and added to song' : 'Added to song');
    btn.replaceWith(append(el('span', { class: 'song-add-asset-in' }), 'In song'));
    if (state.songDetailId === songId) await openSongAssets(songId);
  } catch (e) {
    errEl.textContent = e.message || 'Could not reach server';
    btn.disabled = false;
  }
}

function openSongAddAssetsModal(songId, songName, assetPaths = [], options = {}) {
  songAddAssetsState.songId = songId;
  songAddAssetsState.songName = songName;
  songAddAssetsState.assetPaths = new Set(assetPaths);
  songAddAssetsState.fileFilter = options.filter || null;
  const assets = (studioState.songId === songId && studioState.assets?.length)
    ? studioState.assets
    : [...assetPaths].map((p) => ({ path: p }));
  songAddAssetsState.targetDir = resolveSongAssetDir({ name: songName }, assets);
  const filterTitles = { audio: 'Add audio', document: 'Add document' };
  const prefix = filterTitles[songAddAssetsState.fileFilter] || 'Add assets';
  document.getElementById('song-add-assets-title').textContent = prefix + ' to "' + songName + '"';
  const searchEl = document.getElementById('song-add-assets-search');
  const roleEl = document.getElementById('song-add-assets-role');
  searchEl.value = '';
  searchEl.placeholder = songAddAssetsState.fileFilter === 'audio'
    ? 'Search audio files…'
    : songAddAssetsState.fileFilter === 'document'
      ? 'Search documents…'
      : 'Search files…';
  if (roleEl) roleEl.value = songAddAssetsState.fileFilter === 'audio' ? 'Demo 1' : '';
  document.getElementById('song-add-assets-error').textContent = '';
  updateSongAddAssetsMoveUi();
  document.getElementById('song-add-assets-modal').style.display = 'flex';
  runSongAddAssetsSearch('');
  setTimeout(() => searchEl.focus(), 50);
}

function closeSongAddAssetsModal() {
  document.getElementById('song-add-assets-modal').style.display = 'none';
  songAddAssetsState = { songId: null, songName: '', assetPaths: new Set(), fileFilter: null, targetDir: '' };
}

function wireSongAddSheet() {
  const addSheet = document.getElementById('songwriting-add-sheet');
  document.getElementById('sheet-add-cancel')?.addEventListener('click', closeSongAddSheet);
  addSheet?.addEventListener('click', (e) => {
    if (e.target === addSheet) closeSongAddSheet();
  });
  document.getElementById('songwriting-add-sheet-box')?.addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('sheet-add-recording')?.addEventListener('click', () => {
    closeSongAddSheet();
    if (state.songDetailId) triggerSongAudioUpload(state.songDetailId);
    else showToast('Open a song first', 'error');
  });
  document.getElementById('sheet-add-link-audio')?.addEventListener('click', () => {
    closeSongAddSheet();
    if (!state.songDetailId) {
      showToast('Open a song first', 'error');
      return;
    }
    const songName = studioState.song?.name || '';
    const paths = (studioState.assets || []).map((a) => a.path);
    openSongAddAssetsModal(state.songDetailId, songName, paths, { filter: 'audio' });
  });
  document.getElementById('sheet-add-document')?.addEventListener('click', async () => {
    closeSongAddSheet();
    if (state.songDetailId) await createDocumentForSong(state.songDetailId);
    else showToast('Open a song first', 'error');
  });
  document.getElementById('close-upload-pick-song-modal')?.addEventListener('click', () => {
    document.getElementById('upload-pick-song-modal').style.display = 'none';
    pendingUploadFiles = null;
    pendingAfterSongPick = null;
  });
  document.getElementById('upload-pick-song-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('upload-pick-song-modal')) {
      e.target.style.display = 'none';
      pendingUploadFiles = null;
      pendingAfterSongPick = null;
    }
  });
  document.getElementById('upload-pick-song-modal-box')?.addEventListener('click', (e) => e.stopPropagation());
}

function wireFeatureEvents() {
  initNameInputModal();
  initWorkspaceSwitcher({ setWorkspace, goToSettings, leaveSettings });
  initUpload({
    loadFiles,
    openSongAssets,
    resolveSongAssetDir,
    promptSongForUpload,
    pushAppHistory,
    getStudioState: () => studioState,
  });
  wireSongAddSheet();

  document.getElementById('viewer-pdf-btn')?.addEventListener('click', exportViewerPdf);
  document.getElementById('viewer-add-song-btn')?.addEventListener('click', () => {
    if (!viewerState.relPath) return;
    if (state.workspace === 'songwriting' && state.songDetailId) {
      addSongTargetPath = viewerState.relPath;
      addFileToSong(state.songDetailId, { navigate: false });
      return;
    }
    openAddSongModal(viewerState.relPath);
  });

  document.getElementById('close-add-song-modal').addEventListener('click', closeAddSongModal);
  document.getElementById('add-song-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('add-song-modal')) closeAddSongModal();
  });
  document.getElementById('add-song-modal-box').addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('add-song-new-btn').addEventListener('click', async () => {
    const song = await createNewSongGroup();
    if (!song || !addSongTargetPath) return;
    addSongModalState.songs.push({
      id: song.id,
      name: song.name,
      asset_count: 0,
    });
    addSongModalState.songs.sort((a, b) => a.name.localeCompare(b.name));
    await addFileToSong(song.id);
  });
  document.getElementById('add-song-search').addEventListener('input', (e) => {
    clearTimeout(addSongSearchTimer);
    addSongSearchTimer = setTimeout(() => {
      addSongModalState.query = e.target.value.trim();
      renderAddSongList();
    }, 200);
  });

  document.getElementById('close-song-add-assets-modal').addEventListener('click', closeSongAddAssetsModal);
  document.getElementById('song-add-assets-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('song-add-assets-modal')) closeSongAddAssetsModal();
  });
  document.getElementById('song-add-assets-modal-box').addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('song-add-assets-search').addEventListener('input', (e) => {
    clearTimeout(songAddAssetsSearchTimer);
    const val = e.target.value.trim();
    songAddAssetsSearchTimer = setTimeout(() => runSongAddAssetsSearch(val), 300);
  });
}

function afterOpenViewer() {
  const ext = fileExt(viewerState.name);
  const pdfBtn = document.getElementById('viewer-pdf-btn');
  const addSongBtn = document.getElementById('viewer-add-song-btn');
  if (pdfBtn) pdfBtn.style.display = (ext === 'md' && !viewerState.editing) ? '' : 'none';
  if (addSongBtn) addSongBtn.style.display = viewerState.relPath ? '' : 'none';
  if (viewerState.relPath) loadViewerSongBar(viewerState.relPath);
}

function createNewSheetViaModal() {
  if (state.listMode === 'flat') {
    showToast('Clear the tag filter to create a document in a folder', 'error');
    return;
  }
  showNameInput({
    title: 'New document',
    description: 'Creates a new document in the current folder.',
    defaultValue: 'untitled',
    suffixes: NEW_SHEET_EXTENSIONS,
    defaultSuffix: '.md',
    confirmLabel: 'Create',
  }).then(async (filename) => {
    if (!filename) return;
    try {
      const r = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: state.currentDir, filename }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        showToast(data.error || 'Create failed', 'error');
        return;
      }
      showToast('Created ' + data.name);
      await loadFiles();
      openViewer({ relPath: data.path, name: data.name, tags: [], modified: data.modified }, true);
    } catch {
      showToast('Could not reach server', 'error');
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

readUrlIntoState();
wireFeatureEvents();
applyWorkspaceChrome();
bootstrapApp();
window.addEventListener('popstate', async () => {
  const prevSong = state.songDetailId;
  const prevLayout = state.songLayout;
  const prevAsset = state.studioAssetPath;
  readUrlIntoState();
  if (state.appView === 'settings') {
    refreshSettingsPage();
    applyWorkspaceChrome();
    return;
  }
  const leavingStudioEdit = studioState.editing && studioState.dirty && (
    prevSong !== state.songDetailId
    || prevLayout !== state.songLayout
    || prevAsset !== state.studioAssetPath
  );
  if (leavingStudioEdit) {
    const ok = await showConfirm({
      title: 'Discard changes?',
      message: 'You have unsaved edits. Discard them?',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) {
      history.pushState(null, '', hrefForState({
        songDetailId: prevSong,
        songLayout: prevLayout,
        studioAssetPath: prevAsset,
      }));
      state.songDetailId = prevSong;
      state.songLayout = prevLayout;
      state.studioAssetPath = prevAsset;
      return;
    }
    studioState.editing = false;
    studioState.dirty = false;
  }
  loadFiles();
});
setInterval(() => {
  if (viewerModal.style.display !== 'none' && viewerState.editing) return;
  if (state.songDetailId && !studioState.editing) return;
  if (studioState.editing) return;
  if (state.inlineRename) return;
  if (songTypeDropdown.style.display !== 'none') return;
  loadFiles();
}, 10000);

