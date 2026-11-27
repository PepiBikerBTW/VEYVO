// Shared harness for the Electron UI tests (tests/ui-app.cjs, ui-flows.cjs, ui-nutrition.cjs).
// Not a node --test file: each UI test is an Electron main script, run by `npm run test:ui`
// (Windows CI, the repo's Electron) or by hand with any Electron >= 38:
//
//   electron tests/ui-app.cjs
//   <linux electron> --ozone-platform=headless --no-sandbox tests/ui-app.cjs
//
// The window loads the real src/index.html with the real electron/preload.js (sandboxed, context
// isolated, exactly like electron/main.js); every IPC channel the preload uses is answered here by a
// recording stub, so tests can assert what the page sent (saved files, backups, title bar colours)
// and drive what main would answer (Strava activities, updater events). Nothing touches the disk,
// the network or the real userData: each test gets its own in-memory partition.
'use strict';
const { app, BrowserWindow, ipcMain, clipboard, Menu } = require('electron');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'src', 'index.html');
const PRELOAD = path.join(ROOT, 'electron', 'preload.js');
const TODAY = '2026-11-27'; // Friday; every test pins the app's date with ?today=

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------- seed data (the owner's 9 runs)
const OWNER_RUNS = [
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
const CZ_TYPES = { run: 'Běh', easy: 'Lehký běh', long: 'Dlouhý běh', tempo: 'Tempo', intervals: 'Intervaly', test5k: 'Test 5 km', race: 'Závod' };

function ownerState(overrides) {
  return Object.assign({
    schemaVersion: 2,
    profile: { name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true },
    runHistory: OWNER_RUNS.map(([date, type, distance, movingSeconds, effort, note], i) => ({
      id: 'm-seed-' + (i + 1), source: 'manual', date, startTime: '18:10', type, distance, movingSeconds, effort, note
    })),
    recoveryLogs: [],
    legacyMilestones: [],
    ignoredStravaIds: [], plannedWorkouts: [], exportLog: [],
    theme: 'dark', language: 'cs',
    strava: { connected: false, lastSync: null, lastError: null },
    intervals: { enabled: false, lastPush: null, lastError: null },
    ui: { lastSeenVersion: null }
  }, overrides || {});
}
/** The same runs as 0.3 stored them: Czech type labels, ISO date-times, 'mm:ss' strings, no schemaVersion. */
function legacyState() {
  return {
    profile: { goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6] },
    runHistory: OWNER_RUNS.map(([date, type, distance, movingSeconds, effort, note], i) => ({
      id: 1761580800000 + i, source: 'manual', date: date + 'T00:00:00', type: CZ_TYPES[type], distance,
      time: Math.floor(movingSeconds / 60) + ':' + String(movingSeconds % 60).padStart(2, '0'), movingSeconds, effort, effortRecorded: true, note
    })).concat([{
      // a Strava import from 0.3: fake-Z local time, no effort
      id: 'strava-9001', source: 'strava', stravaActivityId: '9001', date: '2026-11-25T19:30:00Z', type: 'Běh',
      distance: 3.2, movingSeconds: 1150, time: '19:10', name: 'Večerní běh', effort: null
    }]),
    milestones: [{ date: '2026-11-10', label: '5 km pod 21:30' }],
    recoveryLogs: [{ date: '2026-11-26', sleepHours: 7, fatigue: 5, soreness: 3 }],
    stravaActivityIds: ['9001'], theme: 'light', language: 'cs'
  };
}

// ---------------------------------------------------------------- IPC stubs (the channels of electron/preload.js)
const calls = {};
const overrides = {};
const DEFAULTS = {
  'app-version': () => '0.4.0-test',
  'updater-check': () => undefined,
  'updater-install': () => undefined,
  'strava-status': () => ({ connected: false, athlete: null }),
  'strava-connect': () => ({ pending: true }),
  'strava-sync': () => [],
  'strava-disconnect': () => ({ connected: false }),
  'file-save': file => ({ saved: true, path: path.join(ROOT, 'test-output', String(file && file.name)) }),
  'file-show': () => ({ shown: true }),
  'open-external': () => ({ opened: true }),
  'http-request': () => { throw new Error('[network] offline test stub'); },
  'secret-get': () => null,
  'secret-set': () => undefined,
  'secret-remove': () => undefined,
  'backup-snapshot': () => ({ path: path.join(ROOT, 'test-output', 'veyvo-' + TODAY + '.json') }),
  'backup-list': () => [],
  'backup-read': () => '',
  'garmin-find-drives': () => [],
  'garmin-copy': () => ({ saved: false }),
  'titlebar-theme': () => ({}),
  'notify': () => ({ shown: false })
};
for (const channel of Object.keys(DEFAULTS)) {
  calls[channel] = [];
  ipcMain.handle(channel, async (_event, ...args) => {
    calls[channel].push(args);
    return (overrides[channel] || DEFAULTS[channel])(...args);
  });
}
const ipc = {
  calls,
  set(channel, fn) { overrides[channel] = fn; },
  reset(channel) { if (channel) { delete overrides[channel]; calls[channel] = []; } else for (const k of Object.keys(calls)) { delete overrides[k]; calls[k] = []; } }
};

// ---------------------------------------------------------------- in-page helpers (window.T)
const PAGE_HELPERS = `(() => {
  if (window.T) return;
  const $ = (s, r) => (typeof s === 'string' ? (r || document).querySelector(s) : s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const need = (s, r) => { const el = $(s, r); if (!el) throw new Error('not found: ' + s); return el; };
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  window.T = {
    $, $$, need, visible,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    async wait(fn, ms, label) {
      const end = Date.now() + (ms || 4000);
      let last;
      for (;;) {
        try { last = fn(); if (last) return last; } catch (e) { last = e; }
        if (Date.now() > end) throw new Error('timeout waiting for ' + (label || fn.toString().slice(0, 140)) + (last instanceof Error ? ' (' + last.message + ')' : ''));
        await new Promise(r => setTimeout(r, 25));
      }
    },
    click(s, r) { const el = need(s, r); el.click(); return el; },
    input(s, value, r) {
      const el = need(s, r);
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el;
    },
    dialog() { const list = $$('dialog[open]'); return list[list.length - 1] || null; },
    dialogs() { return $$('dialog[open]').length; },
    text(s, r) { const el = $(s, r); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; },
    pageText() { return document.querySelector('#main').innerText; },
    toast() { const el = $('#toast-root .toast:not(.is-leaving)'); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; },
    async toastAction() { const btn = await T.wait(() => $('#toast-root .toast:not(.is-leaving) .toast-action'), 3000, 'toast action'); btn.click(); },
    byText(selector, text, r) { return $$(selector, r).find(el => el.textContent.replace(/\\s+/g, ' ').includes(text)) || null; },
    state: () => VeyvoUI.app.state(),
    derived: () => VeyvoUI.app.derived(),
    async go(page) {
      VeyvoUI.app.navigate(page);
      await T.wait(() => VeyvoUI.app.page() === page && document.querySelector('[data-page="' + page + '"]').childElementCount > 0, 3000, 'page ' + page);
      await T.sleep(60);
    },
    async closeDialogs() { VeyvoUI.app.dialogs.closeAll(); await T.wait(() => T.dialogs() === 0, 3000, 'dialogs closed'); }
  };
})(); 0`;

// ---------------------------------------------------------------- the harness
/**
 * run(name, async t => { ... }, { width, height, seed, today, platform }) boots one window, runs the
 * test body, prints a summary and exits (0 = all checks passed). t:
 *   t.js(expr), t.exec(body)   await a page expression / run an async function body in the page
 *   t.seed(storage)            replace localStorage ({ key: value | object }) and reload
 *   t.reload(), t.setSize(w,h), t.key(code, mods?), t.type(text), t.clickAt(x, y), t.clickOn(selector)
 *   t.ok(cond, label), t.equal(a, b, label), t.match(str, re, label)
 *   t.ipc                      recorded calls + overrides (see above)
 *   t.errors                   console errors/warnings and crashes seen so far
 */
function run(name, body, options) {
  const o = Object.assign({ width: 1480, height: 940, today: TODAY }, options || {});
  const errors = [];
  let checks = 0;
  const t = {
    TODAY, ipc, errors, ownerState, legacyState, OWNER_RUNS, clipboard,
    win: null,
    ok(cond, label) { checks++; if (!cond) throw new Error('FAILED: ' + label); console.log('  ok  ' + label); },
    equal(actual, expected, label) {
      checks++;
      const a = JSON.stringify(actual), e = JSON.stringify(expected);
      if (a !== e) throw new Error('FAILED: ' + label + '\n      expected ' + e + '\n      actual   ' + a);
      console.log('  ok  ' + label);
    },
    match(str, re, label) { checks++; if (!re.test(String(str))) throw new Error('FAILED: ' + label + '\n      ' + JSON.stringify(String(str).slice(0, 400)) + ' !~ ' + re); console.log('  ok  ' + label); },
    /** js(expression): the awaited value of one page expression. */
    js(expr) { return t.exec('return (' + expr + ');'); },
    /** exec(statements): runs an async function body in the page; returns what it returns. */
    async exec(code) {
      try { return await t.win.webContents.executeJavaScript('(async () => { ' + code + '\n })()', true); }
      catch (error) { throw new Error('page error: ' + (error && error.message || error) + '\n      in: ' + code.slice(0, 300)); }
    },
    async ready() {
      for (let i = 0; i < 200; i++) {
        const ok = await t.win.webContents.executeJavaScript('!!(window.VeyvoUI && VeyvoUI.app && VeyvoUI.app.isReady && VeyvoUI.app.isReady())').catch(() => false);
        if (ok) break;
        await wait(25);
      }
      await t.win.webContents.executeJavaScript('document.fonts.ready.then(() => 0)');
      await t.win.webContents.executeJavaScript(PAGE_HELPERS);
      await wait(80);
    },
    async load(hash) {
      // A load that only changes the #hash would be a same-document navigation (no restart): leave first.
      await t.win.loadURL('about:blank');
      await t.win.loadFile(INDEX, { hash: hash || 'home', query: { today: o.today } }).catch(() => { /* the app rewrites the hash while booting */ });
      await t.ready();
    },
    async reload() {
      await new Promise(resolve => { t.win.webContents.once('did-finish-load', resolve); t.win.webContents.reload(); });
      await t.ready();
    },
    async seed(storage, hash) {
      const entries = Object.entries(storage || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
      await t.win.webContents.executeJavaScript('localStorage.clear(); ' + JSON.stringify(entries) + '.forEach(([k, v]) => localStorage.setItem(k, v)); 0');
      if (hash) await t.load(hash); else await t.reload();
    },
    setSize(w, h) { t.win.setSize(w, h); t.win.setContentSize(w, h); return wait(250); },
    async key(keyCode, modifiers) {
      t.win.webContents.focus();
      t.win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: modifiers || [] });
      if (keyCode.length === 1) t.win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers: modifiers || [] });
      t.win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: modifiers || [] });
      await wait(60);
    },
    async type(text) { t.win.webContents.focus(); await t.win.webContents.insertText(text); await wait(30); },
    async clickAt(x, y) {
      t.win.focus();
      t.win.webContents.focus();
      t.win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      t.win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await wait(60);
    },
    /** clickOn(selector): a real mouse click at the element's centre (focus + user activation, like a person). */
    async clickOn(selector) {
      const box = await t.js(`(() => { const el = T.need(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      await t.clickAt(box.x, box.y);
    },
    noErrors(label) {
      checks++;
      if (errors.length) throw new Error('FAILED: ' + (label || 'no console errors') + '\n      ' + errors.join('\n      '));
      console.log('  ok  ' + (label || 'no console errors or warnings'));
    }
  };

  app.whenReady().then(async () => {
    const started = Date.now();
    Menu.setApplicationMenu(null); // no menu bar eating into the content height (Linux, Windows dev runs)
    console.log(name);
    try {
      t.win = new BrowserWindow({
        show: false, width: o.width, height: o.height, useContentSize: true, backgroundColor: '#0D0E11',
        webPreferences: {
          preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true,
          backgroundThrottling: false, spellcheck: false, partition: 'veyvo-ui-test-' + process.pid
        }
      });
      // Headless Linux starts every window on a 1x1 display: size it after creation. The window must
      // be shown (without stealing focus) or later resizes never reach the page.
      t.win.setSize(o.width, o.height);
      t.win.setContentSize(o.width, o.height);
      t.win.showInactive();
      const wc = t.win.webContents;
      // One declared parameter: Electron >= 35 passes everything on the event (older ones as extra arguments).
      wc.on('console-message', function (event) {
        const legacy = arguments;
        const level = typeof event.level === 'string' ? event.level : ({ 0: 'verbose', 1: 'info', 2: 'warning', 3: 'error' })[legacy[1]];
        const message = event.message !== undefined ? event.message : legacy[2];
        const line = event.lineNumber !== undefined ? event.lineNumber : legacy[3];
        const source = event.sourceId !== undefined ? event.sourceId : legacy[4];
        if (level === 'error' || level === 'warning') {
          // Electron's own dev-mode security banner is not a page problem.
          if (/Electron Security Warning/.test(message)) return;
          errors.push('[' + level + '] ' + message + (source ? ' (' + path.basename(String(source)) + ':' + line + ')' : ''));
        }
      });
      wc.on('render-process-gone', (_e, details) => errors.push('[crash] renderer gone: ' + details.reason));
      wc.on('preload-error', (_e, file, error) => errors.push('[preload] ' + error));
      // First load: a fresh, empty profile. Seed the requested storage, then reload.
      await t.load();
      if (o.seed !== undefined) await t.seed(o.seed);
      await body(t);
      console.log(name + ': ' + checks + ' checks passed in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s');
      app.exit(0);
    } catch (error) {
      console.error(String(error && error.stack || error));
      if (errors.length) console.error('console:\n  ' + errors.join('\n  '));
      app.exit(1);
    }
  });
  setTimeout(() => { console.error(name + ': timeout'); app.exit(1); }, o.timeout || 120000);
}

module.exports = { run, TODAY, ownerState, legacyState, OWNER_RUNS, wait };
