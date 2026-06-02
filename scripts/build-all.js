const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'public', 'index.html');

// Use original monolithic html if backup exists, else current
let html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('<style>')) {
  const backup = path.join(root, 'public', 'index.monolith.html');
  if (fs.existsSync(backup)) html = fs.readFileSync(backup, 'utf8');
}

if (html.includes('<style>') && !fs.existsSync(path.join(root, 'public', 'index.monolith.html'))) {
  fs.writeFileSync(path.join(root, 'public', 'index.monolith.html'), html);
}

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(/<body>([\s\S]*?)<script src="\/vendor\/marked\.min\.js"><\/script>/);
const scriptMatch = html.match(/<script src="\/vendor\/marked\.min\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/);

if (!styleMatch || !bodyMatch || !scriptMatch) {
  console.error('Could not parse index.html — restore index.monolith.html');
  process.exit(1);
}

let css = styleMatch[1].replace(/^    /gm, '') + fs.readFileSync(path.join(__dirname, 'extra.css'), 'utf8');
let body = bodyMatch[1];
let js = scriptMatch[1].replace(/^  /gm, '');
const extraJs = fs.readFileSync(path.join(__dirname, 'extra.js'), 'utf8');
const extraHtml = fs.readFileSync(path.join(__dirname, 'extra.html'), 'utf8');

// HTML patches
body = body.replace(
  '<button type="button" id="view-tab-sheets" class="view-tab" title="Lyrics sheets (.md and .txt)">Sheets</button>',
  '<button type="button" id="view-tab-sheets" class="view-tab" title="Lyrics sheets (.md and .txt)">Sheets</button>\n        <button type="button" id="view-tab-songs" class="view-tab" title="Song groups">Songs</button>'
);
body = body.replace(
  '<button type="button" id="viewer-download-btn" class="btn-secondary btn-sm viewer-labeled-icon-btn">Download</button>',
  '<button type="button" id="viewer-pdf-btn" class="btn-secondary btn-sm" style="display:none">Save as PDF</button>\n        <button type="button" id="viewer-add-song-btn" class="btn-secondary btn-sm" style="display:none">Add to song…</button>\n        <button type="button" id="viewer-download-btn" class="btn-secondary btn-sm viewer-labeled-icon-btn">Download</button>'
);
body = body.replace(
  '<div id="viewer-body" class="viewer-body">',
  '<div id="viewer-song-bar" class="viewer-song-bar"></div>\n    <div id="viewer-body" class="viewer-body">'
);
body = body.replace('<div id="toast"></div>', extraHtml + '\n<div id="toast"></div>');

// JS patches
js = js.replace(
  `const NEW_SHEET_EXTENSIONS = [
    { value: '.md', label: '.md' },
    { value: '.txt', label: '.txt' },
    // ChordPro — enable when viewer support lands
    // { value: '.pro', label: '.pro' },
    // { value: '.cho', label: '.cho' },
  ];`,
  `const NEW_SHEET_EXTENSIONS = [
    { value: '.md', label: '.md' },
    { value: '.txt', label: '.txt' },
    { value: '.pro', label: '.pro' },
    { value: '.cho', label: '.cho' },
  ];`
);

js = js.replace(
  `  if (s.view === 'sheets') q.set('view', 'sheets');`,
  `  if (s.view === 'sheets') q.set('view', 'sheets');
  if (s.view === 'songs') q.set('view', 'songs');
  if (s.songDetailId) q.set('song', String(s.songDetailId));`
);

js = js.replace(
  `  state.view = q.get('view') === 'sheets' ? 'sheets' : 'browse';`,
  `  const viewParam = q.get('view');
  state.view = viewParam === 'sheets' ? 'sheets' : viewParam === 'songs' ? 'songs' : 'browse';
  const songId = parseInt(q.get('song'), 10);
  state.songDetailId = Number.isFinite(songId) && songId > 0 ? songId : null;`
);

js = js.replace(
  `function renderViewTabs() {
  document.getElementById('view-tab-browse').classList.toggle('active', state.view === 'browse');
  document.getElementById('view-tab-sheets').classList.toggle('active', state.view === 'sheets');
}`,
  `function renderViewTabs() {
  document.getElementById('view-tab-browse').classList.toggle('active', state.view === 'browse');
  document.getElementById('view-tab-sheets').classList.toggle('active', state.view === 'sheets');
  const songsTab = document.getElementById('view-tab-songs');
  if (songsTab) songsTab.classList.toggle('active', state.view === 'songs');
}`
);

js = js.replace(
  `function setView(view) {
  if (state.view === view) return;
  state.view = view;
  state.page = 1;
  state.tagFilter = 'all';
  state.currentDir = '';
  pushAppHistory();
  loadFiles();
}`,
  `function setView(view) {
  if (state.view === view) return;
  state.view = view;
  state.page = 1;
  state.tagFilter = 'all';
  state.currentDir = '';
  state.songDetailId = null;
  pushAppHistory();
  loadFiles();
}`
);

js = js.replace(
  `function renderListBanner(listMode, filterLabel) {
  const banner = document.getElementById('flat-filter-banner');
  if (listMode === 'sheets') {`,
  `function renderListBanner(listMode, filterLabel) {
  const banner = document.getElementById('flat-filter-banner');
  if (listMode === 'songs') {
    banner.style.display = 'block';
    banner.replaceChildren(document.createTextNode('Song groups — click a song to view its assets'));
    return;
  }
  if (listMode === 'sheets') {`
);

js = js.replace(
  `    } else if (fileExt(name) === 'md' && typeof marked !== 'undefined') {
      const div = el('div', { class: 'viewer-markdown' });
      div.innerHTML = marked.parse(content, { breaks: true, gfm: true });
      viewerBody.appendChild(div);`,
  `    } else if ((fileExt(name) === 'pro' || fileExt(name) === 'cho') && !editing) {
      const div = el('div', { class: 'viewer-chordpro' });
      div.innerHTML = renderChordProHtml(content);
      viewerBody.appendChild(div);
    } else if (fileExt(name) === 'md' && typeof marked !== 'undefined' && !editing) {
      const div = el('div', { class: 'viewer-markdown' });
      div.innerHTML = marked.parse(content, { breaks: true, gfm: true });
      viewerBody.appendChild(div);`
);

js = js.replace(
  `    setViewerLoading(false);
  }
}`,
  `    setViewerLoading(false);
    afterOpenViewer();
  }
}`
);

js = js.replace(
  `      const tagTd = el('td', { class: 'col-tag' });
      const actionsTd = el('td', { class: 'col-actions' });

      const row = append(el('tr', { class: 'row-folder' }),`,
  `      const tagTd = el('td', { class: 'col-tag' });
      renderFileTagsCell(tagTd, { relPath: item.relPath, tags: item.tags || [], kind: 'folder' });
      const actionsTd = el('td', { class: 'col-actions' });

      const row = append(el('tr', { class: 'row-folder' }),`
);

js = js.replace(
  `  for (const item of items) {
    if (item.kind === 'folder') {`,
  `  for (const item of items) {
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
      const row = append(el('tr', { class: 'row-song' }),
        iconTd, nameTd,
        append(el('td', { class: 'col-size' }), '—'),
        modifiedCell(item.modified),
        append(el('td', { class: 'col-downloads' }), '—'),
        el('td', { class: 'col-tag' }),
        el('td', { class: 'col-actions' }));
      row.addEventListener('click', () => openSongAssets(item.id));
      tbody.appendChild(row);
      continue;
    }
    if (item.kind === 'folder') {`
);

js = js.replace(
  `    else if (state.listMode === 'sheets') td.textContent = 'No sheets yet. Create one with New sheet, or upload .md or .txt files.';`,
  `    else if (state.listMode === 'songs') td.textContent = 'No songs yet. Create one with + New song or add files from Browse.';
    else if (state.listMode === 'sheets') td.textContent = 'No sheets yet. Create one with New sheet, or upload .md or .txt files.';`
);

js = js.replace(
  `      if (state.view === 'sheets') params.set('view', 'sheets');`,
  `      if (state.view === 'sheets') params.set('view', 'sheets');
      if (state.view === 'songs') params.set('view', 'songs');`
);

js = js.replace(
  `      const flatList = state.listMode === 'flat' || state.listMode === 'sheets';`,
  `      if (state.view === 'songs' && state.songDetailId) {
        await openSongAssets(state.songDetailId);
        return;
      }
      const flatList = state.listMode === 'flat' || state.listMode === 'sheets' || state.listMode === 'songs';`
);

js = js.replace(
  `      document.getElementById('new-sheet-btn').style.display = state.listMode === 'flat' ? 'none' : '';`,
  `      document.getElementById('new-sheet-btn').style.display = (state.listMode === 'flat' || state.listMode === 'songs') ? 'none' : '';
      let newSongBtn = document.getElementById('new-song-btn');
      if (!newSongBtn && state.listMode === 'songs') {
        newSongBtn = el('button', { type: 'button', id: 'new-song-btn', class: 'btn-secondary btn-sm' });
        newSongBtn.textContent = '+ New song';
        newSongBtn.addEventListener('click', async () => {
          const song = await createNewSongGroup();
          if (song) { await loadFiles(); openSongAssets(song.id); }
        });
        document.querySelector('.files-header-actions')?.prepend(newSongBtn);
      } else if (newSongBtn) {
        newSongBtn.style.display = state.listMode === 'songs' ? '' : 'none';
      }`
);

js = js.replace(
  `function createNewSheet() {
    if (state.listMode === 'flat') {
      showToast('Clear the tag filter to create a sheet in a folder', 'error');
      return;
    }
    openNewSheetModal();
  }

  document.getElementById('new-sheet-btn').addEventListener('click', createNewSheet);`,
  `document.getElementById('new-sheet-btn').addEventListener('click', createNewSheetViaModal);`
);

js = js.replace(
  '// ── Init ──────────────────────────────────────────────────────',
  extraJs + '\n// ── Init ──────────────────────────────────────────────────────'
);

js = js.replace(
  `document.getElementById('view-tab-browse').addEventListener('click', () => setView('browse'));
document.getElementById('view-tab-sheets').addEventListener('click', () => setView('sheets'));`,
  `document.getElementById('view-tab-browse').addEventListener('click', () => setView('browse'));
document.getElementById('view-tab-sheets').addEventListener('click', () => setView('sheets'));
document.getElementById('view-tab-songs')?.addEventListener('click', () => setView('songs'));`
);

js = js.replace(
  `readUrlIntoState();
initNewSheetExtSelect();
bootstrapApp();`,
  `readUrlIntoState();
initNewSheetExtSelect();
wireFeatureEvents();
bootstrapApp();`
);

// Patch tag dropdown for folders
js = js.replace(
  `function openTagDropdown(anchor, relPath, tags, tagIds) {`,
  `function openTagDropdown(anchor, relPath, tags, tagIds, isFolder) {`
);

js = js.replace(
  `async function assignTag(relPath, tagId) {
    try {
      const r = await fetch('/api/files/tag', {`,
  `async function assignTag(relPath, tagId, isFolder) {
    try {
      const url = isFolder ? '/api/folders/tag' : '/api/files/tag';
      const r = await fetch(url, {`
);

js = js.replace(
  `      assignTag(relPath, tagId);`,
  `      assignTag(relPath, tagId, isFolder);`
);

js = js.replace(
  `function renderFileTagsCell(td, file) {`,
  `function renderFileTagsCell(td, file) {
  const isFolder = file.kind === 'folder';`
);

js = js.replace(
  `      openTagDropdown(badge, file.relPath, state.tags, file.tags.map(t => t.id));`,
  `      openTagDropdown(badge, file.relPath, state.tags, file.tags.map(t => t.id), isFolder);`
);

js = js.replace(
  `      openTagDropdown(empty, file.relPath, state.tags, []);`,
  `      openTagDropdown(empty, file.relPath, state.tags, [], isFolder);`
);

const thinHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fileshare</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/css/app.css?v=__BUILD_ID__" />
</head>
<body>
${body}
<script src="/vendor/marked.min.js?v=__BUILD_ID__"></script>
<script type="module" src="/js/main.js?v=__BUILD_ID__"></script>
</body>
</html>
`;

fs.mkdirSync(path.join(root, 'public', 'css'), { recursive: true });
fs.mkdirSync(path.join(root, 'public', 'js', 'ui'), { recursive: true });
fs.writeFileSync(path.join(root, 'public', 'css', 'app.css'), css);
fs.writeFileSync(path.join(root, 'public', 'index.html'), thinHtml);

// Split into ES modules
const lines = js.split('\n');
function slice(a, b) { return lines.slice(a - 1, b).join('\n'); }

fs.writeFileSync(path.join(root, 'public', 'js', 'util.js'),
  slice(1, 211) + '\n\n' + slice(672, 808) + `
export { el, append, makeIcon, makeFilledIcon, fileType, fileExt, isTextFile, isEditableFile, isPdfFile,
  parentDirFromPath, formatSize, formatDate, tagColor, TYPE_MAP, TYPE_COLORS, NEW_SHEET_EXTENSIONS };
`);

fs.writeFileSync(path.join(root, 'public', 'js', 'ui', 'toast.js'),
  slice(579, 588) + `\nexport { showToast };\n`
);

const modalsJs = slice(590, 670) + '\n\n' + slice(1899, 2137);
fs.writeFileSync(path.join(root, 'public', 'js', 'ui', 'modals.js'),
  `import { el, append, makeIcon, NEW_SHEET_EXTENSIONS } from '../util.js';
import { state, SETUP_RESET_CONFIRM, applyCategorySettings, syncSharePath, markShareUnconfigured, fetchSetupStatus } from '../state.js';
import { showToast } from './toast.js';
import { loadFiles } from './file-list.js';
import { openViewer } from './viewer.js';

` + modalsJs + `
export {
  showConfirm, closeConfirmModal, initNewSheetExtSelect,
  openSettingsModal, closeSettingsModal, openResetStorageModal, closeResetStorageModal,
  executeResetStorage, updateResetStorageConfirmBtn, bootstrapApp, checkSetup, submitSetup,
  showSetupModal, hideSetupModal, saveCategorySettings, maybeMigrateLocalSettings,
  handleCreateTag, handleDeleteTag, renderTagManager, renderExcludeTagsSettings, renderCategoryToggles,
  openRestartModal, closeRestartModal, executeRestartServer,
};
`);

// For circular deps - use single app.js bundle + thin module re-exports
const appJs = `import { renderChordProHtml } from './chordpro.js';

${js}
`;
fs.writeFileSync(path.join(root, 'public', 'js', 'app.js'), appJs);

// state.js standalone for module structure
const stateBlock = slice(213, 577);
fs.writeFileSync(path.join(root, 'public', 'js', 'state.js'),
  `import { el } from './util.js';\n\n` + stateBlock.replace(
    'const state = {',
    'export const state = {\n  songDetailId: null,'
  ).replace(/^const VALID_SORTS/m, 'export const VALID_SORTS')
    .replace(/^const SETUP_RESET_CONFIRM/m, 'export const SETUP_RESET_CONFIRM')
    .replace(/^function /gm, 'export function ')
  + `\n`
);

fs.writeFileSync(path.join(root, 'public', 'js', 'ui', 'file-list.js'), '// re-exported via app.js\nexport {};\n');
fs.writeFileSync(path.join(root, 'public', 'js', 'ui', 'viewer.js'), '// re-exported via app.js\nexport {};\n');
fs.writeFileSync(path.join(root, 'public', 'js', 'ui', 'upload.js'), '// re-exported via app.js\nexport {};\n');

fs.writeFileSync(path.join(root, 'public', 'js', 'main.js'), `import './app.js';\n`);

console.log('Build complete: index.html, app.css, app.js, main.js, util.js, state.js, chordpro.js');
