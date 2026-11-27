// Electron UI test: "Před během" (nutrition and pre-run preparation).
//   electron tests/ui-nutrition.cjs       (npm run test:ui runs it with the repo's Electron)
// Covers: every edit saves under localStorage 'veyvo-pre-run-v1' in the 0.3 format and is restored
// after a restart; the fuel calculator (60 g -> 3 servings of 25 g, invalid rates rejected); the
// timeline crossing midnight ("předchozí den"); the checklist with reset + Undo (notes untouched);
// "Podle dalšího běhu" fills distance and minutes from the plan; a saved 0.3 record keeps unknown
// keys; English; no sideways scroll at 1480, 1120 and 412 px; no console errors.
'use strict';
const { run } = require('./ui-harness.cjs');

const KEY = 'veyvo-pre-run-v1';

run('VEYVO UI: Před během saves, restores and calculates', async t => {
  await t.seed({ 'veyvo-state': t.ownerState() }, 'nutrition');
  t.equal(await t.js("T.text('#page-title')"), 'Před během', 'Před během opens from the hash');
  t.equal(await t.js(`localStorage.getItem('${KEY}')`), null, 'nothing saved before the first edit');
  t.equal(await t.js("T.$$('#main h1, #main h2').filter(T.visible).filter(el => /Před během/.test(el.textContent)).length"), 0, 'the page title is not repeated inside the page');

  // ------------------------------------------------------------ 1. edits save at once (0.3 format)
  await t.exec(`
    T.click('[data-key="nut-distance:21.1"]');
    T.input('#nut-minutes', '120');
    T.click('[data-key="nut-timing:soon"]');
    T.input('#nut-start', '02:30');
    await T.sleep(60);
    T.input('#nut-rate', '30');
    T.input('#nut-serving', '25');
    T.input('[data-key="nut-notes"]', 'Toast v 7:00, bez potíží.');
    T.click('label[for="nut-check-meal"], #nut-check-meal');
    await T.sleep(120);`);
  const saved = JSON.parse(await t.js(`localStorage.getItem('${KEY}')`));
  t.equal([saved.nutritionDistance, saved.nutritionMinutes, saved.nutritionTiming, saved.nutritionStart, saved.nutritionRate, saved.nutritionServing, saved.nutritionNotes],
    ['21.1', '120', 'soon', '02:30', '30', '25', 'Toast v 7:00, bez potíží.'], 'every field saved under veyvo-pre-run-v1 in the 0.3 format');
  t.equal(saved.checks && saved.checks.meal, true, 'the ticked checklist item is saved');
  const page = await t.js('T.text("#main")');
  t.match(page, /60\s*g sacharidů celkem, tedy 3\s*porce po 25\s*g/, 'calculator: 60 g in total, 3 servings of 25 g (Czech plural "3 porce")');
  t.match(page, /předchozí den/, 'a 02:30 start puts the meal on the previous day');
  t.match(page, /Teď/, 'the phase for "do 1 h" is marked "Teď"');
  await t.exec(`T.input('#nut-rate', '95'); await T.sleep(80);`);
  t.match(await t.js('T.text("#main")'), /Zadej cíl 30–60\s*g\/h/, 'a rate above 60 g/h for 120 min is rejected with the allowed range');
  await t.exec(`T.input('#nut-rate', '30'); await T.sleep(80);`);

  // ------------------------------------------------------------ 2. restored after a restart
  await t.reload();
  await t.js("T.wait(() => document.querySelector('#nut-minutes'), 3000, 'nutrition page after restart')");
  const restored = await t.exec(`return {
    dist: document.querySelector('[data-key="nut-distance:21.1"]').getAttribute('aria-checked'),
    minutes: T.need('#nut-minutes').value, start: T.need('#nut-start').value, rate: T.need('#nut-rate').value,
    notes: T.need('[data-key="nut-notes"]').value, meal: T.need('#nut-check-meal').checked, text: T.text('#main') };`);
  t.equal([restored.dist, restored.minutes, restored.start, restored.rate, restored.notes, restored.meal], ['true', '120', '02:30', '30', 'Toast v 7:00, bez potíží.', true], 'distance, minutes, start, rate, notes and checklist restored');
  t.match(restored.text, /60\s*g sacharidů celkem/, 'the calculation is restored too');

  // ------------------------------------------------------------ 3. checklist reset with Undo
  await t.exec(`T.click('#nut-check-drink'); await T.sleep(60); T.click('[data-key="nut-reset"]'); await T.sleep(80);`);
  t.equal(await t.js("[T.need('#nut-check-meal').checked, T.need('#nut-check-drink').checked]"), [false, false], 'reset clears the checklist');
  t.equal(await t.js("T.need('[data-key=\"nut-notes\"]').value"), 'Toast v 7:00, bez potíží.', 'reset keeps the notes');
  t.equal(JSON.parse(await t.js(`localStorage.getItem('${KEY}')`)).checks.meal, false, 'the reset is saved');
  await t.js('T.toastAction()');
  await t.js("T.wait(() => T.need('#nut-check-meal').checked && T.need('#nut-check-drink').checked, 3000, 'undo reset')");
  t.equal(JSON.parse(await t.js(`localStorage.getItem('${KEY}')`)).checks.drink, true, 'Undo restores and saves the ticks');

  // ------------------------------------------------------------ 4. fill from the next run
  const sug = await t.js("T.wait(() => document.querySelector('[data-key=\"nut-next-apply\"]'), 2000, 'next-run button') && T.text(T.need('[data-key=\"nut-next-apply\"]').closest('section, .card, div'))");
  t.match(sug, /ne 29\. 11\./, 'the suggestion names the next run (Sunday)');
  await t.exec(`T.click('[data-key="nut-next-apply"]'); await T.sleep(120);`);
  const filled = JSON.parse(await t.js(`localStorage.getItem('${KEY}')`));
  const est = await t.js('VeyvoUI.nutrition.nextSuggestion(T.derived())');
  t.equal([filled.nutritionDistance, filled.nutritionMinutes], [est.distance, String(est.minutes)], '"Podle dalšího běhu" picked the nearest distance option (' + est.distance + ' km) and the plan\'s ' + est.minutes + ' min (' + est.km + ' km run)');
  t.equal(await t.js("T.need('[data-key=\"nut-notes\"]').value"), 'Toast v 7:00, bez potíží.', 'filling from the plan keeps the notes');

  // ------------------------------------------------------------ 5. a 0.3 record keeps its unknown keys
  await t.seed({ 'veyvo-state': t.ownerState(), [KEY]: { nutritionDistance: '6', nutritionMinutes: '35', nutritionTiming: 'snack', nutritionNotes: 'Banán', checks: { meal: true }, legacyFlag: 'keep-me' } }, 'nutrition');
  t.equal(await t.js("[document.querySelector('[data-key=\"nut-distance:6\"]').getAttribute('aria-checked'), T.need('#nut-minutes').value, T.need('[data-key=\"nut-notes\"]').value, T.need('#nut-check-meal').checked]"), ['true', '35', 'Banán', true], 'a saved 0.3 record (6 km, 35 min, snack) loads');
  await t.exec(`T.click('#nut-check-gear'); await T.sleep(60);`);
  const kept = JSON.parse(await t.js(`localStorage.getItem('${KEY}')`));
  t.equal([kept.legacyFlag, kept.nutritionDistance, kept.checks.gear], ['keep-me', '6', true], 'saving keeps unknown keys and the 6 km choice');

  // ------------------------------------------------------------ 6. Settings replace / Undo / wipe while Před během is open
  // The page must show the stored nutrition afterwards and never write the old object back on the next tap.
  const notesOnPage = () => t.js("T.need('[data-key=\"nut-notes\"]').value");
  const storedNotes = () => t.js(`(JSON.parse(localStorage.getItem('${KEY}') || 'null') || {}).nutritionNotes || null`);
  const openReplace = `const text = VeyvoStore.exportBackup(T.state(), JSON.stringify({ nutritionDistance: '10', nutritionNotes: 'ZE ZALOHY', checks: {} }), { exportedAt: new Date() });
    VeyvoUI.app.dialogs.open('settings', { section: 'data', backupText: text, backupName: 'zaloha.json' });
    await T.wait(() => document.querySelector('dialog[open] [data-key="set-replace"]'), 3000, 'import preview');
    T.click('dialog[open] [data-key="set-replace"]');
    await T.wait(() => T.dialogs() === 2 && T.dialog().querySelector('.btn-danger-solid'), 3000, 'replace confirm');
    T.dialog().querySelector('.btn-danger-solid').click();`;
  // a safety backup that cannot be written: Replace asks again instead of going on silently
  t.ipc.set('backup-snapshot', () => { throw new Error('[write_failed] disk full'); });
  await t.exec(openReplace + `
    await T.wait(() => T.dialogs() === 2 && /Zálohu se nepodařilo uložit/.test(T.text(T.dialog())), 3000, 'safety failed confirm');
    T.dialog().querySelector('.btn-secondary').click();
    await T.wait(() => T.dialogs() === 1, 3000, 'back in settings');`);
  t.equal(await storedNotes(), 'Banán', 'a failed safety backup stops Replace when the runner says no');
  t.ok(!/Záloha obnovena/.test(await t.js('T.toast()')), 'and no "restored" success toast');
  await t.js('T.closeDialogs()');
  t.ipc.reset('backup-snapshot');
  // replace, then Undo from the toast while Settings is still open
  await t.exec(openReplace + `
    await T.wait(() => /Záloha obnovena/.test(T.toast()), 3000, 'replaced');`);
  t.equal(await storedNotes(), 'ZE ZALOHY', 'Replace stores the backup notes');
  t.ok(t.ipc.calls['backup-snapshot'].some(a => a[1] && a[1].kind === 'replace'), 'Replace first saved a separate safety copy ({ kind: replace })');
  await t.js('T.closeDialogs()');
  t.equal(await notesOnPage(), 'ZE ZALOHY', 'the open page shows the replaced notes, not the old ones');
  await t.js('T.toastAction()');
  await t.js(`T.wait(() => (JSON.parse(localStorage.getItem('${KEY}')) || {}).nutritionNotes === 'Banán', 3000, 'undo restores the own notes')`);
  t.equal(await notesOnPage(), 'Banán', 'after Undo the page shows the own notes again');
  await t.exec(`T.click('#nut-check-drink'); await T.sleep(80);`);
  t.equal(await storedNotes(), 'Banán', 'a tap after Undo keeps the own notes (the backup notes are not written back)');
  // wipe everything while the page is open
  await t.exec(`VeyvoUI.app.dialogs.open('settings', { section: 'data' });
    await T.wait(() => document.querySelector('dialog[open] [data-key="set-wipe-start"]'), 3000, 'danger zone');
    T.click('dialog[open] [data-key="set-wipe-start"]');
    await T.wait(() => document.querySelector('dialog[open] [data-key="set-wipe-input"]'), 3000, 'wipe input');
    T.input('dialog[open] [data-key="set-wipe-input"]', 'SMAZAT');
    await T.sleep(40);
    T.click('dialog[open] [data-key="set-wipe-go"]');
    await T.wait(() => T.state().runHistory.length === 0, 3000, 'wiped');`);
  t.equal(await t.js(`localStorage.getItem('${KEY}')`), null, 'the wipe removes the nutrition key');
  t.ok(t.ipc.calls['backup-snapshot'].some(a => a[1] && a[1].kind === 'wipe'), 'the wipe first saved a separate safety copy ({ kind: wipe })');
  await t.js('T.closeDialogs()');
  t.equal(await notesOnPage(), '', 'after the wipe the open page shows no old notes');
  await t.exec(`T.click('#nut-check-meal'); await T.sleep(80);`);
  const afterWipe = JSON.parse(await t.js(`localStorage.getItem('${KEY}')`));
  t.ok(!afterWipe.nutritionNotes && afterWipe.legacyFlag === undefined, 'a tap after the wipe does not write the old nutrition back');
  await t.seed({ 'veyvo-state': t.ownerState(), [KEY]: { nutritionDistance: '6', nutritionMinutes: '35', nutritionTiming: 'snack', nutritionNotes: 'Banán', checks: { meal: true }, legacyFlag: 'keep-me' } }, 'nutrition');

  // ------------------------------------------------------------ 7. English + layouts
  await t.exec(`VeyvoUI.app.setLanguage('en'); await T.sleep(120);`);
  const en = await t.js("document.querySelector('#app').innerText.split('Banán').join('')");
  t.ok(!/[ěščřžůťďň]/i.test(en), 'Před během is fully English after a live switch');
  t.match(en, /Before the run/, 'English title');
  await t.exec(`VeyvoUI.app.setLanguage('cs'); await T.sleep(80);`);
  for (const [w, h] of [[1480, 940], [1120, 720], [412, 915]]) {
    await t.setSize(w, h);
    const sideways = await t.js("document.documentElement.scrollWidth > innerWidth || T.need('#main').scrollWidth > T.need('#main').clientWidth + 1");
    t.ok(!sideways, `no sideways scroll at ${w}×${h}`);
  }

  t.noErrors();
}, { timeout: 120000 });
