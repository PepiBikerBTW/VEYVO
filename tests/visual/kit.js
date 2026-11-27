// VEYVO component kit (dev only, injected by tests/visual/screenshots.cjs --page kit).
// A living style guide built ONLY from the shared foundation (VeyvoUI.dom/icons/motion/charts and
// the components registry) with the real derived data, so page agents can see every building
// block in both themes and copy the markup. Not shipped; strings here are not localized.
(function () {
  'use strict';
  const app = VeyvoUI.app;
  if (app.pages.get('kit')) return;

  app.pages.register('kit', {
    title: 'ui.nav.home',
    eyebrow: () => 'Component kit · ' + VeyvoUI.fmt.date(app.today(), 'long'),
    actions: ctx => ctx.h('div.btn-row',
      ctx.h('button.btn.btn-secondary.btn-sm', { type: 'button', onClick: () => app.setTheme(app.theme() === 'dark' ? 'light' : 'dark') }, ctx.icons.get(app.theme() === 'dark' ? 'sun' : 'moon'), 'Theme'),
      ctx.h('button.btn.btn-secondary.btn-sm', { type: 'button', onClick: () => app.setLanguage(app.language() === 'cs' ? 'en' : 'cs') }, ctx.icons.get('language'), app.language().toUpperCase())),
    render(container, ctx) {
      const { h, icons, fmt, charts, components: C, derived: d, motion } = ctx;
      const g = d.goal;
      const card = (cls, ...kids) => { let props = {}; if (kids[0] && !kids[0].nodeType && typeof kids[0] === 'object' && !Array.isArray(kids[0])) props = kids.shift(); return h('article', Object.assign({}, props, { class: ['card', cls] }), ...kids); };
      const head = (title, sub, end) => h('div.card-head', h('h2.card-title', title), sub ? h('span.card-sub', sub) : null, end ? h('div.card-end', end) : null);

      // ---- hero: goal card with lanes
      const bestEl = h('span.num', fmt.duration(g.best));
      const lanesHost = h('div', { style: { marginTop: '22px' } });
      const goalCard = card('card-pad-lg card-glow reveal',
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          icons.get('flag', { className: 'accent-text' }), h('span.eyebrow', 'Cíl'), h('b', fmt.goal(d.profile)),
          h('span.faint', { style: { marginLeft: 'auto', fontSize: '12.5px' } }, 'nejlepší čas z ' + fmt.date(g.bestDate))),
        h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '20px', marginTop: '16px' } },
          h('div', h('div', { style: { font: '600 104px/.8 var(--font-num)' } }, bestEl), h('div.faint', { style: { fontSize: '12px', marginTop: '10px' } }, 'Tvůj nejlepší čas')),
          icons.get('arrow-right', { size: 30, className: 'faint' }),
          h('div', h('div.num.faint', { style: { fontSize: '104px', fontWeight: 600, lineHeight: .8 } }, fmt.duration(g.target)), h('div.faint', { style: { fontSize: '12px', marginTop: '10px' } }, 'Cíl')),
          h('div', { style: { marginLeft: 'auto', background: 'var(--accent-soft)', borderRadius: '8px', padding: '12px 16px', boxShadow: 'inset 3px 0 0 var(--accent)' } },
            h('div.num.accent-text', { style: { fontSize: '60px', fontWeight: 700, lineHeight: .82 } }, fmt.seconds(-g.gapSeconds)),
            h('div.muted', { style: { fontSize: '12px', marginTop: '8px' } }, 'chybí do cíle'))),
        lanesHost,
        h('div.stat-row', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line-soft)' } },
          C.create('stat', { small: true, label: 'Tempo nejlepšího běhu', value: fmt.pace(g.bestPace), unit: '/km' }),
          C.create('stat', { small: true, label: 'Potřebné tempo', value: fmt.pace(g.targetPace), unit: '/km' }),
          C.create('stat', { small: true, label: 'Zlepšení od ' + fmt.date(g.previousBestDate, 'dayMonth'), value: fmt.seconds(-g.improvementSeconds), sub: fmt.count('common.count.days', g.improvementDays) })));
      motion.countUp(bestEl, g.best, { from: g.previousBest || g.best + 30, format: s => fmt.duration(s), delay: 120 });

      // ---- next run (signal card)
      const nr = d.nextRun;
      const nextCard = card('card-pad-lg card-raised card-signal reveal', { style: { '--i': 1 } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('span.eyebrow', 'Další běh'), nr && nr.date ? h('span.chip', fmt.relDay(nr.date, d.today)) : null),
        h('p.muted', { style: { marginTop: '16px', fontWeight: 500 } }, nr && nr.date ? fmt.date(nr.date, 'long') : '—'),
        h('h3', { style: { font: '600 24px/1.15 var(--font-ui)', marginTop: '2px' } }, d.nextWorkout ? d.nextWorkout.name : '—'),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '10px' } }, h('span.num', { style: { fontSize: '96px', fontWeight: 600, lineHeight: .8 } }, nr ? fmt.km(nr.distanceKm, { trim: true }) : '—'), h('span.num.muted', { style: { fontSize: '26px', fontWeight: 600 } }, 'km')),
        h('p.muted', { style: { marginTop: '16px', fontSize: '13.5px', maxWidth: '40ch' } }, d.nextWorkout ? fmt.typo(d.nextWorkout.description) : ''),
        h('div.btn-row', { style: { marginTop: '18px' } },
          h('button.btn.btn-primary.btn-lg', { type: 'button', style: { flex: 1 } }, icons.get('play'), 'Spustit běh'),
          h('button.btn.btn-secondary.btn-lg', { type: 'button' }, icons.get('calendar'), 'Plán')));

      // ---- stat board
      const t7 = d.last7, tot = d.totals;
      const board = h('div.stat-board.reveal', { style: { '--i': 2 } },
        C.create('stat', { label: 'Běhy', value: String(tot.count), sub: 'od ' + fmt.date(d.runs[0] && d.runs[0].date, 'dayMonth'), countTo: { to: tot.count } }),
        C.create('stat', { label: 'Vzdálenost', value: fmt.km(tot.distanceKm), unit: 'km', sub: 'celkem', countTo: { to: tot.distanceKm, format: v => fmt.km(v) } }),
        C.create('stat', { label: 'Čas běhu', value: fmt.durationWords(tot.movingSeconds), sub: 'celkem' }),
        C.create('stat', { label: 'Posledních 7 dní', value: fmt.km(t7.distanceKm), unit: 'km', sub: fmt.count('common.count.runs', t7.count) }),
        C.create('stat', { label: 'Průměrné tempo', value: fmt.pace(tot.avgPaceSecPerKm), unit: '/km', sub: 'všechny běhy' }),
        C.create('stat', { hot: true, label: 'Nejlepší 5 km', value: fmt.duration(g.best), sub: fmt.date(g.bestDate) + ' · ' + fmt.seconds(-g.improvementSeconds) }));

      // ---- pace chart with range tabs
      let range = 'all';
      const paceHost = h('div', { style: { marginTop: '8px' } });
      const paceCard = card('card-pad reveal', { style: { '--i': 3 } },
        head('Tempo každého běhu', 'min/km · rychlejší nahoře', C.create('segmented', { label: 'Období', value: range, options: [{ value: '4w', label: '4 týdny' }, { value: '3m', label: '3 měsíce' }, { value: 'all', label: 'Vše' }], onChange: v => { range = v; paceChart.update(null, true); } })),
        paceHost, h('div', { style: { marginTop: '8px' } }, charts.legend({ goal: true })));
      const volHost = h('div');
      const volCard = card('card-pad reveal', { style: { '--i': 4 } }, head('Objem po týdnech', 'km'), volHost, h('div', { style: { marginTop: '8px' } }, charts.legend({ plan: true })));

      // ---- table
      const notesFor = id => (d.notes[id] || []).map(n => n.code).join(', ');
      const rows = d.runsDesc.slice(0, 6).map(r => h('tr.is-clickable', { tabindex: '0', 'data-key': 'run:' + r.id },
        h('td.dt', fmt.date(r.date)), h('td', C.create('typeTag', { type: r.type })),
        h('td.r.n', fmt.km(r.distance), h('span.unit', ' km')), h('td.r.n', fmt.duration(r.movingSeconds)),
        h('td.r.n', fmt.pace(r.movingSeconds / r.distance), h('span.unit', ' /km')),
        h('td.r', h('span.meter-val', C.create('meter', { value: r.effort, animate: true }), h('span.num', String(r.effort || '–')))),
        h('td.faint', notesFor(r.id) || '–')));
      const tableCard = card('card-pad reveal', { style: { '--i': 5 } }, head('Poslední běhy', null, h('a.btn-link', { href: '#progress', 'data-nav': 'progress' }, 'Všechny běhy', icons.get('chevron-right', { className: 'ic-end' }))),
        h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', 'Datum'), h('th', 'Typ'), h('th.r', 'Vzdálenost'), h('th.r', 'Čas'), h('th.r', 'Tempo'), h('th.r', 'Úsilí'), h('th', 'Poznámka'))), h('tbody', rows))));

      // ---- form controls
      const timeInput = h('input.input.input-num', { type: 'text', inputmode: 'numeric', value: '21:02', 'data-key': 'kit-time' });
      const formCard = card('card-pad reveal', { style: { '--i': 6 } }, head('Formulář', 'pole, výběry, stupnice'),
        h('div.form',
          h('div.form-row',
            C.create('field', { label: 'Datum', control: h('input.input', { type: 'date', value: d.today }) }),
            C.create('field', { label: 'Typ běhu', control: h('select.select', ['run', 'easy', 'long', 'tempo', 'intervals', 'test5k', 'race'].map(c => h('option', { value: c }, VeyvoI18n.t('common.runType.' + c)))) })),
          h('div.form-row',
            C.create('field', { label: 'Vzdálenost', control: h('div.affix', h('input.input.input-num', { type: 'text', value: '5,0' }), h('span.affix-suffix', 'km')) }),
            C.create('field', { label: 'Čas', control: timeInput, hint: 'mm:ss nebo h:mm:ss' })),
          C.create('field', { label: 'Úsilí', control: C.create('scale', { value: 9, fill: true, label: 'Úsilí', lowLabel: 'lehké', highLabel: 'maximální' }) }),
          h('div.form-row',
            C.create('field', { label: 'Spánek', control: C.create('stepper', { value: 7.2, min: 0, max: 24, step: 0.5, decimals: 1, unit: 'h', label: 'Spánek' }) }),
            C.create('field', { label: 'Běžecké dny', control: C.create('dayToggles', { value: d.profile.days, label: 'Běžecké dny' }) })),
          C.create('field', { label: 'Poznámka', optional: '(volitelné)', control: h('textarea.textarea', { rows: 2, placeholder: 'Jak se běželo?' }) }),
          C.create('field', { label: 'Cílový čas', control: h('input.input', { value: '19:9', 'aria-invalid': 'true' }), error: 'Čas zadej jako mm:ss, např. 19:59.' }),
          h('div', { style: { display: 'flex', gap: '24px', flexWrap: 'wrap' } }, C.create('switch', { checked: true, label: 'Tmavý režim' }), h('label.check-row', h('input.check', { type: 'checkbox', checked: true }), h('span', 'Zapamatovat'))),
          C.create('range', { value: 6, min: 1, max: 10, label: 'Úsilí' })));

      // ---- buttons, chips, feedback
      const misc = card('card-pad reveal', { style: { '--i': 7 } }, head('Tlačítka a štítky'),
        h('div.btn-row', h('button.btn.btn-primary', { type: 'button' }, icons.get('check'), 'Uložit'), h('button.btn.btn-secondary', { type: 'button' }, 'Zrušit'),
          h('button.btn.btn-ghost', { type: 'button' }, icons.get('edit'), 'Upravit'), h('button.btn.btn-outline', { type: 'button' }, icons.get('download'), 'Export'),
          h('button.btn.btn-danger', { type: 'button' }, icons.get('trash'), 'Smazat'), h('button.btn.btn-primary.is-busy', { type: 'button' }, 'Ukládám'),
          h('button.btn.btn-secondary', { type: 'button', disabled: true }, 'Nedostupné'), h('button.icon-btn', { type: 'button', 'aria-label': 'Více' }, icons.get('more'))),
        h('div.btn-row', { style: { marginTop: '12px' } }, h('button.btn.btn-secondary.btn-sm', { type: 'button' }, icons.get('refresh'), 'Synchronizovat'), h('span.chip', 'za 3 dny'), h('span.chip.chip-accent', icons.get('flag'), 'Nejlepší 5 km'),
          h('span.chip.chip-cool', 'Dnes'), h('span.chip.chip-good', icons.get('check'), 'Splněno'), h('span.chip.chip-warn', 'Odpočinek'), h('span.chip.chip-plan', 'Plán'),
          h('span.badge-count', '3'), h('kbd.kbd', 'N')),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '14px' } }, ...['home', 'calendar', 'trend', 'checklist', 'settings', 'plus', 'play', 'check', 'x', 'chevron-right', 'arrow-right', 'flag', 'clock', 'route', 'gauge', 'heart', 'watch', 'download', 'upload', 'share', 'link', 'refresh', 'trash', 'edit', 'info', 'warning', 'moon', 'sun', 'language', 'user', 'more', 'filter', 'fork-knife', 'mountain', 'repeat', 'target'].map(n => h('span', { title: n, style: { color: 'var(--text-muted)' } }, icons.get(n)))),
        h('div', { style: { display: 'grid', gap: '10px', marginTop: '16px' } },
          C.create('callout', { kind: 'warn', title: 'Dnes raději odpočívej.', text: 'Únava 8/10 je vysoká, běh odlož.' }),
          C.create('callout', { kind: 'info', text: 'Tempa jsou odvozená z tvého nejlepšího času na 5 km.' }),
          h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center' } }, C.create('meter', { value: 4 }), C.create('meter', { value: 7, variant: 'accent', size: 'lg' }),
            h('div.bar', { style: { flex: 1 } }, h('span.bar-fill', { ref: el => motion.fillBar(el, g.fraction || 0.4, { delay: 200 }) })),
            charts.sparkline(d.weekly.map(w => w.distanceKm), { width: 120, height: 32, label: 'Týdenní objem' })),
          h('div.btn-row',
            h('button.btn.btn-secondary.btn-sm', { type: 'button', onClick: () => app.toast('Běh uložen.', { kind: 'success', action: { label: 'Vrátit', run: () => app.toast('Vráceno.') } }) }, 'Toast s akcí'),
            h('button.btn.btn-secondary.btn-sm', { type: 'button', onClick: () => app.confirm({ title: 'Smazat běh?', body: 'Běh z út 24. 11. zmizí ze všech přehledů.', confirmLabel: 'Smazat', danger: true }) }, 'Potvrzení'),
            h('button.btn.btn-secondary.btn-sm', { type: 'button', onClick: () => app.dialogs.create({ title: 'Boční panel', kind: 'sheet', body: C.create('skeleton', { lines: 4 }) }) }, 'Boční panel'))));
      const emptyCard = card('card-pad reveal', { style: { '--i': 8 } }, head('Prázdný stav a načítání'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' } },
          C.create('empty', { icon: 'route', title: 'Zatím žádný běh', text: 'Zapiš první běh nebo připoj Stravu. Přehled se pak vyplní tvými daty.', actions: [h('button.btn.btn-primary.btn-sm', { type: 'button', 'data-action': 'log-run' }, icons.get('plus'), 'Zapsat běh')] }),
          C.create('skeleton', { lines: 3 })));

      ctx.dom.mount(container,
        h('div', { class: 'grid-main-side' }, goalCard, nextCard),
        board,
        h('div', { class: 'grid-main-side' }, paceCard, volCard),
        h('div', { class: 'grid-main-side' }, tableCard, formCard),
        h('div', { class: 'grid-2' }, misc, emptyCard));

      charts.mount(lanesHost, o => charts.goalLanes(g, o));
      const paceChart = charts.mount(paceHost, o => charts.paceChart(d.runs, Object.assign({ goalPace: g.targetPace, range, today: d.today, bestRunId: g.bestRunId, height: 280 }, o)));
      charts.mount(volHost, o => charts.weeklyVolume(d.weekly.slice(-6), Object.assign({ planned: d.nextRun && d.nextRun.date && d.nextRun.date <= d.weekly[d.weekly.length - 1].weekEnd ? d.nextRun.distanceKm : 0, stackedByType: true, showCounts: true, height: 210 }, o)));
    }
  });
})();
