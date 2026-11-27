const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
process.env.TZ = 'Europe/Prague';
const Format = require('../src/core/format.js');
const I18n = require('../src/core/i18n.js');

// ---------------------------------------------------------------- tiny fake DOM

class FakeElement {
  constructor(attrs = {}, children = []) {
    this.attributes = new Map(Object.entries(attrs));
    this.children = children;
    this.textContent = '';
    this.innerHTML = '';
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelectorAll(selector) {
    const match = /^\[([a-z0-9-]+)\]$/i.exec(selector);
    if (!match) throw new Error('fake DOM only supports [attr] selectors, got ' + selector);
    const out = [];
    const walk = node => node.children.forEach(child => {
      if (child.attributes.has(match[1])) out.push(child);
      walk(child);
    });
    walk(this);
    return out;
  }
}
const el = (attrs, ...children) => new FakeElement(attrs, children);
class FakeDocument {
  constructor(body) {
    this.documentElement = el({}, body);
  }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
}

let nsCounter = 0;
const uniqueNs = () => 'test' + (++nsCounter);

beforeEach(() => I18n.setLocale('cs'));

// ---------------------------------------------------------------- lookup + register

test('t: namespaced lookup in the current locale', () => {
  const ns = uniqueNs();
  I18n.register(ns, { cs: { title: 'Přehled' }, en: { title: 'Overview' } });
  assert.equal(I18n.t(ns + '.title'), 'Přehled');
  I18n.setLocale('en');
  assert.equal(I18n.t(ns + '.title'), 'Overview');
  assert.equal(I18n.t(ns + '.title', null, 'cs'), 'Přehled', 'explicit locale');
});

test('register merges dictionaries and flattens nested objects and arrays', () => {
  const ns = uniqueNs();
  I18n.register(ns, { cs: { a: 'A1', group: { b: 'B', deep: { c: 'C' } } }, en: { a: 'A1en' } });
  I18n.register(ns, { cs: { a: 'A2', list: ['nula', 'jedna'] } });
  assert.equal(I18n.t(ns + '.a'), 'A2', 'later registration wins');
  assert.equal(I18n.t(ns + '.group.b'), 'B', 'earlier keys survive a merge');
  assert.equal(I18n.t(ns + '.group.deep.c'), 'C');
  assert.equal(I18n.t(ns + '.list.1'), 'jedna');
  assert.equal(I18n.t(ns + '.a', null, 'en'), 'A1en');
  I18n.register(ns, { cs: { num: 42, flag: true } });
  assert.equal(I18n.t(ns + '.num'), '42');
  assert.equal(I18n.t(ns + '.flag'), 'true');
  assert.deepEqual(I18n.keys(ns), [ns + '.a', ns + '.flag', ns + '.group.b', ns + '.group.deep.c', ns + '.list.0', ns + '.list.1', ns + '.num']);
});

test('register validates namespace, locales and dictionaries', () => {
  assert.throws(() => I18n.register('', { cs: {} }), TypeError);
  assert.throws(() => I18n.register('a.b', { cs: {} }), TypeError);
  assert.throws(() => I18n.register(null, { cs: {} }), TypeError);
  assert.throws(() => I18n.register(uniqueNs(), null), TypeError);
  assert.throws(() => I18n.register(uniqueNs(), { de: { a: 'b' } }), /unsupported locale/);
  assert.throws(() => I18n.register(uniqueNs(), { cs: 'text' }), TypeError);
  assert.throws(() => I18n.register(uniqueNs(), { cs: ['a'] }), TypeError);
  assert.doesNotThrow(() => I18n.register(uniqueNs(), { cs: { a: 'b' }, en: null }));
});

test('fallback order: current locale -> cs -> key, with the missing hook', () => {
  const ns = uniqueNs();
  I18n.register(ns, { cs: { onlyCs: 'Jen česky', both: 'Obojí' }, en: { both: 'Both' } });
  const seen = [];
  const off = I18n.onMissing(info => seen.push(info));
  I18n.setLocale('en');
  assert.equal(I18n.t(ns + '.both'), 'Both');
  assert.equal(I18n.t(ns + '.onlyCs'), 'Jen česky');
  assert.equal(I18n.t(ns + '.nothing'), ns + '.nothing');
  assert.equal(I18n.t('noNamespace'), 'noNamespace');
  I18n.setLocale('cs');
  assert.equal(I18n.t(ns + '.nothing2'), ns + '.nothing2');
  off();
  I18n.t(ns + '.afterOff');
  assert.deepEqual(seen, [
    { key: ns + '.onlyCs', locale: 'en', resolvedLocale: 'cs' },
    { key: ns + '.nothing', locale: 'en', resolvedLocale: null },
    { key: 'noNamespace', locale: 'en', resolvedLocale: null },
    { key: ns + '.nothing2', locale: 'cs', resolvedLocale: null }
  ]);
  // A throwing hook never breaks translation.
  const offBad = I18n.onMissing(() => { throw new Error('boom'); });
  assert.equal(I18n.t(ns + '.missing'), ns + '.missing');
  offBad();
});

test('lookups never hit Object.prototype', () => {
  assert.equal(I18n.t('constructor'), 'constructor');
  assert.equal(I18n.t('common.__proto__'), 'common.__proto__');
  assert.equal(I18n.t('toString'), 'toString');
  assert.equal(I18n.has('constructor'), false);
});

test('has: true when t() resolves in the locale or the cs fallback', () => {
  const ns = uniqueNs();
  I18n.register(ns, { cs: { a: 'A', p: { one: 'x', other: 'y' } }, en: { b: 'B' } });
  assert.equal(I18n.has(ns + '.a'), true);
  assert.equal(I18n.has(ns + '.p'), true);
  assert.equal(I18n.has(ns + '.b'), false, 'en-only key is not reachable from cs');
  assert.equal(I18n.has(ns + '.b', 'en'), true);
  assert.equal(I18n.has(ns + '.a', 'en'), true, 'via cs fallback');
  assert.equal(I18n.has(ns + '.zzz'), false);
  assert.equal(I18n.has(ns), false, 'a namespace is not a key');
});

// ---------------------------------------------------------------- interpolation + plurals

test('interpolation: {param}, locale numbers, missing params stay visible', () => {
  const ns = uniqueNs();
  I18n.register(ns, {
    cs: { gap: 'Do cíle chybí {time} ({km} km)', year: 'Rok {year}', ratio: 'Poměr {x}', empty: '[{v}]' },
    en: { gap: '{time} to goal ({km} km)', year: 'Year {year}', ratio: 'Ratio {x}', empty: '[{v}]' }
  });
  assert.equal(I18n.t(ns + '.gap', { time: '0:42', km: Format.km(5) }), 'Do cíle chybí 0:42 (5,0 km)');
  assert.equal(I18n.t(ns + '.year', { year: 2026 }), 'Rok 2026', 'no thousands grouping');
  assert.equal(I18n.t(ns + '.ratio', { x: 1.5 }), 'Poměr 1,5');
  assert.equal(I18n.t(ns + '.ratio', { x: 1.5 }, 'en'), 'Ratio 1.5');
  assert.equal(I18n.t(ns + '.gap', { time: '0:42' }), 'Do cíle chybí 0:42 ({km} km)');
  assert.equal(I18n.t(ns + '.gap'), 'Do cíle chybí {time} ({km} km)');
  assert.equal(I18n.t(ns + '.empty', { v: null }), '[]');
  assert.equal(I18n.t(ns + '.empty', { v: NaN }), '[]');
  assert.equal(I18n.t(ns + '.empty', { v: 0 }), '[0]');
  assert.equal(I18n.t(ns + '.empty', { v: '<b>' }), '[<b>]', 't() is plain text, no escaping');
  assert.equal(I18n.t(ns + '.empty', Object.create({ v: 'inherited' })), '[{v}]', 'only own params');
});

test('plural entries: Czech one/few/many/other and English one/other', () => {
  I18n.setLocale('cs');
  const runs = n => I18n.t('common.count.runs', { n });
  assert.equal(runs(1), '1 běh');
  assert.equal(runs(2), '2 běhy');
  assert.equal(runs(4), '4 běhy');
  assert.equal(runs(5), '5 běhů');
  assert.equal(runs(0), '0 běhů');
  assert.equal(runs(21), '21 běhů');
  assert.equal(I18n.t('common.count.km', { n: 1.5 }), '1,5 kilometru');
  assert.equal(I18n.t('common.count.km', { n: '5,0' }), '5,0 kilometru', 'visible decimals select many');
  assert.equal(I18n.t('common.count.km', { n: 3 }), '3 kilometry');
  assert.equal(I18n.t('common.count.days', { count: 2 }), '2 dny', 'params.count works too');
  assert.equal(I18n.t('common.count.days', { n: 5 }), '5 dní');
  assert.equal(I18n.t('common.count.weeks', { n: 10 }), '10 týdnů');
  assert.equal(I18n.t('common.count.minutes', { n: 1.5 }), '1,5 minuty');
  I18n.setLocale('en');
  assert.equal(runs(1), '1 run');
  assert.equal(runs(2), '2 runs');
  assert.equal(runs(0), '0 runs');
  assert.equal(I18n.t('common.count.km', { n: 1.5 }), '1.5 kilometres');
  assert.equal(I18n.t('common.count.km', { n: '1.0' }), '1.0 kilometres');
  assert.equal(I18n.t('common.count.km', { n: 1 }), '1 kilometre');
});

test('plural entries: zero form, no count, en falls back to cs rules for cs text', () => {
  const ns = uniqueNs();
  I18n.register(ns, {
    cs: {
      runs: { zero: 'Zatím žádný běh', one: '{n} běh', few: '{n} běhy', many: '{n} běhu', other: '{n} běhů' },
      onlyCs: { one: '{n} den', few: '{n} dny', many: '{n} dne', other: '{n} dní' },
      partial: { one: '{n} krok', other: '{n} kroků' },
      countWord: { one: '{count} týden', few: '{count} týdny', many: '{count} týdne', other: '{count} týdnů' }
    },
    en: { runs: { zero: 'No runs yet', one: '{n} run', other: '{n} runs' } }
  });
  assert.equal(I18n.t(ns + '.runs', { n: 0 }), 'Zatím žádný běh');
  assert.equal(I18n.t(ns + '.runs', { n: '0' }), 'Zatím žádný běh');
  assert.equal(I18n.t(ns + '.runs', { n: '' }), ' běhů', 'empty string is not zero');
  assert.equal(I18n.t(ns + '.runs', { n: 1 }), '1 běh');
  assert.equal(I18n.t(ns + '.runs'), '{n} běhů', 'no count -> other');
  assert.equal(I18n.t(ns + '.partial', { n: 3 }), '3 kroků', 'missing few -> other');
  assert.equal(I18n.t(ns + '.countWord', { n: 3 }), '3 týdny', '{count} placeholder filled from n');
  assert.equal(I18n.t(ns + '.countWord', { count: 1.5 }), '1,5 týdne');
  I18n.setLocale('en');
  assert.equal(I18n.t(ns + '.runs', { n: 0 }), 'No runs yet');
  assert.equal(I18n.t(ns + '.onlyCs', { n: 3 }), '3 dny', 'cs entry keeps cs plural rules');
  assert.equal(I18n.t(ns + '.onlyCs', { n: 1.5 }), '1,5 dne', 'and cs number format');
});

test('function entries receive params and the entry locale', () => {
  const ns = uniqueNs();
  I18n.register(ns, {
    cs: { next: (p, l) => (p.day === 2 ? 'Další běh ve středu' : 'Další běh {when}') + (l === 'cs' ? '' : '?') },
    en: { next: () => 'Next run {when}' }
  });
  assert.equal(I18n.t(ns + '.next', { day: 2 }), 'Další běh ve středu');
  assert.equal(I18n.t(ns + '.next', { day: 1, when: 'v úterý' }), 'Další běh v úterý');
  assert.equal(I18n.t(ns + '.next', { when: 'on Tuesday' }, 'en'), 'Next run on Tuesday');
});

test('html(): trusted markup, escaped params, escaped missing key', () => {
  const ns = uniqueNs();
  I18n.register(ns, { cs: { rich: 'Cíl <b>{goal}</b>' }, en: { rich: 'Goal <b>{goal}</b>' } });
  assert.equal(I18n.html(ns + '.rich', { goal: '5 km < 20:00' }), 'Cíl <b>5 km &lt; 20:00</b>');
  assert.equal(I18n.html(ns + '.rich', { goal: '"x" & \'y\'' }, 'en'), 'Goal <b>&quot;x&quot; &amp; &#39;y&#39;</b>');
  assert.equal(I18n.html('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(I18n.escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
});

// ---------------------------------------------------------------- locale switching

test('setLocale: normalizes, syncs VeyvoFormat, notifies only on change', () => {
  const calls = [];
  const off = I18n.onChange((next, previous) => calls.push([next, previous]));
  assert.equal(I18n.getLocale(), 'cs');
  assert.equal(I18n.setLocale('en-GB'), 'en');
  assert.equal(Format.getLocale(), 'en', 'VeyvoFormat follows');
  assert.equal(Format.km(5), '5.0');
  assert.equal(I18n.setLocale('en'), 'en');
  assert.equal(I18n.setLocale(undefined), 'en', 'invalid input is ignored');
  assert.equal(I18n.setLocale(123), 'en');
  assert.equal(I18n.setLocale('cs'), 'cs');
  assert.equal(Format.getLocale(), 'cs');
  off();
  I18n.setLocale('en');
  assert.deepEqual(calls, [['en', 'cs'], ['cs', 'en']]);
  assert.throws(() => I18n.onChange('nope'), TypeError);
});

test('setLocale: every subscriber runs even if one throws, then the error surfaces', () => {
  const order = [];
  const offA = I18n.onChange(() => { order.push('a'); throw new Error('render failed'); });
  const offB = I18n.onChange(() => order.push('b'));
  assert.throws(() => I18n.setLocale('en'), /render failed/);
  assert.equal(I18n.getLocale(), 'en', 'locale still switched');
  assert.deepEqual(order, ['a', 'b']);
  offA(); offB();
  offA(); // unsubscribing twice is harmless
});

test('a subscriber may unsubscribe itself during notification', () => {
  const calls = [];
  const off = I18n.onChange(() => { calls.push('self'); off(); });
  const offOther = I18n.onChange(() => calls.push('other'));
  I18n.setLocale('en');
  I18n.setLocale('cs');
  offOther();
  assert.deepEqual(calls, ['self', 'other', 'other']);
});

// ---------------------------------------------------------------- apply()

test('apply: text, attributes, params and root element itself', () => {
  const ns = uniqueNs();
  I18n.register(ns, {
    cs: { title: 'Přehled', search: 'Hledat běh', label: 'Zavřít okno', count: { one: '{n} běh', few: '{n} běhy', many: '{n} běhu', other: '{n} běhů' } },
    en: { title: 'Overview', search: 'Search runs', label: 'Close window', count: { one: '{n} run', other: '{n} runs' } }
  });
  const heading = el({ 'data-i18n': ns + '.title' });
  const input = el({ 'data-i18n-attr': `placeholder:${ns}.search; aria-label:${ns}.label` });
  const counter = el({ 'data-i18n': ns + '.count', 'data-i18n-params': '{"n":3}' });
  const plain = el({ class: 'untouched' });
  const rootNode = el({ 'data-i18n-attr': `title:${ns}.title` }, el({}, heading, input), counter, plain);
  assert.equal(I18n.apply(rootNode), 4);
  assert.equal(heading.textContent, 'Přehled');
  assert.equal(input.getAttribute('placeholder'), 'Hledat běh');
  assert.equal(input.getAttribute('aria-label'), 'Zavřít okno');
  assert.equal(counter.textContent, '3 běhy');
  assert.equal(rootNode.getAttribute('title'), 'Přehled', 'root element is translated too');
  assert.equal(plain.textContent, '');
  I18n.setLocale('en');
  I18n.apply(rootNode);
  assert.equal(heading.textContent, 'Overview');
  assert.equal(input.getAttribute('placeholder'), 'Search runs');
  assert.equal(counter.textContent, '3 runs');
});

test('apply: data-i18n-html uses trusted dictionary markup only', () => {
  const ns = uniqueNs();
  I18n.register(ns, { cs: { rich: 'Cíl: <strong>{goal}</strong>' }, en: { rich: 'Goal: <strong>{goal}</strong>' } });
  const rich = el({ 'data-i18n-html': ns + '.rich', 'data-i18n-params': '{"goal":"<script>x</script>"}' });
  const missing = el({ 'data-i18n-html': '<img src=x onerror=alert(1)>' });
  const textOnly = el({ 'data-i18n': ns + '.rich', 'data-i18n-params': '{"goal":"5 km"}' });
  I18n.apply(el({}, rich, missing, textOnly));
  assert.equal(rich.innerHTML, 'Cíl: <strong>&lt;script&gt;x&lt;/script&gt;</strong>');
  assert.equal(missing.innerHTML, '', 'missing key never becomes markup');
  assert.equal(missing.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(textOnly.textContent, 'Cíl: <strong>5 km</strong>', 'data-i18n is plain text');
  assert.equal(textOnly.innerHTML, '');
});

test('apply: refuses event-handler and style attributes, tolerates bad specs and params', () => {
  const ns = uniqueNs();
  I18n.register(ns, { cs: { a: 'alert(1)', b: 'Popisek' } });
  const node = el({ 'data-i18n-attr': `onclick:${ns}.a;ONMOUSEOVER:${ns}.a;style:${ns}.a;srcdoc:${ns}.a;title:${ns}.b;broken;:${ns}.b;alt:` });
  const badParams = el({ 'data-i18n': 'common.count.runs', 'data-i18n-params': '{not json' });
  const arrayParams = el({ 'data-i18n': 'common.count.runs', 'data-i18n-params': '[1,2]' });
  const emptyKey = el({ 'data-i18n': '' });
  const onlyBad = el({ 'data-i18n-attr': 'onclick:x' });
  const count = I18n.apply(el({}, node, badParams, arrayParams, emptyKey, onlyBad));
  assert.equal(count, 3, 'empty key and all-refused specs are skipped');
  assert.equal(node.getAttribute('onclick'), null);
  assert.equal(node.getAttribute('ONMOUSEOVER'), null);
  assert.equal(node.getAttribute('style'), null);
  assert.equal(node.getAttribute('srcdoc'), null);
  assert.equal(node.getAttribute('title'), 'Popisek');
  assert.equal(node.getAttribute('alt'), null);
  assert.equal(badParams.textContent, '{n} běhů', 'invalid JSON params are ignored');
  assert.equal(arrayParams.textContent, '{n} běhů');
  assert.equal(emptyKey.textContent, '');
});

test('apply: Document root sets <html lang>, missing keys show the key, bad roots are ignored', () => {
  const ns = uniqueNs();
  const missing = el({ 'data-i18n': ns + '.missing' });
  const doc = new FakeDocument(el({}, missing, el({ 'data-i18n': 'common.button.save' })));
  assert.equal(I18n.apply(doc), 2);
  assert.equal(doc.documentElement.getAttribute('lang'), 'cs');
  assert.equal(missing.textContent, ns + '.missing');
  I18n.setLocale('en');
  I18n.apply(doc);
  assert.equal(doc.documentElement.getAttribute('lang'), 'en');
  assert.equal(I18n.apply(null), 0);
  assert.equal(I18n.apply({}), 0);
  assert.equal(I18n.apply(undefined), 0);
});

test('apply re-run via onChange keeps the UI in the chosen language', () => {
  const button = el({ 'data-i18n': 'common.button.cancel' });
  const page = el({}, button);
  const off = I18n.onChange(() => I18n.apply(page));
  I18n.apply(page);
  assert.equal(button.textContent, 'Zrušit');
  I18n.setLocale('en');
  assert.equal(button.textContent, 'Cancel');
  off();
});

// ---------------------------------------------------------------- common namespace

test('common: run types, buttons, weekdays in cs and en', () => {
  const types = ['run', 'easy', 'long', 'tempo', 'intervals', 'test5k', 'race'];
  assert.deepEqual(types.map(k => I18n.t('common.runType.' + k)), ['Běh', 'Lehký běh', 'Dlouhý běh', 'Tempo', 'Intervaly', 'Test 5 km', 'Závod']);
  assert.deepEqual(types.map(k => I18n.t('common.runType.' + k, null, 'en')), ['Run', 'Easy run', 'Long run', 'Tempo run', 'Intervals', '5 km test', 'Race']);
  const buttons = ['save', 'cancel', 'close', 'delete', 'edit', 'back'];
  assert.deepEqual(buttons.map(k => I18n.t('common.button.' + k)), ['Uložit', 'Zrušit', 'Zavřít', 'Smazat', 'Upravit', 'Zpět']);
  assert.deepEqual(buttons.map(k => I18n.t('common.button.' + k, null, 'en')), ['Save', 'Cancel', 'Close', 'Delete', 'Edit', 'Back']);
  // profile.days convention: 0 = Monday ... 6 = Sunday; owner runs on [1, 6].
  assert.deepEqual([1, 6].map(d => I18n.t('common.weekdayLong.' + d)), ['úterý', 'neděle']);
  assert.deepEqual([1, 6].map(d => I18n.t('common.weekdayShort.' + d, null, 'en')), ['Tue', 'Sun']);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(d => I18n.t('common.onWeekday.' + d)), ['v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu', 'v neděli']);
  assert.equal(I18n.t('common.onWeekday.' + Format.weekdayIndex('2026-11-29'), null, 'en'), 'on Sunday');
  assert.equal(I18n.t('common.status.saved'), 'Uloženo');
  assert.equal(I18n.t('common.status.saved', null, 'en'), 'Saved');
  assert.equal(I18n.t('common.unit.bpm'), 'tep/min');
});

test('common weekday and month words agree with VeyvoFormat date names', () => {
  const monday = '2026-11-23';
  for (const locale of ['cs', 'en']) {
    for (let i = 0; i < 7; i++) {
      const key = Format.addDays(monday, i);
      assert.equal(I18n.t('common.weekdayShort.' + i, null, locale), Format.date(key, 'weekday', locale), `${locale} weekday ${i}`);
      assert.equal(I18n.t('common.weekdayLong.' + i, null, locale), Format.date(key, 'weekdayLong', locale), `${locale} weekdayLong ${i}`);
    }
    for (let m = 1; m <= 12; m++) {
      const key = `2026-${String(m).padStart(2, '0')}-15`;
      assert.equal(I18n.t('common.monthLong.' + (m - 1), null, locale), Format.date(key, 'month', locale), `${locale} month ${m}`);
      assert.equal(I18n.t('common.monthShort.' + (m - 1), null, locale), Format.date(key, 'monthShort', locale), `${locale} monthShort ${m}`);
    }
  }
});

test('audit: common namespace is complete in both languages', () => {
  const report = I18n.audit('common');
  assert.deepEqual(report.missing, { cs: [], en: [] });
  assert.deepEqual(report.incompletePlurals, []);
  assert.deepEqual(report.placeholderMismatch, []);
  assert.ok(I18n.keys('common').length > 100);
});

test('audit reports gaps, incomplete Czech plurals and placeholder typos', () => {
  const ns = uniqueNs();
  I18n.register(ns, {
    cs: { a: 'A', p: { one: '{n} běh', other: '{n} běhů' }, typo: 'Za {days} dní' },
    en: { b: 'B', p: { one: '{n} run', other: '{n} runs' }, typo: 'In {day} days' }
  });
  const report = I18n.audit(ns);
  assert.deepEqual(report.missing, { cs: [ns + '.b'], en: [ns + '.a'] });
  assert.deepEqual(report.incompletePlurals, [{ key: ns + '.p', locale: 'cs', missing: ['few', 'many'] }]);
  assert.deepEqual(report.placeholderMismatch, [ns + '.typo']);
});

test('module is a classic script loadable in a browser after format.js', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const formatSource = fs.readFileSync(require.resolve('../src/core/format.js'), 'utf8');
  const i18nSource = fs.readFileSync(require.resolve('../src/core/i18n.js'), 'utf8');
  assert.doesNotMatch(i18nSource, /^\s*(import|export)\s/m);
  assert.doesNotMatch(i18nSource, /\b(document|window|localStorage|fetch|XMLHttpRequest)\b/);
  const sandbox = { Intl, Date, Math, Number, String, Object, Array, Map, RegExp, JSON, TypeError, Error };
  vm.createContext(sandbox);
  assert.throws(() => vm.runInContext(i18nSource, sandbox), /load src\/core\/format\.js first/);
  vm.runInContext(formatSource, sandbox);
  vm.runInContext(i18nSource, sandbox);
  const { VeyvoI18n, VeyvoFormat } = vm.runInContext('({ VeyvoI18n, VeyvoFormat })', sandbox);
  assert.equal(VeyvoI18n.t('common.runType.easy'), 'Lehký běh');
  VeyvoI18n.setLocale('en');
  assert.equal(VeyvoFormat.getLocale(), 'en');
  assert.equal(VeyvoI18n.t('common.count.runs', { n: 2 }), '2 runs');
});
