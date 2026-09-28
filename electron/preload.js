const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('veyvo', {
  version: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: () => ipcRenderer.invoke('updater-check'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  onUpdaterStatus: callback => ipcRenderer.on('updater-status', (_, status) => callback(status)),
  stravaStatus: () => ipcRenderer.invoke('strava-status'),
  connectStrava: secret => ipcRenderer.invoke('strava-connect', secret),
  syncStrava: () => ipcRenderer.invoke('strava-sync'),
  disconnectStrava: () => ipcRenderer.invoke('strava-disconnect'),
  fetchSharedHistory: url => ipcRenderer.invoke('shared-history-fetch', url),
  savedSharedHistoryUrl: () => ipcRenderer.invoke('shared-history-url'),
  saveSharedHistoryUrl: url => ipcRenderer.invoke('shared-history-save-url', url),
  clearSharedHistoryUrl: () => ipcRenderer.invoke('shared-history-clear-url'),
  onStravaEvent: callback => ipcRenderer.on('strava-event', (_, event) => callback(event))
});
