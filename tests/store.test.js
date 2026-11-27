const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../src/core/store.js');
const Runs = require('../src/core/runs-model.js');
const Training = require('../src/training-context.js');
const I18n = require('../src/core/i18n.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---------------------------------------------------------------- fixtures and helpers

function ownerLegacy() {
  return {
    profile: { goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6] },
    runHistory: [
      { id: 1732400000000, source: 'manual', date: '2026-11-24T00:00:00', type: 'Běh', distance: 5, time: '21:02', movingSeconds: 1262, effort: 9, effortRecorded: true, note: '' },
      { id: 'strava-123', stravaActivityId: '123', source: 'strava', date: '2026-11-21T19:30:00Z', type: 'Běh', name: 'Evening Run', distance: 12, time: '69:40', movingSeconds: 4180, effort: null, effortRecorded: false, note: '', averageHeartrate: 150.2, elevationGain: 34 }
    ],
    milestones: [{ date: '2026-09-01', label: 'Intervaly 6x400' }],
    recoveryLogs: [{ date: '2026-11-26', sleepHours: 7.2, fatigue: 4, soreness: 2, note: '' }],
    stravaActivityIds: ['123'],
    theme: 'dark',
    language: 'cs',
    stravaConnected: true,
    stravaLastSync: '2026-11-26T10:00:00.000Z',
    sharedChatUrl: 'x'
  };
}

const OWNER_V2 = {
  schemaVersion: 2,
  profile: { name: '', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true },
  runHistory: [
    { id: 'strava-123', source: 'strava', date: '2026-11-21', startTime: '19:30', type: 'run', distance: 12, movingSeconds: 4180, effort: null, note: '', name: 'Evening Run', stravaActivityId: '123', averageHeartrate: 150.2, elevationGain: 34 },
    { id: 'm-1732400000000', source: 'manual', date: '2026-11-24', startTime: null, type: 'run', distance: 5, movingSeconds: 1262, effort: 9, note: '' }
  ],
  recoveryLogs: [{ date: '2026-11-26', sleepHours: 7.2, fatigue: 4, soreness: 2, note: '' }],
  legacyMilestones: [{ date: '2026-09-01', label: 'Intervaly 6x400' }],
  ignoredStravaIds: [],
  ignoredHealthIds: [],
  plannedWorkouts: [],
  exportLog: [],
  theme: 'dark',
  language: 'cs',
  strava: { connected: true, lastSync: '2026-11-26T10:00:00.000Z', lastError: null },
  intervals: { enabled: false, lastPush: null, lastError: null },
  health: { enabled: false, lastImport: null, lastError: null },
  ui: { lastSeenVersion: null }
};

function messyLegacy() {
  return {
    profile: { goalDistanceKm: '10', targetSeconds: '45:00', days: ['1', 3, 3, 6], name: '  Pepa  ' },
    runHistory: [
      null,
      'run',
      { id: 1, date: '2026-13-45', distance: 5, time: '25:00' },
      { id: 2, date: '2026-11-01T07:15:00', distance: '5,2', time: '26:00', type: 'Lehký běh', effort: '7' },
      { id: 3, date: '2026-11-02', distance: -1, time: '20:00' },
      { id: 4, date: '2026-11-03', distance: 'abc', time: '20:00' },
      { id: 5, date: '2026-11-04', distance: 10, time: '21:61' },
      { id: '1732400000123', date: '2026-11-05T00:00:00', distance: 21.1, time: '1:45:30', type: 'Dlouhý běh', effort: 15, note: 'x'.repeat(1200) },
      { date: '2026-11-06', distance: 3, movingSeconds: '1200', type: 'Fartlek' },
      { id: 'strava-77', source: 'strava', date: '2026-11-07T00:10:00Z', distance: 8, movingSeconds: 2400, stravaActivityId: 77, averageHeartrate: 'abc' },
      { id: 2, date: '2026-11-08', distance: 4, time: '20:00', type: 'Intervaly' },
      { id: 2, date: '2026-11-01T07:15:00', distance: 5.2, time: '26:00' },
      { id: 'strava-77', source: 'strava', date: '2026-11-07', distance: 8.1, movingSeconds: 2410 },
      { id: 9, date: '2026-11-09', distance: 5, time: '19:58', type: 'Test 5 km', startTime: '25:00' },
      { id: 10, date: '2026-11-10', distance: 5, time: '0:00' },
      { id: 11, date: 20261111, distance: 5, time: '20:00' }
    ],
    milestones: [{ date: '2026-09-01', label: 'Intervaly 6x400' }, { date: 'bad', label: 'x' }, { date: '2026-09-02', label: '   ' }, 'junk'],
    recoveryLogs: [
      { date: '2026-11-01', sleepHours: '7,5', fatigue: 3, soreness: 1, note: '' },
      { date: '2026-11-01', sleepHours: 8, fatigue: 2, soreness: 0, note: 'later' },
      { date: '2026-11-02', sleepHours: 30, fatigue: 0, soreness: 11 },
      { date: 'nope', sleepHours: 7 },
      { date: '2026-11-03', fatigue: '5' }
    ],
    stravaActivityIds: ['77', '999', 77],
    theme: 'neon',
    language: 'en-GB',
    sharedChatUrl: 'x',
    randomJunk: 1,
    stravaConnected: 'yes'
  };
}

function v2WithExtras() {
  return {
    schemaVersion: 2,
    profile: { name: 'Anna', goalDistanceKm: 10, targetSeconds: null, days: [0, 2, 4], onboarded: false },
    runHistory: [
      { id: 'm-5', source: 'manual', date: '2026-10-02', startTime: '06:45', type: 'tempo', distance: 8, movingSeconds: 2700, effort: 7, note: 'Tempo 3x2 km', maxHeartrate: 181 },
      { id: 'strava-9', source: 'strava', date: '2026-10-01', startTime: '00:00', type: 'easy', distance: 6, movingSeconds: 2160, effort: null, note: '', stravaActivityId: '9', averageHeartrate: null, elevationGain: null }
    ],
    recoveryLogs: [{ date: '2026-10-02', sleepHours: null, fatigue: 6, soreness: null, note: '', legs: 'heavy' }],
    legacyMilestones: [],
    theme: 'light',
    language: 'en',
    strava: { connected: false, lastSync: null, lastError: 'token-expired' },
    intervals: { enabled: true, lastPush: '2026-10-02T08:00:00.000Z', lastError: null },
    ui: { lastSeenVersion: '0.4.0', lastPage: 'progress', compact: true, nested: { no: 1 } },
    workouts: [{ id: 'w1' }]
  };
}

const JUNK = [
  undefined, null, 0, 1, -1, NaN, Infinity, '', 'x', '{}', true, false, [], [1, 2], () => 1, Symbol('x'),
  new Date(0), /re/, new Map(), Object.create(null),
  { schemaVersion: 'abc' }, { schemaVersion: 99 }, { runHistory: 'nope' }, { runHistory: { 0: {} } },
  { profile: 'x' }, { profile: { days: 'x', goalDistanceKm: {}, targetSeconds: [], name: 5, onboarded: 'yes' } },
  { runHistory: [[]], recoveryLogs: 5, milestones: {} }, { strava: 5, intervals: [], ui: 'x' },
  { runHistory: [{ date: {}, distance: {}, movingSeconds: {} }, { date: '2026-11-01', distance: Infinity, movingSeconds: 1 }] },
  { runHistory: [{ date: '2026-02-30', distance: 5, movingSeconds: 1500 }, { date: '2026-11-01', distance: 5, movingSeconds: 172801 }] },
  { runHistory: [{ date: '2026-11-01', distance: 5, movingSeconds: 1500, effort: true, startTime: 1234, note: {}, name: 7, averageHeartrate: -3, elevationGain: 'lots' }] }
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function memoryStorage(initial, behaviour) {
  const b = behaviour || {};
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    getItem(key) {
      if (b.failGet) throw new Error('SecurityError: access denied');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (b.failSet && b.failSet(key)) {
        const error = new Error(b.quota ? 'The quota has been exceeded.' : 'write failed');
        error.name = b.quota ? 'QuotaExceededError' : 'Error';
        throw error;
      }
      map.set(key, String(value));
    },
    removeItem(key) { map.delete(key); }
  };
}

const codes = warnings => warnings.map(w => w.code);
const count = (warnings, code) => warnings.filter(w => w.code === code).length;

// ---------------------------------------------------------------- defaults

test('DEFAULT_STATE is the v2 schema and a fresh copy every time', () => {
  const a = Store.DEFAULT_STATE();
  assert.deepEqual(a, {
    schemaVersion: 2,
    profile: { name: '', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: false },
    runHistory: [], recoveryLogs: [], legacyMilestones: [], ignoredStravaIds: [], ignoredHealthIds: [], plannedWorkouts: [], exportLog: [], theme: 'dark', language: 'cs',
    strava: { connected: false, lastSync: null, lastError: null },
    intervals: { enabled: false, lastPush: null, lastError: null },
    health: { enabled: false, lastImport: null, lastError: null },
    ui: { lastSeenVersion: null }
  });
  a.profile.days.push(3);
  a.runHistory.push({});
  assert.deepEqual(Store.DEFAULT_STATE().profile.days, [1, 6]);
  assert.deepEqual(Store.DEFAULT_STATE().runHistory, []);
  assert.deepEqual(Store.migrate(Store.DEFAULT_STATE()), Store.DEFAULT_STATE());
});

// ---------------------------------------------------------------- legacy migration

test("owner's legacy state migrates exactly, with no warnings", () => {
  const report = Store.migrateWithReport(deepFreeze(ownerLegacy()));
  assert.deepEqual(report.state, OWNER_V2);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.fromVersion, 1);
  assert.equal(report.failed, false);
  assert.ok(!('time' in report.state.runHistory[0]), 'time string dropped once movingSeconds is known');
  assert.ok(!('effortRecorded' in report.state.runHistory[1]));
  assert.ok(!('milestones' in report.state) && !('stravaActivityIds' in report.state) && !('sharedChatUrl' in report.state));
  assert.deepEqual(Store.stravaActivityIds(report.state), ['123']);
});

test('migrated owner data works with VeyvoRuns and VeyvoTraining', () => {
  const state = Store.migrate(ownerLegacy());
  assert.ok(state.runHistory.every(Runs.isValidRun));
  const totals = Runs.totals(state.runHistory);
  assert.equal(totals.count, 2);
  assert.equal(totals.distanceKm, 17);
  assert.equal(totals.movingSeconds, 5442);
  const latest = Runs.sortRuns(state.runHistory).at(-1);
  assert.equal(latest.id, 'm-1732400000000');
  const next = Training.nextRunAfterRun(latest, state.profile.days, '2026-11-27');
  assert.equal(next.kind, 'easy');
  assert.equal(next.date, '2026-11-29'); // Sunday (profile day 6) after effort 9 -> at least 3 days
});

test('messy legacy state: valid runs kept, every drop reported', () => {
  const report = Store.migrateWithReport(deepFreeze(messyLegacy()));
  const { state, warnings } = report;
  assert.deepEqual(state.profile, { name: 'Pepa', goalDistanceKm: 10, targetSeconds: 2700, days: [1, 3, 6], onboarded: true });
  assert.deepEqual(state.runHistory.map(r => r.id), ['m-2', 'm-1732400000123', 'm-20261106-3000-1200', 'strava-77', 'm-2-2', 'm-9']);

  const [easy, long, generated, strava, renamed, test5k] = state.runHistory;
  assert.deepEqual(easy, { id: 'm-2', source: 'manual', date: '2026-11-01', startTime: '07:15', type: 'easy', distance: 5.2, movingSeconds: 1560, effort: 7, note: '' });
  assert.equal(long.type, 'long');
  assert.equal(long.startTime, null);
  assert.equal(long.movingSeconds, 6330);
  assert.equal(long.effort, null);
  assert.equal(long.note.length, 1000);
  assert.equal(generated.type, 'run');
  assert.equal(generated.movingSeconds, 1200);
  assert.deepEqual(strava, { id: 'strava-77', source: 'strava', date: '2026-11-07', startTime: '00:10', type: 'run', distance: 8, movingSeconds: 2400, effort: null, note: '', stravaActivityId: '77', averageHeartrate: null, elevationGain: null });
  assert.equal(renamed.type, 'intervals');
  assert.equal(renamed.date, '2026-11-08');
  assert.equal(test5k.type, 'test5k');
  assert.equal(test5k.startTime, null);
  assert.equal(test5k.movingSeconds, 1198);

  const dropped = warnings.filter(w => w.code === 'run-dropped');
  assert.deepEqual(dropped.map(w => [w.index, w.reason]), [
    [0, 'not-object'], [1, 'not-object'], [2, 'date-invalid'], [4, 'distance-invalid'], [5, 'distance-invalid'],
    [6, 'duration-invalid'], [14, 'duration-invalid'], [15, 'date-invalid']
  ]);
  assert.deepEqual(dropped[2].record, { id: 1, date: '2026-13-45', distance: 5, time: '25:00' }, 'dropped record is kept in the warning');
  assert.equal(dropped[2].id, '1');
  assert.deepEqual(warnings.filter(w => w.code === 'run-duplicate-dropped').map(w => w.index), [11, 12]);
  assert.deepEqual(warnings.filter(w => w.code === 'run-id-changed').map(w => [w.from, w.to]), [['m-2', 'm-2-2']]);
  assert.deepEqual(warnings.filter(w => w.code === 'run-type-unknown').map(w => w.value), ['Fartlek']);
  assert.deepEqual(warnings.filter(w => w.code === 'run-field-invalid').map(w => [w.id, w.field]).sort(), [
    ['m-1732400000123', 'effort'], ['m-9', 'startTime'], ['strava-77', 'averageHeartrate']
  ]);
  assert.equal(count(warnings, 'run-note-truncated'), 1);

  assert.deepEqual(state.legacyMilestones, [{ date: '2026-09-01', label: 'Intervaly 6x400' }]);
  assert.deepEqual(warnings.filter(w => w.code === 'milestone-dropped').map(w => w.reason), ['date-invalid', 'label-invalid', 'date-invalid']);

  assert.deepEqual(state.recoveryLogs, [
    { date: '2026-11-01', sleepHours: 8, fatigue: 2, soreness: 0, note: 'later' },
    { date: '2026-11-03', sleepHours: null, fatigue: 5, soreness: null, note: '' }
  ]);
  assert.equal(count(warnings, 'recovery-duplicate-date'), 1);
  assert.equal(count(warnings, 'recovery-field-invalid'), 3);
  assert.deepEqual(warnings.filter(w => w.code === 'recovery-dropped').map(w => w.reason), ['empty', 'date-invalid']);

  assert.equal(state.theme, 'dark');
  assert.equal(state.language, 'en');
  assert.deepEqual(state.strava, { connected: false, lastSync: null, lastError: null });
  assert.deepEqual(warnings.find(w => w.code === 'strava-ids-orphaned'), { code: 'strava-ids-orphaned', count: 1, ids: ['999'] });
  assert.deepEqual(warnings.filter(w => w.code === 'state-key-dropped').map(w => w.key), ['randomJunk']);
});

test('every Czech legacy type label maps to its code; unknown labels become run', () => {
  const labels = { 'Běh': 'run', 'Lehký běh': 'easy', 'Dlouhý běh': 'long', 'Tempo': 'tempo', 'Intervaly': 'intervals', 'Test 5 km': 'test5k', 'Závod': 'race' };
  for (const [label, code] of Object.entries(labels)) {
    assert.equal(Store.typeCode(label), code, label);
    const state = Store.migrate({ runHistory: [{ id: 1, date: '2026-11-01', distance: 5, time: '25:00', type: label }] });
    assert.equal(state.runHistory[0].type, code, label);
  }
  for (const code of Store.RUN_TYPES) assert.equal(Store.typeCode(code), code);
  assert.equal(Store.typeCode(' lehký  BĚH '), 'easy');
  assert.equal(Store.typeCode('Test 5km'), 'test5k');
  assert.equal(Store.typeCode('Long run'), 'long');
  assert.equal(Store.typeCode('Fartlek'), null);
  const report = Store.migrateWithReport({ runHistory: [{ id: 1, date: '2026-11-01', distance: 5, time: '25:00', type: 'Fartlek' }, { id: 2, date: '2026-11-02', distance: 5, time: '25:00' }] });
  assert.deepEqual(report.state.runHistory.map(r => r.type), ['run', 'run']);
  assert.deepEqual(codes(report.warnings), ['run-type-unknown']);
});

test('start time comes from the date string, never from new Date()', () => {
  const run = (date, extra) => Object.assign({ id: 1, date, distance: 5, movingSeconds: 1500 }, extra);
  const first = state => state.runHistory[0];
  assert.equal(first(Store.migrate({ runHistory: [run('2026-11-24T00:00:00')] })).startTime, null, 'manual midnight = no time');
  assert.equal(first(Store.migrate({ runHistory: [run('2026-11-24T07:15:00')] })).startTime, '07:15');
  assert.equal(first(Store.migrate({ runHistory: [run('2026-11-24 18:05')] })).startTime, '18:05');
  assert.equal(first(Store.migrate({ runHistory: [run('2026-11-24')] })).startTime, null);
  const strava = first(Store.migrate({ runHistory: [run('2026-11-24T00:00:00Z', { id: 'strava-5', source: 'strava' })] }));
  assert.equal(strava.startTime, '00:00', 'a Strava midnight run keeps its time');
  // Strava's local time with a fake Z just before midnight stays on the local calendar day.
  const late = first(Store.migrate({ runHistory: [run('2026-11-24T23:50:00Z', { id: 'strava-6', source: 'strava' })] }));
  assert.equal(late.date, '2026-11-24');
  assert.equal(late.startTime, '23:50');
  assert.equal(first(Store.migrate({ runHistory: [run('2026-11-24T07:15:00', { startTime: '6:05' })] })).startTime, '06:05', 'explicit startTime wins');
  const bad = Store.migrateWithReport({ runHistory: [run('2026-11-24', { startTime: '24:00' })] });
  assert.equal(first(bad.state).startTime, null);
  assert.deepEqual(codes(bad.warnings), ['run-field-invalid']);
});

test('moving time comes from movingSeconds or the legacy time string', () => {
  const seconds = raw => {
    const state = Store.migrate({ runHistory: [Object.assign({ id: 1, date: '2026-11-01', distance: 5 }, raw)] });
    return state.runHistory.length ? state.runHistory[0].movingSeconds : null;
  };
  assert.equal(seconds({ movingSeconds: 1262 }), 1262);
  assert.equal(seconds({ movingSeconds: '1262' }), 1262);
  assert.equal(seconds({ movingSeconds: 1262.4 }), 1262);
  assert.equal(seconds({ time: '21:02' }), 1262);
  assert.equal(seconds({ time: '69:40' }), 4180);
  assert.equal(seconds({ time: '1:09:40' }), 4180);
  assert.equal(seconds({ movingSeconds: null, time: '21:02' }), 1262);
  assert.equal(seconds({ movingSeconds: -5, time: '21:02' }), 1262);
  assert.equal(seconds({ movingSeconds: 1262, time: '99:99' }), 1262);
  assert.equal(seconds({ time: '21:60' }), null);
  assert.equal(seconds({ time: '1:60:00' }), null);
  assert.equal(seconds({ time: '21' }), null);
  assert.equal(seconds({}), null);
  assert.equal(seconds({ movingSeconds: 172800 }), 172800);
  assert.equal(seconds({ movingSeconds: 172801 }), null);
  assert.equal(Store.parseClockDuration('0:59'), 59);
  assert.equal(Store.parseClockDuration('12:00:00'), 43200);
  assert.equal(Store.parseClockDuration('abc'), null);
});

test('ids become strings: m-<n> for manual numbers, strava-<id> kept, unique after migration', () => {
  const state = Store.migrate({
    runHistory: [
      { id: 1732400000000, date: '2026-11-01', distance: 5, movingSeconds: 1500 },
      { id: '1732400000001', date: '2026-11-02', distance: 5, movingSeconds: 1500 },
      { id: 'm-1732400000002', date: '2026-11-03', distance: 5, movingSeconds: 1500 },
      { id: 'strava-123', date: '2026-11-04', distance: 5, movingSeconds: 1500 },
      { id: 456, source: 'strava', date: '2026-11-05', distance: 5, movingSeconds: 1500 },
      { id: 'whatever', stravaActivityId: 789, date: '2026-11-06', distance: 5, movingSeconds: 1500 },
      { date: '2026-11-07', distance: 5.5, movingSeconds: 1650 }
    ]
  });
  assert.deepEqual(state.runHistory.map(r => [r.id, r.source, r.stravaActivityId]), [
    ['m-1732400000000', 'manual', undefined],
    ['m-1732400000001', 'manual', undefined],
    ['m-1732400000002', 'manual', undefined],
    ['strava-123', 'strava', '123'],
    ['strava-456', 'strava', '456'],
    ['strava-789', 'strava', '789'],
    ['m-20261107-5500-1650', 'manual', undefined]
  ]);
  const collisions = Store.migrateWithReport({
    runHistory: [
      { id: 'x', date: '2026-11-01', distance: 5, movingSeconds: 1500 },
      { id: 'x', date: '2026-11-02', distance: 6, movingSeconds: 1800 },
      { id: 'x-2', date: '2026-11-03', distance: 7, movingSeconds: 2100 }
    ]
  });
  assert.deepEqual(collisions.state.runHistory.map(r => r.id), ['x', 'x-3', 'x-2'], 'renaming never steals a later id');
  assert.deepEqual(codes(collisions.warnings), ['run-id-changed']);
});

test('profile: valid legacy days are kept (no more forced [1,6]); invalid values are reported', () => {
  assert.deepEqual(Store.migrate({ profile: { days: [0, 2, 4] } }).profile.days, [0, 2, 4]);
  assert.deepEqual(Store.migrate({ profile: { days: ['6', '1'] } }).profile.days, [1, 6]);
  assert.deepEqual(Store.migrate({ profile: { days: [0, 1, 2, 3, 4, 5, 6] } }).profile.days, [0, 1, 2, 3, 4, 5, 6]);
  for (const days of [[], [7], [-1], [1.5], 'x', [null], {}]) {
    const report = Store.migrateWithReport({ profile: { days } });
    assert.deepEqual(report.state.profile.days, [1, 6], JSON.stringify(days));
    assert.deepEqual(codes(report.warnings), ['profile-field-invalid']);
  }
  assert.equal(Store.migrate({ profile: { goalDistanceKm: 10 } }).profile.targetSeconds, null, 'no invented target for another distance');
  assert.equal(Store.migrate({ profile: {} }).profile.targetSeconds, 1200);
  assert.equal(Store.migrate({ profile: { targetSeconds: null } }).profile.targetSeconds, null);
  assert.equal(Store.migrate({ profile: { targetSeconds: '1199' } }).profile.targetSeconds, 1199);
  const badTarget = Store.migrateWithReport({ profile: { targetSeconds: 10 } });
  assert.equal(badTarget.state.profile.targetSeconds, null);
  assert.deepEqual(badTarget.warnings.map(w => w.field), ['targetSeconds']);
  const badGoal = Store.migrateWithReport({ profile: { goalDistanceKm: 0.5 } });
  assert.equal(badGoal.state.profile.goalDistanceKm, 5);
  assert.deepEqual(badGoal.warnings.map(w => w.field), ['goalDistanceKm']);
  const longName = Store.migrateWithReport({ profile: { name: 'Ž'.repeat(45) } });
  assert.equal(longName.state.profile.name, 'Ž'.repeat(40));
  assert.deepEqual(codes(longName.warnings), ['profile-name-changed']);
});

test('onboarded: legacy users with data are onboarded, fresh states are not, explicit values stay', () => {
  assert.equal(Store.migrate(ownerLegacy()).profile.onboarded, true);
  assert.equal(Store.migrate({ profile: { goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6] }, runHistory: [], milestones: [], recoveryLogs: [] }).profile.onboarded, false);
  assert.equal(Store.migrate({ runHistory: [{ id: 1, date: 'bad' }] }).profile.onboarded, true, 'an existing user even if a run is broken');
  assert.equal(Store.migrate({ milestones: [{ date: '2026-09-01', label: 'Start' }] }).profile.onboarded, true);
  assert.equal(Store.migrate({ stravaConnected: true }).profile.onboarded, true);
  assert.equal(Store.migrate(v2WithExtras()).profile.onboarded, false, 'explicit false is kept');
  assert.equal(Store.migrate({ schemaVersion: 2, profile: { onboarded: true } }).profile.onboarded, true);
});

test('v2 state: unknown run/recovery/ui fields survive, unknown top-level keys are dropped and reported', () => {
  const report = Store.migrateWithReport(deepFreeze(v2WithExtras()));
  const { state } = report;
  assert.equal(report.fromVersion, 2);
  assert.deepEqual(codes(report.warnings), ['state-key-dropped']);
  assert.equal(report.warnings[0].key, 'workouts');
  assert.ok(!('workouts' in state));
  assert.deepEqual(state.runHistory.map(r => r.id), ['strava-9', 'm-5']);
  assert.equal(state.runHistory[0].startTime, '00:00');
  assert.equal(state.runHistory[1].maxHeartrate, 181);
  assert.equal(state.recoveryLogs[0].legs, 'heavy');
  assert.deepEqual(state.ui, { lastSeenVersion: '0.4.0', lastPage: 'progress', compact: true });
  assert.deepEqual(state.strava, { connected: false, lastSync: null, lastError: 'token-expired' });
  assert.deepEqual(state.intervals, { enabled: true, lastPush: '2026-10-02T08:00:00.000Z', lastError: null });
  assert.equal(state.theme, 'light');
  assert.equal(state.language, 'en');
});

test('a newer schema is read best-effort and reported', () => {
  const report = Store.migrateWithReport({ schemaVersion: 3, profile: { name: 'Pepa' }, runHistory: [] });
  assert.equal(report.fromVersion, 3);
  assert.equal(report.state.schemaVersion, 2);
  assert.deepEqual(codes(report.warnings), ['schema-newer']);
  assert.equal(report.state.profile.name, 'Pepa');
});

test('migrate never throws on junk and returns a valid v2 state', () => {
  for (const value of JUNK) {
    const report = Store.migrateWithReport(value);
    assert.equal(report.state.schemaVersion, 2);
    assert.ok(Array.isArray(report.state.runHistory));
    assert.ok(Array.isArray(report.state.profile.days));
    assert.doesNotThrow(() => JSON.stringify(report.state));
  }
  const hostile = { get runHistory() { throw new Error('boom'); } };
  const report = Store.migrateWithReport(hostile);
  assert.equal(report.failed, true);
  assert.deepEqual(report.state, Store.DEFAULT_STATE());
  assert.deepEqual(codes(report.warnings), ['migrate-failed']);
  assert.deepEqual(Store.migrateWithReport('x').warnings, [{ code: 'state-not-object', valueType: 'string' }]);
  assert.deepEqual(Store.migrateWithReport(null).warnings, []);
});

test('migration cannot pollute prototypes', () => {
  const raw = JSON.parse('{"__proto__":{"polluted":true},"runHistory":[{"id":"m-1","date":"2026-11-01","distance":5,"movingSeconds":1500,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}],"ui":{"__proto__":"x"}}');
  const state = Store.migrate(raw);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.getPrototypeOf(state.runHistory[0]), Object.prototype);
  assert.ok(!Object.prototype.hasOwnProperty.call(state.runHistory[0], '__proto__'));
  assert.ok(!Object.prototype.hasOwnProperty.call(state.runHistory[0], 'constructor'));
  assert.ok(!Object.prototype.hasOwnProperty.call(state.ui, '__proto__'));
});

test('migrate is idempotent and pure for every fixture', () => {
  const fixtures = [ownerLegacy(), messyLegacy(), v2WithExtras(), OWNER_V2].concat(JUNK);
  for (const fixture of fixtures) {
    const before = typeof fixture === 'object' && fixture !== null && !(fixture instanceof Map) ? JSON.stringify(fixture) : null;
    const once = Store.migrate(fixture);
    const twice = Store.migrateWithReport(once);
    assert.deepEqual(twice.state, once);
    assert.deepEqual(twice.warnings, [], 'a migrated state needs no further fixes');
    assert.deepEqual(Store.migrate(JSON.parse(JSON.stringify(once))), once, 'survives a JSON round trip');
    if (before !== null) assert.equal(JSON.stringify(fixture), before, 'input not mutated');
  }
  const frozen = deepFreeze(messyLegacy());
  assert.doesNotThrow(() => Store.migrate(frozen));
});

// ---------------------------------------------------------------- load and save

test('load: empty storage gives defaults; legacy data is migrated with a one-time raw backup', () => {
  const empty = Store.load(memoryStorage());
  assert.deepEqual(empty.state, Store.DEFAULT_STATE());
  assert.equal(empty.recoveredFromCorruption, false);
  assert.deepEqual(empty.warnings, []);
  assert.equal(empty.fromVersion, null);

  const raw = JSON.stringify(ownerLegacy());
  const storage = memoryStorage({ 'veyvo-state': raw });
  const first = Store.load(storage, { now: '2026-11-27T10:00:00' });
  assert.deepEqual(first.state, OWNER_V2);
  assert.equal(first.fromVersion, 1);
  assert.equal(first.backupKey, 'veyvo-state-backup-v1');
  assert.equal(storage.map.get('veyvo-state-backup-v1'), raw);
  assert.equal(first.needsSave, true);
  assert.equal(storage.map.get('veyvo-state'), raw, 'load does not overwrite the stored value');

  assert.deepEqual(Store.save(storage, first.state), { ok: true, bytes: storage.map.get('veyvo-state').length });
  const second = Store.load(storage);
  assert.deepEqual(second.state, OWNER_V2);
  assert.equal(second.fromVersion, 2);
  assert.equal(second.backupKey, null);
  assert.equal(second.needsSave, false);
  assert.deepEqual(second.warnings, []);

  // An existing backup is never overwritten by a later legacy load.
  storage.map.set('veyvo-state', JSON.stringify({ runHistory: [] }));
  const third = Store.load(storage);
  assert.equal(third.backupKey, 'veyvo-state-backup-v1');
  assert.equal(storage.map.get('veyvo-state-backup-v1'), raw);
});

test('load: corrupt JSON is copied to a timestamped key and defaults are returned', () => {
  const broken = '{"runHistory":[{"id":1,';
  const storage = memoryStorage({ 'veyvo-state': broken });
  const result = Store.load(storage, { now: '2026-11-27T10:15:30' });
  assert.equal(result.recoveredFromCorruption, true);
  assert.equal(result.corruptKey, 'veyvo-state-corrupt-20261127101530');
  assert.equal(storage.map.get('veyvo-state-corrupt-20261127101530'), broken);
  assert.deepEqual(result.state, Store.DEFAULT_STATE());
  assert.deepEqual(result.warnings, [{ code: 'state-corrupt', reason: 'json-invalid' }]);
  assert.equal(storage.map.get('veyvo-state'), broken);

  assert.equal(Store.load(storage, { now: '20261127101530' }).corruptKey, 'veyvo-state-corrupt-20261127101530-2', 'never overwrites an earlier copy');
  assert.equal(Store.load(storage, { now: '2026-11-27T10:15:30.000Z' }).corruptKey, 'veyvo-state-corrupt-20261127101530-3');
  assert.equal(Store.load(memoryStorage({ 'veyvo-state': '{' }), { now: new Date(2026, 10, 27, 8, 5, 9) }).corruptKey, 'veyvo-state-corrupt-20261127080509');
  assert.match(Store.load(memoryStorage({ 'veyvo-state': '{' })).corruptKey, /^veyvo-state-corrupt-\d{14}$/);
  assert.equal(Store.load(memoryStorage({ 'veyvo-state': '{' }), { now: '2026-11-27' }).corruptKey, 'veyvo-state-corrupt-20261127000000');

  for (const junk of ['[1,2]', '"text"', '42', 'true', '', 'undefined']) {
    const r = Store.load(memoryStorage({ 'veyvo-state': junk }), { now: '20261127000000' });
    assert.equal(r.recoveredFromCorruption, true, junk);
    assert.deepEqual(r.state, Store.DEFAULT_STATE());
  }
  const nullState = Store.load(memoryStorage({ 'veyvo-state': 'null' }));
  assert.equal(nullState.recoveredFromCorruption, false);
  assert.deepEqual(nullState.state, Store.DEFAULT_STATE());
});

test('load: unreadable storage, failed copies, BOM and custom keys', () => {
  const unreadable = Store.load(memoryStorage({}, { failGet: true }));
  assert.deepEqual(unreadable.state, Store.DEFAULT_STATE());
  assert.deepEqual(codes(unreadable.warnings), ['storage-read-failed']);
  assert.equal(unreadable.recoveredFromCorruption, false);
  assert.deepEqual(codes(Store.load(null).warnings), ['storage-read-failed']);

  const full = memoryStorage({ 'veyvo-state': '{oops' }, { failSet: () => true, quota: true });
  const copyFailed = Store.load(full, { now: '20261127101530' });
  assert.equal(copyFailed.recoveredFromCorruption, true);
  assert.equal(copyFailed.corruptKey, null);
  assert.equal(copyFailed.needsSave, false, 'the only copy must not be overwritten');
  assert.deepEqual(codes(copyFailed.warnings), ['state-corrupt', 'corrupt-copy-failed']);

  const noBackup = Store.load(memoryStorage({ 'veyvo-state': JSON.stringify(ownerLegacy()) }, { failSet: key => key.startsWith('veyvo-state-backup') }));
  assert.deepEqual(noBackup.state, OWNER_V2);
  assert.deepEqual(codes(noBackup.warnings), ['migration-backup-failed']);
  assert.equal(noBackup.backupKey, null);

  const bom = Store.load(memoryStorage({ 'veyvo-state': '﻿' + JSON.stringify(OWNER_V2) }));
  assert.equal(bom.recoveredFromCorruption, false);
  assert.deepEqual(bom.state, OWNER_V2);

  const custom = memoryStorage({ other: JSON.stringify(OWNER_V2) });
  assert.deepEqual(Store.load(custom, { key: 'other' }).state, OWNER_V2);
  assert.equal(Store.save(custom, OWNER_V2, { key: 'other2' }).ok, true);
  assert.equal(custom.map.get('other2'), JSON.stringify(OWNER_V2));
});

test('load: broken runs inside valid JSON are reported, not treated as corruption', () => {
  // The raw legacy string still survives in the v1 backup key.
  const storage = memoryStorage({ 'veyvo-state': JSON.stringify({ runHistory: [{ id: 1, date: 'x' }] }) });
  const result = Store.load(storage);
  assert.equal(result.recoveredFromCorruption, false);
  assert.deepEqual(codes(result.warnings), ['run-dropped']);
  assert.equal(result.warnings[0].record.id, 1);
  assert.ok(storage.map.has('veyvo-state-backup-v1'));
});

test('save: writes JSON, never throws, reports storage errors', () => {
  const storage = memoryStorage();
  const state = Store.migrate(ownerLegacy());
  assert.equal(Store.save(storage, state).ok, true);
  assert.deepEqual(JSON.parse(storage.map.get(Store.STORAGE_KEY)), state);
  assert.deepEqual(Store.save(memoryStorage({}, { failSet: () => true, quota: true }), state), { ok: false, error: 'storage-full' });
  assert.deepEqual(Store.save(memoryStorage({}, { failSet: () => true }), state), { ok: false, error: 'storage-write-failed' });
  assert.deepEqual(Store.save(null, state), { ok: false, error: 'storage-write-failed' });
  assert.deepEqual(Store.save(storage, null), { ok: false, error: 'state-invalid' });
  assert.deepEqual(Store.save(storage, ownerLegacy()), { ok: false, error: 'state-invalid' }, 'only v2 states are written');
  const cyclic = Store.DEFAULT_STATE();
  cyclic.ui.self = cyclic;
  assert.deepEqual(Store.save(storage, cyclic), { ok: false, error: 'serialize-failed' });
});

// ---------------------------------------------------------------- backups

test('exportBackup -> parseBackup round trip', () => {
  const state = Store.migrate(ownerLegacy());
  const nutrition = JSON.stringify({ distance: '10', timing: 'meal', checked: ['water'] });
  const text = Store.exportBackup(deepFreeze(state), nutrition, { appVersion: '0.4.0', exportedAt: '2026-11-27T10:00:00.000Z' });
  assert.ok(text.startsWith('{\n  "app": "VEYVO",\n  "kind": "backup",\n  "schemaVersion": 2,'), 'pretty JSON with a fixed header');
  const doc = JSON.parse(text);
  assert.deepEqual(Object.keys(doc), ['app', 'kind', 'schemaVersion', 'appVersion', 'exportedAt', 'state', 'nutrition']);
  assert.equal(doc.appVersion, '0.4.0');
  assert.equal(doc.exportedAt, '2026-11-27T10:00:00.000Z');
  assert.deepEqual(doc.nutrition, { distance: '10', timing: 'meal', checked: ['water'] });

  const parsed = Store.parseBackup(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.state, state);
  assert.deepEqual(parsed.nutrition, { distance: '10', timing: 'meal', checked: ['water'] });
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.appVersion, '0.4.0');
  assert.equal(parsed.exportedAt, '2026-11-27T10:00:00.000Z');
  assert.equal(Store.parseBackup('﻿' + text).ok, true, 'Windows editors may add a BOM');
});

test('exportBackup normalizes its inputs', () => {
  const doc = JSON.parse(Store.exportBackup(ownerLegacy(), '{broken', { exportedAt: new Date(Date.UTC(2026, 10, 27, 9)) }));
  assert.deepEqual(doc.state, OWNER_V2, 'a legacy state is exported as v2');
  assert.equal(doc.nutrition, null);
  assert.equal(doc.appVersion, null);
  assert.equal(doc.exportedAt, '2026-11-27T09:00:00.000Z');
  assert.deepEqual(JSON.parse(Store.exportBackup(null, { a: 1 }, {})).nutrition, { a: 1 });
  assert.equal(JSON.parse(Store.exportBackup(null, '[1]')).nutrition, null);
  assert.equal(JSON.parse(Store.exportBackup(null)).exportedAt, null, 'no hidden clock');
  assert.equal(Store.backupFileName('2026-11-27T10:15:30.000Z'), 'veyvo-backup-2026-11-27-1015.json');
  assert.equal(Store.backupFileName('2026-11-27'), 'veyvo-backup-2026-11-27.json');
  assert.equal(Store.backupFileName(''), 'veyvo-backup.json');
});

test('parseBackup rejects anything that is not a VEYVO v1/v2 backup', () => {
  const wrap = patch => JSON.stringify(Object.assign({ app: 'VEYVO', kind: 'backup', schemaVersion: 2, state: Store.DEFAULT_STATE() }, patch));
  const cases = [
    [null, 'not-text'], [42, 'not-text'], ['', 'empty'], ['   \n', 'empty'], ['{"app":', 'json-invalid'],
    ['[]', 'not-backup'], ['"VEYVO"', 'not-backup'],
    [wrap({ app: 'Strava' }), 'wrong-app'], [wrap({ app: undefined }), 'wrong-app'], [wrap({ kind: 'state' }), 'wrong-kind'],
    [wrap({ schemaVersion: undefined }), 'schema-invalid'], [wrap({ schemaVersion: '2' }), 'schema-invalid'],
    [wrap({ schemaVersion: 0 }), 'schema-invalid'], [wrap({ schemaVersion: 1.5 }), 'schema-invalid'],
    [wrap({ schemaVersion: 3 }), 'schema-newer'],
    [wrap({ state: undefined }), 'state-invalid'], [wrap({ state: [] }), 'state-invalid'], [wrap({ state: 'x' }), 'state-invalid']
  ];
  for (const [input, error] of cases) {
    const result = Store.parseBackup(input);
    assert.equal(result.ok, false, String(input));
    assert.equal(result.error, error, String(input));
    assert.equal(result.state, null);
  }
  assert.equal(Store.parseBackup(' '.repeat(Store.LIMITS.maxBackupChars + 1)).error, 'too-large');
});

test('parseBackup migrates the state inside and reports what it dropped', () => {
  const text = JSON.stringify({ app: 'VEYVO', kind: 'backup', schemaVersion: 1, state: messyLegacy(), nutrition: 'nope' });
  const parsed = Store.parseBackup(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state, Store.migrate(messyLegacy()));
  assert.equal(count(parsed.warnings, 'run-dropped'), 8);
  assert.equal(count(parsed.warnings, 'nutrition-dropped'), 1);
  assert.equal(parsed.nutrition, null);
});

test('applyBackup replaces or merges', () => {
  const current = Store.setProfile(Store.migrate(ownerLegacy()), { name: 'Pepa' }).state;
  const backupState = Store.migrate({
    schemaVersion: 2,
    profile: { name: 'Old', goalDistanceKm: 10, targetSeconds: null, days: [2], onboarded: true },
    runHistory: [
      { id: 'm-1732400000000', source: 'manual', date: '2026-11-24', type: 'run', distance: 5, movingSeconds: 1262, effort: 9, note: 'from phone' },
      { id: 'm-1', source: 'manual', date: '2026-10-01', type: 'easy', distance: 4, movingSeconds: 1500, effort: 4, note: '' }
    ],
    recoveryLogs: [{ date: '2026-11-26', sleepHours: 5, fatigue: 9, soreness: 9, note: '' }, { date: '2026-10-01', sleepHours: 8, fatigue: 2, soreness: 1, note: '' }],
    legacyMilestones: [{ date: '2026-09-01', label: 'Intervaly 6x400' }, { date: '2026-08-01', label: 'Start' }]
  });
  const parsed = Store.parseBackup(Store.exportBackup(backupState, null, { appVersion: '0.4.0', exportedAt: '2026-11-27T10:00:00Z' }));

  const replaced = Store.applyBackup(current, parsed, { mode: 'replace' });
  assert.equal(replaced.ok, true);
  assert.deepEqual(replaced.state, backupState);

  const merged = Store.applyBackup(deepFreeze(current), parsed, { mode: 'merge' });
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.stats, { added: 1, updated: 1, unchanged: 0, invalid: 0, ignored: 0 });
  assert.equal(merged.state.profile.name, 'Pepa', 'an onboarded profile stays');
  assert.deepEqual(merged.state.runHistory.map(r => r.id), ['m-1', 'strava-123', 'm-1732400000000']);
  assert.equal(merged.state.runHistory[2].note, 'from phone', 'blank note filled from the backup');
  assert.deepEqual(merged.state.recoveryLogs.map(l => [l.date, l.fatigue]), [['2026-10-01', 2], ['2026-11-26', 4]]);
  assert.deepEqual(merged.state.legacyMilestones.map(m => m.label), ['Intervaly 6x400', 'Start']);
  assert.equal(Store.applyBackup(Store.DEFAULT_STATE(), parsed, { mode: 'merge' }).state.profile.name, 'Old', 'a fresh install takes the backup profile');
  assert.equal(Store.applyBackup(current, { ok: false }, {}).ok, false);
});

// ---------------------------------------------------------------- merging runs

const MANUAL = { id: 'm-1', source: 'manual', date: '2026-11-24', startTime: null, type: 'test5k', distance: 5, movingSeconds: 1262, effort: 9, note: 'Hard' };
const STRAVA = { id: 'strava-555', source: 'strava', date: '2026-11-24', startTime: '17:05', type: 'run', distance: 5.08, movingSeconds: 1290, effort: null, note: '', name: 'Afternoon Run', stravaActivityId: '555', averageHeartrate: 171.4, elevationGain: 12 };
// Owner decision (2026-11-27): the typed time is authoritative; Strava's moving time is kept as stravaMovingSeconds.
const COMBINED = { id: 'strava-555', source: 'strava', date: '2026-11-24', startTime: '17:05', type: 'test5k', distance: 5, movingSeconds: 1262, stravaMovingSeconds: 1290, effort: 9, note: 'Hard', name: 'Afternoon Run', stravaActivityId: '555', averageHeartrate: 171.4, elevationGain: 12 };

test('mergeRuns: a manual run and its Strava twin become one record (both directions)', () => {
  const a = Store.mergeRuns(deepFreeze([MANUAL]), deepFreeze([STRAVA]));
  assert.deepEqual(a.runs, [COMBINED]);
  assert.deepEqual([a.added, a.updated, a.unchanged, a.invalid], [0, 1, 0, 0]);
  const b = Store.mergeRuns([STRAVA], [MANUAL]);
  assert.deepEqual(b.runs, [COMBINED]);
  assert.equal(b.updated, 1);
  // Agrees with VeyvoRuns' rule for the cross-source case.
  assert.equal(Runs.findDuplicate([MANUAL], STRAVA), MANUAL);
  assert.equal(Store.isDuplicateRun(MANUAL, STRAVA), true);
});

test('mergeRuns: dedupe by id first, existing record wins and only gains blanks', () => {
  const existing = [{ id: 'm-1', source: 'manual', date: '2026-11-01', type: 'run', distance: 6, movingSeconds: 1800, effort: null, note: '' }];
  const incoming = [{ id: 'm-1', source: 'manual', date: '2026-11-01', type: 'easy', distance: 5, movingSeconds: 1500, effort: 5, note: 'old copy' }];
  const result = Store.mergeRuns(existing, incoming);
  assert.equal(result.runs.length, 1);
  assert.deepEqual(result.runs[0], { id: 'm-1', source: 'manual', date: '2026-11-01', startTime: null, type: 'run', distance: 6, movingSeconds: 1800, effort: 5, note: 'old copy' });
  assert.equal(result.updated, 1);
  const again = Store.mergeRuns(result.runs, incoming);
  assert.deepEqual([again.added, again.updated, again.unchanged], [0, 0, 1]);
  assert.deepEqual(again.runs, result.runs);
  const byStrava = Store.mergeRuns([STRAVA], [{ id: 555, source: 'strava', date: '2026-11-24T17:05:00Z', distance: 5.08, time: '21:30', type: 'Běh' }]);
  assert.deepEqual([byStrava.added, byStrava.updated, byStrava.unchanged], [0, 0, 1], 'legacy Strava copy of the same activity');
});

test('mergeRuns: duplicate thresholds are |Δkm| < 0.15 and |Δs| < 90 on the same date', () => {
  const base = { id: 'm-a', source: 'manual', date: '2026-11-01', distance: 5, movingSeconds: 1500 };
  const with_ = patch => Store.mergeRuns([base], [Object.assign({ id: 'm-b', source: 'manual', date: '2026-11-01', distance: 5, movingSeconds: 1500 }, patch)]);
  assert.equal(with_({ distance: 5.149 }).runs.length, 1);
  assert.equal(with_({ distance: 5.15 }).runs.length, 2);
  assert.equal(with_({ distance: 4.851 }).runs.length, 1);
  assert.equal(with_({ distance: 4.85 }).runs.length, 2);
  assert.equal(with_({ movingSeconds: 1589 }).runs.length, 1);
  assert.equal(with_({ movingSeconds: 1590 }).runs.length, 2);
  assert.equal(with_({ movingSeconds: 1411 }).runs.length, 1);
  assert.equal(with_({ movingSeconds: 1410 }).runs.length, 2);
  assert.equal(with_({ date: '2026-11-02' }).runs.length, 2);
  // Same run logged on two devices (both manual): kept once, blanks filled.
  const twoDevices = with_({ effort: 6, note: 'phone' });
  assert.equal(twoDevices.runs.length, 1);
  assert.equal(twoDevices.runs[0].id, 'm-a');
  assert.equal(twoDevices.runs[0].effort, 6);
  assert.equal(twoDevices.runs[0].note, 'phone');
});

test('mergeRuns: different Strava activities and runs hours apart stay separate', () => {
  const s1 = Object.assign({}, STRAVA, { id: 'strava-1', stravaActivityId: '1' });
  const s2 = Object.assign({}, STRAVA, { id: 'strava-2', stravaActivityId: '2' });
  assert.equal(Store.mergeRuns([s1], [s2]).runs.length, 2);
  const morning = Object.assign({}, MANUAL, { startTime: '07:00' });
  assert.equal(Store.mergeRuns([morning], [Object.assign({}, STRAVA, { startTime: '17:05' })]).runs.length, 2);
  assert.equal(Store.mergeRuns([Object.assign({}, MANUAL, { startTime: '15:10' })], [STRAVA]).runs.length, 1, 'under 2 h apart');
});

test('mergeRuns: each existing run absorbs at most one lookalike, the closest one', () => {
  const existing = [{ id: 'm-a', date: '2026-11-01', distance: 5, movingSeconds: 1500 }];
  const incoming = [{ id: 'm-b', date: '2026-11-01', distance: 5, movingSeconds: 1500 }, { id: 'm-c', date: '2026-11-01', distance: 5.01, movingSeconds: 1505 }];
  const result = Store.mergeRuns(existing, incoming);
  assert.deepEqual(result.runs.map(r => r.id), ['m-a', 'm-c']);
  assert.deepEqual([result.added, result.updated, result.unchanged], [1, 0, 1]);

  const two = [{ id: 'm-a', date: '2026-11-01', distance: 5, movingSeconds: 1500 }, { id: 'm-x', date: '2026-11-01', distance: 5.1, movingSeconds: 1520 }];
  const closest = Store.mergeRuns(two, [Object.assign({}, STRAVA, { date: '2026-11-01', distance: 5.09, movingSeconds: 1519 })]);
  assert.deepEqual(closest.runs.map(r => r.id).sort(), ['m-a', 'strava-555']);
  assert.equal(closest.runs.find(r => r.id === 'strava-555').distance, 5.1, 'kept the manual distance of m-x');
});

test('mergeRuns: invalid incoming runs are counted and reported, output is sorted and inputs untouched', () => {
  const existing = deepFreeze([{ id: 'm-2', date: '2026-11-05', distance: 5, movingSeconds: 1500 }]);
  const incoming = deepFreeze([{ date: 'bad' }, null, { id: 'm-1', date: '2026-11-01', distance: 3, time: '18:00', type: 'Lehký běh' }]);
  const result = Store.mergeRuns(existing, incoming);
  assert.equal(result.invalid, 2);
  assert.equal(result.added, 1);
  assert.deepEqual(result.runs.map(r => [r.id, r.type]), [['m-1', 'easy'], ['m-2', 'run']]);
  assert.deepEqual(result.warnings.filter(w => w.code === 'run-dropped').map(w => w.list), ['incoming', 'incoming']);
  assert.deepEqual(Store.mergeRuns(undefined, 'x').runs, []);
  assert.ok(Store.isDuplicateRun({ date: '2026-11-24T00:00:00', distance: 5, time: '21:02' }, { date: '2026-11-24', distance: '5,05', movingSeconds: 1270 }));
  assert.equal(Store.isDuplicateRun(null, MANUAL), false);
});

// ---------------------------------------------------------------- validation and edits

const TODAY = '2026-11-27';

test('validateRun accepts form input and normalizes it', () => {
  const result = Store.validateRun({ date: '2026-11-26', startTime: '7:05', type: 'easy', distance: '6,4', time: '34:12', effort: '6', note: '  Lehce, bez bolesti.  ' }, TODAY);
  assert.deepEqual(result, {
    ok: true,
    run: { date: '2026-11-26', startTime: '07:05', type: 'easy', distance: 6.4, movingSeconds: 2052, effort: 6, note: 'Lehce, bez bolesti.' },
    errors: [], warnings: []
  });
  const minimal = Store.validateRun({ date: TODAY, distance: 5, movingSeconds: 1199 }, { today: TODAY });
  assert.deepEqual(minimal.run, { date: TODAY, startTime: null, type: 'run', distance: 5, movingSeconds: 1199, effort: null, note: '' });
  assert.equal(Store.validateRun({ date: TODAY, distance: 42.195, time: '3:59:59', effort: 10 }, TODAY).run.movingSeconds, 14399);
  assert.equal(Store.validateRun({ date: TODAY, distance: 300, movingSeconds: 172800 }, TODAY).ok, true);
  assert.equal(Store.validateRun({ date: TODAY, distance: 5, movingSeconds: 1500, name: ' Ranní běh ' }, TODAY).run.name, 'Ranní běh');
  assert.equal(Store.validateRun({ date: TODAY, distance: 5, movingSeconds: 1500, note: '🏃'.repeat(1000) }, TODAY).ok, true, 'characters, not UTF-16 units');
});

test('validateRun error codes', () => {
  const base = { date: '2026-11-20', distance: 5, movingSeconds: 1500 };
  const errors = (patch, today = TODAY) => Store.validateRun(Object.assign({}, base, patch), today).errors;
  assert.deepEqual(Store.validateRun(null, TODAY).errors, ['input-invalid']);
  assert.deepEqual(Store.validateRun(base).errors, ['today-invalid']);
  assert.deepEqual(Store.validateRun(base, '2026-02-30').errors, ['today-invalid']);
  assert.deepEqual(errors({ date: '' }), ['date-required']);
  assert.deepEqual(errors({ date: '2026-02-30' }), ['date-invalid']);
  assert.deepEqual(errors({ date: '2026-11-24T00:00:00' }), ['date-invalid']);
  assert.deepEqual(errors({ date: '2026-11-28' }), ['date-future']);
  assert.deepEqual(errors({ date: TODAY }), []);
  assert.deepEqual(errors({ startTime: '24:00' }), ['start-time-invalid']);
  assert.deepEqual(errors({ type: 'Běh' }), ['type-invalid'], 'codes only, labels are for the UI');
  assert.deepEqual(errors({ distance: '' }), ['distance-required']);
  assert.deepEqual(errors({ distance: 'pět' }), ['distance-invalid']);
  assert.deepEqual(errors({ distance: 0 }), ['distance-range']);
  assert.deepEqual(errors({ distance: 300.01 }), ['distance-range']);
  assert.deepEqual(errors({ movingSeconds: undefined }), ['duration-required']);
  assert.deepEqual(errors({ movingSeconds: undefined, time: '21:60' }), ['duration-invalid']);
  assert.deepEqual(errors({ movingSeconds: undefined, time: '21' }), ['duration-invalid'], 'a bare number typed as time is ambiguous');
  assert.deepEqual(errors({ movingSeconds: '1262' }), []);
  assert.deepEqual(errors({ movingSeconds: '21:02' }), []);
  assert.deepEqual(errors({ movingSeconds: 0 }), ['duration-range']);
  assert.deepEqual(errors({ movingSeconds: 172801 }), ['duration-range']);
  assert.deepEqual(errors({ effort: 0 }), ['effort-invalid']);
  assert.deepEqual(errors({ effort: 11 }), ['effort-invalid']);
  assert.deepEqual(errors({ effort: 7.5 }), ['effort-invalid']);
  assert.deepEqual(errors({ effort: null }), []);
  assert.deepEqual(errors({ note: 'a'.repeat(1001) }), ['note-too-long']);
  assert.deepEqual(errors({ note: 5 }), ['note-invalid']);
  assert.deepEqual(errors({ name: 'n'.repeat(201) }), ['run-name-too-long']);
  assert.deepEqual(errors({ date: '', distance: '', movingSeconds: '' }), ['date-required', 'distance-required', 'duration-required']);
  const fast = Store.validateRun(Object.assign({}, base, { movingSeconds: 300 }), TODAY);
  assert.equal(fast.ok, true);
  assert.deepEqual(fast.warnings, ['pace-implausible'], 'minutes typed as seconds');
});

test('addRun adds a manual run with a unique id and an undo token', () => {
  const state = deepFreeze(Store.migrate(ownerLegacy()));
  const result = Store.addRun(state, { date: '2026-11-26', distance: '6,4', time: '34:12', type: 'easy', effort: 6 }, { today: TODAY, nowMs: 1764230400000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { id: 'm-1764230400000', source: 'manual', date: '2026-11-26', startTime: null, type: 'easy', distance: 6.4, movingSeconds: 2052, effort: 6, note: '' });
  assert.deepEqual(result.state.runHistory.map(r => r.id), ['strava-123', 'm-1732400000000', 'm-1764230400000']);
  assert.equal(result.duplicateOf, null);
  assert.deepEqual(result.undo, { op: 'add', runId: 'm-1764230400000' });
  assert.equal(state.runHistory.length, 2, 'input untouched');
  assert.deepEqual(Store.migrateWithReport(result.state).warnings, [], 'result is a clean v2 state');

  const undone = Store.applyUndo(result.state, result.undo);
  assert.equal(undone.ok, true);
  assert.deepEqual(undone.state, state);

  assert.equal(Store.addRun(state, { date: '2026-11-20', distance: 5, time: '25:00' }, { today: TODAY, nowMs: 1732400000000 }).run.id, 'm-1732400000001');
  assert.equal(Store.addRun(state, { date: '2026-11-20', distance: 5, time: '25:00' }, { today: TODAY, id: 'm-custom' }).run.id, 'm-custom');
  assert.match(Store.addRun(state, { date: '2026-11-20', distance: 5, time: '25:00' }, TODAY).run.id, /^m-\d+$/);

  const twin = Store.addRun(state, { date: '2026-11-24', distance: 5.05, time: '21:30' }, { today: TODAY, nowMs: 1 });
  assert.equal(twin.ok, true);
  assert.equal(twin.duplicateOf, 'm-1732400000000', 'warns, does not block');

  const bad = Store.addRun(state, { date: '2026-11-28', distance: 5, time: '25:00' }, { today: TODAY, nowMs: 1 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, ['date-future']);
  assert.equal(bad.state, state, 'failure returns the same state');
  assert.equal(bad.undo, null);
  assert.equal(Store.addRun(null, { date: TODAY, distance: 5, movingSeconds: 1500 }, { today: TODAY, nowMs: 5 }).state.runHistory.length, 1);
});

test('updateRun edits allowed fields and keeps identity', () => {
  const state = deepFreeze(Store.migrate(ownerLegacy()));
  const result = Store.updateRun(state, 'm-1732400000000', { effort: 7, note: ' Vítr ', time: '20:59' }, { today: TODAY });
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { id: 'm-1732400000000', source: 'manual', date: '2026-11-24', startTime: null, type: 'run', distance: 5, movingSeconds: 1259, effort: 7, note: 'Vítr' });
  assert.deepEqual(result.undo, { op: 'update', before: state.runHistory[1] });
  assert.deepEqual(Store.applyUndo(result.state, result.undo).state, state);

  const strava = Store.updateRun(state, 'strava-123', { type: 'long', effort: 6 }, TODAY);
  assert.deepEqual(strava.run, Object.assign({}, OWNER_V2.runHistory[0], { type: 'long', effort: 6 }));
  const unnamed = Store.updateRun(state, 'strava-123', { name: '' }, TODAY);
  assert.ok(!('name' in unnamed.run));
  assert.equal(unnamed.run.stravaActivityId, '123');

  const moved = Store.updateRun(state, 'strava-123', { date: '2026-11-25' }, TODAY);
  assert.deepEqual(moved.state.runHistory.map(r => r.id), ['m-1732400000000', 'strava-123'], 'resorted');

  assert.deepEqual(Store.updateRun(state, 'nope', { effort: 5 }, TODAY).errors, ['run-not-found']);
  assert.deepEqual(Store.updateRun(state, 'm-1732400000000', { distance: 0 }, TODAY).errors, ['distance-range']);
  assert.deepEqual(Store.updateRun(state, 'm-1732400000000', null, TODAY).errors, ['input-invalid']);
  assert.deepEqual(Store.updateRun(state, 'm-1732400000000', { date: '2026-11-28' }, TODAY).errors, ['date-future']);
  assert.deepEqual(Store.updateRun(state, 'm-1732400000000', { date: '2026-11-20' }).errors, ['today-invalid']);
  assert.equal(Store.updateRun(state, 'm-1732400000000', { note: 'x' }).ok, true, 'today only needed when the date changes');

  // A synced run dated after "today" (time zone edge) can still be edited without moving it.
  const ahead = Store.migrate({ schemaVersion: 2, runHistory: [{ id: 'strava-9', date: '2026-11-28', startTime: '00:20', distance: 5, movingSeconds: 1500 }] });
  assert.equal(Store.updateRun(ahead, 'strava-9', { effort: 4 }, TODAY).ok, true);
});

test('deleteRun removes a run and undo puts it back', () => {
  const state = deepFreeze(Store.migrate(ownerLegacy()));
  const result = Store.deleteRun(state, 'strava-123');
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.runHistory.map(r => r.id), ['m-1732400000000']);
  assert.deepEqual(result.state.ignoredStravaIds, ['123'], 'a deleted Strava run is not re-imported');
  assert.deepEqual(result.undo, { op: 'delete', run: state.runHistory[0], index: 0, ignoredBefore: [] });
  const manualOnly = Store.deleteRun(state, 'm-1732400000000');
  assert.deepEqual(manualOnly.undo, { op: 'delete', run: state.runHistory[1], index: 1 });
  assert.deepEqual(manualOnly.state.ignoredStravaIds, []);
  const back = Store.applyUndo(result.state, result.undo);
  assert.deepEqual(back.state, state);
  assert.deepEqual(Store.applyUndo(back.state, result.undo).state.runHistory.length, 2, 'undo twice does not duplicate');
  assert.deepEqual(Store.deleteRun(state, 'missing').errors, ['run-not-found']);
  assert.deepEqual(Store.applyUndo(state, null).errors, ['undo-invalid']);
  assert.deepEqual(Store.applyUndo(state, { op: 'explode' }).errors, ['undo-invalid']);
});

test('upsertRecovery: one log per day, filled in over several taps', () => {
  const state = deepFreeze(Store.migrate(ownerLegacy()));
  const first = Store.upsertRecovery(state, { date: TODAY, sleepHours: '7,5', fatigue: 3 }, { today: TODAY });
  assert.equal(first.ok, true);
  assert.deepEqual(first.log, { date: TODAY, sleepHours: 7.5, fatigue: 3, soreness: null, note: '' });
  assert.deepEqual(first.undo, { op: 'recovery', date: TODAY, before: null });
  const second = Store.upsertRecovery(first.state, { date: TODAY, soreness: 2 }, TODAY);
  assert.deepEqual(second.log, { date: TODAY, sleepHours: 7.5, fatigue: 3, soreness: 2, note: '' });
  assert.equal(second.state.recoveryLogs.length, 2);
  const cleared = Store.upsertRecovery(second.state, { date: TODAY, sleepHours: null, note: ' Těžké nohy ' }, TODAY);
  assert.deepEqual(cleared.log, { date: TODAY, sleepHours: null, fatigue: 3, soreness: 2, note: 'Těžké nohy' });
  assert.deepEqual(Store.applyUndo(cleared.state, cleared.undo).state.recoveryLogs, second.state.recoveryLogs);
  assert.deepEqual(Store.applyUndo(first.state, first.undo).state.recoveryLogs, state.recoveryLogs);

  const edit = Store.upsertRecovery(state, { date: '2026-11-26', fatigue: 8 }, TODAY);
  assert.deepEqual(edit.log, { date: '2026-11-26', sleepHours: 7.2, fatigue: 8, soreness: 2, note: '' });
  assert.equal(edit.state.recoveryLogs.length, 1);

  const errors = log => Store.upsertRecovery(state, Object.assign({ date: '2026-11-25' }, log), TODAY).errors;
  assert.deepEqual(errors({ sleepHours: 25 }), ['sleep-invalid']);
  assert.deepEqual(errors({ sleepHours: -1 }), ['sleep-invalid']);
  assert.deepEqual(errors({ fatigue: 0 }), ['fatigue-invalid']);
  assert.deepEqual(errors({ fatigue: 3.5 }), ['fatigue-invalid']);
  assert.deepEqual(errors({ soreness: 11 }), ['soreness-invalid']);
  assert.deepEqual(errors({ soreness: 0 }), []);
  assert.deepEqual(errors({ note: 'n'.repeat(1001) }), ['note-too-long']);
  assert.deepEqual(errors({ note: 1 }), ['note-invalid']);
  assert.deepEqual(errors({}), ['recovery-empty']);
  assert.deepEqual(errors({ date: '2026-11-28', fatigue: 3 }), ['date-future']);
  assert.deepEqual(errors({ date: 'x', fatigue: 3 }), ['date-invalid']);
  assert.deepEqual(errors({ date: undefined, fatigue: 3 }), ['date-required']);
  assert.deepEqual(Store.upsertRecovery(state, null).errors, ['input-invalid']);

  const removed = Store.deleteRecovery(state, '2026-11-26');
  assert.deepEqual(removed.state.recoveryLogs, []);
  assert.deepEqual(Store.applyUndo(removed.state, removed.undo).state.recoveryLogs, state.recoveryLogs);
  assert.deepEqual(Store.deleteRecovery(state, '2026-01-01').errors, ['recovery-not-found']);
});

test('setProfile validates every field and is all-or-nothing', () => {
  const state = deepFreeze(Store.migrate(ownerLegacy()));
  const result = Store.setProfile(state, { name: '  Pepa ', goalDistanceKm: '10', targetSeconds: '45:00', days: [6, 1, 1], onboarded: true, unknown: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile, { name: 'Pepa', goalDistanceKm: 10, targetSeconds: 2700, days: [1, 6], onboarded: true });
  assert.deepEqual(result.undo, { op: 'profile', before: state.profile });
  assert.deepEqual(Store.applyUndo(result.state, result.undo).state, state);
  assert.equal(Store.setProfile(state, { targetSeconds: '19:59' }).profile.targetSeconds, 1199);
  assert.equal(Store.setProfile(state, { targetSeconds: '1:30:00' }).profile.targetSeconds, 5400);
  assert.equal(Store.setProfile(state, { targetSeconds: null }).profile.targetSeconds, null);
  assert.equal(Store.setProfile(state, { targetSeconds: '' }).profile.targetSeconds, null);
  assert.equal(Store.setProfile(state, { goalDistanceKm: '21,1' }).profile.goalDistanceKm, 21.1);
  assert.equal(Store.setProfile(state, { name: 'Žluťoučký kůň úpěl ďábelské ódy' }).ok, true);
  assert.equal(Store.setProfile(state, { name: 'Č'.repeat(40) }).ok, true);
  assert.equal(Store.setProfile(state, { name: '🏃'.repeat(40) }).ok, true);
  assert.equal(Store.setProfile(state, { days: [0, 1, 2, 3, 4, 5, 6] }).ok, true);

  const errors = patch => Store.setProfile(state, patch).errors;
  assert.deepEqual(errors({ name: 'Č'.repeat(41) }), ['name-too-long']);
  assert.deepEqual(errors({ name: 5 }), ['name-invalid']);
  for (const goal of [0.5, 101, 'abc', null]) assert.deepEqual(errors({ goalDistanceKm: goal }), ['goal-distance-invalid'], String(goal));
  for (const target of [59, 172801, 'abc', '61:61']) assert.deepEqual(errors({ targetSeconds: target }), ['target-invalid'], String(target));
  for (const days of [[], [7], [-1], [1.5], 'x', null]) assert.deepEqual(errors({ days }), ['days-invalid'], JSON.stringify(days));
  assert.deepEqual(errors({ onboarded: 'yes' }), ['onboarded-invalid']);
  assert.deepEqual(Store.setProfile(state, 'x').errors, ['input-invalid']);

  const partial = Store.setProfile(state, { name: 'Anna', days: [] });
  assert.equal(partial.ok, false);
  assert.equal(partial.state, state);
  assert.equal(partial.state.profile.name, '');
});

// ---------------------------------------------------------------- texts

test('MESSAGES register into VeyvoI18n with complete Czech and English texts', () => {
  I18n.register('store', Store.MESSAGES);
  const report = I18n.audit('store');
  assert.deepEqual(report.missing, { cs: [], en: [] });
  assert.deepEqual(report.incompletePlurals, []);
  assert.deepEqual(report.placeholderMismatch, []);

  assert.equal(I18n.t('store.notice.runsDropped', { n: 1 }, 'cs'), '1 běh se nepodařilo načíst.');
  assert.equal(I18n.t('store.notice.runsDropped', { n: 2 }, 'cs'), '2 běhy se nepodařilo načíst.');
  assert.equal(I18n.t('store.notice.runsDropped', { n: 5 }, 'cs'), '5 běhů se nepodařilo načíst.');
  assert.equal(I18n.t('store.notice.runsDropped', { n: 1 }, 'en'), '1 run could not be loaded.');
  assert.equal(I18n.t('store.notice.runsDropped', { n: 3 }, 'en'), '3 runs could not be loaded.');
  assert.equal(I18n.t('store.notice.runsAdded', { n: 1 }, 'cs'), 'Přidán 1 běh.');
  assert.equal(I18n.t('store.notice.runsAdded', { n: 4 }, 'cs'), 'Přidány 4 běhy.');
  assert.equal(I18n.t('store.notice.runsAdded', { n: 12 }, 'cs'), 'Přidáno 12 běhů.');
  assert.equal(I18n.t('store.notice.runsUpdated', { n: 2 }, 'cs'), 'Doplněny 2 běhy.');
  assert.equal(I18n.t('store.notice.runsUnchanged', { n: 5 }, 'cs'), '5 běhů už bylo uloženo.');
  assert.equal(I18n.t('store.notice.runsUnchanged', { n: 1 }, 'en'), '1 run was already saved.');
  assert.equal(I18n.t('store.error.date-future', null, 'cs'), 'Datum nemůže být v budoucnosti.');
  assert.equal(I18n.t('store.error.distance-invalid', null, 'en'), 'Enter the distance as a number, e.g. 5.2.');

  const produced = [
    'input-invalid', 'today-invalid', 'date-required', 'date-invalid', 'date-future', 'start-time-invalid', 'type-invalid',
    'distance-required', 'distance-invalid', 'distance-range', 'duration-required', 'duration-invalid', 'duration-range',
    'effort-invalid', 'note-invalid', 'note-too-long', 'run-name-invalid', 'run-name-too-long', 'run-not-found',
    'name-invalid', 'name-too-long', 'goal-distance-invalid', 'target-invalid', 'days-invalid', 'onboarded-invalid',
    'sleep-invalid', 'fatigue-invalid', 'soreness-invalid', 'recovery-empty', 'recovery-not-found', 'undo-invalid',
    'state-invalid', 'serialize-failed', 'storage-full', 'storage-write-failed', 'backup-invalid',
    'not-text', 'empty', 'too-large', 'json-invalid', 'not-backup', 'wrong-app', 'wrong-kind', 'schema-invalid', 'schema-newer'
  ];
  for (const code of produced) {
    for (const locale of ['cs', 'en']) {
      assert.equal(typeof Store.MESSAGES[locale].error[code], 'string', locale + ' ' + code);
      assert.ok(I18n.has('store.error.' + code, locale));
    }
  }
});

test('works as a classic browser script: VeyvoStore global, texts registered into VeyvoI18n', () => {
  const context = vm.createContext({});
  for (const file of ['format.js', 'i18n.js', 'store.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', file), 'utf8');
    assert.doesNotMatch(source, /^\s*(import|export)\s/m, file + ' must stay a classic script');
    vm.runInContext(source, context, { filename: file });
  }
  const result = vm.runInContext(`({
    hasStore: typeof VeyvoStore === 'object',
    owner: VeyvoStore.migrate(${JSON.stringify(ownerLegacy())}),
    text: VeyvoI18n.t('store.notice.runsDropped', { n: 2 }, 'cs'),
    textEn: VeyvoI18n.t('store.error.schema-newer', null, 'en')
  })`, context);
  assert.equal(result.hasStore, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.owner)), OWNER_V2);
  assert.equal(result.text, '2 běhy se nepodařilo načíst.');
  assert.equal(result.textEn, 'This backup comes from a newer VEYVO. Update the app first.');
});

// ---------------------------------------------------------------- realistic 0.3.x localStorage -> v2 -> VeyvoRuns

/**
 * What a 0.3.x desktop install really holds in localStorage['veyvo-state']: Czech type labels, manual
 * dates 'YYYY-MM-DDT00:00:00', Strava start_date_local with a fake 'Z', legacy time strings, numeric
 * ids, a late-evening Strava run the 0.3 importer failed to match to its manual twin (new Date() put it
 * on the next day), the same Strava activity stored twice, and broken entries.
 */
function realisticLegacyRaw() {
  const manual = (id, date, type, distance, time, movingSeconds, effort, note) =>
    ({ id, source: 'manual', date: date + 'T00:00:00', type, distance, time, movingSeconds, effort, effortRecorded: true, note: note || '' });
  const strava = (id, date, type, distance, movingSeconds, extra) => Object.assign({
    id: 'strava-' + id, stravaActivityId: id, source: 'strava', date, type, name: 'Ranní běh', distance,
    time: null, movingSeconds, effort: null, effortRecorded: false, note: '', averageHeartrate: 151.4, elevationGain: 22
  }, extra || {});
  return JSON.stringify({
    profile: { goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6] },
    runHistory: [
      manual(1761580800000, '2026-10-27', 'Lehký běh', 5.2, '30:30', 1830, 4),
      manual(1761926400000, '2026-10-31', 'Intervaly', 6, '31:30', 1890, 8, '6x400'),
      strava('16030001', '2026-11-03T07:15:00Z', 'Dlouhý běh', 10.4, 3650),
      manual(1762473600000, '2026-11-07', 'Tempo', 7, '36:20', 2180, 7),
      manual(1762732800000, '2026-11-10', 'Test 5 km', 5, '21:30', 1290, 9, 'první test'),
      manual(1763078400000, '2026-11-14', 'Lehký běh', 6.1, '35:40', 2140, 4),
      manual(1763337600000, '2026-11-17', 'Intervaly', 6.5, '33:30', 2010, 8),
      manual(1763683200000, '2026-11-21', 'Dlouhý běh', 12, '1:09:40', 4180, 6, 'kopce'),
      // the same 12 km on Strava at 23:40 local: |delta km| 0.04, |delta s| 25 -> one activity
      strava('16030002', '2026-11-21T23:40:00Z', 'Běh', 12.04, 4155, { name: 'Noční dlouhý běh', averageHeartrate: 148 }),
      manual(1764028800000, '2026-11-24', 'Běh', 5, '21:02', 1262, 9),
      // corrupted / incomplete entries a 0.3 bug or a manual edit left behind
      null,
      'Běh 5 km',
      { id: 1764100000000, source: 'manual', date: 'Invalid Date', type: 'Běh', distance: 5, time: '25:00' },
      { id: 1764100000001, source: 'manual', date: '2026-11-25T00:00:00', type: 'Běh', distance: '', time: '' },
      // the same Strava activity imported twice (identical content)
      strava('16030001', '2026-11-03T07:15:00Z', 'Dlouhý běh', 10.4, 3650)
    ],
    milestones: [{ date: '2026-10-27', label: 'Začátek přípravy na 5 km pod 20 minut' }],
    recoveryLogs: [{ date: '2026-11-25', sleepHours: 7.5, fatigue: 5, soreness: 3, note: 'lýtka' }],
    stravaActivityIds: ['16030001', '16030002', '15999999'],
    theme: 'dark',
    language: 'cs',
    stravaConnected: true,
    stravaLastSync: '2026-11-26T18:02:11.000Z',
    sharedChatUrl: ''
  });
}

test('realistic 0.3.x localStorage: migrate -> VeyvoRuns gives the owner totals, best 5 km and plan', () => {
  const Format = require('../src/core/format.js');
  I18n.register('store', Store.MESSAGES); // (also done by an earlier test; keeps this one self-contained)
  const raw = realisticLegacyRaw();
  const storage = memoryStorage({ 'veyvo-state': raw });
  const loaded = Store.load(storage, { now: '2026-11-26T20:00:00' });
  const state = loaded.state;
  assert.equal(loaded.fromVersion, 1);
  assert.equal(loaded.recoveredFromCorruption, false);
  assert.equal(loaded.backupKey, 'veyvo-state-backup-v1');
  assert.equal(storage.map.get('veyvo-state-backup-v1'), raw, 'the untouched 0.3 data is kept');
  assert.equal(loaded.needsSave, true);

  // Every dropped or merged record is reported with the original attached.
  const w = loaded.warnings;
  assert.equal(count(w, 'run-dropped'), 4);
  assert.deepEqual(w.filter(x => x.code === 'run-dropped').map(x => x.reason), ['not-object', 'not-object', 'date-invalid', 'distance-invalid']);
  assert.equal(count(w, 'run-duplicate-dropped'), 1);
  const twins = w.filter(x => x.code === 'run-twins-merged');
  assert.equal(twins.length, 1);
  assert.equal(twins[0].manualId, 'm-1763683200000');
  assert.equal(twins[0].stravaId, 'strava-16030002');
  assert.equal(twins[0].manual.note, 'kopce');
  assert.deepEqual(w.find(x => x.code === 'strava-ids-orphaned').ids, ['15999999']);
  assert.equal(I18n.t('store.notice.runsMerged', { n: twins.length }, 'cs'), '1 běh ze Stravy byl spojen s ručním zápisem.');
  assert.equal(I18n.t('store.notice.runsMerged', { n: 3 }, 'cs'), '3 běhy ze Stravy byly spojeny s ručními zápisy.');
  assert.equal(I18n.t('store.notice.runsMerged', { n: 5 }, 'cs'), '5 běhů ze Stravy bylo spojeno s ručními zápisy.');
  assert.equal(I18n.t('store.notice.runsMerged', { n: 2 }, 'en'), '2 Strava runs were merged with their manual entries.');

  // Calendar dates come from the strings, never from new Date(): no time zone shift.
  const runs = state.runHistory;
  assert.equal(runs.length, 9);
  assert.deepEqual(runs.map(r => r.date), ['2026-10-27', '2026-10-31', '2026-11-03', '2026-11-07', '2026-11-10', '2026-11-14', '2026-11-17', '2026-11-21', '2026-11-24']);
  assert.deepEqual(runs.map(r => r.type), ['easy', 'intervals', 'long', 'tempo', 'test5k', 'easy', 'intervals', 'long', 'run']);
  assert.ok(runs.every(r => !('time' in r) && !('effortRecorded' in r)));
  const strava3 = runs[2];
  assert.equal(strava3.id, 'strava-16030001');
  assert.equal(strava3.startTime, '07:15');
  // The merged twin: Strava identity + start time; the owner's type, distance, typed time, effort and note
  // (Strava's moving time stays available as stravaMovingSeconds).
  const long = runs[7];
  assert.deepEqual(
    { id: long.id, source: long.source, startTime: long.startTime, type: long.type, distance: long.distance, movingSeconds: long.movingSeconds,
      stravaMovingSeconds: long.stravaMovingSeconds, effort: long.effort, note: long.note, name: long.name, averageHeartrate: long.averageHeartrate,
      stravaActivityId: long.stravaActivityId },
    { id: 'strava-16030002', source: 'strava', startTime: '23:40', type: 'long', distance: 12, movingSeconds: 4180, stravaMovingSeconds: 4155,
      effort: 6, note: 'kopce', name: 'Noční dlouhý běh', averageHeartrate: 148, stravaActivityId: '16030002' });
  assert.deepEqual(Store.stravaActivityIds(state), ['16030001', '16030002']);
  assert.deepEqual(state.profile, { name: '', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true });
  assert.deepEqual(state.legacyMilestones, [{ date: '2026-10-27', label: 'Začátek přípravy na 5 km pod 20 minut' }]);
  assert.deepEqual(state.strava, { connected: true, lastSync: '2026-11-26T18:02:11.000Z', lastError: null });

  // VeyvoRuns on the migrated data: nothing counted twice.
  const TODAY = '2026-11-26';
  const totals = Runs.totals(runs);
  assert.equal(totals.count, 9);
  assert.equal(totals.distanceKm, 63.2);
  assert.equal(Format.km(totals.distanceKm, 'cs'), '63,2');
  assert.equal(Format.km(totals.distanceKm, 'en'), '63.2');
  assert.equal(I18n.t('common.count.runs', { n: totals.count }, 'cs'), '9 běhů');
  assert.deepEqual(Runs.weeklyTotals(runs, TODAY, 5).map(x => x.distanceKm), [11.2, 17.4, 11.1, 18.5, 5]);
  assert.equal(Runs.lastNDays(runs, TODAY, 7).distanceKm, 17);
  const best = Runs.bestEffort(runs);
  assert.equal(best.id, 'm-1764028800000');
  assert.equal(Format.duration(best.movingSeconds), '21:02');
  assert.deepEqual(Runs.fiveKProgression(runs).map(p => [p.date, p.seconds, p.isPersonalBest]), [['2026-11-10', 1290, true], ['2026-11-24', 1262, true]]);
  const goal = Runs.goalProgress(state.profile, runs);
  assert.equal(goal.best, 1262);
  assert.equal(goal.gapSeconds, 62);
  assert.equal(goal.improvementSeconds, 28);
  assert.equal(goal.improvementDays, 14);
  assert.deepEqual(goal.checkpoints.map(c => c.seconds), [1260, 1230, 1200]);
  const records = Runs.records(runs);
  assert.equal(records.longestRun.value, 12);
  assert.equal(records.longestRun.runId, 'strava-16030002');
  assert.equal(records.biggestWeek.weekStart, '2026-11-16');
  assert.equal(records.biggestWeek.value, 18.5);
  assert.equal(Runs.currentStreakWeeks(runs, TODAY, state.profile), 4);
  const strip = Runs.weekStrip(runs, { todayKey: TODAY, profile: state.profile });
  assert.deepEqual(strip.map(d => d.status), ['rest', 'done', 'rest', 'rest', 'rest', 'rest', 'available']);
  assert.equal(strip[3].isToday, true, 'Thursday is today and a rest day');

  // VeyvoTraining still plans from the migrated codes (24.11. effort 9 -> Sunday 29.11.).
  const latest = Runs.sortRuns(runs).at(-1);
  const baseline = runs.find(r => r.type === 'test5k');
  const next = Training.nextRunAfterRun(latest, state.profile.days, TODAY, baseline);
  assert.equal(next.kind, 'easy');
  assert.equal(next.date, '2026-11-29');
  assert.equal(Training.normalizeRuns(runs, new Date(2026, 10, 26, 20)).length, 9);

  // Saving and loading again is stable: no warnings, nothing merged twice.
  assert.equal(Store.save(storage, state).ok, true);
  const again = Store.load(storage);
  assert.equal(again.fromVersion, 2);
  assert.deepEqual(again.warnings, []);
  assert.deepEqual(again.state, state);
  assert.deepEqual(Store.migrate(state), state);
});

test('legacy twin merge: only manual + Strava pairs, closest wins, v2 states are left alone', () => {
  const m = (id, distance, movingSeconds, extra) => Object.assign({ id, source: 'manual', date: '2026-11-21T00:00:00', type: 'Běh', distance, movingSeconds }, extra || {});
  const s = (id, distance, movingSeconds, extra) => Object.assign({ id: 'strava-' + id, stravaActivityId: id, source: 'strava', date: '2026-11-21T18:00:00Z', type: 'Běh', distance, movingSeconds }, extra || {});
  // two manual lookalikes: the closer one is merged, the other stays
  let state = Store.migrate({ runHistory: [m(1, 5, 1500), m(2, 5.05, 1520), s('9', 5.04, 1518)] });
  assert.deepEqual(state.runHistory.map(r => r.id), ['m-1', 'strava-9']);
  // two Strava activities never merge with each other, and one manual twin absorbs only one of them
  state = Store.migrate({ runHistory: [s('8', 5, 1500), s('9', 5.01, 1502), m(1, 5, 1501)] });
  assert.equal(state.runHistory.length, 2);
  assert.deepEqual(state.runHistory.map(r => r.source), ['strava', 'strava']);
  // outside the thresholds (|delta s| >= 90) both stay
  assert.equal(Store.migrate({ runHistory: [m(1, 5, 1500), s('9', 5, 1590)] }).runHistory.length, 2);
  // a different day never merges
  assert.equal(Store.migrate({ runHistory: [m(1, 5, 1500), s('9', 5, 1500, { date: '2026-11-22T07:00:00Z' })] }).runHistory.length, 2);
  // v2 data keeps deliberate lookalikes (the UI warns with duplicateOf instead)
  const v2 = Store.migrate({ schemaVersion: 2, runHistory: [m(1, 5, 1500), s('9', 5.01, 1505)] });
  assert.equal(v2.runHistory.length, 2);
});

// ---------------------------------------------------------------- 0.4 UI additions: manual time wins, ignored Strava ids, planned sessions, export log

test('manual + Strava twin: the typed time and distance win, Strava time kept as stravaMovingSeconds, stable on re-sync', () => {
  const merged = Store.mergeRuns([MANUAL], [STRAVA]).runs[0];
  assert.equal(merged.movingSeconds, 1262);
  assert.equal(merged.distance, 5);
  assert.equal(merged.stravaMovingSeconds, 1290);
  // The next sync brings the same Strava copy again: nothing changes.
  const resync = Store.mergeRuns([merged], [STRAVA]);
  assert.deepEqual([resync.added, resync.updated, resync.unchanged], [0, 0, 1]);
  assert.deepEqual(resync.runs, [merged]);
  // A second manual copy of an already merged run keeps the typed time and the original Strava time.
  const again = Store.mergeRuns([merged], [Object.assign({}, MANUAL, { id: 'm-2', movingSeconds: 1265 })]).runs[0];
  assert.equal(again.stravaMovingSeconds, 1290);
  // stravaMovingSeconds is validated like movingSeconds and survives migration.
  const migrated = Store.migrate({ schemaVersion: 2, runHistory: [merged, Object.assign({}, STRAVA, { id: 'strava-1', stravaActivityId: '1', date: '2026-11-01', stravaMovingSeconds: 'abc' })] });
  assert.equal(migrated.runHistory.find(r => r.id === 'strava-555').stravaMovingSeconds, 1290);
  assert.equal('stravaMovingSeconds' in migrated.runHistory.find(r => r.id === 'strava-1'), false);
  assert.equal(count(Store.migrateWithReport({ schemaVersion: 2, runHistory: [Object.assign({}, STRAVA, { stravaMovingSeconds: -4 })] }).warnings, 'run-field-invalid'), 1);
});

test('ignoredStravaIds: normalized, filled by deleteRun, honoured by importStravaRuns, restorable', () => {
  const report = Store.migrateWithReport({ schemaVersion: 2, ignoredStravaIds: ['9', 9, ' 10 ', '', null, 'bad id!', '11'] });
  assert.deepEqual(report.state.ignoredStravaIds, ['9', '10', '11']);
  assert.equal(count(report.warnings, 'ignored-id-dropped'), 3);
  assert.deepEqual(Store.migrateWithReport({ ignoredStravaIds: 'x' }).warnings.map(w => w.code), ['list-invalid']);

  const state = deepFreeze(Store.migrate({ schemaVersion: 2, runHistory: [STRAVA, MANUAL_OTHER_DAY()] }));
  const deleted = Store.deleteRun(state, 'strava-555');
  assert.deepEqual(deleted.state.ignoredStravaIds, ['555']);
  // The next sync returns the deleted activity and a new one: only the new one is imported.
  const fresh = { id: 'strava-777', source: 'strava', stravaActivityId: '777', date: '2026-11-26', startTime: '18:00', type: 'run', distance: 6, movingSeconds: 1900 };
  const imported = Store.importStravaRuns(deleted.state, [STRAVA, fresh]);
  assert.equal(imported.ok, true);
  assert.deepEqual([imported.added, imported.updated, imported.unchanged, imported.ignored], [1, 0, 0, 1]);
  assert.deepEqual(imported.state.runHistory.map(r => r.id), ['m-9', 'strava-777']);
  // Nothing new: the same state object comes back.
  const idle = Store.importStravaRuns(imported.state, [fresh]);
  assert.equal(idle.state, imported.state);
  assert.equal(idle.unchanged, 1);
  // Undo of the delete restores the run and the old ignore list.
  const back = Store.applyUndo(deleted.state, deleted.undo).state;
  assert.deepEqual(back.ignoredStravaIds, []);
  assert.deepEqual(back.runHistory.map(r => r.id), state.runHistory.map(r => r.id));
  // restoreIgnoredStrava: some or all ids, with undo.
  const two = Store.migrate({ schemaVersion: 2, ignoredStravaIds: ['1', '2', '3'] });
  const some = Store.restoreIgnoredStrava(two, ['2', 'nope!']);
  assert.deepEqual([some.state.ignoredStravaIds, some.removed], [['1', '3'], 1]);
  const all = Store.restoreIgnoredStrava(two);
  assert.deepEqual([all.state.ignoredStravaIds, all.removed], [[], 3]);
  assert.deepEqual(Store.applyUndo(all.state, all.undo).state.ignoredStravaIds, ['1', '2', '3']);
});

function MANUAL_OTHER_DAY() {
  return { id: 'm-9', source: 'manual', date: '2026-11-20', type: 'easy', distance: 6, movingSeconds: 2100 };
}

test('plannedWorkouts: one valid library session per date, schedule/unschedule with undo', () => {
  const report = Store.migrateWithReport({ schemaVersion: 2, plannedWorkouts: [
    { date: '2026-12-01', templateId: 'intervals400' },
    { date: '2026-11-29', templateId: 'easy', note: 'kept extra' },
    { date: '2026-12-01', templateId: 'threshold' },
    { date: '2026-13-01', templateId: 'easy' },
    { date: '2026-12-03', templateId: '<script>' },
    'junk'
  ] });
  assert.deepEqual(report.state.plannedWorkouts, [
    { date: '2026-11-29', templateId: 'easy', note: 'kept extra' },
    { date: '2026-12-01', templateId: 'threshold' }
  ]);
  assert.equal(count(report.warnings, 'planned-duplicate-date'), 1);
  assert.deepEqual(report.warnings.filter(w => w.code === 'planned-dropped').map(w => w.reason), ['date-invalid', 'template-invalid', 'date-invalid']);

  const TODAY = '2026-11-27';
  const base = deepFreeze(Store.migrate({ schemaVersion: 2 }));
  const first = Store.schedulePlanned(base, { date: '2026-12-01', templateId: 'intervals400' }, { today: TODAY });
  assert.equal(first.ok, true);
  assert.deepEqual(first.state.plannedWorkouts, [{ date: '2026-12-01', templateId: 'intervals400' }]);
  const replaced = Store.schedulePlanned(first.state, { date: '2026-12-01', templateId: 'threshold' }, TODAY);
  assert.deepEqual(replaced.state.plannedWorkouts, [{ date: '2026-12-01', templateId: 'threshold' }]);
  assert.deepEqual(Store.applyUndo(replaced.state, replaced.undo).state.plannedWorkouts, first.state.plannedWorkouts);
  assert.deepEqual(Store.schedulePlanned(base, { date: '2026-11-26', templateId: 'easy' }, { today: TODAY }).errors, ['date-past']);
  assert.deepEqual(Store.schedulePlanned(base, { date: '', templateId: '' }).errors, ['date-required', 'template-invalid']);
  assert.deepEqual(Store.schedulePlanned(base, null).errors, ['input-invalid']);
  const removed = Store.unschedulePlanned(replaced.state, '2026-12-01');
  assert.deepEqual(removed.state.plannedWorkouts, []);
  assert.deepEqual(Store.applyUndo(removed.state, removed.undo).state.plannedWorkouts, replaced.state.plannedWorkouts);
  assert.deepEqual(Store.unschedulePlanned(base, '2026-12-01').errors, ['planned-not-found']);
});

test('exportLog: validated records, newest 50 kept', () => {
  const at = i => '2026-11-27T10:' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + '.000Z';
  let state = Store.migrate({ schemaVersion: 2 });
  for (let i = 0; i < 55; i++) {
    const r = Store.logExport(state, { at: at(i), workoutId: 'plan-2026-11-29', format: i % 2 ? 'fit' : 'apple' });
    assert.equal(r.ok, true);
    state = r.state;
  }
  assert.equal(state.exportLog.length, Store.EXPORT_LOG_MAX);
  assert.equal(state.exportLog[0].at, at(5));
  assert.equal(state.exportLog.at(-1).at, at(54));
  assert.deepEqual(Store.logExport(state, { at: 'yesterday', workoutId: 'x', format: 'fit' }).errors, ['export-invalid']);
  assert.deepEqual(Store.logExport(state, { at: at(1), workoutId: '', format: 'fit' }).errors, ['export-invalid']);
  assert.deepEqual(Store.logExport(state, { at: at(1), workoutId: 'x', format: 'FIT!' }).errors, ['export-invalid']);
  const report = Store.migrateWithReport({ schemaVersion: 2, exportLog: [{ at: at(1), workoutId: 'w', format: 'zwo' }, { at: 'x' }, 5] });
  assert.deepEqual(report.state.exportLog, [{ at: at(1), workoutId: 'w', format: 'zwo' }]);
  assert.equal(count(report.warnings, 'export-log-dropped'), 2);
  // Save -> load round trip keeps all three new lists.
  const storage = memoryStorage();
  const full = Object.assign({}, state, { ignoredStravaIds: ['5'], plannedWorkouts: [{ date: '2026-12-01', templateId: 'easy' }] });
  assert.equal(Store.save(storage, full).ok, true);
  const loaded = Store.load(storage);
  assert.deepEqual(loaded.warnings, []);
  assert.deepEqual(loaded.state, full);
});

test('applyBackup merge unions the ignore list, keeps current planned dates and merges the export log', () => {
  const current = Store.migrate({ schemaVersion: 2, profile: { onboarded: true }, ignoredStravaIds: ['1'],
    plannedWorkouts: [{ date: '2026-12-01', templateId: 'easy' }], exportLog: [{ at: '2026-11-20T10:00:00.000Z', workoutId: 'a', format: 'fit' }] });
  const backup = Store.migrate({ schemaVersion: 2, ignoredStravaIds: ['2', '1'],
    plannedWorkouts: [{ date: '2026-12-01', templateId: 'threshold' }, { date: '2026-12-03', templateId: 'long' }],
    exportLog: [{ at: '2026-11-19T10:00:00.000Z', workoutId: 'b', format: 'zwo' }, { at: '2026-11-20T10:00:00.000Z', workoutId: 'a', format: 'fit' }] });
  const parsed = Store.parseBackup(Store.exportBackup(backup, null, {}));
  const merged = Store.applyBackup(current, parsed, { mode: 'merge' }).state;
  assert.deepEqual(merged.ignoredStravaIds, ['1', '2']);
  assert.deepEqual(merged.plannedWorkouts, [{ date: '2026-12-01', templateId: 'easy' }, { date: '2026-12-03', templateId: 'long' }]);
  assert.deepEqual(merged.exportLog.map(e => e.workoutId), ['b', 'a']);
  const replaced = Store.applyBackup(current, parsed, { mode: 'replace' }).state;
  assert.deepEqual(replaced.ignoredStravaIds, ['2', '1']);
});

// ---------------------------------------------------------------- review fixes (0.4 release)

test('legacy stravaActivityIds without a run (wiped in 0.3) become ignoredStravaIds, so a sync does not bring them back', () => {
  const legacy = {
    runHistory: [{ id: 1, source: 'manual', date: '2026-11-24T00:00:00', type: 'Běh', distance: 5, time: '21:02' },
      { id: 'strava-200', source: 'strava', stravaActivityId: '200', date: '2026-11-25T19:30:00Z', type: 'Běh', distance: 3.2, movingSeconds: 1150 }],
    stravaActivityIds: ['16030555', '200', 16030556, 'bad id!']
  };
  const report = Store.migrateWithReport(legacy);
  assert.deepEqual(report.state.ignoredStravaIds, ['16030555', '16030556']);
  assert.ok(report.warnings.some(w => w.code === 'strava-ids-orphaned' && w.count === 2), 'the warning stays');
  const back = Store.importStravaRuns(report.state, [{ id: 'strava-16030555', source: 'strava', stravaActivityId: '16030555', date: '2026-11-20', type: 'run', distance: 4, movingSeconds: 1400 }]);
  assert.equal(back.state.runHistory.some(r => r.stravaActivityId === '16030555'), false, 'the wiped run is not re-imported');
  assert.deepEqual(Store.migrate(report.state), report.state, 'idempotent');
  // a v2 state never gains ids this way
  const v2 = Object.assign(Store.DEFAULT_STATE(), { stravaActivityIds: ['999'] });
  assert.deepEqual(Store.migrate(v2).ignoredStravaIds, []);
});

test('merging a backup keeps a deleted Strava run deleted (runs and ignore list agree)', () => {
  const s0 = Store.importStravaRuns(Store.DEFAULT_STATE(), [{ id: 'strava-777', source: 'strava', stravaActivityId: '777', date: '2026-11-20', type: 'run', distance: 4, movingSeconds: 1400 }]).state;
  const text = Store.exportBackup(s0, null, { exportedAt: '2026-11-27T10:00:00Z' });
  const deleted = Store.deleteRun(s0, 'strava-777').state;
  assert.deepEqual([deleted.runHistory.length, deleted.ignoredStravaIds], [0, ['777']]);
  const merged = Store.applyBackup(deleted, Store.parseBackup(text), { mode: 'merge' });
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.state.runHistory.map(r => r.id), [], 'the deleted run does not come back');
  assert.deepEqual(merged.state.ignoredStravaIds, ['777']);
  assert.equal(merged.stats.added, 0);
  assert.equal(merged.stats.ignored, 1);
  // the other way round: a backup that deleted a run this device still has -> the run stays, and is not ignored
  const deletedBackup = Store.exportBackup(deleted, null, { exportedAt: '2026-11-27T10:00:00Z' });
  const kept = Store.applyBackup(s0, Store.parseBackup(deletedBackup), { mode: 'merge' });
  assert.deepEqual(kept.state.runHistory.map(r => r.id), ['strava-777']);
  assert.deepEqual(kept.state.ignoredStravaIds, []);
});

test('ignoredStravaIds are deduplicated in linear time (a crafted 60 000-id backup parses quickly)', () => {
  const ids = Array.from({ length: 60000 }, (_, i) => String(1e9 + i));
  const state = Object.assign(Store.DEFAULT_STATE(), { ignoredStravaIds: ids.concat(ids.slice(-100)) });
  const text = JSON.stringify({ app: 'VEYVO', kind: 'backup', schemaVersion: 2, state });
  const started = Date.now();
  const parsed = Store.parseBackup(text);
  const ms = Date.now() - started;
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.ignoredStravaIds.length, 5000, 'capped at 5000');
  assert.equal(new Set(parsed.state.ignoredStravaIds).size, 5000, 'unique');
  assert.equal(parsed.state.ignoredStravaIds[4999], String(1e9 + 59999), 'the newest ids are kept');
  assert.ok(ms < 1500, 'parsed in ' + ms + ' ms');
  // the dedupe still keeps the first occurrence order
  assert.deepEqual(Store.migrate(Object.assign(Store.DEFAULT_STATE(), { ignoredStravaIds: ['3', '1', '3', 2, '1'] })).ignoredStravaIds, ['3', '1', '2']);
});

test('run ids named like Object.prototype keys are renamed and never crash the derived notes', () => {
  const names = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'prototype'];
  const runs = names.map((id, i) => ({ id, source: 'manual', date: '2026-11-0' + (i + 1), type: 'run', distance: 5, movingSeconds: 1500 - i * 10 }));
  const state = Store.migrate(JSON.parse(JSON.stringify(Object.assign(Store.DEFAULT_STATE(), { runHistory: runs }))));
  assert.deepEqual(state.runHistory.map(r => r.id), names.map(n => 'm-' + n));
  const text = JSON.stringify({ app: 'VEYVO', kind: 'backup', schemaVersion: 2, state: { schemaVersion: 2, runHistory: JSON.parse(JSON.stringify(runs)) } });
  const parsed = Store.parseBackup(text);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.state.runHistory.every(r => r.id.startsWith('m-')), 'backup import renames them too');
  // addRun never takes such an id either
  assert.equal(Store.addRun(Store.DEFAULT_STATE(), { date: '2026-11-01', type: 'run', distance: 5, time: '25:00' }, { today: '2026-11-27', id: 'toString' }).run.id === 'toString', false);
  // and VeyvoRuns copes with them anyway (state from an older build or another tool)
  const notes = Runs.runNotes(runs, { goalDistanceKm: 5, targetSeconds: 1200 });
  for (const id of names) assert.ok(Array.isArray(Runs.notesOf(notes, id)), id);
  assert.equal(Runs.notesOf(notes, 'toString').length > 0, true);
  assert.deepEqual(Runs.notesOf(notes, 'missing'), []);
  assert.deepEqual(Runs.notesOf({}, 'toString'), [], 'never an Object.prototype function');
  assert.ok(Runs.milestones(runs, { goalDistanceKm: 5, targetSeconds: 1200 }).length > 0);
});

test('0.3.4 shared-chat runs (source chatgpt, noon date) migrate without an invented 12:00 start time', () => {
  const legacy = {
    runHistory: [
      { id: 'chatgpt-2026-09-14-5.1-1755', source: 'chatgpt', date: '2026-09-14T12:00:00', type: 'Běh', distance: 5.1, movingSeconds: 1755 },
      { id: 'chatgpt-2026-09-16-6-2100', source: 'chatgpt', date: '2026-09-16T07:15:00', type: 'Běh', distance: 6, movingSeconds: 2100 },
      { id: 7, source: 'manual', date: '2026-09-18T12:00:00', type: 'Běh', distance: 4, movingSeconds: 1500 }
    ]
  };
  const state = Store.migrate(legacy);
  const [chat, chatTimed, manual] = state.runHistory;
  assert.deepEqual([chat.source, chat.date, chat.startTime, chat.importedFrom], ['manual', '2026-09-14', null, 'chatgpt']);
  assert.equal(chatTimed.startTime, '07:15', 'a real time from the chat is kept');
  assert.equal(manual.startTime, '12:00', 'a manual run at noon keeps its time');
  assert.equal(manual.importedFrom, undefined);
  assert.deepEqual(Store.migrate(state), state, 'idempotent');
});

test('pre-0.3.3 keys (chatHistory, weekReviews, ...) travel in backups from the raw legacy copy', () => {
  const raw = JSON.stringify({ runHistory: [], chatHistory: [{ role: 'user', text: 'ahoj' }], weekReviews: { w1: 'ok' }, aiPlans: [1], stravaActivityIds: ['1'], profile: { days: [1, 6] } });
  assert.deepEqual(Store.legacyExtras(raw), { chatHistory: [{ role: 'user', text: 'ahoj' }], weekReviews: { w1: 'ok' }, aiPlans: [1] });
  assert.equal(Store.legacyExtras(JSON.stringify({ runHistory: [], profile: {} })), null);
  assert.equal(Store.legacyExtras('{broken'), null);
  assert.equal(Store.LEGACY_BACKUP_KEY, 'veyvo-state-backup-v1');
  const text = Store.exportBackup(Store.DEFAULT_STATE(), null, { exportedAt: '2026-11-27T10:00:00Z', legacy: raw });
  const doc = JSON.parse(text);
  assert.deepEqual(Object.keys(doc.legacy).sort(), ['aiPlans', 'chatHistory', 'weekReviews']);
  const parsed = Store.parseBackup(text);
  assert.deepEqual(parsed.legacy.chatHistory, [{ role: 'user', text: 'ahoj' }]);
  // no legacy copy: no field
  assert.equal('legacy' in JSON.parse(Store.exportBackup(Store.DEFAULT_STATE(), null, {})), false);
  assert.equal(Store.parseBackup(Store.exportBackup(Store.DEFAULT_STATE(), null, {})).legacy, null);
  // __proto__ never becomes a key
  assert.equal(Object.getPrototypeOf(Store.legacyExtras('{"__proto__": {"x": 1}, "weekPlans": []}')), Object.prototype);
});

// ---------------------------------------------------------------- Apple Health import (iOS)

const HK_A = '6F1C2D3E-4A5B-4C6D-8E7F-90A1B2C3D4E5';
const HK_B = '11111111-2222-4333-8444-555555555555';
const HK_C = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
function hkRow(over) {
  return Object.assign({
    healthId: HK_A, startDate: '2026-11-24T17:31:00Z', date: '2026-11-24', startTime: '18:31',
    distanceKm: 5.0123, movingSeconds: 1262.4, averageHeartrate: 158.44, maxHeartrate: 181, sourceName: '  Cvičení  '
  }, over || {});
}

test('healthRunFrom maps one VeyvoHealth row onto a Run and refuses rows the journal cannot hold', () => {
  assert.deepEqual(Store.healthRunFrom(hkRow()), {
    id: 'health-' + HK_A, source: 'health', date: '2026-11-24', startTime: '18:31', type: 'run', distance: 5.012,
    movingSeconds: 1262, effort: null, note: '', healthId: HK_A, averageHeartrate: 158.4, maxHeartrate: 181, sourceName: 'Cvičení'
  });
  const lower = Store.healthRunFrom(hkRow({ healthId: HK_A.toLowerCase(), averageHeartrate: null, maxHeartrate: 400, sourceName: '' }));
  assert.equal(lower.healthId, HK_A, 'Swift uuidString is upper case; lower case input is accepted');
  assert.equal(lower.averageHeartrate, null);
  assert.equal('maxHeartrate' in lower, false);
  assert.equal('sourceName' in lower, false);
  assert.equal(Store.healthRunFrom(hkRow({ startTime: '25:00' })).startTime, null);
  for (const bad of [null, 'x', [], hkRow({ healthId: 'strava-1' }), hkRow({ healthId: null }), hkRow({ date: '2026-02-30' }),
    hkRow({ date: null }), hkRow({ distanceKm: null }), hkRow({ distanceKm: 0 }), hkRow({ distanceKm: 301 }),
    hkRow({ movingSeconds: 0 }), hkRow({ movingSeconds: '1262' }), hkRow({ movingSeconds: 172801 })]) {
    assert.equal(Store.healthRunFrom(bad), null, JSON.stringify(bad));
  }
});

test('importHealthRuns: first import adds runs, the next one is a no-op, health bookkeeping is stored', () => {
  const state = deepFreeze(Store.DEFAULT_STATE());
  const rows = [hkRow(), hkRow({ healthId: HK_B, date: '2026-11-26', startTime: '07:05', distanceKm: 8, movingSeconds: 2900 }), hkRow({ healthId: HK_C, distanceKm: null })];
  const first = Store.importHealthRuns(state, rows, { at: '2026-11-27T08:00:00.000Z' });
  assert.equal(first.ok, true);
  assert.deepEqual([first.added, first.updated, first.invalid, first.ignored], [2, 0, 1, 0]);
  assert.deepEqual(first.state.runHistory.map(r => r.id), ['health-' + HK_A, 'health-' + HK_B]);
  assert.deepEqual(first.state.health, { enabled: true, lastImport: '2026-11-27T08:00:00.000Z', lastError: null });
  assert.deepEqual(Store.migrate(first.state), first.state, 'the imported state is already canonical');

  const again = Store.importHealthRuns(first.state, rows, { at: '2026-11-27T09:00:00.000Z' });
  assert.deepEqual([again.added, again.updated, again.unchanged], [0, 0, 2]);
  assert.equal(again.state.runHistory, first.state.runHistory, 'runs untouched when nothing changed');
  assert.equal(again.state.health.lastImport, '2026-11-27T09:00:00.000Z');
  const noAt = Store.importHealthRuns(first.state, [], {});
  assert.equal(noAt.state.health.lastImport, '2026-11-27T08:00:00.000Z', 'no clock inside: a missing at keeps lastImport');
  assert.deepEqual(Store.importHealthRuns(state, 'junk').state.runHistory, []);
});

test('importHealthRuns: a manual twin keeps the typed time and gains start time, heart rate and the workout id', () => {
  const state = Store.migrate({ schemaVersion: 2, runHistory: [{ id: 'm-1', source: 'manual', date: '2026-11-24', type: 'test5k', distance: 5, movingSeconds: 1250, effort: 9, note: 'PB' }] });
  const r = Store.importHealthRuns(state, [hkRow()], { at: '2026-11-27T08:00:00.000Z' });
  assert.deepEqual([r.added, r.updated], [0, 1]);
  assert.deepEqual(r.state.runHistory, [{
    id: 'm-1', source: 'manual', date: '2026-11-24', startTime: '18:31', type: 'test5k', distance: 5, movingSeconds: 1250, effort: 9, note: 'PB',
    healthId: HK_A, averageHeartrate: 158.4, maxHeartrate: 181, sourceName: 'Cvičení'
  }]);
  const again = Store.importHealthRuns(r.state, [hkRow()], { at: '2026-11-28T08:00:00.000Z' });
  assert.deepEqual([again.added, again.updated, again.unchanged], [0, 0, 1], 'matched by the workout id from then on');

  // A Strava run of the same activity keeps its id and Strava fields, the Health copy only fills blanks.
  const strava = Store.migrate({ schemaVersion: 2, runHistory: [{ id: 'strava-77', source: 'strava', stravaActivityId: '77', date: '2026-11-24', startTime: '18:30', distance: 5.01, movingSeconds: 1270, name: 'Evening Run', averageHeartrate: 157 }] });
  const s = Store.importHealthRuns(strava, [hkRow()], { at: '2026-11-27T08:00:00.000Z' });
  assert.equal(s.updated, 1);
  assert.equal(s.state.runHistory.length, 1);
  assert.equal(s.state.runHistory[0].id, 'strava-77');
  assert.equal(s.state.runHistory[0].startTime, '18:30');
  assert.equal(s.state.runHistory[0].averageHeartrate, 157);
  assert.equal(s.state.runHistory[0].healthId, HK_A);
});

test('importHealthRuns: two apps writing one run give one record; two runs on one day stay two', () => {
  const twin = hkRow({ healthId: HK_B, startTime: '18:35', distanceKm: 5.05, movingSeconds: 1280, averageHeartrate: null, maxHeartrate: null, sourceName: 'Garmin Connect' });
  const r = Store.importHealthRuns(Store.DEFAULT_STATE(), [hkRow({ averageHeartrate: null }), twin], { at: '2026-11-27T08:00:00.000Z' });
  assert.deepEqual([r.added, r.twins], [1, 1]);
  assert.equal(r.state.runHistory[0].healthId, HK_A);
  const later = hkRow({ healthId: HK_B, startTime: '20:40' });
  const two = Store.importHealthRuns(Store.DEFAULT_STATE(), [hkRow(), later], { at: '2026-11-27T08:00:00.000Z' });
  assert.equal(two.added, 2, 'starts 2 h apart: two runs');
  const far = hkRow({ healthId: HK_B, startTime: '18:45' });
  assert.equal(Store.importHealthRuns(Store.DEFAULT_STATE(), [hkRow(), far], {}).added, 2, 'two Health workouts more than 10 min apart are not twins');
  assert.equal(Store.isDuplicateRun(Store.healthRunFrom(hkRow()), Store.healthRunFrom(far)), false);
  assert.equal(Store.isDuplicateRun(Store.healthRunFrom(hkRow()), Store.healthRunFrom(twin)), true);
});

test('deleting a Health run keeps it deleted; undo and restoreIgnoredHealth bring it back', () => {
  const imported = Store.importHealthRuns(Store.DEFAULT_STATE(), [hkRow()], { at: '2026-11-27T08:00:00.000Z' }).state;
  const del = Store.deleteRun(imported, 'health-' + HK_A);
  assert.equal(del.ok, true);
  assert.deepEqual(del.state.ignoredHealthIds, [HK_A]);
  assert.deepEqual(del.undo.ignoredHealthBefore, []);
  assert.equal(del.undo.ignoredBefore, undefined, 'no Strava id, no Strava bookkeeping');
  const re = Store.importHealthRuns(del.state, [hkRow()], { at: '2026-11-28T08:00:00.000Z' });
  assert.deepEqual([re.added, re.ignored], [0, 1]);
  assert.deepEqual(re.state.runHistory, []);

  const undone = Store.applyUndo(del.state, del.undo);
  assert.deepEqual(undone.state.ignoredHealthIds, []);
  assert.equal(undone.state.runHistory.length, 1);

  // a manual run that absorbed its Health copy is also never re-imported after a delete
  const manual = Store.migrate({ schemaVersion: 2, runHistory: [{ id: 'm-1', source: 'manual', date: '2026-11-24', distance: 5, movingSeconds: 1250, healthId: HK_A.toLowerCase() }] });
  assert.deepEqual(Store.deleteRun(manual, 'm-1').state.ignoredHealthIds, [HK_A]);

  const restored = Store.restoreIgnoredHealth(del.state);
  assert.equal(restored.removed, 1);
  assert.deepEqual(restored.state.ignoredHealthIds, []);
  assert.equal(restored.state.health.lastImport, null, 'the next import reads 90 days again');
  const back = Store.applyUndo(restored.state, restored.undo);
  assert.deepEqual(back.state.ignoredHealthIds, [HK_A]);
  assert.equal(back.state.health.lastImport, '2026-11-27T08:00:00.000Z');
  assert.equal(Store.restoreIgnoredHealth(del.state, ['not-a-uuid']).removed, 0);
  assert.equal(Store.restoreIgnoredHealth(del.state, ['not-a-uuid']).state.health.lastImport, '2026-11-27T08:00:00.000Z');
});

test('healthImportSince: 90 days on the first import, then from 7 days before the last import', () => {
  const now = Date.parse('2026-11-27T08:00:00.000Z');
  assert.equal(Store.healthImportSince(Store.DEFAULT_STATE(), now), '2026-08-29T08:00:00.000Z');
  assert.equal(Store.healthImportSince(Store.DEFAULT_STATE(), new Date(now)), '2026-08-29T08:00:00.000Z');
  const state = Object.assign(Store.DEFAULT_STATE(), { health: { enabled: true, lastImport: '2026-11-25T06:00:00.000Z', lastError: null } });
  assert.equal(Store.healthImportSince(state, '2026-11-27T08:00:00.000Z'), '2026-11-18T06:00:00.000Z');
  const old = Object.assign(Store.DEFAULT_STATE(), { health: { enabled: true, lastImport: '2026-01-10T06:00:00.000Z', lastError: null } });
  assert.equal(Store.healthImportSince(old, now), '2026-01-03T06:00:00.000Z', 'a long break is not cut to 90 days');
  const future = Object.assign(Store.DEFAULT_STATE(), { health: { enabled: true, lastImport: '2027-01-01T00:00:00.000Z', lastError: null } });
  assert.equal(Store.healthImportSince(future, now), '2026-08-29T08:00:00.000Z', 'a clock that jumped back reads 90 days');
  assert.equal(Store.healthImportSince(Store.DEFAULT_STATE(), 'soon'), null);
  assert.equal(Store.healthImportSince(Store.DEFAULT_STATE()), null);
});

test('migration keeps Health data canonical: ids, ignore list, bookkeeping; broken ids are reported', () => {
  const report = Store.migrateWithReport({
    schemaVersion: 2,
    runHistory: [
      { id: 'health-' + HK_A.toLowerCase(), source: 'health', date: '2026-11-24', distance: 5, movingSeconds: 1262, maxHeartrate: '181' },
      { id: 'health-x', source: 'health', date: '2026-11-25', distance: 5, movingSeconds: 1262 },
      { id: 'm-2', source: 'manual', date: '2026-11-26', distance: 5, movingSeconds: 1262, healthId: 'nope' }
    ],
    ignoredHealthIds: [HK_B, HK_B.toLowerCase(), 'x', 7],
    health: { enabled: true, lastImport: 'yesterday', lastError: 'denied' }
  });
  const runs = report.state.runHistory;
  assert.equal(runs[0].id, 'health-' + HK_A);
  assert.equal(runs[0].healthId, HK_A);
  assert.equal(runs[0].maxHeartrate, 181);
  assert.equal(runs[0].averageHeartrate, null);
  assert.equal(runs[1].source, 'manual', 'a Health run without a valid workout id becomes a manual run');
  assert.equal(runs[1].id, 'health-x');
  assert.equal('healthId' in runs[2], false);
  assert.deepEqual(report.state.ignoredHealthIds, [HK_B]);
  assert.deepEqual(report.state.health, { enabled: true, lastImport: null, lastError: 'denied' });
  assert.equal(count(report.warnings, 'ignored-id-dropped'), 2);
  assert.ok(report.warnings.filter(w => w.code === 'ignored-id-dropped').every(w => w.field === 'ignoredHealthIds'));
  assert.equal(report.warnings.filter(w => w.code === 'run-field-invalid' && w.field === 'healthId').length, 2);
  assert.deepEqual(Store.migrate(report.state), report.state);
  assert.deepEqual(Store.migrate({ ignoredHealthIds: 'x' }).ignoredHealthIds, []);
  const big = Store.migrateWithReport({ ignoredHealthIds: new Array(12000).fill(HK_C) });
  assert.deepEqual(big.state.ignoredHealthIds, [HK_C]);
  assert.equal(count(big.warnings, 'ignored-ids-truncated'), 1);
});

test('backup merge: a Health run deleted on either side stays deleted, Health bookkeeping stays local', () => {
  const imported = Store.importHealthRuns(Store.DEFAULT_STATE(), [hkRow(), hkRow({ healthId: HK_B, date: '2026-11-26' })], { at: '2026-11-27T08:00:00.000Z' }).state;
  const deletedHere = Store.deleteRun(imported, 'health-' + HK_B).state;
  const parsed = Store.parseBackup(Store.exportBackup(imported, null, { appVersion: '0.4.1', exportedAt: '2026-11-27T09:00:00.000Z' }));
  const merged = Store.applyBackup(deletedHere, parsed, { mode: 'merge' });
  assert.deepEqual(merged.state.runHistory.map(r => r.id), ['health-' + HK_A]);
  assert.deepEqual(merged.state.ignoredHealthIds, [HK_B]);
  assert.equal(merged.stats.ignored, 1);

  const fresh = Store.DEFAULT_STATE();
  const fromDeleted = Store.applyBackup(fresh, Store.parseBackup(Store.exportBackup(deletedHere, null, {})), { mode: 'merge' });
  assert.deepEqual(fromDeleted.state.ignoredHealthIds, [HK_B], 'the deletion travels with the backup');
  assert.deepEqual(fromDeleted.state.health, fresh.health, 'connections stay as they are on this device');
  assert.equal(Store.addRun(fresh, { date: '2026-11-20', distance: 5, time: '25:00' }, { today: '2026-11-27', id: 'health-' + HK_A, nowMs: 5 }).run.id, 'm-5', 'addRun never makes a health- id');
});
