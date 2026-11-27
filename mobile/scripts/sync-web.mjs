// Copies the shared web app into www/ for Capacitor (Android and iOS).
// The layout mirrors the repository (www/src + www/assets), so every relative path that works in the
// desktop app (for example ../assets/veyvo-icon.png from src/index.html) works in the mobile apps unchanged.
// www/index.html only forwards to src/index.html (no script, so the strict CSP stays intact).
//
// Build channel (contract in src/build-info.js):
//   node scripts/sync-web.mjs                      'github'   (default: the Android APK on GitHub releases)
//   node scripts/sync-web.mjs --channel play       'play'     (Google Play)
//   node scripts/sync-web.mjs --channel appstore   'appstore' (Apple App Store, used by `npm run sync:ios`)
// For a store channel ('play', 'appstore') the copy in www/ is changed, never the source in ../src:
//   1. www/src/build-info.js gets that channel (globalThis.VEYVO_BUILD = { channel: '<channel>' }).
//   2. In every www/src/**/*.js file, lines from '// #if-channel <list>' to '// #end-channel' are removed
//      unless <list> names the channel, so the store builds do not even contain the GitHub self-updater.
// The 'github' channel copies src/ unchanged.
// A store build fails (exit 1) when its JS still contains the GitHub updater ('api.github.com',
// 'releases/latest', '.apk') or when www/src/index.html does not load build-info.js first.
// --out <dir> syncs into another folder instead of www/ (tests); it only replaces an empty folder or
// an earlier sync output.
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHANNELS = ['github', 'play', 'appstore'];
const STORE_CHANNELS = ['play', 'appstore'];

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
let www = join(here, '..', 'www');
let outDir = null;
// What a store build must not contain anywhere in its JS (Play Device and Network Abuse policy).
export const STORE_FORBIDDEN = [/api\.github\.com/, /releases\/latest/, /\.apk\b/i];

function fail(message) {
  console.error('sync-web: ' + message);
  process.exit(1);
}

function parseChannel(argv) {
  let channel = process.env.VEYVO_CHANNEL || 'github';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--channel') channel = argv[++i] || '';
    else if (argv[i].startsWith('--channel=')) channel = argv[i].slice('--channel='.length);
    else if (argv[i] === '--out') outDir = argv[++i] || '';
    else if (argv[i].startsWith('--out=')) outDir = argv[i].slice('--out='.length);
    else fail('unknown argument ' + argv[i] + ' (usage: node scripts/sync-web.mjs [--channel github|play|appstore] [--out <dir>])');
  }
  if (!CHANNELS.includes(channel)) fail('unknown channel "' + channel + '", expected one of ' + CHANNELS.join(', '));
  return channel;
}

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

const IF_RE = /^\s*\/\/\s*#if-channel\s+(.+?)\s*$/;
const END_RE = /^\s*\/\/\s*#end-channel\b/;

/** Removes '// #if-channel <list>' ... '// #end-channel' blocks whose list does not name the channel. */
export function stripChannelBlocks(source, channel, label = 'source') {
  const lines = source.split('\n');
  const out = [];
  let block = null; // { keep, line }
  let removed = 0;
  lines.forEach((line, index) => {
    const open = IF_RE.exec(line);
    if (open) {
      if (block) throw new Error(label + ':' + (index + 1) + ': nested #if-channel (opened at line ' + block.line + ')');
      const names = open[1].split(/[\s,]+/).filter(Boolean);
      const unknown = names.filter(name => !CHANNELS.includes(name));
      if (unknown.length) throw new Error(label + ':' + (index + 1) + ': unknown channel ' + unknown.join(', '));
      block = { keep: names.includes(channel), line: index + 1 };
      if (!block.keep) removed++;
      return;
    }
    if (END_RE.test(line)) {
      if (!block) throw new Error(label + ':' + (index + 1) + ': #end-channel without #if-channel');
      block = null;
      return;
    }
    if (!block || block.keep) out.push(line);
  });
  if (block) throw new Error(label + ':' + block.line + ': #if-channel is never closed');
  return { text: out.join('\n'), removed };
}

/** Sets the channel in build-info.js: the one code line with `channel: '<value>'`. */
export function setBuildChannel(source, channel) {
  const lines = source.split('\n');
  let hits = 0;
  const out = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return line;
    return line.replace(/(\bchannel\s*:\s*)(['"])[a-z]+\2/, (match, key, quote) => {
      hits++;
      return key + quote + channel + quote;
    });
  });
  if (hits !== 1) throw new Error('build-info.js must contain exactly one `channel: \'...\'` code line, found ' + hits);
  return out.join('\n');
}

function applyChannel(channel) {
  const srcDir = join(www, 'src');
  const buildInfo = join(srcDir, 'build-info.js');
  if (!existsSync(buildInfo)) fail('src/build-info.js is missing, so the "' + channel + '" channel cannot be set');
  writeFileSync(buildInfo, setBuildChannel(readFileSync(buildInfo, 'utf8'), channel));

  const platform = join(srcDir, 'platform.js');
  if (existsSync(platform) && !readFileSync(platform, 'utf8').includes("'" + channel + "'")) {
    fail('src/platform.js does not list the "' + channel + '" channel yet; it would treat this build as "github"');
  }

  let blocks = 0;
  for (const file of jsFiles(srcDir)) {
    const before = readFileSync(file, 'utf8');
    if (!before.includes('#if-channel')) continue;
    let result;
    try { result = stripChannelBlocks(before, channel, relative(www, file)); } catch (error) { fail(error.message); }
    if (result.text !== before) writeFileSync(file, result.text);
    blocks += result.removed;
  }

  // Store builds must not contain the GitHub updater at all (not even in comments): fail the build.
  const leftovers = [];
  for (const file of jsFiles(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const re of STORE_FORBIDDEN) if (re.test(text)) leftovers.push(relative(www, file) + ' (' + re.source + ')');
  }
  if (leftovers.length) {
    fail('the "' + channel + '" build still contains GitHub updater code after stripping: ' + leftovers.join(', ') +
      '. Wrap it in // #if-channel github ... // #end-channel.');
  }
  // The channel only applies when build-info.js runs before every other script.
  const html = readFileSync(join(srcDir, 'index.html'), 'utf8');
  const first = /<script\s+src="([^"]+)"/.exec(html);
  if (!first || first[1] !== 'build-info.js') fail('src/index.html must load build-info.js as its first script');
  return blocks;
}

/** --out: an empty or missing folder, or an earlier sync output (it has src/build-info.js); never anything else. */
function useOutDir(dir) {
  if (!dir) fail('--out needs a folder');
  const target = resolve(dir);
  if (existsSync(target) && readdirSync(target).length && !existsSync(join(target, 'src', 'build-info.js'))) {
    fail('refusing to replace ' + target + ': it is not empty and not an earlier sync output');
  }
  www = target;
}

function main() {
  const channel = parseChannel(process.argv.slice(2));
  if (outDir !== null) useOutDir(outDir);
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
  let note = '';
  if (STORE_CHANNELS.includes(channel)) note = ', ' + applyChannel(channel) + ' github-only block(s) removed';
  console.log('Synced web app into', www, '(channel ' + channel + note + ')');
}

// Run when executed directly (node scripts/sync-web.mjs); importing it (tests) only exposes the helpers.
function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch (error) { return false; }
}
if (isMain()) main();
