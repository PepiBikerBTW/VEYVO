// VeyvoUI.app derived data (integration rules shared by Přehled, Můj plán and the nav badge):
// the next run keeps today in play until a run is logged that day, and derived.nextSession picks
// whatever comes first - a booked library session or the engine's run. Uses the real
// computeDerived() through VeyvoUI.app.deriveFrom(state, today).
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
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js']) require(path.join(SRC, 'ui', file));
const app = globalThis.VeyvoUI.app;
const { typo } = globalThis.VeyvoUI.fmt;
const NB = ' ';

const BASE = [
  ['2026-10-27', 'easy', 5.2, 1830, 4], ['2026-10-31', 'intervals', 6.0, 1890, 8], ['2026-11-03', 'long', 10.4, 3650, 6],
  ['2026-11-07', 'tempo', 7.0, 2180, 7], ['2026-11-10', 'run', 5.0, 1290, 9], ['2026-11-14', 'easy', 6.1, 2140, 4],
  ['2026-11-17', 'intervals', 6.5, 2010, 8], ['2026-11-21', 'long', 12.0, 4180, 6], ['2026-11-24', 'run', 5.0, 1262, 9]
];
function state({ runs = BASE, planned = [], days = [1, 6] } = {}) {
  const s = globalThis.VeyvoStore.defaultState ? globalThis.VeyvoStore.defaultState() : globalThis.VeyvoStore.load({ getItem: () => null, setItem() {}, removeItem() {} }).state;
  return Object.assign({}, s, {
    profile: { name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days, onboarded: true },
    runHistory: runs.map(([date, type, distance, movingSeconds, effort], i) => ({ id: 'm-' + (i + 1), source: 'manual', date, startTime: null, type, distance, movingSeconds, effort, note: '' })),
    plannedWorkouts: planned
  });
}

test('next run: Sunday is a running day, so on Sunday (nothing logged yet) the run is today', () => {
  const fri = app.deriveFrom(state(), '2026-11-27');
  assert.equal(fri.nextRun.date, '2026-11-29');
  const sun = app.deriveFrom(state(), '2026-11-29');
  assert.equal(sun.nextRun.date, '2026-11-29', 'today stays in play until a run is logged');
  assert.equal(sun.nextRun.distanceKm, 3, 'same prescription as planned on Friday');
  assert.equal(sun.nextSession.date, '2026-11-29');
  assert.equal(sun.weekStrip.find(d => d.date === '2026-11-29').status, 'planned', 'the week strip shows today as planned');
  const logged = app.deriveFrom(state({ runs: BASE.concat([['2026-11-29', 'easy', 3.1, 1080, 4]]) }), '2026-11-29');
  assert.equal(logged.nextRun.date, '2026-12-01', 'after logging today the next run is Tuesday');
});

test('next run: a rest day today does not pull the run forward, a return after a break starts today', () => {
  const sat = app.deriveFrom(state(), '2026-11-28');
  assert.equal(sat.nextRun.date, '2026-11-29', 'Saturday is not a running day');
  const breakRuns = BASE.slice(0, 8); // last run Sat 21. 11.
  const back = app.deriveFrom(state({ runs: breakRuns }), '2026-12-01'); // Tue, 10 days later
  assert.equal(back.nextRun.returnAfterBreak, true);
  assert.equal(back.nextRun.date, '2026-12-01');
});

test('nextSession: a library session booked before the engine run comes first; a tie goes to the booking', () => {
  const sat = app.deriveFrom(state({ planned: [{ date: '2026-11-28', templateId: 'intervals400' }] }), '2026-11-27');
  assert.equal(sat.nextRun.date, '2026-11-29', 'the engine still plans Sunday');
  assert.deepEqual([sat.nextSession.source, sat.nextSession.date, sat.nextSession.templateId], ['planned', '2026-11-28', 'intervals400']);
  assert.equal(sat.nextSession.workout.date, '2026-11-28');
  const tie = app.deriveFrom(state({ planned: [{ date: '2026-11-29', templateId: 'threshold' }] }), '2026-11-27');
  assert.deepEqual([tie.nextSession.source, tie.nextSession.templateId], ['planned', 'threshold']);
  assert.equal(tie.nextWorkout.id, tie.nextSession.workout.id, 'nextWorkout is the booked session on the engine date');
  const later = app.deriveFrom(state({ planned: [{ date: '2026-12-03', templateId: 'long' }] }), '2026-11-27');
  assert.deepEqual([later.nextSession.source, later.nextSession.date], ['engine', '2026-11-29']);
  const past = app.deriveFrom(state({ planned: [{ date: '2026-11-24', templateId: 'easy' }] }), '2026-11-27');
  assert.equal(past.nextSession.source, 'engine', 'a booking on a day with a logged run (or in the past) is not next');
  assert.equal(app.deriveFrom(state({ runs: [] }), '2026-11-27').nextSession, null, 'no runs, nothing booked: no next session');
});

test('typo: a separator only binds between digits, so "21:02, zpět" keeps a normal space after the comma', () => {
  assert.equal(typo('za 21:02, zpět domů', 'cs'), 'za 21:02, zpět domů');
  assert.equal(typo('5,0 km a 1:09:40 h', 'cs'), '5,0' + NB + 'km a' + NB + '1:09:40' + NB + 'h');
  assert.equal(typo('út 24. 11. v 7:30', 'cs'), 'út 24.' + NB + '11.' + NB + 'v' + NB + '7:30', 'ordinal dates bind to the next word');
  assert.equal(typo('3 runs, 12 km', 'en'), '3' + NB + 'runs, 12' + NB + 'km');
});

test('errorText: Strava auth and HTTP codes are translated and keep the status', () => {
  globalThis.VeyvoI18n.setLocale('cs');
  assert.match(app.errorText(Object.assign(new Error('Synchronizace Stravy selhala (401).'), { code: 'auth_required' })), /\(401\)/);
  globalThis.VeyvoI18n.setLocale('en');
  assert.match(app.errorText(Object.assign(new Error('Synchronizace Stravy selhala (503).'), { code: 'strava_http' })), /^Strava answered with error 503.\sTry again later.$/);
  assert.deepEqual(globalThis.VeyvoI18n.audit('ui').missing, { cs: [], en: [] });
  globalThis.VeyvoI18n.setLocale('cs');
});

test('a 5 km test logged at 5.08 km (GPS) keeps a next run, and is the pace baseline; an 8 km test session is not', () => {
  const gps = BASE.slice(0, 8).concat([['2026-11-24', 'test5k', 5.08, 1262, 9]]);
  const d = app.deriveFrom(state({ runs: gps }), '2026-11-27');
  assert.ok(d.nextRun && d.nextRun.kind === 'easy', 'the engine plans the next run');
  assert.equal(d.nextRun.date, '2026-12-01');
  assert.ok(d.nextSession && d.nextWorkout, 'next session and workout exist');
  assert.equal(d.baselineRun.id, 'm-9');
  assert.equal(d.records.fastest5k.runId, 'm-9', 'the records agree');
  // a later easy run gets its paces from that 5,08 km test, not from its own pace
  const easy = app.deriveFrom(state({ runs: gps.concat([['2026-11-26', 'easy', 6, 2160, 4]]) }), '2026-11-27');
  assert.equal(easy.baselineRun.id, 'm-9');
  assert.deepEqual([easy.nextRun.paceFast, easy.nextRun.paceSlow], [Math.round(1262 / 5.08 * 1.2 / 5) * 5, Math.round(1262 / 5.08 * 1.45 / 5) * 5]);
  // a test logged as the whole 8 km session is not a 5 km reference: the latest real 5 km is
  const whole = app.deriveFrom(state({ runs: BASE.concat([['2026-11-26', 'test5k', 8, 2700, 8]]) }), '2026-11-27');
  assert.equal(whole.baselineRun.id, 'm-9');
  assert.ok(whole.nextRun && whole.nextRun.kind === 'easy' && whole.nextRun.date === '2026-11-29');
});
