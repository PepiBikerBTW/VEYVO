/*
 * VeyvoUI.dom + VeyvoUI.fmt - tiny, safe DOM building and Czech/English display typography.
 *
 * Classic script (CSP script-src 'self', no bundler). Never builds HTML from strings: every
 * text goes through textContent, so user data (run notes, names) can never inject markup.
 *
 *   const { h, svg, $, $$, on, mount } = VeyvoUI.dom;
 *   h('button.btn.btn-primary', { type: 'button', onClick: save, 'aria-label': t('x') }, icon, 'Uložit')
 *   h('div', { class: ['card', active && 'is-on'], style: { '--f': .5 }, dataset: { key: 'goal' } }, ...)
 *
 *   VeyvoUI.fmt.kmUnit(5)       -> '5,0 km' (non-breaking space)       fmt.paceUnit(252) -> '4:12 /km'
 *   VeyvoUI.fmt.date(key)       -> 'út 24. 11.' (no line break inside)  fmt.typo(text)    -> NBSP rules
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI = root.VeyvoUI || {};
  const doc = root.document;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const NB = ' ';
  const BOOL_PROPS = { hidden: 1, disabled: 1, checked: 1, selected: 1, readOnly: 1, readonly: 1, required: 1, multiple: 1, open: 1, autofocus: 1, inert: 1 };

  // ---------------------------------------------------------------- element builders

  function classList(value) {
    if (!value) return [];
    if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
    if (Array.isArray(value)) return value.reduce((all, v) => all.concat(classList(v)), []);
    if (typeof value === 'object') return Object.keys(value).filter(k => value[k]);
    return [];
  }

  function setStyle(el, style) {
    if (!style) return;
    if (typeof style === 'string') { el.style.cssText = style; return; }
    for (const key of Object.keys(style)) {
      const v = style[key];
      if (v === null || v === undefined || v === false) continue;
      if (key.startsWith('--') || key.indexOf('-') > 0) el.style.setProperty(key, String(v));
      else el.style[key] = typeof v === 'number' && !/opacity|zIndex|flex|order|lineHeight|fontWeight/.test(key) ? v + 'px' : v;
    }
  }

  function setProp(el, key, value, isSvg) {
    if (value === undefined || value === null || value === false) {
      if (key in BOOL_PROPS && !isSvg) el[key === 'readonly' ? 'readOnly' : key] = false;
      return;
    }
    if (key === 'class' || key === 'className') { classList(value).forEach(c => el.classList.add(c)); return; }
    if (key === 'style') { setStyle(el, value); return; }
    if (key === 'dataset' || key === 'data') { for (const k of Object.keys(value)) if (value[k] !== undefined && value[k] !== null) el.dataset[k] = String(value[k]); return; }
    if (key === 'on') { for (const type of Object.keys(value)) if (typeof value[type] === 'function') el.addEventListener(type, value[type]); return; }
    if (key === 'text') { el.textContent = String(value); return; }
    if (key === 'ref') { if (typeof value === 'function') value(el); return; }
    if (key === 'html' || key === 'innerHTML') throw new Error('VeyvoUI.dom: html is not allowed, build nodes instead');
    if (/^on[A-Z]/.test(key) && typeof value === 'function') { el.addEventListener(key.slice(2).toLowerCase(), value); return; }
    if (!isSvg && (key === 'value' || key in BOOL_PROPS)) { el[key === 'readonly' ? 'readOnly' : key] = key === 'value' ? String(value) : !!value; return; }
    el.setAttribute(key, value === true ? '' : String(value));
  }

  function appendChild(parent, child) {
    if (child === null || child === undefined || child === false || child === true) return;
    if (Array.isArray(child)) { child.forEach(c => appendChild(parent, c)); return; }
    if (typeof child === 'string' || typeof child === 'number') { parent.appendChild(doc.createTextNode(String(child))); return; }
    if (child && typeof child.nodeType === 'number') parent.appendChild(child);
  }

  function isProps(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && typeof value.nodeType !== 'number';
  }

  /** h('tag.cls1.cls2#id', props?, ...children) -> HTMLElement. */
  function h(spec, props) {
    const parts = String(spec).match(/^([a-z][a-z0-9-]*)?((?:[.#][\w-]+)*)$/i);
    if (!parts) throw new Error('VeyvoUI.dom.h: bad tag "' + spec + '"');
    const el = doc.createElement(parts[1] || 'div');
    (parts[2] || '').replace(/([.#])([\w-]+)/g, (m, kind, name) => { if (kind === '.') el.classList.add(name); else el.id = name; return m; });
    let rest = Array.prototype.slice.call(arguments, 1);
    if (isProps(props)) { for (const key of Object.keys(props)) setProp(el, key, props[key], false); rest = rest.slice(1); }
    appendChild(el, rest);
    return el;
  }

  /** svg('rect', { x: 1, class: 'm-fast' }, ...children) -> SVGElement. */
  function svg(tag, props) {
    const el = doc.createElementNS(SVG_NS, tag);
    let rest = Array.prototype.slice.call(arguments, 1);
    if (isProps(props)) { for (const key of Object.keys(props)) setProp(el, key, props[key], true); rest = rest.slice(1); }
    appendChild(el, rest);
    return el;
  }

  function frag() { const f = doc.createDocumentFragment(); appendChild(f, Array.prototype.slice.call(arguments)); return f; }
  function text(value) { return doc.createTextNode(value === null || value === undefined ? '' : String(value)); }

  // ---------------------------------------------------------------- queries and events

  function $(selector, scope) { return (scope || doc).querySelector(selector); }
  function $$(selector, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(selector)); }

  /**
   * on(target, type, handler, options?) or on(target, type, selector, handler(event, matched), options?)
   * -> off(). The delegated form matches `selector` with closest() inside target.
   */
  function on(target, type, selector, handler, options) {
    let fn, opts;
    if (typeof selector === 'function') { fn = selector; opts = handler; }
    else {
      opts = options;
      fn = function (event) {
        const match = event.target && event.target.closest ? event.target.closest(selector) : null;
        if (match && target.contains(match)) handler.call(match, event, match);
      };
    }
    target.addEventListener(type, fn, opts);
    return () => target.removeEventListener(type, fn, opts);
  }

  function clear(el) { if (el) el.replaceChildren(); return el; }
  /** mount(el, ...children): replace all children of el. */
  function mount(el) { el.replaceChildren(); appendChild(el, Array.prototype.slice.call(arguments, 1)); return el; }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let uidCounter = 0;
  function uid(prefix) { uidCounter += 1; return (prefix || 'v') + '-' + uidCounter.toString(36); }

  function isTyping(event) {
    const el = event && event.target;
    if (!el || !el.closest) return false;
    return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  }

  // ---------------------------------------------------------------- focus

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';
  function focusables(scope) {
    return $$(FOCUSABLE, scope).filter(el => !el.closest('[hidden], [inert]') && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0));
  }

  /**
   * trapFocus(container, { initial, returnFocus }) -> release(). Keeps Tab / Shift+Tab inside the
   * container (for custom overlays; native <dialog>.showModal() already makes the page inert).
   */
  function trapFocus(container, options) {
    const opts = options || {};
    const previous = opts.returnFocus || doc.activeElement;
    function onKey(event) {
      if (event.key !== 'Tab') return;
      const items = focusables(container);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (doc.activeElement === first || !container.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    container.addEventListener('keydown', onKey);
    const initial = typeof opts.initial === 'string' ? $(opts.initial, container) : opts.initial;
    const target = initial || focusables(container)[0];
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    return function release() {
      container.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function' && doc.contains(previous)) previous.focus({ preventScroll: true });
    };
  }

  UI.dom = { h, svg, frag, text, $, $$, on, clear, mount, escapeHtml, uid, isTyping, focusables, trapFocus, SVG_NS, NB };

  // ================================================================ VeyvoUI.fmt (display typography)

  function F() { return root.VeyvoFormat; }
  function I() { return root.VeyvoI18n; }
  function locale() { return I() ? I().getLocale() : (F() ? F().getLocale() : 'cs'); }
  function empty() { return F() ? F().EMPTY : '—'; }
  function withUnit(value, unit) { return value === empty() ? value : value + NB + unit; }

  /**
   * typo(text, locale?) - Czech typography for any visible string:
   *  - a number and the word/unit after it never split: '5 km', '3 dny', '62 s', '4:12 /km', '20 %';
   *  - Czech one-letter prepositions/conjunctions stick to the next word: 'v neděli', 'k cíli', 'a', 'i';
   *  - day + month in dates stay together: '24. 11.', '24. listopadu'.
   * Applied automatically by VeyvoUI.app.t(); call it yourself for strings you assemble.
   */
  function typo(value, loc) {
    if (value === null || value === undefined) return '';
    let s = String(value);
    // A number keeps the unit/word after it ('5,0 km', '24. 11.'); a separator must sit between digits,
    // so '21:02, zpět' keeps its normal space after the comma.
    s = s.replace(/(\d+(?:[.,:]\d+)*\.?) (?=[\p{L}\/%°×]|\d+\.)/gu, '$1' + NB);
    if ((loc || locale()) === 'cs') s = s.replace(/(?<=^|[\s(\u201e"'\u00a0])(?<!\d[\s\u00a0])([ksvzouaiKSVZOUAI]) (?=\S)/g, '$1' + NB);
    return s;
  }

  const fmt = {
    NB,
    typo,
    number(n, opts) { return F().number(n, opts); },
    /** '5,0' (1 decimal; trim: true -> '5') */
    km(n, opts) { return F().km(n, Object.assign({ decimals: 1 }, opts || {})); },
    /** '5,0 km' with a non-breaking space */
    kmUnit(n, opts) { return withUnit(fmt.km(n, opts), 'km'); },
    /** '21:02', '1:09:40' */
    duration(s, opts) { return F().duration(s, opts); },
    /** '5 h 40 min' */
    durationWords(s, opts) { return typo(F().durationWords(s, opts)); },
    /** '4:12' */
    pace(secPerKm) { return F().pace(secPerKm); },
    /** '4:12 /km' */
    paceUnit(secPerKm) { return withUnit(F().pace(secPerKm), '/km'); },
    /** '62 s' / '−28 s' (signed: true adds '+' for positives) */
    seconds(n, opts) { return withUnit(F().number(Math.round(n), Object.assign({ grouping: false }, opts || {})), 's'); },
    /** '7,2 h' */
    hours(n) { return withUnit(F().number(n, { maxDecimals: 1 }), 'h'); },
    /** date('2026-11-24') -> 'út 24. 11.'; styles from VeyvoFormat.DATE_STYLES; never breaks inside. */
    date(key, style, opts) {
      const s = F().date(key, style, opts);
      const short = !style || /^(short|dayMonth|dayMonthYear|weekday|monthShort|iso)$/.test(style);
      return short ? s.replace(/ /g, NB) : typo(s);
    },
    /** 'dnes', 'zítra', 'za 3 dny', 'před 2 dny' */
    relDay(key, todayKey, opts) { return typo(F().relativeDay(key, todayKey, opts)); },
    /** '23.–29. 11.' */
    weekRange(start, end, opts) { return F().weekRange(start, end, opts).replace(/ /g, NB); },
    /** plural via i18n: fmt.count('common.count.runs', 3) -> '3 běhy' */
    count(key, n) { return typo(I().t(key, { n })); },
    /** profile goal label: '5 km pod 20:00' / '5 km under 20:00' (or just '10 km' without target) */
    goal(profile) {
      const p = profile || {};
      if (!I()) return '';
      const distance = F().km(p.goalDistanceKm || 5, { trim: true });
      if (!p.targetSeconds) return typo(I().t('ui.goalDistance', { distance }));
      return typo(I().t('ui.goal', { distance, time: F().duration(p.targetSeconds) }));
    },
    locale
  };
  UI.fmt = fmt;

  /** dom.val(value, unit, { cls }) -> <span class="num">5,0<span class="unit"> km</span></span> */
  UI.dom.val = function val(value, unit, options) {
    const opts = options || {};
    return h('span', { class: ['num', opts.cls] }, String(value), unit ? h('span.unit', NB + unit) : null);
  };
})(globalThis);
