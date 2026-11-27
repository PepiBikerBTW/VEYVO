/*
 * VeyvoStore - VEYVO state schema v2 (see docs/architecture.md).
 *
 *   DEFAULT_STATE()                         fresh v2 state
 *   migrate(raw) / migrateWithReport(raw)   any stored value (legacy 0.3.x, v2, junk) -> v2 state
 *   load(storage, { now, key }) / save(storage, state)
 *   exportBackup(state, nutritionRaw, { appVersion, exportedAt }) / parseBackup(text) / applyBackup
 *   mergeRuns(existing, incoming) / importStravaRuns(state, incoming)
 *   importHealthRuns(state, rows, { at }) / healthRunFrom(row) / healthImportSince(state, now)
 *   validateRun, addRun, updateRun, deleteRun, upsertRecovery, deleteRecovery, setProfile, applyUndo
 *   schedulePlanned, unschedulePlanned, logExport, restoreIgnoredStrava, restoreIgnoredHealth
 *
 * Classic UMD script: no DOM, no network. Nothing reads the clock inside a calculation; "today"
 * is passed as 'YYYY-MM-DD'. (Two I/O conveniences fall back to the clock only when the caller
 * gives nothing: the corrupt-copy timestamp in load() and the 'm-<timestamp>' id in addRun().)
 * Every helper is pure: it returns a new state and never mutates its arguments. Results carry
 * error/warning codes; the UI translates them (cs/en texts in VeyvoStore.MESSAGES, namespace
 * 'store', registered into VeyvoI18n automatically when it is already loaded).
 *
 * Migration never throws and never drops data silently: every dropped or altered record is
 * reported as a warning ({ code, ... }), and load() keeps a copy of the pre-v2 raw string.
 */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const STORAGE_KEY = 'veyvo-state';
  const NUTRITION_KEY = 'veyvo-pre-run-v1';
  const CORRUPT_KEY_PREFIX = 'veyvo-state-corrupt-';
  const MIGRATION_BACKUP_PREFIX = 'veyvo-state-backup-v';
  const RUN_TYPES = Object.freeze(['run', 'easy', 'long', 'tempo', 'intervals', 'test5k', 'race']);
  const LIMITS = Object.freeze({
    maxDistanceKm: 300, maxSeconds: 172800, maxNote: 1000, maxProfileName: 40, maxRunName: 200,
    maxLabel: 200, minGoalKm: 1, maxGoalKm: 100, minTargetSeconds: 60, maxTargetSeconds: 172800,
    maxSleepHours: 24, maxBackupChars: 50 * 1024 * 1024
  });
  // Same activity: same date, |delta km| < 0.15 and |delta s| < 90 (as VeyvoRuns.findDuplicate).
  // Extra guard: two known start times at least 2 hours apart are two different runs.
  const DUPLICATE = Object.freeze({ km: 0.15, seconds: 90, startMinutes: 120 });
  const MIN_PLAUSIBLE_PACE = 120; // s/km; faster than 2:00/km is almost always a typo
  const DEFAULT_DAYS = Object.freeze([1, 6]); // 0 = Monday ... 6 = Sunday; owner: Tuesday + Sunday
  const DEFAULT_GOAL_KM = 5;
  const DEFAULT_TARGET_SECONDS = 1200;

  const V2_KEYS = ['schemaVersion', 'profile', 'runHistory', 'recoveryLogs', 'legacyMilestones', 'ignoredStravaIds', 'ignoredHealthIds', 'plannedWorkouts', 'exportLog', 'theme', 'language', 'strava', 'intervals', 'health', 'ui'];
  const LEGACY_KEYS = ['milestones', 'stravaActivityIds', 'stravaConnected', 'stravaLastSync', 'sharedChatUrl'];
  const RUN_KEYS = ['id', 'source', 'date', 'startTime', 'type', 'distance', 'movingSeconds', 'effort', 'note', 'name', 'stravaActivityId', 'stravaMovingSeconds', 'averageHeartrate', 'elevationGain', 'healthId', 'maxHeartrate', 'sourceName'];
  // Apple Health (iOS, VeyvoPlatform.health): the first import reads firstImportDays back, later ones
  // start overlapDays before the last import (watch apps often sync a run into Health hours or days
  // later). Two Health workouts with different ids are one run only when they started at most
  // twinStartMinutes apart: two apps (Strava, Garmin Connect, the Workout app) wrote the same run.
  const HEALTH = Object.freeze({ firstImportDays: 90, overlapDays: 7, twinStartMinutes: 10, maxIgnored: 5000, maxSourceName: 80 });
  const HEALTH_ID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
  const LEGACY_RUN_KEYS = ['time', 'effortRecorded'];
  const RECOVERY_KEYS = ['date', 'sleepHours', 'fatigue', 'soreness', 'note'];
  const PLANNED_KEYS = ['date', 'templateId'];
  // ignoredStravaIds: Strava activities the runner deleted (never re-imported). plannedWorkouts: one
  // library session per date ({ date, templateId }). exportLog: the newest EXPORT_LOG_MAX exports.
  const MAX_IGNORED_STRAVA = 5000;
  const EXPORT_LOG_MAX = 50;
  const TEMPLATE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
  const EXPORT_FORMAT = /^[a-z0-9][a-z0-9-]{0,19}$/;

  // ---------------------------------------------------------------- small helpers

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const safeKey = k => k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
  const blank = v => v === undefined || v === null || v === '';
  const filled = v => !blank(v);

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
  }

  /** Deep copy of JSON-safe data; functions and other exotic values are left out. */
  function cloneJson(value, depth) {
    const d = depth || 0;
    if (d > 32) return undefined;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(item => { const c = cloneJson(item, d + 1); return c === undefined ? null : c; });
    if (isPlainObject(value)) {
      const out = {};
      for (const k of Object.keys(value)) {
        if (!safeKey(k)) continue;
        const c = cloneJson(value[k], d + 1);
        if (c !== undefined) out[k] = c;
      }
      return out;
    }
    return undefined;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => hasOwn(b, k) && deepEqual(a[k], b[k]));
  }

  /** Number from a number or a numeric string ('5', '5.2', '5,2', ' 12 '); NaN otherwise. */
  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value !== 'string') return NaN;
    const text = value.trim().replace(/\s+/g, '').replace(',', '.');
    return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
  }

  function roundTo(value, digits) {
    const f = Math.pow(10, digits);
    return Math.round(value * f) / f;
  }

  const chars = text => Array.from(text);
  const charLength = text => chars(text).length;
  const truncate = (text, max) => (text.length <= max || charLength(text) <= max ? text : chars(text).slice(0, max).join(''));

  function isDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    if (y < 1900) return false;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }

  function todayOf(options) {
    const value = typeof options === 'string' ? options : isPlainObject(options) ? options.today : undefined;
    return typeof value === 'string' && isDateKey(value.trim()) ? value.trim() : null;
  }

  /** 'HH:MM' from 'H:MM', 'HH:MM' or 'HH:MM:SS'; null when not a valid clock time. */
  function normalizeClock(value) {
    if (typeof value !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    return h <= 23 && min <= 59 ? String(h).padStart(2, '0') + ':' + m[2] : null;
  }
  const clockMinutes = clock => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

  /** Seconds from 'm:ss', 'mm:ss', 'mmm:ss' or 'h:mm:ss'; null when malformed (range not checked). */
  function parseClockDuration(value) {
    if (typeof value !== 'string') return null;
    const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2]), c = m[3] === undefined ? null : Number(m[3]);
    if (b > 59 || (c !== null && c > 59)) return null;
    return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
  }

  /** Whole seconds in (0, 48 h] from a number, numeric string or clock string; null otherwise. */
  function durationFrom(value) {
    if (blank(value)) return null;
    const raw = typeof value === 'string' && value.indexOf(':') >= 0 ? parseClockDuration(value) : toNumber(value);
    if (raw === null || !Number.isFinite(raw)) return null;
    const seconds = Math.round(raw);
    return seconds > 0 && seconds <= LIMITS.maxSeconds ? seconds : null;
  }

  /** Whole seconds in (0, 48 h] from a clock string only ('21' alone is ambiguous: minutes or seconds). */
  function clockDurationFrom(value) {
    const seconds = parseClockDuration(value);
    return seconds !== null && seconds > 0 && seconds <= LIMITS.maxSeconds ? seconds : null;
  }

  function foldLabel(value) {
    return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  const TYPE_ALIASES = (function () {
    const map = Object.create(null);
    const add = (code, labels) => labels.forEach(label => { map[foldLabel(label)] = code; });
    add('run', ['run', 'Běh', 'Running', 'Trail run', 'Virtual run']);
    add('easy', ['easy', 'Lehký běh', 'Lehký', 'Easy run', 'Regenerační běh', 'Recovery run']);
    add('long', ['long', 'Dlouhý běh', 'Dlouhý', 'Long run']);
    add('tempo', ['tempo', 'Tempo run', 'Tempový běh']);
    add('intervals', ['intervals', 'Intervaly', 'Interval', 'Intervalový trénink']);
    add('test5k', ['test5k', 'Test 5 km', 'Test 5km', 'Test na 5 km', '5 km test', '5k test']);
    add('race', ['race', 'Závod', 'Závody']);
    return map;
  })();
  /** Run type code from a code or a (legacy Czech / English) label; null when unknown. */
  function typeCode(value) {
    if (RUN_TYPES.indexOf(value) >= 0) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const code = TYPE_ALIASES[foldLabel(value)];
    return code === undefined ? null : code;
  }

  function cleanStravaId(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : null;
  }
  function stravaIdOf(run) {
    const direct = cleanStravaId(run.stravaActivityId);
    if (direct !== null) return direct;
    if (typeof run.id === 'string' && /^strava-./.test(run.id.trim())) return cleanStravaId(run.id.trim().slice(7));
    if (run.source === 'strava') {
      const id = cleanStravaId(run.id);
      if (id !== null && /^\d+$/.test(id)) return id;
    }
    return null;
  }

  /** An Apple Health workout id (HKWorkout UUID, upper case like Swift's uuidString) or null. */
  function cleanHealthId(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim().toUpperCase();
    return HEALTH_ID_RE.test(text) ? text : null;
  }
  /** run.healthId, or the id of a 'health-<uuid>' run from Apple Health; null otherwise. */
  function healthIdOf(run) {
    const direct = cleanHealthId(run.healthId);
    if (direct !== null) return direct;
    if (run.source === 'health' && typeof run.id === 'string' && /^health-./.test(run.id.trim())) return cleanHealthId(run.id.trim().slice(7));
    return null;
  }

  // Run ids are used as object keys (VeyvoRuns.runNotes, UI lookups): never an Object.prototype name.
  const RESERVED_IDS = new Set(Object.getOwnPropertyNames(Object.prototype).concat(['__proto__', 'prototype']));
  function cleanId(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return 'm-' + String(value);
    if (typeof value !== 'string') return null;
    const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!text || text.length > 120) return null;
    return /^\d+$/.test(text) || RESERVED_IDS.has(text) ? 'm-' + text : text;
  }
  function idHint(value) {
    return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? String(value) : null;
  }

  function textOrNull(value, max) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text ? truncate(text, max) : null;
  }
  function isoOrNull(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 8.64e15) return new Date(value).toISOString();
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(text) && isDateKey(text.slice(0, 10)) ? text : null;
  }
  function cleanName(value) {
    return value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  }
  function languageOf(value) {
    return typeof value === 'string' && /^en\b/i.test(value.trim()) ? 'en' : 'cs';
  }

  function copyExtras(target, source, known) {
    for (const k of Object.keys(source)) {
      if (!safeKey(k) || known.indexOf(k) >= 0 || hasOwn(target, k)) continue;
      const value = cloneJson(source[k]);
      if (value !== undefined) target[k] = value;
    }
    return target;
  }

  function warn(warnings, code, details) {
    if (warnings) warnings.push(Object.assign({ code: code }, details || {}));
  }

  // ---------------------------------------------------------------- defaults

  function DEFAULT_STATE() {
    return {
      schemaVersion: SCHEMA_VERSION,
      profile: { name: '', goalDistanceKm: DEFAULT_GOAL_KM, targetSeconds: DEFAULT_TARGET_SECONDS, days: DEFAULT_DAYS.slice(), onboarded: false },
      runHistory: [],
      recoveryLogs: [],
      legacyMilestones: [],
      ignoredStravaIds: [],
      ignoredHealthIds: [],
      plannedWorkouts: [],
      exportLog: [],
      theme: 'dark',
      language: 'cs',
      strava: { connected: false, lastSync: null, lastError: null },
      intervals: { enabled: false, lastPush: null, lastError: null },
      health: { enabled: false, lastImport: null, lastError: null },
      ui: { lastSeenVersion: null }
    };
  }

  // ---------------------------------------------------------------- runs

  function compareRuns(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const sa = a.startTime || '', sb = b.startTime || '';
    return sa === sb ? 0 : sa < sb ? -1 : 1;
  }
  /** Chronological (date, then start time; stable for equal keys). */
  function sortRuns(runs) {
    return runs.map((run, i) => ({ run, i })).sort((x, y) => compareRuns(x.run, y.run) || x.i - y.i).map(e => e.run);
  }

  /**
   * One stored run -> canonical v2 Run, or null (reported as 'run-dropped'). Accepts legacy
   * records (Czech type labels, 'time' strings, ISO dates with time, numeric ids) and v2 records.
   * Unknown per-run fields are kept (forward compatibility); legacy 'time'/'effortRecorded' go.
   */
  function normalizeRun(raw, ctx) {
    const warnings = ctx && ctx.warnings;
    const where = { list: (ctx && ctx.list) || 'runHistory', index: ctx && Number.isInteger(ctx.index) ? ctx.index : -1 };
    if (!isPlainObject(raw)) {
      const record = cloneJson(raw);
      warn(warnings, 'run-dropped', Object.assign({}, where, { id: null, reason: 'not-object', record: record === undefined ? null : record }));
      return null;
    }
    const drop = reason => {
      warn(warnings, 'run-dropped', Object.assign({}, where, { id: idHint(raw.id), reason, record: cloneJson(raw) }));
      return null;
    };
    const dateText = typeof raw.date === 'string' ? raw.date.trim() : '';
    const date = dateText.slice(0, 10);
    if (!isDateKey(date)) return drop('date-invalid');
    const distance = roundTo(toNumber(raw.distance), 3);
    if (!(distance > 0 && distance <= LIMITS.maxDistanceKm)) return drop('distance-invalid');
    let movingSeconds = durationFrom(raw.movingSeconds);
    if (movingSeconds === null) movingSeconds = clockDurationFrom(raw.time);
    if (movingSeconds === null) return drop('duration-invalid');

    const stravaId = stravaIdOf(raw);
    // Apple Health: source 'health' with the HKWorkout UUID as healthId and the id 'health-<uuid>'. A
    // manual or Strava run that absorbed its Health copy keeps its own source and gains the healthId.
    const healthId = healthIdOf(raw);
    const source = stravaId !== null || raw.source === 'strava' ? 'strava' : healthId !== null && raw.source === 'health' ? 'health' : 'manual';
    // 0.3.4 shared-chat import: source 'chatgpt', date + 'T12:00:00' (a made-up noon, not a start time).
    const fromChat = stravaId === null && (raw.source === 'chatgpt' || (typeof raw.id === 'string' && /^chatgpt-/.test(raw.id.trim())));
    const id = stravaId !== null ? 'strava-' + stravaId
      : source === 'health' ? 'health-' + healthId
      : cleanId(raw.id) || 'm-' + date.replace(/-/g, '') + '-' + Math.round(distance * 1000) + '-' + movingSeconds;
    const fieldInvalid = (field, value) => warn(warnings, 'run-field-invalid', Object.assign({}, where, { id, field, value: cloneJson(value) === undefined ? null : cloneJson(value) }));
    if ((filled(raw.healthId) && cleanHealthId(raw.healthId) === null) || (raw.source === 'health' && healthId === null)) fieldInvalid('healthId', raw.healthId);

    let startTime = null;
    if (filled(raw.startTime)) {
      startTime = normalizeClock(raw.startTime);
      if (startTime === null) fieldInvalid('startTime', raw.startTime);
    } else if (dateText.length >= 16 && (dateText[10] === 'T' || dateText[10] === ' ')) {
      const clock = /^\d{2}:\d{2}$/.test(dateText.slice(11, 16)) ? normalizeClock(dateText.slice(11, 16)) : null;
      // Legacy manual runs were stored as 'YYYY-MM-DDT00:00:00': midnight means "no time".
      if (clock !== null && !(source === 'manual' && clock === '00:00') && !(fromChat && clock === '12:00')) startTime = clock;
    }

    let type = 'run';
    if (filled(raw.type)) {
      const code = typeCode(raw.type);
      if (code !== null) type = code;
      else warn(warnings, 'run-type-unknown', Object.assign({}, where, { id, value: cloneJson(raw.type) === undefined ? null : cloneJson(raw.type) }));
    }

    let effort = null;
    if (filled(raw.effort)) {
      const n = toNumber(raw.effort);
      if (n >= 1 && n <= 10) effort = Math.round(n);
      else fieldInvalid('effort', raw.effort);
    }

    let note = '';
    if (typeof raw.note === 'string') {
      note = truncate(raw.note, LIMITS.maxNote);
      if (note !== raw.note) warn(warnings, 'run-note-truncated', Object.assign({}, where, { id, length: charLength(raw.note) }));
    } else if (typeof raw.note === 'number' && Number.isFinite(raw.note)) note = String(raw.note);
    else if (raw.note !== undefined && raw.note !== null) fieldInvalid('note', raw.note);

    const name = typeof raw.name === 'string' ? truncate(raw.name.trim(), LIMITS.maxRunName) : '';
    let averageHeartrate = null;
    if (filled(raw.averageHeartrate)) {
      const n = toNumber(raw.averageHeartrate);
      if (n > 0 && n <= 300) averageHeartrate = n; else fieldInvalid('averageHeartrate', raw.averageHeartrate);
    }
    let elevationGain = null;
    if (filled(raw.elevationGain)) {
      const n = toNumber(raw.elevationGain);
      if (n >= 0 && n <= 20000) elevationGain = n; else fieldInvalid('elevationGain', raw.elevationGain);
    }

    let stravaMovingSeconds = null;
    if (filled(raw.stravaMovingSeconds)) {
      stravaMovingSeconds = durationFrom(raw.stravaMovingSeconds);
      if (stravaMovingSeconds === null) fieldInvalid('stravaMovingSeconds', raw.stravaMovingSeconds);
    }
    let maxHeartrate = null;
    if (filled(raw.maxHeartrate)) {
      const n = toNumber(raw.maxHeartrate);
      if (n > 0 && n <= 300) maxHeartrate = n; else fieldInvalid('maxHeartrate', raw.maxHeartrate);
    }
    // The app that wrote the run into Apple Health ('Garmin Connect', 'Strava', 'Cvičení').
    let sourceName = '';
    if (typeof raw.sourceName === 'string') sourceName = truncate(cleanName(raw.sourceName), HEALTH.maxSourceName);
    else if (filled(raw.sourceName)) fieldInvalid('sourceName', raw.sourceName);

    const run = { id, source, date, startTime, type, distance, movingSeconds, effort, note };
    if (fromChat) run.importedFrom = 'chatgpt';
    if (name) run.name = name;
    if (stravaId !== null) run.stravaActivityId = stravaId;
    if (stravaMovingSeconds !== null) run.stravaMovingSeconds = stravaMovingSeconds;
    if (healthId !== null) run.healthId = healthId;
    if (source === 'strava' || source === 'health' || averageHeartrate !== null) run.averageHeartrate = averageHeartrate;
    if (maxHeartrate !== null) run.maxHeartrate = maxHeartrate;
    if (source === 'strava' || elevationGain !== null) run.elevationGain = elevationGain;
    if (sourceName) run.sourceName = sourceName;
    return copyExtras(run, raw, RUN_KEYS.concat(LEGACY_RUN_KEYS));
  }

  function sameContent(a, b) {
    return a.date === b.date && a.distance === b.distance && a.movingSeconds === b.movingSeconds;
  }

  /** Normalizes a run list: drops invalid runs, removes repeated records, keeps ids unique, sorts. */
  function normalizeRunList(list, warnings, listName) {
    const name = listName || 'runHistory';
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) { warn(warnings, 'list-invalid', { field: name }); return []; }
    const items = [];
    list.forEach((raw, index) => {
      const run = normalizeRun(raw, { index, list: name, warnings });
      if (run) items.push({ run, index });
    });
    const reserved = new Set(items.map(e => e.run.id));
    const seen = new Map();
    const kept = [];
    for (const item of items) {
      const previous = seen.get(item.run.id);
      if (previous) {
        if ((previous.stravaActivityId && previous.stravaActivityId === item.run.stravaActivityId) ||
          (previous.healthId && previous.healthId === item.run.healthId) || sameContent(previous, item.run)) {
          warn(warnings, 'run-duplicate-dropped', { list: name, index: item.index, id: item.run.id, record: item.run });
          continue;
        }
        let n = 2, next;
        do { next = item.run.id + '-' + n++; } while (reserved.has(next));
        reserved.add(next);
        warn(warnings, 'run-id-changed', { list: name, index: item.index, from: item.run.id, to: next });
        item.run = Object.assign({}, item.run, { id: next });
      }
      seen.set(item.run.id, item.run);
      kept.push(item);
    }
    kept.sort((a, b) => compareRuns(a.run, b.run) || a.index - b.index);
    return kept.map(e => e.run);
  }

  function runFacts(run) {
    if (!isPlainObject(run)) return null;
    const date = typeof run.date === 'string' ? run.date.trim().slice(0, 10) : '';
    const distance = toNumber(run.distance);
    let seconds = durationFrom(run.movingSeconds);
    if (seconds === null) seconds = clockDurationFrom(run.time);
    if (!isDateKey(date) || !(distance > 0) || seconds === null) return null;
    const stravaId = stravaIdOf(run);
    const healthId = healthIdOf(run);
    const startTime = filled(run.startTime) ? normalizeClock(run.startTime) : null;
    return { date, distance, seconds, stravaId, healthId, startTime };
  }

  /**
   * True when a and b look like the same activity: same date, |delta km| < 0.15, |delta s| < 90,
   * not two different Strava activities, and start times (when both known) under 2 h apart.
   * Two different Apple Health workouts are one run only when both start times are known and at
   * most HEALTH.twinStartMinutes apart (two apps wrote the same run into Health).
   * Unlike VeyvoRuns.findDuplicate the sources may be equal (same run logged on two devices).
   */
  function isDuplicateRun(a, b) {
    const x = runFacts(a), y = runFacts(b);
    if (!x || !y || x.date !== y.date) return false;
    if (x.stravaId !== null && y.stravaId !== null && x.stravaId !== y.stravaId) return false;
    if (x.healthId !== null && y.healthId !== null && x.healthId !== y.healthId &&
      !(x.startTime && y.startTime && Math.abs(clockMinutes(x.startTime) - clockMinutes(y.startTime)) <= HEALTH.twinStartMinutes)) return false;
    if (!(roundTo(Math.abs(x.distance - y.distance), 6) < DUPLICATE.km)) return false;
    if (!(Math.abs(x.seconds - y.seconds) < DUPLICATE.seconds)) return false;
    if (x.startTime && y.startTime && Math.abs(clockMinutes(x.startTime) - clockMinutes(y.startTime)) >= DUPLICATE.startMinutes) return false;
    return true;
  }

  /**
   * One record from two copies of the same activity (inputs normalized). Manual + Strava: the
   * Strava copy gives id, activity id, name, heart rate, elevation and start time; the manual copy
   * gives date, type, distance, moving time, effort and note (owner decision 2026-11-27: the time
   * typed by hand is authoritative). Strava's own moving time is kept as stravaMovingSeconds.
   * Apple Health copy + a manual or Strava record: the record stays as it is (id, source, date, type,
   * distance, moving time, effort, note, name) and Health only fills its blanks (HEALTH_FILLS: start
   * time, heart rate, elevation, the writing app and the Health workout id).
   * Same source: existing wins and only fills its blanks from incoming.
   */
  const HEALTH_FILLS = ['startTime', 'averageHeartrate', 'maxHeartrate', 'elevationGain', 'sourceName', 'healthId'];
  function combineRuns(existing, incoming) {
    if ((existing.source === 'health') !== (incoming.source === 'health')) {
      const record = existing.source === 'health' ? incoming : existing, health = existing.source === 'health' ? existing : incoming;
      const kept = Object.assign({}, health, record);
      for (const k of HEALTH_FILLS) if (blank(record[k]) && filled(health[k])) kept[k] = health[k];
      kept.id = record.id;
      kept.source = record.source;
      return normalizeRun(kept, { index: -1, warnings: null }) || existing;
    }
    const merged = Object.assign({}, incoming, existing);
    const existingStrava = existing.source === 'strava', incomingStrava = incoming.source === 'strava';
    if (existingStrava !== incomingStrava) {
      const manual = existingStrava ? incoming : existing, strava = existingStrava ? existing : incoming;
      merged.id = strava.id;
      merged.source = 'strava';
      if (strava.stravaActivityId) merged.stravaActivityId = strava.stravaActivityId;
      merged.name = filled(strava.name) ? strava.name : manual.name;
      merged.averageHeartrate = filled(strava.averageHeartrate) ? strava.averageHeartrate : (filled(manual.averageHeartrate) ? manual.averageHeartrate : null);
      merged.elevationGain = filled(strava.elevationGain) ? strava.elevationGain : (filled(manual.elevationGain) ? manual.elevationGain : null);
      merged.movingSeconds = manual.movingSeconds;
      merged.stravaMovingSeconds = filled(strava.stravaMovingSeconds) ? strava.stravaMovingSeconds : strava.movingSeconds;
      merged.startTime = strava.startTime || manual.startTime || null;
      merged.date = manual.date;
      merged.distance = manual.distance;
      merged.type = manual.type;
      merged.effort = filled(manual.effort) ? manual.effort : (filled(strava.effort) ? strava.effort : null);
      merged.note = manual.note || strava.note || '';
    } else {
      for (const k of ['startTime', 'effort', 'name', 'stravaMovingSeconds', 'averageHeartrate', 'elevationGain', 'maxHeartrate', 'sourceName', 'healthId']) {
        if (blank(existing[k]) && filled(incoming[k])) merged[k] = incoming[k];
      }
      if (!existing.note && incoming.note) merged.note = incoming.note;
    }
    if (blank(merged.name)) delete merged.name;
    return normalizeRun(merged, { index: -1, warnings: null }) || existing;
  }

  /**
   * mergeRuns(existing, incoming) -> { runs, added, updated, unchanged, invalid, warnings }.
   * An incoming run matches an existing one by id, then by Strava activity id, then by Apple Health
   * workout id, then by the duplicate rule (closest existing run that is not matched yet). Matches
   * are combined (combineRuns), everything else is added. Neither input is mutated; runs are sorted.
   */
  function mergeRuns(existing, incoming) {
    const warnings = [];
    const runs = normalizeRunList(existing, warnings, 'existing');
    const before = warnings.length;
    const extra = normalizeRunList(incoming, warnings, 'incoming');
    const invalid = warnings.slice(before).filter(w => w.code === 'run-dropped').length;
    const baseCount = runs.length;
    const byId = new Map(), byStrava = new Map(), byHealth = new Map(), matched = new Set();
    runs.forEach((run, i) => {
      byId.set(run.id, i);
      if (run.stravaActivityId) byStrava.set(run.stravaActivityId, i);
      if (run.healthId) byHealth.set(run.healthId, i);
    });
    let added = 0, updated = 0, unchanged = 0;
    for (const run of extra) {
      let at = byId.get(run.id);
      if (at === undefined && run.stravaActivityId) at = byStrava.get(run.stravaActivityId);
      if (at === undefined && run.healthId) at = byHealth.get(run.healthId);
      if (at === undefined) {
        let bestScore = Infinity;
        for (let i = 0; i < baseCount; i++) {
          if (matched.has(i) || !isDuplicateRun(runs[i], run)) continue;
          const score = Math.abs(runs[i].distance - run.distance) / DUPLICATE.km + Math.abs(runs[i].movingSeconds - run.movingSeconds) / DUPLICATE.seconds;
          if (score < bestScore) { bestScore = score; at = i; }
        }
      }
      if (at === undefined) {
        byId.set(run.id, runs.length);
        if (run.stravaActivityId) byStrava.set(run.stravaActivityId, runs.length);
        if (run.healthId) byHealth.set(run.healthId, runs.length);
        runs.push(run);
        added++;
        continue;
      }
      matched.add(at);
      const current = runs[at];
      const merged = combineRuns(current, run);
      if (deepEqual(current, merged)) { unchanged++; continue; }
      if (merged.id !== current.id) { byId.delete(current.id); byId.set(merged.id, at); }
      if (merged.stravaActivityId) byStrava.set(merged.stravaActivityId, at);
      if (merged.healthId) byHealth.set(merged.healthId, at);
      runs[at] = merged;
      updated++;
    }
    return { runs: sortRuns(runs), added, updated, unchanged, invalid, warnings };
  }

  /**
   * Legacy migration only: a manual run and a Strava run that are the same activity (isDuplicateRun)
   * become one record via combineRuns (Strava id, name, HR, elevation and start time; manual date,
   * type, distance, moving time, effort and note; Strava's time kept as stravaMovingSeconds). 0.3.x deduplicated only when Strava synced after
   * the manual entry, with |delta s| < 60 and dates read through new Date() (a late-evening Strava run
   * with its fake 'Z' landed on the next day), so such twins exist in real data and would count twice
   * in every total. Each Strava run takes the closest unmatched manual twin; two manual runs or two
   * Strava runs are never merged here. Every merge is reported ('run-twins-merged', both originals).
   */
  function mergeLegacyTwins(runs, warnings) {
    const manual = [], strava = [];
    runs.forEach((run, i) => (run.source === 'strava' ? strava : manual).push(i));
    if (!manual.length || !strava.length) return runs;
    const used = new Set(), merged = new Map();
    for (const si of strava) {
      let best = -1, bestScore = Infinity;
      for (const mi of manual) {
        if (used.has(mi) || !isDuplicateRun(runs[mi], runs[si])) continue;
        const score = Math.abs(runs[mi].distance - runs[si].distance) / DUPLICATE.km + Math.abs(runs[mi].movingSeconds - runs[si].movingSeconds) / DUPLICATE.seconds;
        if (score < bestScore) { bestScore = score; best = mi; }
      }
      if (best < 0) continue;
      used.add(best);
      const run = combineRuns(runs[best], runs[si]);
      merged.set(si, run);
      warn(warnings, 'run-twins-merged', { id: run.id, manualId: runs[best].id, stravaId: runs[si].id, manual: runs[best], strava: runs[si] });
    }
    if (!used.size) return runs;
    return sortRuns(runs.map((run, i) => merged.get(i) || run).filter((run, i) => !used.has(i)));
  }

  /** Strava activity ids present in runHistory (replaces the legacy stravaActivityIds list). */
  function stravaActivityIds(state) {
    const runs = isPlainObject(state) && Array.isArray(state.runHistory) ? state.runHistory : [];
    const ids = [];
    for (const run of runs) {
      if (!isPlainObject(run)) continue;
      const id = stravaIdOf(run);
      if (id !== null && ids.indexOf(id) < 0) ids.push(id);
    }
    return ids;
  }

  // ---------------------------------------------------------------- recovery, milestones

  function normalizeRecovery(raw, index, warnings) {
    if (!isPlainObject(raw)) {
      const record = cloneJson(raw);
      warn(warnings, 'recovery-dropped', { index, reason: 'not-object', record: record === undefined ? null : record });
      return null;
    }
    const date = typeof raw.date === 'string' ? raw.date.trim().slice(0, 10) : '';
    if (!isDateKey(date)) { warn(warnings, 'recovery-dropped', { index, reason: 'date-invalid', record: cloneJson(raw) }); return null; }
    const metric = (field, min, max, digits) => {
      const value = raw[field];
      if (blank(value)) return null;
      const n = toNumber(value);
      if (n >= min && n <= max) return roundTo(n, digits);
      warn(warnings, 'recovery-field-invalid', { index, date, field, value: cloneJson(value) === undefined ? null : cloneJson(value) });
      return null;
    };
    const sleepHours = metric('sleepHours', 0, LIMITS.maxSleepHours, 2);
    const fatigue = metric('fatigue', 1, 10, 0);
    const soreness = metric('soreness', 0, 10, 0);
    let note = typeof raw.note === 'string' ? truncate(raw.note, LIMITS.maxNote) : '';
    if (typeof raw.note === 'string' && note !== raw.note) warn(warnings, 'recovery-note-truncated', { index, date });
    if (sleepHours === null && fatigue === null && soreness === null && !note.trim()) {
      warn(warnings, 'recovery-dropped', { index, reason: 'empty', record: cloneJson(raw) });
      return null;
    }
    return copyExtras({ date, sleepHours, fatigue, soreness, note }, raw, RECOVERY_KEYS);
  }

  /** One log per date (the later entry wins), sorted by date. */
  function normalizeRecoveryList(list, warnings) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) { warn(warnings, 'list-invalid', { field: 'recoveryLogs' }); return []; }
    const byDate = new Map();
    list.forEach((raw, index) => {
      const log = normalizeRecovery(raw, index, warnings);
      if (!log) return;
      if (byDate.has(log.date)) warn(warnings, 'recovery-duplicate-date', { index, date: log.date, replaced: byDate.get(log.date) });
      byDate.set(log.date, log);
    });
    return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function normalizeMilestones(list, warnings) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) { warn(warnings, 'list-invalid', { field: 'legacyMilestones' }); return []; }
    const out = [];
    list.forEach((raw, index) => {
      const date = isPlainObject(raw) && typeof raw.date === 'string' ? raw.date.trim().slice(0, 10) : '';
      const label = isPlainObject(raw) && typeof raw.label === 'string' ? truncate(raw.label.trim(), LIMITS.maxLabel) : '';
      if (!isDateKey(date) || !label) {
        const record = cloneJson(raw);
        warn(warnings, 'milestone-dropped', { index, reason: isDateKey(date) ? 'label-invalid' : 'date-invalid', record: record === undefined ? null : record });
        return;
      }
      out.push({ date, label });
    });
    return out;
  }

  // ---------------------------------------------------------------- ignored Strava / Health ids, planned sessions, export log

  /**
   * Deduplicated ids from a list (newest `max` kept); invalid entries reported. `field` names the
   * list in the warnings of every list but ignoredStravaIds (whose warnings predate the Health list).
   */
  function normalizeIdList(list, warnings, field, clean, max) {
    const tag = field === 'ignoredStravaIds' ? {} : { field };
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) { warn(warnings, 'list-invalid', { field }); return []; }
    // Linear time (a crafted backup can hold huge lists): a Set for the dedupe, and only the newest
    // 2 * max entries of an oversized list are looked at.
    const start = Math.max(0, list.length - max * 2);
    if (start > 0) warn(warnings, 'ignored-ids-truncated', Object.assign({ count: start }, tag));
    const seen = new Set();
    const out = [];
    for (let index = start; index < list.length; index++) {
      const item = list[index];
      const id = clean(item);
      if (id === null) { warn(warnings, 'ignored-id-dropped', Object.assign({ index, value: cloneJson(item) === undefined ? null : cloneJson(item) }, tag)); continue; }
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out.length > max ? out.slice(out.length - max) : out;
  }

  /** Deduplicated Strava activity ids the runner deleted; invalid entries reported. */
  function normalizeIgnoredIds(list, warnings) {
    return normalizeIdList(list, warnings, 'ignoredStravaIds', cleanStravaId, MAX_IGNORED_STRAVA);
  }

  /** Deduplicated Apple Health workout ids (upper-case UUIDs) the runner deleted; invalid entries reported. */
  function normalizeIgnoredHealthIds(list, warnings) {
    return normalizeIdList(list, warnings, 'ignoredHealthIds', cleanHealthId, HEALTH.maxIgnored);
  }

  function cleanTemplateId(value) {
    return typeof value === 'string' && TEMPLATE_ID.test(value.trim()) ? value.trim() : null;
  }

  /** One planned library session per date (the later entry wins), sorted by date. */
  function normalizePlanned(list, warnings) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) { warn(warnings, 'list-invalid', { field: 'plannedWorkouts' }); return []; }
    const byDate = new Map();
    list.forEach((raw, index) => {
      const date = isPlainObject(raw) && typeof raw.date === 'string' ? raw.date.trim().slice(0, 10) : '';
      const templateId = isPlainObject(raw) ? cleanTemplateId(raw.templateId) : null;
      if (!isDateKey(date) || templateId === null) {
        const record = cloneJson(raw);
        warn(warnings, 'planned-dropped', { index, reason: isDateKey(date) ? 'template-invalid' : 'date-invalid', record: record === undefined ? null : record });
        return;
      }
      if (byDate.has(date)) warn(warnings, 'planned-duplicate-date', { index, date, replaced: byDate.get(date) });
      byDate.set(date, copyExtras({ date, templateId }, raw, PLANNED_KEYS));
    });
    return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function exportEntry(raw) {
    if (!isPlainObject(raw)) return null;
    const at = isoOrNull(raw.at);
    const workoutId = textOrNull(raw.workoutId, 100);
    const format = typeof raw.format === 'string' && EXPORT_FORMAT.test(raw.format.trim()) ? raw.format.trim() : null;
    return at && workoutId && format ? { at, workoutId, format } : null;
  }

  /** Valid export records, oldest first, at most EXPORT_LOG_MAX (the newest are kept). */
  function normalizeExportLog(list, warnings) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) { warn(warnings, 'list-invalid', { field: 'exportLog' }); return []; }
    const out = [];
    list.forEach((raw, index) => {
      const entry = exportEntry(raw);
      if (entry) out.push(entry);
      else {
        const record = cloneJson(raw);
        warn(warnings, 'export-log-dropped', { index, record: record === undefined ? null : record });
      }
    });
    return out.length > EXPORT_LOG_MAX ? out.slice(out.length - EXPORT_LOG_MAX) : out;
  }

  // ---------------------------------------------------------------- profile and settings

  function daysFrom(value) {
    if (!Array.isArray(value)) return null;
    const days = [];
    for (const item of value) {
      const n = typeof item === 'number' ? item : toNumber(item);
      if (!Number.isInteger(n) || n < 0 || n > 6) return null;
      if (days.indexOf(n) < 0) days.push(n);
    }
    return days.length >= 1 && days.length <= 7 ? days.sort((a, b) => a - b) : null;
  }

  function targetFrom(value) {
    const seconds = typeof value === 'string' && value.indexOf(':') >= 0 ? parseClockDuration(value) : toNumber(value);
    if (seconds === null || !Number.isFinite(seconds)) return null;
    const rounded = Math.round(seconds);
    return rounded >= LIMITS.minTargetSeconds && rounded <= LIMITS.maxTargetSeconds ? rounded : null;
  }

  function normalizeProfile(raw, warnings, hasData) {
    const p = isPlainObject(raw) ? raw : {};
    if (raw !== undefined && raw !== null && !isPlainObject(raw)) warn(warnings, 'profile-field-invalid', { field: 'profile', value: cloneJson(raw) === undefined ? null : cloneJson(raw) });
    const invalid = field => warn(warnings, 'profile-field-invalid', { field, value: cloneJson(p[field]) === undefined ? null : cloneJson(p[field]) });

    let name = '';
    if (typeof p.name === 'string') {
      name = truncate(cleanName(p.name), LIMITS.maxProfileName);
      if (name !== p.name.trim()) warn(warnings, 'profile-name-changed', { from: p.name, to: name });
    } else if (p.name !== undefined && p.name !== null) invalid('name');

    let goalDistanceKm = DEFAULT_GOAL_KM;
    if (p.goalDistanceKm !== undefined) {
      const n = toNumber(p.goalDistanceKm);
      if (n >= LIMITS.minGoalKm && n <= LIMITS.maxGoalKm) goalDistanceKm = roundTo(n, 3); else invalid('goalDistanceKm');
    }

    let targetSeconds;
    if (p.targetSeconds === undefined) targetSeconds = goalDistanceKm === DEFAULT_GOAL_KM ? DEFAULT_TARGET_SECONDS : null;
    else if (p.targetSeconds === null || p.targetSeconds === '') targetSeconds = null;
    else {
      targetSeconds = targetFrom(p.targetSeconds);
      if (targetSeconds === null) invalid('targetSeconds');
    }

    let days = DEFAULT_DAYS.slice();
    if (p.days !== undefined) {
      const parsed = daysFrom(p.days);
      if (parsed) days = parsed; else invalid('days');
    }

    const onboarded = typeof p.onboarded === 'boolean' ? p.onboarded : !!hasData;
    return { name, goalDistanceKm, targetSeconds, days, onboarded };
  }

  function normalizeStrava(raw) {
    const s = isPlainObject(raw.strava) ? raw.strava : null;
    if (s) return { connected: s.connected === true, lastSync: isoOrNull(s.lastSync), lastError: textOrNull(s.lastError, 500) };
    return { connected: raw.stravaConnected === true, lastSync: isoOrNull(raw.stravaLastSync), lastError: null };
  }

  function normalizeIntervals(raw) {
    const i = isPlainObject(raw) ? raw : {};
    return { enabled: i.enabled === true, lastPush: isoOrNull(i.lastPush), lastError: textOrNull(i.lastError, 500) };
  }

  /**
   * Apple Health import (iOS): enabled once the runner imported (the app then imports new runs on
   * start and when it comes back to the foreground), lastImport = when the last import finished.
   */
  function normalizeHealth(raw) {
    const hh = isPlainObject(raw) ? raw : {};
    return { enabled: hh.enabled === true, lastImport: isoOrNull(hh.lastImport), lastError: textOrNull(hh.lastError, 500) };
  }

  /** ui keeps lastSeenVersion plus any other primitive per-device preferences. */
  function normalizeUi(raw) {
    const u = isPlainObject(raw) ? raw : {};
    const ui = { lastSeenVersion: textOrNull(u.lastSeenVersion, 40) };
    for (const k of Object.keys(u)) {
      if (!safeKey(k) || k === 'lastSeenVersion') continue;
      const v = u[k];
      if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) ui[k] = v;
    }
    return ui;
  }

  // ---------------------------------------------------------------- migration

  /**
   * migrateWithReport(raw) -> { state, warnings, fromVersion, failed }.
   * fromVersion: 1 for legacy (no schemaVersion), the stored version otherwise, null for
   * nothing/junk. Unknown top-level keys are dropped ('state-key-dropped'). Legacy (pre-v2) data
   * also gets its manual/Strava twins merged (mergeLegacyTwins, 'run-twins-merged'). Never throws.
   */
  function migrateWithReport(raw) {
    const warnings = [];
    try {
      if (raw === undefined || raw === null) return { state: DEFAULT_STATE(), warnings, fromVersion: null, failed: false };
      if (!isPlainObject(raw)) {
        warn(warnings, 'state-not-object', { valueType: Array.isArray(raw) ? 'array' : typeof raw });
        return { state: DEFAULT_STATE(), warnings, fromVersion: null, failed: false };
      }
      const version = toNumber(raw.schemaVersion);
      const fromVersion = Number.isInteger(version) && version >= 1 ? version : 1;
      if (fromVersion > SCHEMA_VERSION) warn(warnings, 'schema-newer', { version: fromVersion });
      for (const key of Object.keys(raw)) {
        if (V2_KEYS.indexOf(key) < 0 && LEGACY_KEYS.indexOf(key) < 0) warn(warnings, 'state-key-dropped', { key });
      }
      const runList = normalizeRunList(raw.runHistory, warnings, 'runHistory');
      const runHistory = fromVersion < SCHEMA_VERSION ? mergeLegacyTwins(runList, warnings) : runList;
      const recoveryLogs = normalizeRecoveryList(raw.recoveryLogs, warnings);
      const legacyMilestones = normalizeMilestones(raw.legacyMilestones !== undefined ? raw.legacyMilestones : raw.milestones, warnings);
      const strava = normalizeStrava(raw);
      const hasData = (Array.isArray(raw.runHistory) && raw.runHistory.length > 0) || recoveryLogs.length > 0 || legacyMilestones.length > 0 || strava.connected;
      const profile = normalizeProfile(raw.profile, warnings, hasData);

      // 0.3 kept the ids of runs it had wiped ("Smazat místní běhy") in stravaActivityIds, so a sync
      // never brought them back. Those orphaned ids become ignoredStravaIds (Settings can restore them).
      let orphaned = [];
      if (Array.isArray(raw.stravaActivityIds)) {
        const present = new Set(runHistory.map(run => run.stravaActivityId).filter(Boolean));
        const seen = new Set();
        for (const item of raw.stravaActivityIds.slice(-MAX_IGNORED_STRAVA * 2)) {
          const id = cleanStravaId(item);
          if (id !== null && !present.has(id) && !seen.has(id)) { seen.add(id); orphaned.push(id); }
        }
        if (orphaned.length) warn(warnings, 'strava-ids-orphaned', { count: orphaned.length, ids: orphaned });
        if (fromVersion >= SCHEMA_VERSION) orphaned = [];
      }
      const ignoredList = normalizeIgnoredIds(raw.ignoredStravaIds, warnings);

      const state = {
        schemaVersion: SCHEMA_VERSION,
        profile,
        runHistory,
        recoveryLogs,
        legacyMilestones,
        ignoredStravaIds: orphaned.length ? normalizeIgnoredIds(ignoredList.concat(orphaned), null) : ignoredList,
        ignoredHealthIds: normalizeIgnoredHealthIds(raw.ignoredHealthIds, warnings),
        plannedWorkouts: normalizePlanned(raw.plannedWorkouts, warnings),
        exportLog: normalizeExportLog(raw.exportLog, warnings),
        theme: raw.theme === 'light' ? 'light' : 'dark',
        language: languageOf(raw.language),
        strava,
        intervals: normalizeIntervals(raw.intervals),
        health: normalizeHealth(raw.health),
        ui: normalizeUi(raw.ui)
      };
      return { state, warnings, fromVersion, failed: false };
    } catch (error) {
      warn(warnings, 'migrate-failed', { message: String((error && error.message) || error) });
      return { state: DEFAULT_STATE(), warnings, fromVersion: null, failed: true };
    }
  }

  /** migrate(raw) -> v2 state. Pure, idempotent (migrate(migrate(x)) deep-equals migrate(x)). */
  function migrate(raw) {
    return migrateWithReport(raw).state;
  }

  // ---------------------------------------------------------------- storage

  function stampOf(now) {
    if (typeof now === 'string') {
      const digits = now.replace(/\D/g, '');
      if (digits.length >= 8) return digits.slice(0, 14).padEnd(14, '0');
    }
    const date = now instanceof Date && Number.isFinite(now.getTime()) ? now
      : typeof now === 'number' && Number.isFinite(now) ? new Date(now) : new Date();
    const p = n => String(n).padStart(2, '0');
    return String(date.getFullYear()) + p(date.getMonth() + 1) + p(date.getDate()) + p(date.getHours()) + p(date.getMinutes()) + p(date.getSeconds());
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function storageHas(storage, key) {
    try { const v = storage.getItem(key); return v !== null && v !== undefined; } catch (e) { return false; }
  }

  function isQuotaError(error) {
    return !!error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014 || /quota/i.test(String(error.message)));
  }

  /**
   * load(storage, { now, key }) -> { state, warnings, recoveredFromCorruption, corruptKey,
   * backupKey, fromVersion, needsSave }.
   * - Nothing stored: defaults. Unreadable storage: defaults + 'storage-read-failed'.
   * - Unparseable or non-object JSON: the raw string is copied to
   *   'veyvo-state-corrupt-<YYYYMMDDHHmmss>' (digits of options.now; '-2', '-3' on collision)
   *   and defaults are returned with recoveredFromCorruption = true.
   * - A legacy (or newer) state is migrated; its raw string is first copied once to
   *   'veyvo-state-backup-v<version>' so the original data survives the next save.
   * Never throws. The caller decides when to save (needsSave hints that it should).
   */
  function load(storage, options) {
    const opts = isPlainObject(options) ? options : {};
    const key = typeof opts.key === 'string' && opts.key ? opts.key : STORAGE_KEY;
    const result = (state, extra) => Object.assign({
      state, warnings: [], recoveredFromCorruption: false, corruptKey: null, backupKey: null, fromVersion: null, needsSave: false
    }, extra);
    let raw;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      return result(DEFAULT_STATE(), { warnings: [{ code: 'storage-read-failed', message: String((error && error.message) || error) }] });
    }
    if (raw === null || raw === undefined) return result(DEFAULT_STATE());
    const text = typeof raw === 'string' ? raw : String(raw);

    const recover = (reason, extraWarnings) => {
      const warnings = [{ code: 'state-corrupt', reason }].concat(extraWarnings || []);
      const base = CORRUPT_KEY_PREFIX + stampOf(opts.now);
      let corruptKey = base;
      for (let n = 2; storageHas(storage, corruptKey) && n < 1000; n++) corruptKey = base + '-' + n;
      try {
        storage.setItem(corruptKey, text);
      } catch (error) {
        warnings.push({ code: 'corrupt-copy-failed', key: corruptKey, message: String((error && error.message) || error) });
        corruptKey = null;
      }
      return result(DEFAULT_STATE(), { warnings, recoveredFromCorruption: true, corruptKey, needsSave: corruptKey !== null });
    };

    let parsed;
    try { parsed = JSON.parse(stripBom(text)); } catch (error) { return recover('json-invalid'); }
    if (parsed === null) return result(DEFAULT_STATE());
    if (!isPlainObject(parsed)) return recover('not-object');
    const report = migrateWithReport(parsed);
    if (report.failed) return recover('migrate-failed', report.warnings);

    const warnings = report.warnings;
    let backupKey = null;
    if (report.fromVersion !== SCHEMA_VERSION) {
      const candidate = MIGRATION_BACKUP_PREFIX + report.fromVersion;
      if (storageHas(storage, candidate)) backupKey = candidate;
      else {
        try { storage.setItem(candidate, text); backupKey = candidate; } catch (error) {
          warnings.push({ code: 'migration-backup-failed', key: candidate, message: String((error && error.message) || error) });
        }
      }
    }
    const needsSave = report.fromVersion !== SCHEMA_VERSION || warnings.length > 0;
    return result(report.state, { warnings, backupKey, fromVersion: report.fromVersion, needsSave });
  }

  /** save(storage, state, { key }) -> { ok, error?, bytes? }. Writes JSON; never throws. */
  function save(storage, state, options) {
    const opts = isPlainObject(options) ? options : {};
    const key = typeof opts.key === 'string' && opts.key ? opts.key : STORAGE_KEY;
    if (!isPlainObject(state) || state.schemaVersion !== SCHEMA_VERSION) return { ok: false, error: 'state-invalid' };
    let json;
    try { json = JSON.stringify(state); } catch (error) { return { ok: false, error: 'serialize-failed' }; }
    try {
      storage.setItem(key, json);
      return { ok: true, bytes: json.length };
    } catch (error) {
      return { ok: false, error: isQuotaError(error) ? 'storage-full' : 'storage-write-failed' };
    }
  }

  // ---------------------------------------------------------------- backups

  function nutritionValue(raw) {
    let value = raw;
    if (typeof raw === 'string') {
      try { value = JSON.parse(stripBom(raw)); } catch (error) { return null; }
    }
    return isPlainObject(value) ? cloneJson(value) : null;
  }

  /**
   * exportBackup(state, nutritionRaw, { appVersion, exportedAt }) -> pretty JSON string
   * { app: 'VEYVO', kind: 'backup', schemaVersion: 2, appVersion, exportedAt, state, nutrition }.
   * state is normalized with migrate(); nutritionRaw is the 'veyvo-pre-run-v1' string (or object);
   * anything that is not a JSON object becomes null.
   */
  /**
   * legacyExtras(raw) -> { key: value } of the pre-0.4 top-level keys that migrate() drops (chatHistory,
   * weekReviews, weekPlans, aiPlans, ...), from the raw 'veyvo-state-backup-v1' string or object; null if none.
   */
  function legacyExtras(raw) {
    let value = raw;
    if (typeof raw === 'string') {
      try { value = JSON.parse(stripBom(raw)); } catch (error) { return null; }
    }
    if (!isPlainObject(value)) return null;
    const out = {};
    let any = false;
    for (const key of Object.keys(value)) {
      if (!safeKey(key) || V2_KEYS.indexOf(key) >= 0 || LEGACY_KEYS.indexOf(key) >= 0) continue;
      const copy = cloneJson(value[key]);
      if (copy === undefined) continue;
      out[key] = copy;
      any = true;
    }
    return any ? out : null;
  }

  function exportBackup(state, nutritionRaw, meta) {
    const m = isPlainObject(meta) ? meta : {};
    const exportedAt = m.exportedAt instanceof Date && Number.isFinite(m.exportedAt.getTime()) ? m.exportedAt.toISOString() : textOrNull(m.exportedAt, 64);
    const doc = {
      app: 'VEYVO',
      kind: 'backup',
      schemaVersion: SCHEMA_VERSION,
      appVersion: textOrNull(m.appVersion, 40),
      exportedAt,
      state: migrate(state),
      nutrition: nutritionValue(nutritionRaw)
    };
    // meta.legacy: the raw 0.3 state ('veyvo-state-backup-v1'); the keys 0.4 no longer reads travel along.
    const legacy = m.legacy === undefined || m.legacy === null ? null : legacyExtras(m.legacy);
    if (legacy) doc.legacy = legacy;
    return JSON.stringify(doc, null, 2);
  }

  /** 'veyvo-backup-2026-11-27-1015.json' from an ISO timestamp ('veyvo-backup-2026-11-27.json' from a date key). */
  function backupFileName(exportedAt) {
    const text = exportedAt instanceof Date && Number.isFinite(exportedAt.getTime()) ? exportedAt.toISOString() : String(exportedAt || '');
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text.trim());
    if (!m || !isDateKey(m[1])) return 'veyvo-backup.json';
    return 'veyvo-backup-' + m[1] + (m[2] ? '-' + m[2] + m[3] : '') + '.json';
  }

  /**
   * parseBackup(text) -> { ok: true, state, nutrition, warnings, appVersion, exportedAt, error: null }
   * or { ok: false, error } with error in: 'not-text', 'empty', 'too-large', 'json-invalid',
   * 'not-backup', 'wrong-app', 'wrong-kind', 'schema-invalid', 'schema-newer', 'state-invalid'.
   */
  function parseBackup(text) {
    const fail = error => ({ ok: false, state: null, nutrition: null, warnings: [], legacy: null, appVersion: null, exportedAt: null, error });
    if (typeof text !== 'string') return fail('not-text');
    if (text.length > LIMITS.maxBackupChars) return fail('too-large');
    const body = stripBom(text).trim();
    if (!body) return fail('empty');
    let doc;
    try { doc = JSON.parse(body); } catch (error) { return fail('json-invalid'); }
    if (!isPlainObject(doc)) return fail('not-backup');
    if (doc.app !== 'VEYVO') return fail('wrong-app');
    if (doc.kind !== 'backup') return fail('wrong-kind');
    if (!Number.isInteger(doc.schemaVersion) || doc.schemaVersion < 1) return fail('schema-invalid');
    if (doc.schemaVersion > SCHEMA_VERSION) return fail('schema-newer');
    if (!isPlainObject(doc.state)) return fail('state-invalid');
    const report = migrateWithReport(doc.state);
    if (report.failed) return fail('state-invalid');
    const warnings = report.warnings;
    let nutrition = null;
    if (isPlainObject(doc.nutrition)) nutrition = cloneJson(doc.nutrition);
    else if (doc.nutrition !== undefined && doc.nutrition !== null) warn(warnings, 'nutrition-dropped', {});
    return {
      ok: true, state: report.state, nutrition, warnings, legacy: legacyExtras(doc.legacy),
      appVersion: textOrNull(doc.appVersion, 40), exportedAt: textOrNull(doc.exportedAt, 64), error: null
    };
  }

  /**
   * applyBackup(current, parsed, { mode: 'replace' | 'merge' }) -> { ok, mode, state, nutrition, stats, warnings }.
   * replace: the backup state as is. merge: runs via mergeRuns, recovery logs and milestones
   * added where missing (current wins on the same date); profile, theme, language and
   * connections stay current unless the current profile is not onboarded yet.
   */
  function applyBackup(current, parsed, options) {
    const mode = isPlainObject(options) && options.mode === 'merge' ? 'merge' : 'replace';
    if (!parsed || parsed.ok !== true || !isPlainObject(parsed.state)) return { ok: false, mode, error: 'backup-invalid', state: current, nutrition: null, stats: null, warnings: [] };
    const incoming = migrate(parsed.state);
    if (mode === 'replace') return { ok: true, mode, state: incoming, nutrition: parsed.nutrition || null, stats: null, warnings: [] };
    const base = migrate(current);
    // A Strava run deleted on either side stays deleted (the same rule as importStravaRuns), so the
    // runs and ignoredStravaIds agree: incoming runs on the merged ignore list are skipped. The same
    // goes for Apple Health workouts and ignoredHealthIds.
    const ignoredSet = new Set(base.ignoredStravaIds.concat(incoming.ignoredStravaIds));
    const ignoredHealthSet = new Set(base.ignoredHealthIds.concat(incoming.ignoredHealthIds));
    const keptHere = new Set(base.runHistory.map(run => run.stravaActivityId).filter(Boolean));
    const keptHealthHere = new Set(base.runHistory.map(run => run.healthId).filter(Boolean));
    const incomingRuns = incoming.runHistory.filter(run => !(run.stravaActivityId && ignoredSet.has(run.stravaActivityId)) &&
      !(run.healthId && ignoredHealthSet.has(run.healthId)));
    const merged = mergeRuns(base.runHistory, incomingRuns);
    const days = new Set(base.recoveryLogs.map(log => log.date));
    const recoveryLogs = base.recoveryLogs.concat(incoming.recoveryLogs.filter(log => !days.has(log.date)))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const seen = new Set(base.legacyMilestones.map(m => m.date + '\n' + m.label));
    const legacyMilestones = base.legacyMilestones.concat(incoming.legacyMilestones.filter(m => !seen.has(m.date + '\n' + m.label)));
    const profile = base.profile.onboarded ? base.profile : incoming.profile;
    // A run this device still has wins over the backup's deletion of it (current wins, as everywhere in merge).
    const ignoredStravaIds = normalizeIgnoredIds(base.ignoredStravaIds.concat(incoming.ignoredStravaIds.filter(id => !keptHere.has(id))), null);
    const ignoredHealthIds = normalizeIgnoredHealthIds(base.ignoredHealthIds.concat(incoming.ignoredHealthIds.filter(id => !keptHealthHere.has(id))), null);
    const plannedDates = new Set(base.plannedWorkouts.map(p => p.date));
    const plannedWorkouts = base.plannedWorkouts.concat(incoming.plannedWorkouts.filter(p => !plannedDates.has(p.date)))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const exportKeys = new Set(base.exportLog.map(e => e.at + '\n' + e.workoutId + '\n' + e.format));
    const exportLog = normalizeExportLog(base.exportLog.concat(incoming.exportLog.filter(e => !exportKeys.has(e.at + '\n' + e.workoutId + '\n' + e.format)))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)), null);
    const state = Object.assign({}, base, { profile, runHistory: merged.runs, recoveryLogs, legacyMilestones, ignoredStravaIds, ignoredHealthIds, plannedWorkouts, exportLog });
    return {
      ok: true, mode, state, nutrition: parsed.nutrition || null,
      stats: { added: merged.added, updated: merged.updated, unchanged: merged.unchanged, invalid: merged.invalid, ignored: incoming.runHistory.length - incomingRuns.length },
      warnings: merged.warnings
    };
  }

  // ---------------------------------------------------------------- validation

  function validateRunInput(input, today, skipFuture) {
    const errors = [], warnings = [];
    if (!isPlainObject(input)) return { ok: false, run: null, errors: ['input-invalid'], warnings };
    if (!skipFuture && !today) errors.push('today-invalid');

    const date = typeof input.date === 'string' ? input.date.trim() : '';
    if (!date) errors.push('date-required');
    else if (!isDateKey(date)) errors.push('date-invalid');
    else if (!skipFuture && today && date > today) errors.push('date-future');

    let startTime = null;
    if (filled(input.startTime)) {
      startTime = normalizeClock(input.startTime);
      if (startTime === null) errors.push('start-time-invalid');
    }

    let type = 'run';
    if (filled(input.type)) {
      if (RUN_TYPES.indexOf(input.type) >= 0) type = input.type; else errors.push('type-invalid');
    }

    let distance = null;
    if (blank(input.distance)) errors.push('distance-required');
    else {
      const n = toNumber(input.distance);
      if (!Number.isFinite(n)) errors.push('distance-invalid');
      else {
        distance = roundTo(n, 3);
        if (!(distance > 0 && distance <= LIMITS.maxDistanceKm)) { errors.push('distance-range'); distance = null; }
      }
    }

    let movingSeconds = null;
    const fromTime = !filled(input.movingSeconds);
    const durationInput = fromTime ? input.time : input.movingSeconds;
    if (blank(durationInput)) errors.push('duration-required');
    else {
      // time is what people type ('21:02', '1:09:40'); movingSeconds may be a plain number.
      const raw = fromTime || (typeof durationInput === 'string' && durationInput.indexOf(':') >= 0) ? parseClockDuration(durationInput) : toNumber(durationInput);
      if (raw === null || !Number.isFinite(raw)) errors.push('duration-invalid');
      else {
        movingSeconds = Math.round(raw);
        if (!(movingSeconds > 0 && movingSeconds <= LIMITS.maxSeconds)) { errors.push('duration-range'); movingSeconds = null; }
      }
    }

    let effort = null;
    if (filled(input.effort)) {
      const n = toNumber(input.effort);
      if (Number.isInteger(n) && n >= 1 && n <= 10) effort = n; else errors.push('effort-invalid');
    }

    let note = '';
    if (typeof input.note === 'string') {
      note = input.note.normalize('NFC').trim();
      if (charLength(note) > LIMITS.maxNote) errors.push('note-too-long');
    } else if (input.note !== undefined && input.note !== null) errors.push('note-invalid');

    let name = '';
    if (typeof input.name === 'string') {
      name = cleanName(input.name);
      if (charLength(name) > LIMITS.maxRunName) errors.push('run-name-too-long');
    } else if (input.name !== undefined && input.name !== null) errors.push('run-name-invalid');

    if (distance !== null && movingSeconds !== null && movingSeconds / distance < MIN_PLAUSIBLE_PACE) warnings.push('pace-implausible');
    if (errors.length) return { ok: false, run: null, errors, warnings };
    const run = { date, startTime, type, distance, movingSeconds, effort, note };
    if (name) run.name = name;
    return { ok: true, run, errors, warnings };
  }

  /**
   * validateRun(input, today | { today }) -> { ok, run, errors: [codes], warnings: [codes] }.
   * input: { date 'YYYY-MM-DD', startTime? 'HH:MM', type? code, distance km (number or '5,2'),
   * movingSeconds (number) or time ('21:02', '1:09:40'), effort? 1..10, note?, name? }.
   * Error codes: input-invalid, today-invalid, date-required, date-invalid, date-future,
   * start-time-invalid, type-invalid, distance-required, distance-invalid, distance-range,
   * duration-required, duration-invalid, duration-range, effort-invalid, note-invalid,
   * note-too-long, run-name-invalid, run-name-too-long. Warning: pace-implausible (< 2:00/km).
   */
  function validateRun(input, options) {
    return validateRunInput(input, todayOf(options), false);
  }

  // ---------------------------------------------------------------- pure edit helpers

  function baseState(state) {
    return isPlainObject(state) ? state : DEFAULT_STATE();
  }
  function runsOf(state) {
    return Array.isArray(state.runHistory) ? state.runHistory.filter(isPlainObject) : [];
  }
  function failure(state, errors, extra) {
    return Object.assign({ ok: false, state, errors, warnings: [], undo: null }, extra || {});
  }
  function findDuplicateId(runs, run, exceptId) {
    const twin = runs.find(other => other.id !== exceptId && isDuplicateRun(other, run));
    return twin ? twin.id : null;
  }

  /**
   * addRun(state, input, { today, nowMs?, id? }) -> { ok, state, run, errors, warnings,
   * duplicateOf, undo: { op: 'add', runId } }. New manual run with id 'm-<nowMs>' (unique).
   * duplicateOf names an existing run that looks like the same activity (not blocking).
   */
  function addRun(state, input, options) {
    const base = baseState(state);
    const opts = isPlainObject(options) ? options : { today: options };
    const check = validateRun(input, opts);
    if (!check.ok) return failure(base, check.errors, { run: null, warnings: check.warnings, duplicateOf: null });
    const runs = runsOf(base);
    const used = new Set(runs.map(run => run.id));
    let id = typeof opts.id === 'string' && opts.id.trim() && !/^(strava|health)-/.test(opts.id.trim()) && !RESERVED_IDS.has(opts.id.trim()) && !used.has(opts.id.trim()) ? opts.id.trim() : null;
    if (id === null) {
      let n = Number.isFinite(opts.nowMs) ? Math.floor(opts.nowMs) : Date.now();
      while (used.has('m-' + n)) n++;
      id = 'm-' + n;
    }
    const run = Object.assign({ id, source: 'manual' }, check.run);
    const next = Object.assign({}, base, { runHistory: sortRuns(runs.concat([run])) });
    return { ok: true, state: next, run, errors: [], warnings: check.warnings, duplicateOf: findDuplicateId(runs, run, id), undo: { op: 'add', runId: id } };
  }

  /**
   * updateRun(state, id, patch, { today }) -> { ok, state, run, errors, warnings, undo }.
   * patch may change date, startTime, type, distance, movingSeconds or time, effort, note, name;
   * id, source and Strava fields stay. The future-date check only applies when the date changes.
   */
  function updateRun(state, id, patch, options) {
    const base = baseState(state);
    const runs = runsOf(base);
    const key = id === undefined || id === null ? '' : String(id);
    const existing = runs.find(run => run.id === key);
    if (!existing) return failure(base, ['run-not-found'], { run: null });
    if (!isPlainObject(patch)) return failure(base, ['input-invalid'], { run: null });
    const candidate = {
      date: existing.date, startTime: existing.startTime, type: existing.type, distance: existing.distance,
      movingSeconds: existing.movingSeconds, effort: existing.effort, note: existing.note, name: existing.name
    };
    for (const field of ['date', 'startTime', 'type', 'distance', 'effort', 'note', 'name']) {
      if (hasOwn(patch, field)) candidate[field] = patch[field];
    }
    if (hasOwn(patch, 'movingSeconds')) candidate.movingSeconds = patch.movingSeconds;
    else if (hasOwn(patch, 'time')) { candidate.movingSeconds = undefined; candidate.time = patch.time; }
    const dateChanged = typeof candidate.date !== 'string' || candidate.date.trim() !== existing.date;
    const today = todayOf(isPlainObject(options) ? options : { today: options });
    const check = validateRunInput(candidate, today, !dateChanged);
    if (!check.ok) return failure(base, check.errors, { run: null, warnings: check.warnings });
    const run = Object.assign({}, existing, check.run);
    if (!check.run.name) delete run.name;
    const next = Object.assign({}, base, { runHistory: sortRuns(runs.map(r => (r === existing ? run : r))) });
    return { ok: true, state: next, run, errors: [], warnings: check.warnings, undo: { op: 'update', before: existing } };
  }

  function ignoredOf(state) {
    return Array.isArray(state.ignoredStravaIds) ? state.ignoredStravaIds.filter(id => typeof id === 'string') : [];
  }
  function ignoredHealthOf(state) {
    return Array.isArray(state.ignoredHealthIds) ? state.ignoredHealthIds.map(cleanHealthId).filter(id => id !== null) : [];
  }

  /**
   * deleteRun(state, id) -> { ok, state, run, errors, undo: { op: 'delete', run, index[, ignoredBefore][, ignoredHealthBefore] } }.
   * Deleting a Strava run adds its activity id to ignoredStravaIds so the next sync does not bring it
   * back; a run with an Apple Health workout id (a Health run, or a manual / Strava run that absorbed
   * its Health copy) adds that id to ignoredHealthIds. Undo restores the previous lists.
   */
  function deleteRun(state, id) {
    const base = baseState(state);
    const runs = runsOf(base);
    const key = id === undefined || id === null ? '' : String(id);
    const index = runs.findIndex(run => run.id === key);
    if (index < 0) return failure(base, ['run-not-found'], { run: null });
    const run = runs[index];
    const patch = { runHistory: runs.filter((r, i) => i !== index) };
    const undo = { op: 'delete', run, index };
    const stravaId = stravaIdOf(run);
    const ignored = ignoredOf(base);
    if (stravaId !== null && ignored.indexOf(stravaId) < 0) {
      patch.ignoredStravaIds = normalizeIgnoredIds(ignored.concat([stravaId]), null);
      undo.ignoredBefore = ignored;
    }
    const healthId = healthIdOf(run);
    const ignoredHealth = ignoredHealthOf(base);
    if (healthId !== null && ignoredHealth.indexOf(healthId) < 0) {
      patch.ignoredHealthIds = normalizeIgnoredHealthIds(ignoredHealth.concat([healthId]), null);
      undo.ignoredHealthBefore = ignoredHealth;
    }
    const next = Object.assign({}, base, patch);
    return { ok: true, state: next, run, errors: [], warnings: [], undo };
  }

  /**
   * importStravaRuns(state, incoming) -> { ok, state, added, updated, unchanged, invalid, ignored, warnings }.
   * Runs whose Strava activity id is in state.ignoredStravaIds are skipped (counted in `ignored`);
   * the rest go through mergeRuns (manual twins keep the typed time, see combineRuns).
   */
  function importStravaRuns(state, incoming) {
    const base = baseState(state);
    const list = Array.isArray(incoming) ? incoming : [];
    const ignored = new Set(ignoredOf(base));
    const kept = list.filter(run => !(isPlainObject(run) && ignored.has(stravaIdOf(run))));
    const merged = mergeRuns(runsOf(base), kept);
    const changed = merged.added > 0 || merged.updated > 0;
    return {
      ok: true, state: changed ? Object.assign({}, base, { runHistory: merged.runs }) : base,
      added: merged.added, updated: merged.updated, unchanged: merged.unchanged, invalid: merged.invalid,
      ignored: list.length - kept.length, warnings: merged.warnings
    };
  }

  /**
   * restoreIgnoredStrava(state, ids?) -> { ok, state, removed, errors, undo }. Takes the given activity
   * ids (or all of them) off the ignore list, so the next sync may import those runs again.
   */
  function restoreIgnoredStrava(state, ids) {
    const base = baseState(state);
    const ignored = ignoredOf(base);
    const drop = Array.isArray(ids) ? new Set(ids.map(cleanStravaId).filter(id => id !== null)) : null;
    const keep = drop ? ignored.filter(id => !drop.has(id)) : [];
    return {
      ok: true, state: Object.assign({}, base, { ignoredStravaIds: keep }), removed: ignored.length - keep.length,
      errors: [], warnings: [], undo: { op: 'ignored', before: ignored }
    };
  }

  // ---------------------------------------------------------------- Apple Health import

  /**
   * healthRunFrom(row) -> a normalized Run { id: 'health-<UUID>', source: 'health', healthId, date,
   * startTime, type: 'run', distance, movingSeconds, effort: null, note: '', averageHeartrate,
   * maxHeartrate?, sourceName? } from one VeyvoPlatform.health.importRuns() row, or null when the row
   * has no valid workout id, local date, distance or duration (a treadmill run saved without a
   * distance, for example). Heart rates outside (0, 300] bpm are left out.
   * row: { healthId: HKWorkout UUID, startDate: ISO, date: 'YYYY-MM-DD' (local), startTime: 'HH:MM'
   *        (local), distanceKm, movingSeconds, averageHeartrate, maxHeartrate, sourceName }
   */
  function healthRunFrom(row) {
    if (!isPlainObject(row)) return null;
    const healthId = cleanHealthId(row.healthId);
    const date = typeof row.date === 'string' ? row.date.trim() : '';
    if (healthId === null || !isDateKey(date)) return null;
    const distance = roundTo(toNumber(row.distanceKm), 3);
    if (!(distance > 0 && distance <= LIMITS.maxDistanceKm)) return null;
    const movingSeconds = typeof row.movingSeconds === 'number' ? durationFrom(row.movingSeconds) : null;
    if (movingSeconds === null) return null;
    const bpm = value => {
      const n = typeof value === 'number' ? value : NaN;
      return n > 0 && n <= 300 ? roundTo(n, 1) : null;
    };
    const run = {
      id: 'health-' + healthId, source: 'health', healthId, date, startTime: normalizeClock(row.startTime), type: 'run',
      distance, movingSeconds, effort: null, note: '', averageHeartrate: bpm(row.averageHeartrate)
    };
    const max = bpm(row.maxHeartrate);
    if (max !== null) run.maxHeartrate = max;
    if (typeof row.sourceName === 'string' && cleanName(row.sourceName)) run.sourceName = row.sourceName;
    return normalizeRun(run, { index: -1, warnings: null });
  }

  /**
   * importHealthRuns(state, rows, { at }) -> { ok, state, added, updated, unchanged, invalid, ignored, twins, warnings }.
   * rows: VeyvoPlatform.health.importRuns() answers (see healthRunFrom). Workouts on
   * ignoredHealthIds are skipped (`ignored`); two rows that are one run (two apps wrote it into
   * Health, isDuplicateRun) become one record (`twins`); the rest goes through mergeRuns, so a
   * manual or Strava twin keeps its own values and only gains what Health adds (start time, heart
   * rate, the writing app, the workout id). state.health becomes { enabled: true, lastImport: at,
   * lastError: null }; `at` is the ISO time of the import (nothing reads the clock here).
   */
  function importHealthRuns(state, rows, options) {
    const base = baseState(state);
    const opts = isPlainObject(options) ? options : {};
    const list = Array.isArray(rows) ? rows : [];
    const ignored = new Set(ignoredHealthOf(base));
    const incoming = [];
    let invalid = 0, ignoredCount = 0, twins = 0;
    for (const row of list) {
      const run = healthRunFrom(row);
      if (!run) { invalid++; continue; }
      if (ignored.has(run.healthId)) { ignoredCount++; continue; }
      const twin = incoming.findIndex(other => other.healthId === run.healthId || isDuplicateRun(other, run));
      if (twin >= 0) { incoming[twin] = combineRuns(incoming[twin], run); twins++; continue; }
      incoming.push(run);
    }
    const merged = mergeRuns(runsOf(base), incoming);
    const health = Object.assign(normalizeHealth(base.health), { enabled: true, lastError: null });
    const at = isoOrNull(opts.at);
    if (at) health.lastImport = at;
    const next = Object.assign({}, base, { health });
    if (merged.added > 0 || merged.updated > 0) next.runHistory = merged.runs;
    return {
      ok: true, state: next, added: merged.added, updated: merged.updated, unchanged: merged.unchanged,
      invalid: invalid + merged.invalid, ignored: ignoredCount, twins, warnings: merged.warnings
    };
  }

  /**
   * healthImportSince(state, now) -> ISO timestamp the next Apple Health import reads from: the
   * first import (or a lastImport in the future) reads HEALTH.firstImportDays (90) back, later ones
   * start HEALTH.overlapDays (7) before the last import, because watch apps often sync a run into
   * Health hours or days after it happened (runs already imported are matched by their workout id).
   * now: Date, epoch ms or ISO string. null when now is not a valid time.
   */
  function healthImportSince(state, now) {
    const ms = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : typeof now === 'string' ? Date.parse(now) : NaN;
    if (!Number.isFinite(ms)) return null;
    const base = baseState(state);
    const last = isPlainObject(base.health) ? isoOrNull(base.health.lastImport) : null;
    const lastMs = last ? Date.parse(last) : NaN;
    const day = 86400000;
    const from = Number.isFinite(lastMs) && lastMs <= ms ? lastMs - HEALTH.overlapDays * day : ms - HEALTH.firstImportDays * day;
    return new Date(from).toISOString();
  }

  /**
   * restoreIgnoredHealth(state, ids?) -> { ok, state, removed, errors, undo }. Takes the given Apple
   * Health workout ids (or all of them) off the ignore list and resets lastImport, so the next import
   * reads the last 90 days again and may bring those runs back.
   */
  function restoreIgnoredHealth(state, ids) {
    const base = baseState(state);
    const ignored = ignoredHealthOf(base);
    const drop = Array.isArray(ids) ? new Set(ids.map(cleanHealthId).filter(id => id !== null)) : null;
    const keep = drop ? ignored.filter(id => !drop.has(id)) : [];
    const health = normalizeHealth(base.health);
    const patch = { ignoredHealthIds: keep };
    if (keep.length !== ignored.length) patch.health = Object.assign({}, health, { lastImport: null });
    return {
      ok: true, state: Object.assign({}, base, patch), removed: ignored.length - keep.length,
      errors: [], warnings: [], undo: { op: 'ignoredHealth', before: ignored, health }
    };
  }

  function plannedOf(state) {
    return Array.isArray(state.plannedWorkouts) ? state.plannedWorkouts.filter(isPlainObject) : [];
  }
  const byDateKey = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  /**
   * schedulePlanned(state, { date, templateId }, { today }?) -> { ok, state, planned, errors, undo }.
   * One library session per date: an existing entry for that date is replaced. With today given,
   * dates in the past are refused ('date-past'). templateId: a library id such as 'intervals400'.
   * Error codes: input-invalid, date-required, date-invalid, date-past, template-invalid.
   */
  function schedulePlanned(state, entry, options) {
    const base = baseState(state);
    if (!isPlainObject(entry)) return failure(base, ['input-invalid'], { planned: null });
    const errors = [];
    const today = todayOf(isPlainObject(options) ? options : { today: options });
    const date = typeof entry.date === 'string' ? entry.date.trim() : '';
    if (!date) errors.push('date-required');
    else if (!isDateKey(date)) errors.push('date-invalid');
    else if (today && date < today) errors.push('date-past');
    const templateId = cleanTemplateId(entry.templateId);
    if (templateId === null) errors.push('template-invalid');
    if (errors.length) return failure(base, errors, { planned: null });
    const list = plannedOf(base);
    const before = list.find(p => p.date === date) || null;
    const planned = { date, templateId };
    const plannedWorkouts = list.filter(p => p.date !== date).concat([planned]).sort(byDateKey);
    return { ok: true, state: Object.assign({}, base, { plannedWorkouts }), planned, errors: [], warnings: [], undo: { op: 'planned', date, before } };
  }

  /** unschedulePlanned(state, date) -> { ok, state, errors, undo }. Error: planned-not-found. */
  function unschedulePlanned(state, date) {
    const base = baseState(state);
    const list = plannedOf(base);
    const before = list.find(p => p.date === date);
    if (!before) return failure(base, ['planned-not-found']);
    return { ok: true, state: Object.assign({}, base, { plannedWorkouts: list.filter(p => p !== before) }), errors: [], warnings: [], undo: { op: 'planned', date, before } };
  }

  /**
   * logExport(state, { at, workoutId, format }) -> { ok, state, entry, errors }. Appends one export
   * record (at: ISO timestamp, workoutId <= 100 chars, format: 'fit' | 'apple' | 'zwo' | 'intervals' |
   * 'garmin' | 'text' | other lowercase code); only the newest 50 are kept. Error: export-invalid.
   */
  function logExport(state, entry) {
    const base = baseState(state);
    const clean = exportEntry(entry);
    if (!clean) return failure(base, ['export-invalid'], { entry: null });
    const log = Array.isArray(base.exportLog) ? base.exportLog.filter(isPlainObject) : [];
    const exportLog = log.concat([clean]);
    return { ok: true, state: Object.assign({}, base, { exportLog: exportLog.slice(Math.max(0, exportLog.length - EXPORT_LOG_MAX)) }), entry: clean, errors: [], warnings: [] };
  }

  /**
   * upsertRecovery(state, log, { today }?) -> { ok, state, log, errors, undo }.
   * log: { date, sleepHours?, fatigue?, soreness?, note? }. Fields left undefined keep the value
   * already logged for that date (a check-in can be filled in several taps); null clears one.
   * Error codes: input-invalid, date-required, date-invalid, date-future, sleep-invalid,
   * fatigue-invalid, soreness-invalid, note-invalid, note-too-long, recovery-empty.
   */
  function upsertRecovery(state, log, options) {
    const base = baseState(state);
    if (!isPlainObject(log)) return failure(base, ['input-invalid'], { log: null });
    const errors = [];
    const today = todayOf(isPlainObject(options) ? options : { today: options });
    const date = typeof log.date === 'string' ? log.date.trim() : '';
    if (!date) errors.push('date-required');
    else if (!isDateKey(date)) errors.push('date-invalid');
    else if (today && date > today) errors.push('date-future');
    const logs = Array.isArray(base.recoveryLogs) ? base.recoveryLogs.filter(isPlainObject) : [];
    const before = logs.find(item => item.date === date) || null;
    const next = Object.assign({ date, sleepHours: null, fatigue: null, soreness: null, note: '' }, before || {}, { date });
    const metric = (field, min, max, integer, code) => {
      if (!hasOwn(log, field) || log[field] === undefined) return;
      if (blank(log[field])) { next[field] = null; return; }
      const n = toNumber(log[field]);
      if (!(n >= min && n <= max) || (integer && !Number.isInteger(n))) { errors.push(code); return; }
      next[field] = integer ? n : roundTo(n, 2);
    };
    metric('sleepHours', 0, LIMITS.maxSleepHours, false, 'sleep-invalid');
    metric('fatigue', 1, 10, true, 'fatigue-invalid');
    metric('soreness', 0, 10, true, 'soreness-invalid');
    if (hasOwn(log, 'note') && log.note !== undefined) {
      if (log.note === null) next.note = '';
      else if (typeof log.note !== 'string') errors.push('note-invalid');
      else {
        next.note = log.note.normalize('NFC').trim();
        if (charLength(next.note) > LIMITS.maxNote) errors.push('note-too-long');
      }
    }
    if (!errors.length && next.sleepHours === null && next.fatigue === null && next.soreness === null && !next.note) errors.push('recovery-empty');
    if (errors.length) return failure(base, errors, { log: null });
    const recoveryLogs = logs.filter(item => item.date !== date).concat([next]).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { ok: true, state: Object.assign({}, base, { recoveryLogs }), log: next, errors: [], warnings: [], undo: { op: 'recovery', date, before } };
  }

  /** deleteRecovery(state, date) -> { ok, state, errors, undo }. */
  function deleteRecovery(state, date) {
    const base = baseState(state);
    const logs = Array.isArray(base.recoveryLogs) ? base.recoveryLogs.filter(isPlainObject) : [];
    const before = logs.find(item => item.date === date);
    if (!before) return failure(base, ['recovery-not-found']);
    return { ok: true, state: Object.assign({}, base, { recoveryLogs: logs.filter(item => item !== before) }), errors: [], warnings: [], undo: { op: 'recovery', date, before } };
  }

  /**
   * setProfile(state, patch) -> { ok, state, profile, errors, undo }. All-or-nothing.
   * name <= 40 characters (trimmed), goalDistanceKm 1..100 (number or '21,1'), targetSeconds
   * 60..172800 / 'mm:ss' / 'h:mm:ss' or null, days 1..7 ints 0..6 (deduplicated, sorted),
   * onboarded boolean. Unknown patch keys are ignored.
   * Error codes: input-invalid, name-invalid, name-too-long, goal-distance-invalid,
   * target-invalid, days-invalid, onboarded-invalid.
   */
  function setProfile(state, patch) {
    const base = baseState(state);
    const current = isPlainObject(base.profile) ? base.profile : DEFAULT_STATE().profile;
    if (!isPlainObject(patch)) return failure(base, ['input-invalid'], { profile: current });
    const errors = [];
    const next = Object.assign({}, current);
    if (hasOwn(patch, 'name')) {
      if (patch.name === null) next.name = '';
      else if (typeof patch.name !== 'string') errors.push('name-invalid');
      else {
        next.name = cleanName(patch.name);
        if (charLength(next.name) > LIMITS.maxProfileName) errors.push('name-too-long');
      }
    }
    if (hasOwn(patch, 'goalDistanceKm')) {
      const n = toNumber(patch.goalDistanceKm);
      if (n >= LIMITS.minGoalKm && n <= LIMITS.maxGoalKm) next.goalDistanceKm = roundTo(n, 3); else errors.push('goal-distance-invalid');
    }
    if (hasOwn(patch, 'targetSeconds')) {
      if (blank(patch.targetSeconds)) next.targetSeconds = null;
      else {
        const seconds = targetFrom(patch.targetSeconds);
        if (seconds === null) errors.push('target-invalid'); else next.targetSeconds = seconds;
      }
    }
    if (hasOwn(patch, 'days')) {
      const days = daysFrom(patch.days);
      if (days === null) errors.push('days-invalid'); else next.days = days;
    }
    if (hasOwn(patch, 'onboarded')) {
      if (typeof patch.onboarded !== 'boolean') errors.push('onboarded-invalid'); else next.onboarded = patch.onboarded;
    }
    if (errors.length) return failure(base, errors, { profile: current });
    return { ok: true, state: Object.assign({}, base, { profile: next }), profile: next, errors: [], warnings: [], undo: { op: 'profile', before: current } };
  }

  /**
   * applyUndo(state, undo) -> { ok, state, errors }. Reverts a token from addRun, updateRun,
   * deleteRun, upsertRecovery, deleteRecovery, setProfile, schedulePlanned, unschedulePlanned,
   * restoreIgnoredStrava or restoreIgnoredHealth on the current state.
   */
  function applyUndo(state, undo) {
    const base = baseState(state);
    if (!isPlainObject(undo)) return failure(base, ['undo-invalid']);
    const runs = runsOf(base);
    if (undo.op === 'add' && typeof undo.runId === 'string') {
      return { ok: true, state: Object.assign({}, base, { runHistory: runs.filter(run => run.id !== undo.runId) }), errors: [] };
    }
    if ((undo.op === 'delete' && isPlainObject(undo.run)) || (undo.op === 'update' && isPlainObject(undo.before))) {
      const run = undo.op === 'delete' ? undo.run : undo.before;
      const others = runs.filter(r => r.id !== run.id);
      const patch = { runHistory: sortRuns(others.concat([run])) };
      if (undo.op === 'delete' && Array.isArray(undo.ignoredBefore)) patch.ignoredStravaIds = undo.ignoredBefore.slice();
      if (undo.op === 'delete' && Array.isArray(undo.ignoredHealthBefore)) patch.ignoredHealthIds = undo.ignoredHealthBefore.slice();
      return { ok: true, state: Object.assign({}, base, patch), errors: [] };
    }
    if (undo.op === 'ignored' && Array.isArray(undo.before)) {
      return { ok: true, state: Object.assign({}, base, { ignoredStravaIds: undo.before.slice() }), errors: [] };
    }
    if (undo.op === 'ignoredHealth' && Array.isArray(undo.before)) {
      const patch = { ignoredHealthIds: undo.before.slice() };
      if (isPlainObject(undo.health)) patch.health = normalizeHealth(undo.health);
      return { ok: true, state: Object.assign({}, base, patch), errors: [] };
    }
    if (undo.op === 'planned' && typeof undo.date === 'string') {
      const list = plannedOf(base).filter(p => p.date !== undo.date);
      if (isPlainObject(undo.before)) list.push(undo.before);
      return { ok: true, state: Object.assign({}, base, { plannedWorkouts: list.sort(byDateKey) }), errors: [] };
    }
    if (undo.op === 'recovery' && typeof undo.date === 'string') {
      const logs = (Array.isArray(base.recoveryLogs) ? base.recoveryLogs.filter(isPlainObject) : []).filter(log => log.date !== undo.date);
      if (isPlainObject(undo.before)) logs.push(undo.before);
      logs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return { ok: true, state: Object.assign({}, base, { recoveryLogs: logs }), errors: [] };
    }
    if (undo.op === 'profile' && isPlainObject(undo.before)) {
      return { ok: true, state: Object.assign({}, base, { profile: undo.before }), errors: [] };
    }
    return failure(base, ['undo-invalid']);
  }

  // ---------------------------------------------------------------- texts (cs + en)

  const MESSAGES = {
    cs: {
      error: {
        'input-invalid': 'Záznam není platný.',
        'today-invalid': 'Chybí dnešní datum pro kontrolu.',
        'date-required': 'Zadej datum.',
        'date-invalid': 'Datum není platné.',
        'date-future': 'Datum nemůže být v budoucnosti.',
        'start-time-invalid': 'Čas startu zadej jako HH:MM, např. 07:30.',
        'type-invalid': 'Vyber typ běhu.',
        'distance-required': 'Zadej vzdálenost.',
        'distance-invalid': 'Vzdálenost zadej jako číslo, např. 5,2.',
        'distance-range': 'Vzdálenost musí být větší než 0 a nejvýš 300 km.',
        'duration-required': 'Zadej čas běhu.',
        'duration-invalid': 'Čas zadej jako mm:ss nebo h:mm:ss.',
        'duration-range': 'Čas musí být delší než 0 a nejvýš 48 hodin.',
        'effort-invalid': 'Náročnost vyber na stupnici 1–10.',
        'note-invalid': 'Poznámka musí být text.',
        'note-too-long': 'Poznámka může mít nejvýš 1000 znaků.',
        'run-name-invalid': 'Název běhu musí být text.',
        'run-name-too-long': 'Název běhu může mít nejvýš 200 znaků.',
        'run-not-found': 'Běh se nepodařilo najít.',
        'name-invalid': 'Jméno musí být text.',
        'name-too-long': 'Jméno může mít nejvýš 40 znaků.',
        'goal-distance-invalid': 'Cílová vzdálenost musí být 1–100 km.',
        'target-invalid': 'Cílový čas musí být mezi 1:00 a 48:00:00.',
        'days-invalid': 'Vyber 1 až 7 běžeckých dnů.',
        'onboarded-invalid': 'Stav úvodního nastavení není platný.',
        'sleep-invalid': 'Spánek zadej v rozmezí 0–24 hodin.',
        'fatigue-invalid': 'Únavu vyber na stupnici 1–10.',
        'soreness-invalid': 'Bolest svalů vyber na stupnici 0–10.',
        'recovery-empty': 'Vyplň aspoň jednu hodnotu.',
        'recovery-not-found': 'Záznam regenerace se nepodařilo najít.',
        'undo-invalid': 'Tuto akci už nejde vrátit.',
        'date-past': 'Datum nemůže být v minulosti.',
        'template-invalid': 'Vyber trénink z knihovny.',
        'planned-not-found': 'Naplánovaný trénink se nepodařilo najít.',
        'export-invalid': 'Záznam o exportu není platný.',
        'state-invalid': 'Data nejsou platná.',
        'serialize-failed': 'Data se nepodařilo připravit k uložení.',
        'storage-full': 'Úložiště je plné, změny se neuložily.',
        'storage-write-failed': 'Změny se nepodařilo uložit.',
        'backup-invalid': 'Záloha není platná.',
        'not-text': 'Soubor se nepodařilo přečíst jako text.',
        empty: 'Soubor je prázdný.',
        'too-large': 'Soubor je příliš velký.',
        'json-invalid': 'Soubor je poškozený, nejde o platnou zálohu VEYVO.',
        'not-backup': 'Soubor není záloha VEYVO.',
        'wrong-app': 'Soubor není záloha VEYVO.',
        'wrong-kind': 'Soubor není záloha VEYVO.',
        'schema-invalid': 'Verze zálohy není platná.',
        'schema-newer': 'Záloha je z novější verze VEYVO. Nejdřív aktualizuj aplikaci.'
      },
      notice: {
        runsDropped: { one: '{n} běh se nepodařilo načíst.', few: '{n} běhy se nepodařilo načíst.', many: '{n} běhu se nepodařilo načíst.', other: '{n} běhů se nepodařilo načíst.' },
        runsAdded: { one: 'Přidán {n} běh.', few: 'Přidány {n} běhy.', many: 'Přidáno {n} běhu.', other: 'Přidáno {n} běhů.' },
        runsUpdated: { one: 'Doplněn {n} běh.', few: 'Doplněny {n} běhy.', many: 'Doplněno {n} běhu.', other: 'Doplněno {n} běhů.' },
        runsUnchanged: { one: '{n} běh už byl uložený.', few: '{n} běhy už byly uložené.', many: '{n} běhu už bylo uloženo.', other: '{n} běhů už bylo uloženo.' },
        runsMerged: { one: '{n} běh ze Stravy byl spojen s ručním zápisem.', few: '{n} běhy ze Stravy byly spojeny s ručními zápisy.', many: '{n} běhu ze Stravy bylo spojeno s ručními zápisy.', other: '{n} běhů ze Stravy bylo spojeno s ručními zápisy.' },
        corrupt: 'Uložená data byla poškozená. Jejich kopie zůstala uschovaná a VEYVO začíná nanovo.',
        corruptCopyFailed: 'Uložená data byla poškozená a jejich kopii se nepodařilo uschovat.',
        storageReadFailed: 'Uložená data nejdou přečíst. Změny se nemusí uložit.',
        migrated: 'Data z předchozí verze VEYVO byla převedena.',
        legacyKept: 'Starší data AI trenéra (chat, týdenní plány) se už nezobrazují, ale zůstávají v zálohách.',
        schemaNewer: 'Data pocházejí z novější verze VEYVO. Některé údaje se nemusí zobrazit.',
        duplicateSuspected: 'Podobný běh ze stejného dne už je zapsaný.',
        paceImplausible: 'Tempo vychází rychlejší než 2:00/km. Zkontroluj čas.',
        runSaved: 'Běh uložen.',
        runUpdated: 'Běh upraven.',
        runDeleted: 'Běh smazán.',
        runDeletedStrava: 'Běh smazán. Strava ho znovu nenačte.',
        stravaRestored: { one: '{n} smazaný běh ze Stravy se může znovu načíst.', few: '{n} smazané běhy ze Stravy se mohou znovu načíst.', many: '{n} smazaného běhu ze Stravy se může znovu načíst.', other: '{n} smazaných běhů ze Stravy se může znovu načíst.' },
        runDeletedHealth: 'Běh smazán. Z Apple Zdraví se znovu nenačte.',
        healthRestored: { one: '{n} smazaný běh z Apple Zdraví se může znovu načíst.', few: '{n} smazané běhy z Apple Zdraví se mohou znovu načíst.', many: '{n} smazaného běhu z Apple Zdraví se může znovu načíst.', other: '{n} smazaných běhů z Apple Zdraví se může znovu načíst.' },
        plannedSaved: 'Trénink naplánován.',
        plannedRemoved: 'Naplánovaný trénink odebrán.',
        recoverySaved: 'Regenerace uložena.',
        profileSaved: 'Profil uložen.',
        backupRestored: 'Záloha obnovena.',
        undo: 'Vrátit'
      }
    },
    en: {
      error: {
        'input-invalid': 'The entry is not valid.',
        'today-invalid': "Today's date is missing for the check.",
        'date-required': 'Enter the date.',
        'date-invalid': 'The date is not valid.',
        'date-future': 'The date cannot be in the future.',
        'start-time-invalid': 'Enter the start time as HH:MM, e.g. 07:30.',
        'type-invalid': 'Choose a run type.',
        'distance-required': 'Enter the distance.',
        'distance-invalid': 'Enter the distance as a number, e.g. 5.2.',
        'distance-range': 'Distance must be more than 0 and at most 300 km.',
        'duration-required': 'Enter the run time.',
        'duration-invalid': 'Enter the time as mm:ss or h:mm:ss.',
        'duration-range': 'Time must be more than 0 and at most 48 hours.',
        'effort-invalid': 'Pick an effort from 1 to 10.',
        'note-invalid': 'The note must be text.',
        'note-too-long': 'The note can be at most 1,000 characters.',
        'run-name-invalid': 'The run name must be text.',
        'run-name-too-long': 'The run name can be at most 200 characters.',
        'run-not-found': 'The run could not be found.',
        'name-invalid': 'The name must be text.',
        'name-too-long': 'The name can be at most 40 characters.',
        'goal-distance-invalid': 'Goal distance must be 1–100 km.',
        'target-invalid': 'Target time must be between 1:00 and 48:00:00.',
        'days-invalid': 'Choose 1 to 7 running days.',
        'onboarded-invalid': 'The setup status is not valid.',
        'sleep-invalid': 'Enter sleep between 0 and 24 hours.',
        'fatigue-invalid': 'Pick fatigue from 1 to 10.',
        'soreness-invalid': 'Pick muscle soreness from 0 to 10.',
        'recovery-empty': 'Fill in at least one value.',
        'recovery-not-found': 'The recovery entry could not be found.',
        'undo-invalid': 'This action can no longer be undone.',
        'date-past': 'The date cannot be in the past.',
        'template-invalid': 'Choose a workout from the library.',
        'planned-not-found': 'The planned workout could not be found.',
        'export-invalid': 'The export record is not valid.',
        'state-invalid': 'The data is not valid.',
        'serialize-failed': 'The data could not be prepared for saving.',
        'storage-full': 'Storage is full, so the changes were not saved.',
        'storage-write-failed': 'The changes could not be saved.',
        'backup-invalid': 'The backup is not valid.',
        'not-text': 'The file could not be read as text.',
        empty: 'The file is empty.',
        'too-large': 'The file is too large.',
        'json-invalid': 'The file is damaged and is not a valid VEYVO backup.',
        'not-backup': 'This file is not a VEYVO backup.',
        'wrong-app': 'This file is not a VEYVO backup.',
        'wrong-kind': 'This file is not a VEYVO backup.',
        'schema-invalid': 'The backup version is not valid.',
        'schema-newer': 'This backup comes from a newer VEYVO. Update the app first.'
      },
      notice: {
        runsDropped: { one: '{n} run could not be loaded.', other: '{n} runs could not be loaded.' },
        runsAdded: { one: '{n} run added.', other: '{n} runs added.' },
        runsUpdated: { one: '{n} run updated.', other: '{n} runs updated.' },
        runsUnchanged: { one: '{n} run was already saved.', other: '{n} runs were already saved.' },
        runsMerged: { one: '{n} Strava run was merged with its manual entry.', other: '{n} Strava runs were merged with their manual entries.' },
        corrupt: 'Saved data was damaged. A copy was kept and VEYVO is starting fresh.',
        corruptCopyFailed: 'Saved data was damaged and a copy could not be kept.',
        storageReadFailed: 'Saved data cannot be read. Changes may not be saved.',
        migrated: 'Data from the previous VEYVO version was converted.',
        legacyKept: 'Older AI coach data (chat, weekly plans) is no longer shown but stays in your backups.',
        schemaNewer: 'This data comes from a newer VEYVO. Some details may not show.',
        duplicateSuspected: 'A similar run on the same day is already logged.',
        paceImplausible: 'The pace works out faster than 2:00/km. Check the time.',
        runSaved: 'Run saved.',
        runUpdated: 'Run updated.',
        runDeleted: 'Run deleted.',
        runDeletedStrava: 'Run deleted. Strava will not import it again.',
        stravaRestored: { one: '{n} deleted Strava run can be imported again.', other: '{n} deleted Strava runs can be imported again.' },
        runDeletedHealth: 'Run deleted. Apple Health will not import it again.',
        healthRestored: { one: '{n} deleted Apple Health run can be imported again.', other: '{n} deleted Apple Health runs can be imported again.' },
        plannedSaved: 'Workout scheduled.',
        plannedRemoved: 'Planned workout removed.',
        recoverySaved: 'Recovery saved.',
        profileSaved: 'Profile saved.',
        backupRestored: 'Backup restored.',
        undo: 'Undo'
      }
    }
  };

  const api = {
    SCHEMA_VERSION, STORAGE_KEY, NUTRITION_KEY, CORRUPT_KEY_PREFIX, MIGRATION_BACKUP_PREFIX,
    RUN_TYPES, LIMITS, DUPLICATE, HEALTH, MESSAGES, EXPORT_LOG_MAX,
    DEFAULT_STATE,
    migrate, migrateWithReport, normalizeRun, typeCode, parseClockDuration, isDateKey,
    load, save,
    LEGACY_BACKUP_KEY: MIGRATION_BACKUP_PREFIX + '1',
    exportBackup, parseBackup, applyBackup, backupFileName, legacyExtras,
    mergeRuns, importStravaRuns, isDuplicateRun, stravaActivityIds, sortRuns,
    importHealthRuns, healthRunFrom, healthImportSince, restoreIgnoredHealth,
    validateRun, addRun, updateRun, deleteRun, restoreIgnoredStrava,
    upsertRecovery, deleteRecovery, setProfile, applyUndo,
    schedulePlanned, unschedulePlanned, logExport
  };

  if (root.VeyvoI18n && typeof root.VeyvoI18n.register === 'function') {
    try { root.VeyvoI18n.register('store', MESSAGES); } catch (error) { /* texts stay available via MESSAGES */ }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VeyvoStore = api;
})(globalThis);
