// Preload for tests/visual/screenshots.cjs (dev only, never shipped).
// - seeds localStorage from --veyvo-seed=<file.json> BEFORE any page script runs ({ key: value });
// - --veyvo-motion=off sets <html data-motion="off"> (CSS + VeyvoUI.motion jump to end states);
// - --veyvo-platform=desktop exposes a fake window.veyvo bridge so VeyvoPlatform detects 'desktop'
//   (Strava slot, backups, title-bar theme); --veyvo-strava=off|connected|error shapes its answers.
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
