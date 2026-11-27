const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/core/runs-model.js');
const { nextRunAfter5k, nextRunAfterRun } = require('../src/training-context.js');

const TODAY = '2026-11-26';
const PROFILE = { name: '', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true };

function run(id, date, type, distance, movingSeconds, effort, extra) {
  return Object.assign({ id, source: 'manual', date, startTime: null, type, distance, movingSeconds, effort, note: '' }, extra || {});
}
function demoRuns() {
  return [
    run('m-1', '2026-10-27', 'easy', 5.2, 1830, 4),
    run('m-2', '2026-10-31', 'intervals', 6.0, 1890, 8),
    run('m-3', '2026-11-03', 'long', 10.4, 3650, 6),
    run('m-4', '2026-11-07', 'tempo', 7.0, 2180, 7),
    run('m-5', '2026-11-10', 'run', 5.0, 1290, 9),
    run('m-6', '2026-11-14', 'easy', 6.1, 2140, 4),
    run('m-7', '2026-11-17', 'intervals', 6.5, 2010, 8),
    run('m-8', '2026-11-21', 'long', 12.0, 4180, 6),
    run('m-9', '2026-11-24', 'run', 5.0, 1262, 9)
  ];
}
const close = (actual, expected, digits = 6) => assert.ok(Math.abs(actual - expected) < Math.pow(10, -digits), `${actual} != ${expected}`);

// ---------- helpers ----------

test('calendar helpers use Monday-start weeks and are DST/time-zone safe', () => {
  assert.equal(R.weekStartOf('2026-11-26'), '2026-11-23');
  assert.equal(R.weekStartOf('2026-11-23'), '2026-11-23');
  assert.equal(R.weekStartOf('2026-11-29'), '2026-11-23');
  assert.equal(R.weekdayIndex('2026-11-24'), 1);
  assert.equal(R.weekdayIndex('2026-11-29'), 6);
  assert.equal(R.addDays('2026-10-25', 1), '2026-10-26'); // European DST change
  assert.equal(R.addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(R.daysBetween('2026-11-10', '2026-11-24'), 14);
  assert.equal(R.isDateKey('2026-02-29'), false);
  assert.equal(R.isDateKey('2028-02-29'), true);
  assert.equal(R.isDateKey('2026-11-24T00:00:00'), false);
});

test('run type codes are ordered and legacy Czech labels map to codes', () => {
  assert.deepEqual(R.RUN_TYPES, ['run', 'easy', 'long', 'tempo', 'intervals', 'test5k', 'race']);
  assert.ok(Object.isFrozen(R.RUN_TYPES));
  assert.equal(R.typeCode('Test 5 km'), 'test5k');
  assert.equal(R.typeCode('Lehký běh'), 'easy');
  assert.equal(R.typeCode('Dlouhý běh'), 'long');
  assert.equal(R.typeCode('Intervaly'), 'intervals');
  assert.equal(R.typeCode('Závod'), 'race');
  assert.equal(R.typeCode('Běh'), 'run');
  assert.equal(R.typeCode('tempo'), 'tempo');
  assert.equal(R.typeCode('something else'), 'run');
  assert.equal(R.typeCode(undefined), 'run');
});

test('invalid runs are ignored everywhere and sortRuns is chronological', () => {
  const runs = [null, 'x', { id: 'bad-date', date: 'nope', distance: 5, movingSeconds: 1300 }, run('zero', '2026-11-01', 'run', 0, 100, 5),
    run('no-time', '2026-11-01', 'run', 5, null, 5), run('b', '2026-11-02', 'run', 3, 1000, 5), run('a', '2026-11-01', 'run', 4, 1500, 5)];
  assert.deepEqual(R.sortRuns(runs).map(r => r.id), ['a', 'b']);
  assert.equal(R.totals(runs).count, 2);
  assert.equal(R.isValidRun(runs[4]), false);
  assert.equal(R.totals(undefined).count, 0);
  // legacy time string is accepted when movingSeconds is missing
  assert.equal(R.paceSecPerKm({ date: '2026-11-01', distance: 5, time: '25:00' }), 300);
});

test('same-day runs are ordered by start time, then by input order', () => {
  const runs = [run('evening', '2026-11-01', 'easy', 3, 1100, 3, { startTime: '18:00' }), run('morning', '2026-11-01', 'easy', 3, 1100, 3, { startTime: '07:00' })];
  assert.deepEqual(R.sortRuns(runs).map(r => r.id), ['morning', 'evening']);
  assert.deepEqual(R.runNotes(runs).morning.map(n => n.code), ['firstRun']);
});

// ---------- attempts and best efforts ----------

test('only real 5 km attempts count: 4.95-5.2 km and run / test5k / race', () => {
  const base = { date: '2026-11-24', movingSeconds: 1262 };
  for (const type of ['run', 'test5k', 'race', 'Test 5 km', 'Závod', 'Běh']) assert.equal(R.isFiveKAttempt({ ...base, type, distance: 5 }), true, type);
  for (const type of ['easy', 'long', 'tempo', 'intervals', 'Lehký běh']) assert.equal(R.isFiveKAttempt({ ...base, type, distance: 5 }), false, type);
  assert.equal(R.isFiveKAttempt({ ...base, type: 'run', distance: 4.95 }), true);
  assert.equal(R.isFiveKAttempt({ ...base, type: 'run', distance: 5.2 }), true);
  assert.equal(R.isFiveKAttempt({ ...base, type: 'run', distance: 4.94 }), false);
  assert.equal(R.isFiveKAttempt({ ...base, type: 'run', distance: 5.21 }), false);
  assert.equal(R.isFiveKAttempt({ ...base, type: 'run', distance: 5, movingSeconds: 130 }), false); // typo: 2:10 for 5 km
  assert.equal(R.isFiveKAttempt({ ...base, type: 'run', distance: 5, movingSeconds: null }), false);
  assert.equal(R.isFiveKAttempt(null), false);
});

test('best effort uses raw moving time of real attempts, never scaled runs', () => {
  const runs = demoRuns();
  assert.equal(R.bestEffort(runs, { distanceKm: 5 }).id, 'm-9');
  assert.equal(R.bestEffort(runs).id, 'm-9');
  // a 5.2 km easy run in 20:00 is not a 5 km result
  assert.equal(R.bestEffort([...runs, run('easy-fast', '2026-11-25', 'easy', 5.2, 1200, 5)]).id, 'm-9');
  // a 5.2 km test is a real attempt and is compared by its moving time as-is
  assert.equal(R.bestEffort([...runs, run('t', '2026-11-25', 'test5k', 5.2, 1250, 9)]).id, 't');
  // ties keep the earlier run
  assert.equal(R.bestEffort([...runs, run('tie', '2026-11-25', 'race', 5, 1262, 9)]).id, 'm-9');
  // the 10.4 km long run is not a 10 km attempt; only run / race within +-3 % counts
  assert.equal(R.bestEffort(runs, { distanceKm: 10 }), null);
  assert.equal(R.isAttempt(run('r', '2026-11-25', 'race', 10.3, 2900, 9), 10), true);
  assert.equal(R.isAttempt(run('r', '2026-11-25', 'race', 10.31, 2900, 9), 10), false);
  assert.equal(R.isAttempt(run('r', '2026-11-25', 'long', 10, 2900, 9), 10), false);
  assert.equal(R.bestEffort([], { distanceKm: 5 }), null);
});

test('5 km progression is chronological with personal-best flags and deltas', () => {
  const runs = [...demoRuns(), run('slow', '2026-11-29', 'run', 5, 1275, 8)];
  const p = R.fiveKProgression(runs);
  assert.deepEqual(p.map(x => [x.runId, x.date, x.seconds, x.isPersonalBest, x.deltaToPreviousBest]), [
    ['m-5', '2026-11-10', 1290, true, null],
    ['m-9', '2026-11-24', 1262, true, -28],
    ['slow', '2026-11-29', 1275, false, 13]
  ]);
  close(p[1].pace, 252.4);
  assert.equal(p[2].previousBest, 1262);
  assert.deepEqual(R.fiveKProgression([]), []);
});

// ---------- totals ----------

test('owner demo: totals, pace and last 7 days', () => {
  const runs = demoRuns();
  const t = R.totals(runs);
  assert.equal(t.count, 9);
  assert.equal(t.distanceKm, 63.2);
  assert.equal(t.movingSeconds, 20432);
  close(t.avgPaceSecPerKm, 20432 / 63.2);
  close(R.paceSecPerKm(runs[8]), 252.4);
  assert.equal(R.paceSecPerKm({ distance: 0, movingSeconds: 10, date: '2026-11-01' }), null);

  const week = R.lastNDays(runs, TODAY, 7);
  assert.equal(week.distanceKm, 17);
  assert.equal(week.count, 2);
  assert.equal(week.movingSeconds, 4180 + 1262);
  assert.equal(week.from, '2026-11-20');
  assert.equal(week.to, TODAY);
  assert.equal(R.lastNDays(runs, TODAY).distanceKm, 17);
  const month = R.lastNDays(runs, TODAY, 28);
  assert.equal(month.count, 8);
  assert.equal(month.distanceKm, 58);
  // future-dated runs are not part of "the last n days"
  assert.equal(R.lastNDays([...runs, run('f', '2026-11-27', 'easy', 4, 1400, 3)], TODAY, 7).distanceKm, 17);
  assert.deepEqual(R.totals([]), { count: 0, distanceKm: 0, movingSeconds: 0, avgPaceSecPerKm: null });
  assert.throws(() => R.lastNDays(runs, '26. 11. 2026', 7), TypeError);
  assert.throws(() => R.lastNDays(runs, TODAY, 0), RangeError);
});

test('owner demo: weekly totals are Monday-start, oldest to newest', () => {
  const runs = demoRuns();
  const weeks = R.weeklyTotals(runs, TODAY, 5);
  assert.deepEqual(weeks.map(w => w.weekStart), ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  assert.deepEqual(weeks.map(w => w.weekEnd), ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
  assert.deepEqual(weeks.map(w => w.distanceKm), [11.2, 17.4, 11.1, 18.5, 5]);
  assert.deepEqual(weeks.map(w => w.count), [2, 2, 2, 2, 1]);
  assert.deepEqual(weeks.map(w => w.isCurrent), [false, false, false, false, true]);
  assert.equal(weeks[3].movingSeconds, 2010 + 4180);
  assert.deepEqual(weeks[3].byType.intervals, { count: 1, distanceKm: 6.5 });
  assert.deepEqual(weeks[3].byType.long, { count: 1, distanceKm: 12 });
  assert.deepEqual(weeks[3].byType.easy, { count: 0, distanceKm: 0 });
  assert.deepEqual(Object.keys(weeks[0].byType), R.RUN_TYPES);

  const twelve = R.weeklyTotals(runs, TODAY);
  assert.equal(twelve.length, 12);
  assert.equal(twelve[0].weekStart, '2026-09-07');
  assert.equal(twelve[11].weekStart, '2026-11-23');
  assert.equal(Math.round(twelve.reduce((s, w) => s + w.distanceKm, 0) * 10) / 10, 63.2);
  assert.equal(twelve[0].distanceKm, 0);
  // a short window drops older runs
  assert.deepEqual(R.weeklyTotals(runs, TODAY, 2).map(w => w.distanceKm), [18.5, 5]);
  assert.throws(() => R.weeklyTotals(runs, '2026-13-01'), TypeError);
  assert.throws(() => R.weeklyTotals(runs, TODAY, 0), RangeError);
});

test('weeks across a year boundary start on Monday', () => {
  const weeks = R.weeklyTotals([run('ny', '2027-01-01', 'easy', 5, 1800, 3)], '2027-01-03', 2);
  assert.deepEqual(weeks.map(w => w.weekStart), ['2026-12-21', '2026-12-28']);
  assert.equal(weeks[1].distanceKm, 5);
});

// ---------- goal progress ----------

test('owner demo: goal progress 21:02 vs 20:00', () => {
  const g = R.goalProgress(PROFILE, demoRuns());
  assert.equal(g.distanceKm, 5);
  assert.equal(g.attempts, 2);
  assert.equal(g.best, 1262);
  assert.equal(g.bestDate, '2026-11-24');
  assert.equal(g.bestRunId, 'm-9');
  assert.equal(g.target, 1200);
  assert.equal(g.gapSeconds, 62);
  assert.equal(g.reached, false);
  close(g.bestPace, 252.4);
  assert.equal(g.targetPace, 240);
  close(g.pacePerKmGap, 12.4);
  assert.equal(g.previousBest, 1290);
  assert.equal(g.previousBestDate, '2026-11-10');
  assert.equal(g.improvementSeconds, 28);
  assert.equal(g.improvementDays, 14);
  assert.equal(g.firstAttempt, 1290);
  assert.equal(g.firstAttemptDate, '2026-11-10');
  close(g.fraction, 28 / 90);
  assert.deepEqual(g.checkpoints, [
    { seconds: 1260, reached: false, reachedDate: null, isGoal: false },
    { seconds: 1230, reached: false, reachedDate: null, isGoal: false },
    { seconds: 1200, reached: false, reachedDate: null, isGoal: true }
  ]);
  assert.deepEqual(g.next, { seconds: 1260, missingSeconds: 2 });
});

test('goal progress marks checkpoints as they are reached and the goal itself', () => {
  const runs = [...demoRuns(), run('a', '2026-11-29', 'test5k', 5, 1255, 9)];
  let g = R.goalProgress(PROFILE, runs);
  assert.deepEqual(g.checkpoints.map(c => [c.seconds, c.reached, c.reachedDate]), [[1260, true, '2026-11-29'], [1230, false, null], [1200, false, null]]);
  assert.deepEqual(g.next, { seconds: 1230, missingSeconds: 25 });
  assert.equal(g.previousBest, 1262);
  assert.equal(g.improvementSeconds, 7);
  assert.equal(g.improvementDays, 5);

  runs.push(run('b', '2026-12-06', 'race', 5, 1199, 10));
  g = R.goalProgress(PROFILE, runs);
  assert.equal(g.reached, true);
  assert.equal(g.gapSeconds, -1);
  assert.equal(g.fraction, 1);
  assert.equal(g.next, null);
  assert.deepEqual(g.checkpoints.map(c => c.reachedDate), ['2026-11-29', '2026-12-06', '2026-12-06']);
});

test('checkpoint ladder uses round marks below the first attempt and adapts its step', () => {
  assert.deepEqual(R.checkpointLadder(1290, 1200), [1260, 1230, 1200]);
  assert.deepEqual(R.checkpointLadder(1291, 1200), [1290, 1260, 1230, 1200]);
  assert.deepEqual(R.checkpointLadder(1215, 1200), [1200]);
  assert.deepEqual(R.checkpointLadder(1190, 1200), [1200]);
  assert.deepEqual(R.checkpointLadder(1620, 1200), [1560, 1440, 1320, 1200]); // 27:00 -> 20:00 in 2-minute marks
  assert.deepEqual(R.checkpointLadder(3600, 2700), [3300, 3000, 2700]);       // 60:00 -> 45:00 in 5-minute marks
  assert.deepEqual(R.checkpointLadder(1290, 1185), [1260, 1230, 1200, 1185]); // non-round target stays last
  assert.deepEqual(R.checkpointLadder(1290, 1200, 60), [1260, 1200]);
  assert.deepEqual(R.checkpointLadder(null, 1200), []);
  assert.deepEqual(R.checkpointLadder(9000, 1200), [7200, 5400, 3600, 1800, 1200]);
  assert.ok(R.checkpointLadder(100000, 1200).length <= 6);
  // A tiny or absurd custom step never builds millions of marks (it used to: 1.8 M for 0.001 s).
  const started = Date.now();
  assert.deepEqual(R.checkpointLadder(3000, 1200, 0.001), R.checkpointLadder(3000, 1200));
  assert.deepEqual(R.checkpointLadder(172800, 60, 1e-9), R.checkpointLadder(172800, 60));
  assert.deepEqual(R.checkpointLadder(1290, 1200, 1), R.checkpointLadder(1290, 1200, 1).slice(0, 90), 'step 1 s still allowed (90 marks)');
  assert.ok(Date.now() - started < 200);
  assert.ok(R.goalProgress(PROFILE, demoRuns(), { checkpointStep: 1e-6 }).checkpoints.length <= 6);
});

test('goal progress without attempts or without a target returns null fields', () => {
  const easyOnly = demoRuns().filter(r => r.type !== 'run');
  const empty = R.goalProgress(PROFILE, easyOnly);
  assert.equal(empty.attempts, 0);
  assert.equal(empty.best, null);
  assert.equal(empty.bestDate, null);
  assert.equal(empty.gapSeconds, null);
  assert.equal(empty.fraction, null);
  assert.equal(empty.firstAttempt, null);
  assert.equal(empty.previousBest, null);
  assert.deepEqual(empty.checkpoints, []);
  assert.equal(empty.next, null);
  assert.equal(empty.target, 1200);
  assert.equal(empty.targetPace, 240);
  assert.equal(R.goalProgress(undefined, []).distanceKm, 5);

  const noTarget = R.goalProgress({ goalDistanceKm: 5, targetSeconds: null, days: [1, 6] }, demoRuns());
  assert.equal(noTarget.best, 1262);
  assert.equal(noTarget.improvementSeconds, 28);
  assert.equal(noTarget.target, null);
  assert.equal(noTarget.targetPace, null);
  assert.equal(noTarget.gapSeconds, null);
  assert.equal(noTarget.fraction, null);
  assert.deepEqual(noTarget.checkpoints, []);

  const single = R.goalProgress(PROFILE, [run('one', '2026-11-10', 'run', 5, 1290, 9)]);
  assert.equal(single.best, 1290);
  assert.equal(single.previousBest, null);
  assert.equal(single.improvementSeconds, null);
  assert.equal(single.improvementDays, null);
  assert.equal(single.fraction, 0);
  assert.deepEqual(single.next, { seconds: 1260, missingSeconds: 30 });
});

test('goal progress for another distance uses best effort within +-3 %', () => {
  const profile = { goalDistanceKm: 10, targetSeconds: 2700, days: [1, 6] };
  const runs = [...demoRuns(),
    run('r1', '2026-11-01', 'race', 10.2, 3000, 9),
    run('r2', '2026-11-15', 'run', 9.8, 2950, 9),
    run('far', '2026-11-20', 'run', 10.5, 2800, 9),
    run('long', '2026-11-22', 'long', 10, 2700, 6)];
  const g = R.goalProgress(profile, runs);
  assert.equal(g.distanceKm, 10);
  assert.equal(g.best, 2950);
  assert.equal(g.bestRunId, 'r2');
  close(g.bestPace, 2950 / 9.8);
  assert.equal(g.targetPace, 270);
  assert.equal(g.previousBest, 3000);
  assert.equal(g.improvementSeconds, 50);
  assert.equal(g.gapSeconds, 250);
  assert.deepEqual(g.checkpoints.map(c => c.seconds), [2940, 2880, 2820, 2760, 2700]);
  close(g.fraction, 50 / 300);
});

// ---------- records ----------

test('owner demo: records with previous holders', () => {
  const r = R.records(demoRuns());
  assert.equal(r.fastest5k.value, 1262);
  assert.equal(r.fastest5k.date, '2026-11-24');
  assert.equal(r.fastest5k.runId, 'm-9');
  assert.deepEqual(r.fastest5k.previous, { value: 1290, date: '2026-11-10', runId: 'm-5' });
  assert.equal(r.fastest5k.delta, -28);

  close(r.fastestPace.value, 252.4);
  assert.equal(r.fastestPace.date, '2026-11-24');
  close(r.fastestPace.previous.value, 258);
  close(r.fastestPace.delta, -5.6);

  assert.equal(r.longestRun.value, 12);
  assert.equal(r.longestRun.date, '2026-11-21');
  assert.deepEqual(r.longestRun.previous, { value: 10.4, date: '2026-11-03', runId: 'm-3' });
  assert.equal(r.longestRun.delta, 1.6);

  assert.equal(r.longestDuration.value, 4180);
  assert.equal(r.longestDuration.previous.value, 3650);
  assert.equal(r.longestDuration.delta, 530);

  assert.equal(r.biggestWeek.weekStart, '2026-11-16');
  assert.equal(r.biggestWeek.date, '2026-11-16');
  assert.equal(r.biggestWeek.distanceKm, 18.5);
  assert.equal(r.biggestWeek.value, 18.5);
  assert.equal(r.biggestWeek.count, 2);
  assert.deepEqual(r.biggestWeek.previous, { value: 17.4, date: '2026-11-02', weekStart: '2026-11-02' });
  assert.equal(r.biggestWeek.delta, 1.1);

  // 2 runs every week: the first week holds the record, ties do not replace it
  assert.equal(r.mostRunsWeek.value, 2);
  assert.equal(r.mostRunsWeek.weekStart, '2026-10-26');
  assert.equal(r.mostRunsWeek.previous, null);
  assert.equal(r.mostRunsWeek.delta, null);
});

test('records: fastest pace needs at least 3 km and records are null without data', () => {
  const r = R.records([run('short', '2026-11-01', 'intervals', 2, 400, 9), run('ok', '2026-11-02', 'easy', 3, 1000, 3)]);
  assert.equal(r.fastestPace.runId, 'ok');
  assert.equal(r.fastest5k, null);
  assert.equal(r.longestRun.previous.value, 2);
  const none = R.records([]);
  for (const key of ['fastest5k', 'fastestPace', 'longestRun', 'longestDuration', 'biggestWeek', 'mostRunsWeek']) assert.equal(none[key], null, key);
});

// ---------- notes and milestones ----------

test('owner demo: derived run notes are evaluated chronologically', () => {
  const notes = R.runNotes(demoRuns(), PROFILE);
  assert.deepEqual(notes['m-1'], [{ code: 'firstRun', params: {} }]);
  assert.deepEqual(notes['m-2'], [{ code: 'longestRun', params: { distanceKm: 6, previousKm: 5.2, deltaKm: 0.8 } }]);
  assert.deepEqual(notes['m-3'], [
    { code: 'firstOver10k', params: { distanceKm: 10.4 } },
    { code: 'longestRun', params: { distanceKm: 10.4, previousKm: 6, deltaKm: 4.4 } }
  ]);
  assert.deepEqual(notes['m-4'], []);
  assert.deepEqual(notes['m-5'], [{ code: 'personalBest5k', params: { seconds: 1290, previousBest: null, improvementSeconds: null } }]);
  assert.deepEqual(notes['m-8'], [
    { code: 'longestRun', params: { distanceKm: 12, previousKm: 10.4, deltaKm: 1.6 } },
    { code: 'distanceMilestone', params: { km: 50, totalKm: 58.2 } }
  ]);
  assert.deepEqual(notes['m-9'], [{ code: 'personalBest5k', params: { seconds: 1262, previousBest: 1290, improvementSeconds: 28 } }]);
  assert.equal(Object.keys(notes).length, 9);
});

test('checkpoint notes match the goal ladder and need a target', () => {
  const runs = [...demoRuns(), run('a', '2026-11-29', 'run', 5, 1255, 9), run('b', '2026-12-06', 'race', 5, 1199, 10)];
  const notes = R.runNotes(runs, PROFILE);
  assert.deepEqual(notes.a, [
    { code: 'personalBest5k', params: { seconds: 1255, previousBest: 1262, improvementSeconds: 7 } },
    { code: 'checkpoint', params: { seconds: 1260, isGoal: false } }
  ]);
  assert.deepEqual(notes.b.filter(n => n.code === 'checkpoint').map(n => n.params), [{ seconds: 1230, isGoal: false }, { seconds: 1200, isGoal: true }]);
  // a slower attempt never re-crosses a mark
  const slower = R.runNotes([...runs, run('c', '2026-12-08', 'run', 5, 1240, 8)], PROFILE);
  assert.deepEqual(slower.c, []);
  // without a profile target there are no checkpoint notes
  assert.equal(Object.values(R.runNotes(runs)).flat().some(n => n.code === 'checkpoint'), false);
  // reached dates in goalProgress agree with the notes
  const g = R.goalProgress(PROFILE, runs);
  assert.deepEqual(g.checkpoints.map(c => c.reachedDate), ['2026-11-29', '2026-12-06', '2026-12-06']);
  // custom step is shared by both
  const coarse = R.runNotes(runs, PROFILE, { checkpointStep: 60 });
  assert.deepEqual(coarse.a.filter(n => n.code === 'checkpoint').map(n => n.params.seconds), [1260]);
});

test('cumulative distance milestones fire once each when crossed', () => {
  const runs = Array.from({ length: 26 }, (_, i) => run('r' + i, R.addDays('2026-01-05', i * 3), 'easy', 10, 3600, 4));
  const list = R.milestones(runs, PROFILE).filter(m => m.code === 'distanceMilestone');
  assert.deepEqual(list.map(m => [m.runId, m.params.km]), [['r4', 50], ['r9', 100], ['r24', 250]]);
  const notes = R.runNotes(runs);
  assert.deepEqual(notes.r0.map(n => n.code), ['firstRun', 'firstOver10k']);
  assert.equal(notes.r1.some(n => n.code === 'longestRun'), false); // equal distance is not a new longest
});

test('owner demo: milestones list is chronological', () => {
  const list = R.milestones(demoRuns(), PROFILE);
  assert.deepEqual(list.map(m => [m.date, m.code]), [
    ['2026-10-27', 'firstRun'],
    ['2026-10-31', 'longestRun'],
    ['2026-11-03', 'firstOver10k'],
    ['2026-11-03', 'longestRun'],
    ['2026-11-10', 'personalBest5k'],
    ['2026-11-21', 'longestRun'],
    ['2026-11-21', 'distanceMilestone'],
    ['2026-11-24', 'personalBest5k']
  ]);
  assert.equal(list[7].runId, 'm-9');
  assert.equal(list[7].params.improvementSeconds, 28);
  assert.deepEqual(R.milestones([], PROFILE), []);
});

// ---------- week strip ----------

test('owner demo: week strip Monday..Sunday with Tuesday + Sunday availability', () => {
  const runs = demoRuns();
  const nextRun = nextRunAfterRun(runs[8], PROFILE.days, TODAY);
  assert.equal(nextRun.date, '2026-11-29');
  const strip = R.weekStrip(runs, { todayKey: TODAY, profile: PROFILE, nextRun });
  assert.equal(strip.length, 7);
  assert.deepEqual(strip.map(d => d.date), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  assert.deepEqual(strip.map(d => d.status), ['rest', 'done', 'rest', 'rest', 'rest', 'rest', 'planned']);
  assert.deepEqual(strip.map(d => d.isToday), [false, false, false, true, false, false, false]);
  assert.deepEqual(strip.map(d => d.isPast), [true, true, true, false, false, false, false]);
  assert.deepEqual(strip.map(d => d.weekday), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(strip[1].runs.map(r => r.id), ['m-9']);
  assert.deepEqual(strip[6].planned, nextRun);
  assert.notEqual(strip[6].planned, nextRun); // a copy
  assert.equal(strip[0].planned, undefined);

  const withoutPlan = R.weekStrip(runs, { todayKey: TODAY, profile: PROFILE });
  assert.equal(withoutPlan[6].status, 'available');
  assert.equal(R.weekStrip(runs, { todayKey: TODAY, profile: PROFILE, nextRun: { kind: 'rest', date: null } })[6].status, 'available');
});

test('week strip: today on a run day, no fixed days, previous week and year boundary', () => {
  const runs = demoRuns();
  const thursday = R.weekStrip(runs, { todayKey: TODAY, profile: { days: [3, 6] } });
  assert.equal(thursday[3].status, 'today');
  assert.equal(thursday[1].status, 'done'); // a run on a rest day is still done
  assert.equal(thursday[1].isRunDay, false);
  const free = R.weekStrip(runs, { todayKey: TODAY, profile: { days: [] } });
  assert.deepEqual(free.map(d => d.status), ['available', 'done', 'available', 'today', 'available', 'available', 'available']);
  const lastWeek = R.weekStrip(runs, { todayKey: TODAY, profile: PROFILE, offset: -1 });
  assert.equal(lastWeek[0].date, '2026-11-16');
  assert.deepEqual(lastWeek.map(d => d.status), ['rest', 'done', 'rest', 'rest', 'rest', 'done', 'available']);
  assert.equal(lastWeek.every(d => d.isPast), true);
  const newYear = R.weekStrip([], { todayKey: '2026-12-31', profile: PROFILE });
  assert.deepEqual([newYear[0].date, newYear[6].date], ['2026-12-28', '2027-01-03']);
  assert.throws(() => R.weekStrip(runs, { profile: PROFILE }), TypeError);
});

// ---------- Strava dedupe ----------

test('duplicate detection matches manual and Strava both ways within tolerance', () => {
  const runs = demoRuns();
  const strava = { id: 'strava-99', source: 'strava', stravaActivityId: '99', date: '2026-11-24', startTime: '19:30', type: 'run', distance: 5.04, movingSeconds: 1300, effort: null, note: '', name: 'Večerní běh' };
  assert.equal(R.findDuplicate(runs, strava).id, 'm-9');
  assert.equal(R.findDuplicate(runs, { ...strava, movingSeconds: 1262 + 90 }), null);   // |Δs| must be < 90
  assert.equal(R.findDuplicate(runs, { ...strava, movingSeconds: 1262 + 89 }).id, 'm-9');
  assert.equal(R.findDuplicate(runs, { ...strava, distance: 4.85 }), null);              // |Δkm| must be < 0.15
  assert.equal(R.findDuplicate(runs, { ...strava, distance: 5.149 }).id, 'm-9');
  assert.equal(R.findDuplicate(runs, { ...strava, date: '2026-11-23' }), null);
  // two manual entries are not treated as duplicates
  assert.equal(R.findDuplicate(runs, run('m-10', '2026-11-24', 'run', 5, 1262, 9)), null);
  // the other way: manual candidate against an imported Strava run
  const imported = [{ ...strava }];
  assert.equal(R.findDuplicate(imported, run('m-11', '2026-11-24', 'run', 5, 1290, 9)).id, 'strava-99');
  // the same Strava activity is always a duplicate
  assert.equal(R.findDuplicate(imported, { ...strava, distance: 8, movingSeconds: 3000 }).id, 'strava-99');
  // the candidate itself is skipped
  assert.equal(R.findDuplicate(runs, runs[8]), null);
  // the closest match wins
  const twins = [run('far', '2026-11-24', 'run', 5.1, 1340, 9), run('near', '2026-11-24', 'run', 5.03, 1298, 9)];
  assert.equal(R.findDuplicate(twins, strava).id, 'near');
  assert.equal(R.findDuplicate(runs, null), null);
});

test('merging Strava into a manual run keeps the owner input and takes Strava measurements', () => {
  const manual = run('m-9', '2026-11-24', 'test5k', 5, 1262, 9, { note: 'Cítil jsem se dobře', time: '21:02' });
  const strava = { id: 'strava-99', source: 'strava', stravaActivityId: '99', date: '2026-11-24', startTime: '19:30', type: 'run', distance: 5.04,
    movingSeconds: 1264, effort: null, note: '', name: 'Večerní běh', averageHeartrate: 176, elevationGain: 12 };
  const manualCopy = JSON.parse(JSON.stringify(manual)), stravaCopy = JSON.parse(JSON.stringify(strava));
  const merged = R.mergeStravaIntoManual(manual, strava);
  assert.deepEqual(merged, {
    id: 'strava-99', source: 'strava', stravaActivityId: '99', date: '2026-11-24', startTime: '19:30', type: 'test5k', distance: 5,
    movingSeconds: 1264, effort: 9, note: 'Cítil jsem se dobře', name: 'Večerní běh', averageHeartrate: 176, elevationGain: 12
  });
  assert.deepEqual(manual, manualCopy);
  assert.deepEqual(strava, stravaCopy);
  assert.equal(R.isFiveKAttempt(merged), true);
  // missing Strava extras fall back to null, missing manual note takes nothing invented
  const bare = R.mergeStravaIntoManual(run('m-1', '2026-10-27', 'easy', 5.2, 1830, null), { id: 'strava-5', stravaActivityId: 5, movingSeconds: 1825 });
  assert.equal(bare.id, 'strava-5');
  assert.equal(bare.stravaActivityId, 5);
  assert.equal(bare.averageHeartrate, null);
  assert.equal(bare.elevationGain, null);
  assert.equal(bare.movingSeconds, 1825);
  assert.equal(bare.startTime, null);
  assert.equal(bare.effort, null);
  assert.equal(bare.note, '');
  assert.equal(bare.type, 'easy');
});

// ---------- streak ----------

test('owner demo: week streak counts weeks that met the plan', () => {
  const runs = demoRuns();
  assert.equal(R.currentStreakWeeks(runs, TODAY, PROFILE), 4); // current week not finished yet
  const sunday = [...runs, run('sun', '2026-11-29', 'easy', 5, 1800, 4)];
  assert.equal(R.currentStreakWeeks(sunday, '2026-11-29', PROFILE), 5);
  assert.equal(R.currentStreakWeeks(sunday, TODAY, PROFILE), 4);        // future runs do not count yet
  assert.equal(R.currentStreakWeeks(runs, '2026-11-30', PROFILE), 0);   // last week had 1 of 2 runs
  assert.equal(R.currentStreakWeeks(runs, TODAY, { days: [] }), 5);     // no fixed days: 1 run a week
  assert.equal(R.currentStreakWeeks(runs, TODAY, { days: [1, 3, 6] }), 0);
  assert.equal(R.currentStreakWeeks([], TODAY, PROFILE), 0);
  assert.throws(() => R.currentStreakWeeks(runs, null, PROFILE), TypeError);
});

// ---------- VeyvoTraining compatibility ----------

test('nextRunAfterRun treats the test5k code like the legacy "Test 5 km" label', () => {
  const base = { date: '2026-09-07', distance: 5, movingSeconds: 1800, effort: 5 };
  const expected = nextRunAfter5k(base, [2, 4]);
  assert.deepEqual(expected, { kind: 'easy', date: '2026-09-16', distanceKm: 3.5, paceFast: 430, paceSlow: 520 });
  assert.deepEqual(nextRunAfterRun({ ...base, type: 'test5k' }, [2, 4]), expected);
  assert.deepEqual(nextRunAfterRun({ ...base, type: 'Test 5 km' }, [2, 4]), expected);
  // a plain run of the same length follows the generic rule
  assert.equal(nextRunAfterRun({ ...base, type: 'run' }, [2, 4]).date, '2026-09-09');
  // test5k keeps the effort rules of nextRunAfter5k; outside the 5 km window it is planned like a plain run
  assert.deepEqual(nextRunAfterRun({ ...base, type: 'test5k', distance: 4 }, [2, 4]), nextRunAfterRun({ ...base, type: 'run', distance: 4 }, [2, 4]));
  assert.equal(nextRunAfterRun({ ...base, type: 'test5k', effort: 10 }, [2, 4]).kind, 'rest');
  // the 5 km rule moves the next run into the following week (Tuesday 1. 12.), unlike a plain run (Sunday 29. 11.)
  assert.equal(nextRunAfterRun({ ...base, type: 'test5k', date: '2026-11-24', movingSeconds: 1262, effort: 9 }, [1, 6], TODAY).date, '2026-12-01');
  assert.equal(nextRunAfterRun({ ...base, type: 'run', date: '2026-11-24', movingSeconds: 1262, effort: 9 }, [1, 6], TODAY).date, '2026-11-29');
});
