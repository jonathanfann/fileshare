/**
 * Splits _extracted.js into ES modules and generates main.js init wiring.
 * Run: node scripts/split-frontend.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public', 'js');
const src = fs.readFileSync(path.join(root, '_extracted.js'), 'utf8');
const lines = src.split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function writeModule(relPath, header, body, footer = '') {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, header + body + footer);
}

// ── util.js ──────────────────────────────────────────────────────────────────
writeModule(
  'util.js',
  '',
  slice(1, 211) + '\n\n' + slice(672, 808)
);

// ── state.js ─────────────────────────────────────────────────────────────────
writeModule(
  'state.js',
  `import { el } from './util.js';\n\n`,
  slice(213, 577),
  `\nexport {\n  state, VALID_SORTS, SETUP_RESET_CONFIRM,\n  loadLocalCategoryTagIds, clearLocalCategoryTagIds, applyCategorySettings,\n  syncSharePath, markShareUnconfigured, fetchSetupStatus,\n  readUrlIntoState, replaceAppHistoryIfNeeded, pushAppHistory,\n  navigateToDir, setTagFilter, setView, setSearch, setSort, setPage,\n};\n`
);

// ── toast.js ─────────────────────────────────────────────────────────────────
writeModule(
  'ui/toast.js',
  '',
  slice(579, 588),
  `\nexport { showToast };\n`
);

// ── modals.js (confirm + new-sheet + settings + restart handlers) ───────────
writeModule(
  'ui/modals.js',
  `import { el, append, makeIcon, NEW_SHEET_EXTENSIONS } from '../util.js';\nimport { state, SETUP_RESET_CONFIRM, applyCategorySettings, syncSharePath, markShareUnconfigured, fetchSetupStatus } from '../state.js';\nimport { showToast } from './toast.js';\n\n`,
  slice(590, 670) + '\n\n' + slice(1899, 2137),
  `\nexport {\n  showConfirm, closeConfirmModal,\n  initNewSheetExtSelect, openNewSheetModal, closeNewSheetModal, submitNewSheet, createNewSheet,\n  openSettingsModal, closeSettingsModal,\n  openResetStorageModal, closeResetStorageModal, updateResetStorageConfirmBtn, executeResetStorage,\n  renderTagManager, renderExcludeTagsSettings, renderCategoryToggles, handleDeleteTag, handleCreateTag,\n  showSetupModal, hideSetupModal, checkSetup, submitSetup, bootstrapApp, saveCategorySettings, maybeMigrateLocalSettings,\n  openRestartModal, closeRestartModal, executeRestart,\n};\n`
);

// ── file-list.js ─────────────────────────────────────────────────────────────
writeModule(
  'ui/file-list.js',
  `import { el, append, makeIcon, makeFilledIcon, fileType, fileExt, formatSize, formatDate, tagColor, parentDirFromPath } from '../util.js';\nimport { state, applyCategorySettings, syncSharePath, pushAppHistory, replaceAppHistoryIfNeeded, navigateToDir, setTagFilter, setView, setSearch, setSort, setPage, checkSetup } from '../state.js';\nimport { showToast } from './toast.js';\nimport { showConfirm, openSettingsModal } from './modals.js';\n\n`,
  slice(810, 1187) + '\n\n' + slice(1670, 1862) + '\n\n' + slice(1864, 1897),
  `\nexport {\n  renderTagPills, renderPagination, renderBreadcrumbs, renderListBanner, renderViewTabs, renderSortHeaders,\n  renderTable, loadFiles, updateUploadTagSelect, assignTag, deleteFile, downloadFile,\n  listSearchEl,\n};\n`
);

// ── viewer.js ────────────────────────────────────────────────────────────────
writeModule(
  'ui/viewer.js',
  `import { el, append, makeIcon, makeFilledIcon, fileType, fileExt, isTextFile, isEditableFile, isPdfFile, parentDirFromPath } from '../util.js';\nimport { state } from '../state.js';\nimport { showToast } from './toast.js';\nimport { showConfirm } from './modals.js';\nimport { assignTag, loadFiles } from './file-list.js';\n\n`,
  slice(1189, 1668),
  `\nexport { openViewer, tryCloseViewer, closeViewer };\n`
);

// ── upload.js ────────────────────────────────────────────────────────────────
writeModule(
  'ui/upload.js',
  `import { el } from '../util.js';\nimport { state } from '../state.js';\nimport { showToast } from './toast.js';\nimport { loadFiles } from './file-list.js';\n\n`,
  slice(2139, 2238),
  `\nexport { initUpload };\n`
);

// ── main.js ──────────────────────────────────────────────────────────────────
const mainBody = slice(2240, 2254);
writeModule(
  'main.js',
  `import { state } from './state.js';\nimport { readUrlIntoState } from './state.js';\nimport {\n  initNewSheetExtSelect, bootstrapApp, submitSetup, closeSetupModal,\n  showConfirm, closeConfirmModal, closeNewSheetModal, submitNewSheet, createNewSheet,\n  openSettingsModal, closeSettingsModal, openResetStorageModal, closeResetStorageModal,\n  executeResetStorage, updateResetStorageConfirmBtn, openRestartModal, closeRestartModal, executeRestart,\n} from './ui/modals.js';\nimport { loadFiles, listSearchEl, renderTable } from './ui/file-list.js';\nimport { openViewer, tryCloseViewer, closeViewer } from './ui/viewer.js';\nimport { initUpload } from './ui/upload.js';\n\n`,
  mainBody.replace(/^readUrlIntoState/m, '// wired below\nreadUrlIntoState')
);

console.log('Split complete. Manual fixes may be needed for init event listeners.');
