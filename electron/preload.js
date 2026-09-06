const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('veyvo', {
  openMobile: () => ipcRenderer.invoke('open-mobile'),
  aiStatus: () => ipcRenderer.invoke('ai-status'),
  saveAi: settings => ipcRenderer.invoke('ai-save',settings),
  disconnectAi: () => ipcRenderer.invoke('ai-disconnect'),
  chat: request => ipcRenderer.invoke('ai-chat',request),
  generatePlan: request => ipcRenderer.invoke('ai-plan',request),
  version: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: () => ipcRenderer.invoke('updater-check'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  onUpdaterStatus: callback => ipcRenderer.on('updater-status', (_, status) => callback(status)),
  stravaStatus: () => ipcRenderer.invoke('strava-status'),
  connectStrava: secret => ipcRenderer.invoke('strava-connect', secret),
  syncStrava: () => ipcRenderer.invoke('strava-sync'),
  disconnectStrava: () => ipcRenderer.invoke('strava-disconnect'),
  onStravaEvent: callback => ipcRenderer.on('strava-event', (_, event) => callback(event))
});