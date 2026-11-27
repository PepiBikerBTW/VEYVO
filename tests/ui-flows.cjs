// Electron UI test: the everyday flows, driven through the real UI.
//   electron tests/ui-flows.cjs           (npm run test:ui runs it with the repo's Electron)
// Covers: the inline 3-tap recovery check-in autosaves and the next-run card follows it; logging a
// run (decimal comma, "69:40" read as 1:09:40) -> result view -> it appears on Přehled, Výkonnost
// and Můj plán; edit + delete with Undo; Esc and a dirty form; Strava import through app.strava.sync
// (twin merge keeps the typed time, re-sync adds nothing, a deleted Strava run stays deleted, a 401
// shows "needs a new sign-in"); workout export (FIT bytes + saveFile, Apple .workout bytes, copy as
// text); booking a library session in Můj plán (next session, nav badge, × with Undo); no console errors.
'use strict';
const { run } = require('./ui-harness.cjs');

const NB = ' ';

run('VEYVO UI: check-in, run log, edit/delete, Strava, watch export', async t => {
  await t.seed({ 'veyvo-state': t.ownerState() });

  // ------------------------------------------------------------ 1. recovery check-in (inline, autosave)
  t.equal(await t.js("T.state().recoveryLogs.length"), 0, 'no check-in yet today');
  await t.clickOn('[data-key="home-rec-fatigue:9"]'); // a real click: focus moves to the square, as for a mouse user
  await t.js("T.wait(() => T.state().recoveryLogs.some(l => l.date === '2026-11-27' && l.fatigue === 9), 3000, 'check-in autosaved')");
  t.ok(true, 'one tap on fatigue 9 autosaved today\'s check-in');
  await t.js('T.sleep(120)');
  t.equal(await t.js("document.activeElement && document.activeElement.getAttribute('data-key')"), 'home-rec-fatigue:9', 'keyboard focus stays on the tapped square after the save re-render');
  t.equal(await t.js('T.derived().recoveryAdvice'), { code: 'rest', fatigue: 9, soreness: null }, 'derived rest advice from fatigue 9');
  const homeText = await t.js('T.pageText()');
  t.match(homeText, /Zvaž odpočinek/, 'the next-run card now says to consider resting');
  t.match(homeText, /únava 9\/10/, 'and names the reason');
  await t.exec(`T.need('[data-key="home-rec-fatigue:4"]').click(); await T.wait(() => T.state().recoveryLogs[0].fatigue === 4, 3000, 'fatigue 4 saved');`);
  t.ok(!/Zvaž odpočinek/.test(await t.js('T.pageText()')), 'fatigue 4: the rest warning is gone again');
  // the last tap is saved at once when the window goes away (close, update restart, Android background)
  const stored = () => "(JSON.parse(localStorage.getItem('veyvo-state')).recoveryLogs.find(l => l.date === '2026-11-27') || {})";
  t.equal(await t.exec(`T.need('[data-key="home-rec-fatigue:6"]').click(); window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); return ${stored()}.fatigue;`), 6, 'pagehide saves the last check-in tap without waiting for the 550 ms timer');
  t.equal(await t.exec(`T.need('[data-key="home-rec-fatigue:5"]').click();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const v = ${stored()}.fatigue;
    delete document.hidden;
    return v;`), 5, 'a hidden page (Android background) saves the last tap too');
  await t.exec(`T.need('[data-key="home-rec-fatigue:4"]').click(); await T.wait(() => T.state().recoveryLogs[0].fatigue === 4, 3000, 'fatigue 4 saved again');`);

  // ------------------------------------------------------------ 2. log a run: decimal comma + "69:40"
  await t.exec(`T.click('.sidebar [data-action="log-run"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="rd-distance"]'), 3000, 'run dialog');`);
  t.equal(await t.js("T.text('dialog[open] .dlg-title')"), 'Zapsat běh', 'Zapsat běh opens the run form');
  t.equal(await t.js("document.activeElement.getAttribute('data-key')"), 'rd-distance', 'focus starts in the distance field');
  t.equal(await t.js("T.need('dialog[open] [data-key=\"rd-date\"]').value"), '2026-11-27', 'date defaults to today');
  await t.exec(`
    T.input('dialog[open] [data-key="rd-distance"]', '12,4');
    T.input('dialog[open] [data-key="rd-time"]', '69:40');
    T.click('dialog[open] [data-key="rd-type:long"]');
    T.click('dialog[open] [data-key="rd-effort:6"]');
    await T.sleep(50);`);
  const formText = await t.js("T.dialog().innerText");
  t.match(formText, /Čteme jako 1:09:40/, '"69:40" is read as 1:09:40');
  t.match(formText, /5:37/, 'live pace 5:37 /km');
  await t.exec(`T.click('dialog[open] [data-key="rd-save"]'); await T.wait(() => T.state().runHistory.length === 10, 3000, 'run saved');`);
  const saved = await t.js("T.state().runHistory.find(r => r.date === '2026-11-27')");
  t.equal([saved.distance, saved.movingSeconds, saved.type, saved.effort, saved.source], [12.4, 4180, 'long', 6, 'manual'], 'stored 12,4 km in 4180 s, long, effort 6');
  await t.js("T.wait(() => /zapsaný/.test(T.text('dialog[open] .dlg-title')), 3000, 'result view')");
  const result = await t.js("T.text(T.dialog())");
  t.match(result, new RegExp('12,4' + '\\s*km'), 'result view shows 12,4 km');
  t.match(result, /1:09:40/, 'result view shows 1:09:40');
  t.match(result, /Další běh.*ne 29. 11./, 'result view shows the updated next run (Sunday)');
  await t.exec(`T.click('dialog[open] [data-key="rd-done"]'); await T.wait(() => T.dialogs() === 0, 3000, 'result closed');`);
  const home = await t.js('T.pageText()');
  t.match(home, /Dnešní běh je zapsaný/, 'Přehled headline: today\'s run is logged');
  t.ok(await t.js(`!!T.need('[data-key="home-run-${saved.id}"]')`), 'Přehled lists the new run');
  await t.js("T.go('progress')");
  const row = await t.js(`T.text(T.need('[data-key="prog-run-${saved.id}"]').closest('tr'))`);
  t.match(row, /12,4/, 'Výkonnost log row: 12,4 km');
  t.match(row, /1:09:40/, 'Výkonnost log row: 1:09:40');
  t.match(await t.js('T.pageText()'), /10\s*běhů/, 'Výkonnost counts 10 runs');
  await t.js("T.go('plan')");
  t.match(await t.js(`T.text('[data-key="plan-day:2026-11-27"]')`), /12,4/, 'Můj plán: Friday tile shows the run');
  t.equal(await t.js("T.derived().nextRun.date"), '2026-11-29', 'the next run moved to Sunday');

  // ------------------------------------------------------------ 3. edit with Undo
  await t.js("T.go('progress')");
  await t.exec(`T.click('[data-key="prog-run-${saved.id}"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="rd-edit"]'), 3000, 'run detail');`);
  await t.exec(`T.click('dialog[open] [data-key="rd-edit"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="rd-time"]'), 3000, 'edit form');`);
  t.equal(await t.js("T.need('dialog[open] [data-key=\"rd-time\"]').value"), '1:09:40', 'edit form shows the stored time');
  await t.exec(`T.input('dialog[open] [data-key="rd-time"]', '1:08:00'); T.click('dialog[open] [data-key="rd-save"]');
    await T.wait(() => T.state().runHistory.find(r => r.id === ${JSON.stringify(saved.id)}).movingSeconds === 4080, 3000, 'edit saved');`);
  t.ok(true, 'edit saved 1:08:00');
  t.match(await t.js("T.wait(() => T.toast(), 2000)"), /Vrátit/, 'edit toast offers Undo');
  await t.js('T.toastAction()');
  await t.js(`T.wait(() => T.state().runHistory.find(r => r.id === ${JSON.stringify(saved.id)}).movingSeconds === 4180, 3000, 'undo edit')`);
  t.ok(true, 'Undo restored 1:09:40');
  await t.js('T.closeDialogs()');

  // ------------------------------------------------------------ 4. delete with Undo
  await t.exec(`T.click('[data-key="prog-run-${saved.id}"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="rd-delete"]'), 3000, 'detail');
    T.click('dialog[open] [data-key="rd-delete"]'); await T.wait(() => T.state().runHistory.length === 9 && T.dialogs() === 0, 3000, 'deleted');`);
  t.ok(!(await t.js(`!!document.querySelector('[data-key="prog-run-${saved.id}"]')`)), 'deleted run left the log');
  await t.js('T.toastAction()');
  await t.js("T.wait(() => T.state().runHistory.length === 10, 3000, 'undo delete')");
  t.ok(await t.js(`!!document.querySelector('[data-key="prog-run-${saved.id}"]')`), 'Undo brought the run back into the log');

  // ------------------------------------------------------------ 5. dialogs: Esc, dirty form
  await t.exec(`VeyvoUI.app.dialogs.open('run', { mode: 'new' }); await T.wait(() => document.querySelector('dialog[open] [data-key="rd-distance"]'), 3000);`);
  await t.key('Escape');
  await t.js("T.wait(() => T.dialogs() === 0, 2000, 'Esc closes a clean form')");
  t.ok(true, 'Esc closes an untouched run form');
  await t.exec(`VeyvoUI.app.dialogs.open('run', { mode: 'new' }); await T.wait(() => document.querySelector('dialog[open] [data-key="rd-distance"]'), 3000);
    T.input('dialog[open] [data-key="rd-distance"]', '3,1');`);
  await t.key('Escape');
  await t.js("T.wait(() => T.dialogs() === 2, 2000, 'discard confirm')");
  t.match(await t.js("T.text('dialog[open].dlg-confirm, dialog[open] .dlg-confirm')") || await t.js("T.dialog().innerText"), /\S/, 'Esc on a half-filled form asks before discarding');
  await t.key('Escape');
  await t.js("T.wait(() => T.dialogs() === 1, 2000, 'keep editing')");
  t.equal(await t.js("T.need('dialog[open] [data-key=\"rd-distance\"]').value"), '3,1', 'cancelling the question keeps the typed value');
  // the × button asks the same question; "Zahodit" closes both
  await t.exec(`T.click('dialog[open] .dlg-close'); await T.wait(() => T.dialogs() === 2, 2000, 'discard confirm again');
    T.click(T.byText('dialog[open] .dlg-foot button', 'Zahodit')); await T.wait(() => T.dialogs() === 0, 2000, 'discarded');`);
  t.equal(await t.js('T.state().runHistory.length'), 10, '"Zahodit" closes the form and saves nothing');

  // ------------------------------------------------------------ 6. Strava import through app.strava.sync
  const activities = [
    // twin of today's manual run: same date, 0,02 km and 30 s apart
    { id: '7001', name: 'Ranní dlouhý', sportType: 'Run', startDate: '2026-11-27T06:30:00Z', startDateLocal: '2026-11-27T07:30:00Z', distanceKm: 12.38, movingTime: 4150, elapsedTime: 4300, averageHeartrate: 148.2, totalElevationGain: 64 },
    // a new run only Strava knows, late in the evening (local time must not shift to the next day)
    { id: '7002', name: 'Večerní klus', sportType: 'Run', startDate: '2026-11-25T22:40:00Z', startDateLocal: '2026-11-25T23:40:00Z', distanceKm: 4.02, movingTime: 1490, elapsedTime: 1520, averageHeartrate: 139, totalElevationGain: 12 }
  ];
  t.ipc.set('strava-sync', () => activities);
  const sync1 = await t.js('VeyvoUI.app.strava.sync({ manual: true })');
  t.equal([sync1.ok, sync1.added], [true, 1], 'sync: 1 new run (the twin merged)');
  const afterSync = await t.exec(`
    const runs = T.state().runHistory;
    const twin = runs.find(r => r.date === '2026-11-27'), late = runs.find(r => r.stravaActivityId === '7002');
    return { n: runs.length, twin: [twin.id, twin.movingSeconds, twin.distance, twin.stravaMovingSeconds, twin.stravaActivityId, twin.averageHeartrate, twin.type],
      late: [late.date, late.startTime, late.distance, late.movingSeconds, late.effort], connected: T.state().strava.connected, error: T.state().strava.lastError };`);
  t.equal(afterSync.n, 11, '11 runs after the import, no duplicate of the typed run');
  t.equal(afterSync.twin.slice(1), [4180, 12.4, 4150, '7001', 148.2, 'long'], 'twin: typed time + distance + type win, Strava time kept as stravaMovingSeconds, heart rate added');
  t.equal(afterSync.late, ['2026-11-25', '23:40', 4.02, 1490, null], 'late-evening Strava run stays on its local day');
  t.equal([afterSync.connected, afterSync.error], [true, null], 'Strava marked connected, no error');
  const sync2 = await t.js('VeyvoUI.app.strava.sync({ manual: true })');
  t.equal([sync2.added, await t.js('T.state().runHistory.length')], [0, 11], 're-sync adds nothing');
  // delete the Strava-only run in the UI: it must not come back
  await t.js("T.go('progress')");
  const lateId = await t.js("T.state().runHistory.find(r => r.stravaActivityId === '7002').id");
  await t.exec(`T.click('[data-key="prog-run-${lateId}"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="rd-delete"]'), 3000);
    T.click('dialog[open] [data-key="rd-delete"]'); await T.wait(() => T.state().runHistory.length === 10, 3000, 'strava run deleted');`);
  t.equal(await t.js('T.state().ignoredStravaIds'), ['7002'], 'deleted Strava run is on the ignore list');
  const sync3 = await t.js('VeyvoUI.app.strava.sync({ manual: true })');
  t.equal([sync3.added, await t.js('T.state().runHistory.length')], [0, 10], 'a deleted Strava run is not imported again');
  t.match(await t.js("T.text('[data-slot=\"connection\"]')"), /Strava/, 'sidebar shows the Strava status');
  // a revoked sign-in: main answers [auth_required]
  t.ipc.set('strava-sync', () => { throw new Error('[auth_required] Synchronizace Stravy selhala (401).'); });
  console.log('  --  simulated 401: Electron logs the rejected "strava-sync" handler below, that is expected');
  const sync4 = await t.js('VeyvoUI.app.strava.sync({ manual: false })');
  t.equal(sync4.ok, false, 'a 401 sync fails');
  t.match(await t.js('T.state().strava.lastError'), /401/, 'the error keeps the 401');
  t.match(await t.js("T.text('[data-slot=\"connection\"]')"), /chyba/, 'sidebar: "Strava: chyba"');
  t.match(await t.js("T.wait(() => T.toast(), 2000)"), /přihlášení/, 'the failure is toasted, not swallowed');
  await t.exec(`VeyvoUI.app.dialogs.open('settings', { section: 'connections' }); await T.wait(() => T.dialog(), 3000); await T.sleep(100);`);
  t.match(await t.js('T.dialog().innerText'), /Vyžaduje nové přihlášení/, 'Settings › Propojení: "Vyžaduje nové přihlášení" after a background 401');
  await t.js('T.closeDialogs()');
  t.ipc.reset('strava-sync');

  // ------------------------------------------------------------ 7. plan: schedule a library session, remove it, Undo
  await t.js("T.go('plan')");
  await t.exec(`T.click('[data-key="plan-tpl-plan:intervals400"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="plan-pick:2026-11-28"]'), 3000, 'schedule dialog');
    T.click('dialog[open] [data-key="plan-pick:2026-11-28"]');
    T.click(T.byText('dialog[open] .dlg-foot button', 'Naplánovat'));
    await T.wait(() => T.state().plannedWorkouts.length === 1 && T.dialogs() === 0, 3000, 'scheduled');
    await T.sleep(250);`);
  t.equal(await t.js('T.state().plannedWorkouts'), [{ date: '2026-11-28', templateId: 'intervals400' }], 'intervals 6× 400 m booked for Saturday');
  const ns = await t.js('T.derived().nextSession');
  t.equal([ns.source, ns.date], ['planned', '2026-11-28'], 'the booked Saturday session is the next session (before the engine\'s Sunday run)');
  t.match(await t.js("T.text('[data-slot=\"next-badge\"]')"), /so 28\. 11\./, 'nav badge: so 28. 11.');
  t.match(await t.js("T.text('.plan-next')"), /400/, 'Další trénink panel shows the booked intervals');
  t.match(await t.js("T.text('[data-key=\"plan-day:2026-11-28\"]')"), /400/, 'Saturday tile shows the session');
  await t.exec(`T.click('[data-key="plan-x:2026-11-28"]'); await T.wait(() => T.state().plannedWorkouts.length === 0, 3000, 'unscheduled');`);
  t.ok(true, '× removes the session');
  await t.js('T.toastAction()');
  await t.js("T.wait(() => T.state().plannedWorkouts.length > 0, 3000, 'undo unschedule')");
  t.equal(await t.js('T.state().plannedWorkouts'), [{ date: '2026-11-28', templateId: 'intervals400' }], 'Undo brings back exactly one session');
  await t.exec(`T.click('[data-key="plan-x:2026-11-28"]'); await T.wait(() => T.state().plannedWorkouts.length === 0, 3000);`);
  t.equal(await t.js("T.derived().nextSession.date"), '2026-11-29', 'without it the next session is Sunday again');
  // the day menu without the Popover API (old Android WebView): next to its button, above the day cards
  const menu = await t.exec(`
    const proto = HTMLElement.prototype, saved = proto.showPopover;
    delete proto.showPopover;
    try {
      VeyvoUI.app.navigate('home');
      await T.sleep(50);
      VeyvoUI.app.navigate('plan');
      await T.wait(() => document.querySelector('.plan-day-more'), 3000, 'day menu button');
      await T.sleep(650);
      const btn = document.querySelector('.plan-day-more');
      btn.click();
      const el = document.getElementById(btn.getAttribute('aria-controls'));
      await T.sleep(50);
      const b = btn.getBoundingClientRect(), m = el.getBoundingClientRect();
      const hit = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
      const res = { shown: !el.hidden, dy: Math.round(m.top - b.bottom), dr: Math.round(Math.abs(b.right - m.right)), onTop: el.contains(hit) };
      btn.click();
      res.closed = el.hidden && btn.getAttribute('aria-expanded') === 'false' && el.parentNode !== document.body;
      return res;
    } finally { proto.showPopover = saved; }`);
  t.ok(menu.shown && menu.dy >= 0 && menu.dy <= 8 && menu.dr <= 2, 'fallback day menu opens right under its button (' + JSON.stringify(menu) + ')');
  t.ok(menu.onTop, 'fallback day menu is painted above the following day cards');
  t.ok(menu.closed, 'and closes again');

  // ------------------------------------------------------------ 8. workout export ("Do hodinek")
  await t.js("T.go('home')");
  await t.exec(`VeyvoUI.app.dialogs.open('workout', {}); await T.wait(() => document.querySelector('dialog[open] [data-key="ws-brand-garmin"]'), 3000, 'workout sheet');`);
  const wName = await t.js("T.derived().nextWorkout.name");
  t.match(await t.js("T.text('dialog[open] .dlg-title')"), /\S/, 'workout sheet opened for the next workout (' + wName + ')');
  t.ipc.reset('file-save');
  await t.exec(`T.click('dialog[open] [data-key="ws-brand-garmin"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="ws-save-fit"]'), 3000);
    T.click('dialog[open] [data-key="ws-save-fit"]'); await T.wait(() => T.state().exportLog.some(e => e.format === 'fit'), 3000, 'fit export logged');`);
  const fitCall = t.ipc.calls['file-save'][0][0];
  const fit = Buffer.from(fitCall.data);
  t.match(fitCall.name, /\.fit$/, 'saveFile got a .fit file (' + fitCall.name + ')');
  t.ok(fit.length > 30 && fit[0] === 14 && fit.toString('ascii', 8, 12) === '.FIT', 'FIT bytes: 14-byte header with ".FIT" signature (' + fit.length + ' bytes)');
  t.equal(fit.readUInt32LE(4), fit.length - 14 - 2, 'FIT header data size matches the file (minus header and CRC)');
  t.match(await t.js('T.dialog().innerText'), /Uloženo|uložen/i, 'the sheet confirms where the file went');
  t.ipc.reset('file-save');
  await t.exec(`T.click('dialog[open] [data-key="ws-brand-apple"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="ws-save-apple"]'), 3000);
    T.click('dialog[open] [data-key="ws-save-apple"]'); await T.wait(() => T.state().exportLog.some(e => e.format === 'apple'), 3000, 'apple export logged');`);
  const appleCall = t.ipc.calls['file-save'][0][0];
  const apple = Buffer.from(appleCall.data);
  t.match(appleCall.name, /\.workout$/, 'saveFile got an Apple .workout file (' + appleCall.name + ')');
  t.ok(apple.length > 20 && apple.includes(Buffer.from(wName.slice(0, 6), 'utf8')), 'Apple bytes produced (' + apple.length + ' bytes, contain the workout name)');
  t.ipc.reset('file-save');
  t.clipboard.writeText('');
  await t.exec(`T.click('dialog[open] [data-key="ws-brand-polar"]'); await T.wait(() => document.querySelector('dialog[open] [data-key="ws-copy"]'), 3000);`);
  await t.clickOn('dialog[open] [data-key="ws-copy"]'); // the clipboard needs a focused page and a real click
  await t.js("T.wait(() => T.state().exportLog.some(e => e.format === 'text'), 3000, 'text copy logged')");
  t.match(await t.js("T.wait(() => /ve schránce/.test(T.text(T.dialog())) && T.text(T.dialog()), 2000, 'copied status')"), /Trénink je ve schránce/, 'copy as text confirms the clipboard');
  const clip = String((await t.clipboard.readText()) || ''); // sync in Electron 38, may be async later
  if (clip) t.ok(clip.includes(wName.slice(0, 8)), 'the clipboard holds the workout as text');
  else console.log('  --  clipboard not readable on this display server; status + export log checked instead');
  t.equal(t.ipc.calls['file-save'].length, 0, 'copying text saves no file');
  await t.key('Escape');
  await t.js("T.wait(() => T.dialogs() === 0, 2000, 'Esc closes the workout sheet')");
  t.ok(true, 'Esc closes the workout sheet');

  // ------------------------------------------------------------ 9a. a crafted backup cannot brick the app
  // run ids named like Object.prototype keys ('toString') are renamed on import and the app still starts
  await t.exec(`const state = JSON.parse(JSON.stringify(T.state()));
    state.runHistory = state.runHistory.concat([{ id: 'toString', source: 'manual', date: '2026-11-25', type: 'run', distance: 4, movingSeconds: 1500 },
      { id: '__proto__', source: 'manual', date: '2026-11-26', type: 'easy', distance: 3, movingSeconds: 1200 }]);
    const text = JSON.stringify({ app: 'VEYVO', kind: 'backup', schemaVersion: 2, state });
    VeyvoUI.app.dialogs.open('settings', { section: 'data', backupText: text, backupName: 'crafted.json' });
    await T.wait(() => document.querySelector('dialog[open] [data-key="set-merge"]'), 3000, 'import preview');
    T.click('dialog[open] [data-key="set-merge"]');
    await T.wait(() => T.state().runHistory.some(r => r.id === 'm-toString'), 3000, 'merged');`);
  await t.js('T.closeDialogs()');
  await t.reload();
  t.ok(await t.js('VeyvoUI.app.isReady()'), 'after merging a backup with run id "toString" the app still starts');
  t.equal(await t.js("T.state().runHistory.filter(r => r.id === 'm-toString' || r.id === 'm-__proto__').length"), 2, 'the crafted ids were renamed (m-toString, m-__proto__)');
  // defence in depth: a change the app cannot show is never saved (it would fail on every launch)
  const errorsBefore = t.errors.length;
  const guard = await t.exec(`const stored = localStorage.getItem('veyvo-state'), runs = T.state().runHistory.length;
    const orig = VeyvoRuns.runNotes;
    VeyvoRuns.runNotes = () => { throw new Error('boom'); };
    let r;
    try { r = VeyvoUI.app.update(s => { s.profile = Object.assign({}, s.profile, { name: 'Rozbité' }); }, { reason: 'profile' }); }
    finally { VeyvoRuns.runNotes = orig; }
    return { ok: r.ok, same: localStorage.getItem('veyvo-state') === stored, name: T.state().profile.name, runs: T.state().runHistory.length === runs };`);
  t.equal([guard.ok, guard.same, guard.name !== 'Rozbité', guard.runs], [false, true, true, true], 'a state that breaks the derived data is rolled back, not saved');
  t.errors.splice(errorsBefore, t.errors.length - errorsBefore, ...t.errors.slice(errorsBefore).filter(e => !/cannot be shown|boom/.test(e)));
  await t.exec(`await VeyvoUI.app.update(s => { s.runHistory = s.runHistory.filter(r => r.id !== 'm-toString' && r.id !== 'm-__proto__'); }, { reason: 'cleanup' });`);

  // ------------------------------------------------------------ 9. storage full: nothing claims to be saved
  await t.exec(`window.__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'veyvo-state') throw new DOMException('quota', 'QuotaExceededError'); return window.__setItem.call(this, k, v); };`);
  const full = await t.exec(`const before = T.state().profile.name;
    const r = VeyvoUI.app.update(s => { s.profile = Object.assign({}, s.profile, { name: 'Neuloženo' }); }, { reason: 'profile', toast: 'Profil uložen.' });
    await T.sleep(60);
    return { ok: r.ok, errors: r.errors, name: T.state().profile.name, before, toast: T.toast(), stored: JSON.parse(localStorage.getItem('veyvo-state')).profile.name };`);
  t.equal([full.ok, full.errors], [false, ['storage-full']], 'update() reports a failed save (ok: false, storage-full)');
  t.equal([full.name, full.stored], [full.before, full.before], 'the app stays on the stored state');
  t.match(full.toast, /Úložiště je plné/, 'the error toast stays visible (not replaced by "Profil uložen")');
  const runsBefore = await t.js('T.state().runHistory.length');
  await t.exec(`VeyvoUI.app.dialogs.open('run', { mode: 'new' }); await T.wait(() => document.querySelector('dialog[open] [data-key="rd-distance"]'), 3000, 'run dialog');
    T.input('dialog[open] [data-key="rd-distance"]', '4');
    T.input('dialog[open] [data-key="rd-time"]', '24:00');
    await T.sleep(60);
    T.click('dialog[open] [data-key="rd-save"]');
    await T.sleep(150);`);
  t.ok(await t.js("!!document.querySelector('dialog[open] [data-key=\"rd-distance\"]') && /Úložiště je plné/.test(T.text(T.dialog()))"), 'the run dialog stays open and says the run was not saved');
  t.equal(await t.js('T.state().runHistory.length'), runsBefore, 'no run was added in memory either (a retry cannot add it twice)');
  await t.exec(`Storage.prototype.setItem = window.__setItem;
    T.click('dialog[open] [data-key="rd-save"]');
    await T.wait(() => T.state().runHistory.length === ${runsBefore + 1}, 3000, 'saved after storage is back');`);
  t.equal(await t.js("JSON.parse(localStorage.getItem('veyvo-state')).runHistory.length"), runsBefore + 1, 'with space again the same form saves exactly one run');
  await t.js('T.closeDialogs()');

  t.noErrors();
}, { timeout: 180000 });
