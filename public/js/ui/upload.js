/** File upload — generic (Files workspace) and song-scoped (Songwriting) */

import { state } from '../state.js';
import { el, append, fileType, fileExt } from '../util.js';
import { showToast } from './toast.js';

let uploadDeps = null;

export function initUpload(deps) {
  uploadDeps = deps;
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const browseBtn = document.getElementById('browse-btn');
  const queue = document.getElementById('queue');
  const notice = document.getElementById('multi-file-notice');
  const compactBtn = document.getElementById('upload-compact-btn');
  const songAudioInput = document.getElementById('song-audio-input');
  const songAnyInput = document.getElementById('song-any-input');

  if (!dropZone || !fileInput) return;

  function handleFiles(files) {
    if (state.workspace === 'songwriting') {
      if (state.songDetailId) {
        uploadFilesForSong(state.songDetailId, files);
      } else {
        uploadDeps.promptSongForUpload(files);
      }
      return;
    }
    uploadFiles(files);
  }

  browseBtn?.addEventListener('click', () => fileInput.click());
  compactBtn?.addEventListener('click', () => {
    if (state.songDetailId) {
      songAnyInput.dataset.songId = String(state.songDetailId);
      songAnyInput.click();
    } else {
      uploadDeps.promptSongForUpload(null, () => songAnyInput.click());
    }
  });
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = '';
  });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  songAudioInput?.addEventListener('change', () => {
    const songId = songAudioInput.dataset.songId
      ? parseInt(songAudioInput.dataset.songId, 10)
      : state.songDetailId;
    if (songAudioInput.files.length && songId) {
      uploadFilesForSong(songId, songAudioInput.files, { audioOnly: true });
    }
    songAudioInput.value = '';
    delete songAudioInput.dataset.songId;
  });

  songAnyInput?.addEventListener('change', () => {
    const songId = songAnyInput.dataset.songId
      ? parseInt(songAnyInput.dataset.songId, 10)
      : state.songDetailId;
    if (songAnyInput.files.length && songId) {
      uploadFilesForSong(songId, songAnyInput.files);
    }
    songAnyInput.value = '';
    delete songAnyInput.dataset.songId;
  });

  function uploadFiles(files) {
    const tagId = document.getElementById('upload-tag-select')?.value || null;
    const arr = Array.from(files);
    if (notice) notice.style.display = arr.length > 1 ? 'block' : 'none';

    arr.forEach((file) => {
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
      xhr.upload.onprogress = (e) => {
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
          } catch { /* ignore */ }
          showToast(msg);
          uploadDeps.loadFiles();
          setTimeout(() => {
            item.remove();
            if (queue && !queue.children.length && notice) notice.style.display = 'none';
          }, 2500);
        } else {
          item.classList.add('status-error');
          showToast('Upload failed: ' + file.name, 'error');
        }
      };
      xhr.onerror = () => { item.classList.add('status-error'); showToast('Network error', 'error'); };
      xhr.send(fd);
    });
  }
}

export function triggerSongAudioUpload(songId) {
  const input = document.getElementById('song-audio-input');
  if (!input) return;
  input.dataset.songId = String(songId);
  input.click();
}

export function triggerSongAnyUpload(songId) {
  const input = document.getElementById('song-any-input');
  if (!input) return;
  input.dataset.songId = String(songId);
  input.click();
}

function inferSongAssetRole(filename) {
  const ext = fileExt(filename);
  if (fileType(filename) === 'audio') return null;
  if (['.md', '.txt', '.pro', '.cho'].includes(ext)) return 'Lyrics';
  return null;
}

export async function uploadFilesForSong(songId, files, options = {}) {
  if (!uploadDeps) return;
  const arr = Array.from(files);
  if (!arr.length) return;

  if (options.audioOnly) {
    const nonAudio = arr.filter((f) => fileType(f.name) !== 'audio');
    if (nonAudio.length) {
      showToast('Please choose audio files only', 'error');
      return;
    }
  }

  let song = null;
  let assets = [];
  if (uploadDeps.getStudioState?.().songId === songId) {
    song = uploadDeps.getStudioState().song;
    assets = uploadDeps.getStudioState().assets || [];
  }
  if (!song) {
    try {
      const r = await fetch('/api/songs/' + songId);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not load song');
      song = data;
      assets = data.assets || [];
    } catch (e) {
      showToast(e.message || 'Could not reach server', 'error');
      return;
    }
  }

  const targetDir = uploadDeps.resolveSongAssetDir(song, assets);
  let lastPath = '';

  for (const file of arr) {
    try {
      const fd = new FormData();
      fd.append('files', file);
      const r = await fetch('/api/upload?dir=' + encodeURIComponent(targetDir), { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        showToast(data.error || 'Upload failed: ' + file.name, 'error');
        continue;
      }
      const paths = data.uploaded || [];
      for (const relPath of paths) {
        const role = inferSongAssetRole(file.name);
        const body = { path: relPath };
        if (role) body.role = role;
        const addR = await fetch('/api/songs/' + songId + '/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const addData = await addR.json().catch(() => ({}));
        if (!addR.ok) {
          showToast(addData.error || 'Could not add to song', 'error');
          continue;
        }
        lastPath = relPath;
        showToast('Added ' + (file.name) + ' to song');
      }
    } catch {
      showToast('Upload failed: ' + file.name, 'error');
    }
  }

  if (lastPath) {
    state.studioAssetPath = lastPath;
    state.songDetailId = songId;
    state.view = 'songs';
    uploadDeps.pushAppHistory?.();
    await uploadDeps.openSongAssets(songId, { selectPath: lastPath });
  } else {
    await uploadDeps.openSongAssets(songId);
  }
}
