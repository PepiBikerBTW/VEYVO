// Cross-module integration: one VEYVO workout model, five outputs (printable text, FIT, Apple
// .workout, Zwift .zwo, intervals.icu text + request). Every output is decoded or parsed back and
// compared with the model step by step, so the exporters cannot drift apart (pace direction, repeat
// expansion, units, names). Decoders are dev-only: @garmin/fitsdk (devDependency) and the
// @bibixx/workoutkit decoder (never vendored into src/).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const W = require('../src/core/workouts.js');
const Fit = require('../src/core/export/fit.js');
const Apple = require('../src/core/export/apple.js');
const Zwo = require('../src/core/export/zwo.js');
const Intervals = require('../src/core/export/intervals.js');
const Training = require('../src/training-context.js');
const Runs = require('../src/core/runs-model.js');
const Platform = require('../src/platform.js');
const U = Platform.util;

const ROOT = path.join(__dirname, '..');
const APPLE_DECODE = [
  process.env.VEYVO_WORKOUTKIT_DECODE,
  path.join(ROOT, 'node_modules', '@bibixx', 'workoutkit', 'dist', 'decode.js')
].find((p) => p && fs.existsSync(p));
const NO_APPLE_DECODER = APPLE_DECODE ? false : '@bibixx/workoutkit decode.js not found (set VEYVO_WORKOUTKIT_DECODE)';

let SDK = null;
let appleDecode = null;
before(async () => {
  SDK = await import('@garmin/fitsdk');
  if (APPLE_DECODE) appleDecode = (await import(pathToFileURL(APPLE_DECODE).href)).decode;
});

const CREATED = new Date('2026-11-27T18:30:00Z');
const LTHR = 172;

// ---------------------------------------------------------------- workouts under test

const s = (intensity, duration, target, label) => {
  const step = { kind: 'step', intensity, duration, target: target || { type: 'open' } };
  if (label !== undefined) step.label = label;
  return step;
};
const time = (seconds) => ({ type: 'time', seconds });
const dist = (meters) => ({ type: 'distance', meters });
const open = () => ({ type: 'open' });
const pace = (fastSecPerKm, slowSecPerKm) => ({ type: 'pace', fastSecPerKm, slowSecPerKm });
const hr = (lowBpm, highBpm) => ({ type: 'hr', lowBpm, highBpm });
const workout = (id, name, steps, extra) => Object.assign({ id, name, sport: 'running', source: 'custom', steps }, extra || {});

// The four reference workouts used by every exporter's own tests.
const SAMPLES = [
  workout('lib-easy', 'Lehký běh 3 km', [s('active', dist(3000), pace(305, 365))]),
  workout('lib-intervals400', 'Intervaly 6x400', [
    s('warmup', time(900)),
    { kind: 'repeat', count: 6, steps: [s('active', dist(400), pace(230, 237)), s('recovery', dist(200))] },
    s('cooldown', time(600))
  ]),
  workout('test-hr-open', 'Tep a Lap', [
    s('warmup', open(), open()),
    s('active', time(1200), hr(140, 155)),
    s('rest', open()),
    s('cooldown', dist(1000), hr(110, 130))
  ]),
  workout('czech', 'Lehký běh 3 km', [
    s('warmup', time(300), open(), 'Rozběhání, žádný spěch'),
    s('active', dist(3000), pace(305, 365), 'Klidně, ať můžeš mluvit'),
    s('cooldown', time(120), open(), 'Vyklusání')
  ])
];

// Shapes the samples do not cover: a repeat first, a single-pass repeat, three-step and two
// repeats, a warm-up in the middle, a mile in metres, a timed rest, a fractional distance.
const EDGE = workout('edge', 'Kombinace úseků a mílí', [
  { kind: 'repeat', count: 3, steps: [s('active', time(60), pace(240, 250)), s('rest', time(30)), s('recovery', dist(150), hr(120, 140))] },
  s('warmup', time(300), open(), 'Druhé rozklusání'),
  { kind: 'repeat', count: 1, steps: [s('active', dist(1609), pace(260, 270), 'Míle'), s('recovery', time(90))] },
  { kind: 'repeat', count: 2, steps: [s('active', dist(2500), pace(255, 265)), s('recovery', time(120))] },
  s('active', dist(1250.5), open()),
  s('cooldown', open())
]);

const PACE_CASES = [
  ['owner 21:02 -> 20:00', { best5kSeconds: 1262, targetSeconds: 1200 }],
  ['no times', null],
  ['goal only', { targetSeconds: 1200 }],
  ['best only', { best5kSeconds: 1262 }],
  ['beginner 45:00 -> 40:00', { best5kSeconds: 2700, targetSeconds: 2400 }],
  ['fast 15:00 -> 14:00', { best5kSeconds: 900, targetSeconds: 840 }]
];

const OWNER_PACES = W.derivePaces({ best5kSeconds: 1262, targetSeconds: 1200 });
const FALLBACK_ZWO = { referencePaceSecPerKm: 300, easyPaceSecPerKm: { fastSecPerKm: 330, slowSecPerKm: 390 } };

/** Owner demo runs -> VeyvoTraining next run -> VeyvoWorkouts.fromNextRun (cs + en). */
function planWorkouts() {
  const runs = [
    { id: 'm-5', source: 'manual', date: '2026-11-10', type: 'test5k', distance: 5, movingSeconds: 1290, effort: 9 },
    { id: 'm-8', source: 'manual', date: '2026-11-21', type: 'long', distance: 12, movingSeconds: 4180, effort: 6 },
    { id: 'm-9', source: 'manual', date: '2026-11-24', type: 'run', distance: 5, movingSeconds: 1262, effort: 9 }
  ];
  const latest = Runs.sortRuns(runs).at(-1);
  const baseline = runs.find((r) => r.type === 'test5k');
  const suggestions = [
    Training.nextRunAfterRun(latest, [1, 6], '2026-11-26', baseline),
    Training.nextRunAfterRun(latest, [1, 6], '2026-12-08', baseline), // two weeks later: easy return
    Training.nextRunAfter5k({ date: '2026-11-24', distance: 5, movingSeconds: 1262, effort: 6 }, [1, 6], '2026-11-24')
  ];
  const out = [];
  suggestions.forEach((next, i) => {
    for (const locale of ['cs', 'en']) {
      const w = W.fromNextRun(next, { days: [1, 6] }, { locale });
      assert.ok(w, 'plan ' + i + ' ' + locale + ' gives a workout');
      out.push({ label: 'plan ' + i + ' ' + locale, workout: w, paces: OWNER_PACES, locale });
    }
  });
  return out;
}

function allCases() {
  const cases = [];
  for (const w of SAMPLES.concat([EDGE])) {
    for (const locale of ['cs', 'en']) cases.push({ label: 'sample ' + w.id + ' ' + locale, workout: w, paces: OWNER_PACES, locale });
  }
  for (const [name, input] of PACE_CASES) {
    const paces = input ? W.derivePaces(input) : null;
    for (const locale of ['cs', 'en']) {
      for (const template of W.library(paces, { locale })) {
        cases.push({ label: 'library ' + template.id + ' (' + name + ') ' + locale, workout: template.workout, paces, locale, template });
      }
    }
  }
  return cases.concat(planWorkouts());
}
const CASES = allCases();

// ---------------------------------------------------------------- reference expansion of the model

/** Executed steps in order (repeats unrolled), each { intensity, d, v, t, lo, hi, label, inRepeat }. */
function expandModel(w) {
  const out = [];
  const one = (step, inRepeat) => {
    const e = { intensity: step.intensity, d: step.duration.type, v: null, t: step.target.type, lo: null, hi: null, label: step.label, inRepeat };
    if (e.d === 'time') e.v = step.duration.seconds;
    if (e.d === 'distance') e.v = step.duration.meters;
    if (e.t === 'pace') { e.lo = 1000 / step.target.slowSecPerKm; e.hi = 1000 / step.target.fastSecPerKm; }
    if (e.t === 'hr') { e.lo = step.target.lowBpm; e.hi = step.target.highBpm; }
    return e;
  };
  for (const item of w.steps) {
    if (item.kind === 'repeat') for (let r = 0; r < item.count; r++) item.steps.forEach((st) => out.push(one(st, true)));
    else out.push(one(item, false));
  }
  return out;
}

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected} (±${tolerance})`);
}

// ---------------------------------------------------------------- 1. model + printable text

test('every sample, library session (all pace cases, cs + en) and plan workout validates and prints', () => {
  assert.ok(CASES.length >= 80, 'cases: ' + CASES.length);
  const ids = new Set();
  for (const c of CASES) {
    const w = c.workout;
    const v = W.validate(w);
    assert.equal(v.ok, true, c.label + ': ' + JSON.stringify(v.errors));
    assert.equal(v.fitStepCount, W.flatten(w).length, c.label);
    for (const locale of ['cs', 'en']) {
      const lines = W.toLines(w, locale);
      assert.equal(lines.length, w.steps.length, c.label + ' one line per top-level item');
      lines.forEach((line, i) => {
        assert.doesNotMatch(line, /undefined|NaN|null|\{|\}|—/, c.label + ' ' + locale + ': ' + line);
        if (w.steps[i].kind === 'repeat') assert.ok(line.startsWith(w.steps[i].count + '× '), line);
      });
      assert.equal(W.toText(w, locale), lines.join('\n'));
    }
    if (c.template) {
      assert.equal(c.template.paced, w.steps.some((x) => (x.kind === 'repeat' ? x.steps : [x]).some((st) => st.target.type === 'pace')), c.label + ' paced flag');
      ids.add(c.locale + ':' + w.id);
    }
    assert.doesNotMatch(w.name + ' ' + (w.description || ''), /undefined|NaN|\{[a-zA-Z]+\}/, c.label + ' name/description filled');
  }
  // Czech decimal comma in the printable text, English decimal point.
  assert.equal(W.toLines(EDGE, 'cs')[4], 'Běh 1,25 km');
  assert.equal(W.toLines(EDGE, 'en')[4], 'Run 1.25 km');
  assert.equal(ids.size, 2 * W.LIBRARY_IDS.length, 'library ids are stable per locale');
});

// ---------------------------------------------------------------- 2. FIT

function decodeFit(bytes) {
  const decoder = new SDK.Decoder(SDK.Stream.fromByteArray(bytes));
  assert.equal(SDK.Decoder.isFIT(SDK.Stream.fromByteArray(bytes)), true);
  assert.equal(decoder.isFIT(), true);
  assert.equal(decoder.checkIntegrity(), true, 'header + file CRC and sizes');
  const { messages, errors } = decoder.read();
  assert.deepEqual(errors, []);
  return messages;
}

/** Decoded workout_step messages with repeats unrolled. */
function expandFit(steps) {
  const out = [];
  steps.forEach((m, i) => {
    assert.equal(m.messageIndex, i, 'message_index runs 0..n-1');
    if (m.durationType === 'repeatUntilStepsCmplt') {
      assert.ok(m.durationStep < i, 'repeat points back');
      const block = steps.slice(m.durationStep, i);
      assert.ok(block.every((b) => b.durationType !== 'repeatUntilStepsCmplt'), 'no nested repeats');
      for (let r = 1; r < m.repeatSteps; r++) block.forEach((b) => out.push(b));
      return;
    }
    out.push(m);
  });
  return out;
}

test('FIT: every workout decodes with @garmin/fitsdk and matches the model step by step', () => {
  const INTENSITY = { warmup: 'warmup', active: 'active', recovery: 'recovery', rest: 'rest', cooldown: 'cooldown' };
  for (const c of CASES) {
    const w = c.workout;
    const bytes = Fit.encodeWorkout(w, { timeCreated: CREATED, locale: c.locale });
    assert.deepEqual(Fit.encodeWorkout(w, { timeCreated: CREATED, locale: c.locale }), bytes, c.label + ' deterministic');
    // header: size 14, data size = file - header - CRC
    assert.equal(bytes[0], 14);
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true), bytes.length - 16, c.label + ' data size');
    assert.equal(Fit.crc16(bytes), 0, c.label + ' CRC over the whole file is 0');
    const messages = decodeFit(bytes);
    const flat = W.flatten(w);
    assert.deepEqual(messages.workoutMesgs[0], { wktName: Fit.garminName(w), sport: 'running', numValidSteps: flat.length }, c.label);
    assert.equal(messages.fileIdMesgs[0].type, 'workout');
    const decoded = messages.workoutStepMesgs;
    assert.equal(decoded.length, flat.length, c.label + ' step count');
    // default names match VeyvoWorkouts (the watch shows the same words as the app)
    flat.forEach((f, i) => {
      if (f.kind === 'repeat') { assert.equal(decoded[i].wktStepName, undefined); return; }
      assert.equal(decoded[i].wktStepName, f.label || W.stepName(f, c.locale, f.inRepeat), c.label + ' step name ' + i);
    });
    const expected = expandModel(w);
    const got = expandFit(decoded);
    assert.equal(got.length, expected.length, c.label + ' unrolled steps');
    expected.forEach((e, i) => {
      const g = got[i];
      const where = c.label + ' step ' + i;
      assert.equal(g.intensity, INTENSITY[e.intensity], where);
      assert.equal(g.durationType, e.d === 'open' ? 'open' : e.d, where);
      if (e.d === 'time') close(g.durationTime, e.v, 0.001, where);
      if (e.d === 'distance') close(g.durationDistance, e.v, 0.01, where);
      if (e.t === 'open') { assert.equal(g.targetType, 'open', where); return; }
      if (e.t === 'pace') {
        assert.equal(g.targetType, 'speed', where);
        close(g.customTargetSpeedLow, e.lo, 0.0006, where + ' low = slower pace');
        close(g.customTargetSpeedHigh, e.hi, 0.0006, where + ' high = faster pace');
        assert.ok(g.customTargetSpeedLow < g.customTargetSpeedHigh, where);
      } else {
        assert.equal(g.targetType, 'heartRate', where);
        assert.equal(g.customTargetValueLow - 100, Math.round(e.lo), where + ' bpm + 100');
        assert.equal(g.customTargetValueHigh - 100, Math.round(e.hi), where);
      }
    });
  }
});

// ---------------------------------------------------------------- 3. Apple

function expandApple(plan) {
  const c = plan.custom;
  const out = [];
  if (c.warmup) out.push({ purpose: 'warmup', step: c.warmup });
  for (const block of c.blocks) {
    assert.ok(Number.isInteger(block.iterations) && block.iterations >= 1);
    for (let r = 0; r < block.iterations; r++) block.steps.forEach((x) => out.push({ purpose: x.purpose, step: x.step }));
  }
  if (c.cooldown) out.push({ purpose: 'cooldown', step: c.cooldown });
  return out;
}
const speedOf = (speed) => {
  assert.equal(speed.distance.unit, 'meters');
  assert.equal(speed.time.unit, 'seconds');
  return speed.distance.value / speed.time.value;
};

test('Apple: every workout decodes with @bibixx/workoutkit and matches the model step by step', { skip: NO_APPLE_DECODER }, () => {
  for (const c of CASES) {
    const w = c.workout;
    const bytes = Apple.encodeWorkout(w, { locale: c.locale });
    assert.deepEqual(Apple.encodeWorkout(w, { locale: c.locale }), bytes, c.label + ' deterministic');
    const plan = appleDecode(bytes).toJSON();
    assert.deepEqual(plan, Apple.toPlanJson(w, { locale: c.locale }), c.label + ' decoded = encoded plan');
    assert.equal(plan.custom.activity, 'running');
    assert.equal(plan.custom.displayName, w.name.trim());
    const expected = expandModel(w);
    const got = expandApple(plan);
    assert.equal(got.length, expected.length, c.label + ' unrolled steps');
    // Apple keeps warm-up / cool-down only at the ends (and only around at least one block).
    const isStep = (item, intensity) => item.kind === 'step' && item.intensity === intensity;
    const hasWarmup = isStep(w.steps[0], 'warmup') && w.steps.length > 1 && !(w.steps.length === 2 && isStep(w.steps[1], 'cooldown'));
    const hasCooldown = isStep(w.steps[w.steps.length - 1], 'cooldown') && w.steps.length > 1 && !(w.steps.length === 2 && isStep(w.steps[0], 'warmup'));
    assert.equal(Boolean(plan.custom.warmup), hasWarmup, c.label + ' warm-up slot');
    assert.equal(Boolean(plan.custom.cooldown), hasCooldown, c.label + ' cool-down slot');
    expected.forEach((e, i) => {
      const g = got[i];
      const where = c.label + ' step ' + i;
      const purpose = i === 0 && hasWarmup ? 'warmup' : i === expected.length - 1 && hasCooldown ? 'cooldown' : e.intensity === 'active' ? 'work' : 'recovery';
      assert.equal(g.purpose, purpose, where);
      if (purpose === 'recovery' && e.intensity !== 'recovery' && !e.label) assert.equal(g.step.displayName, W.stepName(e, c.locale, e.inRepeat), where + ' named');
      const goal = g.step.goal;
      assert.equal(goal.type, e.d, where);
      if (e.d === 'time') { assert.equal(goal.time.unit, 'seconds'); close(goal.time.value, e.v, 1e-9, where); }
      if (e.d === 'distance') { assert.equal(goal.distance.unit, 'meters'); close(goal.distance.value, e.v, 1e-9, where); }
      if (e.t === 'open') { assert.equal(g.step.alert, undefined, where); return; }
      if (e.t === 'pace') {
        assert.equal(g.step.alert.type, 'speedRange', where);
        close(speedOf(g.step.alert.min), e.lo, 1e-9, where + ' min = slower pace');
        close(speedOf(g.step.alert.max), e.hi, 1e-9, where + ' max = faster pace');
      } else {
        assert.equal(g.step.alert.type, 'heartRateRange', where);
        assert.deepEqual([g.step.alert.min.value, g.step.alert.max.value], [e.lo, e.hi], where);
      }
      if (e.label) assert.equal(g.step.displayName, e.label.trim(), where + ' label');
    });
  }
});

// ---------------------------------------------------------------- 4. ZWO

/** Minimal XML checker: balanced tags, quoted attributes, only the five entities, one root. */
function parseZwo(xml) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<workout_file>'));
  const body = xml.replace(/^<\?xml[^>]*\?>/, '');
  const stack = [];
  const blocks = [];
  const tagRe = /<(\/?)([A-Za-z_][\w-]*)((?:\s+[A-Za-z_][\w-]*="[^"<]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  let consumed = 0;
  while ((m = tagRe.exec(body))) {
    assert.equal(m.index, consumed, 'no stray markup at ' + m.index);
    consumed = tagRe.lastIndex;
    if (m[5] !== undefined) {
      assert.doesNotMatch(m[5], /&(?!(amp|lt|gt|quot|apos|#10|#9);)/, 'entity');
      continue;
    }
    const [, closing, name, attrText, selfClosing] = m;
    if (closing) { assert.equal(stack.pop(), name, 'closing ' + name); continue; }
    const attrs = {};
    for (const a of attrText.matchAll(/([A-Za-z_][\w-]*)="([^"]*)"/g)) {
      assert.ok(!(a[1] in attrs), 'duplicate attribute ' + a[1]);
      assert.doesNotMatch(a[2], /&(?!(amp|lt|gt|quot|apos|#10|#9);)/, 'entity in ' + a[1]);
      attrs[a[1]] = a[2];
    }
    if (stack.length === 2 && stack[1] === 'workout') blocks.push({ name, attrs });
    if (!selfClosing) stack.push(name);
  }
  assert.equal(consumed, body.length);
  assert.deepEqual(stack, []);
  return blocks;
}

test('ZWO: every workout is well-formed XML whose blocks match the model', () => {
  const round4 = (x) => Math.round(x * 1e4) / 1e4;
  for (const c of CASES) {
    const w = c.workout;
    const opts = Object.assign({ locale: c.locale }, Zwo.optionsFromPaces(c.paces) || FALLBACK_ZWO);
    const result = Zwo.convert(w, opts);
    assert.equal(Zwo.check(w, opts).ok, true, c.label);
    const blocks = parseZwo(result.xml);
    assert.equal(result.blockCount, blocks.length);
    assert.match(result.xml, new RegExp('<durationType>' + result.durationType + '</durationType>'));
    // unroll IntervalsT and compare with the model
    const unrolled = [];
    for (const b of blocks) {
      assert.equal(b.attrs.pace, '1', '5 km reference');
      if (b.name === 'IntervalsT') {
        for (let r = 0; r < Number(b.attrs.Repeat); r++) {
          unrolled.push({ name: 'On', duration: Number(b.attrs.OnDuration), power: Number(b.attrs.OnPower) });
          unrolled.push({ name: 'Off', duration: Number(b.attrs.OffDuration), power: Number(b.attrs.OffPower) });
        }
      } else {
        unrolled.push({ name: b.name, duration: Number(b.attrs.Duration), power: Number(b.attrs.Power), low: Number(b.attrs.PowerLow), high: Number(b.attrs.PowerHigh) });
      }
    }
    const expected = expandModel(w);
    assert.equal(unrolled.length, expected.length, c.label + ' unrolled blocks');
    const ref = opts.referencePaceSecPerKm;
    expected.forEach((e, i) => {
      const g = unrolled[i];
      const where = c.label + ' block ' + i;
      assert.ok(Number.isInteger(g.duration) && g.duration >= 1, where + ' duration');
      if (e.d === result.durationType) assert.equal(g.duration, Math.max(1, Math.round(e.v)), where + ' same-unit duration kept');
      if (e.t === 'pace') {
        // Zwift fractions are speed relative to the reference pace: faster pace -> bigger number.
        const mid = (1000 / e.lo + 1000 / e.hi) / 2;
        if (g.name === 'Warmup') { assert.equal(g.low, round4(ref * e.lo / 1000)); assert.equal(g.high, round4(ref * e.hi / 1000)); }
        else if (g.name === 'Cooldown') { assert.equal(g.low, round4(ref * e.hi / 1000)); assert.equal(g.high, round4(ref * e.lo / 1000)); }
        else assert.equal(g.power, round4(ref / mid), where + ' power = reference / target');
      }
      for (const p of [g.power, g.low, g.high]) if (p !== undefined && !Number.isNaN(p)) assert.ok(p > 0 && p < 3, where + ' plausible fraction ' + p);
    });
  }
});

// ---------------------------------------------------------------- 5. intervals.icu

/** Parses VEYVO's intervals.icu text back into unrolled steps. */
function parseIntervals(text) {
  const out = [];
  let repeat = null;
  const flush = () => {
    if (!repeat) return;
    for (let r = 0; r < repeat.count; r++) repeat.steps.forEach((x) => out.push(Object.assign({}, x, { inRepeat: true })));
    repeat = null;
  };
  for (const line of text.split('\n')) {
    if (line === '') { flush(); continue; }
    const header = /^(.+) (\d+)x$/.exec(line);
    if (header && !line.startsWith('- ')) { flush(); repeat = { count: Number(header[2]), steps: [] }; continue; }
    if (!line.startsWith('- ')) { assert.ok(!repeat, 'note lines only before the steps: ' + line); continue; }
    const tokens = line.slice(2).split(' ');
    const step = { open: line.startsWith('- Press lap '), d: null, v: null, slow: null, fast: null, hr: null, intensity: null };
    const durationToken = tokens.find((t) => /^\d/.test(t));
    let m;
    if ((m = /^(\d+(?:\.\d+)?)km$/.exec(durationToken))) { step.d = 'distance'; step.v = Number(m[1]) * 1000; }
    else if ((m = /^(\d+)mtr$/.exec(durationToken))) { step.d = 'distance'; step.v = Number(m[1]); }
    else if ((m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(durationToken)) && durationToken) {
      step.d = 'time'; step.v = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
    } else assert.fail('no duration in ' + line);
    if ((m = / (\d+:\d\d)-(\d+:\d\d)\/km Pace/.exec(line))) { step.slow = m[1]; step.fast = m[2]; }
    if ((m = / (\d+)(?:-(\d+))?% LTHR/.exec(line))) step.hr = [Number(m[1]), Number(m[2] || m[1])];
    step.intensity = (/ intensity=(\w+)$/.exec(line) || [])[1];
    assert.ok(step.intensity, 'intensity on every step: ' + line);
    if (repeat) repeat.steps.push(step); else out.push(Object.assign(step, { inRepeat: false }));
  }
  flush();
  return out;
}

test('intervals.icu: workout text parses back to the model and the request passes the platform allowlist', () => {
  const payloadInput = [];
  for (const c of CASES) {
    const w = c.workout;
    const { text, warnings } = Intervals.convert(w, { locale: c.locale, lthrBpm: LTHR, includeDescription: true });
    assert.ok(!warnings.some((x) => x.code === 'hr_absolute_unsupported'), c.label + ' bpm converted with LTHR');
    const got = parseIntervals(text);
    const expected = expandModel(w);
    assert.equal(got.length, expected.length, c.label + ' unrolled steps\n' + text);
    expected.forEach((e, i) => {
      const g = got[i];
      const where = c.label + ' step ' + i + ': ' + JSON.stringify(g);
      if (e.d === 'open') { assert.equal(g.open, true, where); assert.equal(g.d, 'time', where + ' nominal length'); }
      else {
        assert.equal(g.open, false, where);
        assert.equal(g.d, e.d, where);
        assert.equal(g.v, Math.round(e.v), where);
      }
      if (e.t === 'pace') {
        // slower pace first, as in every official example
        assert.equal(g.slow, W.format.pace(1000 / e.lo), where + ' slow first');
        assert.equal(g.fast, W.format.pace(1000 / e.hi), where);
      } else assert.equal(g.slow, null, where);
      if (e.t === 'hr') assert.deepEqual(g.hr, [Math.round(e.lo / LTHR * 100), Math.round(e.hi / LTHR * 100)], where);
      const intensity = e.intensity === 'active' ? (g.inRepeat ? 'interval' : 'active') : e.intensity;
      assert.equal(g.intensity, intensity, where);
    });
    if (c.locale === 'cs') payloadInput.push(Object.assign({}, w, { id: c.label.replace(/[^A-Za-z0-9]+/g, '-'), date: '2026-12-01' }));
  }
  const payload = Intervals.toEventsPayload(payloadInput, { locale: 'cs', lthrBpm: LTHR });
  assert.equal(payload.length, payloadInput.length);
  assert.equal(new Set(payload.map((e) => e.external_id)).size, payload.length, 'external ids unique');
  const request = Intervals.buildRequest(payload, 'secret-key-123');
  // The request built by the exporter must go through VeyvoPlatform.http unchanged.
  const normalized = U.normalizeHttpRequest(request);
  assert.equal(normalized.url, 'https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true');
  assert.equal(normalized.method, 'POST');
  assert.equal(normalized.body, request.body);
  assert.deepEqual(Object.keys(normalized.headers).sort(), ['Authorization', 'Content-Type']);
  assert.equal(Buffer.from(normalized.headers.Authorization.slice(6), 'base64').toString(), 'API_KEY:secret-key-123');
  const del = Intervals.buildDeleteRequest(payload.map((e) => e.external_id), 'secret-key-123');
  assert.equal(U.normalizeHttpRequest(del).method, 'PUT');
});

// ---------------------------------------------------------------- 6. files through the platform adapter

test('file names and mime types of every exporter pass VeyvoPlatform unchanged (desktop, Garmin copy)', () => {
  for (const c of CASES) {
    const w = c.workout;
    const files = [
      Fit.toFile(w, { timeCreated: CREATED, locale: c.locale }),
      Apple.file(w, { locale: c.locale }),
      Zwo.file(w, Object.assign({ locale: c.locale }, Zwo.optionsFromPaces(c.paces) || FALLBACK_ZWO))
    ];
    for (const file of files) {
      assert.match(file.name, /^[A-Za-z0-9._-]{1,70}$/, c.label + ' ascii name ' + file.name);
      const prepared = U.prepareFile(file);
      assert.equal(prepared.name, file.name, c.label + ' name survives sanitizing');
      assert.equal(prepared.mime, file.mime);
      assert.equal(U.isBlockedFileName(file.name), false);
    }
    const fit = files[0];
    assert.equal(fit.mime, 'application/vnd.ant.fit');
    assert.equal(U.looksLikeFit(fit.data), true);
    assert.equal(U.prepareFitFile(fit.name, fit.data).name, fit.name, c.label + ' Garmin copy keeps the FIT name');
    assert.equal(U.fileExtension(files[1].name), 'workout');
    assert.equal(U.fileExtension(files[2].name), 'zwo');
    assert.equal(typeof files[2].data, 'string');
  }
});

// ---------------------------------------------------------------- 7. owner scenario end to end

test("owner's next run (VeyvoTraining) exports to all formats with the same paces", () => {
  const next = Training.nextRunAfterRun({ date: '2026-11-24', type: 'run', distance: 5, movingSeconds: 1262, effort: 9 }, [1, 6], '2026-11-26');
  // effort 9 counts as tired: 60 % of the 5 km, at least 3 days later, on a Tuesday/Sunday
  assert.deepEqual(next, { kind: 'easy', date: '2026-11-29', distanceKm: 3, paceFast: 305, paceSlow: 365 });
  const w = W.fromNextRun(next, null, { locale: 'cs' });
  assert.equal(w.name, 'Lehký běh 3 km');
  assert.equal(W.fromNextRun(next, null, { locale: 'en' }).name, 'Easy run 3 km');
  assert.equal(W.toText(w, 'cs'), 'Běh 3 km v tempu 5:05–6:05 /km');
  assert.equal(Intervals.toWorkoutText(w, { locale: 'cs', includeDescription: false }), '- Běh 3km 6:05-5:05/km Pace intensity=active');
  const fitStep = decodeFit(Fit.encodeWorkout(w, { timeCreated: CREATED })).workoutStepMesgs[0];
  assert.equal(fitStep.customTargetSpeedLow, Math.round(1e6 / 365) / 1000);
  assert.equal(fitStep.customTargetSpeedHigh, Math.round(1e6 / 305) / 1000);
  const easyFromLibrary = W.library(OWNER_PACES)[0].workout.steps[0].target;
  assert.deepEqual(easyFromLibrary, w.steps[0].target, 'library easy pace = plan easy pace');
  const [event] = Intervals.toEventsPayload(w);
  assert.equal(event.external_id, 'veyvo-plan-2026-11-29');
  assert.equal(event.start_date_local, '2026-11-29T00:00:00');
  assert.match(Zwo.toZwo(w, Zwo.optionsFromPaces(OWNER_PACES)), /<SteadyState Duration="3000" Power="0.7534" pace="1">/);
});
