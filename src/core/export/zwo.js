/*
 * VeyvoZwo - VEYVO Workout -> Zwift `.zwo` run workout (also read by TrainingPeaks and intervals.icu).
 *
 * Classic UMD script; load src/core/workouts.js first. Pure: no DOM, no network, no clock.
 *
 * ZWO has no official spec. What this file relies on (checked 2026-11-27):
 *   - Zwift Insider "How To: Create Running Workouts in Zwift" (Zwift's own example file):
 *     <sportType>run</sportType>; run blocks Warmup, SteadyState, IntervalsT, Cooldown; `Power`,
 *     `PowerLow`/`PowerHigh`, `OnPower`/`OffPower` are decimal FRACTIONS of a reference pace the
 *     runner keeps in Zwift ("Edit Paces"); `pace` picks that reference: 0 = 1 mile, 1 = 5 km,
 *     2 = 10 km, 3 = half marathon, 4 = marathon. The fraction is of SPEED (Zwift's example uses
 *     OffPower 0.252 of 5 km pace for walking), so power = referenceSecPerKm / targetSecPerKm and
 *     a faster pace gives a bigger number.
 *   - intervals.icu forum "Intervals running zwo workout exports doesn't run in Zwift" (2023):
 *     a run file needs <durationType>: 'distance' makes Duration/OnDuration/OffDuration meters,
 *     'time' makes them seconds; a file without it did not load. pace="2" = 10 km pace there too,
 *     which confirms the 0-based mapping (one blog lists 1..5; Zwift's own examples use 0..4).
 *   - h4l/zwift-workout-file-reference (tags seen in 1 500+ real files): textevent with
 *     `timeoffset` (time files) or `distoffset` (distance files) + `message` inside a block.
 *   - Known Zwift display bug (forums.zwift.com, July 2024): distance-based IntervalsT may label
 *     meters as minutes on screen while still counting down the distance; options.repeats =
 *     'expand' writes plain SteadyState blocks instead.
 *
 * Choices made here:
 *   - One unit per file (durationType). 'auto': 'distance' when every measured step is a distance,
 *     'time' when every step is a time; for a mix, the unit that needs the fewest pace guesses
 *     (see chooseDurationType; the 6 × 400 m session becomes 'time', the 5 km test 'distance'),
 *     ties -> 'time'. A step in the other unit is converted with ITS OWN pace: the middle of its
 *     pace target ((fast + slow) / 2, like VeyvoWorkouts.estimate), or options.easyPaceSecPerKm
 *     for a step without a pace target; seconds are rounded to 1 s, meters to 10 m. Converted
 *     steps are listed in convert().convertedPaths and explained in the description.
 *   - Zwift needs a target on every block. Steps VEYVO runs by feel (open or HR target) use the
 *     athlete's easy pace (options.easyPaceSecPerKm), and their textevent says the real
 *     instruction ("podle pocitu" / "by feel", or the heart-rate range Zwift cannot target).
 *     This includes an active step without a pace (the all-out 5 km test): the easy pace is the
 *     safe guide, because the same rule also covers the by-feel return run after a break, where
 *     showing 5 km pace would push the runner too hard. The description says so.
 *   - Warmup/Cooldown are ramps from PowerLow to PowerHigh: Warmup goes from the slow end of the
 *     range to the fast end, Cooldown from the fast end to the slow end (so PowerLow > PowerHigh,
 *     as in Zwift's own cool-downs; not yet checked on a device). A single easy pace gives a flat
 *     ramp.
 *   - A repeat with exactly two steps becomes IntervalsT (Repeat, OnDuration/OffDuration,
 *     OnPower/OffPower); other repeats are written out as SteadyState blocks, count times.
 *   - Open-duration steps (lap button) have no Zwift equivalent: they get options.openStepSeconds
 *     (300) / options.openStepMeters (1000) and the textevent says so.
 *   - Every block gets one textevent at offset 0 with the step in words (one per IntervalsT set).
 *   - The description starts with workout.description and names the reference pace the fractions
 *     were computed from, so the runner can set the same pace in Zwift.
 *
 * Errors carry `code`: 'workout_invalid' (+ errors), 'zwo_reference_pace_required',
 * 'zwo_easy_pace_required' (+ paths), 'zwo_option_invalid' (+ option).
 */
(function (root) {
  'use strict';

  const Workouts = root.VeyvoWorkouts || (typeof require === 'function' ? require('../workouts.js') : null);
  if (!Workouts) throw new Error('VeyvoZwo needs VeyvoWorkouts: load src/core/workouts.js first.');

  const EXTENSION = '.zwo';
  const MIME = 'application/xml';
  const AUTHOR = 'VEYVO';
  const FILE_NAME_MAX = 60;
  const EN_DASH = '–';
  const DOT = ' · ';
  /** Zwift `pace` attribute values (0-based, see the header). */
  const PACE_ZONES = Object.freeze({ mile: 0, '5k': 1, '10k': 2, half: 3, marathon: 4 });
  const DURATION_TYPES = Object.freeze(['auto', 'time', 'distance']);
  const DEFAULT_OPEN_SECONDS = 300;
  const DEFAULT_OPEN_METERS = 1000;
  const LIMITS = Workouts.LIMITS;

  const TEXT = Object.freeze({
    cs: {
      zone: { mile: 'míli', '5k': '5 km', '10k': '10 km', half: 'půlmaraton', marathon: 'maraton' },
      reference: 'Tempa jsou v souboru zapsaná jako podíl tvého tempa na {zone} ({pace} /km). Stejné tempo nastav ve Zwiftu v Edit Paces.',
      easyGuide: 'Úseky bez cílového tempa ukazují ve Zwiftu jako vodítko tvé lehké tempo {easy} /km. Řiď se textem u úseku.',
      convertedToTime: 'Úseky zadané vzdáleností jsou přepočtené na čas',
      convertedToDistance: 'Úseky zadané časem jsou přepočtené na vzdálenost',
      byTarget: ' podle svého cílového tempa.',
      byEasy: ' podle tvého lehkého tempa {easy} /km.',
      byBoth: ' podle cílového tempa, úseky bez něj podle tvého lehkého tempa {easy} /km.',
      byFeel: 'podle pocitu',
      pace: '{range} /km',
      hr: 'tep {range} tep/min',
      open: 'bez pevné délky, v souboru {amount}'
    },
    en: {
      zone: { mile: 'mile', '5k': '5 km', '10k': '10 km', half: 'half marathon', marathon: 'marathon' },
      reference: 'Paces in this file are stored relative to your {zone} pace ({pace} /km). Set the same pace in Zwift under Edit Paces.',
      easyGuide: 'Steps without a target pace show your easy pace ({easy} /km) in Zwift as a guide. Follow the step text.',
      convertedToTime: 'Distance-based steps were converted to time',
      convertedToDistance: 'Time-based steps were converted to distance',
      byTarget: ' using their target pace.',
      byEasy: ' using your easy pace of {easy} /km.',
      byBoth: ' using their target pace, or your easy pace of {easy} /km where there is none.',
      byFeel: 'by feel',
      pace: '{range} /km',
      hr: 'heart rate {range} bpm',
      open: 'no fixed length, {amount} in this file'
    }
  });

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function isNum(value) { return typeof value === 'number' && Number.isFinite(value); }
  function codedError(code, message, extra) {
    const error = new Error(message);
    error.code = code;
    return Object.assign(error, extra || {});
  }
  function fill(template, params) {
    return template.replace(/\{(\w+)\}/g, function (m, key) { return params[key] == null ? m : String(params[key]); });
  }

  // ---------------------------------------------------------------- XML

  /** Escapes text and attribute values; drops characters XML 1.0 does not allow. */
  function escapeXml(value) {
    const text = Array.from(String(value == null ? '' : value).replace(/\r\n?/g, '\n')).filter(function (ch) {
      const c = ch.charCodeAt(0);
      if (ch.length === 1 && c >= 0xD800 && c <= 0xDFFF) return false;       // lone surrogate
      if (c < 0x20) return c === 0x09 || c === 0x0A;                         // C0 controls except tab/LF
      return c !== 0xFFFE && c !== 0xFFFF;
    }).join('');
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  /** Attribute values also keep their line breaks / tabs through attribute normalisation. */
  function escapeAttr(value) {
    return escapeXml(value).replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
  }
  /** 1.027837 -> '1.0278' (max 4 decimals, '.' separator, no trailing zeros). */
  function num(value, decimals) {
    const factor = Math.pow(10, decimals == null ? 4 : decimals);
    const rounded = Math.round(value * factor) / factor;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }

  // ---------------------------------------------------------------- options

  // Reference and easy paces are the athlete's own numbers, not step targets: derivePaces() accepts a
  // 5 km up to 2:00:00, so its easy range can reach ~35:00 /km (a 45:00 5 km already gives 6:30–13:05).
  // Workouts.LIMITS.paceSlowest (12:00 /km) only bounds step targets, so options allow up to 40:00 /km.
  const OPTION_PACE_SLOWEST = 2400;
  function paceNumber(value) { return isNum(value) && value >= LIMITS.paceFastest && value <= OPTION_PACE_SLOWEST; }

  /** number | { fastSecPerKm, slowSecPerKm } -> { fast, slow, mid } | null; throws on bad input. */
  function readEasy(value) {
    if (value == null) return null;
    if (paceNumber(value)) return { fast: value, slow: value, mid: value };
    if (isObject(value) && paceNumber(value.fastSecPerKm) && paceNumber(value.slowSecPerKm) && value.fastSecPerKm <= value.slowSecPerKm) {
      return { fast: value.fastSecPerKm, slow: value.slowSecPerKm, mid: (value.fastSecPerKm + value.slowSecPerKm) / 2 };
    }
    throw codedError('zwo_option_invalid', 'easyPaceSecPerKm must be seconds per km (150–2400) or a { fastSecPerKm, slowSecPerKm } range.', { option: 'easyPaceSecPerKm' });
  }

  function positive(value, fallback, option) {
    if (value == null) return fallback;
    if (!isNum(value) || value < 1) throw codedError('zwo_option_invalid', option + ' must be a positive number.', { option: option });
    return Math.round(value);
  }

  function readOptions(options) {
    const opts = isObject(options) ? options : {};
    const reference = opts.referencePaceSecPerKm;
    if (reference == null) {
      throw codedError('zwo_reference_pace_required', 'Zwift export needs referencePaceSecPerKm (the runner\'s reference pace in Zwift, by default 5 km pace).');
    }
    if (!paceNumber(reference)) {
      throw codedError('zwo_option_invalid', 'referencePaceSecPerKm must be seconds per km between 150 and 2400.', { option: 'referencePaceSecPerKm' });
    }
    const zone = opts.referenceDistance == null ? '5k' : opts.referenceDistance;
    if (!Object.prototype.hasOwnProperty.call(PACE_ZONES, zone)) {
      throw codedError('zwo_option_invalid', 'referenceDistance must be one of ' + Object.keys(PACE_ZONES).join(', ') + '.', { option: 'referenceDistance' });
    }
    const durationType = opts.durationType == null ? 'auto' : opts.durationType;
    if (DURATION_TYPES.indexOf(durationType) < 0) {
      throw codedError('zwo_option_invalid', 'durationType must be auto, time or distance.', { option: 'durationType' });
    }
    const repeats = opts.repeats == null ? 'intervals' : opts.repeats;
    if (repeats !== 'intervals' && repeats !== 'expand') {
      throw codedError('zwo_option_invalid', 'repeats must be "intervals" or "expand".', { option: 'repeats' });
    }
    return {
      reference: reference,
      zone: zone,
      easy: readEasy(opts.easyPaceSecPerKm),
      durationType: durationType,
      repeats: repeats,
      locale: Workouts.normalizeLocale(opts.locale),
      textEvents: opts.textEvents !== false,
      openSeconds: positive(opts.openStepSeconds, DEFAULT_OPEN_SECONDS, 'openStepSeconds'),
      openMeters: positive(opts.openStepMeters, DEFAULT_OPEN_METERS, 'openStepMeters'),
      author: typeof opts.author === 'string' && opts.author.trim() ? opts.author.trim() : AUTHOR
    };
  }

  /**
   * optionsFromPaces(paces, extra) -> toZwo options from VeyvoWorkouts.derivePaces() output:
   *   reference = best 5 km / 5 when a best 5 km is known (unrounded, like Zwift's own 5 km pace),
   *   otherwise paces.currentSecPerKm; easy = paces.easy. Returns null when paces is null.
   */
  function optionsFromPaces(paces, extra) {
    if (!isObject(paces)) return null;
    const best = paces.basis && isNum(paces.basis.best5kSeconds) ? paces.basis.best5kSeconds : null;
    const out = { referencePaceSecPerKm: best != null ? best / 5 : paces.currentSecPerKm, referenceDistance: '5k' };
    if (isObject(paces.easy)) out.easyPaceSecPerKm = { fastSecPerKm: paces.easy.fastSecPerKm, slowSecPerKm: paces.easy.slowSecPerKm };
    return Object.assign(out, isObject(extra) ? extra : {});
  }

  // ---------------------------------------------------------------- planning

  function measuredSteps(workout) {
    const out = [];
    workout.steps.forEach(function (item, i) {
      if (item.kind === 'repeat') item.steps.forEach(function (s, j) { out.push({ s: s, path: 'steps.' + i + '.steps.' + j }); });
      else out.push({ s: item, path: 'steps.' + i });
    });
    return out;
  }

  /**
   * 'auto' picks the unit that needs the fewest guesses, comparing (steps counted as written):
   *   1. active steps without a pace target that would be converted (VEYVO has no pace for
   *      them: a 5 km test is run all out, an easy run by feel; the easy pace would be a guess),
   *   2. any step without a pace target that would be converted (they use the easy pace),
   *   3. all converted steps;
   * a tie goes to 'time'. All-distance workouts stay distance, all-time workouts stay time.
   */
  function chooseDurationType(workout, requested) {
    if (requested !== 'auto') return requested;
    function cost(unit) {
      const c = [0, 0, 0];
      measuredSteps(workout).forEach(function (e) {
        const d = e.s.duration.type;
        if (d === 'open' || d === unit) return;
        const paced = e.s.target.type === 'pace';
        if (!paced && e.s.intensity === 'active') c[0] += 1;
        if (!paced) c[1] += 1;
        c[2] += 1;
      });
      return c;
    }
    const t = cost('time'), d = cost('distance');
    for (let i = 0; i < 3; i++) {
      if (d[i] !== t[i]) return d[i] < t[i] ? 'distance' : 'time';
    }
    return 'time';
  }

  /** Pace a step is run at for conversions and for its Zwift target: own target, else easy. */
  function stepPace(s, easy) {
    if (s.target.type === 'pace') return { fast: s.target.fastSecPerKm, slow: s.target.slowSecPerKm, mid: (s.target.fastSecPerKm + s.target.slowSecPerKm) / 2 };
    return easy;
  }

  function requirements(workout, opts) {
    const durationType = chooseDurationType(workout, opts.durationType);
    const needEasy = [], converted = [], open = [];
    let convertedPaced = false, convertedEasy = false;
    measuredSteps(workout).forEach(function (e) {
      const d = e.s.duration.type;
      const paced = e.s.target.type === 'pace';
      if (!paced) needEasy.push(e.path);
      if (d === 'open') open.push(e.path);
      else if (d !== durationType) {
        converted.push(e.path);
        if (paced) convertedPaced = true; else convertedEasy = true;
      }
    });
    return { durationType: durationType, needEasy: needEasy, converted: converted, open: open,
      convertedPaced: convertedPaced, convertedEasy: convertedEasy };
  }

  // ---------------------------------------------------------------- blocks

  function durationValue(s, durationType, opts) {
    const d = s.duration;
    if (d.type === 'open') return durationType === 'time' ? opts.openSeconds : opts.openMeters;
    if (d.type === durationType) return Math.max(1, Math.round(d.type === 'time' ? d.seconds : d.meters));
    const p = stepPace(s, opts.easy).mid;
    if (d.type === 'distance') return Math.max(1, Math.round((d.meters / 1000) * p));      // -> seconds
    return Math.max(10, Math.round((d.seconds / p) * 100) * 10);                           // -> meters, to 10 m
  }

  function fraction(secPerKm, opts) { return num(opts.reference / secPerKm); }

  function amountText(s, durationType, opts) {
    const value = durationValue(s, durationType, opts);
    return durationType === 'time' ? Workouts.format.time(value) : Workouts.format.distance(value, opts.locale);
  }

  /** 'Úsek 400 m · 3:50–3:57 /km', 'Rozklus 15 min · podle pocitu', 'Běh 40 min · tep 140–155 tep/min'. */
  function stepText(s, inRepeat, durationType, opts) {
    const words = TEXT[opts.locale];
    const parts = [Workouts.stepName(s, opts.locale, inRepeat)];
    const d = s.duration;
    if (d.type === 'time') parts[0] += ' ' + Workouts.format.time(d.seconds);
    else if (d.type === 'distance') parts[0] += ' ' + Workouts.format.distance(d.meters, opts.locale);
    const t = s.target;
    if (t.type === 'pace') parts.push(fill(words.pace, { range: Workouts.format.pace(t.fastSecPerKm) + EN_DASH + Workouts.format.pace(t.slowSecPerKm) }));
    else if (t.type === 'hr') parts.push(fill(words.hr, { range: Math.round(t.lowBpm) + EN_DASH + Math.round(t.highBpm) }));
    else parts.push(words.byFeel);
    if (d.type === 'open') parts.push(fill(words.open, { amount: amountText(s, durationType, opts) }));
    return parts.join(DOT);
  }

  function element(name, attrs, message, durationType) {
    const attrText = attrs.map(function (pair) { return ' ' + pair[0] + '="' + escapeAttr(pair[1]) + '"'; }).join('');
    if (message == null) return { name: name, xml: '    <' + name + attrText + '/>' };
    const offset = durationType === 'distance' ? 'distoffset' : 'timeoffset';
    return {
      name: name,
      xml: '    <' + name + attrText + '>\n' +
        '      <textevent ' + offset + '="0" message="' + escapeAttr(message) + '"/>\n' +
        '    </' + name + '>'
    };
  }

  function singleBlock(s, kind, inRepeat, durationType, opts, withText) {
    const p = stepPace(s, opts.easy);
    const attrs = [['Duration', String(durationValue(s, durationType, opts))]];
    if (kind === 'Warmup') attrs.push(['PowerLow', fraction(p.slow, opts)], ['PowerHigh', fraction(p.fast, opts)]);
    else if (kind === 'Cooldown') attrs.push(['PowerLow', fraction(p.fast, opts)], ['PowerHigh', fraction(p.slow, opts)]);
    else attrs.push(['Power', fraction(p.mid, opts)]);
    attrs.push(['pace', String(PACE_ZONES[opts.zone])]);
    return element(kind, attrs, withText ? stepText(s, inRepeat, durationType, opts) : null, durationType);
  }

  function blocksFor(workout, durationType, opts) {
    const out = [];
    workout.steps.forEach(function (item) {
      if (item.kind !== 'repeat') {
        const kind = item.intensity === 'warmup' ? 'Warmup' : item.intensity === 'cooldown' ? 'Cooldown' : 'SteadyState';
        out.push(singleBlock(item, kind, false, durationType, opts, opts.textEvents));
        return;
      }
      if (opts.repeats === 'intervals' && item.steps.length === 2) {
        const on = item.steps[0], off = item.steps[1];
        const attrs = [
          ['Repeat', String(item.count)],
          ['OnDuration', String(durationValue(on, durationType, opts))],
          ['OffDuration', String(durationValue(off, durationType, opts))],
          ['OnPower', fraction(stepPace(on, opts.easy).mid, opts)],
          ['OffPower', fraction(stepPace(off, opts.easy).mid, opts)],
          ['pace', String(PACE_ZONES[opts.zone])]
        ];
        const message = opts.textEvents
          ? item.count + '× (' + stepText(on, true, durationType, opts) + ' + ' + stepText(off, true, durationType, opts) + ')'
          : null;
        out.push(element('IntervalsT', attrs, message, durationType));
        return;
      }
      for (let r = 0; r < item.count; r++) {
        item.steps.forEach(function (s) {
          out.push(singleBlock(s, 'SteadyState', true, durationType, opts, opts.textEvents));
        });
      }
    });
    return out;
  }

  /** '5:10–6:15' for a range, '5:43' for a single pace. */
  function easyText(easy) {
    const fast = Workouts.format.pace(easy.fast), slow = Workouts.format.pace(easy.slow);
    return fast === slow ? fast : fast + EN_DASH + slow;
  }

  function descriptionFor(workout, info, opts) {
    const words = TEXT[opts.locale];
    const parts = [];
    if (typeof workout.description === 'string' && workout.description.trim()) parts.push(workout.description.trim());
    parts.push(fill(words.reference, { zone: words.zone[opts.zone], pace: Workouts.format.pace(opts.reference) }));
    if (info.needEasy.length) parts.push(fill(words.easyGuide, { easy: easyText(opts.easy) }));
    if (info.converted.length) {
      const how = info.convertedPaced && info.convertedEasy ? words.byBoth : info.convertedEasy ? words.byEasy : words.byTarget;
      parts.push((info.durationType === 'time' ? words.convertedToTime : words.convertedToDistance) +
        fill(how, { easy: opts.easy ? Workouts.format.pace(opts.easy.mid) : '' }));
    }
    return parts.join('\n\n');
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
   * convert(workout, options) -> { xml, durationType, blockCount, convertedPaths, openPaths, easyPacePaths }
   * options:
   *   referencePaceSecPerKm  REQUIRED, the runner's reference pace in Zwift (s/km)
   *   referenceDistance      'mile' | '5k' (default) | '10k' | 'half' | 'marathon' -> pace="0".."4"
   *   easyPaceSecPerKm       number | { fastSecPerKm, slowSecPerKm }; required when a step has no
   *                          pace target (open / HR): its Zwift target and its duration conversion
   *   durationType           'auto' (default) | 'time' | 'distance'
   *   repeats                'intervals' (default, two-step repeats -> IntervalsT) | 'expand'
   *   locale                 'cs' (default) | 'en' for textevents and the description
   *   textEvents             true (default) | false
   *   openStepSeconds / openStepMeters   nominal length of lap-button steps (300 s / 1000 m)
   *   author                 default 'VEYVO'
   */
  function convert(workout, options) {
    requireValid(workout);
    const opts = readOptions(options);
    const info = requirements(workout, opts);
    if (info.needEasy.length && !opts.easy) {
      throw codedError('zwo_easy_pace_required', 'Zwift export needs easyPaceSecPerKm for steps without a pace target: ' + info.needEasy.join(', '), { paths: info.needEasy });
    }
    const blocks = blocksFor(workout, info.durationType, opts);
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<workout_file>',
      '  <author>' + escapeXml(opts.author) + '</author>',
      '  <name>' + escapeXml(workout.name.trim()) + '</name>',
      '  <description>' + escapeXml(descriptionFor(workout, info, opts)) + '</description>',
      '  <sportType>run</sportType>',
      '  <durationType>' + info.durationType + '</durationType>',
      '  <workout>'
    ].concat(blocks.map(function (b) { return b.xml; }), ['  </workout>', '</workout_file>', '']).join('\n');
    return {
      xml: xml,
      durationType: info.durationType,
      blockCount: blocks.length,
      convertedPaths: info.converted,
      openPaths: info.open,
      easyPacePaths: info.needEasy
    };
  }

  /** toZwo(workout, options) -> the `.zwo` XML string (see convert() for options and errors). */
  function toZwo(workout, options) { return convert(workout, options).xml; }

  /**
   * check(workout, options) -> { ok, code?, paths?, durationType? } without throwing, so the UI can
   * tell the runner what is missing before offering the Zwift download.
   */
  function check(workout, options) {
    try {
      const result = convert(workout, options);
      return { ok: true, durationType: result.durationType, convertedPaths: result.convertedPaths, openPaths: result.openPaths };
    } catch (error) {
      if (!error || !error.code) throw error;
      const out = { ok: false, code: error.code };
      if (error.paths) out.paths = error.paths;
      if (error.option) out.option = error.option;
      if (error.errors) out.errors = error.errors;
      return out;
    }
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

  /** fileName(workout) -> '<ascii-name>.zwo'. */
  function fileName(workout) { return asciiName(isObject(workout) ? workout.name : '') + EXTENSION; }

  /** { name, mime, data } ready for VeyvoPlatform.saveFile(). */
  function file(workout, options) { return { name: fileName(workout), mime: MIME, data: toZwo(workout, options) }; }

  const api = {
    EXTENSION: EXTENSION,
    MIME: MIME,
    PACE_ZONES: PACE_ZONES,
    TEXT: TEXT,
    toZwo: toZwo,
    convert: convert,
    check: check,
    optionsFromPaces: optionsFromPaces,
    fileName: fileName,
    file: file,
    escapeXml: escapeXml
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VeyvoZwo = api;
})(globalThis);
