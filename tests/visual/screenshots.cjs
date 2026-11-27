// VEYVO visual dev tool: renders the real app (src/index.html) headlessly and writes PNGs.
// Dev only (not shipped, not part of npm test). Run it with any Electron >= 38 binary:
//
//   ELECTRON=<path to electron>   # e.g. the Linux build in the session scratchpad
//   $ELECTRON --ozone-platform=headless --no-sandbox tests/visual/screenshots.cjs --out /tmp/shots \
//       [--page home,plan,progress,nutrition,kit] [--theme dark,light] [--lang cs,en]
//       [--size 1480x940,1120x720,412x915]   (aliases: desktop, min, phone)
//       [--seed demo|empty|legacy|<file.json>] [--platform desktop|android|ios|web] [--strava off|connected|error]
//       [--today YYYY-MM-DD] [--full] [--dialog name[:{"json":"params"}]] [--eval "<js>"]
//       [--wait 700] [--anim] [--name prefix] [--index <other index.html>] [--scale 3] [--settle 450] [--css "<extra css>"]
//       [--channel github|play|appstore]
//
// --scale renders at that device scale factor (the window size stays in CSS px, the PNG is w*scale x h*scale);
// tests/visual/store-graphics.cjs uses it for the crisp store screenshots. --settle is the wait after --eval;
// --css is injected like the animation freeze (e.g. hidden scrollbars, as on a phone).
//
// The Play build: `node mobile/scripts/sync-web.mjs --channel play --out <dir>`, then
// --index <dir>/src/index.html --platform android (fake Capacitor shell from stub-preload.cjs).
// The App Store build: `--channel appstore --out <dir>`, then --index <dir>/src/index.html --platform ios
// (the same shell as getPlatform() 'ios' with fake VeyvoWorkoutKit and VeyvoHealth plugins).
// --channel play|appstore does both in one step: it syncs that channel into a temporary folder (removed
// afterwards), loads it instead of src/index.html and defaults --platform to android / ios.
//
// Every combination of page x theme x lang x size gives <out>/<name><page>[-<dialog>]-<theme>-<lang>-<w>x<h>.png.
// Seeds: demo = the owner's 9 runs (27. 10. - 24. 11. 2026) shifted by whole weeks so the last run is
// within the past week (weekdays stay), recovery logged today (7,2 h / 4 / 2), profile 'Pepa';
// empty = fresh install; legacy = the same runs in the 0.3 format (exercises migration + notices).
// --page kit injects tests/visual/kit.js: a living style guide of every shared component and chart.
// Animations are frozen (data-motion="off" + CSS) unless --anim is given. Console errors are printed.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..', '..');
let INDEX = process.argv.includes('--index') ? path.resolve(process.argv[process.argv.indexOf('--index') + 1]) : path.join(ROOT, 'src', 'index.html');
const PRELOAD = path.join(__dirname, 'stub-preload.cjs');
const KIT = path.join(__dirname, 'kit.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(process.argv.findIndex(a => a.endsWith('screenshots.cjs')) + 1));
const list = (v, d) => String(v || d).split(',').map(s => s.trim()).filter(Boolean);
const SIZES = { desktop: '1480x940', min: '1120x720', phone: '412x915', tablet: '900x1100' };
const OUT = path.resolve(args.out || path.join(os.tmpdir(), 'veyvo-shots'));
const pagesArg = list(args.page, 'home');
const themes = list(args.theme, 'dark');
const langs = list(args.lang, 'cs');
const sizes = list(args.size, '1480x940').map(s => SIZES[s] || s);
const seedKind = args.seed || 'demo';
const CHANNEL_PLATFORM = { github: 'desktop', play: 'android', appstore: 'ios' };
const channel = args.channel && args.channel !== true ? String(args.channel) : null;
if (channel && !CHANNEL_PLATFORM[channel]) { console.error('screenshots: unknown --channel ' + channel); process.exit(1); }
const platform = args.platform || (channel ? CHANNEL_PLATFORM[channel] : 'desktop');
// --channel: sync that build into a temporary folder (the same copy Capacitor gets) and load it.
let channelDir = null;
if (channel && !args.index) {
  channelDir = path.join(os.tmpdir(), 'veyvo-shots-www-' + channel + '-' + process.pid);
  require('node:child_process').execFileSync(process.execPath, [path.join(ROOT, 'mobile', 'scripts', 'sync-web.mjs'), '--channel', channel, '--out', channelDir], {
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), stdio: ['ignore', 'ignore', 'inherit']
  });
  INDEX = path.join(channelDir, 'src', 'index.html');
}
const cleanChannelDir = () => { if (channelDir) fs.rmSync(channelDir, { recursive: true, force: true }); };
const strava = args.strava || 'connected';
const waitMs = Number(args.wait || 700);

// ---------------------------------------------------------------- seed data
const DAY = 86400000;
const keyOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const utc = key => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (key, n) => new Date(utc(key) + n * DAY).toISOString().slice(0, 10);
const TODAY = args.today || keyOf(new Date());
const BASE_RUNS = [
  ['2026-10-27', 'easy', 5.2, 1830, 4, ''],
  ['2026-10-31', 'intervals', 6.0, 1890, 8, '6× 400 m'],
  ['2026-11-03', 'long', 10.4, 3650, 6, ''],
  ['2026-11-07', 'tempo', 7.0, 2180, 7, ''],
  ['2026-11-10', 'run', 5.0, 1290, 9, ''],
  ['2026-11-14', 'easy', 6.1, 2140, 4, ''],
  ['2026-11-17', 'intervals', 6.5, 2010, 8, ''],
  ['2026-11-21', 'long', 12.0, 4180, 6, 'Kopce v druhé půlce'],
  ['2026-11-24', 'run', 5.0, 1262, 9, '']
];
const LAST = BASE_RUNS[BASE_RUNS.length - 1][0];
const SHIFT = Math.floor(Math.round((utc(TODAY) - utc(LAST)) / DAY) / 7) * 7;
const CZ_TYPES = { run: 'Běh', easy: 'Lehký běh', long: 'Dlouhý běh', tempo: 'Tempo', intervals: 'Intervaly', test5k: 'Test 5 km', race: 'Závod' };

function demoState(theme, lang) {
  const runs = BASE_RUNS.map(([date, type, distance, movingSeconds, effort, note], i) => ({
    id: 'm-demo-' + (i + 1), source: 'manual', date: addDays(date, SHIFT), startTime: i % 2 ? '18:10' : '07:30',
    type, distance, movingSeconds, effort, note
  }));
  return {
    schemaVersion: 2,
    profile: { name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true },
    runHistory: runs,
    recoveryLogs: [{ date: TODAY, sleepHours: 7.2, fatigue: 4, soreness: 2, note: '' }],
    legacyMilestones: [],
    ignoredStravaIds: [], plannedWorkouts: [], exportLog: [],
    theme, language: lang,
    strava: { connected: strava !== 'off', lastSync: strava !== 'off' ? new Date(utc(TODAY) + 7.7 * 3600000).toISOString() : null, lastError: strava === 'error' ? 'Synchronizace Stravy selhala (401).' : null },
    intervals: { enabled: false, lastPush: null, lastError: null },
    ui: { lastSeenVersion: null }
  };
}
function legacyState(theme, lang) {
  return {
    profile: { goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6] },
    runHistory: BASE_RUNS.map(([date, type, distance, movingSeconds, effort, note], i) => ({
      id: 1761580800000 + i, source: 'manual', date: addDays(date, SHIFT) + 'T00:00:00', type: CZ_TYPES[type], distance,
      time: Math.floor(movingSeconds / 60) + ':' + String(movingSeconds % 60).padStart(2, '0'), movingSeconds, effort, effortRecorded: true, note
    })),
    milestones: [], recoveryLogs: [], stravaActivityIds: [], theme, language: lang
  };
}
function seedFor(theme, lang) {
  if (seedKind === 'empty') return { 'veyvo-state': JSON.stringify(Object.assign(demoState(theme, lang), { runHistory: [], recoveryLogs: [], profile: { name: '', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: false } })) };
  if (seedKind === 'legacy') return { 'veyvo-state': JSON.stringify(legacyState(theme, lang)) };
  if (seedKind === 'none') return {};
  if (seedKind !== 'demo') return JSON.parse(fs.readFileSync(path.resolve(seedKind), 'utf8'));
  return { 'veyvo-state': JSON.stringify(demoState(theme, lang)) };
}

// ---------------------------------------------------------------- capture
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', String(Number(args.scale) > 0 ? Number(args.scale) : 1));
const wait = ms => new Promise(r => setTimeout(r, ms));
const BG = { dark: '#0D0E11', light: '#F2F3F5' };
const FREEZE = '*,*::before,*::after,::backdrop{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}';

async function shoot(cfg, n) {
  const [w, h] = cfg.size.split('x').map(Number);
  const seedPath = path.join(os.tmpdir(), 'veyvo-seed-' + process.pid + '-' + n + '.json');
  fs.writeFileSync(seedPath, JSON.stringify(seedFor(cfg.theme, cfg.lang)));
  const win = new BrowserWindow({
    show: true, width: w, height: h, useContentSize: true, backgroundColor: BG[cfg.theme] || BG.dark,
    webPreferences: {
      preload: PRELOAD, contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false,
      partition: 'veyvo-shot-' + process.pid + '-' + n,
      additionalArguments: ['--veyvo-seed=' + seedPath, '--veyvo-platform=' + platform, '--veyvo-strava=' + strava].concat(args.anim ? [] : ['--veyvo-motion=off'])
    }
  });
  win.setSize(w, h);
  win.setContentSize(w, h);
  const log = [];
  win.webContents.on('console-message', e => {
    if (e.level === 'warning' || e.level === 'error') log.push('[' + e.level + '] ' + e.message + (e.sourceId ? ' (' + path.basename(String(e.sourceId)) + ':' + e.lineNumber + ')' : ''));
  });
  win.webContents.on('preload-error', (e, file, error) => log.push('[preload] ' + error));
  const query = Object.assign({}, args.today ? { today: args.today } : {}, args.anim ? {} : { motion: 'off' });
  // The app rewrites location.hash while booting; Electron may report that as an aborted load.
  await win.loadFile(INDEX, { hash: cfg.page === 'kit' ? 'home' : cfg.page, query }).catch(error => log.push('[load] ' + error.code));
  for (let i = 0; i < 100; i++) {
    const ok = await win.webContents.executeJavaScript('!!(window.VeyvoUI && VeyvoUI.app && VeyvoUI.app.isReady && VeyvoUI.app.isReady())').catch(() => false);
    if (ok) break;
    await wait(50);
  }
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => document.fonts.size)');
  if (cfg.page === 'kit') {
    await win.webContents.executeJavaScript(fs.readFileSync(KIT, 'utf8'));
    await win.webContents.executeJavaScript("VeyvoUI.app.navigate('kit', { focus: false }); 0");
  }
  if (!args.anim) await win.webContents.insertCSS(FREEZE);
  if (args.css && args.css !== true) await win.webContents.insertCSS(String(args.css));
  await wait(args.anim ? Math.max(waitMs, 1200) : waitMs);
  if (args.dialog) {
    const [name, json] = String(args.dialog).split(/:(.*)/s);
    await win.webContents.executeJavaScript('void VeyvoUI.app.dialogs.open(' + JSON.stringify(name) + ', ' + (json || '{}') + ')');
    await wait(500);
  }
  if (args.eval && args.eval !== true) { await win.webContents.executeJavaScript(String(args.eval) + '\n;0'); await wait(Number(args.settle) >= 0 ? Number(args.settle) : 450); }
  if (args.full) {
    const extra = await win.webContents.executeJavaScript("(() => { const m = document.querySelector('#main'); return m ? Math.max(0, m.scrollHeight - m.clientHeight) : 0; })()");
    if (extra > 0) { win.setContentSize(w, Math.min(h + extra + 8, 6000)); await wait(600); }
  }
  const img = await win.webContents.capturePage();
  const dialogPart = args.dialog ? '-' + String(args.dialog).split(':')[0] : '';
  const file = path.join(OUT, (args.name ? args.name + '-' : '') + cfg.page + dialogPart + '-' + cfg.theme + '-' + cfg.lang + '-' + w + 'x' + h + (args.full ? '-full' : '') + '.png');
  fs.writeFileSync(file, img.toPNG());
  const size = img.getSize();
  console.log('saved', file, size.width + 'x' + size.height);
  log.forEach(line => console.log('   console', line));
  win.destroy();
  fs.rmSync(seedPath, { force: true });
}

app.on('window-all-closed', () => { /* keep running between jobs; we exit explicitly */ });
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = [];
  for (const page of pagesArg) for (const theme of themes) for (const lang of langs) for (const size of sizes) jobs.push({ page, theme, lang, size });
  let n = 0;
  try {
    for (const job of jobs) await shoot(job, n++);
    cleanChannelDir();
    app.exit(0);
  } catch (error) {
    console.error('screenshots failed', error);
    cleanChannelDir();
    app.exit(1);
  }
});
setTimeout(() => { console.error('screenshots: timeout'); cleanChannelDir(); app.exit(1); }, 30000 + 15000 * pagesArg.length * themes.length * langs.length * sizes.length);
