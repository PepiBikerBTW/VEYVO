// Preload for tests/visual/screenshots.cjs (dev only, never shipped).
// - seeds localStorage from --veyvo-seed=<file.json> BEFORE any page script runs ({ key: value });
// - --veyvo-motion=off sets <html data-motion="off"> (CSS + VeyvoUI.motion jump to end states);
// - --veyvo-platform=desktop exposes a fake window.veyvo bridge so VeyvoPlatform detects 'desktop'
//   (Strava slot, backups, title-bar theme); --veyvo-strava=off|connected|error shapes its answers.
// - --veyvo-platform=android exposes a fake window.Capacitor (Android shell with the plugins the app
//   uses) so VeyvoPlatform detects 'android'; combine it with screenshots.cjs --index to shoot the
//   Play build that mobile/scripts/sync-web.mjs --channel play writes.
// - --veyvo-platform=ios exposes the same shell as getPlatform() 'ios' plus the app's own Swift plugins
//   VeyvoWorkoutKit (Apple Watch) and VeyvoHealth (Apple Health) as recording fakes; the page reads
//   and steers them through window.VeyvoIosStub ({ calls(), set(name, value) }). tests/ui-ios.cjs and
//   screenshots.cjs --index <appstore copy>/src/index.html --platform ios use it.
const { contextBridge } = require('electron');
const fs = require('node:fs');

const arg = name => {
  const prefix = '--veyvo-' + name + '=';
  const found = process.argv.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
};

const seedFile = arg('seed');
if (seedFile) {
  try {
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    window.localStorage.clear();
    for (const [key, value] of Object.entries(seed)) window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch (error) {
    console.error('[stub-preload] seed failed', error);
  }
}

if (arg('motion') === 'off') {
  const set = () => { if (document.documentElement) document.documentElement.setAttribute('data-motion', 'off'); };
  set();
  document.addEventListener('readystatechange', set);
  document.addEventListener('DOMContentLoaded', set);
}

if (arg('platform') === 'desktop') {
  const strava = arg('strava') || 'off';
  const connected = strava === 'connected' || strava === 'error';
  contextBridge.exposeInMainWorld('veyvo', {
    version: async () => '0.4.0-dev',
    checkForUpdates: async () => ({}),
    installUpdate: async () => {},
    onUpdaterStatus: () => () => {},
    stravaStatus: async () => ({ connected, athlete: connected ? { id: 1, firstname: 'Demo', lastname: '' } : null }),
    connectStrava: async () => ({ pending: true }),
    syncStrava: async () => {
      if (strava === 'error') throw new Error('[network] Synchronizace Stravy selhala (401).');
      return [];
    },
    disconnectStrava: async () => ({ connected: false }),
    onStravaEvent: () => () => {},
    saveFile: async file => ({ saved: true, path: '/tmp/' + file.name }),
    showItemInFolder: async () => ({ shown: false }),
    openExternal: async () => {},
    http: async () => { throw new Error('[unsupported] offline screenshot stub'); },
    secrets: { get: async () => null, set: async () => {}, remove: async () => {} },
    backupSnapshot: async () => ({ path: '/tmp/veyvo-backup.json' }),
    listBackups: async () => [],
    readBackup: async () => '',
    garminFindDrives: async () => [],
    garminCopy: async () => ({ saved: false }),
    setTitleBarTheme: async () => ({}),
    notify: async () => ({ shown: false })
  });
}

if (arg('platform') === 'android') {
  const prefs = new Map();
  contextBridge.exposeInMainWorld('Capacitor', {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      App: { getInfo: async () => ({ version: '0.4.0', build: '40000' }), addListener: async () => ({ remove: async () => {} }), exitApp: async () => {} },
      Filesystem: {
        writeFile: async o => ({ uri: 'file:///data/' + o.directory + '/' + o.path }),
        rename: async () => {}, deleteFile: async () => {}, readdir: async () => ({ files: [] }),
        readFile: async () => { throw new Error('File does not exist'); }
      },
      Share: { share: async () => ({}) },
      Preferences: {
        get: async ({ key }) => ({ value: prefs.has(key) ? prefs.get(key) : null }),
        set: async ({ key, value }) => { prefs.set(key, value); },
        remove: async ({ key }) => { prefs.delete(key); }
      },
      Browser: { open: async () => {} },
      CapacitorHttp: { request: async () => { throw new Error('offline screenshot stub'); } },
      SystemBars: { setStyle: async () => {} }
    }
  });
}

if (arg('platform') === 'ios') {
  const prefs = new Map();
  const log = [];
  const knobs = {
    wkSupported: true, wkSchedule: true, wkError: null,
    hkAvailable: true, hkError: null,
    hkRows: [
      { healthId: '6F1C2D3E-4A5B-4C6D-8E7F-90A1B2C3D4E5', startDate: '2026-11-24T17:12:00Z', date: '2026-11-24', startTime: '18:12',
        distanceKm: 5.01, movingSeconds: 1270, averageHeartrate: 171.4, maxHeartrate: 186, sourceName: 'Cvičení' },
      { healthId: '11111111-2222-4333-8444-555555555555', startDate: '2026-11-26T06:05:00Z', date: '2026-11-26', startTime: '07:05',
        distanceKm: 8.02, movingSeconds: 2900, averageHeartrate: 148, maxHeartrate: 163, sourceName: 'Garmin Connect' },
      { healthId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE', startDate: '2026-11-25T06:00:00Z', date: '2026-11-25', startTime: '07:00',
        movingSeconds: 1800, sourceName: 'Cvičení' }
    ]
  };
  const record = (name, options) => { log.push({ name, options: options === undefined ? null : JSON.parse(JSON.stringify(options)) }); };
  // a plain object: contextBridge copies its code (Capacitor rejects with { message, code } too)
  const fail = code => Promise.reject({ message: 'stub ' + code, code });
  const later = (value, ms) => new Promise(resolve => setTimeout(() => resolve(value), ms || 30));
  contextBridge.exposeInMainWorld('VeyvoIosStub', {
    calls: () => JSON.parse(JSON.stringify(log)),
    set: (name, value) => { knobs[name] = value; }
  });
  contextBridge.exposeInMainWorld('Capacitor', {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    Plugins: {
      App: { getInfo: async () => ({ version: '0.4.0', build: '400' }), addListener: async () => ({ remove: async () => {} }) },
      Filesystem: {
        writeFile: async o => ({ uri: 'file:///var/mobile/' + o.directory + '/' + o.path }),
        rename: async () => {}, deleteFile: async () => {}, readdir: async () => ({ files: [] }),
        readFile: async () => { throw new Error('File does not exist'); }
      },
      Share: { share: async o => { record('Share.share', { files: o.files }); return {}; } },
      Preferences: {
        get: async ({ key }) => ({ value: prefs.has(key) ? prefs.get(key) : null }),
        set: async ({ key, value }) => { prefs.set(key, value); },
        remove: async ({ key }) => { prefs.delete(key); }
      },
      Browser: { open: async o => { record('Browser.open', o); } },
      CapacitorHttp: { request: async () => { throw new Error('offline stub'); } },
      SystemBars: { setStyle: async () => {} },
      VeyvoWorkoutKit: {
        isSupported: async () => { record('VeyvoWorkoutKit.isSupported'); return knobs.wkSupported ? { supported: true, preview: true, schedule: !!knobs.wkSchedule, maxScheduled: 15 } : { supported: false, preview: false, schedule: false, reason: 'ios_version' }; },
        preview: async o => { record('VeyvoWorkoutKit.preview', o); return knobs.wkError ? fail(knobs.wkError) : later({ shown: true }, 60); },
        schedule: async o => { record('VeyvoWorkoutKit.schedule', o); return knobs.wkError ? fail(knobs.wkError) : later({ scheduled: true, id: o.planId, date: o.date, replaced: 0 }); },
        listScheduled: async () => ({ workouts: [] }),
        clearScheduled: async () => ({ removed: 0 })
      },
      VeyvoHealth: {
        isAvailable: async () => { record('VeyvoHealth.isAvailable'); return { available: !!knobs.hkAvailable }; },
        requestAuthorization: async () => { record('VeyvoHealth.requestAuthorization'); return { requested: true }; },
        importRuns: async o => { record('VeyvoHealth.importRuns', o); return knobs.hkError ? fail(knobs.hkError) : later({ runs: knobs.hkRows }); }
      }
    }
  });
}
