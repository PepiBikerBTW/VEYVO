// Electron UI test: the iPhone app (App Store channel) with its native Apple features, driven through the
// real UI on the fake iOS Capacitor shell of tests/visual/stub-preload.cjs (recording VeyvoWorkoutKit and
// VeyvoHealth plugins). The page is the App Store copy that mobile/scripts/sync-web.mjs --channel appstore
// writes, exactly what `npm run sync:ios` puts into the Xcode project.
//   electron tests/ui-ios.cjs            (npm run test:ui runs it with the repo's Electron)
// Covers: platform 'ios' + appstore channel; Settings › Propojení shows Apple Zdraví (no Strava, no text
// naming other platforms); "Importovat běhy" asks for access, reads 90 days, adds new runs, completes the
// manual twin (typed time wins), skips a run without distance; the next import reads from 7 days before
// the last one and adds nothing; a deleted Health run stays deleted; the app imports on its own at start;
// the workout sheet preselects Apple Watch, "Přidat do Apple Watch" sends the VEYVO workout JSON to
// WorkoutKit, "Naplánovat na …" schedules it at 07:00 of its day; below iOS 17 the .workout file is the
// main action again; Garmin steers to intervals.icu; no console errors.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { run } = require('./ui-harness.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvo-ios-'));
const WWW = path.join(OUT, 'www');
const sync = spawnSync(process.execPath, [path.join(ROOT, 'mobile', 'scripts', 'sync-web.mjs'), '--channel', 'appstore', '--out', WWW],
  { encoding: 'utf8', env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', VEYVO_CHANNEL: '' }) });
if (sync.status !== 0) { console.error('sync-web failed:\n' + sync.stdout + sync.stderr); process.exit(1); }
process.on('exit', () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* temp dir */ } });

const HK_TWIN = '6F1C2D3E-4A5B-4C6D-8E7F-90A1B2C3D4E5';
const HK_NEW = '11111111-2222-4333-8444-555555555555';
const DAY = 86400000;

run('VEYVO UI on iPhone: Apple Zdraví import, Apple Watch through WorkoutKit', async t => {
  await t.seed({ 'veyvo-state': t.ownerState() });
  t.equal(await t.js("[VeyvoPlatform.kind, VeyvoPlatform.build.channel, VeyvoPlatform.build.store, document.documentElement.dataset.platform]"), ['ios', 'appstore', true, 'ios'], 'the fake iPhone shell runs the App Store copy');
  t.equal(await t.js("[VeyvoPlatform.watch.supported, VeyvoPlatform.health.supported, VeyvoPlatform.updates.supported, VeyvoPlatform.strava.supported]"), [true, true, false, false], 'watch + health on, no updater, no Strava');

  // ------------------------------------------------------------ 1. Settings › Propojení › Apple Zdraví
  await t.exec("VeyvoUI.app.dialogs.open('settings', { section: 'connections' }); await T.wait(() => T.$('[data-key=\"set-health-import\"]'), 3000, 'Apple Zdraví card');");
  const settingsText = await t.js("T.text(T.dialog())");
  t.match(settingsText, /Apple Zdraví/, 'the Apple Zdraví card is shown');
  t.match(settingsText, /intervals\.icu/, 'intervals.icu stays');
  t.ok(!/Strava/.test(settingsText), 'no Strava anywhere in the iPhone settings');
  t.ok(!/Android|Windows|GitHub|\bAPK\b/.test(settingsText), 'no other platform named (App Store guideline 2.3.10)');
  t.equal(await t.js("T.text('[data-key=\"set-health-import\"]')"), 'Importovat běhy', 'the first action is "Importovat běhy"');

  const before = Date.now();
  await t.exec("T.click('[data-key=\"set-health-import\"]'); await T.wait(() => T.state().health.enabled && T.state().runHistory.length === 10, 4000, 'health import stored');");
  const calls = await t.js('VeyvoIosStub.calls().map(c => c.name)');
  const firstImport = calls.indexOf('VeyvoHealth.importRuns');
  t.ok(calls.indexOf('VeyvoHealth.requestAuthorization') >= 0 && calls.indexOf('VeyvoHealth.requestAuthorization') < firstImport, 'read access is requested before the import');
  const since1 = await t.js("Date.parse(VeyvoIosStub.calls().find(c => c.name === 'VeyvoHealth.importRuns').options.since)");
  t.ok(Math.abs(since1 - (before - 90 * DAY)) < 60000, 'the first import reads the last 90 days');
  await t.js("T.wait(() => /Z Apple Zdraví přibyl 1 běh/.test(T.toast()), 3000, 'import toast')");
  t.ok(true, 'toast: "Z Apple Zdraví přibyl 1 běh."');
  const twin = await t.js("T.state().runHistory.find(r => r.date === '2026-11-24')");
  t.equal([twin.id, twin.source, twin.movingSeconds, twin.distance, twin.startTime, twin.healthId, twin.averageHeartrate, twin.maxHeartrate],
    ['m-seed-9', 'manual', 1262, 5, '18:10', HK_TWIN, 171.4, 186], 'the manual twin keeps its time and distance and gains heart rate + the Health id');
  const added = await t.js("T.state().runHistory.find(r => r.id === 'health-" + HK_NEW + "')");
  t.equal([added.source, added.date, added.startTime, added.distance, added.movingSeconds, added.sourceName], ['health', '2026-11-26', '07:05', 8.02, 2900, 'Garmin Connect'], 'the new run is stored as source health');
  t.ok(!(await t.js("T.state().runHistory.some(r => r.date === '2026-11-25')")), 'a Health workout without a distance is skipped');
  await t.js("T.wait(() => /1 běh bez vzdálenosti se nenačetl/.test(T.text(T.dialog())), 2000, 'skipped note')");
  t.ok(true, 'the card says one run without a distance was not imported');
  t.match(await t.js("T.text(T.dialog())"), /Zapnuto/, 'status chip: Zapnuto');

  await t.exec("const n = VeyvoIosStub.calls().length; T.click('[data-key=\"set-health-import\"]'); await T.wait(() => VeyvoIosStub.calls().filter(c => c.name === 'VeyvoHealth.importRuns').length === 2 && !T.$('[data-key=\"set-health-import\"].is-busy'), 4000, 'second import');");
  const since2 = await t.js("Date.parse(VeyvoIosStub.calls().filter(c => c.name === 'VeyvoHealth.importRuns')[1].options.since)");
  const last1 = await t.js("Date.parse(T.state().health.lastImport)");
  t.ok(since2 < last1 - 6.9 * DAY && since2 > last1 - 7.2 * DAY, 'the next import starts 7 days before the last one');
  t.equal(await t.js('T.state().runHistory.length'), 10, 'nothing is imported twice');
  await t.js("T.wait(() => /Žádné nové běhy/.test(T.toast()), 3000, 'up-to-date toast')");
  t.ok(true, 'a manual import with nothing new says so');

  await t.exec("VeyvoUI.app.update(s => VeyvoStore.deleteRun(s, 'health-" + HK_NEW + "'), { reason: 'run-delete' });");
  t.equal(await t.js('T.state().ignoredHealthIds'), [HK_NEW], 'deleting a Health run remembers its workout id');
  await t.exec("T.click('[data-key=\"set-health-import\"]'); await T.wait(() => VeyvoIosStub.calls().filter(c => c.name === 'VeyvoHealth.importRuns').length === 3 && !T.$('[data-key=\"set-health-import\"].is-busy'), 4000, 'third import');");
  t.equal(await t.js("T.state().runHistory.some(r => r.healthId === '" + HK_NEW + "')"), false, 'a deleted Health run stays deleted');
  t.match(await t.js("T.text(T.dialog())"), /1 smazaný běh z Apple Zdraví se znovu nenačítá/, 'the card counts the deleted run and offers to restore it');
  t.ok(await t.js("!!T.$('[data-key=\"set-health-restore\"]')"), 'restore button shown');

  // the error path: Health unavailable -> chip + callout, connections dot
  await t.exec("VeyvoIosStub.set('hkAvailable', false); T.click('[data-key=\"set-health-import\"]'); await T.wait(() => T.state().health.lastError, 4000, 'health error stored');");
  t.match(await t.js("T.text(T.dialog())"), /Apple Zdraví není v tomto zařízení dostupné/, 'an unavailable Health store is explained');
  await t.exec("VeyvoIosStub.set('hkAvailable', true); T.click('[data-key=\"set-health-import\"]'); await T.wait(() => !T.state().health.lastError && !T.$('[data-key=\"set-health-import\"].is-busy'), 4000, 'error cleared');");
  t.ok(true, 'the next good import clears the error');
  await t.exec("await T.closeDialogs();");

  // ------------------------------------------------------------ 2. automatic import when the app starts
  await t.reload();
  await t.js("T.wait(() => VeyvoIosStub.calls().some(c => c.name === 'VeyvoHealth.importRuns'), 5000, 'automatic import after start')");
  t.ok(true, 'with Apple Zdraví on, the app imports new runs on its own when it starts');
  await t.js("T.wait(() => !VeyvoIosStub.calls().some(c => c.name === 'VeyvoHealth.importRuns') || T.state().health.lastImport, 3000, 'automatic import finished')");
  await t.exec("Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; await T.sleep(200);");
  t.equal(await t.js("VeyvoIosStub.calls().filter(c => c.name === 'VeyvoHealth.importRuns').length"), 1, 'coming back to the foreground right away does not import again (15 min pause)');

  // ------------------------------------------------------------ 3. workout sheet: Apple Watch through WorkoutKit
  await t.exec("VeyvoUI.app.dialogs.open('workout', {}); await T.wait(() => T.$('[data-key=\"ws-watch-add\"]'), 3000, 'Apple Watch flow');");
  t.equal(await t.js("T.$('.ws-flow').dataset.brand"), 'apple', 'Apple Watch is preselected on iPhone');
  t.equal(await t.js("T.text('[data-key=\"ws-watch-add\"]')"), 'Přidat do Apple Watch', 'the primary action is "Přidat do Apple Watch"');
  t.ok(await t.js("T.$('[data-key=\"ws-watch-add\"]').classList.contains('btn-primary')"), 'and it is the primary button');
  t.ok(await t.js("!T.$('[data-key=\"ws-apple-file\"]').open"), 'the .workout file waits behind "Pro pokročilé"');
  await t.exec("T.click('[data-key=\"ws-apple-loc:indoor\"]'); await T.sleep(50);");
  await t.exec("T.click('[data-key=\"ws-watch-add\"]'); await T.wait(() => /Náhled je zavřený/.test(T.text(T.dialog())), 3000, 'preview closed status');");
  const preview = await t.js("VeyvoIosStub.calls().find(c => c.name === 'VeyvoWorkoutKit.preview').options");
  const model = JSON.parse(preview.workoutJson);
  const next = await t.js('T.derived().nextSession.workout');
  t.equal([model.id, model.name, model.steps.length], [next.id, next.name, next.steps.length], 'WorkoutKit gets the VEYVO workout model as JSON');
  t.equal(preview.indoor, true, '"Na pásu" makes it an indoor workout');
  t.ok(/^[0-9A-F]{8}-[0-9A-F]{4}-8[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(preview.planId), 'with a stable plan id');
  t.equal(await t.js("T.state().exportLog.slice(-1)[0].format"), 'apple-watch', 'the export log records the Apple Watch hand-over');

  t.ok(await t.js("!!T.$('[data-key=\"ws-watch-plan\"]')"), 'scheduling is offered when the scheduler is supported');
  const planLabel = await t.js("T.text('[data-key=\"ws-watch-plan\"]')");
  t.match(planLabel, /^Naplánovat na /, 'the schedule button names the day: ' + planLabel);
  await t.exec("T.click('[data-key=\"ws-watch-plan\"]'); await T.wait(() => /Naplánováno na/.test(T.text(T.dialog())), 3000, 'scheduled status');");
  const scheduled = await t.js("VeyvoIosStub.calls().find(c => c.name === 'VeyvoWorkoutKit.schedule').options");
  t.equal([scheduled.date, scheduled.hour], [next.date && next.date >= t.TODAY ? next.date : t.TODAY, 7], 'scheduled for the workout day at 07:00');
  t.equal(await t.js("T.state().exportLog.slice(-1)[0].format"), 'apple-schedule', 'the export log records the scheduling');
  await t.exec("await T.closeDialogs();");

  // denied scheduling: the error is worded
  await t.exec("VeyvoIosStub.set('wkError', 'watch_denied'); VeyvoUI.app.dialogs.open('workout', {}); await T.wait(() => T.$('[data-key=\"ws-watch-plan\"]'), 3000, 'plan button'); T.click('[data-key=\"ws-watch-plan\"]'); await T.wait(() => /nemá povolené plánovat/.test(T.text(T.dialog())), 3000, 'denied text');");
  t.ok(true, 'a denied scheduler permission is explained');
  await t.exec("VeyvoIosStub.set('wkError', null);");
  await t.exec("await T.closeDialogs();");

  // below iOS 17 the plugin answers supported: false -> the .workout file is the main action again
  await t.exec("VeyvoIosStub.set('wkSupported', false); VeyvoUI.app.dialogs.open('workout', {}); await T.wait(() => T.$('[data-key=\"ws-save-apple\"]') && !T.$('[data-key=\"ws-watch-add\"]'), 3000, 'file flow after check()');");
  t.ok(await t.js("T.$('[data-key=\"ws-save-apple\"]').classList.contains('btn-primary')"), 'below iOS 17: "Sdílet .workout" is the primary action');
  t.match(await t.js("T.text('[data-key=\"ws-save-apple\"]')"), /^Sdílet \.workout/, 'files go through the share sheet');
  t.match(await t.js("T.text(T.dialog())"), /Uložit do Souborů/, 'with iPhone steps');

  // Garmin from an iPhone: intervals.icu first, the .fit file as the advanced option
  await t.exec("T.click('[data-brand=\"garmin\"]'); await T.wait(() => T.$('[data-key=\"ws-garmin-cloud\"]'), 3000, 'Garmin via intervals.icu');");
  t.ok(true, 'the Garmin card steers to intervals.icu on iPhone');
  const sheetText = await t.js("T.text(T.dialog())");
  t.ok(!/Android|Windows|GitHub|\bAPK\b/.test(sheetText), 'the sheet names no other platform');
  t.ok(!/Samsung|Pixel/.test(sheetText), 'no Samsung / Pixel Watch tiles in the iPhone build (guideline 2.3.10)');
  await t.exec("await T.closeDialogs();");

  // ------------------------------------------------------------ 4. O aplikaci
  await t.exec("VeyvoUI.app.dialogs.open('settings', { section: 'about' }); await T.wait(() => /Apple Zdraví VEYVO jen čte/.test(T.text(T.dialog())), 3000, 'privacy line');");
  const about = await t.js("T.text(T.dialog())");
  t.match(about, /iPhone/, 'the platform is iPhone');
  t.ok(!/Android|Windows|GitHub|\bAPK\b/.test(about), 'O aplikaci names no other platform');
  await t.exec("await T.closeDialogs();");
  t.noErrors();
}, {
  width: 430, height: 932,
  preload: path.join(ROOT, 'tests', 'visual', 'stub-preload.cjs'), sandbox: false, args: ['--veyvo-platform=ios'],
  index: path.join(WWW, 'src', 'index.html'), timeout: 150000
});
