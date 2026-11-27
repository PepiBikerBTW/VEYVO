// Copies the shared web app into www/ for Capacitor.
// The layout mirrors the repository (www/src + www/assets), so every relative path that works in the
// desktop app (for example ../assets/veyvo-icon.png from src/index.html) works on Android unchanged.
// www/index.html only forwards to src/index.html (no script, so the strict CSP stays intact).
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const www = join(here, '..', 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(join(root, 'src'), join(www, 'src'), { recursive: true });
cpSync(join(root, 'assets'), join(www, 'assets'), { recursive: true, filter: src => !src.endsWith('.ico') });
writeFileSync(join(www, 'index.html'), `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="refresh" content="0;url=src/index.html">
  <title>VEYVO</title>
  <style>html,body{margin:0;background:#0d0e11}</style>
</head>
<body></body>
</html>
`);
console.log('Synced web app into', www);
