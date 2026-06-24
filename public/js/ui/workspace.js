/** App navigation, workspace, and context-aware page chrome */

import { state, persistWorkspace, WORKSPACE_KEY } from '../state.js';

export function applyWorkspaceChrome() {
  const ws = state.workspace;
  const onSong = !!state.songDetailId;
  const onSettings = state.appView === 'settings';
  const body = document.body;

  body.classList.toggle('workspace-files', ws === 'files' && !onSettings);
  body.classList.toggle('workspace-songwriting', ws === 'songwriting' && !onSettings);
  body.classList.toggle('app-view-settings', onSettings);

  const titleEl = document.getElementById('app-title');
  if (titleEl) titleEl.textContent = 'Fileshare';

  document.getElementById('nav-files-btn')?.classList.toggle('active', !onSettings && ws === 'files');
  document.getElementById('nav-songwriting-btn')?.classList.toggle('active', !onSettings && ws === 'songwriting');
  const swNav = document.getElementById('nav-songwriting-btn');
  if (swNav) swNav.hidden = !state.songwritingEnabled;

  const uploadCard = document.getElementById('upload-card');
  const filesSection = document.getElementById('files-section');
  const settingsPage = document.getElementById('settings-page');
  const uploadDetails = document.getElementById('upload-files-details');
  const tagWrap = document.getElementById('tag-select-wrap');

  if (onSettings) {
    if (uploadCard) uploadCard.style.display = 'none';
    if (filesSection) filesSection.style.display = 'none';
    if (settingsPage) settingsPage.hidden = false;
    return;
  }

  if (settingsPage) settingsPage.hidden = true;
  if (filesSection) filesSection.style.display = '';

  if (uploadCard) {
    uploadCard.classList.remove('upload-full', 'upload-compact', 'upload-hidden');
    if (ws === 'files') {
      uploadCard.classList.add('upload-full');
      uploadCard.style.display = '';
      if (uploadDetails && !uploadDetails.dataset.userToggled) {
        uploadDetails.open = window.matchMedia('(min-width: 641px)').matches;
      }
    } else if (onSong) {
      uploadCard.classList.add('upload-hidden');
      uploadCard.style.display = 'none';
    } else {
      uploadCard.classList.add('upload-compact');
      uploadCard.style.display = '';
    }
  }
  if (tagWrap) tagWrap.style.display = ws === 'songwriting' ? 'none' : '';

  const filesHeader = document.getElementById('files-header');
  if (filesHeader) filesHeader.style.display = (ws === 'songwriting' && onSong) ? 'none' : '';

  const browseTab = document.getElementById('view-tab-browse');
  const docsTab = document.getElementById('view-tab-sheets');
  const hideOtherTabs = ws === 'songwriting';
  if (browseTab) browseTab.style.display = hideOtherTabs ? 'none' : '';
  if (docsTab) docsTab.style.display = hideOtherTabs ? 'none' : '';

  const hideBrowseFilters = ws === 'songwriting' || onSong;
  const tagPills = document.getElementById('tag-pills');
  const categoryWrap = document.getElementById('category-toggles-wrap');
  const breadcrumbs = document.getElementById('breadcrumbs');
  const listToolbar = document.getElementById('list-toolbar');
  const tableWrap = document.getElementById('table-wrap');
  if (tagPills) tagPills.style.display = hideBrowseFilters ? 'none' : '';
  if (categoryWrap) categoryWrap.style.display = hideBrowseFilters ? 'none' : '';
  if (breadcrumbs && onSong) breadcrumbs.style.display = 'none';
  if (listToolbar) listToolbar.style.display = onSong ? 'none' : '';
  if (tableWrap) tableWrap.style.display = onSong ? 'none' : '';

  const studio = document.getElementById('song-studio');
  if (studio) studio.style.display = onSong ? '' : 'none';
  if (onSong) {
    document.getElementById('pagination-top')?.replaceChildren();
    document.getElementById('pagination-bottom')?.replaceChildren();
  }

  const banner = document.getElementById('flat-filter-banner');
  if (banner) {
    banner.classList.toggle('song-context-header', ws === 'songwriting');
    banner.classList.toggle('song-banner-sticky', ws === 'songwriting' && onSong);
  }

  const railWrap = document.getElementById('song-studio-rail-wrap');
  if (railWrap) railWrap.classList.toggle('studio-rail-horizontal', ws === 'songwriting' && onSong);
}

export function initWorkspaceSwitcher({ setWorkspace, goToSettings, leaveSettings }) {
  document.getElementById('nav-files-btn')?.addEventListener('click', () => {
    if (state.appView === 'settings') leaveSettings();
    setWorkspace('files');
  });
  document.getElementById('nav-songwriting-btn')?.addEventListener('click', () => {
    if (state.appView === 'settings') leaveSettings();
    if (!state.songwritingEnabled) return;
    setWorkspace('songwriting');
  });
  document.getElementById('settings-nav-btn')?.addEventListener('click', goToSettings);
  document.getElementById('settings-back-btn')?.addEventListener('click', leaveSettings);

  const uploadDetails = document.getElementById('upload-files-details');
  uploadDetails?.addEventListener('toggle', () => {
    if (uploadDetails.open) uploadDetails.dataset.userToggled = '1';
  });
}

export async function applySongwritingEnabledFromSettings(settings, { saveSettings }) {
  if (!settings) return;
  let enabled = settings.songwritingEnabled;
  if (enabled === null || enabled === undefined) {
    try {
      const hadSongwriting = localStorage.getItem(WORKSPACE_KEY) === 'songwriting';
      enabled = hadSongwriting;
      await saveSettings({ songwritingEnabled: enabled });
    } catch {
      enabled = false;
    }
  }
  state.songwritingEnabled = !!enabled;
  if (!state.songwritingEnabled && state.workspace === 'songwriting') {
    state.workspace = 'files';
    state.view = 'browse';
    state.songDetailId = null;
    state.studioAssetPath = '';
    persistWorkspace('files');
  }
  const cb = document.getElementById('songwriting-enabled-cb');
  if (cb) cb.checked = state.songwritingEnabled;
}
