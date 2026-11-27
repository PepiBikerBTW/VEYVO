/*
 * VeyvoRuns - pure run statistics for VEYVO (schema v2 Run records).
 *
 * Classic UMD script: no DOM, no network, no hidden clock. Every function that
 * depends on "now" takes todayKey ('YYYY-MM-DD'). Dates are handled as calendar
 * keys with UTC day arithmetic, so time zones and DST never shift a day.
 *
 * Everything returned is data or codes; the UI translates (cs/en) and formats.
 * Invalid runs (bad date, distance <= 0, missing time) are ignored everywhere.
 */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const RUN_TYPES = Object.freeze(['run', 'easy', 'long', 'tempo', 'intervals', 'test5k', 'race']);
  const LEGACY_TYPES = Object.freeze({
    'Běh': 'run', 'Lehký běh': 'easy', 'Dlouhý běh': 'long', 'Tempo': 'tempo',
    'Intervaly': 'intervals', 'Test 5 km': 'test5k', 'Závod': 'race'
  });
  const FIVE_K_TYPES = new Set(['run', 'test5k', 'race']);
  const ATTEMPT_TYPES = new Set(['run', 'race']);
  const FIVE_K_MIN_KM = 4.95;
  const FIVE_K_MAX_KM = 5.2;
  const ATTEMPT_TOLERANCE = 0.03;
  // Faster than 2:00/km over a timed effort is a typo (e.g. minutes entered as seconds), not a record.
  const MIN_PLAUSIBLE_PACE = 120;
  const FASTEST_PACE_MIN_KM = 3;
  const LONG_RUN_KM = 10;
  const DISTANCE_MILESTONES = Object.freeze([50, 100, 250, 500, 1000]);
  const CHECKPOINT_STEPS = Object.freeze([30, 60, 120, 300, 600, 900, 1800, 3600]);
  const MAX_INTERMEDIATE_CHECKPOINTS = 5;
  const MAX_LADDER_MARKS = 1000;
  const MAX_SECONDS = 172800;
  const DUPLICATE_KM = 0.15;
  const DUPLICATE_SECONDS = 90;

  // ---------- calendar keys ----------

  function isDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }
  function requireDateKey(value, name) {
    if (!isDateKey(value)) throw new TypeError((name || 'todayKey') + " must be a valid 'YYYY-MM-DD' date");
    return value;
  }
  function dayNumber(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  }
  function fromDayNumber(n) { return new Date(n * DAY_MS).toISOString().slice(0, 10); }
  function addDays(key, n) { return fromDayNumber(dayNumber(key) + n); }
  function daysBetween(fromKey, toKey) { return dayNumber(toKey) - dayNumber(fromKey); }
  /** 0 = Monday ... 6 = Sunday (same convention as profile.days / VeyvoTraining). */
  function weekdayIndex(key) { return (new Date(dayNumber(key) * DAY_MS).getUTCDay() + 6) % 7; }
  function weekStartOf(key) { return addDays(key, -weekdayIndex(key)); }

  // ---------- numbers ----------

  function round(value, digits) {
    const f = Math.pow(10, digits);
    return Math.round(value * f) / f;
  }
  function positiveInteger(value, fallback, name) {
    if (value === undefined || value === null) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 5200) throw new RangeError((name || 'value') + ' must be a positive whole number');
    return n;
  }

  // ---------- run fields ----------

  function typeCode(value) {
    if (RUN_TYPES.includes(value)) return value;
    if (typeof value === 'string') {
      const label = value.trim();
      if (RUN_TYPES.includes(label)) return label;
      if (Object.prototype.hasOwnProperty.call(LEGACY_TYPES, label)) return LEGACY_TYPES[label];
    }
    return 'run';
  }
  function parseClock(value) {
    if (typeof value !== 'string' || !/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value.trim())) return null;
    const parts = value.trim().split(':').map(Number);
    if (parts.slice(1).some(n => n > 59)) return null;
    const seconds = parts.reduce((sum, n) => sum * 60 + n, 0);
    return seconds > 0 ? seconds : null;
  }
  function runDate(run) {
    const key = run && typeof run.date === 'string' ? run.date.slice(0, 10) : '';
    return isDateKey(key) ? key : null;
  }
  function runDistance(run) {
    const n = Number(run && run.distance);
    return run && run.distance !== null && run.distance !== '' && Number.isFinite(n) && n > 0 && n <= 1000 ? n : null;
  }
  function runSeconds(run) {
    if (!run) return null;
    const raw = run.movingSeconds;
    const n = raw === null || raw === undefined || raw === '' ? parseClock(run.time) : Number(raw);
    return Number.isFinite(n) && n > 0 && n <= MAX_SECONDS ? n : null;
  }
  function runStartTime(run) {
    return run && typeof run.startTime === 'string' && /^\d{2}:\d{2}$/.test(run.startTime) ? run.startTime : '';
  }
  function runKey(run, index) {
    return run.id !== undefined && run.id !== null && run.id !== '' ? String(run.id) : '#' + index;
  }
  function stravaIdOf(run) {
    if (!run) return null;
    if (run.stravaActivityId !== undefined && run.stravaActivityId !== null && run.stravaActivityId !== '') return String(run.stravaActivityId);
    return typeof run.id === 'string' && /^strava-./.test(run.id) ? run.id.slice(7) : null;
  }
  function sourceOf(run) { return run.source === 'strava' || stravaIdOf(run) ? 'strava' : 'manual'; }
  function isValidRun(run) {
    return !!run && typeof run === 'object' && runDate(run) !== null && runDistance(run) !== null && runSeconds(run) !== null;
  }

  /** Valid runs as internal entries, sorted by date, start time, then input order. */
  function entries(runs) {
    if (!Array.isArray(runs)) return [];
    const list = [];
    runs.forEach((run, index) => {
      if (!isValidRun(run)) return;
      list.push({
        run, index, id: runKey(run, index), date: runDate(run), startTime: runStartTime(run),
        type: typeCode(run.type), distance: runDistance(run), seconds: runSeconds(run)
      });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.index - b.index);
  }

  /** Valid runs in chronological order (the original objects). */
  function sortRuns(runs) { return entries(runs).map(e => e.run); }

  function entryPace(e) { return e.seconds / e.distance; }
  function plausible(e) { return entryPace(e) >= MIN_PLAUSIBLE_PACE; }

  function goalDistanceOf(profile) {
    const n = Number(profile && profile.goalDistanceKm);
    return profile && profile.goalDistanceKm !== null && profile.goalDistanceKm !== '' && Number.isFinite(n) && n > 0 ? n : 5;
  }
  function targetOf(profile) {
    if (!profile || profile.targetSeconds === null || profile.targetSeconds === undefined || profile.targetSeconds === '') return null;
    const n = Number(profile.targetSeconds);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function profileDays(profile) {
    if (!profile || !Array.isArray(profile.days)) return [];
    return [...new Set(profile.days.map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  }

  // ---------- attempts and best efforts ----------

  function isFiveKEntry(e) {
    return FIVE_K_TYPES.has(e.type) && e.distance >= FIVE_K_MIN_KM && e.distance <= FIVE_K_MAX_KM && plausible(e);
  }
  function isAttemptEntry(e, distanceKm) {
    if (distanceKm === 5) return isFiveKEntry(e);
    return ATTEMPT_TYPES.has(e.type) && Math.abs(e.distance - distanceKm) <= distanceKm * ATTEMPT_TOLERANCE + 1e-9 && plausible(e);
  }
  function wantedDistance(options) {
    const n = Number(options && options.distanceKm !== undefined ? options.distanceKm : 5);
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  /** A real 5 km effort: 4.95-5.2 km and type run / test5k / race (easy, long, tempo, intervals never count). */
  function isFiveKAttempt(run) {
    if (!isValidRun(run)) return false;
    return isFiveKEntry({ type: typeCode(run.type), distance: runDistance(run), seconds: runSeconds(run) });
  }

  /** A real effort at distanceKm: 5 km uses isFiveKAttempt, other distances +-3 % and type run / race. */
  function isAttempt(run, distanceKm) {
    if (!isValidRun(run)) return false;
    const d = wantedDistance({ distanceKm });
    return isAttemptEntry({ type: typeCode(run.type), distance: runDistance(run), seconds: runSeconds(run) }, d);
  }

  /** Fastest real attempt by moving time (no scaling of other distances). Ties keep the earlier run. */
  function bestEffort(runs, options) {
    const distanceKm = wantedDistance(options);
    let best = null;
    for (const e of entries(runs)) if (isAttemptEntry(e, distanceKm) && (!best || e.seconds < best.seconds)) best = e;
    return best ? best.run : null;
  }

  /** Chronological attempts at distanceKm with personal-best flags. delta = seconds - previous best (negative = faster). */
  function effortProgression(runs, options) {
    const distanceKm = wantedDistance(options);
    let best = null;
    return entries(runs).filter(e => isAttemptEntry(e, distanceKm)).map(e => {
      const isPersonalBest = best === null || e.seconds < best;
      const item = {
        runId: e.id, date: e.date, seconds: e.seconds, distanceKm: e.distance, pace: entryPace(e),
        isPersonalBest, previousBest: best, deltaToPreviousBest: best === null ? null : e.seconds - best
      };
      if (isPersonalBest) best = e.seconds;
      return item;
    });
  }
  function fiveKProgression(runs) { return effortProgression(runs, { distanceKm: 5 }); }

  // ---------- basic totals ----------

  function paceSecPerKm(run) {
    if (!isValidRun(run)) return null;
    return runSeconds(run) / runDistance(run);
  }
  function sumEntries(list) {
    let distance = 0, seconds = 0;
    for (const e of list) { distance += e.distance; seconds += e.seconds; }
    return { count: list.length, distanceKm: round(distance, 2), movingSeconds: seconds, avgPaceSecPerKm: distance > 0 ? seconds / distance : null };
  }
  function totals(runs) { return sumEntries(entries(runs)); }

  /** Totals for the n calendar days ending with todayKey (inclusive). Future-dated runs are ignored. */
  function lastNDays(runs, todayKey, n) {
    requireDateKey(todayKey);
    const days = positiveInteger(n, 7, 'n');
    const from = addDays(todayKey, -(days - 1));
    const result = sumEntries(entries(runs).filter(e => e.date >= from && e.date <= todayKey));
    result.from = from;
    result.to = todayKey;
    return result;
  }

  function emptyByType() {
    const byType = {};
    for (const code of RUN_TYPES) byType[code] = { count: 0, distanceKm: 0 };
    return byType;
  }

  /** Monday-start weeks, oldest -> newest, the last one being the week of todayKey. */
  function weeklyTotals(runs, todayKey, weeks) {
    requireDateKey(todayKey);
    const count = positiveInteger(weeks, 12, 'weeks');
    const current = weekStartOf(todayKey);
    const list = Array.from({ length: count }, (_, i) => {
      const weekStart = addDays(current, -7 * (count - 1 - i));
      return { weekStart, weekEnd: addDays(weekStart, 6), distanceKm: 0, count: 0, movingSeconds: 0, byType: emptyByType(), isCurrent: weekStart === current };
    });
    const byStart = new Map(list.map(w => [w.weekStart, w]));
    for (const e of entries(runs)) {
      const week = byStart.get(weekStartOf(e.date));
      if (!week) continue;
      week.distanceKm += e.distance;
      week.count += 1;
      week.movingSeconds += e.seconds;
      week.byType[e.type].count += 1;
      week.byType[e.type].distanceKm += e.distance;
    }
    for (const w of list) {
      w.distanceKm = round(w.distanceKm, 2);
      for (const code of RUN_TYPES) w.byType[code].distanceKm = round(w.byType[code].distanceKm, 2);
    }
    return list;
  }

  /** Weeks that contain runs, chronological: [{weekStart, weekEnd, distanceKm, count, movingSeconds}]. */
  function weeksWithRuns(list) {
    const map = new Map();
    for (const e of list) {
      const weekStart = weekStartOf(e.date);
      if (!map.has(weekStart)) map.set(weekStart, { weekStart, weekEnd: addDays(weekStart, 6), distanceKm: 0, count: 0, movingSeconds: 0 });
      const w = map.get(weekStart);
      w.distanceKm += e.distance;
      w.count += 1;
      w.movingSeconds += e.seconds;
    }
    return [...map.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).map(w => Object.assign(w, { distanceKm: round(w.distanceKm, 2) }));
  }

  // ---------- goal ladder and progress ----------

  /**
   * Round checkpoints from the first attempt down to the target, slowest first.
   * Marks are clock-round multiples of the step strictly between target and first attempt;
   * the target itself is always the last mark. Step is the smallest of 30 s, 1, 2, 5, 10, 15,
   * 30, 60 min (then whole hours) that keeps at most 5 intermediate marks (unless given).
   */
  function checkpointLadder(firstSeconds, targetSeconds, step) {
    const first = Number(firstSeconds), target = Number(targetSeconds);
    if (!Number.isFinite(first) || !Number.isFinite(target) || target <= 0 || first <= 0) return [];
    const marksFor = s => {
      const marks = [];
      for (let m = Math.ceil(first / s) * s - s; m > target; m -= s) marks.push(m);
      return marks;
    };
    let chosen = Number(step);
    // A step under 1 s (or one that would give more than MAX_LADDER_MARKS marks) is a bad option, not
    // a request for millions of marks: fall back to the automatic step.
    if (Number.isFinite(chosen) && chosen >= 1 && (first - target) / chosen > MAX_LADDER_MARKS) chosen = NaN;
    if (!Number.isFinite(chosen) || chosen < 1) {
      chosen = CHECKPOINT_STEPS.find(s => marksFor(s).length <= MAX_INTERMEDIATE_CHECKPOINTS)
        || Math.ceil((first - target) / (MAX_INTERMEDIATE_CHECKPOINTS + 1) / 3600) * 3600;
    }
    const marks = first > target ? marksFor(chosen) : [];
    marks.push(target);
    return marks;
  }

  function goalProgress(profile, runs, options) {
    const distanceKm = goalDistanceOf(profile);
    const target = targetOf(profile);
    const step = options && options.checkpointStep;
    const progression = effortProgression(runs, { distanceKm });
    const result = {
      distanceKm, target, targetPace: target === null ? null : target / distanceKm, attempts: progression.length,
      best: null, bestDate: null, bestRunId: null, bestPace: null, gapSeconds: null, pacePerKmGap: null, reached: false,
      previousBest: null, previousBestDate: null, improvementSeconds: null, improvementDays: null,
      firstAttempt: null, firstAttemptDate: null, fraction: null, checkpoints: [], next: null
    };
    if (!progression.length) return result;
    const pbs = progression.filter(p => p.isPersonalBest);
    const best = pbs[pbs.length - 1];
    const previous = pbs.length > 1 ? pbs[pbs.length - 2] : null;
    const first = progression[0];
    Object.assign(result, {
      best: best.seconds, bestDate: best.date, bestRunId: best.runId, bestPace: best.pace,
      firstAttempt: first.seconds, firstAttemptDate: first.date
    });
    if (previous) {
      Object.assign(result, {
        previousBest: previous.seconds, previousBestDate: previous.date,
        improvementSeconds: previous.seconds - best.seconds, improvementDays: daysBetween(previous.date, best.date)
      });
    }
    if (target === null) return result;
    result.gapSeconds = best.seconds - target;
    result.pacePerKmGap = best.pace - result.targetPace;
    result.reached = best.seconds <= target;
    result.fraction = first.seconds <= target ? 1 : Math.min(1, Math.max(0, (first.seconds - best.seconds) / (first.seconds - target)));
    result.checkpoints = checkpointLadder(first.seconds, target, step).map(seconds => {
      const hit = progression.find(p => p.seconds <= seconds);
      return { seconds, reached: !!hit, reachedDate: hit ? hit.date : null, isGoal: seconds === target };
    });
    const next = result.checkpoints.find(c => !c.reached);
    result.next = next ? { seconds: next.seconds, missingSeconds: best.seconds - next.seconds } : null;
    return result;
  }

  // ---------- records ----------

  /** Record progression: items that strictly beat every earlier item. Ties keep the earlier holder. */
  function recordChain(items, value, better) {
    const chain = [];
    for (const item of items) {
      const v = value(item);
      if (v === null || v === undefined) continue;
      if (!chain.length || better(v, chain[chain.length - 1].value)) chain.push({ item, value: v });
    }
    return chain;
  }
  function runRecord(chain, deltaDigits) {
    if (!chain.length) return null;
    const last = chain[chain.length - 1], prev = chain.length > 1 ? chain[chain.length - 2] : null;
    return {
      value: last.value, date: last.item.date, runId: last.item.id, distanceKm: last.item.distance, movingSeconds: last.item.seconds,
      previous: prev ? { value: prev.value, date: prev.item.date, runId: prev.item.id } : null,
      delta: prev ? (deltaDigits === null ? last.value - prev.value : round(last.value - prev.value, deltaDigits)) : null
    };
  }
  function weekRecord(chain, deltaDigits) {
    if (!chain.length) return null;
    const last = chain[chain.length - 1], prev = chain.length > 1 ? chain[chain.length - 2] : null;
    const w = last.item;
    return {
      value: last.value, date: w.weekStart, weekStart: w.weekStart, weekEnd: w.weekEnd, distanceKm: w.distanceKm, count: w.count, movingSeconds: w.movingSeconds,
      previous: prev ? { value: prev.value, date: prev.item.weekStart, weekStart: prev.item.weekStart } : null,
      delta: prev ? round(last.value - prev.value, deltaDigits) : null
    };
  }

  function records(runs) {
    const list = entries(runs);
    const faster = (a, b) => a < b, more = (a, b) => a > b;
    const weeks = weeksWithRuns(list);
    return {
      fastest5k: runRecord(recordChain(list.filter(isFiveKEntry), e => e.seconds, faster), null),
      fastestPace: runRecord(recordChain(list.filter(e => e.distance >= FASTEST_PACE_MIN_KM && plausible(e)), entryPace, faster), null),
      longestRun: runRecord(recordChain(list, e => e.distance, more), 2),
      longestDuration: runRecord(recordChain(list, e => e.seconds, more), null),
      biggestWeek: weekRecord(recordChain(weeks, w => w.distanceKm, more), 2),
      mostRunsWeek: weekRecord(recordChain(weeks, w => w.count, more), 0)
    };
  }

  // ---------- derived notes and milestones ----------

  function note(code, params) { return { code, params: params || {} }; }

  /**
   * Derived note codes per run id, evaluated chronologically (each run only sees earlier runs).
   * Codes: firstRun, personalBest5k {seconds, previousBest, improvementSeconds} (previousBest and
   * improvementSeconds are null on the first 5 km attempt), checkpoint {seconds, isGoal} (needs
   * profile.targetSeconds), firstOver10k {distanceKm}, longestRun {distanceKm, previousKm, deltaKm},
   * distanceMilestone {km, totalKm}. Every valid run gets an array (possibly empty).
   * options.checkpointStep must match the one given to goalProgress (default: automatic).
   */
  function runNotes(runs, profile, options) {
    const list = entries(runs);
    // No prototype: a run id such as 'constructor' or '__proto__' (hand-edited backup) is just a key.
    const notes = Object.create(null);
    const goalDistance = goalDistanceOf(profile);
    const target = targetOf(profile);
    const step = options && options.checkpointStep;
    let best5k = null, longest = null, cumulative = 0, sawLong = false, ladder = null;
    const crossed = new Set();
    list.forEach((e, i) => {
      const out = [];
      if (i === 0) out.push(note('firstRun'));
      if (isFiveKEntry(e) && (best5k === null || e.seconds < best5k)) {
        out.push(note('personalBest5k', { seconds: e.seconds, previousBest: best5k, improvementSeconds: best5k === null ? null : best5k - e.seconds }));
        best5k = e.seconds;
      }
      if (target !== null && isAttemptEntry(e, goalDistance)) {
        if (ladder === null) ladder = checkpointLadder(e.seconds, target, step);
        for (const mark of ladder) {
          if (!crossed.has(mark) && e.seconds <= mark) {
            crossed.add(mark);
            out.push(note('checkpoint', { seconds: mark, isGoal: mark === target }));
          }
        }
      }
      if (!sawLong && e.distance >= LONG_RUN_KM) {
        sawLong = true;
        out.push(note('firstOver10k', { distanceKm: e.distance }));
      }
      if (longest !== null && e.distance > longest) out.push(note('longestRun', { distanceKm: e.distance, previousKm: longest, deltaKm: round(e.distance - longest, 2) }));
      if (longest === null || e.distance > longest) longest = e.distance;
      const before = cumulative;
      cumulative = round(cumulative + e.distance, 6);
      for (const km of DISTANCE_MILESTONES) if (before < km && cumulative >= km) out.push(note('distanceMilestone', { km, totalKm: round(cumulative, 2) }));
      notes[e.id] = notesOf(notes, e.id).concat(out);
    });
    return notes;
  }

  /** The notes of one run from a runNotes() map: always an array, own keys only (never Object.prototype). */
  function notesOf(notes, runId) {
    if (!notes || runId === undefined || runId === null) return [];
    const list = Object.prototype.hasOwnProperty.call(notes, String(runId)) ? notes[String(runId)] : null;
    return Array.isArray(list) ? list : [];
  }

  /** Chronological milestone list for the progress page: [{date, runId, code, params}]. */
  function milestones(runs, profile, options) {
    const notes = runNotes(runs, profile, options);
    const seen = new Set();
    const out = [];
    for (const e of entries(runs)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      for (const n of notesOf(notes, e.id)) out.push({ date: e.date, runId: e.id, code: n.code, params: n.params });
    }
    return out;
  }

  // ---------- week strip ----------

  /**
   * Seven entries Monday..Sunday for the week of todayKey (offset in weeks optional).
   * status: 'done' (has runs) > 'planned' (nextRun.date) > 'rest' (not in profile.days)
   * > 'today' > 'available'. Empty or missing profile.days means no fixed schedule (no rest days).
   */
  function weekStrip(runs, options) {
    const opts = options || {};
    const todayKey = requireDateKey(opts.todayKey);
    const days = profileDays(opts.profile);
    const nextRun = opts.nextRun && typeof opts.nextRun === 'object' ? opts.nextRun : null;
    const offset = Number.isInteger(opts.offset) ? opts.offset : 0;
    const monday = addDays(weekStartOf(todayKey), 7 * offset);
    const byDate = new Map();
    for (const e of entries(runs)) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e.run);
    }
    return Array.from({ length: 7 }, (_, weekday) => {
      const date = addDays(monday, weekday);
      const dayRuns = byDate.get(date) || [];
      const isToday = date === todayKey;
      const isRunDay = days.length === 0 || days.includes(weekday);
      const plannedHere = !!nextRun && nextRun.kind !== 'rest' && nextRun.date === date;
      let status;
      if (dayRuns.length) status = 'done';
      else if (plannedHere) status = 'planned';
      else if (!isRunDay) status = 'rest';
      else if (isToday) status = 'today';
      else status = 'available';
      const day = { date, weekday, isToday, isPast: date < todayKey, isRunDay, runs: dayRuns, status };
      if (plannedHere) day.planned = Object.assign({}, nextRun);
      return day;
    });
  }

  // ---------- Strava dedupe ----------

  /**
   * Existing run that is the same activity as candidate: same Strava activity id, or the other
   * source (manual vs Strava, both ways) on the same date with |delta km| < 0.15 and |delta s| < 90.
   * The closest match wins. The candidate object itself (or a record with its id) is skipped.
   */
  function findDuplicate(runs, candidate) {
    if (!Array.isArray(runs) || !candidate || typeof candidate !== 'object') return null;
    const candidateStrava = stravaIdOf(candidate);
    if (candidateStrava) {
      const same = runs.find(run => run && typeof run === 'object' && run !== candidate && stravaIdOf(run) === candidateStrava);
      if (same) return same;
    }
    if (!isValidRun(candidate)) return null;
    const date = runDate(candidate), distance = runDistance(candidate), seconds = runSeconds(candidate), source = sourceOf(candidate);
    const candidateId = candidate.id === undefined || candidate.id === null ? null : String(candidate.id);
    let best = null, bestScore = Infinity;
    for (const run of runs) {
      if (!isValidRun(run) || run === candidate) continue;
      if (candidateId !== null && run.id !== undefined && run.id !== null && String(run.id) === candidateId) continue;
      if (sourceOf(run) === source || runDate(run) !== date) continue;
      const dKm = round(Math.abs(runDistance(run) - distance), 6), dSec = Math.abs(runSeconds(run) - seconds);
      if (dKm >= DUPLICATE_KM || dSec >= DUPLICATE_SECONDS) continue;
      const score = dKm / DUPLICATE_KM + dSec / DUPLICATE_SECONDS;
      if (score < bestScore) { best = run; bestScore = score; }
    }
    return best;
  }

  /**
   * One record from a manual entry and its Strava twin. Keeps the manual date, type, distance,
   * effort and note; takes the Strava id, activity id, name, heart rate, elevation, moving time and
   * start time. Inputs are not mutated.
   */
  function mergeStravaIntoManual(manual, strava) {
    const m = manual && typeof manual === 'object' ? manual : {};
    const s = strava && typeof strava === 'object' ? strava : {};
    const merged = Object.assign({}, m);
    const activityId = s.stravaActivityId !== undefined && s.stravaActivityId !== null && s.stravaActivityId !== '' ? s.stravaActivityId : stravaIdOf(s);
    merged.source = 'strava';
    merged.id = s.id !== undefined && s.id !== null && s.id !== '' ? s.id : (activityId !== null ? 'strava-' + activityId : m.id);
    if (activityId !== null) merged.stravaActivityId = activityId;
    if (typeof s.name === 'string' && s.name.trim()) merged.name = s.name;
    merged.averageHeartrate = s.averageHeartrate ?? m.averageHeartrate ?? null;
    merged.elevationGain = s.elevationGain ?? m.elevationGain ?? null;
    const seconds = runSeconds({ movingSeconds: s.movingSeconds });
    if (seconds !== null) merged.movingSeconds = seconds;
    merged.startTime = runStartTime(s) || runStartTime(m) || null;
    merged.type = m.type !== undefined && m.type !== null && m.type !== '' ? m.type : (s.type ?? 'run');
    merged.effort = m.effort ?? s.effort ?? null;
    merged.note = typeof m.note === 'string' && m.note ? m.note : (typeof s.note === 'string' ? s.note : '');
    if (runDate(m) === null && runDate(s) !== null) merged.date = runDate(s);
    if (runDistance(m) === null && runDistance(s) !== null) merged.distance = s.distance;
    delete merged.time;
    return merged;
  }

  // ---------- streak ----------

  /**
   * Consecutive Monday-start weeks meeting the plan (runs >= profile.days.length, or >= 1 with no
   * fixed days). The current week counts once it is met; until then the streak ends with last week.
   */
  function currentStreakWeeks(runs, todayKey, profile) {
    requireDateKey(todayKey);
    const need = profileDays(profile).length || 1;
    const counts = new Map();
    for (const e of entries(runs)) {
      if (e.date > todayKey) continue;
      const ws = weekStartOf(e.date);
      counts.set(ws, (counts.get(ws) || 0) + 1);
    }
    let week = weekStartOf(todayKey);
    let streak = (counts.get(week) || 0) >= need ? 1 : 0;
    week = addDays(week, -7);
    while ((counts.get(week) || 0) >= need) {
      streak += 1;
      week = addDays(week, -7);
    }
    return streak;
  }

  const api = {
    RUN_TYPES, DISTANCE_MILESTONES,
    // helpers
    isDateKey, addDays, daysBetween, weekdayIndex, weekStartOf, typeCode, isValidRun, sortRuns,
    // attempts
    isFiveKAttempt, isAttempt, bestEffort, effortProgression, fiveKProgression,
    // totals
    paceSecPerKm, totals, lastNDays, weeklyTotals,
    // goal
    checkpointLadder, goalProgress,
    // records and notes
    records, runNotes, notesOf, milestones,
    // calendar
    weekStrip, currentStreakWeeks,
    // Strava
    findDuplicate, mergeStravaIntoManual
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VeyvoRuns = api;
})(globalThis);
