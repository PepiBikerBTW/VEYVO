// Store listings (docs/store) and the GitHub Pages site (site/): length limits, required notices,
// store-policy wording, and the rule that the public contact email appears only where the owner approved it.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, 'docs', 'store');
const SITE = path.join(ROOT, 'site');
const counter = require(path.join(STORE, 'count-chars.cjs'));

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fields = rel => Object.fromEntries(counter.fieldsOf(read(rel)).map(f => [f.id, f.text]));

const PLAY = ['docs/store/play-listing.cs.md', 'docs/store/play-listing.en.md'];
const APPSTORE = ['docs/store/appstore-listing.cs.md', 'docs/store/appstore-listing.en.md'];
const DISCLAIMER = {
  cs: 'VEYVO není zdravotnický prostředek a nediagnostikuje, neléčí, nevyléčí ani nepředchází žádnému onemocnění.',
  en: 'VEYVO is not a medical device and does not diagnose, treat, cure, or prevent any medical condition.'
};
const CONSULT = { cs: 'poraď s lékařem', en: 'Consult a healthcare professional' };
const langOf = rel => (rel.includes('.cs.') ? 'cs' : 'en');
// Built from parts so this file does not count as a place the address is published.
const CONTACT = ['pepik.kozisek', 'seznam.cz'].join('@');

test('every store text field is within its limit and not empty', () => {
  const rows = counter.check();
  assert.ok(rows.length >= 20, 'expected all listing fields, got ' + rows.length);
  const bad = rows.filter(r => !r.ok).map(r => r.file + ' ' + r.id + ' ' + r.used + '/' + r.max);
  assert.deepEqual(bad, [], counter.table(rows));
});

test('each listing has the fields its store requires', () => {
  for (const rel of PLAY) assert.deepEqual(Object.keys(fields(rel)).sort(), ['full', 'name', 'release-notes', 'short'], rel);
  for (const rel of APPSTORE) {
    assert.deepEqual(Object.keys(fields(rel)).sort(), ['description', 'keywords', 'name', 'promo', 'subtitle', 'whats-new'], rel);
  }
  assert.ok(fields('docs/store/declarations.md')['app-review-notes'], 'App Review note');
});

test('full descriptions carry the health notice (Play Health policy, App Store 1.4.1)', () => {
  for (const [rel, key] of PLAY.map(r => [r, 'full']).concat(APPSTORE.map(r => [r, 'description']))) {
    const text = fields(rel)[key], lang = langOf(rel);
    assert.ok(text.includes(DISCLAIMER[lang]), rel + ': medical device notice');
    assert.ok(text.includes(CONSULT[lang]), rel + ': consult a professional');
  }
});

test('store texts name only what the store build does', () => {
  // Play build: no Strava, no updater, no Health Connect yet. App Store build: no other platforms (2.3.10).
  const PLAY_BANNED = /\b(Strava|Windows|GitHub|APK|Health Connect|App Store|iOS)\b/i;
  const APPLE_BANNED = /\b(Strava|Windows|GitHub|APK|Android|Google|Play Store|Pixel)\b/i;
  // URLs are left out: the privacy policy itself lives on pepibikerbtw.github.io.
  const words = text => text.replace(/https?:\/\/\S+/g, '');
  for (const rel of PLAY) for (const [id, text] of Object.entries(fields(rel))) assert.doesNotMatch(words(text), PLAY_BANNED, rel + ' ' + id);
  for (const rel of APPSTORE) for (const [id, text] of Object.entries(fields(rel))) assert.doesNotMatch(words(text), APPLE_BANNED, rel + ' ' + id);
  assert.doesNotMatch(words(fields('docs/store/declarations.md')['app-review-notes']), APPLE_BANNED, 'App Review note');
  for (const rel of PLAY.concat(APPSTORE)) {
    for (const [id, text] of Object.entries(fields(rel))) assert.doesNotMatch(text, /\{\{|\}\}/, rel + ' ' + id + ': unfilled placeholder');
  }
});

test('the iOS release guide has no unfilled owner placeholders', () => {
  assert.doesNotMatch(read('docs/ios-release.md'), /\{\{(CONTACT_EMAIL|PUBLISHER_NAME|EFFECTIVE_DATE)\}\}/);
});

test('App Store keywords: comma list, no spaces around commas, no trademarks, no words from name or subtitle', () => {
  for (const rel of APPSTORE) {
    const f = fields(rel);
    const words = f.keywords.split(',');
    assert.ok(words.every(w => w.length && w === w.trim()), rel + ': spaces around commas');
    assert.equal(new Set(words).size, words.length, rel + ': duplicate keyword');
    assert.doesNotMatch(f.keywords, /garmin|apple|watch|strava|coros|suunto|zwift|intervals\.icu|veyvo/i, rel + ': trademark or app name');
    const titleWords = new Set((f.name + ' ' + f.subtitle).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2));
    for (const w of words.join(' ').toLowerCase().split(/\s+/)) assert.ok(!titleWords.has(w), rel + ': "' + w + '" is already in the name or subtitle');
  }
});

// ---------------------------------------------------------------- site/
const PAGES = ['index.html', 'privacy/index.html', 'support/index.html'];

test('site pages: health notice in every footer, no placeholders, nothing from other hosts', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(SITE, page), 'utf8');
    const foot = html.slice(html.indexOf('<footer'));
    assert.ok(foot.includes('VEYVO není zdravotnický prostředek'), page + ': Czech health notice in the footer');
    assert.ok(foot.includes('VEYVO is not a medical device'), page + ': English health notice in the footer');
    assert.ok(foot.includes('Josef Kožíšek'), page + ': publisher in the footer');
    assert.doesNotMatch(html, /\{\{|\}\}/, page + ': unfilled placeholder');
    assert.doesNotMatch(html, /<(script|link)\b[^>]*\b(src|href)="(https?:)?\/\//i, page + ': external script or stylesheet');
  }
  const css = fs.readFileSync(path.join(SITE, 'site.css'), 'utf8');
  assert.doesNotMatch(css, /url\((['"]?)(https?:)?\/\//, 'site.css loads nothing from other hosts');
  for (const m of css.matchAll(/url\('([^']+)'\)/g)) assert.ok(fs.existsSync(path.join(SITE, m[1])), 'font file ' + m[1]);
  assert.doesNotMatch(css, /border-radius:\s*(\d{3,}|[2-9]\d|1[1-9])px/, 'radius <= 10 px (no pills)');
  assert.match(css, /prefers-reduced-motion: reduce/, 'reduced motion');
  assert.match(css, /prefers-color-scheme: light/, 'light theme');
});

test('site pages: every local link and image exists', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(SITE, page), 'utf8');
    const dir = path.dirname(path.join(SITE, page));
    for (const m of html.matchAll(/\b(?:href|src)="([^"#:]+)(?:#[^"]*)?"/g)) {
      const target = path.resolve(dir, m[1]);
      const file = m[1].endsWith('/') ? path.join(target, 'index.html') : target;
      assert.ok(fs.existsSync(file), page + ' links to missing ' + m[1]);
    }
  }
});

test('privacy policy: the URL the app opens, publisher, contact, effective date, required sections', () => {
  const settings = read('src/ui/settings.js');
  const url = /const PRIVACY_URL = '([^']+)'/.exec(settings)[1];
  assert.equal(url, 'https://pepibikerbtw.github.io/VEYVO/privacy/');
  const html = fs.readFileSync(path.join(SITE, 'privacy', 'index.html'), 'utf8');
  assert.ok(html.includes('id="cs"') && html.includes('id="en"'), 'both languages with anchors');
  assert.ok(html.includes('Josef Kožíšek') && html.includes('mailto:' + CONTACT), 'publisher and contact');
  assert.ok(html.includes('1.&nbsp;prosince 2026') && html.includes('1 December 2026'), 'effective date');
  for (const word of ['intervals.icu', 'Strava', 'Apple Health', 'Smazat všechna data', 'Delete all data', '18+', 'GDPR']) {
    assert.ok(html.includes(word), 'privacy policy mentions ' + word);
  }
});

test('the public contact email appears only in the privacy policy, the support page, the store listings and the iOS release guide', () => {
  const allowed = new Set([
    'site/privacy/index.html', 'site/support/index.html',
    'docs/store/play-listing.cs.md', 'docs/store/play-listing.en.md',
    'docs/store/appstore-listing.cs.md', 'docs/store/appstore-listing.en.md',
    'docs/ios-release.md' // App Review contact and TestFlight feedback address
  ]);
  const found = [];
  const walk = rel => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(full)) {
        if (name === 'node_modules' || name === 'build' || name === '.gradle' || name === 'Pods') continue;
        walk(path.join(rel, name));
      }
    } else if (/\.(html|css|js|cjs|mjs|md|json|yml|yaml|txt|plist|strings|xml|gradle|swift)$/.test(rel) && st.size < 2e6) {
      if (fs.readFileSync(full, 'utf8').includes(CONTACT)) found.push(rel.split(path.sep).join('/'));
    }
  };
  for (const rel of ['site', 'docs', 'src', 'electron', 'tests', '.github', 'assets', 'mobile/scripts', 'mobile/ios/App/App', 'README.md', 'AGENTS.md', 'package.json']) walk(rel);
  assert.deepEqual(found.filter(f => !allowed.has(f)), [], 'email outside the approved places');
  for (const must of ['site/privacy/index.html', 'site/support/index.html', 'docs/store/play-listing.cs.md', 'docs/store/play-listing.en.md', 'docs/ios-release.md']) {
    assert.ok(found.includes(must), 'contact email missing in ' + must);
  }
});
