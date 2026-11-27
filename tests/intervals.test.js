const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const W = require('../src/core/workouts.js');
const I = require('../src/core/export/intervals.js');
const T = require('../src/training-context.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'core', 'export', 'intervals.js');
const WORKOUTS_SRC = path.join(ROOT, 'src', 'core', 'workouts.js');
const { step, repeat, time, distance, open, pace, hr } = W.build;

function workout(steps, extra) {
  return Object.assign({ id: 'w1', name: 'Test', sport: 'running', source: 'custom', date: '2026-12-01', steps: steps }, extra || {});
}
const paces = W.derivePaces({ best5kSeconds: 1290, targetSeconds: 1200 });
const lib = (locale) => W.library(paces, { locale: locale || 'cs' });
const noDesc = { includeDescription: false };

// Every line must be blank, a note, a repeat header or a step in the documented grammar.
const STEP_LINE = /^- (?:Press lap )?(?:[^\d\n=]+ )?(?:\d+h)?(?:\d+m)?(?:\d+s)?(?:\d+(?:\.\d+)?km|\d+mtr)? ?(?:\d+:\d\d-\d+:\d\d\/km Pace|\d+(?:-\d+)?% (?:LTHR|HR))? ?intensity=(?:warmup|cooldown|active|interval|recovery|rest)$/;
function assertGrammar(text) {
  const lines = text.split('\n');
  assert.notEqual(lines[0], '', 'no leading blank line');
  assert.notEqual(lines.at(-1), '', 'no trailing blank line');
  lines.forEach((line, i) => {
    if (line === '') { assert.notEqual(lines[i + 1], '', 'never two blank lines'); return; }
    if (line.startsWith('- ')) { assert.match(line, STEP_LINE); return; }
    if (/ \d+x$/.test(line)) {
      assert.equal(lines[i - 1] === undefined || lines[i - 1] === '', true, 'blank line before a repeat: ' + line);
      return;
    }
    assert.doesNotMatch(line, /^-/, 'notes never start with a dash');
  });
}

// ---------------------------------------------------------------- workout text

test('toWorkoutText: 6 × 400 m session in native intervals.icu syntax', () => {
  assert.equal(I.toWorkoutText(lib()[1].workout, noDesc), [
    '- Rozklus 15m intensity=warmup',
    '',
    'Hlavní část 6x',
    '- Úsek 400mtr 3:57-3:50/km Pace intensity=interval',
    '- Klus 200mtr intensity=recovery',
    '',
    '- Vyklus 10m intensity=cooldown'
  ].join('\n'));
  assert.equal(I.toWorkoutText(lib('en')[1].workout, { includeDescription: false, locale: 'en' }), [
    '- Warm-up 15m intensity=warmup',
    '',
    'Main set 6x',
    '- Interval 400mtr 3:57-3:50/km Pace intensity=interval',
    '- Jog 200mtr intensity=recovery',
    '',
    '- Cool-down 10m intensity=cooldown'
  ].join('\n'));
});

test('toWorkoutText: every library session, with description notes on top', () => {
  for (const locale of ['cs', 'en']) {
    for (const t of lib(locale)) {
      const text = I.toWorkoutText(t.workout, { locale });
      assert.ok(text.startsWith(t.workout.description + '\n\n'), t.id);
      assertGrammar(text);
    }
  }
  assert.equal(I.toWorkoutText(lib()[0].workout, noDesc), '- Běh 5km 6:15-5:10/km Pace intensity=active');
  assert.equal(I.toWorkoutText(lib()[3].workout, noDesc).split('\n')[3], '- Úsek 2km 4:35-4:28/km Pace intensity=interval');
  assert.equal(I.toWorkoutText(lib()[2].workout, noDesc).split('\n')[4], '- Klus 2m intensity=recovery');
  assert.equal(I.toWorkoutText(lib()[5].workout, noDesc), [
    '- Rozklus 15m intensity=warmup', '- Naplno 5km intensity=active', '- Vyklus 10m intensity=cooldown'
  ].join('\n'));
});

test('toWorkoutText: duration and distance tokens (m means minutes, metres are mtr)', () => {
  const line = (d) => I.toWorkoutText(workout([step('active', d, open(), 'Run')]), noDesc);
  assert.equal(line(time(90)), '- Run 1m30s intensity=active');
  assert.equal(line(time(45)), '- Run 45s intensity=active');
  assert.equal(line(time(3600)), '- Run 1h intensity=active');
  assert.equal(line(time(5400)), '- Run 1h30m intensity=active');
  assert.equal(line(time(3725)), '- Run 1h2m5s intensity=active');
  assert.equal(line(time(59.6)), '- Run 1m intensity=active');
  assert.equal(line(distance(400)), '- Run 400mtr intensity=active');
  assert.equal(line(distance(1000)), '- Run 1km intensity=active');
  assert.equal(line(distance(2500)), '- Run 2.5km intensity=active', 'dot decimal, never a comma');
  assert.equal(line(distance(1250)), '- Run 1.25km intensity=active');
  assert.equal(line(distance(1609)), '- Run 1609mtr intensity=active');
  assert.equal(line(distance(10000)), '- Run 10km intensity=active');
  assert.equal(line(distance(50)), '- Run 50mtr intensity=active');
});

test('toWorkoutText: blank lines around every repeat block, single-pass blocks written inline', () => {
  const text = I.toWorkoutText(workout([
    repeat(3, [step('active', distance(400), open())]),
    repeat(2, [step('active', time(60)), step('rest', time(30))]),
    repeat(1, [step('active', time(120)), step('recovery', time(60))]),
    step('cooldown', time(300))
  ]), noDesc);
  assert.equal(text, [
    'Hlavní část 3x',
    '- Úsek 400mtr intensity=interval',
    '',
    'Hlavní část 2x',
    '- Úsek 1m intensity=interval',
    '- Pauza 30s intensity=rest',
    '',
    '- Běh 2m intensity=active',
    '- Klus 1m intensity=recovery',
    '- Vyklus 5m intensity=cooldown'
  ].join('\n'));
  assertGrammar(text);
});

test('convert: pace warning, HR conversion and mixed targets', () => {
  const paced = I.convert(lib()[1].workout);
  assert.deepEqual(paced.warnings, [{ code: 'pace_needs_threshold', path: 'steps.1.steps.0.target' }]);
  assert.deepEqual(I.convert(lib()[5].workout).warnings, [], 'the open 5 km test needs no setup');

  const hrWorkout = workout([step('warmup', time(600), hr(120, 140)), step('active', time(1200), hr(140, 150))]);
  const dropped = I.convert(hrWorkout, noDesc);
  assert.equal(dropped.text, '- Rozklus 10m intensity=warmup\n- Běh 20m intensity=active');
  assert.deepEqual(dropped.warnings, [{ code: 'hr_absolute_unsupported', path: 'steps.0.target' }], 'reported once');

  assert.equal(I.convert(hrWorkout, { includeDescription: false, lthrBpm: 180 }).text,
    '- Rozklus 10m 67-78% LTHR intensity=warmup\n- Běh 20m 78-83% LTHR intensity=active');
  assert.equal(I.convert(hrWorkout, { includeDescription: false, maxHrBpm: 190 }).text,
    '- Rozklus 10m 63-74% HR intensity=warmup\n- Běh 20m 74-79% HR intensity=active');
  assert.equal(I.convert(hrWorkout, { includeDescription: false, lthrBpm: 180, maxHrBpm: 190 }).text.includes('LTHR'), true, 'LTHR preferred');
  assert.equal(I.convert(workout([step('active', time(60), hr(150, 151))]), { includeDescription: false, lthrBpm: 240 }).text,
    '- Běh 1m 63% LTHR intensity=active', 'equal rounded percentages collapse to one value');
  assert.deepEqual(I.convert(hrWorkout, { lthrBpm: 30 }).warnings.map((w) => w.code), ['hr_absolute_unsupported'], 'implausible LTHR ignored');

  const mixed = workout([step('active', time(600), hr(140, 150)), step('active', distance(1000), pace(240, 250))]);
  assert.deepEqual(I.convert(mixed, { lthrBpm: 180 }).warnings.map((w) => w.code), ['pace_needs_threshold', 'mixed_targets']);
  assert.deepEqual(I.convert(mixed).warnings.map((w) => w.code), ['hr_absolute_unsupported', 'pace_needs_threshold'],
    'not mixed once HR is dropped');
});

test('convert: lap-button steps get Press lap and a nominal duration', () => {
  const w = workout([step('warmup', open()), repeat(4, [step('active', open(), pace(240, 250)), step('recovery', time(90))])]);
  const result = I.convert(w, noDesc);
  assert.equal(result.text, [
    '- Press lap Rozklus 5m intensity=warmup',
    '',
    'Hlavní část 4x',
    '- Press lap Úsek 5m 4:10-4:00/km Pace intensity=interval',
    '- Klus 1m30s intensity=recovery'
  ].join('\n'));
  assert.deepEqual(result.warnings[0], { code: 'open_step_nominal', path: 'steps.0.duration', seconds: 300, minutes: 5 });
  assert.equal(I.convert(w, { includeDescription: false, openStepSeconds: 600 }).text.split('\n')[0], '- Press lap Rozklus 10m intensity=warmup');
  assert.equal(I.convert(w, { includeDescription: false, openStepSeconds: 1 }).text.split('\n')[0], '- Press lap Rozklus 5m intensity=warmup');
  assertGrammar(result.text);
});

test('convert: labels become cue text without syntax characters', () => {
  const line = (label) => I.toWorkoutText(workout([step('active', time(60), open(), label)]), noDesc);
  assert.equal(line('Úsek 1'), '- Úsek 1m intensity=active');
  assert.equal(line('Kopec 90%'), '- Kopec 1m intensity=active');
  assert.equal(line('- Rovinky'), '- Rovinky 1m intensity=active');
  assert.equal(line('Press lap teď'), '- teď 1m intensity=active');
  assert.equal(line('a=b/c:d'), '- a b c d 1m intensity=active');
  assert.equal(line('123'), '- Běh 1m intensity=active', 'a label of digits falls back to the default name');
});

test('convert: description notes cannot start a step or a repeat', () => {
  const w = workout([step('active', time(600))], { description: '- Rychle\nCelkem 5x\n\n  Pozor  ' });
  assert.equal(I.toWorkoutText(w), 'Rychle\nCelkem 5x.\nPozor\n\n- Běh 10m intensity=active');
  assert.equal(I.toWorkoutText(w, { includeDescription: false }), '- Běh 10m intensity=active');
  assert.equal(I.toWorkoutText(workout([step('active', time(600))], { description: '   ' })), '- Běh 10m intensity=active');
});

test('convert: invalid workouts throw with the validation errors', () => {
  assert.throws(() => I.toWorkoutText(workout([repeat(2, [repeat(2, [step('active', time(60))])])])), (error) => {
    assert.equal(error.code, 'workout_invalid');
    assert.deepEqual(error.errors, [{ code: 'repeat_nested', path: 'steps.0.steps.0' }]);
    return true;
  });
  assert.throws(() => I.convert(null), { code: 'workout_invalid' });
});

// ---------------------------------------------------------------- events payload

test('toEventsPayload: bulk upsert events with stable external ids', () => {
  const plan = W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 3.5, paceFast: 310, paceSlow: 375 });
  const interval = Object.assign({}, lib()[1].workout, { id: 'lib-intervals400-2026-12-06', date: '2026-12-06', name: '  Úseky 6× 400 m ' });
  const payload = I.toEventsPayload([plan, interval]);
  assert.deepEqual(payload[0], {
    category: 'WORKOUT',
    start_date_local: '2026-12-01T00:00:00',
    type: 'Run',
    name: 'Lehký běh 3,5 km',
    description: 'Lehký běh v tempu 5:10–6:15 /km podle tvých posledních výsledků.\n\n- Běh 3.5km 6:15-5:10/km Pace intensity=active',
    external_id: 'veyvo-plan-2026-12-01'
  });
  assert.equal(payload[1].external_id, 'veyvo-lib-intervals400-2026-12-06');
  assert.equal(payload[1].name, 'Úseky 6× 400 m', 'trimmed');
  assert.equal(payload[1].description, I.toWorkoutText(interval));
  assert.deepEqual(Object.keys(payload[1]).sort(), ['category', 'description', 'external_id', 'name', 'start_date_local', 'type']);

  assert.equal(I.toEventsPayload(plan, { externalIdPrefix: 'test-' })[0].external_id, 'test-plan-2026-12-01', 'single workout + prefix');
  assert.equal(I.toEventsPayload(plan, { externalIdPrefix: '' })[0].external_id, 'plan-2026-12-01');
  assert.equal(I.toEventsPayload(plan, { includeDescription: false })[0].description, '- Běh 3.5km 6:15-5:10/km Pace intensity=active');
  assert.equal(I.toEventsPayload(W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 3 }), { locale: 'en' })[0].description,
    'Lehký běh pohodovým tempem podle pocitu.\n\n- Run 3km intensity=active', 'locale only changes cue words');
  assert.deepEqual(I.toEventsPayload([]), []);
});

test('toEventsPayload: date, duplicate and validity errors carry the index', () => {
  const dated = workout([step('active', time(600))]);
  assert.throws(() => I.toEventsPayload([dated, workout([step('active', time(600))], { id: 'w2', date: undefined })]),
    { code: 'date_required', index: 1 });
  assert.throws(() => I.toEventsPayload([dated, Object.assign({}, dated)]), { code: 'duplicate_external_id', index: 1, externalId: 'veyvo-w1' });
  assert.throws(() => I.toEventsPayload([dated, workout([], { id: 'w3' })]), { code: 'workout_invalid', index: 1 });
  assert.throws(() => I.toEventsPayload(dated, { externalIdPrefix: 5 }), { code: 'prefix_invalid' });
});

// ---------------------------------------------------------------- requests

test('buildRequest: POST events/bulk?upsert=true with Basic API_KEY auth', () => {
  const payload = I.toEventsPayload(W.fromNextRun({ kind: 'easy', date: '2026-12-01', distanceKm: 3.5, paceFast: 310, paceSlow: 375 }));
  const request = I.buildRequest(payload, '  abc123xyz  ');
  assert.deepEqual(request, {
    url: 'https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true',
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from('API_KEY:abc123xyz').toString('base64'),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  assert.deepEqual(JSON.parse(request.body), payload);
  assert.equal(I.buildRequest(payload, 'k', { athleteId: 'i12345' }).url, 'https://intervals.icu/api/v1/athlete/i12345/events/bulk?upsert=true');
  assert.equal(new URL(request.url).host, I.HOST);
  assert.throws(() => I.buildRequest(payload, '   '), { code: 'api_key_required' });
  assert.throws(() => I.buildRequest(payload, null), { code: 'api_key_required' });
  assert.throws(() => I.buildRequest([], 'k'), { code: 'payload_invalid' });
  assert.throws(() => I.buildRequest({}, 'k'), { code: 'payload_invalid' });
  assert.throws(() => I.buildRequest(payload, 'k', { athleteId: '../admin' }), { code: 'athlete_id_invalid' });
});

test('buildDeleteRequest: PUT events/bulk-delete by external_id', () => {
  assert.deepEqual(I.buildDeleteRequest(['veyvo-plan-2026-12-01', '', 7, ' veyvo-x '], 'key'), {
    url: 'https://intervals.icu/api/v1/athlete/0/events/bulk-delete',
    method: 'PUT',
    headers: { Authorization: 'Basic ' + Buffer.from('API_KEY:key').toString('base64'), 'Content-Type': 'application/json' },
    body: '[{"external_id":"veyvo-plan-2026-12-01"},{"external_id":"veyvo-x"}]'
  });
  assert.equal(I.buildDeleteRequest('veyvo-a', 'key').body, '[{"external_id":"veyvo-a"}]');
  assert.throws(() => I.buildDeleteRequest([], 'key'), { code: 'payload_invalid' });
  assert.throws(() => I.buildDeleteRequest(['a'], ''), { code: 'api_key_required' });
});

test('base64: UTF-8 safe through btoa, Buffer and the pure fallback', () => {
  for (const text of ['API_KEY:abc', 'API_KEY:klíč-žluťoučký', 'a', 'ab', 'abc', '', 'emoji 🏃']) {
    assert.equal(I.base64(text), Buffer.from(text, 'utf8').toString('base64'), text);
  }
  const source = fs.readFileSync(WORKOUTS_SRC, 'utf8') + '\n' + fs.readFileSync(SRC, 'utf8');
  // A bare context has no btoa, Buffer or TextEncoder: exercises the pure-JS encoders.
  const bare = {};
  vm.createContext(bare);
  vm.runInContext(source, bare);
  // Only Buffer: exercises the Buffer branch.
  const bufferOnly = { Buffer: Buffer };
  vm.createContext(bufferOnly);
  vm.runInContext(source, bufferOnly);
  for (const text of ['API_KEY:abc', 'API_KEY:klíč-žluťoučký', 'a', 'ab', '', 'emoji 🏃 ﬀ']) {
    const expected = Buffer.from(text, 'utf8').toString('base64');
    assert.equal(bare.VeyvoIntervals.base64(text), expected, 'fallback ' + text);
    assert.equal(bufferOnly.VeyvoIntervals.base64(text), expected, 'buffer ' + text);
  }
});

// ---------------------------------------------------------------- responses

test('parseError: maps VeyvoPlatform.http results and failures to codes', () => {
  assert.equal(I.parseError({ status: 200, ok: true, text: '[]', json: [] }), null);
  assert.equal(I.parseError({ status: 204, text: '' }), null);
  assert.deepEqual(I.parseError(null), { code: 'network', status: 0, message: '' });
  assert.deepEqual(I.parseError(new Error('getaddrinfo ENOTFOUND intervals.icu')),
    { code: 'network', status: 0, message: 'getaddrinfo ENOTFOUND intervals.icu' });
  assert.equal(I.parseError({ status: 0, ok: false, text: '' }).code, 'network');
  assert.deepEqual(I.parseError({ status: 401, ok: false, text: '{"error":"Unauthorized"}' }),
    { code: 'unauthorized', status: 401, message: 'Unauthorized' });
  assert.equal(I.parseError({ status: 403, ok: false }).code, 'forbidden');
  assert.equal(I.parseError({ status: 404, ok: false, text: 'Not Found' }).message, 'Not Found');
  assert.deepEqual(I.parseError({ status: 422, ok: false, json: { message: 'Invalid start_date_local' } }),
    { code: 'invalid_request', status: 422, message: 'Invalid start_date_local' });
  assert.equal(I.parseError({ status: 400, ok: false, json: { errors: [{ message: 'a' }, 'b'] } }).message, 'a; b');
  assert.equal(I.parseError({ status: 400, ok: false, json: 'plain' }).message, 'plain');
  assert.deepEqual(I.parseError({ status: 429, ok: false, text: '', headers: { 'Retry-After': '30' } }),
    { code: 'rate_limited', status: 429, message: '', retryAfterSeconds: 30 });
  assert.equal(I.parseError({ status: 429, ok: false, headers: new Map([['retry-after', '5']]) }).retryAfterSeconds, 5);
  assert.equal('retryAfterSeconds' in I.parseError({ status: 429, ok: false }), false);
  assert.equal(I.parseError({ status: 503, ok: false, text: '<html><body><h1>Bad gateway</h1></body></html>' }).message, 'Bad gateway');
  assert.equal(I.parseError({ status: 502, ok: false }).code, 'server_error');
  assert.equal(I.parseError({ status: 418, ok: false }).code, 'http_error');
  assert.equal(I.parseError({ status: 200, ok: false }).code, 'http_error', 'ok:false wins');
  const long = I.parseError({ status: 400, ok: false, text: 'x'.repeat(1000) }).message;
  assert.equal(long.length, 300);
  assert.ok(long.endsWith('…'));
});

test('parseResponse: created events or an error', () => {
  assert.deepEqual(I.parseResponse({ status: 200, ok: true, json: [
    { id: 991, external_id: 'veyvo-plan-2026-12-01', name: 'Lehký běh 3,5 km', start_date_local: '2026-12-01T00:00:00', category: 'WORKOUT' },
    null
  ] }), { ok: true, events: [{ id: 991, externalId: 'veyvo-plan-2026-12-01', name: 'Lehký běh 3,5 km', date: '2026-12-01' }] });
  assert.deepEqual(I.parseResponse({ status: 200, ok: true, text: '[{"id":1}]' }),
    { ok: true, events: [{ id: 1, externalId: null, name: '', date: null }] });
  assert.equal(I.parseResponse({ status: 200, ok: true, text: '{"oops":1}' }).error.code, 'unexpected_response');
  assert.equal(I.parseResponse({ status: 200, ok: true, text: 'not json' }).error.code, 'unexpected_response');
  assert.deepEqual(I.parseResponse({ status: 401, ok: false, text: '' }), { ok: false, error: { code: 'unauthorized', status: 401, message: '' } });
});

// ---------------------------------------------------------------- messages + integration

test('MESSAGES: every error and warning code has cs + en text with matching placeholders', () => {
  const I18n = require('../src/core/i18n.js');
  assert.equal(I.registerMessages(I18n), true);
  assert.equal(I.registerMessages({}), false);
  const report = I18n.audit('intervals');
  assert.deepEqual(report.missing, { cs: [], en: [] });
  assert.deepEqual(report.placeholderMismatch, []);
  for (const code of ['network', 'unauthorized', 'forbidden', 'not_found', 'invalid_request', 'rate_limited',
    'server_error', 'http_error', 'unexpected_response', 'api_key_required', 'date_required']) {
    assert.ok(I18n.has('intervals.error.' + code, 'cs') && I18n.has('intervals.error.' + code, 'en'), code);
  }
  for (const code of ['pace_needs_threshold', 'hr_absolute_unsupported', 'mixed_targets', 'open_step_nominal']) {
    assert.ok(I18n.has('intervals.warning.' + code, 'cs') && I18n.has('intervals.warning.' + code, 'en'), code);
  }
  assert.equal(I18n.t('intervals.warning.open_step_nominal', { minutes: 5 }, 'cs'),
    'Krok bez pevné délky ukončíš tlačítkem Lap. V intervals.icu má orientačně 5 min.');
  assert.equal(I18n.t('intervals.error.http_error', { status: 418 }, 'en'), 'intervals.icu returned error 418.');
});

test('integration: owner Tuesday + Sunday plan to a ready request', () => {
  const next = T.nextRunAfterRun({ date: '2026-11-24', type: 'easy', distance: 5, movingSeconds: 1650, effort: 5 }, [1, 6], '2026-11-27');
  const planned = W.fromNextRun(next, { days: [1, 6] });
  const request = I.buildRequest(I.toEventsPayload([planned]), 'secret');
  const body = JSON.parse(request.body);
  assert.equal(body[0].start_date_local, '2026-11-29T00:00:00');
  assert.equal(body[0].external_id, 'veyvo-plan-2026-11-29');
  assert.ok(body[0].description.endsWith('- Běh 4km 8:00-6:35/km Pace intensity=active'));
  assertGrammar(body[0].description);
});

// ---------------------------------------------------------------- UMD contract

test('UMD: classic script sets VeyvoIntervals and needs VeyvoWorkouts first', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  assert.throws(() => vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox), /needs VeyvoWorkouts/);
  const registered = [];
  const ok = { VeyvoI18n: { register: (ns) => registered.push(ns) } };
  vm.createContext(ok);
  vm.runInContext(fs.readFileSync(WORKOUTS_SRC, 'utf8'), ok);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ok);
  assert.equal(typeof ok.VeyvoIntervals.toWorkoutText, 'function');
  assert.deepEqual(registered, ['workouts', 'intervals']);
  const w = ok.VeyvoWorkouts.library(null)[5].workout;
  assert.equal(ok.VeyvoIntervals.toWorkoutText(w, { includeDescription: false }).split('\n').length, 3);
});

test('source stays pure: no module syntax, DOM, network or hidden clock', () => {
  const source = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(source, /^\s*(import|export)\s/m);
  assert.doesNotMatch(source, /\b(document|window|fetch|XMLHttpRequest|localStorage)\b/);
  assert.doesNotMatch(source, /Date\.now|new Date\(/);
});
