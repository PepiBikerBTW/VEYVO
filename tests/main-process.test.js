// electron/main.js under Node with a fake 'electron' module: the IPC handlers that touch the disk or
// the browser (backup snapshots and their safety copies, the Strava connect flow). No window opens:
// app.whenReady() never resolves here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const MAIN = path.join(__dirname, '..', 'electron', 'main.js');
const EVENT = { senderFrame: { url: 'file:///C:/VEYVO/src/index.html', parent: null } };

function loadMain() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvo-main-'));
  const handlers = {};
  const shell = { openExternal: async () => {} };
  const noop = () => {};
  const electron = {
    app: {
      getPath: () => userData, getVersion: () => '0.4.0-test', isPackaged: false,
      requestSingleInstanceLock: () => true, setAppUserModelId: noop, on: noop, quit: noop,
      whenReady: () => new Promise(noop)
    },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    shell,
    safeStorage: { isEncryptionAvailable: () => false },
    dialog: {}, session: {}, Notification: function () {}
  };
  const updater = { autoUpdater: { on: noop } };
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === 'electron-updater') return updater;
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(MAIN)];
    require(MAIN);
  } finally {
    Module._load = original;
  }
  const call = (channel, ...args) => Promise.resolve().then(() => handlers[channel](EVENT, ...args));
  return { userData, handlers, shell, call, backups: () => fs.readdirSync(path.join(userData, 'backups')).sort() };
}

test('main: a replace/wipe safety copy is its own file; the daily backup and earlier copies are never overwritten', async () => {
  const m = loadMain();
  const daily = await m.call('backup-snapshot', JSON.stringify({ n: 'ORIGINAL' }));
  assert.match(path.basename(daily.path), /^veyvo-\d{4}-\d{2}-\d{2}\.json$/);
  const first = await m.call('backup-snapshot', JSON.stringify({ n: 'BEFORE-REPLACE-1' }), { kind: 'replace' });
  const second = await m.call('backup-snapshot', JSON.stringify({ n: 'BEFORE-REPLACE-2' }), { kind: 'replace' });
  const wipe = await m.call('backup-snapshot', JSON.stringify({ n: 'BEFORE-WIPE' }), { kind: 'wipe' });
  assert.notEqual(first.path, second.path, 'a second replace on the same day keeps the first copy');
  assert.match(path.basename(wipe.path), /-before-wipe\.json$/);
  assert.equal(JSON.parse(fs.readFileSync(daily.path, 'utf8')).n, 'ORIGINAL', 'the daily file still holds the original');
  assert.equal(JSON.parse(fs.readFileSync(first.path, 'utf8')).n, 'BEFORE-REPLACE-1');
  assert.equal(JSON.parse(fs.readFileSync(second.path, 'utf8')).n, 'BEFORE-REPLACE-2');
  assert.equal(m.backups().length, 4);
  const list = await m.call('backup-list');
  assert.deepEqual(list.map(x => x.kind).sort(), ['daily', 'replace', 'replace', 'wipe']);
  assert.ok(list.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date)));
  assert.equal(JSON.parse(await m.call('backup-read', path.basename(first.path))).n, 'BEFORE-REPLACE-1', 'a safety copy can be restored');
  await assert.rejects(m.call('backup-snapshot', '{}', { kind: '../evil' }), /invalid_data/);
  // pruning counts daily backups and safety copies separately
  const dir = path.join(m.userData, 'backups');
  for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(dir, 'veyvo-2025-01-' + String(i).padStart(2, '0') + '.json'), '{}');
  await m.call('backup-snapshot', '{}');
  const names = m.backups();
  assert.equal(names.filter(n => !n.includes('-before-')).length, 14, '14 daily backups');
  assert.equal(names.filter(n => n.includes('-before-')).length, 3, 'every safety copy is still there');
  fs.rmSync(m.userData, { recursive: true, force: true });
});

test('main: strava-connect rejects (and stops listening) when the browser cannot be opened', async () => {
  const m = loadMain();
  m.shell.openExternal = async () => { throw new Error('ShellExecute failed'); };
  let timer;
  const result = await Promise.race([
    m.call('strava-connect', 'secret-123456').then(() => 'resolved', error => error),
    new Promise(resolve => { timer = setTimeout(() => resolve('pending'), 3000); })
  ]);
  clearTimeout(timer);
  assert.ok(result instanceof Error, 'the connect attempt settles: ' + result);
  assert.equal(result.code, 'failed');
  assert.match(result.message, /ShellExecute failed/);
  // a browser that opens still gives { pending: true }
  m.shell.openExternal = async () => {};
  assert.deepEqual(await m.call('strava-connect', 'secret-123456'), { pending: true });
  await m.call('strava-disconnect');
  fs.rmSync(m.userData, { recursive: true, force: true });
});
