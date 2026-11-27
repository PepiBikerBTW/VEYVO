const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const W = require('../src/core/workouts.js');
const Z = require('../src/core/export/zwo.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'core', 'export', 'zwo.js');
const WORKOUTS_SRC = path.join(ROOT, 'src', 'core', 'workouts.js');
const { step, repeat, time, distance, open, pace, hr } = W.build;

function workout(id, name, steps, extra) {
  return Object.assign({ id: id, name: name, sport: 'running', source: 'custom', steps: steps }, extra || {});
}

// Owner-like numbers: best 5 km 21:30 (4:18 /km), goal 20:00.
const PACES = W.derivePaces({ best5kSeconds: 1290, targetSeconds: 1200 });
const OPTS = Z.optionsFromPaces(PACES);           // reference 258 s/km, easy 310–375 (mid 342.5)
const REF = 258, EASY_MID = 342.5;

// The four reference workouts shared with the FIT / Apple exporter tests.
const SAMPLES = {
  easy: workout('sample-easy', 'Easy 3 km', [step('active', distance(3000), pace(305, 365))]),
  reps: workout('sample-reps', 'Úseky 6× 400 m', [
    step('warmup', time(900)),
    repeat(6, [step('active', distance(400), pace(230, 237)), step('recovery', distance(200), open())]),
    step('cooldown', time(600))
  ]),
  hr: workout('sample-hr', 'HR run 40 min', [step('active', time(2400), hr(140, 155))]),
  czech: W.fromNextRun({ kind: 'easy', date: '2026-11-29', distanceKm: 3, paceFast: 305, paceSlow: 365 }, {}, { locale: 'cs' })
};

// ---------------------------------------------------------------- tiny XML parser (no DOMParser in Node)

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    assert.ok(Object.prototype.hasOwnProperty.call(ENTITIES, e), 'unknown entity ' + m);
    return ENTITIES[e];
  });
}
/**
 * Strict enough for our output: XML declaration, nested elements, double-quoted attributes,
 * text; fails on unbalanced tags, raw '<' / '&' in text or attributes, duplicate attributes,
 * anything outside the root element.
 */
function parseXml(xml) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'), 'XML declaration first');
  const body = xml.slice(xml.indexOf('?>') + 2);
  const token = /<\/([A-Za-z_][\w.-]*)\s*>|<([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.-]*="[^"<]*")*)\s*(\/?)>|([^<]+)/y;
  const rootNode = { name: '#document', children: [] };
  const stack = [rootNode];
  let pos = 0;
  while (pos < body.length) {
    token.lastIndex = pos;
    const m = token.exec(body);
    assert.ok(m, 'unparsable XML at ' + JSON.stringify(body.slice(pos, pos + 40)));
    pos = token.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1]) {
      assert.equal(m[1], top.name, 'closing tag matches');
      stack.pop();
    } else if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) {
        assert.ok(!(a[1] in attrs), 'duplicate attribute ' + a[1]);
        assert.doesNotMatch(a[2], /&(?!(?:amp|lt|gt|quot|apos|#\d+);)/, 'raw & in attribute');
        attrs[a[1]] = decodeEntities(a[2]);
      }
      const node = { name: m[2], attrs: attrs, children: [], text: '' };
      if (top === rootNode) assert.equal(rootNode.children.length, 0, 'single root element');
      top.children.push(node);
      if (!m[4]) stack.push(node);
    } else {
      assert.doesNotMatch(m[5], /&(?!(?:amp|lt|gt|quot|apos|#\d+);)/, 'raw & in text');
      if (top === rootNode) assert.match(m[5], /^\s*$/, 'only whitespace outside the root');
      else top.text += decodeEntities(m[5]);
    }
  }
  assert.equal(stack.length, 1, 'all elements closed');
  return rootNode.children[0];
}
const child = (node, name) => node.children.find((c) => c.name === name);
const blocksOf = (xml) => child(parseXml(xml), 'workout').children;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, (label || '') + ' ' + actual + ' vs ' + expected);

test('test XML parser rejects what Zwift would reject', () => {
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n';
  assert.equal(parseXml(head + '<a x="1 &amp; 2"><b/>t &lt; u</a>\n').children[0].name, 'b');
  for (const bad of ['<a><b></a>', '<a>x & y</a>', '<a x="1" x="2"/>', '<a x=1/>', '<a></a><b/>', '<a>', 'text<a/>', '<a x="<"/>']) {
    assert.throws(() => parseXml(head + bad), assert.AssertionError, bad);
  }
  assert.throws(() => parseXml('<a/>'), assert.AssertionError, 'declaration required');
});

// ---------------------------------------------------------------- header

test('header: author, name, description, sportType run, durationType, in that order', () => {
  const root = parseXml(Z.toZwo(SAMPLES.easy, OPTS));
  assert.equal(root.name, 'workout_file');
  assert.deepEqual(root.children.map((c) => c.name), ['author', 'name', 'description', 'sportType', 'durationType', 'workout']);
  assert.equal(child(root, 'author').text, 'VEYVO');
  assert.equal(child(root, 'name').text, 'Easy 3 km');
  assert.equal(child(root, 'sportType').text, 'run');
  assert.equal(child(root, 'durationType').text, 'distance');
  assert.equal(child(root, 'description').text,
    'Tempa jsou v souboru zapsaná jako podíl tvého tempa na 5 km (4:18 /km). Stejné tempo nastav ve Zwiftu v Edit Paces.');
  assert.equal(Z.toZwo(SAMPLES.easy, Object.assign({ author: '  Pepa ' }, OPTS)).includes('<author>Pepa</author>'), true);
  assert.ok(Z.toZwo(SAMPLES.easy, OPTS).endsWith('</workout_file>\n'));
});

// ---------------------------------------------------------------- the four reference workouts

test('easy 3 km @ 5:05–6:05: one distance SteadyState at reference / middle pace', () => {
  const result = Z.convert(SAMPLES.easy, OPTS);
  assert.equal(result.durationType, 'distance');
  assert.equal(result.blockCount, 1);
  assert.deepEqual(result.convertedPaths, []);
  assert.deepEqual(result.easyPacePaths, []);
  const blocks = blocksOf(result.xml);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].name, 'SteadyState');
  assert.deepEqual(blocks[0].attrs, { Duration: '3000', Power: String(Math.round((REF / 335) * 1e4) / 1e4), pace: '1' });
  assert.deepEqual(blocks[0].children.map((c) => [c.name, c.attrs]), [['textevent', { distoffset: '0', message: 'Běh 3 km · 5:05–6:05 /km' }]]);
});

test('15 min WU + 6 × (400 m @ 3:50–3:57 + 200 m) + 10 min CD: time file with IntervalsT', () => {
  const result = Z.convert(SAMPLES.reps, OPTS);
  assert.equal(result.durationType, 'time');
  assert.deepEqual(result.convertedPaths, ['steps.1.steps.0', 'steps.1.steps.1']);
  assert.deepEqual(result.easyPacePaths, ['steps.0', 'steps.1.steps.1', 'steps.2']);
  const blocks = blocksOf(result.xml);
  assert.deepEqual(blocks.map((b) => b.name), ['Warmup', 'IntervalsT', 'Cooldown']);
  const [wu, reps, cd] = blocks;
  // Warm-up ramps across the easy range: slow end first.
  assert.deepEqual(wu.attrs, { Duration: '900', PowerLow: String(Math.round((REF / 375) * 1e4) / 1e4), PowerHigh: String(Math.round((REF / 310) * 1e4) / 1e4), pace: '1' });
  // Cool-down ramps back down: fast end first.
  assert.deepEqual(cd.attrs, { Duration: '600', PowerLow: wu.attrs.PowerHigh, PowerHigh: wu.attrs.PowerLow, pace: '1' });
  assert.equal(reps.attrs.Repeat, '6');
  assert.equal(reps.attrs.OnDuration, String(Math.round(0.4 * 233.5)));        // 93 s at the middle of 3:50–3:57
  assert.equal(reps.attrs.OffDuration, String(Math.round(0.2 * EASY_MID)));     // 69 s at easy pace
  near(REF / Number(reps.attrs.OnPower), 233.5, 0.05, 'on pace');
  near(REF / Number(reps.attrs.OffPower), EASY_MID, 0.05, 'off pace');
  assert.ok(Number(reps.attrs.OnPower) > 1, 'faster than the 5 km reference -> above 1');
  assert.equal(reps.attrs.pace, '1');
  assert.equal(reps.children.length, 1);
  assert.deepEqual(reps.children[0].attrs, { timeoffset: '0', message: '6× (Úsek 400 m · 3:50–3:57 /km + Klus 200 m · podle pocitu)' });
  assert.equal(wu.children[0].attrs.message, 'Rozklus 15 min · podle pocitu');
  assert.equal(cd.children[0].attrs.message, 'Vyklus 10 min · podle pocitu');
  const description = child(parseXml(result.xml), 'description').text;
  assert.ok(description.endsWith('Úseky zadané vzdáleností jsou přepočtené na čas podle cílového tempa, úseky bez něj podle tvého lehkého tempa 5:43 /km.'), description);
  assert.ok(description.includes('Úseky bez cílového tempa ukazují ve Zwiftu jako vodítko tvé lehké tempo 5:10–6:15 /km.'));
});

test('heart-rate run: easy-pace guide in Zwift, heart-rate range in the text event', () => {
  const result = Z.convert(SAMPLES.hr, OPTS);
  assert.equal(result.durationType, 'time');
  const blocks = blocksOf(result.xml);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].name, 'SteadyState');
  assert.equal(blocks[0].attrs.Duration, '2400');
  near(REF / Number(blocks[0].attrs.Power), EASY_MID, 0.05);
  assert.equal(blocks[0].children[0].attrs.message, 'Běh 40 min · tep 140–155 tep/min');
  const en = blocksOf(Z.toZwo(SAMPLES.hr, Object.assign({}, OPTS, { locale: 'en' })));
  assert.equal(en[0].children[0].attrs.message, 'Run 40 min · heart rate 140–155 bpm');
});

test('Czech plan workout keeps its UTF-8 name and description; file name is ASCII', () => {
  const xml = Z.toZwo(SAMPLES.czech, OPTS);
  const root = parseXml(xml);
  assert.equal(child(root, 'name').text, 'Lehký běh 3 km');
  assert.ok(child(root, 'description').text.startsWith('Lehký běh v tempu 5:05–6:05 /km podle tvých posledních výsledků.\n\nTempa jsou'));
  assert.equal(Z.fileName(SAMPLES.czech), 'Lehky-beh-3-km.zwo');
  assert.equal(Z.fileName(SAMPLES.reps), 'Useky-6x-400-m.zwo');
  assert.equal(Z.fileName({ name: '' }), 'veyvo-workout.zwo');
  const f = Z.file(SAMPLES.czech, OPTS);
  assert.deepEqual([f.name, f.mime, f.data], ['Lehky-beh-3-km.zwo', 'application/xml', xml]);
});

// ---------------------------------------------------------------- choices

test('durationType auto: all distance -> distance, all time -> time, mixes avoid pace guesses', () => {
  const lib = W.library(PACES);
  const types = Object.fromEntries(lib.map((t) => [t.id, Z.convert(t.workout, OPTS).durationType]));
  assert.deepEqual(types, { easy: 'distance', intervals400: 'time', intervals1k: 'time', threshold: 'time', long: 'distance', test5k: 'distance' });
  // 5 km test: converting the all-out 5 km at easy pace would be wrong, so the warm-up and
  // cool-down (easy by definition) are converted instead.
  const test5k = Z.convert(lib[5].workout, OPTS);
  assert.deepEqual(test5k.convertedPaths, ['steps.0', 'steps.2']);
  const blocks = blocksOf(test5k.xml);
  assert.deepEqual(blocks.map((b) => [b.name, b.attrs.Duration]), [['Warmup', String(Math.round(900 / EASY_MID * 100) * 10)], ['SteadyState', '5000'], ['Cooldown', String(Math.round(600 / EASY_MID * 100) * 10)]]);
  assert.equal(blocks[1].children[0].attrs.message, 'Naplno 5 km · podle pocitu');
  assert.equal(blocks[0].children[0].attrs.distoffset, '0');
  assert.ok(child(parseXml(test5k.xml), 'description').text.includes('Úseky zadané časem jsou přepočtené na vzdálenost podle tvého lehkého tempa 5:43 /km.'));
  // Pure time workout.
  assert.equal(Z.convert(workout('t', 'T', [step('active', time(600), pace(300, 320))]), OPTS).durationType, 'time');
  // Only open durations: nothing to compare, tie -> time.
  assert.equal(Z.convert(workout('o', 'O', [step('active', open())]), OPTS).durationType, 'time');
});

test('durationType forced: conversions use the step pace, meters to 10 m, seconds to 1 s', () => {
  const dist = Z.convert(SAMPLES.reps, Object.assign({}, OPTS, { durationType: 'distance' }));
  assert.equal(dist.durationType, 'distance');
  assert.deepEqual(dist.convertedPaths, ['steps.0', 'steps.2']);
  const blocks = blocksOf(dist.xml);
  assert.equal(blocks[0].attrs.Duration, '2630');                      // 900 s / 342.5 s/km
  assert.equal(blocks[1].attrs.OnDuration, '400');
  assert.equal(blocks[1].attrs.OffDuration, '200');
  assert.equal(blocks[2].attrs.Duration, '1750');
  const timed = blocksOf(Z.toZwo(SAMPLES.easy, Object.assign({}, OPTS, { durationType: 'time' })));
  assert.equal(timed[0].attrs.Duration, String(Math.round(3 * 335)));   // 3 km at 5:35 /km
  assert.equal(timed[0].children[0].attrs.timeoffset, '0');
  assert.equal(timed[0].children[0].attrs.message, 'Běh 3 km · 5:05–6:05 /km', 'text keeps the prescription');
  const en = child(parseXml(Z.toZwo(SAMPLES.easy, Object.assign({}, OPTS, { durationType: 'time', locale: 'en' }))), 'description').text;
  assert.ok(en.endsWith('Distance-based steps were converted to time using their target pace.'), en);
});

test('repeats: two steps -> IntervalsT; one or three steps and repeats: "expand" -> SteadyState × count', () => {
  const expanded = blocksOf(Z.toZwo(SAMPLES.reps, Object.assign({}, OPTS, { repeats: 'expand' })));
  assert.deepEqual(expanded.map((b) => b.name), ['Warmup'].concat(Array(12).fill('SteadyState'), ['Cooldown']));
  assert.deepEqual(expanded.slice(1, 3).map((b) => b.attrs.Duration), ['93', '69']);
  assert.equal(expanded[1].children[0].attrs.message, 'Úsek 400 m · 3:50–3:57 /km');
  assert.equal(expanded[2].children[0].attrs.message, 'Klus 200 m · podle pocitu');
  const three = workout('3', 'Three', [repeat(4, [step('active', time(60), pace(240, 250)), step('recovery', time(60)), step('rest', time(30))])]);
  const r3 = Z.convert(three, OPTS);
  assert.equal(r3.blockCount, 12);
  assert.ok(blocksOf(r3.xml).every((b) => b.name === 'SteadyState'));
  assert.equal(blocksOf(r3.xml)[2].children[0].attrs.message, 'Pauza 30 s · podle pocitu');
  const one = blocksOf(Z.toZwo(workout('1', 'One', [repeat(3, [step('active', distance(1000), pace(240, 250))])]), OPTS));
  assert.deepEqual(one.map((b) => [b.name, b.attrs.Duration]), [['SteadyState', '1000'], ['SteadyState', '1000'], ['SteadyState', '1000']]);
});

test('middle warm-up / cool-down steps keep their Zwift ramp elements; recovery/rest are SteadyState', () => {
  const w = workout('m', 'Mix', [
    step('active', time(300), pace(300, 320)),
    step('warmup', time(120), pace(260, 280)),
    step('recovery', time(60)),
    step('rest', time(60)),
    step('cooldown', time(300), pace(330, 360))
  ]);
  const blocks = blocksOf(Z.toZwo(w, OPTS));
  assert.deepEqual(blocks.map((b) => b.name), ['SteadyState', 'Warmup', 'SteadyState', 'SteadyState', 'Cooldown']);
  near(REF / Number(blocks[1].attrs.PowerLow), 280, 0.05, 'warm-up starts slow');
  near(REF / Number(blocks[1].attrs.PowerHigh), 260, 0.05, 'warm-up ends fast');
  near(REF / Number(blocks[4].attrs.PowerLow), 330, 0.05, 'cool-down starts at the fast end');
  near(REF / Number(blocks[4].attrs.PowerHigh), 360, 0.05, 'cool-down ends slow');
});

test('reference distance picks Zwift pace="0".."4"; easy pace may be a single number', () => {
  const zones = Object.fromEntries(Object.keys(Z.PACE_ZONES).map((zone) => [zone, blocksOf(Z.toZwo(SAMPLES.easy, Object.assign({}, OPTS, { referenceDistance: zone })))[0].attrs.pace]));
  assert.deepEqual(zones, { mile: '0', '5k': '1', '10k': '2', half: '3', marathon: '4' });
  const desc = child(parseXml(Z.toZwo(SAMPLES.easy, Object.assign({}, OPTS, { referenceDistance: 'half', referencePaceSecPerKm: 280 }))), 'description').text;
  assert.equal(desc, 'Tempa jsou v souboru zapsaná jako podíl tvého tempa na půlmaraton (4:40 /km). Stejné tempo nastav ve Zwiftu v Edit Paces.');
  const enDesc = child(parseXml(Z.toZwo(SAMPLES.easy, Object.assign({}, OPTS, { referenceDistance: 'mile', locale: 'en' }))), 'description').text;
  assert.equal(enDesc, 'Paces in this file are stored relative to your mile pace (4:18 /km). Set the same pace in Zwift under Edit Paces.');
  const flat = blocksOf(Z.toZwo(SAMPLES.reps, { referencePaceSecPerKm: 240, easyPaceSecPerKm: 330 }));
  assert.equal(flat[0].attrs.PowerLow, flat[0].attrs.PowerHigh, 'single easy pace -> flat warm-up');
  assert.equal(flat[0].attrs.PowerLow, String(Math.round((240 / 330) * 1e4) / 1e4));
  assert.ok(child(parseXml(Z.toZwo(SAMPLES.reps, { referencePaceSecPerKm: 240, easyPaceSecPerKm: 330 })), 'description').text
    .includes('tvé lehké tempo 5:30 /km.'));
});

test('open-duration steps get a nominal length and say so', () => {
  const w = workout('lap', 'Lap', [step('warmup', open()), step('active', distance(2000), pace(250, 260)), step('cooldown', open())]);
  const result = Z.convert(w, OPTS);
  assert.equal(result.durationType, 'distance');
  assert.deepEqual(result.openPaths, ['steps.0', 'steps.2']);
  const blocks = blocksOf(result.xml);
  assert.deepEqual(blocks.map((b) => b.attrs.Duration), ['1000', '2000', '1000']);
  assert.equal(blocks[0].children[0].attrs.message, 'Rozklus · podle pocitu · bez pevné délky, v souboru 1 km');
  const timed = blocksOf(Z.toZwo(w, Object.assign({}, OPTS, { durationType: 'time', openStepSeconds: 420, locale: 'en' })));
  assert.equal(timed[0].attrs.Duration, '420');
  assert.equal(timed[0].children[0].attrs.message, 'Warm-up · by feel · no fixed length, 7 min in this file');
  assert.equal(blocksOf(Z.toZwo(w, Object.assign({}, OPTS, { openStepMeters: 800 })))[2].attrs.Duration, '800');
});

test('textEvents: false writes self-closing blocks only', () => {
  const xml = Z.toZwo(SAMPLES.reps, Object.assign({}, OPTS, { textEvents: false }));
  assert.doesNotMatch(xml, /textevent/);
  assert.ok(blocksOf(xml).every((b) => b.children.length === 0));
  assert.match(xml, /<IntervalsT Repeat="6" OnDuration="93" OffDuration="69" OnPower="[\d.]+" OffPower="[\d.]+" pace="1"\/>/);
});

test('XML escaping: names, descriptions, labels; control characters and lone surrogates dropped', () => {
  const w = workout('x', 'A & B <C> "D" \'E\'', [step('active', time(600), pace(300, 320), 'Kopec <&> "1"')], {
    description: 'Řádek 1\r\nŘádek 2 & <b>\u0001\u0007 \uD800 konec 🏃'
  });
  const xml = Z.toZwo(w, OPTS);
  assert.match(xml, /<name>A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;<\/name>/);
  const root = parseXml(xml);
  assert.equal(child(root, 'name').text, 'A & B <C> "D" \'E\'');
  assert.ok(child(root, 'description').text.startsWith('Řádek 1\nŘádek 2 & <b>  konec 🏃\n\n'));
  assert.doesNotMatch(xml, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  assert.equal(blocksOf(xml)[0].children[0].attrs.message, 'Kopec <&> "1" 10 min · 5:00–5:20 /km');
  assert.equal(Z.escapeXml('a\nb\tc'), 'a\nb\tc');
  assert.equal(Z.escapeXml(null), '');
  assert.equal(Z.escapeXml('\uDC00\uDC00x🏃'), 'x🏃');
});

test('every library session (cs/en) is well-formed and physically consistent', () => {
  for (const locale of ['cs', 'en']) {
    for (const template of W.library(PACES, { locale: locale })) {
      const result = Z.convert(template.workout, Object.assign({ locale: locale }, OPTS));
      const root = parseXml(result.xml);
      assert.equal(child(root, 'name').text, template.workout.name);
      const blocks = child(root, 'workout').children;
      assert.equal(blocks.length, result.blockCount);
      for (const b of blocks) {
        assert.ok(['Warmup', 'SteadyState', 'IntervalsT', 'Cooldown'].includes(b.name), b.name);
        for (const [key, value] of Object.entries(b.attrs)) {
          assert.match(value, /^\d+(\.\d{1,4})?$/, template.id + ' ' + b.name + ' ' + key);
          if (/Power/.test(key)) assert.ok(Number(value) > 0.3 && Number(value) < 1.3, key + '=' + value);
        }
        assert.equal(b.children.length, 1);
        assert.equal(b.children[0].name, 'textevent');
      }
    }
  }
});

// ---------------------------------------------------------------- options + errors

test('optionsFromPaces: exact best 5 km pace, else current; easy range copied', () => {
  assert.deepEqual(OPTS, { referencePaceSecPerKm: 258, referenceDistance: '5k', easyPaceSecPerKm: { fastSecPerKm: 310, slowSecPerKm: 375 } });
  assert.equal(Z.optionsFromPaces(W.derivePaces({ best5kSeconds: 1293 })).referencePaceSecPerKm, 258.6);
  const goalOnly = W.derivePaces({ targetSeconds: 1200 });
  assert.equal(Z.optionsFromPaces(goalOnly).referencePaceSecPerKm, goalOnly.currentSecPerKm);
  assert.deepEqual(Z.optionsFromPaces(PACES, { locale: 'en', repeats: 'expand' }).repeats, 'expand');
  assert.equal(Z.optionsFromPaces(null), null);
});

test('errors: reference pace, easy pace, bad options, invalid workout', () => {
  assert.throws(() => Z.toZwo(SAMPLES.easy), (e) => e.code === 'zwo_reference_pace_required');
  assert.throws(() => Z.toZwo(SAMPLES.easy, {}), (e) => e.code === 'zwo_reference_pace_required');
  for (const bad of [0, 100, 2401, NaN, '258']) {
    assert.throws(() => Z.toZwo(SAMPLES.easy, { referencePaceSecPerKm: bad }), (e) => e.code === 'zwo_option_invalid' && e.option === 'referencePaceSecPerKm', String(bad));
  }
  // Pace-only workout needs no easy pace.
  assert.doesNotThrow(() => Z.toZwo(SAMPLES.easy, { referencePaceSecPerKm: 258 }));
  assert.throws(() => Z.toZwo(SAMPLES.reps, { referencePaceSecPerKm: 258 }),
    (e) => e.code === 'zwo_easy_pace_required' && e.paths.join() === 'steps.0,steps.1.steps.1,steps.2');
  const badOptions = [
    ['easyPaceSecPerKm', { easyPaceSecPerKm: 50 }],
    ['easyPaceSecPerKm', { easyPaceSecPerKm: 2401 }],
    ['easyPaceSecPerKm', { easyPaceSecPerKm: { fastSecPerKm: 380, slowSecPerKm: 310 } }],
    ['referenceDistance', { referenceDistance: '21k' }],
    ['durationType', { durationType: 'meters' }],
    ['repeats', { repeats: 'nested' }],
    ['openStepSeconds', { openStepSeconds: 0 }],
    ['openStepMeters', { openStepMeters: -5 }]
  ];
  for (const [option, extra] of badOptions) {
    assert.throws(() => Z.toZwo(SAMPLES.reps, Object.assign({}, OPTS, extra)), (e) => e.code === 'zwo_option_invalid' && e.option === option, option);
  }
  const invalid = workout('i', 'Bad', [step('active', time(5))]);
  assert.throws(() => Z.toZwo(invalid, OPTS), (e) => e.code === 'workout_invalid' && e.errors[0].code === 'duration_time_range');
});

test('check(): the same rules without throwing', () => {
  assert.deepEqual(Z.check(SAMPLES.easy, OPTS), { ok: true, durationType: 'distance', convertedPaths: [], openPaths: [] });
  assert.deepEqual(Z.check(SAMPLES.reps, { referencePaceSecPerKm: 258 }), { ok: false, code: 'zwo_easy_pace_required', paths: ['steps.0', 'steps.1.steps.1', 'steps.2'] });
  assert.deepEqual(Z.check(SAMPLES.easy, null), { ok: false, code: 'zwo_reference_pace_required' });
  assert.deepEqual(Z.check(SAMPLES.easy, { referencePaceSecPerKm: 258, repeats: 'x' }), { ok: false, code: 'zwo_option_invalid', option: 'repeats' });
  const bad = Z.check({}, OPTS);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'workout_invalid');
  assert.ok(bad.errors.length > 0);
});

test('classic scripts: VeyvoZwo global after workouts.js, error without it', () => {
  const missing = {};
  vm.createContext(missing);
  assert.throws(() => vm.runInContext(fs.readFileSync(SRC, 'utf8'), missing), /needs VeyvoWorkouts/);
  const page = {};
  vm.createContext(page);
  vm.runInContext(fs.readFileSync(WORKOUTS_SRC, 'utf8'), page);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), page);
  assert.equal(typeof page.VeyvoZwo.toZwo, 'function');
  const w = page.VeyvoWorkouts.library(PACES)[1].workout;
  assert.equal(page.VeyvoZwo.toZwo(w, OPTS), Z.toZwo(w, OPTS));
});

test('slow runners: derivePaces() easy ranges beyond 12:00 /km still export (beginner 45:00 5 km, walker 1:10:00)', () => {
  for (const best of [2700, 3000, 3600, 4200, 7200]) {
    const paces = W.derivePaces({ best5kSeconds: best, targetSeconds: 2400 });
    const opts = Z.optionsFromPaces(paces);
    for (const template of W.library(paces)) {
      const xml = Z.toZwo(template.workout, opts);
      assert.match(xml, /<sportType>run<\/sportType>/, best + ' ' + template.id);
      for (const m of xml.matchAll(/(?:Power|PowerLow|PowerHigh|OnPower|OffPower)="([^"]+)"/g)) {
        assert.ok(Number(m[1]) > 0 && Number.isFinite(Number(m[1])), best + ' ' + template.id + ' ' + m[0]);
      }
    }
  }
  assert.ok(W.derivePaces({ best5kSeconds: 2700 }).easy.slowSecPerKm > W.LIMITS.paceSlowest, 'the case this guards really happens');
});
