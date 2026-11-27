#!/usr/bin/env node
// Store text length check for docs/store/*.md.
//
//   node docs/store/count-chars.cjs            prints a Markdown table, exits 1 when a field is over its limit
//
// Every pasteable field in the store docs is a fenced ```text block directly after a marker line:
//   <!-- field: <id> | max: <n> [| unit: bytes] -->
// "chars" counts Unicode code points, the way Play Console and App Store Connect count characters
// ("č" is 1). unit: bytes counts UTF-8 bytes ("č" is 2); it is used where Apple's limit is in bytes
// (App Store keywords, App Review notes), so a Czech keyword list cannot pass here and fail in App Store Connect.
// tests/store-listing.test.js runs the same check in npm test.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const FILES = [
  'play-listing.cs.md', 'play-listing.en.md',
  'appstore-listing.cs.md', 'appstore-listing.en.md',
  'declarations.md'
];
const MARKER = /<!--\s*field:\s*([\w.-]+)\s*\|\s*max:\s*(\d+)(?:\s*\|\s*unit:\s*(chars|bytes))?\s*-->\s*\n```text\n([\s\S]*?)\n```/g;

/** The text exactly as it will be pasted: the block body without the fence lines. */
function fieldsOf(markdown) {
  const out = [];
  let m;
  MARKER.lastIndex = 0;
  while ((m = MARKER.exec(markdown))) {
    const text = m[4];
    out.push({
      id: m[1], max: Number(m[2]), unit: m[3] || 'chars', text,
      chars: [...text].length, bytes: Buffer.byteLength(text, 'utf8')
    });
  }
  return out;
}

function check(dir = DIR) {
  const rows = [];
  for (const file of FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) { rows.push({ file, id: '(file missing)', max: 0, unit: 'chars', chars: 0, bytes: 0, used: 0, ok: false }); continue; }
    for (const f of fieldsOf(fs.readFileSync(full, 'utf8'))) {
      const used = f.unit === 'bytes' ? f.bytes : f.chars;
      rows.push(Object.assign({ file }, f, { used, ok: used <= f.max && f.text.trim().length > 0 }));
    }
  }
  return rows;
}

function table(rows) {
  const lines = ['| File | Field | Characters | UTF-8 bytes | Limit | OK |', '|---|---|---:|---:|---:|---|'];
  for (const r of rows) lines.push('| ' + [r.file, r.id, r.chars, r.bytes, r.max + (r.unit === 'bytes' ? ' bytes' : ' chars'), r.ok ? 'yes' : 'NO'].join(' | ') + ' |');
  return lines.join('\n');
}

module.exports = { FILES, fieldsOf, check, table };

if (require.main === module) {
  const rows = check();
  console.log(table(rows));
  const bad = rows.filter(r => !r.ok);
  if (bad.length) { console.error('\nOver the limit or empty: ' + bad.map(r => r.file + ' ' + r.id).join(', ')); process.exit(1); }
}
