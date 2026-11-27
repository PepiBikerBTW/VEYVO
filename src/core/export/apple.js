/*
 * VeyvoApple - VEYVO Workout -> Apple Watch `.workout` file (WorkoutKit custom workout).
 *
 * Classic UMD script. Load order in the page: src/core/workouts.js, src/vendor/workoutkit.js
 * (globalThis.VeyvoWorkoutKit, vendored @bibixx/workoutkit 0.2.0, MIT), then this file. In Node the
 * vendored script is require()d on first use. Pure: no DOM, no network, no clock.
 *
 * Mapping (docs/architecture.md "Workout model" -> WorkoutKit CustomWorkout):
 *   plan        { referenceId, custom: { activity: 'running', location: 'outdoor' | 'indoor', ... } }
 *   name        -> custom.displayName (trimmed; VEYVO caps names at 40 characters, WorkoutKit has
 *                  no documented limit)
 *   steps[0]    with intensity 'warmup'   -> custom.warmup
 *   steps[last] with intensity 'cooldown' -> custom.cooldown
 *               Apple keeps warm-up and cool-down only at the ends, so every other item becomes
 *               an interval block, in order:
 *   Repeat      -> IntervalBlock { iterations: count, steps }
 *   plain Step  -> IntervalBlock { iterations: 1, steps: [step] }   (one block per step, so the
 *                  watch shows the same sections as VeyvoWorkouts.toLines())
 *   purpose     'active' -> 'work'; 'recovery' | 'rest' -> 'recovery'; a 'warmup' / 'cooldown'
 *                  step that is not at its end (or sits in a repeat) -> 'recovery' (easy running)
 *   step name   label -> step.displayName. Steps Apple cannot name itself ('rest', a misplaced
 *                  warm-up / cool-down) get VeyvoWorkouts.stepName() in options.locale
 *                  ('Pauza', 'Rozklus' ...); work / recovery / warm-up / cool-down without a label
 *                  keep Apple's own localized names.
 *   duration    time -> TimeGoal (seconds), distance -> DistanceGoal (meters), open -> OpenGoal
 *   target      pace -> SpeedRangeAlert, metric current (the default), min = 1000 / slowSecPerKm m/s,
 *                  max = 1000 / fastSecPerKm m/s, stored as "<x> meters per 1 second" (the shape
 *                  Apple writes for Measurement<UnitSpeed>); hr -> HeartRateRangeAlert (bpm);
 *                  open -> no alert
 *   A workout made only of a warm-up and/or a cool-down is written as blocks, because a custom
 *   workout without any interval block is not something Apple's Workout app creates.
 *
 * referenceId (WorkoutPlan.id, a UUID) is derived from the workout id + the encoded content, so the
 * same workout always gives identical bytes and an edited workout gets a new id (an import is never
 * mistaken for an older copy). It is shaped as an RFC 9562 version-8 (custom) UUID, upper case like
 * Swift's uuidString. options.referenceId overrides it.
 *
 * Errors carry `code`: 'workout_invalid' (+ errors, from VeyvoWorkouts.validate),
 * 'apple_option_invalid' (+ option), 'apple_encoder_missing', 'apple_encode_failed' (+ cause).
 */
(function (root) {
  'use strict';

  const Workouts = root.VeyvoWorkouts || (typeof require === 'function' ? require('../workouts.js') : null);
  if (!Workouts) throw new Error('VeyvoApple needs VeyvoWorkouts: load src/core/workouts.js first.');

  const EXTENSION = '.workout';
  const MIME = 'application/octet-stream';
  const LOCATIONS = Object.freeze(['outdoor', 'indoor']);
  const FILE_NAME_MAX = 60;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function codedError(code, message, extra) {
    const error = new Error(message);
    error.code = code;
    return Object.assign(error, extra || {});
  }

  // ---------------------------------------------------------------- encoder lookup

  /** globalThis.VeyvoWorkoutKit, loading src/vendor/workoutkit.js in Node when needed; null if absent. */
  function kit() {
    if (root.VeyvoWorkoutKit && typeof root.VeyvoWorkoutKit.encode === 'function') return root.VeyvoWorkoutKit;
    if (typeof require === 'function') {
      try { require('../../vendor/workoutkit.js'); } catch (error) { return null; }
      const loaded = root.VeyvoWorkoutKit || globalThis.VeyvoWorkoutKit;
      if (loaded && typeof loaded.encode === 'function') return loaded;
    }
    return null;
  }

  // ---------------------------------------------------------------- options

  function readOptions(options) {
    const opts = isObject(options) ? options : {};
    const location = opts.location == null ? 'outdoor' : opts.location;
    if (LOCATIONS.indexOf(location) < 0) {
      throw codedError('apple_option_invalid', 'Apple location must be "outdoor" or "indoor".', { option: 'location' });
    }
    if (opts.referenceId != null && (typeof opts.referenceId !== 'string' || !UUID_RE.test(opts.referenceId))) {
      throw codedError('apple_option_invalid', 'Apple referenceId must be a UUID string.', { option: 'referenceId' });
    }
    return { location: location, locale: Workouts.normalizeLocale(opts.locale), referenceId: opts.referenceId || null };
  }

  // ---------------------------------------------------------------- mapping

  function goalJson(duration) {
    if (duration.type === 'time') return { type: 'time', time: { value: duration.seconds, unit: 'seconds' } };
    if (duration.type === 'distance') return { type: 'distance', distance: { value: duration.meters, unit: 'meters' } };
    return { type: 'open' };
  }

  /** Pace in seconds per km -> WorkoutKit speed "<m> meters per 1 second". */
  function speedJson(secPerKm) {
    return { distance: { value: 1000 / secPerKm, unit: 'meters' }, time: { value: 1, unit: 'seconds' } };
  }

  function alertJson(target) {
    if (target.type === 'pace') {
      // The slower pace is the lower speed. No `metric`: WorkoutKit's default is the current
      // speed (what the Workout app calls current pace), and the decoder omits it too.
      return { type: 'speedRange', min: speedJson(target.slowSecPerKm), max: speedJson(target.fastSecPerKm) };
    }
    if (target.type === 'hr') {
      return { type: 'heartRateRange', min: { value: target.lowBpm, unit: 'beatsPerMinute' }, max: { value: target.highBpm, unit: 'beatsPerMinute' } };
    }
    return null;
  }

  function label(s) { return typeof s.label === 'string' && s.label.trim() ? s.label.trim() : ''; }

  function stepJson(s, displayName) {
    const out = { goal: goalJson(s.duration) };
    const alert = alertJson(s.target);
    if (alert) out.alert = alert;
    if (displayName) out.displayName = displayName;
    return out;
  }

  /** A step inside an interval block. */
  function intervalStepJson(s, inRepeat, locale) {
    const purpose = s.intensity === 'active' ? 'work' : 'recovery';
    const needsName = s.intensity === 'rest' || s.intensity === 'warmup' || s.intensity === 'cooldown';
    const name = label(s) || (needsName ? Workouts.stepName(s, locale, inRepeat) : '');
    return { purpose: purpose, step: stepJson(s, name) };
  }

  function isStep(item, intensity) { return isObject(item) && item.kind === 'step' && item.intensity === intensity; }

  /**
   * layout(workout) -> { warmup: Step | null, blocks: Array<Step | Repeat>, cooldown: Step | null }
   * (VEYVO items, before conversion). Exposed for the UI preview and the tests.
   */
  function layout(workout) {
    requireValid(workout);
    const steps = workout.steps;
    let start = 0, end = steps.length;
    let warmup = null, cooldown = null;
    if (isStep(steps[0], 'warmup')) { warmup = steps[0]; start = 1; }
    if (end > start && isStep(steps[end - 1], 'cooldown')) { cooldown = steps[end - 1]; end -= 1; }
    if (end === start) return { warmup: null, blocks: steps.slice(), cooldown: null };
    return { warmup: warmup, blocks: steps.slice(start, end), cooldown: cooldown };
  }

  // ---------------------------------------------------------------- reference id

  /** cyrb128: small, fast, well-mixed 128-bit string hash (public domain). Not cryptographic. */
  function hash128(text) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < text.length; i++) {
      const k = text.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1, h2, h3, h4].map(function (h) { return (h >>> 0).toString(16).padStart(8, '0'); }).join('');
  }

  /** Deterministic version-8 UUID for any string, e.g. '1F0C…-…-8…-[89AB]…-…'. */
  function uuidFrom(text) {
    const hex = hash128(String(text)).split('');
    hex[12] = '8';
    hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const h = hex.join('');
    return (h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20)).toUpperCase();
  }

  // ---------------------------------------------------------------- public API

  function requireValid(workout) {
    const check = Workouts.validate(workout);
    if (!check.ok) {
      throw codedError('workout_invalid', 'Invalid workout: ' + check.errors.map(function (e) {
        return e.code + (e.path ? ' @ ' + e.path : '');
      }).join(', '), { errors: check.errors });
    }
  }

  /**
   * toPlanJson(workout, { location = 'outdoor', locale = 'cs', referenceId }) -> WorkoutPlanJson
   * The @bibixx/workoutkit JSON shape that encode() accepts (see the mapping at the top).
   */
  function toPlanJson(workout, options) {
    requireValid(workout);
    const opts = readOptions(options);
    const parts = layout(workout);
    const custom = { activity: 'running', location: opts.location, displayName: workout.name.trim() };
    if (parts.warmup) custom.warmup = stepJson(parts.warmup, label(parts.warmup));
    custom.blocks = parts.blocks.map(function (item) {
      if (item.kind === 'repeat') {
        return { iterations: item.count, steps: item.steps.map(function (s) { return intervalStepJson(s, true, opts.locale); }) };
      }
      return { iterations: 1, steps: [intervalStepJson(item, false, opts.locale)] };
    });
    if (parts.cooldown) custom.cooldown = stepJson(parts.cooldown, label(parts.cooldown));
    const referenceId = opts.referenceId || uuidFrom(workout.id + '\n' + JSON.stringify(custom));
    return { referenceId: referenceId, custom: custom };
  }

  /**
   * encodeWorkout(workout, options) -> Uint8Array with the bytes of an Apple `.workout` file.
   * options as toPlanJson(). Throws coded errors (see the top of the file).
   */
  function encodeWorkout(workout, options) {
    const plan = toPlanJson(workout, options);
    const Kit = kit();
    if (!Kit) throw codedError('apple_encoder_missing', 'Apple export needs VeyvoWorkoutKit: load src/vendor/workoutkit.js first.');
    let bytes;
    try {
      bytes = Kit.encode(plan);
    } catch (cause) {
      throw codedError('apple_encode_failed', 'Apple .workout encoding failed: ' + (cause && cause.message ? cause.message : String(cause)), { cause: cause });
    }
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw codedError('apple_encode_failed', 'Apple .workout encoder returned no bytes.');
    return bytes;
  }

  /** 'Lehký běh 3 km' -> 'Lehky-beh-3-km' (ASCII letters, digits and dashes; × -> x). */
  function asciiName(text) {
    const slug = String(text == null ? '' : text)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[×✕]/g, 'x')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, FILE_NAME_MAX)
      .replace(/-+$/, '');
    return slug || 'veyvo-workout';
  }

  /** fileName(workout) -> '<ascii-name>.workout', e.g. 'Useky-6x-400-m.workout'. */
  function fileName(workout) { return asciiName(isObject(workout) ? workout.name : '') + EXTENSION; }

  /** { name, mime, data } ready for VeyvoPlatform.saveFile(). */
  function file(workout, options) {
    return { name: fileName(workout), mime: MIME, data: encodeWorkout(workout, options) };
  }

  const api = {
    EXTENSION: EXTENSION,
    MIME: MIME,
    LOCATIONS: LOCATIONS,
    encodeWorkout: encodeWorkout,
    toPlanJson: toPlanJson,
    layout: layout,
    fileName: fileName,
    file: file,
    asciiName: asciiName,
    uuidFrom: uuidFrom,
    isAvailable: function () { return !!kit(); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VeyvoApple = api;
})(globalThis);
