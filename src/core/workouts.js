/*
 * VeyvoWorkouts - structured running workouts for VEYVO (docs/architecture.md, "Workout model").
 *
 * Classic UMD script: no DOM, no network, no hidden clock, no dependency on other modules.
 * Exporters (FIT, Apple, ZWO, intervals.icu) take a validated Workout and call flatten().
 *
 *   Workout = { id, name (<= 40 chars, Garmin shows 15), sport: 'running', date?: 'YYYY-MM-DD',
 *               description?, source: 'plan' | 'library' | 'custom', steps: Array<Step | Repeat> }
 *   Step    = { kind: 'step', intensity: 'warmup'|'active'|'recovery'|'rest'|'cooldown',
 *               duration: {type:'time', seconds} | {type:'distance', meters} | {type:'open'},
 *               target: {type:'open'} | {type:'pace', fastSecPerKm, slowSecPerKm} | {type:'hr', lowBpm, highBpm},
 *               label?: string }
 *   Repeat  = { kind: 'repeat', count: 1..99, steps: Step[] }      // one nesting level only
 *
 * Every pace in this file is a PRESCRIPTION derived from the athlete's own numbers (best 5 km,
 * goal time, the VeyvoTraining next-run suggestion). Nothing here measures or predicts fitness.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- limits

  const LIMITS = Object.freeze({
    maxFitSteps: 50,              // Garmin: up to 50 steps per workout (a repeat block adds one step)
    repeatMin: 1,
    repeatMax: 99,                // Garmin: repeats up to 99 times
    nameMax: 40,                  // VEYVO limit; most Garmin watches show only the first 15 characters
    labelMax: 40,
    idMax: 100,
    paceFastest: 150,             // 2:30 /km
    paceSlowest: 720,             // 12:00 /km
    hrMin: 60,
    hrMax: 220,
    timeMin: 10,                  // 10 s
    timeMax: 6 * 3600,            // 6 h
    distanceMin: 50,              // 50 m
    distanceMax: 100000           // 100 km
  });
  const INTENSITIES = Object.freeze(['warmup', 'active', 'recovery', 'rest', 'cooldown']);
  const DURATION_TYPES = Object.freeze(['time', 'distance', 'open']);
  const TARGET_TYPES = Object.freeze(['open', 'pace', 'hr']);
  const SOURCES = Object.freeze(['plan', 'library', 'custom']);
  const LIBRARY_IDS = Object.freeze(['easy', 'intervals400', 'intervals1k', 'threshold', 'long', 'test5k']);
  const DASH = '—';
  const EN_DASH = '–';

  // ---------------------------------------------------------------- small helpers

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function isNum(value) { return typeof value === 'number' && Number.isFinite(value); }
  function charLength(text) { return Array.from(text).length; }
  function isDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }
  /** 'cs' for null/undefined/'cs-CZ'/'sk', 'en' for any other language tag (same rule as VeyvoFormat). */
  function normalizeLocale(value) {
    if (isObject(value)) value = value.locale;
    if (typeof value !== 'string' || !value.trim()) return 'cs';
    return /^(cs|sk)\b/i.test(value.trim().replace('_', '-')) ? 'cs' : 'en';
  }
  /** Rounds to the nearest 5 s (paces), the same rounding VeyvoTraining uses. */
  function round5(value) { return Math.round(value / 5) * 5; }

  // ---------------------------------------------------------------- self-contained formatting

  function pad2(n) { return String(n).padStart(2, '0'); }
  /** 237 -> '3:57' (seconds per km, rounded to whole seconds). */
  function formatPace(secPerKm) {
    if (!isNum(secPerKm) || secPerKm <= 0) return DASH;
    const r = Math.round(secPerKm);
    return Math.floor(r / 60) + ':' + pad2(r % 60);
  }
  /** 2.5 -> '2,5' (cs) / '2.5' (en); no grouping, up to maxDecimals, trailing zeros trimmed. */
  function formatNumber(value, locale, maxDecimals) {
    if (!isNum(value)) return DASH;
    const factor = Math.pow(10, maxDecimals == null ? 2 : maxDecimals);
    const rounded = Math.round(value * factor) / factor;
    const text = String(Object.is(rounded, -0) ? 0 : rounded);
    return normalizeLocale(locale) === 'cs' ? text.replace('.', ',') : text;
  }
  /** 400 -> '400 m', 1000 -> '1 km', 2500 -> '2,5 km' (cs) / '2.5 km' (en). */
  function formatDistance(meters, locale) {
    if (!isNum(meters) || meters < 0) return DASH;
    const r = Math.round(meters);
    return r < 1000 ? r + ' m' : formatNumber(r / 1000, locale, 2) + ' km';
  }
  /** 900 -> '15 min', 90 -> '1 min 30 s', 5400 -> '1 h 30 min', 45 -> '45 s'. */
  function formatTime(seconds) {
    if (!isNum(seconds) || seconds < 0) return DASH;
    const r = Math.round(seconds);
    const h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), s = r % 60;
    const parts = [];
    if (h) parts.push(h + ' h');
    if (m) parts.push(m + ' min');
    if (s || !parts.length) parts.push(s + ' s');
    return parts.join(' ');
  }
  /** '{a} km' with params; numbers get the locale's decimal separator (like VeyvoI18n.t). */
  function fill(template, params, locale) {
    return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, function (match, name) {
      if (!params || !Object.prototype.hasOwnProperty.call(params, name)) return match;
      const value = params[name];
      return typeof value === 'number' ? formatNumber(value, locale, 2) : value == null ? '' : String(value);
    });
  }
  function capitalize(text) { return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text; }

  // ---------------------------------------------------------------- builders

  function time(seconds) { return { type: 'time', seconds: seconds }; }
  function distance(meters) { return { type: 'distance', meters: meters }; }
  function open() { return { type: 'open' }; }
  function pace(fastSecPerKm, slowSecPerKm) { return { type: 'pace', fastSecPerKm: fastSecPerKm, slowSecPerKm: slowSecPerKm }; }
  function hr(lowBpm, highBpm) { return { type: 'hr', lowBpm: lowBpm, highBpm: highBpm }; }
  function step(intensity, duration, target, label) {
    const result = { kind: 'step', intensity: intensity, duration: duration, target: target || open() };
    if (label != null && label !== '') result.label = label;
    return result;
  }
  function repeat(count, steps) { return { kind: 'repeat', count: count, steps: steps }; }

  // ---------------------------------------------------------------- validation

  /**
   * validate(workout) -> { ok, errors: [{ code, path, ...limits }], fitStepCount }
   * Paths are dotted ('steps.1.steps.0.target.fastSecPerKm'). Codes (stable, translated by the UI):
   *   workout_invalid, id_invalid, name_required, name_too_long, sport_invalid, date_invalid,
   *   description_invalid, source_invalid, steps_empty, step_invalid, intensity_invalid,
   *   duration_invalid, duration_time_range, duration_distance_range, target_invalid, pace_range,
   *   pace_order, hr_range, hr_order, label_invalid, label_too_long, repeat_count_range,
   *   repeat_empty, repeat_nested, too_many_steps
   */
  function validate(workout) {
    const errors = [];
    const add = function (code, path, extra) { errors.push(Object.assign({ code: code, path: path }, extra || {})); };
    if (!isObject(workout)) {
      add('workout_invalid', '');
      return { ok: false, errors: errors, fitStepCount: 0 };
    }
    if (typeof workout.id !== 'string' || !workout.id.trim() || workout.id.length > LIMITS.idMax) add('id_invalid', 'id');
    if (typeof workout.name !== 'string' || !workout.name.trim()) add('name_required', 'name');
    else if (charLength(workout.name) > LIMITS.nameMax) add('name_too_long', 'name', { max: LIMITS.nameMax });
    if (workout.sport !== 'running') add('sport_invalid', 'sport');
    if (workout.date != null && !isDateKey(workout.date)) add('date_invalid', 'date');
    if (workout.description != null && typeof workout.description !== 'string') add('description_invalid', 'description');
    if (SOURCES.indexOf(workout.source) < 0) add('source_invalid', 'source');

    let fitStepCount = 0;
    if (!Array.isArray(workout.steps) || !workout.steps.length) {
      add('steps_empty', 'steps');
    } else {
      workout.steps.forEach(function (item, i) {
        const path = 'steps.' + i;
        if (isObject(item) && item.kind === 'repeat') {
          fitStepCount += 1; // the FIT "repeat until steps complete" step
          if (!Number.isInteger(item.count) || item.count < LIMITS.repeatMin || item.count > LIMITS.repeatMax) {
            add('repeat_count_range', path + '.count', { min: LIMITS.repeatMin, max: LIMITS.repeatMax });
          }
          if (!Array.isArray(item.steps) || !item.steps.length) {
            add('repeat_empty', path + '.steps');
            return;
          }
          item.steps.forEach(function (inner, j) {
            const innerPath = path + '.steps.' + j;
            fitStepCount += 1;
            if (isObject(inner) && inner.kind === 'repeat') add('repeat_nested', innerPath);
            else validateStep(inner, innerPath, add);
          });
        } else {
          fitStepCount += 1;
          validateStep(item, path, add);
        }
      });
      if (fitStepCount > LIMITS.maxFitSteps) add('too_many_steps', 'steps', { count: fitStepCount, max: LIMITS.maxFitSteps });
    }
    return { ok: errors.length === 0, errors: errors, fitStepCount: fitStepCount };
  }

  function validateStep(item, path, add) {
    if (!isObject(item) || item.kind !== 'step') { add('step_invalid', path); return; }
    if (INTENSITIES.indexOf(item.intensity) < 0) add('intensity_invalid', path + '.intensity');

    const d = item.duration;
    if (!isObject(d) || DURATION_TYPES.indexOf(d.type) < 0) add('duration_invalid', path + '.duration');
    else if (d.type === 'time') {
      if (!isNum(d.seconds)) add('duration_invalid', path + '.duration.seconds');
      else if (d.seconds < LIMITS.timeMin || d.seconds > LIMITS.timeMax) {
        add('duration_time_range', path + '.duration.seconds', { min: LIMITS.timeMin, max: LIMITS.timeMax });
      }
    } else if (d.type === 'distance') {
      if (!isNum(d.meters)) add('duration_invalid', path + '.duration.meters');
      else if (d.meters < LIMITS.distanceMin || d.meters > LIMITS.distanceMax) {
        add('duration_distance_range', path + '.duration.meters', { min: LIMITS.distanceMin, max: LIMITS.distanceMax });
      }
    }

    const t = item.target;
    if (!isObject(t) || TARGET_TYPES.indexOf(t.type) < 0) add('target_invalid', path + '.target');
    else if (t.type === 'pace') {
      let numbers = true;
      ['fastSecPerKm', 'slowSecPerKm'].forEach(function (key) {
        if (!isNum(t[key])) { add('target_invalid', path + '.target.' + key); numbers = false; }
        else if (t[key] < LIMITS.paceFastest || t[key] > LIMITS.paceSlowest) {
          add('pace_range', path + '.target.' + key, { min: LIMITS.paceFastest, max: LIMITS.paceSlowest });
        }
      });
      if (numbers && !(t.fastSecPerKm < t.slowSecPerKm)) add('pace_order', path + '.target');
    } else if (t.type === 'hr') {
      let numbers = true;
      ['lowBpm', 'highBpm'].forEach(function (key) {
        if (!isNum(t[key])) { add('target_invalid', path + '.target.' + key); numbers = false; }
        else if (t[key] < LIMITS.hrMin || t[key] > LIMITS.hrMax) {
          add('hr_range', path + '.target.' + key, { min: LIMITS.hrMin, max: LIMITS.hrMax });
        }
      });
      if (numbers && !(t.lowBpm < t.highBpm)) add('hr_order', path + '.target');
    }

    if (item.label != null) {
      if (typeof item.label !== 'string') add('label_invalid', path + '.label');
      else if (charLength(item.label.trim()) > LIMITS.labelMax) add('label_too_long', path + '.label', { max: LIMITS.labelMax });
    }
  }

  function invalidError(result) {
    const error = new Error('Invalid workout: ' + result.errors.map(function (e) { return e.code + (e.path ? ' @ ' + e.path : ''); }).join(', '));
    error.code = 'workout_invalid';
    error.errors = result.errors;
    return error;
  }
  function requireValid(workout) {
    const result = validate(workout);
    if (!result.ok) throw invalidError(result);
    return workout;
  }

  // ---------------------------------------------------------------- flatten (for exporters)

  function copyDuration(d) {
    if (d.type === 'time') return { type: 'time', seconds: d.seconds };
    if (d.type === 'distance') return { type: 'distance', meters: d.meters };
    return { type: 'open' };
  }
  function copyTarget(t) {
    if (t.type === 'pace') return { type: 'pace', fastSecPerKm: t.fastSecPerKm, slowSecPerKm: t.slowSecPerKm };
    if (t.type === 'hr') return { type: 'hr', lowBpm: t.lowBpm, highBpm: t.highBpm };
    return { type: 'open' };
  }
  function flatStep(s, index, path, inRepeat) {
    const out = { kind: 'step', index: index, path: path, intensity: s.intensity,
      duration: copyDuration(s.duration), target: copyTarget(s.target), inRepeat: inRepeat };
    if (typeof s.label === 'string' && s.label.trim()) out.label = s.label.trim();
    return out;
  }

  /**
   * flatten(workout) -> FIT-style list (message order), throws { code: 'workout_invalid', errors } if invalid.
   *   { kind: 'step', index, path, intensity, duration, target, label?, inRepeat }
   *   { kind: 'repeat', index, path, fromIndex, count }   // directly follows its block; fromIndex =
   *                                                       // index of the block's first step
   * 6x(400 m + 200 m) between a warm-up and a cool-down -> indexes 0 warmup, 1 active, 2 recovery,
   * 3 repeat {fromIndex: 1, count: 6}, 4 cooldown. list.length is the FIT step count.
   */
  function flatten(workout) {
    requireValid(workout);
    const out = [];
    workout.steps.forEach(function (item, i) {
      if (item.kind === 'repeat') {
        const fromIndex = out.length;
        item.steps.forEach(function (s, j) { out.push(flatStep(s, out.length, 'steps.' + i + '.steps.' + j, true)); });
        out.push({ kind: 'repeat', index: out.length, path: 'steps.' + i, fromIndex: fromIndex, count: item.count });
      } else {
        out.push(flatStep(item, out.length, 'steps.' + i, false));
      }
    });
    return out;
  }

  /** Number of FIT steps without throwing (a repeat counts as its steps + 1). */
  function fitStepCount(workout) { return validate(workout).fitStepCount; }

  // ---------------------------------------------------------------- estimate

  /**
   * estimate(workout, { easyPaceSecPerKm }) -> { distanceM, seconds, openSteps, unpacedSteps, complete } | null
   * APPROXIMATE planning numbers, not a prediction:
   *   - a pace-target step runs at the middle of its range ((fast + slow) / 2);
   *   - any other step (open or HR target) runs at easyPaceSecPerKm when given;
   *   - open-duration (lap button) steps are left out and counted in openSteps;
   *   - steps whose missing half (distance of a time step, time of a distance step) cannot be
   *     derived because no pace is known are counted in unpacedSteps;
   *   - repeats multiply by their count; counters count steps as written, not repetitions.
   * complete is true only when nothing was left out. Returns null for an invalid workout.
   */
  function estimate(workout, options) {
    if (!validate(workout).ok) return null;
    const easy = options && isNum(options.easyPaceSecPerKm) && options.easyPaceSecPerKm > 0 ? options.easyPaceSecPerKm : null;
    const total = { distanceM: 0, seconds: 0, openSteps: 0, unpacedSteps: 0 };
    function add(s, times) {
      if (s.duration.type === 'open') { total.openSteps += 1; return; }
      const paceSec = s.target.type === 'pace' ? (s.target.fastSecPerKm + s.target.slowSecPerKm) / 2 : easy;
      if (s.duration.type === 'time') {
        total.seconds += s.duration.seconds * times;
        if (paceSec) total.distanceM += (s.duration.seconds / paceSec) * 1000 * times;
        else total.unpacedSteps += 1;
      } else {
        total.distanceM += s.duration.meters * times;
        if (paceSec) total.seconds += (s.duration.meters / 1000) * paceSec * times;
        else total.unpacedSteps += 1;
      }
    }
    workout.steps.forEach(function (item) {
      if (item.kind === 'repeat') item.steps.forEach(function (s) { add(s, item.count); });
      else add(item, 1);
    });
    return {
      distanceM: Math.round(total.distanceM),
      seconds: Math.round(total.seconds),
      openSteps: total.openSteps,
      unpacedSteps: total.unpacedSteps,
      complete: total.openSteps === 0 && total.unpacedSteps === 0
    };
  }

  // ---------------------------------------------------------------- messages (cs + en)

  /*
   * Names and descriptions for the library and the plan workout. Register them with
   * VeyvoI18n.register('workouts', VeyvoWorkouts.MESSAGES) (done automatically when VeyvoI18n is
   * already loaded); keys then read 'workouts.library.intervals400.name' etc. Both locales use the
   * same placeholders. No plural-sensitive nouns are interpolated (counts are written as '6×').
   */
  const MESSAGES = Object.freeze({
    cs: {
      library: {
        easy: {
          name: 'Lehký běh {distanceKm} km',
          description: 'Klidný běh v tempu {paceFast}–{paceSlow} /km. Má být pohodový, měl bys u něj zvládnout mluvit.',
          descriptionByFeel: 'Klidný běh podle pocitu. Má být pohodový, měl bys u něj zvládnout mluvit.'
        },
        intervals400: {
          name: 'Úseky {reps}× {distanceM} m',
          description: 'Rozklus {warmupMin} min, pak {reps}× {distanceM} m v tempu {paceFast}–{paceSlow} /km, tedy o něco rychleji než cílové tempo {goalPace} /km. Mezi úseky {recoveryM} m klusu, na závěr vyklus {cooldownMin} min.',
          descriptionByFeel: 'Rozklus {warmupMin} min, pak {reps}× {distanceM} m svižně, o něco rychleji než závodní tempo na 5 km. Mezi úseky {recoveryM} m klusu, na závěr vyklus {cooldownMin} min.'
        },
        intervals1k: {
          name: 'Úseky {reps}× {distanceKm} km',
          description: 'Rozklus {warmupMin} min, pak {reps}× {distanceKm} km v cílovém tempu {paceFast}–{paceSlow} /km. Mezi úseky {recoveryMin} min klusu, na závěr vyklus {cooldownMin} min.',
          descriptionByFeel: 'Rozklus {warmupMin} min, pak {reps}× {distanceKm} km v tempu, které chceš udržet v závodě na 5 km. Mezi úseky {recoveryMin} min klusu, na závěr vyklus {cooldownMin} min.'
        },
        threshold: {
          name: 'Tempo {reps}× {distanceKm} km',
          description: 'Rozklus {warmupMin} min, pak {reps}× {distanceKm} km v tempu {paceFast}–{paceSlow} /km, tedy o něco pomaleji než tvé současné tempo na 5 km. Mezi úseky {recoveryMin} min klusu, na závěr vyklus {cooldownMin} min.',
          descriptionByFeel: 'Rozklus {warmupMin} min, pak {reps}× {distanceKm} km „příjemně ztěžka“, o něco pomaleji než závodní tempo na 5 km. Mezi úseky {recoveryMin} min klusu, na závěr vyklus {cooldownMin} min.'
        },
        long: {
          name: 'Dlouhý běh {distanceKm} km',
          description: 'Dlouhý klidný běh v tempu {paceFast}–{paceSlow} /km. Raději pomaleji než rychleji.',
          descriptionByFeel: 'Dlouhý klidný běh podle pocitu. Raději pomaleji než rychleji.'
        },
        test5k: {
          name: 'Test {distanceKm} km',
          description: 'Rozklus {warmupMin} min, pak {distanceKm} km naplno a vyklus {cooldownMin} min. Výsledek zapiš jako Test 5 km, tempa tréninků se podle něj přepočítají.',
          stepLabel: 'Naplno'
        }
      },
      plan: {
        easy: {
          name: 'Lehký běh {distanceKm} km',
          description: 'Lehký běh v tempu {paceFast}–{paceSlow} /km podle tvých posledních výsledků.',
          descriptionByFeel: 'Lehký běh pohodovým tempem podle pocitu.'
        },
        returnAfterBreak: {
          name: 'Lehký běh {minutes} min',
          description: 'Návrat po delší pauze: {minutes} min lehce, tempo podle pocitu.'
        }
      }
    },
    en: {
      library: {
        easy: {
          name: 'Easy run {distanceKm} km',
          description: 'Relaxed run at {paceFast}–{paceSlow} /km. Keep it easy enough to hold a conversation.',
          descriptionByFeel: 'Relaxed run by feel. Keep it easy enough to hold a conversation.'
        },
        intervals400: {
          name: 'Reps {reps}× {distanceM} m',
          description: 'Warm up for {warmupMin} min, then run {reps}× {distanceM} m at {paceFast}–{paceSlow} /km, a little faster than your goal pace of {goalPace} /km. Jog {recoveryM} m between reps and cool down for {cooldownMin} min.',
          descriptionByFeel: 'Warm up for {warmupMin} min, then run {reps}× {distanceM} m briskly, a little faster than your 5 km race pace. Jog {recoveryM} m between reps and cool down for {cooldownMin} min.'
        },
        intervals1k: {
          name: 'Reps {reps}× {distanceKm} km',
          description: 'Warm up for {warmupMin} min, then run {reps}× {distanceKm} km at goal pace, {paceFast}–{paceSlow} /km. Jog for {recoveryMin} min between reps and cool down for {cooldownMin} min.',
          descriptionByFeel: 'Warm up for {warmupMin} min, then run {reps}× {distanceKm} km at the pace you want to hold in a 5 km race. Jog for {recoveryMin} min between reps and cool down for {cooldownMin} min.'
        },
        threshold: {
          name: 'Tempo {reps}× {distanceKm} km',
          description: 'Warm up for {warmupMin} min, then run {reps}× {distanceKm} km at {paceFast}–{paceSlow} /km, a little slower than your current 5 km pace. Jog for {recoveryMin} min between reps and cool down for {cooldownMin} min.',
          descriptionByFeel: 'Warm up for {warmupMin} min, then run {reps}× {distanceKm} km comfortably hard, a little slower than your 5 km race pace. Jog for {recoveryMin} min between reps and cool down for {cooldownMin} min.'
        },
        long: {
          name: 'Long run {distanceKm} km',
          description: 'Long relaxed run at {paceFast}–{paceSlow} /km. When in doubt, go slower.',
          descriptionByFeel: 'Long relaxed run by feel. When in doubt, go slower.'
        },
        test5k: {
          name: '{distanceKm} km test',
          description: 'Warm up for {warmupMin} min, run {distanceKm} km all out, then cool down for {cooldownMin} min. Log the result as a 5 km test so your training paces can be recalculated.',
          stepLabel: 'All-out'
        }
      },
      plan: {
        easy: {
          name: 'Easy run {distanceKm} km',
          description: 'Easy run at {paceFast}–{paceSlow} /km, based on your latest results.',
          descriptionByFeel: 'Easy run at a relaxed pace, by feel.'
        },
        returnAfterBreak: {
          name: 'Easy run {minutes} min',
          description: 'Back after a longer break: {minutes} min easy, pace by feel.'
        }
      }
    }
  });

  /** Registers MESSAGES under the 'workouts' namespace of a VeyvoI18n instance; returns true on success. */
  function registerMessages(i18n) {
    if (!i18n || typeof i18n.register !== 'function') return false;
    i18n.register('workouts', MESSAGES);
    return true;
  }

  // ---------------------------------------------------------------- 5 km paces + session library

  // A 5 km time outside 12:30 (2:30 /km) .. 2:00:00 is treated as missing input.
  const FIVE_K_MIN_SECONDS = 750;
  const FIVE_K_MAX_SECONDS = 7200;
  function plausible5k(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= FIVE_K_MIN_SECONDS && n <= FIVE_K_MAX_SECONDS ? n : null;
  }

  /**
   * derivePaces({ best5kSeconds, targetSeconds }) -> paces | null (null when neither time is usable)
   *
   * Formulas (seconds per km; PRESCRIPTIONS for training, not measurements or predictions):
   *   goal     = round5(targetSeconds / 5)          no goal time: goal = round5(best / 5)
   *   current  = round5(best5kSeconds / 5)          no best 5 km: current = goal + 15
   *   easy     = round5(ref × 1.20) .. round5(ref × 1.45), ref = best / 5 (unrounded) or current;
   *              this is the VeyvoTraining next-run formula, so library and plan agree
   *   rep400   = goal − 10 .. goal − 3              (6 × 400 m, a little faster than goal pace)
   *   rep1k    = goal .. goal + 5                   (5 × 1 km at goal pace)
   *   threshold= current + 8 .. current + 15        (3 × 2 km, a little slower than current 5 km pace)
   * Base paces (goal, current, easy) are rounded to 5 s; the offsets are then applied exactly,
   * so 20:00 gives rep400 3:50–3:57 /km. goalReached is true when best <= target.
   */
  function derivePaces(input) {
    const best = plausible5k(input && input.best5kSeconds);
    const target = plausible5k(input && input.targetSeconds);
    if (best == null && target == null) return null;
    const goal = round5((target != null ? target : best) / 5);
    const current = best != null ? round5(best / 5) : goal + 15;
    const easyRef = best != null ? best / 5 : current;
    const range = function (fast, slow) { return { fastSecPerKm: fast, slowSecPerKm: slow }; };
    return {
      goalSecPerKm: goal,
      currentSecPerKm: current,
      easy: range(round5(easyRef * 1.2), round5(easyRef * 1.45)),
      rep400: range(goal - 10, goal - 3),
      rep1k: range(goal, goal + 5),
      threshold: range(current + 8, current + 15),
      basis: { best5kSeconds: best, targetSeconds: target, currentFromGoal: best == null, goalFromBest: target == null },
      goalReached: best != null && target != null && best <= target
    };
  }

  /** A pace target when the range passes validation, otherwise null (the step is then run by feel). */
  function paceTarget(range) {
    if (!isObject(range)) return null;
    const fast = range.fastSecPerKm, slow = range.slowSecPerKm;
    if (!isNum(fast) || !isNum(slow) || !(fast < slow)) return null;
    if (fast < LIMITS.paceFastest || slow > LIMITS.paceSlowest) return null;
    return pace(fast, slow);
  }
  function validDistanceKm(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n * 1000 >= LIMITS.distanceMin && n * 1000 <= LIMITS.distanceMax ? n : fallback;
  }

  /**
   * library(paces, { locale = 'cs', easyDistanceKm = 5, longDistanceKm = 10 }) -> Template[]
   *   Template = { id, nameKey, descriptionKey, params, paced, workout }
   * paces comes from derivePaces(); with paces = null every session is still returned, with open
   * (by-feel) targets and the descriptionByFeel text. A template whose pace range would fall outside
   * 2:30–12:00 /km also falls back to by-feel. workout.name/description are rendered in `locale`;
   * nameKey/descriptionKey + params let the UI re-render through VeyvoI18n.
   * Sessions (15 min warm-up / 10 min cool-down around every quality session):
   *   easy         easyDistanceKm at the easy range, no warm-up
   *   intervals400 6 × (400 m @ rep400, 200 m jog, open target)
   *   intervals1k  5 × (1 km @ rep1k, 2 min jog)
   *   threshold    3 × (2 km @ threshold, 2 min jog)
   *   long         longDistanceKm at the easy range
   *   test5k       5 km open target (race effort)
   */
  function library(paces, options) {
    const opts = isObject(options) ? options : {};
    const locale = normalizeLocale(opts.locale);
    const p = isObject(paces) ? paces : null;
    const easyKm = validDistanceKm(opts.easyDistanceKm, 5);
    const longKm = validDistanceKm(opts.longDistanceKm, 10);
    const WARMUP_MIN = 15, COOLDOWN_MIN = 10;
    const warmup = function () { return step('warmup', time(WARMUP_MIN * 60), open()); };
    const cooldown = function () { return step('cooldown', time(COOLDOWN_MIN * 60), open()); };
    const withPaces = function (params, target, extra) {
      if (!target) return params;
      return Object.assign(params, { paceFast: formatPace(target.fastSecPerKm), paceSlow: formatPace(target.slowSecPerKm) }, extra || {});
    };
    const out = [];

    function add(id, params, target, steps, alwaysDescription) {
      const text = MESSAGES[locale].library[id];
      const paced = !!target;
      const descriptionName = paced || alwaysDescription ? 'description' : 'descriptionByFeel';
      out.push({
        id: id,
        nameKey: 'workouts.library.' + id + '.name',
        descriptionKey: 'workouts.library.' + id + '.' + descriptionName,
        params: params,
        paced: paced,
        workout: {
          id: 'lib-' + id,
          name: fill(text.name, params, locale),
          sport: 'running',
          source: 'library',
          description: fill(text[descriptionName], params, locale),
          steps: steps
        }
      });
    }

    let target = paceTarget(p && p.easy);
    add('easy', withPaces({ distanceKm: easyKm }, target),
      target, [step('active', distance(easyKm * 1000), target || open())]);

    target = paceTarget(p && p.rep400);
    add('intervals400', withPaces({ reps: 6, distanceM: 400, recoveryM: 200, warmupMin: WARMUP_MIN, cooldownMin: COOLDOWN_MIN },
      target, p ? { goalPace: formatPace(p.goalSecPerKm) } : null), target, [
      warmup(),
      repeat(6, [step('active', distance(400), target || open()), step('recovery', distance(200), open())]),
      cooldown()
    ]);

    target = paceTarget(p && p.rep1k);
    add('intervals1k', withPaces({ reps: 5, distanceKm: 1, recoveryMin: 2, warmupMin: WARMUP_MIN, cooldownMin: COOLDOWN_MIN }, target), target, [
      warmup(),
      repeat(5, [step('active', distance(1000), target || open()), step('recovery', time(120), open())]),
      cooldown()
    ]);

    target = paceTarget(p && p.threshold);
    add('threshold', withPaces({ reps: 3, distanceKm: 2, recoveryMin: 2, warmupMin: WARMUP_MIN, cooldownMin: COOLDOWN_MIN }, target), target, [
      warmup(),
      repeat(3, [step('active', distance(2000), target || open()), step('recovery', time(120), open())]),
      cooldown()
    ]);

    target = paceTarget(p && p.easy);
    add('long', withPaces({ distanceKm: longKm }, target), target, [step('active', distance(longKm * 1000), target || open())]);

    add('test5k', { distanceKm: 5, warmupMin: WARMUP_MIN, cooldownMin: COOLDOWN_MIN }, null, [
      warmup(),
      step('active', distance(5000), open(), MESSAGES[locale].library.test5k.stepLabel),
      cooldown()
    ], true);

    return out;
  }

  // ---------------------------------------------------------------- plan -> workout

  /**
   * fromNextRun(nextRun, profile, { locale = 'cs' }) -> Workout | null
   * Converts VeyvoTraining.nextRunAfterRun()/nextRunAfter5k() output:
   *   kind 'rest' (or anything not 'easy')  -> null
   *   returnAfterBreak                       -> one time step of durationMax minutes (engine: 25–30 min,
   *                                             so 30 min; falls back to durationMin, then 30), open target
   *   easy                                   -> one distance step of distanceKm, pace target
   *                                             paceFast..paceSlow when valid, otherwise open; no warm-up
   * id is 'plan-<date>' ('plan-next' when the engine found no date) so re-sending the same day
   * updates it. `profile` is accepted for future per-athlete settings and not read yet.
   */
  function fromNextRun(nextRun, profile, options) {
    if (!isObject(nextRun) || nextRun.kind !== 'easy') return null;
    const locale = normalizeLocale(options);
    const text = MESSAGES[locale].plan;
    const date = isDateKey(nextRun.date) ? nextRun.date : null;
    let steps, name, description;
    if (nextRun.returnAfterBreak) {
      let minutes = Number(nextRun.durationMax);
      if (!Number.isFinite(minutes) || minutes <= 0) minutes = Number(nextRun.durationMin);
      if (!Number.isFinite(minutes) || minutes <= 0) minutes = 30;
      minutes = Math.round(minutes);
      steps = [step('active', time(minutes * 60), open())];
      name = fill(text.returnAfterBreak.name, { minutes: minutes }, locale);
      description = fill(text.returnAfterBreak.description, { minutes: minutes }, locale);
    } else {
      const km = Number(nextRun.distanceKm);
      if (!Number.isFinite(km) || km <= 0) return null;
      const target = paceTarget({ fastSecPerKm: nextRun.paceFast, slowSecPerKm: nextRun.paceSlow });
      const params = { distanceKm: km };
      if (target) { params.paceFast = formatPace(target.fastSecPerKm); params.paceSlow = formatPace(target.slowSecPerKm); }
      steps = [step('active', distance(Math.round(km * 1000)), target || open())];
      name = fill(text.easy.name, params, locale);
      description = fill(target ? text.easy.description : text.easy.descriptionByFeel, params, locale);
    }
    const workout = { id: 'plan-' + (date || 'next'), name: name, sport: 'running', source: 'plan', description: description, steps: steps };
    if (date) workout.date = date;
    return validate(workout).ok ? workout : null;
  }

  // ---------------------------------------------------------------- printable text

  const WORDS = Object.freeze({
    cs: {
      warmup: 'rozklus', cooldown: 'vyklus', recovery: 'klus', rest: 'pauza', active: 'běh', activeInRepeat: 'úsek',
      pace: ' v tempu {range} /km', hr: ' při tepu {range} tep/min', untilLap: ' do stisku tlačítka Lap'
    },
    en: {
      warmup: 'warm-up', cooldown: 'cool-down', recovery: 'jog', rest: 'rest', active: 'run', activeInRepeat: 'interval',
      pace: ' at {range} /km', hr: ' at {range} bpm', untilLap: ' until you press Lap'
    }
  });

  /** Short step name for watch screens: the label, else 'Rozklus'/'Úsek'/'Klus'… ('Warm-up'/'Interval'/'Jog'…). */
  function stepName(s, locale, inRepeat) {
    if (isObject(s) && typeof s.label === 'string' && s.label.trim()) return s.label.trim();
    const words = WORDS[normalizeLocale(locale)];
    const intensity = isObject(s) && INTENSITIES.indexOf(s.intensity) >= 0 ? s.intensity : 'active';
    return capitalize(intensity === 'active' && inRepeat ? words.activeInRepeat : words[intensity]);
  }

  function targetText(t, words) {
    if (t.type === 'pace') return fill(words.pace, { range: formatPace(t.fastSecPerKm) + EN_DASH + formatPace(t.slowSecPerKm) });
    if (t.type === 'hr') return fill(words.hr, { range: Math.round(t.lowBpm) + EN_DASH + Math.round(t.highBpm) });
    return '';
  }

  // Top level:   'Rozklus 15 min', 'Běh 5 km v tempu 5:10–6:15 /km', 'Naplno 5 km' (label replaces the noun)
  // In a repeat: '400 m v tempu 3:50–3:57 /km', '200 m klus', '400 m v tempu … – kopec' (label appended)
  function stepPhrase(s, locale, inRepeat) {
    const words = WORDS[locale];
    const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim() : '';
    const target = targetText(s.target, words);
    const noun = label || words[s.intensity];
    if (s.duration.type === 'open') return noun + words.untilLap + target;
    const amount = s.duration.type === 'time' ? formatTime(s.duration.seconds) : formatDistance(s.duration.meters, locale);
    if (s.intensity === 'active') {
      return inRepeat ? amount + target + (label ? ' ' + EN_DASH + ' ' + label : '') : noun + ' ' + amount + target;
    }
    if (s.intensity === 'warmup' || s.intensity === 'cooldown') return noun + ' ' + amount + target;
    return amount + ' ' + noun + target; // recovery, rest: '200 m klus', '1 min pauza'
  }

  /**
   * toLines(workout, locale) -> string[] (one line per top-level step or repeat); throws if invalid.
   *   cs: ['Rozklus 15 min', '6× (400 m v tempu 3:50–3:57 /km, 200 m klus)', 'Vyklus 10 min']
   *   en: ['Warm-up 15 min', '6× (400 m at 3:50–3:57 /km, 200 m jog)', 'Cool-down 10 min']
   */
  function toLines(workout, locale) {
    requireValid(workout);
    const loc = normalizeLocale(locale);
    return workout.steps.map(function (item) {
      if (item.kind === 'repeat') {
        const inner = item.steps.map(function (s) { return stepPhrase(s, loc, true); });
        return item.count + '× ' + (inner.length > 1 ? '(' + inner.join(', ') + ')' : inner[0]);
      }
      return capitalize(stepPhrase(item, loc, false));
    });
  }

  /** toText(workout, locale) -> the toLines() joined with '\n'. */
  function toText(workout, locale) { return toLines(workout, locale).join('\n'); }

  // ---------------------------------------------------------------- exports

  const api = {
    LIMITS: LIMITS,
    INTENSITIES: INTENSITIES,
    DURATION_TYPES: DURATION_TYPES,
    TARGET_TYPES: TARGET_TYPES,
    SOURCES: SOURCES,
    LIBRARY_IDS: LIBRARY_IDS,
    MESSAGES: MESSAGES,
    build: Object.freeze({ step: step, repeat: repeat, time: time, distance: distance, open: open, pace: pace, hr: hr }),
    validate: validate,
    flatten: flatten,
    fitStepCount: fitStepCount,
    estimate: estimate,
    derivePaces: derivePaces,
    library: library,
    fromNextRun: fromNextRun,
    toLines: toLines,
    toText: toText,
    stepName: stepName,
    registerMessages: registerMessages,
    format: Object.freeze({ pace: formatPace, distance: formatDistance, time: formatTime, number: formatNumber }),
    normalizeLocale: normalizeLocale,
    isDateKey: isDateKey
  };
  if (root && root.VeyvoI18n) registerMessages(root.VeyvoI18n);
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VeyvoWorkouts = api;
})(globalThis);
