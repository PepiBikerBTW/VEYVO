// "Do hodinek" workout sheet (src/ui/workout-sheet.js): i18n completeness and the pure helpers
// exported as VeyvoUI.workoutSheet (workout resolution, ids, brand list, profile, error wording,
// clipboard text, Garmin paths, remembered brand). The DOM side is checked with screenshots.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
globalThis.VeyvoFormat = require('../src/core/format.js');
globalThis.VeyvoI18n = require('../src/core/i18n.js');
globalThis.VeyvoRuns = require('../src/core/runs-model.js');
globalThis.VeyvoStore = require('../src/core/store.js');
globalThis.VeyvoWorkouts = require('../src/core/workouts.js');
globalThis.VeyvoFit = require('../src/core/export/fit.js');
globalThis.VeyvoIntervals = require('../src/core/export/intervals.js');
globalThis.VeyvoTraining = require('../src/training-context.js');
globalThis.VeyvoPlatform = require('../src/platform.js');
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js', 'workout-sheet.js']) require(path.join(SRC, 'ui', file));
const Sheet = globalThis.VeyvoUI.workoutSheet;
const app = globalThis.VeyvoUI.app;
const I18n = globalThis.VeyvoI18n;
const Workouts = globalThis.VeyvoWorkouts;

const paces = Workouts.derivePaces({ best5kSeconds: 1262, targetSeconds: 1200 });
function derived(locale) {
  const library = Workouts.library(paces, { locale: locale || 'cs' });
  const lib = id => library.find(x => x.id === id);
  const dated = (tpl, date) => Object.assign(JSON.parse(JSON.stringify(tpl.workout)), { id: tpl.workout.id + '-' + date, date });
  const nextRun = { kind: 'easy', date: '2026-11-29', distanceKm: 3, paceFast: 305, paceSlow: 365 };
  return {
    paces, library,
    planned: [{ date: '2026-12-01', templateId: 'intervals400', template: lib('intervals400'), workout: dated(lib('intervals400'), '2026-12-01') }],
    nextWorkout: Workouts.fromNextRun(nextRun, {}, { locale: locale || 'cs' })
  };
}

test('workout namespace is complete in Czech and English', () => {
  assert.deepEqual(I18n.audit('workout'), { missing: { cs: [], en: [] }, incompletePlurals: [], placeholderMismatch: [] });
});

test('both dialog names are registered (plan uses workoutExport, home and the run dialog use workout)', () => {
  assert.ok(app.dialogs.has('workout'));
  assert.ok(app.dialogs.has('workoutExport'));
});

test('brands: every brand has a flow, a name and a method label in both languages', () => {
  const flows = new Set(['fit', 'apple', 'intervals', 'zwo', 'text']);
  assert.equal(Sheet.BRANDS.length, 13);
  for (const b of Sheet.BRANDS) {
    assert.ok(flows.has(b.flow), b.id);
    for (const loc of ['cs', 'en']) {
      assert.ok(I18n.has('workout.brand.' + b.id, loc), b.id + ' ' + loc);
      if (b.flow === 'intervals') {
        assert.ok(I18n.has('workout.intervals.account.' + b.id, loc), 'account ' + b.id);
        assert.ok(I18n.has('workout.intervals.note.' + b.id, loc), 'note ' + b.id);
      }
    }
  }
  assert.deepEqual(Sheet.BRANDS.filter(b => b.flow === 'intervals').map(b => b.id), ['garminCloud', 'coros', 'suunto', 'huawei', 'amazfit']);
  assert.deepEqual(Sheet.BRANDS.filter(b => b.flow === 'text').map(b => b.id), ['polar', 'samsung', 'pixel', 'other']);
});

test('resolveWorkout: a passed workout is copied, never mutated', () => {
  const d = derived();
  const original = d.nextWorkout;
  const r = Sheet.resolveWorkout({ workout: original }, d);
  assert.equal(r.source, 'param');
  assert.notEqual(r.workout, original);
  assert.equal(r.workout.id, 'plan-2026-11-29');
  assert.equal(r.date, '2026-11-29');
  r.workout.name = 'x';
  assert.equal(original.name, 'Lehký běh 3 km');
});

test('resolveWorkout: templateId + date picks the planned session, else the library, re-dated', () => {
  const d = derived();
  const planned = Sheet.resolveWorkout({ templateId: 'intervals400', date: '2026-12-01' }, d);
  assert.equal(planned.source, 'planned');
  assert.equal(planned.workout.id, 'lib-intervals400-2026-12-01');
  const lib = Sheet.resolveWorkout({ templateId: 'threshold', date: '2026-12-06' }, d);
  assert.equal(lib.source, 'library');
  assert.equal(lib.workout.id, 'lib-threshold-2026-12-06');
  assert.equal(lib.workout.date, '2026-12-06');
  const undated = Sheet.resolveWorkout({ templateId: 'test5k' }, d);
  assert.equal(undated.workout.id, 'lib-test5k');
  assert.equal(undated.date, null);
  assert.equal(Sheet.resolveWorkout({ templateId: 'nope' }, d), null);
});

test('resolveWorkout: no params falls back to the next workout; nothing to send gives null', () => {
  const d = derived();
  assert.equal(Sheet.resolveWorkout({}, d).source, 'next');
  assert.equal(Sheet.resolveWorkout({}, { library: [], planned: [], nextWorkout: null }), null);
  assert.equal(Sheet.resolveWorkout(null, null), null);
});

test('idForDate: a trailing date is replaced, never doubled', () => {
  assert.equal(Sheet.idForDate('lib-easy', '2026-12-01'), 'lib-easy-2026-12-01');
  assert.equal(Sheet.idForDate('plan-2026-11-29', '2026-11-30'), 'plan-2026-11-30');
  assert.equal(Sheet.idForDate('plan-next', '2026-11-30'), 'plan-next-2026-11-30');
  assert.ok(Sheet.idForDate('x'.repeat(200), '2026-11-30').length <= 100);
});

test('groupOf: template ids map to the chart series, other workouts by shape', () => {
  const d = derived();
  assert.equal(Sheet.groupOf(d.nextWorkout, null), 'easy');
  assert.equal(Sheet.groupOf(null, 'intervals400'), 'quality');
  assert.equal(Sheet.groupOf(null, 'test5k'), 'fast');
  assert.equal(Sheet.groupOf(d.library.find(x => x.id === 'intervals1k').workout, null), 'quality');
  assert.equal(Sheet.groupOf(d.library.find(x => x.id === 'test5k').workout, null), 'fast');
});

test('profileBlocks: repeats expanded, widths from the prescription, reps taller than jogs', () => {
  const w = derived().library.find(x => x.id === 'intervals400').workout;
  const blocks = Sheet.profileBlocks(w, { easyPace: Sheet.easyPaceOf(paces), refPace: paces.goalSecPerKm });
  assert.equal(blocks.length, 1 + 6 * 2 + 1);
  assert.equal(blocks[0].intensity, 'warmup');
  assert.equal(blocks[0].seconds, 900);
  const rep = blocks[1], jog = blocks[2];
  assert.equal(rep.intensity, 'active');
  assert.ok(rep.level > jog.level);
  assert.ok(Math.abs(rep.seconds - 0.4 * (230 + 237) / 2) < 0.01, 'distance step at the middle of its pace range');
  assert.deepEqual(Sheet.profileBlocks(null), []);
});

test('errorEntries: codes are worded with the step position, duplicates dropped', () => {
  I18n.setLocale('cs');
  const w = derived().library.find(x => x.id === 'intervals400').workout;
  const broken = JSON.parse(JSON.stringify(w));
  broken.name = '';
  broken.steps[1].count = 120;
  broken.steps[1].steps[0].target = { type: 'pace', fastSecPerKm: 240, slowSecPerKm: 230 };
  const entries = Sheet.errorEntries(Workouts.validate(broken));
  const byCode = Object.fromEntries(entries.map(e => [e.code, e]));
  assert.equal(byCode.name_required.where, null);
  assert.deepEqual(byCode.repeat_count_range.where, { key: 'errors.repeat', params: { n: 2 } });
  assert.deepEqual(byCode.pace_order.where, { key: 'errors.repeatStep', params: { n: 2, m: 1 } });
  assert.equal(app.t('workout.' + byCode.repeat_count_range.key, byCode.repeat_count_range.params), 'Opakování musí být 1× až 99×.');
  const many = Sheet.errorEntries({ errors: [{ code: 'too_many_steps', path: 'steps', count: 52, max: 50 }, { code: 'weird_new_code', path: '' }] });
  assert.equal(app.t('workout.' + many[0].key, many[0].params), 'Trénink má 52\u00a0kroků, hodinky Garmin zvládnou nejvýš 50.');
  assert.equal(many[1].key, 'errors.code.workout_invalid', 'unknown codes still get a sentence');
});

test('every VeyvoWorkouts.validate error code has a sentence', () => {
  const src = require('node:fs').readFileSync(path.join(SRC, 'core', 'workouts.js'), 'utf8');
  const doc = src.slice(src.indexOf('Codes (stable'), src.indexOf('function validate('));
  const codes = doc.match(/[a-z]+(?:_[a-z]+)+|[a-z]+_[a-z]+/g).filter(c => c.indexOf('_') > 0);
  assert.ok(codes.length >= 20);
  for (const code of new Set(codes)) assert.ok(I18n.has('workout.errors.code.' + code, 'en'), code);
});

test('textFor: name, date, the step lines in the chosen language, description', () => {
  const w = derived('en').library.find(x => x.id === 'intervals400').workout;
  const text = Sheet.textFor(w, 'en', 'Tuesday 1 December');
  const lines = text.split('\n');
  assert.equal(lines[0], 'Reps 6× 400 m');
  assert.equal(lines[1], 'Tuesday 1 December');
  assert.equal(lines[3], 'Warm-up 15 min');
  assert.match(lines[4], /^6× \(400 m at 3:50–3:57 \/km, 200 m jog\)$/);
  assert.equal(lines[5], 'Cool-down 10 min');
  assert.match(lines[lines.length - 1], /^Warm up for 15 min/);
});

test('newFilesPath: Windows drive roots and POSIX mounts', () => {
  assert.equal(Sheet.newFilesPath('E:\\'), 'E:\\GARMIN\\NewFiles');
  assert.equal(Sheet.newFilesPath('F:'), 'F:\\GARMIN\\NewFiles');
  assert.equal(Sheet.newFilesPath('/media/pepa/GARMIN/'), '/media/pepa/GARMIN/GARMIN/NewFiles');
});

test('lastBrand: state.ui first, then the local fallback, unknown ids ignored', () => {
  assert.equal(Sheet.lastBrand({ ui: { lastExportBrand: 'coros' } }, () => 'garmin'), 'coros');
  assert.equal(Sheet.lastBrand({ ui: {} }, k => (k === Sheet.LS_BRAND ? 'apple' : null)), 'apple');
  assert.equal(Sheet.lastBrand({ ui: { lastExportBrand: 'nokia' } }, () => null), null);
  assert.equal(Sheet.lastBrand(null, () => { throw new Error('blocked'); }), null);
});

test('state.ui keeps lastExportBrand and every export format code passes VeyvoStore.logExport', () => {
  const Store = globalThis.VeyvoStore;
  const state = Store.migrate({ schemaVersion: 2, ui: { lastSeenVersion: null, lastExportBrand: 'garmin' } });
  assert.equal(state.ui.lastExportBrand, 'garmin');
  for (const format of Object.values(Sheet.FORMAT)) {
    const r = Store.logExport(state, { at: '2026-11-27T10:00:00.000Z', workoutId: 'plan-2026-11-29', format });
    assert.ok(r.ok, format);
  }
});
