const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const W = require('../src/core/workouts.js');
const A = require('../src/core/export/apple.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'core', 'export', 'apple.js');
const WORKOUTS_SRC = path.join(ROOT, 'src', 'core', 'workouts.js');
const KIT_SRC = path.join(ROOT, 'src', 'vendor', 'workoutkit.js');
const { step, repeat, time, distance, open, pace, hr } = W.build;

// The @bibixx/workoutkit decoder is used only to check our bytes; it is never vendored into src/.
// Lookup order: $VEYVO_WORKOUTKIT_DECODE, then the devDependency in node_modules.
const DECODE_PATH = [
  process.env.VEYVO_WORKOUTKIT_DECODE,
  path.join(ROOT, 'node_modules', '@bibixx', 'workoutkit', 'dist', 'decode.js')
].find((p) => p && fs.existsSync(p)) || null;
const NO_DECODER = DECODE_PATH ? false : '@bibixx/workoutkit decode.js not found (set VEYVO_WORKOUTKIT_DECODE)';
// Set VEYVO_APPLE_OUT=/some/dir to also write the sample files for manual iPhone / Watch testing.
const OUT_DIR = process.env.VEYVO_APPLE_OUT || '';

let decodeFn = null;
async function decode(bytes) {
  if (!decodeFn) decodeFn = (await import(pathToFileURL(DECODE_PATH).href)).decode;
  return decodeFn(bytes).toJSON();
}

function workout(id, name, steps, extra) {
  return Object.assign({ id: id, name: name, sport: 'running', source: 'custom', steps: steps }, extra || {});
}

// The four reference workouts shared with the FIT exporter tests.
const SAMPLES = {
  easy: workout('sample-easy', 'Easy 3 km', [step('active', distance(3000), pace(305, 365))]),
  reps: workout('sample-reps', 'Úseky 6× 400 m', [
    step('warmup', time(900)),
    repeat(6, [step('active', distance(400), pace(230, 237)), step('recovery', distance(200), open())]),
    step('cooldown', time(600))
  ]),
  hr: workout('sample-hr', 'HR run 40 min', [step('active', time(2400), hr(140, 155))]),
  czech: W.fromNextRun({ kind: 'easy', date: '2026-11-29', distanceKm: 3, paceFast: 305, paceSlow: 365 }, {}, { locale: 'cs' })
};

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 0.01, (label || '') + ' ' + actual + ' ≉ ' + expected);
}
/** m/s of a decoded WorkoutKit speed { distance, time } (meters + seconds only in our files). */
function metersPerSecond(speed) {
  assert.equal(speed.distance.unit, 'meters');
  assert.equal(speed.time.unit, 'seconds');
  return speed.distance.value / speed.time.value;
}

// ---------------------------------------------------------------- independent wire reader

/** Minimal protobuf reader (varint / i64 / len) so the bytes are checked without the library. */
function readProto(bytes) {
  const out = [];
  let i = 0;
  function varint() {
    let result = 0n, shift = 0n;
    for (;;) {
      assert.ok(i < bytes.length, 'varint runs past the end');
      const b = bytes[i++];
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
      shift += 7n;
    }
  }
  while (i < bytes.length) {
    const tag = Number(varint());
    const field = tag >>> 3, wire = tag & 7;
    if (wire === 0) out.push({ field, wire, value: Number(varint()) });
    else if (wire === 1) { out.push({ field, wire, value: new DataView(bytes.buffer, bytes.byteOffset + i, 8).getFloat64(0, true) }); i += 8; }
    else if (wire === 2) { const len = Number(varint()); out.push({ field, wire, value: bytes.subarray(i, i + len) }); i += len; }
    else assert.fail('unexpected wire type ' + wire);
  }
  assert.equal(i, bytes.length, 'message ends exactly at the end of its bytes');
  return out;
}
const pick = (msg, field) => msg.filter((f) => f.field === field);
const text = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

// ---------------------------------------------------------------- mapping

test('toPlanJson: easy 3 km is one work block with a speed range (slow pace = low speed)', () => {
  const plan = A.toPlanJson(SAMPLES.easy);
  assert.match(plan.referenceId, /^[0-9A-F]{8}-[0-9A-F]{4}-8[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  assert.deepEqual(plan.custom, {
    activity: 'running',
    location: 'outdoor',
    displayName: 'Easy 3 km',
    blocks: [{
      iterations: 1,
      steps: [{
        purpose: 'work',
        step: {
          goal: { type: 'distance', distance: { value: 3000, unit: 'meters' } },
          alert: {
            type: 'speedRange',
            min: { distance: { value: 1000 / 365, unit: 'meters' }, time: { value: 1, unit: 'seconds' } },
            max: { distance: { value: 1000 / 305, unit: 'meters' }, time: { value: 1, unit: 'seconds' } }
          }
        }
      }]
    }]
  });
});

test('toPlanJson: 15 min warm-up + 6 × (400 m + 200 m) + 10 min cool-down', () => {
  const custom = A.toPlanJson(SAMPLES.reps).custom;
  assert.deepEqual(custom.warmup, { goal: { type: 'time', time: { value: 900, unit: 'seconds' } } });
  assert.deepEqual(custom.cooldown, { goal: { type: 'time', time: { value: 600, unit: 'seconds' } } });
  assert.equal(custom.blocks.length, 1);
  assert.equal(custom.blocks[0].iterations, 6);
  assert.deepEqual(custom.blocks[0].steps.map((s) => s.purpose), ['work', 'recovery']);
  assert.deepEqual(custom.blocks[0].steps[1].step, { goal: { type: 'distance', distance: { value: 200, unit: 'meters' } } });
  const alert = custom.blocks[0].steps[0].step.alert;
  near(1000 / metersPerSecond(alert.min), 237, 'slow end');
  near(1000 / metersPerSecond(alert.max), 230, 'fast end');
});

test('toPlanJson: heart-rate target -> HeartRateRangeAlert in bpm', () => {
  const s = A.toPlanJson(SAMPLES.hr).custom.blocks[0].steps[0].step;
  assert.deepEqual(s, {
    goal: { type: 'time', time: { value: 2400, unit: 'seconds' } },
    alert: { type: 'heartRateRange', min: { value: 140, unit: 'beatsPerMinute' }, max: { value: 155, unit: 'beatsPerMinute' } }
  });
});

test('toPlanJson: Czech plan name is kept as typed, file name is ASCII', () => {
  assert.equal(SAMPLES.czech.name, 'Lehký běh 3 km');
  assert.equal(A.toPlanJson(SAMPLES.czech).custom.displayName, 'Lehký běh 3 km');
  assert.equal(A.fileName(SAMPLES.czech), 'Lehky-beh-3-km.workout');
});

test('layout: warm-up and cool-down only at the ends, everything else becomes blocks', () => {
  const wu = step('warmup', time(600)), cd = step('cooldown', time(300)), run = step('active', distance(1000));
  const strides = step('warmup', time(120), open(), 'Rovinky');
  const shape = (steps) => {
    const plan = A.toPlanJson(workout('l', 'Layout', steps));
    return {
      warmup: !!plan.custom.warmup,
      cooldown: !!plan.custom.cooldown,
      blocks: plan.custom.blocks.map((b) => b.iterations + ':' + b.steps.map((s) => s.purpose + (s.step.displayName ? '(' + s.step.displayName + ')' : '')).join(','))
    };
  };
  assert.deepEqual(shape([wu, run, cd]), { warmup: true, cooldown: true, blocks: ['1:work'] });
  assert.deepEqual(shape([run, cd]), { warmup: false, cooldown: true, blocks: ['1:work'] });
  assert.deepEqual(shape([wu, run]), { warmup: true, cooldown: false, blocks: ['1:work'] });
  // A second warm-up step (strides) is not at the start: single-iteration recovery block, named.
  assert.deepEqual(shape([wu, strides, run, cd]), { warmup: true, cooldown: true, blocks: ['1:recovery(Rovinky)', '1:work'] });
  // Cool-down first / warm-up last are misplaced: blocks named with VEYVO's step names.
  assert.deepEqual(shape([cd, run, wu]), { warmup: false, cooldown: false, blocks: ['1:recovery(Vyklus)', '1:work', '1:recovery(Rozklus)'] });
  // Nothing between the ends: no empty custom workout, the steps become blocks.
  assert.deepEqual(shape([wu]), { warmup: false, cooldown: false, blocks: ['1:recovery(Rozklus)'] });
  assert.deepEqual(shape([wu, cd]), { warmup: false, cooldown: false, blocks: ['1:recovery(Rozklus)', '1:recovery(Vyklus)'] });
  // Plain middle steps are one block each (same sections as toLines()).
  assert.deepEqual(shape([wu, run, step('recovery', time(120)), run, cd]), { warmup: true, cooldown: true, blocks: ['1:work', '1:recovery', '1:work'] });
  // rest -> recovery named 'Pauza'; a warm-up inside a repeat -> recovery named.
  assert.deepEqual(shape([repeat(3, [run, step('rest', time(60))]), repeat(2, [step('warmup', time(60)), run])]),
    { warmup: false, cooldown: false, blocks: ['3:work,recovery(Pauza)', '2:recovery(Rozklus),work'] });
  const layout = A.layout(workout('l', 'Layout', [wu, run, cd]));
  assert.equal(layout.warmup, wu);
  assert.equal(layout.cooldown, cd);
  assert.deepEqual(layout.blocks, [run]);
});

test('step names: labels win, rest is localized, plain work/recovery keep Apple names', () => {
  const steps = [
    step('warmup', time(600), open(), 'Rozběh'),
    step('active', distance(5000), open(), 'Naplno'),
    repeat(2, [step('active', time(60)), step('rest', time(60))]),
    step('cooldown', time(300), open(), 'Vyklusání')
  ];
  const cs = A.toPlanJson(workout('n', 'Names', steps)).custom;
  assert.equal(cs.warmup.displayName, 'Rozběh');
  assert.equal(cs.cooldown.displayName, 'Vyklusání');
  assert.equal(cs.blocks[0].steps[0].step.displayName, 'Naplno');
  assert.equal(cs.blocks[1].steps[0].step.displayName, undefined);
  assert.equal(cs.blocks[1].steps[1].step.displayName, 'Pauza');
  const en = A.toPlanJson(workout('n', 'Names', steps), { locale: 'en' }).custom;
  assert.equal(en.blocks[1].steps[1].step.displayName, 'Rest');
  assert.equal(A.toPlanJson(workout('n', 'Names', [step('active', time(60)), step('cooldown', time(60)), step('active', time(60))]), { locale: 'en-GB' })
    .custom.blocks[1].steps[0].step.displayName, 'Cool-down');
});

test('goals: open duration -> OpenGoal, open target -> no alert; name is trimmed', () => {
  const plan = A.toPlanJson(workout('o', '  Lap run  ', [step('active', open(), open())]));
  assert.equal(plan.custom.displayName, 'Lap run');
  assert.deepEqual(plan.custom.blocks[0].steps[0], { purpose: 'work', step: { goal: { type: 'open' } } });
});

test('options: indoor location, explicit referenceId, invalid options', () => {
  const id = '6F9619FF-8B86-D011-B42D-00C04FC964FF';
  const plan = A.toPlanJson(SAMPLES.easy, { location: 'indoor', referenceId: id });
  assert.equal(plan.custom.location, 'indoor');
  assert.equal(plan.referenceId, id);
  assert.throws(() => A.toPlanJson(SAMPLES.easy, { location: 'pool' }), (e) => e.code === 'apple_option_invalid' && e.option === 'location');
  assert.throws(() => A.toPlanJson(SAMPLES.easy, { referenceId: 'abc' }), (e) => e.code === 'apple_option_invalid' && e.option === 'referenceId');
  assert.deepEqual(A.LOCATIONS, ['outdoor', 'indoor']);
});

test('referenceId: deterministic per content, new when the workout changes', () => {
  const a = A.toPlanJson(SAMPLES.reps).referenceId;
  assert.equal(A.toPlanJson(JSON.parse(JSON.stringify(SAMPLES.reps))).referenceId, a);
  const edited = JSON.parse(JSON.stringify(SAMPLES.reps));
  edited.steps[1].count = 8;
  assert.notEqual(A.toPlanJson(edited).referenceId, a);
  assert.notEqual(A.toPlanJson(Object.assign({}, SAMPLES.reps, { id: 'other' })).referenceId, a);
  assert.notEqual(A.toPlanJson(SAMPLES.reps, { location: 'indoor' }).referenceId, a);
  assert.deepEqual(A.encodeWorkout(SAMPLES.reps), A.encodeWorkout(SAMPLES.reps));
  const ids = new Set(Array.from({ length: 500 }, (_, i) => A.uuidFrom('w' + i)));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[0-9A-F]{8}-[0-9A-F]{4}-8[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
});

test('invalid workouts throw workout_invalid with the validation errors', () => {
  const bad = workout('b', '', [step('active', distance(10))]);
  for (const fn of [() => A.encodeWorkout(bad), () => A.toPlanJson(bad), () => A.layout(bad)]) {
    assert.throws(fn, (e) => e.code === 'workout_invalid' && e.errors.some((x) => x.code === 'name_required') &&
      e.errors.some((x) => x.code === 'duration_distance_range'));
  }
  assert.throws(() => A.encodeWorkout(null), (e) => e.code === 'workout_invalid');
  assert.throws(() => A.encodeWorkout(workout('b', 'Pace', [step('active', time(60), pace(300, 290))])), (e) => e.code === 'workout_invalid');
});

test('fileName: ASCII, dashes, × -> x, fallback', () => {
  assert.equal(A.fileName(SAMPLES.reps), 'Useky-6x-400-m.workout');
  assert.equal(A.fileName({ name: 'Žluťoučký kůň: tempo/400 m?' }), 'Zlutoucky-kun-tempo-400-m.workout');
  assert.equal(A.fileName({ name: '  ' }), 'veyvo-workout.workout');
  assert.equal(A.fileName({ name: '🏃‍♂️' }), 'veyvo-workout.workout');
  assert.equal(A.fileName(null), 'veyvo-workout.workout');
  assert.equal(A.fileName({ name: 'Ř'.repeat(80) }), 'R'.repeat(60) + '.workout');
  assert.match(A.fileName({ name: 'Tempo 3× 2 km — ' + 'a'.repeat(70) }), /^[A-Za-z0-9-]+[A-Za-z0-9]\.workout$/);
  const f = A.file(SAMPLES.czech);
  assert.equal(f.name, 'Lehky-beh-3-km.workout');
  assert.equal(f.mime, 'application/octet-stream');
  assert.ok(f.data instanceof Uint8Array && f.data.length > 0);
});

// ---------------------------------------------------------------- bytes without the library

test('wire format: plan, custom workout and blocks are where Apple expects them', () => {
  const bytes = A.encodeWorkout(SAMPLES.czech);
  const plan = readProto(bytes);
  assert.equal(text(pick(plan, 9)[0].value), A.toPlanJson(SAMPLES.czech).referenceId);
  assert.equal(pick(plan, 1000)[0].value, 1);
  assert.equal(pick(plan, 1002)[0].value, 5);
  const custom = readProto(pick(plan, 11)[0].value);
  assert.equal(pick(custom, 1)[0].value, 37, 'running');
  assert.equal(pick(custom, 2)[0].value, 3, 'outdoor');
  assert.equal(text(pick(custom, 3)[0].value), 'Lehký běh 3 km');
  assert.equal(pick(custom, 4).length, 0, 'no warm-up');
  assert.equal(pick(custom, 6).length, 0, 'no cool-down');
  assert.equal(pick(custom, 5).length, 1, 'one block');

  const reps = readProto(pick(readProto(A.encodeWorkout(SAMPLES.reps, { location: 'indoor' })), 11)[0].value);
  assert.equal(pick(reps, 2)[0].value, 2, 'indoor');
  assert.equal(pick(reps, 4).length, 1);
  assert.equal(pick(reps, 6).length, 1);
  const blocks = pick(reps, 5).map((b) => readProto(b.value));
  assert.equal(blocks.length, 1);
  assert.equal(pick(blocks[0], 2)[0].value, 6, 'iterations');
  assert.deepEqual(pick(blocks[0], 1).map((s) => pick(readProto(s.value), 1)[0].value), [1, 2], 'work, recovery');
});

// ---------------------------------------------------------------- round trip through the decoder

test('round trip: the four reference workouts decode to the same structure', { skip: NO_DECODER }, async () => {
  if (OUT_DIR) fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [key, w] of Object.entries(SAMPLES)) {
    const bytes = A.encodeWorkout(w);
    if (OUT_DIR) fs.writeFileSync(path.join(OUT_DIR, key + '-' + A.fileName(w)), bytes);
    const plan = await decode(bytes);
    assert.equal(plan.referenceId, A.toPlanJson(w).referenceId, key);
    assert.equal(plan.goal, undefined);
    assert.equal(plan.pacer, undefined);
    assert.equal(plan.custom.activity, 'running');
    assert.equal(plan.custom.location, 'outdoor');
    assert.equal(plan.custom.displayName, w.name);
  }

  const easy = (await decode(A.encodeWorkout(SAMPLES.easy))).custom;
  assert.equal(easy.warmup, undefined);
  assert.equal(easy.cooldown, undefined);
  assert.equal(easy.blocks.length, 1);
  assert.equal(easy.blocks[0].iterations, 1);
  assert.equal(easy.blocks[0].steps.length, 1);
  const easyStep = easy.blocks[0].steps[0];
  assert.equal(easyStep.purpose, 'work');
  assert.deepEqual(easyStep.step.goal, { type: 'distance', distance: { value: 3000, unit: 'meters' } });
  assert.equal(easyStep.step.alert.type, 'speedRange');
  assert.equal(easyStep.step.alert.metric, undefined, 'current pace (WorkoutKit default)');
  near(metersPerSecond(easyStep.step.alert.min), 1000 / 365, 'min speed');
  near(metersPerSecond(easyStep.step.alert.max), 1000 / 305, 'max speed');
  near(1000 / metersPerSecond(easyStep.step.alert.max), 305, '5:05 /km');
  near(1000 / metersPerSecond(easyStep.step.alert.min), 365, '6:05 /km');

  const reps = (await decode(A.encodeWorkout(SAMPLES.reps))).custom;
  assert.deepEqual(reps.warmup, { goal: { type: 'time', time: { value: 900, unit: 'seconds' } } });
  assert.deepEqual(reps.cooldown, { goal: { type: 'time', time: { value: 600, unit: 'seconds' } } });
  assert.equal(reps.blocks.length, 1);
  assert.equal(reps.blocks[0].iterations, 6);
  assert.deepEqual(reps.blocks[0].steps.map((s) => s.purpose), ['work', 'recovery']);
  const work = reps.blocks[0].steps[0].step, jog = reps.blocks[0].steps[1].step;
  assert.deepEqual(work.goal, { type: 'distance', distance: { value: 400, unit: 'meters' } });
  near(1000 / metersPerSecond(work.alert.max), 230, '3:50 /km');
  near(1000 / metersPerSecond(work.alert.min), 237, '3:57 /km');
  assert.ok(metersPerSecond(work.alert.max) > metersPerSecond(work.alert.min), 'fast pace = higher speed');
  assert.deepEqual(jog, { goal: { type: 'distance', distance: { value: 200, unit: 'meters' } } });

  const hrRun = (await decode(A.encodeWorkout(SAMPLES.hr))).custom;
  assert.equal(hrRun.blocks.length, 1);
  assert.deepEqual(hrRun.blocks[0].steps[0].step.goal, { type: 'time', time: { value: 2400, unit: 'seconds' } });
  const hrAlert = hrRun.blocks[0].steps[0].step.alert;
  assert.equal(hrAlert.type, 'heartRateRange');
  near(hrAlert.min.value, 140, 'low bpm');
  near(hrAlert.max.value, 155, 'high bpm');
  assert.equal(hrAlert.min.unit, 'beatsPerMinute');

  const czech = (await decode(A.encodeWorkout(SAMPLES.czech))).custom;
  assert.equal(czech.displayName, 'Lehký běh 3 km');
  assert.equal(czech.blocks[0].steps[0].step.goal.distance.value, 3000);
  near(1000 / metersPerSecond(czech.blocks[0].steps[0].step.alert.min), 365, 'plan slow pace');
});

test('round trip: decoded plan matches toPlanJson exactly for every library session', { skip: NO_DECODER }, async () => {
  const paces = W.derivePaces({ best5kSeconds: 1290, targetSeconds: 1200 });
  for (const locale of ['cs', 'en']) {
    for (const p of [paces, null]) {
      for (const template of W.library(p, { locale: locale })) {
        const bytes = A.encodeWorkout(template.workout, { locale: locale });
        assert.deepEqual(await decode(bytes), A.toPlanJson(template.workout, { locale: locale }), template.id + ' ' + locale);
      }
    }
  }
  const test5k = (await decode(A.encodeWorkout(W.library(paces)[5].workout))).custom;
  assert.equal(test5k.blocks[0].steps[0].step.displayName, 'Naplno');
  assert.ok(test5k.warmup && test5k.cooldown);
});

test('round trip: labels, misplaced warm-up, open goals, 99 iterations and 50 steps', { skip: NO_DECODER }, async () => {
  const w = workout('edge', 'Hraniční „případ“ & <test>', [
    step('cooldown', time(60)),
    repeat(99, [step('active', time(10), pace(150, 720), 'Sprint'), step('rest', open())]),
    step('active', open(), hr(60, 220)),
    step('warmup', distance(50))
  ]);
  const plan = await decode(A.encodeWorkout(w));
  assert.deepEqual(plan, A.toPlanJson(w));
  assert.equal(plan.custom.displayName, 'Hraniční „případ“ & <test>');
  assert.deepEqual(plan.custom.blocks.map((b) => b.iterations), [1, 99, 1, 1]);
  assert.equal(plan.custom.blocks[1].steps[0].step.displayName, 'Sprint');
  assert.equal(plan.custom.blocks[1].steps[1].step.displayName, 'Pauza');
  assert.deepEqual(plan.custom.blocks[1].steps[1].step.goal, { type: 'open' });

  // 49 plain steps + the 1-step repeat = 50 FIT steps: still one block per item for Apple.
  const many = workout('many', 'Many', Array.from({ length: 48 }, (_, i) => step(i % 2 ? 'recovery' : 'active', time(60))).concat([repeat(2, [step('active', time(30))])]));
  assert.equal(W.fitStepCount(many), 50);
  const decoded = await decode(A.encodeWorkout(many));
  assert.equal(decoded.custom.blocks.length, 49);
  assert.equal(decoded.custom.blocks[48].iterations, 2);
});

// ---------------------------------------------------------------- classic script loading

test('classic scripts: VeyvoApple global, needs VeyvoWorkouts, lazy VeyvoWorkoutKit', () => {
  const missing = {};
  vm.createContext(missing);
  assert.throws(() => vm.runInContext(fs.readFileSync(SRC, 'utf8'), missing), /needs VeyvoWorkouts/);

  const page = { TextEncoder: TextEncoder };
  vm.createContext(page);
  vm.runInContext(fs.readFileSync(WORKOUTS_SRC, 'utf8'), page);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), page); // before the vendor script: still loads
  assert.equal(typeof page.VeyvoApple.encodeWorkout, 'function');
  assert.equal(page.VeyvoApple.isAvailable(), false);
  const w = page.VeyvoWorkouts.library(null)[0].workout;
  assert.throws(() => page.VeyvoApple.encodeWorkout(w), (e) => e.code === 'apple_encoder_missing');
  assert.equal(page.VeyvoApple.toPlanJson(w).custom.displayName, 'Lehký běh 5 km');

  vm.runInContext(fs.readFileSync(KIT_SRC, 'utf8'), page);
  assert.equal(page.VeyvoApple.isAvailable(), true);
  const bytes = page.VeyvoApple.encodeWorkout(w);
  assert.deepEqual(Array.from(bytes), Array.from(A.encodeWorkout(w)), 'same bytes in the page and in Node');
});

test('encoder failures are wrapped as apple_encode_failed', () => {
  const sandbox = { VeyvoWorkoutKit: { encode: () => { throw new Error('boom'); } } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(WORKOUTS_SRC, 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);
  const w = sandbox.VeyvoWorkouts.library(null)[0].workout;
  assert.throws(() => sandbox.VeyvoApple.encodeWorkout(w), (e) => e.code === 'apple_encode_failed' && /boom/.test(e.message) && e.cause.message === 'boom');
  sandbox.VeyvoWorkoutKit.encode = () => new Uint8Array(0);
  assert.throws(() => sandbox.VeyvoApple.encodeWorkout(w), (e) => e.code === 'apple_encode_failed');
});
