const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const cloud=require('./cloud').createCloud();
const { createAiClient } = require('./ai');
const { createSettingsStore } = require('./ai-settings');
let aiStore;
let aiSettingsRevision = 0;
let aiSaving = false;
function getAiStore() { return aiStore ||= createSettingsStore({file:path.join(app.getPath('userData'),'openai.secure'),safeStorage}); }
const ai = createAiClient({getSettings:()=>getAiStore().read()});
function trustedAiSender(event) {
  const expected=pathToFileURL(path.join(__dirname,'..','src','index.html')).href;
  if(event.sender!==mainWindow?.webContents || event.senderFrame!==event.sender.mainFrame || event.senderFrame.url!==expected) throw Error('Neplatný zdroj AI požadavku.');
}
function aiHandler(channel,handler) {
  ipcMain.handle(channel,async(event,payload)=>{trustedAiSender(event);return handler(payload);});
}
aiHandler('ai-status',async()=>{if(cloud.enabled()){try{return cloudAiStatus(await cloud.request());}catch{return pendingCloudStatus();}}const local=getAiStore().status();return local.configured?local:pendingCloudStatus();});
function pendingCloudStatus(){return {configured:false,automatic:false,model:'nvidia/nemotron-3.5-lightning-30b-a3b',cloud:true,needsLogin:true};}
aiHandler('ai-save',async input=>{
  if(cloud.enabled()){let data=await cloud.request();if(input.apiKey?.trim())data=await cloud.request({action:'connect',revision:data.revision,key:input.apiKey,consent:input.consent});data=await cloud.request({action:'profile',revision:data.revision,profile:data.profile,timeZone:data.timeZone,automatic:input.automatic});return cloudAiStatus(data);}
  if(aiSaving)throw Error('Ověření připojení už probíhá.');
  aiSaving=true;
  const revision=aiSettingsRevision;
  try{
    const settings=getAiStore().candidate(input);
    const previous=getAiStore().read();
    if(!previous || previous.apiKey!==settings.apiKey || previous.model!==settings.model)await ai.test(settings);
    if(revision!==aiSettingsRevision)throw Error('Připojení bylo mezitím změněno.');
    const status=getAiStore().write(settings);aiSettingsRevision++;return status;
  }finally{aiSaving=false;}
});
aiHandler('ai-disconnect',async()=>{aiSettingsRevision++;if(cloud.enabled()){const d=await cloud.request();return cloudAiStatus(await cloud.request({action:'disconnect',revision:d.revision}));}return getAiStore().disconnect();});
aiHandler('ai-chat',async input=>{
  if(cloud.enabled()){const d=await cloud.request(),result=await cloud.request({action:'chat',revision:d.revision,message:input.messages?.at(-1)?.content});return {text:result.chat.at(-1).content,model:result.model};}
  const revision=aiSettingsRevision,result=await ai.chat(input);
  if(revision!==aiSettingsRevision)throw Error('AI připojení bylo během požadavku změněno.');
  return result;
});
aiHandler('ai-plan',async input=>{
  if(cloud.enabled()){const d=await cloud.request(),result=await cloud.request({action:input.automatic?'autoPlan':'plan',revision:d.revision});const plan=Object.values(result.plans).sort((a,b)=>b.week.localeCompare(a.week))[0];if(!plan)throw Error('Plán ještě není vytvořený.');const rows=require('./ai').rowsFromPlan(plan);return {...plan,source:'nvidia',targetWeek:input.targetWeek,rows,rules:{lockedDays:[],completedKm:result.runs.filter(r=>plan.dates.includes(r.date)).reduce((sum,r)=>sum+r.distance,0)}};}
  if(input?.automatic&&!getAiStore().read()?.automatic)throw Error('Automatické plánování je vypnuté.');
  const revision=aiSettingsRevision,result=await ai.plan(input);
  if(revision!==aiSettingsRevision)throw Error('AI připojení bylo během požadavku změněno.');
  return result;
});

const STRAVA_CLIENT_ID = '275720';
let mainWindow;
let updateCheckStarted = false;
let oauthServer;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function sendUpdateStatus(type, data = {}) { send('updater-status', { type, ...data }); }
function stravaFile() { return path.join(app.getPath('userData'), 'strava.secure'); }
function saveStrava(data) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows šifrování není dostupné.');
  fs.writeFileSync(stravaFile(), safeStorage.encryptString(JSON.stringify(data)));
}
function loadStrava() {
  try {
    const file = stravaFile();
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  } catch { return null; }
}
function publicStravaStatus() {
  const data = loadStrava();
  return { connected: Boolean(data?.refreshToken), athlete: data?.athlete ? { id: data.athlete.id, firstname: data.athlete.firstname, lastname: data.athlete.lastname } : null };
}
async function tokenRequest(parameters) {
  const response = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(parameters) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Strava odmítla přihlášení.');
  return result;
}
async function accessToken() {
  const data = loadStrava();
  if (!data?.refreshToken) throw new Error('Strava není připojená.');
  if (data.expiresAt > Math.floor(Date.now() / 1000) + 120) return data.accessToken;
  const refreshed = await tokenRequest({ client_id: STRAVA_CLIENT_ID, client_secret: data.clientSecret, grant_type: 'refresh_token', refresh_token: data.refreshToken });
  saveStrava({ ...data, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, expiresAt: refreshed.expires_at });
  return refreshed.access_token;
}
async function syncStrava() {
  const token = await accessToken();
  const after = Math.floor((Date.now() - 45 * 86400000) / 1000);
  const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Synchronizace Stravy selhala (${response.status}).`);
  const activities = await response.json();
  return activities.filter(item => ['Run', 'TrailRun', 'VirtualRun'].includes(item.sport_type || item.type)).map(item => ({
    id: String(item.id), name: item.name, sportType: item.sport_type || item.type, startDate: item.start_date, startDateLocal: item.start_date_local,
    distanceKm: Math.round(item.distance / 10) / 100, movingTime: item.moving_time, elapsedTime: item.elapsed_time,
    averageHeartrate: item.average_heartrate || null, totalElevationGain: item.total_elevation_gain || 0
  }));
}
function closeOauthServer() { if (oauthServer) { oauthServer.close(); oauthServer = null; } }
async function beginStravaOauth(clientSecret) {
  if (!/^\S{8,}$/.test(clientSecret || '')) throw new Error('Zadej platný Strava Client Secret.');
  closeOauthServer();
  const csrfState = crypto.randomBytes(24).toString('hex');
  return new Promise((resolve, reject) => {
    oauthServer = http.createServer(async (request, response) => {
      const callback = new URL(request.url, 'http://localhost');
      if (callback.pathname !== '/strava/callback') { response.writeHead(404).end(); return; }
      try {
        if (callback.searchParams.get('state') !== csrfState) throw new Error('Neplatný bezpečnostní stav přihlášení.');
        const code = callback.searchParams.get('code');
        if (!code) throw new Error(callback.searchParams.get('error') || 'Přihlášení bylo zrušeno.');
        const address = oauthServer.address();
        const redirectUri = `http://localhost:${address.port}/strava/callback`;
        const token = await tokenRequest({ client_id: STRAVA_CLIENT_ID, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
        saveStrava({ clientSecret, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: token.expires_at, athlete: token.athlete });
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><meta charset="utf-8"><title>VEYVO</title><body style="font-family:system-ui;background:#07110f;color:#dfffee;text-align:center;padding:80px"><h1>Strava je připojená ✓</h1><p>Můžeš zavřít toto okno a vrátit se do VEYVO.</p></body>');
        send('strava-event', { type: 'connected', status: publicStravaStatus() });
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(error.message);
        send('strava-event', { type: 'error', message: error.message });
      } finally { setTimeout(closeOauthServer, 500); }
    });
    oauthServer.once('error', reject);
    oauthServer.listen(0, 'localhost', async () => {
      const port = oauthServer.address().port;
      const redirectUri = `http://localhost:${port}/strava/callback`;
      const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=auto&scope=read,activity:read_all&state=${csrfState}`;
      await shell.openExternal(url); resolve({ pending: true });
    });
  });
}

function configureUpdater() {
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true; autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', info => sendUpdateStatus('available', { version: info.version }));
  autoUpdater.on('update-not-available', info => sendUpdateStatus('current', { version: info.version || app.getVersion() }));
  autoUpdater.on('download-progress', progress => sendUpdateStatus('progress', { percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total }));
  autoUpdater.on('update-downloaded', info => { sendUpdateStatus('ready', { version: info.version, restartIn: 5 }); setTimeout(() => autoUpdater.quitAndInstall(true, true), 5000); });
  autoUpdater.on('error', error => sendUpdateStatus('error', { message: error?.message || 'Update failed' }));
}
async function checkForUpdates() {
  if (!app.isPackaged) return sendUpdateStatus('development', { version: app.getVersion() });
  if (updateCheckStarted) return; updateCheckStarted = true;
  try { await autoUpdater.checkForUpdates(); } catch (error) { sendUpdateStatus('error', { message: error?.message || 'Update failed' }); } finally { updateCheckStarted = false; }
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1480, height: 940, minWidth: 1120, minHeight: 720, backgroundColor: '#071222', icon: path.join(__dirname, '..', 'assets', 'veyvo.ico'), titleBarStyle: 'hidden', titleBarOverlay: { color: '#071222', symbolColor: '#dfffee', height: 42 }, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.once('did-finish-load', () => setTimeout(checkForUpdates, 5000));
}
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('updater-check', () => checkForUpdates());
ipcMain.handle('updater-install', () => { if (app.isPackaged) autoUpdater.quitAndInstall(true, true); });
ipcMain.handle('strava-status', () => publicStravaStatus());
ipcMain.handle('strava-connect', (_, secret) => beginStravaOauth(secret));
ipcMain.handle('strava-sync', () => syncStrava());
ipcMain.handle('strava-disconnect', () => { closeOauthServer(); const file = stravaFile(); if (fs.existsSync(file)) fs.unlinkSync(file); return { connected: false }; });
app.whenReady().then(() => { configureUpdater(); createWindow(); });
app.on('window-all-closed', () => { closeOauthServer(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('open-mobile', () => shell.openExternal('https://veyvo-coach-pepa.j-kozisek.chatgpt.site'));

function cloudAiStatus(data){return {configured:data.configured,automatic:data.automatic,model:data.model,cloud:true};}
aiHandler('cloud-status',()=>cloud.status());
aiHandler('cloud-connect',()=>cloud.connect());
aiHandler('cloud-disconnect',()=>cloud.disconnect());
aiHandler('cloud-sync',async snapshot=>{if(!cloud.enabled())throw Error('Synchronizace není připojená.');const d=await cloud.request();if(snapshot.accountId&&snapshot.accountId!==d.accountId)throw Error('Je přihlášen jiný účet. Odpoj synchronizaci a připoj původní účet.');return cloud.request({action:'desktopSync',revision:d.revision,snapshot});});

aiHandler('cloud-clear-chat',async()=>{if(!cloud.enabled())throw Error('Cloud není připojený.');const d=await cloud.request();return cloud.request({action:'clearChat',revision:d.revision});});
