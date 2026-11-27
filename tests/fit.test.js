const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Fit = require('../src/core/export/fit.js');

// Optional cross-checks against the workout model (skipped while src/core/workouts.js is missing).
let Workouts = null;
try { Workouts = require('../src/core/workouts.js'); } catch (e) { Workouts = null; }

// The Garmin FIT SDK is a devDependency used ONLY here, to decode what our own encoder writes.
let SDK;
before(async () => { SDK = await import('@garmin/fitsdk'); });

// Set VEYVO_FIT_OUT=/some/dir to also write the sample files for manual watch testing.
const OUT_DIR = process.env.VEYVO_FIT_OUT || '';

const CREATED = new Date('2026-11-27T18:30:00Z');
const OPTS = { timeCreated: CREATED, serialNumber: 0x5E7F0001 };

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
const workout = (name, steps, extra) => Object.assign({ id: 'test-' + name, name, sport: 'running', source: 'custom', steps }, extra || {});

// (a) easy 3 km at 5:05-6:05 /km
const EASY = workout('Lehký běh 3 km', [s('active', dist(3000), pace(305, 365))], { id: 'lib-easy' });
// (b) 15 min warm-up + 6 x (400 m @ 3:50-3:57, 200 m open jog) + 10 min cool-down
const INTERVALS = workout('Intervaly 6x400', [
  s('warmup', time(900)),
  { kind: 'repeat', count: 6, steps: [s('active', dist(400), pace(230, 237)), s('recovery', dist(200))] },
  s('cooldown', time(600))
], { id: 'lib-intervals400' });
// (c) heart-rate targets and open (Lap button) steps
const HR_OPEN = workout('Tep a Lap', [
  s('warmup', open(), open()),
  s('active', time(1200), hr(140, 155)),
  s('rest', open()),
  s('cooldown', dist(1000), hr(110, 130))
]);
// (d) Czech diacritics in the workout and step names
const CZECH = workout('Lehký běh 3 km', [
  s('warmup', time(300), open(), 'Rozběhání, žádný spěch'),
  s('active', dist(3000), pace(305, 365), 'Klidně, ať můžeš mluvit'),
  s('cooldown', time(120), open(), 'Vyklusání')
], { id: 'czech' });

const SAMPLES = [
  ['easy-3k', EASY], ['intervals-6x400', INTERVALS], ['hr-open', HR_OPEN], ['czech-names', CZECH]
];

/** Decodes with the SDK twice: scaled/sub-fields/enum strings, and raw on-disk integers. */
function decode(bytes) {
  const { Decoder, Stream } = SDK;
  const isFITStatic = Decoder.isFIT(Stream.fromByteArray(bytes));
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  const isFIT = decoder.isFIT();
  const integrity = decoder.checkIntegrity();
  const { messages, errors } = decoder.read();
  const raw = new Decoder(Stream.fromByteArray(bytes)).read({
    applyScaleAndOffset: false, expandSubFields: false, convertTypesToStrings: false, mergeHeartRates: false
  });
  return { isFITStatic, isFIT, integrity, messages, errors, raw: raw.messages, rawErrors: raw.errors };
}

function assertValidFit(bytes) {
  assert.ok(bytes instanceof Uint8Array);
  const d = decode(bytes);
  assert.equal(d.isFITStatic, true, 'Decoder.isFIT');
  assert.equal(d.isFIT, true, 'decoder.isFIT');
  assert.equal(d.integrity, true, 'checkIntegrity (header + file CRC, sizes)');
  assert.deepEqual(d.errors, [], 'no decode errors');
  assert.deepEqual(d.rawErrors, [], 'no raw decode errors');
  assert.equal(d.messages.fileIdMesgs.length, 1);
  assert.equal(d.messages.workoutMesgs.length, 1);
  return d;
}

/** Keeps only the listed keys that are present, so absent fields are part of the comparison. */
function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}
const STEP_KEYS = ['messageIndex', 'wktStepName', 'durationType', 'durationValue', 'durationTime', 'durationDistance',
  'durationStep', 'targetType', 'targetValue', 'repeatSteps', 'customTargetValueLow', 'customTargetValueHigh',
  'customTargetSpeedLow', 'customTargetSpeedHigh', 'customTargetHeartRateLow', 'customTargetHeartRateHigh', 'intensity'];
const steps = (d) => d.messages.workoutStepMesgs.map((m) => pick(m, STEP_KEYS));
const secPerKm = (mps) => Math.round(1000 / mps);

test('(a) easy 3 km with pace 5:05-6:05: file_id, workout and one distance step with a speed range', () => {
  const bytes = Fit.encodeWorkout(EASY, OPTS);
  const d = assertValidFit(bytes);
  assert.deepEqual(d.messages.fileIdMesgs[0], {
    type: 'workout', manufacturer: 'development', product: 1, serialNumber: 0x5E7F0001, timeCreated: CREATED
  });
  assert.deepEqual(d.messages.workoutMesgs[0], { wktName: 'Lehký běh 3 km', sport: 'running', numValidSteps: 1 });
  assert.equal(d.messages.workoutMesgs[0].subSport, undefined, 'sub_sport is left out for running');
  assert.deepEqual(steps(d), [{
    messageIndex: 0, wktStepName: 'Běh',
    durationType: 'distance', durationValue: 300000, durationDistance: 3000,
    targetType: 'speed', targetValue: 0,
    customTargetValueLow: 2740, customTargetValueHigh: 3279,
    customTargetSpeedLow: 2.74, customTargetSpeedHigh: 3.279,
    intensity: 'active'
  }]);
  const st = d.messages.workoutStepMesgs[0];
  assert.equal(secPerKm(st.customTargetSpeedLow), 365, 'low speed = slower pace 6:05');
  assert.equal(secPerKm(st.customTargetSpeedHigh), 305, 'high speed = faster pace 5:05');
});

test('(b) 15 min warm-up + 6 x (400 m @ 3:50-3:57, 200 m jog) + 10 min cool-down: repeat step semantics', () => {
  const d = assertValidFit(Fit.encodeWorkout(INTERVALS, OPTS));
  assert.equal(d.messages.workoutMesgs[0].numValidSteps, 5);
  assert.equal(d.messages.workoutMesgs[0].wktName, 'Intervaly 6x400');
  assert.deepEqual(steps(d), [
    { messageIndex: 0, wktStepName: 'Rozklus', durationType: 'time', durationValue: 900000, durationTime: 900,
      targetType: 'open', targetValue: 0, intensity: 'warmup' },
    { messageIndex: 1, wktStepName: 'Úsek', durationType: 'distance', durationValue: 40000, durationDistance: 400,
      targetType: 'speed', targetValue: 0, customTargetValueLow: 4219, customTargetValueHigh: 4348,
      customTargetSpeedLow: 4.219, customTargetSpeedHigh: 4.348, intensity: 'active' },
    { messageIndex: 2, wktStepName: 'Klus', durationType: 'distance', durationValue: 20000, durationDistance: 200,
      targetType: 'open', targetValue: 0, intensity: 'recovery' },
    { messageIndex: 3, durationType: 'repeatUntilStepsCmplt', durationValue: 1, durationStep: 1,
      targetType: 'open', targetValue: 6, repeatSteps: 6 },
    { messageIndex: 4, wktStepName: 'Vyklus', durationType: 'time', durationValue: 600000, durationTime: 600,
      targetType: 'open', targetValue: 0, intensity: 'cooldown' }
  ]);
  const rep = d.messages.workoutStepMesgs[1];
  assert.equal(secPerKm(rep.customTargetSpeedHigh), 230, '3:50');
  assert.equal(secPerKm(rep.customTargetSpeedLow), 237, '3:57');
  const repeat = d.messages.workoutStepMesgs[3];
  assert.equal(repeat.intensity, undefined, 'repeat step has no intensity');
  assert.equal(repeat.wktStepName, undefined, 'repeat step has no name');
});

test('(c) heart-rate targets are bpm + 100 and open steps wait for the Lap button', () => {
  const d = assertValidFit(Fit.encodeWorkout(HR_OPEN, OPTS));
  assert.deepEqual(steps(d), [
    { messageIndex: 0, wktStepName: 'Rozklus', durationType: 'open', targetType: 'open', targetValue: 0, intensity: 'warmup' },
    { messageIndex: 1, wktStepName: 'Běh', durationType: 'time', durationValue: 1200000, durationTime: 1200,
      targetType: 'heartRate', targetValue: 0, customTargetValueLow: 240, customTargetValueHigh: 255,
      customTargetHeartRateLow: 240, customTargetHeartRateHigh: 255, intensity: 'active' },
    { messageIndex: 2, wktStepName: 'Pauza', durationType: 'open', targetType: 'open', targetValue: 0, intensity: 'rest' },
    { messageIndex: 3, wktStepName: 'Vyklus', durationType: 'distance', durationValue: 100000, durationDistance: 1000,
      targetType: 'heartRate', targetValue: 0, customTargetValueLow: 210, customTargetValueHigh: 230,
      customTargetHeartRateLow: 210, customTargetHeartRateHigh: 230, intensity: 'cooldown' }
  ]);
  const raw = d.raw.workoutStepMesgs;
  assert.equal(raw[0].durationValue, undefined, 'open duration has no value');
  assert.equal(raw[0].durationType, Fit.ENUMS.duration.open);
  assert.equal(raw[1].targetType, Fit.ENUMS.target.heartRate);
});

test('(d) Czech diacritics survive in wkt_name and wkt_step_name (UTF-8)', () => {
  const d = assertValidFit(Fit.encodeWorkout(CZECH, OPTS));
  assert.equal(d.messages.workoutMesgs[0].wktName, 'Lehký běh 3 km');
  assert.deepEqual(d.messages.workoutStepMesgs.map((m) => m.wktStepName),
    ['Rozběhání, žádný spěch', 'Klidně, ať můžeš mluvit', 'Vyklusání']);
  // Decomposed input (e.g. typed on macOS) is written as NFC.
  const nfd = Object.assign({}, CZECH, { name: 'Lehký běh 3 km'.normalize('NFD') });
  const d2 = assertValidFit(Fit.encodeWorkout(nfd, OPTS));
  assert.equal(d2.messages.workoutMesgs[0].wktName, 'Lehký běh 3 km');
});

test('raw on-disk values equal toFitSteps() for every sample', () => {
  for (const [, w] of SAMPLES) {
    const d = assertValidFit(Fit.encodeWorkout(w, OPTS));
    const expected = Fit.toFitSteps(w).map((st) => {
      const out = {};
      Object.keys(st).forEach((k) => { if (st[k] !== null) out[k] = st[k]; });
      return out;
    });
    const got = d.raw.workoutStepMesgs.map((m) => pick(m, Object.keys(Fit.toFitSteps(w)[0])));
    assert.deepEqual(got, expected, w.name);
    assert.equal(d.raw.workoutMesgs[0].numValidSteps, expected.length);
    assert.equal(d.raw.fileIdMesgs[0].type, 5);
    assert.equal(d.raw.fileIdMesgs[0].manufacturer, 255);
    assert.equal(d.raw.workoutMesgs[0].sport, 1);
  }
});

test('header, sizes and CRCs are correct (checked without the SDK) and crc16 matches the SDK', () => {
  const bytes = Fit.encodeWorkout(INTERVALS, OPTS);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(bytes[0], 14, 'header size');
  assert.equal(bytes[1], 0x10, 'protocol 1.0');
  assert.equal(dv.getUint16(2, true), Fit.PROFILE_VERSION);
  assert.equal(dv.getUint32(4, true), bytes.length - 14 - 2, 'data size excludes header and file CRC');
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), '.FIT');
  assert.equal(dv.getUint16(12, true), Fit.crc16(bytes, 0, 12), 'header CRC');
  assert.equal(dv.getUint16(bytes.length - 2, true), Fit.crc16(bytes, 0, bytes.length - 2), 'file CRC');
  assert.equal(Fit.crc16(bytes), 0, 'CRC over a whole file including its CRC is 0');
  // First record is the file_id definition (local 0, little-endian, global 0).
  assert.equal(bytes[14], 0x40);
  assert.equal(bytes[16], 0, 'little-endian architecture');
  assert.equal(dv.getUint16(17, true), 0, 'file_id');

  // CRC-16/ARC check value and agreement with the SDK's calculator on random data.
  assert.equal(Fit.crc16(new TextEncoder().encode('123456789')), 0xBB3D);
  assert.equal(Fit.crc16(new Uint8Array(0)), 0);
  let seed = 7;
  const random = new Uint8Array(1000).map(() => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24);
  assert.equal(Fit.crc16(random), SDK.CrcCalculator.calculateCRC(random, 0, random.length));
  assert.equal(Fit.crc16(random, 10, 500), SDK.CrcCalculator.calculateCRC(random, 10, 500));

  // A flipped byte is caught by the integrity check.
  const broken = bytes.slice();
  broken[30] ^= 0xFF;
  assert.equal(new SDK.Decoder(SDK.Stream.fromByteArray(broken)).checkIntegrity(), false);
});

test('output is deterministic and contains no SDK code path (pure function of input + options)', () => {
  const a = Fit.encodeWorkout(INTERVALS, OPTS);
  const b = Fit.encodeWorkout(JSON.parse(JSON.stringify(INTERVALS)), Object.assign({}, OPTS));
  assert.deepEqual(a, b);
  const src = fs.readFileSync(path.join(__dirname, '../src/core/export/fit.js'), 'utf8');
  assert.doesNotMatch(src, /require\(\s*['"]@garmin|import\(|^\s*import\s|^\s*export\s/m, 'no SDK, no ES module syntax');
  assert.doesNotMatch(src, /Date\.now|new Date\(\)|document\.|window\.|fetch\(|XMLHttpRequest/, 'no clock, DOM or network');
});

test('options: timeCreated as Date or FIT seconds, serialNumber, product, productName', () => {
  const fitSeconds = Math.floor(CREATED.getTime() / 1000) - Fit.FIT_EPOCH_UNIX;
  assert.equal(Fit.toFitTime(CREATED), fitSeconds);
  assert.equal(Fit.toFitTime(fitSeconds), fitSeconds);
  assert.deepEqual(Fit.fromFitTime(fitSeconds), CREATED);
  assert.equal(Fit.toFitTime(new Date('1989-12-31T00:00:00Z').getTime() / 1000 - Fit.FIT_EPOCH_UNIX + 0x10000000), 0x10000000);
  assert.deepEqual(Fit.encodeWorkout(EASY, { timeCreated: fitSeconds, serialNumber: 1 }),
    Fit.encodeWorkout(EASY, { timeCreated: CREATED, serialNumber: 1 }));

  const d = assertValidFit(Fit.encodeWorkout(EASY, { timeCreated: CREATED, serialNumber: 0xFFFFFFFF, product: 42, productName: 'VEYVO 0.4' }));
  assert.deepEqual(d.messages.fileIdMesgs[0], {
    type: 'workout', manufacturer: 'development', product: 42, serialNumber: 0xFFFFFFFF, timeCreated: CREATED, productName: 'VEYVO 0.4'
  });

  for (const bad of [undefined, null, 'today', new Date('nope'), new Date('1995-01-01T00:00:00Z'), 12345, 1.5, -1, 0xFFFFFFFF]) {
    assert.throws(() => Fit.encodeWorkout(EASY, { timeCreated: bad }), { code: 'time_created_invalid' }, String(bad));
  }
  assert.throws(() => Fit.encodeWorkout(EASY), { code: 'time_created_invalid' }, 'no hidden clock');
  for (const bad of [0, -5, 1.5, 0x100000000, '12']) {
    assert.throws(() => Fit.encodeWorkout(EASY, { timeCreated: CREATED, serialNumber: bad }), { code: 'serial_number_invalid' }, String(bad));
  }
  for (const bad of [-1, 0xFFFF, 2.5, 'x']) {
    assert.throws(() => Fit.encodeWorkout(EASY, { timeCreated: CREATED, product: bad }), { code: 'product_invalid' }, String(bad));
  }
});

test('default serial number is deterministic, non-zero and differs per workout and per export time', () => {
  const later = new Date(CREATED.getTime() + 1000);
  const serial = (w, t) => assertValidFit(Fit.encodeWorkout(w, { timeCreated: t })).messages.fileIdMesgs[0].serialNumber;
  const a = serial(EASY, CREATED);
  assert.ok(Number.isInteger(a) && a > 0 && a <= 0xFFFFFFFF);
  assert.equal(serial(EASY, CREATED), a);
  assert.notEqual(serial(EASY, later), a);
  assert.notEqual(serial(INTERVALS, CREATED), a);
  assert.equal(Fit.serialFor(''), 0x811C9DC5, 'FNV-1a offset basis for an empty seed');
  assert.equal(Fit.serialFor('a'), 0xE40C292C, 'FNV-1a reference value');
});

test('step names: labels win, defaults in cs/en match VeyvoWorkouts, stepNames:false leaves them out', () => {
  const d = assertValidFit(Fit.encodeWorkout(INTERVALS, Object.assign({ locale: 'en' }, OPTS)));
  assert.deepEqual(d.messages.workoutStepMesgs.map((m) => m.wktStepName), ['Warm-up', 'Interval', 'Jog', undefined, 'Cool-down']);
  const en = assertValidFit(Fit.encodeWorkout(HR_OPEN, Object.assign({ locale: 'en-GB' }, OPTS)));
  assert.deepEqual(en.messages.workoutStepMesgs.map((m) => m.wktStepName), ['Warm-up', 'Run', 'Rest', 'Cool-down']);

  const bare = assertValidFit(Fit.encodeWorkout(INTERVALS, Object.assign({ stepNames: false }, OPTS)));
  assert.ok(bare.messages.workoutStepMesgs.every((m) => m.wktStepName === undefined));
  assert.equal(bare.messages.workoutStepMesgs[1].customTargetValueLow, 4219, 'other fields unchanged without the name field');
  const labelled = assertValidFit(Fit.encodeWorkout(CZECH, Object.assign({ stepNames: false }, OPTS)));
  assert.equal(labelled.messages.workoutStepMesgs[1].wktStepName, 'Klidně, ať můžeš mluvit');

  const long = workout('Dlouhý štítek', [s('active', time(600), open(), '  Velmi\tdlouhý   popis úseku, který se na hodinky nevejde vůbec  ')]);
  const name = assertValidFit(Fit.encodeWorkout(long, OPTS)).messages.workoutStepMesgs[0].wktStepName;
  assert.equal(name, 'Velmi dlouhý popis úseku, který se na ho');
  assert.equal(Array.from(name).length, 40);

  if (Workouts) {
    for (const locale of ['cs', 'en']) {
      for (const intensity of ['warmup', 'active', 'recovery', 'rest', 'cooldown']) {
        for (const inRepeat of [false, true]) {
          const st = s(intensity, time(60));
          assert.equal(Fit.stepName(st, locale, inRepeat), Workouts.stepName(st, locale, inRepeat), [locale, intensity, inRepeat].join(' '));
        }
      }
    }
  }
});

test('workout name: Garmin 15 characters by default, fullName writes up to 40', () => {
  const w = workout('Dlouhý běh 10 km po Stromovce', [s('active', dist(10000), pace(310, 375))]);
  const d = assertValidFit(Fit.encodeWorkout(w, OPTS));
  assert.equal(d.messages.workoutMesgs[0].wktName, 'Dlouhý běh 10km');
  const full = assertValidFit(Fit.encodeWorkout(w, Object.assign({ fullName: true }, OPTS)));
  assert.equal(full.messages.workoutMesgs[0].wktName, 'Dlouhý běh 10 km po Stromovce');
  const noName = assertValidFit(Fit.encodeWorkout(Object.assign({}, w, { name: '   ' }), OPTS));
  assert.equal(noName.messages.workoutMesgs[0].wktName, 'VEYVO');
  const emoji = assertValidFit(Fit.encodeWorkout(Object.assign({}, w, { name: '👨‍👩‍👧‍👦'.repeat(15) }), OPTS));
  assert.ok(new TextEncoder().encode(emoji.messages.workoutMesgs[0].wktName).length <= 254, 'string field stays within 255 bytes');
});

test('garminName trims to 15 visible characters without cutting words or numbers in half', () => {
  const cases = [
    ['Lehký běh 3 km', 'Lehký běh 3 km'],
    ['Úseky 6× 400 m', 'Úseky 6× 400 m'],
    ['Dlouhý běh 10 km', 'Dlouhý běh 10km'],
    ['Dlouhý běh 12,5 km', 'Dlouhý běh 12,5'],
    ['Intervaly 6× 400 m', 'Intervaly 6×400'],
    ['Intervaly 10× 400 m', 'Intervaly'],
    ['Tempo 3× 2 km v cílovém tempu', 'Tempo 3×2km'],
    ['Lehký běh 3 km a něco', 'Lehký běh 3km'],
    ['Reps 6× 400 m at goal pace', 'Reps 6×400m at'],
    ['Easy run 5 km', 'Easy run 5 km'],
    ['Supervelkolepýběhpřesmez', 'Supervelkolepýb'],
    ['  Lehký\n běh   3 km  ', 'Lehký běh 3 km'],
    ['Lehký běh 3 km'.normalize('NFD'), 'Lehký běh 3 km'],
    ['', 'VEYVO'],
    [null, 'VEYVO']
  ];
  for (const [input, expected] of cases) {
    const got = Fit.garminName(input);
    assert.equal(got, expected, JSON.stringify(input));
    assert.ok(Array.from(got).length <= 15);
  }
  assert.equal(Fit.garminName({ name: 'Úseky 5× 1 km' }), 'Úseky 5× 1 km');
  assert.equal(Fit.garminName('Běh 👨‍👩‍👧‍👦 rodina a přátelé'), 'Běh 👨‍👩‍👧‍👦 rodina', 'an emoji family counts as one character');
  assert.equal(Fit.garminName('Lehký běh 3 km', 5), 'Lehký');
});

test('fileName: safe ASCII, VEYVO_ prefix, at most 40 characters', () => {
  const cases = [
    ['Intervaly 6x400', 'VEYVO_Intervaly_6x400.fit'],
    ['Lehký běh 3 km', 'VEYVO_Lehky_beh_3_km.fit'],
    ['Úseky 6× 400 m', 'VEYVO_Useky_6x_400_m.fit'],
    ['Tempo 3× 2 km', 'VEYVO_Tempo_3x_2_km.fit'],
    ['VEYVO Intervaly 6x400', 'VEYVO_Intervaly_6x400.fit'],
    ['Žluťoučký kůň úpěl ďábelské ódy', 'VEYVO_Zlutoucky_kun_upel_dabelske.fit'],
    ['Straße & Łódź: ½ maratonu!', 'VEYVO_Strasse_and_Lodz_1_2_maratonu.fit'],
    ['a/b\\c:d*e?f"g<h>i|j', 'VEYVO_a_b_c_d_e_f_g_h_i_j.fit'],
    ['   ', 'VEYVO_workout.fit'],
    ['😀😀', 'VEYVO_workout.fit'],
    [undefined, 'VEYVO_workout.fit']
  ];
  for (const [input, expected] of cases) {
    const got = Fit.fileName(input);
    assert.equal(got, expected, JSON.stringify(input));
    assert.match(got, /^VEYVO_[A-Za-z0-9_-]+\.fit$/);
    assert.ok(got.length <= 40, got);
  }
  assert.equal(Fit.fileName(EASY), 'VEYVO_Lehky_beh_3_km.fit');
  const long = Fit.fileName('Dlouhý běh 21,1 km kolem Vltavy a zpátky domů');
  assert.ok(long.length <= 40);
  assert.doesNotMatch(long, /_\.fit$/, 'no trailing separator before the extension');
  assert.equal(long, 'VEYVO_Dlouhy_beh_21_1_km_kolem.fit', 'cut after a whole word');
});

test('toFile returns a ready-to-save { name, mime, data }', () => {
  const file = Fit.toFile(INTERVALS, OPTS);
  assert.equal(file.name, 'VEYVO_Intervaly_6x400.fit');
  assert.equal(file.mime, 'application/vnd.ant.fit');
  assert.deepEqual(file.data, Fit.encodeWorkout(INTERVALS, OPTS));
});

test('rounding: fractional seconds, metres and paces become the nearest raw integer', () => {
  const w = workout('Zlomky', [
    s('active', time(90.5), pace(240.4, 250.6)),
    s('recovery', dist(400.004))
  ]);
  const d = assertValidFit(Fit.encodeWorkout(w, OPTS));
  const [a, b] = d.raw.workoutStepMesgs;
  assert.equal(a.durationValue, 90500);
  assert.equal(a.customTargetValueLow, Math.round(1e6 / 250.6));
  assert.equal(a.customTargetValueHigh, Math.round(1e6 / 240.4));
  assert.equal(b.durationValue, 40000);
  const hrRounded = Fit.toFitSteps(workout('Tep', [s('active', time(60), hr(139.6, 150.2))]))[0];
  assert.equal(hrRounded.customTargetValueLow, 240);
  assert.equal(hrRounded.customTargetValueHigh, 250);
});

test('50 FIT steps encode (Garmin limit); repeat counts 1 and 99 encode', () => {
  const fifty = workout('Padesát', Array.from({ length: 50 }, (_, i) => s(i % 2 ? 'recovery' : 'active', dist(100 + i))));
  const d = assertValidFit(Fit.encodeWorkout(fifty, OPTS));
  assert.equal(d.messages.workoutStepMesgs.length, 50);
  assert.equal(d.messages.workoutMesgs[0].numValidSteps, 50);
  assert.equal(d.messages.workoutStepMesgs[49].messageIndex, 49);
  assert.equal(d.messages.workoutStepMesgs[49].durationDistance, 149);

  const bigRepeat = workout('Repeat', [{ kind: 'repeat', count: 99, steps: Array.from({ length: 49 }, () => s('active', time(30))) }]);
  const r = assertValidFit(Fit.encodeWorkout(bigRepeat, OPTS));
  assert.equal(r.messages.workoutStepMesgs.length, 50);
  assert.deepEqual(pick(r.messages.workoutStepMesgs[49], ['durationType', 'durationStep', 'repeatSteps']),
    { durationType: 'repeatUntilStepsCmplt', durationStep: 0, repeatSteps: 99 });

  const once = workout('Jednou', [s('warmup', time(60)), { kind: 'repeat', count: 1, steps: [s('active', dist(1000))] }]);
  const o = assertValidFit(Fit.encodeWorkout(once, OPTS));
  assert.deepEqual(pick(o.messages.workoutStepMesgs[2], ['durationStep', 'repeatSteps']), { durationStep: 1, repeatSteps: 1 });

  const twoBlocks = workout('Dva bloky', [
    { kind: 'repeat', count: 3, steps: [s('active', dist(200)), s('recovery', dist(200))] },
    s('rest', time(120)),
    { kind: 'repeat', count: 4, steps: [s('active', dist(400), pace(230, 237)), s('recovery', time(90))] }
  ]);
  const t = assertValidFit(Fit.encodeWorkout(twoBlocks, OPTS));
  const repeats = t.messages.workoutStepMesgs.filter((m) => m.durationType === 'repeatUntilStepsCmplt');
  assert.deepEqual(repeats.map((m) => [m.messageIndex, m.durationStep, m.repeatSteps]), [[2, 0, 3], [6, 4, 4]]);
});

test('invalid workouts throw workout_invalid with coded, pathed errors; check() does not throw', () => {
  const codes = (w) => Fit.check(w).errors.map((e) => e.code + '@' + e.path);
  assert.deepEqual(codes(null), ['workout_invalid@']);
  assert.deepEqual(codes(workout('x', [])), ['steps_empty@steps']);
  assert.deepEqual(codes(workout('x', [s('active', time(60))], { sport: 'cycling' })), ['sport_invalid@sport']);
  assert.deepEqual(codes(workout('x', [s('sprint', time(60))])), ['intensity_invalid@steps.0.intensity']);
  assert.deepEqual(codes(workout('x', [s('active', time(0))])), ['duration_invalid@steps.0.duration.seconds']);
  assert.deepEqual(codes(workout('x', [s('active', dist(NaN))])), ['duration_invalid@steps.0.duration.meters']);
  assert.deepEqual(codes(workout('x', [s('active', { type: 'calories', kcal: 100 })])), ['duration_invalid@steps.0.duration']);
  assert.deepEqual(codes(workout('x', [s('active', time(5e6))])), ['value_range@steps.0.duration.seconds']);
  assert.deepEqual(codes(workout('x', [s('active', time(60), pace(300, 300))])), ['pace_order@steps.0.target']);
  assert.deepEqual(codes(workout('x', [s('active', time(60), pace(320, 300))])), ['pace_order@steps.0.target']);
  assert.deepEqual(codes(workout('x', [s('active', time(60), pace(0, 300))])), ['target_invalid@steps.0.target.fastSecPerKm']);
  assert.deepEqual(codes(workout('x', [s('active', time(60), hr(150, 140))])), ['hr_order@steps.0.target']);
  assert.deepEqual(codes(workout('x', [s('active', time(60), hr(0, 140))])), ['hr_range@steps.0.target.lowBpm']);
  assert.deepEqual(codes(workout('x', [s('active', time(60), { type: 'power', low: 200 })])), ['target_invalid@steps.0.target']);
  assert.deepEqual(codes(workout('x', [s('active', time(60), open(), 42)])), ['label_invalid@steps.0.label']);
  assert.deepEqual(codes(workout('x', [{ kind: 'repeat', count: 0, steps: [s('active', time(60))] }])), ['repeat_count_range@steps.0.count']);
  assert.deepEqual(codes(workout('x', [{ kind: 'repeat', count: 100, steps: [s('active', time(60))] }])), ['repeat_count_range@steps.0.count']);
  assert.deepEqual(codes(workout('x', [{ kind: 'repeat', count: 2.5, steps: [s('active', time(60))] }])), ['repeat_count_range@steps.0.count']);
  assert.deepEqual(codes(workout('x', [{ kind: 'repeat', count: 2, steps: [] }])), ['repeat_empty@steps.0.steps']);
  assert.deepEqual(codes(workout('x', [{ kind: 'repeat', count: 2, steps: [{ kind: 'repeat', count: 2, steps: [s('active', time(60))] }] }])),
    ['repeat_nested@steps.0.steps.0']);
  assert.deepEqual(codes(workout('x', [{ kind: 'warmup' }])), ['step_invalid@steps.0']);
  const tooMany = workout('x', Array.from({ length: 51 }, () => s('active', time(60))));
  assert.deepEqual(Fit.check(tooMany).errors, [{ code: 'too_many_steps', path: 'steps', count: 51, max: 50 }]);
  const repeatCounts = workout('x', [{ kind: 'repeat', count: 2, steps: Array.from({ length: 50 }, () => s('active', time(60))) }]);
  assert.equal(Fit.check(repeatCounts).fitStepCount, 51, 'the repeat step counts as one FIT step');
  assert.equal(Fit.check(INTERVALS).fitStepCount, 5);
  assert.equal(Fit.check(INTERVALS).ok, true);

  assert.throws(() => Fit.encodeWorkout(tooMany, OPTS), (err) => {
    assert.equal(err.code, 'workout_invalid');
    assert.equal(err.errors[0].code, 'too_many_steps');
    assert.match(err.message, /too_many_steps/);
    return true;
  });
  assert.throws(() => Fit.flatten(workout('x', [])), { code: 'workout_invalid' });
  assert.throws(() => Fit.toFitSteps(null), { code: 'workout_invalid' });
  // A workout without a sport is treated as running.
  const noSport = Object.assign({}, EASY);
  delete noSport.sport;
  assert.equal(assertValidFit(Fit.encodeWorkout(noSport, OPTS)).messages.workoutMesgs[0].sport, 'running');
});

test('flatten follows the architecture model (and agrees with VeyvoWorkouts.flatten when present)', () => {
  assert.deepEqual(Fit.flatten(INTERVALS), [
    { kind: 'step', index: 0, path: 'steps.0', intensity: 'warmup', duration: { type: 'time', seconds: 900 }, target: { type: 'open' }, inRepeat: false },
    { kind: 'step', index: 1, path: 'steps.1.steps.0', intensity: 'active', duration: { type: 'distance', meters: 400 },
      target: { type: 'pace', fastSecPerKm: 230, slowSecPerKm: 237 }, inRepeat: true },
    { kind: 'step', index: 2, path: 'steps.1.steps.1', intensity: 'recovery', duration: { type: 'distance', meters: 200 }, target: { type: 'open' }, inRepeat: true },
    { kind: 'repeat', index: 3, path: 'steps.1', fromIndex: 1, count: 6 },
    { kind: 'step', index: 4, path: 'steps.2', intensity: 'cooldown', duration: { type: 'time', seconds: 600 }, target: { type: 'open' }, inRepeat: false }
  ]);
  assert.equal(Fit.flatten(CZECH)[1].label, 'Klidně, ať můžeš mluvit');
  // flatten copies: the encoder never mutates the caller's workout
  const copy = JSON.parse(JSON.stringify(INTERVALS));
  Fit.encodeWorkout(copy, OPTS);
  assert.deepEqual(copy, INTERVALS);

  if (Workouts) {
    for (const [, w] of SAMPLES) assert.deepEqual(Fit.flatten(w), Workouts.flatten(w), w.name);
  }
});

test('every VeyvoWorkouts library session (cs + en, paced and by feel) encodes to a valid FIT file', { skip: !Workouts }, () => {
  const paces = Workouts.derivePaces({ best5kSeconds: 1290, targetSeconds: 1200 });
  for (const locale of ['cs', 'en']) {
    for (const p of [paces, null]) {
      for (const entry of Workouts.library(p, { locale })) {
        const w = entry.workout;
        const d = assertValidFit(Fit.encodeWorkout(w, { timeCreated: CREATED, locale }));
        assert.equal(d.messages.workoutMesgs[0].numValidSteps, Workouts.fitStepCount(w), w.name);
        assert.equal(d.messages.workoutStepMesgs.length, Workouts.flatten(w).length);
        assert.equal(d.messages.workoutMesgs[0].wktName, Fit.garminName(w));
        assert.ok(Array.from(d.messages.workoutMesgs[0].wktName).length <= 15);
        assert.match(Fit.fileName(w), /^VEYVO_[A-Za-z0-9_-]+\.fit$/);
      }
    }
  }
  const rep = Workouts.library(paces, { locale: 'cs' }).find((e) => e.id === 'intervals400').workout;
  const d = decode(Fit.encodeWorkout(rep, OPTS));
  assert.equal(d.messages.workoutMesgs[0].wktName, 'Úseky 6× 400 m');
  assert.deepEqual(pick(d.messages.workoutStepMesgs[1], ['customTargetSpeedLow', 'customTargetSpeedHigh']),
    { customTargetSpeedLow: 4.219, customTargetSpeedHigh: 4.348 }, 'goal 20:00 -> 3:50-3:57 /km');
});

test('sample files for manual watch testing (written only when VEYVO_FIT_OUT is set)', { skip: !OUT_DIR }, () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [slug, w] of SAMPLES) {
    const file = Fit.toFile(w, { timeCreated: CREATED });
    const target = path.join(OUT_DIR, slug + '__' + file.name);
    fs.writeFileSync(target, file.data);
    assertValidFit(new Uint8Array(fs.readFileSync(target)));
  }
});
