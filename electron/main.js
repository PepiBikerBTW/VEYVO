const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#07110f',
    icon: path.join(__dirname, '..', 'assets', 'veyvo.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07110f', symbolColor: '#dfffee', height: 42 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('check-github-release', async (_, owner, repo) => {
  const safe = /^[A-Za-z0-9_.-]+$/;
  if (!safe.test(owner || '') || !safe.test(repo || '')) return { error: 'Neplatný název repozitáře.' };
  try {
    const response = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers: { 'User-Agent': 'VEYVO-Updater', 'Accept': 'application/vnd.github+json' } });
    if (response.status === 404) return { error: 'Repozitář nebo veřejné vydání nebylo nalezeno.' };
    if (!response.ok) return { error: `GitHub odpověděl stavem ${response.status}.` };
    const release = await response.json();
    return { currentVersion: app.getVersion(), latestVersion: String(release.tag_name || '').replace(/^v/i, ''), name: release.name || release.tag_name, url: release.html_url, publishedAt: release.published_at };
  } catch { return { error: 'Ke GitHubu se nepodařilo připojit.' }; }
});
ipcMain.handle('open-github-release', (_, url) => {
  if (typeof url === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\//.test(url)) shell.openExternal(url);
});
ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && url.startsWith('https://www.strava.com/oauth/authorize')) shell.openExternal(url);
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });



