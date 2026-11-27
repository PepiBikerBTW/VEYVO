// Nastavení + úvodní průvodce: i18n completeness (namespaces 'settings' and 'onboarding') and the
// pure helpers exported as VeyvoUI.settings (target-time parsing, profile patch validation, goal
// preview from real runs, backup file names, typed wipe confirmation, wipe state, import summary,
// updater view states, Strava re-sign-in detection).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
globalThis.VeyvoFormat = require('../src/core/format.js');
globalThis.VeyvoI18n = require('../src/core/i18n.js');
globalThis.VeyvoRuns = require('../src/core/runs-model.js');
globalThis.VeyvoStore = require('../src/core/store.js');
globalThis.VeyvoWorkouts = require('../src/core/workouts.js');
globalThis.VeyvoTraining = require('../src/training-context.js');
globalThis.VeyvoPlatform = require('../src/platform.js');
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js', 'settings.js', 'onboarding.js']) require(path.join(SRC, 'ui', file));
const UI = globalThis.VeyvoUI;
const I18n = globalThis.VeyvoI18n;
const Store = globalThis.VeyvoStore;
const S = UI.settings;

const RUNS = [
  ['2026-11-10', 'run', 5.0, 1290], ['2026-11-17', 'intervals', 6.5, 2010], ['2026-11-24', 'run', 5.0, 1262]
].map(([date, type, distance, movingSeconds], i) => ({ id: 'm-' + i, source: 'manual', date, type, distance, movingSeconds, effort: 7, note: '' }));

test('settings and onboarding namespaces are complete in Czech and English', () => {
  for (const ns of ['settings', 'onboarding']) {
    const report = I18n.audit(ns);
    const problems = [];
    const walk = (value, where) => {
      if (Array.isArray(value)) value.forEach(item => problems.push(where + ': ' + JSON.stringify(item)));
      else if (value && typeof value === 'object') Object.keys(value).forEach(k => walk(value[k], where + '.' + k));
    };
    walk(report, ns);
    assert.deepEqual(problems, [], ns + ' i18n audit');
  }
});

test('dialogs are registered under the documented names', () => {
  assert.ok(UI.app.dialogs.has('settings'));
  assert.ok(UI.app.dialogs.has('onboarding'));
  assert.deepEqual(S.SECTIONS, ['profile', 'appearance', 'connections', 'data', 'updates', 'about']);
  assert.equal(S.sectionOf('strava'), 'connections');
  assert.equal(S.sectionOf('backup'), 'data');
  assert.equal(S.sectionOf('nonsense'), 'profile');
  assert.equal(S.INTERVALS_SECRET, 'intervals-api-key', 'same secret name as ui/workout-sheet.js');
});

test('target time: mm:ss, h:mm:ss, Android dots, bare minutes, empty and junk', () => {
  assert.deepEqual(S.parseTarget('20:00'), { seconds: 1200 });
  assert.deepEqual(S.parseTarget('20.00'), { seconds: 1200 });
  assert.deepEqual(S.parseTarget('1.45.00'), { seconds: 6300 });
  assert.deepEqual(S.parseTarget('20'), { seconds: 1200 });
  assert.equal(S.parseTarget('').empty, true);
  assert.equal(S.parseTarget('20:7').invalid, true);
  assert.equal(S.parseKm('7,5'), 7.5);
  assert.equal(S.parseKm('12 km'), 12);
  assert.equal(S.parseKm('0'), null);
  assert.equal(S.presetOf(21.1), '21.1');
  assert.equal(S.presetOf(8), 'custom');
});

test('profile patch: validated through VeyvoStore.setProfile, days kept (0.3 days-reset bug)', () => {
  const state = Store.DEFAULT_STATE();
  const draft = S.draftFromProfile({ name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6] });
  assert.deepEqual(draft, { name: 'Pepa', preset: '5', customKm: '', target: '20:00', days: [1, 6] });
  draft.days = [0, 2, 4];
  draft.target = '19:30';
  const built = S.profilePatch(draft);
  assert.equal(built.ok, true);
  const r = Store.setProfile(state, built.patch);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.profile.days, [0, 2, 4]);
  assert.equal(r.state.profile.targetSeconds, 1170);
  // custom distance + no target
  const custom = S.profilePatch({ name: '', preset: 'custom', customKm: '8', target: '', days: [6] });
  assert.deepEqual(custom.patch, { name: '', goalDistanceKm: 8, targetSeconds: null, days: [6] });
  // errors: "1:30" for a half marathon reads as 90 s -> faster than 2:00/km
  assert.deepEqual(S.profilePatch({ name: 'x', preset: '21.1', customKm: '', target: '1:30', days: [1] }).errors, { target: 'target-implausible' });
  assert.deepEqual(S.profilePatch({ name: 'x', preset: '5', customKm: '', target: 'abc', days: [1] }).errors, { target: 'target-format' });
  assert.deepEqual(S.profilePatch({ name: 'x', preset: 'custom', customKm: '200', target: '', days: [] }).errors, { distance: 'goal-distance-invalid', days: 'days-invalid' });
  assert.equal(S.profilePatch({ name: 'x'.repeat(41), preset: '5', customKm: '', target: '', days: [1] }).errors.name, 'name-too-long');
  // canonical key: '20:00' vs '20.00' is not a change
  assert.equal(S.draftKey({ name: 'a', preset: '5', customKm: '', target: '20:00', days: [1, 6] }), S.draftKey({ name: 'a ', preset: '5', customKm: '9', target: '20.00', days: [6, 1] }));
});

test('goal preview: pace from the draft, best and gap from the runs (VeyvoRuns.goalProgress)', () => {
  const g = S.goalPreview({ name: '', preset: '5', customKm: '', target: '20:00', days: [1] }, RUNS);
  assert.equal(g.pace, 240);
  assert.equal(g.best, 1262);
  assert.equal(g.gap, 62);
  assert.equal(g.reached, false);
  const none = S.goalPreview({ name: '', preset: '10', customKm: '', target: '45:00', days: [1] }, RUNS);
  assert.equal(none.best, null);
  assert.equal(none.pace, 270);
  assert.equal(S.goalPreview({ name: '', preset: 'custom', customKm: 'x', target: '', days: [1] }, RUNS).km, null);
});

test('backup file names, typed confirmation, key masking, intervals athlete name', () => {
  assert.equal(S.backupFileName('2026-11-27', 'cs'), 'veyvo-zaloha-2026-11-27.json');
  assert.equal(S.backupFileName('2026-11-27', 'en'), 'veyvo-backup-2026-11-27.json');
  assert.equal(S.confirmMatches(' smazat ', 'cs'), true);
  assert.equal(S.confirmMatches('DELETE', 'en'), true);
  assert.equal(S.confirmMatches('DELETE', 'cs'), false);
  assert.equal(S.confirmMatches('', 'cs'), false);
  assert.equal(S.maskKey('abcdef1234'), '1234');
  assert.equal(S.maskKey('abc'), '');
  assert.equal(S.athleteName({ name: ' Pepa K ' }), 'Pepa K');
  assert.equal(S.athleteName({ firstname: 'Pepa', lastname: 'K' }), 'Pepa K');
  assert.equal(S.athleteName({}), null);
});

test('wipe state keeps device preferences and clears Strava import bookkeeping', () => {
  const prev = Store.DEFAULT_STATE();
  Object.assign(prev, {
    theme: 'light', language: 'en', runHistory: RUNS, ignoredStravaIds: ['123'],
    strava: { connected: true, lastSync: '2026-11-27T07:00:00.000Z', lastError: 'x' },
    intervals: { enabled: true, lastPush: '2026-11-26T10:00:00.000Z', lastError: null }
  });
  prev.profile = Object.assign({}, prev.profile, { name: 'Pepa', onboarded: true, days: [0, 3] });
  const w = S.wipeState(prev);
  assert.equal(w.runHistory.length, 0);
  assert.deepEqual(w.ignoredStravaIds, []);
  assert.deepEqual(w.strava, { connected: true, lastSync: null, lastError: null });
  assert.equal(w.intervals.enabled, true);
  assert.equal(w.theme, 'light');
  assert.equal(w.language, 'en');
  assert.equal(w.profile.onboarded, false);
  assert.equal(w.profile.name, '');
  assert.equal(Store.migrate(w).schemaVersion, Store.SCHEMA_VERSION);
});

test('import summary counts the backup and dry-runs a merge', () => {
  const current = Store.migrate(Object.assign(Store.DEFAULT_STATE(), { runHistory: RUNS.slice(0, 2) }));
  const backup = Object.assign(Store.DEFAULT_STATE(), { runHistory: RUNS, recoveryLogs: [{ date: '2026-11-24', sleepHours: 7, fatigue: 3, soreness: 2, note: '' }] });
  const parsed = Store.parseBackup(Store.exportBackup(backup, { notes: 'a' }, { appVersion: '0.4.0', exportedAt: new Date('2026-11-25T18:42:00Z') }));
  assert.equal(parsed.ok, true);
  const s = S.importSummary(current, parsed);
  assert.equal(s.runs, 3);
  assert.equal(s.newRuns, 1);
  assert.equal(s.recovery, 1);
  assert.equal(s.nutrition, true);
  assert.equal(s.appVersion, '0.4.0');
  assert.equal(s.firstDate, '2026-11-10');
});

test('updater view states and Strava re-sign-in detection', () => {
  assert.deepEqual(S.updateView(null, false), { key: 'unsupported' });
  assert.deepEqual(S.updateView(null, true), { key: 'idle' });
  const p = S.updateView({ type: 'progress', percent: 62.4, transferred: 1e6, total: 2e6 }, true);
  assert.equal(p.key, 'progress');
  assert.equal(p.percent, 62);
  assert.equal(S.updateView({ type: 'weird' }, true).key, 'error');
  assert.equal(S.updateView({ type: 'ready', version: '0.4.1' }, true).version, '0.4.1');
  // a newer release without its APK is its own state with the release page, not "up to date"
  const newer = S.updateView({ type: 'newer', version: '0.4.1', pageUrl: 'https://github.com/PepiBikerBTW/VEYVO/releases/tag/v0.4.1', checkedAt: '2026-11-27T08:00:00.000Z' }, true);
  assert.deepEqual([newer.key, newer.version, newer.pageUrl, newer.checkedAt], ['newer', '0.4.1', 'https://github.com/PepiBikerBTW/VEYVO/releases/tag/v0.4.1', '2026-11-27T08:00:00.000Z']);
  I18n.setLocale('cs');
  assert.match(UI.app.t('settings.updates.state.newer', { version: '0.4.1' }), /0\.4\.1/);
  assert.ok(I18n.has('settings.updates.state.newerText') && I18n.has('settings.updates.badge.newer'));
  assert.equal(S.isReauthError('Synchronizace Stravy selhala (401).'), true);
  assert.equal(S.isReauthError('Authorization Error'), true);
  assert.equal(S.isReauthError('Nepodařilo se připojit.'), false);
});

test('Czech typography in settings texts: units and one-letter words stay bound', () => {
  I18n.setLocale('cs');
  const NB = ' ';
  assert.ok(UI.app.t('settings.strava.lead').includes('45' + NB + 'dní'));
  assert.ok(UI.app.t('settings.profile.daysCount', { n: 2 }).startsWith('2' + NB + 'dny'));
  assert.equal(UI.app.t('settings.profile.daysCount', { n: 5 }), '5' + NB + 'dní v' + NB + 'týdnu');
  assert.equal(UI.app.t('settings.data.runsLabel', { n: 3 }), 'běhy');
  I18n.setLocale('en');
  assert.equal(UI.app.t('settings.profile.daysCount', { n: 1 }), '1' + NB + 'day a week');
  I18n.setLocale('cs');
});

test('Apple Zdraví on iPhone: connections per platform, card states, import toasts, wipe keeps the switch', () => {
  const STORE = { channel: 'appstore', store: true }, GITHUB = { channel: 'github', store: false };
  assert.deepEqual(S.connectionsFor(STORE, 'ios'), ['health', 'intervals'], 'iPhone: Apple Zdraví instead of Strava');
  assert.deepEqual(S.connectionsFor(GITHUB, 'ios'), ['health', 'intervals']);
  assert.deepEqual(S.connectionsFor(GITHUB, 'desktop'), ['strava', 'intervals'], 'Windows unchanged');
  assert.deepEqual(S.connectionsFor({ channel: 'play', store: true }, 'android'), ['intervals'], 'Google Play unchanged');
  assert.deepEqual(S.connectionsFor(GITHUB, 'android'), ['strava', 'intervals']);
  assert.equal(S.healthKey({ enabled: false, lastImport: null, lastError: null }, false), 'off');
  assert.equal(S.healthKey({ enabled: true, lastImport: '2026-11-27T08:00:00.000Z', lastError: null }, false), 'on');
  assert.equal(S.healthKey({ enabled: true, lastError: 'x' }, false), 'error');
  assert.equal(S.healthKey({ enabled: true, lastError: 'x' }, true), 'importing');
  assert.equal(S.healthKey(undefined, false), 'off');
  assert.deepEqual(S.healthToast({ added: 2, updated: 0 }, 5, false), { key: 'health.imported', n: 2 }, 'an automatic import speaks up only for new runs');
  assert.equal(S.healthToast({ added: 0, updated: 3 }, 5, false), null);
  assert.deepEqual(S.healthToast({ added: 0, updated: 3 }, 5, true), { key: 'health.updated', n: 3 });
  assert.deepEqual(S.healthToast({ added: 0, updated: 0 }, 5, true), { key: 'health.upToDate', n: 5 });
  assert.deepEqual(S.healthToast({ added: 0, updated: 0 }, 0, true), { key: 'health.none', n: 0 });
  assert.equal(S.HEALTH_AUTO_MS, 15 * 60 * 1000);
  assert.equal(typeof S.importHealth, 'function');
  // in Node the platform is the web adapter: importing is a no-op, never a throw
  return S.importHealth({ manual: true }).then(r => {
    assert.deepEqual(r, { ok: false, unsupported: true });
    const prev = Object.assign(Store.DEFAULT_STATE(), {
      ignoredHealthIds: ['11111111-2222-4333-8444-555555555555'],
      health: { enabled: true, lastImport: '2026-11-27T08:00:00.000Z', lastError: 'x' }
    });
    const w = S.wipeState(prev);
    assert.deepEqual(w.health, { enabled: true, lastImport: null, lastError: null }, 'Apple Zdraví stays on and reads 90 days again');
    assert.deepEqual(w.ignoredHealthIds, []);
    assert.deepEqual(Store.migrate(w), w);
  });
});

test('iPhone texts: cs + en, plural forms, and no other platform named', () => {
  const t = (key, locale, params) => I18n.t(key, params || { n: 2 }, locale);
  for (const locale of ['cs', 'en']) {
    for (const key of ['settings.health.title', 'settings.health.lead', 'settings.health.reads', 'settings.health.rules', 'settings.health.permission',
      'settings.health.imported', 'settings.health.skipped', 'settings.health.ignored', 'settings.lead.connectionsIos', 'settings.about.privacyHealth',
      'settings.about.capacitorIos', 'settings.about.platform.ios', 'settings.intervals.storePlainIos', 'store.notice.runDeletedHealth', 'store.notice.healthRestored']) {
      assert.ok(I18n.has(key, locale), key + ' ' + locale);
      assert.doesNotMatch(t(key, locale), /Android|Windows|GitHub|\bAPK\b|Strava/, key + ' ' + locale);
    }
  }
  assert.equal(I18n.t('settings.health.title', null, 'cs'), 'Apple Zdraví');
  assert.equal(I18n.t('settings.health.import', null, 'cs'), 'Importovat běhy');
  assert.equal(I18n.t('settings.health.imported', { n: 3 }, 'cs'), 'Z Apple Zdraví přibyly 3 běhy.');
  assert.equal(I18n.t('settings.health.imported', { n: 1 }, 'en'), '1 run added from Apple Health.');
  assert.match(I18n.t('settings.health.rules', null, 'cs'), /90 dní/);
});
