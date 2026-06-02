/**
 * Build ES module frontend from _extracted.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public', 'js', '_extracted.js'), 'utf8');
const lines = js.split('\n');

function slice(a, b) {
  return lines.slice(a - 1, b).join('\n');
}

const out = path.join(root, 'public', 'js');
fs.mkdirSync(path.join(out, 'ui'), { recursive: true });

// ── util.js ───────────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(out, 'util.js'), slice(1, 211) + '\n\n' + slice(672, 808) + `
export {
  el, append, makeIcon, makeFilledIcon, SVG_NS, ICON_SHAPES,
  fileType, fileExt, isTextFile, isEditableFile, isPdfFile, parentDirFromPath,
  TYPE_MAP, TYPE_COLORS, TEXT_EXTENSIONS, EDITABLE_EXTENSIONS, NEW_SHEET_EXTENSIONS,
  TAG_PALETTE, tagColor, formatSize, formatDate, formatRelativeDate,
};
`);

// ── state.js ──────────────────────────────────────────────────────────────────
const stateBody = slice(213, 577)
  .replace('function updateSettingsShareDir(shareDir) {', 'export function updateSettingsShareDir(shareDir) {')
  .replace(/^const state = /m, 'export const state = ')
  .replace(/^const VALID_SORTS = /m, 'export const VALID_SORTS = ')
  .replace(/^const SETUP_RESET_CONFIRM = /m, 'export const SETUP_RESET_CONFIRM = ')
  .replace(/^function /gm, 'export function ')
  .replace(/export function updateSettingsShareDir/g, 'function updateSettingsShareDir');

// Fix double export on updateSettingsShareDir - rewrite state.js manually
const stateJs = `import { el } from './util.js';

export const state = {
  page: 1,
  tagFilter: 'all',
  view: 'browse',
  songDetailId: null,
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

export const VALID_SORTS = ['name', 'size', 'modified', 'downloads'];
export const SETUP_RESET_CONFIRM = 'fileshare';
const EXCLUDE_TAGS_KEY = 'fileshare-exclude-tags';
const SHOW_TAGS_KEY = 'fileshare-show-tags';

${slice(238, 274)}

export function applyCategorySettings(settings) {
  if (!settings) return;
  state.excludeTags = settings.excludeTags || [];
  state.showTags = settings.showTags || [];
  if (settings.shareDir) syncSharePath(settings.shareDir);
}

export function syncSharePath(shareDir) {
  if (!shareDir) return;
  state.shareDir = shareDir;
  const pathEl = document.getElementById('header-path');
  if (pathEl) {
    pathEl.textContent = shareDir;
    pathEl.title = shareDir;
  }
  const settingsEl = document.getElementById('settings-share-dir');
  if (settingsEl) settingsEl.textContent = shareDir;
}

export function markShareUnconfigured() {
  state.shareDir = '';
  const pathEl = document.getElementById('header-path');
  if (pathEl) {
    pathEl.textContent = 'Not configured';
    pathEl.title = '';
  }
  const settingsEl = document.getElementById('settings-share-dir');
  if (settingsEl) settingsEl.textContent = 'Not configured';
}

export async function fetchSetupStatus() {
  const res = await fetch('/api/setup', { cache: 'no-store' });
  if (!res.ok) throw new Error('Setup check failed');
  return res.json();
}

${slice(432, 577)}
`;

fs.writeFileSync(path.join(out, 'state.js'), stateJs.replace(
  "if (s.view === 'sheets') q.set('view', 'sheets');",
  "if (s.view === 'sheets') q.set('view', 'sheets');\n  if (s.view === 'songs') q.set('view', 'songs');\n  if (s.songDetailId) q.set('song', String(s.songDetailId));"
).replace(
  "state.view = q.get('view') === 'sheets' ? 'sheets' : 'browse';",
  `const v = q.get('view');
  state.view = v === 'sheets' ? 'sheets' : v === 'songs' ? 'songs' : 'browse';
  const songId = parseInt(q.get('song'), 10);
  state.songDetailId = Number.isFinite(songId) && songId > 0 ? songId : null;`
));

console.log('Built util.js and state.js');
