const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.TZ = 'Europe/Prague';
// platform.js reads globalThis.window when it loads; a bare object means "plain browser".
globalThis.window = {};
const Platform = require('../src/platform.js');
const U = Platform.util;

const FIT_HEADER = [14, 0x10, 0xd9, 0x08, 0x20, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
function fitBytes(extra = 4) { return new Uint8Array([...FIT_HEADER, ...new Array(extra).fill(1)]); }
async function rejectsWith(promise, code) {
  await assert.rejects(promise, error => { assert.equal(error.code, code, error.message); return true; });
}
function throwsWith(fn, code) {
  assert.throws(fn, error => { assert.equal(error.code, code, error.message); return true; });
}

// ---------------------------------------------------------------- module shape

test('loads in Node as the web adapter with the full VeyvoPlatform shape', async () => {
  assert.equal(Platform.kind, 'web');
  for (const name of ['version', 'saveFile', 'showInFolder', 'openExternal', 'http', 'setTitleBarTheme', 'notify', 'create', 'detect']) {
    assert.equal(typeof Platform[name], 'function', name);
  }
  for (const [ns, methods] of Object.entries({
    secrets: ['get', 'set', 'remove'], backup: ['snapshot', 'list', 'read'], updates: ['check', 'install', 'onStatus'],
    strava: ['status', 'connect', 'sync', 'disconnect', 'onEvent'], garmin: ['findDrives', 'copy']
  })) {
    assert.equal(typeof Platform[ns].supported, 'boolean', ns + '.supported');
    for (const method of methods) assert.equal(typeof Platform[ns][method], 'function', ns + '.' + method);
  }
  assert.deepEqual(Object.keys(Platform.supports).sort(), ['backup', 'encryptedSecrets', 'garmin', 'http', 'notify', 'saveFile', 'secrets', 'share', 'showInFolder', 'strava', 'titleBar', 'updates']);
  assert.ok(Object.isFrozen(Platform.supports));
  assert.ok(Object.isFrozen(U));
  assert.equal(await Platform.version(), '0.0.0-web');
});

test('detect: desktop needs window.veyvo.saveFile, android needs a native Capacitor Android shell', () => {
  assert.equal(Platform.detect(undefined), 'web');
  assert.equal(Platform.detect({}), 'web');
  assert.equal(Platform.detect({ veyvo: { version() {} } }), 'web', 'the 0.3 preload without saveFile is not a 0.4 desktop');
  assert.equal(Platform.detect({ veyvo: { saveFile() {} } }), 'desktop');
  assert.equal(Platform.detect({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }), 'android');
  assert.equal(Platform.detect({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }), 'web');
  assert.equal(Platform.detect({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }), 'web');
  assert.equal(Platform.detect({ Capacitor: { isNativePlatform() { throw new Error('broken'); } } }), 'web');
});

// ---------------------------------------------------------------- http allowlist

test('http allowlist: only https intervals.icu and api.github.com on the default port', () => {
  assert.deepEqual([...U.HTTP_HOSTS], ['intervals.icu', 'api.github.com']);
  for (const url of [
    'https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true',
    'https://api.github.com/repos/PepiBikerBTW/VEYVO/releases/latest',
    'https://INTERVALS.ICU/api/v1/athlete/0',
    'https://intervals.icu:443/api/v1/athlete/0'
  ]) assert.equal(U.isAllowedHttpUrl(url), true, url);
  for (const url of [
    'http://intervals.icu/api/v1/athlete/0',
    'https://intervals.icu.evil.com/',
    'https://evil.com/intervals.icu',
    'https://evil.com/?u=https://intervals.icu',
    'https://user:pw@intervals.icu/',
    'https://api.github.com@evil.com/',
    'https://evil.com#@intervals.icu',
    'https://intervals.icu:8443/',
    'https://www.intervals.icu/',
    'https://intervals.icu./',
    'https://github.com/PepiBikerBTW/VEYVO',
    'https://www.strava.com/api/v3/athlete',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'intervals.icu/api',
    '', null, undefined, 42, {}
  ]) assert.equal(U.isAllowedHttpUrl(url), false, String(url));
  assert.equal(U.isAllowedHttpUrl('https://intervals.icu/' + 'a'.repeat(5000)), false, 'very long urls are refused');
});

test('external links: http and https only, no credentials', () => {
  assert.equal(U.isExternalUrl('https://intervals.icu/settings'), true);
  assert.equal(U.isExternalUrl('http://example.com/page'), true);
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows/system32/calc.exe', 'ms-settings:privacy', 'mailto:a@b.cz',
    'https://user:pw@example.com', 'data:text/html,hi', 'vbscript:x', '', null]) {
    assert.equal(U.isExternalUrl(url), false, String(url));
  }
});

test('normalizeHttpRequest validates method, headers and body', () => {
  assert.deepEqual(U.normalizeHttpRequest({ url: 'https://intervals.icu/api/v1/athlete/0' }),
    { url: 'https://intervals.icu/api/v1/athlete/0', method: 'GET', headers: {} });
  const post = U.normalizeHttpRequest({ url: 'https://intervals.icu/api/v1/x', method: 'post', headers: { Authorization: 'Basic abc' }, body: [{ a: 1 }] });
  assert.equal(post.method, 'POST');
  assert.equal(post.body, '[{"a":1}]');
  assert.equal(post.headers['Content-Type'], 'application/json');
  const keepType = U.normalizeHttpRequest({ url: 'https://intervals.icu/x', method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'hi' });
  assert.deepEqual(keepType.headers, { 'content-type': 'text/plain' });
  assert.equal(keepType.body, 'hi');
  assert.equal('body' in U.normalizeHttpRequest({ url: 'https://intervals.icu/x', method: 'POST', body: '' }), false);
  assert.equal(U.normalizeHttpRequest({ url: 'https://intervals.icu/x', headers: { 'X-Count': 3 } }).headers['X-Count'], '3');

  throwsWith(() => U.normalizeHttpRequest({ url: 'https://evil.com/' }), 'host_not_allowed');
  throwsWith(() => U.normalizeHttpRequest({ url: 'http://intervals.icu/' }), 'host_not_allowed');
  throwsWith(() => U.normalizeHttpRequest({ url: 'not a url' }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest(null), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest('https://intervals.icu/'), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', method: 'TRACE' }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', method: 'GET', body: 'x' }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', headers: { Host: 'evil.com' } }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', headers: { 'Proxy-Authorization': 'x' } }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', headers: { 'X-A': 'a\r\nX-B: b' } }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', headers: { 'Bad Name': 'x' } }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', headers: { 'X-A': { nested: true } } }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', headers: { Accept: 'a', accept: 'b' } }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', headers: ['x'] }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', method: 'POST', body: 12 }), 'invalid_request');
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', method: 'POST', body: 'x'.repeat(5 * 1024 * 1024 + 1) }), 'too_large');
});

test('responseFrom builds { status, ok, text, json, headers }', () => {
  assert.deepEqual(U.responseFrom({ status: 200, text: '[{"id":1}]', headers: { 'Retry-After': '5' } }),
    { status: 200, ok: true, text: '[{"id":1}]', json: [{ id: 1 }], headers: { 'retry-after': '5' } });
  assert.deepEqual(U.responseFrom({ status: 401, text: 'nope' }), { status: 401, ok: false, text: 'nope', json: null, headers: {} });
  assert.deepEqual(U.responseFrom({ status: 204, text: '' }), { status: 204, ok: true, text: '', json: null, headers: {} });
  assert.equal(U.responseFrom({ status: 302, text: '' }).ok, false, 'redirects are not followed, so they are not ok');
  assert.deepEqual(U.responseFrom(null), { status: 0, ok: false, text: '', json: null, headers: {} });
  assert.deepEqual(U.responseFrom({ status: 200, text: '{"a":1}', json: { a: 2 } }).json, { a: 2 }, 'a parsed body from the bridge wins');
});

test('toCodedError keeps the code through Electron IPC messages', () => {
  const error = U.toCodedError(new Error("Error invoking remote method 'file-save': Error: [invalid_name] bad name"));
  assert.equal(error.code, 'invalid_name');
  assert.equal(error.message, 'bad name');
  assert.equal(U.toCodedError(new Error('boom'), 'network').code, 'network');
  assert.equal(U.toCodedError(Object.assign(new Error('x'), { code: 'timeout' })).code, 'timeout');
  assert.equal(U.toCodedError(Object.assign(new Error('x'), { code: 'ENOENT' }), 'not_found').code, 'not_found');
  assert.equal(U.toCodedError('plain text').message, 'plain text');
});

// ---------------------------------------------------------------- file names

test('sanitizeFileName keeps Czech names readable and safe on Windows', () => {
  assert.equal(U.sanitizeFileName('Lehký běh – út 24. 11.fit'), 'Lehký běh – út 24. 11.fit');
  assert.equal(U.sanitizeFileName('Záloha VEYVO 27. 11. 2026.json'), 'Záloha VEYVO 27. 11. 2026.json');
  assert.equal(U.sanitizeFileName('Be\u030Ch.txt'), 'Běh.txt', 'decomposed diacritics are composed (NFC)');
  assert.equal(U.sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(U.sanitizeFileName('C:\\Users\\pepa\\plan.zwo'), 'plan.zwo');
  assert.equal(U.sanitizeFileName('a<b>:c"d|e?f*g.txt'), 'a-b--c-d-e-f-g.txt');
  assert.equal(U.sanitizeFileName('tab\there\nnew.txt'), 'tabherenew.txt');
  assert.equal(U.sanitizeFileName('run\u202Etxt.exe'), 'runtxt.exe', 'bidi overrides cannot disguise the extension');
  assert.equal(U.sanitizeFileName('  .hidden. '), 'hidden');
  assert.equal(U.sanitizeFileName('plan  .  fit'), 'plan . fit');
  assert.equal(U.sanitizeFileName('CON.txt'), '_CON.txt');
  assert.equal(U.sanitizeFileName('nul'), '_nul');
  assert.equal(U.sanitizeFileName('com1.fit'), '_com1.fit');
  assert.equal(U.sanitizeFileName('con.tar.gz'), '_con.tar.gz');
  assert.equal(U.sanitizeFileName('console.txt'), 'console.txt');
  assert.equal(U.sanitizeFileName(''), 'veyvo-export');
  assert.equal(U.sanitizeFileName(null), 'veyvo-export');
  assert.equal(U.sanitizeFileName({}), 'veyvo-export');
  assert.equal(U.sanitizeFileName('...', { fallback: 'trenink' }), 'trenink');
  const long = U.sanitizeFileName('Běh '.repeat(80) + '.fit');
  assert.ok(Array.from(long).length <= 120, long);
  assert.ok(long.endsWith('.fit'));
  assert.equal(U.sanitizeFileName('😀'.repeat(200) + '.txt', { maxLength: 20 }), '😀'.repeat(16) + '.txt', 'surrogate pairs are not split');
});

test('sanitizeFileName ascii mode for Garmin watches', () => {
  assert.equal(U.sanitizeFileName('Lehký běh – út 24. 11.fit', { ascii: true }), 'Lehky-beh-ut-24.-11.fit');
  assert.equal(U.sanitizeFileName('Intervaly 6×400 m.FIT', { ascii: true }), 'Intervaly-6-400-m.FIT');
  assert.equal(U.sanitizeFileName('Žluťoučký kůň.fit', { ascii: true }), 'Zlutoucky-kun.fit');
  assert.equal(U.sanitizeFileName('???.fit', { ascii: true, fallback: 'veyvo-workout' }), 'veyvo-workout.fit');
  assert.match(U.sanitizeFileName('Tempo 3 × 2 km', { ascii: true }), /^[A-Za-z0-9._-]+$/);
});

test('file extensions and mime defaults', () => {
  assert.equal(U.fileExtension('Plan.FIT'), 'fit');
  assert.equal(U.fileExtension('a.workout'), 'workout');
  assert.equal(U.fileExtension('notes'), '');
  assert.equal(U.fileExtension('.bashrc'), '');
  assert.equal(U.fileExtension('trailing.'), '');
  assert.equal(U.ensureExtension('zaloha', 'application/json'), 'zaloha.json');
  assert.equal(U.ensureExtension('plan', 'application/vnd.ant.fit'), 'plan.fit');
  assert.equal(U.ensureExtension('plan', 'text/plain; charset=utf-8'), 'plan.txt');
  assert.equal(U.ensureExtension('plan.zwo', 'application/xml'), 'plan.zwo');
  assert.equal(U.ensureExtension('plan', 'application/x-unknown'), 'plan');
  assert.equal(U.ensureExtension('Záloha 27.11', 'application/json'), 'Záloha 27.11.json', 'digits after a dot are a date, not an extension');
  assert.equal(U.ensureExtension('archive.7z', 'application/json'), 'archive.7z');
});

test('prepareFile sanitizes names, keeps strings and converts binary views', () => {
  assert.deepEqual(U.prepareFile({ name: '', mime: 'application/json', data: '{}' }), { name: 'veyvo-export.json', mime: 'application/json', data: '{}' });
  const bytes = U.prepareFile({ name: '../Tempo.fit', mime: 'application/vnd.ant.fit', data: new Uint8Array([1, 2, 3]).buffer });
  assert.equal(bytes.name, 'Tempo.fit');
  assert.ok(bytes.data instanceof Uint8Array);
  assert.deepEqual([...bytes.data], [1, 2, 3]);
  const view = U.prepareFile({ name: 'a.bin', data: new Uint16Array([0x0201]) });
  assert.equal(view.mime, 'application/octet-stream');
  assert.equal(view.data.byteLength, 2);
  assert.equal(U.prepareFile({ name: 'a.txt', mime: 'not a mime', data: 'x' }).mime, 'application/octet-stream');
  throwsWith(() => U.prepareFile({ name: 'a.txt', data: 12 }), 'invalid_data');
  throwsWith(() => U.prepareFile({ name: 'a.txt', data: [1, 2] }), 'invalid_data');
  throwsWith(() => U.prepareFile(null), 'invalid_data');
  throwsWith(() => U.prepareFile({ name: 'big.bin', data: new Uint8Array(50 * 1024 * 1024 + 1) }), 'too_large');
});

test('bytes and base64', () => {
  assert.deepEqual([...U.toBytes('Běh')], [0x42, 0xc4, 0x9b, 0x68]);
  assert.equal(U.bytesToBase64(new Uint8Array([0, 255, 128])), 'AP+A');
  assert.equal(U.bytesToBase64('Běh'), Buffer.from('Běh').toString('base64'));
  const big = new Uint8Array(100000).map((_, i) => i % 256);
  assert.equal(U.bytesToBase64(big), Buffer.from(big).toString('base64'), 'chunked encoding matches');
});

test('FIT detection and Garmin file preparation', () => {
  assert.equal(U.looksLikeFit(fitBytes()), true);
  assert.equal(U.looksLikeFit(new Uint8Array([12, 0x10, 0, 0, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0])), true, '12-byte header');
  assert.equal(U.looksLikeFit(new Uint8Array(20)), false);
  assert.equal(U.looksLikeFit('.FIT'), false);
  assert.equal(U.looksLikeFit(null), false);
  const fit = U.prepareFitFile('Lehký běh út.FIT', fitBytes());
  assert.equal(fit.name, 'Lehky-beh-ut.fit');
  assert.ok(fit.data instanceof Uint8Array);
  assert.equal(U.prepareFitFile('Tempo', fitBytes()).name, 'Tempo.fit', '.fit is added when missing');
  assert.equal(U.prepareFitFile('', fitBytes()).name, 'veyvo-workout.fit');
  throwsWith(() => U.prepareFitFile('plan.zwo', fitBytes()), 'not_fit');
  throwsWith(() => U.prepareFitFile('plan.fit', new Uint8Array(30)), 'not_fit');
  throwsWith(() => U.prepareFitFile('plan.fit', 'text'), 'not_fit');
  throwsWith(() => U.prepareFitFile('plan.fit', fitBytes(1024 * 1024)), 'too_large');
});

// ---------------------------------------------------------------- versions

test('compareVersions follows semver', () => {
  assert.equal(U.compareVersions('0.4.0', '0.3.11'), 1);
  assert.equal(U.compareVersions('0.3.10', '0.3.9'), 1, 'numeric, not text order');
  assert.equal(U.compareVersions('0.3.9', '0.3.10'), -1);
  assert.equal(U.compareVersions('v0.4.0', '0.4.0'), 0);
  assert.equal(U.compareVersions('0.4', '0.4.0'), 0);
  assert.equal(U.compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(U.compareVersions('0.4.0-beta.2', '0.4.0'), -1, 'a prerelease is older than its release');
  assert.equal(U.compareVersions('0.4.0', '0.4.0-rc.1'), 1);
  assert.equal(U.compareVersions('0.4.0-beta.2', '0.4.0-beta.10'), -1);
  assert.equal(U.compareVersions('0.4.0-alpha', '0.4.0-beta'), -1);
  assert.equal(U.compareVersions('1.0.0-1', '1.0.0-alpha'), -1, 'numeric identifiers sort first');
  assert.equal(U.compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1, 'shorter prerelease sorts first');
  assert.equal(U.compareVersions('1.0.0+build.5', '1.0.0'), 0, 'build metadata is ignored');
  assert.equal(U.compareVersions('0.0.0-web', '0.3.11'), -1);
  assert.equal(U.compareVersions(' 0.4.1 ', '0.4.0'), 1);
  for (const bad of ['', 'latest', '1', '1.2.3.4', 'v', '01.x.2', null, undefined, 4]) assert.equal(U.compareVersions(bad, '0.4.0'), null, String(bad));
  assert.equal(U.isNewerVersion('0.4.1', '0.4.0'), true);
  assert.equal(U.isNewerVersion('0.4.0', '0.4.0'), false);
  assert.equal(U.isNewerVersion('nonsense', '0.4.0'), false);
  assert.deepEqual(U.parseVersion('v1.2.3-beta.4'), { major: 1, minor: 2, patch: 3, prerelease: ['beta', '4'] });
});

const RELEASE = {
  tag_name: 'v0.4.1', draft: false, prerelease: false,
  html_url: 'https://github.com/PepiBikerBTW/VEYVO/releases/tag/v0.4.1',
  published_at: '2026-12-01T18:00:00Z',
  assets: [
    { name: 'VEYVO-Setup-0.4.1-x64.exe', browser_download_url: 'https://github.com/PepiBikerBTW/VEYVO/releases/download/v0.4.1/VEYVO-Setup-0.4.1-x64.exe' },
    { name: 'VEYVO-0.4.1-debug.apk', browser_download_url: 'https://github.com/PepiBikerBTW/VEYVO/releases/download/v0.4.1/VEYVO-0.4.1-debug.apk' },
    { name: 'VEYVO-0.4.1.apk', browser_download_url: 'https://github.com/PepiBikerBTW/VEYVO/releases/download/v0.4.1/VEYVO-0.4.1.apk' },
    { name: 'evil.apk', browser_download_url: 'https://evil.example/VEYVO.apk' }
  ]
};

test('releaseInfo picks the release .apk from the VEYVO repository', () => {
  assert.deepEqual(U.releaseInfo(RELEASE, '0.4.0'), {
    available: true, newer: true, version: '0.4.1',
    url: 'https://github.com/PepiBikerBTW/VEYVO/releases/download/v0.4.1/VEYVO-0.4.1.apk',
    pageUrl: 'https://github.com/PepiBikerBTW/VEYVO/releases/tag/v0.4.1',
    publishedAt: '2026-12-01T18:00:00Z'
  });
  assert.equal(U.releaseInfo(RELEASE, '0.4.1').available, false, 'same version');
  assert.equal(U.releaseInfo(RELEASE, '0.5.0').newer, false);
  const noApk = U.releaseInfo({ ...RELEASE, assets: RELEASE.assets.slice(0, 1) }, '0.4.0');
  assert.equal(noApk.newer, true);
  assert.equal(noApk.available, false, 'a newer Windows-only release is not installable on Android');
  assert.equal(noApk.url, null);
  const foreign = U.releaseInfo({ ...RELEASE, assets: [RELEASE.assets[3]] }, '0.4.0');
  assert.equal(foreign.url, null, 'assets from other hosts are ignored');
  assert.equal(U.releaseInfo({ ...RELEASE, draft: true }, '0.4.0').available, false);
  assert.equal(U.releaseInfo({ ...RELEASE, prerelease: true }, '0.4.0').available, false);
  assert.equal(U.releaseInfo({ ...RELEASE, tag_name: 'latest' }, '0.4.0').available, false);
  assert.equal(U.releaseInfo({ ...RELEASE, html_url: 'https://evil.example/' }, '0.4.0').pageUrl, null);
  assert.equal(U.releaseInfo(null, '0.4.0').available, false);
  assert.equal(U.releaseInfo(RELEASE, '0.0.0-web').available, true);
});

// ---------------------------------------------------------------- secrets, dates, backups

test('secret names are limited to [a-z0-9-]{1,40}', () => {
  for (const name of ['intervals-api-key', 'a', '0', 'x'.repeat(40)]) assert.equal(U.isSecretName(name), true, name);
  for (const name of ['', 'Intervals', 'a_b', 'a.b', '../x', 'x'.repeat(41), 'klíč', ' a', null, 5, '__proto__']) {
    assert.equal(U.isSecretName(name), false, String(name));
  }
});

test('backup names, local dates and pruning to the newest 14', () => {
  assert.equal(U.dateKeyOf(new Date(2026, 10, 27, 23, 59)), '2026-11-27');
  assert.equal(U.dateKeyOf(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  assert.equal(U.dateKeyOf(new Date('2026-03-29T00:30:00+01:00')), '2026-03-29', 'local date across the spring DST switch');
  assert.equal(U.dateKeyOf(new Date('nope')), null);
  assert.equal(U.dateKeyOf('2026-11-27'), null);
  assert.equal(U.backupFileName('2026-11-27'), 'veyvo-2026-11-27.json');
  assert.equal(U.backupFileName('2026-02-29'), null);
  assert.equal(U.backupFileName('2028-02-29'), 'veyvo-2028-02-29.json');
  assert.equal(U.backupFileName('2026-13-01'), null);
  assert.equal(U.backupFileName('../x'), null);
  assert.equal(U.isBackupFileName('veyvo-2026-11-27.json'), true);
  for (const name of ['veyvo-2026-11-31.json', 'veyvo-2026-11-27.json.tmp', '../veyvo-2026-11-27.json', 'veyvo-backup-2026-11-27.json', 'VEYVO-2026-11-27.json', '', null]) {
    assert.equal(U.isBackupFileName(name), false, String(name));
  }
  const names = [];
  for (let day = 1; day <= 16; day++) names.push('veyvo-2026-11-' + String(day).padStart(2, '0') + '.json');
  const shuffled = [names[5], 'secrets.json', ...names.slice(10), 'veyvo-2026-11-03.json.123.tmp', ...names.slice(0, 10), names[0]];
  assert.deepEqual(U.backupsToPrune(shuffled), ['veyvo-2026-11-02.json', 'veyvo-2026-11-01.json']);
  assert.deepEqual(U.backupsToPrune(names.slice(0, 14)), []);
  assert.deepEqual(U.backupsToPrune(names, 15), ['veyvo-2026-11-01.json']);
  assert.equal(U.sortBackupNames(shuffled)[0], 'veyvo-2026-11-16.json');
  assert.equal(U.sortBackupNames(shuffled).length, 16);
  assert.deepEqual(U.sortBackupNames(['veyvo-2027-01-01.json', 'veyvo-2026-12-31.json']), ['veyvo-2027-01-01.json', 'veyvo-2026-12-31.json'], 'year rollover');
});

test('title bar colors', () => {
  for (const color of ['#fff', '#0e0f11', '#FF6A1A', '#80ff6a1a']) assert.equal(U.isHexColor(color), true, color);
  for (const color of ['fff', '#ffff', 'red', 'rgb(0,0,0)', '#12345g', '', null]) assert.equal(U.isHexColor(color), false, String(color));
});

test('messages exist in Czech and English for the same error codes', () => {
  const cs = Object.keys(Platform.MESSAGES.cs.error).sort();
  assert.deepEqual(Object.keys(Platform.MESSAGES.en.error).sort(), cs);
  for (const code of ['unsupported', 'host_not_allowed', 'timeout', 'network', 'drive_not_found', 'not_fit', 'encryption_unavailable']) assert.ok(cs.includes(code), code);
  let registered = null;
  assert.equal(Platform.registerMessages({ register: (ns, dict) => { registered = [ns, dict]; } }), true);
  assert.equal(registered[0], 'platform');
  assert.equal(Platform.registerMessages(null), false);
});

// ---------------------------------------------------------------- web fallback behaviour

function fakeDocument() {
  const clicks = [];
  const appended = [];
  const document = {
    body: { appendChild(node) { appended.push(node); node.parent = this; } },
    createElement(tag) {
      return { tag, style: {}, click() { clicks.push({ href: this.href, download: this.download }); }, remove() { this.removed = true; } };
    }
  };
  return { document, clicks, appended };
}

test('web fallback: download via <a download>, in-memory secrets, everything else unsupported', async () => {
  const dom = fakeDocument();
  const blobs = [];
  const revoked = [];
  const opened = [];
  const win = {
    document: dom.document,
    Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; blobs.push(this); } },
    URL: { createObjectURL: () => 'blob:veyvo/1', revokeObjectURL: url => revoked.push(url) },
    open: (...args) => opened.push(args)
  };
  const web = Platform.create(win);
  assert.equal(web.kind, 'web');
  assert.equal(web.supports.saveFile, true);
  assert.deepEqual(await web.saveFile({ name: 'Záloha: 27. 11.', mime: 'application/json', data: '{"a":1}' }), { saved: true });
  assert.deepEqual(dom.clicks, [{ href: 'blob:veyvo/1', download: 'Záloha- 27. 11.json' }]);
  assert.equal(blobs[0].type, 'application/json');
  assert.equal(dom.appended[0].removed, true, 'the temporary link is removed again');

  await web.openExternal('https://intervals.icu/settings');
  assert.deepEqual(opened, [['https://intervals.icu/settings', '_blank', 'noopener,noreferrer']]);
  await rejectsWith(web.openExternal('javascript:alert(1)'), 'invalid_url');

  await rejectsWith(web.http({ url: 'https://intervals.icu/api/v1/athlete/0' }), 'unsupported');
  await rejectsWith(web.http({ url: 'https://evil.com/' }), 'host_not_allowed');

  assert.equal(web.secrets.encrypted, false);
  assert.equal(await web.secrets.get('intervals-api-key'), null);
  await web.secrets.set('intervals-api-key', 'abc123');
  assert.equal(await web.secrets.get('intervals-api-key'), 'abc123');
  await web.secrets.remove('intervals-api-key');
  assert.equal(await web.secrets.get('intervals-api-key'), null);
  assert.equal(await web.secrets.get('__proto__').catch(e => e.code), 'invalid_name');
  await rejectsWith(web.secrets.set('BAD NAME', 'x'), 'invalid_name');
  await rejectsWith(web.secrets.set('ok', 5), 'invalid_data');

  assert.deepEqual(await web.backup.snapshot('{"app":"VEYVO"}'), { path: null });
  await rejectsWith(web.backup.snapshot('not json'), 'invalid_data');
  assert.deepEqual(await web.backup.list(), []);
  await rejectsWith(web.backup.read('veyvo-2026-11-27.json'), 'unsupported');

  assert.equal(web.updates.supported, false);
  assert.equal((await web.updates.check()).available, false);
  await rejectsWith(web.updates.install(), 'unsupported');
  assert.equal(typeof web.updates.onStatus(() => {}), 'function');
  assert.equal(web.strava.supported, false);
  assert.deepEqual(await web.strava.status(), { connected: false, athlete: null, unsupported: true });
  assert.deepEqual(await web.strava.sync(), []);
  await rejectsWith(web.strava.connect('secret123'), 'unsupported');
  assert.equal(typeof web.strava.onEvent(() => {}), 'function');
  assert.equal(web.garmin.supported, false);
  assert.deepEqual(await web.garmin.findDrives(), []);
  await rejectsWith(web.garmin.copy({ root: 'E:\\', name: 'a.fit', data: fitBytes() }), 'unsupported');
  assert.equal(web.setTitleBarTheme({ color: '#000000', symbolColor: '#ffffff' }), undefined);
  assert.deepEqual(await web.notify({ title: 'Běh', body: 'Dnes' }), { shown: false });
  assert.equal(await web.showInFolder('/tmp/x'), false);
});

test('web fallback without a document reports saveFile as unsupported', async () => {
  const bare = Platform.create(undefined);
  assert.equal(bare.supports.saveFile, false);
  await rejectsWith(bare.saveFile({ name: 'a.txt', data: 'x' }), 'unsupported');
  await rejectsWith(bare.openExternal('https://intervals.icu/'), 'unsupported');
});

// ---------------------------------------------------------------- desktop adapter over a fake preload

function fakeDesktop(overrides = {}) {
  const calls = [];
  const record = (name, result) => (...args) => { calls.push([name, ...args]); return typeof result === 'function' ? result(...args) : Promise.resolve(result); };
  const listeners = {};
  const veyvo = {
    version: record('version', '0.4.0'),
    checkForUpdates: record('checkForUpdates', undefined),
    installUpdate: record('installUpdate', undefined),
    onUpdaterStatus: cb => { listeners.updater = cb; return () => { listeners.updater = null; }; },
    stravaStatus: record('stravaStatus', { connected: true, athlete: null }),
    connectStrava: record('connectStrava', { pending: true }),
    syncStrava: record('syncStrava', []),
    disconnectStrava: record('disconnectStrava', { connected: false }),
    onStravaEvent: cb => { listeners.strava = cb; return () => {}; },
    saveFile: record('saveFile', { saved: true, path: 'C:\\Users\\pepa\\Downloads\\plan.fit' }),
    showItemInFolder: record('showItemInFolder', { shown: true }),
    openExternal: record('openExternal', { opened: true }),
    http: record('http', { status: 200, ok: true, text: '[]', headers: { 'content-type': 'application/json' } }),
    secrets: { get: record('secret.get', 'key-1'), set: record('secret.set', true), remove: record('secret.remove', true) },
    backupSnapshot: record('backupSnapshot', { path: 'C:\\VEYVO\\backups\\veyvo-2026-11-27.json' }),
    listBackups: record('listBackups', [{ name: 'veyvo-2026-11-27.json' }]),
    readBackup: record('readBackup', '{"app":"VEYVO"}'),
    garminFindDrives: record('garminFindDrives', [{ root: 'E:\\', label: 'Forerunner 255 (E:)' }]),
    garminCopy: record('garminCopy', { saved: true, path: 'E:\\GARMIN\\NewFiles\\Tempo.fit' }),
    setTitleBarTheme: record('setTitleBarTheme', { applied: true }),
    notify: record('notify', { shown: true }),
    ...overrides
  };
  return { veyvo, calls, listeners };
}

test('desktop adapter maps every call onto window.veyvo', async () => {
  const fake = fakeDesktop();
  const desktop = Platform.create({ veyvo: fake.veyvo, navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/38.8.6' } });
  assert.equal(desktop.kind, 'desktop');
  assert.equal(desktop.supports.garmin, true);
  assert.equal(desktop.secrets.encrypted, true);
  assert.equal(await desktop.version(), '0.4.0');

  const saved = await desktop.saveFile({ name: 'C:\\x\\Tempo út.fit', mime: 'application/vnd.ant.fit', data: fitBytes() });
  assert.deepEqual(saved, { saved: true, path: 'C:\\Users\\pepa\\Downloads\\plan.fit' });
  const saveCall = fake.calls.find(c => c[0] === 'saveFile');
  assert.equal(saveCall[1].name, 'Tempo út.fit');
  assert.ok(saveCall[1].data instanceof Uint8Array);

  const response = await desktop.http({ url: 'https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true', method: 'POST', body: [{ a: 1 }] });
  assert.deepEqual(response, { status: 200, ok: true, text: '[]', json: [], headers: { 'content-type': 'application/json' } });
  const httpCall = fake.calls.find(c => c[0] === 'http');
  assert.equal(httpCall[1].body, '[{"a":1}]');
  const before = fake.calls.length;
  await rejectsWith(desktop.http({ url: 'https://evil.com/steal' }), 'host_not_allowed');
  assert.equal(fake.calls.length, before, 'a blocked host never reaches the bridge');

  assert.equal(await desktop.secrets.get('intervals-api-key'), 'key-1');
  await desktop.secrets.set('intervals-api-key', 'abc');
  await desktop.secrets.remove('intervals-api-key');
  await rejectsWith(desktop.secrets.get('../strava'), 'invalid_name');
  assert.deepEqual(fake.calls.filter(c => c[0].startsWith('secret.')).map(c => c.slice(0, 3)),
    [['secret.get', 'intervals-api-key'], ['secret.set', 'intervals-api-key', 'abc'], ['secret.remove', 'intervals-api-key']]);

  assert.deepEqual(await desktop.backup.snapshot('{"app":"VEYVO"}'), { path: 'C:\\VEYVO\\backups\\veyvo-2026-11-27.json' });
  await rejectsWith(desktop.backup.snapshot('{broken'), 'invalid_data');
  assert.equal((await desktop.backup.list()).length, 1);
  assert.equal(await desktop.backup.read('veyvo-2026-11-27.json'), '{"app":"VEYVO"}');
  await rejectsWith(desktop.backup.read('..\\secrets.json'), 'invalid_name');

  assert.deepEqual(await desktop.updates.check(), { pending: true });
  const statuses = [];
  const off = desktop.updates.onStatus(status => statuses.push(status));
  fake.listeners.updater({ type: 'ready', version: '0.4.1' });
  off();
  assert.equal(fake.listeners.updater, null, 'unsubscribe reaches the preload');
  assert.deepEqual(statuses, [{ type: 'ready', version: '0.4.1' }]);
  await desktop.updates.install();

  assert.deepEqual(await desktop.strava.status(), { connected: true, athlete: null });
  await desktop.strava.connect('secret-value');
  assert.deepEqual(fake.calls.find(c => c[0] === 'connectStrava'), ['connectStrava', 'secret-value']);

  assert.deepEqual(await desktop.garmin.findDrives(), [{ root: 'E:\\', label: 'Forerunner 255 (E:)' }]);
  assert.deepEqual(await desktop.garmin.copy({ root: 'E:\\', name: 'Tempo út', data: fitBytes() }), { saved: true, path: 'E:\\GARMIN\\NewFiles\\Tempo.fit' });
  assert.equal(fake.calls.find(c => c[0] === 'garminCopy')[1].name, 'Tempo-ut.fit');
  await rejectsWith(desktop.garmin.copy({ root: 'E:\\', name: 'plan.zwo', data: fitBytes() }), 'not_fit');
  await rejectsWith(desktop.garmin.copy({ name: 'plan.fit', data: fitBytes() }), 'drive_not_found');

  await desktop.openExternal('https://intervals.icu/settings');
  await rejectsWith(desktop.openExternal('file:///C:/Windows/system32/calc.exe'), 'invalid_url');
  assert.equal(await desktop.showInFolder('C:\\Users\\pepa\\Downloads\\plan.fit'), true);
  desktop.setTitleBarTheme({ color: '#0e0f11', symbolColor: '#f4f4f5' });
  desktop.setTitleBarTheme({ color: 'red', symbolColor: '#fff' });
  await Promise.resolve();
  assert.deepEqual(fake.calls.filter(c => c[0] === 'setTitleBarTheme'), [['setTitleBarTheme', { color: '#0e0f11', symbolColor: '#f4f4f5' }]]);
  assert.deepEqual(await desktop.notify({ title: 'Zítra běžíš', body: 'Út 24. 11. · 5 km' }), { shown: true });
  await rejectsWith(desktop.notify({ body: 'no title' }), 'invalid_data');
});

test('desktop adapter turns IPC errors back into codes and hides Garmin off Windows', async () => {
  const fake = fakeDesktop({
    http: () => Promise.reject(new Error("Error invoking remote method 'http-request': Error: [timeout] no answer within 15 s")),
    saveFile: () => Promise.reject(new Error("Error invoking remote method 'file-save': Error: [write_failed] EACCES"))
  });
  const desktop = Platform.create({ veyvo: fake.veyvo, navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Electron/38' } });
  await rejectsWith(desktop.http({ url: 'https://intervals.icu/api/v1/athlete/0' }), 'timeout');
  await rejectsWith(desktop.saveFile({ name: 'a.txt', data: 'x' }), 'write_failed');
  assert.equal(desktop.garmin.supported, false);
  assert.deepEqual(await desktop.garmin.findDrives(), []);

  const minimal = Platform.create({ veyvo: { saveFile: () => Promise.resolve({ saved: false }) } });
  assert.equal(minimal.kind, 'desktop');
  assert.deepEqual(await minimal.saveFile({ name: 'a.txt', data: 'x' }), { saved: false });
  assert.equal(minimal.updates.supported, false);
  assert.equal(minimal.strava.supported, false);
  await rejectsWith(minimal.http({ url: 'https://intervals.icu/' }), 'unsupported');
  await rejectsWith(minimal.secrets.get('intervals-api-key'), 'unsupported');
  assert.equal(await minimal.version().catch(e => e.code), 'unsupported');
});

// ---------------------------------------------------------------- android adapter over fake Capacitor plugins

function fakeAndroid(options = {}) {
  const files = new Map();
  const prefs = new Map();
  const log = [];
  const Plugins = {
    App: { getInfo: async () => ({ version: options.version || '0.4.0', build: '40' }) },
    Filesystem: {
      async writeFile(o) { log.push(['writeFile', o.path, o.directory, o.encoding || 'base64']); files.set(o.directory + ':' + o.path, o.data); return { uri: 'file:///data/' + o.directory + '/' + o.path }; },
      async rename(o) {
        const from = o.directory + ':' + o.from, to = (o.toDirectory || o.directory) + ':' + o.to;
        if (options.renameRefusesOverwrite && files.has(to)) throw new Error('Destination exists');
        files.set(to, files.get(from)); files.delete(from); log.push(['rename', o.from, o.to]);
      },
      async deleteFile(o) { files.delete(o.directory + ':' + o.path); log.push(['deleteFile', o.path]); },
      async readdir(o) {
        const prefix = o.directory + ':' + o.path + '/';
        return { files: [...files.keys()].filter(k => k.startsWith(prefix)).map(k => ({ name: k.slice(prefix.length), size: files.get(k).length, mtime: 1764200000000, type: 'file' })) };
      },
      async readFile(o) {
        const key = o.directory + ':' + o.path;
        if (!files.has(key)) throw new Error('File does not exist');
        return { data: files.get(key) };
      }
    },
    Share: {
      async share(o) { log.push(['share', o.files]); if (options.cancelShare) throw new Error('Share canceled'); return { activityType: 'com.google.android.apps.docs' }; }
    },
    Preferences: {
      async get({ key }) { return { value: prefs.has(key) ? prefs.get(key) : null }; },
      async set({ key, value }) { prefs.set(key, value); },
      async remove({ key }) { prefs.delete(key); }
    },
    Browser: { async open({ url }) { log.push(['browser', url]); } },
    CapacitorHttp: {
      async request(o) {
        log.push(['http', o.method, o.url, o.headers, o.data]);
        if (options.httpError) throw new Error(options.httpError);
        if (o.url === U.RELEASES_LATEST_URL) return { status: 200, headers: { 'Content-Type': 'application/json' }, data: options.release || RELEASE };
        return { status: 201, headers: { 'Content-Type': 'application/json' }, data: [{ id: 7 }] };
      }
    }
  };
  const win = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins } };
  return { win, files, prefs, log, Plugins };
}

test('android adapter: share sheet for files, CapacitorHttp with the allowlist, Preferences secrets', async () => {
  const fake = fakeAndroid();
  const android = Platform.create(fake.win);
  assert.equal(android.kind, 'android');
  assert.equal(await android.version(), '0.4.0');
  assert.equal(android.secrets.encrypted, false, 'Preferences are not encrypted');
  assert.equal(android.strava.supported, false);
  assert.equal(android.garmin.supported, false);

  const shared = await android.saveFile({ name: 'Tempo út.fit', mime: 'application/vnd.ant.fit', data: new Uint8Array([0, 255, 128]) });
  assert.deepEqual(shared, { saved: true, shared: true, path: 'file:///data/CACHE/exports/Tempo út.fit' });
  assert.equal(fake.files.get('CACHE:exports/Tempo út.fit'), 'AP+A', 'binary data goes in as base64');
  await android.saveFile({ name: 'plan.txt', data: 'Běh' });
  assert.equal(fake.files.get('CACHE:exports/plan.txt'), 'Běh');
  assert.deepEqual(fake.log.find(e => e[0] === 'writeFile' && e[1] === 'exports/plan.txt'), ['writeFile', 'exports/plan.txt', 'CACHE', 'utf8']);
  const cancel = await Platform.create(fakeAndroid({ cancelShare: true }).win).saveFile({ name: 'a.txt', data: 'x' });
  assert.deepEqual(cancel, { saved: false, shared: false, canceled: true });

  const response = await android.http({ url: 'https://intervals.icu/api/v1/athlete/0/events/bulk', method: 'POST', headers: { Authorization: 'Basic x' }, body: [{ a: 1 }] });
  assert.equal(response.status, 201);
  assert.equal(response.ok, true);
  assert.deepEqual(response.json, [{ id: 7 }]);
  assert.equal(response.text, '[{"id":7}]');
  assert.equal(response.headers['content-type'], 'application/json');
  const httpCall = fake.log.find(e => e[0] === 'http');
  assert.equal(httpCall[4], '[{"a":1}]');
  assert.equal(httpCall[3]['Content-Type'], 'application/json');
  const calls = fake.log.length;
  await rejectsWith(android.http({ url: 'https://evil.com/' }), 'host_not_allowed');
  assert.equal(fake.log.length, calls, 'blocked before reaching the plugin');
  await rejectsWith(Platform.create(fakeAndroid({ httpError: 'Unable to resolve host' }).win).http({ url: 'https://intervals.icu/' }), 'network');
  await rejectsWith(Platform.create(fakeAndroid({ httpError: 'connect timed out' }).win).http({ url: 'https://intervals.icu/' }), 'timeout');

  await android.secrets.set('intervals-api-key', 'secret');
  assert.equal(fake.prefs.get('veyvo-secret.intervals-api-key'), 'secret');
  assert.equal(await android.secrets.get('intervals-api-key'), 'secret');
  await android.secrets.remove('intervals-api-key');
  assert.equal(await android.secrets.get('intervals-api-key'), null);
  await rejectsWith(android.secrets.get('Bad'), 'invalid_name');

  await android.openExternal('https://intervals.icu/settings');
  assert.deepEqual(fake.log.at(-1), ['browser', 'https://intervals.icu/settings']);
  await rejectsWith(android.openExternal('intent://evil'), 'invalid_url');
});

test('android backups: atomic write in Data/backups and only the newest 14 kept', async () => {
  for (const renameRefusesOverwrite of [false, true]) {
    const fake = fakeAndroid({ renameRefusesOverwrite });
    for (let day = 1; day <= 15; day++) fake.files.set('DATA:backups/veyvo-2026-10-' + String(day).padStart(2, '0') + '.json', '{}');
    fake.files.set('DATA:backups/notes.txt', 'keep me');
    const android = Platform.create(fake.win);
    const today = U.backupFileName(U.dateKeyOf(new Date()));
    fake.files.set('DATA:backups/' + today, '{"old":true}');
    const result = await android.backup.snapshot('{"app":"VEYVO"}');
    assert.deepEqual(result, { path: 'backups/' + today });
    assert.equal(fake.files.get('DATA:backups/' + today), '{"app":"VEYVO"}', 'same day is overwritten');
    assert.equal(fake.files.has('DATA:backups/' + today + '.tmp'), false);
    const kept = [...fake.files.keys()].filter(k => /veyvo-\d/.test(k));
    assert.equal(kept.length, 14);
    assert.equal(fake.files.has('DATA:backups/veyvo-2026-10-01.json'), false);
    assert.equal(fake.files.has('DATA:backups/veyvo-2026-10-02.json'), false);
    assert.equal(fake.files.get('DATA:backups/notes.txt'), 'keep me', 'other files are never pruned');
    const list = await android.backup.list();
    assert.equal(list.length, 14);
    assert.equal(list[0].name, today);
    assert.equal(list[0].date, today.slice(6, 16));
    assert.equal(list[0].modified, new Date(1764200000000).toISOString());
    assert.equal(await android.backup.read(today), '{"app":"VEYVO"}');
    await rejectsWith(android.backup.read('veyvo-2026-10-01.json'), 'not_found');
    await rejectsWith(android.backup.read('../shared_prefs.xml'), 'invalid_name');
    await rejectsWith(android.backup.snapshot(''), 'invalid_data');
  }
});

test('android updates: GitHub latest release, semver compare, .apk opened in the browser', async () => {
  const fake = fakeAndroid({ version: '0.4.0' });
  const android = Platform.create(fake.win);
  const statuses = [];
  const off = android.updates.onStatus(status => statuses.push(status));
  await rejectsWith(android.updates.install(), 'no_update');
  const info = await android.updates.check();
  assert.equal(info.available, true);
  assert.equal(info.version, '0.4.1');
  assert.equal(info.url, 'https://github.com/PepiBikerBTW/VEYVO/releases/download/v0.4.1/VEYVO-0.4.1.apk');
  const request = fake.log.find(e => e[0] === 'http');
  assert.deepEqual(request.slice(0, 3), ['http', 'GET', 'https://api.github.com/repos/PepiBikerBTW/VEYVO/releases/latest']);
  await android.updates.install();
  assert.deepEqual(fake.log.at(-1), ['browser', info.url]);
  off();
  assert.deepEqual(statuses.map(s => s.type), ['checking', 'available', 'opened']);

  const current = Platform.create(fakeAndroid({ version: '0.4.1' }).win);
  const seen = [];
  current.updates.onStatus(status => seen.push(status));
  assert.equal((await current.updates.check()).available, false);
  assert.deepEqual(seen.at(-1), { type: 'current', version: '0.4.1' });
  await rejectsWith(current.updates.install(), 'no_update');

  const offline = Platform.create(fakeAndroid({ httpError: 'Unable to resolve host "api.github.com"' }).win);
  const errors = [];
  offline.updates.onStatus(status => errors.push(status));
  const failed = await offline.updates.check();
  assert.equal(failed.available, false);
  assert.equal(failed.error.code, 'network');
  assert.equal(errors.at(-1).type, 'error');
});

test('android without optional plugins degrades instead of throwing at load', async () => {
  const fake = fakeAndroid();
  delete fake.Plugins.Share;
  delete fake.Plugins.CapacitorHttp;
  const android = Platform.create(fake.win);
  assert.equal(android.supports.share, false);
  assert.equal(android.supports.http, false);
  assert.equal(android.updates.supported, false);
  assert.deepEqual(await android.saveFile({ name: 'plan.txt', data: 'x' }), { saved: true, shared: false, path: 'file:///data/DOCUMENTS/VEYVO/plan.txt' });
  await rejectsWith(android.http({ url: 'https://intervals.icu/' }), 'unsupported');
});

// ---------------------------------------------------------------- preload and main stay in sync

const ROOT = path.join(__dirname, '..');
function loadPreload() {
  const exposed = {};
  const invoked = [];
  const listeners = [];
  const ipcRenderer = {
    invoke: (channel, ...args) => { invoked.push([channel, ...args]); return Promise.resolve(); },
    on: (channel, listener) => listeners.push([channel, listener]),
    removeListener: (channel, listener) => { const i = listeners.findIndex(l => l[0] === channel && l[1] === listener); if (i !== -1) listeners.splice(i, 1); }
  };
  const required = [];
  const sandboxRequire = name => { required.push(name); if (name !== 'electron') throw new Error('sandboxed preload cannot require ' + name); return { contextBridge: { exposeInMainWorld: (key, api) => { exposed[key] = api; } }, ipcRenderer }; };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8'), { require: sandboxRequire });
  return { api: exposed.veyvo, invoked, listeners, required };
}

test('preload: sandbox-safe, keeps the 0.3 API and adds the 0.4 bridge', async () => {
  const preload = loadPreload();
  assert.deepEqual(preload.required, ['electron']);
  const source = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');
  assert.match(source, /const \{ contextBridge, ipcRenderer \} = require\('electron'\);/);
  assert.doesNotMatch(source, /process\.|__dirname|require\('(?!electron')/);
  for (const name of ['version', 'checkForUpdates', 'installUpdate', 'onUpdaterStatus', 'stravaStatus', 'connectStrava', 'syncStrava', 'disconnectStrava', 'onStravaEvent',
    'saveFile', 'showItemInFolder', 'openExternal', 'http', 'backupSnapshot', 'listBackups', 'readBackup', 'garminFindDrives', 'garminCopy', 'setTitleBarTheme', 'notify']) {
    assert.equal(typeof preload.api[name], 'function', name);
  }
  for (const name of ['get', 'set', 'remove']) assert.equal(typeof preload.api.secrets[name], 'function', 'secrets.' + name);
  assert.equal(Platform.detect({ veyvo: preload.api }), 'desktop');

  await preload.api.version();
  await preload.api.connectStrava('abc');
  await preload.api.secrets.set('intervals-api-key', 'k');
  assert.deepEqual(preload.invoked, [['app-version'], ['strava-connect', 'abc'], ['secret-set', 'intervals-api-key', 'k']]);
  const off = preload.api.onUpdaterStatus(() => {});
  assert.equal(preload.listeners.length, 1);
  off();
  assert.equal(preload.listeners.length, 0, 'onUpdaterStatus returns a working unsubscribe');
});

test('main: every channel the preload uses has a validated handler, hardening is in place', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const invoked = [...preload.matchAll(/invoke\('([a-z-]+)'/g)].map(m => m[1]);
  const handled = [...main.matchAll(/\bhandle\('([a-z-]+)'/g)].map(m => m[1]);
  assert.ok(invoked.length >= 20);
  assert.deepEqual([...new Set(invoked)].sort(), [...new Set(handled)].sort());
  assert.doesNotMatch(main, /ipcMain\.handle\('/, 'all handlers go through the sender check');
  for (const legacy of ['app-version', 'updater-check', 'updater-install', 'strava-status', 'strava-connect', 'strava-sync', 'strava-disconnect']) assert.ok(handled.includes(legacy), legacy);
  assert.match(main, /sandbox: true/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /requestSingleInstanceLock\(\)/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /'will-navigate'/);
  assert.match(main, /redirect: 'manual'/);
  for (const url of ['https://www.nswis.com.au/nswis-news/food-choices-for-the-run-in-to-competition/',
    'https://www.ausport.gov.au/ais/nutrition/supplements/group_a/sports-foods2/sports-drink/how-and-when-do-i-use-it',
    'https://health.clevelandclinic.org/what-to-eat-when-youre-training-for-a-marathon']) assert.ok(main.includes(url), 'nutrition source kept: ' + url);
});

test('capacitor config keeps the app identity and disables the fetch patch', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'mobile', 'capacitor.config.json'), 'utf8'));
  assert.equal(config.appId, 'com.veyvo.coach');
  assert.equal(config.appName, 'VEYVO');
  assert.equal(config.webDir, 'www');
  assert.ok(U.isHexColor(config.android.backgroundColor));
  assert.deepEqual(config.plugins.CapacitorHttp, { enabled: false });
});

// ---------------------------------------------------------------- adversarial review (integration pass)

test('http allowlist resists parser tricks: backslashes, encoded dots, userinfo, ports, lookalikes', () => {
  for (const url of [
    'https://evil.com\\@intervals.icu/',
    'https://evil.com\\.intervals.icu/',
    'https://intervals.icu:443@evil.com/',
    'https://intervals.icu%2F@evil.com/',
    'https://intervals.icu%2eevil.com/',
    'https://intervals.icu%00.evil.com/',
    'https://xn--intervals-icu.com/',
    'https://intervals-icu.com/',
    'https://api.github.com.evil.com/',
    'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/',
    'https://intervals.icu:0/', 'https://intervals.icu:80/',
    'HTTPS://evil.com/intervals.icu', 'wss://intervals.icu/', 'ftp://intervals.icu/', 'blob:https://intervals.icu/x'
  ]) assert.equal(U.isAllowedHttpUrl(url), false, url);
  // A backslash before '@' is a path separator for https: the request still goes to intervals.icu.
  assert.equal(new URL(U.normalizeHttpRequest({ url: 'https://intervals.icu\\@evil.com/' }).url).hostname, 'intervals.icu');
  // Header injection and hop-by-hop / proxy headers are refused.
  for (const headers of [{ Host: 'evil.com' }, { 'X-A': 'a\r\nHost: evil.com' }, { 'Proxy-Authorization': 'x' }, { 'Sec-Fetch-Site': 'none' },
    { 'Transfer-Encoding': 'chunked' }, { 'X A': '1' }, { 'X-A': '1', 'x-a': '2' }]) {
    throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu/', headers }), 'invalid_request');
  }
  throwsWith(() => U.normalizeHttpRequest({ url: 'https://intervals.icu.evil.com/' }), 'host_not_allowed');
});

test('saveFile refuses executable types and keeps every name a single safe segment', () => {
  for (const name of ['update.exe', 'UPDATE.EXE', 'plan.fit.exe', 'plan.exe.', 'plan.exe ', 'run.bat', 'x.cmd', 'x.ps1', 'x.vbs',
    'x.js', 'x.hta', 'x.lnk', 'x.url', 'x.scr', 'x.msi', 'x.reg', 'x.jar', 'x.appref-ms', 'x.settingcontent-ms', 'x.iso',
    'x.apk', 'x.e\u200bxe', 'C:\\Windows\\System32\\x.dll', '../../x.sh']) {
    throwsWith(() => U.prepareFile({ name, mime: 'application/octet-stream', data: 'x' }), 'file_type_blocked');
    assert.equal(U.isBlockedFileName(U.sanitizeFileName(name)), true, name);
  }
  for (const name of ['plan.fit', 'Úseky 6× 400 m.workout', 'tempo.zwo', 'veyvo-backup-2026-11-27.json', 'plan.txt', 'a.bin', 'exe', 'x.exe.fit', 'notes.json.txt']) {
    assert.doesNotThrow(() => U.prepareFile({ name, data: 'x' }), name);
  }
  assert.equal(U.sanitizeFileName('CONIN$.txt'), '_CONIN$.txt');
  assert.equal(U.sanitizeFileName('conout$'), '_conout$');
  for (const name of ['..', '../..', '..\\..\\', '/', 'C:\\', '\\\\server\\share\\', 'a/../../b.json', '%2e%2e%2fsecrets.json']) {
    const safe = U.sanitizeFileName(name);
    assert.doesNotMatch(safe, /[\\/]|^\.\.?$/, name + ' -> ' + safe);
  }
  for (const locale of ['cs', 'en']) assert.equal(typeof Platform.MESSAGES[locale].error.file_type_blocked, 'string');
});

test('Garmin copy and backups cannot leave their folders', () => {
  for (const name of ['..\\..\\Windows\\win.ini.fit', '../../../etc/x.fit', 'GARMIN\\Apps\\x.fit', 'C:\\x.fit', 'a:b.fit', 'x.fit::$DATA']) {
    const fit = U.prepareFitFile(name, fitBytes());
    assert.match(fit.name, /^[A-Za-z0-9._-]+\.fit$/, name + ' -> ' + fit.name);
    assert.doesNotMatch(fit.name, /\.\./);
  }
  for (const name of ['../secrets.json', '..\\secrets.json', 'veyvo-2026-11-27.json/../../x', 'veyvo-2026-11-27.json\0', 'veyvo-2026-02-30.json',
    'veyvo-2026-11-27.JSON', '/abs/veyvo-2026-11-27.json', 'veyvo-2026-11-27.json.bak', ' veyvo-2026-11-27.json']) {
    assert.equal(U.isBackupFileName(name), false, name);
  }
  for (const name of ['Secret', 'a_b', 'a.b', '../x', 'x/y', '__proto__', 'constructor ', 'a'.repeat(41), '', 'ř']) {
    assert.equal(U.isSecretName(name), false, name);
  }
});

test('main: showItemInFolder only reveals files VEYVO wrote or its own backups', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(main, /function showItemInFolder\(filePath\) \{[\s\S]*?if \(!isRevealable\(target\)/);
  assert.match(main, /rememberWritten\(result\.filePath\)/, 'saveFile records the chosen path');
  assert.match(main, /rememberWritten\(target\)/, 'garminCopy records the copied file');
  assert.match(main, /U\.isBackupFileName\(path\.basename\(target\)\)/);
  assert.match(main, /U\.prepareFile\(/, 'main re-checks names (and blocked types) itself');
});

// ---------------------------------------------------------------- safety copies (review fix: a second replace/wipe kept no original)

test('safety backup names: one file per replace/wipe, listed with their kind, pruned on their own', () => {
  assert.equal(U.backupFileName('2026-11-27', { kind: 'replace', time: '101500' }), 'veyvo-2026-11-27-101500-before-replace.json');
  assert.equal(U.backupFileName('2026-11-27', { kind: 'wipe', time: '235959' }), 'veyvo-2026-11-27-235959-before-wipe.json');
  assert.equal(U.backupFileName('2026-11-27', { kind: 'daily' }), 'veyvo-2026-11-27.json');
  for (const bad of [{ kind: 'replace', time: '246000' }, { kind: 'replace', time: '1015' }, { kind: 'evil', time: '101500' }, { kind: 'replace' }]) {
    assert.equal(U.backupFileName('2026-11-27', bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(U.backupInfo('veyvo-2026-11-27-101500-before-replace.json'), { name: 'veyvo-2026-11-27-101500-before-replace.json', date: '2026-11-27', time: '101500', kind: 'replace' });
  assert.deepEqual(U.backupInfo('veyvo-2026-11-27.json'), { name: 'veyvo-2026-11-27.json', date: '2026-11-27', time: null, kind: 'daily' });
  for (const name of ['veyvo-2026-11-27-101500-before-evil.json', 'veyvo-2026-11-27-101500.json', 'veyvo-2026-11-27-999999-before-wipe.json', 'veyvo-2026-11-27-101500-before-replace.json.tmp']) {
    assert.equal(U.isBackupFileName(name), false, name);
  }
  assert.equal(U.timeKeyOf(new Date(2026, 10, 27, 9, 5, 7)), '090507');
  const taken = ['veyvo-2026-11-27-090507-before-replace.json'];
  assert.equal(U.safetyBackupName('replace', new Date(2026, 10, 27, 9, 5, 7), taken), 'veyvo-2026-11-27-090508-before-replace.json', 'never the same name twice');
  // newest first; a day's safety copies (newest first) before its daily file
  assert.deepEqual(U.sortBackupNames(['veyvo-2026-11-26.json', 'veyvo-2026-11-27-090000-before-replace.json', 'veyvo-2026-11-27.json', 'veyvo-2026-11-27-101500-before-wipe.json']),
    ['veyvo-2026-11-27-101500-before-wipe.json', 'veyvo-2026-11-27-090000-before-replace.json', 'veyvo-2026-11-27.json', 'veyvo-2026-11-26.json']);
  // 20 daily + 12 safety copies: the 14 newest daily and the 10 newest safety copies stay
  const daily = Array.from({ length: 20 }, (_, i) => 'veyvo-2026-10-' + String(i + 1).padStart(2, '0') + '.json');
  const safety = Array.from({ length: 12 }, (_, i) => 'veyvo-2026-09-01-' + String(100000 + i) + '-before-replace.json');
  const doomed = U.backupsToPrune(daily.concat(safety));
  assert.deepEqual(doomed.filter(n => n.includes('before')).sort(), safety.slice(0, 2).sort(), 'the two oldest safety copies go');
  assert.deepEqual(doomed.filter(n => !n.includes('before')).sort(), daily.slice(0, 6).sort(), 'the six oldest daily backups go');
  assert.equal(U.SAFETY_KEEP, 10);
});

test('desktop and android: snapshot(json, { kind }) writes a separate safety copy; the daily file stays', async () => {
  const fake = fakeDesktop();
  const desktop = Platform.create({ veyvo: fake.veyvo, navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/38.8.6' } });
  await desktop.backup.snapshot('{"app":"VEYVO"}', { kind: 'replace' });
  assert.deepEqual(fake.calls.filter(c => c[0] === 'backupSnapshot').at(-1).slice(1), ['{"app":"VEYVO"}', { kind: 'replace' }]);
  await desktop.backup.snapshot('{"app":"VEYVO"}');
  assert.deepEqual(fake.calls.filter(c => c[0] === 'backupSnapshot').at(-1).slice(1), ['{"app":"VEYVO"}'], 'the daily backup keeps its one-argument call');
  await rejectsWith(desktop.backup.snapshot('{"app":"VEYVO"}', { kind: 'evil' }), 'invalid_data');

  const a = fakeAndroid();
  const android = Platform.create(a.win);
  const today = U.backupFileName(U.dateKeyOf(new Date()));
  a.files.set('DATA:backups/' + today, '{"original":true}');
  const one = await android.backup.snapshot('{"copy":1}', { kind: 'replace' });
  const two = await android.backup.snapshot('{"copy":2}', { kind: 'replace' });
  assert.notEqual(one.path, two.path, 'two replaces on the same day: two files');
  assert.match(one.path, /^backups\/veyvo-\d{4}-\d{2}-\d{2}-\d{6}-before-replace\.json$/);
  assert.equal(a.files.get('DATA:backups/' + today), '{"original":true}', 'the daily backup is untouched');
  assert.equal(a.files.get('DATA:' + one.path), '{"copy":1}');
  assert.equal(a.files.get('DATA:' + two.path), '{"copy":2}');
  const list = await android.backup.list();
  assert.deepEqual(list.map(x => x.kind).sort(), ['daily', 'replace', 'replace']);
  assert.equal(await android.backup.read(one.path.slice(8)), '{"copy":1}');
});

test('android updates: a newer release without an APK is "newer", not "up to date"; the daily check only counts when answered', async () => {
  const noApk = { tag_name: 'v0.4.1', html_url: 'https://github.com/PepiBikerBTW/VEYVO/releases/tag/v0.4.1', assets: [
    { name: 'VEYVO-Setup-0.4.1.exe', browser_download_url: 'https://github.com/PepiBikerBTW/VEYVO/releases/download/v0.4.1/VEYVO-Setup-0.4.1.exe' },
    { name: 'latest.yml', browser_download_url: 'https://github.com/PepiBikerBTW/VEYVO/releases/download/v0.4.1/latest.yml' }] };
  const android = Platform.create(fakeAndroid({ version: '0.4.0', release: noApk }).win);
  const seen = [];
  android.updates.onStatus(status => seen.push(status));
  const info = await android.updates.check();
  assert.deepEqual([info.available, info.newer], [false, true]);
  assert.deepEqual(seen.map(s => s.type), ['checking', 'newer']);
  assert.deepEqual(seen.at(-1), { type: 'newer', version: '0.4.1', pageUrl: 'https://github.com/PepiBikerBTW/VEYVO/releases/tag/v0.4.1' });
  assert.equal(U.updateCheckCounts(info), false, 'checked again later, when the APK is there');
  assert.equal(U.updateCheckCounts({ available: false, newer: false }), true);
  assert.equal(U.updateCheckCounts({ available: true, newer: true }), true);
  assert.equal(U.updateCheckCounts({ available: false, error: { code: 'network' } }), false, 'offline: retry');
  assert.equal(U.updateCheckCounts(null), false);
  // the last answer survives a restart while it fits the installed version
  const rec = { type: 'current', version: '0.4.0', pageUrl: null, checkedAt: '2026-11-27T08:00:00.000Z', installed: '0.4.0' };
  assert.deepEqual(U.restoredUpdateStatus(rec, '0.4.0'), { type: 'current', version: '0.4.0', pageUrl: null, checkedAt: '2026-11-27T08:00:00.000Z', restored: true });
  assert.equal(U.restoredUpdateStatus(rec, '0.4.1'), null, 'after an update the old answer is stale');
  assert.equal(U.restoredUpdateStatus({ ...rec, type: 'error' }, '0.4.0'), null);
  assert.equal(U.restoredUpdateStatus({ ...rec, type: 'newer', pageUrl: 'javascript:alert(1)' }, '0.4.0').pageUrl, null);
});

test('android: the status and navigation bar icons follow the app theme (SystemBars), not the phone setting', async () => {
  const fake = fakeAndroid();
  const styles = [];
  fake.Plugins.SystemBars = { async setStyle(o) { styles.push(o.style); } };
  const android = Platform.create(fake.win);
  assert.equal(android.supports.titleBar, true);
  android.setTitleBarTheme({ color: '#0D0E11', symbolColor: '#F3F4F6' });
  android.setTitleBarTheme({ color: '#F2F3F5', symbolColor: '#0E1013' });
  android.setTitleBarTheme({ color: 'red', symbolColor: '#000' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(styles, ['DARK', 'LIGHT'], 'dark app: light icons (DARK), light app: dark icons (LIGHT); junk ignored');
  assert.equal(U.isDarkColor('#0D0E11'), true);
  assert.equal(U.isDarkColor('#FFF'), false);
  // without the plugin nothing breaks
  const bare = Platform.create(fakeAndroid().win);
  assert.equal(bare.supports.titleBar, false);
  assert.doesNotThrow(() => bare.setTitleBarTheme({ color: '#0D0E11', symbolColor: '#F3F4F6' }));
  // the native first paint is graphite too (no white strips behind the bars)
  const styles_xml = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml'), 'utf8');
  assert.match(styles_xml, /android:windowBackground">@color\/veyvoBackground</);
  const colors = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'android', 'app', 'src', 'main', 'res', 'values', 'colors.xml'), 'utf8');
  assert.match(colors, /name="veyvoBackground">#0D0E11</);
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mobile', 'capacitor.config.json'), 'utf8')).plugins.SystemBars.style, 'DARK');
});
