// Můj plán page (src/ui/plan.js): the pure model half and the 'plan' i18n namespace.
// The page module exports its model under Node (module.exports) and skips the DOM part.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.VeyvoFormat = require('../src/core/format.js');
globalThis.VeyvoI18n = require('../src/core/i18n.js');
globalThis.VeyvoRuns = require('../src/core/runs-model.js');
globalThis.VeyvoStore = require('../src/core/store.js');
globalThis.VeyvoWorkouts = require('../src/core/workouts.js');
globalThis.VeyvoTraining = require('../src/training-context.js');
globalThis.VeyvoPlatform = require('../src/platform.js');
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js']) require(path.join(__dirname, '..', 'src', 'ui', file));
const plan = require('../src/ui/plan.js');
const I18n = globalThis.VeyvoI18n, Runs = globalThis.VeyvoRuns, Workouts = globalThis.VeyvoWorkouts, Training = globalThis.VeyvoTraining;

const TODAY = '2026-11-27'; // Friday
const PROFILE = { name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true };
const run = (date, type, distance, movingSeconds, effort) => ({ id: 'm-' + date, source: 'manual', date, type, distance, movingSeconds, effort, note: '' });
const RUNS = [run('2026-11-10', 'run', 5, 1290, 9), run('2026-11-21', 'long', 12, 4180, 6), run('2026-11-24', 'run', 5, 1262, 9)];
const PACES = Workouts.derivePaces({ best5kSeconds: 1262, targetSeconds: 1200 });
const LIBRARY = Workouts.library(PACES, { locale: 'cs' });
const tpl = id => LIBRARY.find(t => t.id === id);

test('plan i18n namespace is complete in Czech and English', () => {
  const report = I18n.audit('plan');
  assert.deepEqual(report.missing, { cs: [], en: [] });
  assert.deepEqual(report.incompletePlurals, []);
  assert.deepEqual(report.placeholderMismatch, []);
  I18n.setLocale('cs');
  assert.equal(I18n.t('plan.week.ago', { n: 2 }), 'Před 2 týdny');
  assert.equal(I18n.t('plan.week.ahead', { n: 5 }), 'Za 5 týdnů');
  assert.equal(I18n.t('plan.week.ahead', { n: 1 }), 'Za 1 týden');
  I18n.setLocale('en');
  assert.equal(I18n.t('plan.week.ago', { n: 1 }), '1 week ago');
  I18n.setLocale('cs');
});

test('plan texts contain no glyph icons or arrows (SVG icons only)', () => {
  const glyphs = /[←-⇿⌀-⏿■-➿⬀-⯿\u{1F000}-\u{1FAFF}]/u;
  const walk = (value, where) => {
    if (typeof value === 'string') assert.doesNotMatch(value, glyphs, where);
    else if (value && typeof value === 'object') Object.keys(value).forEach(k => walk(value[k], where + '.' + k));
  };
  walk(plan.MESSAGES, 'plan');
});

test('buildWeek: availability is checked before past-ness (past rest days read "Volno")', () => {
  const nextRun = Training.nextRunAfterRun(RUNS[2], PROFILE.days, TODAY, RUNS[2]);
  assert.equal(nextRun.date, '2026-11-29');
  const week = plan.buildWeek(Runs.sortRuns(RUNS), { todayKey: TODAY, profile: PROFILE, nextRun, planned: [], offset: 0 });
  assert.equal(week.monday, '2026-11-23');
  assert.equal(week.sunday, '2026-11-29');
  const by = Object.fromEntries(week.days.map(d => [d.date, d]));
  assert.equal(by['2026-11-23'].status, 'rest', 'past Monday is a rest day, not "Bez záznamu"');
  assert.equal(by['2026-11-23'].canLog, false);
  assert.equal(by['2026-11-24'].status, 'done');
  assert.equal(by['2026-11-24'].canLog, false);
  assert.equal(by['2026-11-24'].canAddAnother, true);
  assert.equal(by['2026-11-27'].status, 'rest', 'today is Friday, a rest day');
  assert.equal(by['2026-11-27'].isToday, true);
  assert.equal(by['2026-11-27'].canLog, false, 'no "+" on a rest day');
  assert.equal(by['2026-11-29'].status, 'planned');
  assert.equal(by['2026-11-29'].engine.distanceKm, nextRun.distanceKm);
  assert.equal(by['2026-11-29'].canLog, false, 'no "+" in the future');
  assert.deepEqual(week.summary, { count: 1, distanceKm: 5, movingSeconds: 1262, plannedCount: 1 });
});

test('buildWeek: unlogged past running day, today running day, library session overrides the engine', () => {
  const profile = Object.assign({}, PROFILE, { days: [0, 1, 4, 6] }); // Mon, Tue, Fri, Sun
  const nextRun = { kind: 'easy', date: '2026-11-29', distanceKm: 3, paceFast: 305, paceSlow: 365 };
  const planned = [{ date: '2026-11-29', templateId: 'intervals400' }, { date: '2026-11-25', templateId: 'threshold' }];
  const week = plan.buildWeek(RUNS, { todayKey: TODAY, profile, nextRun, planned, offset: 0 });
  const by = Object.fromEntries(week.days.map(d => [d.date, d]));
  assert.equal(by['2026-11-23'].status, 'unlogged');
  assert.equal(by['2026-11-23'].canLog, true);
  assert.equal(by['2026-11-27'].status, 'today');
  assert.equal(by['2026-11-27'].canLog, true);
  assert.equal(by['2026-11-29'].status, 'session');
  assert.equal(by['2026-11-29'].engine, null, 'the session replaces the suggested easy run');
  assert.equal(by['2026-11-25'].status, 'missed', 'a past session without a run');
  assert.equal(by['2026-11-25'].canLog, true, 'a missed session day can still get its result');
  assert.equal(by['2026-11-28'].status, 'rest');
  assert.equal(week.summary.plannedCount, 1);
});

test('week offsets: whole Monday weeks, clamped to ±52', () => {
  assert.equal(plan.weekOffsetOf('2026-11-23', TODAY), 0);
  assert.equal(plan.weekOffsetOf('2026-11-29', TODAY), 0);
  assert.equal(plan.weekOffsetOf('2026-11-22', TODAY), -1);
  assert.equal(plan.weekOffsetOf('2026-12-07', TODAY), 2);
  assert.equal(plan.weekOffsetOf('not-a-date', TODAY), 0);
  assert.equal(plan.clampOffset(80), 52);
  assert.equal(plan.clampOffset(-80), -52);
  assert.equal(plan.clampOffset('3'), 3);
  const far = plan.buildWeek(RUNS, { todayKey: TODAY, profile: PROFILE, offset: 999 });
  assert.equal(far.offset, 52);
  assert.equal(far.monday, Runs.addDays('2026-11-23', 52 * 7));
});

test('scheduleCandidates: 14 days from today, prefers the first free running day', () => {
  const nextRun = { kind: 'easy', date: '2026-11-29' };
  const pick = plan.scheduleCandidates(TODAY, { profile: PROFILE, planned: [{ date: '2026-11-29', templateId: 'easy' }], nextRun, runs: RUNS });
  assert.equal(pick.days.length, 14);
  assert.equal(pick.days[0].date, TODAY);
  assert.equal(pick.days[0].isToday, true);
  assert.equal(pick.days[13].date, '2026-12-10');
  assert.equal(pick.days[2].session.templateId, 'easy');
  assert.equal(pick.days[2].isEngine, true);
  assert.equal(pick.days[pick.preferred].date, '2026-12-01', 'Sunday has a session, so the next Tuesday');
  const none = plan.scheduleCandidates(TODAY, { profile: { days: [] } });
  assert.equal(none.preferred, 0, 'no days set = every day is a running day');
});

test('workoutStats: exact sums when possible, documented estimate otherwise', () => {
  const easy = plan.workoutStats(tpl('easy').workout, PACES);
  assert.deepEqual(easy.distance, { meters: 5000, approx: false });
  assert.equal(easy.time.approx, true);
  assert.equal(easy.time.seconds, Math.round(5 * (305 + 365) / 2));
  assert.deepEqual(easy.target, { fast: 305, slow: 365 });

  const reps = plan.workoutStats(tpl('intervals400').workout, PACES);
  assert.equal(reps.distance.approx, true);
  assert.deepEqual(reps.target, { fast: 230, slow: 237 });

  const test5k = plan.workoutStats(tpl('test5k').workout, PACES);
  const est = Workouts.estimate(tpl('test5k').workout, { easyPaceSecPerKm: 335 });
  assert.equal(test5k.time.seconds, Math.round(est.seconds + 5 * (1262 / 5 - 335)), 'the all-out 5 km is timed at the best 5 km pace');
  assert.deepEqual(test5k.target, { label: 'Naplno' });

  const byFeel = plan.workoutStats(Workouts.library(null)[0].workout, null);
  assert.deepEqual(byFeel.distance, { meters: 5000, approx: false });
  assert.equal(byFeel.time, null, 'no pace known, no invented duration');
  assert.equal(plan.workoutStats({ steps: [] }, PACES), null);
});

test('paceBasis: the formula behind each library pace', () => {
  assert.deepEqual(plan.paceBasis('intervals400', PACES), { rule: 'rep400', from: 'goal', time: 1200, pace: 240, approx: false });
  assert.deepEqual(plan.paceBasis('intervals1k', PACES), { rule: 'rep1k', from: 'goal', time: 1200, pace: 240, approx: false });
  assert.deepEqual(plan.paceBasis('threshold', PACES), { rule: 'threshold', from: 'best', time: 1262, pace: 250, approx: true });
  assert.deepEqual(plan.paceBasis('easy', PACES), { rule: 'easy', from: 'best', time: 1262, pace: 1262 / 5, approx: false });
  assert.deepEqual(plan.paceBasis('test5k', PACES), { rule: 'test' });
  assert.deepEqual(plan.paceBasis('easy', null), { rule: 'byFeel' });
  assert.deepEqual(plan.paceBasis('easy', PACES, false), { rule: 'byFeel' });
  const goalOnly = Workouts.derivePaces({ best5kSeconds: null, targetSeconds: 1200 });
  assert.deepEqual(plan.paceBasis('threshold', goalOnly), { rule: 'threshold', from: 'goalPlus', time: 1200, pace: 255, approx: false });
  const bestOnly = Workouts.derivePaces({ best5kSeconds: 1262, targetSeconds: null });
  assert.equal(plan.paceBasis('intervals400', bestOnly).from, 'best');
});

test('paceContext: target range, goal pace and best 5 km pace on one track', () => {
  const c = plan.paceContext({ fast: 305, slow: 365 }, PACES);
  assert.ok(c.lo <= 240 && c.hi >= 365);
  assert.equal(c.goalPace, 240);
  assert.equal(c.bestPace, 1262 / 5);
  assert.ok(c.goal < c.best && c.best < c.band.from && c.band.from < c.band.to && c.band.to <= 1);
  assert.equal(plan.paceContext(null, PACES), null);
  assert.equal(plan.paceContext({ fast: 300, slow: 300 }, PACES), null);
  const noData = plan.paceContext({ fast: 305, slow: 365 }, null);
  assert.equal(noData.goal, null);
  assert.equal(noData.best, null);
});

test('profileBlocks: repeats expanded, faster steps taller', () => {
  const blocks = plan.profileBlocks(tpl('intervals400').workout, { easyPace: 335, refPace: 240 });
  assert.equal(blocks.length, 1 + 6 * 2 + 1);
  assert.equal(blocks[0].intensity, 'warmup');
  assert.equal(blocks[1].intensity, 'active');
  assert.ok(blocks[1].level > blocks[0].level && blocks[1].level > blocks[2].level);
  assert.ok(blocks.every(b => b.seconds > 0 && b.level > 0 && b.level <= 1));
});

test('prefill and logDate for "Zapsat výsledek"', () => {
  assert.deepEqual(plan.prefill({ nextRun: { kind: 'easy', distanceKm: 3 } }), { type: 'easy', distance: 3 });
  assert.deepEqual(plan.prefill({ nextRun: { kind: 'easy', returnAfterBreak: true, distanceKm: 3.5 } }), { type: 'easy' });
  assert.deepEqual(plan.prefill({ templateId: 'test5k' }), { type: 'test5k', distance: 5 });
  const stats = plan.workoutStats(tpl('threshold').workout, PACES);
  const p = plan.prefill({ templateId: 'threshold', stats });
  assert.equal(p.type, 'tempo');
  assert.equal(p.distance, Math.round(stats.distance.meters / 100) / 10);
  assert.equal(plan.logDate('2026-11-29', TODAY), TODAY, 'never a future date');
  assert.equal(plan.logDate('2026-11-24', TODAY), '2026-11-24');
  assert.equal(plan.logDate(null, TODAY), TODAY);
  assert.equal(plan.runTypeOf('intervals1k'), 'intervals');
  assert.equal(plan.runTypeOf('unknown'), 'easy');
});
