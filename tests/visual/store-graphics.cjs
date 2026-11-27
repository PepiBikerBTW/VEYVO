// VEYVO store graphics: renders the REAL app with tests/visual/screenshots.cjs (demo seed, store build
// channel) and composes the store images on an Electron canvas. Dev only: not shipped, not part of npm test.
//
//   E=<path to an Electron binary>   # e.g. the Linux build in the session scratchpad
//   $E --ozone-platform=headless --no-sandbox tests/visual/store-graphics.cjs \
//       [--out docs/store/graphics] [--only icon,feature,play,ios69,ios63,site] [--lang cs,en] [--screens overview,result]
//       [--plain] [--keep]
//
// Output (all PNGs are opaque; screenshots and the feature graphic have no alpha channel at all):
//   play-icon-512.png                                 Google Play icon, 512 x 512, 32-bit PNG (alpha 255 everywhere)
//   play-feature-<lang>.png                           Google Play feature graphic, 1024 x 500, 24-bit PNG
//   play-phone-<lang>-<n>-<screen>.png                Google Play phone screenshots, 1080 x 2400 ('play' build, Android shell)
//   ios-6.9-<lang>-<n>-<screen>.png                   App Store iPhone 6.9", 1320 x 2868 ('appstore' build)
//   ios-6.3-<lang>-<n>-<screen>.png                   App Store iPhone 6.3", 1206 x 2622 ('appstore' build)
//   site/img/<screen>-<lang>.webp, site/img/icon-192.png   website screenshots (560 x 1120) and icon (--only site)
// --plain writes the screenshots without the caption band (the app fills the whole image).
//
// Every screenshot is the app rendered at a phone viewport (Play 390 x 780 CSS px at 2.4x, iPhone 6.9" 440 x 870
// and 6.3" 400 x 795 at 2.6x, so the app is drawn at the final pixel size, never upscaled) from the demo
// seed (the owner's 9 real runs, 27. 10. - 24. 11. 2026, today pinned to 2026-11-27). Nothing is drawn
// over the app: the caption band sits above it. The result screen logs the real 24. 11. run (5,0 km in
// 21:02) on that day, so the app itself shows the 5 km personal best against the 10. 11. run (21:30).
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(__dirname, 'screenshots.cjs');
const SYNC = path.join(ROOT, 'mobile', 'scripts', 'sync-web.mjs');
const FONT_CSS = path.join(ROOT, 'src', 'styles', 'fonts.css');
const FONT_DIR = path.join(ROOT, 'src', 'fonts');
const ICON = path.join(ROOT, 'assets', 'veyvo-icon.png');
const SITE_IMG = path.join(ROOT, 'site', 'img');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[argv[i].slice(2)] = true;
    else { out[argv[i].slice(2)] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(process.argv.findIndex(a => a.endsWith('store-graphics.cjs')) + 1));
const list = (v, d) => String(v || d).split(',').map(s => s.trim()).filter(Boolean);
const OUT = path.resolve(args.out || path.join(ROOT, 'docs', 'store', 'graphics'));
const ONLY = list(args.only, 'icon,feature,play,ios69,ios63,site');
const LANGS = list(args.lang, 'cs,en');
const SCREEN_IDS = args.screens ? list(args.screens) : null; // e.g. --screens result,watch (default: all six)
const TODAY = '2026-11-27';
const SCALE = 2.6;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvo-store-'));
// Chromium switches this process got (headless, sandbox) are passed on to the screenshots.cjs runs.
const CHROMIUM_FLAGS = process.argv.filter(a => /^--(ozone-platform|no-sandbox|disable-gpu|enable-features|disable-features)/.test(a));

// ---------------------------------------------------------------- Track palette (src/styles/tokens.css, dark)
const C = {
  bg: '#0D0E11', surface0: '#09090B', surface1: '#141619', line: '#2A2E35', lineSoft: '#1E2126',
  text: '#F3F4F6', muted: '#A9B0BA', faint: '#878F9A', accent: '#F5621A', accentText: '#FF7A3D', cool: '#4C9BFF'
};

// ---------------------------------------------------------------- targets and screens
const TARGETS = {
  play: { channel: 'play', platform: 'android', css: [390, 780], scale: 2.4, canvas: [1080, 2400], file: (lang, n, id) => 'play-phone-' + lang + '-' + n + '-' + id + '.png' },
  ios69: { channel: 'appstore', platform: 'ios', css: [440, 870], canvas: [1320, 2868], file: (lang, n, id) => 'ios-6.9-' + lang + '-' + n + '-' + id + '.png', ios: true },
  ios63: { channel: 'appstore', platform: 'ios', css: [400, 795], canvas: [1206, 2622], file: (lang, n, id) => 'ios-6.3-' + lang + '-' + n + '-' + id + '.png', ios: true }
};

// Phones draw overlay scrollbars only while scrolling, so the captures hide the desktop scrollbars.
const PHONE_CSS = '*{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}';
/** Scrolls the page scroller so the element's top sits `offset` CSS px below the scroller's top. */
const scrollTo = (selector, offset) => "(function(){var m=document.querySelector('#main');var el=document.querySelector(" + JSON.stringify(selector) +
  ");if(!m||!el)return;m.scrollTop+=el.getBoundingClientRect().top-m.getBoundingClientRect().top-" + offset + ";})();";
const brand = id => id ? "VeyvoUI.app.update(function(s){s.ui=Object.assign({},s.ui,{lastExportBrand:" + JSON.stringify(id) + "});},{reason:'store-shot',render:false});" : '';
// The real 24. 11. run, logged on that day through the run dialog (the demo seed minus that run).
const LOG_PB_RUN = [
  "(function(){var app=VeyvoUI.app;",
  "app.update(function(s){s.runHistory=s.runHistory.filter(function(r){return r.date!=='2026-11-24';});},{reason:'store-shot',render:false});",
  "app.dialogs.open('run',{mode:'new',date:'2026-11-24'});",
  "function set(sel,v){var el=document.querySelector('dialog[open] '+sel);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);",
  "el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}",
  "setTimeout(function(){set('[data-key=\"rd-distance\"]','5');set('[data-key=\"rd-time\"]','21:02');",
  "var ty=document.querySelector('dialog[open] [data-key=\"rd-type:run\"]');if(ty)ty.click();",
  "var ef=document.querySelector('dialog[open] [data-key=\"rd-effort:9\"]');if(ef)ef.click();",
  "document.querySelector('dialog[open] [data-key=\"rd-save\"]').click();",
  // Wait for the result view (PB banner with its lane chart), then drop the focus the view gives its
  // Done button: a tap on a phone shows no focus ring.
  "var n=0;(function ready(){var lanes=document.querySelector('dialog[open] .rd-result .rd-pb-lanes svg');",
  "if(!lanes&&++n<60)return setTimeout(ready,50);if(document.activeElement)document.activeElement.blur();",
  "document.documentElement.setAttribute('data-shot-ready','1');})();},200);})();"
].join('');

// Captions: eyebrow = the app's own name for the screen, headline = what it does (no claims, no numbers).
const SCREENS = [
  {
    id: 'overview', page: 'home', run: () => '',
    eyebrow: { cs: 'Přehled', en: 'Overview' },
    title: { cs: 'Další běh a cíl na jednom místě', en: 'Your next run and your goal at a glance' }
  },
  {
    id: 'plan', page: 'plan', run: () => '',
    eyebrow: { cs: 'Můj plán', en: 'My plan' },
    title: { cs: 'Týden podle dnů, kdy můžeš běhat', en: 'A week built around the days you can run' }
  },
  {
    id: 'progress', page: 'progress', run: () => scrollTo('.prog-pace', 12),
    eyebrow: { cs: 'Výkonnost', en: 'Progress' },
    title: { cs: 'Pokrok spočítaný z tvých běhů', en: 'Progress worked out from your own runs' }
  },
  {
    id: 'watch', page: 'home', settle: 800, run: t => brand(t.ios ? 'apple' : null) + "VeyvoUI.app.dialogs.open('workout',{});",
    eyebrow: { cs: 'Do hodinek', en: 'To your watch' },
    title: {
      cs: 'Trénink do hodinek Garmin, Apple Watch, COROS a dalších',
      en: 'Send workouts to Garmin, Apple Watch, COROS and more'
    },
    titleIos: {
      cs: 'Trénink do Apple Watch, Garminu i dalších hodinek',
      en: 'Send workouts to Apple Watch, Garmin and more'
    }
  },
  {
    id: 'prerun', page: 'nutrition', run: () => scrollTo('.nut-timeline', 12),
    eyebrow: { cs: 'Před během', en: 'Before the run' },
    title: { cs: 'Co jíst a pít před během, se zdroji', en: 'What to eat and drink before a run, with sources' }
  },
  {
    id: 'result', page: 'home', today: '2026-11-24', settle: 1600, run: () => LOG_PB_RUN,
    eyebrow: { cs: 'Zapsat běh', en: 'Log a run' },
    title: { cs: 'Osobní rekord poznáš hned po zápisu', en: 'See a personal best the moment you log it' }
  }
];

// Feature graphic: wordmark + one line (no numbers, no device frame).
const FEATURE = {
  cs: { line: 'Běžecký deník, plán a trénink do hodinek', sub: 'Bez účtu. Data zůstávají v telefonu.' },
  en: { line: 'Running journal, plan and watch workouts', sub: 'No account. Your data stays on your phone.' }
};

// ---------------------------------------------------------------- helpers
function run(cmd, argv, opts) {
  const r = spawnSync(cmd, argv, Object.assign({ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, opts));
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) throw new Error(path.basename(argv.find(a => /\.(c|m)?js$/.test(a)) || cmd) + ' failed (' + r.status + '):\n' + out.split('\n').filter(l => !/^\[|ERR: Display/.test(l)).join('\n'));
  return out;
}

function syncBuild(channel) {
  const dir = path.join(TMP, channel);
  run(process.execPath, [SYNC, '--channel', channel, '--out', dir], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) });
  return path.join(dir, 'src', 'index.html');
}

/** Renders one screen in both languages with screenshots.cjs; returns { lang: pngPath }. */
function capture(targetId, target, screen, index) {
  const rawDir = path.join(TMP, 'raw');
  const [w, h] = target.css;
  const name = targetId + '-' + screen.id;
  const argv = CHROMIUM_FLAGS.concat([SHOTS, '--out', rawDir, '--index', index, '--platform', target.platform, '--strava', 'off',
    '--page', screen.page, '--theme', 'dark', '--lang', LANGS.join(','), '--size', w + 'x' + h, '--scale', String(target.scale || SCALE),
    '--today', screen.today || TODAY, '--seed', 'demo', '--name', name, '--wait', '900', '--settle', String(screen.settle || 500),
    '--css', PHONE_CSS, '--eval', screen.run(target) || ';']);
  const out = run(process.execPath, argv);
  const warnings = out.split('\n').filter(l => /^\s+console /.test(l));
  if (warnings.length) console.log('  ' + name + ' console:\n' + warnings.join('\n'));
  const files = {};
  for (const lang of LANGS) {
    const file = path.join(rawDir, name + '-' + screen.page + '-dark-' + lang + '-' + w + 'x' + h + '.png');
    if (!fs.existsSync(file)) throw new Error('missing capture ' + file);
    files[lang] = file;
  }
  return files;
}

// PNG encoder (RGB or RGBA, 8 bit, adaptive filters). Chromium's toDataURL always writes RGBA, while Google
// Play's feature graphic and App Store screenshots must not have an alpha channel.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(rgba, w, h, alpha) {
  const bpp = alpha ? 4 : 3, stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  let prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride), cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = x * bpp;
      if (rgba[s + 3] !== 255) throw new Error('pixel not opaque at ' + x + ',' + y);
      cur[d] = rgba[s]; cur[d + 1] = rgba[s + 1]; cur[d + 2] = rgba[s + 2]; if (alpha) cur[d + 3] = 255;
    }
    let best = 0, bestScore = Infinity;
    for (let type = 0; type < 5; type++) {
      const out = cand[type]; let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let pred = 0;
        if (type === 1) pred = a; else if (type === 2) pred = b; else if (type === 3) pred = (a + b) >> 1;
        else if (type === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (cur[i] - pred) & 0xff; out[i] = v; score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = type; }
    }
    raw[y * (stride + 1)] = best; cand[best].copy(raw, y * (stride + 1) + 1);
    prev = Buffer.from(cur);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

// ---------------------------------------------------------------- canvas page (runs in the renderer)
// Shared drawing code, sent once; every job calls one of these functions and returns base64 RGBA pixels
// (or a WebP data URL for the website).
const CANVAS_LIB = String.raw`
window.G = (() => {
  const C = ${JSON.stringify(C)};
  const load = async src => { const i = new Image(); i.src = src; await i.decode(); return i; };
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const pixels = c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = ''; const CH = 0x8000;
    for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
    return btoa(s);
  };
  const rrect = (x, px, py, w, h, r) => {
    x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
  };
  /** Greedy word wrap; NBSP binds words (Czech one-letter prepositions). */
  const wrap = (x, text, maxW) => {
    const words = text.split(' '); const lines = []; let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (line && x.measureText(test).width > maxW) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  /** Balanced wrap: the narrowest width that still gives the same number of lines (no lonely last word). */
  const balance = (x, text, maxW) => {
    const n = wrap(x, text, maxW).length; if (n < 2) return wrap(x, text, maxW);
    let lo = maxW * 0.45, hi = maxW;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (wrap(x, text, mid).length > n) lo = mid; else hi = mid; }
    return wrap(x, text, hi);
  };

  /** Crops the solid rounded square of the artwork (alpha >= 250) like the iOS icon, flattened on graphite. */
  async function icon(src, size) {
    const img = await load(src);
    const c0 = canvas(img.width, img.height), x0 = c0.getContext('2d', { willReadFrequently: true });
    x0.drawImage(img, 0, 0);
    const d = x0.getImageData(0, 0, c0.width, c0.height).data; let a = c0.width, b = c0.height, e = -1, f = -1;
    for (let y = 0; y < c0.height; y++) for (let i = 0; i < c0.width; i++) if (d[(y * c0.width + i) * 4 + 3] >= 250) { if (i < a) a = i; if (i > e) e = i; if (y < b) b = y; if (y > f) f = y; }
    const inset = Math.round(Math.min(e - a, f - b) * 0.012), side = Math.min(e - a, f - b) - 2 * inset;
    const sx = Math.round((a + e - side) / 2), sy = Math.round((b + f - side) / 2);
    // Two-step downscale keeps the strokes smooth.
    const mid = canvas(size * 2, size * 2), xm = mid.getContext('2d'); xm.imageSmoothingQuality = 'high';
    xm.fillStyle = C.bg; xm.fillRect(0, 0, mid.width, mid.height); xm.drawImage(img, sx, sy, side, side, 0, 0, mid.width, mid.height);
    const c = canvas(size, size), x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.fillStyle = C.bg; x.fillRect(0, 0, size, size); x.drawImage(mid, 0, 0, size, size);
    return { pixels: pixels(c), crop: [sx, sy, side] };
  }

  /** The lane board of the Track design: lanes, the orange signal bar, a hatched gap and a checkered finish. */
  function lanes(x, L, T, W, H, n, opt) {
    const laneH = H / n;
    x.save();
    x.strokeStyle = C.line; x.lineWidth = 2;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(L, T + i * laneH); x.lineTo(L + W, T + i * laneH); x.stroke(); }
    const finish = L + W * opt.finish, cell = laneH / 6;
    opt.bars.forEach(bar => { if (bar.hot) { x.fillStyle = 'rgba(245,98,26,.07)'; x.fillRect(L, T + bar.lane * laneH + 1, W, laneH - 2); } });
    for (let r = 0; r < n * 6; r++) for (let k = 0; k < 2; k++) {
      x.fillStyle = (r + k) % 2 ? C.text : C.bg; x.fillRect(finish + k * cell, T + r * cell, cell, cell);
    }
    opt.bars.forEach((bar, i) => {
      const y = T + (bar.lane + 0.5) * laneH, bh = laneH * 0.34, end = L + W * bar.to;
      x.fillStyle = bar.hot ? C.accent : '#3A3F48';
      rrect(x, L + W * (bar.from || 0), y - bh / 2, end - (L + W * (bar.from || 0)), bh, 4); x.fill();
      if (bar.hot) {
        // hatched gap to the finish
        x.save(); rrect(x, end + 6, y - bh / 2, finish - end - 12, bh, 4); x.clip();
        x.strokeStyle = 'rgba(245,98,26,.55)'; x.lineWidth = 3;
        for (let s = end - bh; s < finish + bh; s += 12) { x.beginPath(); x.moveTo(s, y + bh / 2); x.lineTo(s + bh, y - bh / 2); x.stroke(); }
        x.restore();
      }
    });
    x.fillStyle = C.faint; x.font = '600 ' + Math.round(laneH * 0.36) + 'px "Barlow Condensed"'; x.textBaseline = 'middle'; x.textAlign = 'right';
    for (let i = 0; i < n; i++) x.fillText(String(i + 1), L - 16, T + (i + 0.5) * laneH);
    x.restore();
  }

  function feature(o) {
    const W = 1024, H = 500, c = canvas(W, H), x = c.getContext('2d');
    x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
    // faint lane lines across the whole graphic, the board itself on the right
    lanes(x, 604, 104, 356, 292, 4, { finish: 0.88, bars: [{ lane: 0, to: 0.6 }, { lane: 1, to: 0.66, hot: true }, { lane: 2, to: 0.46 }, { lane: 3, to: 0.53 }] });
    x.fillStyle = C.text; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.font = '700 132px "Barlow Condensed"';
    if ('letterSpacing' in x) x.letterSpacing = '4px';
    x.fillText('VEYVO', 64, 222);
    if ('letterSpacing' in x) x.letterSpacing = '0px';
    x.fillStyle = C.accent; x.fillRect(68, 248, 64, 6);
    x.font = '600 30px Inter'; x.fillStyle = C.text;
    const lines = balance(x, o.line, 470);
    lines.forEach((l, i) => x.fillText(l, 66, 304 + i * 40));
    x.font = '500 22px Inter'; x.fillStyle = C.muted;
    x.fillText(o.sub, 66, 304 + lines.length * 40 + 14);
    return pixels(c);
  }

  /** Store screenshot: caption band on top, the real app capture below in a hairline card. */
  async function shot(o) {
    const [W, H] = o.canvas, k = W / 1080;
    const img = await load(o.src);
    const c = canvas(W, H), x = c.getContext('2d');
    x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
    if (o.plain) { x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, H); return pixels(c); }
    const cw = img.width, ch = img.height, m = Math.round((W - cw) / 2), top = H - m - ch;
    // caption band: orange tick + eyebrow, then a headline of at most two lines, centred in the band
    const pad = m, eyebrowSize = Math.round(30 * k);
    let size = Math.round(68 * k), lines;
    for (;;) { x.font = '700 ' + size + 'px Inter'; lines = balance(x, o.title, W - 2 * pad); if (lines.length <= 2 || size < 40 * k) break; size -= 2; }
    const lh = Math.round(size * 1.13), gap = Math.round(30 * k);
    const blockH = eyebrowSize + gap + size + (lines.length - 1) * lh;
    const eyebrowY = Math.round((top - blockH) / 2 + eyebrowSize * 0.85 - 4 * k);
    x.textBaseline = 'alphabetic';
    x.fillStyle = C.accent; x.fillRect(pad, eyebrowY - Math.round(eyebrowSize * 0.72), Math.round(6 * k), Math.round(eyebrowSize * 0.78));
    x.font = '600 ' + eyebrowSize + 'px Inter'; x.fillStyle = C.accentText;
    if ('letterSpacing' in x) x.letterSpacing = Math.round(3.4 * k) + 'px';
    x.fillText(o.eyebrow.toLocaleUpperCase(o.lang), pad + Math.round(22 * k), eyebrowY);
    if ('letterSpacing' in x) x.letterSpacing = '0px';
    const titleTop = eyebrowY + gap + size;
    x.font = '700 ' + size + 'px Inter'; x.fillStyle = C.text;
    lines.forEach((l, i) => x.fillText(l, pad, titleTop + i * lh));
    // card: shadow, the capture, hairline
    const r = Math.round(26 * k);
    x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 60 * k; x.shadowOffsetY = 18 * k;
    rrect(x, m, top, cw, ch, r); x.fillStyle = C.surface0; x.fill(); x.restore();
    x.save(); rrect(x, m, top, cw, ch, r); x.clip(); x.drawImage(img, m, top); x.restore();
    rrect(x, m + 1, top + 1, cw - 2, ch - 2, r); x.strokeStyle = 'rgba(255,255,255,.10)'; x.lineWidth = 2 * k; x.stroke();
    return pixels(c);
  }

  /** Website image: the raw capture scaled to w x h, WebP. */
  async function web(o) {
    const img = await load(o.src); const c = canvas(o.w, o.h), x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, o.w, o.h); return c.toDataURL('image/webp', 0.88);
  }
  return { icon, feature, shot, web };
})();
`;

async function canvasPage() {
  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { backgroundThrottling: false, offscreen: false } });
  const fontCss = fs.readFileSync(FONT_CSS, 'utf8').replace(/url\('\.\.\/fonts\//g, "url('" + 'file://' + FONT_DIR.split(path.sep).map(encodeURIComponent).join('/') + '/');
  const html = path.join(TMP, 'canvas.html');
  fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><style>' + fontCss + '</style><body style="font-family:Inter">' +
    '<span style="font:700 20px Inter">Ččř</span><span style="font:600 20px Inter">Ěě</span><span style="font:500 20px Inter">Žž</span>' +
    '<span style="font:700 20px \'Barlow Condensed\'">Řř1</span><span style="font:600 20px \'Barlow Condensed\'">Šš1</span></body>');
  await win.loadFile(html);
  await win.webContents.executeJavaScript(CANVAS_LIB + ';0');
  const faces = await win.webContents.executeJavaScript("Promise.all(['700 64px Inter','600 30px Inter','500 22px Inter','700 132px \"Barlow Condensed\"','600 20px \"Barlow Condensed\"'].map(f => document.fonts.load(f, 'VEYVOčřžěů'))).then(() => document.fonts.ready).then(() => [...document.fonts].filter(f => f.status === 'loaded').length)");
  if (faces < 5) throw new Error('fonts did not load (' + faces + ')');
  return win;
}

function writePixels(file, b64, w, h, alpha) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(Buffer.from(b64, 'base64'), w, h, alpha));
  console.log('wrote', path.relative(ROOT, file), w + 'x' + h, Math.round(fs.statSync(file).size / 1024) + ' KB');
}

// ---------------------------------------------------------------- main
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const page = await canvasPage();
    const js = code => page.webContents.executeJavaScript(code);

    if (ONLY.includes('icon')) {
      const r = await js('G.icon(' + JSON.stringify(dataUrl(ICON)) + ', 512)');
      writePixels(path.join(OUT, 'play-icon-512.png'), r.pixels, 512, 512, true);
    }
    if (ONLY.includes('feature')) {
      for (const lang of LANGS) writePixels(path.join(OUT, 'play-feature-' + lang + '.png'), await js('G.feature(' + JSON.stringify(FEATURE[lang]) + ')'), 1024, 500, false);
    }

    const shotTargets = ONLY.filter(id => TARGETS[id]);
    const needPlay = shotTargets.includes('play') || ONLY.includes('site');
    const index = {};
    if (needPlay) index.play = syncBuild('play');
    if (shotTargets.some(id => TARGETS[id].channel === 'appstore')) index.appstore = syncBuild('appstore');

    const raws = {}; // targetId -> screenId -> { lang: file }
    for (const targetId of shotTargets.concat(ONLY.includes('site') && !shotTargets.includes('play') ? ['play'] : [])) {
      const target = TARGETS[targetId];
      raws[targetId] = {};
      for (const screen of SCREENS) {
        if (SCREEN_IDS && !SCREEN_IDS.includes(screen.id)) continue;
        raws[targetId][screen.id] = capture(targetId, target, screen, index[target.channel]);
        console.log('captured', targetId, screen.id);
      }
    }
    for (const targetId of shotTargets) {
      const target = TARGETS[targetId];
      const [W, H] = target.canvas;
      for (const [n, screen] of SCREENS.entries()) {
        if (!raws[targetId][screen.id]) continue;
        for (const lang of LANGS) {
          const title = (target.ios && screen.titleIos ? screen.titleIos : screen.title)[lang];
          const b64 = await js('G.shot(' + JSON.stringify({ src: dataUrl(raws[targetId][screen.id][lang]), canvas: [W, H], lang, eyebrow: screen.eyebrow[lang], title, plain: !!args.plain }) + ')');
          writePixels(path.join(OUT, target.file(lang, n + 1, screen.id)), b64, W, H, false);
        }
      }
    }
    if (ONLY.includes('site')) {
      fs.mkdirSync(SITE_IMG, { recursive: true });
      const siteIcon = await js('G.icon(' + JSON.stringify(dataUrl(ICON)) + ', 192)');
      writePixels(path.join(SITE_IMG, 'icon-192.png'), siteIcon.pixels, 192, 192, true);
      for (const id of ['overview', 'plan', 'progress', 'watch', 'prerun', 'result']) {
        if (!raws.play[id]) continue;
        for (const lang of LANGS) {
          const url = await js('G.web(' + JSON.stringify({ src: dataUrl(raws.play[id][lang]), w: 560, h: 1120 }) + ')');
          const file = path.join(SITE_IMG, id + '-' + lang + '.webp');
          fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
          console.log('wrote', path.relative(ROOT, file), Math.round(fs.statSync(file).size / 1024) + ' KB');
        }
      }
    }
    if (args.keep) console.log('raw captures kept in', path.join(TMP, 'raw'));
    else fs.rmSync(TMP, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error('store-graphics failed:', error && error.stack || error);
    app.exit(1);
  }
});
setTimeout(() => { console.error('store-graphics: timeout'); app.exit(1); }, 20 * 60 * 1000);
