/*
 * VeyvoUI.motion - imperative motion helpers (the CSS classes in styles/motion.css cover most cases).
 *
 * Every helper is a no-op that jumps to the final state when motion is suppressed:
 *   - prefers-reduced-motion: reduce
 *   - <html data-motion="off">          (screenshots, tests)
 *   - the element is inside [data-anim="off"] (VeyvoUI.app marks the page container this way when it
 *     re-renders after a data change, so animations play on navigation, not on every save)
 * So page code may call them unconditionally. Transform/opacity only, durations capped at 450 ms.
 *
 *   motion.countUp(el, 1262, { from: 1320, format: s => fmt.duration(s) })  -> Promise
 *   motion.reveal(container)            children rise in, staggered (sets --i, restarts .reveal)
 *   motion.drawLine(svgPathOrGroup)     left-to-right reveal through an animated clip rect
 *   motion.growBars(svg)                re-plays .grow-y bars (e.g. after switching a range tab)
 *   motion.fillBar(el, 0.62)            scaleX fill from 0 (or the current value) to the fraction
 *   motion.pageEnter(el)                page transition (VeyvoUI.app calls this on navigate)
 *   motion.flash(el)                    one-shot highlight (new/edited row); el needs position:relative
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI = root.VeyvoUI || {};
  const MAX = 450;
  const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
  const EASE_IN_OUT = 'cubic-bezier(.65, 0, .35, 1)';
  const mq = typeof root.matchMedia === 'function' ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function prefersReduced() {
    const html = root.document && root.document.documentElement;
    return !!(mq && mq.matches) || !!(html && html.dataset.motion === 'off');
  }
  /** true when animations must not run for this element. */
  function suppressed(el) {
    return prefersReduced() || !!(el && el.closest && el.closest('[data-anim="off"]'));
  }
  const cap = ms => Math.max(0, Math.min(MAX, Number.isFinite(ms) ? ms : MAX));
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const raf = cb => (root.requestAnimationFrame ? root.requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16));

  /**
   * countUp(el, to, { from = 0, duration = 420, delay = 0, format = Math.round }) -> Promise.
   * Writes format(value) into el.textContent each frame; always ends with exactly format(to).
   * Pick `from` so the motion means something (e.g. count a time DOWN from the previous best).
   */
  function countUp(el, to, options) {
    const opts = options || {};
    const format = typeof opts.format === 'function' ? opts.format : (v => String(Math.round(v)));
    if (!el) return Promise.resolve();
    if (el._veyvoCount) { el._veyvoCount.cancelled = true; el._veyvoCount = null; }
    const target = Number(to);
    if (!Number.isFinite(target) || suppressed(el)) { el.textContent = format(target); return Promise.resolve(); }
    const from = Number.isFinite(Number(opts.from)) ? Number(opts.from) : 0;
    const duration = cap(opts.duration === undefined ? 420 : opts.duration);
    const delay = Math.max(0, Number(opts.delay) || 0);
    const job = { cancelled: false };
    el._veyvoCount = job;
    el.textContent = format(from);
    return new Promise(resolve => {
      const begin = () => {
        let start = null;
        const step = now => {
          if (job.cancelled) { resolve(); return; }
          if (start === null) start = now;
          const t = Math.min(1, (now - start) / duration);
          const value = from + (target - from) * easeOutCubic(t);
          el.textContent = t >= 1 ? format(target) : format(value);
          if (t < 1) raf(step); else { if (el._veyvoCount === job) el._veyvoCount = null; resolve(); }
        };
        raf(step);
      };
      if (delay) setTimeout(begin, delay); else begin();
    });
  }

  /**
   * reveal(container, { selector, stagger = 45, start = 0 }) - children (or `selector` matches) get
   * --i and the .reveal class is restarted, so they rise in one after another.
   */
  function reveal(container, options) {
    if (!container) return;
    const opts = options || {};
    const items = opts.selector ? Array.from(container.querySelectorAll(opts.selector)) : Array.from(container.children);
    if (suppressed(container)) { items.forEach(el => el.classList.remove('reveal')); return; }
    if (opts.stagger) container.style.setProperty('--stagger', opts.stagger + 'ms');
    items.forEach((el, i) => {
      el.style.setProperty('--i', String((opts.start || 0) + i));
      el.classList.remove('reveal');
      void el.offsetWidth; // restart the animation
      el.classList.add('reveal');
    });
  }

  /** drawLine(target, { duration, delay }) -> Promise. Clip-rect reveal of an SVG line/group, left to right. */
  function drawLine(target, options) {
    const opts = options || {};
    if (!target || suppressed(target) || typeof target.getBBox !== 'function') return Promise.resolve();
    const svgRoot = target.ownerSVGElement || target;
    let box;
    try { box = target.getBBox(); } catch (e) { box = null; }
    if (!box || !box.width) return Promise.resolve();
    const NS = 'http://www.w3.org/2000/svg';
    const id = 'vdraw-' + Math.random().toString(36).slice(2, 9);
    let defs = svgRoot.querySelector('defs');
    if (!defs) { defs = root.document.createElementNS(NS, 'defs'); svgRoot.insertBefore(defs, svgRoot.firstChild); }
    const clip = root.document.createElementNS(NS, 'clipPath');
    clip.setAttribute('id', id);
    const rect = root.document.createElementNS(NS, 'rect');
    const pad = 8;
    rect.setAttribute('x', box.x - pad); rect.setAttribute('y', box.y - pad);
    rect.setAttribute('width', box.width + pad * 2); rect.setAttribute('height', box.height + pad * 2);
    rect.style.transformBox = 'fill-box';
    rect.style.transformOrigin = '0 50%';
    clip.appendChild(rect);
    defs.appendChild(clip);
    target.setAttribute('clip-path', 'url(#' + id + ')');
    const done = () => { target.removeAttribute('clip-path'); clip.remove(); };
    if (typeof rect.animate !== 'function') { done(); return Promise.resolve(); }
    const anim = rect.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: cap(opts.duration), delay: opts.delay || 0, easing: EASE_IN_OUT, fill: 'both' });
    return anim.finished.then(done, done);
  }

  /** growBars(scope, { selector = '.grow-y', stagger = 40 }) - re-plays bar growth (WAAPI, transform only). */
  function growBars(scope, options) {
    if (!scope || suppressed(scope)) return;
    const opts = options || {};
    const bars = Array.from(scope.querySelectorAll(opts.selector || '.grow-y'));
    bars.forEach((bar, i) => {
      if (typeof bar.animate !== 'function') return;
      bar.style.transformBox = 'fill-box';
      bar.style.transformOrigin = '50% 100%';
      bar.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: MAX, delay: i * (opts.stagger || 40), easing: EASE_OUT, fill: 'backwards' });
    });
  }

  /** fillBar(el, fraction, { delay, from }) - progress fill along x; el should be the .bar-fill. */
  function fillBar(el, fraction, options) {
    if (!el) return;
    const opts = options || {};
    const f = Math.max(0, Math.min(1, Number(fraction) || 0));
    el.style.transformOrigin = '0 50%';
    el.style.setProperty('--f', String(f));
    el.style.transform = 'scaleX(' + f + ')';
    if (suppressed(el) || typeof el.animate !== 'function') return;
    const from = Math.max(0, Math.min(1, Number(opts.from) || 0));
    el.animate([{ transform: 'scaleX(' + from + ')' }, { transform: 'scaleX(' + f + ')' }], { duration: MAX, delay: opts.delay || 0, easing: EASE_OUT, fill: 'backwards' });
  }

  /** pageEnter(el) - opacity + small rise (260 ms). */
  function pageEnter(el) {
    if (!el || suppressed(el) || typeof el.animate !== 'function') return;
    el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT });
  }

  /** flash(el) - one-shot highlight overlay (row or card that just changed). */
  function flash(el) {
    if (!el || suppressed(el)) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 900);
  }

  UI.motion = { prefersReduced, suppressed, countUp, reveal, stagger: reveal, drawLine, growBars, fillBar, pageEnter, flash, MAX_MS: MAX };
})(globalThis);
