// Build channels (src/build-info.js -> VeyvoPlatform.build -> VeyvoUI.app.build). The Google Play build
// ('play') must not update itself (Play's Device and Network Abuse policy), never talks to GitHub, hides
// Strava, says nothing about the Windows app or APK downloads, and on Android its Garmin card steers to
// intervals.icu. The GitHub build stays as it was. The last tests sync a real Play copy with
// mobile/scripts/sync-web.mjs into a temporary folder and check what would ship.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SYNC = path.join(ROOT, 'mobile', 'scripts', 'sync-web.mjs');

// platform.js reads globalThis.window when it loads; a bare object is a plain browser ('github').
globalThis.window = {};
const Platform = require('../src/platform.js');
const U = Platform.util;

/** A Capacitor Android shell whose page has VEYVO_BUILD = { channel } (none: the committed 'github'). */
function androidWindow(channel, log = []) {
  const Plugins = {
    App: { getInfo: async () => ({ version: '0.4.1' }) },
    Filesystem: { async writeFile(o) { return { uri: 'file:///data/' + o.path }; }, async readdir() { return { files: [] }; } },
    Share: { async share() { return {}; } },
    Preferences: { async get() { return { value: null }; }, async set() {}, async remove() {} },
    Browser: { async open({ url }) { log.push(['browser', url]); } },
    CapacitorHttp: {
      async request(o) {
        log.push(['http', o.method, o.url]);
        return { status: 200, headers: { 'Content-Type': 'application/json' }, data: { tag_name: 'v0.4.0', assets: [] } };
      }
    }
  };
  const win = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins } };
  if (channel) win.VEYVO_BUILD = { channel };
  return win;
}
async function rejectsWith(promise, code) {
  await assert.rejects(promise, error => { assert.equal(error.code, code, error.message); return true; });
}

// The UI modules below run inside the Google Play Android shell.
globalThis.VeyvoFormat = require('../src/core/format.js');
globalThis.VeyvoI18n = require('../src/core/i18n.js');
globalThis.VeyvoRuns = require('../src/core/runs-model.js');
globalThis.VeyvoStore = require('../src/core/store.js');
globalThis.VeyvoWorkouts = require('../src/core/workouts.js');
globalThis.VeyvoFit = require('../src/core/export/fit.js');
globalThis.VeyvoIntervals = require('../src/core/export/intervals.js');
globalThis.VeyvoTraining = require('../src/training-context.js');
globalThis.VeyvoPlatform = Platform.create(androidWindow('play'));
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js', 'home.js', 'progress.js', 'workout-sheet.js', 'settings.js', 'onboarding.js']) {
  require(path.join(SRC, 'ui', file));
}
const UI = globalThis.VeyvoUI;
const app = UI.app;
const I18n = globalThis.VeyvoI18n;
const PLAY = Object.freeze({ channel: 'play', store: true });
const GITHUB = Object.freeze({ channel: 'github', store: false });

// ---------------------------------------------------------------- channel detection

test('build-info.js as committed is the github channel; anything unknown falls back to github', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(SRC, 'build-info.js'), 'utf8'), sandbox);
  assert.equal(sandbox.VEYVO_BUILD.channel, 'github');
  assert.ok(Object.isFrozen(sandbox.VEYVO_BUILD));

  assert.deepEqual([...U.CHANNELS], ['github', 'play', 'appstore']);
  assert.deepEqual({ ...U.buildInfo({ VEYVO_BUILD: { channel: 'play' } }) }, PLAY);
  assert.deepEqual({ ...U.buildInfo({ VEYVO_BUILD: { channel: 'appstore' } }) }, { channel: 'appstore', store: true });
  for (const raw of [undefined, null, {}, { channel: 'beta' }, { channel: 7 }, 'play']) {
    assert.deepEqual({ ...U.buildInfo({ VEYVO_BUILD: raw }) }, GITHUB, JSON.stringify(raw));
  }
  const broken = {};
  Object.defineProperty(broken, 'VEYVO_BUILD', { get() { throw new Error('blocked'); } });
  assert.deepEqual({ ...U.buildInfo(broken) }, GITHUB);
  assert.deepEqual({ ...Platform.build }, GITHUB, 'Node (electron/main.js) is the github channel');
  assert.deepEqual([...U.HTTP_HOSTS], ['intervals.icu', 'api.github.com']);
});

// ---------------------------------------------------------------- platform rules

test('play on Android: no updater at all, and GitHub is not on the http allowlist', async () => {
  const log = [];
  const play = Platform.create(androidWindow('play', log));
  assert.equal(play.kind, 'android');
  assert.deepEqual({ ...play.build }, PLAY);
  assert.equal(play.updates.supported, false);
  assert.equal(play.supports.updates, false);
  const info = await play.updates.check();
  assert.equal(info.available, false);
  assert.equal(info.unsupported, true);
  await rejectsWith(play.updates.install(), 'unsupported');
  assert.equal(typeof play.updates.onStatus(() => {}), 'function');

  await rejectsWith(play.http({ url: 'https://api.github.com/repos/PepiBikerBTW/VEYVO/releases/latest' }), 'host_not_allowed');
  await rejectsWith(play.http({ url: 'https://github.com/PepiBikerBTW/VEYVO/releases' }), 'host_not_allowed');
  const res = await play.http({ url: 'https://intervals.icu/api/v1/athlete/0' });
  assert.equal(res.ok, true, 'intervals.icu still works');
  assert.deepEqual(log, [['http', 'GET', 'https://intervals.icu/api/v1/athlete/0']], 'nothing else went out, no browser opened');

  assert.deepEqual([...U.httpHostsFor('play')], ['intervals.icu']);
  assert.deepEqual([...U.httpHostsFor('appstore')], ['intervals.icu']);
  assert.equal(U.isAllowedHttpUrl('https://api.github.com/repos/x', U.httpHostsFor('play')), false);
  assert.equal(play.strava.supported, false);
  assert.equal(play.garmin.supported, false);
});

test('github on Android keeps the daily GitHub update check (the APK channel is unchanged)', async () => {
  const log = [];
  const github = Platform.create(androidWindow(null, log));
  assert.deepEqual({ ...github.build }, GITHUB);
  assert.equal(github.updates.supported, true);
  assert.equal(github.supports.updates, true);
  await github.updates.check();
  assert.deepEqual(log[0], ['http', 'GET', U.RELEASES_LATEST_URL]);
  assert.deepEqual([...U.httpHostsFor('github')], ['intervals.icu', 'api.github.com']);
});

test('desktop and web adapters follow the channel too', async () => {
  const bridge = { saveFile() {}, version: async () => '0.4.1', checkForUpdates: async () => ({}), installUpdate: async () => {}, onUpdaterStatus: () => () => {}, http: async () => ({ status: 200, text: '' }) };
  assert.equal(Platform.create({ veyvo: bridge }).updates.supported, true, 'Windows app: electron-updater');
  const storeDesktop = Platform.create({ veyvo: bridge, VEYVO_BUILD: { channel: 'play' } });
  assert.equal(storeDesktop.updates.supported, false);
  assert.equal(storeDesktop.supports.updates, false);
  await rejectsWith(storeDesktop.http({ url: 'https://api.github.com/' }), 'host_not_allowed');
  const web = Platform.create({ VEYVO_BUILD: { channel: 'play' } });
  assert.equal(web.kind, 'web');
  assert.deepEqual({ ...web.build }, PLAY);
  await rejectsWith(web.http({ url: 'https://api.github.com/' }), 'host_not_allowed');
});

test('the store builds do not mention GitHub in the host error', () => {
  const store = Platform.messagesFor(PLAY);
  for (const locale of ['cs', 'en']) {
    assert.doesNotMatch(store[locale].error.host_not_allowed, /GitHub/i, locale);
    assert.match(store[locale].error.host_not_allowed, /intervals\.icu/, locale);
    assert.deepEqual(Object.keys(store[locale].error).sort(), Object.keys(Platform.MESSAGES[locale].error).sort(), locale + ' keeps every code');
  }
  assert.equal(Platform.messagesFor(GITHUB), Platform.MESSAGES);
});

// ---------------------------------------------------------------- UI rules

test('app.build follows VeyvoPlatform.build: the play shell hides Strava and the updater', () => {
  assert.deepEqual({ ...app.build }, PLAY);
  assert.equal(app.strava.supported, false);
  assert.equal(app.updates.supported, false);
});

test('Settings in a store build: no Aktualizace section, no Strava group, the privacy policy link', () => {
  const S = UI.settings;
  assert.deepEqual([...S.sectionsFor(app.build)], ['profile', 'appearance', 'connections', 'data', 'about']);
  assert.deepEqual([...S.sectionsFor(GITHUB)], ['profile', 'appearance', 'connections', 'data', 'updates', 'about']);
  const shown = S.sectionsFor(app.build);
  assert.equal(S.sectionOf('updates', shown), 'about', 'a link to Aktualizace lands on O aplikaci (the version)');
  assert.equal(S.sectionOf('update', shown), 'about');
  assert.equal(S.sectionOf('strava', shown), 'connections');
  assert.equal(S.sectionOf('updates'), 'updates', 'the github build still has it');
  assert.deepEqual(S.connectionsFor(app.build), ['intervals']);
  assert.deepEqual(S.connectionsFor(GITHUB), ['strava', 'intervals']);
  assert.equal(S.PRIVACY_URL, 'https://pepibikerbtw.github.io/VEYVO/privacy/');
  assert.equal(U.isExternalUrl(S.PRIVACY_URL), true, 'VeyvoPlatform.openExternal accepts it');
});

test('workout sheet: on Android the store build steers Garmin to intervals.icu, the .fit file is the advanced option', () => {
  const W = UI.workoutSheet;
  assert.equal(W.garminViaIntervals('android', app.build), true);
  assert.equal(W.garminViaIntervals('android', GITHUB), false, 'the GitHub APK keeps the USB flow');
  assert.equal(W.garminViaIntervals('desktop', app.build), false);
  assert.equal(W.garminViaIntervals('web', app.build), false);
  assert.equal(W.brandOf('garminCloud').flow, 'intervals', 'the button leads to the intervals.icu flow');
  assert.equal(I18n.t('workout.garmin.phone.advanced', null, 'cs'), 'Pro pokročilé: USB z počítače');
  assert.equal(I18n.t('workout.garmin.phone.advanced', null, 'en'), 'Advanced: USB from a computer');
  for (const locale of ['cs', 'en']) {
    for (const key of ['lead', 'use', 'why']) assert.match(I18n.t('workout.garmin.phone.' + key, null, locale), /intervals\.icu/, key + ' ' + locale);
    assert.match(I18n.t('workout.garmin.phone.why', null, locale), /Garmin Connect/, locale);
    assert.match(I18n.t('workout.method.garminPhone', null, locale), /intervals\.icu.*\.fit/, locale);
  }
});

test('health notice and privacy policy wording (cs + en), every touched namespace complete', () => {
  const t = (key, locale) => I18n.t(key, null, locale);
  assert.match(t('settings.about.medical', 'cs'), /^VEYVO není zdravotnický prostředek/);
  assert.match(t('settings.about.medical', 'cs'), /diagnóze, léčbě, vyléčení ani prevenci/);
  assert.match(t('settings.about.medical', 'en'), /^VEYVO is not a medical device and does not diagnose, treat, cure or prevent any medical condition\./);
  assert.match(t('settings.about.medicalConsult', 'cs'), /lékařem/);
  assert.match(t('settings.about.medicalConsult', 'en'), /healthcare professional/);
  assert.match(t('onboarding.health', 'cs'), /^VEYVO není zdravotnický prostředek\./);
  assert.match(t('onboarding.health', 'en'), /^VEYVO is not a medical device\./);
  assert.equal(t('settings.about.privacyPolicy', 'cs'), 'Zásady ochrany osobních údajů');
  assert.equal(t('settings.about.privacyPolicy', 'en'), 'Privacy policy');
  for (const ns of ['settings', 'onboarding', 'workout', 'home', 'progress']) {
    assert.deepEqual(I18n.audit(ns), { missing: { cs: [], en: [] }, incompletePlurals: [], placeholderMismatch: [] }, ns);
  }
});

// Every visible text that names the Windows app, APK files or GitHub, and why a store build never shows it.
const NOT_IN_STORE = {
  // replaced by a store variant (key + 'Store', or Platform.STORE_MESSAGES)
  'home.headline.noRunsSubLocal': 'home.headline.noRunsSubStore',
  'home.setup.step2TextLocal': 'home.setup.step2TextStore',
  'progress.empty.textLocal': 'progress.empty.textStore',
  'settings.about.privacyOut': 'settings.about.privacyOutStore',
  'platform.error.host_not_allowed': 'STORE_MESSAGES',
  // whole parts the store build does not render
  'settings.strava.form.privacy': 'connectionsFor: no Strava group',
  'settings.strava.status.unsupported': 'connectionsFor: no Strava group',
  'settings.strava.unsupportedText': 'connectionsFor: no Strava group',
  'settings.strava.unsupportedTitle': 'connectionsFor: no Strava group',
  'settings.updates.howAndroid': 'sectionsFor: no Aktualizace',
  'settings.updates.source': 'sectionsFor: no Aktualizace',
  'settings.updates.state.availableAndroid': 'sectionsFor: no Aktualizace',
  'settings.updates.state.newerText': 'sectionsFor: no Aktualizace',
  'settings.updates.state.openedText': 'sectionsFor: no Aktualizace',
  'settings.updates.state.unsupportedText': 'sectionsFor: no Aktualizace',
  // desktop (Windows) only
  'settings.about.electron': 'desktop only',
  'settings.about.platform.desktop': 'desktop only',
  'settings.intervals.storeEncrypted': 'desktop only (encrypted secrets)',
  // a plain browser only (Android has CapacitorHttp)
  'workout.intervals.unavailable': 'web only'
};

test('every text naming Windows, APK or GitHub is one a store build never shows', () => {
  Platform.registerMessages(I18n);
  const FORBIDDEN = /Windows|\bAPK\b|GitHub/i;
  for (const locale of ['cs', 'en']) {
    const hits = I18n.keys().filter(key => { const v = I18n.t(key, null, locale); return typeof v === 'string' && FORBIDDEN.test(v); }).sort();
    assert.deepEqual(hits, Object.keys(NOT_IN_STORE).sort(),
      locale + ': a new text names Windows/APK/GitHub; hide it in store builds (app.build.store) and list it in NOT_IN_STORE');
  }
  const ui = ['home.js', 'progress.js', 'settings.js'].map(f => fs.readFileSync(path.join(SRC, 'ui', f), 'utf8')).join('\n').split('\n');
  for (const [key, store] of Object.entries(NOT_IN_STORE)) {
    if (!/Store$/.test(store)) continue;
    for (const locale of ['cs', 'en']) {
      assert.ok(I18n.has(store, locale), store + ' ' + locale);
      assert.doesNotMatch(I18n.t(store, null, locale), FORBIDDEN, store + ' ' + locale);
      assert.doesNotMatch(I18n.t(store, null, locale), /Strav/i, store + ' ' + locale);
    }
    // a use looks like t('…empty.textLocal'); the definition (textLocal: '…') does not match
    const local = '.' + key.split('.').pop() + "'", replacement = '.' + store.split('.').pop() + "'";
    const lines = ui.filter(line => line.includes(local));
    assert.ok(lines.length > 0, key + ' is used');
    for (const line of lines) assert.ok(line.includes(replacement) && line.includes('app.build.store'), key + ' is always paired with ' + store + ': ' + line.trim());
  }
});

// ---------------------------------------------------------------- versionCode

test('Android versionCode leaves room for test uploads: major*1000000 + minor*10000 + patch*100 + build', () => {
  const gradle = fs.readFileSync(path.join(ROOT, 'mobile', 'android', 'app', 'build.gradle'), 'utf8');
  assert.match(gradle, /veyvoMajor \* 1000000 \+ veyvoMinor \* 10000 \+ veyvoPatch \* 100 \+ veyvoBuildNumber/);
  assert.match(gradle, /System\.getenv\('VEYVO_BUILD_NUMBER'\)/);
  const code = (v, build = 0) => { const [a, b, c] = v.split('.').map(Number); return a * 1000000 + b * 10000 + c * 100 + build; };
  assert.equal(code('0.4.1'), 40100);
  assert.ok(code('0.4.1') > 400, 'above the old 0.4.0 code (400), so GitHub installs still update');
  assert.ok(code('0.4.1', 99) < code('0.4.2'));
  const version = require('../package.json').version;
  assert.ok(code(version.split('-')[0]) >= 40000);
});

// ---------------------------------------------------------------- a real Play copy of www/

function syncInto(dir, args, env) {
  return spawnSync(process.execPath, [SYNC].concat(args, ['--out', dir]), { encoding: 'utf8', env: Object.assign({}, process.env, { VEYVO_CHANNEL: '' }, env || {}) });
}
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

test('sync-web --channel play: the www copy has no GitHub updater, still parses and runs as the play channel', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvo-play-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const www = path.join(tmp, 'www');
  const run = syncInto(www, ['--channel', 'play']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /channel play/);

  const files = walk(path.join(www, 'src'));
  assert.deepEqual(files.map(f => path.relative(path.join(www, 'src'), f)).sort(), walk(SRC).map(f => path.relative(SRC, f)).sort(), 'same files as src/');
  const js = files.filter(f => f.endsWith('.js'));
  assert.ok(js.length > 20);
  for (const file of js) {
    const text = fs.readFileSync(file, 'utf8');
    const name = path.relative(www, file);
    assert.ok(!text.includes('releases/latest'), name + ' contains releases/latest');
    assert.doesNotMatch(text, /\.apk\b/i, name + ' contains .apk');
    assert.ok(!text.includes('api.github.com'), name + ' contains api.github.com');
    assert.doesNotMatch(text, /^\s*\/\/\s*#(?:if|end)-channel/m, name + ' keeps a channel marker line');
    assert.doesNotThrow(() => new vm.Script(text, { filename: name }), name + ' is valid JS');
  }
  const html = fs.readFileSync(path.join(www, 'src', 'index.html'), 'utf8');
  assert.equal(/<script src="([^"]+)"/.exec(html)[1], 'build-info.js', 'build-info.js runs first');
  assert.ok(fs.existsSync(path.join(www, 'index.html')));

  // The page's first scripts as a WebView in the Play shell would run them.
  const sandbox = { console, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout };
  const context = vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis;', context);
  context.Capacitor = androidWindow(null).Capacitor;
  for (const f of ['build-info.js', 'platform.js']) vm.runInContext(fs.readFileSync(path.join(www, 'src', f), 'utf8'), context, { filename: f });
  const P = context.VeyvoPlatform;
  assert.equal(P.kind, 'android');
  assert.equal(P.build.channel, 'play');
  assert.equal(P.build.store, true);
  assert.equal(P.updates.supported, false);
  assert.deepEqual([...P.util.HTTP_HOSTS], ['intervals.icu']);
  assert.equal(P.util.releaseInfo, undefined, 'the GitHub release parser is not in the Play build');
  assert.equal(P.util.RELEASES_LATEST_URL, undefined);
});

test('sync-web: github is the default and keeps the updater; VEYVO_CHANNEL works; bad input fails', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvo-github-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const www = path.join(tmp, 'www');
  const channelOf = () => {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(www, 'src', 'build-info.js'), 'utf8'), sandbox);
    return sandbox.VEYVO_BUILD.channel;
  };
  let run = syncInto(www, []);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(channelOf(), 'github');
  assert.ok(fs.readFileSync(path.join(www, 'src', 'platform.js'), 'utf8').includes('releases/latest'), 'the APK updater stays in the GitHub build');
  assert.equal(fs.readFileSync(path.join(www, 'src', 'platform.js'), 'utf8'), fs.readFileSync(path.join(SRC, 'platform.js'), 'utf8'));

  run = syncInto(www, [], { VEYVO_CHANNEL: 'play' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(channelOf(), 'play', 'VEYVO_CHANNEL=play');

  run = syncInto(www, ['--channel', 'beta']);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /unknown channel/);

  const other = path.join(tmp, 'not-a-sync');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'keep.txt'), 'x');
  run = syncInto(other, ['--channel', 'play']);
  assert.notEqual(run.status, 0, '--out never wipes an unrelated folder');
  assert.ok(fs.existsSync(path.join(other, 'keep.txt')));
});
