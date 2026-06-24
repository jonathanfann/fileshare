/** Shared application state and workspace persistence */

export const WORKSPACE_KEY = 'fileshare-workspace';
export const VALID_SORTS = ['name', 'size', 'modified', 'downloads'];
export const SETUP_RESET_CONFIRM = 'fileshare';
export const EXCLUDE_TAGS_KEY = 'fileshare-exclude-tags';
export const SHOW_TAGS_KEY = 'fileshare-show-tags';

export function loadWorkspaceFromStorage() {
  try {
    const w = localStorage.getItem(WORKSPACE_KEY);
    if (w === 'songwriting' || w === 'files') return w;
  } catch { /* ignore */ }
  return 'files';
}

export function persistWorkspace(workspace) {
  try {
    localStorage.setItem(WORKSPACE_KEY, workspace);
  } catch { /* ignore */ }
}

export const state = {
  page: 1,
  tagFilter: 'all',
  view: 'browse',
  appView: 'main',
  workspace: loadWorkspaceFromStorage(),
  songwritingEnabled: false,
  songDetailId: null,
  songLayout: 'studio',
  studioAssetPath: '',
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
