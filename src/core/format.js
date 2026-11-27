/*
 * VeyvoFormat - locale-aware display formatting for VEYVO (cs + en).
 *
 * Classic UMD script: loaded with <script src> in the app and require()d by Node tests.
 * Pure functions only: no DOM, no network, no hidden "now" (pass today explicitly).
 *
 * Every formatter accepts an optional last argument that is either a locale string
 * ('cs' | 'en') or an options object with `locale`. Without it the module locale
 * (setLocale/getLocale, default 'cs') is used.
 *
 * Date keys are 'YYYY-MM-DD' strings in the runner's local calendar. They are turned into
 * Date objects with the local constructor (new Date(y, m - 1, d, 12)), never by parsing an
 * ISO string, so a run on 24 Nov is shown as 24 Nov in every time zone.
 */
(function (root) {
  'use strict';

  const LOCALES = Object.freeze(['cs', 'en']);
  const INTL_LOCALE = Object.freeze({ cs: 'cs-CZ', en: 'en-GB' });
  const EMPTY = '\u2014'; // em dash shown for missing / invalid values
  const MINUS = '\u2212'; // typographic minus for negative numbers and deltas
  const DAY_MS = 86400000;
  const DATE_STYLES = Object.freeze([
    'short', 'dayMonth', 'dayMonthYear', 'dayMonthLong', 'long', 'longYear',
    'weekday', 'weekdayLong', 'month', 'monthShort', 'monthYear', 'iso'
  ]);

  let current = 'cs';

  // ---------------------------------------------------------------- locale

  /** Maps any language tag to 'cs' | 'en'. Czech (and Slovak) -> 'cs', anything else -> 'en'. */
  function normalizeLocale(value, fallback) {
    if (typeof value === 'string' && value.trim()) {
      const language = value.trim().toLowerCase().split(/[-_]/)[0];
      return language === 'cs' || language === 'sk' ? 'cs' : 'en';
    }
    return fallback === undefined ? current : fallback;
  }

  function setLocale(locale) {
    current = normalizeLocale(locale, current);
    return current;
  }

  function getLocale() {
    return current;
  }

  function intlLocale(locale) {
    return INTL_LOCALE[normalizeLocale(locale)];
  }

  function options(opts) {
    if (typeof opts === 'string') return { locale: opts };
    return opts && typeof opts === 'object' ? opts : {};
  }

  function localeOf(opts) {
    return normalizeLocale(opts.locale, current);
  }

  function fallbackOf(opts) {
    return opts.fallback === undefined ? EMPTY : opts.fallback;
  }

  // ---------------------------------------------------------------- numbers

  /** Finite number from a number or a plain numeric string ('5.02'); otherwise null. */
  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
    return null;
  }

  function clampInt(value, min, max, fallback) {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  const numberFormats = new Map();
  function numberFormat(locale, min, max, grouping) {
    const key = locale + '|' + min + '|' + max + '|' + grouping;
    let format = numberFormats.get(key);
    if (!format) {
      format = new Intl.NumberFormat(INTL_LOCALE[locale], {
        minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping
      });
      numberFormats.set(key, format);
    }
    return format;
  }

  function fractionRange(opts, defaultMax) {
    if (opts.decimals != null) {
      const fixed = clampInt(opts.decimals, 0, 10, 0);
      return [fixed, fixed];
    }
    const min = clampInt(opts.minDecimals, 0, 10, 0);
    const max = clampInt(opts.maxDecimals, min, 10, Math.max(min, defaultMax));
    return [min, max];
  }

  /** True when a formatted number shows no non-zero digit (e.g. '-0,0'). */
  function looksZero(text) {
    return !/[1-9]/.test(text);
  }

  function signed(text, value, opts) {
    let out = text;
    if (/^[-\u2212]/.test(out)) out = looksZero(out) ? out.slice(1) : MINUS + out.slice(1);
    if (opts.signed && value > 0 && !looksZero(out)) out = '+' + out;
    return out;
  }

  /**
   * number(1263.25, { decimals: 1 }) -> '1 263,3' (cs, NBSP grouping) / '1,263.3' (en).
   * Options: decimals (fixed) | minDecimals + maxDecimals (default 0..2), grouping (default true),
   * signed (prefix '+'), locale, fallback. Negative numbers use the typographic minus U+2212.
   */
  function number(value, opts) {
    const o = options(opts);
    const n = toNumber(value);
    if (n === null) return fallbackOf(o);
    const [min, max] = fractionRange(o, 2);
    const text = numberFormat(localeOf(o), min, max, o.grouping !== false).format(n);
    return signed(text, n, o);
  }

  /**
   * km(63.24) -> '63,2' (cs) / '63.2' (en). One decimal by default so table columns line up
   * ('5,0'). Options: decimals (default 1), trim (drop trailing zeros: 5 -> '5', 5.25 -> '5,3'),
   * unit (append ' km'), grouping, signed, locale, fallback.
   */
  function km(value, opts) {
    const o = options(opts);
    const decimals = clampInt(o.decimals == null ? 1 : o.decimals, 0, 6, 1);
    const text = number(value, Object.assign({}, o, o.trim
      ? { decimals: undefined, minDecimals: 0, maxDecimals: decimals }
      : { decimals: decimals }));
    if (text === fallbackOf(o) && toNumber(value) === null) return text;
    return o.unit ? text + ' km' : text;
  }

  // ---------------------------------------------------------------- durations

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * duration(1262) -> '21:02'; duration(4180) -> '1:09:40' (never '69:40').
   * Options: forceHours ('0:21:02'), signed ('+0:12'), locale (unused), fallback.
   */
  function duration(seconds, opts) {
    const o = options(opts);
    const s = toNumber(seconds);
    if (s === null) return fallbackOf(o);
    const total = Math.round(Math.abs(s));
    const sign = total === 0 ? '' : s < 0 ? MINUS : o.signed ? '+' : '';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0 || o.forceHours) return sign + h + ':' + pad2(m) + ':' + pad2(sec);
    return sign + m + ':' + pad2(sec);
  }

  /**
   * durationWords(20400) -> '5 h 40 min' (same in cs and en). Rounds to whole minutes,
   * '45 s' under a minute, '2 h' when the minutes are zero.
   * Options: seconds (keep seconds: '21 min 2 s'), locale, fallback.
   */
  function durationWords(seconds, opts) {
    const o = options(opts);
    const s = toNumber(seconds);
    if (s === null) return fallbackOf(o);
    const total = Math.round(Math.abs(s));
    const sign = s < 0 && total > 0 ? MINUS : '';
    const parts = [];
    if (o.seconds) {
      const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
      if (h) parts.push(h + ' h');
      if (m) parts.push(m + ' min');
      if (sec || !parts.length) parts.push(sec + ' s');
    } else if (total < 60) {
      parts.push(total + ' s');
    } else {
      const minutes = Math.round(total / 60);
      const h = Math.floor(minutes / 60), m = minutes % 60;
      if (h) parts.push(h + ' h');
      if (m || !h) parts.push(m + ' min');
    }
    return sign + parts.join(' ');
  }

  /** pace(252) -> '4:12'. Options: unit (append ' /km'), fallback. Non-positive -> fallback. */
  function pace(secPerKm, opts) {
    const o = options(opts);
    const s = toNumber(secPerKm);
    if (s === null || s <= 0) return fallbackOf(o);
    const r = Math.round(s);
    const text = Math.floor(r / 60) + ':' + pad2(r % 60);
    return o.unit ? text + ' /km' : text;
  }

  /**
   * parseDuration('21:02') -> 1262, parseDuration('1:09:40') -> 4180, parseDuration('69:40') -> 4180.
   * Accepts 'm:ss' / 'mm:ss' / 'mmm:ss' and 'h:mm:ss' (surrounding whitespace allowed).
   * Returns null for anything else (empty, '21:2', '1:60:00', '21.02', numbers).
   */
  function parseDuration(text) {
    if (typeof text !== 'string') return null;
    const match = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
    if (!match) return null;
    const a = Number(match[1]), b = Number(match[2]);
    if (match[3] === undefined) return b > 59 ? null : a * 60 + b;
    const c = Number(match[3]);
    return b > 59 || c > 59 ? null : a * 3600 + b * 60 + c;
  }

  // ---------------------------------------------------------------- calendar keys

  /**
   * 'YYYY-MM-DD' (or a string starting with it followed by 'T'/' ', or a Date) -> local Date at
   * 12:00, or null when invalid ('2026-02-30', '24.11.2026', ...). Never parses ISO strings.
   */
  function parseDateKey(value) {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime())
        ? new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12) : null;
    }
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value.trim());
    if (!match) return null;
    const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    const date = new Date(y, m - 1, d, 12);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
  }

  /** Local Date -> 'YYYY-MM-DD' (null when invalid). */
  function toDateKey(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function utcDay(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /** Calendar days from `fromKey` to `toKey` (positive when toKey is later), DST-safe. */
  function daysBetween(fromKey, toKey) {
    const a = parseDateKey(fromKey), b = parseDateKey(toKey);
    if (!a || !b) return null;
    return Math.round((utcDay(b) - utcDay(a)) / DAY_MS);
  }

  /** addDays('2026-11-24', 6) -> '2026-11-30'. */
  function addDays(dateKey, days) {
    const date = parseDateKey(dateKey);
    const n = Math.trunc(Number(days));
    if (!date || !Number.isFinite(n)) return null;
    return toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12));
  }

  /** 0 = Monday ... 6 = Sunday (the VeyvoTraining / profile.days convention); null if invalid. */
  function weekdayIndex(dateKey) {
    const date = parseDateKey(dateKey);
    return date ? (date.getDay() + 6) % 7 : null;
  }

  function isoWeekParts(dateKey) {
    const date = parseDateKey(dateKey);
    if (!date) return null;
    const day = utcDay(date);
    const weekday = (new Date(day).getUTCDay() + 6) % 7;
    const thursday = new Date(day + (3 - weekday) * DAY_MS);
    const year = thursday.getUTCFullYear();
    const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7);
    return { year: year, week: week };
  }

  /** ISO 8601 week number (1-53): isoWeek('2026-11-26') -> 48. */
  function isoWeek(dateKey) {
    const parts = isoWeekParts(dateKey);
    return parts ? parts.week : null;
  }

  /** ISO week-numbering year: isoWeekYear('2027-01-01') -> 2026. */
  function isoWeekYear(dateKey) {
    const parts = isoWeekParts(dateKey);
    return parts ? parts.year : null;
  }

  // ---------------------------------------------------------------- date names

  const nameCache = new Map();
  function names(locale) {
    let cached = nameCache.get(locale);
    if (cached) return cached;
    const tag = INTL_LOCALE[locale];
    const fmt = function (opts) { return new Intl.DateTimeFormat(tag, opts); };
    const wdShort = fmt({ weekday: 'short' }), wdLong = fmt({ weekday: 'long' });
    const monShort = fmt({ month: 'short' }), monLong = fmt({ month: 'long' });
    const dayMonthLong = fmt({ day: 'numeric', month: 'long' });
    const weekdays = [], months = [];
    for (let i = 0; i < 7; i++) weekdays.push(new Date(2024, 0, 1 + i, 12)); // 1 Jan 2024 = Monday
    for (let i = 0; i < 12; i++) months.push(new Date(2024, i, 15, 12));
    cached = {
      weekdayShort: weekdays.map(function (d) { return wdShort.format(d); }),
      weekdayLong: weekdays.map(function (d) { return wdLong.format(d); }),
      // English abbreviations are always the first three letters; newer CLDR writes 'Sept' for en-GB
      // and older WebView ICU 'Sep', so pin the short form for identical output on every shell.
      monthShort: months.map(function (d) {
        const name = monShort.format(d).replace(/\.$/, '');
        return locale === 'en' ? name.slice(0, 3) : name;
      }),
      monthLong: months.map(function (d) { return monLong.format(d); }),
      // Czech needs the genitive after a day number: 'listopad' -> '24. listopadu'.
      monthGenitive: months.map(function (d) {
        const part = dayMonthLong.formatToParts(d).find(function (p) { return p.type === 'month'; });
        return part ? part.value : monLong.format(d);
      })
    };
    nameCache.set(locale, cached);
    return cached;
  }

  /** Upper-cases the first letter with locale rules: capitalize('úterý') -> 'Úterý'. */
  function capitalize(text, locale) {
    const s = String(text == null ? '' : text);
    if (!s) return s;
    const first = s.codePointAt(0) > 0xffff ? s.slice(0, 2) : s.charAt(0);
    return first.toLocaleUpperCase(INTL_LOCALE[normalizeLocale(locale)]) + s.slice(first.length);
  }

  function dateParts(date, locale) {
    const n = names(locale);
    const wd = (date.getDay() + 6) % 7, mo = date.getMonth();
    return {
      d: date.getDate(), m: mo + 1, y: date.getFullYear(),
      wdShort: n.weekdayShort[wd], wdLong: n.weekdayLong[wd],
      monShort: n.monthShort[mo], monLong: n.monthLong[mo], monGen: n.monthGenitive[mo]
    };
  }

  const TEMPLATES = {
    cs: {
      short: function (p) { return p.wdShort + ' ' + p.d + '. ' + p.m + '.'; },
      dayMonth: function (p) { return p.d + '. ' + p.m + '.'; },
      dayMonthYear: function (p) { return p.d + '. ' + p.m + '. ' + p.y; },
      dayMonthLong: function (p) { return p.d + '. ' + p.monGen; },
      long: function (p) { return p.wdLong + ' ' + p.d + '. ' + p.monGen; },
      longYear: function (p) { return p.wdLong + ' ' + p.d + '. ' + p.monGen + ' ' + p.y; },
      monthYear: function (p) { return p.monLong + ' ' + p.y; }
    },
    en: {
      short: function (p) { return p.wdShort + ' ' + p.d + ' ' + p.monShort; },
      dayMonth: function (p) { return p.d + ' ' + p.monShort; },
      dayMonthYear: function (p) { return p.d + ' ' + p.monShort + ' ' + p.y; },
      dayMonthLong: function (p) { return p.d + ' ' + p.monLong; },
      long: function (p) { return p.wdLong + ' ' + p.d + ' ' + p.monLong; },
      longYear: function (p) { return p.wdLong + ' ' + p.d + ' ' + p.monLong + ' ' + p.y; },
      monthYear: function (p) { return p.monLong + ' ' + p.y; }
    }
  };
  const SHARED_TEMPLATES = {
    weekday: function (p) { return p.wdShort; },
    weekdayLong: function (p) { return p.wdLong; },
    month: function (p) { return p.monLong; },
    monthShort: function (p) { return p.monShort; },
    iso: function (p) { return p.y + '-' + pad2(p.m) + '-' + pad2(p.d); }
  };

  /**
   * date('2026-11-24', style)
   *   short        'út 24. 11.'              'Tue 24 Nov'           (default)
   *   dayMonth     '24. 11.'                 '24 Nov'
   *   dayMonthYear '24. 11. 2026'            '24 Nov 2026'
   *   dayMonthLong '24. listopadu'           '24 November'
   *   long         'úterý 24. listopadu'     'Tuesday 24 November'
   *   longYear     'úterý 24. listopadu 2026' 'Tuesday 24 November 2026'
   *   weekday      'út'                      'Tue'
   *   weekdayLong  'úterý'                   'Tuesday'
   *   month        'listopad'                'November'
   *   monthShort   'lis'                     'Nov'
   *   monthYear    'listopad 2026'           'November 2026'
   *   iso          '2026-11-24'
   * Unknown styles fall back to 'short'. Options: capitalize, locale, fallback.
   */
  function date(dateKey, style, opts) {
    const o = options(opts);
    const parsed = parseDateKey(dateKey);
    if (!parsed) return fallbackOf(o);
    const locale = localeOf(o);
    const key = typeof style === 'string' && DATE_STYLES.indexOf(style) >= 0 ? style : 'short';
    const template = TEMPLATES[locale][key] || SHARED_TEMPLATES[key];
    const text = template(dateParts(parsed, locale));
    return o.capitalize ? capitalize(text, locale) : text;
  }

  /**
   * weekRange('2026-11-23', '2026-11-29') -> '23.–29. 11.' / '23–29 Nov'
   * across months  '26. 10. – 1. 11.' / '26 Oct – 1 Nov'
   * across years   '28. 12. 2026 – 3. 1. 2027' / '28 Dec 2026 – 3 Jan 2027'
   * endKey defaults to startKey + 6 days; reversed input is swapped.
   * Options: year (always show the year), locale, fallback.
   */
  function weekRange(startKey, endKey, opts) {
    const o = options(opts);
    let start = parseDateKey(startKey);
    let end = endKey == null || endKey === '' ? parseDateKey(addDays(startKey, 6)) : parseDateKey(endKey);
    if (!start || !end) return fallbackOf(o);
    if (utcDay(end) < utcDay(start)) { const swap = start; start = end; end = swap; }
    const locale = localeOf(o);
    const a = dateParts(start, locale), b = dateParts(end, locale);
    const sameYear = a.y === b.y, sameMonth = sameYear && a.m === b.m;
    if (locale === 'cs') {
      if (sameMonth && a.d === b.d) return a.d + '. ' + a.m + '.' + (o.year ? ' ' + a.y : '');
      if (sameMonth) return a.d + '.\u2013' + b.d + '. ' + b.m + '.' + (o.year ? ' ' + b.y : '');
      if (sameYear && !o.year) return a.d + '. ' + a.m + '. \u2013 ' + b.d + '. ' + b.m + '.';
      if (sameYear) return a.d + '. ' + a.m + '. \u2013 ' + b.d + '. ' + b.m + '. ' + b.y;
      return a.d + '. ' + a.m + '. ' + a.y + ' \u2013 ' + b.d + '. ' + b.m + '. ' + b.y;
    }
    if (sameMonth && a.d === b.d) return a.d + ' ' + a.monShort + (o.year ? ' ' + a.y : '');
    if (sameMonth) return a.d + '\u2013' + b.d + ' ' + b.monShort + (o.year ? ' ' + b.y : '');
    if (sameYear) return a.d + ' ' + a.monShort + ' \u2013 ' + b.d + ' ' + b.monShort + (o.year ? ' ' + b.y : '');
    return a.d + ' ' + a.monShort + ' ' + a.y + ' \u2013 ' + b.d + ' ' + b.monShort + ' ' + b.y;
  }

  // ---------------------------------------------------------------- plurals

  const PLURAL_CATEGORIES = Object.freeze(['zero', 'one', 'two', 'few', 'many', 'other']);
  const pluralRules = new Map();

  function pluralRulesFor(locale, min, max) {
    if (typeof Intl === 'undefined' || typeof Intl.PluralRules !== 'function') return null;
    const key = locale + '|' + min + '|' + max;
    let rules = pluralRules.get(key);
    if (!rules) {
      rules = new Intl.PluralRules(INTL_LOCALE[locale], { minimumFractionDigits: min, maximumFractionDigits: max });
      pluralRules.set(key, rules);
    }
    return rules;
  }

  /** CLDR rules for cs/en, used when Intl.PluralRules is unavailable (very old WebViews). */
  function fallbackPluralCategory(value, locale, min, max) {
    let text = Math.abs(value).toFixed(max);
    if (text.indexOf('.') >= 0) {
      while (/0$/.test(text) && text.split('.')[1].length > min) text = text.slice(0, -1);
      text = text.replace(/\.$/, '');
    }
    const parts = text.split('.');
    const i = Number(parts[0]), v = parts[1] ? parts[1].length : 0;
    if (locale === 'cs') {
      if (v > 0) return 'many';
      if (i === 1) return 'one';
      return i >= 2 && i <= 4 ? 'few' : 'other';
    }
    return i === 1 && v === 0 ? 'one' : 'other';
  }

  /**
   * Parses a number or a displayed numeric string -> { value, decimals }.
   * cs: '1,5' / '5,0' / '1 263' (comma or dot = decimals); en: '1.5' / '1,263' (comma = grouping).
   */
  function pluralOperand(n, locale) {
    if (typeof n === 'number') return Number.isFinite(n) ? { value: n, decimals: null } : null;
    if (typeof n !== 'string') return null;
    let text = n.trim().replace(/^\u2212/, '-').replace(/[\s\u00a0\u202f]/g, '');
    text = locale === 'en' ? text.replace(/,(?=\d{3}(\D|$))/g, '') : text.replace(',', '.');
    if (!/^[-+]?\d+(\.\d+)?$/.test(text)) return null;
    const fraction = text.split('.')[1];
    return { value: Number(text), decimals: fraction ? fraction.length : 0 };
  }

  /**
   * Plural category of n for the locale. cs: 'one' | 'few' | 'many' | 'other' ('many' = decimals,
   * '1,5 kilometru'); en: 'one' | 'other'. A numeric string keeps its visible decimals ('5,0' ->
   * 'many'). Options: decimals (as displayed), locale.
   */
  function pluralCategory(n, opts) {
    const o = options(opts);
    const locale = localeOf(o);
    const operand = pluralOperand(n, locale);
    if (!operand) return 'other';
    let min, max;
    if (o.decimals != null) min = max = clampInt(o.decimals, 0, 10, 0);
    else if (operand.decimals != null) min = max = operand.decimals;
    else { min = 0; max = 2; }
    const value = Math.abs(operand.value);
    const rules = pluralRulesFor(locale, min, max);
    return rules ? rules.select(value) : fallbackPluralCategory(value, locale, min, max);
  }

  function isPluralForms(forms) {
    if (!forms || typeof forms !== 'object' || Array.isArray(forms)) return false;
    const keys = Object.keys(forms);
    return keys.length > 0 && keys.every(function (k) { return PLURAL_CATEGORIES.indexOf(k) >= 0; });
  }

  /**
   * plural(n, forms) -> the matching form; '{n}' inside the form is replaced by the locale number.
   *   plural(2, { one: 'běh', few: 'běhy', many: 'běhu', other: 'běhů' }) -> 'běhy'
   *   plural(5, { one: '{n} run', other: '{n} runs' }, 'en') -> '5 runs'
   * forms may also be keyed by locale: { cs: {...}, en: {...} }. An optional `zero` form is used
   * for exactly 0. Missing categories fall back to `other`. Options: decimals, locale.
   */
  function plural(n, forms, opts) {
    const o = options(opts);
    const locale = localeOf(o);
    let set = forms;
    if (set && typeof set === 'object' && !isPluralForms(set) && (set.cs || set.en)) set = set[locale] || set.cs || set.en;
    if (!isPluralForms(set)) return '';
    let form;
    if (typeof set.zero === 'string' && (n === 0 || (typeof n === 'string' && n.trim() === '0'))) form = set.zero;
    else {
      const category = pluralCategory(n, o);
      form = typeof set[category] === 'string' ? set[category] : set.other;
      if (typeof form !== 'string') form = set.one || '';
    }
    if (form.indexOf('{n}') < 0) return form;
    const shown = typeof n === 'string' ? n.trim()
      : number(n, { locale: locale, grouping: false, decimals: o.decimals, maxDecimals: 2 });
    return form.split('{n}').join(shown);
  }

  // ---------------------------------------------------------------- relative days

  const relativeFormats = new Map();
  function relativeFormat(locale, numeric) {
    if (typeof Intl === 'undefined' || typeof Intl.RelativeTimeFormat !== 'function') return null;
    const key = locale + '|' + numeric;
    let format = relativeFormats.get(key);
    if (!format) {
      format = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: numeric });
      relativeFormats.set(key, format);
    }
    return format;
  }

  const RELATIVE_FALLBACK = {
    cs: {
      0: 'dnes', 1: 'zítra', '-1': 'včera',
      future: { one: 'za {n} den', few: 'za {n} dny', many: 'za {n} dne', other: 'za {n} dní' },
      past: { one: 'před {n} dnem', few: 'před {n} dny', many: 'před {n} dne', other: 'před {n} dny' }
    },
    en: {
      0: 'today', 1: 'tomorrow', '-1': 'yesterday',
      future: { one: 'in {n} day', other: 'in {n} days' },
      past: { one: '{n} day ago', other: '{n} days ago' }
    }
  };

  /**
   * relativeDay('2026-11-27', '2026-11-24') -> 'za 3 dny' / 'in 3 days'.
   * 0 'dnes'/'today', +1 'zítra'/'tomorrow', -1 'včera'/'yesterday', otherwise numeric
   * ('před 2 dny', 'za 5 dní' / '2 days ago', 'in 5 days'). todayKey is required.
   * Options: capitalize, locale, fallback.
   */
  function relativeDay(dateKey, todayKey, opts) {
    const o = options(opts);
    const diff = daysBetween(todayKey, dateKey);
    if (diff === null) return fallbackOf(o);
    const locale = localeOf(o);
    const near = Math.abs(diff) <= 1;
    const format = relativeFormat(locale, near ? 'auto' : 'always');
    let text;
    if (format) text = format.format(diff, 'day');
    else if (near) text = RELATIVE_FALLBACK[locale][diff];
    else text = plural(Math.abs(diff), RELATIVE_FALLBACK[locale][diff > 0 ? 'future' : 'past'], { locale: locale });
    return o.capitalize ? capitalize(text, locale) : text;
  }

  // ---------------------------------------------------------------- exports

  const api = {
    LOCALES: LOCALES,
    DATE_STYLES: DATE_STYLES,
    EMPTY: EMPTY,
    MINUS: MINUS,
    setLocale: setLocale,
    getLocale: getLocale,
    normalizeLocale: normalizeLocale,
    intlLocale: intlLocale,
    number: number,
    km: km,
    duration: duration,
    durationWords: durationWords,
    pace: pace,
    parseDuration: parseDuration,
    date: date,
    weekRange: weekRange,
    relativeDay: relativeDay,
    pluralCategory: pluralCategory,
    plural: plural,
    isoWeek: isoWeek,
    isoWeekYear: isoWeekYear,
    parseDateKey: parseDateKey,
    toDateKey: toDateKey,
    addDays: addDays,
    daysBetween: daysBetween,
    weekdayIndex: weekdayIndex,
    capitalize: capitalize,
    _fallbackPluralCategory: fallbackPluralCategory
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VeyvoFormat = api;
})(globalThis);
