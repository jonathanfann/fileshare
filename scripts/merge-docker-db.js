#!/usr/bin/env node
/** Merge songs from a stray Docker DB (/data/fileshare.db) into the persisted data/db copy. */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..');
const targetPath = path.join(root, 'data', 'db', 'fileshare.db');
const strayPath = process.argv[2];

if (!strayPath || !fs.existsSync(strayPath)) {
  console.error('Usage: node scripts/merge-docker-db.js <path-to-stray-fileshare.db>');
  process.exit(1);
}
if (!fs.existsSync(targetPath)) {
  console.error('Target DB missing:', targetPath);
  process.exit(1);
}

const stray = new Database(strayPath, { readonly: true });
const target = new Database(targetPath);

const straySongs = stray.prepare('SELECT * FROM songs ORDER BY id').all();
const targetIds = new Set(target.prepare('SELECT id FROM songs').all().map((r) => r.id));

console.log('Target songs:', target.prepare('SELECT id, name FROM songs ORDER BY id').all());
console.log('Stray songs:', straySongs.map((s) => ({ id: s.id, name: s.name })));

const merge = target.transaction(() => {
  for (const song of straySongs) {
    if (targetIds.has(song.id)) {
      console.log('Skip existing song id', song.id, song.name);
      continue;
    }
    target.prepare('INSERT INTO songs (id, name, notes, created_at) VALUES (?, ?, ?, ?)').run(
      song.id,
      song.name,
      song.notes || '',
      song.created_at,
    );
    console.log('Merged song', song.id, song.name);
    const assets = stray.prepare('SELECT * FROM song_assets WHERE song_id = ?').all(song.id);
    for (const a of assets) {
      target.prepare(`
        INSERT OR IGNORE INTO song_assets (song_id, file_path, role, sort_order, notes, track_labels)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(song.id, a.file_path, a.role || '', a.sort_order ?? 0, a.notes || '', a.track_labels || '[]');
      console.log('  asset', a.file_path);
    }
    const tags = stray.prepare('SELECT tag_id FROM song_tags WHERE song_id = ?').all(song.id);
    for (const t of tags) {
      target.prepare('INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)').run(song.id, t.tag_id);
    }
  }
});

merge();
console.log('Done. Final songs:', target.prepare('SELECT id, name FROM songs ORDER BY id').all());
stray.close();
target.close();
