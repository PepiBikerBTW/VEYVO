const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('veyvo', {
  version: () => ipcRenderer.invoke('app-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  checkGithubRelease: (owner, repo) => ipcRenderer.invoke('check-github-release', owner, repo),
  openGithubRelease: (url) => ipcRenderer.invoke('open-github-release', url)
});


