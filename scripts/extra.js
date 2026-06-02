
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

async function openAddSongModal(relPath) {
  addSongTargetPath = relPath;
  const errEl = document.getElementById('add-song-error');
  errEl.textContent = '';
  const list = document.getElementById('add-song-list');
  list.replaceChildren();
  try {
    const r = await fetch('/api/songs');
    const songs = await r.json();
    if (!songs.length) {
      list.appendChild(append(el('div', { class: 'modal-desc' }), 'No songs yet — create one below.'));
    }
    for (const s of songs) {
      const btn = el('button', {
        type: 'button',
        class: 'add-song-option',
        onclick: () => addFileToSong(s.id),
      });
      btn.textContent = s.name + (s.asset_count ? ` (${s.asset_count} assets)` : '');
      list.appendChild(btn);
    }
    document.getElementById('add-song-modal').style.display = 'flex';
  } catch {
    errEl.textContent = 'Could not load songs';
  }
}

function closeAddSongModal() {
  document.getElementById('add-song-modal').style.display = 'none';
  addSongTargetPath = '';
}

async function addFileToSong(songId) {
  const errEl = document.getElementById('add-song-error');
  const path = addSongTargetPath;
  try {
    const r = await fetch('/api/songs/' + songId + '/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = data.error || 'Failed to add';
      return;
    }
    closeAddSongModal();
    showToast('Added to song');
    if (viewerState.relPath === path) loadViewerSongBar(path);
  } catch {
    errEl.textContent = 'Could not reach server';
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

async function openSongAssets(songId) {
  state.songDetailId = songId;
  try {
    const r = await fetch('/api/songs/' + songId);
    const data = await r.json();
    if (!r.ok) throw new Error();
    const banner = document.getElementById('flat-filter-banner');
    banner.style.display = 'block';
    banner.replaceChildren(document.createTextNode('Song: '), append(el('strong'), data.name));
    const tbody = document.getElementById('file-list');
    tbody.replaceChildren();
    if (!data.assets.length) {
      tbody.appendChild(append(el('tr'), append(el('td', { colspan: '7', class: 'empty-state' }),
        'No assets yet. Add files from Browse or the viewer.')));
      return;
    }
    renderTable(data.assets.map((a) => ({
      kind: 'file',
      name: a.name,
      relPath: a.path,
      size: a.size || 0,
      modified: a.modified || new Date().toISOString(),
      tags: [],
      downloadCount: 0,
      dirLabel: parentDirFromPath(a.path),
    })), true);
    document.getElementById('pagination-top').replaceChildren();
    document.getElementById('pagination-bottom').replaceChildren();
  } catch {
    showToast('Could not load song', 'error');
  }
}

function wireFeatureEvents() {
  initNameInputModal();

  document.getElementById('viewer-pdf-btn')?.addEventListener('click', exportViewerPdf);
  document.getElementById('viewer-add-song-btn')?.addEventListener('click', () => {
    if (viewerState.relPath) openAddSongModal(viewerState.relPath);
  });

  document.getElementById('close-add-song-modal').addEventListener('click', closeAddSongModal);
  document.getElementById('add-song-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('add-song-modal')) closeAddSongModal();
  });
  document.getElementById('add-song-modal-box').addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('add-song-new-btn').addEventListener('click', async () => {
    const song = await createNewSongGroup();
    if (song && addSongTargetPath) await addFileToSong(song.id);
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
    showToast('Clear the tag filter to create a sheet in a folder', 'error');
    return;
  }
  showNameInput({
    title: 'New lyrics sheet',
    description: 'Creates a new sheet in the current folder.',
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
