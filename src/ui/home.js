/*
 * ui/home.js - Přehled / Overview page (concept A "Track" + D's today headline).
 *
 * Order on desktop: today headline -> [goal lanes hero | next run card] -> recovery check-in ->
 * this week lane strip -> [recent runs | weekly volume]. Phone (<= 760 px): headline -> next run ->
 * goal -> recovery -> week (horizontal scroll snap) -> recent runs as cards -> volume.
 * No runs yet: headline + one setup card (onboarding or the first run) + the week skeleton.
 *
 * Every number comes from app.derived() (VeyvoRuns / VeyvoTraining / VeyvoWorkouts); nothing is
 * invented. Texts: i18n namespace 'home' (cs + en). CSS: styles/pages/home.css (prefix home-).
 *
 * Dialogs used (registered names from docs/ui-architecture.md):
 *   workout    { workout, date, templateId }        "Do hodinek" / planned day / test 5 km
 *   run        { mode: 'new', date, prefill }       "Zapsat výsledek", past empty running day
 *   run        { mode: 'edit', runId }              done day, recent run row (run detail)
 *   recovery   { date }                             recovery fallback strip
 *   onboarding {}                                   setup card
 *   settings   { section: 'profile' }               goal edit / new goal
 *
 * Pure helpers for tests: VeyvoUI.home.{ focusSession, headline, noteTag, figure, weekPlannedKm,
 * runTypeForTemplate, recoveryReasons }.
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI;
  const app = UI.app;
  const I18n = root.VeyvoI18n;
  const Runs = root.VeyvoRuns;
  const Training = root.VeyvoTraining;
  const Workouts = root.VeyvoWorkouts;

  // ================================================================ texts (namespace 'home')
  const MESSAGES = {
    cs: {
      label: 'Dnešek',
      headline: {
        welcome: 'Vítej ve VEYVO.',
        welcomeSub: 'Zadej svůj cíl a dny, kdy můžeš běhat. Přehled se pak plní tvými běhy.',
        noRuns: 'Zatím tu není žádný běh.',
        noRunsSub: 'Zapiš první běh ručně nebo připoj Stravu. Cíl, plán i grafy se spočítají z tvých dat.',
        noRunsSubLocal: 'Zapiš první běh ručně nebo obnov zálohu z Windows. Cíl, plán i grafy se spočítají z tvých dat.',
        loggedToday: 'Dnešní běh je zapsaný.',
        runToday: 'Dnes běžíš: {what}.',
        restAdvised: 'Dnes raději odpočívej.',
        recover: 'Teď si dej volno.',
        free: 'Dnes máš volno.',
        next: 'Další běh {when}.'
      },
      what: { km: '{km} km lehce', minutes: '{min}–{max} min lehce' },
      when: { tomorrow: 'zítra', dated: '{weekday} {date}' },
      sub: {
        last: 'Naposledy {date}: {type}, {distance} za {time}.',
        lastBest: 'Naposledy {date}: {type}, {distance} za {time}, tvůj nejlepší čas.',
        today: '{type}: {distance} za {time}.',
        todayEffort: '{type}: {distance} za {time}, úsilí {effort}/10.',
        checkin: 'Podle dnešního check-inu: {reasons}. Běh klidně zkrať nebo posuň.',
        recover: 'Poslední běh byl na maximum. Další zařaď, až se tělo zotaví.'
      },
      reason: { fatigue: 'únava {n}/10', soreness: 'bolest svalů {n}/10', both: '{a} a {b}' },
      goal: {
        eyebrow: 'Cíl',
        bestFrom: 'nejlepší čas z {date}',
        best: 'Tvůj nejlepší čas',
        bestAt: 'Nejlepší čas na {distance} km',
        target: 'Cíl',
        gap: 'chybí do cíle',
        bestPace: 'Tempo nejlepšího běhu',
        neededPace: 'Potřebné tempo',
        faster: 'o {s} s/km rychleji',
        improvement: 'Zlepšení od {date}',
        over: 'za {days}',
        attempts: 'Měřené pokusy',
        since: 'první {date}',
        reached: 'Cíl splněn',
        under: 'o {s} s pod cílem',
        exact: 'přesně na cílový čas',
        newGoal: 'Nastav nový cíl',
        edit: 'Upravit cíl',
        emptyTitle: 'Změř si výchozí čas na {distance} km.',
        fastestPace: 'Nejrychlejší tempo zatím',
        longest: 'Nejdelší běh',
        empty5k: 'Zaběhni 5 km naplno. Z výsledku uvidíš, kolik ti chybí do cíle, a podle něj se spočítají tempa tréninků.',
        emptyOther: 'Zapiš běh nebo závod na {distance} km a uvidíš, kolik ti chybí do cíle.',
        test5k: 'Zaběhni test 5 km',
        logRun: 'Zapsat běh',
        noTarget: 'bez cílového času'
      },
      next: {
        eyebrow: 'Další běh',
        eyebrowToday: 'Dnešní běh',
        today: 'Dnes',
        restTitle: 'Odpočinek',
        restFigure: 'Volno',
        returnTitle: 'Návrat po pauze',
        easy: 'Lehký běh v tempu {fast}–{slow} /km. Má být pohodový, v klidu u něj jde mluvit.',
        easyFeel: 'Lehký běh pohodovým tempem podle pocitu.',
        back: 'Od posledního běhu uplynulo {days}. Vrať se volně: {min}–{max} min podle pocitu, bez hlídání tempa.',
        rest: 'Poslední běh byl na maximum (úsilí 10/10). Dej si volno a další běh zařaď, až se tělo zotaví.',
        basisFive: 'Tempa vycházejí z pětky {date} za {time}.',
        basisRun: 'Tempa vycházejí z běhu {date} ({pace}).',
        none: 'Další běh se naplánuje podle tvého příštího zapsaného běhu.',
        after: 'Po posledním běhu',
        effort: 'úsilí {n}/10',
        toWatch: 'Do hodinek',
        log: 'Zapsat výsledek',
        scheduled: 'Naplánováno',
        scheduledHint: 'Výsledek zapíšeš v den běhu.',
        openPlan: 'Otevřít plán',
        warnTitle: 'Zvaž odpočinek.',
        warn: 'Dnešní check-in: {reasons}.'
      },
      week: {
        title: 'Tento týden',
        label: 'Dny tohoto týdne',
        done: 'odběhnuto',
        planned: 'v plánu',
        today: 'Dnes',
        plan: 'Plán',
        rest: 'Volno',
        runDay: 'Běžecký den',
        missed: 'Bez záznamu',
        recovery: 'regenerace zapsaná',
        ariaDone: '{day}: {text}. Otevřít běh.',
        ariaLog: '{day}: {text}. Zapsat běh.',
        ariaPlan: '{day}: v plánu {text}. Otevřít trénink.',
        ariaDay: '{day}: {text}.'
      },
      runs: {
        title: 'Poslední běhy',
        all: 'Všechny běhy',
        date: 'Datum',
        type: 'Typ',
        distance: 'Vzdálenost',
        time: 'Čas',
        pace: 'Tempo',
        effort: 'Úsilí',
        open: 'Otevřít běh z {date}',
        effortAria: 'úsilí {n} z 10',
        noEffort: 'úsilí nezapsáno'
      },
      notes: {
        personalBest5k: 'Osobní rekord',
        firstFiveK: 'První pětka',
        goal: 'Cíl splněn',
        checkpoint: 'Pod {time}',
        firstOver10k: 'První přes 10 km',
        longestRun: 'Nejdelší běh',
        distanceMilestone: '{km} km celkem',
        firstRun: 'První běh'
      },
      volume: { title: 'Objem po týdnech', unit: 'km', done: 'Odběhnuto', planned: 'V plánu' },
      rec: {
        title: 'Regenerace dnes',
        ask: 'Jak se dnes cítíš?',
        logged: 'Zapsáno',
        edit: 'Upravit',
        add: 'Zapsat regeneraci',
        outOf: '/10'
      },
      setup: {
        eyebrow: 'První kroky',
        title: 'Nastav si VEYVO',
        titleRuns: 'Zapiš svůj první běh',
        text: 'Tři krátké kroky a přehled začne pracovat s tvými daty: cíl, první běh a denní check-in.',
        start: 'Začít nastavení',
        firstRun: 'Zapsat první běh',
        step1: 'Cíl a běžecké dny',
        step1Text: 'Na jakou vzdálenost, za jaký čas a ve které dny můžeš běhat.',
        step2: 'První běh',
        step2Text: 'Zapiš běh ručně, nebo ho načti ze Stravy.',
        step2TextLocal: 'Zapiš běh ručně, nebo obnov zálohu z Windows v Nastavení › Data.',
        step3: 'Denní check-in',
        step3Text: 'Spánek, únava a bolest svalů. Podle nich se upraví doporučení.',
        done: 'Hotovo'
      }
    },
    en: {
      label: 'Today',
      headline: {
        welcome: 'Welcome to VEYVO.',
        welcomeSub: 'Set your goal and the days you can run. The overview then fills with your runs.',
        noRuns: 'No runs here yet.',
        noRunsSub: 'Log your first run by hand or connect Strava. Your goal, plan and charts are calculated from your data.',
        noRunsSubLocal: 'Log your first run by hand or restore a backup from Windows. Your goal, plan and charts are calculated from your data.',
        loggedToday: 'Today’s run is logged.',
        runToday: 'Run today: {what}.',
        restAdvised: 'Better rest today.',
        recover: 'Time to recover.',
        free: 'Rest day today.',
        next: 'Next run {when}.'
      },
      what: { km: '{km} km easy', minutes: '{min}–{max} min easy' },
      when: { tomorrow: 'tomorrow', dated: '{weekday} {date}' },
      sub: {
        last: 'Last run {date}: {type}, {distance} in {time}.',
        lastBest: 'Last run {date}: {type}, {distance} in {time}, your best time.',
        today: '{type}: {distance} in {time}.',
        todayEffort: '{type}: {distance} in {time}, effort {effort}/10.',
        checkin: 'From today’s check-in: {reasons}. Feel free to shorten or move the run.',
        recover: 'Your last run was all-out. Plan the next one once your body has recovered.'
      },
      reason: { fatigue: 'fatigue {n}/10', soreness: 'muscle soreness {n}/10', both: '{a} and {b}' },
      goal: {
        eyebrow: 'Goal',
        bestFrom: 'best time from {date}',
        best: 'Your best time',
        bestAt: 'Best time over {distance} km',
        target: 'Goal',
        gap: 'to the goal',
        bestPace: 'Pace of your best run',
        neededPace: 'Pace needed',
        faster: '{s} s/km faster',
        improvement: 'Improvement since {date}',
        over: 'in {days}',
        attempts: 'Timed attempts',
        since: 'first {date}',
        reached: 'Goal reached',
        under: '{s} s under the goal',
        exact: 'right on the goal time',
        newGoal: 'Set a new goal',
        edit: 'Edit goal',
        emptyTitle: 'Get a baseline time over {distance} km.',
        fastestPace: 'Fastest pace so far',
        longest: 'Longest run',
        empty5k: 'Run 5 km all-out. The result shows how far you are from your goal and sets your training paces.',
        emptyOther: 'Log a run or race over {distance} km to see how far you are from your goal.',
        test5k: 'Run a 5 km test',
        logRun: 'Log a run',
        noTarget: 'no target time'
      },
      next: {
        eyebrow: 'Next run',
        eyebrowToday: 'Today’s run',
        today: 'Today',
        restTitle: 'Recovery',
        restFigure: 'Rest',
        returnTitle: 'Back after a break',
        easy: 'Easy run at {fast}–{slow} /km. Keep it relaxed enough to hold a conversation.',
        easyFeel: 'Easy run at a relaxed pace, by feel.',
        back: 'It has been {days} since your last run. Come back gently: {min}–{max} min by feel, no pace target.',
        rest: 'Your last run was all-out (effort 10/10). Take a rest and plan the next run once your body has recovered.',
        basisFive: 'Paces are based on your {time} 5 km on {date}.',
        basisRun: 'Paces are based on your run on {date} ({pace}).',
        none: 'Your next run is planned from the next run you log.',
        after: 'After your last run',
        effort: 'effort {n}/10',
        toWatch: 'Send to watch',
        log: 'Log result',
        scheduled: 'Scheduled',
        scheduledHint: 'You can log the result on the day of the run.',
        openPlan: 'Open plan',
        warnTitle: 'Consider resting.',
        warn: 'Today’s check-in: {reasons}.'
      },
      week: {
        title: 'This week',
        label: 'Days of this week',
        done: 'done',
        planned: 'planned',
        today: 'Today',
        plan: 'Plan',
        rest: 'Rest day',
        runDay: 'Running day',
        missed: 'Not logged',
        recovery: 'recovery logged',
        ariaDone: '{day}: {text}. Open the run.',
        ariaLog: '{day}: {text}. Log a run.',
        ariaPlan: '{day}: planned {text}. Open the workout.',
        ariaDay: '{day}: {text}.'
      },
      runs: {
        title: 'Recent runs',
        all: 'All runs',
        date: 'Date',
        type: 'Type',
        distance: 'Distance',
        time: 'Time',
        pace: 'Pace',
        effort: 'Effort',
        open: 'Open the run from {date}',
        effortAria: 'effort {n} of 10',
        noEffort: 'effort not logged'
      },
      notes: {
        personalBest5k: 'Personal best',
        firstFiveK: 'First 5 km',
        goal: 'Goal reached',
        checkpoint: 'Under {time}',
        firstOver10k: 'First over 10 km',
        longestRun: 'Longest run',
        distanceMilestone: '{km} km in total',
        firstRun: 'First run'
      },
      volume: { title: 'Weekly volume', unit: 'km', done: 'Done', planned: 'Planned' },
      rec: {
        title: 'Recovery today',
        ask: 'How do you feel today?',
        logged: 'Logged',
        edit: 'Edit',
        add: 'Log recovery',
        outOf: '/10'
      },
      setup: {
        eyebrow: 'First steps',
        title: 'Set up VEYVO',
        titleRuns: 'Log your first run',
        text: 'Three short steps and the overview starts working with your data: a goal, a first run and a daily check-in.',
        start: 'Start setup',
        firstRun: 'Log your first run',
        step1: 'Goal and running days',
        step1Text: 'Which distance, in what time and on which days you can run.',
        step2: 'First run',
        step2Text: 'Log a run by hand or load it from Strava.',
        step2TextLocal: 'Log a run by hand, or restore a backup from Windows in Settings › Data.',
        step3: 'Daily check-in',
        step3Text: 'Sleep, fatigue and muscle soreness. The advice adapts to them.',
        done: 'Done'
      }
    }
  };
  I18n.register('home', MESSAGES);

  const t = (key, params) => app.t('home.' + key, params);
  const fmt = UI.fmt;

  // ================================================================ pure model helpers

  /** Library session -> run type code for the run dialog prefill. */
  const TEMPLATE_TYPE = Object.freeze({ easy: 'easy', intervals400: 'intervals', intervals1k: 'intervals', threshold: 'tempo', long: 'long', test5k: 'test5k' });
  function runTypeForTemplate(templateId) { return TEMPLATE_TYPE[templateId] || 'run'; }

  const SOURCE_RANK = { planned: 0, today: 1, engine: 2 };

  function engineSession(nr, source, profile, locale) {
    if (!nr) return null;
    if (nr.kind === 'rest') return { kind: 'rest', source, date: null, type: null, workout: null };
    return {
      kind: 'easy', source, date: nr.date || null, type: 'easy',
      distanceKm: nr.returnAfterBreak ? null : nr.distanceKm,
      paceFast: nr.paceFast, paceSlow: nr.paceSlow,
      returnAfterBreak: !!nr.returnAfterBreak, durationMin: nr.durationMin, durationMax: nr.durationMax,
      workout: Workouts.fromNextRun(nr, profile, { locale })
    };
  }
  function plannedSession(p) {
    const params = (p.template && p.template.params) || {};
    return {
      kind: 'planned', source: 'planned', date: p.date, templateId: p.templateId, type: runTypeForTemplate(p.templateId),
      distanceKm: params.reps ? null : (params.distanceKm || null), params, workout: p.workout
    };
  }

  /**
   * focusSession(derived) -> the session the overview is about, or null:
   *  - a planned library session from today on (the runner's explicit plan wins on the same date);
   *  - today's slot of the engine plan: VeyvoTraining evaluated as of yesterday, when it lands on today
   *    and nothing is logged today yet (derived.nextRun always starts tomorrow, see the integrator note);
   *  - derived.nextRun (an easy run, a return after a break, or kind 'rest' after a maximal effort).
   * Adds isToday / canLog (date <= today) / isFuture.
   */
  function focusSession(d) {
    const today = d.today;
    const doneDates = new Set((d.runs || []).map(r => r.date));
    const list = [];
    (d.planned || []).forEach(p => { if (p.workout && p.date >= today && !doneDates.has(p.date)) list.push(plannedSession(p)); });
    if (d.latestRun && !doneDates.has(today) && Training && Runs) {
      const asOfYesterday = Training.nextRunAfterRun(d.latestRun, d.profile.days, Runs.addDays(today, -1), d.baselineRun);
      if (asOfYesterday && asOfYesterday.kind !== 'rest' && asOfYesterday.date === today) list.push(engineSession(asOfYesterday, 'today', d.profile, d.locale));
    }
    if (d.nextRun) list.push(engineSession(d.nextRun, 'engine', d.profile, d.locale));
    const sessions = list.filter(Boolean).sort((a, b) => {
      if (a.date !== b.date) return a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? -1 : 1;
      return SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    });
    const s = sessions[0] || null;
    if (!s) return null;
    return Object.assign({}, s, { isToday: s.date === today, canLog: !!s.date && s.date <= today, isFuture: !!s.date && s.date > today });
  }

  /** ['únava 8/10', 'bolest svalů 7/10'] for today's check-in when it triggers the rest rule. */
  function recoveryReasons(advice) {
    if (!advice) return [];
    const out = [];
    if ((advice.fatigue || 0) >= 8) out.push(t('reason.fatigue', { n: advice.fatigue }));
    if ((advice.soreness || 0) >= 7) out.push(t('reason.soreness', { n: advice.soreness }));
    return out;
  }
  function joinReasons(list) { return list.length > 1 ? t('reason.both', { a: list[0], b: list[1] }) : (list[0] || ''); }

  function whenPhrase(date, today) {
    const diff = Runs.daysBetween(today, date);
    const wd = Runs.weekdayIndex(date);
    if (diff === 1) return t('when.tomorrow');
    const weekday = I18n.t('common.onWeekday.' + wd);
    if (diff > 1 && diff <= 6) return weekday;
    return t('when.dated', { weekday, date: fmt.date(date, 'dayMonth') });
  }

  function typeName(code) { return I18n.t('common.runType.' + (Runs.typeCode(code) || 'run')); }
  function lower(text) { return String(text).toLocaleLowerCase(I18n.getLocale() === 'cs' ? 'cs-CZ' : 'en-GB'); }

  /** What today's session is, for the headline: '3 km lehce', '25–30 min lehce' or the workout name. */
  function whatPhrase(s) {
    if (s.kind === 'planned') return s.workout ? s.workout.name : typeName(s.type);
    if (s.returnAfterBreak) return t('what.minutes', { min: s.durationMin || 25, max: s.durationMax || 30 });
    return t('what.km', { km: fmt.km(s.distanceKm, { trim: true }) });
  }

  /**
   * headline(derived, session) -> { main, tail, sub, tone } (all strings already translated).
   * tone: 'welcome' | 'done' | 'run' | 'rest' | 'free'.
   */
  function headline(d, s) {
    const today = d.today;
    if (!d.hasRuns) {
      return d.profile && d.profile.onboarded
        ? { tone: 'welcome', main: t('headline.noRuns'), tail: '', sub: t(app.strava.supported ? 'headline.noRunsSub' : 'headline.noRunsSubLocal') }
        : { tone: 'welcome', main: t('headline.welcome'), tail: '', sub: t('headline.welcomeSub') };
    }
    const reasons = recoveryReasons(d.recoveryAdvice);
    const todays = d.runs.filter(r => r.date === today);
    const nextTail = s && s.date && s.date > today ? t('headline.next', { when: whenPhrase(s.date, today) }) : '';
    if (todays.length) {
      const r = todays[todays.length - 1];
      const params = { type: typeName(r.type), distance: fmt.kmUnit(r.distance), time: fmt.duration(r.movingSeconds), effort: r.effort };
      return { tone: 'done', main: t('headline.loggedToday'), tail: nextTail, sub: t(r.effort ? 'sub.todayEffort' : 'sub.today', params) };
    }
    const last = d.latestRun;
    const lastSub = last ? t(last.id === d.goal.bestRunId ? 'sub.lastBest' : 'sub.last', {
      date: fmt.date(last.date), type: lower(typeName(last.type)), distance: fmt.kmUnit(last.distance), time: fmt.duration(last.movingSeconds)
    }) : '';
    if (s && s.isToday) {
      if (reasons.length) return { tone: 'rest', main: t('headline.restAdvised'), tail: '', sub: t('sub.checkin', { reasons: joinReasons(reasons) }) };
      return { tone: 'run', main: t('headline.runToday', { what: whatPhrase(s) }), tail: '', sub: lastSub };
    }
    if (s && s.kind === 'rest') return { tone: 'rest', main: t('headline.recover'), tail: '', sub: t('sub.recover') };
    return { tone: 'free', main: t('headline.free'), tail: nextTail, sub: reasons.length ? t('sub.checkin', { reasons: joinReasons(reasons) }) : lastSub };
  }

  /** The big figure of the next-run card: { value, unit } or null. */
  function figure(s) {
    if (!s) return null;
    if (s.kind === 'rest') return { value: t('next.restFigure'), unit: '', word: true };
    if (s.kind === 'planned') {
      const p = s.params || {};
      if (p.reps && p.distanceM) return { value: p.reps + '×' + p.distanceM, unit: I18n.t('common.unit.m') };
      if (p.reps && p.distanceKm) return { value: p.reps + '×' + fmt.km(p.distanceKm, { trim: true }), unit: I18n.t('common.unit.km') };
      if (p.distanceKm) return { value: fmt.km(p.distanceKm, { trim: true }), unit: I18n.t('common.unit.km'), km: p.distanceKm };
      return null;
    }
    if (s.returnAfterBreak) return { value: (s.durationMin || 25) + '–' + (s.durationMax || 30), unit: I18n.t('common.unit.min') };
    if (Number.isFinite(s.distanceKm)) return { value: fmt.km(s.distanceKm, { trim: true }), unit: I18n.t('common.unit.km'), km: s.distanceKm };
    return null;
  }

  const NOTE_ORDER = ['goal', 'personalBest5k', 'checkpoint', 'firstOver10k', 'longestRun', 'distanceMilestone', 'firstRun'];
  /** Translated derived note tags for a run, most important first: [{ code, text, hot }]. */
  function noteTags(notes) {
    const out = (notes || []).map(n => {
      const p = n.params || {};
      if (n.code === 'checkpoint' && p.isGoal) return { code: 'goal', text: t('notes.goal'), hot: true };
      if (n.code === 'checkpoint') return { code: 'checkpoint', text: t('notes.checkpoint', { time: fmt.duration(p.seconds) }), hot: false };
      if (n.code === 'personalBest5k') return p.previousBest === null || p.previousBest === undefined
        ? { code: 'personalBest5k', text: t('notes.firstFiveK'), hot: false } : { code: 'personalBest5k', text: t('notes.personalBest5k'), hot: true };
      if (n.code === 'distanceMilestone') return { code: n.code, text: t('notes.distanceMilestone', { km: p.km }), hot: false };
      if (MESSAGES.cs.notes[n.code]) return { code: n.code, text: t('notes.' + n.code), hot: false };
      return null;
    }).filter(Boolean);
    return out.sort((a, b) => NOTE_ORDER.indexOf(a.code) - NOTE_ORDER.indexOf(b.code));
  }
  function noteTag(notes) { return noteTags(notes)[0] || null; }

  /** Km still planned this week (sessions from today on with a known distance, days without a run). */
  function weekPlannedKm(d, s) {
    let km = 0;
    const seen = new Set();
    (d.weekStrip || []).forEach(day => {
      if (day.status === 'done' || day.date < d.today) return;
      if (day.plannedWorkout && day.plannedWorkout.template) {
        const p = day.plannedWorkout.template.params || {};
        if (!p.reps && p.distanceKm) { km += p.distanceKm; seen.add(day.date); }
        return;
      }
      if (day.status === 'planned' && day.planned && Number.isFinite(day.planned.distanceKm) && !day.planned.returnAfterBreak) { km += day.planned.distanceKm; seen.add(day.date); }
    });
    if (s && s.isToday && !seen.has(s.date) && Number.isFinite(s.distanceKm)) km += s.distanceKm;
    return Math.round(km * 100) / 100;
  }

  UI.home = { MESSAGES, focusSession, headline, noteTag, noteTags, figure, weekPlannedKm, runTypeForTemplate, recoveryReasons, whenPhrase, paceBasis };

  // ================================================================ rendering
  let mounts = [];
  const cloneJson = v => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

  function openRun(runId) { app.dialogs.open('run', { mode: 'edit', runId }); }
  function logRun(date, prefill) { app.dialogs.open('run', Object.assign({ mode: 'new', date }, prefill ? { prefill } : {})); }
  function openWorkout(workout, date, templateId) {
    app.dialogs.open('workout', Object.assign({ workout: cloneJson(workout) }, date ? { date } : {}, templateId ? { templateId } : {}));
  }

  // ---------------------------------------------------------------- 1. headline
  function renderHeadline(ctx, hl) {
    const { h } = ctx;
    return h('header', { class: ['home-head', 'reveal', 'home-tone-' + hl.tone], style: { '--i': 0 } },
      h('h2.home-headline', h('span.home-headline-main', hl.main), hl.tail ? h('span.home-headline-tail', ' ' + hl.tail) : null),
      hl.sub ? h('p.home-headline-sub', hl.sub) : null);
  }

  // ---------------------------------------------------------------- 2. goal hero
  function renderGoal(ctx, after, index) {
    const { h, icons, charts, motion, derived: d } = ctx;
    const g = d.goal;
    const dist = fmt.km(g.distanceKm || d.profile.goalDistanceKm || 5, { trim: true });
    const hasTarget = Number.isFinite(g.target);
    const hasBest = Number.isFinite(g.best);
    const goalLabel = hasTarget ? fmt.goal(d.profile) : typo(dist + ' km');

    const top = h('div.home-goal-top',
      icons.get('flag', { className: 'home-goal-flag' }),
      h('h2.eyebrow', t('goal.eyebrow')),
      h('b.home-goal-label', goalLabel, hasTarget ? null : h('span.faint', ' · ' + t('goal.noTarget'))),
      h('span.home-goal-end',
        hasBest ? h('span.home-goal-from', t('goal.bestFrom', { date: fmt.date(g.bestDate) })) : null,
        h('button.icon-btn.icon-btn-sm.home-goal-edit', { type: 'button', 'aria-label': t('goal.edit'), title: t('goal.edit'), 'data-key': 'home-goal-edit', onClick: () => app.dialogs.open('settings', { section: 'profile' }) }, icons.get('edit'))));

    const card = h('article', { class: ['card', 'card-pad-lg', 'card-glow', 'home-goal', 'reveal', g.reached && 'is-reached'], style: { '--i': index }, 'aria-labelledby': 'home-goal-h' });
    top.querySelector('h2').id = 'home-goal-h';
    card.append(top);

    // --- no timed attempt yet
    if (!hasBest) {
      const figs = h('div.home-figs',
        hasTarget ? h('div.home-fig.home-fig-goal', h('span.num.home-fig-n', fmt.duration(g.target)), h('span.home-fig-l', t('goal.target'))) : null);
      const is5k = Number(g.distanceKm) === 5;
      const cta = is5k
        ? h('button.btn.btn-primary', { type: 'button', 'data-key': 'home-goal-test', onClick: () => {
          const tpl = (d.library || []).find(x => x.id === 'test5k');
          openWorkout(tpl ? tpl.workout : null, null, 'test5k');
        } }, icons.get('flag'), t('goal.test5k'))
        : h('button.btn.btn-secondary', { type: 'button', 'data-action': 'log-run', 'data-key': 'home-goal-log' }, icons.get('plus'), t('goal.logRun'));
      const empty = h('div.home-goal-empty',
        h('p.home-goal-empty-title', t('goal.emptyTitle', { distance: dist })),
        h('p.home-goal-empty-text', is5k ? t('goal.empty5k') : t('goal.emptyOther', { distance: dist })),
        h('div.btn-row', cta));
      card.append(h('div.home-goal-nofig', figs, empty));
      const stats = h('dl.home-gstats');
      if (hasTarget) stats.append(stat(ctx, t('goal.neededPace'), fmt.pace(g.targetPace), '/km'));
      const fp = d.records && d.records.fastestPace;
      if (fp && Number.isFinite(fp.value)) stats.append(stat(ctx, t('goal.fastestPace'), fmt.pace(fp.value), '/km', fmt.date(fp.date, 'dayMonth')));
      const lr = d.records && d.records.longestRun;
      if (lr && Number.isFinite(lr.value)) stats.append(stat(ctx, t('goal.longest'), fmt.km(lr.value), 'km', fmt.date(lr.date, 'dayMonth')));
      if (stats.children.length === 2) stats.classList.add('home-gstats-2');
      if (stats.children.length === 1) stats.classList.add('home-gstats-1');
      if (stats.children.length) card.append(stats);
      return card;
    }

    // --- best (and target)
    const bestEl = h('span.num.home-fig-n', fmt.duration(g.best));
    const figs = h('div.home-figs',
      h('div.home-fig.home-fig-best', bestEl, h('span.home-fig-l', hasTarget ? t('goal.best') : t('goal.bestAt', { distance: dist }))));
    let gapEl = null;
    if (hasTarget) {
      figs.append(icons.get('arrow-right', { className: 'home-fig-arrow' }),
        h('div.home-fig.home-fig-goal', h('span.num.home-fig-n', fmt.duration(g.target)), h('span.home-fig-l', t('goal.target'))));
      if (g.reached) {
        const under = Math.round(g.target - g.best);
        figs.append(h('div.home-gap.home-gap-reached.pop', { style: { '--i': 6 } },
          h('span.home-gap-head', icons.get('check', { size: 18 }), t('goal.reached')),
          h('span.home-gap-l', under > 0 ? t('goal.under', { s: under }) : t('goal.exact')),
          h('button.btn-link.home-gap-link', { type: 'button', 'data-key': 'home-goal-new', onClick: () => app.dialogs.open('settings', { section: 'profile' }) },
            t('goal.newGoal'), icons.get('chevron-right', { className: 'ic-end' }))));
      } else {
        gapEl = h('span.num.home-gap-n', fmt.seconds(-g.gapSeconds));
        figs.append(h('div.home-gap.pop', { style: { '--i': 6 } }, gapEl, h('span.home-gap-l', t('goal.gap'))));
      }
    }
    card.append(figs);

    const lanesHost = h('div.home-lanes');
    card.append(lanesHost);

    // stats row: best pace | needed pace (+ delta) | improvement since previous best (or attempts)
    const stats = h('dl.home-gstats');
    const paceEl = stats.appendChild(stat(ctx, t('goal.bestPace'), fmt.pace(g.bestPace), '/km')).querySelector('.num');
    if (hasTarget && !g.reached) {
      const faster = Math.round(g.pacePerKmGap);
      stats.append(stat(ctx, t('goal.neededPace'), fmt.pace(g.targetPace), '/km', faster > 0 ? t('goal.faster', { s: faster }) : null));
    } else if (hasTarget) {
      stats.append(stat(ctx, t('goal.neededPace'), fmt.pace(g.targetPace), '/km'));
    }
    let improveEl = null;
    if (Number.isFinite(g.previousBest)) {
      const row = stat(ctx, t('goal.improvement', { date: fmt.date(g.previousBestDate, 'dayMonth') }), fmt.seconds(-g.improvementSeconds), null,
        t('goal.over', { days: fmt.count('common.count.days', g.improvementDays) }));
      improveEl = row.querySelector('.num');
      stats.append(row);
    } else {
      stats.append(stat(ctx, t('goal.attempts'), String(g.attempts || 1), null, g.firstAttemptDate ? t('goal.since', { date: fmt.date(g.firstAttemptDate, 'dayMonth') }) : null));
    }
    if (!hasTarget && stats.children.length < 3) stats.classList.add('home-gstats-2');
    card.append(stats);

    after.push(() => {
      mounts.push(charts.mount(lanesHost, o => charts.goalLanes(g, o)));
      const from = Number.isFinite(g.previousBest) ? g.previousBest : g.best + 30;
      motion.countUp(bestEl, g.best, { from, format: v => fmt.duration(Math.round(v)), delay: 140 });
      if (gapEl) motion.countUp(gapEl, g.gapSeconds, { from: from - g.target, format: v => fmt.seconds(-Math.round(v)), delay: 200 });
      if (paceEl && Number.isFinite(g.bestPace)) motion.countUp(paceEl, g.bestPace, { from: from / (g.distanceKm || 5), format: v => fmt.pace(v), delay: 260 });
      if (improveEl) motion.countUp(improveEl, g.improvementSeconds, { from: 0, format: v => fmt.seconds(-Math.round(v)), delay: 300 });
    });
    return card;
  }

  function typo(text) { return fmt.typo(text); }

  /** One goal stat: <div><dt>label</dt><dd><span.num>value</span><unit><note></dd></div> */
  function stat(ctx, label, value, unit, note) {
    const { h } = ctx;
    return h('div.home-gs',
      h('dt', label),
      h('dd', h('span.num', value), unit ? h('span.unit', ' ' + unit) : null, note ? h('span.home-gs-note', note) : null));
  }

  // ---------------------------------------------------------------- 3. next run card
  function renderNext(ctx, s, after, index) {
    const { h, icons, motion, components: C, derived: d } = ctx;
    const today = d.today;
    const card = h('article', { class: ['card', 'card-pad-lg', 'card-raised', 'card-signal', 'home-next', 'reveal', s && s.isToday && 'is-today', d.recoveryAdvice && 'is-warn'], style: { '--i': index }, 'aria-labelledby': 'home-next-h' });
    const eyebrow = h('h2.eyebrow#home-next-h', s && s.isToday ? t('next.eyebrowToday') : t('next.eyebrow'));
    let badge = null;
    if (s && s.date) badge = s.isToday ? h('span.chip.chip-accent', t('next.today')) : h('span.chip', fmt.relDay(s.date, today));
    card.append(h('div.home-next-top', eyebrow, badge));

    const body = h('div.home-next-body');
    card.append(body);

    if (!s) {
      body.append(h('p.home-next-advice', t('next.none')));
      card.append(h('div.home-next-actions', h('a.btn.btn-secondary.btn-lg', { href: '#plan', 'data-nav': 'plan', 'data-key': 'home-next-plan' }, icons.get('calendar'), t('next.openPlan'))));
      return card;
    }

    if (s.date) body.append(h('p.home-next-date', fmt.date(s.date, 'long')));
    let title;
    if (s.kind === 'rest') title = t('next.restTitle');
    else if (s.kind === 'planned') title = s.workout ? s.workout.name : typeName(s.type);
    else if (s.returnAfterBreak) title = t('next.returnTitle');
    else title = typeName('easy');
    body.append(h('h3.home-next-type', title));

    const fig = figure(s);
    let figNum = null;
    if (fig) {
      figNum = h('span.num.home-next-n', fig.value);
      body.append(h('div', { class: ['home-next-fig', fig.word && 'is-word'] }, figNum, fig.unit ? h('span.home-next-unit', fig.unit) : null));
    }

    // advice text (engine cases translated; planned sessions use the workout description)
    let advice = '', basis = '';
    if (s.kind === 'rest') advice = t('next.rest');
    else if (s.kind === 'planned') advice = s.workout && s.workout.description ? typo(s.workout.description) : '';
    else if (s.returnAfterBreak) {
      const days = d.latestRun ? Runs.daysBetween(d.latestRun.date, today) : null;
      advice = t('next.back', { days: days !== null ? fmt.count('common.count.days', days) : '', min: s.durationMin || 25, max: s.durationMax || 30 });
    } else if (Number.isFinite(s.paceFast) && Number.isFinite(s.paceSlow)) {
      advice = t('next.easy', { fast: fmt.pace(s.paceFast), slow: fmt.pace(s.paceSlow) });
      basis = paceBasis(d);
    } else advice = t('next.easyFeel');
    if (advice) body.append(h('p.home-next-advice', advice));
    if (basis) body.append(h('p.home-next-basis', basis));

    // check-in says rest (fatigue >= 8 or soreness >= 7): the card must not contradict it
    const reasons = recoveryReasons(d.recoveryAdvice);
    if (reasons.length && s.kind !== 'rest') {
      body.append(h('div.home-next-warn', C.create('callout', { kind: 'warn', title: t('next.warnTitle'), text: t('next.warn', { reasons: joinReasons(reasons) }) })));
    }

    // context: after the last run
    if (d.latestRun) {
      const r = d.latestRun;
      const bits = [fmt.date(r.date)];
      if (r.effort) bits.push(t('next.effort', { n: r.effort }));
      else bits.push(fmt.kmUnit(r.distance));
      card.append(h('p.home-next-ctx', h('span', t('next.after')), h('b', bits.join(' · '))));
    }

    // actions
    const actions = h('div.home-next-actions');
    const workout = s.workout;
    const watchBtn = (primary) => h('button', { type: 'button', class: ['btn', 'btn-lg', primary ? 'btn-primary' : 'btn-secondary'], 'data-key': 'home-next-watch',
      onClick: () => openWorkout(workout, s.date, s.templateId) }, icons.get('watch'), t('next.toWatch'));
    if (s.kind === 'rest') {
      actions.append(h('a.btn.btn-secondary.btn-lg', { href: '#plan', 'data-nav': 'plan', 'data-key': 'home-next-plan' }, icons.get('calendar'), t('next.openPlan')));
    } else if (s.canLog) {
      const prefill = { type: s.type };
      if (Number.isFinite(s.distanceKm)) prefill.distance = s.distanceKm;
      actions.append(h('button', { type: 'button', class: ['btn', 'btn-lg', reasons.length ? 'btn-secondary' : 'btn-primary', 'home-next-log'], 'data-key': 'home-next-log',
        onClick: () => logRun(s.date, prefill) }, icons.get('check'), t('next.log')));
      if (workout) actions.append(watchBtn(false));
    } else {
      if (workout) actions.append(watchBtn(!reasons.length));
      actions.append(h('span.home-next-status', { title: t('next.scheduledHint') }, icons.get('calendar-check'), h('span', t('next.scheduled')), h('span.sr-only', ' ' + t('next.scheduledHint'))));
    }
    card.append(actions);

    if (figNum && Number.isFinite(fig.km)) {
      const target = fig.km;
      after.push(() => motion.countUp(figNum, target, { from: 0, delay: 220, format: v => (Number.isInteger(target) ? String(Math.round(v)) : fmt.km(v)) }));
    }
    return card;
  }

  /** Which run the engine's easy pace comes from (same rule as VeyvoTraining). */
  function paceBasis(d) {
    const last = d.latestRun;
    if (!last) return '';
    const five = r => !!r && Runs.isFiveKAttempt(r);
    const base = Runs.typeCode(last.type) === 'test5k' && five(last) ? last : (five(d.baselineRun) ? d.baselineRun : null);
    if (base) return t('next.basisFive', { date: fmt.date(base.date), time: fmt.duration(base.movingSeconds) });
    return t('next.basisRun', { date: fmt.date(last.date), pace: fmt.paceUnit(last.movingSeconds / last.distance) });
  }

  // ---------------------------------------------------------------- 4. recovery check-in
  function renderRecovery(ctx, index) {
    const { h, components: C } = ctx;
    const wrap = h('section', { class: ['home-rec', 'reveal'], style: { '--i': index }, 'aria-label': t('rec.title') });
    let el = null;
    if (C.has('recoveryCheckin')) {
      try { el = C.create('recoveryCheckin', { date: ctx.today, variant: 'inline', key: 'home-rec' }); } catch (err) { console.error('recoveryCheckin', err); el = null; }
      // the foundation stub returns the shared placeholder (.empty); use the home strip until the real one lands
      if (el && el.classList && el.classList.contains('empty')) el = null;
    }
    if (el) { wrap.classList.add('home-rec-host'); wrap.append(el); return wrap; }
    wrap.classList.add('home-rec-strip');
    wrap.append(recoveryStrip(ctx));
    return wrap;
  }

  /** Fallback strip (concept A): today's sleep / fatigue / soreness + edit; opens the 'recovery' dialog. */
  function recoveryStrip(ctx) {
    const { h, icons, charts, derived: d } = ctx;
    const log = d.recoveryToday;
    const open = () => app.dialogs.open('recovery', { date: d.today });
    const label = h('h2.eyebrow.home-rec-title', t('rec.title'));
    if (!log) {
      return h('div.home-rec-row', label, h('span.home-rec-ask', t('rec.ask')),
        h('div.home-rec-end', h('button.btn.btn-secondary.btn-sm', { type: 'button', 'data-key': 'home-rec-add', onClick: open }, icons.get('plus'), t('rec.add'))));
    }
    const item = (name, valueNode) => h('div.home-rec-item', h('span.home-rec-l', name), valueNode);
    const scaleVal = (n, variant) => [
      charts.meter(n, 10, { label: name10(n) }),
      h('span.num.home-rec-v', { 'aria-hidden': 'true' }, String(n), h('small', t('rec.outOf')))
    ];
    const name10 = n => I18n.t('charts.meter', { value: n, max: 10 });
    const items = [];
    if (Number.isFinite(log.sleepHours)) items.push(item(I18n.t('common.field.sleep'), h('span.num.home-rec-v', fmt.number(log.sleepHours, { maxDecimals: 1 }), h('small', ' ' + I18n.t('common.unit.h')))));
    if (Number.isFinite(log.fatigue)) items.push(item(I18n.t('common.field.fatigue'), h('span.home-rec-scale', scaleVal(log.fatigue))));
    if (Number.isFinite(log.soreness)) items.push(item(I18n.t('common.field.soreness'), h('span.home-rec-scale', scaleVal(log.soreness))));
    return h('div.home-rec-row', label, items,
      h('div.home-rec-end',
        h('span.home-rec-ok', icons.get('check', { size: 15 }), t('rec.logged')),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', 'data-key': 'home-rec-edit', onClick: open }, icons.get('edit'), t('rec.edit'))));
  }

  // ---------------------------------------------------------------- 5. this week lane strip
  function renderWeek(ctx, s, index, after) {
    const { h, icons, derived: d } = ctx;
    const days = d.weekStrip || [];
    const today = d.today;
    const weeklyList = d.weekly || [];
    const weekNow = weeklyList[weeklyList.length - 1];
    const doneKm = weekNow && weekNow.isCurrent ? weekNow.distanceKm : days.reduce((a, day) => a + day.runs.reduce((b, r) => b + (r.distance || 0), 0), 0);
    const planKm = weekPlannedKm(d, s);
    const range = days.length ? fmt.weekRange(days[0].date, days[6].date) : '';

    const head = h('div.sec-head',
      h('h2.sec-title#home-week-h', t('week.title')),
      h('span.sec-sub', range),
      h('div.sec-end.home-week-sum',
        h('span', h('b.num', fmt.km(doneKm)), h('span.unit', ' km'), ' ' + t('week.done')),
        planKm > 0 ? h('span.home-week-dot', { 'aria-hidden': 'true' }, '·') : null,
        planKm > 0 ? h('span', h('b.num', fmt.km(planKm, { trim: true })), h('span.unit', ' km'), ' ' + t('week.planned')) : null));

    const list = h('ol.home-days', { 'aria-label': t('week.label') });
    days.forEach((day, i) => list.append(dayCell(ctx, day, s, i)));
    const section = h('section', { class: ['home-week', 'reveal'], style: { '--i': index }, 'aria-labelledby': 'home-week-h' }, head, list);

    if (ctx.isPhone) {
      after.push(() => {
        const cell = list.querySelector('.is-today') || list.querySelector('.is-plan');
        if (cell && list.scrollWidth > list.clientWidth) list.scrollLeft = Math.max(0, cell.offsetLeft - list.offsetLeft - 16 - (cell.previousElementSibling ? cell.previousElementSibling.offsetWidth * .5 : 0));
      });
    }
    return section;
  }

  function dayCell(ctx, day, s, i) {
    const { h, icons, derived: d } = ctx;
    const today = d.today;
    const wd = day.weekday;
    const dayName = I18n.t('common.weekdayShort.' + wd);
    const dayNum = Number(day.date.slice(8, 10)) + (I18n.getLocale() === 'cs' ? '.' : '');
    const longDay = fmt.date(day.date, 'long');
    const isTodaySession = !!(s && s.isToday && s.date === day.date && day.status !== 'done');
    const planned = day.plannedWorkout && day.status !== 'done' ? day.plannedWorkout : null;

    let status = day.status;
    if (status !== 'done' && (planned || isTodaySession) && day.date >= today) status = 'planned';
    const cls = ['home-day', 'is-' + ({ done: 'done', planned: 'plan', rest: 'rest', today: 'run', available: day.isPast ? 'missed' : 'run' }[status] || 'run'), day.isToday && 'is-today', 'pop'];
    let badge = null, txt = null, aria = '', onClick = null;

    if (status === 'done') {
      const runs = day.runs;
      const km = runs.reduce((a, r) => a + (r.distance || 0), 0);
      const secs = runs.reduce((a, r) => a + (r.movingSeconds || 0), 0);
      const name = runs.length > 1 ? fmt.count('common.count.runs', runs.length) : typeName(runs[0].type);
      badge = h('span.home-day-badge', icons.get('check', { size: 13, strokeWidth: 2.6 }));
      txt = h('span.home-day-txt', h('b', name), h('span.home-day-meta', h('span.num', fmt.km(km)), h('span.unit', ' km'), ' · ', h('span.num', fmt.duration(secs))));
      aria = t('week.ariaDone', { day: longDay, text: name + ', ' + fmt.kmUnit(km) + ', ' + fmt.duration(secs) });
      const last = runs[runs.length - 1];
      onClick = () => openRun(last.id);
    } else if (status === 'planned') {
      const session = planned ? plannedSession(planned) : (isTodaySession ? s : (day.planned ? engineSession(day.planned, 'engine', d.profile, d.locale) : s));
      const name = planned ? (planned.workout ? planned.workout.name : typeName(session.type)) : (session.returnAfterBreak ? t('next.returnTitle') : typeName('easy'));
      const fig = figure(session);
      badge = h('span.home-day-badge', day.isToday ? t('week.today') : t('week.plan'));
      txt = h('span.home-day-txt', h('b.truncate', name), fig && !planned ? h('span.home-day-meta', h('span.num', fig.value), h('span.unit', ' ' + fig.unit)) : null);
      aria = t('week.ariaPlan', { day: longDay, text: name });
      const workout = session.workout || null;
      if (workout) onClick = () => openWorkout(workout, day.date, session.templateId);
    } else if (status === 'rest') {
      if (day.isToday) badge = h('span.home-day-badge', t('week.today'));
      txt = h('span.home-day-txt', t('week.rest'), day.isToday && d.recoveryToday ? h('span.home-day-note', t('week.recovery')) : null);
      aria = t('week.ariaDay', { day: longDay, text: t('week.rest') });
    } else {
      const missed = day.isPast && d.hasRuns;
      if (day.isToday) badge = h('span.home-day-badge', t('week.today'));
      const label = missed ? t('week.missed') : t('week.runDay');
      txt = h('span.home-day-txt', label, day.isToday && d.recoveryToday ? h('span.home-day-note', t('week.recovery')) : null);
      if (day.isPast || day.isToday) {
        aria = t('week.ariaLog', { day: longDay, text: label });
        onClick = () => logRun(day.date);
      } else aria = t('week.ariaDay', { day: longDay, text: label });
    }

    const inner = [h('span.home-day-head', h('span.home-day-name', dayName), h('span.num.home-day-num', dayNum)), badge, txt];
    const cell = onClick
      ? h('button.home-day-in', { type: 'button', 'aria-label': aria, 'data-key': 'home-day-' + day.date, onClick }, inner)
      : h('div.home-day-in', { 'aria-label': aria, role: 'group' }, inner);
    return h('li', { class: cls, style: { '--i': 6 + i }, 'aria-current': day.isToday ? 'date' : null }, cell);
  }

  // ---------------------------------------------------------------- 6a. recent runs
  function renderRuns(ctx, index) {
    const { h, icons, charts, derived: d } = ctx;
    const runs = d.runsDesc.filter(r => r.date <= d.today).slice(0, 5);
    const head = h('div.sec-head',
      h('h2.sec-title#home-runs-h', t('runs.title')),
      h('div.sec-end', h('a.btn-link', { href: '#progress', 'data-nav': 'progress', 'data-key': 'home-all-runs' }, t('runs.all'), icons.get('chevron-right', { className: 'ic-end' }))));
    const section = h('section', { class: ['home-runs', 'reveal'], style: { '--i': index }, 'aria-labelledby': 'home-runs-h' }, head);

    const tagFor = r => {
      const tag = noteTag(Runs.notesOf(d.notes, r.id));
      if (tag) return h('span', { class: ['chip', 'chip-sm', 'home-tag', tag.hot ? 'chip-accent' : null] }, tag.text);
      return null;
    };
    const effortCell = r => r.effort
      ? h('span.meter-val', charts.meter(r.effort, 10, { label: t('runs.effortAria', { n: r.effort }), animate: true }), h('span.num', { 'aria-hidden': 'true' }, String(r.effort)))
      : h('span.faint', { title: t('runs.noEffort') }, '–');

    if (ctx.isPhone) {
      const list = h('ul.home-runcards');
      runs.forEach((r, i) => {
        list.append(h('li', { class: 'reveal', style: { '--i': index + i + 1 } },
          h('button.home-runcard', { type: 'button', 'data-key': 'home-run-' + r.id, 'aria-label': t('runs.open', { date: fmt.date(r.date, 'long') }), onClick: () => openRun(r.id) },
            h('span.home-runcard-top', h('span.home-runcard-date', fmt.date(r.date)), ctx.components.create('typeTag', { type: r.type }), tagFor(r)),
            h('span.home-runcard-figs',
              h('span.home-runcard-fig', h('span.num', fmt.km(r.distance)), h('span.unit', ' km')),
              h('span.home-runcard-fig', h('span.num', fmt.duration(r.movingSeconds))),
              h('span.home-runcard-fig', h('span.num', fmt.pace(r.movingSeconds / r.distance)), h('span.unit', ' /km')),
              h('span.home-runcard-eff', effortCell(r))),
            icons.get('chevron-right', { className: 'home-runcard-chev' }))));
      });
      section.append(list);
      return section;
    }

    const rows = runs.map((r, i) => h('tr', { class: ['is-clickable', 'reveal'], style: { '--i': index + i + 1 }, onClick: e => { if (!e.target.closest('button')) openRun(r.id); } },
      h('td.dt', h('button.home-run-open', { type: 'button', 'data-key': 'home-run-' + r.id, 'aria-label': t('runs.open', { date: fmt.date(r.date, 'long') }), onClick: () => openRun(r.id) }, fmt.date(r.date))),
      h('td.home-col-type', h('span.home-type', ctx.components.create('typeTag', { type: r.type }), tagFor(r))),
      h('td.r.n', fmt.km(r.distance), h('span.unit', ' km')),
      h('td.r.n', fmt.duration(r.movingSeconds)),
      h('td.r.n.home-col-pace', fmt.pace(r.movingSeconds / r.distance), h('span.unit', ' /km')),
      h('td.r.home-col-eff', effortCell(r))));
    section.append(h('div.table-wrap', h('table.table.home-table',
      h('thead', h('tr',
        h('th', { scope: 'col' }, t('runs.date')), h('th', { scope: 'col' }, t('runs.type')), h('th.r', { scope: 'col' }, t('runs.distance')),
        h('th.r', { scope: 'col' }, t('runs.time')), h('th.r.home-col-pace', { scope: 'col' }, t('runs.pace')), h('th.r.home-col-eff', { scope: 'col' }, t('runs.effort')))),
      h('tbody', rows))));
    return section;
  }

  // ---------------------------------------------------------------- 6b. weekly volume
  function renderVolume(ctx, s, index, after) {
    const { h, charts, derived: d } = ctx;
    const planned = weekPlannedKm(d, s);
    const weeks = (d.weekly || []).slice(-5);
    const legend = h('div.legend.home-vol-legend',
      h('span.legend-item', h('i.dot.dot-easy'), t('volume.done')),
      planned > 0 ? h('span.legend-item', h('i.lg-plan'), t('volume.planned')) : null);
    const host = h('div.home-vol-chart');
    after.push(() => mounts.push(charts.mount(host, o => charts.weeklyVolume(weeks, Object.assign({ planned, height: ctx.isPhone ? 170 : 186 }, o)))));
    return h('section', { class: ['home-vol', 'reveal'], style: { '--i': index }, 'aria-labelledby': 'home-vol-h' },
      h('div.sec-head', h('h2.sec-title#home-vol-h', t('volume.title')), h('span.sec-sub', t('volume.unit')), h('div.sec-end', legend)),
      host);
  }

  // ---------------------------------------------------------------- empty state: one setup card
  function renderSetup(ctx, index) {
    const { h, icons, derived: d } = ctx;
    const onboarded = !!(d.profile && d.profile.onboarded);
    const daysText = (d.profile.days || []).map(x => I18n.t('common.weekdayShort.' + x)).join(', ');
    const step = (n, done, title, text) => h('li', { class: ['home-setup-step', done && 'is-done'] },
      h('span.home-setup-no', done ? icons.get('check', { size: 15, strokeWidth: 2.4 }) : h('span.num', String(n))),
      h('span.home-setup-step-main', h('b', title), h('span', text)),
      done ? h('span.chip.chip-sm.chip-good', t('setup.done')) : null);
    const cta = onboarded
      ? h('button.btn.btn-primary.btn-lg', { type: 'button', 'data-action': 'log-run', 'data-key': 'home-setup-cta' }, icons.get('plus'), t('setup.firstRun'))
      : h('button.btn.btn-primary.btn-lg', { type: 'button', 'data-key': 'home-setup-cta', onClick: () => app.dialogs.open('onboarding', {}) }, icons.get('arrow-right'), t('setup.start'));
    return h('section', { class: ['card', 'card-pad-lg', 'card-glow', 'card-signal', 'home-setup', 'reveal'], style: { '--i': index }, 'aria-labelledby': 'home-setup-h' },
      h('div.home-setup-main',
        h('span.eyebrow', t('setup.eyebrow')),
        h('h2.home-setup-title#home-setup-h', onboarded ? t('setup.titleRuns') : t('setup.title')),
        h('p.home-setup-text', t('setup.text')),
        h('div.btn-row', cta)),
      h('ol.home-setup-steps',
        step(1, onboarded, t('setup.step1'), onboarded ? fmt.goal(d.profile) + (daysText ? ' · ' + daysText : '') : t('setup.step1Text')),
        step(2, false, t('setup.step2'), t(app.strava.supported ? 'setup.step2Text' : 'setup.step2TextLocal')),
        step(3, !!d.recoveryToday, t('setup.step3'), t('setup.step3Text'))));
  }

  // ---------------------------------------------------------------- page
  app.pages.register('home', {
    title: 'ui.nav.home',
    render(container, ctx) {
      mounts.forEach(m => { try { m.destroy(); } catch (e) { /* already gone */ } });
      mounts = [];
      const d = ctx.derived;
      const after = [];
      const s = focusSession(d);
      const hl = headline(d, s);
      const page = ctx.h('div', { class: ['home', ctx.isPhone ? 'home-phone' : 'home-desk'] });

      if (!d.hasRuns) {
        page.append(renderHeadline(ctx, hl), renderSetup(ctx, 1), renderWeek(ctx, null, 2, after));
      } else if (ctx.isPhone) {
        page.append(
          renderHeadline(ctx, hl),
          renderNext(ctx, s, after, 1),
          renderGoal(ctx, after, 2),
          renderRecovery(ctx, 3),
          renderWeek(ctx, s, 4, after),
          renderRuns(ctx, 5),
          renderVolume(ctx, s, 6, after));
      } else {
        page.append(
          renderHeadline(ctx, hl),
          ctx.h('div.home-hero', renderGoal(ctx, after, 1), renderNext(ctx, s, after, 2)),
          renderRecovery(ctx, 3),
          renderWeek(ctx, s, 4, after),
          ctx.h('div.home-lower', renderRuns(ctx, 5), renderVolume(ctx, s, 6, after)));
      }
      ctx.dom.mount(container, page);
      after.forEach(fn => { try { fn(); } catch (err) { console.error('home', err); } });
    },
    onLeave() {
      mounts.forEach(m => { try { m.destroy(); } catch (e) { /* already gone */ } });
      mounts = [];
    }
  });
})(globalThis);
