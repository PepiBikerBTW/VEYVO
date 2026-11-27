// UI foundation guards: shared i18n namespaces are complete, Czech typography helpers, the shell's
// script order, and the owner's design rules that are cheap to check mechanically (no innerHTML,
// no emoji/glyph icons, no rounded-pill radii, motion kill switches present).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// Load the core the way the browser does (globals), then the UI runtime files.
globalThis.VeyvoFormat = require('../src/core/format.js');
globalThis.VeyvoI18n = require('../src/core/i18n.js');
globalThis.VeyvoRuns = require('../src/core/runs-model.js');
globalThis.VeyvoStore = require('../src/core/store.js');
globalThis.VeyvoWorkouts = require('../src/core/workouts.js');
globalThis.VeyvoTraining = require('../src/training-context.js');
globalThis.VeyvoPlatform = require('../src/platform.js');
for (const file of ['dom.js', 'icons.js', 'motion.js', 'charts.js', 'app.js']) require(path.join(SRC, 'ui', file));
const UI = globalThis.VeyvoUI;
const I18n = globalThis.VeyvoI18n;
const NB = ' ';

test('ui and charts namespaces are complete in Czech and English', () => {
  for (const ns of ['ui', 'charts']) {
    const report = I18n.audit(ns);
    const problems = [];
    const walk = (value, where) => {
      if (Array.isArray(value)) value.forEach(item => problems.push(where + ': ' + JSON.stringify(item)));
      else if (value && typeof value === 'object') Object.keys(value).forEach(k => walk(value[k], where + '.' + k));
    };
    walk(report, ns);
    assert.deepEqual(problems, [], ns + ' i18n audit');
  }
});

test('fmt.typo: numbers keep their units and words, Czech one-letter words stick to the next word', () => {
  const { typo } = UI.fmt;
  assert.equal(typo('5 km pod 20:00', 'cs'), '5' + NB + 'km pod 20:00');
  assert.equal(typo('za 3 dny v neděli', 'cs'), 'za 3' + NB + 'dny v' + NB + 'neděli');
  assert.equal(typo('tempo 4:12 /km', 'cs'), 'tempo 4:12' + NB + '/km');
  assert.equal(typo('út 24. 11.', 'cs'), 'út 24.' + NB + '11.');
  assert.equal(typo('chybí 62 s a k cíli', 'cs'), 'chybí 62' + NB + 's a' + NB + 'k' + NB + 'cíli');
  assert.equal(typo('a run of 5 km', 'en'), 'a run of 5' + NB + 'km', 'English: only number rules');
  assert.equal(typo(null), '');
});

test('fmt helpers: decimal comma, non-breaking units, goal label from the profile', () => {
  I18n.setLocale('cs');
  const f = UI.fmt;
  assert.equal(f.kmUnit(5), '5,0' + NB + 'km');
  assert.equal(f.paceUnit(252), '4:12' + NB + '/km');
  assert.equal(f.seconds(-62), '−62' + NB + 's');
  assert.equal(f.hours(7.2), '7,2' + NB + 'h');
  assert.equal(f.date('2026-11-24'), 'út' + NB + '24.' + NB + '11.');
  assert.equal(f.count('common.count.runs', 3), '3' + NB + 'běhy');
  assert.equal(f.goal({ goalDistanceKm: 5, targetSeconds: 1200 }), '5' + NB + 'km pod 20:00');
  assert.equal(f.goal({ goalDistanceKm: 10, targetSeconds: null }), 'Cíl 10' + NB + 'km');
  I18n.setLocale('en');
  assert.equal(f.kmUnit(5), '5.0' + NB + 'km');
  assert.equal(f.goal({ goalDistanceKm: 5, targetSeconds: 1200 }), '5' + NB + 'km under 20:00');
  I18n.setLocale('cs');
});

test('charts: one series encoding for every run type; icons cover the shell set', () => {
  const g = UI.charts.groupOf;
  assert.deepEqual(['run', 'test5k', 'race', 'intervals', 'tempo', 'easy', 'long', 'Lehký běh'].map(g),
    ['fast', 'fast', 'fast', 'quality', 'quality', 'easy', 'easy', 'easy']);
  for (const name of ['home', 'calendar', 'trend', 'checklist', 'fork-knife', 'settings', 'plus', 'play', 'check', 'x', 'chevron-right', 'arrow-right',
    'flag', 'clock', 'route', 'gauge', 'heart', 'watch', 'download', 'upload', 'share', 'link', 'refresh', 'trash', 'edit', 'info', 'warning',
    'moon', 'sun', 'language', 'strava', 'garmin', 'user', 'more', 'menu', 'filter']) {
    assert.ok(UI.icons.has(name), 'icon ' + name);
  }
  assert.equal(UI.icons.has('flame'), false);
});

test('app runtime exposes the documented API', () => {
  const app = UI.app;
  for (const fn of ['start', 'state', 'update', 'derived', 'today', 't', 'navigate', 'toast', 'confirm', 'setTheme', 'setLanguage', 'on', 'refresh']) {
    assert.equal(typeof app[fn], 'function', 'app.' + fn);
  }
  for (const reg of ['pages', 'dialogs', 'components', 'actions']) assert.equal(typeof app[reg].register, 'function', reg + '.register');
  for (const name of ['segmented', 'scale', 'dayToggles', 'stepper', 'switch', 'range', 'field', 'stat', 'empty', 'skeleton', 'typeTag', 'valueUnit', 'meter', 'legend', 'callout', 'placeholder']) {
    assert.ok(app.components.has(name), 'component ' + name);
  }
  assert.equal(typeof app.strava.sync, 'function');
  const run = app.strava.toRun({ id: 42, name: 'Večerní běh', startDateLocal: '2026-11-24T23:40:00Z', distanceKm: 5.04, movingTime: 1265, averageHeartrate: 171, totalElevationGain: 12 });
  assert.deepEqual(run, { id: 'strava-42', stravaActivityId: '42', source: 'strava', date: '2026-11-24', startTime: '23:40', type: 'run', name: 'Večerní běh', distance: 5.04, movingSeconds: 1265, effort: null, note: '', averageHeartrate: 171, elevationGain: 12 });
});

test('index.html loads every module in the documented order, and every file exists', () => {
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.deepEqual(scripts, [
    'vendor/workoutkit.js', 'core/format.js', 'core/i18n.js', 'core/runs-model.js', 'core/store.js', 'core/workouts.js',
    'core/export/fit.js', 'core/export/apple.js', 'core/export/zwo.js', 'core/export/intervals.js', 'training-context.js',
    'nutrition-context.js', 'platform.js', 'ui/dom.js', 'ui/icons.js', 'ui/motion.js', 'ui/charts.js', 'ui/app.js',
    'ui/home.js', 'ui/plan.js', 'ui/progress.js', 'ui/run-dialog.js', 'ui/recovery.js', 'ui/workout-sheet.js', 'ui/settings.js',
    'ui/onboarding.js', 'ui/nutrition.js', 'ui/boot.js'
  ]);
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
  for (const file of scripts.concat(styles)) assert.ok(fs.existsSync(path.join(SRC, file)), file + ' exists');
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /<script>|onclick=|javascript:/i, 'no inline script');
  assert.match(html, /viewport-fit=cover/);
});

test('design rules: no innerHTML, no emoji or glyph icons, radii <= 10px, reduced-motion kill switch', () => {
  const uiDir = path.join(SRC, 'ui');
  const files = fs.readdirSync(uiDir).filter(f => f.endsWith('.js')).map(f => path.join(uiDir, f)).concat([path.join(SRC, 'index.html')]);
  // emoji, dingbats, arrows/geometric glyphs used as icons in 0.3 (⌁ ◫ ▤ ↻ ☾ ☀ ✓ ▶ …)
  const glyphs = /[←-⇿⌀-⏿■-➿⬀-⯿\u{1F000}-\u{1FAFF}]/u;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/, path.basename(file) + ' builds DOM safely');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, glyphs, path.basename(file) + ' uses SVG icons, not glyphs');
  }
  const cssDir = path.join(SRC, 'styles');
  const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => path.join(cssDir, f))
    .concat(fs.readdirSync(path.join(cssDir, 'pages')).map(f => path.join(cssDir, 'pages', f)));
  for (const file of cssFiles) {
    const css = fs.readFileSync(file, 'utf8');
    for (const m of css.matchAll(/border-radius:\s*([^;}]+)/g)) {
      for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) assert.ok(Number(px[1]) <= 10, path.basename(file) + ': radius ' + m[1]);
      assert.doesNotMatch(m[1], /999|9999|100%/, path.basename(file) + ': no pill radius');
    }
    assert.doesNotMatch(css, /linear-gradient\([^)]*(#7c3aed|#8b5cf6|purple|violet)/i, 'no purple gradients');
  }
  const motion = fs.readFileSync(path.join(cssDir, 'motion.css'), 'utf8');
  assert.match(motion, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(motion, /\[data-anim="off"\]/);
  for (const m of motion.matchAll(/--dur-\d|(\d+)ms/g)) if (m[1]) assert.ok(Number(m[1]) <= 450, 'motion duration ' + m[0]);
});

test('charts: the pace chart description is pluralised (1 běh, 3 běhy, 5 běhů; 1 run)', () => {
  const I18n = globalThis.VeyvoI18n;
  const p = n => ({ n, from: '1. 11.', to: '24. 11.' });
  I18n.setLocale('cs');
  assert.match(I18n.t('charts.pace.desc', p(1)), /^1 běh od /);
  assert.match(I18n.t('charts.pace.desc', p(3)), /^3 běhy od /);
  assert.match(I18n.t('charts.pace.desc', p(5)), /^5 běhů od /);
  I18n.setLocale('en');
  assert.match(I18n.t('charts.pace.desc', p(1)), /^1 run from /);
  assert.match(I18n.t('charts.pace.desc', p(4)), /^4 runs from /);
  I18n.setLocale('cs');
});
