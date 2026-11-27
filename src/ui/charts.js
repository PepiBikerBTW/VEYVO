/*
 * VeyvoUI.charts - pure SVG chart builders from real run data (no invented numbers).
 *
 * Every builder returns a <div class="vchart"> holding one <svg role="img"> with <title>/<desc>,
 * renders at `width` px (text stays crisp) and scales down with CSS when the box is narrower.
 * Prefer charts.mount(host, opts => charts.weeklyVolume(weeks, opts)): it measures the host,
 * re-renders on resize (without replaying animations) and passes { width, animate }.
 *
 *   weeklyVolume(weeks, { planned, height, stackedByType, showCounts, currentLabel })
 *       weeks = VeyvoRuns.weeklyTotals(...) (oldest -> newest). planned = km still planned this week.
 *   paceChart(runs, { goalPace, range: '4w' | '3m' | 'all', today, bestRunId, height })
 *       pace per run, y inverted (faster = higher), dashed goal line, labelled 5 km results,
 *       hover/keyboard tooltip (arrow keys move between runs).
 *   goalLanes(goalProgress, { width })      the Track lane board (previous vs current best).
 *   meter(value, max = 10, { variant, size, label, animate })   10-segment meter (HTML)
 *   sparkline(values, { width, height, area, invert })
 *   legend({ groups, goal, plan })         HTML legend for the shared series encoding
 *   groupOf(type) -> 'fast' | 'quality' | 'easy'    (run/test5k/race, intervals/tempo, easy/long)
 *
 * Motion hooks: bars .grow-y, lane fills .grow-x, lines draw in through a clip rect (.draw-line),
 * points .pop - all CSS, all disabled by reduced motion or [data-anim="off"] / { animate: false }.
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI = root.VeyvoUI || {};
  const dom = UI.dom;
  const fmt = UI.fmt;
  const S = dom.svg;
  const h = dom.h;
  const NB = ' ';
  const MINUS = '−';

  // ---------------------------------------------------------------- texts
  const MESSAGES = {
    cs: {
      group: { fast: 'Běh a závod', quality: 'Intervaly a tempo', easy: 'Lehké a dlouhé' },
      goal: 'Cíl', plan: 'V plánu', done: 'Odběháno',
      thisWeek: 'tento týden',
      empty: 'Zatím žádné běhy v tomto období.',
      weekly: {
        title: 'Kilometry po týdnech',
        desc: 'Týden od {date}: {km} km',
        planned: 'Tento týden: {km} km odběhnuto, v plánu ještě {planned} km'
      },
      pace: {
        title: 'Tempo každého běhu',
        desc: {
          one: '{n} běh od {from} do {to}. Rychlejší tempo je výš.',
          few: '{n} běhy od {from} do {to}. Rychlejší tempo je výš.',
          many: '{n} běhu od {from} do {to}. Rychlejší tempo je výš.',
          other: '{n} běhů od {from} do {to}. Rychlejší tempo je výš.'
        },
        goalLine: 'Cíl {pace}',
        gap: 'chybí {s} s/km',
        keys: 'Šipkami vlevo a vpravo projdeš jednotlivé běhy.'
      },
      tip: { time: 'Čas', pace: 'Tempo', distance: 'Vzdálenost', effort: 'Úsilí', best: 'Nejlepší 5 km', runs: 'Běhy' },
      lanes: {
        title: 'Dráha k cíli {target}',
        titleNoTarget: 'Tvoje nejlepší časy',
        desc: '{date}: {time}',
        gap: 'Do cíle {target} chybí {gap} s.',
        reached: 'Cíl {target} je splněný.',
        empty: 'Zatím žádný měřený běh na {distance} km'
      },
      meter: '{value} z {max}'
    },
    en: {
      group: { fast: 'Run & race', quality: 'Intervals & tempo', easy: 'Easy & long' },
      goal: 'Goal', plan: 'Planned', done: 'Done',
      thisWeek: 'this week',
      empty: 'No runs in this period yet.',
      weekly: {
        title: 'Kilometres per week',
        desc: 'Week of {date}: {km} km',
        planned: 'This week: {km} km done, {planned} km still planned'
      },
      pace: {
        title: 'Pace of every run',
        desc: { one: '{n} run from {from} to {to}. Faster pace is higher.', other: '{n} runs from {from} to {to}. Faster pace is higher.' },
        goalLine: 'Goal {pace}',
        gap: '{s} s/km to go',
        keys: 'Use the left and right arrow keys to step through the runs.'
      },
      tip: { time: 'Time', pace: 'Pace', distance: 'Distance', effort: 'Effort', best: 'Best 5 km', runs: 'Runs' },
      lanes: {
        title: 'Track to the {target} goal',
        titleNoTarget: 'Your best times',
        desc: '{date}: {time}',
        gap: '{gap} s to the {target} goal.',
        reached: 'The {target} goal is reached.',
        empty: 'No timed {distance} km run yet'
      },
      meter: '{value} of {max}'
    }
  };
  if (root.VeyvoI18n) root.VeyvoI18n.register('charts', MESSAGES);
  const t = (key, params) => fmt.typo(root.VeyvoI18n.t('charts.' + key, params));

  // ---------------------------------------------------------------- series encoding
  const GROUP_OF = { run: 'fast', test5k: 'fast', race: 'fast', intervals: 'quality', tempo: 'quality', easy: 'easy', long: 'easy' };
  const GROUPS = Object.freeze(['fast', 'quality', 'easy']);
  function typeCode(type) { return root.VeyvoRuns ? root.VeyvoRuns.typeCode(type) : type; }
  function groupOf(type) { return GROUP_OF[typeCode(type)] || 'fast'; }
  function typeLabel(type) { return root.VeyvoI18n.t('common.runType.' + (typeCode(type) || 'run')); }

  // ---------------------------------------------------------------- helpers
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const r1 = v => Math.round(v * 10) / 10;
  function niceStep(range, ticks) {
    const raw = range / Math.max(1, ticks);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }
  function frame(W, H, title, desc, cls) {
    const tid = dom.uid('ch-t'), did = dom.uid('ch-d');
    return S('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-labelledby': tid + ' ' + did, class: cls },
      S('title', { id: tid }, title), S('desc', { id: did }, desc));
  }
  function wrap(svgEl, cls, animate) {
    return h('div', { class: ['vchart', cls], dataset: animate === false ? { anim: 'off' } : {} }, svgEl);
  }
  /** Column with 4 px rounded top, square at the baseline. */
  function colPath(x, y, w, hgt, r) {
    if (!(hgt > 0) || !(w > 0)) return '';
    const rr = Math.min(r, w / 2, hgt);
    return 'M' + r1(x) + ',' + r1(y + hgt) + 'V' + r1(y + rr) + 'Q' + r1(x) + ',' + r1(y) + ' ' + r1(x + rr) + ',' + r1(y) +
      'H' + r1(x + w - rr) + 'Q' + r1(x + w) + ',' + r1(y) + ' ' + r1(x + w) + ',' + r1(y + rr) + 'V' + r1(y + hgt) + 'Z';
  }
  /** Bar with 4 px rounded right end, square at the left start. */
  function barPath(x, y, w, hgt, r) {
    if (!(w > 0) || !(hgt > 0)) return '';
    const rr = Math.min(r, w, hgt / 2);
    return 'M' + r1(x) + ',' + r1(y) + 'H' + r1(x + w - rr) + 'Q' + r1(x + w) + ',' + r1(y) + ' ' + r1(x + w) + ',' + r1(y + rr) +
      'V' + r1(y + hgt - rr) + 'Q' + r1(x + w) + ',' + r1(y + hgt) + ' ' + r1(x + w - rr) + ',' + r1(y + hgt) + 'H' + r1(x) + 'Z';
  }
  function txt(x, y, value, cls, anchor, extra) {
    return S('text', Object.assign({ x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || 'start' }, extra || {}), String(value));
  }
  function dateShort(key) { return fmt.date(key, 'dayMonth'); }

  // ---------------------------------------------------------------- shared hover / keyboard tooltip
  /**
   * interactive(wrapEl, svgEl, items, { W, render(i) -> Node[], label(i) -> string, cross, maxDist })
   * items: [{ x, y, node? }] in viewBox units. Pointer: nearest item by x. Keyboard: the svg is
   * focusable; arrows / Home / End move, Esc hides. A visually hidden live region reads the item.
   */
  function interactive(wrapEl, svgEl, items, o) {
    if (!items.length) return null;
    const tip = h('div.tip', { 'aria-hidden': 'true' });
    const live = h('div.sr-only', { 'aria-live': 'polite' });
    wrapEl.append(tip, live);
    svgEl.setAttribute('tabindex', '0');
    let active = -1;
    function scale() { const w = svgEl.getBoundingClientRect().width; return w > 0 ? w / o.W : 1; }
    function show(i, fromKey) {
      if (i < 0 || i >= items.length) return;
      if (active >= 0 && items[active].node) items[active].node.classList.remove('is-active');
      active = i;
      const it = items[i];
      if (it.node) it.node.classList.add('is-active');
      if (o.cross) { o.cross.setAttribute('x1', r1(it.x)); o.cross.setAttribute('x2', r1(it.x)); o.cross.removeAttribute('visibility'); }
      tip.replaceChildren.apply(tip, [].concat(o.render(i)));
      const k = scale();
      const px = it.x * k, py = it.y * k;
      const box = wrapEl.getBoundingClientRect();
      const tw = tip.offsetWidth || 170, th = tip.offsetHeight || 80;
      let left = px + 16;
      if (left + tw > box.width - 2) left = px - 16 - tw;
      left = Math.max(0, left);
      const top = Math.max(0, Math.min(py - th / 2, (svgEl.getBoundingClientRect().height || o.H) - th));
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      tip.classList.add('is-on');
      if (fromKey && o.label) live.textContent = o.label(i);
    }
    function hide() {
      tip.classList.remove('is-on');
      if (active >= 0 && items[active].node) items[active].node.classList.remove('is-active');
      if (o.cross) o.cross.setAttribute('visibility', 'hidden');
      active = -1;
    }
    function nearest(event) {
      const pt = svgEl.createSVGPoint();
      pt.x = event.clientX; pt.y = event.clientY;
      const ctm = svgEl.getScreenCTM();
      if (!ctm) return -1;
      const p = pt.matrixTransform(ctm.inverse());
      let best = -1, dist = Infinity;
      items.forEach((it, i) => { const d = Math.abs(it.x - p.x) + (o.useY ? Math.abs(it.y - p.y) * .35 : 0); if (d < dist) { dist = d; best = i; } });
      return dist <= (o.maxDist || 48) ? best : -1;
    }
    svgEl.addEventListener('pointermove', e => { const i = nearest(e); if (i < 0) hide(); else if (i !== active) show(i, false); });
    svgEl.addEventListener('pointerleave', hide);
    svgEl.addEventListener('focus', () => show(active >= 0 ? active : items.length - 1, true));
    svgEl.addEventListener('blur', hide);
    svgEl.addEventListener('keydown', e => {
      const map = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (map[e.key]) { e.preventDefault(); show(Math.max(0, Math.min(items.length - 1, (active < 0 ? items.length - 1 : active) + map[e.key])), true); }
      else if (e.key === 'Home') { e.preventDefault(); show(0, true); }
      else if (e.key === 'End') { e.preventDefault(); show(items.length - 1, true); }
      else if (e.key === 'Escape') { hide(); }
    });
    return { show, hide };
  }
  function tipRow(label, value, unit) {
    return h('div', null, h('span.tip-k', label), h('span.tip-v', value, unit ? h('span.unit', NB + unit) : null));
  }

  // ---------------------------------------------------------------- weekly volume
  function weeklyVolume(weeks, options) {
    const o = Object.assign({ width: 440, height: 180, planned: 0, stackedByType: false, showCounts: false, animate: true, labels: true }, options || {});
    const list = Array.isArray(weeks) ? weeks.filter(w => w && w.weekStart) : [];
    const W = Math.max(200, Math.round(o.width));
    const countsH = o.showCounts ? 14 : 0;
    const H = Math.round(o.height) + countsH;
    const m = { l: 30, r: 6, t: 24, b: 26 + countsH };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const planned = finite(o.planned) && o.planned > 0 ? o.planned : 0;
    const totals = list.map(w => (w.distanceKm || 0) + (w.isCurrent ? planned : 0));
    const maxV = totals.length ? Math.max.apply(null, totals) : 0;
    const step = maxV > 0 ? niceStep(maxV, 3) : 5;
    const top = maxV > 0 ? Math.ceil(maxV / step) * step : 10;
    const y = v => m.t + ph - (v / top) * ph;

    const descParts = list.map(w => t('weekly.desc', { date: dateShort(w.weekStart), km: fmt.km(w.distanceKm || 0) }));
    if (planned) descParts.push(t('weekly.planned', { km: fmt.km(list.length ? list[list.length - 1].distanceKm : 0), planned: fmt.km(planned, { trim: true }) }));
    const svgEl = frame(W, H, o.title || t('weekly.title'), descParts.join('; '), 'ch-weekly');

    const grid = S('g', { 'aria-hidden': 'true' });
    for (let v = 0; v <= top + 1e-9; v += step) {
      grid.append(S('line', { class: v === 0 ? 'ch-base' : 'ch-grid', x1: m.l, x2: W - m.r, y1: r1(y(v)) + .5, y2: r1(y(v)) + .5 }));
      grid.append(txt(m.l - 8, y(v) + 4, fmt.number(v, { maxDecimals: 1 }), 'ch-axis-num', 'end'));
    }
    svgEl.append(grid);

    const n = Math.max(1, list.length);
    const band = pw / n;
    const barW = Math.min(24, Math.max(8, band * 0.42));
    const labelEvery = band < 30 ? 3 : band < 44 ? 2 : 1;
    const currentLabel = o.currentLabel || (band >= 66 ? t('thisWeek') : null);
    const bars = S('g');
    const items = [];
    list.forEach((w, i) => {
      const cx = m.l + band * (i + .5);
      const x = cx - barW / 2;
      const km = w.distanceKm || 0;
      const col = S('g', { class: o.animate === false ? '' : 'grow-y', style: { '--i': i } });
      if (o.stackedByType && km > 0) {
        const parts = { easy: 0, quality: 0, fast: 0 };
        Object.keys(w.byType || {}).forEach(code => { parts[groupOf(code)] += (w.byType[code] && w.byType[code].distanceKm) || 0; });
        const order = ['easy', 'quality', 'fast'].filter(g => parts[g] > 0);
        let acc = 0;
        order.forEach((g, gi) => {
          const y0 = y(acc), y1 = y(acc + parts[g]);
          const isTop = gi === order.length - 1;
          const gap = gi > 0 ? 2 : 0;
          const hgt = Math.max(0, y0 - y1 - gap);
          col.append(isTop ? S('path', { class: 'm-' + g, d: colPath(x, y1, barW, hgt, 4) }) : S('rect', { class: 'm-' + g, x: r1(x), y: r1(y1), width: r1(barW), height: r1(hgt) }));
          acc += parts[g];
        });
      } else if (km > 0) {
        col.append(S('path', { class: w.isCurrent ? 'm-fast' : 'm-easy', d: colPath(x, y(km), barW, y(0) - y(km), 4) }));
      }
      if (w.isCurrent && planned) {
        const yTop = y(km + planned), yBot = y(km) - (km > 0 ? 2 : 0);
        col.append(S('rect', { class: 'm-plan', x: r1(x + .75), y: r1(yTop + .75), width: r1(barW - 1.5), height: r1(Math.max(2, yBot - yTop - 1.5)), rx: 3 }));
      }
      bars.append(col);
      if (o.labels && (km > 0 || w.isCurrent)) {
        const label = w.isCurrent && planned ? fmt.km(km) + ' + ' + fmt.km(planned, { trim: true }) : fmt.km(km);
        bars.append(txt(cx, y(totals[i]) - 7, label, 'ch-val' + (w.isCurrent ? ' ch-val-strong' : ''), 'middle', { class: 'ch-val fade-in' + (w.isCurrent ? ' ch-val-strong' : ''), style: { '--i': i + 4 } }));
      }
      const showX = w.isCurrent || (list.length - 1 - i) % labelEvery === 0;
      if (showX) bars.append(txt(cx, H - m.b + 17, w.isCurrent ? (currentLabel || dateShort(w.weekStart)) : dateShort(w.weekStart), w.isCurrent ? 'ch-axis ch-axis-strong' : 'ch-axis', 'middle'));
      if (o.showCounts && showX) bars.append(txt(cx, H - m.b + 31, w.count ? fmt.count('common.count.runs', w.count) : '', 'ch-sub', 'middle'));
      items.push({ x: cx, y: y(totals[i]), w });
    });
    svgEl.append(bars);
    const el = wrap(svgEl, 'vchart-weekly', o.animate);
    interactive(el, svgEl, items, {
      W, H, maxDist: band / 2 + 2,
      render: i => {
        const w = items[i].w;
        const rows = [tipRow(root.VeyvoI18n.t('common.field.distance'), fmt.km(w.distanceKm || 0), 'km'), tipRow(t('tip.runs'), String(w.count || 0))];
        if (w.isCurrent && planned) rows.push(tipRow(t('plan'), fmt.km(planned, { trim: true }), 'km'));
        return [h('div.tip-title', fmt.weekRange(w.weekStart, w.weekEnd)), h('div.tip-grid', rows)];
      },
      label: i => t('weekly.desc', { date: dateShort(items[i].w.weekStart), km: fmt.km(items[i].w.distanceKm || 0) })
    });
    return el;
  }

  // ---------------------------------------------------------------- pace chart
  const RANGE_DAYS = { '4w': 28, '3m': 91, '6m': 182, '1y': 365, all: Infinity };

  function paceChart(runs, options) {
    const o = Object.assign({ width: 760, height: 300, goalPace: null, range: 'all', today: null, labelFiveK: true, bestRunId: null, gapMarker: true, animate: true }, options || {});
    const R = root.VeyvoRuns;
    let data = (Array.isArray(runs) ? runs : []).filter(r => R.isValidRun(r)).map(r => ({
      run: r, date: r.date, pace: r.movingSeconds / r.distance, group: groupOf(r.type), five: R.isFiveKAttempt(r)
    })).filter(p => p.pace >= 120 && p.pace <= 1500).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const today = o.today && R.isDateKey(o.today) ? o.today : (data.length ? data[data.length - 1].date : null);
    const days = RANGE_DAYS[o.range] || Infinity;
    let start, end;
    if (today && days !== Infinity) {
      start = R.addDays(today, -(days - 1)); end = today;
      data = data.filter(p => p.date >= start && p.date <= end);
    } else if (data.length) { start = data[0].date; end = data[data.length - 1].date; }
    else { end = today || '2026-01-01'; start = R.addDays(end, -27); }
    if (start === end) { start = R.addDays(start, -3); end = R.addDays(end, 3); }
    const span = Math.max(1, R.daysBetween(start, end));

    const W = Math.max(260, Math.round(o.width)), H = Math.round(o.height);
    const m = { l: 44, r: 58, t: 26, b: 28 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const inner = 12;
    const x = key => m.l + inner + (R.daysBetween(start, key) / span) * (pw - inner * 2);

    const goal = finite(o.goalPace) && o.goalPace > 0 ? o.goalPace : null;
    const paces = data.map(p => p.pace);
    let fast = paces.length ? Math.min.apply(null, paces) : (goal || 300);
    let slow = paces.length ? Math.max.apply(null, paces) : (goal ? goal + 90 : 390);
    if (goal) { fast = Math.min(fast, goal); slow = Math.max(slow, goal); }
    const stepY = slow - fast > 240 ? 60 : 30;
    const topV = Math.floor(fast / stepY) * stepY;
    let botV = Math.ceil((slow + 10) / stepY) * stepY;
    if (botV - topV < stepY * 2) botV = topV + stepY * 2;
    const y = pace => m.t + ((pace - topV) / (botV - topV)) * ph;

    const desc = data.length ? t('pace.desc', { n: data.length, from: fmt.date(data[0].date, 'dayMonth'), to: fmt.date(data[data.length - 1].date, 'dayMonth') }) + ' ' + t('pace.keys') : t('empty');
    const svgEl = frame(W, H, o.title || t('pace.title'), desc, 'ch-pace');
    const defs = S('defs');
    svgEl.append(defs);

    const grid = S('g', { 'aria-hidden': 'true' });
    for (let v = topV; v <= botV + 1e-9; v += stepY) {
      grid.append(S('line', { class: 'ch-grid', x1: m.l, x2: W - m.r + 8, y1: r1(y(v)) + .5, y2: r1(y(v)) + .5 }));
      grid.append(txt(m.l - 8, y(v) + 4, fmt.pace(v), 'ch-axis-num', 'end'));
    }
    // x ticks: Mondays for short spans, month starts for long ones
    const ticks = [];
    if (span <= 130) {
      let k = R.weekStartOf(start);
      if (k < start) k = R.addDays(k, 7);
      const every = span > 70 ? 14 : 7;
      for (; k <= end; k = R.addDays(k, every)) ticks.push({ key: k, label: dateShort(k) });
    } else {
      let [yy, mm] = start.split('-').map(Number);
      mm += 1; if (mm > 12) { mm = 1; yy += 1; }
      const every = span > 400 ? 3 : 1;
      for (let guard = 0; guard < 40; guard++) {
        const k = yy + '-' + String(mm).padStart(2, '0') + '-01';
        if (k > end) break;
        ticks.push({ key: k, label: fmt.date(k, 'monthShort') });
        mm += every; while (mm > 12) { mm -= 12; yy += 1; }
      }
    }
    ticks.forEach(tk => grid.append(txt(x(tk.key), H - 8, tk.label, 'ch-axis', 'middle')));
    grid.append(S('line', { class: 'ch-base', x1: m.l, x2: W - m.r + 8, y1: H - m.b + .5, y2: H - m.b + .5 }));
    svgEl.append(grid);

    if (goal) {
      const gy = r1(y(goal));
      svgEl.append(S('line', { class: 'ch-goal', x1: m.l, x2: W - m.r + 8, y1: gy, y2: gy }));
      svgEl.append(txt(m.l + 4, gy - 7, t('pace.goalLine', { pace: fmt.paceUnit(goal) }), 'ch-goal-label', 'start'));
    }

    const cross = S('line', { class: 'ch-cross', x1: 0, x2: 0, y1: m.t - 6, y2: H - m.b, visibility: 'hidden' });
    svgEl.append(cross);

    if (!data.length) {
      svgEl.append(txt(m.l + pw / 2, m.t + ph / 2 + 4, t('empty'), 'ch-axis', 'middle'));
      return wrap(svgEl, 'vchart-pace', o.animate);
    }

    const items = [];
    const labels = S('g');
    GROUPS.forEach((g, gi) => {
      const pts = data.filter(p => p.group === g);
      if (!pts.length) return;
      const series = S('g', { class: 'ch-series' });
      if (pts.length >= 2) {
        const clipId = dom.uid('clip');
        defs.append(S('clipPath', { id: clipId }, S('rect', { class: o.animate === false ? '' : 'draw-line', style: { '--i': gi }, x: m.l - 6, y: 0, width: pw + 20, height: H })));
        series.append(S('path', { class: 'ch-line l-' + g + (g === 'fast' ? '' : ' ch-line-thin'), 'clip-path': 'url(#' + clipId + ')', d: 'M' + pts.map(p => r1(x(p.date)) + ',' + r1(y(p.pace))).join('L') }));
      }
      pts.forEach(p => {
        const cx = x(p.date), cy = y(p.pace);
        const frac = (cx - m.l) / pw;
        const dot = S('circle', { class: 'ch-point m-' + g + (o.animate === false ? '' : ' pop'), cx: r1(cx), cy: r1(cy), r: g === 'fast' ? 5 : 4, style: { animationDelay: Math.round(gi * 60 + frac * 380) + 'ms' } });
        series.append(dot);
        items.push({ x: cx, y: cy, node: dot, p });
      });
      // direct labels: every 5 km result (time + date); other series only at their last point (pace)
      if (g === 'fast' && o.labelFiveK) {
        let lastX = -Infinity;
        pts.filter(p => p.five).forEach(p => {
          const cx = x(p.date), cy = y(p.pace);
          const below = cy + 34 < H - m.b;
          const ty = below ? cy + 19 : cy - 22;
          labels.append(txt(cx, ty, fmt.duration(p.run.movingSeconds), 'ch-val ch-val-strong', 'middle'));
          if (cx - lastX > 46) labels.append(txt(cx, ty + 13, dateShort(p.date), 'ch-sub', 'middle'));
          lastX = cx;
        });
      } else {
        const last = pts[pts.length - 1];
        labels.append(txt(x(last.date) + 9, y(last.pace) + 4, fmt.pace(last.pace), 'ch-val', 'start'));
      }
      svgEl.append(series);
    });
    // gap from the latest 5 km result to the goal pace (a bracket + '12 s/km to go')
    const fives = data.filter(p => p.five);
    if (goal && o.gapMarker && fives.length) {
      const last = fives[fives.length - 1];
      const gap = Math.round(last.pace - goal);
      if (gap > 0) {
        const bx = x(last.date) + 12, y0 = y(goal), y1 = y(last.pace) - 6;
        if (y1 - y0 > 10) {
          labels.append(S('path', { class: 'ch-goal', 'stroke-dasharray': 'none', d: 'M' + r1(bx - 4) + ',' + r1(y0) + 'H' + r1(bx) + 'V' + r1(y1) + 'H' + r1(bx - 4) }));
          labels.append(txt(bx + 6, (y0 + y1) / 2 + 4, MINUS + gap + NB + 's/km', 'ch-val ch-val-hot', 'start'));
        }
      }
    }
    svgEl.append(labels);
    items.sort((a, b) => a.x - b.x);

    const el = wrap(svgEl, 'vchart-pace', o.animate);
    interactive(el, svgEl, items, {
      W, H, cross, useY: true, maxDist: 40,
      render: i => {
        const p = items[i].p, run = p.run;
        const rows = [
          tipRow(t('tip.time'), fmt.duration(run.movingSeconds)),
          tipRow(t('tip.pace'), fmt.pace(p.pace), '/km'),
          tipRow(t('tip.distance'), fmt.km(run.distance), 'km')
        ];
        if (finite(run.effort)) rows.push(tipRow(t('tip.effort'), String(run.effort), '/10'));
        return [
          h('div.tip-title', h('i', { class: 'dot dot-' + p.group }), fmt.date(p.date, 'short') + ' · ' + typeLabel(run.type),
            o.bestRunId && run.id === o.bestRunId ? h('span.chip.chip-sm.chip-accent', t('tip.best')) : null),
          h('div.tip-grid', rows)
        ];
      },
      label: i => {
        const p = items[i].p;
        return fmt.date(p.date, 'short') + ', ' + typeLabel(p.run.type) + ', ' + fmt.kmUnit(p.run.distance) + ', ' + fmt.duration(p.run.movingSeconds) + ', ' + fmt.paceUnit(p.pace);
      }
    });
    return el;
  }

  // ---------------------------------------------------------------- goal lanes (concept A "Track")
  const LANE_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

  function goalLanes(goal, options) {
    const o = Object.assign({ width: 640, animate: true, laneHeight: 30 }, options || {});
    const g = goal || {};
    const target = finite(g.target) ? g.target : null;
    const lanes = [];
    if (finite(g.previousBest) && g.previousBestDate) lanes.push({ seconds: g.previousBest, date: g.previousBestDate, hot: false });
    if (finite(g.best)) lanes.push({ seconds: g.best, date: g.bestDate, hot: true });

    const W = Math.max(280, Math.round(o.width));
    const laneH = o.laneHeight;
    const labelW = W < 420 ? 64 : 78;
    const padR = 10;
    const top = 8;
    const nLanes = Math.max(1, lanes.length);
    const fieldBottom = top + nLanes * laneH;
    const H = fieldBottom + 26;
    const x0 = labelW, fw = W - labelW - padR;

    const times = lanes.map(l => l.seconds);
    let left, right, step;
    if (!times.length && target === null) {
      const svgEmpty = frame(W, H, t('lanes.titleNoTarget'), t('lanes.empty', { distance: fmt.km(g.distanceKm || 5, { trim: true }) }), 'ch-lanes');
      svgEmpty.append(S('rect', { class: 'ln-track', x: x0, y: top, width: fw, height: laneH }));
      svgEmpty.append(txt(x0 + 12, top + laneH / 2 + 4, t('lanes.empty', { distance: fmt.km(g.distanceKm || 5, { trim: true }) }), 'ln-empty'));
      return wrap(svgEmpty, 'vchart-lanes', o.animate);
    }
    const slowest = Math.max.apply(null, times.concat(target !== null ? [target] : []));
    const fastest = Math.min.apply(null, times.concat(target !== null ? [target] : []));
    for (const s of LANE_STEPS) {
      const pad = Math.max(s * .5, 8);
      const l = Math.ceil((slowest + (times.length ? pad : s * 4)) / s) * s;
      const rgt = target !== null && fastest >= target ? target : Math.floor((fastest - pad) / s) * s;
      if ((l - rgt) / s <= 5) { left = l; right = rgt; step = s; break; }
    }
    if (left === undefined) { step = Math.ceil((slowest - fastest) / 5 / 60) * 60 || 60; left = Math.ceil(slowest / step) * step + step; right = Math.floor(fastest / step) * step; }
    const x = sec => x0 + ((left - sec) / (left - right)) * fw;

    const title = target !== null ? t('lanes.title', { target: fmt.duration(target) }) : t('lanes.titleNoTarget');
    const descParts = lanes.map(l => t('lanes.desc', { date: dateShort(l.date), time: fmt.duration(l.seconds) }));
    if (target !== null && finite(g.best)) descParts.push(g.best <= target ? t('lanes.reached', { target: fmt.duration(target) }) : t('lanes.gap', { target: fmt.duration(target), gap: Math.round(g.best - target) }));
    if (!lanes.length) descParts.push(t('lanes.empty', { distance: fmt.km(g.distanceKm || 5, { trim: true }) }));
    const svgEl = frame(W, H, title, descParts.join('; '), 'ch-lanes');
    const hatchId = dom.uid('hatch'), checkId = dom.uid('chk');
    const defs = S('defs',
      S('pattern', { id: hatchId, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, S('line', { class: 'ln-hatch-line', x1: 0, y1: 0, x2: 0, y2: 7 })));
    svgEl.append(defs);

    // tracks, edges and split lines
    for (let i = 0; i < nLanes; i++) {
      const ly = top + i * laneH;
      svgEl.append(S('rect', { class: 'ln-track', x: x0, y: ly, width: fw, height: laneH }));
      svgEl.append(S('line', { class: 'ln-edge', x1: x0, x2: x0 + fw, y1: ly + .5, y2: ly + .5 }));
    }
    svgEl.append(S('line', { class: 'ln-edge', x1: x0, x2: x0 + fw, y1: fieldBottom - .5, y2: fieldBottom - .5 }));
    const tickVals = [];
    for (let v = left; v >= right - 1e-9; v -= step) tickVals.push(v);
    tickVals.slice(1, -1).forEach(v => svgEl.append(S('line', { class: 'ln-split', x1: r1(x(v)) + .5, x2: r1(x(v)) + .5, y1: top, y2: fieldBottom })));

    if (!lanes.length) svgEl.append(txt(x0 + 12, top + laneH / 2 + 4, t('lanes.empty', { distance: fmt.km(g.distanceKm || 5, { trim: true }) }), 'ln-empty'));

    lanes.forEach((lane, i) => {
      const ly = top + i * laneH;
      const fx = x(lane.seconds);
      const fwid = Math.max(0, Math.min(x0 + fw, fx) - x0);
      svgEl.append(txt(6, ly + laneH / 2 + 5, String(i + 1), 'ln-no', 'start'));
      svgEl.append(txt(22, ly + laneH / 2 + 4, dateShort(lane.date), 'ln-date', 'start'));
      svgEl.append(S('path', { class: (lane.hot ? 'ln-fill-hot' : 'ln-fill-mute') + (o.animate === false ? '' : ' grow-x'), style: { '--i': i }, d: barPath(x0, ly + 5, fwid, laneH - 10, 4) }));
      const label = fmt.duration(lane.seconds);
      const inside = fwid > 58;
      svgEl.append(txt(inside ? x0 + fwid - 8 : x0 + fwid + 6, ly + laneH / 2 + 5, label,
        'ln-time ' + (inside ? (lane.hot ? 'ln-time-hot' : 'ln-time-mute') : 'ln-time-out') + (o.animate === false ? '' : ' fade-in'), inside ? 'end' : 'start', { style: { '--i': 6 + i } }));
      if (lane.hot && target !== null && lane.seconds > target) {
        const gx = x(lane.seconds), gw = x(target) - gx;
        const grp = S('g', { class: o.animate === false ? '' : 'fade-in', style: { '--i': 9 } });
        grp.append(S('rect', { x: r1(gx), y: ly + 5, width: r1(gw), height: laneH - 10, fill: 'url(#' + hatchId + ')' }));
        grp.append(S('path', { class: 'ln-gap', d: 'M' + r1(gx) + ',' + (ly + 5.5) + 'H' + r1(gx + gw - 4) + 'Q' + r1(gx + gw) + ',' + (ly + 5.5) + ' ' + r1(gx + gw) + ',' + (ly + 9.5) + 'V' + (ly + laneH - 9.5) + 'Q' + r1(gx + gw) + ',' + (ly + laneH - 5.5) + ' ' + r1(gx + gw - 4) + ',' + (ly + laneH - 5.5) + 'H' + r1(gx) }));
        if (gw > 34) grp.append(txt(gx + gw / 2, ly + laneH / 2 + 5, fmt.seconds(lane.seconds - target), 'ln-gap-label', 'middle'));
        svgEl.append(grp);
      }
    });

    if (target !== null) {
      const fx = x(target);
      defs.append(S('pattern', { id: checkId, width: 6, height: 6, patternUnits: 'userSpaceOnUse', x: r1(fx - 3), y: top - 6 },
        S('rect', { class: 'ln-check-a', x: 0, y: 0, width: 3, height: 3 }), S('rect', { class: 'ln-check-a', x: 3, y: 3, width: 3, height: 3 })));
      svgEl.append(S('rect', { x: r1(fx - 3), y: top - 6, width: 6, height: nLanes * laneH + 12, fill: 'url(#' + checkId + ')' }));
    }

    tickVals.forEach((v, i) => {
      const first = i === 0, last = i === tickVals.length - 1;
      svgEl.append(txt(x(v), H - 6, fmt.duration(v), 'ln-tick' + (last && v === target ? ' ln-tick-goal' : ''), first ? 'start' : last ? 'end' : 'middle'));
    });
    return wrap(svgEl, 'vchart-lanes', o.animate);
  }

  // ---------------------------------------------------------------- meter (HTML)
  function meter(value, max, options) {
    const o = options || {};
    const n = Number.isInteger(max) && max > 0 ? max : 10;
    const v = finite(value) ? Math.max(0, Math.min(n, Math.round(value))) : 0;
    const el = h('span', {
      class: ['meter', o.variant ? 'meter-' + o.variant : null, o.size === 'lg' ? 'meter-lg' : null, o.animate ? 'is-anim' : null],
      role: 'img', 'aria-label': o.label || t('meter', { value: finite(value) ? v : '–', max: n })
    });
    for (let i = 0; i < n; i++) el.append(h('i', { class: i < v ? 'on' : null, style: o.animate ? { '--i': i } : null }));
    return el;
  }

  // ---------------------------------------------------------------- sparkline
  function sparkline(values, options) {
    const o = Object.assign({ width: 120, height: 32, area: true, highlightLast: true, invert: false, label: '' }, options || {});
    const vals = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
    const W = o.width, H = o.height, pad = 4;
    const el = S('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'sparkline', role: o.label ? 'img' : null, 'aria-label': o.label || null, 'aria-hidden': o.label ? null : 'true' });
    if (!vals.length) { el.append(S('line', { class: 'spark-line', x1: pad, x2: W - pad, y1: H / 2, y2: H / 2, 'stroke-dasharray': '3 3' })); return el; }
    const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    const range = max - min || 1;
    const px = i => vals.length === 1 ? W / 2 : pad + (i / (vals.length - 1)) * (W - pad * 2);
    const py = v => { const f = (v - min) / range; return pad + (o.invert ? f : 1 - f) * (H - pad * 2); };
    if (vals.length > 1) {
      const line = vals.map((v, i) => r1(px(i)) + ',' + r1(py(v))).join('L');
      if (o.area) el.append(S('path', { class: 'spark-area', d: 'M' + r1(px(0)) + ',' + (H - pad) + 'L' + line + 'L' + r1(px(vals.length - 1)) + ',' + (H - pad) + 'Z' }));
      el.append(S('path', { class: 'spark-line', d: 'M' + line }));
    }
    if (o.highlightLast) el.append(S('circle', { class: 'spark-dot', cx: r1(px(vals.length - 1)), cy: r1(py(vals[vals.length - 1])), r: 3 }));
    return el;
  }

  // ---------------------------------------------------------------- legend
  function legend(options) {
    const o = options || {};
    const groups = o.groups || GROUPS;
    const el = h('div.legend');
    groups.forEach(g => el.append(h('span.legend-item', h('i', { class: 'dot dot-' + g }), t('group.' + g))));
    if (o.goal) el.append(h('span.legend-item', h('i.lg-goal'), typeof o.goal === 'string' ? o.goal : t('goal')));
    if (o.plan) el.append(h('span.legend-item', h('i.lg-plan'), typeof o.plan === 'string' ? o.plan : t('plan')));
    return el;
  }

  // ---------------------------------------------------------------- responsive mount
  /**
   * mount(host, build({ width, animate }) -> Element, { minWidth }) -> { update(build), destroy() }.
   * Renders at the host's pixel width; re-renders (animate: false) when the width changes by > 8 px.
   */
  function mount(host, build, options) {
    const o = options || {};
    let builder = build, last = 0, timer = null, destroyed = false, observer = null;
    function render(animate) {
      if (destroyed) return;
      const width = Math.max(o.minWidth || 240, Math.floor(host.clientWidth || 0));
      last = width;
      host.replaceChildren(builder({ width, animate }));
    }
    function first(tries) {
      if (destroyed) return;
      if (!host.isConnected || !host.clientWidth) {
        if (tries < 30) { (root.requestAnimationFrame || setTimeout)(() => first(tries + 1)); return; }
      }
      render(true);
    }
    first(0);
    if (typeof root.ResizeObserver === 'function') {
      observer = new root.ResizeObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (Math.abs(Math.floor(host.clientWidth) - last) > 8) render(false); }, 120);
      });
      observer.observe(host);
    }
    return {
      update(next, animate) { if (next) builder = next; render(!!animate); },
      destroy() { destroyed = true; clearTimeout(timer); if (observer) observer.disconnect(); }
    };
  }

  UI.charts = { weeklyVolume, paceChart, goalLanes, meter, sparkline, legend, mount, groupOf, typeLabel, GROUPS, RANGE_DAYS, MESSAGES };
})(globalThis);
