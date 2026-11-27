/*
 * ui/recovery.js - the inline 3-tap recovery check-in (concept D graft on concept A "Track").
 *
 *   component 'recoveryCheckin'  props { date = today, variant: 'inline' | 'dialog', key, headingLevel = 2 }
 *   dialog    'recovery'         params { date? }   the same check-in in a small modal / bottom sheet
 *
 * Sleep stepper (-/+ 0,5 h, tap to type), fatigue 1-10 and muscle soreness 0-10 as square tap rows
 * on desktop; on a phone (<= 760 px) they become full-width 10-segment meters you tap or drag
 * (one 44 px target each), soreness with its own "Žádná" (0) button. Every tap autosaves through
 * app.update(VeyvoStore.upsertRecovery) after a short debounce and a small "Uloženo" tick pops.
 * Once today is logged the check-in collapses to one strip ("Zapsáno · Upravit"). Fatigue >= 8 or
 * soreness >= 7 shows "Dnes dej přednost odpočinku" - the same rule as derived.recoveryAdvice, so
 * the next-run card never contradicts it. There is no required field and no form submission, so
 * the dialog's close button always closes (the 0.3 "x does not close" bug cannot return).
 *
 * Texts: i18n namespace 'recovery' (cs + en). CSS: styles/pages/recovery.css (prefix rec-).
 * Pure helpers for tests: VeyvoUI.recovery.{ verdict, merge }.
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI;
  const app = UI.app;
  const I18n = root.VeyvoI18n;
  const Store = root.VeyvoStore;
  const Runs = root.VeyvoRuns;
  const Format = root.VeyvoFormat;
  const dom = UI.dom, h = dom.h, fmt = UI.fmt, icons = UI.icons, motion = UI.motion, charts = UI.charts;
  const doc = root.document;

  const SAVE_DELAY = 550;     // ms after the last tap
  const SAVED_SHOW = 2600;    // how long the "Uloženo" tick stays
  const FIELDS = ['sleepHours', 'fatigue', 'soreness'];

  // ================================================================ texts (namespace 'recovery')
  const MESSAGES = {
    cs: {
      title: 'Regenerace dnes',
      titleDate: 'Regenerace {date}',
      dialogTitle: 'Regenerace',
      ask: 'Jak se dnes cítíš?',
      askDate: 'Spánek, únava a bolest svalů za tento den.',
      autosave: 'Ukládá se samo po každém ťuknutí.',
      fatigueLow: 'minimální',
      fatigueHigh: 'maximální',
      sorenessLow: 'žádná',
      sorenessHigh: 'silná',
      none: 'Žádná',
      noneAria: 'Bolest svalů 0, žádná',
      outOf: '/10',
      valueOf: '{n} z 10',
      notSet: 'nezapsáno',
      saved: 'Uloženo',
      logged: 'Zapsáno',
      edit: 'Upravit',
      editAria: 'Upravit regeneraci',
      done: 'Hotovo',
      verdict: 'Dnes dej přednost odpočinku.',
      reasonFatigue: 'Únava {n}/10',
      reasonSoreness: 'bolest svalů {n}/10',
      reasonSorenessFirst: 'Bolest svalů {n}/10',
      sleepAria: 'Spánek v hodinách',
      sliderHint: 'Ťukni nebo táhni',
      error: 'Regeneraci se nepodařilo uložit: {message}'
    },
    en: {
      title: 'Recovery today',
      titleDate: 'Recovery {date}',
      dialogTitle: 'Recovery',
      ask: 'How do you feel today?',
      askDate: 'Sleep, fatigue and muscle soreness for this day.',
      autosave: 'Saves itself after every tap.',
      fatigueLow: 'minimal',
      fatigueHigh: 'maximal',
      sorenessLow: 'none',
      sorenessHigh: 'severe',
      none: 'None',
      noneAria: 'Muscle soreness 0, none',
      outOf: '/10',
      valueOf: '{n} of 10',
      notSet: 'not logged',
      saved: 'Saved',
      logged: 'Logged',
      edit: 'Edit',
      editAria: 'Edit recovery',
      done: 'Done',
      verdict: 'Put rest first today.',
      reasonFatigue: 'Fatigue {n}/10',
      reasonSoreness: 'muscle soreness {n}/10',
      reasonSorenessFirst: 'Muscle soreness {n}/10',
      sleepAria: 'Sleep in hours',
      sliderHint: 'Tap or drag',
      error: 'Recovery could not be saved: {message}'
    }
  };
  I18n.register('recovery', MESSAGES);
  const t = (key, params) => app.t('recovery.' + key, params);
  const tc = (key, params) => app.t('common.' + key, params);

  // ================================================================ pure helpers
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  /** Same rule as app.derived().recoveryAdvice (0.3 journal.js): fatigue >= 8 or soreness >= 7. */
  function verdict(values) {
    const v = values || {};
    const fatigue = isNum(v.fatigue) && v.fatigue >= 8 ? v.fatigue : null;
    const soreness = isNum(v.soreness) && v.soreness >= 7 ? v.soreness : null;
    return fatigue !== null || soreness !== null ? { code: 'rest', fatigue, soreness } : null;
  }
  /** Logged values overlaid with not-yet-saved taps (a field set to null in `pending` is cleared). */
  function merge(log, pendingFields) {
    const out = {};
    const p = pendingFields || {};
    FIELDS.forEach(f => {
      if (Object.prototype.hasOwnProperty.call(p, f)) out[f] = p[f];
      else out[f] = log && isNum(log[f]) ? log[f] : null;
    });
    return out;
  }

  // ================================================================ session state (per app run)
  const pending = new Map();      // date -> { field: value } waiting for the debounced save
  const editing = new Set();      // dates opened for editing (stay expanded after a save)
  let saveTimer = null;
  let savedAt = 0, savedDate = null;
  let lastError = null;
  let animateDate = null;         // the next build of this date plays the expand/collapse motion
  let hideTimer = null;

  function logFor(date) {
    const s = app.state();
    return (s && s.recoveryLogs || []).find(l => l.date === date) || null;
  }
  function valuesFor(date) { return merge(logFor(date), pending.get(date)); }
  /** Last logged sleep before this date: the stepper starts from it (real data), else 7,5 h. */
  function sleepStart(date) {
    const logs = (app.state().recoveryLogs || []).filter(l => l.date < date && isNum(l.sleepHours));
    return logs.length ? logs[logs.length - 1].sleepHours : 7.5;
  }

  function setValue(date, field, value, rootEl) {
    const p = Object.assign({}, pending.get(date) || {});
    p[field] = value;
    pending.set(date, p);
    editing.add(date);
    lastError = null;
    if (rootEl) paintLive(rootEl);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY);
  }

  /** Saves every pending date now (also on navigation, "Hotovo" and dialog close). */
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!pending.size || !app.isReady()) return;
    const started = Date.now();
    const today = app.today();
    for (const [date, fields] of Array.from(pending.entries())) {
      pending.delete(date);
      const next = merge(logFor(date), fields);
      const empty = FIELDS.every(f => next[f] === null);
      const before = { at: savedAt, date: savedDate };
      savedAt = Date.now();
      savedDate = date;
      let r;
      if (empty) r = logFor(date) ? app.update(s => Store.deleteRecovery(s, date), { reason: 'recovery' }) : { ok: true };
      else r = app.update(s => Store.upsertRecovery(s, Object.assign({ date }, fields), { today }), { reason: 'recovery' });
      if (!r.ok) {
        savedAt = before.at;
        savedDate = before.date;
        lastError = t('error', { message: (r.errors || []).map(c => (I18n.has('store.error.' + c) ? app.t('store.error.' + c) : c)).join(' ') || app.t('ui.errors.unknown') });
      }
    }
    announce(lastError || t('saved'));
    // Instances that the page re-render did not replace (e.g. inside the dialog) refresh themselves.
    doc.querySelectorAll('[data-rec-root]').forEach(el => { if ((el._recBuiltAt || 0) < started) refreshInPlace(el); });
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      doc.querySelectorAll('[data-rec-root] .rec-status.is-saved').forEach(el => {
        el.classList.remove('is-saved');
        const label = el.querySelector('.rec-status-t');
        if (label) label.textContent = t('logged');
      });
    }, SAVED_SHOW);
  }

  app.on('navigate', () => { flush(); editing.clear(); });
  // The last tap must not wait for the timer when the window closes, the app quits for an update or
  // Android sends the WebView to the background (it may be killed there). Saving is synchronous.
  if (root && typeof root.addEventListener === 'function') root.addEventListener('pagehide', flush);
  if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', () => { if (doc.hidden) flush(); });

  /** The visible status is rebuilt on every save, so screen readers hear a persistent live region
   *  (inside the top dialog when one is open, because everything else is inert then). */
  function announce(text) {
    const top = app.dialogs.top();
    const host = top && top.el ? top.el : doc.body;
    let region = host.querySelector(':scope > .rec-live');
    if (!region) { region = h('div.sr-only.rec-live', { role: 'status', 'aria-live': 'polite' }); host.append(region); }
    region.textContent = '';
    setTimeout(() => { region.textContent = text; }, 60);
  }

  // ================================================================ building blocks
  function heading(level, attrs, text) { return h('h' + (level === 3 ? 3 : 2), attrs, text); }

  function statusNode(date, logged) {
    const fresh = savedDate === date && Date.now() - savedAt < SAVED_SHOW;
    const node = h('span', { class: ['rec-status', fresh ? 'is-saved' : null, fresh && Date.now() - savedAt < 600 ? 'is-fresh' : null] },
      h('span.rec-tick', { 'aria-hidden': 'true' }, icons.get('check', { size: 12 })),
      h('span.rec-status-t', fresh ? t('saved') : logged ? t('logged') : ''));
    if (!fresh && !logged) node.hidden = true;
    return node;
  }

  function verdictNode(values) {
    const v = verdict(values);
    const el = h('p.rec-verdict', { role: 'status' });
    fillVerdict(el, v);
    return el;
  }
  function fillVerdict(el, v) {
    if (!v) { el.hidden = true; el.replaceChildren(); el._key = ''; return; }
    const parts = [];
    if (v.fatigue !== null) parts.push(t('reasonFatigue', { n: v.fatigue }));
    if (v.soreness !== null) parts.push(parts.length ? t('reasonSoreness', { n: v.soreness }) : t('reasonSorenessFirst', { n: v.soreness }));
    const key = parts.join('|');
    const wasHidden = el.hidden;
    el.hidden = false;
    if (el._key === key) return;
    el._key = key;
    dom.mount(el, icons.get('warning', { size: 16 }), h('b', t('verdict')), h('span', fmt.typo(parts.join(', ') + '.')));
    if (wasHidden && el.isConnected && !motion.prefersReduced() && typeof el.animate === 'function') {
      el.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  }

  function readout(value) {
    return h('span.num.rec-v', isNum(value) ? String(value) : '–', h('small', t('outOf')));
  }
  function paintReadout(el, value) {
    if (!el) return;
    el.firstChild.textContent = isNum(value) ? String(value) : '–';
    el.classList.toggle('is-empty', !isNum(value));
  }

  /**
   * Phone: a full-width 10-segment meter (role="slider") you tap or drag; arrows, Home/End and
   * PageUp/PageDown work from the keyboard. onInput while dragging, onChange on release / key.
   */
  function segSlider(o) {
    const min = o.min, max = o.max;
    const n = max - min + 1;
    let value = isNum(o.value) && o.value >= min ? o.value : null;
    const cells = [];
    for (let i = 0; i < n; i++) cells.push(h('i', { style: { '--i': i } }));
    const el = h('div.rec-seg', {
      role: 'slider', tabindex: '0', 'aria-label': o.label, 'aria-valuemin': String(min), 'aria-valuemax': String(max),
      'data-key': o.key, title: t('sliderHint')
    }, h('span.rec-seg-cells', cells));
    function paint() {
      cells.forEach((c, i) => { c.classList.toggle('on', value !== null && min + i <= value); c.classList.toggle('is-cur', value !== null && min + i === value); });
      if (value === null) { el.removeAttribute('aria-valuenow'); el.setAttribute('aria-valuetext', t('notSet')); }
      else { el.setAttribute('aria-valuenow', String(value)); el.setAttribute('aria-valuetext', t('valueOf', { n: value })); }
    }
    function set(v, commit) {
      const next = Math.max(min, Math.min(max, v));
      const changedValue = next !== value;
      value = next;
      if (changedValue) { paint(); if (o.onInput) o.onInput(value); }
      if (commit && (changedValue || o.commitSame)) o.onChange(value);
    }
    function fromX(x) {
      const r = el.getBoundingClientRect();
      const f = r.width ? (x - r.left) / r.width : 0;
      return min + Math.max(0, Math.min(n - 1, Math.floor(f * n)));
    }
    // A tap sets the value on release; a horizontal drag scrubs live. A vertical swipe scrolls the
    // page (touch-action: pan-y) and its pointercancel restores the previous value.
    let dragging = false, moved = false, startValue = null, startX = 0;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      dragging = true; moved = false;
      startValue = value; startX = e.clientX;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    });
    el.addEventListener('pointermove', e => {
      if (!dragging) return;
      if (!moved && Math.abs(e.clientX - startX) < 4) return;
      moved = true;
      set(fromX(e.clientX), false);
    });
    el.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      set(fromX(e.clientX), false);
      if (value !== startValue && value !== null) o.onChange(value);
    });
    el.addEventListener('pointercancel', () => {
      if (!dragging) return;
      dragging = false;
      if (value !== startValue) { value = startValue; paint(); if (o.onInput) o.onInput(value); }
    });
    el.addEventListener('keydown', e => {
      const base = value === null ? min - 1 : value;
      const map = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 3, PageDown: -3 };
      let next = null;
      if (map[e.key]) next = base + map[e.key];
      else if (e.key === 'Home') next = min;
      else if (e.key === 'End') next = max;
      if (next === null) return;
      e.preventDefault();
      set(Math.max(min, next), true);
    });
    paint();
    el.setValue = v => { value = isNum(v) && v >= min ? v : null; paint(); };
    return el;
  }

  // ================================================================ the check-in
  function build(props) {
    const p = Object.assign({ variant: 'inline', key: 'rec', headingLevel: 2 }, props || {});
    const today = app.today();
    const date = Runs.isDateKey(p.date) && p.date <= today ? p.date : today;
    const isToday = date === today;
    const log = logFor(date);
    const logged = !!log;
    const values = valuesFor(date);
    const phone = app.isPhone();
    const inDialog = p.variant === 'dialog';
    const open = inDialog || !logged || editing.has(date);
    const animate = animateDate === date;
    if (animate) animateDate = null;
    const titleId = dom.uid('rec-t');
    const key = p.key;

    const rootEl = h('section', {
      class: ['rec', open ? 'is-open' : 'is-closed', phone ? 'is-phone' : null, inDialog ? 'rec-in-dialog' : null, animate ? 'rec-anim' : null],
      'data-rec-root': '', 'aria-labelledby': inDialog ? null : titleId
    });
    rootEl._recProps = Object.assign({}, p, { date });
    rootEl._recBuiltAt = Date.now();

    const title = isToday ? t('title') : t('titleDate', { date: fmt.date(date, 'short') });
    const status = statusNode(date, logged);
    const end = h('div.rec-end', inDialog ? null : status);
    if (!open) {
      end.append(h('button.btn.btn-ghost.btn-sm.rec-edit', {
        type: 'button', 'data-key': key + '-edit', 'aria-label': t('editAria'),
        onClick: () => { editing.add(date); animateDate = date; const next = refreshInPlace(rootEl); focusFirst(next); }
      }, icons.get('edit'), t('edit')));
    } else if (logged && !inDialog) {
      end.append(h('button.btn.btn-secondary.btn-sm.rec-done', {
        type: 'button', 'data-key': key + '-done',
        onClick: () => { flush(); editing.delete(date); animateDate = date; const next = refreshInPlace(rootEl); const b = next && next.querySelector('.rec-edit'); if (b) b.focus({ preventScroll: true }); }
      }, t('done')));
    }
    const head = h('div.rec-head',
      inDialog ? null : heading(p.headingLevel, { class: 'eyebrow rec-title', id: titleId }, title),
      open && !inDialog ? h('span.rec-ask', isToday ? t('ask') : t('askDate')) : null,
      end);
    rootEl.append(head);

    if (!open) {
      rootEl.append(summaryStrip(values));
    } else {
      rootEl.append(editor(rootEl, date, values, key, phone));
      if (inDialog || !logged) rootEl.append(h('div.rec-foot', h('p.rec-hint', icons.get('check', { size: 13 }), t('autosave')), inDialog ? status : null));
    }
    rootEl.append(verdictNode(values));
    const err = h('p.rec-error', { role: 'alert', hidden: !lastError }, lastError ? [icons.get('warning', { size: 15 }), h('span', lastError)] : null);
    rootEl.append(err);
    return rootEl;
  }

  function summaryStrip(v) {
    const item = (label, valueNode) => h('div.rec-item', h('span.rec-l', label), valueNode);
    const scaleVal = (n, label) => h('span.rec-sum', charts.meter(isNum(n) ? n : 0, 10, { label: label + ' ' + (isNum(n) ? t('valueOf', { n }) : t('notSet')) }), readout(n));
    return h('div.rec-strip',
      item(tc('field.sleep'), h('span.num.rec-v', isNum(v.sleepHours) ? Format.number(v.sleepHours, { maxDecimals: 1 }) : '–', h('small', ' ' + I18n.t('common.unit.h')))),
      item(tc('field.fatigue'), scaleVal(v.fatigue, tc('field.fatigue'))),
      item(tc('field.soreness'), scaleVal(v.soreness, tc('field.soreness'))));
  }

  function editor(rootEl, date, v, key, phone) {
    const sleepId = dom.uid('rec-sleep');
    const stepper = app.components.create('stepper', {
      value: v.sleepHours, min: 0, max: 24, step: 0.5, decimals: 1, unit: I18n.t('common.unit.h'), start: sleepStart(date),
      label: t('sleepAria'), id: sleepId, key: key + '-sleep',
      onChange: val => setValue(date, 'sleepHours', val, rootEl)
    });
    stepper.classList.add('rec-stepper');
    if (stepper.input) stepper.input.placeholder = Format.number(sleepStart(date), { minDecimals: 1, maxDecimals: 1 });
    const sleep = h('div.rec-item.rec-sleep', h('label.rec-l', { for: sleepId }, tc('field.sleep')), stepper);

    const fatigueRead = readout(v.fatigue);
    const sorenessRead = readout(v.soreness);
    fatigueRead.classList.add('rec-read-fatigue');
    sorenessRead.classList.add('rec-read-soreness');
    paintReadout(fatigueRead, v.fatigue);
    paintReadout(sorenessRead, v.soreness);
    const fLabelId = dom.uid('rec-f'), sLabelId = dom.uid('rec-s');
    let fatigueControl, sorenessControl;
    if (!phone) {
      fatigueControl = app.components.create('scale', {
        min: 1, max: 10, value: v.fatigue, fill: true, key: key + '-fatigue', label: tc('field.fatigue'),
        lowLabel: t('fatigueLow'), highLabel: t('fatigueHigh'),
        onChange: val => { paintReadout(fatigueRead, val); setValue(date, 'fatigue', val, rootEl); }
      });
      sorenessControl = app.components.create('scale', {
        min: 0, max: 10, value: v.soreness, fill: true, key: key + '-soreness', label: tc('field.soreness'),
        lowLabel: t('sorenessLow'), highLabel: t('sorenessHigh'),
        onChange: val => { paintReadout(sorenessRead, val); setValue(date, 'soreness', val, rootEl); }
      });
    } else {
      fatigueControl = h('div.rec-seg-wrap',
        segSlider({ min: 1, max: 10, value: v.fatigue, label: tc('field.fatigue'), key: key + '-fatigue',
          onInput: val => paintReadout(fatigueRead, val), onChange: val => setValue(date, 'fatigue', val, rootEl) }),
        h('div.scale-ends', { 'aria-hidden': 'true' }, h('span', t('fatigueLow')), h('span', t('fatigueHigh'))));
      let slider = null;
      const zero = h('button.rec-zero', {
        type: 'button', 'data-key': key + '-soreness:0', 'aria-pressed': v.soreness === 0 ? 'true' : 'false', 'aria-label': t('noneAria'),
        onClick: () => { zero.setAttribute('aria-pressed', 'true'); slider.setValue(null); paintReadout(sorenessRead, 0); setValue(date, 'soreness', 0, rootEl); }
      }, t('none'));
      slider = segSlider({ min: 1, max: 10, value: v.soreness, label: tc('field.soreness'), key: key + '-soreness',
        onInput: val => {
          const keep = val === null ? valuesFor(date).soreness === 0 : false;
          zero.setAttribute('aria-pressed', keep ? 'true' : 'false');
          paintReadout(sorenessRead, val === null && keep ? 0 : val);
        },
        onChange: val => setValue(date, 'soreness', val, rootEl) });
      sorenessControl = h('div.rec-seg-wrap',
        h('div.rec-seg-row', zero, slider),
        h('div.scale-ends', { 'aria-hidden': 'true' }, h('span'), h('span', t('sorenessHigh'))));
    }
    const fatigue = h('div.rec-item.rec-fatigue', h('div.rec-l-row', h('span.rec-l', { id: fLabelId }, tc('field.fatigue')), fatigueRead), fatigueControl);
    const soreness = h('div.rec-item.rec-soreness', h('div.rec-l-row', h('span.rec-l', { id: sLabelId }, tc('field.soreness')), sorenessRead), sorenessControl);
    return h('div.rec-grid', sleep, fatigue, soreness);
  }

  /** Live repaint between saves: only the verdict line (the controls paint themselves). */
  function paintLive(rootEl) {
    if (!rootEl || !rootEl.isConnected) return;
    const date = rootEl._recProps && rootEl._recProps.date;
    const el = rootEl.querySelector('.rec-verdict');
    if (el) fillVerdict(el, verdict(valuesFor(date)));
    const err = rootEl.querySelector('.rec-error');
    if (err && !lastError) { err.hidden = true; err.replaceChildren(); }
  }

  function focusFirst(el) {
    if (!el) return;
    const target = el.querySelector('.rec-fatigue .scale [tabindex="0"]') || el.querySelector('.rec-fatigue .rec-seg') || el.querySelector('.rec-done');
    if (target) target.focus({ preventScroll: true });
  }

  /** Rebuilds one instance where it stands (keeps keyboard focus by data-key). */
  function refreshInPlace(el) {
    if (!el || !el.isConnected || !el._recProps) return null;
    const active = doc.activeElement;
    const key = active && el.contains(active) ? active.getAttribute('data-key') : null;
    const next = build(el._recProps);
    el.replaceWith(next);
    if (key) {
      const target = next.querySelector('[data-key="' + (root.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
      if (target) target.focus({ preventScroll: true });
    }
    return next;
  }

  app.components.register('recoveryCheckin', props => build(props));

  app.dialogs.register('recovery', {
    open(params) {
      const today = app.today();
      const p = params || {};
      const date = Runs.isDateKey(p.date) && p.date <= today ? p.date : today;
      const body = build({ date, variant: 'dialog', key: 'rec-dlg' });
      const done = h('button.btn.btn-primary', { type: 'button', 'data-key': 'rec-dlg-close' }, tc('button.done'));
      const d = app.dialogs.create({
        title: t('dialogTitle'), eyebrow: date === today ? tc('today') : fmt.date(date, 'long'),
        size: 'sm', kind: 'modal', className: 'rec-dlg', body, actions: [done],
        initialFocus: body.querySelector('.scale [tabindex="0"], .rec-seg') || done,
        onClose: () => flush()
      });
      done.addEventListener('click', () => d.close());
      return d;
    }
  });

  UI.recovery = { verdict, merge, flush };
})(globalThis);
