/*
 * ui/onboarding.js - first-run guide (dialog 'onboarding'), concept A "Track".
 *
 * VeyvoUI.app opens it on start when profile.onboarded is false and there are no runs; Settings ›
 * Data opens it again after "Smazat všechna data". Three short steps with a lane-style progress bar:
 *   1. Jak ti říkat + cíl   name (<= 40), goal distance, target time (prefilled 5 km / 20:00 from the
 *                           default profile) with a live goal-pace tile; at the bottom the health notice
 *                           ("not a medical device", required by both app stores) and the privacy policy
 *                           link (VeyvoUI.settings.PRIVACY_URL via VeyvoPlatform.openExternal)
 *   2. Kdy můžeš běhat      square day toggles Po–Ne (profile.days, 0 = Monday)
 *   3. Čím začneš           Zapiš poslední běh (dialog runLog) / Připojit Stravu (desktop: Settings ›
 *                           Propojení with the connect form open) / Obnovit ze zálohy (file picker ->
 *                           VeyvoStore.parseBackup -> Settings › Data import preview)
 * Every "Další" saves its step with VeyvoStore.setProfile; closing the guide in any way sets
 * profile.onboarded = true (and keeps a valid name/goal typed on the current step), so it never nags.
 *
 * Texts: i18n namespace 'onboarding' (cs + en). CSS: styles/pages/onboarding.css (prefix onb-).
 * Parsing helpers come from VeyvoUI.settings (ui/settings.js loads first).
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI;
  const app = UI.app;
  const I18n = root.VeyvoI18n, Store = root.VeyvoStore, Format = root.VeyvoFormat;
  const h = UI.dom.h, fmt = UI.fmt, icons = UI.icons, motion = UI.motion;
  const S = () => UI.settings;

  // ================================================================ texts (namespace 'onboarding')
  const MESSAGES = {
    cs: {
      eyebrow: 'Vítej ve VEYVO',
      progress: 'Postup úvodního nastavení',
      stepOf: 'Krok {n} ze {total}',
      steps: { goal: 'Cíl', days: 'Dny', start: 'Začátek' },
      goal: {
        title: 'Jak ti říkat a kam míříš',
        lead: 'Podle cíle VEYVO ukazuje, kolik ti do něj chybí. Změníš ho kdykoli v Nastavení.'
      },
      days: {
        title: 'Kdy můžeš běhat',
        lead: 'Další běh VEYVO naplánuje jen na vybrané dny. I ty změníš v Nastavení.'
      },
      start: {
        title: 'Čím začneš',
        lead: 'VEYVO počítá všechno z tvých běhů. Vyber, odkud je vezme.'
      },
      option: {
        log: 'Zapiš poslední běh',
        logText: 'Datum, vzdálenost a čas. Zabere to chvilku.',
        strava: 'Připojit Stravu',
        stravaText: 'Načte tvoje běhy za posledních 45 dní.',
        restore: 'Obnovit ze zálohy',
        restoreText: 'Soubor zálohy VEYVO (.json), třeba z počítače.'
      },
      pace: 'Cílové tempo',
      paceNone: 'bez cílového času',
      speed: '{speed} km/h',
      health: 'VEYVO není zdravotnický prostředek. Rady v aplikaci jsou obecné, při zdravotních potížích se poraď s lékařem.',
      restoreFailed: 'Zálohu se nepodařilo načíst: {message}',
      done: 'Hotovo'
    },
    en: {
      eyebrow: 'Welcome to VEYVO',
      progress: 'Setup progress',
      stepOf: 'Step {n} of {total}',
      steps: { goal: 'Goal', days: 'Days', start: 'Start' },
      goal: {
        title: 'What to call you and where you are heading',
        lead: 'VEYVO uses your goal to show how far you are from it. You can change it any time in Settings.'
      },
      days: {
        title: 'When you can run',
        lead: 'VEYVO plans your next run on the chosen days only. You can change them in Settings too.'
      },
      start: {
        title: 'How you start',
        lead: 'VEYVO works everything out from your runs. Choose where it gets them from.'
      },
      option: {
        log: 'Log your last run',
        logText: 'Date, distance and time. Takes a moment.',
        strava: 'Connect Strava',
        stravaText: 'Imports your runs from the last 45 days.',
        restore: 'Restore from a backup',
        restoreText: 'A VEYVO backup file (.json), for example from your computer.'
      },
      pace: 'Goal pace',
      paceNone: 'no target time',
      speed: '{speed} km/h',
      health: 'VEYVO is not a medical device. Its tips are general guidance; if you have health concerns, talk to a healthcare professional.',
      restoreFailed: 'The backup could not be loaded: {message}',
      done: 'Done'
    }
  };
  I18n.register('onboarding', MESSAGES);
  const t = (key, params) => app.t('onboarding.' + key, params);

  const STEPS = ['goal', 'days', 'start'];
  const icon = (name, size) => icons.get(name, size ? { size } : undefined);

  let current = null;   // the open guide: { handle, step, dir, draft, errors, ... }

  // ================================================================ rendering
  function focusKey(key) {
    if (!current) return;
    const el = current.handle && current.handle.el.querySelector('[data-key="' + CSS.escape(key) + '"]');
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  function errorText(code) {
    if (I18n.has('settings.profile.error.' + code)) return app.t('settings.profile.error.' + code);
    return app.t('store.error.' + code);
  }

  function progress(st) {
    return h('ol.onb-progress', { 'aria-label': t('progress') }, STEPS.map((k, i) => h('li', {
      class: ['onb-seg', i < st.step ? 'is-done' : null, i === st.step ? 'is-current' : null],
      'aria-current': i === st.step ? 'step' : null
    },
      h('span.onb-seg-bar', { 'aria-hidden': 'true' }, h('span.onb-seg-fill', { style: { '--f': i < st.step ? 1 : i === st.step ? (st.prevStep < st.step || st.first ? 0 : 1) : 0 } })),
      h('span.onb-seg-label', h('span.onb-seg-n.num', String(i + 1)), h('span', t('steps.' + k))))));
  }

  function goalStep(st) {
    const d = st.draft, e = st.errors;
    const name = h('input.input.onb-name', {
      type: 'text', value: d.name, maxlength: 40, autocomplete: 'nickname', spellcheck: 'false',
      placeholder: app.t('settings.profile.namePlaceholder'), dataset: { key: 'onb-name' },
      onInput: ev => { d.name = ev.target.value; if (e.name) { delete e.name; render(); } }
    });
    const dist = app.components.create('segmented', {
      label: app.t('settings.profile.distance'), key: 'onb-dist', value: d.preset,
      options: S().GOAL_PRESETS.map(km => ({ value: String(km), label: fmt.kmUnit(km, { trim: true }) })).concat([{ value: 'custom', label: app.t('settings.profile.custom') }]),
      onChange: v => { d.preset = v; delete e.distance; render(); if (v === 'custom') focusKey('onb-km'); else live(); }
    });
    const km = d.preset === 'custom' ? h('div.affix.onb-km',
      h('input.input.input-num', {
        type: 'text', inputmode: 'decimal', value: d.customKm, autocomplete: 'off', placeholder: Format.number(7.5, { minDecimals: 1, maxDecimals: 1 }),
        'aria-label': app.t('settings.profile.customLabel'), 'aria-invalid': e.distance ? 'true' : null, dataset: { key: 'onb-km' },
        onInput: ev => { d.customKm = ev.target.value; if (e.distance) { delete e.distance; render(); } else live(); }
      }), h('span.affix-suffix', app.t('common.unit.km'))) : null;
    const target = h('input.input.input-num.input-lg.onb-target', {
      type: 'text', inputmode: 'decimal', value: d.target, autocomplete: 'off', spellcheck: 'false',
      placeholder: app.t('settings.profile.targetPlaceholder'), dataset: { key: 'onb-target' },
      onInput: ev => { d.target = ev.target.value; if (e.target) { delete e.target; render(); } else live(); }
    });
    const paceValue = h('span.onb-pace-v.num');
    const paceSub = h('span.onb-pace-s');
    st.pace = { value: paceValue, sub: paceSub };
    return [
      app.components.create('field', { label: app.t('settings.profile.name'), control: name, error: e.name ? errorText(e.name) : null }),
      h('div.field',
        h('span.field-label', app.t('settings.profile.distance')),
        h('div.onb-dist-row', dist, km),
        e.distance ? h('p.field-error', { role: 'alert' }, icon('warning'), h('span', errorText(e.distance))) : null),
      h('div.onb-goal-row',
        app.components.create('field', { label: app.t('settings.profile.target'), control: target, hint: app.t('settings.profile.targetHint'), error: e.target ? errorText(e.target) : null }),
        h('div.onb-pace', { 'aria-live': 'polite' }, h('span.onb-pace-l', t('pace')), paceValue, paceSub)),
      healthNote()
    ];
  }

  /** Step 1 footer: the health notice both stores require, and the privacy policy link. */
  function healthNote() {
    return h('div.onb-health',
      icon('info', 14),
      h('p.onb-health-text', t('health')),
      h('button.btn-link.onb-policy', { type: 'button', dataset: { key: 'onb-privacy' }, onClick: openPrivacyPolicy },
        h('span', app.t('settings.about.privacyPolicy')), icon('external', 14)));
  }
  function openPrivacyPolicy() {
    Promise.resolve().then(() => root.VeyvoPlatform.openExternal(S().PRIVACY_URL))
      .catch(err => app.toast(app.errorText(err), { kind: 'error' }));
  }

  function daysStep(st) {
    const d = st.draft;
    const sum = h('p.onb-days-sum');
    st.daysSum = sum;
    return [
      app.components.create('dayToggles', { label: t('days.title'), key: 'onb-days', value: d.days, onChange: days => { d.days = days; live(); } }),
      sum
    ];
  }

  function startStep(st) {
    const option = (kind, iconName, title, text) => h('button.onb-option', { type: 'button', dataset: { key: 'onb-opt-' + kind }, onClick: () => choose(kind) },
      h('span.onb-option-ico', icon(iconName)),
      h('span.onb-option-main', h('span.onb-option-t', title), h('span.onb-option-d', text)),
      icon('chevron-right', 18));
    const input = h('input.onb-file', {
      type: 'file', accept: '.json,application/json', tabindex: '-1', 'aria-hidden': 'true',
      onChange: ev => { const file = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (file) readBackup(file); }
    });
    st.fileInput = input;
    return [
      h('div.onb-options', { class: st.animate ? 'stagger' : null },
        option('log', 'plus', t('option.log'), t('option.logText')),
        app.strava.supported ? option('strava', 'link', t('option.strava'), t('option.stravaText')) : null,
        option('restore', 'upload', t('option.restore'), t('option.restoreText'))),
      st.error ? h('div.callout.callout-danger.onb-error', { role: 'alert' }, icon('warning'), h('div', st.error)) : null,
      input
    ];
  }

  function render() {
    const st = current;
    if (!st) return;
    const key = STEPS[st.step];
    const body = key === 'goal' ? goalStep(st) : key === 'days' ? daysStep(st) : startStep(st);
    const stepEl = h('div', { class: ['onb-step', 'onb-step-' + key, st.animate ? (st.dir < 0 ? 'onb-in-back' : 'onb-in-next') : null], dataset: { step: key } },
      h('p.onb-lead', t(key + '.lead')),
      h('div.onb-fields', body));
    const focused = root.document.activeElement;
    const focusKeyName = focused && st.root.contains(focused) ? focused.getAttribute('data-key') : null;
    let sel = null;
    try { if (focused && typeof focused.selectionStart === 'number') sel = [focused.selectionStart, focused.selectionEnd]; } catch (e) { sel = null; }
    st.root.replaceChildren(progress(st), stepEl);
    if (focusKeyName && !st.animate) {
      const el = st.root.querySelector('[data-key="' + CSS.escape(focusKeyName) + '"]');
      if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* no caret */ } } }
    }
    // lane fill for the current step grows in after a step change
    const fill = st.root.querySelector('.onb-seg.is-current .onb-seg-fill');
    if (fill) { void fill.offsetWidth; fill.style.setProperty('--f', '1'); }
    paintFoot(st);
    if (st.handle) {
      st.handle.setTitle(t(key + '.title'));
      const eyebrow = st.handle.head.querySelector('.eyebrow');
      if (eyebrow) eyebrow.textContent = t('eyebrow');
    }
    st.animate = false;
    st.first = false;
    st.prevStep = st.step;
    live();
  }

  function paintFoot(st) {
    if (!st.back) return;
    st.back.classList.toggle('is-hidden', st.step === 0);
    st.back.disabled = st.step === 0;
    st.stepText.textContent = t('stepOf', { n: st.step + 1, total: STEPS.length });
    const last = st.step === STEPS.length - 1;
    st.next.className = 'btn ' + (last ? 'btn-secondary' : 'btn-primary');
    st.next.replaceChildren.apply(st.next, [h('span', last ? t('done') : app.t('common.button.next'))].concat(last ? [] : [icon('arrow-right')]));
  }

  /** Live bits: goal pace tile (step 1) and the days summary (step 2). */
  function live() {
    const st = current;
    if (!st) return;
    const d = st.draft;
    if (st.step === 0 && st.pace) {
      const g = S().goalPreview(d, []);
      if (g.pace) {
        const from = st.lastPace;
        st.pace.value.replaceChildren(h('span.onb-pace-num', Format.pace(g.pace)), h('span.unit', fmt.NB + app.t('common.unit.perKm')));
        st.pace.sub.textContent = t('speed', { speed: fmt.number(3600 / g.pace, { decimals: 1 }) });
        if (typeof from === 'number' && Math.abs(from - g.pace) >= 0.5) motion.countUp(st.pace.value.firstChild, g.pace, { from, duration: 260, format: v => Format.pace(v) });
        st.lastPace = g.pace;
      } else {
        st.pace.value.replaceChildren(h('span.onb-pace-num.is-empty', Format.EMPTY));
        st.pace.sub.textContent = t('paceNone');
        st.lastPace = null;
      }
    }
    if (st.step === 1 && st.daysSum) {
      const n = d.days.length;
      st.daysSum.replaceChildren.apply(st.daysSum, [h('b', app.t('settings.profile.daysCount', { n }))].concat(n ? [h('span', ' · ' + d.days.map(i => I18n.t('common.weekdayLong.' + i)).join(', '))] : []));
    }
  }

  // ================================================================ flow
  /** Saves the fields of the current step (and the earlier ones) through VeyvoStore.setProfile. */
  function commit(st, extra) {
    const built = S().profilePatch(st.draft);
    if (!built.ok) return built;
    const patch = Object.assign({}, built.patch, extra || {});
    const r = app.update(s => Store.setProfile(s, patch), { reason: 'onboarding' });
    if (!r.ok) {
      const errors = {};
      (r.errors || []).forEach(code => { errors[{ 'name-too-long': 'name', 'name-invalid': 'name', 'goal-distance-invalid': 'distance', 'target-invalid': 'target', 'days-invalid': 'days' }[code] || 'name'] = code; });
      return { ok: false, errors };
    }
    return { ok: true };
  }

  function go(step) {
    const st = current;
    st.dir = step > st.step ? 1 : -1;
    st.step = step;
    st.error = null;
    st.animate = !motion.prefersReduced();
    render();
    const key = STEPS[step];
    if (key === 'goal') focusKey(app.isPhone() ? 'onb-next' : 'onb-name');
    else if (key === 'days') focusKey('onb-days:' + (st.draft.days[0] || 0));
    else focusKey('onb-opt-log');
  }

  function next() {
    const st = current;
    if (!st) return;
    if (st.step === STEPS.length - 1) { st.handle.close(); return; }
    const r = commit(st);
    if (!r.ok) {
      st.errors = r.errors;
      const first = ['name', 'distance', 'target'].find(f => st.errors[f]);
      if (st.step !== 0 && first) { go(0); st.errors = r.errors; render(); }
      else render();
      focusKey({ name: 'onb-name', distance: st.draft.preset === 'custom' ? 'onb-km' : 'onb-dist:' + st.draft.preset, target: 'onb-target' }[first] || 'onb-next');
      return;
    }
    st.errors = {};
    go(st.step + 1);
  }

  function back() {
    const st = current;
    if (!st || st.step === 0) return;
    go(st.step - 1);
  }

  function choose(kind) {
    const st = current;
    if (!st) return;
    if (kind === 'restore') { st.fileInput.click(); return; }
    st.after = { kind };
    st.handle.close();
  }

  async function readBackup(file) {
    const st = current;
    if (!st) return;
    let text = null;
    // The same size limit as Settings › Data: a huge file is refused before it is read into memory.
    if (file && Number(file.size) > Store.LIMITS.maxBackupChars) { st.error = t('restoreFailed', { message: app.t('store.error.too-large') }); render(); focusKey('onb-opt-restore'); return; }
    try { text = await file.text(); } catch (err) { st.error = t('restoreFailed', { message: app.errorText(err) }); render(); return; }
    const parsed = Store.parseBackup(text);
    if (!parsed.ok) { st.error = t('restoreFailed', { message: app.t('store.error.' + parsed.error) }); render(); focusKey('onb-opt-restore'); return; }
    st.after = { kind: 'restore', text, name: file.name };
    st.handle.close();
  }

  /** Closing in any way: keep a valid draft, mark the guide as done, then run the chosen start. */
  function finish(st) {
    const s = app.state();
    const built = S().profilePatch(st.draft);
    const patch = built.ok ? Object.assign({}, built.patch, { onboarded: true }) : { onboarded: true };
    if (!s.profile.onboarded || built.ok) app.update(x => Store.setProfile(x, patch), { reason: 'onboarding' });
    const after = st.after;
    if (!after) return;
    setTimeout(() => {
      if (after.kind === 'log') app.dialogs.open(app.dialogs.has('runLog') ? 'runLog' : 'run', { mode: 'new' });
      else if (after.kind === 'strava') app.dialogs.open('settings', { section: 'connections', connect: true });
      else if (after.kind === 'restore') app.dialogs.open('settings', { section: 'data', backupText: after.text, backupName: after.name });
    }, 40);
  }

  function open() {
    if (current && current.handle && current.handle.isOpen()) return current.handle;
    const profile = app.state().profile;
    const draft = S().draftFromProfile(profile);
    if (!draft.target && profile.goalDistanceKm === 5 && !profile.onboarded) draft.target = Format.duration(1200);
    const st = current = {
      handle: null, step: 0, prevStep: 0, dir: 1, draft, errors: {}, error: null, after: null,
      animate: false, first: true, lastPace: null, pace: null, daysSum: null, fileInput: null
    };
    st.root = h('div.onb');
    st.back = h('button.btn.btn-ghost.onb-back', { type: 'button', dataset: { key: 'onb-back' }, onClick: back }, icon('arrow-left'), h('span', app.t('common.button.back')));
    st.stepText = h('span.onb-steptext.num', { 'aria-hidden': 'true' });
    st.next = h('button.btn.btn-primary.onb-next', { type: 'button', dataset: { key: 'onb-next' }, onClick: next });
    render();
    st.root.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && st.step === 0 && ev.target && ev.target.matches && ev.target.matches('input')) { ev.preventDefault(); next(); }
    });
    st.handle = app.dialogs.create({
      title: t('goal.title'), eyebrow: t('eyebrow'), kind: 'modal', size: 'md', className: 'onb-dlg dlg-full',
      body: st.root, actions: [st.back, st.stepText, st.next],
      initialFocus: app.isPhone() ? '.dlg-panel' : '[data-key="onb-name"]',
      onClose: () => { const done = current; current = null; if (done) finish(done); }
    });
    const offLang = app.on('language', () => {
      if (!current) { offLang(); return; }
      current.back.replaceChildren(icon('arrow-left'), h('span', app.t('common.button.back')));
      render();
    });
    paintFoot(st);
    return st.handle;
  }

  app.dialogs.register('onboarding', { open });

  UI.onboarding = { STEPS, MESSAGES, readBackup };
})(globalThis);
