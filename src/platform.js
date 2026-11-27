/*
 * VeyvoPlatform - one API over the three places the web core runs:
 *
 *   desktop  Electron: window.veyvo from electron/preload.js (detected by window.veyvo.saveFile)
 *   android  Capacitor: window.Capacitor.Plugins (Filesystem, Share, Preferences, Browser, App,
 *            CapacitorHttp), detected by Capacitor.isNativePlatform() && getPlatform() === 'android'
 *   ios      the same Capacitor plugins plus the app's own Swift plugins VeyvoWorkoutKit (Apple Watch)
 *            and VeyvoHealth (Apple Health, read only), detected by getPlatform() === 'ios'
 *   web      anything else (tests, screenshots, a plain browser): safe fallbacks
 *
 * Classic UMD script, no DOM access at load time. In Node, require('./platform.js') returns the
 * adapter built for globalThis.window (web when there is none); create(win) builds another one.
 * electron/main.js requires this file only for the pure helpers in VeyvoPlatform.util, so the
 * http host allowlist, file-name rules and backup names are defined once for both sides.
 *
 * Shape of every adapter (unsupported parts resolve to harmless values or reject with
 * error.code === 'unsupported'; never call a missing plugin):
 *   kind: 'desktop' | 'android' | 'ios' | 'web'
 *   build: { channel: 'github' | 'play' | 'appstore', store }   from window.VEYVO_BUILD (src/build-info.js)
 *   supports: { saveFile, share, showInFolder, http, secrets, encryptedSecrets, backup, updates,
 *               strava, garmin, notify, titleBar, watch, health }
 *   version(): Promise<string>
 *   saveFile({ name, mime, data: Uint8Array | string }): Promise<{ saved, path?, shared?, canceled? }>
 *   showInFolder(path): Promise<boolean>
 *   openExternal(url): Promise<void>                  http/https only
 *   http({ url, method, headers, body }): Promise<{ status, ok, text, json, headers }>
 *                                                     https://intervals.icu, plus GitHub's API in the
 *                                                     'github' channel only (httpHostsFor)
 *   secrets: { supported, encrypted, get(name), set(name, value), remove(name) }
 *                                                     names [a-z0-9-]{1,40}
 *   backup: { supported, snapshot(json): Promise<{ path }>, list(), read(name) }
 *   updates: { supported, check(), install(), onStatus(cb) -> unsubscribe }
 *   strava: { supported, status(), connect(secret), sync(), disconnect(), onEvent(cb) -> unsubscribe }
 *   garmin: { supported, findDrives(): Promise<[{ root, label }]>, copy({ root, name, data }) }
 *   watch: { supported, canSchedule, check(), preview(workout, { indoor, locale }),        (iOS only:
 *            schedule(workout, 'YYYY-MM-DD', { indoor, locale }), listScheduled(), clearScheduled() }  WorkoutKit)
 *   health: { supported, isAvailable(), requestAuthorization(), importRuns({ since }) }       (iOS only:
 *                                                                                            HealthKit, read only)
 *   setTitleBarTheme({ color, symbolColor }): void
 *   notify({ title, body }): Promise<{ shown }>
 *
 * Errors carry error.code; MESSAGES has cs + en texts for them ('platform.error.<code>').
 *
 * Android notes:
 *   - secrets live in Capacitor Preferences (Android SharedPreferences in the app's private
 *     storage). They are NOT encrypted: secrets.encrypted === false, the UI should say so.
 *   - saveFile writes to the app cache (exports/<name>) and opens the system share sheet.
 *   - backups go to Directory.Data 'backups/', newest 14 kept.
 *   - updates: only the 'github' channel has an updater (it asks GitHub for the newest release and
 *     opens its Android package in the browser). The 'play' channel has none: Google Play installs
 *     updates, and Play's Device and Network Abuse policy forbids any other update path.
 *   - Strava and Garmin USB copy are not available.
 *
 * iOS notes (mobile/ios, docs/ios-release.md):
 *   - the Capacitor plugins behave as on Android: Preferences is UserDefaults (not encrypted), files go
 *     through the share sheet, backups to Directory.Data 'backups/'. No updater in any channel: the
 *     App Store installs updates.
 *   - watch: Capacitor.Plugins.VeyvoWorkoutKit (mobile/ios/App/App/VeyvoWorkoutKitPlugin.swift). Needs
 *     iOS 17; `supported` starts from the iOS version in the user agent and check() asks the plugin.
 *     preview() shows Apple's own workout preview with its "add to watch" button; schedule() puts the
 *     workout into the Workout app's scheduled list for that day (07:00, today after 07:00 the next minute) and replaces any VEYVO
 *     workout already scheduled for the day. The workout travels as JSON (watchPayload).
 *   - health: Capacitor.Plugins.VeyvoHealth (VeyvoHealthPlugin.swift). importRuns resolves to rows
 *     for VeyvoStore.importHealthRuns. iOS never tells an app whether reading was denied, so a denied
 *     permission looks like "no runs".
 *
 * Build channels: code between the lines '// #if-channel github' and '// #end-channel' exists only in
 * the 'github' channel. mobile/scripts/sync-web.mjs --channel play (or appstore) deletes those lines
 * from the copy in mobile/www, so a store build does not even contain the GitHub updater. The code
 * inside also checks the channel at run time, so the unstripped source behaves the same everywhere.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- constants

  // Build channels (src/build-info.js): 'github' plus the store channels. Unknown values count as 'github'.
  const CHANNELS = Object.freeze(['github', 'play', 'appstore']);
  // intervals.icu: the workout push, in every build. GitHub's API: the Android update check, GitHub build only.
  const STORE_HTTP_HOSTS = Object.freeze(['intervals.icu']);
  // #if-channel github
  const GITHUB_HTTP_HOSTS = Object.freeze(['intervals.icu', 'api.github.com']);
  // #end-channel
  const HTTP_HOSTS = httpHostsFor(buildInfo(root.window).channel);
  const HTTP_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
  const HTTP_TIMEOUT_MS = 15000;
  const MAX_HTTP_BODY_CHARS = 5 * 1024 * 1024;
  const MAX_HTTP_RESPONSE_BYTES = 10 * 1024 * 1024;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_FIT_BYTES = 1024 * 1024;
  const MAX_BACKUP_CHARS = 50 * 1024 * 1024;
  const MAX_SECRET_CHARS = 8192;
  const MAX_URL_CHARS = 4096;
  const BACKUP_KEEP = 14;
  // Safety copies made right before a destructive step (Nahradit, Smazat vše): one file each, never
  // overwritten by the daily backup or by each other, pruned separately (newest SAFETY_KEEP stay).
  const SAFETY_KEEP = 10;
  const SAFETY_KINDS = Object.freeze(['replace', 'wipe']);
  const BACKUP_DIR = 'backups';
  // Apple Watch: a scheduled workout appears in the Workout app at this local hour of its day.
  const WATCH_SCHEDULE_HOUR = 7;
  // Apple Health: at most this many running workouts per import (90 days hold far fewer).
  const HEALTH_MAX_ROWS = 1000;
  const SECRET_PREFIX = 'veyvo-secret.';
  const WEB_VERSION = '0.0.0-web';
  // #if-channel github
  const REPO = 'PepiBikerBTW/VEYVO';
  const RELEASES_LATEST_URL = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  const RELEASE_DOWNLOAD_PREFIX = 'https://github.com/' + REPO + '/releases/download/';
  const RELEASE_PAGE_PREFIX = 'https://github.com/' + REPO + '/releases/';
  // #end-channel

  const SECRET_NAME_RE = /^[a-z0-9-]{1,40}$/;
  // 'veyvo-2026-11-27.json' (daily) or 'veyvo-2026-11-27-101500-before-replace.json' (safety copy).
  const BACKUP_NAME_RE = /^veyvo-(\d{4}-\d{2}-\d{2})(?:-(\d{6})-before-([a-z]+))?\.json$/;
  const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
  const FORBIDDEN_HEADERS = Object.freeze(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding',
    'upgrade', 'te', 'trailer', 'expect', 'cookie', 'cookie2']);
  const MAX_HEADERS = 32;
  const MAX_HEADER_VALUE = 8192;
  const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
  // Types that run code or mount images when opened (Windows, Android, Linux desktops). VEYVO only
  // exports data (.fit, .workout, .zwo, .json, .txt, ...); a page must never drop one of these.
  const BLOCKED_EXTENSIONS = Object.freeze(['exe', 'com', 'bat', 'cmd', 'scr', 'pif', 'msi', 'msp', 'mst', 'msc', 'msix',
    'appx', 'appinstaller', 'application', 'appref-ms', 'cpl', 'dll', 'sys', 'drv', 'ocx', 'ps1', 'psm1', 'psd1', 'ps1xml',
    'vb', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'wsf', 'wsh', 'ws', 'wsc', 'hta', 'chm', 'lnk', 'url', 'scf', 'reg', 'inf',
    'jar', 'jnlp', 'gadget', 'settingcontent-ms', 'library-ms', 'search-ms', 'searchconnector-ms', 'diagcab', 'iso', 'img',
    'vhd', 'vhdx', 'xll', 'xlam', 'docm', 'xlsm', 'pptm', 'apk', 'sh', 'command', 'desktop']);
  const MIME_EXTENSIONS = Object.freeze({
    'application/json': 'json',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'text/xml': 'xml',
    'application/xml': 'xml',
    'text/html': 'html',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/vnd.ant.fit': 'fit',
    'application/fit': 'fit'
  });

  // ---------------------------------------------------------------- small helpers

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function codedError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }

  /**
   * Turns whatever a bridge rejected with into a coded Error. Electron wraps errors thrown in
   * the main process as "Error invoking remote method 'x': Error: [code] message"; the code in
   * brackets survives that, everything else falls back to `fallbackCode`.
   */
  function toCodedError(error, fallbackCode) {
    if (error && typeof error.code === 'string' && /^[a-z_]{2,40}$/.test(error.code)) return error;
    const raw = error && error.message != null ? String(error.message) : String(error == null ? '' : error);
    const match = /\[([a-z_]{2,40})\]\s*/.exec(raw);
    const message = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(?:[A-Za-z]*Error:\s*)+/, '')
      .replace(/\[[a-z_]{2,40}\]\s*/, '').trim();
    return codedError(match ? match[1] : (fallbackCode || 'failed'), message || (match ? match[1] : fallbackCode || 'failed'));
  }

  function noop() {}
  function unsubscribeNoop() { return noop; }

  // ---------------------------------------------------------------- build channel

  /**
   * buildInfo(win) -> { channel: 'github' | 'play' | 'appstore', store } from win.VEYVO_BUILD (in a
   * page that is the global set by src/build-info.js). Missing or unknown values give 'github'; store
   * is true for a store build (Google Play, App Store): no self-updater, no GitHub calls, no Strava.
   */
  function buildInfo(win) {
    let raw = null;
    try { raw = win && win.VEYVO_BUILD ? win.VEYVO_BUILD : root.VEYVO_BUILD; } catch (error) { raw = null; }
    const channel = raw && typeof raw.channel === 'string' && CHANNELS.indexOf(raw.channel) >= 0 ? raw.channel : 'github';
    return Object.freeze({ channel: channel, store: channel !== 'github' });
  }

  /** The http allowlist of a channel: STORE_HTTP_HOSTS for a store, plus GitHub's API (update check) for 'github'. */
  function httpHostsFor(channel) {
    // #if-channel github
    if (channel === 'github' || CHANNELS.indexOf(channel) < 0) return GITHUB_HTTP_HOSTS;
    // #end-channel
    return STORE_HTTP_HOSTS;
  }

  // ---------------------------------------------------------------- urls and http requests

  function parseUrl(url) {
    if (typeof url !== 'string' || !url || url.length > MAX_URL_CHARS) return null;
    if (typeof URL !== 'function') return null;
    try { return new URL(url); } catch (error) { return null; }
  }

  /**
   * true for https://<an allowlisted host>/... on the default port without credentials. hosts
   * defaults to HTTP_HOSTS (this build's channel); adapters pass httpHostsFor(their channel).
   */
  function isAllowedHttpUrl(url, hosts) {
    const list = Array.isArray(hosts) ? hosts : HTTP_HOSTS;
    const u = parseUrl(url);
    if (!u) return false;
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    if (u.port !== '' && u.port !== '443') return false;
    return list.indexOf(u.hostname) !== -1;
  }

  /** true for http:// and https:// links with a host and no embedded credentials. */
  function isExternalUrl(url) {
    const u = parseUrl(url);
    if (!u) return false;
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return Boolean(u.hostname) && !u.username && !u.password;
  }

  function headerList(headers) {
    if (headers == null) return {};
    if (!isPlainObject(headers)) throw codedError('invalid_request', 'headers must be a plain object');
    const names = Object.keys(headers);
    if (names.length > MAX_HEADERS) throw codedError('invalid_request', 'too many headers');
    const out = {};
    const seen = {};
    names.forEach(function (name) {
      const lower = name.toLowerCase();
      if (!HEADER_NAME_RE.test(name)) throw codedError('invalid_request', 'invalid header name');
      if (FORBIDDEN_HEADERS.indexOf(lower) !== -1 || lower.indexOf('proxy-') === 0 || lower.indexOf('sec-') === 0) {
        throw codedError('invalid_request', 'header not allowed: ' + lower);
      }
      if (seen[lower]) throw codedError('invalid_request', 'duplicate header: ' + lower);
      seen[lower] = true;
      const raw = headers[name];
      if (typeof raw !== 'string' && !(typeof raw === 'number' && Number.isFinite(raw))) {
        throw codedError('invalid_request', 'header values must be strings');
      }
      const value = String(raw);
      if (value.length > MAX_HEADER_VALUE || /[\r\n\0]/.test(value)) throw codedError('invalid_request', 'invalid header value');
      out[name] = value;
    });
    return out;
  }

  function hasHeader(headers, name) {
    const wanted = name.toLowerCase();
    return Object.keys(headers).some(function (key) { return key.toLowerCase() === wanted; });
  }

  /**
   * normalizeHttpRequest({ url, method = 'GET', headers, body }, { hosts }?) -> { url, method, headers, body? }
   * Throws coded errors: host_not_allowed (not https or not an allowlisted host), invalid_request,
   * too_large. A plain object/array body is sent as JSON (Content-Type added when missing).
   */
  function normalizeHttpRequest(request, options) {
    if (!isPlainObject(request)) throw codedError('invalid_request', 'request must be an object');
    const u = parseUrl(request.url);
    if (!u) throw codedError('invalid_request', 'invalid url');
    const hosts = options && Array.isArray(options.hosts) ? options.hosts : HTTP_HOSTS;
    if (!isAllowedHttpUrl(request.url, hosts)) throw codedError('host_not_allowed', 'host not allowed: ' + u.host);
    const method = request.method == null ? 'GET' : String(request.method).toUpperCase();
    if (HTTP_METHODS.indexOf(method) === -1) throw codedError('invalid_request', 'method not allowed: ' + method);
    const headers = headerList(request.headers);
    let body = request.body;
    if (body === null || body === undefined || body === '') body = undefined;
    else if (typeof body === 'string') { /* as is */ }
    else if (isPlainObject(body) || Array.isArray(body)) {
      body = JSON.stringify(body);
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    } else throw codedError('invalid_request', 'body must be a string or JSON object');
    if (body !== undefined && body.length > MAX_HTTP_BODY_CHARS) throw codedError('too_large', 'request body too large');
    if (body !== undefined && (method === 'GET' || method === 'HEAD')) throw codedError('invalid_request', method + ' cannot have a body');
    const out = { url: u.href, method: method, headers: headers };
    if (body !== undefined) out.body = body;
    return out;
  }

  function lowerHeaders(headers) {
    const out = {};
    if (!headers) return out;
    if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
      headers.forEach(function (value, key) { out[String(key).toLowerCase()] = String(value); });
      return out;
    }
    if (typeof headers === 'object') {
      Object.keys(headers).forEach(function (key) {
        const value = headers[key];
        if (value != null) out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
      });
    }
    return out;
  }

  /** { status, text, headers } from a bridge -> { status, ok, text, json, headers }; json is null when the body is not JSON. */
  function responseFrom(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const status = Number(r.status);
    const safeStatus = Number.isInteger(status) && status >= 0 && status <= 999 ? status : 0;
    const text = typeof r.text === 'string' ? r.text : (r.text == null ? '' : String(r.text));
    let json = null;
    if (r.json !== undefined && r.json !== null && typeof r.json !== 'function') json = r.json;
    else if (text.trim()) {
      try { json = JSON.parse(text); } catch (error) { json = null; }
    }
    return { status: safeStatus, ok: safeStatus >= 200 && safeStatus < 300, text: text, json: json, headers: lowerHeaders(r.headers) };
  }

  // ---------------------------------------------------------------- file names and data

  function splitExtension(name) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' };
    const ext = name.slice(dot);
    if (!/^\.[A-Za-z0-9]{1,10}$/.test(ext)) return { base: name, ext: '' };
    return { base: name.slice(0, dot), ext: ext };
  }

  function cutChars(text, max) {
    const chars = Array.from(text);
    return chars.length > max ? chars.slice(0, Math.max(0, max)).join('') : text;
  }

  /**
   * sanitizeFileName(name, { ascii = false, fallback = 'veyvo-export', maxLength = 120 })
   * Keeps only the last path segment, removes control and bidi characters, replaces characters
   * Windows forbids (<>:"/\|?*) with '-', trims dots and spaces at both ends, prefixes reserved
   * device names (CON, NUL, COM1, ...) with '_' and shortens long names keeping the extension.
   * ascii: strips diacritics (Běh -> Beh) and keeps only [A-Za-z0-9._-] (for Garmin watches).
   */
  function sanitizeFileName(name, options) {
    const o = isPlainObject(options) ? options : {};
    const fallback = typeof o.fallback === 'string' && o.fallback ? o.fallback : 'veyvo-export';
    const maxLength = Number.isInteger(o.maxLength) && o.maxLength >= 8 ? Math.min(o.maxLength, 200) : 120;
    let text = typeof name === 'string' ? name : (typeof name === 'number' && Number.isFinite(name) ? String(name) : '');
    text = text.normalize('NFC').replace(/^.*[\\/]/, '')
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
      .replace(/^[\s.]+|[\s.]+$/g, '');
    const parts = splitExtension(text);
    let base = parts.base;
    const ext = parts.ext;
    if (o.ascii) {
      base = base.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    } else {
      base = base.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
    }
    if (!base) base = fallback;
    if (WINDOWS_RESERVED_RE.test(base.split('.')[0])) base = '_' + base;
    if (Array.from(base).length + ext.length > maxLength) base = cutChars(base, maxLength - ext.length).replace(/[\s.-]+$/g, '') || '_';
    return base + ext;
  }

  /** 'Plan.FIT' -> 'fit', 'notes' -> '' */
  function fileExtension(name) {
    if (typeof name !== 'string') return '';
    const ext = splitExtension(name).ext;
    return ext ? ext.slice(1).toLowerCase() : '';
  }

  /** Adds the extension for a known mime type when the name has none ('zaloha', 'application/json' -> 'zaloha.json'). */
  function ensureExtension(name, mime) {
    // 'Záloha 27.11' has no real extension: digits after the last dot are part of a date.
    if (/[a-z]/.test(fileExtension(name))) return name;
    const key = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
    const ext = MIME_EXTENSIONS[key];
    return ext ? name + '.' + ext : name;
  }

  /** string -> UTF-8 bytes; Uint8Array / ArrayBuffer / other views -> Uint8Array; anything else throws invalid_data. */
  function toBytes(data) {
    if (typeof data === 'string') {
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(data);
      throw codedError('unsupported', 'TextEncoder is missing');
    }
    if (data instanceof Uint8Array) return data;
    if (typeof ArrayBuffer !== 'undefined') {
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw codedError('invalid_data', 'data must be a string or Uint8Array');
  }

  function bytesToBase64(bytes) {
    const view = toBytes(bytes);
    if (typeof root.btoa !== 'function') {
      if (typeof Buffer === 'function') return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64');
      throw codedError('unsupported', 'base64 encoder is missing');
    }
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < view.length; i += chunk) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
    }
    return root.btoa(binary);
  }

  /** FIT files start with a 12 or 14 byte header whose bytes 8-11 read '.FIT'. */
  function looksLikeFit(data) {
    if (typeof data === 'string') return false;
    let bytes;
    try { bytes = toBytes(data); } catch (error) { return false; }
    return bytes.length >= 14 && (bytes[0] === 12 || bytes[0] === 14) &&
      bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
  }

  /** True when the name ends in a type that runs code when opened ('plan.fit.exe', 'x.appref-ms'). */
  function isBlockedFileName(name) {
    if (typeof name !== 'string') return false;
    const trimmed = name.replace(/[\s.]+$/, '');
    const dot = trimmed.lastIndexOf('.');
    return dot >= 0 && BLOCKED_EXTENSIONS.indexOf(trimmed.slice(dot + 1).toLowerCase()) !== -1;
  }

  /**
   * prepareFile({ name, mime, data }) -> { name, mime, data } with a sanitized name (extension
   * added from mime when missing), data as string or Uint8Array; throws invalid_data / too_large,
   * file_type_blocked for executable types (BLOCKED_EXTENSIONS).
   */
  function prepareFile(file) {
    if (!isPlainObject(file)) throw codedError('invalid_data', 'file must be an object');
    const mime = typeof file.mime === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+(;.*)?$/i.test(file.mime.trim()) ? file.mime.trim() : 'application/octet-stream';
    const name = sanitizeFileName(ensureExtension(sanitizeFileName(file.name), mime));
    if (isBlockedFileName(name)) throw codedError('file_type_blocked', 'this file type cannot be saved: ' + name);
    let data = file.data;
    if (typeof data !== 'string') data = toBytes(data);
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (size > MAX_FILE_BYTES) throw codedError('too_large', 'file too large');
    return { name: name, mime: mime, data: data };
  }

  // ---------------------------------------------------------------- versions

  const VERSION_RE = /^v?(\d{1,9})\.(\d{1,9})(?:\.(\d{1,9}))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

  /** '0.4.0', 'v0.4.0', '0.4', '0.4.0-beta.2' -> { major, minor, patch, prerelease: [] } | null */
  function parseVersion(version) {
    if (typeof version !== 'string') return null;
    const m = VERSION_RE.exec(version.trim());
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] || 0), prerelease: m[4] ? m[4].split('.') : [] };
  }

  /** Semver order: -1, 0 or 1; null when either side is not a version. A prerelease sorts before its release. */
  function compareVersions(a, b) {
    const x = parseVersion(a), y = parseVersion(b);
    if (!x || !y) return null;
    const parts = ['major', 'minor', 'patch'];
    for (let i = 0; i < parts.length; i++) {
      if (x[parts[i]] !== y[parts[i]]) return x[parts[i]] > y[parts[i]] ? 1 : -1;
    }
    const p = x.prerelease, q = y.prerelease;
    if (!p.length || !q.length) return p.length === q.length ? 0 : (p.length ? -1 : 1);
    for (let i = 0; i < Math.max(p.length, q.length); i++) {
      if (i >= p.length) return -1;
      if (i >= q.length) return 1;
      const pn = /^\d+$/.test(p[i]), qn = /^\d+$/.test(q[i]);
      if (pn && qn) {
        const d = Number(p[i]) - Number(q[i]);
        if (d) return d > 0 ? 1 : -1;
      } else if (pn !== qn) return pn ? -1 : 1;
      else if (p[i] !== q[i]) return p[i] > q[i] ? 1 : -1;
    }
    return 0;
  }

  function isNewerVersion(candidate, current) {
    return compareVersions(candidate, current) === 1;
  }

  // #if-channel github
  /**
   * releaseInfo(githubLatestReleaseJson, currentVersion) ->
   *   { available, newer, version, url, pageUrl, publishedAt }
   * url is the .apk asset under https://github.com/PepiBikerBTW/VEYVO/releases/download/ (a
   * non-debug build preferred); available needs both a newer version and an .apk.
   */
  function releaseInfo(release, currentVersion) {
    const empty = { available: false, newer: false, version: null, url: null, pageUrl: null, publishedAt: null };
    if (!isPlainObject(release) || release.draft === true || release.prerelease === true) return empty;
    const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
    const parsed = parseVersion(tag);
    if (!parsed) return empty;
    const version = tag.replace(/^v/, '');
    const assets = Array.isArray(release.assets) ? release.assets.filter(function (asset) {
      return isPlainObject(asset) && typeof asset.name === 'string' && /\.apk$/i.test(asset.name) &&
        typeof asset.browser_download_url === 'string' && asset.browser_download_url.indexOf(RELEASE_DOWNLOAD_PREFIX) === 0 &&
        isExternalUrl(asset.browser_download_url);
    }) : [];
    assets.sort(function (a, b) { return (/debug/i.test(a.name) ? 1 : 0) - (/debug/i.test(b.name) ? 1 : 0); });
    const url = assets.length ? assets[0].browser_download_url : null;
    const newer = isNewerVersion(version, currentVersion);
    const pageUrl = typeof release.html_url === 'string' && release.html_url.indexOf(RELEASE_PAGE_PREFIX) === 0 && isExternalUrl(release.html_url) ? release.html_url : null;
    return {
      available: Boolean(newer && url),
      newer: newer,
      version: version,
      url: url,
      pageUrl: pageUrl,
      publishedAt: typeof release.published_at === 'string' ? release.published_at : null
    };
  }

  /** A daily update check counts as done only when GitHub answered and any newer release already has its APK. */
  function updateCheckCounts(info) {
    return Boolean(info && typeof info === 'object' && !info.error && !(info.newer && !info.available));
  }

  /**
   * The last check's status ({ type: 'current' | 'available' | 'newer', version, pageUrl, checkedAt,
   * installed }) to show after a restart, or null when it does not fit the installed version.
   */
  function restoredUpdateStatus(record, installedVersion) {
    if (!isPlainObject(record) || ['current', 'available', 'newer'].indexOf(record.type) < 0) return null;
    if (!installedVersion || record.installed !== installedVersion) return null;
    return { type: record.type, version: typeof record.version === 'string' ? record.version : null, pageUrl: typeof record.pageUrl === 'string' && isExternalUrl(record.pageUrl) ? record.pageUrl : null, checkedAt: typeof record.checkedAt === 'string' ? record.checkedAt : null, restored: true };
  }
  // #end-channel

  // ---------------------------------------------------------------- secrets, dates, backups, colors

  function isSecretName(name) {
    return typeof name === 'string' && SECRET_NAME_RE.test(name);
  }

  function isDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const y = Number(value.slice(0, 4)), m = Number(value.slice(5, 7)), d = Number(value.slice(8, 10));
    if (m < 1 || m > 12 || d < 1) return false;
    const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= days[m - 1];
  }

  /** Local calendar date of a Date as 'YYYY-MM-DD' (null for an invalid date). */
  function dateKeyOf(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return String(date.getFullYear()).padStart(4, '0') + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  /** Local clock of a Date as 'HHMMSS' (null for an invalid date). */
  function timeKeyOf(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
  }
  function isTimeKey(value) {
    return typeof value === 'string' && /^\d{6}$/.test(value) && Number(value.slice(0, 2)) < 24 && Number(value.slice(2, 4)) < 60 && Number(value.slice(4, 6)) < 60;
  }

  /**
   * '2026-11-27' -> 'veyvo-2026-11-27.json' (the daily backup); with { kind: 'replace' | 'wipe', time:
   * 'HHMMSS' } -> 'veyvo-2026-11-27-101500-before-replace.json' (a safety copy). Null for anything invalid.
   */
  function backupFileName(dateKey, options) {
    if (!isDateKey(dateKey)) return null;
    const o = options && typeof options === 'object' ? options : {};
    if (o.kind === undefined || o.kind === null || o.kind === 'daily') return 'veyvo-' + dateKey + '.json';
    if (SAFETY_KINDS.indexOf(o.kind) < 0 || !isTimeKey(o.time)) return null;
    return 'veyvo-' + dateKey + '-' + o.time + '-before-' + o.kind + '.json';
  }

  /** backupInfo(name) -> { name, date, time, kind: 'daily' | 'replace' | 'wipe' } or null. */
  function backupInfo(name) {
    if (typeof name !== 'string') return null;
    const m = BACKUP_NAME_RE.exec(name);
    if (!m || !isDateKey(m[1])) return null;
    if (m[2] === undefined) return { name: name, date: m[1], time: null, kind: 'daily' };
    if (!isTimeKey(m[2]) || SAFETY_KINDS.indexOf(m[3]) < 0) return null;
    return { name: name, date: m[1], time: m[2], kind: m[3] };
  }

  function isBackupFileName(name) {
    return backupInfo(name) !== null;
  }

  /** Valid backup names, unique, newest first (a day's safety copies, newest first, before its daily file). */
  function sortBackupNames(names) {
    const list = Array.isArray(names) ? names.filter(isBackupFileName) : [];
    const key = function (name) { const i = backupInfo(name); return i.date + ' ' + (i.time || ''); };
    return list.filter(function (name, index) { return list.indexOf(name) === index; })
      .sort(function (a, b) { const ka = key(a), kb = key(b); return ka < kb ? 1 : ka > kb ? -1 : 0; });
  }

  /**
   * Backup names to delete: only the newest `keep` (default 14) daily backups and the newest
   * `safetyKeep` (default 10) safety copies remain, each counted on its own, so daily backups never
   * push out the copy made before a replace or wipe. Other files are never listed.
   */
  function backupsToPrune(names, keep, safetyKeep) {
    const limit = Number.isInteger(keep) && keep >= 1 ? keep : BACKUP_KEEP;
    const safetyLimit = Number.isInteger(safetyKeep) && safetyKeep >= 1 ? safetyKeep : SAFETY_KEEP;
    const sorted = sortBackupNames(names);
    const daily = sorted.filter(function (name) { return backupInfo(name).kind === 'daily'; });
    const safety = sorted.filter(function (name) { return backupInfo(name).kind !== 'daily'; });
    return daily.slice(limit).concat(safety.slice(safetyLimit));
  }

  /** snapshot() options -> the safety kind ('replace' | 'wipe') or null for the daily backup. */
  function snapshotKind(options) {
    const kind = options && typeof options === 'object' ? options.kind : null;
    if (kind === undefined || kind === null || kind === 'daily') return null;
    if (SAFETY_KINDS.indexOf(kind) < 0) throw codedError('invalid_data', 'unknown backup kind');
    return kind;
  }

  /** A safety-copy name for `now` that is not in `taken` yet (one second later on a clash). */
  function safetyBackupName(kind, now, taken) {
    const used = new Set(Array.isArray(taken) ? taken : []);
    const base = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
    for (let i = 0; i < 60; i++) {
      const at = new Date(base + i * 1000);
      const name = backupFileName(dateKeyOf(at), { kind: kind, time: timeKeyOf(at) });
      if (name && !used.has(name)) return name;
    }
    return backupFileName(dateKeyOf(new Date(base)), { kind: kind, time: timeKeyOf(new Date(base)) });
  }

  function isHexColor(value) {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
  }

  function checkSecretName(name) {
    if (!isSecretName(name)) throw codedError('invalid_name', 'secret names must match [a-z0-9-]{1,40}');
  }

  function checkSecretValue(value) {
    if (typeof value !== 'string') throw codedError('invalid_data', 'secret values must be strings');
    if (value.length > MAX_SECRET_CHARS) throw codedError('too_large', 'secret too long');
  }

  function checkBackupJson(json) {
    if (typeof json !== 'string' || !json.trim()) throw codedError('invalid_data', 'backup must be a JSON string');
    if (json.length > MAX_BACKUP_CHARS) throw codedError('too_large', 'backup too large');
    try { JSON.parse(json); } catch (error) { throw codedError('invalid_data', 'backup is not valid JSON'); }
  }

  /** Garmin copy input check (shared by desktop renderer and main). Returns { name, data: Uint8Array }. */
  function prepareFitFile(name, data) {
    let fileName = sanitizeFileName(typeof name === 'string' ? name : '', { ascii: true, fallback: 'veyvo-workout', maxLength: 64 });
    const ext = fileExtension(fileName);
    if (!ext) fileName += '.fit';
    else if (ext !== 'fit') throw codedError('not_fit', 'only .fit files can be copied to a Garmin watch');
    fileName = fileName.replace(/\.fit$/i, '.fit');
    let bytes;
    try { bytes = toBytes(data); } catch (error) { throw codedError('not_fit', 'FIT data must be bytes'); }
    if (typeof data === 'string' || !looksLikeFit(bytes)) throw codedError('not_fit', 'data is not a FIT file');
    if (bytes.byteLength > MAX_FIT_BYTES) throw codedError('too_large', 'FIT file too large');
    return { name: fileName, data: bytes };
  }

  // ---------------------------------------------------------------- messages (cs + en)

  /** VeyvoI18n.register('platform', VeyvoPlatform.MESSAGES); keys 'platform.error.<code>'. */
  const MESSAGES = Object.freeze({
    cs: {
      error: {
        unsupported: 'Tahle funkce v této verzi VEYVO není dostupná.',
        host_not_allowed: 'VEYVO se smí připojit jen k intervals.icu a GitHubu.',
        invalid_url: 'Tohle není platná webová adresa.',
        invalid_request: 'Požadavek není platný.',
        timeout: 'Server neodpověděl do 15 sekund. Zkus to znovu.',
        network: 'Nepodařilo se připojit. Zkontroluj připojení k internetu.',
        too_large: 'Soubor nebo odpověď je příliš velká.',
        invalid_name: 'Neplatný název.',
        invalid_data: 'Data souboru nejsou platná.',
        encryption_unavailable: 'Šifrované úložiště systému není dostupné, klíč se proto neuložil.',
        not_found: 'Soubor se nenašel.',
        drive_not_found: 'Hodinky Garmin nejsou připojené. Připoj je kabelem a zkus to znovu.',
        not_fit: 'Do hodinek Garmin jde nahrát jen soubor .fit.',
        file_type_blocked: 'Tento typ souboru VEYVO z bezpečnostních důvodů neuloží.',
        write_failed: 'Soubor se nepodařilo uložit.',
        no_update: 'Žádná aktualizace ke stažení není.',
        watch_unsupported: 'Přidat trénink přímo do Apple Watch jde v iPhonu s iOS 17 nebo novějším.',
        watch_invalid: 'Tenhle trénink Apple Watch nepřijme. Zkontroluj délky a cíle kroků.',
        watch_step_unsupported: 'Apple Watch některý krok nebo cíl tohoto tréninku neumí.',
        watch_busy: 'Náhled tréninku už je otevřený.',
        watch_denied: 'VEYVO nemá povolené plánovat tréninky do Apple Watch. Povol to v Nastavení iPhonu u aplikace VEYVO.',
        watch_limit: 'V Apple Watch je naplánovaných tréninků nejvíc, kolik jde. Starší nejdřív odeber.',
        watch_date: 'Naplánovat jde jen dnešek nebo pozdější den.',
        watch_failed: 'Trénink se do Apple Watch nepodařilo předat.',
        health_unavailable: 'Apple Zdraví není v tomto zařízení dostupné.',
        health_failed: 'Běhy z Apple Zdraví se nepodařilo načíst.',
        failed: 'Něco se nepovedlo. Zkus to znovu.'
      }
    },
    en: {
      error: {
        unsupported: 'This feature is not available in this version of VEYVO.',
        host_not_allowed: 'VEYVO may only connect to intervals.icu and GitHub.',
        invalid_url: 'That is not a valid web address.',
        invalid_request: 'The request is not valid.',
        timeout: 'The server did not respond within 15 seconds. Try again.',
        network: 'Could not connect. Check your internet connection.',
        too_large: 'The file or response is too large.',
        invalid_name: 'Invalid name.',
        invalid_data: 'The file data is not valid.',
        encryption_unavailable: 'Encrypted system storage is not available, so the key was not saved.',
        not_found: 'File not found.',
        drive_not_found: 'No Garmin watch is connected. Plug it in with the cable and try again.',
        not_fit: 'Only .fit files can be copied to a Garmin watch.',
        file_type_blocked: 'For security reasons VEYVO does not save this type of file.',
        write_failed: 'The file could not be saved.',
        no_update: 'There is no update to download.',
        watch_unsupported: 'Adding a workout straight to Apple Watch needs an iPhone with iOS 17 or later.',
        watch_invalid: 'Apple Watch will not take this workout. Check the step lengths and targets.',
        watch_step_unsupported: 'Apple Watch does not support a step or target of this workout.',
        watch_busy: 'The workout preview is already open.',
        watch_denied: 'VEYVO is not allowed to schedule workouts on Apple Watch. Allow it for VEYVO in the iPhone Settings.',
        watch_limit: 'Apple Watch already has as many scheduled workouts as it can hold. Remove older ones first.',
        watch_date: 'Only today or a later day can be scheduled.',
        watch_failed: 'The workout could not be handed to Apple Watch.',
        health_unavailable: 'Apple Health is not available on this device.',
        health_failed: 'Runs could not be read from Apple Health.',
        failed: 'Something went wrong. Try again.'
      }
    }
  });

  // A store build talks to intervals.icu only, so its texts must not mention GitHub.
  const STORE_MESSAGES = Object.freeze({
    cs: { error: { host_not_allowed: 'VEYVO se smí připojit jen k intervals.icu.' } },
    en: { error: { host_not_allowed: 'VEYVO may only connect to intervals.icu.' } }
  });

  /** MESSAGES for a build ({ store }): the store builds get STORE_MESSAGES on top. */
  function messagesFor(build) {
    if (!build || !build.store) return MESSAGES;
    const out = {};
    Object.keys(MESSAGES).forEach(function (code) {
      out[code] = { error: Object.assign({}, MESSAGES[code].error, STORE_MESSAGES[code].error) };
    });
    return out;
  }

  function registerMessages(i18n) {
    if (!i18n || typeof i18n.register !== 'function') return false;
    i18n.register('platform', messagesFor(api.build));
    return true;
  }

  // ---------------------------------------------------------------- shared adapter parts

  function unsupported(what) {
    return Promise.reject(codedError('unsupported', (what || 'feature') + ' is not supported here'));
  }

  function attempt(fn) {
    try { return Promise.resolve(fn()); } catch (error) { return Promise.reject(error); }
  }

  function unsupportedUpdates() {
    return {
      supported: false,
      check: function () { return Promise.resolve({ available: false, newer: false, version: null, url: null, unsupported: true }); },
      install: function () { return unsupported('updates'); },
      onStatus: unsubscribeNoop
    };
  }

  function unsupportedStrava() {
    return {
      supported: false,
      status: function () { return Promise.resolve({ connected: false, athlete: null, unsupported: true }); },
      connect: function () { return unsupported('Strava'); },
      sync: function () { return Promise.resolve([]); },
      disconnect: function () { return Promise.resolve({ connected: false }); },
      onEvent: unsubscribeNoop
    };
  }

  function unsupportedGarmin() {
    return {
      supported: false,
      findDrives: function () { return Promise.resolve([]); },
      copy: function () { return unsupported('Garmin copy'); }
    };
  }

  function unsupportedWatch() {
    return {
      supported: false,
      canSchedule: false,
      check: function () { return Promise.resolve({ supported: false, schedule: false, maxScheduled: null }); },
      preview: function () { return unsupported('Apple Watch'); },
      schedule: function () { return unsupported('Apple Watch'); },
      listScheduled: function () { return Promise.resolve([]); },
      clearScheduled: function () { return unsupported('Apple Watch'); }
    };
  }

  function unsupportedHealth() {
    return {
      supported: false,
      isAvailable: function () { return Promise.resolve(false); },
      requestAuthorization: function () { return unsupported('Apple Health'); },
      importRuns: function () { return unsupported('Apple Health'); }
    };
  }

  // ---------------------------------------------------------------- Apple Watch payload (iOS)

  /** The iOS major version from a WKWebView user agent ('… CPU iPhone OS 17_2 like Mac OS X …'), or null. */
  function iosMajorVersion(userAgent) {
    const m = /\bOS (\d{1,2})[_.]\d/.exec(typeof userAgent === 'string' ? userAgent : '');
    return m ? Number(m[1]) : null;
  }

  /**
   * Apple keeps a warm-up only as the first item and a cool-down only as the last one; everything
   * else becomes an interval block (the VeyvoApple.layout rule). A workout made only of a warm-up
   * and/or a cool-down is all blocks.
   */
  function watchEnds(steps) {
    const isStep = function (item, intensity) { return isPlainObject(item) && item.kind === 'step' && item.intensity === intensity; };
    let start = 0, end = steps.length;
    if (isStep(steps[0], 'warmup')) start = 1;
    if (end > start && isStep(steps[end - 1], 'cooldown')) end -= 1;
    return end === start ? { warmup: false, cooldown: false } : { warmup: start === 1, cooldown: end === steps.length - 1 };
  }

  /**
   * watchPayload(workout, { indoor, locale, date }) -> { workoutJson, indoor, planId?, date? } for the
   * native VeyvoWorkoutKit plugin. workoutJson is the VEYVO workout model (docs/architecture.md)
   * as a JSON string: { id, name, date?, steps: [Step | Repeat] }. Steps Apple cannot name itself
   * ('rest', or a warm-up / cool-down that is not at its end) get a label from VeyvoWorkouts.stepName
   * in `locale`, as in the .workout file. planId is a deterministic UUID for (workout id, date)
   * (VeyvoApple.uuidFrom), so scheduling the same workout again replaces it. The workout is checked
   * with VeyvoWorkouts.validate first; an invalid one throws 'watch_invalid'.
   */
  function watchPayload(workout, options) {
    const o = isPlainObject(options) ? options : {};
    const Workouts = root.VeyvoWorkouts, Apple = root.VeyvoApple;
    if (!isPlainObject(workout) || !Array.isArray(workout.steps) || typeof workout.name !== 'string') throw codedError('watch_invalid', 'workout must be a VEYVO workout');
    if (Workouts && typeof Workouts.validate === 'function') {
      const check = Workouts.validate(workout);
      if (!check.ok) throw codedError('watch_invalid', 'invalid workout: ' + check.errors.map(function (e) { return e.code; }).join(', '));
    }
    const locale = o.locale === 'en' ? 'en' : 'cs';
    const ends = watchEnds(workout.steps);
    const last = workout.steps.length - 1;
    function step(s, inRepeat, atEnd) {
      const out = { kind: 'step', intensity: s.intensity, duration: s.duration, target: s.target };
      const own = typeof s.label === 'string' ? s.label.trim() : '';
      const needsName = !atEnd && (s.intensity === 'rest' || s.intensity === 'warmup' || s.intensity === 'cooldown');
      const name = own || (needsName && Workouts && typeof Workouts.stepName === 'function' ? Workouts.stepName(s, locale, inRepeat) : '');
      if (name) out.label = String(name);
      return out;
    }
    const steps = workout.steps.map(function (item, i) {
      if (item.kind === 'repeat') return { kind: 'repeat', count: item.count, steps: item.steps.map(function (s) { return step(s, true, false); }) };
      return step(item, false, (i === 0 && ends.warmup) || (i === last && ends.cooldown));
    });
    const date = isDateKey(o.date) ? o.date : (isDateKey(workout.date) ? workout.date : null);
    const model = { id: String(workout.id || ''), name: workout.name.trim(), steps: steps };
    if (date) model.date = date;
    const out = { workoutJson: JSON.stringify(model), indoor: o.indoor === true };
    if (Apple && typeof Apple.uuidFrom === 'function') out.planId = Apple.uuidFrom('veyvo-watch\n' + model.id + '\n' + (date || ''));
    if (date) out.date = date;
    return out;
  }

  function emitter() {
    const listeners = [];
    return {
      on: function (callback) {
        if (typeof callback !== 'function') return noop;
        listeners.push(callback);
        return function () {
          const index = listeners.indexOf(callback);
          if (index !== -1) listeners.splice(index, 1);
        };
      },
      emit: function (payload) {
        listeners.slice().forEach(function (callback) {
          try { callback(payload); } catch (error) { /* a listener must not break the others */ }
        });
      }
    };
  }

  function withTimeout(promise, ms, code) {
    let timer = null;
    const timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () { reject(codedError(code || 'timeout', 'timed out after ' + ms + ' ms')); }, ms);
    });
    return Promise.race([promise, timeout]).then(function (value) {
      clearTimeout(timer);
      return value;
    }, function (error) {
      clearTimeout(timer);
      throw error;
    });
  }

  function checkExternalUrl(url) {
    if (!isExternalUrl(url)) throw codedError('invalid_url', 'only http and https links can be opened');
    return new URL(url).href;
  }

  function checkTitleBarTheme(theme) {
    if (!isPlainObject(theme) || !isHexColor(theme.color) || !isHexColor(theme.symbolColor)) return null;
    return { color: theme.color, symbolColor: theme.symbolColor };
  }

  /** Relative luminance check of a '#RGB' / '#RRGGBB(AA)' colour: true for a dark background. */
  function isDarkColor(hex) {
    if (!isHexColor(hex)) return false;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    const channel = function (i) {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) < 0.18;
  }

  /** Android system bars follow the app theme: 'DARK' = light icons on a dark app, 'LIGHT' = dark icons. */
  function systemBarsStyle(theme) {
    const checked = checkTitleBarTheme(theme);
    return checked ? (isDarkColor(checked.color) ? 'DARK' : 'LIGHT') : null;
  }

  function checkNotification(message) {
    if (!isPlainObject(message) || typeof message.title !== 'string' || !message.title.trim()) {
      throw codedError('invalid_data', 'notification needs a title');
    }
    return {
      title: cutChars(message.title.trim(), 120),
      body: typeof message.body === 'string' ? cutChars(message.body.trim(), 500) : ''
    };
  }

  // ---------------------------------------------------------------- desktop (Electron preload)

  function createDesktop(win) {
    const bridge = win.veyvo;
    function has(name) { return typeof bridge[name] === 'function'; }
    function call(name, args, fallbackCode) {
      if (!has(name)) return unsupported(name);
      return attempt(function () { return bridge[name].apply(bridge, args || []); })
        .catch(function (error) { throw toCodedError(error, fallbackCode); });
    }
    const secretsBridge = bridge.secrets && typeof bridge.secrets === 'object' ? bridge.secrets : null;
    function secretCall(method, args) {
      if (!secretsBridge || typeof secretsBridge[method] !== 'function') return unsupported('secrets');
      return attempt(function () { return secretsBridge[method].apply(secretsBridge, args); })
        .catch(function (error) { throw toCodedError(error, 'failed'); });
    }
    const userAgent = win.navigator && typeof win.navigator.userAgent === 'string' ? win.navigator.userAgent : '';
    const garminSupported = has('garminFindDrives') && has('garminCopy') && (!userAgent || /Windows/i.test(userAgent));
    const build = buildInfo(win);
    const hosts = httpHostsFor(build.channel);

    function subscribe(name, callback) {
      if (!has(name) || typeof callback !== 'function') return noop;
      try {
        const off = bridge[name](callback);
        return typeof off === 'function' ? off : noop;
      } catch (error) { return noop; }
    }

    return {
      kind: 'desktop',
      build: build,
      supports: Object.freeze({
        saveFile: true, share: false, showInFolder: has('showItemInFolder'), http: has('http'),
        secrets: Boolean(secretsBridge), encryptedSecrets: Boolean(secretsBridge), backup: has('backupSnapshot'),
        updates: has('checkForUpdates') && !build.store, strava: has('connectStrava'), garmin: garminSupported,
        notify: has('notify'), titleBar: has('setTitleBarTheme'), watch: false, health: false
      }),
      watch: unsupportedWatch(),
      health: unsupportedHealth(),
      version: function () {
        return call('version', [], 'failed').then(function (value) { return typeof value === 'string' && value ? value : '0.0.0'; });
      },
      saveFile: function (file) {
        return attempt(function () { return prepareFile(file); }).then(function (prepared) {
          return call('saveFile', [prepared], 'write_failed');
        }).then(function (result) {
          const r = result && typeof result === 'object' ? result : {};
          const out = { saved: r.saved === true };
          if (typeof r.path === 'string' && r.path) out.path = r.path;
          return out;
        });
      },
      showInFolder: function (filePath) {
        if (typeof filePath !== 'string' || !filePath) return Promise.resolve(false);
        return call('showItemInFolder', [filePath], 'not_found').then(function (r) { return Boolean(r && r.shown); }, function () { return false; });
      },
      openExternal: function (url) {
        return attempt(function () { return checkExternalUrl(url); }).then(function (href) {
          return call('openExternal', [href], 'invalid_url');
        }).then(noop);
      },
      http: function (request) {
        return attempt(function () { return normalizeHttpRequest(request, { hosts: hosts }); }).then(function (normalized) {
          return call('http', [normalized], 'network');
        }).then(responseFrom);
      },
      secrets: {
        supported: Boolean(secretsBridge),
        encrypted: Boolean(secretsBridge),
        get: function (name) {
          return attempt(function () { checkSecretName(name); }).then(function () { return secretCall('get', [name]); })
            .then(function (value) { return typeof value === 'string' ? value : null; });
        },
        set: function (name, value) {
          return attempt(function () { checkSecretName(name); checkSecretValue(value); })
            .then(function () { return secretCall('set', [name, value]); }).then(noop);
        },
        remove: function (name) {
          return attempt(function () { checkSecretName(name); }).then(function () { return secretCall('remove', [name]); }).then(noop);
        }
      },
      backup: {
        supported: has('backupSnapshot'),
        /** snapshot(json, { kind? }): the daily backup, or with kind 'replace' | 'wipe' a separate safety copy. */
        snapshot: function (json, options) {
          let kind = null;
          return attempt(function () { checkBackupJson(json); kind = snapshotKind(options); })
            .then(function () { return call('backupSnapshot', kind ? [json, { kind: kind }] : [json], 'write_failed'); })
            .then(function (r) { return { path: r && typeof r.path === 'string' ? r.path : null }; });
        },
        list: function () {
          if (!has('listBackups')) return Promise.resolve([]);
          return call('listBackups', [], 'failed').then(function (list) { return Array.isArray(list) ? list : []; });
        },
        read: function (name) {
          if (!isBackupFileName(name)) return Promise.reject(codedError('invalid_name', 'not a backup file name'));
          return call('readBackup', [name], 'not_found');
        }
      },
      // A store build never updates itself (only the GitHub Windows app ships electron-updater).
      updates: has('checkForUpdates') && !build.store ? {
        supported: true,
        check: function () { return call('checkForUpdates', [], 'failed').then(function () { return { pending: true }; }); },
        install: function () { return call('installUpdate', [], 'failed').then(noop); },
        onStatus: function (callback) { return subscribe('onUpdaterStatus', callback); }
      } : unsupportedUpdates(),
      strava: has('connectStrava') ? {
        supported: true,
        status: function () { return call('stravaStatus', [], 'failed'); },
        connect: function (secret) { return call('connectStrava', [secret], 'failed'); },
        sync: function () { return call('syncStrava', [], 'network'); },
        disconnect: function () { return call('disconnectStrava', [], 'failed'); },
        onEvent: function (callback) { return subscribe('onStravaEvent', callback); }
      } : unsupportedStrava(),
      garmin: garminSupported ? {
        supported: true,
        findDrives: function () {
          return call('garminFindDrives', [], 'failed').then(function (list) {
            return Array.isArray(list) ? list.filter(function (d) { return d && typeof d.root === 'string'; })
              .map(function (d) { return { root: d.root, label: typeof d.label === 'string' ? d.label : d.root }; }) : [];
          });
        },
        copy: function (file) {
          return attempt(function () {
            if (!isPlainObject(file) || typeof file.root !== 'string' || !file.root) throw codedError('drive_not_found', 'choose a Garmin drive');
            return prepareFitFile(file.name, file.data);
          }).then(function (fit) {
            return call('garminCopy', [{ root: file.root, name: fit.name, data: fit.data }], 'write_failed');
          }).then(function (r) {
            return { saved: Boolean(r && r.saved), path: r && typeof r.path === 'string' ? r.path : null };
          });
        }
      } : unsupportedGarmin(),
      setTitleBarTheme: function (theme) {
        const checked = checkTitleBarTheme(theme);
        if (!checked || !has('setTitleBarTheme')) return;
        call('setTitleBarTheme', [checked]).catch(noop);
      },
      notify: function (message) {
        return attempt(function () { return checkNotification(message); }).then(function (checked) {
          if (!has('notify')) return { shown: false };
          return call('notify', [checked], 'failed').then(function (r) { return { shown: Boolean(r && r.shown) }; });
        });
      }
    };
  }

  // ---------------------------------------------------------------- android and ios (Capacitor)

  /** The Capacitor shells: kind 'android' (mobile/android) or 'ios' (mobile/ios). */
  function createCapacitor(win, kind) {
    const isIos = kind === 'ios';
    const cap = win.Capacitor;
    function plugins() { return cap.Plugins && typeof cap.Plugins === 'object' ? cap.Plugins : {}; }
    function hasPlugin(name) { return Boolean(plugins()[name]); }
    function plugin(name) {
      const p = plugins()[name];
      if (!p) throw codedError('unsupported', name + ' plugin is not available');
      return p;
    }
    function errorMessage(error) { return error && error.message ? String(error.message) : String(error || ''); }
    const build = buildInfo(win);
    const hosts = httpHostsFor(build.channel);

    function version() {
      return attempt(function () { return plugin('App').getInfo(); })
        .then(function (info) { return info && typeof info.version === 'string' && info.version ? info.version : '0.0.0'; },
          function () { return '0.0.0'; });
    }

    function http(request) {
      return attempt(function () {
        const r = normalizeHttpRequest(request, { hosts: hosts });
        const Http = plugin('CapacitorHttp');
        const headers = Object.assign({}, r.headers);
        const options = {
          url: r.url, method: r.method, headers: headers, responseType: 'text',
          connectTimeout: HTTP_TIMEOUT_MS, readTimeout: HTTP_TIMEOUT_MS, disableRedirects: true
        };
        if (r.body !== undefined) {
          // CapacitorHttp sends a body only together with a Content-Type header.
          if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'text/plain; charset=utf-8';
          options.data = r.body;
        }
        return withTimeout(Promise.resolve(Http.request(options)), HTTP_TIMEOUT_MS + 1000).catch(function (error) {
          if (error && error.code === 'timeout') throw error;
          const message = errorMessage(error);
          throw codedError(/time(d)?\s?out/i.test(message) ? 'timeout' : 'network', message);
        });
      }).then(function (res) {
        const r = res && typeof res === 'object' ? res : {};
        const data = r.data;
        const text = typeof data === 'string' ? data : (data == null ? '' : JSON.stringify(data));
        if (text.length > MAX_HTTP_RESPONSE_BYTES) throw codedError('too_large', 'response too large');
        return responseFrom({ status: r.status, text: text, json: typeof data === 'object' && data !== null ? data : undefined, headers: r.headers });
      });
    }

    function writeCacheFile(prepared) {
      const Filesystem = plugin('Filesystem');
      const options = { path: 'exports/' + prepared.name, directory: 'CACHE', recursive: true };
      if (typeof prepared.data === 'string') { options.data = prepared.data; options.encoding = 'utf8'; } else options.data = bytesToBase64(prepared.data);
      return Promise.resolve(Filesystem.writeFile(options)).then(function (result) {
        if (!result || typeof result.uri !== 'string') throw codedError('write_failed', 'file was not written');
        return result.uri;
      });
    }

    function writeDocument(prepared) {
      const Filesystem = plugin('Filesystem');
      const options = { path: 'VEYVO/' + prepared.name, directory: 'DOCUMENTS', recursive: true };
      if (typeof prepared.data === 'string') { options.data = prepared.data; options.encoding = 'utf8'; } else options.data = bytesToBase64(prepared.data);
      return Promise.resolve(Filesystem.writeFile(options)).then(function (result) {
        return result && typeof result.uri === 'string' ? result.uri : null;
      });
    }

    function saveFile(file) {
      return attempt(function () { return prepareFile(file); }).then(function (prepared) {
        if (!hasPlugin('Share')) {
          return writeDocument(prepared).then(function (uri) { return { saved: true, shared: false, path: uri || undefined }; });
        }
        return writeCacheFile(prepared).then(function (uri) {
          return Promise.resolve(plugin('Share').share({ title: prepared.name, dialogTitle: prepared.name, files: [uri] }))
            .then(function () { return { saved: true, shared: true, path: uri }; }, function (error) {
              if (/cancel/i.test(errorMessage(error))) return { saved: false, shared: false, canceled: true };
              throw codedError('write_failed', errorMessage(error));
            });
        });
      });
    }

    function backupPath(name) { return BACKUP_DIR + '/' + name; }

    function listBackupNames(Filesystem) {
      return Promise.resolve(Filesystem.readdir({ path: BACKUP_DIR, directory: 'DATA' })).then(function (result) {
        const files = result && Array.isArray(result.files) ? result.files : [];
        return files.map(function (f) { return typeof f === 'string' ? { name: f } : f; }).filter(function (f) { return f && isBackupFileName(f.name); });
      }, function () { return []; });
    }

    function snapshot(json, options) {
      let kind = null;
      return attempt(function () { checkBackupJson(json); kind = snapshotKind(options); return plugin('Filesystem'); }).then(function (Filesystem) {
        // A safety copy gets its own name that is not taken yet; the daily backup is one file per day.
        return (kind ? listBackupNames(Filesystem).then(function (files) {
          return safetyBackupName(kind, new Date(), files.map(function (f) { return f.name; }));
        }) : Promise.resolve(backupFileName(dateKeyOf(new Date())))).then(function (name) { return writeBackup(Filesystem, name, json); });
      });
    }

    function writeBackup(Filesystem, name, json) {
      const target = backupPath(name);
      const tmp = target + '.tmp';
      return Promise.resolve(Filesystem.writeFile({ path: tmp, data: json, directory: 'DATA', encoding: 'utf8', recursive: true }))
        .then(function () {
          return Promise.resolve(Filesystem.rename({ from: tmp, to: target, directory: 'DATA', toDirectory: 'DATA' })).catch(function () {
            // Some Android versions refuse to rename over an existing file: replace it explicitly.
            return Promise.resolve(Filesystem.deleteFile({ path: target, directory: 'DATA' })).catch(noop).then(function () {
              return Filesystem.rename({ from: tmp, to: target, directory: 'DATA', toDirectory: 'DATA' });
            });
          });
        })
        .then(function () { return listBackupNames(Filesystem); })
        .then(function (files) {
          const doomed = backupsToPrune(files.map(function (f) { return f.name; }), BACKUP_KEEP);
          return Promise.all(doomed.map(function (old) {
            return Promise.resolve(Filesystem.deleteFile({ path: backupPath(old), directory: 'DATA' })).catch(noop);
          }));
        })
        .then(function () { return { path: target }; }, function (error) {
          throw error && error.code ? error : codedError('write_failed', errorMessage(error));
        });
    }

    function listBackups() {
      return attempt(function () { return plugin('Filesystem'); }).then(listBackupNames).then(function (files) {
        const byName = {};
        files.forEach(function (f) { byName[f.name] = f; });
        return sortBackupNames(Object.keys(byName)).map(function (name) {
          const f = byName[name];
          const info = backupInfo(name);
          return {
            name: name,
            date: info.date,
            time: info.time,
            kind: info.kind,
            size: Number.isFinite(Number(f.size)) ? Number(f.size) : null,
            modified: Number.isFinite(Number(f.mtime)) ? new Date(Number(f.mtime)).toISOString() : null
          };
        });
      }, function () { return []; });
    }

    function readBackup(name) {
      if (!isBackupFileName(name)) return Promise.reject(codedError('invalid_name', 'not a backup file name'));
      return attempt(function () { return plugin('Filesystem').readFile({ path: backupPath(name), directory: 'DATA', encoding: 'utf8' }); })
        .then(function (result) { return result && typeof result.data === 'string' ? result.data : ''; },
          function (error) { throw codedError('not_found', errorMessage(error)); });
    }

    // Updates: the Play and App Store builds have none (the store installs them). Only the GitHub
    // Android build checks the newest GitHub release once a day (ui/app.js) and opens its APK download
    // in the browser. iOS never has an updater.
    let updates = unsupportedUpdates();
    // #if-channel github
    function githubUpdates() {
      const updateEvents = emitter();
      let lastRelease = null;

      function checkUpdates() {
        updateEvents.emit({ type: 'checking' });
        return version().then(function (current) {
          return http({ url: RELEASES_LATEST_URL, method: 'GET', headers: { Accept: 'application/vnd.github+json' } }).then(function (res) {
            if (!res.ok) throw codedError(res.status === 404 ? 'no_update' : 'network', 'GitHub answered ' + res.status);
            const info = releaseInfo(res.json, current);
            lastRelease = info.available ? info : null;
            if (info.available) updateEvents.emit({ type: 'available', version: info.version, url: info.url });
            // A newer release without an APK yet (the Windows job finished first, or no signing key):
            // not "up to date" - say a new version exists and link its release page.
            else if (info.newer) updateEvents.emit({ type: 'newer', version: info.version, pageUrl: info.pageUrl });
            else updateEvents.emit({ type: 'current', version: current });
            return info;
          });
        }).catch(function (error) {
          const coded = toCodedError(error, 'network');
          updateEvents.emit({ type: 'error', code: coded.code, message: coded.message });
          return { available: false, newer: false, version: null, url: null, error: { code: coded.code, message: coded.message } };
        });
      }

      function installUpdate() {
        if (!lastRelease || !lastRelease.url) return Promise.reject(codedError('no_update', 'check for updates first'));
        const url = lastRelease.url;
        return attempt(function () { return plugin('Browser').open({ url: url }); }).then(function () {
          updateEvents.emit({ type: 'opened', version: lastRelease.version, url: url });
        });
      }

      return { supported: hasPlugin('CapacitorHttp') && hasPlugin('Browser'), check: checkUpdates, install: installUpdate, onStatus: updateEvents.on };
    }
    if (build.channel === 'github' && !isIos) updates = githubUpdates();
    // #end-channel

    // ---- Apple Watch (WorkoutKit) and Apple Health (HealthKit): the app's own Swift plugins, iOS only
    function nativeCall(name, method, args, fallbackCode) {
      return attempt(function () {
        const p = plugin(name);
        if (typeof p[method] !== 'function') throw codedError('unsupported', name + '.' + method + ' is not available');
        return p[method](args || {});
      }).catch(function (error) {
        if (error && error.code === 'unsupported') throw error;
        throw toCodedError(error, fallbackCode);
      });
    }

    function createWatch() {
      if (!isIos || !hasPlugin('VeyvoWorkoutKit')) return unsupportedWatch();
      const major = iosMajorVersion(win.navigator && win.navigator.userAgent);
      // A first guess from the user agent (WorkoutKit needs iOS 17); check() asks the plugin itself.
      const known = { supported: major === null || major >= 17, schedule: major === null || major >= 17 };
      const call = function (method, args) { return nativeCall('VeyvoWorkoutKit', method, args, 'watch_failed'); };
      function payload(workout, options, date) {
        if (!known.supported) throw codedError('watch_unsupported', 'WorkoutKit needs iOS 17');
        return watchPayload(workout, Object.assign({}, isPlainObject(options) ? options : {}, date ? { date: date } : {}));
      }
      return {
        get supported() { return known.supported; },
        get canSchedule() { return known.supported && known.schedule; },
        check: function () {
          return call('isSupported').then(function (r) {
            known.supported = !!(r && r.supported);
            known.schedule = !!(r && r.supported && r.schedule);
            return { supported: known.supported, schedule: known.schedule, maxScheduled: r && Number.isInteger(r.maxScheduled) ? r.maxScheduled : null };
          }, function () {
            known.supported = false;
            known.schedule = false;
            return { supported: false, schedule: false, maxScheduled: null };
          });
        },
        preview: function (workout, options) {
          return attempt(function () { return payload(workout, options, null); })
            .then(function (args) { return call('preview', args); })
            .then(function (r) { return { shown: !(r && r.shown === false) }; });
        },
        schedule: function (workout, date, options) {
          return attempt(function () {
            if (!isDateKey(date)) throw codedError('watch_date', 'date must be YYYY-MM-DD');
            if (!known.schedule) throw codedError('watch_unsupported', 'WorkoutScheduler is not supported');
            return Object.assign(payload(workout, options, date), { hour: WATCH_SCHEDULE_HOUR });
          }).then(function (args) { return call('schedule', args); }).then(function (r) {
            return {
              scheduled: true,
              id: r && typeof r.id === 'string' ? r.id : null,
              date: r && isDateKey(r.date) ? r.date : date,
              replaced: r && Number.isInteger(r.replaced) ? r.replaced : 0
            };
          });
        },
        listScheduled: function () {
          return call('listScheduled').then(function (r) {
            const list = r && Array.isArray(r.workouts) ? r.workouts : [];
            return list.filter(isPlainObject).map(function (w) {
              return {
                id: typeof w.id === 'string' ? w.id : null,
                date: isDateKey(w.date) ? w.date : null,
                time: typeof w.time === 'string' && /^\d{2}:\d{2}$/.test(w.time) ? w.time : null,
                name: typeof w.name === 'string' ? cutChars(w.name, 120) : '',
                complete: w.complete === true
              };
            });
          });
        },
        clearScheduled: function () {
          return call('clearScheduled').then(function (r) { return { removed: r && Number.isInteger(r.removed) ? r.removed : 0 }; });
        }
      };
    }

    function createHealth() {
      if (!isIos || !hasPlugin('VeyvoHealth')) return unsupportedHealth();
      const call = function (method, args) { return nativeCall('VeyvoHealth', method, args, 'health_failed'); };
      return {
        supported: true,
        isAvailable: function () {
          return call('isAvailable').then(function (r) { return !!(r && r.available); }, function () { return false; });
        },
        /** Shows the Health permission sheet the first time; later calls resolve at once. */
        requestAuthorization: function () {
          return call('requestAuthorization').then(function (r) { return { requested: !!(r && r.requested) }; });
        },
        /** importRuns({ since: ISO }) -> rows for VeyvoStore.importHealthRuns (running workouts that started at or after since). */
        importRuns: function (options) {
          return attempt(function () {
            const since = isPlainObject(options) && typeof options.since === 'string' ? options.since : '';
            const ms = Date.parse(since);
            if (!Number.isFinite(ms)) throw codedError('invalid_request', 'since must be an ISO date');
            return { since: new Date(ms).toISOString(), limit: HEALTH_MAX_ROWS };
          }).then(function (args) { return call('importRuns', args); }).then(function (r) {
            const rows = r && Array.isArray(r.runs) ? r.runs : [];
            return rows.filter(isPlainObject).slice(0, HEALTH_MAX_ROWS);
          });
        }
      };
    }

    return {
      kind: kind,
      build: build,
      supports: Object.freeze({
        saveFile: hasPlugin('Filesystem'), share: hasPlugin('Share'), showInFolder: false, http: hasPlugin('CapacitorHttp'),
        secrets: hasPlugin('Preferences'), encryptedSecrets: false, backup: hasPlugin('Filesystem'),
        updates: updates.supported, strava: false, garmin: false, notify: false, titleBar: hasPlugin('SystemBars'),
        watch: isIos && hasPlugin('VeyvoWorkoutKit'), health: isIos && hasPlugin('VeyvoHealth')
      }),
      watch: createWatch(),
      health: createHealth(),
      version: version,
      saveFile: saveFile,
      showInFolder: function () { return Promise.resolve(false); },
      openExternal: function (url) {
        return attempt(function () { return checkExternalUrl(url); }).then(function (href) {
          return plugin('Browser').open({ url: href });
        }).then(noop);
      },
      http: http,
      secrets: {
        supported: hasPlugin('Preferences'),
        encrypted: false,
        get: function (name) {
          return attempt(function () { checkSecretName(name); return plugin('Preferences').get({ key: SECRET_PREFIX + name }); })
            .then(function (r) { return r && typeof r.value === 'string' ? r.value : null; });
        },
        set: function (name, value) {
          return attempt(function () {
            checkSecretName(name); checkSecretValue(value);
            return plugin('Preferences').set({ key: SECRET_PREFIX + name, value: value });
          }).then(noop);
        },
        remove: function (name) {
          return attempt(function () { checkSecretName(name); return plugin('Preferences').remove({ key: SECRET_PREFIX + name }); }).then(noop);
        }
      },
      backup: { supported: hasPlugin('Filesystem'), snapshot: snapshot, list: listBackups, read: readBackup },
      updates: updates,
      strava: unsupportedStrava(),
      garmin: unsupportedGarmin(),
      // Status and navigation bar icons follow the app theme, not the phone's light/dark setting
      // (Capacitor SystemBars; otherwise dark icons sit on the dark app bar in a light-mode phone).
      setTitleBarTheme: function (theme) {
        const style = systemBarsStyle(theme);
        if (!style || !hasPlugin('SystemBars') || typeof plugins().SystemBars.setStyle !== 'function') return;
        Promise.resolve().then(function () { return plugins().SystemBars.setStyle({ style: style }); }).catch(noop);
      },
      notify: function (message) {
        return attempt(function () { checkNotification(message); return { shown: false }; });
      }
    };
  }

  // ---------------------------------------------------------------- web fallback

  function createWeb(win) {
    const w = win && typeof win === 'object' ? win : null;
    const memorySecrets = {};
    const build = buildInfo(w);
    const hosts = httpHostsFor(build.channel);
    return {
      kind: 'web',
      build: build,
      supports: Object.freeze({
        saveFile: Boolean(w && w.document && w.URL && typeof w.Blob === 'function'), share: false, showInFolder: false,
        http: false, secrets: true, encryptedSecrets: false, backup: false, updates: false, strava: false,
        garmin: false, notify: false, titleBar: false, watch: false, health: false
      }),
      watch: unsupportedWatch(),
      health: unsupportedHealth(),
      version: function () { return Promise.resolve(WEB_VERSION); },
      saveFile: function (file) {
        return attempt(function () {
          const prepared = prepareFile(file);
          const doc = w && w.document;
          if (!doc || !doc.body || typeof w.Blob !== 'function' || !w.URL || typeof w.URL.createObjectURL !== 'function') {
            throw codedError('unsupported', 'downloads are not available');
          }
          const blob = new w.Blob([prepared.data], { type: prepared.mime });
          const href = w.URL.createObjectURL(blob);
          const link = doc.createElement('a');
          link.href = href;
          link.download = prepared.name;
          link.rel = 'noopener';
          link.style.display = 'none';
          doc.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(function () { try { w.URL.revokeObjectURL(href); } catch (error) { /* already gone */ } }, 1000);
          return { saved: true };
        });
      },
      showInFolder: function () { return Promise.resolve(false); },
      openExternal: function (url) {
        return attempt(function () {
          const href = checkExternalUrl(url);
          if (!w || typeof w.open !== 'function') throw codedError('unsupported', 'cannot open links');
          w.open(href, '_blank', 'noopener,noreferrer');
        });
      },
      http: function (request) {
        return attempt(function () { normalizeHttpRequest(request, { hosts: hosts }); }).then(function () { return unsupported('http'); });
      },
      secrets: {
        supported: true,
        encrypted: false,
        get: function (name) {
          return attempt(function () {
            checkSecretName(name);
            return Object.prototype.hasOwnProperty.call(memorySecrets, name) ? memorySecrets[name] : null;
          });
        },
        set: function (name, value) {
          return attempt(function () { checkSecretName(name); checkSecretValue(value); memorySecrets[name] = value; });
        },
        remove: function (name) {
          return attempt(function () { checkSecretName(name); delete memorySecrets[name]; });
        }
      },
      backup: {
        supported: false,
        snapshot: function (json) { return attempt(function () { checkBackupJson(json); return { path: null }; }); },
        list: function () { return Promise.resolve([]); },
        read: function () { return unsupported('backups'); }
      },
      updates: unsupportedUpdates(),
      strava: unsupportedStrava(),
      garmin: unsupportedGarmin(),
      setTitleBarTheme: noop,
      notify: function (message) {
        return attempt(function () { checkNotification(message); return { shown: false }; });
      }
    };
  }

  // ---------------------------------------------------------------- detection

  /**
   * 'desktop' when window.veyvo.saveFile exists, 'android' / 'ios' inside a native Capacitor shell
   * (Capacitor.getPlatform()), else 'web'.
   */
  function detect(win) {
    if (!win || (typeof win !== 'object' && typeof win !== 'function')) return 'web';
    try {
      if (win.veyvo && typeof win.veyvo.saveFile === 'function') return 'desktop';
      const cap = win.Capacitor;
      if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && typeof cap.getPlatform === 'function') {
        const platform = cap.getPlatform();
        if (platform === 'android' || platform === 'ios') return platform;
      }
    } catch (error) { /* a broken bridge is treated as no bridge */ }
    return 'web';
  }

  function create(win) {
    const kind = detect(win);
    if (kind === 'desktop') return createDesktop(win);
    if (kind === 'android' || kind === 'ios') return createCapacitor(win, kind);
    return createWeb(win);
  }

  const util = Object.freeze({
    CHANNELS: CHANNELS,
    HTTP_HOSTS: HTTP_HOSTS,
    STORE_HTTP_HOSTS: STORE_HTTP_HOSTS,
    buildInfo: buildInfo,
    httpHostsFor: httpHostsFor,
    HTTP_METHODS: HTTP_METHODS,
    HTTP_TIMEOUT_MS: HTTP_TIMEOUT_MS,
    MAX_HTTP_RESPONSE_BYTES: MAX_HTTP_RESPONSE_BYTES,
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_FIT_BYTES: MAX_FIT_BYTES,
    MAX_BACKUP_CHARS: MAX_BACKUP_CHARS,
    MAX_SECRET_CHARS: MAX_SECRET_CHARS,
    BACKUP_KEEP: BACKUP_KEEP,
    SAFETY_KEEP: SAFETY_KEEP,
    SAFETY_KINDS: SAFETY_KINDS,
    WEB_VERSION: WEB_VERSION,
    // #if-channel github
    RELEASES_LATEST_URL: RELEASES_LATEST_URL,
    RELEASE_DOWNLOAD_PREFIX: RELEASE_DOWNLOAD_PREFIX,
    releaseInfo: releaseInfo,
    updateCheckCounts: updateCheckCounts,
    restoredUpdateStatus: restoredUpdateStatus,
    // #end-channel
    codedError: codedError,
    toCodedError: toCodedError,
    isAllowedHttpUrl: isAllowedHttpUrl,
    isExternalUrl: isExternalUrl,
    normalizeHttpRequest: normalizeHttpRequest,
    responseFrom: responseFrom,
    sanitizeFileName: sanitizeFileName,
    fileExtension: fileExtension,
    ensureExtension: ensureExtension,
    prepareFile: prepareFile,
    prepareFitFile: prepareFitFile,
    isBlockedFileName: isBlockedFileName,
    BLOCKED_EXTENSIONS: BLOCKED_EXTENSIONS,
    toBytes: toBytes,
    bytesToBase64: bytesToBase64,
    looksLikeFit: looksLikeFit,
    parseVersion: parseVersion,
    compareVersions: compareVersions,
    isNewerVersion: isNewerVersion,
    isSecretName: isSecretName,
    isDateKey: isDateKey,
    dateKeyOf: dateKeyOf,
    timeKeyOf: timeKeyOf,
    backupFileName: backupFileName,
    backupInfo: backupInfo,
    safetyBackupName: safetyBackupName,
    snapshotKind: snapshotKind,
    isBackupFileName: isBackupFileName,
    sortBackupNames: sortBackupNames,
    backupsToPrune: backupsToPrune,
    isHexColor: isHexColor,
    isDarkColor: isDarkColor,
    systemBarsStyle: systemBarsStyle,
    WATCH_SCHEDULE_HOUR: WATCH_SCHEDULE_HOUR,
    HEALTH_MAX_ROWS: HEALTH_MAX_ROWS,
    iosMajorVersion: iosMajorVersion,
    watchPayload: watchPayload
  });

  const api = create(root.window);
  api.create = create;
  api.detect = detect;
  api.util = util;
  api.MESSAGES = MESSAGES;
  api.STORE_MESSAGES = STORE_MESSAGES;
  api.messagesFor = messagesFor;
  api.registerMessages = registerMessages;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VeyvoPlatform = api;
})(globalThis);
