#!/usr/bin/env node
/**
 * Lint + syntax-check all project JavaScript.
 * Exit 1 on any failure (used by npm run check and Cursor session hooks).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (name.endsWith('.js') && name !== '_extracted.js') acc.push(full);
  }
  return acc;
}

console.log('Running ESLint…');
execSync('npx eslint "public/js/**/*.js" server.js scripts/check.js scripts/verify.js scripts/stamp-build.js .cursor/hooks', {
  cwd: root,
  stdio: 'inherit',
});

const files = [
  path.join(root, 'server.js'),
  ...walk(path.join(root, 'public', 'js')),
  ...walk(path.join(root, 'scripts')),
  ...walk(path.join(root, '.cursor', 'hooks')),
].filter((f) => fs.existsSync(f) && !f.includes('_extracted.js'));

console.log('Syntax-checking', files.length, 'files…');
for (const file of files) {
  execSync(`node --check "${file}"`, { cwd: root, stdio: 'pipe' });
}

console.log('All checks passed.');
