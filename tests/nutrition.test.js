// Před během / Before the run: the guide engine (src/nutrition-context.js, 0.3 API kept, now cs + en)
// and the page's pure helpers (src/ui/nutrition.js -> VeyvoUI.nutrition): i18n completeness, the
// 'veyvo-pre-run-v1' format, the fuel calculator rules, the timeline and the next-run prefill.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../src/nutrition-context');
const { guide, timeline, fuelBudget } = N;
const NB = '\u00a0';

// ---------------------------------------------------------------- engine (0.3 behaviour)

test('every distance option, 5 km included, has its own preparation', () => {
  const plans = [5, 6, 10, 21.1, 42.2].map(d => guide(d, 120, 'meal'));
  assert.equal(new Set(plans.map(p => p.prep)).size, 5);
  assert.deepEqual(N.DISTANCES.map(d => d.value), ['5', '6', '10', '21.1', '42.2']);
  assert.equal(guide('5', 21, 'meal').name, '5 km');
  assert.equal(guide('21.1', 120, 'meal', 'en').name, 'Half marathon · 21.1 km');
  assert.deepEqual(Object.keys(N.profiles), ['5', '6', '10', '21.1', '42.2'], '0.3 profiles map keeps working');
});

test('fuelling follows duration, not distance', () => {
  assert.match(guide(10, 40, 'meal').fuel, /nejsou potřeba/);
  assert.match(guide(6, 100, 'meal').fuel, /30–60/);
  assert.match(guide(42.2, 240, 'meal').fuel, /až 90/);
  assert.match(guide(42.2, 240, 'meal', 'en').fuel, /up to 90 g/);
  assert.equal(guide(5, 21, 'meal').fuelCode, 'none');
});

test('duration boundaries', () => {
  assert.match(guide(6, 45, 'snack').fuel, /malé množství/);
  assert.match(guide(10, 75, 'snack').fuel, /malé množství/);
  assert.match(guide(10, 76, 'snack').fuel, /30–60/);
  assert.match(guide(21.1, 150, 'snack').fuel, /30–60/);
  assert.match(guide(21.1, 151, 'snack').fuel, /až 90/);
  assert.deepEqual([44, 45, 75, 76, 150, 151].map(N.fuelBand), ['none', 'small', 'small', 'moderate', 'moderate', 'high']);
  assert.deepEqual([120, 150, 151].map(N.rateMax), [60, 60, 90]);
});

test('late start changes meal and flags long runs', () => {
  assert.equal(guide(21.1, 120, 'soon').lateLongRun, true);
  assert.equal(guide(6, 35, 'soon').lateLongRun, false);
  assert.notEqual(guide(10, 60, 'meal').meal.title, guide(10, 60, 'snack').meal.title);
  assert.equal(guide(10, 60, 'snack').meal.name, 'Menší svačina');
  assert.equal(guide(10, 60, 'snack', 'en').meal.name, 'Smaller snack');
});

test('invalid input never produces a plan', () => {
  for (const n of [0, 9, 721, NaN, Infinity, '60', null]) assert.throws(() => guide(6, n, 'meal'), RangeError);
  assert.throws(() => guide(7, 40, 'meal'), RangeError);
  assert.throws(() => guide(6, 40, 'unknown'), RangeError);
  assert.throws(() => guide(6, 5, 'meal', 'en'), /10–720 minutes/);
  assert.doesNotThrow(() => guide(5, 40, 'meal'));
});

test('timeline works across midnight and rejects malformed time', () => {
  assert.equal(timeline('02:30')[0].time, '22:30 (předchozí den) až 00:30');
  assert.equal(timeline('09:00')[0].time, '05:00 až 07:00');
  assert.equal(timeline('02:30', 'en')[0].time, '22:30 (previous day) to 00:30');
  for (const input of ['24:00', '09:60', '', 'no']) assert.throws(() => timeline(input), RangeError);
  const t = timeline('02:30');
  assert.deepEqual(t.map(p => p.code), ['meal', 'snack', 'last', 'start']);
  assert.deepEqual(t.map(p => [p.from, p.to, p.fromPrevDay]), [['22:30', '00:30', true], ['00:30', '01:30', false], ['01:30', '02:30', false], ['02:30', null, false]]);
  assert.deepEqual(N.phases().map(p => [p.offsetFrom, p.offsetTo, p.timing]), [[240, 120, 'meal'], [120, 60, 'snack'], [60, 0, 'soon'], [0, null, null]]);
});

test('the meal phase points UP to the meal options (they are above the timeline)', () => {
  assert.match(timeline('17:00')[0].detail, /výše/);
  assert.doesNotMatch(timeline('17:00')[0].detail, /níže/);
  assert.match(timeline('17:00', 'en')[0].detail, /above/);
});

test('fuel calculator adds whole-run grams and rounds supplies up', () => {
  assert.deepEqual(fuelBudget(120, 30, 25), { grams: 60, servings: 3 });
  assert.deepEqual(fuelBudget(240, 60, 30), { grams: 240, servings: 8 });
});

test('calculator rejects excessive targets and invalid servings', () => {
  for (const args of [[60, 30, 25], [120, 90, 25], [180, 100, 25], [180, 60, 0], [NaN, 30, 25]]) assert.throws(() => fuelBudget(...args), RangeError);
});

test('nearest distance option for the next-run prefill', () => {
  assert.deepEqual([3, 5.2, 6.4, 12, 18, 28, 45].map(N.nearestDistance), ['5', '5', '6', '10', '21.1', '21.1', '42.2']);
  assert.equal(N.nearestDistance(0), '5');
  assert.equal(N.distanceCode('21.1'), 'd21');
  assert.equal(N.distanceCode(42.2), 'd42');
  assert.equal(N.distanceCode('7'), null);
});

test('Czech and English guide texts have the same structure', () => {
  const shape = v => (Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, shape(v[k])])) : typeof v);
  assert.deepEqual(shape(N.MESSAGES.en), shape(N.MESSAGES.cs));
});

test('saved page state: the 0.3 format is read as is, broken data is reported', () => {
  const saved = { nutritionDistance: '6', nutritionMinutes: '35', nutritionTiming: 'snack', nutritionStart: '17:00', nutritionRate: '', nutritionServing: '', nutritionNotes: 'Banán', checks: { meal: true, drink: 'yes' }, extra: 1 };
  const r = N.readSaved(JSON.stringify(saved));
  assert.equal(r.ok, true);
  assert.equal(r.data.nutritionNotes, 'Banán');
  assert.deepEqual(r.data.checks, { meal: true, drink: false });
  assert.equal(r.data.extra, 1, 'unknown keys survive');
  assert.deepEqual(N.readSaved('{oops').ok, false);
  assert.deepEqual(N.readSaved('[1]').ok, false);
  assert.deepEqual(N.readSaved(null), { ok: true, data: { checks: {} } });
  assert.equal(N.readSaved({ nutritionMinutes: 35 }).data.nutritionMinutes, undefined, 'non-string fields are dropped');
  assert.equal(N.STORAGE_KEY, 'veyvo-pre-run-v1');
});

// ---------------------------------------------------------------- page helpers (VeyvoUI.nutrition)

const SRC = path.join(__dirname, '..', 'src');
globalThis.VeyvoFormat = require('../src/core/format.js');
globalThis.VeyvoI18n = require('../src/core/i18n.js');
globalThis.VeyvoRuns = require('../src/core/runs-model.js');
globalThis.VeyvoStore = require('../src/core/store.js');
globalThis.VeyvoWorkouts = require('../src/core/workouts.js');
globalThis.VeyvoTraining = require('../src/training-context.js');
globalThis.VeyvoPlatform = require('../src/platform.js');
globalThis.VeyvoNutrition = N;
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js', 'nutrition.js']) require(path.join(SRC, 'ui', file));
const U = globalThis.VeyvoUI.nutrition;
const I18n = globalThis.VeyvoI18n;
const app = globalThis.VeyvoUI.app;

test('nutrition namespace (page + guide texts) is complete in Czech and English', () => {
  assert.deepEqual(I18n.audit('nutrition'), { missing: { cs: [], en: [] }, incompletePlurals: [], placeholderMismatch: [] });
  I18n.setLocale('cs');
  assert.equal(app.t('nutrition.guide.phase.meal.title'), 'Hlavní jídlo');
  I18n.setLocale('en');
  assert.equal(app.t('nutrition.guide.phase.meal.title'), 'Main meal');
  I18n.setLocale('cs');
});

test('Czech typography and plurals in the page texts', () => {
  I18n.setLocale('cs');
  assert.equal(app.t('nutrition.guide.band.moderate.value'), '30–60' + NB + 'g/h');
  assert.equal(app.t('nutrition.calc.per', { g: 25 }), 'po 25' + NB + 'g, zaokrouhleno nahoru');
  assert.deepEqual([1, 2, 4, 5].map(n => app.t('nutrition.calc.servingsWord', { n })), ['porce', 'porce', 'porce', 'porcí']);
  assert.equal(app.t('nutrition.calc.squaresAria', { n: 5 }), '5' + NB + 'porcí');
  assert.equal(app.t('nutrition.timeline.subStart', { time: '17:30' }), 'Počítáno zpět od startu v' + NB + '17:30');
  I18n.setLocale('en');
  assert.deepEqual([1, 3].map(n => app.t('nutrition.calc.servingsWord', { n })), ['serving', 'servings']);
  I18n.setLocale('cs');
});

test('page values: 5 km is the new default, a saved 0.3 choice is kept', () => {
  const fresh = U.valuesOf({ checks: {} });
  assert.deepEqual([fresh.distance, fresh.timing, fresh.minutes, fresh.start, fresh.done], ['5', 'meal', null, '', 0]);
  const old = U.valuesOf({ nutritionDistance: '6', nutritionMinutes: '35', nutritionTiming: 'soon', nutritionStart: '7:00', checks: { meal: true, gear: true } });
  assert.deepEqual([old.distance, old.timing, old.minutes, old.start, old.done], ['6', 'soon', 35, '', 2]);
  assert.equal(U.valuesOf({ nutritionMinutes: '5' }).minutesError, true);
  assert.equal(U.valuesOf({ nutritionMinutes: '35.5' }).minutes, null, 'whole minutes only, as the 0.3 input');
});

test('serialize writes the 0.3 keys (strings + checks) and keeps unknown keys', () => {
  const out = U.serialize({ nutritionMinutes: '21', checks: { meal: true, legacy: true }, other: 'x' });
  assert.deepEqual(Object.keys(out).sort(), ['checks', 'nutritionDistance', 'nutritionMinutes', 'nutritionNotes', 'nutritionRate', 'nutritionServing', 'nutritionStart', 'nutritionTiming', 'other']);
  assert.equal(out.nutritionDistance, '5');
  assert.equal(out.nutritionTiming, 'meal');
  assert.deepEqual(out.checks, { meal: true, legacy: true, drink: false, fuel: false, route: false, gear: false });
  assert.ok(Object.keys(out).every(k => k === 'checks' || typeof out[k] === 'string' || k === 'other'));
});

test('calculator states follow the 0.3 rules', () => {
  const st = d => U.calcState(U.valuesOf(d));
  assert.equal(st({}).kind, 'noMinutes');
  assert.equal(st({ nutritionMinutes: '75' }).kind, 'short');
  assert.deepEqual(st({ nutritionMinutes: '120' }), { kind: 'missing', max: 60 });
  assert.deepEqual(st({ nutritionMinutes: '120', nutritionRate: '90', nutritionServing: '25' }), { kind: 'invalid', max: 60 });
  assert.deepEqual(st({ nutritionMinutes: '180', nutritionRate: '90', nutritionServing: '25' }), { kind: 'ok', max: 90, grams: 270, servings: 11, serving: 25 });
  assert.equal(st({ nutritionMinutes: '120', nutritionRate: '30', nutritionServing: '0' }).kind, 'invalid');
});

test('timeline rows: the active phase follows "time to the start", clock times only with a start', () => {
  const rel = U.phaseRows(U.valuesOf({ nutritionTiming: 'soon' }), 'cs');
  assert.deepEqual(rel.map(r => [r.code, r.hours, r.from, r.active]), [['meal', 2, null, false], ['snack', 1, null, false], ['last', 1, null, true], ['start', 0, null, false]]);
  const clock = U.phaseRows(U.valuesOf({ nutritionStart: '07:00' }), 'cs');
  assert.deepEqual(clock.map(r => r.from), ['03:00', '05:00', '06:00', '07:00']);
  assert.equal(clock[0].active, true);
});

test('next-run prefill: nearest distance and the planning estimate in minutes', () => {
  const R = globalThis.VeyvoRuns, T = globalThis.VeyvoTraining, W = globalThis.VeyvoWorkouts;
  const base = [['2026-11-10', 'run', 5.0, 1290, 9], ['2026-11-21', 'long', 12.0, 4180, 6], ['2026-11-24', 'run', 5.0, 1262, 9]];
  const runs = R.sortRuns(base.map(([date, type, distance, movingSeconds, effort], i) => ({ id: 'm-' + i, source: 'manual', date, type, distance, movingSeconds, effort, note: '' })));
  const profile = { name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true };
  const today = '2026-11-27';
  const latest = runs[runs.length - 1];
  const nextRun = T.nextRunAfterRun(latest, profile.days, today, latest);
  const paces = W.derivePaces({ best5kSeconds: R.records(runs).fastest5k.value, targetSeconds: 1200 });
  const nextWorkout = W.fromNextRun(nextRun, profile, { locale: 'cs' });
  const nextSession = { source: 'engine', date: nextRun.date, templateId: null, planned: null, workout: nextWorkout };
  const s = U.nextSuggestion({ nextRun, nextWorkout, nextSession, paces });
  assert.ok(s, 'an easy run gives a suggestion');
  assert.equal(s.date, nextRun.date);
  const est = W.estimate(nextWorkout, { easyPaceSecPerKm: (paces.easy.fastSecPerKm + paces.easy.slowSecPerKm) / 2 });
  assert.equal(s.minutes, Math.max(10, Math.round(est.seconds / 60)));
  assert.equal(s.distance, N.nearestDistance(est.distanceM / 1000));
  assert.equal(U.nextSuggestion({ nextRun: { kind: 'rest', date: null }, nextWorkout: null, nextSession: null, paces }), null);
  assert.equal(U.nextSuggestion({ nextRun: null, nextWorkout: null }), null);
});

test('next-run prefill follows derived.nextSession: a library session booked before the engine run wins', () => {
  const Store = globalThis.VeyvoStore;
  const base = [['2026-11-10', 'run', 5.0, 1290, 9], ['2026-11-21', 'long', 12.0, 4180, 6], ['2026-11-24', 'run', 5.0, 1262, 9]];
  const state = Object.assign(Store.DEFAULT_STATE(), {
    profile: { name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true },
    runHistory: base.map(([date, type, distance, movingSeconds, effort], i) => ({ id: 'm-' + i, source: 'manual', date, startTime: null, type, distance, movingSeconds, effort, note: '' })),
    plannedWorkouts: [{ date: '2026-11-28', templateId: 'long' }]
  });
  I18n.setLocale('cs');
  const d = app.deriveFrom(state, '2026-11-27');
  assert.deepEqual([d.nextSession.source, d.nextSession.date], ['planned', '2026-11-28']);
  assert.equal(d.nextRun.date, '2026-11-29', 'the engine still plans Sunday');
  const s = U.nextSuggestion(d);
  assert.equal(s.date, '2026-11-28', 'the booked Saturday session, not the engine run');
  assert.equal(s.name, d.nextSession.workout.name);
  assert.ok(s.km >= 9, 'the long run, not the 3 km easy run: ' + s.km);
});

test('source links match the main-process allowlist exactly', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.equal(U.SOURCES.length, 3);
  for (const s of U.SOURCES) assert.ok(main.includes("'" + s.url + "'"), 'allowlisted: ' + s.url);
  I18n.setLocale('cs');
  assert.match(app.t('nutrition.sources.verified'), /1\.\s10\.\s2026/);
});
