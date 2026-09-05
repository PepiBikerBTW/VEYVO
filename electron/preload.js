const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('veyvo', {
  version: () => ipcRenderer.invoke('app-version'),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  checkForUpdates: () => ipcRenderer.invoke('updater-check'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  onUpdaterStatus: callback => ipcRenderer.on('updater-status', (_, status) => callback(status))
});
