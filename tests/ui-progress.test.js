// Výkonnost (progress) page: i18n completeness and the pure view-model helpers exported as
// VeyvoUI.progress (range periods, scoreboard, week groups, derived note texts, km by type, volume
// buckets, records, milestones). The derived object is built from the core modules like app.derived().
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
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js', 'progress.js']) require(path.join(SRC, 'ui', file));
const P = globalThis.VeyvoUI.progress;
const I18n = globalThis.VeyvoI18n;
const Runs = globalThis.VeyvoRuns;
const NB = ' ';

// The owner's demo history (tests/visual/screenshots.cjs), Tue + Sun runner, goal 5 km under 20:00.
const BASE = [
  ['2026-10-27', 'easy', 5.2, 1830, 4], ['2026-10-31', 'intervals', 6.0, 1890, 8], ['2026-11-03', 'long', 10.4, 3650, 6],
  ['2026-11-07', 'tempo', 7.0, 2180, 7], ['2026-11-10', 'run', 5.0, 1290, 9], ['2026-11-14', 'easy', 6.1, 2140, 4],
  ['2026-11-17', 'intervals', 6.5, 2010, 8], ['2026-11-21', 'long', 12.0, 4180, 6], ['2026-11-24', 'run', 5.0, 1262, 9]
];
const runsOf = list => list.map(([date, type, distance, movingSeconds, effort], i) => ({ id: 'm-' + (i + 1), source: 'manual', date, type, distance, movingSeconds, effort, note: '' }));
const PROFILE = { name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true };

function derive({ runs = runsOf(BASE), today = '2026-11-27', profile = PROFILE, legacy = [], locale = 'cs' } = {}) {
  I18n.setLocale(locale);
  const sorted = Runs.sortRuns(runs);
  return {
    today, locale, profile, runs: sorted, runsDesc: sorted.slice().reverse(), hasRuns: sorted.length > 0,
    last7: Runs.lastNDays(sorted, today, 7), goal: Runs.goalProgress(profile, sorted), records: Runs.records(sorted),
    notes: Runs.runNotes(sorted, profile), milestones: Runs.milestones(sorted, profile), legacyMilestones: legacy
  };
}

test('progress namespace is complete in Czech and English', () => {
  assert.deepEqual(I18n.audit('progress'), { missing: { cs: [], en: [] }, incompletePlurals: [], placeholderMismatch: [] });
});

test('periods: all = first..last run, 4 weeks and 3 months are whole Monday weeks up to today', () => {
  const d = derive();
  const all = P.periodOf(d.runs, 'all', d.today);
  assert.deepEqual([all.from, all.to, all.runs.length], ['2026-10-27', '2026-11-24', 9]);
  const w4 = P.periodOf(d.runs, '4w', d.today);
  assert.deepEqual([w4.from, w4.to, w4.runs.length], ['2026-11-02', '2026-11-27', 7]);
  const vol = P.volumeBuckets(d.runs, '4w', d.today).list;
  assert.equal(vol[0].weekStart, w4.from, 'the volume bars cover the same weeks');
  assert.equal(vol.reduce((s, w) => s + w.count, 0), w4.runs.length);
  const m3 = P.periodOf(d.runs, '3m', d.today);
  assert.deepEqual([m3.from, m3.runs.length], ['2026-08-31', 9]);
  assert.deepEqual(P.periodOf([], 'all', d.today).runs, []);
});

test('scoreboard: totals of the period, last 7 days and the best 5 km with its −28 s improvement', () => {
  const d = derive();
  const m = P.boardModel(d, 'all');
  assert.equal(m.count, 9);
  assert.equal(m.distanceKm, 63.2);
  assert.equal(m.movingSeconds, 20432);
  assert.equal(Math.round(m.avgPace), 323);
  assert.equal(m.firstDate, '2026-10-27');
  assert.deepEqual([m.last7.distanceKm, m.last7.count], [17, 2]);
  assert.equal(m.best.seconds, 1262);
  assert.equal(m.best.improvement, 28);
  assert.equal(m.best.previousBest, 1290);
  assert.equal(m.best.behindRecord, null);
});

test('scoreboard: a period without the record shows how far its best is behind the record', () => {
  const runs = runsOf(BASE).concat([{ id: 'm-x', source: 'manual', date: '2027-01-12', type: 'run', distance: 5.0, movingSeconds: 1300, effort: 8, note: '' }]);
  const d = derive({ runs, today: '2027-01-14' });
  const m = P.boardModel(d, '4w');
  assert.equal(m.count, 1);
  assert.equal(m.best.seconds, 1300);
  assert.equal(m.best.improvement, null);
  assert.equal(m.best.behindRecord, 38);
  const empty = P.boardModel(derive({ runs, today: '2027-03-30' }), '4w');
  assert.equal(empty.count, 0);
  assert.equal(empty.best, null);
  assert.equal(empty.avgPace, null);
});

test('week groups: newest first, this week / last week, weekly totals', () => {
  const d = derive();
  const groups = P.weekGroups(d.runsDesc, d.today);
  assert.equal(groups.length, 5);
  assert.deepEqual([groups[0].weekStart, groups[0].rel, groups[0].count, groups[0].distanceKm], ['2026-11-23', 'this', 1, 5]);
  assert.deepEqual([groups[1].rel, groups[1].count, groups[1].distanceKm], ['last', 2, 18.5]);
  assert.deepEqual(groups.map(g => g.distanceKm), [5, 18.5, 11.1, 17.4, 11.2]);
});

test('derived notes are translated with Czech typography, most important first', () => {
  const d = derive();
  const pb = P.noteItems(d.notes['m-9']);
  assert.equal(pb[0].text, 'Osobní rekord na 5' + NB + 'km (−28' + NB + 's)');
  assert.equal(pb[0].hot, true);
  const long = P.noteItems(d.notes['m-8']).map(n => n.text);
  assert.deepEqual(long, ['Nejdelší běh (+1,6' + NB + 'km)', '50' + NB + 'km celkem']);
  assert.equal(P.noteItems(d.notes['m-5'])[0].text, 'První měřená pětka');
  assert.deepEqual(P.noteItems(d.notes['m-3']).map(n => n.code), ['firstOver10k', 'longestRun']);
  assert.equal(P.noteItems(d.notes['m-1'])[0].text, 'První zapsaný běh');
  const en = derive({ locale: 'en' });
  assert.equal(P.noteItems(en.notes['m-9'])[0].text, '5' + NB + 'km personal best (−28' + NB + 's)');
  I18n.setLocale('cs');
});

test('km by type: largest first, groups follow the shared series encoding', () => {
  const rows = P.typeTotals(derive().runs);
  assert.deepEqual(rows.map(r => [r.type, r.km, r.count, r.group]), [
    ['long', 22.4, 2, 'easy'], ['intervals', 12.5, 2, 'quality'], ['easy', 11.3, 2, 'easy'], ['run', 10, 2, 'fast'], ['tempo', 7, 1, 'quality']
  ]);
  assert.deepEqual(P.groupCounts(derive().runs), { all: 9, fast: 2, quality: 3, easy: 4 });
});

test('volume buckets: 4 / 13 weeks, all weeks since the first run, months for long histories', () => {
  const d = derive();
  assert.equal(P.volumeBuckets(d.runs, '4w', d.today).list.length, 4);
  assert.equal(P.volumeBuckets(d.runs, '3m', d.today).list.length, 13);
  const all = P.volumeBuckets(d.runs, 'all', d.today);
  assert.equal(all.kind, 'week');
  assert.deepEqual(all.list.map(w => w.distanceKm), [11.2, 17.4, 11.1, 18.5, 5]);
  const old = [{ id: 'o', source: 'manual', date: '2025-01-15', type: 'easy', distance: 8, movingSeconds: 2800, effort: 3, note: '' }].concat(d.runs);
  const months = P.volumeBuckets(old, 'all', d.today);
  assert.equal(months.kind, 'month');
  assert.equal(months.list[0].weekStart, '2025-01-01');
  assert.equal(months.list[0].weekEnd, '2025-01-31');
  assert.equal(months.list[0].distanceKm, 8);
  assert.equal(months.list[months.list.length - 1].weekStart, '2026-11-01');
  assert.equal(months.list[months.list.length - 1].isCurrent, true);
  assert.equal(months.list.reduce((s, m) => s + m.count, 0), 10);
});

test('records: all time, with deltas to the previous record', () => {
  const rows = P.recordRows(derive().records);
  const by = Object.fromEntries(rows.map(r => [r.key, r]));
  assert.deepEqual(rows.map(r => r.key), ['fastest5k', 'fastestPace', 'longestRun', 'longestDuration', 'biggestWeek']);
  assert.equal(by.fastest5k.value, '21:02');
  assert.equal(by.fastest5k.delta, '−28' + NB + 's');
  assert.equal(by.longestRun.delta, '+1,6' + NB + 'km');
  assert.equal(by.longestDuration.delta, '+8:50');
  assert.equal(by.biggestWeek.value, '18,5');
  assert.equal(by.biggestWeek.runId, null);
  assert.deepEqual(P.recordRows({}), []);
});

test('milestones: derived from the runs (never empty with a 5 km result), newest first, legacy merged', () => {
  const d = derive({ legacy: [{ date: '2026-10-20T00:00:00', label: 'Start přípravy' }] });
  const items = P.milestoneItems(d);
  assert.equal(items.length, 9);
  assert.equal(items[0].code, 'personalBest5k');
  assert.equal(items[0].title, 'Osobní rekord na 5' + NB + 'km: 21:02');
  assert.equal(items[0].hot, true);
  assert.equal(items[0].runId, 'm-9');
  const dates = items.map(i => i.date);
  assert.deepEqual(dates, dates.slice().sort().reverse());
  const last = items[items.length - 1];
  assert.deepEqual([last.legacy, last.title, last.runId], [true, 'Start přípravy', null]);
  assert.ok(items.some(i => i.code === 'firstFiveK'));
  assert.deepEqual(P.milestoneItems(derive({ runs: [] })), []);
});
