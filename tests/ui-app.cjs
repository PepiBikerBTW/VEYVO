// Electron UI test: the app shell and everything that persists across launches.
//   electron tests/ui-app.cjs            (npm run test:ui runs it with the repo's Electron)
// Covers: first launch onboarding -> profile saved; language cs -> en on every page and dialog, live
// and after a restart (and back); theme switch + title bar colours, persisted; Settings days editor
// -> plan week and the nav badge; legacy 0.3 localStorage (Czech types, ISO dates) -> correct
// totals; the window drag strip is draggable and never covers interactive controls; the updater
// card (progress, restart); the phone layout (tab bar, 44 px targets, no sideways scroll); no
// console errors.
'use strict';
const { run } = require('./ui-harness.cjs');

// Czech-only letters and words. User data (notes, names) and the language's own name in the
// language switcher ("Čeština") are removed before the check.
const CZECH = /[ěščřžůťďňĚŠČŘŽŮŤĎŇ]|(?:\b(?:běh|týden|dnes|zítra|neděle|úterý|cíl)\b)/i;
const USER_TEXT = ['Kopce v druhé půlce', 'Pepa', 'Jana', 'Čeština'];

run('VEYVO UI: shell, onboarding, language, theme, legacy data, drag strip', async t => {
  // ------------------------------------------------------------ 1. first launch: onboarding
  // The harness starts every test on a fresh, empty profile (no storage at all).
  await t.js("T.wait(() => document.querySelector('dialog[open] [data-key=\"onb-name\"]'), 3000, 'onboarding opens on first launch')");
  t.ok(true, 'onboarding opens by itself on a fresh install');
  t.equal(await t.js("T.text('dialog[open] .dlg-title')"), 'Jak ti říkat a kam míříš', 'step 1 title in Czech');
  await t.exec(`
    T.input('dialog[open] [data-key="onb-name"]', 'Jana');
    T.input('dialog[open] [data-key="onb-target"]', '24:30');
    T.click('dialog[open] [data-key="onb-next"]');
    await T.wait(() => document.querySelector('dialog[open] [data-key="onb-days:2"]'), 3000, 'step 2');
    T.click('dialog[open] [data-key="onb-days:2"]');
    T.click('dialog[open] [data-key="onb-next"]');
    await T.wait(() => document.querySelector('dialog[open] [data-key="onb-opt-log"]'), 3000, 'step 3');
    T.click('dialog[open] [data-key="onb-next"]');
    await T.wait(() => T.dialogs() === 0, 3000, 'onboarding closes');`);
  const profile = await t.js('T.state().profile');
  t.equal(profile, { name: 'Jana', goalDistanceKm: 5, targetSeconds: 1470, days: [1, 2, 6], onboarded: true }, 'onboarding saved name, goal 5 km / 24:30, days út+st+ne');
  t.match(await t.js("T.text('[data-slot=\"profile\"]')"), /Jana.*5\s*km pod 24:30/, 'sidebar profile shows the typed name and goal');
  await t.reload();
  await t.js('T.sleep(500)');
  t.equal(await t.js('T.dialogs()'), 0, 'onboarding does not come back after a restart');
  t.equal(await t.js('T.state().profile.name'), 'Jana', 'profile persisted across a restart');

  // ------------------------------------------------------------ 2. legacy 0.3 data
  await t.seed({ 'veyvo-state': t.legacyState() });
  const legacy = await t.exec(`
    const s = T.state(), d = T.derived();
    return { schema: s.schemaVersion, n: s.runHistory.length, types: [...new Set(s.runHistory.map(r => r.type))].sort(),
      dates: s.runHistory.every(r => /^\\d{4}-\\d{2}-\\d{2}$/.test(r.date)), strava: s.runHistory.find(r => r.source === 'strava'),
      km: Math.round(d.totals.distanceKm * 10) / 10, secs: d.totals.movingSeconds, theme: document.documentElement.dataset.theme,
      ignored: s.ignoredStravaIds, legacyMilestones: s.legacyMilestones.length, best: d.goal.best, recovery: s.recoveryLogs.length };`);
  t.equal(legacy.schema, 2, 'legacy state migrated to schema v2');
  t.equal(legacy.n, 10, 'all 10 legacy runs kept');
  t.equal(legacy.types, ['easy', 'intervals', 'long', 'run', 'tempo'], 'Czech type labels mapped to codes');
  t.ok(legacy.dates, 'ISO date-times became YYYY-MM-DD');
  t.equal([legacy.strava.date, legacy.strava.startTime, legacy.strava.movingSeconds], ['2026-11-25', '19:30', 1150], 'Strava fake-Z time sliced, not shifted by the time zone');
  t.equal(legacy.km, 66.4, 'total distance 66,4 km');
  t.equal(legacy.secs, 21582, 'total moving time 5 h 59 min 42 s from movingSeconds');
  t.equal(legacy.best, 1262, 'best 5 km 21:02 from the legacy runs');
  t.equal([legacy.theme, legacy.legacyMilestones, legacy.recovery], ['light', 1, 1], 'theme, milestones and recovery logs carried over');
  await t.js("T.go('progress')");
  const progText = await t.js('T.pageText()');
  t.match(progText, /66,4/, 'Výkonnost shows the 66,4 km total');
  t.match(progText, /5 km pod 21:30/, 'the 0.3 milestone is listed');
  t.ok(!/\d{4}-\d{2}-\d{2}/.test(progText), 'no raw ISO dates on Výkonnost');
  t.match(await t.js("T.wait(() => T.toast(), 3000, 'migration toast')"), /0\.3|převeden|VEYVO/i, 'a one-time migration notice is shown');

  // the daily backup failing on the upgrade launch is not replaced by the migration notice, and
  // Settings > Data keeps showing it
  t.ipc.set('backup-snapshot', () => { throw new Error('[write_failed] disk full'); });
  await t.seed({ 'veyvo-state': t.legacyState() });
  const notice = await t.js("T.sleep(1300).then(() => T.toast())");
  t.match(notice, /převeden/, 'the migration notice is shown');
  t.match(notice, /Denní zálohu se nepodařilo uložit/, 'and still says that the daily backup failed');
  await t.exec(`VeyvoUI.app.dialogs.open('settings', { section: 'data' }); await T.wait(() => /Poslední automatickou zálohu se nepodařilo uložit/.test(T.text(T.dialog())), 3000, 'backup failure in Settings');`);
  t.ok(true, 'Settings > Data > Automatické zálohy shows the failed backup');
  await t.js('T.closeDialogs()');
  t.ipc.reset('backup-snapshot');

  // ------------------------------------------------------------ 3. owner data, drag strip (desktop)
  await t.seed({ 'veyvo-state': t.ownerState() }, 'progress');
  const drag = await t.exec(`
    const region = el => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim();
    const topbar = T.need('#topbar'), brand = T.need('.sidebar .brand'), main = T.need('#main');
    const tb = topbar.getBoundingClientRect(), mb = main.getBoundingClientRect();
    const interactive = T.$$('#topbar a, #topbar button, #topbar input, #topbar select, #topbar [tabindex], #topbar [role="radio"]').filter(T.visible);
    const sideInteractive = T.$$('.sidebar a, .sidebar button').filter(T.visible);
    const inDragBrand = sideInteractive.filter(el => brand.contains(el));
    main.scrollTop = 400;
    const hit = document.elementFromPoint(Math.round(tb.left + tb.width / 2), Math.round(tb.top + tb.height / 2));
    const captionClear = interactive.every(el => el.getBoundingClientRect().right <= innerWidth - 138);
    return { topbar: region(topbar), brand: region(brand), noDrag: interactive.map(region), count: interactive.length,
      top: Math.round(tb.top), height: Math.round(tb.height), mainTop: Math.round(mb.top), tbBottom: Math.round(tb.bottom),
      hitInTopbar: topbar.contains(hit), inDragBrand: inDragBrand.length, captionClear, mainRegion: region(main) };`);
  t.equal([drag.topbar, drag.brand], ['drag', 'drag'], 'topbar and sidebar brand are the window drag strip');
  t.ok(drag.count > 0 && drag.noDrag.every(r => r === 'no-drag'), 'every control in the topbar (' + drag.count + ') is no-drag');
  t.ok(drag.top === 0 && drag.height >= 42, 'drag strip sits at the top and is at least 42 px tall');
  t.ok(drag.mainTop >= drag.tbBottom, 'scrolling content starts below the drag strip');
  t.ok(drag.hitInTopbar, 'scrolled content never slides under the drag strip');
  t.equal(drag.inDragBrand, 0, 'no sidebar control sits inside the draggable brand row');
  t.ok(drag.captionClear, 'topbar controls stay clear of the window caption buttons');
  t.ok(drag.mainRegion !== 'drag', 'the content area is not draggable');

  // ------------------------------------------------------------ 4. language cs -> en on every page and dialog
  const pages = ['home', 'plan', 'progress', 'nutrition'];
  const titles = {};
  for (const p of pages) { await t.js(`T.go('${p}')`); titles[p] = await t.js("T.text('#page-title')"); }
  t.equal(titles, { home: 'Přehled', plan: 'Můj plán', progress: 'Výkonnost', nutrition: 'Před během' }, 'Czech page titles');
  await t.exec(`
    VeyvoUI.app.dialogs.open('settings', { section: 'appearance' });
    await T.wait(() => document.querySelector('dialog[open] [data-key="set-lang:en"]'), 3000, 'appearance section');
    T.click('dialog[open] [data-key="set-lang:en"]');
    await T.wait(() => document.documentElement.lang === 'en', 3000, 'html lang en');
    await T.sleep(100);`);
  t.match(await t.js("T.text('dialog[open]')"), /Appearance|Language/, 'the open Settings dialog re-translated live');
  await t.js('T.closeDialogs()');
  const strip = text => USER_TEXT.reduce((s, u) => s.split(u).join(''), text);
  const enTitles = {};
  for (const p of pages) {
    await t.js(`T.go('${p}')`);
    enTitles[p] = await t.js("T.text('#page-title')");
    const text = strip(await t.js("document.querySelector('#app').innerText"));
    const hit = text.match(CZECH);
    t.ok(!hit, `no Czech left on ${p} in English` + (hit ? ' (found "' + text.slice(Math.max(0, hit.index - 40), hit.index + 40).replace(/\s+/g, ' ') + '")' : ''));
    t.ok(!/\d{4}-\d{2}-\d{2}/.test(text), `no raw ISO dates on ${p}`);
  }
  t.equal(enTitles, { home: 'Overview', plan: 'My plan', progress: 'Progress', nutrition: 'Before the run' }, 'English page titles');
  for (const [name, params] of [['run', { mode: 'new' }], ['run', { mode: 'edit', runId: 'm-seed-9' }], ['recovery', {}], ['workout', {}], ['settings', { section: 'profile' }], ['settings', { section: 'data' }], ['settings', { section: 'connections' }], ['settings', { section: 'appearance' }], ['settings', { section: 'updates' }], ['settings', { section: 'about' }], ['onboarding', {}], ['more', {}]]) {
    const text = strip(await t.exec(`
      VeyvoUI.app.dialogs.open(${JSON.stringify(name)}, ${JSON.stringify(params)});
      await T.wait(() => T.dialog(), 3000, 'dialog ${name}');
      await T.sleep(120);
      const text = T.dialog().innerText;
      await T.closeDialogs();
      return text;`));
    const hit = text.match(CZECH);
    t.ok(!hit, `dialog ${name} ${JSON.stringify(params)} fully English` + (hit ? ' (found "' + text.slice(Math.max(0, hit.index - 40), hit.index + 40).replace(/\s+/g, ' ') + '")' : ''));
  }
  // onboarding was opened by hand: closing it keeps the profile as it was
  t.equal(await t.js('T.state().profile.name'), 'Pepa', 'closing the guide by hand keeps the profile');
  await t.reload();
  t.equal(await t.js("[document.documentElement.lang, T.text('#page-title'), T.state().language]"), ['en', 'Before the run', 'en'], 'English persists across a restart');
  // ... and back to Czech through the phone-style "More" sheet
  await t.exec(`
    VeyvoUI.app.dialogs.open('more');
    await T.wait(() => T.dialog(), 3000);
    T.click(T.dialog().querySelector('[role="radio"][data-value="cs"]'));
    await T.wait(() => document.documentElement.lang === 'cs', 3000, 'back to cs');
    await T.sleep(350); await T.closeDialogs();`);
  t.equal(await t.js("T.text('#page-title')"), 'Před během', 'back in Czech');
  await t.reload();
  t.equal(await t.js('T.state().language'), 'cs', 'Czech persists');

  // ------------------------------------------------------------ 5. theme
  t.ipc.reset('titlebar-theme');
  await t.exec(`T.click('.sidebar [data-action="toggle-theme"]'); await T.wait(() => document.documentElement.dataset.theme === 'light', 3000, 'light theme'); await T.sleep(400);`);
  const lightCalls = t.ipc.calls['titlebar-theme'];
  t.ok(lightCalls.length > 0 && /^#f/i.test(lightCalls[lightCalls.length - 1][0].color), 'Windows title bar overlay follows the light theme');
  const bodyBg = await t.js("getComputedStyle(document.body).backgroundColor");
  t.ok(bodyBg !== 'rgb(13, 14, 17)', 'page background changed with the theme');
  await t.reload();
  t.equal(await t.js("[document.documentElement.dataset.theme, T.state().theme]"), ['light', 'light'], 'light theme persists across a restart');
  await t.exec(`T.click('.sidebar [data-action="toggle-theme"]'); await T.wait(() => document.documentElement.dataset.theme === 'dark', 3000); await T.sleep(400);`);
  t.equal(await t.js('T.state().theme'), 'dark', 'and back to dark');

  // ------------------------------------------------------------ 6. Settings days editor -> plan week + badge
  await t.js("T.go('plan')");
  const before = await t.exec(`
    const sat = T.need('[data-key="plan-day:2026-11-28"]');
    return { satOff: sat.classList.contains('is-off'), badge: T.text('[data-slot="next-badge"]'), next: T.derived().nextRun.date };`);
  t.equal(before, { satOff: true, badge: 'Další běh: ne 29. 11.', next: '2026-11-29' }, 'Saturday is a rest day; next run Sunday (badge)');
  await t.exec(`
    VeyvoUI.app.dialogs.open('settings', { section: 'profile' });
    await T.wait(() => document.querySelector('dialog[open] [data-key="set-days:5"]'), 3000, 'profile section');
    T.click('dialog[open] [data-key="set-days:5"]');
    T.click('dialog[open] [data-key="set-save"]');
    await T.wait(() => T.state().profile.days.includes(5), 3000, 'days saved');
    await T.closeDialogs();`);
  t.equal(await t.js('T.state().profile.days'), [1, 5, 6], 'Settings saved út + so + ne');
  const after = await t.exec(`
    const sat = T.need('[data-key="plan-day:2026-11-28"]');
    return { satOff: sat.classList.contains('is-off'), satPlanned: sat.classList.contains('is-planned'), badge: T.text('[data-slot="next-badge"]'), next: T.derived().nextRun.date };`);
  t.equal(after, { satOff: false, satPlanned: true, badge: 'Další běh: so 28. 11.', next: '2026-11-28' }, 'plan week and nav badge moved the next run to Saturday');

  // ------------------------------------------------------------ 7. updater card in Settings
  await t.exec(`VeyvoUI.app.dialogs.open('settings', { section: 'updates' }); await T.wait(() => document.querySelector('dialog[open] [data-key="set-up-check"]'), 3000, 'updates section');`);
  t.ipc.reset('updater-check');
  await t.exec(`T.click('dialog[open] [data-key="set-up-check"]'); await T.sleep(100);`);
  t.equal(t.ipc.calls['updater-check'].length, 1, '"Zkontrolovat" asks main for an update check');
  t.win.webContents.send('updater-status', { type: 'progress', percent: 42, transferred: 42 * 1048576 / 100 * 80, total: 80 * 1048576 });
  await t.js("T.wait(() => document.querySelector('dialog[open] [role=\"progressbar\"][aria-valuenow=\"42\"]'), 3000, 'progress bar 42 %')");
  t.ok(true, 'download progress shows 42 %');
  t.win.webContents.send('updater-status', { type: 'ready', version: '0.4.1' });
  await t.js("T.wait(() => document.querySelector('dialog[open] [data-key=\"set-up-install\"]'), 3000, 'restart button')");
  t.match(await t.js('T.toast()'), /0\.4\.1/, 'a toast announces the downloaded version');
  t.ipc.reset('updater-install');
  await t.exec(`T.click('dialog[open] [data-key="set-up-install"]'); await T.sleep(100);`);
  t.equal(t.ipc.calls['updater-install'].length, 1, '"Restartovat" installs the update');
  await t.key('Escape');
  await t.js("T.wait(() => T.dialogs() === 0, 3000, 'Esc closes Settings')");
  t.ok(true, 'Esc closes Settings');

  // ------------------------------------------------------------ 8. minimum window and phone layout
  // Touch targets: a control counts with its 44 px wrapper (stepper, visually hidden input + label).
  const SMALL = `T.$$('#main button, #main a[href], #main input, #main select, #main [role="radio"]').filter(T.visible).filter(el => {
      const r = el.getBoundingClientRect();
      const wrap = el.closest('.stepper, label');
      const hit = el.matches('.btn-link') ? parseFloat(getComputedStyle(el, '::after').height) || 0 : 0;
      const hgt = Math.max(r.height, hit, wrap ? wrap.getBoundingClientRect().height : 0);
      return r.width > 2 && hgt < 43.5 && !el.closest('.vchart');
    }).slice(0, 4).map(el => (el.getAttribute('data-key') || el.className || el.tagName) + ':' + Math.round(el.getBoundingClientRect().height))`;
  for (const [w, h] of [[1120, 720], [412, 915]]) {
    await t.setSize(w, h);
    for (const p of pages) {
      await t.js(`T.go('${p}')`);
      const m = await t.exec(`
        const main = T.need('#main');
        const wide = T.$$('#main *').filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !el.closest('.table-wrap, [data-scroll-x], .home-week, .plan-week, .vchart, [class*="scroll"]'); });
        return { sideways: document.documentElement.scrollWidth > innerWidth || main.scrollWidth > main.clientWidth + 1, wide: wide.slice(0, 3).map(el => el.className || el.tagName),
          small: innerWidth <= 760 ? ${SMALL} : [] };`);
      t.ok(!m.sideways && !m.wide.length, `${p} at ${w}×${h}: no sideways scroll` + (m.wide.length ? ' (' + m.wide.join(', ') + ')' : ''));
      if (w <= 760) t.equal(m.small, [], `${p} on a phone: every control is at least 44 px tall`);
    }
  }
  const phone = await t.exec(`
    const bar = T.need('#tabbar'), side = T.need('#sidebar');
    const tabs = T.$$('#tabbar .tab').map(el => el.getBoundingClientRect());
    return { bar: T.visible(bar), side: T.visible(side), tabs: tabs.length, tabH: Math.min(...tabs.map(r => r.height)) };`);
  t.ok(phone.bar && !phone.side, 'phone: bottom tab bar instead of the sidebar');
  t.ok(phone.tabs === 5 && phone.tabH >= 44, 'phone: 5 tabs, each at least 44 px tall');

  // 360 px phone: the shared controls are at least 44 x 44 px in pages and dialogs, and nothing is cut off
  await t.setSize(360, 780);
  const TINY = sel => `T.$$(${JSON.stringify(sel)}).filter(T.visible).map(el => { const r = el.getBoundingClientRect(); return [el.getAttribute('data-key') || el.className, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 43.5 || x[2] < 43.5).slice(0, 3)`;
  await t.js("T.go('home')");
  await t.exec(`VeyvoUI.app.dialogs.open('run', { mode: 'new' }); await T.wait(() => document.querySelector('dialog[open] [data-key="rd-distance"]'), 3000, 'run dialog'); await T.sleep(250);`);
  t.equal(await t.js(TINY('dialog[open] .scale > button')), [], '360 px: the 1-10 effort squares are at least 44 x 44 px');
  await t.js('T.closeDialogs()');
  await t.exec(`VeyvoUI.app.dialogs.open('settings', { section: 'profile' }); await T.wait(() => document.querySelector('dialog[open] .day-toggle'), 3000, 'settings'); await T.sleep(250);`);
  t.equal(await t.js(TINY('dialog[open] .day-toggle')), [], '360 px: Settings day toggles are at least 44 x 44 px');
  const dist = await t.exec(`const last = T.need('dialog[open] [data-key="set-dist:custom"]'); const seg = last.closest('.segmented');
    const s = seg.getBoundingClientRect(), b = last.getBoundingClientRect(); return { inside: b.right <= s.right + 1 && b.left >= s.left - 1, w: Math.round(b.width) };`);
  t.ok(dist.inside && dist.w >= 44, '360 px: the goal "Vlastni" option is fully visible (' + JSON.stringify(dist) + ')');
  await t.js('T.closeDialogs()');
  await t.exec(`VeyvoUI.app.dialogs.open('more', {}); await T.wait(() => document.querySelector('dialog[open] .switch'), 3000, 'more sheet'); await T.sleep(250);`);
  t.ok(await t.js("T.need('dialog[open] .switch').closest('label').getBoundingClientRect().height >= 44"), '360 px: the More sheet theme switch row is at least 44 px tall');
  await t.js('T.closeDialogs()');
  await t.js("T.go('nutrition')");
  t.equal(await t.js(TINY('#main .stepper > button')), [], '360 px: Pred behem stepper buttons are at least 44 x 44 px');
  await t.js("T.go('progress')");
  t.equal(await t.js(`T.$$('.prog-log-filter .segmented > button > span:not(.seg-count)').filter(T.visible).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent)`), [], '360 px: run-log filter names are not cut off');
  await t.setSize(1480, 940);

  // wide layouts on a touch device with cut-outs (Android landscape, 915 x 412): safe-area insets apply
  // above 760 px too, and the rail's "Zapsat beh" button keeps its height
  await t.setSize(915, 412);
  const dbg = t.win.webContents.debugger;
  let insets = false;
  try {
    dbg.attach('1.3');
    await dbg.sendCommand('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, left: 48, right: 48, bottom: 0 } });
    insets = true;
  } catch (err) { console.log('  --  safe-area emulation not available in this Electron (' + err.message + ')'); }
  if (insets) {
    await t.js("T.go('home')");
    const rail = await t.exec(`await T.sleep(150); const r = el => T.need(el).getBoundingClientRect();
      return { brandTop: Math.round(r('.brand').top), btnLeft: Math.round(r('.btn-side').left), btnH: Math.round(r('.btn-side').height), titleTop: Math.round(r('#page-title').top), mainRight: Math.round(r('.page').right), w: innerWidth };`);
    t.ok(rail.brandTop >= 24 && rail.titleTop >= 24, '915x412 with insets: the brand and the title sit below the top inset (' + JSON.stringify(rail) + ')');
    t.ok(rail.btnLeft >= 48, '915x412 with insets: the rail clears the left cut-out');
    t.ok(rail.btnH >= 36, '915x412: "Zapsat beh" keeps its height in the rail (it used to collapse to 18 px)');
    t.ok(rail.mainRight <= rail.w - 48 + 1, '915x412 with insets: the page clears the right cut-out');
    await dbg.sendCommand('Emulation.setSafeAreaInsetsOverride', { insets: {} }).catch(() => {});
    try { dbg.detach(); } catch (e) { /* already detached */ }
  }
  await t.setSize(1480, 940);

  // onboarding "restore a backup": a file over the size limit is refused before it is read
  await t.exec(`VeyvoUI.app.dialogs.open('onboarding', {}); await T.wait(() => T.dialog(), 3000, 'onboarding'); await T.sleep(200);
    T.click('dialog[open] [data-key="onb-next"]'); await T.sleep(150);
    T.click('dialog[open] [data-key="onb-next"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="onb-opt-restore"]'), 3000, 'restore option');`);
  const huge = await t.exec(`let read = false;
    await VeyvoUI.onboarding.readBackup({ name: 'huge.json', size: VeyvoStore.LIMITS.maxBackupChars + 1, text: async () => { read = true; return '{}'; } });
    await T.sleep(80);
    return { read, text: T.text(T.dialog()) };`);
  t.ok(!huge.read && /příliš velký/.test(huge.text), 'onboarding refuses a backup file over the size limit without reading it');
  await t.js('T.closeDialogs()');

  t.noErrors();
}, { timeout: 180000 });
