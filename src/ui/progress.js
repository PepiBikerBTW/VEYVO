/*
 * ui/progress.js - Výkonnost / Progress page.
 *
 * Concept A "Track" progress page with C's range tabs + chart tooltip and B's derived notes column:
 *   topbar  range tabs 4 týdny / 3 měsíce / Vše (in the page on phones) + "27. 10. – 24. 11. · 9 běhů"
 *   1. scoreboard (6 cells, count-ups): runs, distance, moving time, last 7 days, average pace, best 5 km
 *   2. [pace of every run (VeyvoUI.charts.paceChart) | weekly volume stacked by type with run counts]
 *   3. [run log: week groups with totals, type-group filter tabs that double as the legend, derived
 *       notes column, rows open the run, "Doplnit úsilí" on runs without effort |
 *       side: personal records, km by type, milestones (derived, newest first, plus 0.3 legacy ones)]
 * Phone (<= 760 px): range tabs in the page, sections stacked, the log becomes cards.
 *
 * Every number comes from app.derived() / VeyvoRuns over the runner's own runs; nothing is invented.
 * The range (per device, app.storage) changes the scoreboard, both charts, the log and km by type;
 * records and milestones are all-time. Texts: i18n namespace 'progress' (cs + en). CSS:
 * styles/pages/progress.css (prefix prog-).
 *
 * Dialogs used: 'runDetail' { runId, focus } when some module registers it, otherwise the run dialog
 * 'run' { mode: 'edit', runId, focus } (focus: 'effort' from the "Doplnit úsilí" tag).
 *
 * Pure helpers for tests: VeyvoUI.progress.{ periodOf, boardModel, weekGroups, noteItems, typeTotals,
 * volumeBuckets, recordRows, milestoneItems, groupCounts }.
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI;
  const app = UI.app;
  const I18n = root.VeyvoI18n;
  const Runs = root.VeyvoRuns;
  const Format = root.VeyvoFormat;
  const fmt = UI.fmt;
  const NB = ' ';

  // ================================================================ texts (namespace 'progress')
  const MESSAGES = {
    cs: {
      range: { label: 'Období', '4w': '4 týdny', '3m': '3 měsíce', all: 'Vše' },
      eyebrow: '{period} · {runs}',
      eyebrowEmpty: 'Zatím bez běhů',
      board: {
        label: 'Souhrn období',
        runs: 'Běhy',
        runsSub: 'od {date}',
        runsNone: 'v tomto období žádný',
        distance: 'Vzdálenost',
        distanceSub: '{km} km na běh',
        time: 'Čas běhu',
        timeSub: '{time} na běh',
        last7: 'Posledních 7 dní',
        last7None: 'žádný běh',
        pace: 'Průměrné tempo',
        paceSub: 'všechny běhy',
        best: 'Nejlepší {distance} km',
        bestPb: '{date} · {delta}',
        bestFirst: '{date} · první měřený',
        bestBehind: '{date} · rekord {time}',
        bestNone: 'zatím bez měřeného běhu',
        bestNonePeriod: 'v tomto období žádný',
        bestDeltaTitle: 'O {s} s rychleji než předchozí rekord {time}'
      },
      pace: { title: 'Tempo každého běhu', sub: 'min/km · rychlejší nahoře' },
      volume: { title: 'Objem po týdnech', titleMonths: 'Objem po měsících', sub: 'km' },
      log: {
        title: 'Deník běhů',
        sub: '{runs} · nejnovější nahoře',
        filter: 'Typ běhu',
        all: 'Vše',
        date: 'Datum',
        type: 'Typ',
        distance: 'Vzdálenost',
        time: 'Čas',
        pace: 'Tempo',
        effort: 'Úsilí',
        note: 'Poznámka',
        thisWeek: 'Tento týden',
        lastWeek: 'Minulý týden',
        weekTotal: '{km} km · {runs}',
        open: 'Otevřít běh z {date}',
        addEffort: 'Doplnit úsilí',
        addEffortAria: 'Doplnit úsilí k běhu z {date}',
        effortAria: 'Úsilí {n} z 10',
        noEffort: 'Úsilí nezapsáno',
        fromStrava: 'Ze Stravy',
        more: 'Zobrazit další ({n})',
        empty: 'V tomto období není žádný běh.',
        emptyFilter: 'V tomto období není žádný běh tohoto typu.',
        showAll: 'Zobrazit celou historii',
        showAllTypes: 'Zobrazit všechny typy'
      },
      notes: {
        personalBest5k: 'Osobní rekord na 5 km ({delta})',
        firstFiveK: 'První měřená pětka',
        checkpoint: 'Kontrolní bod {time}',
        goal: 'Cíl splněn: {time}',
        firstOver10k: 'První běh přes 10 km',
        longestRun: 'Nejdelší běh ({delta} km)',
        distanceMilestone: '{km} km celkem',
        firstRun: 'První zapsaný běh'
      },
      records: {
        title: 'Osobní maxima',
        sub: 'za celou dobu',
        fastest5k: 'Nejlepší 5 km',
        fastestPace: 'Nejrychlejší tempo',
        fastestPaceHint: 'běhy od 3 km',
        longestRun: 'Nejdelší běh',
        longestDuration: 'Nejdelší čas běhu',
        biggestWeek: 'Největší týden',
        deltaTitle: 'Oproti předchozímu rekordu z {date}',
        open: '{record}: otevřít běh z {date}',
        empty: 'Rekordy se spočítají z tvých běhů.'
      },
      types: {
        title: 'Kilometry podle typu',
        aria: '{type}: {km} km, {runs}',
        empty: 'V tomto období nejsou žádné kilometry.'
      },
      milestones: {
        title: 'Milníky',
        empty: 'Milníky přibydou s tvými běhy: první pětka, osobní rekordy, nejdelší běh a součty kilometrů.',
        more: 'Zobrazit všechny ({n})',
        less: 'Zobrazit méně',
        legacy: 'ze staršího deníku',
        open: '{title}: otevřít běh z {date}'
      },
      ms: {
        firstRun: 'První zapsaný běh',
        firstRunSub: '{date} · {type}, {km} km',
        personalBest5k: 'Osobní rekord na 5 km: {time}',
        personalBest5kSub: '{date} · o {s} s rychleji',
        firstFiveK: 'První měřená pětka: {time}',
        firstFiveKSub: '{date} · výchozí čas pro cíl',
        checkpoint: 'Kontrolní bod {time}',
        checkpointSub: '{date} · výsledek {result}',
        goal: 'Cíl {time} splněn',
        goalSub: '{date} · výsledek {result}',
        firstOver10k: 'První běh přes 10 km',
        firstOver10kSub: '{date} · {km} km',
        longestRun: 'Nejdelší běh: {km} km',
        longestRunSub: '{date} · o {delta} km víc',
        distanceMilestone: '{km} km celkem',
        distanceMilestoneSub: '{date} · {total} km po tomto běhu'
      },
      empty: {
        title: 'Výkonnost se počítá z tvých běhů',
        text: 'Zapiš první běh nebo připoj Stravu. Pak tu uvidíš tempo každého běhu, kilometry po týdnech, osobní rekordy a milníky.',
        textLocal: 'Zapiš první běh nebo obnov zálohu z Windows. Pak tu uvidíš tempo každého běhu, kilometry po týdnech, osobní rekordy a milníky.',
        textStore: 'Zapiš první běh nebo obnov zálohu VEYVO. Pak tu uvidíš tempo každého běhu, kilometry po týdnech, osobní rekordy a milníky.',
        log: 'Zapsat běh',
        strava: 'Připojit Stravu'
      }
    },
    en: {
      range: { label: 'Period', '4w': '4 weeks', '3m': '3 months', all: 'All' },
      eyebrow: '{period} · {runs}',
      eyebrowEmpty: 'No runs yet',
      board: {
        label: 'Period summary',
        runs: 'Runs',
        runsSub: 'since {date}',
        runsNone: 'none in this period',
        distance: 'Distance',
        distanceSub: '{km} km per run',
        time: 'Running time',
        timeSub: '{time} per run',
        last7: 'Last 7 days',
        last7None: 'no runs',
        pace: 'Average pace',
        paceSub: 'all runs',
        best: 'Best {distance} km',
        bestPb: '{date} · {delta}',
        bestFirst: '{date} · first timed',
        bestBehind: '{date} · record {time}',
        bestNone: 'no timed run yet',
        bestNonePeriod: 'none in this period',
        bestDeltaTitle: '{s} s faster than the previous record of {time}'
      },
      pace: { title: 'Pace of every run', sub: 'min/km · faster is higher' },
      volume: { title: 'Weekly volume', titleMonths: 'Monthly volume', sub: 'km' },
      log: {
        title: 'Run log',
        sub: '{runs} · newest first',
        filter: 'Run type',
        all: 'All',
        date: 'Date',
        type: 'Type',
        distance: 'Distance',
        time: 'Time',
        pace: 'Pace',
        effort: 'Effort',
        note: 'Note',
        thisWeek: 'This week',
        lastWeek: 'Last week',
        weekTotal: '{km} km · {runs}',
        open: 'Open the run from {date}',
        addEffort: 'Add effort',
        addEffortAria: 'Add effort to the run from {date}',
        effortAria: 'Effort {n} of 10',
        noEffort: 'Effort not logged',
        fromStrava: 'From Strava',
        more: 'Show more ({n})',
        empty: 'No runs in this period.',
        emptyFilter: 'No runs of this type in this period.',
        showAll: 'Show the whole history',
        showAllTypes: 'Show all types'
      },
      notes: {
        personalBest5k: '5 km personal best ({delta})',
        firstFiveK: 'First timed 5 km',
        checkpoint: 'Checkpoint {time}',
        goal: 'Goal reached: {time}',
        firstOver10k: 'First run over 10 km',
        longestRun: 'Longest run ({delta} km)',
        distanceMilestone: '{km} km in total',
        firstRun: 'First logged run'
      },
      records: {
        title: 'Personal records',
        sub: 'all time',
        fastest5k: 'Best 5 km',
        fastestPace: 'Fastest pace',
        fastestPaceHint: 'runs from 3 km',
        longestRun: 'Longest run',
        longestDuration: 'Longest running time',
        biggestWeek: 'Biggest week',
        deltaTitle: 'Compared with the previous record from {date}',
        open: '{record}: open the run from {date}',
        empty: 'Records are calculated from your runs.'
      },
      types: {
        title: 'Kilometres by type',
        aria: '{type}: {km} km, {runs}',
        empty: 'No kilometres in this period.'
      },
      milestones: {
        title: 'Milestones',
        empty: 'Milestones appear with your runs: your first 5 km, personal records, your longest run and kilometre totals.',
        more: 'Show all ({n})',
        less: 'Show less',
        legacy: 'from the old journal',
        open: '{title}: open the run from {date}'
      },
      ms: {
        firstRun: 'First logged run',
        firstRunSub: '{date} · {type}, {km} km',
        personalBest5k: '5 km personal best: {time}',
        personalBest5kSub: '{date} · {s} s faster',
        firstFiveK: 'First timed 5 km: {time}',
        firstFiveKSub: '{date} · the starting time for your goal',
        checkpoint: 'Checkpoint {time}',
        checkpointSub: '{date} · result {result}',
        goal: 'Goal {time} reached',
        goalSub: '{date} · result {result}',
        firstOver10k: 'First run over 10 km',
        firstOver10kSub: '{date} · {km} km',
        longestRun: 'Longest run: {km} km',
        longestRunSub: '{date} · {delta} km more',
        distanceMilestone: '{km} km in total',
        distanceMilestoneSub: '{date} · {total} km after this run'
      },
      empty: {
        title: 'Progress is calculated from your runs',
        text: 'Log your first run or connect Strava. You will then see the pace of every run, kilometres per week, personal records and milestones.',
        textLocal: 'Log your first run or restore a backup from Windows. You will then see the pace of every run, kilometres per week, personal records and milestones.',
        textStore: 'Log your first run or restore a VEYVO backup. You will then see the pace of every run, kilometres per week, personal records and milestones.',
        log: 'Log a run',
        strava: 'Connect Strava'
      }
    }
  };
  I18n.register('progress', MESSAGES);

  const t = (key, params) => app.t('progress.' + key, params);

  // ================================================================ constants and per-device view state
  const RANGES = Object.freeze(['4w', '3m', 'all']);
  const RANGE_WEEKS = Object.freeze({ '4w': 4, '3m': 13 });
  const RANGE_KEY = 'veyvo-progress-range';
  const RANGE_REASON = 'progress-range';
  const GROUPS = Object.freeze(['fast', 'quality', 'easy']);
  const GROUP_OF = Object.freeze({ run: 'fast', test5k: 'fast', race: 'fast', intervals: 'quality', tempo: 'quality', easy: 'easy', long: 'easy' });
  const NOTE_RANK = Object.freeze({ goal: 0, personalBest5k: 1, firstFiveK: 2, checkpoint: 3, firstOver10k: 4, longestRun: 5, distanceMilestone: 6, firstRun: 7 });
  const PAGE_ROWS = 40;
  const MS_VISIBLE = 6;

  let range = null;          // '4w' | '3m' | 'all'
  let filter = 'all';        // 'all' | 'fast' | 'quality' | 'easy'
  let limit = PAGE_ROWS;
  let msOpen = false;
  let mounts = [];
  let lastBoard = null;      // values on screen, so a range switch counts from the old numbers
  let logState = null;       // { host, ctx, model } for filter / "show more" without a full re-render

  function groupOf(type) { return GROUP_OF[Runs.typeCode(type)] || 'fast'; }
  function typeLabel(type) { return I18n.t('common.runType.' + (Runs.typeCode(type) || 'run')); }
  function currentRange() {
    if (range) return range;
    const saved = app.storage.get(RANGE_KEY);
    range = RANGES.indexOf(saved) >= 0 ? saved : 'all';
    return range;
  }
  function paceOf(run) { return run.movingSeconds / run.distance; }
  function signedKm(n) { return (n > 0 ? '+' : '') + fmt.km(n); }

  // ================================================================ pure view-model helpers

  /**
   * Runs inside the range (sorted oldest first) and the period bounds: { from, to, runs }.
   * 4 weeks / 3 months are whole Monday weeks (4 / 13) ending with this week, so the scoreboard,
   * the log, km by type and the weekly volume bars all count exactly the same runs.
   */
  function periodOf(runs, rangeKey, today) {
    const valid = (runs || []).filter(r => Runs.isValidRun(r));
    const weeks = RANGE_WEEKS[rangeKey];
    if (weeks) {
      const from = Runs.addDays(Runs.weekStartOf(today), -7 * (weeks - 1));
      return { from, to: today, runs: valid.filter(r => r.date >= from && r.date <= today) };
    }
    if (!valid.length) return { from: today, to: today, runs: [] };
    return { from: valid[0].date, to: valid[valid.length - 1].date, runs: valid };
  }

  /** Scoreboard numbers for the range (+ last 7 days and the best effort at the goal distance). */
  function boardModel(d, rangeKey) {
    const period = periodOf(d.runs, rangeKey, d.today);
    const totals = Runs.totals(period.runs);
    const goalKm = d.profile && Number(d.profile.goalDistanceKm) > 0 ? Number(d.profile.goalDistanceKm) : 5;
    const progression = Runs.effortProgression(d.runs, { distanceKm: goalKm });
    const inRange = progression.filter(p => p.date >= period.from && p.date <= period.to);
    let best = null;
    for (const p of inRange) if (!best || p.seconds < best.seconds) best = p;
    const record = progression.reduce((min, p) => (min === null || p.seconds < min ? p.seconds : min), null);
    return {
      period,
      count: totals.count,
      distanceKm: totals.distanceKm,
      movingSeconds: totals.movingSeconds,
      avgPace: totals.avgPaceSecPerKm,
      firstDate: period.runs.length ? period.runs[0].date : null,
      perRunKm: totals.count ? totals.distanceKm / totals.count : null,
      perRunSeconds: totals.count ? totals.movingSeconds / totals.count : null,
      last7: d.last7 || Runs.lastNDays(d.runs, d.today, 7),
      goalKm,
      hasAttempts: progression.length > 0,
      best: best ? {
        seconds: best.seconds, date: best.date, runId: best.runId,
        isPersonalBest: best.isPersonalBest, previousBest: best.previousBest,
        improvement: best.isPersonalBest && best.previousBest !== null ? best.previousBest - best.seconds : null,
        behindRecord: record !== null && best.seconds > record ? best.seconds - record : null,
        record
      } : null
    };
  }

  /** Runs (newest first) grouped by Monday week: [{ weekStart, weekEnd, rel, runs, distanceKm, count }]. */
  function weekGroups(runsDesc, today) {
    const thisWeek = Runs.weekStartOf(today), lastWeek = Runs.addDays(thisWeek, -7);
    const out = [];
    for (const r of runsDesc) {
      const ws = Runs.weekStartOf(r.date);
      let g = out[out.length - 1];
      if (!g || g.weekStart !== ws) {
        g = { weekStart: ws, weekEnd: Runs.addDays(ws, 6), rel: ws === thisWeek ? 'this' : ws === lastWeek ? 'last' : null, runs: [], distanceKm: 0, count: 0, movingSeconds: 0 };
        out.push(g);
      }
      g.runs.push(r);
      g.distanceKm = Math.round((g.distanceKm + r.distance) * 100) / 100;
      g.count += 1;
      g.movingSeconds += r.movingSeconds;
    }
    return out;
  }

  /** Translated derived notes for one run, most important first: [{ code, text, hot }]. */
  function noteItems(notes) {
    const out = [];
    for (const n of notes || []) {
      const p = n.params || {};
      if (n.code === 'personalBest5k') {
        if (p.previousBest === null || p.previousBest === undefined || !p.improvementSeconds) out.push({ code: 'firstFiveK', text: t('notes.firstFiveK'), hot: false });
        else out.push({ code: 'personalBest5k', text: t('notes.personalBest5k', { delta: fmt.seconds(-p.improvementSeconds) }), hot: true });
      } else if (n.code === 'checkpoint') {
        if (p.isGoal) out.push({ code: 'goal', text: t('notes.goal', { time: fmt.duration(p.seconds) }), hot: true });
        else out.push({ code: 'checkpoint', text: t('notes.checkpoint', { time: fmt.duration(p.seconds) }), hot: false });
      } else if (n.code === 'longestRun') {
        out.push({ code: 'longestRun', text: t('notes.longestRun', { delta: signedKm(p.deltaKm) }), hot: false });
      } else if (n.code === 'distanceMilestone') {
        out.push({ code: 'distanceMilestone', text: t('notes.distanceMilestone', { km: fmt.number(p.km, { maxDecimals: 0 }) }), hot: false });
      } else if (n.code === 'firstOver10k' || n.code === 'firstRun') {
        out.push({ code: n.code, text: t('notes.' + n.code), hot: false });
      }
    }
    return out.sort((a, b) => NOTE_RANK[a.code] - NOTE_RANK[b.code]);
  }

  /** Kilometres per run type in the given runs, largest first: [{ type, group, km, count }]. */
  function typeTotals(runs) {
    const map = new Map();
    for (const r of runs || []) {
      if (!Runs.isValidRun(r)) continue;
      const type = Runs.typeCode(r.type) || 'run';
      const row = map.get(type) || { type, group: groupOf(type), km: 0, count: 0 };
      row.km += r.distance;
      row.count += 1;
      map.set(type, row);
    }
    return Array.from(map.values()).map(r => Object.assign(r, { km: Math.round(r.km * 100) / 100 }))
      .sort((a, b) => b.km - a.km || b.count - a.count);
  }

  /** Runs per series group: { all, fast, quality, easy }. */
  function groupCounts(runs) {
    const c = { all: 0, fast: 0, quality: 0, easy: 0 };
    for (const r of runs || []) { c.all += 1; c[groupOf(r.type)] += 1; }
    return c;
  }

  function monthEnd(key) {
    const [y, m] = key.split('-').map(Number);
    const next = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
    return Runs.addDays(next, -1);
  }
  /** Calendar months from the first run to today, in the weeklyTotals shape (for long histories). */
  function monthlyTotals(runs, firstKey, today) {
    const list = [];
    let key = firstKey.slice(0, 8) + '01';
    const last = today.slice(0, 8) + '01';
    for (let guard = 0; key <= last && guard < 240; guard++) {
      const byType = {};
      for (const code of Runs.RUN_TYPES) byType[code] = { count: 0, distanceKm: 0 };
      list.push({ weekStart: key, weekEnd: monthEnd(key), distanceKm: 0, count: 0, movingSeconds: 0, byType, isCurrent: key === last });
      key = Runs.addDays(monthEnd(key), 1);
    }
    const byStart = new Map(list.map(m => [m.weekStart, m]));
    for (const r of runs) {
      if (!Runs.isValidRun(r)) continue;
      const m = byStart.get(r.date.slice(0, 8) + '01');
      if (!m) continue;
      const type = Runs.typeCode(r.type) || 'run';
      m.distanceKm += r.distance; m.count += 1; m.movingSeconds += r.movingSeconds;
      m.byType[type].count += 1; m.byType[type].distanceKm += r.distance;
    }
    for (const m of list) {
      m.distanceKm = Math.round(m.distanceKm * 100) / 100;
      for (const code of Runs.RUN_TYPES) m.byType[code].distanceKm = Math.round(m.byType[code].distanceKm * 100) / 100;
    }
    return list;
  }

  /** Volume buckets for the range: 4 or 13 Monday weeks, all weeks since the first run, or months past 26 weeks. */
  function volumeBuckets(runs, rangeKey, today) {
    const valid = (runs || []).filter(r => Runs.isValidRun(r));
    if (RANGE_WEEKS[rangeKey]) return { kind: 'week', list: Runs.weeklyTotals(valid, today, RANGE_WEEKS[rangeKey]) };
    const first = valid.length && valid[0].date < today ? valid[0].date : today;
    const n = Math.floor(Runs.daysBetween(Runs.weekStartOf(first), Runs.weekStartOf(today)) / 7) + 1;
    if (n <= 26) return { kind: 'week', list: Runs.weeklyTotals(valid, today, Math.max(4, n)) };
    return { kind: 'month', list: monthlyTotals(valid, first, today) };
  }

  /** Personal records (all time) as display rows. */
  function recordRows(records) {
    const r = records || {};
    const rows = [];
    const prevDate = rec => (rec.previous && rec.previous.date ? fmt.date(rec.previous.date, 'dayMonth') : null);
    if (r.fastest5k) rows.push({
      key: 'fastest5k', hot: true, value: fmt.duration(r.fastest5k.value), unit: null, date: fmt.date(r.fastest5k.date), runId: r.fastest5k.runId,
      delta: r.fastest5k.delta !== null ? fmt.seconds(r.fastest5k.delta) : null, prevDate: prevDate(r.fastest5k)
    });
    if (r.fastestPace) rows.push({
      key: 'fastestPace', value: fmt.pace(r.fastestPace.value), unit: '/km', date: fmt.date(r.fastestPace.date), runId: r.fastestPace.runId,
      delta: r.fastestPace.delta !== null && Math.round(r.fastestPace.delta) !== 0 ? fmt.seconds(r.fastestPace.delta) + '/km' : null, prevDate: prevDate(r.fastestPace)
    });
    if (r.longestRun) rows.push({
      key: 'longestRun', value: fmt.km(r.longestRun.value), unit: 'km', date: fmt.date(r.longestRun.date), runId: r.longestRun.runId,
      delta: r.longestRun.delta !== null ? fmt.typo(signedKm(r.longestRun.delta) + ' km') : null, prevDate: prevDate(r.longestRun)
    });
    if (r.longestDuration) rows.push({
      key: 'longestDuration', value: fmt.duration(r.longestDuration.value), unit: null, date: fmt.date(r.longestDuration.date), runId: r.longestDuration.runId,
      delta: r.longestDuration.delta !== null ? '+' + fmt.duration(r.longestDuration.delta) : null, prevDate: prevDate(r.longestDuration)
    });
    if (r.biggestWeek) rows.push({
      key: 'biggestWeek', value: fmt.km(r.biggestWeek.value), unit: 'km', date: fmt.weekRange(r.biggestWeek.weekStart, r.biggestWeek.weekEnd), runId: null,
      delta: r.biggestWeek.delta !== null ? fmt.typo(signedKm(r.biggestWeek.delta) + ' km') : null, prevDate: prevDate(r.biggestWeek)
    });
    return rows;
  }

  const MS_ICON = { firstRun: 'flag', personalBest5k: 'timer', firstFiveK: 'timer', checkpoint: 'target', goal: 'flag', firstOver10k: 'route', longestRun: 'route', distanceMilestone: 'trend' };
  /** Derived milestones + read-only 0.3 ones, newest first: [{ date, code, title, sub, hot, icon, runId }]. */
  function milestoneItems(d) {
    const byId = new Map((d.runs || []).map(r => [r.id, r]));
    const items = [];
    (d.milestones || []).forEach((m, order) => {
      const p = m.params || {}, run = byId.get(m.runId);
      const date = fmt.date(m.date);
      let code = m.code, title, sub;
      if (m.code === 'personalBest5k') {
        const first = p.previousBest === null || p.previousBest === undefined || !p.improvementSeconds;
        code = first ? 'firstFiveK' : 'personalBest5k';
        title = t('ms.' + code, { time: fmt.duration(p.seconds) });
        sub = first ? t('ms.firstFiveKSub', { date }) : t('ms.personalBest5kSub', { date, s: p.improvementSeconds });
      } else if (m.code === 'checkpoint') {
        code = p.isGoal ? 'goal' : 'checkpoint';
        title = t('ms.' + code, { time: fmt.duration(p.seconds) });
        sub = t('ms.' + code + 'Sub', { date, result: run ? fmt.duration(run.movingSeconds) : Format.EMPTY });
      } else if (m.code === 'longestRun') {
        title = t('ms.longestRun', { km: fmt.km(p.distanceKm) });
        sub = t('ms.longestRunSub', { date, delta: fmt.km(p.deltaKm) });
      } else if (m.code === 'firstOver10k') {
        title = t('ms.firstOver10k');
        sub = t('ms.firstOver10kSub', { date, km: fmt.km(p.distanceKm) });
      } else if (m.code === 'distanceMilestone') {
        title = t('ms.distanceMilestone', { km: fmt.number(p.km, { maxDecimals: 0 }) });
        sub = t('ms.distanceMilestoneSub', { date, total: fmt.km(p.totalKm) });
      } else if (m.code === 'firstRun') {
        title = t('ms.firstRun');
        sub = t('ms.firstRunSub', { date, type: run ? typeLabel(run.type).toLocaleLowerCase(I18n.getLocale() === 'cs' ? 'cs-CZ' : 'en-GB') : '', km: run ? fmt.km(run.distance) : Format.EMPTY });
      } else return;
      items.push({ date: m.date, order, code, title, sub, hot: code === 'personalBest5k' || code === 'goal', icon: MS_ICON[code] || 'flag', runId: m.runId || null });
    });
    (d.legacyMilestones || []).forEach((l, i) => {
      const key = String(l && l.date || '').slice(0, 10);
      if (!l || !l.label || !Runs.isDateKey(key)) return;
      items.push({ date: key, order: -1 - i, code: 'legacy', title: String(l.label), sub: fmt.date(key) + ' · ' + t('milestones.legacy'), hot: false, icon: 'flag', runId: null, legacy: true });
    });
    return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (NOTE_RANK[a.code] ?? 9) - (NOTE_RANK[b.code] ?? 9) || a.order - b.order));
  }

  UI.progress = { MESSAGES, RANGES, periodOf, boardModel, weekGroups, noteItems, typeTotals, volumeBuckets, recordRows, milestoneItems, groupCounts };

  // ================================================================ actions

  function openRun(runId, focus) {
    if (!runId) return;
    if (app.dialogs.has('runDetail')) app.dialogs.open('runDetail', focus ? { runId, focus } : { runId });
    else app.dialogs.open('run', focus ? { mode: 'edit', runId, focus } : { mode: 'edit', runId });
  }

  function setRange(value) {
    if (RANGES.indexOf(value) < 0 || value === currentRange()) return;
    const doc = root.document;
    const hadFocus = !!(doc.activeElement && doc.activeElement.closest && doc.activeElement.closest('.prog-range'));
    range = value;
    limit = PAGE_ROWS;
    app.storage.set(RANGE_KEY, value);
    // Re-render shell (eyebrow + tabs) and page; animate: true replays the charts and counts from the old numbers.
    app.refresh({ animate: true, reason: RANGE_REASON });
    if (hadFocus) {
      const btn = doc.querySelector('.prog-range [data-key="prog-range:' + value + '"]');
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  function destroyMounts() {
    mounts.forEach(m => { try { m.destroy(); } catch (e) { /* already gone */ } });
    mounts = [];
  }

  /** Small WAAPI rise for content swapped by a local interaction (filter, show more). */
  function rise(nodes) {
    if (UI.motion.prefersReduced()) return;
    nodes.slice(0, 14).forEach((el, i) => {
      if (typeof el.animate !== 'function') return;
      el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
        { duration: 240, delay: i * 18, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' });
    });
  }

  // ================================================================ view pieces

  function rangeControl(ctx, inPage) {
    const el = ctx.components.create('segmented', {
      options: RANGES.map(v => ({ value: v, label: t('range.' + v) })),
      value: currentRange(), label: t('range.label'), key: 'prog-range', size: inPage ? 'lg' : null,
      onChange: setRange
    });
    el.classList.add('prog-range');
    return inPage ? ctx.h('div.prog-range-row', el) : el;
  }

  function reveal(el, mode, i) {
    if (mode === 'enter') { el.classList.add('reveal'); el.style.setProperty('--i', String(i)); }
    return el;
  }

  // ---------------------------------------------------------------- 1. scoreboard
  function renderBoard(ctx, m, mode, after) {
    const { h } = ctx;
    const prev = mode === 'range' ? lastBoard : null;
    const jobs = [];
    const num = (text, cls) => h('span', { class: ['num', cls] }, text);
    const unit = text => h('span.unit', NB + text);
    const count = (el, to, from, format, delay) => {
      if (mode === 'static' || !Number.isFinite(to) || !Number.isFinite(from) || from === to) return;
      jobs.push(() => UI.motion.countUp(el, to, { from, format, delay }));
    };
    const fromOr = (key, base) => (prev && Number.isFinite(prev[key]) ? prev[key] : (mode === 'enter' ? base : null));
    const cell = (label, value, sub, opts) => h('div', { class: ['stat', 'prog-stat', opts && opts.hot ? 'stat-hot' : null], title: opts && opts.title || null },
      h('span.stat-label', label),
      h('span.stat-value', value),
      h('span.stat-sub', sub || NB));

    const cells = [];
    // runs
    const runsEl = num(String(m.count));
    count(runsEl, m.count, fromOr('count', 0), v => String(Math.round(v)), 0);
    cells.push(cell(t('board.runs'), runsEl, m.count ? t('board.runsSub', { date: fmt.date(m.firstDate, 'dayMonth') }) : t('board.runsNone')));
    // distance
    const kmEl = num(fmt.km(m.distanceKm));
    count(kmEl, m.distanceKm, fromOr('distanceKm', 0), v => fmt.km(v), 40);
    cells.push(cell(t('board.distance'), [kmEl, unit('km')], m.count ? t('board.distanceSub', { km: fmt.km(m.perRunKm) }) : null));
    // running time as '5 h 41 min' (VeyvoFormat.durationWords parts, each number counted)
    const words = m.movingSeconds > 0 ? Format.durationWords(m.movingSeconds) : '0 min';
    const parts = [];
    const re = /(\d+)\s+(\S+)/g;
    let match, pi = 0;
    while ((match = re.exec(words))) {
      const n = Number(match[1]);
      const el = num(match[1]);
      const prevPart = prev && prev.timeParts ? prev.timeParts[match[2]] : null;
      count(el, n, Number.isFinite(prevPart) ? prevPart : (mode === 'enter' ? 0 : null), v => String(Math.round(v)), 80 + pi * 40);
      if (parts.length) parts.push(' ');
      parts.push(el, unit(match[2]));
      pi += 1;
    }
    if (!parts.length) parts.push(num(words));
    cells.push(cell(t('board.time'), parts, m.count ? t('board.timeSub', { time: fmt.duration(m.perRunSeconds) }) : null));
    // last 7 days (independent of the range)
    const l7El = num(fmt.km(m.last7.distanceKm));
    count(l7El, m.last7.distanceKm, fromOr('last7', 0), v => fmt.km(v), 120);
    cells.push(cell(t('board.last7'), [l7El, unit('km')], m.last7.count ? fmt.count('common.count.runs', m.last7.count) : t('board.last7None')));
    // average pace
    const paceEl = num(m.avgPace ? fmt.pace(m.avgPace) : Format.EMPTY);
    if (m.avgPace) count(paceEl, m.avgPace, prev && Number.isFinite(prev.avgPace) ? prev.avgPace : null, v => fmt.pace(v), 160);
    cells.push(cell(t('board.pace'), m.avgPace ? [paceEl, unit('/km')] : paceEl, m.avgPace ? t('board.paceSub') : null));
    // best effort at the goal distance (counted DOWN from the previous best: the improvement itself)
    const b = m.best;
    const bestEl = num(b ? fmt.duration(b.seconds) : Format.EMPTY);
    let bestSub = m.hasAttempts ? t('board.bestNonePeriod') : t('board.bestNone'), bestTitle = null;
    if (b) {
      const date = fmt.date(b.date);
      if (b.improvement) {
        bestSub = t('board.bestPb', { date, delta: fmt.seconds(-b.improvement) });
        bestTitle = t('board.bestDeltaTitle', { s: b.improvement, time: fmt.duration(b.previousBest) });
      } else if (b.behindRecord) bestSub = t('board.bestBehind', { date, time: fmt.duration(b.record) });
      else bestSub = t('board.bestFirst', { date });
      const from = prev && Number.isFinite(prev.best) ? prev.best : (mode === 'enter' && b.improvement ? b.previousBest : null);
      count(bestEl, b.seconds, from, v => fmt.duration(Math.round(v)), 200);
    }
    cells.push(cell(t('board.best', { distance: fmt.km(m.goalKm, { trim: true }) }), bestEl, bestSub, { hot: true, title: bestTitle }));

    const timeParts = {};
    words.replace(/(\d+)\s+(\S+)/g, (all, n, u) => { timeParts[u] = Number(n); return all; });
    lastBoard = { count: m.count, distanceKm: m.distanceKm, timeParts, last7: m.last7.distanceKm, avgPace: m.avgPace, best: b ? b.seconds : null };
    after.push(() => jobs.forEach(fn => fn()));
    return reveal(h('section.stat-board.prog-board', { 'aria-label': t('board.label') }, cells), mode, 0);
  }

  // ---------------------------------------------------------------- 2. charts
  function visibleGroups(runs) {
    const seen = new Set(runs.map(r => groupOf(r.type)));
    return GROUPS.filter(g => seen.has(g));
  }

  function renderPace(ctx, m, rng, mode, after) {
    const { h, charts, derived: d } = ctx;
    const groups = visibleGroups(m.period.runs);
    const goalPace = d.goal && Number.isFinite(d.goal.targetPace) ? d.goal.targetPace : null;
    const host = h('div.prog-pace-chart');
    const height = ctx.isPhone ? 236 : 292;
    // The period's runs (whole weeks); the chart's own range only sets the time axis (28 / 91 days).
    after.push(() => mounts.push(charts.mount(host, o => charts.paceChart(rng === 'all' ? d.runs : m.period.runs, Object.assign({
      goalPace, range: rng, today: d.today, bestRunId: d.goal ? d.goal.bestRunId : null, height, title: t('pace.title')
    }, o)))));
    return reveal(h('section.card.card-pad.prog-chart.prog-pace', { 'aria-labelledby': 'prog-pace-h' },
      h('div.card-head',
        h('h2.card-title#prog-pace-h', t('pace.title')),
        h('span.card-sub', t('pace.sub')),
        groups.length ? h('div.card-end', charts.legend({ groups, goal: !!goalPace })) : null),
      host), mode, 1);
  }

  function renderVolume(ctx, m, rng, mode, after) {
    const { h, charts, derived: d } = ctx;
    const buckets = volumeBuckets(d.runs, rng, d.today);
    const groups = visibleGroups(m.period.runs);
    const title = buckets.kind === 'month' ? t('volume.titleMonths') : t('volume.title');
    const host = h('div.prog-vol-chart');
    const height = ctx.isPhone ? 196 : 238;
    after.push(() => mounts.push(charts.mount(host, o => charts.weeklyVolume(buckets.list, Object.assign({
      stackedByType: true, showCounts: true, height, title
    }, o)))));
    return reveal(h('section.card.card-pad.prog-chart.prog-vol', { 'aria-labelledby': 'prog-vol-h' },
      h('div.card-head', h('h2.card-title#prog-vol-h', title), h('span.card-sub', t('volume.sub'))),
      host,
      groups.length > 1 ? charts.legend({ groups }) : null), mode, 2);
  }

  // ---------------------------------------------------------------- 3. run log
  function effortNode(ctx, r, key) {
    const { h, charts, icons } = ctx;
    if (Number.isFinite(r.effort) && r.effort > 0) {
      return h('span.meter-val.prog-eff', charts.meter(r.effort, 10, { label: t('log.effortAria', { n: r.effort }), animate: true }),
        h('span.num', { 'aria-hidden': 'true' }, String(r.effort)));
    }
    return h('button.chip.chip-sm.chip-plan.prog-eff-add', {
      type: 'button', 'data-key': key, 'aria-label': t('log.addEffortAria', { date: fmt.date(r.date, 'long') }),
      onClick: e => { e.stopPropagation(); openRun(r.id, 'effort'); }
    }, icons.get('plus'), t('log.addEffort'));
  }

  function noteNode(ctx, r, notes) {
    const { h, icons } = ctx;
    const items = noteItems(notes);
    const own = String(r.note || '').trim();
    if (!items.length && !own) return h('span.faint', Format.EMPTY);
    const parts = [];
    items.forEach((n, i) => {
      if (i) parts.push(h('span.prog-note-sep', { 'aria-hidden': 'true' }, ' · '));
      parts.push(h('span', { class: ['prog-note-item', n.hot ? 'is-hot' : null] }, n.hot && i === 0 ? icons.get('flag', { size: 13, className: 'prog-note-ic' }) : null, n.text));
    });
    if (own) {
      if (parts.length) parts.push(h('span.prog-note-sep', { 'aria-hidden': 'true' }, ' · '));
      parts.push(h('span.prog-note-own', fmt.typo(own)));
    }
    const full = items.map(n => n.text).concat(own ? [own] : []).join(' · ');
    return h('span.prog-note', { title: full }, parts);
  }

  function weekLabel(g) {
    const rangeText = fmt.weekRange(g.weekStart, g.weekEnd);
    if (g.rel === 'this') return t('log.thisWeek') + ' · ' + rangeText;
    if (g.rel === 'last') return t('log.lastWeek') + ' · ' + rangeText;
    return rangeText;
  }
  function weekTotal(g) { return t('log.weekTotal', { km: fmt.km(g.distanceKm), runs: fmt.count('common.count.runs', g.count) }); }

  function logModel(ctx, m) {
    const d = ctx.derived;
    const runsDesc = m.period.runs.slice().reverse();
    const counts = groupCounts(runsDesc);
    if (filter !== 'all' && !counts[filter]) filter = 'all';
    const shown = filter === 'all' ? runsDesc : runsDesc.filter(r => groupOf(r.type) === filter);
    return { runsDesc, counts, shown, visible: shown.slice(0, limit), groups: weekGroups(shown.slice(0, limit), d.today) };
  }

  function logTable(ctx, lm, mode) {
    const { h, components, derived: d } = ctx;
    const rows = [];
    let n = 0;
    lm.groups.forEach(g => {
      rows.push(h('tr.group-row.prog-week', h('td', { colspan: 7 },
        h('div.prog-week-in', h('span.prog-week-l', weekLabel(g)), h('span.prog-week-r', weekTotal(g))))));
      g.runs.forEach(r => {
        const i = n++;
        const tr = h('tr', {
          class: ['is-clickable', 'prog-row', mode === 'enter' && i < 14 ? 'reveal' : null, mode === 'range' && i < 14 ? 'fade-in' : null],
          style: mode === 'enter' ? { '--i': Math.min(4 + i, 16) } : mode === 'range' ? { '--i': i } : null,
          title: r.source === 'strava' && r.name ? t('log.fromStrava') + ': ' + r.name : null,
          onClick: e => { if (!e.target.closest('button')) openRun(r.id); }
        },
        h('td.dt', h('button.prog-open', { type: 'button', 'data-key': 'prog-run-' + r.id, 'aria-label': t('log.open', { date: fmt.date(r.date, 'long') }), onClick: () => openRun(r.id) }, fmt.date(r.date))),
        h('td.prog-col-type', components.create('typeTag', { type: r.type })),
        h('td.r.n', fmt.km(r.distance), h('span.unit', NB + 'km')),
        h('td.r.n', fmt.duration(r.movingSeconds)),
        h('td.r.n.prog-col-pace', fmt.pace(paceOf(r)), h('span.unit', NB + '/km')),
        h('td.prog-col-eff', effortNode(ctx, r, 'prog-eff-' + r.id)),
        h('td.prog-col-note', noteNode(ctx, r, Runs.notesOf(d.notes, r.id))));
        rows.push(tr);
      });
    });
    return h('div.table-wrap.prog-table-wrap', h('table.table.prog-table',
      h('caption.sr-only', t('log.title')),
      h('thead', h('tr',
        h('th', { scope: 'col' }, t('log.date')),
        h('th', { scope: 'col' }, t('log.type')),
        h('th.r', { scope: 'col' }, t('log.distance')),
        h('th.r', { scope: 'col' }, t('log.time')),
        h('th.r.prog-col-pace', { scope: 'col' }, t('log.pace')),
        h('th.prog-col-eff', { scope: 'col' }, t('log.effort')),
        h('th.prog-col-note', { scope: 'col' }, t('log.note')))),
      h('tbody', rows)));
  }

  function logCards(ctx, lm, mode) {
    const { h, icons, components, derived: d } = ctx;
    const list = h('div.prog-cards');
    let n = 0;
    lm.groups.forEach(g => {
      list.append(h('div.prog-cards-week', h('span.prog-week-l', weekLabel(g)), h('span.prog-week-r', weekTotal(g))));
      const ul = h('ul.prog-cards-list');
      g.runs.forEach(r => {
        const i = n++;
        const notes = noteItems(Runs.notesOf(d.notes, r.id));
        const own = String(r.note || '').trim();
        ul.append(h('li', {
          class: ['prog-card-run', notes.some(x => x.hot) ? 'is-hot' : null, mode === 'enter' && i < 10 ? 'reveal' : null, mode === 'range' && i < 10 ? 'fade-in' : null],
          style: mode !== 'static' ? { '--i': mode === 'enter' ? Math.min(4 + i, 14) : i } : null
        },
        h('button.prog-card-open', { type: 'button', 'data-key': 'prog-run-' + r.id, 'aria-label': t('log.open', { date: fmt.date(r.date, 'long') }), onClick: () => openRun(r.id) }),
        h('div.prog-card-top', h('span.prog-card-date', fmt.date(r.date)), components.create('typeTag', { type: r.type }),
          h('span.prog-card-eff', effortNode(ctx, r, 'prog-eff-' + r.id))),
        h('div.prog-card-figs',
          h('span.prog-card-fig', h('span.num', fmt.km(r.distance)), h('span.unit', NB + 'km')),
          h('span.prog-card-fig', h('span.num', fmt.duration(r.movingSeconds))),
          h('span.prog-card-fig', h('span.num', fmt.pace(paceOf(r))), h('span.unit', NB + '/km'))),
        notes.length || own ? h('div.prog-card-note', noteNode(ctx, r, Runs.notesOf(d.notes, r.id))) : null,
        icons.get('chevron-right', { className: 'prog-card-chev' })));
      });
      list.append(ul);
    });
    return list;
  }

  function logBody(ctx, lm, mode) {
    const { h, components } = ctx;
    if (!lm.shown.length) {
      const inFilter = filter !== 'all' && lm.runsDesc.length;
      const action = inFilter
        ? h('button.btn.btn-secondary.btn-sm', { type: 'button', 'data-key': 'prog-log-reset', onClick: () => setFilter('all') }, t('log.showAllTypes'))
        : currentRange() !== 'all' ? h('button.btn.btn-secondary.btn-sm', { type: 'button', 'data-key': 'prog-log-all', onClick: () => setRange('all') }, t('log.showAll')) : null;
      return h('div.prog-log-empty', components.create('empty', { icon: 'list', text: inFilter ? t('log.emptyFilter') : t('log.empty'), actions: action ? [action] : [] }));
    }
    const body = ctx.isPhone ? logCards(ctx, lm, mode) : logTable(ctx, lm, mode);
    const rest = lm.shown.length - lm.visible.length;
    const more = rest > 0 ? h('div.prog-more', h('button.btn.btn-ghost.btn-sm', {
      type: 'button', 'data-key': 'prog-log-more',
      onClick: () => { limit += PAGE_ROWS; rebuildLog({ focusFrom: lm.visible.length }); }
    }, ctx.icons.get('chevron-down'), t('log.more', { n: Math.min(rest, PAGE_ROWS) }))) : null;
    return [body, more];
  }

  function filterControl(ctx, counts) {
    const options = [{ value: 'all', label: t('log.all'), count: counts.all }]
      .concat(GROUPS.filter(g => counts[g]).map(g => ({ value: g, label: I18n.t('charts.group.' + g), dot: g, count: counts[g] })));
    const el = ctx.components.create('segmented', { options, value: filter, label: t('log.filter'), key: 'prog-filter', onChange: setFilter });
    el.classList.add('prog-filter');
    return el;
  }

  function setFilter(value) {
    if (value === filter) return;
    filter = value;
    limit = PAGE_ROWS;
    rebuildLog({ animate: true });
    // keep the filter tabs in sync when the change came from an empty-state button
    if (logState && logState.filterEl && logState.filterEl.setValue) logState.filterEl.setValue(value);
  }

  function rebuildLog(opts) {
    const o = opts || {};
    if (!logState || !logState.host || !logState.host.isConnected) return;
    const { ctx, m } = logState;
    const lm = logModel(ctx, m);
    logState.lm = lm;
    ctx.dom.mount(logState.host, logBody(ctx, lm, 'static'));
    ctx.icons.hydrate(logState.host);
    if (logState.subEl) logState.subEl.textContent = t('log.sub', { runs: fmt.count('common.count.runs', lm.shown.length) });
    const rows = Array.from(logState.host.querySelectorAll(ctx.isPhone ? '.prog-card-run' : '.prog-row'));
    if (o.animate) rise(rows);
    if (Number.isInteger(o.focusFrom)) {
      const target = rows[o.focusFrom];
      rise(rows.slice(o.focusFrom));
      const btn = target && target.querySelector('.prog-open, .prog-card-open');
      if (btn) btn.focus({ preventScroll: false });
    }
  }

  function renderLog(ctx, m, mode) {
    const { h } = ctx;
    const lm = logModel(ctx, m);
    const host = h('div.prog-log-body');
    const subEl = h('span.card-sub', t('log.sub', { runs: fmt.count('common.count.runs', lm.shown.length) }));
    const filterEl = lm.runsDesc.length ? filterControl(ctx, lm.counts) : null;
    ctx.dom.mount(host, logBody(ctx, lm, mode));
    logState = { host, ctx, m, lm, subEl, filterEl };
    return reveal(h('section.card.prog-log', { 'aria-labelledby': 'prog-log-h' },
      h('div.card-head.prog-log-head', h('h2.card-title#prog-log-h', t('log.title')), subEl, filterEl ? h('div.card-end.prog-log-filter', filterEl) : null),
      host), mode, 3);
  }

  // ---------------------------------------------------------------- 4. side column
  function renderRecords(ctx, mode, i) {
    const { h, derived: d } = ctx;
    const rows = recordRows(d.records);
    const list = h('div.prog-recs');
    if (!rows.length) list.append(h('p.prog-side-empty', t('records.empty')));
    rows.forEach(r => {
      const label = t('records.' + r.key);
      const inner = [
        h('span.prog-rec-main', h('span.prog-rec-label', label), h('span.prog-rec-date', r.date, r.key === 'fastestPace' ? ' · ' + t('records.fastestPaceHint') : '')),
        r.delta ? h('span.chip.chip-sm.prog-rec-delta', { title: r.prevDate ? t('records.deltaTitle', { date: r.prevDate }) : null }, r.delta) : h('span'),
        h('span', { class: ['num', 'prog-rec-val', r.hot ? 'is-hot' : null] }, r.value, r.unit ? h('span.unit', NB + r.unit) : null)
      ];
      list.append(r.runId
        ? h('button.prog-rec', { type: 'button', 'data-key': 'prog-rec-' + r.key, 'aria-label': t('records.open', { record: label + ' ' + r.value + (r.unit ? NB + r.unit : ''), date: r.date }), onClick: () => openRun(r.runId) }, inner)
        : h('div.prog-rec', inner));
    });
    return reveal(h('section.card.card-pad.prog-panel.prog-records', { 'aria-labelledby': 'prog-rec-h' },
      h('div.card-head', h('h2.card-title#prog-rec-h', t('records.title')), h('span.card-sub', t('records.sub'))),
      list), mode, i);
  }

  function renderTypes(ctx, m, mode, i, after) {
    const { h } = ctx;
    const rows = typeTotals(m.period.runs);
    const max = rows.length ? rows[0].km : 0;
    const list = h('div.prog-types');
    const fills = [];
    if (!rows.length) list.append(h('p.prog-side-empty', t('types.empty')));
    rows.forEach(r => {
      const fill = h('span.bar-fill');
      fills.push([fill, max > 0 ? r.km / max : 0]);
      list.append(h('div.prog-type', { role: 'img', 'aria-label': t('types.aria', { type: typeLabel(r.type), km: fmt.km(r.km), runs: fmt.count('common.count.runs', r.count) }) },
        h('span.prog-type-name', { 'aria-hidden': 'true' }, h('i', { class: 'dot dot-' + r.group }), typeLabel(r.type)),
        h('span', { class: ['bar', 'prog-type-bar', r.group === 'quality' ? 'bar-cool' : r.group === 'easy' ? 'bar-easy' : null], 'aria-hidden': 'true' }, fill),
        h('span.num.prog-type-val', { 'aria-hidden': 'true' }, fmt.km(r.km), h('span.unit', NB + 'km'))));
    });
    after.push(() => fills.forEach(([el, f], k) => UI.motion.fillBar(el, f, { delay: mode === 'enter' ? 220 + k * 50 : k * 40 })));
    return reveal(h('section.card.card-pad.prog-panel.prog-types-card', { 'aria-labelledby': 'prog-types-h' },
      h('div.card-head', h('h2.card-title#prog-types-h', t('types.title')), rows.length ? h('span.card-end.num.prog-types-total', fmt.km(m.distanceKm), h('span.unit', NB + 'km')) : null),
      list), mode, i);
  }

  function msNode(ctx, it) {
    const { h, icons } = ctx;
    const body = [
      h('span.prog-ms-mark', icons.get(it.icon, { size: 15 })),
      h('span.prog-ms-main', h('span.prog-ms-title', it.title), h('span.prog-ms-sub', it.sub)),
      it.runId ? icons.get('chevron-right', { className: 'prog-ms-chev', size: 15 }) : null
    ];
    return h('li', { class: ['prog-ms-item', it.hot ? 'is-hot' : null, it.legacy ? 'is-legacy' : null] },
      it.runId
        ? h('button.prog-ms-row', { type: 'button', 'data-key': 'prog-ms-' + it.runId + '-' + it.code, 'aria-label': t('milestones.open', { title: it.title, date: fmt.date(it.date, 'long') }), onClick: () => openRun(it.runId) }, body)
        : h('div.prog-ms-row', body));
  }

  function renderMilestones(ctx, mode, i) {
    const { h, icons, derived: d } = ctx;
    const items = milestoneItems(d);
    const list = h('ol.prog-ms');
    const shown = msOpen ? items : items.slice(0, MS_VISIBLE);
    shown.forEach(it => list.append(msNode(ctx, it)));
    let toggle = null;
    if (items.length > MS_VISIBLE) {
      toggle = h('button.btn.btn-ghost.btn-sm.prog-ms-toggle', {
        type: 'button', 'data-key': 'prog-ms-toggle', 'aria-expanded': msOpen ? 'true' : 'false',
        onClick: () => {
          msOpen = !msOpen;
          const before = list.children.length;
          list.replaceChildren();
          (msOpen ? items : items.slice(0, MS_VISIBLE)).forEach(it => list.append(msNode(ctx, it)));
          toggle.setAttribute('aria-expanded', msOpen ? 'true' : 'false');
          toggle.replaceChildren(icons.get(msOpen ? 'chevron-up' : 'chevron-down'), msOpen ? t('milestones.less') : t('milestones.more', { n: items.length }));
          if (msOpen) rise(Array.from(list.children).slice(before));
        }
      }, icons.get(msOpen ? 'chevron-up' : 'chevron-down'), msOpen ? t('milestones.less') : t('milestones.more', { n: items.length }));
    }
    if (mode === 'enter') shown.forEach((it, k) => { const li = list.children[k]; li.classList.add('reveal'); li.style.setProperty('--i', String(6 + k)); });
    return reveal(h('section.card.card-pad.prog-panel.prog-milestones', { 'aria-labelledby': 'prog-ms-h' },
      h('div.card-head', h('h2.card-title#prog-ms-h', t('milestones.title')), items.length ? h('span.card-end.num.prog-ms-count', String(items.length)) : null),
      items.length ? list : h('p.prog-side-empty', t('milestones.empty')),
      toggle), mode, i);
  }

  // ---------------------------------------------------------------- empty page (no runs at all)
  function renderEmpty(ctx) {
    const { h, icons } = ctx;
    const actions = [h('button.btn.btn-primary', { type: 'button', 'data-action': 'log-run', 'data-key': 'prog-empty-log' }, icons.get('plus'), t('empty.log'))];
    if (app.strava.supported) actions.push(h('button.btn.btn-secondary', { type: 'button', 'data-action': 'connection', 'data-key': 'prog-empty-strava' }, icons.get('link'), t('empty.strava')));
    return h('section.card.card-pad-lg.card-glow.prog-empty.reveal', ctx.components.create('empty', {
      icon: 'trend', title: t('empty.title'), text: t(app.strava.supported ? 'empty.text' : app.build.store ? 'empty.textStore' : 'empty.textLocal'), actions
    }));
  }

  // ================================================================ page
  app.pages.register('progress', {
    title: 'ui.nav.progress',
    eyebrow(ctx) {
      const d = ctx.derived;
      if (!d.hasRuns) return t('eyebrowEmpty');
      const p = periodOf(d.runs, currentRange(), d.today);
      const period = p.from === p.to ? fmt.date(p.from, 'dayMonth') : fmt.weekRange(p.from, p.to);
      return t('eyebrow', { period, runs: fmt.count('common.count.runs', p.runs.length) });
    },
    actions(ctx) {
      if (ctx.isPhone || !ctx.derived.hasRuns) return null;
      return rangeControl(ctx, false);
    },
    render(container, ctx) {
      destroyMounts();
      const { h, derived: d } = ctx;
      const rng = currentRange();
      const mode = ctx.animate ? (ctx.reason === RANGE_REASON ? 'range' : 'enter') : 'static';
      if (ctx.reason === 'navigate') { msOpen = false; limit = PAGE_ROWS; }
      const page = h('div', { class: ['prog', ctx.isPhone ? 'prog-phone' : 'prog-desk'] });
      if (!d.hasRuns) {
        logState = null;
        lastBoard = null;
        page.append(renderEmpty(ctx));
        ctx.dom.mount(container, page);
        return;
      }
      const after = [];
      const m = boardModel(d, rng);
      if (ctx.isPhone) page.append(rangeControl(ctx, true));
      page.append(
        renderBoard(ctx, m, mode, after),
        h('div.prog-charts', renderPace(ctx, m, rng, mode, after), renderVolume(ctx, m, rng, mode, after)),
        h('div.prog-lower',
          renderLog(ctx, m, mode),
          h('div.prog-side',
            h('div.prog-side-a', renderRecords(ctx, mode, 4), renderTypes(ctx, m, mode, 5, after)),
            h('div.prog-side-b', renderMilestones(ctx, mode, 6)))));
      ctx.dom.mount(container, page);
      after.forEach(fn => { try { fn(); } catch (err) { console.error('progress', err); } });
    },
    onLeave() {
      destroyMounts();
      logState = null;
    }
  });
})(globalThis);
