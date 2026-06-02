const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'public', 'js', 'app.js');
let s = fs.readFileSync(p, 'utf8');

const header = `import { renderChordProHtml } from './chordpro.js';
import {
  el, append, makeIcon, makeFilledIcon, fileType, fileExt, isTextFile, isEditableFile, isPdfFile,
  parentDirFromPath, formatSize, formatDate, tagColor, TYPE_MAP, TYPE_COLORS, NEW_SHEET_EXTENSIONS,
} from './util.js';
import { showToast } from './ui/toast.js';

`;

s = s.replace(
  /import \{ renderChordProHtml \} from '\.\/chordpro\.js';\s*\n\s*\/\/ ── DOM helpers[\s\S]*?function tagColor\(id\) \{ return TAG_PALETTE\[\(\(id - 1\) % TAG_PALETTE\.length\)\]; \}\n\n/,
  header
);

s = s.replace(
  /\/\/ ── Formatters[\s\S]*?function modifiedCell[\s\S]*?\}\n\n/,
  ''
);

s = s.replace(
  /\/\/ ── Toast[\s\S]*?function showToast\(msg, type\) \{[\s\S]*?\}\n\n/,
  ''
);

fs.writeFileSync(p, s);
console.log('Stripped duplicates from app.js');
