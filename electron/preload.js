// Sandboxed preload (webPreferences.sandbox: true): only contextBridge and ipcRenderer are used.
// Every call goes through ipcMain handlers in electron/main.js, which validate the sender frame
// and all arguments again. src/platform.js (VeyvoPlatform) wraps this bridge for the web core.
const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

/** Subscribes to a main -> renderer event; returns an unsubscribe function. */
function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('veyvo', {
  // Updater + Strava channels (names kept from 0.3)
  version: () => invoke('app-version'),
  checkForUpdates: () => invoke('updater-check'),
  installUpdate: () => invoke('updater-install'),
  onUpdaterStatus: callback => subscribe('updater-status', callback),
  stravaStatus: () => invoke('strava-status'),
  connectStrava: secret => invoke('strava-connect', secret),
  syncStrava: () => invoke('strava-sync'),
  disconnectStrava: () => invoke('strava-disconnect'),
  onStravaEvent: callback => subscribe('strava-event', callback),

  // 0.4 platform bridge
  saveFile: file => invoke('file-save', file),                 // { name, mime, data } -> { saved, path? }
  showItemInFolder: filePath => invoke('file-show', filePath), // -> { shown }
  openExternal: url => invoke('open-external', url),           // http/https only
  http: request => invoke('http-request', request),            // intervals.icu / api.github.com, https, 15 s
  secrets: {
    get: name => invoke('secret-get', name),
    set: (name, value) => invoke('secret-set', name, value),
    remove: name => invoke('secret-remove', name)
  },
  // daily backup, or with { kind: 'replace' | 'wipe' } a separate safety copy -> { path }
  backupSnapshot: (json, options) => (options === undefined ? invoke('backup-snapshot', json) : invoke('backup-snapshot', json, options)),
  listBackups: () => invoke('backup-list'),                    // -> [{ name, date, time, kind, size, modified }]
  readBackup: name => invoke('backup-read', name),             // 'veyvo-YYYY-MM-DD[-HHMMSS-before-<kind>].json' -> text
  garminFindDrives: () => invoke('garmin-find-drives'),        // -> [{ root, label }]
  garminCopy: payload => invoke('garmin-copy', payload),       // { root, name, data } -> { saved, path }
  setTitleBarTheme: theme => invoke('titlebar-theme', theme),  // { color, symbolColor }
  notify: message => invoke('notify', message)                 // { title, body } -> { shown }
});
