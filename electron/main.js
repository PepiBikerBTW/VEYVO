const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, session, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const crypto = require('crypto');
// Pure helpers shared with the renderer adapter: http host allowlist, file-name and backup-name rules.
const Platform = require('../src/platform.js');

const U = Platform.util;
const STRAVA_CLIENT_ID = '275720';
const APP_USER_MODEL_ID = 'com.veyvo.coach';
const INDEX_FILE = path.join(__dirname, '..', 'src', 'index.html');
const BACKUP_KEEP = U.BACKUP_KEEP;
const GARMIN_PROBE_TIMEOUT_MS = 1500;
const MAX_GARMIN_XML_BYTES = 256 * 1024;
const NUTRITION_SOURCES = new Set([
  'https://www.nswis.com.au/nswis-news/food-choices-for-the-run-in-to-competition/',
  'https://www.ausport.gov.au/ais/nutrition/supplements/group_a/sports-foods2/sports-drink/how-and-when-do-i-use-it',
  'https://health.clevelandclinic.org/what-to-eat-when-youre-training-for-a-marathon'
]);
const FILE_TYPE_LABELS = { fit: 'Garmin FIT', workout: 'Apple Workout', zwo: 'Zwift workout (ZWO)', json: 'JSON', txt: 'Text', csv: 'CSV', xml: 'XML', html: 'HTML', pdf: 'PDF', zip: 'ZIP' };
let mainWindow;
let updateCheckStarted = false;
let oauthServer;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function sendUpdateStatus(type, data = {}) { send('updater-status', { type, ...data }); }
function stravaFile() { return path.join(app.getPath('userData'), 'strava.secure'); }
function removeLegacyShareLink() { try { fs.rmSync(path.join(app.getPath('userData'),'shared-history-url.txt'),{force:true}); } catch {} }
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
  let response;
  try {
    response = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(parameters) });
  } catch (error) { throw fail('network', error?.message || 'Strava is not reachable'); }
  const result = await response.json().catch(() => ({}));
  // 400/401/403 from the token endpoint: the stored refresh token or client secret is no longer accepted.
  if (!response.ok) throw fail([400, 401, 403].includes(response.status) ? 'auth_required' : 'strava_http', `${result.message || 'Strava odmítla přihlášení.'} (${response.status})`);
  return result;
}
async function accessToken() {
  const data = loadStrava();
  if (!data?.refreshToken) throw fail('auth_required', 'Strava není připojená.');
  if (data.expiresAt > Math.floor(Date.now() / 1000) + 120) return data.accessToken;
  const refreshed = await tokenRequest({ client_id: STRAVA_CLIENT_ID, client_secret: data.clientSecret, grant_type: 'refresh_token', refresh_token: data.refreshToken });
  saveStrava({ ...data, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, expiresAt: refreshed.expires_at });
  return refreshed.access_token;
}
async function syncStrava() {
  const token = await accessToken();
  const after = Math.floor((Date.now() - 45 * 86400000) / 1000);
  let response;
  try {
    response = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) { throw fail('network', error?.message || 'Strava is not reachable'); }
  // Error codes survive IPC as '[code] message' (VeyvoPlatform turns them into error.code): the UI shows
  // "needs a new sign-in" for auth_required and keeps the HTTP status for anything else.
  if (response.status === 401 || response.status === 403) throw fail('auth_required', `Synchronizace Stravy selhala (${response.status}).`);
  if (!response.ok) throw fail('strava_http', `Synchronizace Stravy selhala (${response.status}).`);
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
        const done = localeIsCzech() ? ['Strava je připojená.', 'Můžeš zavřít toto okno a vrátit se do VEYVO.'] : ['Strava is connected.', 'You can close this window and return to VEYVO.'];
        response.end(`<!doctype html><meta charset="utf-8"><title>VEYVO</title><body style="font-family:system-ui;background:#0D0E11;color:#F3F4F6;text-align:center;padding:80px"><h1>${done[0]}</h1><p>${done[1]}</p></body>`);
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
      // A browser that cannot be opened must end the connect attempt, not leave it pending forever.
      try { await shell.openExternal(url); resolve({ pending: true }); } catch (error) { closeOauthServer(); reject(fail('failed', error?.message || 'The browser could not be opened.')); }
    });
  });
}

function configureUpdater() {
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true; autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', info => sendUpdateStatus('available', { version: info.version }));
  autoUpdater.on('update-not-available', info => sendUpdateStatus('current', { version: info.version || app.getVersion() }));
  autoUpdater.on('download-progress', progress => sendUpdateStatus('progress', { percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total }));
  autoUpdater.on('update-downloaded', info => sendUpdateStatus('ready', { version: info.version }));
  autoUpdater.on('error', error => sendUpdateStatus('error', { message: error?.message || 'Update failed' }));
}
async function checkForUpdates() {
  if (!app.isPackaged) return sendUpdateStatus('development', { version: app.getVersion() });
  if (updateCheckStarted) return; updateCheckStarted = true;
  try { await autoUpdater.checkForUpdates(); } catch (error) { sendUpdateStatus('error', { message: error?.message || 'Update failed' }); } finally { updateCheckStarted = false; }
}

// ---------------------------------------------------------------- helpers for the 0.4 bridge

/** Errors keep their code through IPC as '[code] message'; VeyvoPlatform turns that back into error.code. */
function fail(code, message) {
  const error = new Error(`[${code}] ${message || code}`);
  error.code = code;
  return error;
}
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]).finally(() => clearTimeout(timer));
}
function toBuffer(data) {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  try { const bytes = U.toBytes(data); return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  catch { throw fail('invalid_data', 'data must be a string or Uint8Array'); }
}
/** One queue per resource so read-modify-write sequences (secrets.json, backup pruning) never interleave. */
function serial() {
  let tail = Promise.resolve();
  return task => { const run = tail.then(task, task); tail = run.catch(() => {}); return run; };
}
const secretsQueue = serial();
const backupQueue = serial();

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return await fsp.rename(from, to); }
    catch (error) {
      // Windows: antivirus or the indexer can hold the target for a moment.
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await delay(40 * (attempt + 1));
    }
  }
}
/** Write to '<file>.<random>.tmp', flush, then rename over the target (atomic on NTFS and ext4). */
async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await fsp.open(tmp, 'w', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close(); handle = null;
    await renameWithRetry(tmp, file);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}
function localeIsCzech() { try { return /^cs\b/i.test(app.getLocale()); } catch { return false; } }

// ---------------------------------------------------------------- files

function defaultSaveFolder() {
  for (const name of ['downloads', 'documents', 'home']) { try { return app.getPath(name); } catch {} }
  return app.getPath('userData');
}
async function saveFile(file) {
  let prepared;
  try { prepared = U.prepareFile(isPlainObject(file) ? { name: file.name, mime: file.mime, data: file.data } : file); }
  catch (error) { throw fail(error.code || 'invalid_data', error.message); }
  const bytes = toBuffer(prepared.data);
  const ext = U.fileExtension(prepared.name);
  const all = { name: localeIsCzech() ? 'Všechny soubory' : 'All files', extensions: ['*'] };
  const filters = ext ? [{ name: FILE_TYPE_LABELS[ext] || ext.toUpperCase(), extensions: [ext] }, all] : [all];
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const options = { defaultPath: path.join(defaultSaveFolder(), prepared.name), filters, properties: ['createDirectory', 'showOverwriteConfirmation'] };
  const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { saved: false };
  try { await fsp.writeFile(result.filePath, bytes); }
  catch (error) { throw fail('write_failed', error.message); }
  rememberWritten(result.filePath);
  return { saved: true, path: result.filePath };
}
// Paths VEYVO itself wrote in this session (saveFile, garminCopy). showItemInFolder reveals only
// those and the app's own backups, so the page cannot probe or open arbitrary locations on disk.
const writtenPaths = new Set();
function pathKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function rememberWritten(filePath) {
  writtenPaths.add(pathKey(filePath));
  if (writtenPaths.size > 500) writtenPaths.delete(writtenPaths.values().next().value);
}
function isRevealable(target) {
  if (writtenPaths.has(pathKey(target))) return true;
  return pathKey(path.dirname(target)) === pathKey(backupDir()) && U.isBackupFileName(path.basename(target));
}
function showItemInFolder(filePath) {
  if (typeof filePath !== 'string' || filePath.length > 4096 || !path.isAbsolute(filePath)) return { shown: false };
  const target = path.resolve(filePath);
  if (!isRevealable(target) || !fs.existsSync(target)) return { shown: false };
  shell.showItemInFolder(target);
  return { shown: true };
}
async function openExternal(url) {
  if (!U.isExternalUrl(url)) throw fail('invalid_url', 'only http and https links can be opened');
  await shell.openExternal(new URL(url).href);
  return { opened: true };
}

// ---------------------------------------------------------------- http (allowlisted hosts only)

async function readLimitedText(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw fail('too_large', 'response too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); throw fail('too_large', 'response too large'); }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks).toString('utf8');
}
function isTimeout(error) { return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.cause?.name === 'TimeoutError'; }
async function httpRequest(request) {
  let r;
  try { r = U.normalizeHttpRequest(request); }
  catch (error) { throw fail(error.code || 'invalid_request', error.message); }
  const headers = { ...r.headers };
  if (!Object.keys(headers).some(name => name.toLowerCase() === 'user-agent')) headers['User-Agent'] = `VEYVO/${app.getVersion()}`;
  const signal = AbortSignal.timeout(U.HTTP_TIMEOUT_MS);
  try {
    // redirect: 'manual' so a redirect can never leave the allowlisted host.
    const response = await fetch(r.url, { method: r.method, headers, body: r.body, redirect: 'manual', signal });
    const text = r.method === 'HEAD' ? '' : await readLimitedText(response, U.MAX_HTTP_RESPONSE_BYTES);
    return { status: response.status, ok: response.ok, text, headers: Object.fromEntries(response.headers) };
  } catch (error) {
    if (error?.code === 'too_large') throw error;
    if (isTimeout(error) || signal.aborted) throw fail('timeout', `no answer within ${U.HTTP_TIMEOUT_MS / 1000} s`);
    throw fail('network', error?.cause?.code || error?.message || 'request failed');
  }
}

// ---------------------------------------------------------------- secrets (safeStorage, userData/secrets.json)

function secretsFile() { return path.join(app.getPath('userData'), 'secrets.json'); }
async function readSecrets() {
  try {
    const doc = JSON.parse(await fsp.readFile(secretsFile(), 'utf8'));
    const values = Object.create(null);
    if (isPlainObject(doc?.values)) for (const [name, value] of Object.entries(doc.values)) if (U.isSecretName(name) && typeof value === 'string') values[name] = value;
    return values;
  } catch { return Object.create(null); }
}
async function writeSecrets(values) {
  const doc = { version: 1, encrypted: 'electron-safeStorage', values: Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) };
  await writeAtomic(secretsFile(), JSON.stringify(doc, null, 2));
}
function checkSecretName(name) { if (!U.isSecretName(name)) throw fail('invalid_name', 'secret names must match [a-z0-9-]{1,40}'); }
function secretGet(name) {
  checkSecretName(name);
  return secretsQueue(async () => {
    const values = await readSecrets();
    if (!(name in values) || !safeStorage.isEncryptionAvailable()) return null;
    try { return safeStorage.decryptString(Buffer.from(values[name], 'base64')); } catch { return null; }
  });
}
function secretSet(name, value) {
  checkSecretName(name);
  if (typeof value !== 'string') throw fail('invalid_data', 'secret values must be strings');
  if (value.length > U.MAX_SECRET_CHARS) throw fail('too_large', 'secret too long');
  if (!safeStorage.isEncryptionAvailable()) throw fail('encryption_unavailable', 'safeStorage is not available');
  return secretsQueue(async () => {
    const values = await readSecrets();
    values[name] = safeStorage.encryptString(value).toString('base64');
    await writeSecrets(values);
    return true;
  });
}
function secretRemove(name) {
  checkSecretName(name);
  return secretsQueue(async () => {
    const values = await readSecrets();
    if (!(name in values)) return true;
    delete values[name];
    await writeSecrets(values);
    return true;
  });
}

// ---------------------------------------------------------------- backups (userData/backups, newest 14 daily + 10 safety copies)

function backupDir() { return path.join(app.getPath('userData'), 'backups'); }
/**
 * backupSnapshot(json, { kind? }): the daily backup 'veyvo-YYYY-MM-DD.json', or with kind 'replace' |
 * 'wipe' a safety copy 'veyvo-YYYY-MM-DD-HHMMSS-before-<kind>.json' that is never overwritten.
 */
function backupSnapshot(json, options) {
  if (typeof json !== 'string' || !json.trim()) throw fail('invalid_data', 'backup must be a JSON string');
  if (json.length > U.MAX_BACKUP_CHARS) throw fail('too_large', 'backup too large');
  try { JSON.parse(json); } catch { throw fail('invalid_data', 'backup is not valid JSON'); }
  if (options !== undefined && options !== null && !isPlainObject(options)) throw fail('invalid_data', 'backup options must be an object');
  let kind;
  try { kind = U.snapshotKind(options); } catch (error) { throw fail('invalid_data', error.message); }
  return backupQueue(async () => {
    const dir = backupDir();
    await fsp.mkdir(dir, { recursive: true });
    const existing = kind ? await fsp.readdir(dir).catch(() => []) : [];
    const name = kind ? U.safetyBackupName(kind, new Date(), existing) : U.backupFileName(U.dateKeyOf(new Date()));
    const target = path.join(dir, name);
    try { await writeAtomic(target, json); } catch (error) { throw fail('write_failed', error.message); }
    const names = await fsp.readdir(dir).catch(() => []);
    for (const old of U.backupsToPrune(names, BACKUP_KEEP)) await fsp.rm(path.join(dir, old), { force: true }).catch(() => {});
    return { path: target };
  });
}
async function listBackups() {
  const dir = backupDir();
  const names = U.sortBackupNames(await fsp.readdir(dir).catch(() => []));
  const list = [];
  for (const name of names) {
    const stat = await fsp.stat(path.join(dir, name)).catch(() => null);
    const info = U.backupInfo(name);
    if (stat?.isFile()) list.push({ name, date: info.date, time: info.time, kind: info.kind, size: stat.size, modified: stat.mtime.toISOString() });
  }
  return list;
}
async function readBackup(name) {
  if (!U.isBackupFileName(name)) throw fail('invalid_name', 'not a backup file name');
  const file = path.join(backupDir(), name);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile()) throw fail('not_found', name);
  if (stat.size > U.MAX_BACKUP_CHARS * 4) throw fail('too_large', 'backup too large');
  return fsp.readFile(file, 'utf8');
}

// ---------------------------------------------------------------- Garmin USB drive (Windows)

function decodeXml(text) {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
}
async function garminLabel(root, letter) {
  const fallback = `Garmin (${letter}:)`;
  try {
    const file = path.win32.join(root, 'GARMIN', 'GarminDevice.xml');
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size > MAX_GARMIN_XML_BYTES) return fallback;
    const xml = await fsp.readFile(file, 'utf8');
    const match = /<Model>[\s\S]*?<Description>([^<]{1,80})<\/Description>/.exec(xml);
    const model = match ? decodeXml(match[1]).replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    return model ? `${model} (${letter}:)` : fallback;
  } catch { return fallback; }
}
async function probeGarminDrive(letter) {
  const root = `${letter}:\\`;
  // Async stat with a timeout: a disconnected network drive must not freeze the app.
  const found = await withTimeout(fsp.stat(path.win32.join(root, 'GARMIN', 'NewFiles')).then(stat => stat.isDirectory(), () => false), GARMIN_PROBE_TIMEOUT_MS, false);
  if (!found) return null;
  return { root, label: await withTimeout(garminLabel(root, letter), GARMIN_PROBE_TIMEOUT_MS, `Garmin (${letter}:)`) };
}
async function garminFindDrives() {
  if (process.platform !== 'win32') return [];
  const letters = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return (await Promise.all(letters.map(probeGarminDrive))).filter(Boolean);
}
async function garminCopy(payload) {
  if (!isPlainObject(payload) || typeof payload.root !== 'string') throw fail('drive_not_found', 'choose a Garmin drive');
  const drives = await garminFindDrives();
  const drive = drives.find(item => item.root.toUpperCase() === payload.root.toUpperCase());
  if (!drive) throw fail('drive_not_found', 'the Garmin drive is not connected');
  let fit;
  try { fit = U.prepareFitFile(payload.name, payload.data); }
  catch (error) { throw fail(error.code || 'not_fit', error.message); }
  const target = path.win32.join(drive.root, 'GARMIN', 'NewFiles', fit.name);
  try { await writeAtomic(target, Buffer.from(fit.data.buffer, fit.data.byteOffset, fit.data.byteLength)); }
  catch (error) { throw fail('write_failed', error.message); }
  rememberWritten(target);
  return { saved: true, path: target };
}

// ---------------------------------------------------------------- window chrome and notifications

function setTitleBarTheme(theme) {
  if (!isPlainObject(theme) || !U.isHexColor(theme.color) || !U.isHexColor(theme.symbolColor)) throw fail('invalid_data', 'colors must be #rgb or #rrggbb');
  // Only Windows draws the window-controls overlay here (it crashes headless Linux, macOS has traffic lights).
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed() || typeof mainWindow.setTitleBarOverlay !== 'function') return { applied: false };
  try { mainWindow.setTitleBarOverlay({ color: theme.color, symbolColor: theme.symbolColor, height: 42 }); return { applied: true }; }
  catch { return { applied: false }; }
}
function notify(message) {
  if (!isPlainObject(message) || typeof message.title !== 'string' || !message.title.trim()) throw fail('invalid_data', 'notification needs a title');
  if (!Notification.isSupported()) return { shown: false };
  const notification = new Notification({
    title: Array.from(message.title.trim()).slice(0, 120).join(''),
    body: typeof message.body === 'string' ? Array.from(message.body.trim()).slice(0, 500).join('') : '',
    icon: path.join(__dirname, '..', 'assets', 'veyvo-icon.png'),
    silent: false
  });
  notification.on('click', focusMainWindow);
  notification.show();
  return { shown: true };
}
function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------------------------------------------------------------- IPC with sender validation

/** Only the app's own top-level page (file://…/src/index.html) may call the bridge. */
function isTrustedSender(event) {
  const frame = event?.senderFrame;
  if (!frame || frame.parent) return false;
  try {
    const url = new URL(frame.url);
    return url.protocol === 'file:' && url.pathname.endsWith('/src/index.html');
  } catch { return false; }
}
function handle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw fail('blocked', `IPC '${channel}' refused for ${event?.senderFrame?.url || 'an unknown frame'}`);
    return listener(...args);
  });
}
function registerIpc() {
  // Updater + Strava channels keep their 0.3 names and payloads (electron/preload.js, tests/ui-harness.cjs).
  handle('app-version', () => app.getVersion());
  handle('updater-check', () => checkForUpdates());
  handle('updater-install', () => { if (app.isPackaged) autoUpdater.quitAndInstall(true, true); });
  handle('strava-status', () => publicStravaStatus());
  handle('strava-connect', secret => beginStravaOauth(secret));
  handle('strava-sync', () => syncStrava());
  handle('strava-disconnect', () => { closeOauthServer(); const file = stravaFile(); if (fs.existsSync(file)) fs.unlinkSync(file); return { connected: false }; });
  // 0.4 platform bridge (VeyvoPlatform desktop adapter).
  handle('file-save', file => saveFile(file));
  handle('file-show', filePath => showItemInFolder(filePath));
  handle('open-external', url => openExternal(url));
  handle('http-request', request => httpRequest(request));
  handle('secret-get', name => secretGet(name));
  handle('secret-set', (name, value) => secretSet(name, value));
  handle('secret-remove', name => secretRemove(name));
  handle('backup-snapshot', (json, options) => backupSnapshot(json, options));
  handle('backup-list', () => listBackups());
  handle('backup-read', name => readBackup(name));
  handle('garmin-find-drives', () => garminFindDrives());
  handle('garmin-copy', payload => garminCopy(payload));
  handle('titlebar-theme', theme => setTitleBarTheme(theme));
  handle('notify', message => notify(message));
}

// ---------------------------------------------------------------- window and hardening

function sameDocument(target, current) {
  try {
    const a = new URL(target), b = new URL(current);
    return a.protocol === 'file:' && b.protocol === 'file:' && a.pathname === b.pathname;
  } catch { return false; }
}
function hardenContents(contents) {
  contents.on('will-attach-webview', event => event.preventDefault());
  const guard = (event, url) => {
    const target = event?.url || url;
    if (!sameDocument(target, contents.getURL())) event.preventDefault();
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
function hardenSession() {
  const ses = session.defaultSession;
  // Nothing in VEYVO needs camera, location, notifications from the page etc. Writing to the
  // clipboard (copy a workout as text) is the only exception.
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1120, minHeight: 720, backgroundColor: '#0D0E11',
    icon: path.join(__dirname, '..', 'assets', 'veyvo.ico'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0D0E11', symbolColor: '#F3F4F6', height: 42 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false, spellcheck: false
    }
  });
  mainWindow.loadFile(INDEX_FILE);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (NUTRITION_SOURCES.has(url)) shell.openExternal(url).catch(error => console.error('Cannot open nutrition source:', error.message));
    return { action: 'deny' };
  });
  mainWindow.webContents.once('did-finish-load', () => setTimeout(checkForUpdates, 5000));
  mainWindow.on('closed', () => { mainWindow = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
  app.on('second-instance', focusMainWindow);
  app.on('web-contents-created', (_event, contents) => hardenContents(contents));
  registerIpc();
  app.whenReady().then(() => { hardenSession(); removeLegacyShareLink(); configureUpdater(); createWindow(); });
  app.on('window-all-closed', () => { closeOauthServer(); if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
