/*
 * ui/plan.js - "Můj plán" / "My plan" page: week grid (±52 weeks), the next workout as a structured
 * step list, the session library with scheduling, and the running-days shortcut.
 * Contract: docs/ui-architecture.md (page 'plan', i18n namespace 'plan', CSS prefix 'plan-').
 *
 * The file has two halves:
 *   1. `model` - pure helpers (no DOM, no clock): week building, schedule candidates, workout stats,
 *      intensity profile, pace-basis hints, run-dialog prefill. Exported as VeyvoUI.planModel and,
 *      under Node, as module.exports, so tests/plan-model.test.js can check them.
 *   2. the page - registered with VeyvoUI.app when the runtime is present.
 *
 * Every number shown comes from the runner's data or a documented formula: run history, the
 * VeyvoTraining next-run engine, VeyvoWorkouts.derivePaces/library/estimate. Nothing is invented.
 */
(function (root) {
  'use strict';

  const Runs = root.VeyvoRuns;
  const Workouts = root.VeyvoWorkouts;
  const I18n = root.VeyvoI18n;

  // ================================================================ 1. pure model

  const WEEK_LIMIT = 52;
  const SCHEDULE_DAYS = 14;
  const TEMPLATE_RUN_TYPE = Object.freeze({
    easy: 'easy', intervals400: 'intervals', intervals1k: 'intervals', threshold: 'tempo', long: 'long', test5k: 'test5k'
  });
  // Only used to give unpaced blocks a width in the intensity drawing; never displayed.
  const DRAW_PACE = 330;
  const DRAW_OPEN_SECONDS = 120;

  function isKey(value) { return Runs.isDateKey(value); }

  /** profile.days -> sorted unique 0..6 (0 = Monday); empty means "every day" (VeyvoRuns rule). */
  function runDays(profile) {
    if (!profile || !Array.isArray(profile.days)) return [];
    return Array.from(new Set(profile.days.map(Number))).filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  }

  /** Whole weeks between today's Monday and dateKey's Monday (negative = past). */
  function weekOffsetOf(dateKey, todayKey) {
    if (!isKey(dateKey) || !isKey(todayKey)) return 0;
    return Math.round(Runs.daysBetween(Runs.weekStartOf(todayKey), Runs.weekStartOf(dateKey)) / 7);
  }

  function clampOffset(value) {
    const n = Math.trunc(Number(value)) || 0;
    return Math.max(-WEEK_LIMIT, Math.min(WEEK_LIMIT, n));
  }

  function sessionMap(planned) {
    const map = new Map();
    (Array.isArray(planned) ? planned : []).forEach(p => { if (p && isKey(p.date)) map.set(p.date, p); });
    return map;
  }

  /**
   * buildWeek(runs, { todayKey, profile, nextRun, planned, offset }) -> { offset, monday, sunday, days, summary }
   * Day status (availability is checked BEFORE past-ness, so a past rest day reads "Volno", never
   * "Bez záznamu" - the 0.3 calendar bug):
   *   done     the day has at least one run
   *   session  a library session is scheduled (it overrides the engine's easy run on that day)
   *   missed   a scheduled session in the past without a run
   *   planned  the next-run engine's suggestion
   *   rest     not a running day
   *   today    running day, today, nothing logged yet
   *   unlogged running day in the past without a run
   *   open     running day in the future, nothing planned
   * canLog: past/today running day (or session day) without a run -> the "+" button.
   * canAddAnother: past/today day that already has a run -> "Přidat další běh" in the day menu.
   */
  function buildWeek(runs, options) {
    const o = options || {};
    const todayKey = o.todayKey;
    const offset = clampOffset(o.offset);
    const nextRun = o.nextRun && typeof o.nextRun === 'object' && o.nextRun.kind !== 'rest' && isKey(o.nextRun.date) ? o.nextRun : null;
    const sessions = sessionMap(o.planned);
    const strip = Runs.weekStrip(Array.isArray(runs) ? runs : [], { todayKey, profile: o.profile, nextRun, offset });
    const days = strip.map(s => {
      const session = sessions.get(s.date) || null;
      const engine = !session && s.planned ? s.planned : null;
      const isFuture = s.date > todayKey;
      const hasRuns = s.runs.length > 0;
      let status;
      if (hasRuns) status = 'done';
      else if (session) status = s.isPast ? 'missed' : 'session';
      else if (engine) status = 'planned';
      else if (!s.isRunDay) status = 'rest';
      else if (s.isToday) status = 'today';
      else if (s.isPast) status = 'unlogged';
      else status = 'open';
      return {
        date: s.date, weekday: s.weekday, isToday: s.isToday, isPast: s.isPast, isFuture, isRunDay: s.isRunDay,
        runs: s.runs.slice(), status, session, engine,
        canLog: !isFuture && !hasRuns && (s.isRunDay || !!session),
        canAddAnother: !isFuture && hasRuns
      };
    });
    const weekRuns = [];
    days.forEach(d => d.runs.forEach(r => weekRuns.push(r)));
    const totals = Runs.totals(weekRuns);
    const plannedCount = days.filter(d => !d.runs.length && !d.isPast && (d.session || d.engine)).length;
    return {
      offset, monday: days[0].date, sunday: days[6].date, days,
      summary: { count: totals.count, distanceKm: totals.distanceKm, movingSeconds: totals.movingSeconds, plannedCount }
    };
  }

  /**
   * scheduleCandidates(todayKey, { profile, planned, nextRun, runs, count = 14 }) -> { days, preferred }
   * The next `count` days starting today. preferred: the first running day without a session and
   * without a run, else the first running day, else today.
   */
  function scheduleCandidates(todayKey, options) {
    const o = options || {};
    const count = Number.isInteger(o.count) && o.count > 0 ? o.count : SCHEDULE_DAYS;
    const daysOn = runDays(o.profile);
    const sessions = sessionMap(o.planned);
    const ranOn = new Set((Array.isArray(o.runs) ? o.runs : []).map(r => r && String(r.date || '').slice(0, 10)));
    const engineDate = o.nextRun && o.nextRun.kind !== 'rest' && isKey(o.nextRun.date) ? o.nextRun.date : null;
    const days = [];
    for (let i = 0; i < count; i++) {
      const date = Runs.addDays(todayKey, i);
      const weekday = Runs.weekdayIndex(date);
      days.push({
        date, weekday, isToday: i === 0,
        isRunDay: daysOn.length === 0 || daysOn.indexOf(weekday) >= 0,
        session: sessions.get(date) || null,
        isEngine: date === engineDate,
        hasRun: ranOn.has(date)
      });
    }
    let preferred = days.findIndex(d => d.isRunDay && !d.session && !d.hasRun);
    if (preferred < 0) preferred = days.findIndex(d => d.isRunDay);
    if (preferred < 0) preferred = 0;
    return { days, preferred };
  }

  /** Calls cb(step, inRepeat, round) for every step as it will be run (repeats expanded). */
  function eachStep(workout, cb) {
    (workout && Array.isArray(workout.steps) ? workout.steps : []).forEach(item => {
      if (item && item.kind === 'repeat') {
        for (let i = 0; i < item.count; i++) item.steps.forEach(s => cb(s, true, i));
      } else if (item) cb(item, false, 0);
    });
  }
  function midPace(target) {
    return target && target.type === 'pace' ? (target.fastSecPerKm + target.slowSecPerKm) / 2 : null;
  }
  /** Middle of the easy range from derivePaces (the estimate's pace for unpaced steps), or null. */
  function easyMid(paces) {
    return paces && paces.easy ? (paces.easy.fastSecPerKm + paces.easy.slowSecPerKm) / 2 : null;
  }

  /**
   * workoutStats(workout, paces) -> { distance: { meters, approx } | null, time: { seconds, approx } | null,
   *                                   target: { fast, slow } | { label } | null, estimate } | null
   * Exact sums when every step has that kind of duration; otherwise VeyvoWorkouts.estimate (pace
   * steps at the middle of their range, others at the middle of the easy range) marked approx.
   */
  function workoutStats(workout, paces) {
    if (!workout || !Workouts.validate(workout).ok) return null;
    const easy = easyMid(paces);
    const estimate = Workouts.estimate(workout, { easyPaceSecPerKm: easy });
    // VeyvoWorkouts.estimate runs open-target steps at easy pace. An all-out step (the 5 km test's
    // labelled open step) is timed at the runner's current 5 km pace instead (derivePaces: best / 5,
    // or goal + 15 s without a best), so the test isn't estimated as a jog.
    const allOut = paces && paces.basis && paces.basis.best5kSeconds ? paces.basis.best5kSeconds / 5 : (paces ? paces.currentSecPerKm : null);
    let allDistance = true, allTime = true, meters = 0, seconds = 0;
    eachStep(workout, s => {
      if (s.duration.type === 'distance') { meters += s.duration.meters; allTime = false; }
      else if (s.duration.type === 'time') { seconds += s.duration.seconds; allDistance = false; }
      else { allDistance = false; allTime = false; }
    });
    if (estimate && estimate.complete && easy && allOut) {
      eachStep(workout, st => {
        if (st.intensity === 'active' && st.duration.type === 'distance' && st.target.type === 'open' && typeof st.label === 'string' && st.label.trim()) {
          estimate.seconds = Math.round(estimate.seconds + st.duration.meters / 1000 * (allOut - easy));
        }
      });
    }
    const full = estimate && estimate.complete;
    const distance = allDistance ? { meters, approx: false } : (full && estimate.distanceM > 0 ? { meters: estimate.distanceM, approx: true } : null);
    const time = allTime ? { seconds, approx: false } : (full && estimate.seconds > 0 ? { seconds: estimate.seconds, approx: true } : null);
    return { distance, time, target: mainTarget(workout), estimate };
  }

  /** The first active step's pace range, else its label (e.g. 'Naplno'), else null. */
  function mainTarget(workout) {
    let found = null, label = null;
    eachStep(workout, s => {
      if (found || s.intensity !== 'active') return;
      if (s.target && s.target.type === 'pace') found = { fast: s.target.fastSecPerKm, slow: s.target.slowSecPerKm };
      else if (!label && typeof s.label === 'string' && s.label.trim()) label = s.label.trim();
    });
    return found || (label ? { label } : null);
  }

  /**
   * profileBlocks(workout, { easyPace, refPace }) -> [{ intensity, seconds, level, inRepeat, labelled }]
   * A drawing of the prescription: width ~ planned seconds, height ~ intensity (faster than the
   * reference pace = taller). Decorative only; the step list carries the real numbers.
   */
  function profileBlocks(workout, options) {
    const o = options || {};
    const easy = o.easyPace > 0 ? o.easyPace : DRAW_PACE;
    const ref = o.refPace > 0 ? o.refPace : null;
    const out = [];
    eachStep(workout, (s, inRepeat) => {
      const pace = midPace(s.target) || easy;
      let seconds;
      if (s.duration.type === 'time') seconds = s.duration.seconds;
      else if (s.duration.type === 'distance') seconds = s.duration.meters / 1000 * pace;
      else seconds = DRAW_OPEN_SECONDS;
      const labelled = typeof s.label === 'string' && !!s.label.trim();
      let level;
      if (s.intensity === 'warmup' || s.intensity === 'cooldown') level = 0.34;
      else if (s.intensity === 'recovery') level = 0.22;
      else if (s.intensity === 'rest') level = 0.14;
      else if (s.target && s.target.type === 'pace' && ref) level = Math.max(0.42, Math.min(1, Math.pow(ref / pace, 2)));
      else level = labelled ? 1 : 0.62;
      out.push({ intensity: s.intensity, seconds: Math.max(1, seconds), level: Math.round(level * 100) / 100, inRepeat, labelled });
    });
    return out;
  }

  /**
   * paceBasis(templateId, paces, paced) -> where a library session's target pace comes from:
   *   { rule: 'test' | 'byFeel' }
   *   { rule: 'easy'|'rep400'|'rep1k'|'threshold', from: 'goal'|'best'|'goalPlus', time, pace, approx }
   * time = the 5 km time it starts from; pace = the base pace per km (rounded to 5 s by
   * derivePaces for goal/current, hence approx when that rounding changed it).
   */
  function paceBasis(templateId, paces, paced) {
    if (templateId === 'test5k') return { rule: 'test' };
    if (!paces || paced === false || !paces.basis) return { rule: 'byFeel' };
    const best = paces.basis.best5kSeconds, target = paces.basis.targetSeconds;
    const near = (a, b) => Math.abs(a - b) < 0.5;
    if (templateId === 'easy' || templateId === 'long') {
      if (best != null) return { rule: 'easy', from: 'best', time: best, pace: best / 5, approx: false };
      return { rule: 'easy', from: 'goalPlus', time: target, pace: paces.currentSecPerKm, approx: !near(target / 5 + 15, paces.currentSecPerKm) };
    }
    if (templateId === 'intervals400' || templateId === 'intervals1k') {
      const fromGoal = target != null;
      const time = fromGoal ? target : best;
      return { rule: templateId === 'intervals400' ? 'rep400' : 'rep1k', from: fromGoal ? 'goal' : 'best', time, pace: paces.goalSecPerKm, approx: !near(time / 5, paces.goalSecPerKm) };
    }
    if (templateId === 'threshold') {
      if (best != null) return { rule: 'threshold', from: 'best', time: best, pace: paces.currentSecPerKm, approx: !near(best / 5, paces.currentSecPerKm) };
      return { rule: 'threshold', from: 'goalPlus', time: target, pace: paces.currentSecPerKm, approx: !near(target / 5 + 15, paces.currentSecPerKm) };
    }
    return { rule: 'byFeel' };
  }

  /**
   * paceContext(target, paces) -> { lo, hi, band: { from, to }, goal, best } | null (positions 0..1,
   * left = faster). Puts a workout's target range next to the goal pace (goal time / 5) and the best
   * 5 km pace (best / 5), all from the runner's own numbers.
   */
  function paceContext(target, paces) {
    if (!target || !(target.fast > 0) || !(target.slow > target.fast)) return null;
    const b = paces && paces.basis ? paces.basis : {};
    const goal = b.targetSeconds ? b.targetSeconds / 5 : null;
    const best = b.best5kSeconds ? b.best5kSeconds / 5 : null;
    const values = [target.fast, target.slow, goal, best].filter(v => typeof v === 'number' && v > 0);
    const lo = Math.floor((Math.min.apply(null, values) - 12) / 15) * 15;
    const hi = Math.ceil((Math.max.apply(null, values) + 12) / 15) * 15;
    const at = v => v == null ? null : Math.round((v - lo) / (hi - lo) * 1000) / 1000;
    return { lo, hi, band: { from: at(target.fast), to: at(target.slow) }, goal: at(goal), best: at(best), goalPace: goal, bestPace: best };
  }

  function runTypeOf(templateId) { return TEMPLATE_RUN_TYPE[templateId] || 'easy'; }

  /**
   * prefill({ templateId, nextRun, stats }) -> { type, distance? } for the run dialog ("Zapsat výsledek").
   * Library sessions: the session's run type and its planned distance (5 km for the test); the
   * engine's easy run: its distance (none after a long break, which is time-based).
   */
  function prefill(source) {
    const s = source || {};
    const type = s.templateId ? runTypeOf(s.templateId) : 'easy';
    let distance = null;
    if (s.templateId === 'test5k') distance = 5;
    else if (!s.templateId && s.nextRun && !s.nextRun.returnAfterBreak && s.nextRun.distanceKm > 0) distance = s.nextRun.distanceKm;
    else if (s.stats && s.stats.distance) distance = Math.round(s.stats.distance.meters / 100) / 10;
    return distance ? { type, distance } : { type };
  }

  /** A result can't be logged in the future: the planned date when it has come, else today. */
  function logDate(plannedDate, todayKey) {
    return isKey(plannedDate) && plannedDate <= todayKey ? plannedDate : todayKey;
  }

  const model = Object.freeze({
    WEEK_LIMIT, SCHEDULE_DAYS, TEMPLATE_RUN_TYPE,
    runDays, weekOffsetOf, clampOffset, buildWeek, scheduleCandidates,
    workoutStats, mainTarget, profileBlocks, paceBasis, paceContext, runTypeOf, prefill, logDate, easyMid
  });

  // ================================================================ texts (namespace 'plan')

  const MESSAGES = {
    cs: {
      week: {
        current: 'Tento týden', previous: 'Minulý týden', next: 'Příští týden',
        ago: { one: 'Před {n} týdnem', few: 'Před {n} týdny', many: 'Před {n} týdne', other: 'Před {n} týdny' },
        ahead: { one: 'Za {n} týden', few: 'Za {n} týdny', many: 'Za {n} týdne', other: 'Za {n} týdnů' },
        nav: 'Procházení týdnů', prev: 'Předchozí týden', following: 'Následující týden',
        thisWeek: 'Tento týden', latest: 'Poslední trénink',
        none: 'Zatím bez běhu', nonePast: 'Bez běhu', planned: 'v plánu {what}',
        days: 'Dny týdne {range}'
      },
      day: {
        rest: 'Volno', unlogged: 'Bez záznamu', runDay: 'Běžecký den', today: 'Dnes', plan: 'Plán', done: 'Splněno',
        log: 'Zapsat běh: {date}', menu: 'Možnosti dne: {date}', addAnother: 'Přidat další běh',
        editRun: 'Upravit běh {what}', openRun: 'Upravit běh: {what}', openPlan: 'Otevřít trénink: {name}',
        remove: 'Odebrat z plánu: {name}', suggested: 'Navržený běh', missed: 'Neodběhnuto', planNote: 'Plán: {name}'
      },
      next: {
        eyebrow: 'Další trénink', today: 'Dnes', fromLibrary: 'Z knihovny',
        distance: 'Vzdálenost', duration: 'Doba', target: 'Cílové tempo', byFeel: 'Podle pocitu', allOut: 'Naplno',
        toWatch: 'Do hodinek', logResult: 'Zapsat výsledek',
        basisRun: 'Navrženo po běhu {date}, {distance}', basisEffort: 'Navrženo po běhu {date}, {distance}, úsilí {effort}/10',
        basisLibrary: 'Trénink z knihovny má v tento den přednost před navrženým lehkým během.',
        steps: 'Průběh tréninku',
        restTitle: 'Odpočinek',
        restText: 'Poslední běh {date} měl úsilí {effort}/10. Odpočívej, dokud se necítíš svěží. Další trénink se navrhne po tvém dalším běhu.',
        emptyTitle: 'Další trénink se ukáže po prvním běhu',
        emptyText: 'Zapiš běh a VEYVO podle času a úsilí navrhne lehký běh na nejbližší běžecký den. Mezitím si můžeš naplánovat trénink z knihovny.',
        emptyAction: 'Zapsat první běh',
        adviceTitle: 'Dnes raději odpočívej.',
        adviceToday: 'Dnešní regenerace: únava {fatigue}/10, bolest svalů {soreness}/10. Dnešní trénink odlož nebo zkrať.',
        adviceLater: 'Dnešní regenerace: únava {fatigue}/10, bolest svalů {soreness}/10. Pokud se do {date} necítíš lépe, trénink odlož nebo zkrať.'
      },
      step: { byFeel: 'podle pocitu', untilLap: 'do stisku Lap', repeat: 'Opakuj {n}×', hr: '{low}–{high} tep/min' },
      ctx: {
        title: 'Tempo v kontextu', faster: 'rychleji', slower: 'pomaleji',
        workout: 'Tento trénink', goal: 'Cílové tempo', best: 'Nejlepší 5 km'
      },
      library: {
        title: 'Knihovna tréninků',
        sub: 'Tempa z tvého cíle a nejlepšího výsledku na 5 km',
        subByFeel: 'Bez cíle a výsledku na 5 km se běží podle pocitu',
        subGoal: 'Tempa z tvého cíle na 5 km', subBest: 'Tempa z tvého nejlepšího výsledku na 5 km',
        purpose: {
          easy: 'Základ týdne. Buduje vytrvalost a pomáhá regeneraci mezi rychlými tréninky.',
          intervals400: 'Krátké rychlé úseky pro rychlost a lehký krok nad cílovým tempem.',
          intervals1k: 'Delší úseky přesně v cílovém tempu, abys ho poznal a udržel.',
          threshold: 'Úseky „příjemně ztěžka“ posouvají tempo, které vydržíš dlouho.',
          long: 'Nejdelší běh týdne v klidném tempu pro aerobní základ.',
          test5k: 'Kontrola formy. Výsledek se stane novým základem všech temp.'
        },
        toWatch: 'Do hodinek', schedule: 'Naplánovat…', scheduledOn: 'V plánu {date}',
        toWatchLabel: 'Do hodinek: {name}', scheduleLabel: 'Naplánovat: {name}', steps: 'Kroky tréninku {name}'
      },
      basis: {
        fromGoal: 'z cíle {time}', fromBest: 'z 5 km za {time}', fromGoalPlus: 'z cíle {time} + 15 s/km',
        pace: '{pace} /km', paceApprox: '≈ {pace} /km', gives: 'dává',
        rule: { easy: 'o 20–45 % pomaleji', rep400: 'o 3–10 s/km rychleji', rep1k: 'nejvýš o 5 s/km pomaleji', threshold: 'o 8–15 s/km pomaleji' },
        test: 'Bez cílového tempa, naplno. Výsledek přepočítá tempa ostatních tréninků.',
        byFeel: 'Podle pocitu. Tempa se dopočítají, až nastavíš cíl na 5 km nebo zapíšeš 5 km.'
      },
      upcoming: {
        title: 'Naplánované tréninky',
        empty: 'Zatím nic. Trénink z knihovny přidáš tlačítkem Naplánovat.'
      },
      availability: {
        title: 'Běžecké dny', line: 'Běžecké dny: {days}', edit: 'Upravit', editLabel: 'Upravit běžecké dny',
        explain: 'Po každém zapsaném běhu VEYVO naplánuje lehký běh na nejbližší vhodný běžecký den. Trénink z knihovny má v daný den přednost.',
        on: '{day}: běžecký den', off: '{day}: volno'
      },
      schedule: {
        title: 'Naplánovat trénink',
        hint: 'Vyber den v příštích 14 dnech. Tvé běžecké dny jsou zvýrazněné.',
        grid: 'Den tréninku', confirm: 'Naplánovat',
        runDay: 'běžecký den', restDay: 'volno', hasSession: 'naplánováno: {name}', suggested: 'navržený lehký běh', hasRun: 'už máš zaběhnuto',
        replaces: 'Nahradí naplánovaný trénink {name}.', overrides: 'Má přednost před navrženým lehkým během.',
        onRest: 'Tento den nepatří mezi tvé běžecké dny.', ranAlready: 'V tento den už máš zapsaný běh.',
        already: 'Už v plánu', remove: 'Odebrat', removeLabel: 'Odebrat z plánu: {date}',
        legend: { run: 'běžecký den', session: 'trénink z knihovny', engine: 'navržený lehký běh', today: 'dnes' }
      },
      toast: { scheduled: 'Naplánováno na {date}: {name}.', removed: 'Odebráno z plánu: {name}.' }
    },
    en: {
      week: {
        current: 'This week', previous: 'Last week', next: 'Next week',
        ago: { one: '{n} week ago', other: '{n} weeks ago' },
        ahead: { one: 'In {n} week', other: 'In {n} weeks' },
        nav: 'Browse weeks', prev: 'Previous week', following: 'Following week',
        thisWeek: 'This week', latest: 'Latest run',
        none: 'No runs yet', nonePast: 'No runs', planned: '{what} planned',
        days: 'Days of the week {range}'
      },
      day: {
        rest: 'Rest day', unlogged: 'Not logged', runDay: 'Running day', today: 'Today', plan: 'Plan', done: 'Done',
        log: 'Log a run: {date}', menu: 'Day options: {date}', addAnother: 'Add another run',
        editRun: 'Edit run {what}', openRun: 'Edit run: {what}', openPlan: 'Open workout: {name}',
        remove: 'Remove from plan: {name}', suggested: 'Suggested run', missed: 'Not done', planNote: 'Plan: {name}'
      },
      next: {
        eyebrow: 'Next workout', today: 'Today', fromLibrary: 'From the library',
        distance: 'Distance', duration: 'Duration', target: 'Target pace', byFeel: 'By feel', allOut: 'All-out',
        toWatch: 'Send to watch', logResult: 'Log result',
        basisRun: 'Suggested after your run on {date}, {distance}', basisEffort: 'Suggested after your run on {date}, {distance}, effort {effort}/10',
        basisLibrary: 'A library session takes priority over the suggested easy run on this day.',
        steps: 'Workout steps',
        restTitle: 'Rest',
        restText: 'Your last run on {date} was effort {effort}/10. Rest until you feel fresh. The next workout is suggested after your next run.',
        emptyTitle: 'Your next workout appears after your first run',
        emptyText: 'Log a run and VEYVO suggests an easy run on your next running day, based on its time and effort. Meanwhile you can schedule a session from the library.',
        emptyAction: 'Log your first run',
        adviceTitle: 'Better rest today.',
        adviceToday: 'Today’s check-in: fatigue {fatigue}/10, muscle soreness {soreness}/10. Postpone or shorten today’s workout.',
        adviceLater: 'Today’s check-in: fatigue {fatigue}/10, muscle soreness {soreness}/10. If you don’t feel better by {date}, postpone or shorten the workout.'
      },
      step: { byFeel: 'by feel', untilLap: 'until you press Lap', repeat: 'Repeat {n}×', hr: '{low}–{high} bpm' },
      ctx: {
        title: 'Pace in context', faster: 'faster', slower: 'slower',
        workout: 'This workout', goal: 'Goal pace', best: 'Best 5 km'
      },
      library: {
        title: 'Session library',
        sub: 'Paces from your goal and your best 5 km',
        subByFeel: 'Without a goal or a 5 km result, sessions are run by feel',
        subGoal: 'Paces from your 5 km goal', subBest: 'Paces from your best 5 km',
        purpose: {
          easy: 'The base of the week. Builds endurance and helps you recover between faster sessions.',
          intervals400: 'Short fast reps for speed and light, quick steps above goal pace.',
          intervals1k: 'Longer reps right at goal pace, so you learn it and can hold it.',
          threshold: '“Comfortably hard” reps raise the pace you can hold for a long time.',
          long: 'The longest run of the week at a relaxed pace, for your aerobic base.',
          test5k: 'A fitness check. The result becomes the new basis for every pace.'
        },
        toWatch: 'Send to watch', schedule: 'Schedule…', scheduledOn: 'Planned {date}',
        toWatchLabel: 'Send to watch: {name}', scheduleLabel: 'Schedule: {name}', steps: 'Steps of {name}'
      },
      basis: {
        fromGoal: 'goal {time}', fromBest: '5 km in {time}', fromGoalPlus: 'goal {time} + 15 s/km',
        pace: '{pace} /km', paceApprox: '≈ {pace} /km', gives: 'gives',
        rule: { easy: '20–45 % slower', rep400: '3–10 s/km faster', rep1k: 'up to 5 s/km slower', threshold: '8–15 s/km slower' },
        test: 'No target pace, all-out. The result recalculates the paces of the other sessions.',
        byFeel: 'By feel. Paces appear once you set a 5 km goal or log a 5 km.'
      },
      upcoming: {
        title: 'Scheduled sessions',
        empty: 'Nothing yet. Add a library session with Schedule.'
      },
      availability: {
        title: 'Running days', line: 'Running days: {days}', edit: 'Edit', editLabel: 'Edit running days',
        explain: 'After every logged run, VEYVO plans an easy run on your next suitable running day. A library session takes priority on its day.',
        on: '{day}: running day', off: '{day}: rest day'
      },
      schedule: {
        title: 'Schedule a session',
        hint: 'Pick a day in the next 14 days. Your running days are highlighted.',
        grid: 'Workout day', confirm: 'Schedule',
        runDay: 'running day', restDay: 'rest day', hasSession: 'planned: {name}', suggested: 'suggested easy run', hasRun: 'run already logged',
        replaces: 'Replaces the planned session {name}.', overrides: 'Takes priority over the suggested easy run.',
        onRest: 'This day is not one of your running days.', ranAlready: 'You already logged a run on this day.',
        already: 'Already planned', remove: 'Remove', removeLabel: 'Remove from plan: {date}',
        legend: { run: 'running day', session: 'library session', engine: 'suggested easy run', today: 'today' }
      },
      toast: { scheduled: 'Scheduled for {date}: {name}.', removed: 'Removed from plan: {name}.' }
    }
  };
  if (I18n) I18n.register('plan', MESSAGES);

  if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign({ MESSAGES }, model);
  const UI = root.VeyvoUI;
  if (UI) UI.planModel = model;
  const app = UI && UI.app;
  if (!app || !root.document) return; // Node tests: model + texts only

  // ================================================================ 2. page

  const Store = root.VeyvoStore;
  const dom = UI.dom, h = dom.h, fmt = UI.fmt, icons = UI.icons, motion = UI.motion, charts = UI.charts;
  const t = (key, params) => app.t(key, params);
  const NB = fmt.NB;

  let weekOffset = 0;          // shown week relative to today's week
  let weekSlide = 0;           // -1 / +1: animate the days in from that side on the next render
  let flashDate = null;        // day cell to highlight once after scheduling
  let pendingFocus = null;     // data-key to focus after the next render (when the old target is gone)

  // ---------------------------------------------------------------- small builders

  function paceRange(fast, slow) { return fmt.pace(fast) + '–' + fmt.pace(slow); }
  function paceRangeUnit(fast, slow) { return paceRange(fast, slow) + NB + '/km'; }
  function rangeVal(target, cls) { return dom.val(paceRange(target.fast, target.slow), '/km', { cls }); }
  function kmVal(meters, cls) { return dom.val(fmt.km(meters / 1000), 'km', { cls }); }
  function minutesOf(seconds) { return Math.max(1, Math.round(seconds / 60)); }
  /** 47 min -> [47 min]; 65 min -> [1 h] [5 min] (Barlow numbers, small units). */
  function durationVal(seconds, cls) {
    const total = minutesOf(seconds);
    const hrs = Math.floor(total / 60), mins = total % 60;
    if (!hrs) return dom.val(String(total), 'min', { cls });
    return h('span.plan-dur', { class: cls }, dom.val(String(hrs), 'h'), mins ? [NB, dom.val(String(mins), 'min')] : null);
  }
  function approx(node, isApprox) { return isApprox ? h('span.plan-approx', h('span.plan-approx-sign', { 'aria-hidden': 'true' }, '≈' + NB), node) : node; }
  function stepAmount(step, locale) {
    const d = step.duration;
    if (d.type === 'time') return fmt.typo(Workouts.format.time(d.seconds));
    if (d.type === 'distance') return fmt.typo(Workouts.format.distance(d.meters, locale));
    return t('plan.step.untilLap');
  }
  function stepTarget(step) {
    const tg = step.target;
    if (tg && tg.type === 'pace') return { text: paceRangeUnit(tg.fastSecPerKm, tg.slowSecPerKm), strong: true };
    if (tg && tg.type === 'hr') return { text: t('plan.step.hr', { low: Math.round(tg.lowBpm), high: Math.round(tg.highBpm) }), strong: true };
    if (step.intensity === 'active' && step.label) return { text: '', strong: false };
    return { text: t('plan.step.byFeel'), strong: false };
  }
  function groupOfTemplate(templateId) { return charts.groupOf(model.runTypeOf(templateId)); }
  function templateName(tpl) { return tpl ? fmt.typo(t(tpl.nameKey, tpl.params)) : ''; }
  function sessionName(entry) {
    if (!entry) return '';
    if (entry.template) return templateName(entry.template);
    return entry.workout ? fmt.typo(entry.workout.name) : String(entry.templateId || '');
  }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function shortDate(key) { return fmt.date(key, 'short'); }
  function runWhat(run) { return fmt.kmUnit(run.distance) + ', ' + fmt.duration(run.movingSeconds); }

  function openExport(params) {
    const name = app.dialogs.has('workoutExport') ? 'workoutExport' : 'workout';
    app.dialogs.open(name, { workout: clone(params.workout), date: params.date || undefined, templateId: params.templateId || undefined });
  }
  function openLog(date, prefill) {
    app.dialogs.open('run', prefill ? { mode: 'new', date, prefill } : { mode: 'new', date });
  }
  function unschedule(entry, focusKey) {
    const name = sessionName(entry);
    pendingFocus = focusKey || null;
    app.update(s => Store.unschedulePlanned(s, entry.date), {
      reason: 'plan-unschedule', toast: t('plan.toast.removed', { name }), undo: true
    });
  }

  /** Intensity profile: one block per step as run (repeats expanded). Decorative (aria-hidden). */
  function profile(workout, d, group, opts) {
    const o = opts || {};
    const blocks = model.profileBlocks(workout, { easyPace: model.easyMid(d.paces), refPace: d.paces ? d.paces.goalSecPerKm : null });
    const total = blocks.reduce((sum, b) => sum + b.seconds, 0) || 1;
    return h('div.plan-profile', { class: [o.small && 'plan-profile-sm', 'plan-g-' + group], 'aria-hidden': 'true' },
      blocks.map((b, i) => h('i', {
        class: ['plan-blk', 'plan-blk-' + b.intensity, b.labelled && 'plan-blk-all', o.animate !== false && 'grow-y'],
        style: { flexGrow: String(Math.max(0.001, b.seconds / total * 100)), '--lv': String(b.level), '--i': String(Math.min(i, 14)) }
      })));
  }

  /** Target range vs goal pace vs best 5 km pace on one fast-to-slow track (numbers in the legend). */
  function paceContextNode(target, d, group) {
    const c = model.paceContext(target, d.paces);
    if (!c) return null;
    const pct = v => (v * 100).toFixed(1) + '%';
    const item = (cls, label, value) => h('li', h('i', { class: 'plan-ctx-key ' + cls, 'aria-hidden': 'true' }),
      h('span.plan-ctx-k', label), h('span.plan-ctx-v.num', value));
    return h('div.plan-ctx', { class: 'plan-g-' + group },
      h('div.plan-ctx-head', h('span.plan-ctx-title', t('plan.ctx.title'))),
      h('div.plan-ctx-track', { 'aria-hidden': 'true' },
        h('i.plan-ctx-rail'),
        h('i.plan-ctx-band.grow-x', { style: { left: pct(c.band.from), width: pct(Math.max(0.012, c.band.to - c.band.from)) } }),
        c.best != null ? h('i.plan-ctx-mark.plan-ctx-best.pop', { style: { left: pct(c.best), '--i': '3' } }) : null,
        c.goal != null ? h('i.plan-ctx-mark.plan-ctx-goal.pop', { style: { left: pct(c.goal), '--i': '4' } }) : null),
      h('div.plan-ctx-axis', { 'aria-hidden': 'true' },
        h('span', h('span.num', fmt.pace(c.lo)), ' ', t('plan.ctx.faster')),
        h('span', t('plan.ctx.slower'), ' ', h('span.num', fmt.pace(c.hi)))),
      h('ul.plan-ctx-legend',
        item('plan-ctx-key-band', t('plan.ctx.workout'), paceRangeUnit(target.fast, target.slow)),
        c.goalPace ? item('plan-ctx-key-goal', t('plan.ctx.goal'), fmt.paceUnit(c.goalPace)) : null,
        c.bestPace ? item('plan-ctx-key-best', t('plan.ctx.best'), fmt.paceUnit(c.bestPace)) : null));
  }

  /** Structured step list: warm-up / repeat block / cool-down with paces. */
  function stepList(workout, ctx, group, label) {
    const locale = ctx.locale;
    const row = (step, inRepeat) => {
      const target = stepTarget(step);
      return h('li.plan-step', { class: 'plan-step-' + step.intensity },
        h('i.plan-step-bar', { 'aria-hidden': 'true' }),
        h('span.plan-step-name', Workouts.stepName(step, locale, inRepeat)),
        h('span.plan-step-amt.num', stepAmount(step, locale)),
        h('span', { class: ['plan-step-target', target.strong ? 'num' : 'faint'] }, target.text));
    };
    return h('ol.plan-steps', { class: 'plan-g-' + group, 'aria-label': label },
      workout.steps.map(item => item.kind === 'repeat'
        ? h('li.plan-rep',
          h('span.plan-rep-n.num', { 'aria-hidden': 'true' }, item.count + '×'),
          h('span.sr-only', t('plan.step.repeat', { n: item.count })),
          h('ol.plan-rep-steps', item.steps.map(s => row(s, true))))
        : row(item, false)));
  }

  /** "z cíle 20:00 [arrow] 4:00 /km · o 3–10 s/km rychleji" - the formula behind a library pace. */
  function basisLine(templateId, d, paced) {
    const b = model.paceBasis(templateId, d.paces, paced);
    if (b.rule === 'test' || b.rule === 'byFeel') return h('p.plan-basis', t('plan.basis.' + b.rule));
    const fromKey = b.from === 'goal' ? 'fromGoal' : b.from === 'best' ? 'fromBest' : 'fromGoalPlus';
    return h('p.plan-basis',
      h('span', t('plan.basis.' + fromKey, { time: fmt.duration(b.time) })),
      icons.get('arrow-right', { size: 13, className: 'plan-basis-arrow' }),
      h('span.sr-only', ' ' + t('plan.basis.gives') + ' '),
      h('span.plan-basis-pace', t(b.approx ? 'plan.basis.paceApprox' : 'plan.basis.pace', { pace: fmt.pace(b.pace) })),
      h('span.plan-basis-sep', { 'aria-hidden': 'true' }, ' · '),
      h('span', t('plan.basis.rule.' + b.rule)));
  }

  /**
   * Day menu: a popover (popovertarget = native toggle, light dismiss, Esc, focus back to the button)
   * with arrow-key navigation. Without the Popover API it falls back to a toggled panel.
   */
  function dayMenu(label, key, items) {
    const id = dom.uid('plan-menu');
    const btn = h('button.icon-btn.icon-btn-sm.plan-day-btn.plan-day-more', {
      type: 'button', 'aria-label': label, title: label, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': id, dataset: { key }
    }, icons.get('more'));
    const menu = h('div.plan-menu', { role: 'menu', 'aria-label': label, id });
    const entries = items.map(it => h('button.plan-menu-item', { type: 'button', role: 'menuitem', tabindex: '-1' },
      icons.get(it.icon, { size: 16 }), h('span', it.label)));
    menu.append.apply(menu, entries);
    const native = typeof menu.showPopover === 'function';
    // Anchor to the button's right edge; flip above when there is no room below.
    const place = () => {
      const r = btn.getBoundingClientRect();
      const estimate = entries.length * 44 + 10;
      menu.style.right = Math.max(8, root.innerWidth - r.right) + 'px';
      menu.style.left = 'auto';
      if (r.bottom + 4 + estimate > root.innerHeight - 8 && r.top - estimate > 8) {
        menu.style.top = 'auto'; menu.style.bottom = (root.innerHeight - r.top + 4) + 'px';
      } else {
        menu.style.bottom = 'auto'; menu.style.top = (r.bottom + 4) + 'px';
      }
    };
    let open = false, offDoc = null, anchor = null;
    // Fallback only: position: fixed is relative to an ancestor with a transform (the day card keeps one
    // from its entrance animation), so the open menu lives in <body>, where place() is viewport-based.
    const lift = () => {
      if (anchor || !menu.parentNode) return;
      anchor = root.document.createComment('plan-menu');
      menu.parentNode.insertBefore(anchor, menu);
      root.document.body.append(menu);
    };
    const land = () => {
      if (!anchor) return;
      if (anchor.isConnected) anchor.replaceWith(menu); else menu.remove();
      anchor = null;
    };
    const opened = state => {
      open = state;
      btn.setAttribute('aria-expanded', state ? 'true' : 'false');
      btn.classList.toggle('is-open', state);
      if (state) entries[0].focus({ preventScroll: true });
    };
    const hide = refocus => {
      if (!open) return;
      if (native) { try { menu.hidePopover(); } catch (e) { /* already hidden */ } }
      else { menu.hidden = true; land(); opened(false); if (offDoc) offDoc(); }
      if (refocus) btn.focus({ preventScroll: true });
    };
    if (native) {
      menu.setAttribute('popover', 'auto');
      btn.setAttribute('popovertarget', id);
      let hadFocus = false;
      menu.addEventListener('beforetoggle', e => {
        if (e.newState === 'open') place();
        else hadFocus = menu.contains(root.document.activeElement);
      });
      menu.addEventListener('toggle', e => {
        opened(e.newState === 'open');
        if (e.newState !== 'open' && hadFocus && root.document.activeElement !== btn && btn.isConnected) btn.focus({ preventScroll: true });
      });
    } else {
      menu.hidden = true;
      btn.addEventListener('click', () => {
        if (open) { hide(false); return; }
        lift();
        place();
        menu.hidden = false;
        opened(true);
        const onDown = e => { if (!menu.contains(e.target) && !btn.contains(e.target)) hide(false); };
        root.document.addEventListener('pointerdown', onDown, true);
        offDoc = () => { root.document.removeEventListener('pointerdown', onDown, true); offDoc = null; };
      });
    }
    menu.addEventListener('keydown', e => {
      const i = entries.indexOf(root.document.activeElement);
      let next = null;
      if (e.key === 'ArrowDown') next = (i + 1) % entries.length;
      else if (e.key === 'ArrowUp') next = (i - 1 + entries.length) % entries.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = entries.length - 1;
      else if (e.key === 'Escape' && !native) { e.preventDefault(); hide(true); return; }
      else if (e.key === 'Tab') { hide(false); return; }
      if (next !== null) { e.preventDefault(); entries[next].focus(); }
    });
    entries.forEach((el, i) => el.addEventListener('click', () => { hide(false); items[i].run(); }));
    return [btn, menu];
  }

  // ---------------------------------------------------------------- week board

  function weekLabel(offset) {
    if (offset === 0) return t('plan.week.current');
    if (offset === -1) return t('plan.week.previous');
    if (offset === 1) return t('plan.week.next');
    return offset < 0 ? t('plan.week.ago', { n: -offset }) : t('plan.week.ahead', { n: offset });
  }

  function summaryLine(week, ctx) {
    const s = week.summary;
    const parts = [];
    if (s.count) {
      const countText = fmt.count('common.count.runs', s.count);
      const m = countText.match(/^(\S+?) (.+)$/);
      parts.push(m ? h('span', h('b.num.plan-sum-n', m[1]), NB + m[2]) : h('span', countText));
      parts.push(h('span', h('b.num.plan-sum-n', { dataset: { countKm: String(s.distanceKm) } }, fmt.km(s.distanceKm)), h('span.unit', NB + 'km')));
      parts.push(h('span', h('b.num.plan-sum-n', fmt.duration(s.movingSeconds))));
    } else {
      parts.push(h('span', t(week.sunday < ctx.today ? 'plan.week.nonePast' : 'plan.week.none')));
    }
    if (s.plannedCount) parts.push(h('span.plan-sum-plan', t('plan.week.planned', { what: fmt.count('common.count.workouts', s.plannedCount) })));
    const out = [];
    parts.forEach((p, i) => { if (i) out.push(h('span.plan-sum-sep', { 'aria-hidden': 'true' }, '·')); out.push(p); });
    return h('p.plan-week-sum', { 'aria-live': 'polite' }, out);
  }

  function runBlock(run, day, ctx) {
    const what = runWhat(run);
    const pace = run.distance > 0 ? run.movingSeconds / run.distance : null;
    const multi = day.runs.length > 1;
    return h('button.plan-run', {
      type: 'button', 'aria-label': t('plan.day.openRun', { what: charts.typeLabel(run.type) + ', ' + what }),
      dataset: { key: 'plan-run:' + run.id },
      onClick: () => app.dialogs.open('run', { mode: 'edit', runId: run.id })
    },
    ctx.components.create('typeTag', { type: run.type }),
    h('span.plan-run-main', kmVal(run.distance * 1000), h('span.plan-run-sep', { 'aria-hidden': 'true' }, '·'), h('span.num', fmt.duration(run.movingSeconds))),
    !multi && pace ? h('span.plan-run-pace', dom.val(fmt.pace(pace), '/km')) : null);
  }

  function engineBlock(day, ctx) {
    const d = ctx.derived, nr = day.engine;
    const w = d.nextWorkout && d.nextRun && d.nextRun.date === day.date ? d.nextWorkout : null;
    const name = w ? fmt.typo(w.name) : t('plan.day.suggested');
    const detail = nr.returnAfterBreak
      ? dom.val(String(nr.durationMax || nr.durationMin || 30), 'min')
      : kmVal(nr.distanceKm * 1000);
    const inner = [
      h('span.plan-item-title', h('i.dot.dot-easy', { 'aria-hidden': 'true' }), h('span.plan-item-name', name)),
      h('span.plan-item-main', detail),
      nr.paceFast && nr.paceSlow ? h('span.plan-item-pace', rangeVal({ fast: nr.paceFast, slow: nr.paceSlow })) : null
    ];
    return h('div.plan-item.plan-item-engine',
      w ? h('button.plan-item-open', { type: 'button', 'aria-label': t('plan.day.openPlan', { name }), dataset: { key: 'plan-eng:' + day.date }, onClick: () => openExport({ workout: w, date: day.date }) }, inner)
        : h('div.plan-item-open', inner));
  }

  function sessionBlock(day, ctx, faded) {
    const entry = day.session;
    const name = sessionName(entry);
    const tpl = entry.template;
    const stats = entry.workout ? model.workoutStats(entry.workout, ctx.derived.paces) : null;
    const group = groupOfTemplate(entry.templateId);
    return h('div.plan-item.plan-item-session', { class: faded ? 'is-faded' : null },
      h('button.plan-item-open', {
        type: 'button', 'aria-label': t('plan.day.openPlan', { name }), dataset: { key: 'plan-ses:' + day.date }, disabled: !entry.workout,
        onClick: () => openExport({ workout: entry.workout, date: day.date, templateId: entry.templateId })
      },
      h('span.plan-item-title', h('i', { class: 'dot dot-' + group, 'aria-hidden': 'true' }), h('span.plan-item-name', name)),
      stats && stats.target && stats.target.fast ? h('span.plan-item-pace', rangeVal(stats.target)) : null,
      faded ? h('span.plan-item-state', t('plan.day.missed')) : null),
      tpl || entry.workout ? h('button.icon-btn.icon-btn-sm.plan-item-x', {
        type: 'button', 'aria-label': t('plan.day.remove', { name }), title: t('plan.day.remove', { name }),
        dataset: { key: 'plan-x:' + day.date },
        onClick: () => unschedule(entry, 'plan-day:' + day.date)
      }, icons.get('x', { size: 14 })) : null);
  }

  function dayCell(day, ctx) {
    const dateLabel = fmt.date(day.date, 'short');
    const cls = ['plan-day', 'is-' + day.status, day.isToday && 'is-today', !day.isRunDay && 'is-off', day.date === flashDate && 'is-new'];
    let badge = null;
    if (day.status === 'done') badge = h('span.plan-day-check.pop', { title: t('plan.day.done') }, icons.get('check', { size: 13 }), h('span.sr-only', t('plan.day.done')));
    else if (day.isToday) badge = h('span.plan-day-tag.plan-tag-today', t('plan.day.today'));
    else if (day.status === 'planned' || day.status === 'session') badge = h('span.plan-day-tag.plan-tag-plan', t('plan.day.plan'));

    const body = [];
    if (day.runs.length) {
      day.runs.forEach(r => body.push(runBlock(r, day, ctx)));
      if (day.session) body.push(h('span.plan-day-note.truncate', t('plan.day.planNote', { name: sessionName(day.session) })));
    } else if (day.session) body.push(sessionBlock(day, ctx, day.status === 'missed'));
    else if (day.engine) body.push(engineBlock(day, ctx));
    else {
      const key = { rest: 'rest', unlogged: 'unlogged', today: 'runDay', open: 'runDay' }[day.status] || 'runDay';
      body.push(h('span.plan-day-state', t('plan.day.' + key)));
    }

    const actions = [];
    if (day.canLog) {
      const label = t('plan.day.log', { date: dateLabel });
      actions.push(h('button.icon-btn.icon-btn-sm.plan-day-btn.plan-day-add', {
        type: 'button', 'aria-label': label, title: label, dataset: { action: 'log-run', date: day.date, key: 'plan-add:' + day.date }
      }, icons.get('plus', { size: 16 })));
    } else if (day.canAddAnother) {
      const items = day.runs.map(r => ({ icon: 'edit', label: t('plan.day.editRun', { what: runWhat(r) }), run: () => app.dialogs.open('run', { mode: 'edit', runId: r.id }) }));
      items.push({ icon: 'plus', label: t('plan.day.addAnother'), run: () => openLog(day.date) });
      actions.push.apply(actions, dayMenu(t('plan.day.menu', { date: dateLabel }), 'plan-menu:' + day.date, items));
    }

    return h('li', { class: cls, dataset: { date: day.date, key: 'plan-day:' + day.date }, tabindex: '-1' },
      h('div.plan-day-head',
        h('span.plan-day-wd', { 'aria-hidden': 'true' }, I18n.t('common.weekdayShort.' + day.weekday)),
        h('span.plan-day-num.num', { 'aria-hidden': 'true' }, fmt.date(day.date, 'dayMonth').split(NB)[0]),
        h('span.sr-only', fmt.date(day.date, 'long')),
        badge),
      h('div.plan-day-body', body),
      actions.length ? h('div.plan-day-actions', actions) : null);
  }

  function weekBoard(ctx) {
    const d = ctx.derived;
    const week = model.buildWeek(d.runs, { todayKey: ctx.today, profile: d.profile, nextRun: d.nextRun, planned: d.planned, offset: weekOffset });
    const sameYear = week.monday.slice(0, 4) === ctx.today.slice(0, 4) && week.sunday.slice(0, 4) === ctx.today.slice(0, 4);
    const range = sameYear ? fmt.weekRange(week.monday, week.sunday) : root.VeyvoFormat.weekRange(week.monday, week.sunday, { year: true }).replace(/ /g, NB);
    const latestOffset = d.latestRun ? model.clampOffset(model.weekOffsetOf(d.latestRun.date, ctx.today)) : null;
    const go = (offset, dir) => { weekOffset = model.clampOffset(offset); weekSlide = dir; app.refresh(); };
    // aria-disabled (not disabled) keeps keyboard focus on the button after the week changes.
    const navBtn = (spec, props, off, run, child) => h(spec, Object.assign({
      type: 'button', 'aria-disabled': off ? 'true' : null, onClick: () => { if (!off) run(); }
    }, props), child);

    const nav = h('div.plan-week-nav', { role: 'group', 'aria-label': t('plan.week.nav') },
      navBtn('button.icon-btn.plan-nav-step', { 'aria-label': t('plan.week.prev'), title: t('plan.week.prev'), dataset: { key: 'plan-week-prev' } },
        weekOffset <= -model.WEEK_LIMIT, () => go(weekOffset - 1, -1), icons.get('chevron-left')),
      navBtn('button.btn.btn-sm.btn-ghost.plan-nav-txt', { dataset: { key: 'plan-week-now' } },
        weekOffset === 0, () => go(0, weekOffset > 0 ? -1 : 1), t('plan.week.thisWeek')),
      navBtn('button.btn.btn-sm.btn-ghost.plan-nav-txt', { dataset: { key: 'plan-week-latest' } },
        latestOffset === null || latestOffset === weekOffset, () => go(latestOffset, latestOffset < weekOffset ? -1 : 1), t('plan.week.latest')),
      navBtn('button.icon-btn.plan-nav-step', { 'aria-label': t('plan.week.following'), title: t('plan.week.following'), dataset: { key: 'plan-week-next' } },
        weekOffset >= model.WEEK_LIMIT, () => go(weekOffset + 1, 1), icons.get('chevron-right')));

    const list = h('ol.plan-days', { class: ctx.animate && !weekSlide ? 'stagger' : null, 'aria-label': t('plan.week.days', { range }) },
      week.days.map(day => dayCell(day, ctx)));

    const board = h('section.plan-week', { 'aria-labelledby': 'plan-week-title' },
      h('div.plan-week-head',
        h('div.plan-week-titles',
          h('h2.sec-title#plan-week-title', weekLabel(week.offset)),
          h('span.plan-week-range.num', range),
          summaryLine(week, ctx)),
        nav),
      list);
    return board;
  }

  // ---------------------------------------------------------------- next workout

  function statCell(label, value) {
    return h('div.plan-stat', h('span.plan-stat-label', label), h('span.plan-stat-value', value));
  }

  function nextCard(ctx) {
    const d = ctx.derived;
    const head = extra => h('div.plan-next-head', h('span.eyebrow', t('plan.next.eyebrow')), extra);
    // A library session scheduled before the engine's run (or while it says rest) is the next workout:
    // derived.nextSession is what home and the nav badge show, so the panel follows it.
    const early = d.nextSession && d.nextSession.source === 'planned' && d.nextSession.workout ? d.nextSession : null;

    if (!early && (!d.nextRun || (!d.nextWorkout && d.nextRun.kind !== 'rest'))) {
      return h('article.card.card-pad-lg.card-raised.card-signal.plan-next.plan-next-empty',
        head(null),
        h('h2.plan-next-title', t('plan.next.emptyTitle')),
        h('p.plan-next-desc', t('plan.next.emptyText')),
        h('div.btn-row.plan-next-actions',
          h('button.btn.btn-primary', { type: 'button', dataset: { action: 'log-run', key: 'plan-first-run' } }, icons.get('plus'), t('plan.next.emptyAction'))));
    }

    if (!early && d.nextRun.kind === 'rest') {
      const lr = d.latestRun;
      return h('article.card.card-pad-lg.card-raised.card-signal.plan-next.plan-next-rest',
        head(h('span.chip.chip-warn', icons.get('moon'), t('plan.next.restTitle'))),
        h('h2.plan-next-title', t('plan.next.restTitle')),
        h('p.plan-next-desc', t('plan.next.restText', { date: lr ? shortDate(lr.date) : '', effort: lr && lr.effort != null ? lr.effort : 10 })));
    }

    const nr = early ? Object.assign({}, d.nextRun || { kind: 'easy' }, { kind: 'easy', date: early.date }) : d.nextRun;
    const w = early ? early.workout : d.nextWorkout;
    const session = early ? early.planned : (d.planned.find(p => p.date === nr.date && p.workout) || null);
    const templateId = session ? session.templateId : null;
    const group = templateId ? groupOfTemplate(templateId) : 'easy';
    const stats = model.workoutStats(w, d.paces);
    const isToday = nr.date === ctx.today;

    const chips = [
      !nr.date ? null : isToday ? h('span.chip.chip-accent', t('plan.next.today')) : h('span.chip', fmt.relDay(nr.date, ctx.today)),
      session ? h('span.chip.chip-plan', t('plan.next.fromLibrary')) : null
    ];

    const statsRow = h('div.plan-next-stats',
      stats && stats.distance ? statCell(t('plan.next.distance'), approx(kmVal(stats.distance.meters), stats.distance.approx)) : null,
      stats && stats.time ? statCell(t('plan.next.duration'), approx(durationVal(stats.time.seconds), stats.time.approx)) : null,
      statCell(t('plan.next.target'), stats && stats.target && stats.target.fast
        ? rangeVal(stats.target)
        : h('span.plan-stat-text', stats && stats.target && stats.target.label ? t('plan.next.allOut') : t('plan.next.byFeel'))));

    let advice = null;
    if (d.recoveryAdvice) {
      const a = d.recoveryAdvice;
      advice = ctx.components.create('callout', {
        kind: 'warn', icon: 'warning', title: t('plan.next.adviceTitle'),
        text: isToday
          ? t('plan.next.adviceToday', { fatigue: a.fatigue != null ? a.fatigue : '–', soreness: a.soreness != null ? a.soreness : '–' })
          : t('plan.next.adviceLater', { fatigue: a.fatigue != null ? a.fatigue : '–', soreness: a.soreness != null ? a.soreness : '–', date: fmt.date(nr.date, 'dayMonth') })
      });
      advice.classList.add('plan-advice');
      advice.setAttribute('role', 'status');
    }

    let basis;
    if (session) basis = t('plan.next.basisLibrary');
    else if (d.latestRun) {
      const lr = d.latestRun;
      basis = lr.effort != null
        ? t('plan.next.basisEffort', { date: shortDate(lr.date), distance: fmt.kmUnit(lr.distance), effort: lr.effort })
        : t('plan.next.basisRun', { date: shortDate(lr.date), distance: fmt.kmUnit(lr.distance) });
    }

    const prefill = model.prefill({ templateId, nextRun: nr, stats });
    const actions = h('div.btn-row.plan-next-actions',
      h('button.btn.btn-primary', { type: 'button', dataset: { key: 'plan-next-watch' }, onClick: () => openExport({ workout: w, date: nr.date, templateId }) },
        icons.get('watch'), t('plan.next.toWatch')),
      h('button.btn.btn-secondary', { type: 'button', dataset: { key: 'plan-next-log' }, onClick: () => openLog(model.logDate(nr.date, ctx.today), prefill) },
        icons.get('edit'), t('plan.next.logResult')));

    return h('article.card.card-pad-lg.card-raised.card-signal.plan-next', { class: advice ? 'has-advice' : null, 'aria-labelledby': 'plan-next-title' },
      head(h('span.plan-next-chips', chips)),
      h('div.plan-next-grid',
        h('div.plan-next-info',
          nr.date ? h('p.plan-next-date', fmt.date(nr.date, 'long')) : null,
          h('h2.plan-next-title#plan-next-title', fmt.typo(w.name)),
          // A library session's description repeats its steps (listed on the right), so show its purpose.
          session ? h('p.plan-next-desc', t('plan.library.purpose.' + templateId)) : (w.description ? h('p.plan-next-desc', fmt.typo(w.description)) : null),
          statsRow,
          advice,
          actions,
          basis ? h('p.plan-next-basis', basis) : null),
        h('div.plan-next-plan',
          w.steps.length > 1 || w.steps.some(x => x.kind === 'repeat') ? profile(w, d, group) : null,
          stepList(w, ctx, group, t('plan.next.steps')),
          stats && stats.target && stats.target.fast ? paceContextNode(stats.target, d, group) : null)));
  }

  // ---------------------------------------------------------------- side: running days + upcoming

  function availabilityCard(ctx) {
    const d = ctx.derived;
    const days = model.runDays(d.profile);
    const on = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
    const names = on.map(i => I18n.t('common.weekdayShort.' + i)).join(', ');
    return h('section.card.card-pad.plan-avail', { 'aria-labelledby': 'plan-avail-title' },
      h('div.card-head',
        h('h2.card-title#plan-avail-title', t('plan.availability.line', { days: names })),
        h('div.card-end', h('button.btn.btn-sm.btn-ghost.plan-avail-edit', {
          type: 'button', dataset: { action: 'settings', section: 'profile', key: 'plan-avail-edit' }, 'aria-label': t('plan.availability.editLabel')
        }, icons.get('edit'), t('plan.availability.edit')))),
      h('ul.plan-avail-days', { 'aria-label': t('plan.availability.title') },
        [0, 1, 2, 3, 4, 5, 6].map(i => h('li', {
          class: ['plan-avail-day', on.indexOf(i) >= 0 && 'is-on', i === root.VeyvoRuns.weekdayIndex(ctx.today) && 'is-today'],
          title: t(on.indexOf(i) >= 0 ? 'plan.availability.on' : 'plan.availability.off', { day: I18n.t('common.weekdayLong.' + i) })
        }, h('span', { 'aria-hidden': 'true' }, I18n.t('common.weekdayMin.' + i)),
        h('span.sr-only', t(on.indexOf(i) >= 0 ? 'plan.availability.on' : 'plan.availability.off', { day: I18n.t('common.weekdayLong.' + i) }))))),
      h('p.plan-avail-explain', t('plan.availability.explain')));
  }

  function upcomingCard(ctx) {
    const d = ctx.derived;
    const list = d.planned.filter(p => p.date >= ctx.today).slice(0, 8);
    const body = list.length
      ? h('ul.plan-up-list', list.map(p => {
        const name = sessionName(p);
        const stats = p.workout ? model.workoutStats(p.workout, d.paces) : null;
        const group = groupOfTemplate(p.templateId);
        return h('li.plan-up-row', { dataset: { key: 'plan-up:' + p.date }, tabindex: '-1' },
          h('div.plan-up-date', h('span.plan-up-wd', I18n.t('common.weekdayShort.' + root.VeyvoRuns.weekdayIndex(p.date))), h('span.num', fmt.date(p.date, 'dayMonth'))),
          h('div.plan-up-main',
            h('span.plan-up-name', h('i', { class: 'dot dot-' + group, 'aria-hidden': 'true' }), h('span.truncate', name)),
            h('span.plan-up-sub', fmt.relDay(p.date, ctx.today), stats && stats.target && stats.target.fast ? [h('span.plan-sum-sep', { 'aria-hidden': 'true' }, '·'), rangeVal(stats.target)] : null)),
          h('div.plan-up-actions',
            p.workout ? h('button.icon-btn.icon-btn-sm', {
              type: 'button', 'aria-label': t('plan.library.toWatchLabel', { name }), title: t('plan.library.toWatchLabel', { name }), dataset: { key: 'plan-up-watch:' + p.date },
              onClick: () => openExport({ workout: p.workout, date: p.date, templateId: p.templateId })
            }, icons.get('watch', { size: 16 })) : null,
            h('button.icon-btn.icon-btn-sm', {
              type: 'button', 'aria-label': t('plan.day.remove', { name }), title: t('plan.day.remove', { name }), dataset: { key: 'plan-up-x:' + p.date },
              onClick: () => unschedule(p, 'plan-up-title')
            }, icons.get('x', { size: 16 }))));
      }))
      : h('p.plan-up-empty', t('plan.upcoming.empty'));
    return h('section.card.card-pad.plan-up', { 'aria-labelledby': 'plan-up-title' },
      h('div.card-head', h('h2.card-title#plan-up-title', { tabindex: '-1', dataset: { key: 'plan-up-title' } }, t('plan.upcoming.title')),
        list.length ? h('span.badge-count', String(list.length)) : null),
      body);
  }

  // ---------------------------------------------------------------- library

  function libraryCard(tpl, i, ctx) {
    const d = ctx.derived;
    const name = templateName(tpl);
    const group = groupOfTemplate(tpl.id);
    const stats = model.workoutStats(tpl.workout, d.paces);
    const upcoming = d.planned.filter(p => p.templateId === tpl.id && p.date >= ctx.today);
    let lines = [];
    try { lines = Workouts.toLines(tpl.workout, ctx.locale); } catch (e) { lines = []; }

    let paceNode;
    if (stats && stats.target && stats.target.fast) paceNode = rangeVal(stats.target, 'plan-tpl-pace-v');
    else paceNode = h('span.plan-tpl-pace-txt', t(tpl.id === 'test5k' ? 'plan.next.allOut' : 'plan.next.byFeel'));

    const est = [];
    if (stats && stats.distance) est.push(approx(kmVal(stats.distance.meters), stats.distance.approx));
    if (stats && stats.time) est.push(approx(durationVal(stats.time.seconds), stats.time.approx));

    return h('article.card.card-pad.plan-tpl', { class: ['plan-g-' + group, ctx.animate && 'reveal'], style: { '--i': String(i) }, dataset: { tpl: tpl.id }, 'aria-labelledby': 'plan-tpl-' + tpl.id },
      h('div.plan-tpl-head',
        ctx.components.create('typeTag', { type: model.runTypeOf(tpl.id) }),
        upcoming.length ? h('span.chip.chip-plan.chip-sm', icons.get('calendar-check'), t('plan.library.scheduledOn', { date: shortDate(upcoming[0].date) })) : null),
      h('h3.plan-tpl-name#plan-tpl-' + tpl.id, name),
      h('p.plan-tpl-purpose', t('plan.library.purpose.' + tpl.id)),
      h('div.plan-tpl-pace', paceNode, est.length ? h('span.plan-tpl-est', est.map((n, k) => k ? [h('span.plan-sum-sep', { 'aria-hidden': 'true' }, '·'), n] : n)) : null),
      basisLine(tpl.id, d, tpl.paced),
      tpl.workout.steps.length > 1 ? profile(tpl.workout, d, group, { small: true, animate: ctx.animate }) : null,
      lines.length ? h('ul.plan-tpl-lines', { 'aria-label': t('plan.library.steps', { name }) }, lines.map(l => h('li', fmt.typo(l)))) : null,
      h('div.plan-tpl-foot',
        h('button.btn.btn-sm.btn-secondary', {
          type: 'button', 'aria-label': t('plan.library.toWatchLabel', { name }), dataset: { key: 'plan-tpl-watch:' + tpl.id },
          onClick: () => openExport({ workout: tpl.workout, templateId: tpl.id })
        }, icons.get('watch'), t('plan.library.toWatch')),
        h('button.btn.btn-sm.btn-outline', {
          type: 'button', 'aria-label': t('plan.library.scheduleLabel', { name }), 'aria-haspopup': 'dialog', dataset: { key: 'plan-tpl-plan:' + tpl.id },
          onClick: () => openSchedule(tpl)
        }, icons.get('calendar-plus'), t('plan.library.schedule'))));
  }

  function librarySub(paces) {
    if (!paces || !paces.basis) return 'plan.library.subByFeel';
    if (paces.basis.best5kSeconds && paces.basis.targetSeconds) return 'plan.library.sub';
    return paces.basis.best5kSeconds ? 'plan.library.subBest' : 'plan.library.subGoal';
  }

  function librarySection(ctx) {
    const d = ctx.derived;
    return h('section.plan-lib', { 'aria-labelledby': 'plan-lib-title' },
      h('div.sec-head',
        h('h2.sec-title#plan-lib-title', t('plan.library.title')),
        h('span.sec-sub', t(librarySub(d.paces)))),
      h('div.plan-lib-grid', d.library.map((tpl, i) => libraryCard(tpl, i, ctx))));
  }

  // ---------------------------------------------------------------- schedule dialog

  function openSchedule(tpl) {
    const d = app.derived();
    const today = app.today();
    const name = templateName(tpl);
    const pick = model.scheduleCandidates(today, { profile: d.profile, planned: d.planned, nextRun: d.nextRun, runs: d.runs });
    let selected = pick.preferred;
    let dlg = null;
    let afterClose = null;   // runs once the dialog is gone (the page is inert while it is open)

    const note = h('p.plan-pick-note', { 'aria-live': 'polite' });
    const error = h('p.field-error', { role: 'alert', hidden: true });
    const lead = pick.days[0].weekday;
    const buttons = pick.days.map((c, i) => {
      const flags = [t(c.isRunDay ? 'plan.schedule.runDay' : 'plan.schedule.restDay')];
      if (c.session) flags.push(t('plan.schedule.hasSession', { name: sessionName(c.session) }));
      else if (c.isEngine) flags.push(t('plan.schedule.suggested'));
      if (c.hasRun) flags.push(t('plan.schedule.hasRun'));
      return h('button.plan-pick-day', {
        type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1',
        class: [c.isRunDay && 'is-run', !c.isRunDay && 'is-off', c.session && 'has-session', c.isEngine && !c.session && 'has-engine', c.isToday && 'is-today'],
        style: i === 0 ? { gridColumnStart: String(lead + 1) } : null,
        'aria-label': fmt.date(c.date, 'long') + ', ' + flags.join(', '),
        dataset: { key: 'plan-pick:' + c.date }
      },
      h('span.plan-pick-num.num', fmt.date(c.date, 'dayMonth').split(NB)[0]),
      h('span.plan-pick-mark', { 'aria-hidden': 'true' }));
    });
    const grid = h('div.plan-pick', { role: 'radiogroup', 'aria-label': t('plan.schedule.grid') },
      [0, 1, 2, 3, 4, 5, 6].map(i => h('span.plan-pick-wd', { 'aria-hidden': 'true' }, I18n.t('common.weekdayMin.' + i))),
      buttons);

    function paint(focus) {
      buttons.forEach((b, i) => { b.setAttribute('aria-checked', i === selected ? 'true' : 'false'); b.tabIndex = i === selected ? 0 : -1; });
      const c = pick.days[selected];
      const bits = [h('b', fmt.date(c.date, 'long'))];
      const why = [];
      if (c.session) why.push(t('plan.schedule.replaces', { name: sessionName(c.session) }));
      else if (c.isEngine) why.push(t('plan.schedule.overrides'));
      if (!c.isRunDay) why.push(t('plan.schedule.onRest'));
      if (c.hasRun) why.push(t('plan.schedule.ranAlready'));
      if (why.length) bits.push(' ', why.join(' '));
      note.replaceChildren.apply(note, bits);
      note.classList.toggle('is-warn', !!(c.session || !c.isRunDay || c.hasRun));
      error.hidden = true;
      if (focus) buttons[selected].focus();
    }
    buttons.forEach((b, i) => b.addEventListener('click', () => { selected = i; paint(false); }));
    grid.addEventListener('keydown', e => {
      const map = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
      let next = null;
      if (map[e.key] !== undefined) next = selected + map[e.key];
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      if (next === null) return;
      e.preventDefault();
      selected = Math.max(0, Math.min(buttons.length - 1, next));
      paint(true);
    });

    const already = d.planned.filter(p => p.templateId === tpl.id && p.date >= today);
    const alreadyBox = already.length ? h('div.plan-pick-already',
      h('span.plan-pick-already-t', t('plan.schedule.already')),
      h('ul', already.map(p => h('li',
        h('span.num', fmt.date(p.date, 'short')),
        h('button.btn.btn-sm.btn-ghost', {
          type: 'button', 'aria-label': t('plan.schedule.removeLabel', { date: fmt.date(p.date, 'long') }),
          onClick: () => { afterClose = () => unschedule(p, 'plan-tpl-plan:' + tpl.id); if (dlg) dlg.close(false); }
        }, icons.get('x', { size: 14 }), t('plan.schedule.remove')))))) : null;

    const cancel = h('button.btn.btn-secondary', { type: 'button' }, t('common.button.cancel'));
    const ok = h('button.btn.btn-primary', { type: 'button' }, icons.get('calendar-plus'), t('plan.schedule.confirm'));
    dlg = app.dialogs.create({
      title: t('plan.schedule.title'), eyebrow: name, size: 'sm', kind: 'modal', className: 'plan-sched',
      body: [h('p.plan-pick-hint', t('plan.schedule.hint')), grid,
        h('ul.plan-pick-legend', { 'aria-hidden': 'true' },
          ['run', 'session', 'engine', 'today'].map(k => h('li', h('i', { class: 'plan-lg-' + k }), t('plan.schedule.legend.' + k)))),
        note, error, alreadyBox],
      actions: [cancel, ok],
      initialFocus: buttons[selected],
      onClose: () => { const run = afterClose; afterClose = null; if (run) run(); }
    });
    cancel.addEventListener('click', () => dlg.close(false));
    ok.addEventListener('click', () => {
      const c = pick.days[selected];
      // render: false - the page re-renders after the close animation, when focus can return to it.
      const r = app.update(s => Store.schedulePlanned(s, { date: c.date, templateId: tpl.id }, { today: app.today() }), {
        reason: 'plan-schedule', toast: t('plan.toast.scheduled', { date: fmt.date(c.date, 'dayMonth'), name }), undo: true, render: false
      });
      if (!r.ok) {
        error.replaceChildren(icons.get('warning'), h('span', (r.errors || []).map(code => t('store.error.' + code)).join(' ') || t('ui.errors.unknown')));
        error.hidden = false;
        return;
      }
      afterClose = () => {
        flashDate = c.date;
        weekOffset = model.clampOffset(model.weekOffsetOf(c.date, app.today()));
        weekSlide = 0;
        pendingFocus = 'plan-tpl-plan:' + tpl.id;
        app.refresh();
      };
      dlg.close(true);
    });
    paint(false);
    return dlg;
  }

  // ---------------------------------------------------------------- page

  function animateEntry(container, ctx, board) {
    if (ctx.animate) {
      motion.reveal(container, { selector: ':scope > .plan-anim', stagger: 70 });
      const n = board.querySelector('[data-count-km]');
      if (n) motion.countUp(n, Number(n.getAttribute('data-count-km')), { from: 0, duration: 420, delay: 120, format: v => fmt.km(v) });
    }
    if (weekSlide && !motion.prefersReduced()) {
      const dir = weekSlide;
      board.querySelectorAll('.plan-day').forEach((el, i) => {
        if (typeof el.animate !== 'function') return;
        el.animate([{ opacity: 0, transform: 'translateX(' + (dir * 18) + 'px)' }, { opacity: 1, transform: 'none' }],
          { duration: 280, delay: i * 24, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' });
      });
      const head = board.querySelector('.plan-week-titles');
      if (head && typeof head.animate === 'function') head.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
    weekSlide = 0;
  }

  app.pages.register('plan', {
    title: 'ui.nav.plan',
    render(container, ctx) {
      if (ctx.reason === 'navigate') {
        const p = ctx.params || {};
        weekOffset = p.date ? model.clampOffset(model.weekOffsetOf(p.date, ctx.today)) : 0;
        weekSlide = 0;
      }
      const board = weekBoard(ctx);
      board.classList.add('plan-anim');
      const next = nextCard(ctx);
      const mid = h('div.grid-main-side.plan-mid.plan-anim', next,
        h('div.plan-side', availabilityCard(ctx), upcomingCard(ctx)));
      const lib = librarySection(ctx);
      lib.classList.add('plan-anim');
      dom.mount(container, board, mid, lib);
      animateEntry(container, ctx, board);

      if (flashDate) {
        const cell = board.querySelector('.plan-day.is-new');
        flashDate = null;
        if (cell && typeof cell.scrollIntoView === 'function' && !ctx.animate) {
          const r = cell.getBoundingClientRect();
          if (r.bottom < 0 || r.top > root.innerHeight) cell.scrollIntoView({ block: 'nearest' });
        }
      }
      if (pendingFocus) {
        const key = pendingFocus;
        pendingFocus = null;
        (root.requestAnimationFrame || setTimeout)(() => {
          const active = root.document.activeElement;
          if (active && active !== root.document.body && container.contains(active)) return;
          let el = null;
          try { el = container.querySelector('[data-key="' + CSS.escape(key) + '"]'); } catch (e) { el = null; }
          if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
        });
      }
    },
    onLeave() { weekSlide = 0; flashDate = null; pendingFocus = null; }
  });
})(globalThis);
