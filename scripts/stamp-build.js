#!/usr/bin/env node
/** Write a build id used for cache-busting static assets. */
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'public', '.build-id');
const id = String(Date.now());
fs.writeFileSync(out, id + '\n');
console.log('Build id:', id);
