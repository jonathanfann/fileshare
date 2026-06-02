/**
 * Builds thin index.html + ES module frontend from monolithic index.html source.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(/<body>([\s\S]*?)<script src="\/vendor\/marked\.min\.js"><\/script>/);
const scriptMatch = html.match(/<script src="\/vendor\/marked\.min\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/);

if (!styleMatch || !bodyMatch || !scriptMatch) {
  console.error('Could not parse index.html');
  process.exit(1);
}

let css = styleMatch[1].replace(/^    /gm, '');
let js = scriptMatch[1].replace(/^  /gm, '');

// ── Extra CSS ───────────────────────────────────────────────────────────────
css += `

/* Print / PDF export */
@media print {
  body * { visibility: hidden; }
  #viewer-modal, #viewer-modal * { visibility: visible; }
  #viewer-modal {
    position: fixed; inset: 0; display: flex !important;
    background: #fff !important; padding: 0; margin: 0;
  }
  .viewer-toolbar, .viewer-meta, .viewer-song-bar, #viewer-close-btn,
  #viewer-edit-btn, #viewer-save-btn, #viewer-cancel-edit-btn,
  #viewer-download-btn, #viewer-pdf-btn, #viewer-add-song-btn, .viewer-tags { display: none !important; }
  #viewer-panel { box-shadow: none; border: none; max-width: none; width: 100%; }
  .viewer-body { overflow: visible; padding: 24px; }
  .viewer-markdown, .viewer-chordpro {
    color: #111 !important; background: #fff !important;
  }
  .viewer-markdown a { color: #06c !important; }
}

#name-input-modal { z-index: 220; }
.name-input-row {
  display: flex; gap: 8px; align-items: stretch; margin-top: 12px;
}
.name-input-row input {
  flex: 1; min-width: 0; padding: 10px 12px; border-radius: 8px;
  border: 1px solid #333; background: #111; color: #e8e8e8; font: inherit;
}
.name-input-row input:focus { outline: none; border-color: #4a9eff; }
.name-input-row select {
  padding: 10px 12px; border-radius: 8px; border: 1px solid #333;
  background: #111; color: #e8e8e8; font: inherit;
}
#name-input-error { color: #ff7777; font-size: 0.8rem; margin-top: 8px; min-height: 1.2em; }

.viewer-song-bar {
  display: none; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 8px 16px; border-bottom: 1px solid #2a2a2a; background: #141414;
}
.viewer-song-bar.show { display: flex; }
.viewer-song-label { font-size: 0.75rem; color: #888; margin-right: 4px; }
.viewer-song-chip {
  padding: 4px 10px; border-radius: 999px; border: 1px solid #333;
  background: #1a1a1a; color: #ccc; font-size: 0.75rem; cursor: pointer;
  font-family: inherit;
}
.viewer-song-chip:hover { border-color: #4a9eff; color: #e8e8e8; }
.viewer-song-chip.active { border-color: #4a9eff; background: #1a2a3a; color: #4a9eff; }
.viewer-song-chip .role { opacity: 0.7; margin-left: 4px; }

.viewer-chordpro { padding: 20px; line-height: 1.6; max-width: 720px; margin: 0 auto; }
.viewer-chordpro .cp-title { font-size: 1.4rem; font-weight: 700; margin-bottom: 4px; }
.viewer-chordpro .cp-artist { color: #888; margin-bottom: 16px; }
.viewer-chordpro .cp-section { margin: 16px 0; }
.viewer-chordpro .cp-line { margin: 4px 0; font-family: 'Courier New', monospace; white-space: pre; }
.viewer-chordpro .cp-chords { color: #4a9eff; min-height: 1.2em; }
.viewer-chordpro .cp-lyrics { color: #e8e8e8; }

.row-song .col-icon svg { color: #b04aff; }
.song-asset-count { font-size: 0.75rem; color: #888; margin-left: 6px; }

#add-song-modal { z-index: 218; }
.add-song-list { max-height: 200px; overflow-y: auto; margin: 12px 0; }
.add-song-option {
  display: block; width: 100%; text-align: left; padding: 8px 12px;
  border: 1px solid #2a2a2a; border-radius: 8px; background: #141414;
  color: #e8e8e8; font: inherit; cursor: pointer; margin-bottom: 6px;
}
.add-song-option:hover { border-color: #4a9eff; }
`;

// ── Patch JS: chordpro, name modal, songs, pdf, folder tags ───────────────────
const featurePatch = fs.readFileSync(path.join(__dirname, 'frontend-features.js'), 'utf8');
js = js.replace(
  `  const NEW_SHEET_EXTENSIONS = [
    { value: '.md', label: '.md' },
    { value: '.txt', label: '.txt' },
    // ChordPro — enable when viewer support lands
    // { value: '.pro', label: '.pro' },
    // { value: '.cho', label: '.cho' },
  ];`,
  `  const NEW_SHEET_EXTENSIONS = [
    { value: '.md', label: '.md' },
    { value: '.txt', label: '.txt' },
    { value: '.pro', label: '.pro' },
    { value: '.cho', label: '.cho' },
  ];`
);

js = js.replace(
  `  const state = {
    page: 1,
    tagFilter: 'all',
    view: 'browse',`,
  `  const state = {
    page: 1,
    tagFilter: 'all',
    view: 'browse',
    songDetailId: null,`
);

js = js.replace(
  `  function renderViewTabs() {
    const browseBtn = document.getElementById('view-tab-browse');
    const sheetsBtn = document.getElementById('view-tab-sheets');
    if (!browseBtn || !sheetsBtn) return;
    browseBtn.classList.toggle('active', state.view === 'browse');
    sheetsBtn.classList.toggle('active', state.view === 'sheets');
  }`,
  `  function renderViewTabs() {
    const browseBtn = document.getElementById('view-tab-browse');
    const sheetsBtn = document.getElementById('view-tab-sheets');
    const songsBtn = document.getElementById('view-tab-songs');
    if (!browseBtn || !sheetsBtn) return;
    browseBtn.classList.toggle('active', state.view === 'browse');
    sheetsBtn.classList.toggle('active', state.view === 'sheets');
    if (songsBtn) songsBtn.classList.toggle('active', state.view === 'songs');
  }`
);

// Insert features before Init section
js = js.replace(
  '// ── Init ──────────────────────────────────────────────────────',
  featurePatch + '\n// ── Init ──────────────────────────────────────────────────────'
);

// ── HTML patches ──────────────────────────────────────────────────────────────
let body = bodyMatch[1];

body = body.replace(
  `<button type="button" id="view-tab-sheets" class="view-tab" title="Lyrics sheets (.md and .txt)">Sheets</button>`,
  `<button type="button" id="view-tab-sheets" class="view-tab" title="Lyrics sheets (.md and .txt)">Sheets</button>
        <button type="button" id="view-tab-songs" class="view-tab" title="Song groups">Songs</button>`
);

body = body.replace(
  `<button type="button" id="viewer-download-btn" class="btn-secondary btn-sm viewer-labeled-icon-btn">Download</button>`,
  `<button type="button" id="viewer-pdf-btn" class="btn-secondary btn-sm" style="display:none">Save as PDF</button>
        <button type="button" id="viewer-add-song-btn" class="btn-secondary btn-sm" style="display:none">Add to song…</button>
        <button type="button" id="viewer-download-btn" class="btn-secondary btn-sm viewer-labeled-icon-btn">Download</button>`
);

body = body.replace(
  `<div id="viewer-body" class="viewer-body">`,
  `<div id="viewer-song-bar" class="viewer-song-bar"></div>
    <div id="viewer-body" class="viewer-body">`
);

const extraModals = `
<!-- Reusable name input -->
<div id="name-input-modal" class="modal-overlay" style="display:none">
  <div class="modal" id="name-input-modal-box">
    <div class="modal-header">
      <h3 id="name-input-title">Name</h3>
      <button type="button" class="modal-close" id="close-name-input-modal" title="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <p class="modal-desc" id="name-input-desc"></p>
    <div class="name-input-row">
      <input type="text" id="name-input-field" spellcheck="false" autocomplete="off" />
      <select id="name-input-suffix" style="display:none" aria-label="Suffix"></select>
    </div>
    <div id="name-input-error"></div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="name-input-cancel-btn">Cancel</button>
      <button type="button" class="btn" id="name-input-confirm-btn">Confirm</button>
    </div>
  </div>
</div>

<!-- Add file to song -->
<div id="add-song-modal" class="modal-overlay" style="display:none">
  <div class="modal" id="add-song-modal-box">
    <div class="modal-header">
      <h3>Add to song</h3>
      <button type="button" class="modal-close" id="close-add-song-modal" title="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <p class="modal-desc">Choose a song group or create a new one.</p>
    <div id="add-song-list" class="add-song-list"></div>
    <button type="button" class="btn-secondary btn-sm" id="add-song-new-btn">+ New song…</button>
    <div id="add-song-error"></div>
  </div>
</div>
`;

body = body.replace('<div id="toast"></div>', extraModals + '\n<div id="toast"></div>');

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

// ── Split JS into modules ─────────────────────────────────────────────────────
const sections = {
  'util.js': [[1, 211], [672, 808]],
  'state.js': [[213, 577]],
  'ui/toast.js': [[579, 588]],
  'ui/modals-core.js': [[590, 670]],
  'ui/file-list-core.js': [[810, 1187], [1670, 1862], [1864, 1897]],
  'ui/viewer-core.js': [[1189, 1668]],
  'ui/settings.js': [[1899, 2137]],
  'ui/upload.js': [[2139, 2238]],
};

function sliceLines(ranges) {
  return ranges.map(([a, b]) => linesSlice(js, a, b)).join('\n\n');
}

function linesSlice(text, start, end) {
  return text.split('\n').slice(start - 1, end).join('\n');
}

const jsLines = js.split('\n');
function slice(start, end) {
  return jsLines.slice(start - 1, end).join('\n');
}

const outJs = path.join(root, 'public', 'js');
fs.mkdirSync(path.join(outJs, 'ui'), { recursive: true });
fs.mkdirSync(path.join(root, 'public', 'css'), { recursive: true });

fs.writeFileSync(path.join(root, 'public', 'css', 'app.css'), css);

// util.js
fs.writeFileSync(path.join(outJs, 'util.js'), slice(1, 211) + '\n\n' + slice(672, 808) + `
export {
  el, append, makeIcon, makeFilledIcon, fileType, fileExt, isTextFile, isEditableFile, isPdfFile,
  parentDirFromPath, formatSize, formatDate, tagColor, TYPE_MAP, TYPE_COLORS,
  NEW_SHEET_EXTENSIONS, TEXT_EXTENSIONS, EDITABLE_EXTENSIONS, VALID_SORTS as UTIL_VALID_SORTS,
};
`);

// chordpro.js
fs.writeFileSync(path.join(outJs, 'chordpro.js'), fs.readFileSync(path.join(__dirname, 'chordpro.js'), 'utf8'));

// features.js  
fs.writeFileSync(path.join(outJs, 'features.js'), featurePatch + `
export {
  showNameInput, parseChordPro, renderChordProHtml, loadViewerSongBar,
  openAddSongModal, closeAddSongModal, exportViewerPdf, assignFolderTag,
  renderSongTableRow, openSongDetail, createNewSong,
};
`);

// state.js - needs patch for VALID_SORTS export
let stateJs = slice(213, 577);
stateJs = stateJs.replace('function updateSettingsShareDir(shareDir)', `
function updateSettingsShareDir(shareDir) {
  const el = document.getElementById('settings-share-dir');
  if (el) el.textContent = shareDir || 'Not configured';
}

function _updateSettingsShareDirOrig(shareDir)`);
// Actually state calls updateSettingsShareDir from modals - inline it
stateJs = stateJs.replace(/updateSettingsShareDir\(shareDir\)/g, '(function(d){ const el = document.getElementById("settings-share-dir"); if (el) el.textContent = d || "Not configured"; })(shareDir)');

fs.writeFileSync(path.join(outJs, 'state.js'), `import { VALID_SORTS } from './util.js';\n\n` + stateJs + `
export {
  state, SETUP_RESET_CONFIRM, loadLocalCategoryTagIds, clearLocalCategoryTagIds,
  applyCategorySettings, syncSharePath, markShareUnconfigured, fetchSetupStatus,
  readUrlIntoState, replaceAppHistoryIfNeeded, pushAppHistory,
  navigateToDir, setTagFilter, setView, setSearch, setSort, setPage,
  bootstrapApp, checkSetup, submitSetup, showSetupModal, hideSetupModal,
  maybeMigrateLocalSettings, saveCategorySettings,
};
`);

console.log('Wrote CSS and module stubs — run feature merge manually');

// Write monolithic main.js importing features (simplest working approach)
const mainJs = `import { parseChordPro, renderChordProHtml } from './chordpro.js';
import * as features from './features.js';

${js}

Object.assign(globalThis, features);
`;

fs.writeFileSync(path.join(outJs, 'main.js'), mainJs);
fs.writeFileSync(htmlPath, thinHtml);

console.log('Built index.html and main.js');
