// Přehled (home) page: i18n completeness and the pure view-model helpers exported as VeyvoUI.home
// (focus session, today headline, derived note tags, next-run figure, planned km this week).
// The derived object is built from the core modules the same way VeyvoUI.app.derived() does.
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
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js', 'home.js']) require(path.join(SRC, 'ui', file));
const Home = globalThis.VeyvoUI.home;
const I18n = globalThis.VeyvoI18n;
const Runs = globalThis.VeyvoRuns, Training = globalThis.VeyvoTraining, Workouts = globalThis.VeyvoWorkouts;
const NB = '\u00a0';

// The owner's demo history (tests/visual/screenshots.cjs), Tue + Sun runner, goal 5 km under 20:00.
const BASE = [
  ['2026-10-27', 'easy', 5.2, 1830, 4], ['2026-10-31', 'intervals', 6.0, 1890, 8], ['2026-11-03', 'long', 10.4, 3650, 6],
  ['2026-11-07', 'tempo', 7.0, 2180, 7], ['2026-11-10', 'run', 5.0, 1290, 9], ['2026-11-14', 'easy', 6.1, 2140, 4],
  ['2026-11-17', 'intervals', 6.5, 2010, 8], ['2026-11-21', 'long', 12.0, 4180, 6], ['2026-11-24', 'run', 5.0, 1262, 9]
];
const runsOf = list => list.map(([date, type, distance, movingSeconds, effort], i) => ({ id: 'm-' + (i + 1), source: 'manual', date, type, distance, movingSeconds, effort, note: '' }));
const PROFILE = { name: 'Pepa', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: true };

/** Same fields and rules as computeDerived() in src/ui/app.js. */
function derive({ runs = runsOf(BASE), today, profile = PROFILE, recovery = [], planned = [], locale = 'cs' }) {
  I18n.setLocale(locale);
  const sorted = Runs.sortRuns(runs);
  const past = sorted.filter(r => r.date <= today);
  const latestRun = past.length ? past[past.length - 1] : null;
  const findLast = (list, f) => { for (let i = list.length - 1; i >= 0; i--) if (f(list[i])) return list[i]; return null; };
  const baselineRun = findLast(sorted, r => r.type === 'test5k' && Runs.isFiveKAttempt(r)) || findLast(sorted, r => Runs.isFiveKAttempt(r));
  const nextRun = latestRun ? Training.nextRunAfterRun(latestRun, profile.days, today, baselineRun) : null;
  const records = Runs.records(sorted);
  const paces = Workouts.derivePaces({ best5kSeconds: records.fastest5k ? records.fastest5k.value : null, targetSeconds: profile.targetSeconds });
  const library = Workouts.library(paces, { locale });
  const plannedList = planned.map(p => {
    const template = library.find(x => x.id === p.templateId) || null;
    return Object.assign({}, p, { template, workout: template ? Object.assign({}, template.workout, { id: template.workout.id + '-' + p.date, date: p.date }) : null });
  });
  const pForNext = nextRun && nextRun.date ? plannedList.find(p => p.date === nextRun.date) : null;
  const recoveryToday = recovery.find(l => l.date === today) || null;
  return {
    today, locale, profile, runs: sorted, runsDesc: sorted.slice().reverse(), hasRuns: sorted.length > 0, latestRun, baselineRun,
    weekly: Runs.weeklyTotals(sorted, today, 12), goal: Runs.goalProgress(profile, sorted), records, notes: Runs.runNotes(sorted, profile),
    nextRun, nextWorkout: pForNext ? pForNext.workout : (nextRun ? Workouts.fromNextRun(nextRun, profile, { locale }) : null),
    planned: plannedList,
    weekStrip: Runs.weekStrip(sorted, { todayKey: today, profile, nextRun }).map(day => {
      const p = plannedList.find(x => x.date === day.date);
      return p ? Object.assign({}, day, { plannedWorkout: p }) : day;
    }),
    recoveryToday,
    recoveryAdvice: recoveryToday && (recoveryToday.fatigue >= 8 || recoveryToday.soreness >= 7) ? { code: 'rest', fatigue: recoveryToday.fatigue, soreness: recoveryToday.soreness } : null,
    paces, library
  };
}

test('home namespace is complete in Czech and English', () => {
  assert.deepEqual(I18n.audit('home'), { missing: { cs: [], en: [] }, incompletePlurals: [], placeholderMismatch: [] });
});

test('focus session: the engine run on Sunday, with the engine pace range', () => {
  const d = derive({ today: '2026-11-27' });
  const s = Home.focusSession(d);
  assert.equal(s.date, '2026-11-29');
  assert.equal(s.source, 'engine');
  assert.equal(s.distanceKm, 3);
  assert.deepEqual([s.paceFast, s.paceSlow], [305, 365]);
  assert.equal(s.isToday, false);
  assert.equal(s.canLog, false, 'a future run cannot be logged yet');
  assert.equal(s.workout.name, 'Lehký běh 3 km');
});

test('focus session: on the planned day itself the run is today and can be logged', () => {
  const d = derive({ today: '2026-11-29' });
  assert.equal(d.nextRun.date, '2026-12-01', 'derived.nextRun always starts tomorrow');
  const s = Home.focusSession(d);
  assert.equal(s.date, '2026-11-29');
  assert.equal(s.source, 'today');
  assert.equal(s.isToday, true);
  assert.equal(s.canLog, true);
  // once today's run is logged, the next engine run takes over
  const logged = derive({ today: '2026-11-29', runs: runsOf(BASE.concat([['2026-11-29', 'easy', 3.1, 1080, 4]])) });
  assert.equal(Home.focusSession(logged).date, '2026-12-01');
});

test('focus session: a planned library session before the engine date wins; max effort means rest', () => {
  const d = derive({ today: '2026-11-27', planned: [{ date: '2026-11-28', templateId: 'intervals400' }] });
  const s = Home.focusSession(d);
  assert.equal(s.kind, 'planned');
  assert.equal(s.date, '2026-11-28');
  assert.equal(s.type, 'intervals');
  assert.deepEqual(Home.figure(s), { value: '6×400', unit: 'm' });
  const maxed = runsOf(BASE.map((r, i) => i === BASE.length - 1 ? [r[0], r[1], r[2], r[3], 10] : r));
  const rest = derive({ today: '2026-11-26', runs: maxed });
  assert.equal(Home.focusSession(rest).kind, 'rest');
  // the rest verdict after a 10/10 effort (Tuesday 24. 11.) lasts a few days only, then the next run is planned
  const after = Home.focusSession(derive({ today: '2026-11-27', runs: maxed }));
  assert.equal(after.kind, 'easy');
  assert.equal(after.source, 'engine');
  assert.equal(after.date, '2026-11-29');
  assert.equal(Home.focusSession(derive({ today: '2026-11-27', runs: [] })), null);
});

test('today headline: free day, run day, logged, check-in says rest, first launch (Czech typography)', () => {
  let d = derive({ today: '2026-11-27' });
  let hl = Home.headline(d, Home.focusSession(d));
  assert.equal(hl.main, 'Dnes máš volno.');
  assert.equal(hl.tail, 'Další běh v' + NB + 'neděli.');
  assert.ok(hl.sub.startsWith('Naposledy út' + NB + '24.' + NB + '11.: běh, 5,0' + NB + 'km za 21:02,'), hl.sub);
  assert.ok(hl.sub.endsWith('tvůj nejlepší čas.'), 'the latest run is the best 5 km');

  d = derive({ today: '2026-11-29' });
  hl = Home.headline(d, Home.focusSession(d));
  assert.equal(hl.main, 'Dnes běžíš: 3' + NB + 'km lehce.');
  assert.equal(hl.tone, 'run');

  d = derive({ today: '2026-11-29', recovery: [{ date: '2026-11-29', sleepHours: 6, fatigue: 8, soreness: 7 }] });
  hl = Home.headline(d, Home.focusSession(d));
  assert.equal(hl.main, 'Dnes raději odpočívej.');
  assert.match(hl.sub, /únava 8\/10\sa\sbolest svalů 7\/10/);

  d = derive({ today: '2026-11-29', runs: runsOf(BASE.concat([['2026-11-29', 'easy', 3.1, 1080, 4]])) });
  hl = Home.headline(d, Home.focusSession(d));
  assert.equal(hl.main, 'Dnešní běh je zapsaný.');
  assert.equal(hl.tail, 'Další běh v' + NB + 'úterý.');

  d = derive({ today: '2026-11-27', runs: [], profile: Object.assign({}, PROFILE, { onboarded: false }) });
  assert.equal(Home.headline(d, null).main, 'Vítej ve VEYVO.');

  d = derive({ today: '2026-11-27', locale: 'en' });
  hl = Home.headline(d, Home.focusSession(d));
  assert.equal(hl.main + ' ' + hl.tail, 'Rest day today. Next run on Sunday.');
  I18n.setLocale('cs');
});

test('derived note tags: the most important one first, first 5 km is not a "record"', () => {
  I18n.setLocale('cs');
  const d = derive({ today: '2026-11-27' });
  assert.equal(Home.noteTag(d.notes['m-9']).text, 'Osobní rekord');
  assert.equal(Home.noteTag(d.notes['m-5']).text, 'První pětka');
  assert.equal(Home.noteTag(d.notes['m-8']).text, 'Nejdelší běh');
  assert.equal(Home.noteTag(d.notes['m-2']).text, 'Nejdelší běh', 'longer than every earlier run');
  assert.equal(Home.noteTag(d.notes['m-4']), null);
  const tags = Home.noteTags([{ code: 'firstRun', params: {} }, { code: 'checkpoint', params: { seconds: 1200, isGoal: true } }, { code: 'personalBest5k', params: { previousBest: 1262 } }]);
  assert.deepEqual(tags.map(x => x.text), ['Cíl splněn', 'Osobní rekord', 'První běh']);
});

test('planned km this week and recovery reasons', () => {
  assert.equal(Home.weekPlannedKm(derive({ today: '2026-11-27' }), null), 3);
  const sunday = derive({ today: '2026-11-29' });
  assert.equal(Home.weekPlannedKm(sunday, Home.focusSession(sunday)), 3, 'today\'s run counts as planned');
  assert.deepEqual(Home.recoveryReasons({ fatigue: 9, soreness: 2 }), ['únava 9/10']);
  assert.deepEqual(Home.recoveryReasons(null), []);
  assert.equal(Home.runTypeForTemplate('threshold'), 'tempo');
});

test('empty states never point to Strava where it does not exist (Android), and the English pace basis reads naturally', () => {
  const app = globalThis.VeyvoUI.app;
  assert.equal(app.strava.supported, false, 'the Node platform is the web fallback: no Strava, like Android');
  const empty = derive({ today: '2026-11-27', runs: [] });
  const hl = Home.headline(empty, null);
  assert.ok(!/Strav/.test(hl.sub), hl.sub);
  assert.match(hl.sub, /zálohu z\u00a0Windows|zálohu z Windows/);
  assert.ok(!/Strav/.test(app.t('home.setup.step2TextLocal')));
  assert.ok(!/Strav/.test(app.t('progress.empty.textLocal')));
  // pace basis: "your 21:02 5 km on Tue 24 Nov", never "... on Tue 24 Nov in 21:02" (reads like a clock time)
  const en = derive({ today: '2026-11-27', locale: 'en' });
  const basis = Home.paceBasis(en);
  assert.match(basis, /^Paces are based on your 21:02 5\u00a0km on /, basis);
  assert.ok(!/ in 21:02/.test(basis));
  // a 5 km test at a GPS 5.08 km is the basis too
  const gps = derive({ today: '2026-11-27', locale: 'cs', runs: runsOf(BASE.slice(0, 8).concat([['2026-11-24', 'test5k', 5.08, 1262, 9]])) });
  assert.match(Home.paceBasis(gps), /pětky/);
});
