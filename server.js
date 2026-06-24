const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'fileshare.db');
const ENV_SHARE_DIR = process.env.SHARE_DIR ? path.resolve(process.env.SHARE_DIR) : null;
const ENV_DISPLAY_SHARE_DIR = process.env.DISPLAY_SHARE_DIR
  ? String(process.env.DISPLAY_SHARE_DIR).trim()
  : null;
const IS_DOCKER = process.env.DOCKER === '1' || process.env.DOCKER === 'true';
const LEGACY_DEFAULT_SHARE = path.join('D:', 'Fileshare');

// ── Path safety (all file ops stay under the configured share root) ───────────

function safeResolveDir(relRaw) {
  const shareRoot = getShareRoot();
  if (!shareRoot) return null;
  const rel = String(relRaw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const parts = rel.split('/').filter((p) => p.length && p !== '.' && p !== '..');
  const full = path.resolve(shareRoot, ...parts);
  const root = path.resolve(shareRoot);
  const sep = path.sep;
  if (full !== root && !full.startsWith(root + sep)) return null;
  return { full, relative: parts.join('/') };
}

function posixRel(dirRelative, baseName) {
  const d = (dirRelative || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return d ? path.posix.join(d, baseName) : baseName;
}

function decodeRelPath(q) {
  try {
    const raw = decodeURIComponent(String(q || ''));
    const rel = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = rel.split('/').filter((p) => p.length && p !== '.' && p !== '..');
    return parts.join('/');
  } catch {
    return null;
  }
}

/** Absolute path to a file under the share root, or null if invalid / missing / not a file */
function resolveExistingFile(rel) {
  const shareRoot = getShareRoot();
  if (!shareRoot || !rel) return null;
  const segments = rel.split('/');
  const base = segments.pop();
  if (!base) return null;
  const dirResolved = safeResolveDir(segments.join('/'));
  if (!dirResolved) return null;
  const abs = path.join(dirResolved.full, base);
  const root = path.resolve(shareRoot);
  const resolvedAbs = path.resolve(abs);
  if (resolvedAbs !== root && !resolvedAbs.startsWith(root + path.sep)) return null;
  try {
    const st = fs.statSync(resolvedAbs);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return resolvedAbs;
}

// ── Database ─────────────────────────────────────────────────────────────────

const dbDir = path.dirname(DB_PATH);
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.prepare(`
  CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS files (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    filename       TEXT    NOT NULL UNIQUE,
    tag_id         INTEGER REFERENCES tags(id) ON DELETE SET NULL,
    deleted        INTEGER NOT NULL DEFAULT 0,
    deleted_at     TEXT,
    uploaded_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    download_count INTEGER NOT NULL DEFAULT 0
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS file_tags (
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, tag_id)
  )
`).run();

db.prepare(`
  INSERT OR IGNORE INTO file_tags (file_id, tag_id)
  SELECT id, tag_id FROM files WHERE tag_id IS NOT NULL AND deleted = 0
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '[]'
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS songs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS song_assets (
    song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    file_path  TEXT    NOT NULL,
    role       TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (song_id, file_path)
  )
`).run();

try {
  db.prepare('SELECT notes FROM songs LIMIT 1').get();
} catch {
  db.prepare(`ALTER TABLE songs ADD COLUMN notes TEXT NOT NULL DEFAULT ''`).run();
}

try {
  db.prepare('SELECT notes FROM song_assets LIMIT 1').get();
} catch {
  db.prepare(`ALTER TABLE song_assets ADD COLUMN notes TEXT NOT NULL DEFAULT ''`).run();
}
try {
  db.prepare('SELECT track_labels FROM song_assets LIMIT 1').get();
} catch {
  db.prepare(`ALTER TABLE song_assets ADD COLUMN track_labels TEXT NOT NULL DEFAULT '[]'`).run();
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS song_tags (
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (song_id, tag_id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS folder_tags (
    folder_path TEXT    NOT NULL,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_path, tag_id)
  )
`).run();

const MAX_TAGS_PER_FILE = 2;

// Prepared statements (filename = path relative to share root, e.g. sub/file.txt)
const stmts = {
  getFile: db.prepare('SELECT * FROM files WHERE filename = ?'),
  upsertFile: db.prepare(`
    INSERT INTO files (filename, uploaded_at, download_count, deleted, deleted_at)
    VALUES (?, datetime('now'), 0, 0, NULL)
    ON CONFLICT(filename) DO UPDATE SET
      deleted = 0, deleted_at = NULL, uploaded_at = datetime('now')
  `),
  softDelete: db.prepare(`UPDATE files SET deleted = 1, deleted_at = datetime('now') WHERE filename = ?`),
  incrementDownload: db.prepare(`UPDATE files SET download_count = download_count + 1 WHERE filename = ? AND deleted = 0`),
  getAllActiveFiles: db.prepare('SELECT id, filename, download_count FROM files WHERE deleted = 0'),
  getAllFileTags: db.prepare(`
    SELECT f.filename, t.id, t.name
    FROM file_tags ft
    JOIN files f ON f.id = ft.file_id
    JOIN tags t ON t.id = ft.tag_id
    WHERE f.deleted = 0
    ORDER BY t.name
  `),
  getFileTagIds: db.prepare('SELECT tag_id FROM file_tags WHERE file_id = ?'),
  addFileTag: db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)'),
  removeFileTag: db.prepare('DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?'),
  clearFileTags: db.prepare('DELETE FROM file_tags WHERE file_id = ?'),
  countFileTags: db.prepare('SELECT COUNT(*) AS n FROM file_tags WHERE file_id = ?'),
  getAllTags: db.prepare(`
    SELECT t.id, t.name, t.created_at, COUNT(DISTINCT f.id) AS file_count
    FROM tags t
    LEFT JOIN file_tags ft ON ft.tag_id = t.id
    LEFT JOIN files f ON f.id = ft.file_id AND f.deleted = 0
    GROUP BY t.id
    ORDER BY t.name
  `),
  getTagById: db.prepare('SELECT * FROM tags WHERE id = ?'),
  createTag: db.prepare('INSERT INTO tags (name) VALUES (?)'),
  deleteTag: db.prepare('DELETE FROM tags WHERE id = ?'),
  renameFile: db.prepare(`UPDATE files SET filename = ? WHERE filename = ? AND deleted = 0`),
  getSetting: db.prepare('SELECT value FROM app_settings WHERE key = ?'),
  setSetting: db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
  getAllSongs: db.prepare(`
    SELECT s.id, s.name, s.created_at, COUNT(sa.file_path) AS asset_count
    FROM songs s
    LEFT JOIN song_assets sa ON sa.song_id = s.id
    GROUP BY s.id
    ORDER BY s.name COLLATE NOCASE
  `),
  getSong: db.prepare('SELECT * FROM songs WHERE id = ?'),
  createSong: db.prepare('INSERT INTO songs (name) VALUES (?)'),
  renameSong: db.prepare('UPDATE songs SET name = ? WHERE id = ?'),
  updateSongNotes: db.prepare('UPDATE songs SET notes = ? WHERE id = ?'),
  deleteSong: db.prepare('DELETE FROM songs WHERE id = ?'),
  getSongTags: db.prepare(`
    SELECT t.id, t.name FROM song_tags st
    JOIN tags t ON t.id = st.tag_id
    WHERE st.song_id = ?
    ORDER BY t.name
  `),
  getSongTagIds: db.prepare('SELECT tag_id FROM song_tags WHERE song_id = ?'),
  addSongTag: db.prepare('INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)'),
  removeSongTag: db.prepare('DELETE FROM song_tags WHERE song_id = ? AND tag_id = ?'),
  clearSongTags: db.prepare('DELETE FROM song_tags WHERE song_id = ?'),
  getMaxSongAssetSort: db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max FROM song_assets WHERE song_id = ?'),
  updateSongAssetRole: db.prepare('UPDATE song_assets SET role = ? WHERE song_id = ? AND file_path = ?'),
  updateSongAssetNotes: db.prepare('UPDATE song_assets SET notes = ? WHERE song_id = ? AND file_path = ?'),
  updateSongAssetTrackLabels: db.prepare('UPDATE song_assets SET track_labels = ? WHERE song_id = ? AND file_path = ?'),
  updateSongAssetSort: db.prepare('UPDATE song_assets SET sort_order = ? WHERE song_id = ? AND file_path = ?'),
  getSongAssets: db.prepare(`
    SELECT file_path, role, sort_order, notes, track_labels FROM song_assets
    WHERE song_id = ? ORDER BY sort_order, file_path
  `),
  getSongForFile: db.prepare(`
    SELECT s.id, s.name FROM songs s
    JOIN song_assets sa ON sa.song_id = s.id
    WHERE sa.file_path = ?
  `),
  getSongSiblings: db.prepare(`
    SELECT sa.file_path, sa.role, sa.sort_order FROM song_assets sa
    WHERE sa.song_id = (SELECT song_id FROM song_assets WHERE file_path = ?)
    ORDER BY sa.sort_order, sa.file_path
  `),
  addSongAsset: db.prepare(`
    INSERT INTO song_assets (song_id, file_path, role, sort_order)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(song_id, file_path) DO UPDATE SET role = excluded.role, sort_order = excluded.sort_order
  `),
  removeSongAsset: db.prepare('DELETE FROM song_assets WHERE song_id = ? AND file_path = ?'),
  removeSongAssetByPath: db.prepare('DELETE FROM song_assets WHERE file_path = ?'),
  renameSongAssetPath: db.prepare('UPDATE song_assets SET file_path = ? WHERE file_path = ?'),
  getAllFolderTags: db.prepare(`
    SELECT ft.folder_path, t.id, t.name
    FROM folder_tags ft
    JOIN tags t ON t.id = ft.tag_id
    ORDER BY ft.folder_path, t.name
  `),
  getFolderTagIds: db.prepare('SELECT tag_id FROM folder_tags WHERE folder_path = ?'),
  addFolderTag: db.prepare('INSERT OR IGNORE INTO folder_tags (folder_path, tag_id) VALUES (?, ?)'),
  removeFolderTag: db.prepare('DELETE FROM folder_tags WHERE folder_path = ? AND tag_id = ?'),
  clearFolderTags: db.prepare('DELETE FROM folder_tags WHERE folder_path = ?'),
  countFolderTags: db.prepare('SELECT COUNT(*) AS n FROM folder_tags WHERE folder_path = ?'),
};

let cachedShareRoot = undefined;

function bootstrapShareDir() {
  if (ENV_SHARE_DIR) {
    try {
      fs.mkdirSync(ENV_SHARE_DIR, { recursive: true });
      if (fs.statSync(ENV_SHARE_DIR).isDirectory()) {
        stmts.setSetting.run('share_dir', ENV_SHARE_DIR);
        cachedShareRoot = ENV_SHARE_DIR;
        return cachedShareRoot;
      }
    } catch { /* fall through to DB / legacy */ }
  }
  const row = stmts.getSetting.get('share_dir');
  if (row !== undefined) {
    if (!row.value) {
      cachedShareRoot = null;
      return null;
    }
    const resolved = path.resolve(row.value);
    try {
      if (fs.statSync(resolved).isDirectory()) {
        cachedShareRoot = resolved;
        return cachedShareRoot;
      }
    } catch { /* invalid or missing path */ }
    cachedShareRoot = null;
    return null;
  }
  const legacy = path.resolve(LEGACY_DEFAULT_SHARE);
  if (fs.existsSync(legacy)) {
    stmts.setSetting.run('share_dir', legacy);
    cachedShareRoot = legacy;
    return cachedShareRoot;
  }
  cachedShareRoot = null;
  return null;
}

function getShareRoot() {
  if (cachedShareRoot === undefined) bootstrapShareDir();
  return cachedShareRoot;
}

/** Host-facing path for UI (Docker volume mount); internal ops still use getShareRoot(). */
function getShareDirDisplay() {
  if (ENV_DISPLAY_SHARE_DIR) return ENV_DISPLAY_SHARE_DIR;
  return getShareRoot() || '';
}

function validateShareDirInput(input) {
  const raw = String(input || '').trim();
  if (!raw || raw.includes('\0')) return null;
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved)) return null;
  return resolved;
}

function setShareRoot(absPath) {
  const resolved = validateShareDirInput(absPath);
  if (!resolved) throw new Error('Invalid folder path');
  fs.mkdirSync(resolved, { recursive: true });
  stmts.setSetting.run('share_dir', resolved);
  cachedShareRoot = resolved;
  return resolved;
}

function clearShareRoot() {
  stmts.setSetting.run('share_dir', '');
  cachedShareRoot = null;
}

const SETUP_RESET_CONFIRM = 'fileshare';

function validateSetupResetConfirm(input) {
  return String(input || '').trim().toLowerCase() === SETUP_RESET_CONFIRM;
}

function requireShareRoot(req, res, next) {
  if (getShareRoot()) return next();
  res.status(503).json({ error: 'Storage folder not configured', needsSetup: true });
}

bootstrapShareDir();

const INVALID_WIN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

function normalizeFilename(name) {
  let base = path.basename(String(name || '').replace(/\\/g, '/'));
  base = base
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  base = base.replace(/[. ]+$/, '');
  return base;
}

function validateFilename(name) {
  const normalized = normalizeFilename(name);
  if (!normalized || normalized === '.' || normalized === '..') return null;
  if (INVALID_WIN_CHARS.test(normalized)) return null;
  return normalized;
}

function uniqueFilename(dirFull, name) {
  const dest = path.join(dirFull, name);
  if (!fs.existsSync(dest)) return name;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  return `${base}_${Date.now()}${ext}`;
}

// ── Middleware ────────────────────────────────────────────────────────────────

function stampBuildId() {
  const buildIdPath = path.join(__dirname, 'public', '.build-id');
  const id = String(Date.now());
  fs.writeFileSync(buildIdPath, id + '\n');
  return id;
}

function getBuildId() {
  const buildIdPath = path.join(__dirname, 'public', '.build-id');
  try {
    const id = fs.readFileSync(buildIdPath, 'utf8').trim();
    if (id) return id;
  } catch { /* create below */ }
  return stampBuildId();
}

stampBuildId();

app.use(express.json());
app.get('/vendor/marked.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'marked', 'marked.min.js'));
});

app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
    const buildId = getBuildId();
    if (req.query.v && req.query.v === buildId) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
  next();
});

app.get('/', (_req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replace(/__BUILD_ID__/g, getBuildId());
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dirRel = req.query.dir != null ? String(req.query.dir) : '';
    const resolved = safeResolveDir(dirRel);
    if (!resolved) return cb(new Error('Invalid folder'));
    fs.mkdirSync(resolved.full, { recursive: true });
    cb(null, resolved.full);
  },
  filename: (req, file, cb) => {
    const dirRel = req.query.dir != null ? String(req.query.dir) : '';
    const resolved = safeResolveDir(dirRel);
    if (!resolved) return cb(new Error('Invalid folder'));
    let name = validateFilename(file.originalname);
    if (!name) name = `upload_${Date.now()}${path.extname(file.originalname) || ''}`;
    name = uniqueFilename(resolved.full, name);
    cb(null, name);
  },
});
const upload = multer({ storage });

const MAX_TEXT_BYTES = 512 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.pro', '.cho',
  '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.py', '.rb', '.go',
  '.java', '.c', '.cpp', '.h', '.sh', '.yml', '.yaml', '.xml', '.php', '.swift', '.kt', '.rs',
]);

const EDITABLE_EXTENSIONS = new Set(['.txt', '.md', '.pro', '.cho']);
const CREATABLE_SHEET_EXTENSIONS = new Set(['.txt', '.md', '.pro', '.cho']);
const SHEET_VIEW_EXTENSIONS = new Set(['.txt', '.md', '.pro', '.cho']);

function fileExtension(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function isTextExtension(ext) {
  return TEXT_EXTENSIONS.has(ext);
}

function isEditableExtension(ext) {
  return EDITABLE_EXTENSIONS.has(ext);
}

function isSheetFile(name) {
  return SHEET_VIEW_EXTENSIONS.has(fileExtension(name));
}

function walkAllFiles(dirRelative, dirFull) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirFull, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const subRel = posixRel(dirRelative, e.name);
      results.push(...walkAllFiles(subRel, path.join(dirFull, e.name)));
    } else if (e.isFile()) {
      const abs = path.join(dirFull, e.name);
      const stat = fs.statSync(abs);
      const relPath = posixRel(dirRelative, e.name);
      results.push({
        name: e.name,
        relPath,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }
  return results;
}

function dirLabelFromRelPath(relPath) {
  const idx = relPath.lastIndexOf('/');
  if (idx <= 0) return idx === 0 ? relPath.slice(1) : 'Home';
  return relPath.slice(0, idx);
}

function loadTagsByFilename() {
  const map = {};
  for (const row of stmts.getAllFileTags.all()) {
    if (!map[row.filename]) map[row.filename] = [];
    map[row.filename].push({ id: row.id, name: row.name });
  }
  return map;
}

function loadTagsByFolder() {
  const map = {};
  for (const row of stmts.getAllFolderTags.all()) {
    if (!map[row.folder_path]) map[row.folder_path] = [];
    map[row.folder_path].push({ id: row.id, name: row.name });
  }
  return map;
}

function fileInheritsFolderTag(relPath, filterId, tagsByFolder) {
  if (isNaN(filterId)) return false;
  const parts = relPath.split('/');
  if (parts.length <= 1) {
    return (tagsByFolder[''] || []).some((t) => t.id === filterId);
  }
  parts.pop();
  let acc = '';
  for (const seg of parts) {
    acc = acc ? path.posix.join(acc, seg) : seg;
    const tags = tagsByFolder[acc];
    if (tags && tags.some((t) => t.id === filterId)) return true;
  }
  return false;
}

function buildFileRecords(fsFiles, dbMap, tagsByFile) {
  return fsFiles.map((f) => {
    const rec = dbMap[f.relPath];
    const tags = tagsByFile[f.relPath] || [];
    const dirLabel = dirLabelFromRelPath(f.relPath);
    return {
      kind: 'file',
      name: f.name,
      relPath: f.relPath,
      dirLabel: dirLabel === 'Home' ? '' : dirLabel,
      size: f.size,
      modified: f.modified,
      tags,
      downloadCount: rec ? rec.download_count : 0,
    };
  });
}

function applyTagFilter(files, tagFilter, tagsByFolder) {
  if (tagFilter === 'untagged') {
    return files.filter((f) => !f.tags.length);
  }
  if (tagFilter !== 'all') {
    const filterId = parseInt(tagFilter, 10);
    if (!isNaN(filterId)) {
      return files.filter(
        (f) => f.tags.some((t) => t.id === filterId)
          || fileInheritsFolderTag(f.relPath, filterId, tagsByFolder || {}),
      );
    }
  }
  return files;
}

function ensureFileRecord(rel) {
  let record = stmts.getFile.get(rel);
  if (!record) {
    stmts.upsertFile.run(rel);
    record = stmts.getFile.get(rel);
  }
  return record;
}

function filterLabelFor(tagFilter, tags) {
  if (tagFilter === 'untagged') return 'Untagged';
  const filterId = parseInt(tagFilter, 10);
  if (!isNaN(filterId)) {
    const tag = tags.find((t) => t.id === filterId);
    return tag ? tag.name : 'Tag';
  }
  return 'Filtered';
}

const FOLDER_SIZE_TTL_MS = 2 * 60 * 1000;
const folderSizeCache = new Map();

function computeFolderSize(absDir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    try {
      if (e.isDirectory()) total += computeFolderSize(abs);
      else if (e.isFile()) total += fs.statSync(abs).size;
    } catch { /* ignore */ }
  }
  return total;
}

function getFolderSize(relPath, absDir) {
  const cached = folderSizeCache.get(relPath);
  if (cached && Date.now() - cached.at < FOLDER_SIZE_TTL_MS) return cached.size;
  const size = computeFolderSize(absDir);
  folderSizeCache.set(relPath, { size, at: Date.now() });
  return size;
}

function parseListParams(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = 10;
  const query = String(req.query.q || '').trim().toLowerCase();
  const sort = ['name', 'modified', 'size', 'downloads'].includes(req.query.sort) ? req.query.sort : 'modified';
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  return { page, pageSize, query, sort, order };
}

function filterByQuery(items, q) {
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q));
}

function parseTagIdList(param) {
  if (!param) return [];
  if (Array.isArray(param)) {
    return param.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id) && id > 0);
  }
  return String(param)
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((id) => !isNaN(id) && id > 0);
}

function sanitizeCategoryTagIds(ids) {
  const valid = new Set(stmts.getAllTags.all().map((t) => t.id));
  return [...new Set(parseTagIdList(ids))].filter((id) => valid.has(id));
}

function readSettingJsonArray(key) {
  const row = stmts.getSetting.get(key);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getCategorySettings() {
  const excludeTags = sanitizeCategoryTagIds(readSettingJsonArray('exclude_tag_ids'));
  const showTags = sanitizeCategoryTagIds(readSettingJsonArray('show_tag_ids'))
    .filter((id) => excludeTags.includes(id));
  return { excludeTags, showTags };
}

function readSongwritingEnabledSetting() {
  const row = stmts.getSetting.get('songwriting_enabled');
  if (!row) return null;
  return row.value === '1';
}

function saveCategorySettings(excludeTags, showTags, songwritingEnabled) {
  const exclude = sanitizeCategoryTagIds(excludeTags);
  const show = sanitizeCategoryTagIds(showTags).filter((id) => exclude.includes(id));
  stmts.setSetting.run('exclude_tag_ids', JSON.stringify(exclude));
  stmts.setSetting.run('show_tag_ids', JSON.stringify(show));
  if (songwritingEnabled !== undefined) {
    stmts.setSetting.run('songwriting_enabled', songwritingEnabled ? '1' : '0');
  }
  return getAppSettings();
}

function getAppSettings() {
  return {
    ...getCategorySettings(),
    shareDir: getShareDirDisplay(),
    songwritingEnabled: readSongwritingEnabledSetting(),
  };
}

function applyCategoryExclusions(items, excludeTagIds, showTagIds) {
  if (!excludeTagIds.length) return items;
  const exclude = new Set(excludeTagIds);
  const show = new Set(showTagIds);
  return items.filter((item) => {
    if (item.kind === 'folder') return true;
    if (!item.tags || !item.tags.length) return true;
    return !item.tags.some((t) => exclude.has(t.id) && !show.has(t.id));
  });
}

function sortItems(items, sort, order) {
  const dir = order === 'asc' ? 1 : -1;
  const sorted = [...items];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case 'name':
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        break;
      case 'size':
        cmp = (a.size || 0) - (b.size || 0);
        break;
      case 'downloads':
        cmp = (a.downloadCount || 0) - (b.downloadCount || 0);
        break;
      case 'modified':
      default:
        cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
        break;
    }
    if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return cmp * dir;
  });
  return sorted;
}

function paginateItems(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: { page: safePage, pageSize, total, totalPages },
  };
}

function buildBrowseItems(dirResolved, dbMap, tagsByFile, tagsByFolder) {
  const entries = fs.readdirSync(dirResolved.full, { withFileTypes: true });
  const items = [];

  for (const e of entries) {
    if (e.isDirectory()) {
      const subAbs = path.join(dirResolved.full, e.name);
      const relPath = posixRel(dirResolved.relative, e.name);
      let mtime = new Date().toISOString();
      try {
        mtime = fs.statSync(subAbs).mtime.toISOString();
      } catch { /* ignore */ }
      items.push({
        kind: 'folder',
        name: e.name,
        relPath,
        size: getFolderSize(relPath, subAbs),
        modified: mtime,
        tags: tagsByFolder[relPath] || [],
        downloadCount: null,
      });
    } else if (e.isFile()) {
      const stat = fs.statSync(path.join(dirResolved.full, e.name));
      const relPath = posixRel(dirResolved.relative, e.name);
      const rec = dbMap[relPath];
      items.push({
        kind: 'file',
        name: e.name,
        relPath,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        tags: tagsByFile[relPath] || [],
        downloadCount: rec ? rec.download_count : 0,
      });
    }
  }
  return items;
}

function listResponse(items, page, pageSize, sort, order, extra) {
  const filtered = items;
  const sorted = sortItems(filtered, sort, order);
  const { items: pageItems, pagination } = paginateItems(sorted, page, pageSize);
  return { items: pageItems, pagination, sort, order, ...extra };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

app.get('/api/setup', (_req, res) => {
  try {
    const shareDir = getShareRoot();
    res.json({
      configured: !!shareDir,
      shareDir: getShareDirDisplay(),
      suggested: ENV_SHARE_DIR || LEGACY_DEFAULT_SHARE,
      docker: IS_DOCKER,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/setup', (req, res) => {
  try {
    if (getShareRoot()) {
      return res.status(409).json({ error: 'Storage folder is already configured' });
    }
    setShareRoot(req.body.shareDir);
    res.json({ ok: true, shareDir: getShareDirDisplay() });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid folder path' });
  }
});

app.post('/api/setup/reset', (req, res) => {
  try {
    if (!getShareRoot()) {
      return res.status(400).json({ error: 'Storage folder is not configured' });
    }
    if (!validateSetupResetConfirm(req.body.confirm)) {
      return res.status(400).json({ error: 'Confirmation text did not match' });
    }
    clearShareRoot();
    res.json({ ok: true, configured: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── File endpoints ────────────────────────────────────────────────────────────

function parseListView(raw) {
  if (raw === 'documents' || raw === 'sheets') return 'documents';
  if (raw === 'songs' || raw === 'library') return raw;
  return 'browse';
}

// List folder contents — unified items with search, sort, pagination
app.get('/api/files', requireShareRoot, (req, res) => {
  try {
    const { page, pageSize, query, sort, order } = parseListParams(req);
    const tagFilter = req.query.tag || 'all';
    const view = parseListView(req.query.view);

    const dbMap = {};
    for (const row of stmts.getAllActiveFiles.all()) {
      dbMap[row.filename] = row;
    }

    const tags = stmts.getAllTags.all();
    const tagsByFile = loadTagsByFilename();
    const tagsByFolder = loadTagsByFolder();
    const settings = getAppSettings();
    const shareDir = getShareRoot();

    // Songs view — flat list of song groups
    if (view === 'songs' && tagFilter === 'all') {
      const songList = stmts.getAllSongs.all();
      let items = songList.map((s) => ({
        kind: 'song',
        id: s.id,
        name: s.name,
        relPath: '',
        size: null,
        modified: s.created_at,
        tags: stmts.getSongTags.all(s.id).map((t) => ({ id: t.id, name: t.name })),
        downloadCount: null,
        assetCount: s.asset_count,
      }));
      items = filterByQuery(items, query);
      const result = listResponse(items, page, pageSize, sort, order, {
        mode: 'songs',
        dir: '',
        breadcrumbs: [{ name: 'Home', path: '', clearFilter: true }],
        tags,
        settings,
        shareDir: getShareDirDisplay(),
      });
      return res.json(result);
    }

    // Flat cross-folder list for tag filters, Documents view, or library search
    if (tagFilter !== 'all' || view === 'documents' || view === 'library') {
      const allFsFiles = walkAllFiles('', shareDir);
      let items = buildFileRecords(allFsFiles, dbMap, tagsByFile);
      if (view === 'documents') {
        items = items.filter((f) => isSheetFile(f.name));
        items = applyCategoryExclusions(
          items,
          settings.excludeTags,
          settings.showTags,
        );
      }
      items = applyTagFilter(items, tagFilter, tagsByFolder);
      items = filterByQuery(items, query);
      const mode = view === 'documents' ? 'documents' : view === 'library' ? 'library' : 'flat';
      const result = listResponse(items, page, pageSize, sort, order, {
        mode,
        filterLabel: tagFilter !== 'all' ? filterLabelFor(tagFilter, tags) : null,
        dir: '',
        breadcrumbs: [{ name: 'Home', path: '', clearFilter: true }],
        tags,
        settings,
        shareDir: getShareDirDisplay(),
      });
      return res.json(result);
    }

    const dirResolved = safeResolveDir(req.query.dir);
    if (!dirResolved) {
      return res.status(400).json({ error: 'Invalid folder path' });
    }

    let items = buildBrowseItems(dirResolved, dbMap, tagsByFile, tagsByFolder);
    items = filterByQuery(items, query);
    items = applyCategoryExclusions(
      items,
      settings.excludeTags,
      settings.showTags,
    );

    const breadcrumbs = [{ name: 'Home', path: '' }];
    if (dirResolved.relative) {
      let acc = '';
      for (const seg of dirResolved.relative.split('/')) {
        acc = acc ? path.posix.join(acc, seg) : seg;
        breadcrumbs.push({ name: seg, path: acc });
      }
    }

    const result = listResponse(items, page, pageSize, sort, order, {
      mode: 'browse',
      dir: dirResolved.relative,
      breadcrumbs,
      tags,
      settings,
      shareDir: getShareDirDisplay(),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Text file content for viewer/editor
app.get('/api/content', requireShareRoot, (req, res) => {
  try {
    const rel = decodeRelPath(req.query.path);
    const abs = rel ? resolveExistingFile(rel) : null;
    if (!abs) return res.status(404).json({ error: 'File not found' });

    const ext = fileExtension(path.basename(rel));
    if (!isTextExtension(ext)) {
      return res.status(400).json({ error: 'Not a text file' });
    }

    const stat = fs.statSync(abs);
    if (stat.size > MAX_TEXT_BYTES) {
      return res.status(413).json({ error: 'File too large to edit' });
    }

    const content = fs.readFileSync(abs, 'utf8');
    res.json({
      path: rel,
      content,
      modified: stat.mtime.toISOString(),
      editable: isEditableExtension(ext),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save text file content
app.put('/api/files/content', requireShareRoot, (req, res) => {
  try {
    const rel = decodeRelPath(req.body.path);
    const abs = rel ? resolveExistingFile(rel) : null;
    if (!abs) return res.status(404).json({ error: 'File not found' });

    const ext = fileExtension(path.basename(rel));
    if (!isEditableExtension(ext)) {
      return res.status(400).json({ error: 'File type is not editable' });
    }

    const content = req.body.content;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content required' });
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) {
      return res.status(413).json({ error: 'Content too large' });
    }

    const tmp = abs + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, abs);

    const stat = fs.statSync(abs);
    res.json({ ok: true, path: rel, modified: stat.mtime.toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new text file (lyrics sheet)
app.post('/api/files/create', requireShareRoot, (req, res) => {
  try {
    const dirRel = req.body.dir != null ? String(req.body.dir) : '';
    const dirResolved = safeResolveDir(dirRel);
    if (!dirResolved) return res.status(400).json({ error: 'Invalid folder path' });

    let filename = String(req.body.filename || 'untitled.md').trim();
    if (!filename) return res.status(400).json({ error: 'Filename required' });
    filename = validateFilename(filename);
    if (!filename) return res.status(400).json({ error: 'Invalid filename' });

    const ext = fileExtension(filename);
    if (!CREATABLE_SHEET_EXTENSIONS.has(ext)) {
      return res.status(400).json({ error: 'Only .txt, .md, .pro, and .cho files can be created' });
    }

    const abs = path.join(dirResolved.full, filename);
    const root = path.resolve(getShareRoot());
    const resolvedAbs = path.resolve(abs);
    if (resolvedAbs !== root && !resolvedAbs.startsWith(root + path.sep)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (fs.existsSync(abs)) {
      return res.status(409).json({ error: 'File already exists' });
    }

    const defaultContent = ext === '.md'
      ? '# Untitled\n\n'
      : ext === '.pro' || ext === '.cho'
      ? '{title: Untitled}\n{artist: }\n\n{start_of_verse}\n[Am]Line with [G]chords\n{end_of_verse}\n'
      : '';
    const content = typeof req.body.content === 'string' ? req.body.content : defaultContent;

    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) {
      return res.status(413).json({ error: 'Content too large' });
    }

    fs.mkdirSync(dirResolved.full, { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');

    const relPath = posixRel(dirResolved.relative, filename);
    ensureFileRecord(relPath);

    const stat = fs.statSync(abs);
    res.json({
      path: relPath,
      name: filename,
      modified: stat.mtime.toISOString(),
      size: stat.size,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rename file on disk + update DB path key
app.put('/api/files/rename', requireShareRoot, (req, res) => {
  try {
    const rel = decodeRelPath(req.body.path);
    const abs = rel ? resolveExistingFile(rel) : null;
    if (!abs) return res.status(404).json({ error: 'File not found' });

    const newName = validateFilename(req.body.newName);
    if (!newName) return res.status(400).json({ error: 'Invalid filename' });

    const segments = rel.split('/');
    const oldName = segments.pop();
    const dirRel = segments.join('/');
    const dirResolved = safeResolveDir(dirRel);
    if (!dirResolved) return res.status(400).json({ error: 'Invalid path' });

    if (newName === oldName) {
      return res.json({ path: rel, name: oldName, modified: fs.statSync(abs).mtime.toISOString() });
    }

    const newAbs = path.join(dirResolved.full, newName);
    if (fs.existsSync(newAbs)) return res.status(409).json({ error: 'File already exists' });

    fs.renameSync(abs, newAbs);
    const newRel = posixRel(dirResolved.relative, newName);

    const record = stmts.getFile.get(rel);
    if (record && !record.deleted) {
      stmts.renameFile.run(newRel, rel);
    }
    stmts.renameSongAssetPath.run(newRel, rel);

    const stat = fs.statSync(newAbs);
    res.json({ path: newRel, name: newName, modified: stat.mtime.toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move file to another folder on disk + update DB path key
app.put('/api/files/move', requireShareRoot, (req, res) => {
  try {
    const rel = decodeRelPath(req.body.path);
    const abs = rel ? resolveExistingFile(rel) : null;
    if (!abs) return res.status(404).json({ error: 'File not found' });

    const dirRel = req.body.dir != null ? String(req.body.dir) : '';
    const dirResolved = safeResolveDir(dirRel);
    if (!dirResolved) return res.status(400).json({ error: 'Invalid folder path' });

    const segments = rel.split('/');
    const oldName = segments.pop();
    const oldDirRel = segments.join('/');
    if (oldDirRel === dirResolved.relative) {
      const stat = fs.statSync(abs);
      return res.json({ path: rel, name: oldName, modified: stat.mtime.toISOString(), moved: false });
    }

    fs.mkdirSync(dirResolved.full, { recursive: true });
    const destName = uniqueFilename(dirResolved.full, oldName);
    const newAbs = path.join(dirResolved.full, destName);
    fs.renameSync(abs, newAbs);
    const newRel = posixRel(dirResolved.relative, destName);

    const record = stmts.getFile.get(rel);
    if (record && !record.deleted) {
      stmts.renameFile.run(newRel, rel);
    }
    stmts.renameSongAssetPath.run(newRel, rel);

    const stat = fs.statSync(newAbs);
    res.json({ path: newRel, name: destName, modified: stat.mtime.toISOString(), moved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview (no download count)
app.get('/api/preview', requireShareRoot, (req, res) => {
  const rel = decodeRelPath(req.query.path);
  const abs = rel ? resolveExistingFile(rel) : null;
  if (!abs) return res.status(404).json({ error: 'File not found' });
  res.sendFile(abs);
});

// Download (increments count)
app.get('/api/download', requireShareRoot, (req, res) => {
  const rel = decodeRelPath(req.query.path);
  const abs = rel ? resolveExistingFile(rel) : null;
  if (!abs) return res.status(404).json({ error: 'File not found' });
  stmts.incrementDownload.run(rel);
  res.download(abs);
});

// Upload — optional ?dir=relative/subfolder
app.post('/api/upload', requireShareRoot, upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files received' });
  }
  const dirRel = req.query.dir != null ? String(req.query.dir) : '';
  if (!safeResolveDir(dirRel)) {
    return res.status(400).json({ error: 'Invalid folder path' });
  }
  const tagId = req.body.tag_id ? parseInt(req.body.tag_id, 10) : null;
  const uploaded = [];
  const normalized = [];
  for (const f of req.files) {
    const relPath = posixRel(dirRel, f.filename);
    const record = ensureFileRecord(relPath);
    if (tagId && stmts.countFileTags.get(record.id).n < MAX_TAGS_PER_FILE) {
      stmts.addFileTag.run(record.id, tagId);
    }
    uploaded.push(relPath);
    if (f.originalname !== f.filename) {
      normalized.push({ from: f.originalname, to: f.filename });
    }
  }
  res.json({ uploaded, normalized });
});

// Delete file on disk + soft-delete in DB
app.delete('/api/files', requireShareRoot, (req, res) => {
  const rel = decodeRelPath(req.query.path);
  const abs = rel ? resolveExistingFile(rel) : null;
  if (!abs) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(abs);
  stmts.softDelete.run(rel);
  stmts.removeSongAssetByPath.run(rel);
  res.json({ deleted: rel });
});

// Toggle a tag on a file (max 2 tags), or clear all when tag_id is null
app.put('/api/files/tag', requireShareRoot, (req, res) => {
  try {
    const rel = decodeRelPath(req.body.path);
    const abs = rel ? resolveExistingFile(rel) : null;
    if (!abs) return res.status(404).json({ error: 'File not found' });

    const record = ensureFileRecord(rel);
    if (req.body.tag_id === null) {
      stmts.clearFileTags.run(record.id);
      return res.json({ ok: true, tags: [] });
    }

    const tagId = parseInt(req.body.tag_id, 10);
    if (isNaN(tagId) || !stmts.getTagById.get(tagId)) {
      return res.status(400).json({ error: 'Invalid tag' });
    }

    const assigned = stmts.getFileTagIds.all(record.id).map((r) => r.tag_id);
    if (assigned.includes(tagId)) {
      stmts.removeFileTag.run(record.id, tagId);
    } else {
      if (assigned.length >= MAX_TAGS_PER_FILE) {
        return res.status(400).json({ error: `Maximum ${MAX_TAGS_PER_FILE} tags per file` });
      }
      stmts.addFileTag.run(record.id, tagId);
    }

    const tags = stmts.getAllFileTags.all()
      .filter((row) => row.filename === rel)
      .map((row) => ({ id: row.id, name: row.name }));
    res.json({ ok: true, tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── App settings ──────────────────────────────────────────────────────────────

app.get('/api/settings', (_req, res) => {
  try {
    res.json(getAppSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', (req, res) => {
  try {
    const songwritingEnabled = req.body.songwritingEnabled;
    res.json(saveCategorySettings(
      req.body.excludeTags,
      req.body.showTags,
      songwritingEnabled === undefined ? undefined : !!songwritingEnabled,
    ));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tag endpoints ─────────────────────────────────────────────────────────────

app.get('/api/tags', (_req, res) => {
  res.json(stmts.getAllTags.all());
});

app.post('/api/tags', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Tag name required' });
  try {
    const info = stmts.createTag.run(name.trim());
    res.json({ id: info.lastInsertRowid, name: name.trim(), created_at: new Date().toISOString(), file_count: 0 });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Tag already exists' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tags/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const tag = stmts.getTagById.get(id);
  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  stmts.deleteTag.run(id);
  const current = getCategorySettings();
  saveCategorySettings(
    current.excludeTags.filter((tid) => tid !== id),
    current.showTags.filter((tid) => tid !== id),
  );
  res.json({ deleted: id });
});

// ── Folder tag endpoints ────────────────────────────────────────────────────────

app.put('/api/folders/tag', requireShareRoot, (req, res) => {
  try {
    const folderPath = decodeRelPath(req.body.path);
    if (folderPath == null) return res.status(400).json({ error: 'Invalid folder path' });
    const dirResolved = safeResolveDir(folderPath);
    if (!dirResolved) return res.status(400).json({ error: 'Invalid folder path' });

    const rel = dirResolved.relative;

    if (req.body.tag_id === null) {
      stmts.clearFolderTags.run(rel);
      return res.json({ ok: true, tags: [] });
    }

    const tagId = parseInt(req.body.tag_id, 10);
    if (isNaN(tagId) || !stmts.getTagById.get(tagId)) {
      return res.status(400).json({ error: 'Invalid tag' });
    }

    const assigned = stmts.getFolderTagIds.all(rel).map((r) => r.tag_id);
    if (assigned.includes(tagId)) {
      stmts.removeFolderTag.run(rel, tagId);
    } else {
      if (assigned.length >= MAX_TAGS_PER_FILE) {
        return res.status(400).json({ error: `Maximum ${MAX_TAGS_PER_FILE} tags per folder` });
      }
      stmts.addFolderTag.run(rel, tagId);
    }

    const tags = stmts.getAllFolderTags.all()
      .filter((row) => row.folder_path === rel)
      .map((row) => ({ id: row.id, name: row.name }));
    res.json({ ok: true, tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Song group endpoints ────────────────────────────────────────────────────────

function songPayload(song) {
  return {
    id: song.id,
    name: song.name,
    notes: song.notes || '',
    created_at: song.created_at,
    tags: stmts.getSongTags.all(song.id).map((t) => ({ id: t.id, name: t.name })),
  };
}

function parseTrackLabels(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l) => typeof l === 'string' && l.trim()) : [];
  } catch {
    return [];
  }
}

function enrichSongAssets(rows) {
  return rows.map((row) => {
    const abs = resolveExistingFile(row.file_path);
    let name = path.basename(row.file_path);
    let modified = null;
    let size = null;
    if (abs) {
      try {
        const st = fs.statSync(abs);
        modified = st.mtime.toISOString();
        size = st.size;
      } catch { /* missing file */ }
    }
    return {
      path: row.file_path,
      name,
      role: row.role || '',
      notes: row.notes || '',
      trackLabels: parseTrackLabels(row.track_labels),
      sortOrder: row.sort_order,
      modified,
      size,
    };
  });
}

app.get('/api/songs', (_req, res) => {
  try {
    res.json(stmts.getAllSongs.all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/songs', (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Song name required' });
    const info = stmts.createSong.run(name);
    res.json({
      id: info.lastInsertRowid,
      name,
      created_at: new Date().toISOString(),
      asset_count: 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/songs/by-file', requireShareRoot, (req, res) => {
  try {
    const rel = decodeRelPath(req.query.path);
    if (!rel) return res.json({ song: null, assets: [] });
    const song = stmts.getSongForFile.get(rel);
    if (!song) return res.json({ song: null, assets: [] });
    const assets = enrichSongAssets(stmts.getSongAssets.all(song.id));
    res.json({ song: { id: song.id, name: song.name }, assets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/songs/:id', requireShareRoot, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const song = stmts.getSong.get(id);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    const assets = enrichSongAssets(stmts.getSongAssets.all(id));
    res.json({ ...songPayload(song), assets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/songs/tag', (req, res) => {
  try {
    const songId = parseInt(req.body.song_id, 10);
    const song = stmts.getSong.get(songId);
    if (!song) return res.status(404).json({ error: 'Song not found' });

    if (req.body.tag_id === null) {
      stmts.clearSongTags.run(songId);
      return res.json({ ok: true, tags: [] });
    }

    const tagId = parseInt(req.body.tag_id, 10);
    if (isNaN(tagId) || !stmts.getTagById.get(tagId)) {
      return res.status(400).json({ error: 'Invalid tag' });
    }

    const assigned = stmts.getSongTagIds.all(songId).map((r) => r.tag_id);
    if (assigned.includes(tagId)) {
      stmts.removeSongTag.run(songId, tagId);
    } else {
      if (assigned.length >= MAX_TAGS_PER_FILE) {
        return res.status(400).json({ error: `Maximum ${MAX_TAGS_PER_FILE} tags per song` });
      }
      stmts.addSongTag.run(songId, tagId);
    }

    const tags = stmts.getSongTags.all(songId).map((t) => ({ id: t.id, name: t.name }));
    res.json({ ok: true, tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/songs/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const song = stmts.getSong.get(id);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    const hasName = req.body.name != null;
    const hasNotes = req.body.notes != null;
    if (!hasName && !hasNotes) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    if (hasName) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Song name required' });
      stmts.renameSong.run(name, id);
    }
    if (hasNotes) {
      stmts.updateSongNotes.run(String(req.body.notes), id);
    }
    const updated = stmts.getSong.get(id);
    res.json(songPayload(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/songs/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const song = stmts.getSong.get(id);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    stmts.deleteSong.run(id);
    res.json({ deleted: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/songs/:id/assets', requireShareRoot, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const song = stmts.getSong.get(id);
    if (!song) return res.status(404).json({ error: 'Song not found' });

    const rel = decodeRelPath(req.body.path);
    const abs = rel ? resolveExistingFile(rel) : null;
    if (!abs) return res.status(404).json({ error: 'File not found' });

    const existing = stmts.getSongForFile.get(rel);
    if (existing && existing.id !== id) {
      stmts.removeSongAsset.run(existing.id, rel);
    }

    const role = req.body.role != null ? String(req.body.role).slice(0, 32) : null;
    const maxSort = stmts.getMaxSongAssetSort.get(id).max;
    const sortOrder = req.body.sortOrder != null
      ? parseInt(req.body.sortOrder, 10) || 0
      : maxSort + 1;
    stmts.addSongAsset.run(id, rel, role, sortOrder);
    const assets = enrichSongAssets(stmts.getSongAssets.all(id));
    res.json({ ok: true, assets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/songs/:id/assets', requireShareRoot, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const song = stmts.getSong.get(id);
    if (!song) return res.status(404).json({ error: 'Song not found' });

    const rel = decodeRelPath(req.body.path);
    if (!rel) return res.status(400).json({ error: 'Path required' });

    const row = stmts.getSongAssets.all(id).find((a) => a.file_path === rel);
    if (!row) return res.status(404).json({ error: 'Asset not in song' });

    if (req.body.role !== undefined) {
      const role = req.body.role == null || req.body.role === ''
        ? null
        : String(req.body.role).slice(0, 32);
      stmts.updateSongAssetRole.run(role, id, rel);
    }
    if (req.body.notes !== undefined) {
      stmts.updateSongAssetNotes.run(String(req.body.notes).slice(0, 8000), id, rel);
    }
    if (req.body.trackLabels !== undefined) {
      const labels = Array.isArray(req.body.trackLabels)
        ? req.body.trackLabels.map((l) => String(l).trim().slice(0, 32)).filter(Boolean).slice(0, 5)
        : [];
      stmts.updateSongAssetTrackLabels.run(JSON.stringify(labels), id, rel);
    }
    if (req.body.sortOrder !== undefined) {
      const sortOrder = parseInt(req.body.sortOrder, 10) || 0;
      stmts.updateSongAssetSort.run(sortOrder, id, rel);
    }

    const assets = enrichSongAssets(stmts.getSongAssets.all(id));
    res.json({ ok: true, assets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/songs/:id/assets/reorder', requireShareRoot, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const song = stmts.getSong.get(id);
    if (!song) return res.status(404).json({ error: 'Song not found' });

    const order = req.body.order;
    if (!Array.isArray(order) || !order.length) {
      return res.status(400).json({ error: 'order array required' });
    }

    const existing = new Set(stmts.getSongAssets.all(id).map((a) => a.file_path));
    const paths = order.map((p) => decodeRelPath(p)).filter((p) => p && existing.has(p));
    if (!paths.length) return res.status(400).json({ error: 'No valid paths' });

    const reorder = db.transaction((songId, orderedPaths) => {
      orderedPaths.forEach((filePath, idx) => {
        stmts.updateSongAssetSort.run(idx, songId, filePath);
      });
    });
    reorder(id, paths);

    const assets = enrichSongAssets(stmts.getSongAssets.all(id));
    res.json({ ok: true, assets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/songs/:id/assets', requireShareRoot, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const song = stmts.getSong.get(id);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    const rel = decodeRelPath(req.query.path || req.body.path);
    if (!rel) return res.status(400).json({ error: 'Path required' });
    stmts.removeSongAsset.run(id, rel);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Self-restart (spawn a new Node process, then exit). LAN-only use; do not expose to the internet.
app.post('/api/admin/restart', (req, res) => {
  if (IS_DOCKER) {
    res.json({ ok: true, restarting: true, docker: true });
    setTimeout(() => process.exit(0), 250);
    return;
  }
  res.json({ ok: true, restarting: true });
  setTimeout(() => {
    try {
      const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
        detached: true,
        stdio: 'ignore',
        cwd: __dirname,
        env: process.env,
        windowsHide: true,
      });
      child.unref();
    } catch (err) {
      console.error('Restart spawn failed:', err);
    }
    process.exit(0);
  }, 250);
});

// Multer / path errors from upload
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.message === 'Invalid folder' || err.message === 'Invalid folder path')) {
    return res.status(400).json({ error: 'Invalid folder path' });
  }
  return next(err);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
    }
  }
  console.log(`\nFileshare server running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  addresses.forEach((ip) => console.log(`  Network: http://${ip}:${PORT}`));
  const shareDir = getShareRoot();
  if (shareDir) {
    console.log(`\nStoring files in: ${shareDir}`);
    const displayDir = getShareDirDisplay();
    if (displayDir && displayDir !== shareDir) {
      console.log(`  Display path: ${displayDir}`);
    }
  } else {
    console.log('\nStorage folder not configured — open the app in a browser to finish setup');
  }
  console.log(`  Database: ${DB_PATH}`);
  console.log('Press Ctrl+C to stop\n');
});
