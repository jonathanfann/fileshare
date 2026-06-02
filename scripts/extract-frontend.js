const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const scriptMatch = html.match(
  /<script src="\/vendor\/marked\.min\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/
);

if (!styleMatch || !scriptMatch) {
  console.error('Failed to parse index.html');
  process.exit(1);
}

const css = styleMatch[1].replace(/^    /gm, '');
const js = scriptMatch[1].replace(/^  /gm, '');

fs.mkdirSync(path.join(__dirname, '..', 'public', 'css'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'public', 'js', 'ui'), { recursive: true });

fs.writeFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), css);
fs.writeFileSync(path.join(__dirname, '..', 'public', 'js', '_extracted.js'), js);

console.log('Extracted CSS:', css.length, 'bytes');
console.log('Extracted JS:', js.length, 'bytes');
