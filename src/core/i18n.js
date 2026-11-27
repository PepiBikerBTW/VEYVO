/*
 * VeyvoI18n - Czech + English dictionaries for VEYVO.
 *
 * Classic UMD script; load src/core/format.js first. DOM-free except apply(root), which only
 * touches the root object it is given (works with a tiny fake DOM in tests).
 *
 *   VeyvoI18n.register('runs', { cs: { title: 'Běhy', count: { one: '{n} běh', few: '{n} běhy',
 *     many: '{n} běhu', other: '{n} běhů' } }, en: { title: 'Runs', count: { one: '{n} run',
 *     other: '{n} runs' } } });
 *   VeyvoI18n.t('runs.count', { n: 2 })  -> '2 běhy'
 *
 * Dictionaries may be nested (flattened to dotted keys) and may contain arrays (index keys:
 * 'common.weekdayShort.1' -> 'út'). A leaf is a string, a plural object whose keys are CLDR
 * categories and include `other` ({ zero?, one, few, many, other }), or a function
 * (params, locale) -> template string. Lookup order: current locale -> 'cs' -> the key itself.
 */
(function (root) {
  'use strict';

  const Format = root.VeyvoFormat || (typeof require === 'function' ? require('./format.js') : null);
  if (!Format) throw new Error('VeyvoI18n needs VeyvoFormat: load src/core/format.js first.');

  const LOCALES = Format.LOCALES;
  const FALLBACK_LOCALE = 'cs';
  const PLURAL_KEYS = ['zero', 'one', 'two', 'few', 'many', 'other'];
  const REQUIRED_PLURALS = { cs: ['one', 'few', 'many', 'other'], en: ['one', 'other'] };
  const BLOCKED_ATTRIBUTES = /^(on|srcdoc$|style$)/i;

  const dictionaries = Object.create(null);
  LOCALES.forEach(function (l) { dictionaries[l] = Object.create(null); });
  const changeListeners = [];
  const missingListeners = [];
  let locale = Format.getLocale();

  // ---------------------------------------------------------------- registration

  function isPluralEntry(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    return typeof value.other === 'string' && keys.every(function (k) {
      return PLURAL_KEYS.indexOf(k) >= 0 && typeof value[k] === 'string';
    });
  }

  function put(target, key, value) {
    if (typeof value === 'string' || typeof value === 'function') target[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') target[key] = String(value);
    else if (Array.isArray(value)) value.forEach(function (item, i) { put(target, key + '.' + i, item); });
    else if (isPluralEntry(value)) target[key] = Object.freeze(Object.assign({}, value));
    else if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (k) { put(target, key + '.' + k, value[k]); });
    }
  }

  /**
   * register(namespace, { cs: {...}, en: {...} }) merges into existing dictionaries
   * (later registrations win per key). Namespace: letters, digits, '_' or '-' (no dots).
   */
  function register(namespace, byLocale) {
    if (typeof namespace !== 'string' || !/^[A-Za-z0-9_-]+$/.test(namespace)) {
      throw new TypeError('VeyvoI18n.register: invalid namespace "' + namespace + '"');
    }
    if (!byLocale || typeof byLocale !== 'object') {
      throw new TypeError('VeyvoI18n.register: expected { cs: {...}, en: {...} } for "' + namespace + '"');
    }
    Object.keys(byLocale).forEach(function (code) {
      const target = dictionaries[code];
      if (!target) throw new TypeError('VeyvoI18n.register: unsupported locale "' + code + '" in "' + namespace + '"');
      const dict = byLocale[code];
      if (dict == null) return;
      if (typeof dict !== 'object' || Array.isArray(dict)) {
        throw new TypeError('VeyvoI18n.register: dictionary for "' + code + '" in "' + namespace + '" must be an object');
      }
      Object.keys(dict).forEach(function (k) { put(target, namespace + '.' + k, dict[k]); });
    });
  }

  // ---------------------------------------------------------------- lookup

  function own(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  }

  function notifyMissing(info) {
    missingListeners.slice().forEach(function (cb) {
      try { cb(info); } catch (error) { /* a broken dev hook must never break rendering */ }
    });
  }

  function resolve(key, loc) {
    const k = String(key);
    let entry = own(dictionaries[loc], k);
    if (entry !== undefined) return { entry: entry, locale: loc };
    if (loc !== FALLBACK_LOCALE) {
      entry = own(dictionaries[FALLBACK_LOCALE], k);
      if (entry !== undefined) {
        notifyMissing({ key: k, locale: loc, resolvedLocale: FALLBACK_LOCALE });
        return { entry: entry, locale: FALLBACK_LOCALE };
      }
    }
    notifyMissing({ key: k, locale: loc, resolvedLocale: null });
    return null;
  }

  function localeArg(value) {
    return value == null ? locale : Format.normalizeLocale(value, locale);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function countOf(params) {
    if (!params || typeof params !== 'object') return undefined;
    return params.n !== undefined ? params.n : params.count;
  }

  function selectPlural(entry, params, entryLocale) {
    const count = countOf(params);
    if (count === undefined || count === null) return entry.other;
    if (typeof entry.zero === 'string' && (count === 0 || String(count).trim() === '0')) return entry.zero;
    const category = Format.pluralCategory(count, { locale: entryLocale });
    return typeof entry[category] === 'string' ? entry[category] : entry.other;
  }

  function interpolate(template, params, entryLocale, html) {
    const text = String(template);
    if (!params || typeof params !== 'object') return text;
    return text.replace(/\{([A-Za-z0-9_]+)\}/g, function (match, name) {
      if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
      const value = params[name];
      const shown = typeof value === 'number'
        ? Format.number(value, { locale: entryLocale, grouping: false, maxDecimals: 2, fallback: '' })
        : value == null ? '' : String(value);
      return html ? escapeHtml(shown) : shown;
    });
  }

  function render(found, params, html) {
    const entry = found.entry;
    let template;
    let values = params;
    if (typeof entry === 'function') template = entry(params || {}, found.locale);
    else if (typeof entry === 'object') {
      template = selectPlural(entry, params, found.locale);
      // {n} and {count} are interchangeable inside plural forms.
      const count = countOf(params);
      if (count !== undefined) values = Object.assign({}, params, { n: count, count: count });
    } else template = entry;
    return interpolate(template == null ? '' : template, values, found.locale, html);
  }

  /**
   * t('ns.key', params?, locale?) -> plain text. {name} placeholders are filled from params
   * (numbers use the locale decimal separator, no grouping); unknown placeholders stay visible.
   * Plural entries use params.n (or params.count). A missing key returns the key itself.
   */
  function t(key, params, localeOverride) {
    const found = resolve(key, localeArg(localeOverride));
    return found ? render(found, params, false) : String(key);
  }

  /**
   * html('ns.key', params?, locale?) -> markup for trusted dictionary strings; every
   * interpolated param is HTML-escaped and a missing key comes back escaped.
   */
  function html(key, params, localeOverride) {
    const found = resolve(key, localeArg(localeOverride));
    return found ? render(found, params, true) : escapeHtml(key);
  }

  /** has('ns.key', locale?) -> true when t() would find it (current locale or the cs fallback). */
  function has(key, localeOverride) {
    const loc = localeArg(localeOverride);
    const k = String(key);
    return own(dictionaries[loc], k) !== undefined || own(dictionaries[FALLBACK_LOCALE], k) !== undefined;
  }

  // ---------------------------------------------------------------- locale + subscriptions

  function getLocale() {
    return locale;
  }

  /**
   * setLocale('cs' | 'en' | 'en-GB' ...) switches the language, keeps VeyvoFormat in sync and
   * calls onChange subscribers (locale, previous) when it actually changes. All subscribers run
   * even if one throws; the first error is rethrown afterwards.
   */
  function setLocale(value) {
    const next = Format.normalizeLocale(value, null);
    if (!next) return locale;
    Format.setLocale(next);
    if (next === locale) return locale;
    const previous = locale;
    locale = next;
    let failure = null;
    changeListeners.slice().forEach(function (cb) {
      try { cb(next, previous); } catch (error) { if (!failure) failure = error; }
    });
    if (failure) throw failure;
    return locale;
  }

  function subscribe(list, cb) {
    if (typeof cb !== 'function') throw new TypeError('VeyvoI18n: listener must be a function');
    list.push(cb);
    return function unsubscribe() {
      const index = list.indexOf(cb);
      if (index >= 0) list.splice(index, 1);
    };
  }

  /** onChange(cb(locale, previous)) -> unsubscribe(). */
  function onChange(cb) {
    return subscribe(changeListeners, cb);
  }

  /**
   * onMissing(cb({ key, locale, resolvedLocale })) -> unsubscribe(). Dev warning hook:
   * resolvedLocale 'cs' = fell back to Czech, null = nothing found (the key was shown).
   */
  function onMissing(cb) {
    return subscribe(missingListeners, cb);
  }

  // ---------------------------------------------------------------- DOM binding

  function attr(el, name) {
    return el && typeof el.getAttribute === 'function' ? el.getAttribute(name) : null;
  }

  function elementsWith(rootNode, name) {
    const list = [];
    if (attr(rootNode, name) != null) list.push(rootNode);
    const found = rootNode.querySelectorAll('[' + name + ']');
    for (let i = 0; i < found.length; i++) list.push(found[i]);
    return list;
  }

  function paramsOf(el) {
    const raw = attr(el, 'data-i18n-params');
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch (error) {
      return undefined;
    }
  }

  /** Parses 'placeholder:ns.key;aria-label:ns.key2' -> [['placeholder', 'ns.key'], ...]. */
  function parseAttrSpec(spec) {
    return String(spec || '').split(';').map(function (pair) {
      const index = pair.indexOf(':');
      if (index < 1) return null;
      const name = pair.slice(0, index).trim(), key = pair.slice(index + 1).trim();
      if (!key || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name) || BLOCKED_ATTRIBUTES.test(name)) return null;
      return [name, key];
    }).filter(Boolean);
  }

  /**
   * apply(root) translates root and its descendants:
   *   [data-i18n="ns.key"]                          -> textContent
   *   [data-i18n-attr="placeholder:ns.a;title:ns.b"] -> attributes (on* / style / srcdoc refused)
   *   [data-i18n-html="ns.key"]                     -> innerHTML from the trusted dictionary only
   *                                                    (params escaped; a missing key is set as text)
   *   [data-i18n-params='{"n":3}']                  -> params for all of the above
   * A Document root also gets <html lang>. Returns the number of elements updated.
   */
  function apply(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return 0;
    let updated = 0;
    elementsWith(rootNode, 'data-i18n').forEach(function (el) {
      const key = attr(el, 'data-i18n');
      if (!key) return;
      el.textContent = t(key, paramsOf(el));
      updated++;
    });
    elementsWith(rootNode, 'data-i18n-attr').forEach(function (el) {
      const pairs = parseAttrSpec(attr(el, 'data-i18n-attr'));
      if (!pairs.length) return;
      const params = paramsOf(el);
      pairs.forEach(function (pair) { el.setAttribute(pair[0], t(pair[1], params)); });
      updated++;
    });
    elementsWith(rootNode, 'data-i18n-html').forEach(function (el) {
      const key = attr(el, 'data-i18n-html');
      if (!key) return;
      const found = resolve(key, locale);
      if (found) el.innerHTML = render(found, paramsOf(el), true);
      else el.textContent = key;
      updated++;
    });
    const docEl = rootNode.documentElement;
    if (docEl && typeof docEl.setAttribute === 'function') docEl.setAttribute('lang', locale);
    return updated;
  }

  // ---------------------------------------------------------------- dev tooling

  /** Sorted registered keys (union of all locales), optionally limited to one namespace. */
  function keys(namespace) {
    const prefix = namespace ? namespace + '.' : '';
    const all = {};
    LOCALES.forEach(function (l) {
      Object.keys(dictionaries[l]).forEach(function (k) { if (!prefix || k.indexOf(prefix) === 0) all[k] = true; });
    });
    return Object.keys(all).sort();
  }

  function placeholders(entry) {
    const texts = typeof entry === 'string' ? [entry]
      : entry && typeof entry === 'object' ? Object.keys(entry).map(function (k) { return entry[k]; }) : [];
    const found = {};
    texts.forEach(function (text) {
      (String(text).match(/\{[A-Za-z0-9_]+\}/g) || []).forEach(function (p) { found[p] = true; });
    });
    return Object.keys(found).sort().join(',');
  }

  /**
   * audit(namespace?) -> { missing: { cs: [...], en: [...] }, incompletePlurals: [{ key, locale,
   * missing }], placeholderMismatch: [key] }. Use in tests to keep both languages complete.
   */
  function audit(namespace) {
    const report = { missing: {}, incompletePlurals: [], placeholderMismatch: [] };
    LOCALES.forEach(function (l) { report.missing[l] = []; });
    keys(namespace).forEach(function (k) {
      LOCALES.forEach(function (l) {
        const entry = own(dictionaries[l], k);
        if (entry === undefined) { report.missing[l].push(k); return; }
        if (entry && typeof entry === 'object') {
          const lacking = (REQUIRED_PLURALS[l] || ['other']).filter(function (c) { return typeof entry[c] !== 'string'; });
          if (lacking.length) report.incompletePlurals.push({ key: k, locale: l, missing: lacking });
        }
      });
      const signatures = LOCALES.map(function (l) { return own(dictionaries[l], k); })
        .filter(function (e) { return e !== undefined && typeof e !== 'function'; })
        .map(placeholders);
      if (signatures.some(function (s) { return s !== signatures[0]; })) report.placeholderMismatch.push(k);
    });
    return report;
  }

  // ---------------------------------------------------------------- shared words

  register('common', {
    cs: {
      appName: 'VEYVO',
      today: 'Dnes', tomorrow: 'Zítra', yesterday: 'Včera',
      weekdayShort: ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'],
      weekdayMin: ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'],
      weekdayLong: ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'],
      onWeekday: ['v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu', 'v neděli'],
      monthLong: ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'],
      monthShort: ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'],
      runType: {
        run: 'Běh', easy: 'Lehký běh', long: 'Dlouhý běh', tempo: 'Tempo',
        intervals: 'Intervaly', test5k: 'Test 5 km', race: 'Závod'
      },
      runTypeShort: {
        run: 'Běh', easy: 'Lehký', long: 'Dlouhý', tempo: 'Tempo',
        intervals: 'Intervaly', test5k: 'Test', race: 'Závod'
      },
      source: { manual: 'Zapsáno ručně', strava: 'Strava' },
      field: {
        date: 'Datum', startTime: 'Začátek', type: 'Typ běhu', distance: 'Vzdálenost', time: 'Čas',
        pace: 'Tempo', effort: 'Námaha', note: 'Poznámka', avgHeartRate: 'Průměrný tep',
        elevationGain: 'Převýšení', sleep: 'Spánek', fatigue: 'Únava', soreness: 'Bolest svalů'
      },
      unit: {
        km: 'km', m: 'm', h: 'h', min: 'min', s: 's', perKm: '/km', bpm: 'tep/min',
        kmPerWeek: 'km/týden', percent: '%'
      },
      count: {
        runs: { one: '{n} běh', few: '{n} běhy', many: '{n} běhu', other: '{n} běhů' },
        workouts: { one: '{n} trénink', few: '{n} tréninky', many: '{n} tréninku', other: '{n} tréninků' },
        days: { one: '{n} den', few: '{n} dny', many: '{n} dne', other: '{n} dní' },
        weeks: { one: '{n} týden', few: '{n} týdny', many: '{n} týdne', other: '{n} týdnů' },
        km: { one: '{n} kilometr', few: '{n} kilometry', many: '{n} kilometru', other: '{n} kilometrů' },
        hours: { one: '{n} hodina', few: '{n} hodiny', many: '{n} hodiny', other: '{n} hodin' },
        minutes: { one: '{n} minuta', few: '{n} minuty', many: '{n} minuty', other: '{n} minut' },
        seconds: { one: '{n} sekunda', few: '{n} sekundy', many: '{n} sekundy', other: '{n} sekund' }
      },
      button: {
        save: 'Uložit', cancel: 'Zrušit', close: 'Zavřít', delete: 'Smazat', edit: 'Upravit', back: 'Zpět',
        add: 'Přidat', confirm: 'Potvrdit', next: 'Další', done: 'Hotovo', retry: 'Zkusit znovu',
        continue: 'Pokračovat', export: 'Exportovat', import: 'Importovat', copy: 'Kopírovat',
        showAll: 'Zobrazit vše', yes: 'Ano', no: 'Ne', connect: 'Připojit', disconnect: 'Odpojit',
        sync: 'Synchronizovat'
      },
      status: {
        saved: 'Uloženo', saving: 'Ukládám…', deleted: 'Smazáno', copied: 'Zkopírováno',
        loading: 'Načítám…', syncing: 'Synchronizuji…', error: 'Něco se nepovedlo', offline: 'Bez připojení',
        connected: 'Připojeno', disconnected: 'Odpojeno', noData: 'Zatím žádná data',
        logged: 'Zapsáno', planned: 'Naplánováno', unlogged: 'Bez záznamu', rest: 'Volno',
        pending: 'Čeká na výsledek'
      },
      language: { cs: 'Čeština', en: 'English' },
      theme: { dark: 'Tmavý režim', light: 'Světlý režim' }
    },
    en: {
      appName: 'VEYVO',
      today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday',
      weekdayShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      weekdayMin: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
      weekdayLong: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      onWeekday: ['on Monday', 'on Tuesday', 'on Wednesday', 'on Thursday', 'on Friday', 'on Saturday', 'on Sunday'],
      monthLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      monthShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      runType: {
        run: 'Run', easy: 'Easy run', long: 'Long run', tempo: 'Tempo run',
        intervals: 'Intervals', test5k: '5 km test', race: 'Race'
      },
      runTypeShort: {
        run: 'Run', easy: 'Easy', long: 'Long', tempo: 'Tempo',
        intervals: 'Intervals', test5k: 'Test', race: 'Race'
      },
      source: { manual: 'Manual entry', strava: 'Strava' },
      field: {
        date: 'Date', startTime: 'Start time', type: 'Run type', distance: 'Distance', time: 'Time',
        pace: 'Pace', effort: 'Effort', note: 'Note', avgHeartRate: 'Average heart rate',
        elevationGain: 'Elevation gain', sleep: 'Sleep', fatigue: 'Fatigue', soreness: 'Muscle soreness'
      },
      unit: {
        km: 'km', m: 'm', h: 'h', min: 'min', s: 's', perKm: '/km', bpm: 'bpm',
        kmPerWeek: 'km/week', percent: '%'
      },
      count: {
        runs: { one: '{n} run', other: '{n} runs' },
        workouts: { one: '{n} workout', other: '{n} workouts' },
        days: { one: '{n} day', other: '{n} days' },
        weeks: { one: '{n} week', other: '{n} weeks' },
        km: { one: '{n} kilometre', other: '{n} kilometres' },
        hours: { one: '{n} hour', other: '{n} hours' },
        minutes: { one: '{n} minute', other: '{n} minutes' },
        seconds: { one: '{n} second', other: '{n} seconds' }
      },
      button: {
        save: 'Save', cancel: 'Cancel', close: 'Close', delete: 'Delete', edit: 'Edit', back: 'Back',
        add: 'Add', confirm: 'Confirm', next: 'Next', done: 'Done', retry: 'Try again',
        continue: 'Continue', export: 'Export', import: 'Import', copy: 'Copy',
        showAll: 'Show all', yes: 'Yes', no: 'No', connect: 'Connect', disconnect: 'Disconnect',
        sync: 'Sync'
      },
      status: {
        saved: 'Saved', saving: 'Saving…', deleted: 'Deleted', copied: 'Copied',
        loading: 'Loading…', syncing: 'Syncing…', error: 'Something went wrong', offline: 'Offline',
        connected: 'Connected', disconnected: 'Disconnected', noData: 'No data yet',
        logged: 'Logged', planned: 'Planned', unlogged: 'Not logged', rest: 'Rest day',
        pending: 'Waiting for result'
      },
      language: { cs: 'Čeština', en: 'English' },
      theme: { dark: 'Dark mode', light: 'Light mode' }
    }
  });

  const api = {
    LOCALES: LOCALES,
    register: register,
    t: t,
    html: html,
    has: has,
    setLocale: setLocale,
    getLocale: getLocale,
    onChange: onChange,
    onMissing: onMissing,
    apply: apply,
    keys: keys,
    audit: audit,
    escapeHtml: escapeHtml
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VeyvoI18n = api;
})(globalThis);
