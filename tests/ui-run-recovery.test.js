// Run dialog + recovery check-in: i18n completeness (namespaces 'run' and 'recovery') and the pure
// helpers exported as VeyvoUI.runDialog / VeyvoUI.recovery (time and distance parsing, effort bands,
// the pain line kept in the note, similar-run comparison, the rest verdict rule).
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
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js', 'run-dialog.js', 'recovery.js']) require(path.join(SRC, 'ui', file));
const UI = globalThis.VeyvoUI;
const I18n = globalThis.VeyvoI18n;
const Store = globalThis.VeyvoStore;
const RD = UI.runDialog;
const REC = UI.recovery;

test('run and recovery namespaces are complete in Czech and English', () => {
  for (const ns of ['run', 'recovery']) {
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

test('dialogs and the check-in component are registered under the documented names', () => {
  const app = UI.app;
  for (const name of ['run', 'runLog', 'runDetail', 'recovery']) assert.ok(app.dialogs.has(name), 'dialog ' + name);
  assert.ok(app.components.has('recoveryCheckin'));
});

test('time input: m:ss, h:mm:ss, minutes over 60, dot/comma separators and bare minutes', () => {
  assert.equal(RD.parseTime('21:02'), 1262);
  assert.equal(RD.parseTime('1:09:40'), 4180);
  assert.equal(RD.parseTime('69:40'), 4180);
  assert.equal(RD.parseTime('21.02'), 1262);
  assert.equal(RD.parseTime('21,02'), 1262);
  assert.equal(RD.parseTime(' 1.09.40 '), 4180);
  assert.equal(RD.parseTime('21'), 1260, 'bare number = minutes');
  assert.equal(RD.parseTime('21:7'), null);
  assert.equal(RD.parseTime('5.2'), null);
  assert.equal(RD.parseTime(''), null);
  // what the dialog hands to the store validates the same way
  assert.equal(Store.validateRun({ date: '2026-11-24', distance: RD.normalizeDistance('5,0 km'), time: RD.normalizeTime('21.02') }, { today: '2026-11-27' }).run.movingSeconds, 1262);
});

test('distance input: decimal comma or dot, optional km suffix', () => {
  assert.equal(RD.parseDistance('5,2'), 5.2);
  assert.equal(RD.parseDistance('5.2'), 5.2);
  assert.equal(RD.parseDistance('12 km'), 12);
  assert.equal(RD.parseDistance('0'), null);
  assert.equal(RD.parseDistance('abc'), null);
  assert.equal(RD.normalizeDistance(' 6,04 km '), '6,04');
});

test('effort descriptors: 1-3 easy, 4-6 moderate, 7-8 hard, 9-10 max', () => {
  assert.deepEqual([1, 3, 4, 6, 7, 8, 9, 10].map(RD.effortBand), ['easy', 'easy', 'moderate', 'moderate', 'hard', 'hard', 'max', 'max']);
  assert.equal(RD.effortBand(null), null);
  I18n.setLocale('cs');
  assert.equal(I18n.t('run.effort.band.' + RD.effortBand(7)), 'těžce');
});

test('pain is kept as the last note line and parsed back in both languages', () => {
  const note = RD.joinNote('Mokro, kopce', { area: 'knee', level: 4 }, 'cs');
  assert.equal(note, 'Mokro, kopce\nBolest: koleno 4/10');
  assert.deepEqual(RD.splitPain(note), { note: 'Mokro, kopce', pain: { area: 'knee', level: 4 } });
  assert.deepEqual(RD.splitPain('Pain: calf / achilles'), { note: '', pain: { area: 'calf', level: null } });
  assert.deepEqual(RD.splitPain('Bolest: lýtko / achilovka 7/10\n'), { note: '', pain: { area: 'calf', level: 7 } });
  assert.deepEqual(RD.splitPain('Bolest: hlava 3/10'), { note: 'Bolest: hlava 3/10', pain: null }, 'unknown area stays plain text');
  assert.equal(RD.joinNote('Bez bolesti', null, 'cs'), 'Bez bolesti');
  assert.ok(Store.validateRun({ date: '2026-11-24', distance: 5, time: '21:02', note }, { today: '2026-11-27' }).ok);
});

test('result comparison: most similar earlier run, time for equal distance, else pace', () => {
  const runs = [
    { id: 'a', date: '2026-11-10', type: 'run', distance: 5.0, movingSeconds: 1290 },
    { id: 'b', date: '2026-11-14', type: 'easy', distance: 6.1, movingSeconds: 2140 },
    { id: 'c', date: '2026-11-21', type: 'long', distance: 12.0, movingSeconds: 4180 },
    { id: 'd', date: '2026-11-24', type: 'run', distance: 5.0, movingSeconds: 1262 }
  ];
  assert.equal(RD.similarRun(runs, runs[3]).id, 'a');
  assert.deepEqual(RD.compareRuns(runs[3], runs[0]), { mode: 'time', delta: -28 });
  const easy = { id: 'e', date: '2026-11-27', type: 'easy', distance: 6.0, movingSeconds: 2090 };
  assert.equal(RD.similarRun(runs.concat([easy]), easy).id, 'b');
  assert.deepEqual(RD.compareRuns(easy, runs[1]), { mode: 'pace', delta: Math.round(2090 / 6 - 2140 / 6.1) });
  assert.equal(RD.similarRun(runs, { id: 'x', date: '2026-11-27', type: 'race', distance: 21.1, movingSeconds: 7000 }), null, 'nothing within 25 %');
  assert.equal(RD.similarRun(runs, runs[0]), null, 'only earlier runs count');
});

test('recovery verdict uses the same rule as derived.recoveryAdvice (fatigue >= 8 or soreness >= 7)', () => {
  assert.equal(REC.verdict({ fatigue: 7, soreness: 6 }), null);
  assert.deepEqual(REC.verdict({ fatigue: 8, soreness: 2 }), { code: 'rest', fatigue: 8, soreness: null });
  assert.deepEqual(REC.verdict({ fatigue: null, soreness: 7 }), { code: 'rest', fatigue: null, soreness: 7 });
  assert.equal(REC.verdict({}), null);
  assert.deepEqual(REC.merge({ date: 'x', sleepHours: 7.2, fatigue: 4, soreness: 2 }, { fatigue: 9, soreness: null }), { sleepHours: 7.2, fatigue: 9, soreness: null });
  assert.deepEqual(REC.merge(null, {}), { sleepHours: null, fatigue: null, soreness: null });
});

// ---------------------------------------------------------------- result view (review fixes)
const OWNER = [
  ['2026-10-27', 'easy', 5.2, 1830, 4], ['2026-10-31', 'intervals', 6.0, 1890, 8], ['2026-11-03', 'long', 10.4, 3650, 6],
  ['2026-11-07', 'tempo', 7.0, 2180, 7], ['2026-11-10', 'run', 5.0, 1290, 9], ['2026-11-14', 'easy', 6.1, 2140, 4],
  ['2026-11-17', 'intervals', 6.5, 2010, 8], ['2026-11-21', 'long', 12.0, 4180, 6], ['2026-11-24', 'run', 5.0, 1262, 9]
];
function ownerState(extraRuns, planned) {
  return Object.assign(Store.DEFAULT_STATE(), {
    profile: { name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true },
    runHistory: OWNER.concat(extraRuns || []).map(([date, type, distance, movingSeconds, effort], i) => ({ id: 'm-' + (i + 1), source: 'manual', date, startTime: null, type, distance, movingSeconds, effort, note: '' })),
    plannedWorkouts: planned || []
  });
}

test('result view: a backdated run does not claim a record or milestone that a later run holds', () => {
  I18n.setLocale('cs');
  // a forgotten 5 km in 21:20 on 17. 11.: a PB at the time (21:30 before), but 21:02 on 24. 11. is faster
  const d = UI.app.deriveFrom(ownerState([['2026-11-17', 'run', 5.0, 1280, 8]]), '2026-11-27');
  const back = d.runs.find(r => r.id === 'm-10');
  const raw = globalThis.VeyvoRuns.notesOf(d.notes, back.id);
  assert.ok(raw.some(n => n.code === 'personalBest5k'), 'the run log keeps the historical note');
  assert.equal(d.records.fastest5k.runId, 'm-9');
  assert.deepEqual(RD.resultNotes(raw, back, d).filter(n => n.code === 'personalBest5k'), [], 'no "new record" banner');
  // a forgotten 11 km on 15. 11. was the longest run then, the 12 km on 21. 11. is now
  const d2 = UI.app.deriveFrom(ownerState([['2026-11-15', 'long', 11.0, 3900, 6]]), '2026-11-27');
  const eleven = d2.runs.find(r => r.id === 'm-10');
  const raw2 = globalThis.VeyvoRuns.notesOf(d2.notes, eleven.id);
  assert.ok(raw2.some(n => n.code === 'longestRun'));
  assert.deepEqual(RD.resultNotes(raw2, eleven, d2).map(n => n.code).filter(c => c === 'longestRun' || c === 'distanceMilestone' || c === 'firstOver10k'), []);
  // the latest run that is the record keeps its banner
  const d3 = UI.app.deriveFrom(ownerState([['2026-11-26', 'run', 5.0, 1250, 9]]), '2026-11-27');
  const pb = d3.runs.find(r => r.id === 'm-10');
  assert.ok(RD.resultNotes(globalThis.VeyvoRuns.notesOf(d3.notes, pb.id), pb, d3).some(n => n.code === 'personalBest5k'));
});

test('result view: "Další běh" and "Do hodinek" follow derived.nextSession (a booked session before the engine run)', () => {
  I18n.setLocale('cs');
  const d = UI.app.deriveFrom(ownerState([], [{ date: '2026-11-28', templateId: 'long' }]), '2026-11-27');
  assert.deepEqual([d.nextSession.source, d.nextSession.date], ['planned', '2026-11-28']);
  const line = RD.nextLine(d);
  assert.match(line.line, /Dlouhý běh/, line.line);
  assert.match(line.line, /28\./, line.line);
  assert.equal(line.rel, 'zítra');
  const watch = RD.watchParams(d);
  assert.deepEqual([watch.date, watch.templateId, watch.workout.id], ['2026-11-28', 'long', d.nextSession.workout.id]);
  // without a booking it is the engine's run, and there is nothing to export on a rest verdict
  const e = UI.app.deriveFrom(ownerState(), '2026-11-27');
  assert.equal(RD.watchParams(e).date, '2026-11-29');
  assert.equal(RD.watchParams(e).templateId, undefined);
  assert.match(RD.nextLine(e).line, /3\skm/);
  const rest = UI.app.deriveFrom(ownerState([['2026-11-26', 'run', 5.0, 1300, 10]]), '2026-11-27');
  assert.equal(rest.nextRun.kind, 'rest');
  assert.equal(RD.watchParams(rest), null);
});
