/*
 * VeyvoUI.icons - one consistent stroke icon set (24 x 24 grid, 1.75 px stroke, round caps).
 * No emoji, no unicode glyphs, no brand logos (Strava/Garmin get neutral link/watch icons).
 *
 *   VeyvoUI.icons.get('calendar')                     -> <svg class="ic" aria-hidden="true">…</svg>
 *   VeyvoUI.icons.get('check', { size: 14, className: 'ic-end', title: 'Hotovo' })  (title -> role="img")
 *   VeyvoUI.icons.hydrate(root)   replaces <span data-icon="name"></span> placeholders (index.html)
 *   VeyvoUI.icons.names()         all names (aliases included)
 * Size: { size } sets --ic (CSS default 18 px). Colour: currentColor.
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI = root.VeyvoUI || {};
  const NS = 'http://www.w3.org/2000/svg';

  // Each icon: array of [tag, attrs]. 'p' = path d, 'c' = circle [cx, cy, r], 'r' = rect [x, y, w, h, rx], 'f' = filled path.
  const P = {
    // navigation
    home: [['r', [3, 3, 7, 9, 1.5]], ['r', [14, 3, 7, 5, 1.5]], ['r', [14, 12, 7, 9, 1.5]], ['r', [3, 16, 7, 5, 1.5]]],
    house: [['p', 'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6.5H9V21H4.5a1 1 0 0 1-1-1z']],
    calendar: [['r', [3, 4.5, 18, 16.5, 2]], ['p', 'M8 2.5v4M16 2.5v4M3 10h18']],
    'calendar-check': [['r', [3, 4.5, 18, 16.5, 2]], ['p', 'M8 2.5v4M16 2.5v4M3 10h18'], ['p', 'm9 15.5 2 2 4-4']],
    'calendar-plus': [['r', [3, 4.5, 18, 16.5, 2]], ['p', 'M8 2.5v4M16 2.5v4M3 10h18'], ['p', 'M12 13v6M9 16h6']],
    trend: [['p', 'M3 17.5 9.5 11l4 4L21 7.5'], ['p', 'M15.5 7.5H21V13']],
    'bar-chart': [['p', 'M4 20h16'], ['p', 'M7 16.5V11M12 16.5V5.5M17 16.5v-8']],
    checklist: [['r', [8, 2.5, 8, 4, 1]], ['p', 'M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2'], ['p', 'm9 14 2 2 4-4']],
    'fork-knife': [['p', 'M6 3v6a2 2 0 0 0 4 0V3M8 11v10'], ['p', 'M17.5 21V3c-2 1.2-3.2 3.6-3.2 6.5v4.5h3.2']],
    settings: [['p', 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'], ['c', [12, 12, 3]]],
    more: [['f', 'M5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM19 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z']],
    menu: [['p', 'M4 7h16M4 12h16M4 17h16']],
    user: [['c', [12, 8, 4]], ['p', 'M4.5 21a7.5 7.5 0 0 1 15 0']],
    // actions
    plus: [['p', 'M12 5v14M5 12h14']],
    minus: [['p', 'M5 12h14']],
    play: [['f', 'M7 4.5v15l12-7.5z']],
    check: [['p', 'M20 6 9 17l-5-5']],
    x: [['p', 'M18 6 6 18M6 6l12 12']],
    'chevron-right': [['p', 'm9 6 6 6-6 6']],
    'chevron-left': [['p', 'm15 6-6 6 6 6']],
    'chevron-down': [['p', 'm6 9 6 6 6-6']],
    'chevron-up': [['p', 'm6 15 6-6 6 6']],
    'arrow-right': [['p', 'M4 12h16M14 6l6 6-6 6']],
    'arrow-left': [['p', 'M20 12H4M10 6l-6 6 6 6']],
    'arrow-up': [['p', 'M12 20V4M6 10l6-6 6 6']],
    'arrow-down': [['p', 'M12 4v16M6 14l6 6 6-6']],
    external: [['p', 'M14 4h6v6M20 4l-9 9'], ['p', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5']],
    download: [['p', 'M12 3.5v12M7 10.5l5 5 5-5M4.5 20.5h15']],
    upload: [['p', 'M12 15.5v-12M7 8.5l5-5 5 5M4.5 20.5h15']],
    share: [['p', 'M12 3v12.5M7.5 7.5 12 3l4.5 4.5'], ['p', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7']],
    link: [['p', 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1'], ['p', 'M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1']],
    refresh: [['p', 'M20 11a8 8 0 0 0-14.3-4.9L4 8'], ['p', 'M4 3.5V8h4.5'], ['p', 'M4 13a8 8 0 0 0 14.3 4.9L20 16'], ['p', 'M20 20.5V16h-4.5']],
    trash: [['p', 'M4 7h16M10 11v6M14 11v6'], ['p', 'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3']],
    edit: [['p', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4z']],
    copy: [['r', [8, 8, 13, 13, 2]], ['p', 'M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3']],
    undo: [['p', 'M9 14 4 9l5-5'], ['p', 'M4 9h11a5 5 0 0 1 0 10h-3']],
    filter: [['p', 'M3.5 5h17l-6.5 8v6l-4 2v-8z']],
    search: [['c', [11, 11, 7]], ['p', 'm20 20-3.5-3.5']],
    // data / running
    flag: [['p', 'M5 21V4'], ['p', 'M5 4h12l-2.5 4L17 12H5']],
    target: [['c', [12, 12, 9]], ['c', [12, 12, 5]], ['c', [12, 12, 1]]],
    clock: [['c', [12, 12, 9]], ['p', 'M12 7v5l3 2']],
    timer: [['c', [12, 13.5, 7.5]], ['p', 'M12 10v3.5l2 1.5M9.5 2.5h5M12 2.5V6']],
    route: [['c', [6, 18.5, 2.5]], ['c', [18, 5.5, 2.5]], ['p', 'M8.5 18.5h8a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7h8']],
    gauge: [['p', 'M3.5 18a9 9 0 1 1 17 0'], ['p', 'm12 14 4-5']],
    heart: [['p', 'M12 20s-7-4.4-9-9.2C1.6 7.2 4 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4 20 4 22.4 7.2 21 10.8 19 15.6 12 20 12 20z']],
    watch: [['r', [6, 6, 12, 12, 3]], ['p', 'M9 6l.7-3h4.6l.7 3M9 18l.7 3h4.6l.7-3'], ['p', 'M12 9.5v2.7l1.6 1.2']],
    mountain: [['p', 'M3 20 9.5 9l4 6.2 2.3-3.2L21 20z']],
    repeat: [['p', 'M17 2.5l3.5 3.5L17 9.5'], ['p', 'M3.5 11V9a3 3 0 0 1 3-3h14'], ['p', 'M7 21.5 3.5 18 7 14.5'], ['p', 'M20.5 13v2a3 3 0 0 1-3 3h-14']],
    list: [['p', 'M8.5 6H20M8.5 12H20M8.5 18H20'], ['p', 'M4 6h.01M4 12h.01M4 18h.01']],
    file: [['p', 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'], ['p', 'M14 3v5h5']],
    database: [['p', 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z'], ['p', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3']],
    lock: [['r', [5, 11, 14, 10, 2]], ['p', 'M8 11V7.5a4 4 0 0 1 8 0V11']],
    // status
    info: [['c', [12, 12, 9]], ['p', 'M12 11v5.5M12 7.6h.01']],
    warning: [['p', 'M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'], ['p', 'M12 9.5v4M12 17h.01']],
    'check-circle': [['c', [12, 12, 9]], ['p', 'm8.5 12.3 2.4 2.4 4.6-4.9']],
    'x-circle': [['c', [12, 12, 9]], ['p', 'm9 9 6 6M15 9l-6 6']],
    // appearance / language
    moon: [['p', 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z']],
    sun: [['c', [12, 12, 4]], ['p', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4']],
    language: [['c', [12, 12, 9]], ['p', 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18']]
  };
  const ALIASES = {
    plan: 'calendar', chart: 'trend', progress: 'trend', overview: 'home', prerun: 'checklist', nutrition: 'checklist',
    close: 'x', distance: 'route', pace: 'gauge', sync: 'refresh', delete: 'trash', pencil: 'edit', globe: 'language',
    strava: 'link', garmin: 'watch', export: 'download', import: 'upload', goal: 'flag', time: 'clock', sleep: 'moon',
    'chevron': 'chevron-right', error: 'x-circle', success: 'check-circle', dots: 'more'
  };

  function resolve(name) { return P[name] ? name : (ALIASES[name] && P[ALIASES[name]] ? ALIASES[name] : null); }

  /** get(name, { size, className, title, strokeWidth }) -> SVGElement (empty icon + console warning if unknown). */
  function get(name, options) {
    const opts = options || {};
    const doc = root.document;
    const el = doc.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('class', 'ic' + (opts.className ? ' ' + opts.className : ''));
    el.setAttribute('focusable', 'false');
    if (opts.size) el.style.setProperty('--ic', opts.size + 'px');
    if (opts.strokeWidth) el.style.strokeWidth = String(opts.strokeWidth);
    const key = resolve(name);
    if (!key) {
      if (root.console) root.console.warn('VeyvoUI.icons: unknown icon "' + name + '"');
    } else {
      el.dataset.icon = key;
      for (const [kind, value] of P[key]) {
        let node;
        if (kind === 'p' || kind === 'f') {
          node = doc.createElementNS(NS, 'path');
          node.setAttribute('d', value);
          if (kind === 'f') node.setAttribute('class', 'ic-fill');
        } else if (kind === 'c') {
          node = doc.createElementNS(NS, 'circle');
          node.setAttribute('cx', value[0]); node.setAttribute('cy', value[1]); node.setAttribute('r', value[2]);
        } else if (kind === 'r') {
          node = doc.createElementNS(NS, 'rect');
          node.setAttribute('x', value[0]); node.setAttribute('y', value[1]); node.setAttribute('width', value[2]); node.setAttribute('height', value[3]);
          if (value[4]) node.setAttribute('rx', value[4]);
        }
        el.appendChild(node);
      }
    }
    if (opts.title) {
      el.setAttribute('role', 'img');
      const title = doc.createElementNS(NS, 'title');
      title.textContent = opts.title;
      el.insertBefore(title, el.firstChild);
    } else {
      el.setAttribute('aria-hidden', 'true');
    }
    return el;
  }

  /** Replace every [data-icon] placeholder (not already an svg) inside scope with the icon. */
  function hydrate(scope) {
    const nodes = (scope || root.document).querySelectorAll('[data-icon]:not(svg)');
    nodes.forEach(node => {
      const size = node.getAttribute('data-icon-size');
      const icon = get(node.getAttribute('data-icon'), { size: size ? Number(size) : undefined, className: node.getAttribute('data-icon-class') || undefined });
      node.replaceWith(icon);
    });
    return nodes.length;
  }

  function names() { return Object.keys(P).concat(Object.keys(ALIASES)).sort(); }
  function has(name) { return !!resolve(name); }

  UI.icons = { get, hydrate, names, has };
})(globalThis);
