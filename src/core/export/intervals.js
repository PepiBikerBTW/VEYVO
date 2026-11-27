/*
 * VeyvoIntervals - VEYVO Workout -> intervals.icu workout text + events/bulk request.
 *
 * Classic UMD script; load src/core/workouts.js first. Pure: no DOM, no network. The UI sends the
 * request built here through VeyvoPlatform.http (host intervals.icu) and passes the response back
 * to parseResponse()/parseError().
 *
 * intervals.icu workout text, as verified on 2026-11-27 (forum.intervals.icu "Workout Builder Syntax
 * Quick Guide" and "Specify workouts using absolute pace", announced 17 Nov 2025):
 *   - a step is a line starting with '- '; text before the first duration becomes the cue text
 *   - durations: '15m' (m = MINUTES), '90s', '1h30m'; distances: '400mtr' (metres), '2km', '2.5km'
 *   - absolute pace: '7:15-7:00/km Pace' (all official examples list the slower pace first)
 *   - heart rate only as zones or percentages ('75-80% HR', '90-95% LTHR'); absolute bpm is NOT
 *     supported, so bpm targets are converted with lthrBpm/maxHrBpm when given, otherwise dropped
 *   - repeats: a header line ending in 'Nx' ('Main set 6x'), one level only, with one empty line
 *     before and after every block
 *   - 'intensity=warmup|cooldown|active|interval|recovery|rest' per step (set explicitly on steps
 *     inside repeats, otherwise Garmin shows them as "Other")
 *   - 'Press lap' right after the dash ends a step on the lap button; it still needs a nominal
 *     duration for the intervals.icu timeline (Garmin ignores it)
 * Known caveats (docs/research): pace targets reach Garmin only when a Run threshold pace is set in
 * intervals.icu; mixing pace and HR targets in one workout is unreliable on devices; Garmin keeps
 * its own limits (50 steps, 99 repeats, 15 visible name characters).
 *
 * REST (intervals.icu OpenAPI): POST /api/v1/athlete/{id}/events/bulk?upsert=true with an array of
 * events; upsert matches external_id for events created with the same key/app. Athlete id 0 means
 * the owner of the API key. Basic auth: username 'API_KEY', password = the key.
 */
(function (root) {
  'use strict';

  const Workouts = root.VeyvoWorkouts || (typeof require === 'function' ? require('../workouts.js') : null);
  if (!Workouts) throw new Error('VeyvoIntervals needs VeyvoWorkouts: load src/core/workouts.js first.');

  const HOST = 'intervals.icu';
  const API_BASE = 'https://intervals.icu/api/v1';
  const DEFAULT_EXTERNAL_ID_PREFIX = 'veyvo-';
  const DEFAULT_OPEN_STEP_SECONDS = 300;
  const MESSAGE_MAX = 300;
  const REPEAT_HEADER = Object.freeze({ cs: 'Hlavní část', en: 'Main set' });

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function isNum(value) { return typeof value === 'number' && Number.isFinite(value); }
  function codedError(code, message, extra) {
    const error = new Error(message);
    error.code = code;
    return Object.assign(error, extra || {});
  }

  // ---------------------------------------------------------------- tokens

  /** 900 -> '15m', 90 -> '1m30s', 5400 -> '1h30m', 45 -> '45s'. */
  function durationToken(seconds) {
    const r = Math.max(1, Math.round(seconds));
    const h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), s = r % 60;
    return (h ? h + 'h' : '') + (m ? m + 'm' : '') + (s ? s + 's' : '');
  }
  /** 400 -> '400mtr', 1000 -> '1km', 2500 -> '2.5km', 1609 -> '1609mtr' ('m' would mean minutes). */
  function distanceToken(meters) {
    const r = Math.round(meters);
    return r >= 1000 && r % 10 === 0 ? String(r / 1000) + 'km' : r + 'mtr';
  }
  function paceToken(secPerKm) { return Workouts.format.pace(secPerKm); }
  /** Pace range 'slow-fast/km Pace', e.g. fast 230, slow 237 -> '3:57-3:50/km Pace'. */
  function paceTargetToken(target) {
    return paceToken(target.slowSecPerKm) + '-' + paceToken(target.fastSecPerKm) + '/km Pace';
  }
  function percentRange(low, high, reference, unit) {
    const lo = Math.round((low / reference) * 100), hi = Math.round((high / reference) * 100);
    return (lo === hi ? String(lo) : lo + '-' + hi) + '% ' + unit;
  }
  function plausibleHr(value) { return isNum(value) && value >= 80 && value <= 240 ? value : null; }

  /**
   * Cue text must not contain anything the parser could read as a duration, target or keyword,
   * so digits and syntax characters are stripped ('Úsek 1' -> 'Úsek').
   */
  function cueText(text) {
    return String(text)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\b(press\s+lap|intensity|ramp|freeride)\b/gi, ' ')
      .replace(/[0-9%:=\/<>!^*#"'’]/g, ' ')
      .replace(/^[\s\-–—•]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
      .trim();
  }
  /** Description lines are notes: no leading '-', and no trailing 'Nx' that would start a repeat. */
  function noteLine(text) {
    let line = String(text).replace(/\t/g, ' ').trim().replace(/^[-–—•\s]+/, '');
    if (/\d+\s*x\s*$/i.test(line)) line += '.';
    return line;
  }

  // ---------------------------------------------------------------- workout text

  /**
   * convert(workout, options) -> { text, warnings: [{ code, path, ...}] }; throws
   * { code: 'workout_invalid', errors } for an invalid workout. Options:
   *   locale ('cs')               default cue words ('Rozklus', 'Úsek' …) and repeat header
   *   includeDescription (true)   workout.description as note lines above the steps
   *   lthrBpm / maxHrBpm          convert bpm targets to '% LTHR' (preferred) or '% HR'
   *   openStepSeconds (300)       nominal duration written for lap-button steps
   * Warning codes (each reported once, path = first occurrence):
   *   pace_needs_threshold    the workout has pace targets: set a Run threshold pace in intervals.icu
   *   hr_absolute_unsupported bpm targets were dropped (no lthrBpm/maxHrBpm)
   *   mixed_targets           pace and HR targets in one workout
   *   open_step_nominal       a lap-button step was written with { seconds } nominal length
   */
  function convert(workout, options) {
    const opts = isObject(options) ? options : {};
    const check = Workouts.validate(workout);
    if (!check.ok) {
      throw codedError('workout_invalid', 'Invalid workout: ' + check.errors.map(function (e) { return e.code + (e.path ? ' @ ' + e.path : ''); }).join(', '), { errors: check.errors });
    }
    const locale = Workouts.normalizeLocale(opts.locale);
    const lthr = plausibleHr(opts.lthrBpm), maxHr = plausibleHr(opts.maxHrBpm);
    const openSeconds = isNum(opts.openStepSeconds) && opts.openStepSeconds >= 10 && opts.openStepSeconds <= 6 * 3600
      ? opts.openStepSeconds : DEFAULT_OPEN_STEP_SECONDS;
    const warnings = [];
    const seen = Object.create(null);
    const used = { pace: false, hr: false };
    const warn = function (code, path, extra) {
      if (seen[code]) return;
      seen[code] = true;
      warnings.push(Object.assign({ code: code, path: path }, extra || {}));
    };

    function stepLine(s, path, inRepeat) {
      const parts = ['-'];
      if (s.duration.type === 'open') parts.push('Press lap');
      // A label that is all digits/syntax falls back to the default step name.
      const cue = cueText(Workouts.stepName(s, locale, inRepeat)) ||
        cueText(Workouts.stepName({ intensity: s.intensity }, locale, inRepeat));
      if (cue) parts.push(cue);
      if (s.duration.type === 'time') parts.push(durationToken(s.duration.seconds));
      else if (s.duration.type === 'distance') parts.push(distanceToken(s.duration.meters));
      else {
        parts.push(durationToken(openSeconds));
        warn('open_step_nominal', path + '.duration', { seconds: openSeconds, minutes: Math.round(openSeconds / 60) });
      }
      if (s.target.type === 'pace') {
        parts.push(paceTargetToken(s.target));
        used.pace = true;
        warn('pace_needs_threshold', path + '.target');
      } else if (s.target.type === 'hr') {
        if (lthr) { parts.push(percentRange(s.target.lowBpm, s.target.highBpm, lthr, 'LTHR')); used.hr = true; }
        else if (maxHr) { parts.push(percentRange(s.target.lowBpm, s.target.highBpm, maxHr, 'HR')); used.hr = true; }
        else warn('hr_absolute_unsupported', path + '.target');
      }
      parts.push('intensity=' + (s.intensity === 'active' ? (inRepeat ? 'interval' : 'active') : s.intensity));
      return parts.join(' ');
    }

    const lines = [];
    const blank = function () { if (lines.length && lines[lines.length - 1] !== '') lines.push(''); };
    if (opts.includeDescription !== false && typeof workout.description === 'string' && workout.description.trim()) {
      workout.description.split(/\r?\n/).map(noteLine).filter(Boolean).forEach(function (line) { lines.push(line); });
      blank();
    }
    workout.steps.forEach(function (item, i) {
      const path = 'steps.' + i;
      if (item.kind === 'repeat') {
        if (item.count === 1) { // a single pass is written as plain steps
          item.steps.forEach(function (s, j) { lines.push(stepLine(s, path + '.steps.' + j, false)); });
          return;
        }
        blank();
        lines.push(REPEAT_HEADER[locale] + ' ' + item.count + 'x');
        item.steps.forEach(function (s, j) { lines.push(stepLine(s, path + '.steps.' + j, true)); });
        lines.push('');
      } else {
        lines.push(stepLine(item, path, false));
      }
    });
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (used.pace && used.hr) warn('mixed_targets', 'steps');
    return { text: lines.join('\n'), warnings: warnings };
  }

  /** toWorkoutText(workout, options) -> intervals.icu workout text (see convert for options). */
  function toWorkoutText(workout, options) { return convert(workout, options).text; }

  // ---------------------------------------------------------------- events payload

  /**
   * toEventsPayload(workouts, { externalIdPrefix = 'veyvo-', ...convert options }) -> Event[]
   *   Event = { category: 'WORKOUT', start_date_local: 'YYYY-MM-DDT00:00:00', type: 'Run',
   *             name, description: <workout text>, external_id: prefix + workout.id }
   * Accepts one workout or an array. Throws { code } for: workout_invalid (with errors, index),
   * date_required (index), duplicate_external_id (index), prefix_invalid.
   * external_id is stable per workout id, so plan workouts ('plan-<date>') update in place.
   */
  function toEventsPayload(workouts, options) {
    const opts = isObject(options) ? options : {};
    const list = Array.isArray(workouts) ? workouts : [workouts];
    const prefix = opts.externalIdPrefix == null ? DEFAULT_EXTERNAL_ID_PREFIX : opts.externalIdPrefix;
    if (typeof prefix !== 'string') throw codedError('prefix_invalid', 'externalIdPrefix must be a string');
    const ids = Object.create(null);
    return list.map(function (workout, index) {
      let text;
      try { text = convert(workout, opts).text; }
      catch (error) { error.index = index; throw error; }
      if (!Workouts.isDateKey(workout.date)) {
        throw codedError('date_required', 'Workout ' + index + ' needs a date (YYYY-MM-DD) for the calendar', { index: index });
      }
      const externalId = prefix + workout.id;
      if (ids[externalId]) {
        throw codedError('duplicate_external_id', 'Two workouts share external_id ' + externalId, { index: index, externalId: externalId });
      }
      ids[externalId] = true;
      return {
        category: 'WORKOUT',
        start_date_local: workout.date + 'T00:00:00',
        type: 'Run',
        name: workout.name.trim(),
        description: text,
        external_id: externalId
      };
    });
  }

  // ---------------------------------------------------------------- requests

  function utf8Bytes(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    const bytes = [];
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return bytes;
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64Fallback(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
        (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
    }
    return out;
  }
  /** UTF-8 safe base64: btoa when available (browser, Electron, Node >= 16), else Buffer, else pure JS. */
  function base64(text) {
    const bytes = utf8Bytes(String(text));
    if (typeof btoa === 'function') {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }
    if (typeof Buffer === 'function') return Buffer.from(bytes).toString('base64');
    return base64Fallback(bytes);
  }

  function requireKey(apiKey) {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key) throw codedError('api_key_required', 'An intervals.icu API key is required');
    return key;
  }
  function athletePath(options) {
    const id = isObject(options) && options.athleteId != null && options.athleteId !== '' ? String(options.athleteId).trim() : '0';
    if (!/^[A-Za-z0-9]{1,32}$/.test(id)) throw codedError('athlete_id_invalid', 'Invalid intervals.icu athlete id');
    return API_BASE + '/athlete/' + id;
  }
  function headers(key) {
    return { Authorization: 'Basic ' + base64('API_KEY:' + key), 'Content-Type': 'application/json' };
  }

  /**
   * buildRequest(payload, apiKey, { athleteId = '0' }) -> { url, method: 'POST', headers, body }
   * for POST /api/v1/athlete/{id}/events/bulk?upsert=true. Throws api_key_required,
   * athlete_id_invalid or payload_invalid (payload must be a non-empty array).
   */
  function buildRequest(payload, apiKey, options) {
    if (!Array.isArray(payload) || !payload.length) throw codedError('payload_invalid', 'payload must be a non-empty array of events');
    const key = requireKey(apiKey);
    return {
      url: athletePath(options) + '/events/bulk?upsert=true',
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify(payload)
    };
  }

  /**
   * buildDeleteRequest(externalIds, apiKey, { athleteId = '0' }) -> PUT /events/bulk-delete with
   * [{ external_id }] (OpenAPI: deletes "by id or by external_id"). Use it when a planned workout
   * is removed in VEYVO.
   */
  function buildDeleteRequest(externalIds, apiKey, options) {
    const list = (Array.isArray(externalIds) ? externalIds : [externalIds])
      .filter(function (id) { return typeof id === 'string' && id.trim(); });
    if (!list.length) throw codedError('payload_invalid', 'externalIds must contain at least one id');
    const key = requireKey(apiKey);
    return {
      url: athletePath(options) + '/events/bulk-delete',
      method: 'PUT',
      headers: headers(key),
      body: JSON.stringify(list.map(function (id) { return { external_id: id.trim() }; }))
    };
  }

  // ---------------------------------------------------------------- responses

  function responseJson(response) {
    if (response.json !== undefined && typeof response.json !== 'function') return response.json;
    if (typeof response.text === 'string' && response.text.trim()) {
      try { return JSON.parse(response.text); } catch (error) { return undefined; }
    }
    return undefined;
  }
  function clip(text) {
    const clean = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.length > MESSAGE_MAX ? clean.slice(0, MESSAGE_MAX - 1) + '…' : clean;
  }
  function messageOf(response) {
    const json = responseJson(response);
    if (isObject(json)) {
      const candidate = json.error || json.message || json.detail ||
        (Array.isArray(json.errors) ? json.errors.map(function (e) { return isObject(e) ? e.message || e.error || '' : String(e); }).filter(Boolean).join('; ') : '');
      if (typeof candidate === 'string' && candidate.trim()) return clip(candidate);
    } else if (typeof json === 'string' && json.trim()) return clip(json);
    return typeof response.text === 'string' ? clip(response.text) : '';
  }
  function headerValue(response, name) {
    const h = response.headers;
    if (!h) return null;
    if (typeof h.get === 'function') return h.get(name);
    const wanted = name.toLowerCase();
    const key = Object.keys(h).find(function (k) { return k.toLowerCase() === wanted; });
    return key ? h[key] : null;
  }

  /**
   * parseError(response) -> null when the response is a success, else
   *   { code, status, message, retryAfterSeconds? }
   * response is the VeyvoPlatform.http result { status, ok, text, json } (headers optional), or a
   * thrown error / null for a network failure. Codes: network, unauthorized (401: wrong API key),
   * forbidden (403), not_found (404), invalid_request (400/422), rate_limited (429, retryAfterSeconds
   * from Retry-After when present), server_error (5xx), http_error (anything else).
   */
  function parseError(response) {
    if (response == null) return { code: 'network', status: 0, message: '' };
    if (response instanceof Error || (isObject(response) && response.status == null && response.ok == null)) {
      return { code: 'network', status: 0, message: clip(response.message || '') };
    }
    const status = Number(response.status);
    if (response.ok === true || (status >= 200 && status < 300 && response.ok !== false)) return null;
    let code = 'http_error';
    if (!Number.isFinite(status) || status === 0) code = 'network';
    else if (status === 401) code = 'unauthorized';
    else if (status === 403) code = 'forbidden';
    else if (status === 404) code = 'not_found';
    else if (status === 400 || status === 422) code = 'invalid_request';
    else if (status === 429) code = 'rate_limited';
    else if (status >= 500) code = 'server_error';
    const result = { code: code, status: Number.isFinite(status) ? status : 0, message: messageOf(response) };
    if (code === 'rate_limited') {
      const header = headerValue(response, 'retry-after');
      const retry = header == null || String(header).trim() === '' ? NaN : Number(header);
      if (Number.isFinite(retry) && retry >= 0) result.retryAfterSeconds = retry;
    }
    return result;
  }

  /**
   * parseResponse(response) -> { ok: true, events: [{ id, externalId, name, date }] } |
   *                            { ok: false, error: parseError(response) }
   * A success whose body is not an event array is reported as { code: 'unexpected_response' }.
   */
  function parseResponse(response) {
    const error = parseError(response);
    if (error) return { ok: false, error: error };
    const json = responseJson(response);
    if (!Array.isArray(json)) {
      return { ok: false, error: { code: 'unexpected_response', status: Number(response.status) || 200, message: messageOf(response) } };
    }
    return {
      ok: true,
      events: json.filter(isObject).map(function (event) {
        return {
          id: event.id == null ? null : event.id,
          externalId: typeof event.external_id === 'string' ? event.external_id : null,
          name: typeof event.name === 'string' ? event.name : '',
          date: typeof event.start_date_local === 'string' ? event.start_date_local.slice(0, 10) : null
        };
      })
    };
  }

  // ---------------------------------------------------------------- messages (cs + en)

  /** VeyvoI18n.register('intervals', VeyvoIntervals.MESSAGES); keys 'intervals.error.<code>', 'intervals.warning.<code>'. */
  const MESSAGES = Object.freeze({
    cs: {
      error: {
        network: 'Nepodařilo se spojit s intervals.icu. Zkontroluj připojení k internetu.',
        unauthorized: 'intervals.icu odmítlo API klíč. Zkontroluj ho v intervals.icu v Settings → Developer Settings.',
        forbidden: 'Tento API klíč k této akci nemá oprávnění.',
        not_found: 'intervals.icu požadavek nenašlo. Zkontroluj ID sportovce.',
        invalid_request: 'intervals.icu trénink nepřijalo: {message}',
        rate_limited: 'Příliš mnoho požadavků najednou. Zkus to za chvíli znovu.',
        server_error: 'intervals.icu má teď potíže. Zkus to později.',
        http_error: 'intervals.icu vrátilo chybu {status}.',
        unexpected_response: 'intervals.icu odpovědělo neočekávaně. Zkontroluj kalendář v intervals.icu.',
        api_key_required: 'Nejdřív vlož API klíč z intervals.icu.',
        date_required: 'Trénink potřebuje datum, aby se dal poslat do kalendáře.'
      },
      warning: {
        pace_needs_threshold: 'Aby se cílové tempo dostalo do hodinek, nastav v intervals.icu prahové tempo pro běh.',
        hr_absolute_unsupported: 'Cíle tepu se neodeslaly: intervals.icu je přijímá jen v procentech prahového nebo maximálního tepu.',
        mixed_targets: 'Trénink kombinuje tempo a tep. Některé hodinky pak ukážou jen jeden typ cíle.',
        open_step_nominal: 'Krok bez pevné délky ukončíš tlačítkem Lap. V intervals.icu má orientačně {minutes} min.'
      }
    },
    en: {
      error: {
        network: 'Could not reach intervals.icu. Check your internet connection.',
        unauthorized: 'intervals.icu rejected the API key. Check it in intervals.icu under Settings → Developer Settings.',
        forbidden: 'This API key is not allowed to do that.',
        not_found: 'intervals.icu could not find that. Check the athlete ID.',
        invalid_request: 'intervals.icu did not accept the workout: {message}',
        rate_limited: 'Too many requests at once. Try again in a moment.',
        server_error: 'intervals.icu is having trouble right now. Try again later.',
        http_error: 'intervals.icu returned error {status}.',
        unexpected_response: 'intervals.icu sent an unexpected reply. Check your intervals.icu calendar.',
        api_key_required: 'Paste your intervals.icu API key first.',
        date_required: 'The workout needs a date before it can go on the calendar.'
      },
      warning: {
        pace_needs_threshold: 'To get pace targets onto your watch, set a run threshold pace in intervals.icu.',
        hr_absolute_unsupported: 'Heart-rate targets were left out: intervals.icu only accepts them as a percentage of threshold or max heart rate.',
        mixed_targets: 'This workout mixes pace and heart-rate targets. Some watches then show only one target type.',
        open_step_nominal: 'A step without a set length ends when you press Lap. intervals.icu shows it as about {minutes} min.'
      }
    }
  });

  function registerMessages(i18n) {
    if (!i18n || typeof i18n.register !== 'function') return false;
    i18n.register('intervals', MESSAGES);
    return true;
  }

  const api = {
    HOST: HOST,
    API_BASE: API_BASE,
    DEFAULT_EXTERNAL_ID_PREFIX: DEFAULT_EXTERNAL_ID_PREFIX,
    MESSAGES: MESSAGES,
    convert: convert,
    toWorkoutText: toWorkoutText,
    toEventsPayload: toEventsPayload,
    buildRequest: buildRequest,
    buildDeleteRequest: buildDeleteRequest,
    parseError: parseError,
    parseResponse: parseResponse,
    registerMessages: registerMessages,
    base64: base64
  };
  if (root && root.VeyvoI18n) registerMessages(root.VeyvoI18n);
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VeyvoIntervals = api;
})(globalThis);
