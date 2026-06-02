// ── DOM helpers ──────────────────────────────────────────────────────────────

export function el(tag, props) {
  const e = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
  }
  return e;
}

export function append(parent) {
  for (let i = 1; i < arguments.length; i++) {
    const c = arguments[i];
    if (typeof c === 'string') parent.appendChild(document.createTextNode(c));
    else if (c instanceof Node) parent.appendChild(c);
  }
  return parent;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_SHAPES = {
  image: [
    ['rect',     { x:'3', y:'3', width:'18', height:'18', rx:'2' }],
    ['circle',   { cx:'8.5', cy:'8.5', r:'1.5' }],
    ['polyline', { points:'21 15 16 10 5 21' }],
  ],
  audio: [
    ['path',   { d:'M9 18V5l12-2v13' }],
    ['circle', { cx:'6', cy:'18', r:'3' }],
    ['circle', { cx:'18', cy:'16', r:'3' }],
  ],
  video: [
    ['rect', { x:'2', y:'2', width:'20', height:'20', rx:'2.18' }],
    ['line', { x1:'7',  y1:'2',  x2:'7',  y2:'22' }],
    ['line', { x1:'17', y1:'2',  x2:'17', y2:'22' }],
    ['line', { x1:'2',  y1:'12', x2:'22', y2:'12' }],
    ['line', { x1:'2',  y1:'7',  x2:'7',  y2:'7'  }],
    ['line', { x1:'2',  y1:'17', x2:'7',  y2:'17' }],
    ['line', { x1:'17', y1:'17', x2:'22', y2:'17' }],
    ['line', { x1:'17', y1:'7',  x2:'22', y2:'7'  }],
  ],
  document: [
    ['path',     { d:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
    ['polyline', { points:'14 2 14 8 20 8' }],
    ['line',     { x1:'16', y1:'13', x2:'8', y2:'13' }],
    ['line',     { x1:'16', y1:'17', x2:'8', y2:'17' }],
  ],
  archive: [
    ['polyline', { points:'21 8 21 21 3 21 3 8' }],
    ['rect',     { x:'1', y:'3', width:'22', height:'5' }],
    ['line',     { x1:'10', y1:'12', x2:'14', y2:'12' }],
  ],
  code: [
    ['polyline', { points:'16 18 22 12 16 6' }],
    ['polyline', { points:'8 6 2 12 8 18' }],
  ],
  generic: [
    ['path',     { d:'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' }],
    ['polyline', { points:'13 2 13 9 20 9' }],
  ],
  folder: [
    ['path', { d:'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h11a2 2 0 0 1 2 2z' }],
  ],
  dl: [
    ['path',     { d:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points:'7 10 12 15 17 10' }],
    ['line',     { x1:'12', y1:'15', x2:'12', y2:'3' }],
  ],
  trash: [
    ['polyline', { points:'3 6 5 6 21 6' }],
    ['path',     { d:'M19 6l-1 14H6L5 6' }],
    ['path',     { d:'M10 11v6' }],
    ['path',     { d:'M14 11v6' }],
    ['path',     { d:'M9 6V4h6v2' }],
  ],
  rename: [
    ['path', { d:'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' }],
  ],
  edit: [
    ['path', { d:'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' }],
  ],
  eye: [
    ['path', { d:'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }],
    ['circle', { cx:'12', cy:'12', r:'3' }],
  ],
  chevL: [['polyline', { points:'15 18 9 12 15 6' }]],
  chevR: [['polyline', { points:'9 18 15 12 9 6' }]],
  play: [['polygon', { points:'5 3 19 12 5 21 5 3' }]],
  pause: [
    ['rect', { x:'6', y:'4', width:'4', height:'16' }],
    ['rect', { x:'14', y:'4', width:'4', height:'16' }],
  ],
  close: [
    ['line', { x1:'18', y1:'6', x2:'6', y2:'18' }],
    ['line', { x1:'6', y1:'6', x2:'18', y2:'18' }],
  ],
  volume: [
    ['polygon', { points:'11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['path', { d:'M15.54 8.46a5 5 0 0 1 0 7.07' }],
    ['path', { d:'M19.07 4.93a10 10 0 0 1 0 14.14' }],
  ],
  volumeMute: [
    ['polygon', { points:'11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['line', { x1:'23', y1:'9', x2:'17', y2:'15' }],
    ['line', { x1:'17', y1:'9', x2:'23', y2:'15' }],
  ],
};

export function makeIcon(name, size, color) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size || 18));
  svg.setAttribute('height', String(size || 18));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color || '#666');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of (ICON_SHAPES[name] || ICON_SHAPES.generic)) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    svg.appendChild(shape);
  }
  return svg;
}

export function makeFilledIcon(name, size, color) {
  const fill = color || '#2a2a2a';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size || 18));
  svg.setAttribute('height', String(size || 18));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', fill);
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of (ICON_SHAPES[name] || ICON_SHAPES.generic)) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
    shape.setAttribute('fill', fill);
    shape.setAttribute('stroke', 'none');
    svg.appendChild(shape);
  }
  return svg;
}

export const TYPE_MAP = {
  image:    ['jpg','jpeg','png','gif','webp','svg','bmp','heic','avif','tiff'],
  audio:    ['mp3','wav','flac','ogg','m4a','aiff','aac','opus'],
  video:    ['mp4','mkv','mov','avi','webm','m4v','flv','wmv'],
  document: ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','rtf','odt','pages','numbers','key','md','pro','cho'],
  archive:  ['zip','rar','7z','tar','gz','bz2','xz','dmg'],
  code:     ['js','ts','jsx','tsx','html','css','json','py','rb','go','java','c','cpp','h','sh','yml','yaml','xml','php','swift','kt','rs'],
};

export const TYPE_COLORS = {
  image:'#4aef8f', audio:'#b04aff', video:'#ff9f4a',
  document:'#4a9eff', archive:'#ffdf4a', code:'#ff6b9d', generic:'#555',
  folder:'#e8b84a',
};

export function fileType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  for (const [type, exts] of Object.entries(TYPE_MAP)) {
    if (exts.includes(ext)) return type;
  }
  return 'generic';
}

const TEXT_EXTENSIONS = new Set(['txt','md','pro','cho', ...TYPE_MAP.code]);
const EDITABLE_EXTENSIONS = new Set(['txt','md','pro','cho']);

export const NEW_SHEET_EXTENSIONS = [
  { value: '.md', label: '.md' },
  { value: '.txt', label: '.txt' },
  { value: '.pro', label: '.pro' },
  { value: '.cho', label: '.cho' },
];

export function fileExt(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

export function isTextFile(name) {
  return TEXT_EXTENSIONS.has(fileExt(name));
}

export function isEditableFile(name) {
  return EDITABLE_EXTENSIONS.has(fileExt(name));
}

export function isPdfFile(name) {
  return fileExt(name) === 'pdf';
}

export function parentDirFromPath(relPath) {
  const idx = relPath.lastIndexOf('/');
  return idx >= 0 ? relPath.slice(0, idx) : '';
}

const TAG_PALETTE = ['#4a9eff','#4aef8f','#ff9f4a','#b04aff','#ffdf4a','#ff6b9d','#4aefef','#ff7777'];

export function tagColor(id) {
  return TAG_PALETTE[((id - 1) % TAG_PALETTE.length)];
}

export function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

export function formatDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function formatDateFull(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

export function modifiedCell(iso) {
  const td = el('td', { class: 'col-modified', title: formatDateFull(iso) });
  td.textContent = formatDateShort(iso);
  return td;
}
