/** Lightweight ChordPro → HTML renderer (view-only). */

export function parseChordPro(text) {
  const lines = String(text || '').split('\n');
  const meta = {};
  const sections = [];
  let current = { label: '', lines: [] };

  function flush() {
    if (current.lines.length || current.label) sections.push(current);
    current = { label: '', lines: [] };
  }

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const dir = line.match(/^\{(\w+):\s*(.*)\}$/);
    if (dir) {
      meta[dir[1].toLowerCase()] = dir[2].trim();
      continue;
    }
    const block = line.match(/^\{(start_of_\w+|soc|eoc|end_of_\w+)\}(.*)$/i);
    if (block) {
      flush();
      current.label = block[2].trim() || block[1].replace(/^start_of_/i, '').replace(/^end_of_/i, '');
      continue;
    }
    if (/^\{(end_of_\w+|eoc)\}/i.test(line)) {
      flush();
      continue;
    }
    current.lines.push(line);
  }
  flush();
  return { meta, sections };
}

function chordLyricPairs(line) {
  const chordRe = /\[([^\]]+)\]/g;
  let m;
  const chords = [];
  while ((m = chordRe.exec(line)) !== null) {
    chords.push(m[1]);
  }
  const lyrics = line.replace(/\[[^\]]+\]/g, '');
  if (!chords.length) return { chords: '', lyrics: line };
  let chordLine = '';
  let pos = 0;
  for (const chord of chords) {
    const idx = line.indexOf('[' + chord + ']', pos);
    while (chordLine.length < idx) chordLine += ' ';
    chordLine += chord;
    pos = idx + chord.length + 2;
  }
  return { chords: chordLine, lyrics };
}

export function renderChordProHtml(text) {
  const { meta, sections } = parseChordPro(text);
  let html = '';
  if (meta.title) html += `<div class="cp-title">${escapeHtml(meta.title)}</div>`;
  if (meta.artist) html += `<div class="cp-artist">${escapeHtml(meta.artist)}</div>`;
  for (const sec of sections) {
    html += '<div class="cp-section">';
    if (sec.label) html += `<div class="cp-section-label">${escapeHtml(sec.label)}</div>`;
    for (const line of sec.lines) {
      const { chords, lyrics } = chordLyricPairs(line);
      if (chords) html += `<div class="cp-line"><div class="cp-chords">${escapeHtml(chords)}</div><div class="cp-lyrics">${escapeHtml(lyrics)}</div></div>`;
      else if (lyrics.trim()) html += `<div class="cp-line"><div class="cp-chords"></div><div class="cp-lyrics">${escapeHtml(lyrics)}</div></div>`;
      else html += '<div class="cp-line"><br></div>';
    }
    html += '</div>';
  }
  return html || `<div class="cp-lyrics">${escapeHtml(text)}</div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
