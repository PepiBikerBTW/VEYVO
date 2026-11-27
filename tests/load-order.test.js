// Browser load-order check: the page loads every shared file as a CLASSIC script (<script src>,
// CSP script-src 'self', no bundler, no module loader). This runs them in the documented order in a
// fresh vm context that has no require/module/process, no eval (like the CSP) and only the web APIs
// a WebView has, then uses every global once.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ORDER = [
  ['src/vendor/workoutkit.js', 'VeyvoWorkoutKit'],
  ['src/core/format.js', 'VeyvoFormat'],
  ['src/core/i18n.js', 'VeyvoI18n'],
  ['src/core/runs-model.js', 'VeyvoRuns'],
  ['src/core/store.js', 'VeyvoStore'],
  ['src/core/workouts.js', 'VeyvoWorkouts'],
  ['src/core/export/fit.js', 'VeyvoFit'],
  ['src/core/export/apple.js', 'VeyvoApple'],
  ['src/core/export/zwo.js', 'VeyvoZwo'],
  ['src/core/export/intervals.js', 'VeyvoIntervals'],
  ['src/training-context.js', 'VeyvoTraining'],
  ['src/platform.js', 'VeyvoPlatform']
];
const SOURCES = new Map(ORDER.map(([file]) => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]));

/** A fresh "browser window": web APIs only, eval disabled, window === globalThis. */
function browserContext(extra) {
  const sandbox = {
    console, setTimeout, clearTimeout, queueMicrotask,
    URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, Blob,
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Electron/38', language: 'cs-CZ' }
  };
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false }, name: 'veyvo-page' });
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', context);
  if (extra) extra(context);
  return context;
}

function load(context, file) {
  const script = new vm.Script(SOURCES.get(file), { filename: file });
  script.runInContext(context);
}

const own = (context) => new Set(vm.runInContext('Object.getOwnPropertyNames(globalThis)', context));

test('classic scripts in the documented order: every global appears right after its file, nothing else leaks', () => {
  const context = browserContext();
  assert.equal(vm.runInContext('typeof require + typeof module + typeof exports + typeof process + typeof Buffer', context), 'undefinedundefinedundefinedundefinedundefined');
  assert.throws(() => vm.runInContext('eval("1")', context), (error) => error.name === 'EvalError', 'the CSP-like context refuses eval');
  const baseline = own(context);
  const expected = new Set(baseline);
  for (const [file, name] of ORDER) {
    assert.equal(vm.runInContext('typeof ' + name, context), 'undefined', name + ' must not exist before ' + file);
    try {
      load(context, file);
    } catch (error) {
      assert.fail(file + ' threw while loading as a classic script: ' + (error && error.stack || error));
    }
    assert.equal(vm.runInContext('typeof ' + name, context), 'object', name + ' defined by ' + file);
    expected.add(name);
    assert.deepEqual([...own(context)].filter((k) => !expected.has(k)), [], file + ' leaks no other globals');
  }
  // Nothing at the top level of one file clashes with another (shared global lexical scope).
  assert.equal(vm.runInContext(ORDER.map(([, name]) => 'typeof ' + name).join(' + "," + '), context), ORDER.map(() => 'object').join(','));
});

test('the loaded page can use every module together (cs + en, data, exports, platform)', () => {
  const context = browserContext();
  for (const [file] of ORDER) load(context, file);
  const legacy = {
    profile: { goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6] },
    runHistory: [
      { id: 1762732800000, source: 'manual', date: '2026-11-10T00:00:00', type: 'Test 5 km', distance: 5, time: '21:30', movingSeconds: 1290, effort: 9 },
      { id: 'strava-16030002', stravaActivityId: '16030002', source: 'strava', date: '2026-11-21T23:40:00Z', type: 'Dlouhý běh', distance: 12, movingSeconds: 4180 },
      { id: 1764028800000, source: 'manual', date: '2026-11-24T00:00:00', type: 'Běh', distance: 5, time: '21:02', movingSeconds: 1262, effort: 9 }
    ],
    stravaActivityIds: ['16030002']
  };
  const result = JSON.parse(vm.runInContext(`(function () {
    const out = {};
    VeyvoPlatform.registerMessages(VeyvoI18n);
    VeyvoI18n.setLocale('cs');
    out.format = [VeyvoFormat.date('2026-11-24'), VeyvoFormat.km(63.2), VeyvoFormat.duration(1262), VeyvoFormat.weekRange('2026-11-23')];
    out.plural = [1, 2, 5, 1.5].map(n => VeyvoI18n.t('common.count.runs', { n }));
    out.texts = [VeyvoI18n.t('store.error.date-future'), VeyvoI18n.t('workouts.library.easy.name', { distanceKm: 3.5 }),
      VeyvoI18n.t('platform.error.file_type_blocked'), VeyvoI18n.has('intervals.' + Object.keys(VeyvoIntervals.MESSAGES.cs)[0] + '.' + Object.keys(Object.values(VeyvoIntervals.MESSAGES.cs)[0])[0])];
    const state = VeyvoStore.migrate(${JSON.stringify(legacy)});
    out.runs = state.runHistory.map(r => r.date + ' ' + r.type + ' ' + (r.startTime || '-'));
    const best = VeyvoRuns.bestEffort(state.runHistory);
    out.best = VeyvoFormat.duration(best.movingSeconds);
    out.goal = VeyvoRuns.goalProgress(state.profile, state.runHistory).gapSeconds;
    const next = VeyvoTraining.nextRunAfterRun(VeyvoRuns.sortRuns(state.runHistory).at(-1), state.profile.days, '2026-11-26');
    out.next = next.date;
    const paces = VeyvoWorkouts.derivePaces({ best5kSeconds: best.movingSeconds, targetSeconds: state.profile.targetSeconds });
    const plan = VeyvoWorkouts.fromNextRun(next, state.profile, { locale: 'cs' });
    const reps = VeyvoWorkouts.library(paces, { locale: 'cs' })[1].workout;
    out.text = VeyvoWorkouts.toText(reps, 'cs');
    const fit = VeyvoFit.toFile(reps, { timeCreated: new Date('2026-11-27T18:30:00Z') });
    out.fit = [fit.name, fit.data.length, fit.data[8] === 0x2e && fit.data[9] === 0x46, VeyvoFit.crc16(fit.data)];
    out.appleAvailable = VeyvoApple.isAvailable();
    out.apple = Array.from(VeyvoApple.encodeWorkout(plan)).length > 0;
    out.zwo = /<sportType>run<\\/sportType>/.test(VeyvoZwo.toZwo(reps, VeyvoZwo.optionsFromPaces(paces)));
    const payload = VeyvoIntervals.toEventsPayload(plan);
    const request = VeyvoIntervals.buildRequest(payload, 'k');
    out.request = VeyvoPlatform.util.normalizeHttpRequest(request).url;
    VeyvoI18n.setLocale('en');
    out.en = [VeyvoFormat.date('2026-11-24'), VeyvoI18n.t('common.count.runs', { n: 2 }), VeyvoWorkouts.toText(plan, 'en')];
    out.platform = [VeyvoPlatform.kind, VeyvoPlatform.supports.http, typeof VeyvoPlatform.saveFile];
    out.audit = VeyvoI18n.audit();
    out.namespaces = Array.from(new Set(VeyvoI18n.keys().map(k => k.split('.')[0]))).sort();
    return JSON.stringify(out);
  })()`, context));
  assert.deepEqual(result.format, ['út 24. 11.', '63,2', '21:02', '23.–29. 11.']);
  assert.deepEqual(result.plural, ['1 běh', '2 běhy', '5 běhů', '1,5 běhu']);
  assert.deepEqual(result.texts, ['Datum nemůže být v budoucnosti.', 'Lehký běh 3,5 km', 'Tento typ souboru VEYVO z bezpečnostních důvodů neuloží.', true]);
  assert.deepEqual(result.runs, ['2026-11-10 test5k -', '2026-11-21 long 23:40', '2026-11-24 run -']);
  assert.equal(result.best, '21:02');
  assert.equal(result.goal, 62);
  assert.equal(result.next, '2026-11-29');
  assert.equal(result.text, 'Rozklus 15 min\n6× (400 m v tempu 3:50–3:57 /km, 200 m klus)\nVyklus 10 min');
  assert.deepEqual(result.fit, ['VEYVO_Useky_6x_400_m.fit', result.fit[1], true, 0]);
  assert.ok(result.fit[1] > 100);
  assert.equal(result.appleAvailable, true);
  assert.equal(result.apple, true);
  assert.equal(result.zwo, true);
  assert.equal(result.request, 'https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true');
  assert.deepEqual(result.en, ['Tue 24 Nov', '2 runs', 'Run 3 km at 5:05–6:05 /km']);
  assert.deepEqual(result.platform, ['web', false, 'function']);
  // Every text registered by any module exists in both languages with the same placeholders.
  assert.deepEqual(result.namespaces, ['common', 'intervals', 'platform', 'store', 'workouts']);
  assert.deepEqual(result.audit, { missing: { cs: [], en: [] }, incompletePlurals: [], placeholderMismatch: [] });
});

test('platform.js picks desktop or Android from the fake window it finds at load time', () => {
  const desktop = browserContext((context) => {
    vm.runInContext('globalThis.veyvo = { saveFile() {}, version: () => Promise.resolve("0.4.0"), http() {}, secrets: { get() {}, set() {}, remove() {} }, garminFindDrives() {}, garminCopy() {} };', context);
  });
  const android = browserContext((context) => {
    vm.runInContext('globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { Filesystem: {}, Share: {}, Preferences: {}, CapacitorHttp: {}, Browser: {}, App: {} } };', context);
  });
  for (const context of [desktop, android]) for (const [file] of ORDER) load(context, file);
  assert.equal(vm.runInContext('VeyvoPlatform.kind + " " + VeyvoPlatform.supports.garmin + " " + VeyvoPlatform.supports.encryptedSecrets', desktop), 'desktop true true');
  assert.equal(vm.runInContext('VeyvoPlatform.kind + " " + VeyvoPlatform.supports.share + " " + VeyvoPlatform.secrets.encrypted', android), 'android true false');
});

test('a wrong order fails loudly with a clear message, never with a ReferenceError later', () => {
  const needs = [
    ['src/core/i18n.js', [], /VeyvoFormat/],
    ['src/core/export/apple.js', ['src/core/format.js'], /VeyvoWorkouts/],
    ['src/core/export/zwo.js', [], /VeyvoWorkouts/],
    ['src/core/export/intervals.js', [], /VeyvoWorkouts/]
  ];
  for (const [file, before, message] of needs) {
    const context = browserContext();
    before.forEach((b) => load(context, b));
    assert.throws(() => load(context, file), (error) => error.name === 'Error' && message.test(error.message), file);
  }
  // Optional partners may come later: workouts.js / store.js / intervals.js register their texts when
  // VeyvoI18n is already there, and VeyvoApple finds VeyvoWorkoutKit loaded after it.
  const late = browserContext();
  for (const file of ['src/core/workouts.js', 'src/core/export/apple.js', 'src/vendor/workoutkit.js']) load(late, file);
  assert.equal(vm.runInContext('VeyvoApple.isAvailable()', late), true);
});
