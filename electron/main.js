const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow;
let updateCheckStarted = false;

function sendUpdateStatus(type, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater-status', { type, ...data });
}

function configureUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', info => sendUpdateStatus('available', { version: info.version }));
  autoUpdater.on('update-not-available', info => sendUpdateStatus('current', { version: info.version || app.getVersion() }));
  autoUpdater.on('download-progress', progress => sendUpdateStatus('progress', { percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total }));
  autoUpdater.on('update-downloaded', info => {
    sendUpdateStatus('ready', { version: info.version, restartIn: 5 });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 5000);
  });
  autoUpdater.on('error', error => sendUpdateStatus('error', { message: error?.message || 'Update failed' }));
}

async function checkForUpdates() {
  if (!app.isPackaged) return sendUpdateStatus('development', { version: app.getVersion() });
  if (updateCheckStarted) return;
  updateCheckStarted = true;
  try { await autoUpdater.checkForUpdates(); }
  catch (error) { sendUpdateStatus('error', { message: error?.message || 'Update failed' }); }
  finally { updateCheckStarted = false; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#07110f',
    icon: path.join(__dirname, '..', 'assets', 'veyvo.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07110f', symbolColor: '#dfffee', height: 42 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://www.strava.com/')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.once('did-finish-load', () => setTimeout(checkForUpdates, 5000));
}

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('updater-check', () => checkForUpdates());
ipcMain.handle('updater-install', () => { if (app.isPackaged) autoUpdater.quitAndInstall(true, true); });
ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && url.startsWith('https://www.strava.com/oauth/authorize')) shell.openExternal(url);
});

app.whenReady().then(() => { configureUpdater(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
