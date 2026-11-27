const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
process.env.TZ = 'Europe/Prague';
const F = require('../src/core/format.js');

const NBSP = ' ';
const MINUS = '−';
const DASH = '—';

beforeEach(() => F.setLocale('cs'));

test('locale: default cs, setLocale normalizes tags, explicit locale wins', () => {
  assert.equal(F.getLocale(), 'cs');
  assert.equal(F.setLocale('en-GB'), 'en');
  assert.equal(F.getLocale(), 'en');
  assert.equal(F.km(63.24), '63.2');
  assert.equal(F.km(63.24, 'cs'), '63,2');
  assert.equal(F.km(63.24, { locale: 'cs' }), '63,2');
  assert.equal(F.setLocale('cs_CZ'), 'cs');
  assert.equal(F.setLocale('sk'), 'cs');
  assert.equal(F.setLocale('de-DE'), 'en');
  assert.equal(F.setLocale(null), 'en', 'invalid input keeps the current locale');
  assert.equal(F.setLocale(''), 'en');
  assert.equal(F.normalizeLocale('EN'), 'en');
  assert.equal(F.normalizeLocale(undefined, 'cs'), 'cs');
  assert.equal(F.normalizeLocale(42, null), null);
  assert.equal(F.intlLocale('cs'), 'cs-CZ');
  assert.equal(F.intlLocale('en'), 'en-GB');
  assert.deepEqual([...F.LOCALES], ['cs', 'en']);
});

test('number: decimal separator, grouping, decimals, sign, invalid input', () => {
  assert.equal(F.number(63.25, { decimals: 1 }), '63,3');
  assert.equal(F.number(63.25, { decimals: 1, locale: 'en' }), '63.3');
  assert.equal(F.number(1263.2, { decimals: 1 }), '1' + NBSP + '263,2');
  assert.equal(F.number(1263.2, { decimals: 1, locale: 'en' }), '1,263.2');
  assert.equal(F.number(1263.2, { decimals: 1, grouping: false }), '1263,2');
  assert.equal(F.number(2.5), '2,5', 'default 0-2 decimals');
  assert.equal(F.number(2.456), '2,46');
  assert.equal(F.number(2), '2');
  assert.equal(F.number(2, { minDecimals: 2 }), '2,00');
  assert.equal(F.number(2.12345, { maxDecimals: 4 }), '2,1235');
  assert.equal(F.number('5.02'), '5,02', 'numeric strings from old state are accepted');
  assert.equal(F.number(-3.2), MINUS + '3,2', 'typographic minus');
  assert.equal(F.number(-0.04, { decimals: 1 }), '0,0', 'no negative zero');
  assert.equal(F.number(-0), '0');
  assert.equal(F.number(1.5, { signed: true }), '+1,5');
  assert.equal(F.number(-1.5, { signed: true, locale: 'en' }), MINUS + '1.5');
  assert.equal(F.number(0, { signed: true }), '0');
  for (const bad of [null, undefined, NaN, Infinity, '', 'abc', '1,5', {}, []]) assert.equal(F.number(bad), DASH);
  assert.equal(F.number(null, { fallback: '' }), '');
  assert.equal(F.EMPTY, DASH);
});

test('km: one decimal for tables, trim option for prose, unit option', () => {
  assert.equal(F.km(63.24), '63,2');
  assert.equal(F.km(63.24, 'en'), '63.2');
  assert.equal(F.km(5), '5,0', 'tables keep 5,0');
  assert.equal(F.km(5, 'en'), '5.0');
  assert.equal(F.km(5, { trim: true }), '5');
  assert.equal(F.km(5.04, { trim: true }), '5');
  assert.equal(F.km(5.26, { trim: true }), '5,3');
  assert.equal(F.km(3.31, { decimals: 2 }), '3,31');
  assert.equal(F.km(3.3, { decimals: 2, trim: true }), '3,3');
  assert.equal(F.km(5, { unit: true }), '5,0 km');
  assert.equal(F.km(21.0975, { unit: true, trim: true, locale: 'en' }), '21.1 km');
  assert.equal(F.km(1263.2), '1' + NBSP + '263,2');
  assert.equal(F.km(0), '0,0');
  assert.equal(F.km(null), DASH);
  assert.equal(F.km(null, { unit: true }), DASH, 'no unit after a placeholder');
  assert.equal(F.km(undefined, { fallback: '' }), '');
});

test('duration: m:ss under an hour, h:mm:ss from an hour', () => {
  assert.equal(F.duration(1262), '21:02');
  assert.equal(F.duration(1200), '20:00');
  assert.equal(F.duration(4180), '1:09:40', '69:40 must become 1:09:40');
  assert.equal(F.duration(3599), '59:59');
  assert.equal(F.duration(3600), '1:00:00');
  assert.equal(F.duration(3599.6), '1:00:00', 'rounds before choosing the layout');
  assert.equal(F.duration(20400), '5:40:00');
  assert.equal(F.duration(0), '0:00');
  assert.equal(F.duration(5), '0:05');
  assert.equal(F.duration(90061), '25:01:01');
  assert.equal(F.duration(1262, { forceHours: true }), '0:21:02');
  assert.equal(F.duration(-75), MINUS + '1:15');
  assert.equal(F.duration(12, { signed: true }), '+0:12');
  assert.equal(F.duration(-0.2, { signed: true }), '0:00');
  assert.equal(F.duration(1262, 'en'), '21:02');
  assert.equal(F.duration(null), DASH);
  assert.equal(F.duration(NaN), DASH);
});

test('durationWords: hours and minutes in words', () => {
  assert.equal(F.durationWords(20400), '5 h 40 min');
  assert.equal(F.durationWords(20400, 'en'), '5 h 40 min');
  assert.equal(F.durationWords(7200), '2 h');
  assert.equal(F.durationWords(1262), '21 min');
  assert.equal(F.durationWords(1290), '22 min', 'rounds to the nearest minute');
  assert.equal(F.durationWords(3590), '1 h');
  assert.equal(F.durationWords(45), '45 s');
  assert.equal(F.durationWords(0), '0 s');
  assert.equal(F.durationWords(1262, { seconds: true }), '21 min 2 s');
  assert.equal(F.durationWords(4180, { seconds: true }), '1 h 9 min 40 s');
  assert.equal(F.durationWords(3600, { seconds: true }), '1 h');
  assert.equal(F.durationWords(0, { seconds: true }), '0 s');
  assert.equal(F.durationWords(-600), MINUS + '10 min');
  assert.equal(F.durationWords('x'), DASH);
});

test('pace: m:ss per km', () => {
  assert.equal(F.pace(252), '4:12');
  assert.equal(F.pace(251.6), '4:12');
  assert.equal(F.pace(240), '4:00');
  assert.equal(F.pace(59.6), '1:00');
  assert.equal(F.pace(605), '10:05');
  assert.equal(F.pace(252, { unit: true }), '4:12 /km');
  assert.equal(F.pace(252, 'en'), '4:12');
  assert.equal(F.pace(0), DASH);
  assert.equal(F.pace(-10), DASH);
  assert.equal(F.pace(null), DASH);
  assert.equal(F.pace(Infinity, { fallback: '–:––' }), '–:––');
});

test('parseDuration: m:ss and h:mm:ss, strict otherwise', () => {
  assert.equal(F.parseDuration('21:02'), 1262);
  assert.equal(F.parseDuration('1:09:40'), 4180);
  assert.equal(F.parseDuration('69:40'), 4180, 'long minute counts are still accepted');
  assert.equal(F.parseDuration('0:45'), 45);
  assert.equal(F.parseDuration('0:00'), 0);
  assert.equal(F.parseDuration(' 20:00 '), 1200);
  assert.equal(F.parseDuration('0:21:02'), 1262);
  assert.equal(F.parseDuration('10:00:00'), 36000);
  for (const bad of ['', '21', '21:2', '21:60', '1:60:00', '1:00:60', '21.02', '21,02', '-1:00', '1:2:3', 'abc', '21:02:', '1234:00']) {
    assert.equal(F.parseDuration(bad), null, JSON.stringify(bad));
  }
  assert.equal(F.parseDuration(1262), null);
  assert.equal(F.parseDuration(null), null);
  // Round trip with the formatter.
  for (const s of [0, 59, 61, 1200, 1262, 3599, 3600, 4180, 20400]) assert.equal(F.parseDuration(F.duration(s)), s);
});

test('date keys: strict local parsing, arithmetic, weekday index', () => {
  const d = F.parseDateKey('2026-11-24');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getDate(), 24);
  assert.equal(F.parseDateKey('2026-11-24T19:30:00Z').getDate(), 24, 'Strava fake-Z date is sliced, not converted');
  assert.equal(F.parseDateKey('2026-11-24T00:00:00').getDate(), 24);
  assert.equal(F.parseDateKey(new Date(2026, 10, 24, 23, 59)).getDate(), 24);
  for (const bad of ['2026-02-30', '2026-13-01', '2026-11-4', '24.11.2026', '2026/11/24', '', null, 20261124, new Date(NaN), '2026-11-24x']) {
    assert.equal(F.parseDateKey(bad), null, String(bad));
  }
  assert.ok(F.parseDateKey('2028-02-29'));
  assert.equal(F.parseDateKey('2027-02-29'), null);
  assert.equal(F.toDateKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(F.toDateKey(new Date(NaN)), null);
  assert.equal(F.addDays('2026-11-24', 6), '2026-11-30');
  assert.equal(F.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(F.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(F.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(F.addDays('2026-03-28', 2), '2026-03-30', 'across spring DST');
  assert.equal(F.addDays('2026-10-24', 2), '2026-10-26', 'across autumn DST');
  assert.equal(F.addDays('nope', 1), null);
  assert.equal(F.daysBetween('2026-11-24', '2026-11-27'), 3);
  assert.equal(F.daysBetween('2026-11-27', '2026-11-24'), -3);
  assert.equal(F.daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(F.daysBetween('2026-10-24', '2026-10-26'), 2);
  assert.equal(F.daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(F.daysBetween('x', '2026-01-01'), null);
  assert.equal(F.weekdayIndex('2026-11-23'), 0, 'Monday');
  assert.equal(F.weekdayIndex('2026-11-24'), 1, 'Tuesday = profile.days 1');
  assert.equal(F.weekdayIndex('2026-11-29'), 6, 'Sunday = profile.days 6');
  assert.equal(F.weekdayIndex('bad'), null);
});

test('date: all styles in Czech', () => {
  const key = '2026-11-24';
  assert.equal(F.date(key, 'short'), 'út 24. 11.');
  assert.equal(F.date(key), 'út 24. 11.', 'short is the default');
  assert.equal(F.date(key, 'dayMonth'), '24. 11.');
  assert.equal(F.date(key, 'dayMonthYear'), '24. 11. 2026');
  assert.equal(F.date(key, 'dayMonthLong'), '24. listopadu');
  assert.equal(F.date(key, 'long'), 'úterý 24. listopadu');
  assert.equal(F.date(key, 'longYear'), 'úterý 24. listopadu 2026');
  assert.equal(F.date(key, 'weekday'), 'út');
  assert.equal(F.date(key, 'weekdayLong'), 'úterý');
  assert.equal(F.date(key, 'month'), 'listopad');
  assert.equal(F.date(key, 'monthShort'), 'lis');
  assert.equal(F.date(key, 'monthYear'), 'listopad 2026');
  assert.equal(F.date(key, 'iso'), key);
  assert.equal(F.date(key, 'long', { capitalize: true }), 'Úterý 24. listopadu');
  assert.equal(F.date('2026-01-05', 'long'), 'pondělí 5. ledna', 'genitive month after a day');
  assert.equal(F.date('2026-07-01', 'long'), 'středa 1. července');
  assert.equal(F.date('2026-07-01', 'monthYear'), 'červenec 2026', 'nominative month on its own');
  assert.equal(F.date('2026-11-29', 'short'), 'ne 29. 11.');
  assert.equal(F.date('2026-11-26', 'short'), 'čt 26. 11.');
  assert.equal(F.date(key, 'nonsense'), 'út 24. 11.', 'unknown style falls back to short');
  assert.equal(F.date('2026-02-30', 'short'), DASH);
  assert.equal(F.date(null, 'short', { fallback: '' }), '');
});

test('date: all styles in English', () => {
  const key = '2026-11-24';
  const en = { locale: 'en' };
  assert.equal(F.date(key, 'short', en), 'Tue 24 Nov');
  assert.equal(F.date(key, 'dayMonth', en), '24 Nov');
  assert.equal(F.date(key, 'dayMonthYear', en), '24 Nov 2026');
  assert.equal(F.date(key, 'dayMonthLong', en), '24 November');
  assert.equal(F.date(key, 'long', en), 'Tuesday 24 November');
  assert.equal(F.date(key, 'longYear', en), 'Tuesday 24 November 2026');
  assert.equal(F.date(key, 'weekday', en), 'Tue');
  assert.equal(F.date(key, 'weekdayLong', en), 'Tuesday');
  assert.equal(F.date(key, 'month', en), 'November');
  assert.equal(F.date(key, 'monthShort', en), 'Nov');
  assert.equal(F.date(key, 'monthYear', en), 'November 2026');
  assert.equal(F.date('2026-09-05', 'dayMonth', 'en'), '5 Sep', 'three-letter months on every ICU');
  assert.equal(F.date('2026-06-14', 'short', 'en'), 'Sun 14 Jun');
  F.setLocale('en');
  assert.equal(F.date(key, 'short'), 'Tue 24 Nov', 'module locale');
});

test('date: same calendar day in every time zone', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Pago_Pago', 'UTC', 'Asia/Kolkata']) {
      process.env.TZ = zone;
      assert.equal(F.date('2026-11-24', 'short'), 'út 24. 11.', zone);
      assert.equal(F.date('2026-11-24T19:30:00Z', 'long', 'en'), 'Tuesday 24 November', zone);
      assert.equal(F.weekdayIndex('2026-11-24'), 1, zone);
      assert.equal(F.addDays('2026-03-28', 2), '2026-03-30', zone);
      assert.equal(F.relativeDay('2026-11-25', '2026-11-24'), 'zítra', zone);
      assert.equal(F.isoWeek('2026-11-26'), 48, zone);
    }
  } finally {
    process.env.TZ = original;
  }
});

test('weekRange: same month, across months, across years', () => {
  assert.equal(F.weekRange('2026-11-23', '2026-11-29'), '23.–29. 11.');
  assert.equal(F.weekRange('2026-11-23', '2026-11-29', 'en'), '23–29 Nov');
  assert.equal(F.weekRange('2026-10-26', '2026-11-01'), '26. 10. – 1. 11.');
  assert.equal(F.weekRange('2026-10-26', '2026-11-01', 'en'), '26 Oct – 1 Nov');
  assert.equal(F.weekRange('2026-12-28', '2027-01-03'), '28. 12. 2026 – 3. 1. 2027');
  assert.equal(F.weekRange('2026-12-28', '2027-01-03', 'en'), '28 Dec 2026 – 3 Jan 2027');
  assert.equal(F.weekRange('2026-11-23'), '23.–29. 11.', 'end defaults to start + 6 days');
  assert.equal(F.weekRange('2026-11-23', undefined, 'en'), '23–29 Nov');
  assert.equal(F.weekRange('2026-11-29', '2026-11-23'), '23.–29. 11.', 'reversed input is swapped');
  assert.equal(F.weekRange('2026-11-24', '2026-11-24'), '24. 11.');
  assert.equal(F.weekRange('2026-11-24', '2026-11-24', 'en'), '24 Nov');
  assert.equal(F.weekRange('2026-11-23', '2026-11-29', { year: true }), '23.–29. 11. 2026');
  assert.equal(F.weekRange('2026-11-23', '2026-11-29', { year: true, locale: 'en' }), '23–29 Nov 2026');
  assert.equal(F.weekRange('2026-10-26', '2026-11-01', { year: true }), '26. 10. – 1. 11. 2026');
  assert.equal(F.weekRange('2026-10-26', '2026-11-01', { year: true, locale: 'en' }), '26 Oct – 1 Nov 2026');
  assert.equal(F.weekRange('bad', '2026-11-29'), DASH);
});

test('relativeDay: words for near days, counts otherwise', () => {
  const today = '2026-11-24';
  const cs = d => F.relativeDay(F.addDays(today, d), today);
  const en = d => F.relativeDay(F.addDays(today, d), today, 'en');
  assert.equal(cs(0), 'dnes');
  assert.equal(cs(1), 'zítra');
  assert.equal(cs(-1), 'včera');
  assert.equal(cs(2), 'za 2 dny', 'not "pozítří"');
  assert.equal(cs(3), 'za 3 dny');
  assert.equal(cs(5), 'za 5 dní');
  assert.equal(cs(-2), 'před 2 dny', 'not "předevčírem"');
  assert.equal(cs(-5), 'před 5 dny');
  assert.equal(en(0), 'today');
  assert.equal(en(1), 'tomorrow');
  assert.equal(en(-1), 'yesterday');
  assert.equal(en(3), 'in 3 days');
  assert.equal(en(-2), '2 days ago');
  assert.equal(F.relativeDay('2026-03-30', '2026-03-28'), 'za 2 dny', 'DST does not shift the count');
  assert.equal(F.relativeDay('2027-01-01', '2026-12-31'), 'zítra');
  assert.equal(F.relativeDay(today, today, { capitalize: true }), 'Dnes');
  assert.equal(F.relativeDay(today, today, { capitalize: true, locale: 'en' }), 'Today');
  assert.equal(F.relativeDay(today), DASH, 'today must be passed explicitly');
  assert.equal(F.relativeDay('bad', today), DASH);
});

test('relativeDay: fallback words when Intl.RelativeTimeFormat is missing', () => {
  const original = Intl.RelativeTimeFormat;
  // Load a fresh copy so its formatter cache is empty.
  delete require.cache[require.resolve('../src/core/format.js')];
  const fresh = require('../src/core/format.js');
  delete require.cache[require.resolve('../src/core/format.js')];
  try {
    Intl.RelativeTimeFormat = undefined;
    const today = '2026-11-24';
    const rel = (d, l) => fresh.relativeDay(fresh.addDays(today, d), today, l);
    assert.deepEqual([0, 1, -1, 2, 5, -2, -5].map(d => rel(d, 'cs')), ['dnes', 'zítra', 'včera', 'za 2 dny', 'za 5 dní', 'před 2 dny', 'před 5 dny']);
    assert.deepEqual([0, 1, -1, 3, -2].map(d => rel(d, 'en')), ['today', 'tomorrow', 'yesterday', 'in 3 days', '2 days ago']);
  } finally {
    Intl.RelativeTimeFormat = original;
  }
});

test('pluralCategory: Czech one/few/many/other, English one/other', () => {
  const cs = n => F.pluralCategory(n, 'cs');
  const en = n => F.pluralCategory(n, 'en');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 11, 21, 22, 100].map(cs), ['other', 'one', 'few', 'few', 'few', 'other', 'other', 'other', 'other', 'other']);
  assert.equal(cs(1.5), 'many', 'decimals are "many" in Czech: 1,5 kilometru');
  assert.equal(cs(0.5), 'many');
  assert.equal(cs('1,5'), 'many');
  assert.equal(cs('5,0'), 'many', 'visible decimals count');
  assert.equal(cs('5'), 'other');
  assert.equal(cs('1' + NBSP + '263'), 'other');
  assert.equal(F.pluralCategory(5, { locale: 'cs', decimals: 1 }), 'many');
  assert.equal(cs(-2), 'few');
  assert.equal(cs(MINUS + '1'), 'one');
  assert.equal(cs(1.001), 'one', 'rounded like the default display (2 decimals)');
  assert.deepEqual([0, 1, 2, 5, 1.5].map(en), ['other', 'one', 'other', 'other', 'other']);
  assert.equal(en('1.0'), 'other', '1.0 kilometres');
  assert.equal(en('1,263'), 'other', 'comma is grouping in English');
  assert.equal(en('1'), 'one');
  assert.equal(cs('abc'), 'other');
  assert.equal(cs(NaN), 'other');
});

test('fallback plural rules match Intl.PluralRules', () => {
  const values = [0, 1, 2, 3, 4, 5, 10, 11, 12, 21, 22, 25, 101, 0.5, 1.5, 2.25, 4.1];
  for (const locale of ['cs', 'en']) {
    for (const decimals of [null, 0, 1, 2]) {
      for (const v of values) {
        const min = decimals ?? 0, max = decimals ?? 2;
        const intl = new Intl.PluralRules(F.intlLocale(locale), { minimumFractionDigits: min, maximumFractionDigits: max }).select(v);
        assert.equal(F._fallbackPluralCategory(v, locale, min, max), intl, `${locale} ${v} decimals=${decimals}`);
      }
    }
  }
});

test('plural: Czech and English nouns with {n}', () => {
  const runs = { one: '{n} běh', few: '{n} běhy', many: '{n} běhu', other: '{n} běhů' };
  assert.equal(F.plural(1, runs), '1 běh');
  assert.equal(F.plural(2, runs), '2 běhy');
  assert.equal(F.plural(4, runs), '4 běhy');
  assert.equal(F.plural(5, runs), '5 běhů');
  assert.equal(F.plural(0, runs), '0 běhů');
  assert.equal(F.plural(22, runs), '22 běhů');
  const km = { one: '{n} kilometr', few: '{n} kilometry', many: '{n} kilometru', other: '{n} kilometrů' };
  assert.equal(F.plural(1.5, km), '1,5 kilometru');
  assert.equal(F.plural(5, km, { decimals: 1 }), '5,0 kilometru');
  assert.equal(F.plural('5,0', km), '5,0 kilometru', 'preformatted strings are kept as shown');
  assert.equal(F.plural(1263, km), '1263 kilometrů', 'no grouping inside sentences');
  assert.equal(F.plural(2, { one: 'běh', few: 'běhy', other: 'běhů' }), 'běhy', 'forms without {n}');
  assert.equal(F.plural(1.5, { one: 'běh', few: 'běhy', other: 'běhů' }), 'běhů', 'missing many falls back to other');
  const both = { cs: runs, en: { one: '{n} run', other: '{n} runs' } };
  assert.equal(F.plural(1, both, 'en'), '1 run');
  assert.equal(F.plural(3, both, 'en'), '3 runs');
  assert.equal(F.plural(1.5, both, 'en'), '1.5 runs');
  assert.equal(F.plural(3, both), '3 běhy');
  assert.equal(F.plural(0, { zero: 'Zatím žádný běh', ...runs }), 'Zatím žádný běh');
  assert.equal(F.plural(1, { zero: 'Zatím žádný běh', ...runs }), '1 běh');
  assert.equal(F.plural(2, null), '');
  assert.equal(F.plural(2, { foo: 'x' }), '');
});

test('isoWeek and isoWeekYear', () => {
  assert.equal(F.isoWeek('2026-11-26'), 48);
  assert.equal(F.isoWeek('2026-11-23'), 48, 'Monday');
  assert.equal(F.isoWeek('2026-11-29'), 48, 'Sunday');
  assert.equal(F.isoWeek('2026-11-30'), 49);
  assert.equal(F.isoWeek('2026-01-01'), 1, '2026 starts on a Thursday');
  assert.equal(F.isoWeek('2026-12-31'), 53);
  assert.equal(F.isoWeek('2027-01-01'), 53);
  assert.equal(F.isoWeekYear('2027-01-01'), 2026);
  assert.equal(F.isoWeek('2027-01-04'), 1);
  assert.equal(F.isoWeek('2024-12-30'), 1);
  assert.equal(F.isoWeekYear('2024-12-30'), 2025);
  assert.equal(F.isoWeek('2021-01-03'), 53);
  assert.equal(F.isoWeekYear('2021-01-03'), 2020);
  assert.equal(F.isoWeek('2026-03-30'), 14, 'after DST change');
  assert.equal(F.isoWeek('nope'), null);
  assert.equal(F.isoWeekYear('nope'), null);
});

test('capitalize uses locale rules', () => {
  assert.equal(F.capitalize('úterý', 'cs'), 'Úterý');
  assert.equal(F.capitalize('čtvrtek'), 'Čtvrtek');
  assert.equal(F.capitalize('today', 'en'), 'Today');
  assert.equal(F.capitalize(''), '');
  assert.equal(F.capitalize(null), '');
});

test('module is a classic script: no import/export, no DOM, no clock', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/core/format.js'), 'utf8');
  assert.doesNotMatch(source, /^\s*(import|export)\s/m);
  assert.doesNotMatch(source, /\b(document|window|localStorage|fetch|XMLHttpRequest)\b/);
  assert.doesNotMatch(source, /Date\.now\(|new Date\(\)/);
});

test('browser global: script assigns VeyvoFormat without module', () => {
  const vm = require('node:vm');
  const source = require('node:fs').readFileSync(require.resolve('../src/core/format.js'), 'utf8');
  const sandbox = { Intl, Date, Math, Number, String, Object, Array, Map, RegExp, TypeError };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.VeyvoFormat.date, 'function');
  assert.equal(sandbox.VeyvoFormat.km(5.25), '5,3');
});
