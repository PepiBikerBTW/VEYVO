/*
 * VeyvoFit - VEYVO Workout -> Garmin FIT workout file (also opened by WatchFit and other FIT apps).
 *
 * Our own minimal encoder written from the public FIT protocol description; it does not contain or
 * load any code from the Garmin FIT SDK (its licence forbids redistribution). Tests decode the
 * output with @garmin/fitsdk (devDependency) to prove it is valid. Classic UMD script: no DOM, no
 * network, no hidden clock (timeCreated is always passed in), no dependency on other modules.
 *
 * File layout (little-endian everywhere):
 *   14-byte header: size 14, protocol 1.0 (0x10), profile version, data size, '.FIT', header CRC
 *   definition + data record for file_id, then workout, then one definition and n data records
 *   for workout_step; 2-byte CRC of everything before it at the end (FIT CRC-16, nibble table).
 *
 * Messages (Garmin "Encoding Workout Files" cookbook):
 *   file_id      type 5 (workout), manufacturer 255 (development), product, serial_number
 *                (uint32z, never 0), time_created (seconds since 1989-12-31T00:00:00Z),
 *                product_name only when options.productName is given
 *   workout      sport 1 (running), sub_sport left out, num_valid_steps, wkt_name (UTF-8)
 *   workout_step message_index, wkt_step_name, duration_type, duration_value, target_type,
 *                target_value, custom_target_value_low/high, intensity
 * Values (raw main fields; the scaled sub-fields are what decoders show):
 *   time      duration_type 0, duration_value = seconds * 1000 (ms)
 *   distance  duration_type 1, duration_value = metres * 100 (cm)
 *   open      duration_type 5 (until the Lap button), duration_value invalid (absent)
 *   pace      target_type 0 (speed), target_value 0 (custom range, not a zone),
 *             custom low/high = speed in mm/s (m/s * 1000); low = the SLOWER pace
 *   heart rate target_type 1, target_value 0, custom low/high = bpm + 100 (0-100 would mean % max)
 *   no target target_type 2 (open), target_value 0
 *   repeat    duration_type 6 (repeat_until_steps_cmplt), duration_value = message_index of the
 *             block's first step, target_type 2 (open), target_value = total repetitions; the
 *             repeat step directly follows its block. intensity and name are absent.
 *   intensity active 0, rest 1, warmup 2, cooldown 3, recovery 4
 * Absent values are written as the base type's invalid value (0xFF / 0xFFFF / 0xFFFFFFFF, empty
 * string), which FIT decoders treat as "field not present".
 *
 * Workout model: docs/architecture.md. flatten() here mirrors VeyvoWorkouts.flatten() so the
 * encoder works whatever order the scripts load in; tests check that both agree.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- FIT constants

  const FIT_EPOCH_UNIX = 631065600;          // 1989-12-31T00:00:00Z in Unix seconds
  const DATE_TIME_MIN = 0x10000000;          // smaller date_time values mean "seconds since power-on"
  const UINT32_MAX_VALID = 0xFFFFFFFE;       // 0xFFFFFFFF is the uint32 invalid value
  const HEADER_SIZE = 14;
  const PROTOCOL_VERSION = 0x10;             // 1.0: no developer fields or 64-bit types are needed
  const PROFILE_VERSION = 2100;              // 21.00 (major * 100 + minor)
  const MIME = 'application/vnd.ant.fit';

  const MESG = Object.freeze({ fileId: 0, workout: 26, workoutStep: 27 });
  const BASE = Object.freeze({ enum: 0x00, uint8: 0x02, string: 0x07, uint16: 0x84, uint32: 0x86, uint32z: 0x8C });
  const INVALID = Object.freeze({ enum: 0xFF, uint8: 0xFF, uint16: 0xFFFF, uint32: 0xFFFFFFFF, uint32z: 0 });
  const SIZE = Object.freeze({ enum: 1, uint8: 1, uint16: 2, uint32: 4, uint32z: 4 });

  const FILE_TYPE = Object.freeze({ workout: 5 });
  const MANUFACTURER = Object.freeze({ development: 255 });
  const SPORT = Object.freeze({ running: 1 });
  const DURATION = Object.freeze({ time: 0, distance: 1, hrLessThan: 2, hrGreaterThan: 3, calories: 4, open: 5, repeatUntilStepsCmplt: 6 });
  const TARGET = Object.freeze({ speed: 0, heartRate: 1, open: 2 });
  const INTENSITY = Object.freeze({ active: 0, rest: 1, warmup: 2, cooldown: 3, recovery: 4 });
  const ENUMS = Object.freeze({ fileType: FILE_TYPE, manufacturer: MANUFACTURER, sport: SPORT, duration: DURATION, target: TARGET, intensity: INTENSITY });

  // ---------------------------------------------------------------- VEYVO limits

  const LIMITS = Object.freeze({
    maxFitSteps: 50,           // Garmin: 50 steps per workout, a repeat adds one step
    repeatMin: 1,
    repeatMax: 99,
    garminNameChars: 15,       // most Garmin watches show only the first 15 characters
    nameChars: 40,             // VEYVO workout name limit (options.fullName)
    stepNameChars: 40,
    productNameChars: 40,
    fileNameChars: 40,         // whole file name including 'VEYVO_' and '.fit'
    stringBytes: 255,          // a FIT field is at most 255 bytes, null terminator included
    hrMinBpm: 1,
    hrMaxBpm: 255
  });
  const INTENSITIES = Object.freeze(['warmup', 'active', 'recovery', 'rest', 'cooldown']);
  const FILE_PREFIX = 'VEYVO_';
  const FILE_EXT = '.fit';
  const FALLBACK_NAME = 'VEYVO';
  const FALLBACK_FILE_SLUG = 'workout';

  // Default step names when a step has no label (same words as VeyvoWorkouts.stepName).
  const STEP_WORDS = Object.freeze({
    cs: Object.freeze({ warmup: 'Rozklus', cooldown: 'Vyklus', recovery: 'Klus', rest: 'Pauza', active: 'Běh', activeInRepeat: 'Úsek' }),
    en: Object.freeze({ warmup: 'Warm-up', cooldown: 'Cool-down', recovery: 'Jog', rest: 'Rest', active: 'Run', activeInRepeat: 'Interval' })
  });

  // ---------------------------------------------------------------- small helpers

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function isNum(value) { return typeof value === 'number' && Number.isFinite(value); }
  function codedError(code, message, extra) {
    const error = new Error(message);
    error.code = code;
    return Object.assign(error, extra || {});
  }
  /** 'cs' for null/undefined/'cs-CZ'/'sk', 'en' for any other language tag (same rule as VeyvoFormat). */
  function normalizeLocale(value) {
    if (isObject(value)) value = value.locale;
    if (typeof value !== 'string' || !value.trim()) return 'cs';
    return /^(cs|sk)\b/i.test(value.trim().replace('_', '-')) ? 'cs' : 'en';
  }

  /** NFC, control characters removed, whitespace collapsed and trimmed. */
  function cleanText(value) {
    if (value == null) return '';
    let text = String(value);
    if (typeof text.normalize === 'function') text = text.normalize('NFC');
    return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  let segmenter = null;
  /** Visible characters (grapheme clusters when Intl.Segmenter exists, else code points). */
  function graphemes(text) {
    if (segmenter === null) {
      segmenter = false;
      try {
        if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      } catch (e) { segmenter = false; }
    }
    if (segmenter) return Array.from(segmenter.segment(text), function (part) { return part.segment; });
    return Array.from(text);
  }

  /** UTF-8 bytes of a string (TextEncoder where available, otherwise a manual encoder). */
  function utf8(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    const out = [];
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
  }

  /** Cuts text to maxChars visible characters and maxBytes UTF-8 bytes, never inside a character. */
  function capText(text, maxChars, maxBytes) {
    const chars = graphemes(text).slice(0, maxChars);
    let result = chars.join('');
    while (chars.length && utf8(result).length > maxBytes) {
      chars.pop();
      result = chars.join('');
    }
    return result.trim();
  }

  function nameOf(workoutOrName) {
    return isObject(workoutOrName) ? workoutOrName.name : workoutOrName;
  }

  // ---------------------------------------------------------------- names

  /** '6× 400 m' -> '6×400m', '10 km' -> '10km' (only used when a name is too long for the watch). */
  function compactName(text) {
    return text
      .replace(/(\d)\s*([×x])\s*(?=\d)/g, '$1$2')
      .replace(/(\d)\s+(km|m|min|s|h)(?![\p{L}\p{N}])/gu, '$1$2');
  }

  /**
   * garminName(workout | name, maxChars = 15) -> the workout name as most Garmin watches can show it.
   * Counted in visible characters (Czech diacritics stay, FIT strings are UTF-8). A name that is too
   * long is first compacted ('Dlouhý běh 10 km' -> 'Dlouhý běh 10km'), then cut. A cut word without
   * digits, or a number cut in half, is dropped when at least 8 characters remain
   * ('Intervaly 6× 400 m' -> 'Intervaly 6×400', 'Tempo 3× 2 km v cílovém' -> 'Tempo 3×2km',
   * never 'Intervaly 10×40'). Empty names become 'VEYVO'.
   */
  function garminName(workoutOrName, maxChars) {
    const max = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : LIMITS.garminNameChars;
    let text = cleanText(nameOf(workoutOrName));
    if (!text) return FALLBACK_NAME;
    let chars = graphemes(text);
    if (chars.length <= max) return text;
    text = compactName(text);
    chars = graphemes(text);
    if (chars.length <= max) return text;

    let cut = chars.slice(0, max);
    const next = chars[max];
    if (next !== ' ') {
      let space = -1;
      for (let i = cut.length - 1; i >= 0; i -= 1) if (cut[i] === ' ') { space = i; break; }
      const partial = cut.slice(space + 1).join('');
      const splitsNumber = /\d$/.test(partial) && /^\d/.test(next);
      if ((splitsNumber || !/\d/.test(partial)) && space >= Math.min(8, max - 1)) cut = cut.slice(0, space);
    }
    let result = cut.join('').replace(/[\s\-–—,;:.\/(]+$/, '');
    // Czech typography: a one-letter word ('v', 'a', 'k', 's', 'z', 'o', 'u', 'i') never ends the name.
    const shorter = result.replace(/ [\p{L}](?:[\s\-–—,;:.\/(]*)$/u, '');
    if (shorter !== result && graphemes(shorter).length >= Math.min(8, max - 1)) result = shorter;
    return result || cut.join('').trim() || FALLBACK_NAME;
  }

  const ASCII_MAP = Object.freeze({
    'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D',
    'ð': 'd', 'Ð': 'D', 'ł': 'l', 'Ł': 'L', 'þ': 'th', 'Þ': 'Th', 'ı': 'i', '×': 'x', '✕': 'x', '&': 'and'
  });

  /** 'Úseky 6× 400 m' -> 'Useky_6x_400_m' (ASCII letters, digits, '-' and single '_'). */
  function asciiSlug(text) {
    let s = cleanText(text);
    if (typeof s.normalize === 'function') s = s.normalize('NFKD');
    s = s.replace(/[̀-ͯ]/g, '');
    s = s.replace(/[ßæÆœŒøØđĐðÐłŁþÞı×✕&]/g, function (ch) { return ASCII_MAP[ch]; });
    return s.replace(/[^A-Za-z0-9-]+/g, '_').replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
  }

  /**
   * fileName(workout | name) -> safe ASCII file name, at most 40 characters including the
   * 'VEYVO_' prefix and '.fit': 'Intervaly 6x400' -> 'VEYVO_Intervaly_6x400.fit',
   * 'Lehký běh 3 km' -> 'VEYVO_Lehky_beh_3_km.fit'. Long names are cut after a whole word; a
   * leading 'VEYVO' in the name is not doubled; names without letters or digits give 'VEYVO_workout.fit'.
   */
  function fileName(workoutOrName) {
    let slug = asciiSlug(nameOf(workoutOrName)).replace(/^veyvo(?:[_-]+|$)/i, '');
    const room = LIMITS.fileNameChars - FILE_PREFIX.length - FILE_EXT.length;
    if (slug.length > room) {
      let cut = slug.slice(0, room);
      const boundary = Math.max(cut.lastIndexOf('_'), cut.lastIndexOf('-'));
      if (!/[_-]/.test(slug.charAt(room)) && boundary >= room / 2) cut = cut.slice(0, boundary); // whole words only
      slug = cut.replace(/[_-]+$/, '');
    }
    return FILE_PREFIX + (slug || FALLBACK_FILE_SLUG) + FILE_EXT;
  }

  /** Name written to wkt_step_name: the label, else 'Rozklus'/'Úsek'/'Klus'… ('Warm-up'/'Interval'/'Jog'…). */
  function stepName(step, locale, inRepeat) {
    const label = isObject(step) ? cleanText(step.label) : '';
    if (label) return label;
    const words = STEP_WORDS[normalizeLocale(locale)];
    const intensity = isObject(step) && INTENSITIES.indexOf(step.intensity) >= 0 ? step.intensity : 'active';
    return intensity === 'active' && inRepeat ? words.activeInRepeat : words[intensity];
  }

  // ---------------------------------------------------------------- validation + flatten

  function rawTime(seconds) { return Math.round(seconds * 1000); }
  function rawDistance(meters) { return Math.round(meters * 100); }
  /** Pace in s/km -> speed in mm/s (m/s * 1000). 237 s/km -> 4219. */
  function rawSpeed(secPerKm) { return Math.round(1e6 / secPerKm); }
  /** Absolute heart rate -> FIT workout_hr (values 0-100 mean % of max HR, so bpm is stored + 100). */
  function rawHr(bpm) { return Math.round(bpm) + 100; }
  function inUint32(value) { return Number.isInteger(value) && value >= 1 && value <= UINT32_MAX_VALID; }

  function checkStep(item, path, add) {
    if (!isObject(item) || item.kind !== 'step') { add('step_invalid', path); return; }
    if (INTENSITIES.indexOf(item.intensity) < 0) add('intensity_invalid', path + '.intensity');

    const d = item.duration;
    if (!isObject(d)) add('duration_invalid', path + '.duration');
    else if (d.type === 'time') {
      if (!isNum(d.seconds) || d.seconds <= 0) add('duration_invalid', path + '.duration.seconds');
      else if (!inUint32(rawTime(d.seconds))) add('value_range', path + '.duration.seconds');
    } else if (d.type === 'distance') {
      if (!isNum(d.meters) || d.meters <= 0) add('duration_invalid', path + '.duration.meters');
      else if (!inUint32(rawDistance(d.meters))) add('value_range', path + '.duration.meters');
    } else if (d.type !== 'open') add('duration_invalid', path + '.duration');

    const t = item.target;
    if (!isObject(t)) add('target_invalid', path + '.target');
    else if (t.type === 'pace') {
      let numbers = true;
      ['fastSecPerKm', 'slowSecPerKm'].forEach(function (key) {
        if (!isNum(t[key]) || t[key] <= 0) { add('target_invalid', path + '.target.' + key); numbers = false; }
      });
      if (numbers) {
        if (!(t.fastSecPerKm < t.slowSecPerKm)) add('pace_order', path + '.target');
        else if (!inUint32(rawSpeed(t.slowSecPerKm)) || !inUint32(rawSpeed(t.fastSecPerKm))) add('value_range', path + '.target');
      }
    } else if (t.type === 'hr') {
      let numbers = true;
      ['lowBpm', 'highBpm'].forEach(function (key) {
        if (!isNum(t[key])) { add('target_invalid', path + '.target.' + key); numbers = false; }
        else if (Math.round(t[key]) < LIMITS.hrMinBpm || Math.round(t[key]) > LIMITS.hrMaxBpm) {
          add('hr_range', path + '.target.' + key, { min: LIMITS.hrMinBpm, max: LIMITS.hrMaxBpm });
          numbers = false;
        }
      });
      if (numbers && !(Math.round(t.lowBpm) < Math.round(t.highBpm))) add('hr_order', path + '.target');
    } else if (t.type !== 'open') add('target_invalid', path + '.target');

    if (item.label != null && typeof item.label !== 'string') add('label_invalid', path + '.label');
  }

  /**
   * check(workout) -> { ok, errors: [{ code, path }], fitStepCount }
   * Only what the FIT file needs (the stricter VEYVO limits live in VeyvoWorkouts.validate). Codes
   * match VeyvoWorkouts where they overlap: workout_invalid, sport_invalid, steps_empty, step_invalid,
   * intensity_invalid, duration_invalid, target_invalid, pace_order, hr_range, hr_order,
   * label_invalid, repeat_count_range, repeat_empty, repeat_nested, too_many_steps, value_range.
   */
  function check(workout) {
    const errors = [];
    const add = function (code, path, extra) { errors.push(Object.assign({ code: code, path: path }, extra || {})); };
    if (!isObject(workout)) {
      add('workout_invalid', '');
      return { ok: false, errors: errors, fitStepCount: 0 };
    }
    if (workout.sport != null && workout.sport !== 'running') add('sport_invalid', 'sport');
    let count = 0;
    if (!Array.isArray(workout.steps) || !workout.steps.length) add('steps_empty', 'steps');
    else {
      workout.steps.forEach(function (item, i) {
        const path = 'steps.' + i;
        if (isObject(item) && item.kind === 'repeat') {
          count += 1;
          if (!Number.isInteger(item.count) || item.count < LIMITS.repeatMin || item.count > LIMITS.repeatMax) {
            add('repeat_count_range', path + '.count', { min: LIMITS.repeatMin, max: LIMITS.repeatMax });
          }
          if (!Array.isArray(item.steps) || !item.steps.length) { add('repeat_empty', path + '.steps'); return; }
          item.steps.forEach(function (inner, j) {
            count += 1;
            if (isObject(inner) && inner.kind === 'repeat') add('repeat_nested', path + '.steps.' + j);
            else checkStep(inner, path + '.steps.' + j, add);
          });
        } else {
          count += 1;
          checkStep(item, path, add);
        }
      });
      if (count > LIMITS.maxFitSteps) add('too_many_steps', 'steps', { count: count, max: LIMITS.maxFitSteps });
    }
    return { ok: errors.length === 0, errors: errors, fitStepCount: count };
  }

  function requireValid(workout) {
    const result = check(workout);
    if (!result.ok) {
      throw codedError('workout_invalid', 'Workout cannot be encoded as FIT: ' + result.errors.map(function (e) {
        return e.code + (e.path ? ' @ ' + e.path : '');
      }).join(', '), { errors: result.errors });
    }
    return workout;
  }

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
   * flatten(workout) -> steps in FIT message order (same shape as VeyvoWorkouts.flatten):
   *   { kind: 'step', index, path, intensity, duration, target, label?, inRepeat }
   *   { kind: 'repeat', index, path, fromIndex, count }   // right after its block
   * Throws { code: 'workout_invalid', errors } when the workout cannot be encoded.
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

  // ---------------------------------------------------------------- workout -> raw step values

  /**
   * toFitSteps(workout, { locale = 'cs', stepNames = true }) -> raw workout_step values in message
   * order, numbers as written to the file (null = field absent):
   *   { messageIndex, wktStepName, durationType, durationValue, targetType, targetValue,
   *     customTargetValueLow, customTargetValueHigh, intensity }
   * wktStepName is the step label, else a default name in `locale` ('Rozklus', 'Úsek', …) unless
   * stepNames is false; it is capped at 40 characters / 254 bytes.
   */
  function toFitSteps(workout, options) {
    const opts = isObject(options) ? options : {};
    const locale = normalizeLocale(opts.locale);
    const withNames = opts.stepNames !== false;
    return flatten(workout).map(function (item) {
      if (item.kind === 'repeat') {
        return {
          messageIndex: item.index, wktStepName: null,
          durationType: DURATION.repeatUntilStepsCmplt, durationValue: item.fromIndex,
          targetType: TARGET.open, targetValue: item.count,
          customTargetValueLow: null, customTargetValueHigh: null, intensity: null
        };
      }
      const label = cleanText(item.label) || (withNames ? stepName(item, locale, item.inRepeat) : '');
      const out = {
        messageIndex: item.index,
        wktStepName: label ? capText(label, LIMITS.stepNameChars, LIMITS.stringBytes - 1) : null,
        durationType: DURATION[item.duration.type], durationValue: null,
        targetType: TARGET.open, targetValue: 0,
        customTargetValueLow: null, customTargetValueHigh: null,
        intensity: INTENSITY[item.intensity]
      };
      if (item.duration.type === 'time') out.durationValue = rawTime(item.duration.seconds);
      else if (item.duration.type === 'distance') out.durationValue = rawDistance(item.duration.meters);
      if (item.target.type === 'pace') {
        out.targetType = TARGET.speed;
        out.customTargetValueLow = rawSpeed(item.target.slowSecPerKm);  // slower pace = lower speed
        out.customTargetValueHigh = rawSpeed(item.target.fastSecPerKm);
      } else if (item.target.type === 'hr') {
        out.targetType = TARGET.heartRate;
        out.customTargetValueLow = rawHr(item.target.lowBpm);
        out.customTargetValueHigh = rawHr(item.target.highBpm);
      }
      return out;
    });
  }

  // ---------------------------------------------------------------- options

  /** Date or seconds since the FIT epoch -> FIT date_time (uint32). Throws time_created_invalid. */
  function toFitTime(value) {
    let seconds = null;
    if (value instanceof Date) {
      const ms = value.getTime();
      if (isNum(ms)) seconds = Math.floor(ms / 1000) - FIT_EPOCH_UNIX;
    } else if (Number.isInteger(value)) {
      seconds = value;
    }
    if (seconds === null || seconds < DATE_TIME_MIN || seconds > UINT32_MAX_VALID) {
      throw codedError('time_created_invalid', 'timeCreated must be a Date after 1998-07-04 or FIT seconds >= 0x10000000');
    }
    return seconds;
  }

  /** FIT date_time -> Date. */
  function fromFitTime(seconds) { return new Date((seconds + FIT_EPOCH_UNIX) * 1000); }

  /**
   * serialFor(seed) -> deterministic non-zero uint32 (FNV-1a over the UTF-8 seed). encodeWorkout()
   * uses it when no serialNumber is given, with the workout id, name and time_created as seed, so
   * two exports differ (a watch may replace a workout whose file_id matches another one).
   */
  function serialFor(seed) {
    const bytes = utf8(String(seed));
    let hash = 0x811C9DC5;
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash || 1;
  }

  function normalizeOptions(workout, options) {
    const opts = isObject(options) ? options : {};
    const timeCreated = toFitTime(opts.timeCreated);
    let serial = opts.serialNumber;
    if (serial == null) serial = serialFor([workout.id, workout.name, timeCreated].join('|'));
    else if (!Number.isInteger(serial) || serial < 1 || serial > 0xFFFFFFFF) {
      throw codedError('serial_number_invalid', 'serialNumber must be an integer 1..4294967295');
    }
    let product = opts.product;
    if (product == null) product = 1;
    else if (!Number.isInteger(product) || product < 0 || product > 0xFFFE) {
      throw codedError('product_invalid', 'product must be an integer 0..65534');
    }
    const productName = opts.productName == null ? '' : capText(cleanText(opts.productName), LIMITS.productNameChars, LIMITS.stringBytes - 1);
    const name = opts.fullName
      ? capText(cleanText(workout.name), LIMITS.nameChars, LIMITS.stringBytes - 1) || FALLBACK_NAME
      : capText(garminName(workout), LIMITS.garminNameChars, LIMITS.stringBytes - 1) || FALLBACK_NAME;
    return { timeCreated: timeCreated, serialNumber: serial, product: product, productName: productName, name: name,
      locale: normalizeLocale(opts.locale), stepNames: opts.stepNames !== false };
  }

  // ---------------------------------------------------------------- byte writer

  function ByteWriter() {
    this.buffer = new Uint8Array(512);
    this.view = new DataView(this.buffer.buffer);
    this.length = 0;
  }
  ByteWriter.prototype.reserve = function (n) {
    if (this.length + n <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  };
  ByteWriter.prototype.u8 = function (v) { this.reserve(1); this.view.setUint8(this.length, v); this.length += 1; };
  ByteWriter.prototype.u16 = function (v) { this.reserve(2); this.view.setUint16(this.length, v, true); this.length += 2; };
  ByteWriter.prototype.u32 = function (v) { this.reserve(4); this.view.setUint32(this.length, v >>> 0, true); this.length += 4; };
  ByteWriter.prototype.bytes = function (src, size) {
    this.reserve(size);
    this.buffer.fill(0, this.length, this.length + size);
    this.buffer.set(src.subarray(0, size), this.length);
    this.length += size;
  };
  ByteWriter.prototype.result = function () { return this.buffer.slice(0, this.length); };

  // ---------------------------------------------------------------- CRC

  // FIT protocol CRC-16 (polynomial 0xA001, processed one nibble at a time).
  const CRC_TABLE = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];

  /** crc16(bytes, start = 0, end = bytes.length) -> FIT CRC of bytes[start..end). */
  function crc16(bytes, start, end) {
    const from = start == null ? 0 : start;
    const to = end == null ? bytes.length : end;
    let crc = 0;
    for (let i = from; i < to; i += 1) {
      const b = bytes[i];
      let tmp = CRC_TABLE[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ CRC_TABLE[b & 0xF];
      tmp = CRC_TABLE[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xF];
    }
    return crc;
  }

  // ---------------------------------------------------------------- records

  /** field(num, 'uint16', value) / field(num, 'string', text, size). value null = invalid. */
  function field(num, type, value, size) {
    if (type === 'string') {
      const bytes = utf8(value || '');
      return { num: num, type: type, base: BASE.string, size: size || bytes.length + 1, value: bytes };
    }
    return { num: num, type: type, base: BASE[type], size: SIZE[type], value: value == null ? INVALID[type] : value };
  }

  function writeDefinition(w, local, mesgNum, fields) {
    w.u8(0x40 | local);       // record header: definition message, normal header
    w.u8(0);                  // reserved
    w.u8(0);                  // architecture: little-endian
    w.u16(mesgNum);
    w.u8(fields.length);
    fields.forEach(function (f) { w.u8(f.num); w.u8(f.size); w.u8(f.base); });
  }

  function writeData(w, local, fields) {
    w.u8(local);              // record header: data message, normal header
    fields.forEach(function (f) {
      if (f.type === 'string') w.bytes(f.value, f.size);
      else if (f.size === 1) w.u8(f.value);
      else if (f.size === 2) w.u16(f.value);
      else w.u32(f.value);
    });
  }

  function stepFields(step, nameSize) {
    const fields = [field(254, 'uint16', step.messageIndex)];
    if (nameSize) fields.push(field(0, 'string', step.wktStepName, nameSize));
    fields.push(
      field(1, 'enum', step.durationType),
      field(2, 'uint32', step.durationValue),
      field(3, 'enum', step.targetType),
      field(4, 'uint32', step.targetValue),
      field(5, 'uint32', step.customTargetValueLow),
      field(6, 'uint32', step.customTargetValueHigh),
      field(7, 'enum', step.intensity)
    );
    return fields;
  }

  // ---------------------------------------------------------------- encoder

  /**
   * encodeWorkout(workout, options) -> Uint8Array (a complete .fit workout file)
   * options:
   *   timeCreated   Date | seconds since 1989-12-31T00:00:00Z (required; no hidden clock)
   *   serialNumber  integer 1..4294967295 (default: serialFor(id | name | timeCreated))
   *   product       integer 0..65534 (default 1)
   *   productName?  string written to file_id.product_name (left out when not given)
   *   locale        'cs' | 'en' for default step names (default 'cs')
   *   stepNames     false = only explicit labels become step names (default true)
   *   fullName      true = write the whole name (<= 40 chars) instead of garminName() (15)
   * Throws coded errors: workout_invalid (with errors[]), time_created_invalid,
   * serial_number_invalid, product_invalid.
   */
  function encodeWorkout(workout, options) {
    requireValid(workout);
    const opts = normalizeOptions(workout, options);
    const steps = toFitSteps(workout, { locale: opts.locale, stepNames: opts.stepNames });
    const w = new ByteWriter();
    for (let i = 0; i < HEADER_SIZE; i += 1) w.u8(0); // patched below

    const fileId = [
      field(0, 'enum', FILE_TYPE.workout),
      field(1, 'uint16', MANUFACTURER.development),
      field(2, 'uint16', opts.product),
      field(3, 'uint32z', opts.serialNumber),
      field(4, 'uint32', opts.timeCreated)
    ];
    if (opts.productName) fileId.push(field(8, 'string', opts.productName));
    writeDefinition(w, 0, MESG.fileId, fileId);
    writeData(w, 0, fileId);

    const workoutFields = [
      field(8, 'string', opts.name),
      field(4, 'enum', SPORT.running),
      field(6, 'uint16', steps.length)
    ];
    writeDefinition(w, 1, MESG.workout, workoutFields);
    writeData(w, 1, workoutFields);

    // One definition for every step: the name field is as wide as the longest name (+ null).
    let nameSize = 0;
    steps.forEach(function (s) { if (s.wktStepName) nameSize = Math.max(nameSize, utf8(s.wktStepName).length + 1); });
    writeDefinition(w, 2, MESG.workoutStep, stepFields(steps[0], nameSize));
    steps.forEach(function (s) { writeData(w, 2, stepFields(s, nameSize)); });

    // Header: size, protocol, profile, data size, '.FIT', header CRC; then the file CRC.
    const dataSize = w.length - HEADER_SIZE;
    w.view.setUint8(0, HEADER_SIZE);
    w.view.setUint8(1, PROTOCOL_VERSION);
    w.view.setUint16(2, PROFILE_VERSION, true);
    w.view.setUint32(4, dataSize, true);
    w.buffer.set([0x2E, 0x46, 0x49, 0x54], 8); // '.FIT'
    w.view.setUint16(12, crc16(w.buffer, 0, 12), true);
    w.u16(crc16(w.buffer, 0, w.length));
    return w.result();
  }

  /** toFile(workout, options) -> { name, mime, data } ready for VeyvoPlatform.saveFile(). */
  function toFile(workout, options) {
    return { name: fileName(workout), mime: MIME, data: encodeWorkout(workout, options) };
  }

  // ---------------------------------------------------------------- exports

  const api = {
    MIME: MIME,
    LIMITS: LIMITS,
    ENUMS: ENUMS,
    FIT_EPOCH_UNIX: FIT_EPOCH_UNIX,
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    PROFILE_VERSION: PROFILE_VERSION,
    encodeWorkout: encodeWorkout,
    toFile: toFile,
    toFitSteps: toFitSteps,
    flatten: flatten,
    check: check,
    fileName: fileName,
    garminName: garminName,
    stepName: stepName,
    serialFor: serialFor,
    toFitTime: toFitTime,
    fromFitTime: fromFitTime,
    crc16: crc16
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VeyvoFit = api;
})(globalThis);
