const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const W = require('../src/core/workouts.js');
const T = require('../src/training-context.js');

const SRC = path.join(__dirname, '..', 'src', 'core', 'workouts.js');
const { step, repeat, time, distance, open, pace, hr } = W.build;

function workout(steps, extra) {
  return Object.assign({ id: 'w1', name: 'Test', sport: 'running', source: 'custom', steps: steps }, extra || {});
}
function codes(result) { return result.errors.map(function (e) { return e.code + '@' + e.path; }); }
function easyStep() { return step('active', distance(1000), open()); }
function ownerPaces() { return W.derivePaces({ best5kSeconds: 1290, targetSeconds: 1200 }); }

// ---------------------------------------------------------------- validate

test('validate: a well-formed workout passes and reports its FIT step count', () => {
  const w = workout([
    step('warmup', time(900)),
    repeat(6, [step('active', distance(400), pace(230, 237)), step('recovery', distance(200))]),
    step('cooldown', time(600), hr(120, 145), 'Vyklus')
  ], { date: '2026-12-01', description: 'Popis' });
  const result = W.validate(w);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  assert.equal(result.fitStepCount, 5, 'warm-up + 2 block steps + repeat marker + cool-down');
  assert.equal(W.fitStepCount(w), 5);
});

test('validate: workout-level fields', () => {
  assert.deepEqual(codes(W.validate(null)), ['workout_invalid@']);
  assert.deepEqual(codes(W.validate([])), ['workout_invalid@']);
  assert.deepEqual(codes(W.validate('x')), ['workout_invalid@']);
  const bad = W.validate({ id: '', name: '  ', sport: 'cycling', source: 'web', date: '2026-02-30', description: 5, steps: [] });
  assert.deepEqual(codes(bad), [
    'id_invalid@id', 'name_required@name', 'sport_invalid@sport', 'date_invalid@date',
    'description_invalid@description', 'source_invalid@source', 'steps_empty@steps'
  ]);
  assert.equal(W.validate(workout([easyStep()], { id: 'x'.repeat(101) })).errors[0].code, 'id_invalid');
  assert.deepEqual(codes(W.validate(workout(undefined))), ['steps_empty@steps']);
  assert.equal(W.validate(workout([easyStep()], { date: null })).ok, true, 'null date means no date');
  assert.equal(W.validate(workout([easyStep()], { date: '2026-11-24T00:00:00' })).errors[0].code, 'date_invalid');
  for (const source of W.SOURCES) assert.equal(W.validate(workout([easyStep()], { source })).ok, true);
});

test('validate: name length counts characters (Czech diacritics are one character)', () => {
  assert.equal(W.validate(workout([easyStep()], { name: 'ř'.repeat(40) })).ok, true);
  const long = W.validate(workout([easyStep()], { name: 'a'.repeat(41) }));
  assert.deepEqual(long.errors, [{ code: 'name_too_long', path: 'name', max: 40 }]);
});

test('validate: step shape, intensity, label', () => {
  const r = W.validate(workout([
    null,
    { kind: 'other' },
    { kind: 'step', intensity: 'sprint', duration: time(60), target: open() },
    step('active', time(60), open(), 42),
    step('active', time(60), open(), 'x'.repeat(41)),
    step('active', time(60), open(), '  ' + 'x'.repeat(40) + '  ')
  ]));
  assert.deepEqual(codes(r), [
    'step_invalid@steps.0', 'step_invalid@steps.1', 'intensity_invalid@steps.2.intensity',
    'label_invalid@steps.3.label', 'label_too_long@steps.4.label'
  ]);
  for (const intensity of W.INTENSITIES) assert.equal(W.validate(workout([step(intensity, time(60))])).ok, true, intensity);
});

test('validate: durations are finite and within 10 s–6 h and 50 m–100 km', () => {
  const ok = (d) => W.validate(workout([step('active', d)])).ok;
  assert.equal(ok(time(10)), true);
  assert.equal(ok(time(21600)), true);
  assert.equal(ok(distance(50)), true);
  assert.equal(ok(distance(100000)), true);
  assert.equal(ok(open()), true);
  const one = (d) => codes(W.validate(workout([step('active', d)])));
  assert.deepEqual(one(time(9.9)), ['duration_time_range@steps.0.duration.seconds']);
  assert.deepEqual(one(time(21601)), ['duration_time_range@steps.0.duration.seconds']);
  assert.deepEqual(one(distance(49)), ['duration_distance_range@steps.0.duration.meters']);
  assert.deepEqual(one(distance(100001)), ['duration_distance_range@steps.0.duration.meters']);
  for (const bad of [NaN, Infinity, -Infinity, '400', null, undefined]) {
    assert.deepEqual(one(distance(bad)), ['duration_invalid@steps.0.duration.meters'], String(bad));
    assert.deepEqual(one(time(bad)), ['duration_invalid@steps.0.duration.seconds'], String(bad));
  }
  assert.deepEqual(one({ type: 'calories', value: 100 }), ['duration_invalid@steps.0.duration']);
  assert.deepEqual(one(null), ['duration_invalid@steps.0.duration']);
  const range = W.validate(workout([step('active', time(5))])).errors[0];
  assert.deepEqual(range, { code: 'duration_time_range', path: 'steps.0.duration.seconds', min: 10, max: 21600 });
});

test('validate: pace targets 2:30–12:00 /km with fast < slow', () => {
  const one = (t) => codes(W.validate(workout([step('active', distance(400), t)])));
  assert.deepEqual(one(pace(150, 720)), []);
  assert.deepEqual(one(pace(149, 200)), ['pace_range@steps.0.target.fastSecPerKm']);
  assert.deepEqual(one(pace(300, 721)), ['pace_range@steps.0.target.slowSecPerKm']);
  assert.deepEqual(one(pace(240, 240)), ['pace_order@steps.0.target']);
  assert.deepEqual(one(pace(250, 240)), ['pace_order@steps.0.target']);
  assert.deepEqual(one(pace(NaN, 240)), ['target_invalid@steps.0.target.fastSecPerKm']);
  assert.deepEqual(one(pace(240, '250')), ['target_invalid@steps.0.target.slowSecPerKm']);
  assert.deepEqual(one({ type: 'power', low: 200 }), ['target_invalid@steps.0.target']);
  assert.deepEqual(one(undefined), [], 'builder defaults to an open target');
  assert.deepEqual(codes(W.validate(workout([{ kind: 'step', intensity: 'active', duration: time(60) }]))),
    ['target_invalid@steps.0.target'], 'a raw step must carry a target');
});

test('validate: heart-rate targets 60–220 bpm with low < high', () => {
  const one = (t) => codes(W.validate(workout([step('active', time(600), t)])));
  assert.deepEqual(one(hr(60, 220)), []);
  assert.deepEqual(one(hr(59, 150)), ['hr_range@steps.0.target.lowBpm']);
  assert.deepEqual(one(hr(140, 221)), ['hr_range@steps.0.target.highBpm']);
  assert.deepEqual(one(hr(150, 150)), ['hr_order@steps.0.target']);
  assert.deepEqual(one(hr(160, 150)), ['hr_order@steps.0.target']);
  assert.deepEqual(one(hr(Infinity, 150)), ['target_invalid@steps.0.target.lowBpm']);
});

test('validate: repeat count 1–99, non-empty, one nesting level', () => {
  const block = (count, steps) => W.validate(workout([repeat(count, steps || [easyStep()])]));
  assert.equal(block(1).ok, true);
  assert.equal(block(99).ok, true);
  for (const bad of [0, 100, 1.5, '6', null]) {
    assert.deepEqual(codes(block(bad)), ['repeat_count_range@steps.0.count'], String(bad));
  }
  assert.deepEqual(block(0).errors[0], { code: 'repeat_count_range', path: 'steps.0.count', min: 1, max: 99 });
  assert.deepEqual(codes(block(3, [])), ['repeat_empty@steps.0.steps']);
  assert.deepEqual(codes(W.validate(workout([{ kind: 'repeat', count: 3 }]))), ['repeat_empty@steps.0.steps']);
  assert.deepEqual(codes(block(3, [easyStep(), repeat(2, [easyStep()])])), ['repeat_nested@steps.0.steps.1']);
  assert.deepEqual(codes(block(3, [easyStep(), step('active', distance(10))])), ['duration_distance_range@steps.0.steps.1.duration.meters']);
});

test('validate: at most 50 FIT steps, a repeat block adds one', () => {
  const plain = (n) => Array.from({ length: n }, easyStep);
  assert.equal(W.validate(workout(plain(50))).ok, true);
  const tooMany = W.validate(workout(plain(51)));
  assert.deepEqual(tooMany.errors, [{ code: 'too_many_steps', path: 'steps', count: 51, max: 50 }]);
  assert.equal(W.validate(workout([repeat(99, plain(49))])).ok, true, '49 + repeat marker = 50');
  assert.equal(W.validate(workout([repeat(2, plain(50))])).errors[0].count, 51);
  // 16 blocks of (work, recovery) = 48 steps; the repetition count does not matter.
  const blocks = Array.from({ length: 16 }, () => repeat(10, [easyStep(), step('recovery', time(60))]));
  assert.equal(W.validate(workout(blocks)).fitStepCount, 48);
  assert.equal(W.validate(workout(blocks.concat([easyStep(), easyStep()]))).ok, true);
  assert.equal(W.validate(workout(blocks.concat([easyStep(), easyStep(), easyStep()]))).ok, false);
});

// ---------------------------------------------------------------- flatten

test('flatten: FIT message order with repeat markers after their block', () => {
  const w = workout([
    step('warmup', time(900)),
    repeat(6, [step('active', distance(400), pace(230, 237), '  Úsek  '), step('recovery', distance(200))]),
    step('cooldown', time(600))
  ]);
  const flat = W.flatten(w);
  assert.equal(flat.length, 5);
  assert.deepEqual(flat.map((s) => s.kind + ':' + s.index), ['step:0', 'step:1', 'step:2', 'repeat:3', 'step:4']);
  assert.deepEqual(flat[3], { kind: 'repeat', index: 3, path: 'steps.1', fromIndex: 1, count: 6 });
  assert.deepEqual(flat[1], {
    kind: 'step', index: 1, path: 'steps.1.steps.0', intensity: 'active',
    duration: { type: 'distance', meters: 400 }, target: { type: 'pace', fastSecPerKm: 230, slowSecPerKm: 237 },
    inRepeat: true, label: 'Úsek'
  });
  assert.deepEqual(flat[0], {
    kind: 'step', index: 0, path: 'steps.0', intensity: 'warmup', duration: { type: 'time', seconds: 900 },
    target: { type: 'open' }, inRepeat: false
  });
  assert.equal('label' in flat[2], false);
  flat[1].target.fastSecPerKm = 1;
  flat[0].duration.seconds = 1;
  assert.equal(w.steps[1].steps[0].target.fastSecPerKm, 230, 'flatten returns copies');
  assert.equal(w.steps[0].duration.seconds, 900);
});

test('flatten: several blocks keep correct fromIndex values', () => {
  const flat = W.flatten(workout([
    repeat(3, [easyStep()]),
    step('rest', time(120)),
    repeat(2, [easyStep(), step('recovery', time(60)), easyStep()])
  ]));
  assert.deepEqual(flat.map((s) => s.kind === 'repeat' ? 'R' + s.fromIndex + 'x' + s.count : s.intensity[0]),
    ['a', 'R0x3', 'r', 'a', 'r', 'a', 'R3x2']);
  assert.equal(flat[2].intensity, 'rest');
});

test('flatten: invalid workouts throw with the validation errors', () => {
  assert.throws(() => W.flatten(workout([repeat(100, [easyStep()])])), (error) => {
    assert.equal(error.code, 'workout_invalid');
    assert.deepEqual(error.errors, [{ code: 'repeat_count_range', path: 'steps.0.count', min: 1, max: 99 }]);
    assert.match(error.message, /repeat_count_range @ steps\.0\.count/);
    return true;
  });
  assert.throws(() => W.flatten(null), { code: 'workout_invalid' });
});

// ---------------------------------------------------------------- estimate

test('estimate: target midpoints, easy pace for other steps, repeats multiplied', () => {
  const interval = W.library(ownerPaces())[1].workout; // 15 min, 6 × (400 m @ 3:50–3:57, 200 m), 10 min
  // warm-up 900 s @ 342.5 s/km = 2627.7 m; reps 2400 m @ 233.5 = 560.4 s; jogs 1200 m @ 342.5 = 411 s;
  // cool-down 600 s @ 342.5 = 1751.8 m -> 7979.6 m, 2471.4 s
  assert.deepEqual(W.estimate(interval, { easyPaceSecPerKm: 342.5 }),
    { distanceM: 7980, seconds: 2471, openSteps: 0, unpacedSteps: 0, complete: true });
  // without an easy pace the time-only and distance-only halves stay unknown and are flagged
  assert.deepEqual(W.estimate(interval),
    { distanceM: 3600, seconds: 2060, openSteps: 0, unpacedSteps: 3, complete: false });
  assert.deepEqual(W.estimate(interval, { easyPaceSecPerKm: -5 }), W.estimate(interval));
});

test('estimate: open steps are excluded and counted, HR steps use the easy pace', () => {
  const w = workout([
    step('warmup', open()),
    step('active', time(600), hr(140, 150)),
    repeat(4, [step('active', open(), pace(240, 250)), step('recovery', time(60))])
  ]);
  assert.deepEqual(W.estimate(w, { easyPaceSecPerKm: 300 }),
    { distanceM: 2800, seconds: 840, openSteps: 2, unpacedSteps: 0, complete: false });
  assert.equal(W.estimate(workout([])), null);
  assert.equal(W.estimate(null), null);
});

// ---------------------------------------------------------------- derivePaces

test('derivePaces: owner goal 20:00 with a 21:30 best', () => {
  assert.deepEqual(ownerPaces(), {
    goalSecPerKm: 240,
    currentSecPerKm: 260,
    easy: { fastSecPerKm: 310, slowSecPerKm: 375 },
    rep400: { fastSecPerKm: 230, slowSecPerKm: 237 },
    rep1k: { fastSecPerKm: 240, slowSecPerKm: 245 },
    threshold: { fastSecPerKm: 268, slowSecPerKm: 275 },
    basis: { best5kSeconds: 1290, targetSeconds: 1200, currentFromGoal: false, goalFromBest: false },
    goalReached: false
  });
});

test('derivePaces: easy range is the VeyvoTraining next-run formula', () => {
  for (const best of [1100, 1290, 1500, 1800, 2400]) {
    const engine = T.nextRunAfter5k({ date: '2026-11-22', distance: 5, movingSeconds: best, effort: 5 }, [1, 6]);
    const paces = W.derivePaces({ best5kSeconds: best, targetSeconds: 1200 });
    assert.deepEqual([paces.easy.fastSecPerKm, paces.easy.slowSecPerKm], [engine.paceFast, engine.paceSlow], String(best));
  }
});

test('derivePaces: missing best, missing goal, rounding, invalid input', () => {
  const noBest = W.derivePaces({ targetSeconds: 1200 });
  assert.equal(noBest.goalSecPerKm, 240);
  assert.equal(noBest.currentSecPerKm, 255, 'goal pace + 15 s');
  assert.deepEqual(noBest.easy, { fastSecPerKm: 305, slowSecPerKm: 370 });
  assert.deepEqual(noBest.threshold, { fastSecPerKm: 263, slowSecPerKm: 270 });
  assert.equal(noBest.basis.currentFromGoal, true);
  assert.equal(noBest.goalReached, false);

  const noGoal = W.derivePaces({ best5kSeconds: 1290 });
  assert.equal(noGoal.goalSecPerKm, 260, 'trains at current level when no goal is set');
  assert.equal(noGoal.basis.goalFromBest, true);

  assert.equal(W.derivePaces({ targetSeconds: 1190 }).goalSecPerKm, 240, '238 s/km rounds to 240');
  assert.equal(W.derivePaces({ targetSeconds: 1185 }).goalSecPerKm, 235, '237 s/km rounds to 235');
  assert.deepEqual(W.derivePaces({ targetSeconds: 1185 }).rep400, { fastSecPerKm: 225, slowSecPerKm: 232 },
    'offsets are applied after rounding the base pace');
  assert.equal(W.derivePaces({ best5kSeconds: '1290', targetSeconds: '1200' }).currentSecPerKm, 260, 'numeric strings');
  assert.equal(W.derivePaces({ best5kSeconds: 1150, targetSeconds: 1200 }).goalReached, true);

  assert.equal(W.derivePaces({}), null);
  assert.equal(W.derivePaces(null), null);
  assert.equal(W.derivePaces(), null);
  assert.equal(W.derivePaces({ best5kSeconds: 300, targetSeconds: 0 }), null, 'implausible times are ignored');
  assert.equal(W.derivePaces({ best5kSeconds: 9000, targetSeconds: NaN }), null);
  assert.equal(W.derivePaces({ best5kSeconds: 300, targetSeconds: 1200 }).basis.best5kSeconds, null);
});

// ---------------------------------------------------------------- library

test('library: six sessions with i18n keys, params and valid workouts', () => {
  const lib = W.library(ownerPaces());
  assert.deepEqual(lib.map((t) => t.id), ['easy', 'intervals400', 'intervals1k', 'threshold', 'long', 'test5k']);
  assert.deepEqual(lib.map((t) => t.id), [...W.LIBRARY_IDS]);
  for (const t of lib) {
    assert.equal(W.validate(t.workout).ok, true, t.id + ' ' + JSON.stringify(W.validate(t.workout).errors));
    assert.equal(t.nameKey, 'workouts.library.' + t.id + '.name');
    assert.equal(t.descriptionKey, 'workouts.library.' + t.id + '.description');
    assert.equal(t.workout.id, 'lib-' + t.id);
    assert.equal(t.workout.source, 'library');
    assert.equal(t.workout.sport, 'running');
    assert.equal('date' in t.workout, false);
    assert.ok(t.workout.name.length <= 40);
    assert.doesNotMatch(t.workout.name + t.workout.description, /[{}]/, 'every placeholder filled');
  }
  assert.deepEqual(lib.map((t) => t.paced), [true, true, true, true, true, false]);
  assert.deepEqual(lib.map((t) => t.workout.name), [
    'Lehký běh 5 km', 'Úseky 6× 400 m', 'Úseky 5× 1 km', 'Tempo 3× 2 km', 'Dlouhý běh 10 km', 'Test 5 km'
  ]);
  assert.deepEqual(W.library(ownerPaces(), { locale: 'en' }).map((t) => t.workout.name), [
    'Easy run 5 km', 'Reps 6× 400 m', 'Reps 5× 1 km', 'Tempo 3× 2 km', 'Long run 10 km', '5 km test'
  ]);
  assert.deepEqual(lib[1].params, {
    reps: 6, distanceM: 400, recoveryM: 200, warmupMin: 15, cooldownMin: 10,
    paceFast: '3:50', paceSlow: '3:57', goalPace: '4:00'
  });
});

test('library: session structures follow the documented prescriptions', () => {
  const [easy, i400, i1k, thr, long, test5k] = W.library(ownerPaces());
  assert.deepEqual(easy.workout.steps, [step('active', distance(5000), pace(310, 375))]);
  assert.deepEqual(i400.workout.steps, [
    step('warmup', time(900)),
    repeat(6, [step('active', distance(400), pace(230, 237)), step('recovery', distance(200))]),
    step('cooldown', time(600))
  ]);
  assert.deepEqual(i1k.workout.steps[1], repeat(5, [step('active', distance(1000), pace(240, 245)), step('recovery', time(120))]));
  assert.deepEqual(thr.workout.steps[1], repeat(3, [step('active', distance(2000), pace(268, 275)), step('recovery', time(120))]));
  assert.deepEqual(long.workout.steps, [step('active', distance(10000), pace(310, 375))]);
  assert.deepEqual(test5k.workout.steps, [step('warmup', time(900)), step('active', distance(5000), open(), 'Naplno'), step('cooldown', time(600))]);
  for (const t of [i400, i1k, thr, test5k]) {
    assert.deepEqual([t.workout.steps[0].duration, t.workout.steps.at(-1).duration], [time(900), time(600)], t.id);
  }
});

test('library: no paces -> by-feel sessions with open targets', () => {
  const lib = W.library(null, { locale: 'en' });
  assert.equal(lib.length, 6);
  for (const t of lib) {
    assert.equal(W.validate(t.workout).ok, true);
    assert.equal(t.paced, false);
    assert.equal(W.flatten(t.workout).some((s) => s.kind === 'step' && s.target.type !== 'open'), false, t.id);
    assert.equal(t.descriptionKey, 'workouts.library.' + t.id + (t.id === 'test5k' ? '.description' : '.descriptionByFeel'));
    assert.equal('paceFast' in t.params, false);
    assert.doesNotMatch(t.workout.description, /[{}]/);
  }
  assert.equal(lib[1].workout.description,
    'Warm up for 15 min, then run 6× 400 m briskly, a little faster than your 5 km race pace. Jog 200 m between reps and cool down for 10 min.');
});

test('library: a pace range outside 2:30–12:00 /km falls back to by-feel for that session only', () => {
  const slow = W.derivePaces({ best5kSeconds: 3000, targetSeconds: 2700 }); // easy 12:00–14:30 /km
  const lib = W.library(slow);
  assert.deepEqual(lib.map((t) => t.paced), [false, true, true, true, false, false]);
  assert.equal(lib[0].workout.steps[0].target.type, 'open');
  assert.equal(lib[0].descriptionKey, 'workouts.library.easy.descriptionByFeel');
  for (const t of lib) assert.equal(W.validate(t.workout).ok, true, t.id);
});

test('library: easy and long distances are editable', () => {
  const lib = W.library(ownerPaces(), { easyDistanceKm: 4.5, longDistanceKm: 12, locale: 'cs' });
  assert.equal(lib[0].workout.steps[0].duration.meters, 4500);
  assert.equal(lib[0].workout.name, 'Lehký běh 4,5 km', 'decimal comma');
  assert.equal(W.library(ownerPaces(), { easyDistanceKm: 4.5, locale: 'en' })[0].workout.name, 'Easy run 4.5 km');
  assert.equal(lib[4].workout.steps[0].duration.meters, 12000);
  const fallback = W.library(ownerPaces(), { easyDistanceKm: 0, longDistanceKm: 'abc' });
  assert.equal(fallback[0].params.distanceKm, 5);
  assert.equal(fallback[4].params.distanceKm, 10);
});

// ---------------------------------------------------------------- fromNextRun

test('fromNextRun: easy suggestion becomes one paced distance step', () => {
  const w = W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 3.5, paceFast: 310, paceSlow: 375 }, { days: [1, 6] });
  assert.deepEqual(w, {
    id: 'plan-2026-12-01',
    name: 'Lehký běh 3,5 km',
    sport: 'running',
    source: 'plan',
    description: 'Lehký běh v tempu 5:10–6:15 /km podle tvých posledních výsledků.',
    steps: [step('active', distance(3500), pace(310, 375))],
    date: '2026-12-01'
  });
  const en = W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 3.5, paceFast: 310, paceSlow: 375 }, {}, { locale: 'en' });
  assert.equal(en.name, 'Easy run 3.5 km');
  assert.equal(en.description, 'Easy run at 5:10–6:15 /km, based on your latest results.');
  assert.equal(W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 3, paceFast: 310, paceSlow: 375 }, {}, 'en-GB').name, 'Easy run 3 km');
});

test('fromNextRun: missing or unusable paces give an open target', () => {
  for (const [fast, slow] of [[null, null], [375, 310], [100, 200], [600, 800], [undefined, 300]]) {
    const w = W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 3, paceFast: fast, paceSlow: slow });
    assert.deepEqual(w.steps[0].target, { type: 'open' }, fast + '/' + slow);
    assert.equal(w.description, 'Lehký běh pohodovým tempem podle pocitu.');
  }
});

test('fromNextRun: return after a break is a time step of durationMax minutes', () => {
  const nr = { kind: 'easy', date: '2026-09-29', distanceKm: 3.5, paceFast: null, paceSlow: null, returnAfterBreak: true, durationMin: 25, durationMax: 30 };
  const w = W.fromNextRun(nr, { days: [1, 6] });
  assert.deepEqual(w.steps, [step('active', time(1800), open())]);
  assert.equal(w.name, 'Lehký běh 30 min');
  assert.equal(w.description, 'Návrat po delší pauze: 30 min lehce, tempo podle pocitu.');
  assert.equal(W.fromNextRun(nr, {}, { locale: 'en' }).description, 'Back after a longer break: 30 min easy, pace by feel.');
  assert.equal(W.fromNextRun({ ...nr, durationMax: undefined }).steps[0].duration.seconds, 1500, 'falls back to durationMin');
  assert.equal(W.fromNextRun({ ...nr, durationMax: null, durationMin: null }).steps[0].duration.seconds, 1800, 'then 30 min');
});

test('fromNextRun: rest, invalid input and undated suggestions', () => {
  assert.equal(W.fromNextRun({ kind: 'rest', date: null, distanceKm: 0, paceFast: null, paceSlow: null }), null);
  assert.equal(W.fromNextRun(null), null);
  assert.equal(W.fromNextRun(undefined, {}), null);
  assert.equal(W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 0 }), null);
  assert.equal(W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 'x' }), null);
  assert.equal(W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 150 }), null, 'over the 100 km limit');
  const undated = W.fromNextRun({ kind: 'easy', date: null, distanceKm: 3, paceFast: 310, paceSlow: 375 });
  assert.equal(undated.id, 'plan-next');
  assert.equal('date' in undated, false);
  assert.equal(W.fromNextRun({ kind: 'easy', date: '2026-02-30', distanceKm: 3 }).id, 'plan-next');
});

test('fromNextRun: works on real VeyvoTraining output for Tuesday + Sunday', () => {
  const run = { date: '2026-11-24', type: 'easy', distance: 5, movingSeconds: 1650, effort: 5 };
  const next = T.nextRunAfterRun(run, [1, 6], '2026-11-27');
  const w = W.fromNextRun(next, { days: [1, 6] });
  assert.equal(w.date, '2026-11-29', 'Sunday');
  assert.deepEqual(w.steps, [step('active', distance(4000), pace(395, 480))]);
  assert.equal(W.toText(w, 'cs'), 'Běh 4 km v tempu 6:35–8:00 /km');

  const comeback = T.nextRunAfterRun({ date: '2026-09-15T17:44:51Z', type: 'Běh', distance: 6.17, movingSeconds: 2570 }, [1, 6], '2026-09-29');
  const back = W.fromNextRun(comeback, { days: [1, 6] }, { locale: 'en' });
  assert.equal(back.date, '2026-09-29');
  assert.equal(W.toText(back, 'en'), 'Run 30 min');

  assert.equal(W.fromNextRun(T.nextRunAfterRun({ ...run, effort: 10 }, [1, 6], '2026-11-25')), null);
});

// ---------------------------------------------------------------- toText

test('toText: spec examples in Czech and English', () => {
  const w = W.library(ownerPaces())[1].workout;
  assert.equal(W.toText(w, 'cs'), 'Rozklus 15 min\n6× (400 m v tempu 3:50–3:57 /km, 200 m klus)\nVyklus 10 min');
  assert.equal(W.toText(w, 'en'), 'Warm-up 15 min\n6× (400 m at 3:50–3:57 /km, 200 m jog)\nCool-down 10 min');
  assert.deepEqual(W.toLines(w, 'cs'), ['Rozklus 15 min', '6× (400 m v tempu 3:50–3:57 /km, 200 m klus)', 'Vyklus 10 min']);
  assert.equal(W.toText(w), W.toText(w, 'cs'), 'Czech by default');
  assert.equal(W.toText(w, 'cs-CZ'), W.toText(w, 'cs'));
  assert.equal(W.toText(w, { locale: 'en' }), W.toText(w, 'en'));
});

test('toText: every library session reads naturally', () => {
  const cs = W.library(ownerPaces()).map((t) => W.toText(t.workout, 'cs'));
  assert.deepEqual(cs, [
    'Běh 5 km v tempu 5:10–6:15 /km',
    'Rozklus 15 min\n6× (400 m v tempu 3:50–3:57 /km, 200 m klus)\nVyklus 10 min',
    'Rozklus 15 min\n5× (1 km v tempu 4:00–4:05 /km, 2 min klus)\nVyklus 10 min',
    'Rozklus 15 min\n3× (2 km v tempu 4:28–4:35 /km, 2 min klus)\nVyklus 10 min',
    'Běh 10 km v tempu 5:10–6:15 /km',
    'Rozklus 15 min\nNaplno 5 km\nVyklus 10 min'
  ]);
  const en = W.library(ownerPaces(), { locale: 'en' }).map((t) => W.toText(t.workout, 'en'));
  assert.equal(en[0], 'Run 5 km at 5:10–6:15 /km');
  assert.equal(en[5], 'Warm-up 15 min\nAll-out 5 km\nCool-down 10 min');
});

test('toText: distances, times, HR, rest, open steps and labels', () => {
  const w = workout([
    step('warmup', open()),
    step('active', distance(2500), hr(140, 150)),
    step('rest', time(90)),
    step('active', time(5400)),
    step('recovery', time(45), open(), 'chůze'),
    repeat(4, [step('active', distance(1609), pace(240, 250), 'kopec')]),
    repeat(2, [step('active', open(), pace(240, 250)), step('rest', time(3600))]),
    step('cooldown', time(3630), open(), 'Vyklus s rovinkami')
  ]);
  assert.deepEqual(W.toLines(w, 'cs'), [
    'Rozklus do stisku tlačítka Lap',
    'Běh 2,5 km při tepu 140–150 tep/min',
    '1 min 30 s pauza',
    'Běh 1 h 30 min',
    '45 s chůze',
    '4× 1,61 km v tempu 4:00–4:10 /km – kopec',
    '2× (běh do stisku tlačítka Lap v tempu 4:00–4:10 /km, 1 h pauza)',
    'Vyklus s rovinkami 1 h 30 s'
  ]);
  assert.deepEqual(W.toLines(w, 'en'), [
    'Warm-up until you press Lap',
    'Run 2.5 km at 140–150 bpm',
    '1 min 30 s rest',
    'Run 1 h 30 min',
    '45 s chůze',
    '4× 1.61 km at 4:00–4:10 /km – kopec',
    '2× (run until you press Lap at 4:00–4:10 /km, 1 h rest)',
    'Vyklus s rovinkami 1 h 30 s'
  ]);
  assert.throws(() => W.toText(workout([])), { code: 'workout_invalid' });
});

test('stepName and format helpers', () => {
  assert.equal(W.stepName(step('warmup', time(60))), 'Rozklus');
  assert.equal(W.stepName(step('active', time(60)), 'cs', true), 'Úsek');
  assert.equal(W.stepName(step('active', time(60)), 'cs'), 'Běh');
  assert.equal(W.stepName(step('recovery', time(60)), 'en'), 'Jog');
  assert.equal(W.stepName(step('active', time(60)), 'en', true), 'Interval');
  assert.equal(W.stepName(step('cooldown', time(60)), 'en'), 'Cool-down');
  assert.equal(W.stepName(step('rest', time(60), open(), ' Stání '), 'en'), 'Stání');
  assert.equal(W.format.pace(237), '3:57');
  assert.equal(W.format.pace(59.6), '1:00');
  assert.equal(W.format.pace(0), '—');
  assert.equal(W.format.distance(400), '400 m');
  assert.equal(W.format.distance(999.6), '1 km');
  assert.equal(W.format.distance(1000, 'cs'), '1 km');
  assert.equal(W.format.distance(2500, 'cs'), '2,5 km');
  assert.equal(W.format.distance(2500, 'en'), '2.5 km');
  assert.equal(W.format.distance(21097.5, 'cs'), '21,1 km');
  assert.equal(W.format.time(900), '15 min');
  assert.equal(W.format.time(0), '0 s');
  assert.equal(W.format.time(7325), '2 h 2 min 5 s');
  assert.equal(W.format.number(-0.001, 'cs'), '0');
  assert.equal(W.normalizeLocale('EN'), 'en');
  assert.equal(W.normalizeLocale('sk-SK'), 'cs');
  assert.equal(W.normalizeLocale('cs_CZ'), 'cs');
  assert.equal(W.normalizeLocale('de'), 'en');
  assert.equal(W.normalizeLocale(''), 'cs');
});

// ---------------------------------------------------------------- messages + i18n

test('MESSAGES: both languages have the same keys and placeholders, and register in VeyvoI18n', () => {
  const flat = (obj, prefix, out) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') out[prefix + k] = (v.match(/\{\w+\}/g) || []).sort().join(',');
      else flat(v, prefix + k + '.', out);
    }
    return out;
  };
  assert.deepEqual(flat(W.MESSAGES.en, '', {}), flat(W.MESSAGES.cs, '', {}));

  const I18n = require('../src/core/i18n.js');
  assert.equal(W.registerMessages(I18n), true);
  assert.equal(W.registerMessages(null), false);
  const report = I18n.audit('workouts');
  assert.deepEqual(report.missing, { cs: [], en: [] });
  assert.deepEqual(report.placeholderMismatch, []);
  for (const locale of ['cs', 'en']) {
    for (const t of W.library(ownerPaces(), { locale, easyDistanceKm: 4.5 })) {
      assert.equal(I18n.t(t.nameKey, t.params, locale), t.workout.name, locale + ' ' + t.id);
      assert.equal(I18n.t(t.descriptionKey, t.params, locale), t.workout.description, locale + ' ' + t.id);
    }
  }
});

// ---------------------------------------------------------------- UMD contract

test('UMD: loads as a classic script, sets VeyvoWorkouts and auto-registers with VeyvoI18n', () => {
  const registered = [];
  const sandbox = { VeyvoI18n: { register: (ns, dict) => registered.push([ns, dict]) } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'workouts.js' });
  assert.equal(typeof sandbox.VeyvoWorkouts.validate, 'function');
  assert.equal(registered.length, 1);
  assert.equal(registered[0][0], 'workouts');
  const lib = sandbox.VeyvoWorkouts.library(sandbox.VeyvoWorkouts.derivePaces({ targetSeconds: 1200 }));
  assert.equal(sandbox.VeyvoWorkouts.validate(lib[1].workout).ok, true);
});

test('source stays pure: no module syntax, DOM, network or hidden clock', () => {
  const source = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(source, /^\s*(import|export)\s/m);
  assert.doesNotMatch(source, /\b(document|window|fetch|XMLHttpRequest|localStorage)\b/);
  assert.doesNotMatch(source, /Date\.now|new Date\(\)/);
});
