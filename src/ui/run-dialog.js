/*
 * ui/run-dialog.js - log, edit and view one run (concept A "Track").
 *
 * Dialogs (registered names, docs/ui-architecture.md section 6):
 *   run        { mode: 'new', date?, prefill?: { type, distance | distanceKm, movingSeconds, effort }, fromPlan? }
 *              { mode: 'edit', runId }                       -> run detail (home/plan open a run this way)
 *              { mode: 'edit', runId, direct: true }         -> straight into the edit form
 *   runLog     { date?, type?, distanceKm?, fromPlan?, prefill? } new run, or { runId } edit form
 *   runDetail  { runId }                                     the full run view
 *
 * One dialog swaps between four views: form (new / edit), result (after saving), detail.
 *  - Form: date (max today), type (7 codes), distance (decimal comma or dot), time ('21:02',
 *    '1:09:40', '69:40', also '21.02' and bare minutes '21'), effort 1-10 squares with descriptors,
 *    optional pain (stored as the last line of the note: VeyvoStore.validateRun has no pain field),
 *    note. Live pace, inline errors from VeyvoStore error codes, Strava twin check
 *    (VeyvoRuns.findDuplicate) that offers "Sloučit s během ze Stravy" instead of a second record.
 *  - Result: '5,0 km · 21:02 · 4:12 /km', personal-best banner from the derived notes (count-up)
 *    or a comparison with the most similar earlier run, the updated next run, "Do hodinek".
 *  - Detail: figures, effort meter (or "Doplnit úsilí"), Strava data, derived notes, pain, note;
 *    Upravit (form), Smazat (5 s undo toast; VeyvoStore.deleteRun puts Strava ids on the ignore list).
 * Every number comes from the run, the store or a documented formula (pace = time / distance).
 * Texts: i18n namespace 'run' (cs + en). CSS: styles/pages/run-dialog.css (prefix rd-).
 * Pure helpers for tests: VeyvoUI.runDialog.
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
  const NB = ' ';
  const doc = root.document;

  const TYPES = ['run', 'easy', 'long', 'tempo', 'intervals', 'test5k', 'race'];
  const PAIN_AREAS = ['knee', 'groin', 'calf', 'foot', 'other'];
  const BANDS = ['easy', 'moderate', 'hard', 'max'];
  const FAST = { run: 1, test5k: 1, race: 1 };
  const FIELD_OF = {
    'date-required': 'date', 'date-invalid': 'date', 'date-future': 'date', 'type-invalid': 'type',
    'distance-required': 'distance', 'distance-invalid': 'distance', 'distance-range': 'distance',
    'duration-required': 'time', 'duration-invalid': 'time', 'duration-range': 'time',
    'effort-invalid': 'effort', 'note-invalid': 'note', 'note-too-long': 'note'
  };
  const FIELD_ORDER = ['date', 'distance', 'time', 'type', 'effort', 'note'];

  // ================================================================ texts (namespace 'run')
  const MESSAGES = {
    cs: {
      title: { new: 'Zapsat běh', plan: 'Zapsat výsledek', edit: 'Upravit běh', saved: 'Běh je zapsaný', merged: 'Běh je sloučený' },
      eyebrow: { plan: 'Podle plánu · {date}', saved: 'Uloženo', merged: 'Sloučeno se Stravou' },
      form: {
        date: 'Datum', type: 'Typ běhu', distance: 'Vzdálenost', time: 'Čas', note: 'Poznámka',
        optional: 'nepovinné',
        distanceHint: 'Např. 5,2 nebo 5.2',
        timeHint: 'Např. 21:02 nebo 1:09:40',
        timeRead: 'Čteme jako {time}',
        distancePh: '0,0',
        timePh: 'mm:ss',
        notePh: 'Trasa, počasí, jak se běželo…',
        noteCount: '{n} z {max} znaků',
        fromPlan: 'Předvyplněno podle plánu: {what}.',
        formError: 'Běh se nepodařilo uložit: {message}'
      },
      pace: {
        label: 'Tempo',
        empty: 'Dopočítá se ze vzdálenosti a času.',
        goal: 'cílové tempo {pace}',
        faster: 'o {s} rychleji než cílové tempo {pace}',
        slower: 'o {s} pomaleji než cílové tempo {pace}',
        equal: 'přesně cílové tempo {pace}'
      },
      effort: {
        label: 'Úsilí',
        hint: 'Jak náročný běh byl. Podle úsilí se plánuje další běh.',
        band: { easy: 'lehce', moderate: 'středně', hard: 'těžce', max: 'maximum' },
        value: '{n}/10 · {band}',
        option: 'Úsilí {n}, {band}',
        clear: 'Vymazat',
        none: 'nezapsáno'
      },
      pain: {
        toggle: 'Bolest nebo nepohodlí',
        area: 'Kde',
        areas: { none: 'Nic', knee: 'Koleno', groin: 'Tříslo', calf: 'Lýtko / Achilovka', foot: 'Chodidlo', other: 'Jiné' },
        word: { knee: 'koleno', groin: 'tříslo', calf: 'lýtko / achilovka', foot: 'chodidlo', other: 'jiné místo' },
        prefix: 'Bolest',
        level: 'Síla bolesti',
        low: 'mírná',
        high: 'silná',
        option: 'Síla bolesti {n} z 10',
        summary: '{area} {level}/10',
        hint: 'Uloží se jako poslední řádek poznámky, takže ji uvidíš i v historii.'
      },
      dup: {
        stravaTitle: 'Tenhle běh už máš ze Stravy.',
        stravaText: '{name}: {distance} za {time}. Sloučením zůstane jeden záznam s tvým časem, typem, úsilím a poznámkou. Tep a převýšení zůstanou ze Stravy.',
        separate: 'Uložit jako samostatný běh',
        separateOn: 'Uloží se jako samostatný běh vedle záznamu ze Stravy.',
        mergeAgain: 'Přece jen sloučit',
        manualTitle: 'Podobný běh ze stejného dne už je zapsaný.',
        manualText: '{distance} za {time}. Zkontroluj, že ho nezapisuješ podruhé.',
        open: 'Otevřít zapsaný běh'
      },
      button: {
        save: 'Uložit běh', saveEdit: 'Uložit změny', merge: 'Sloučit s během ze Stravy', toWatch: 'Do hodinek',
        addEffort: 'Doplnit úsilí', showRun: 'Zobrazit běh'
      },
      discard: { title: 'Zahodit rozepsaný běh?', body: 'Vyplněné údaje se neuloží.', confirm: 'Zahodit', keep: 'Pokračovat v zápisu' },
      result: {
        summary: '{distance}, {time}, tempo {pace}',
        pb: 'Nový osobní rekord na 5 km o {s}',
        pbFirst: 'První měřená pětka',
        pbFrom: 'Předchozí rekord {time} z {date}',
        pbFirstSub: 'Další pětky se budou měřit proti tomuto času.',
        pbLabel: 'Osobní rekord',
        goal: 'Cíl splněn: {goal}',
        milestones: 'Milníky',
        compare: 'Proti podobnému běhu',
        timeFaster: 'O {s} rychleji než {what} {date} ({time}).',
        timeSlower: 'O {s} pomaleji než {what} {date} ({time}).',
        timeSame: 'Stejný čas jako {what} {date} ({time}).',
        paceFaster: 'Tempo o {s} rychlejší než {what} {date} ({distance}, {pace}).',
        paceSlower: 'Tempo o {s} pomalejší než {what} {date} ({distance}, {pace}).',
        paceSame: 'Stejné tempo jako {what} {date} ({distance}, {pace}).',
        compareNone: 'Zatím nemáš podobný běh, se kterým by šel porovnat.',
        next: 'Další běh',
        nextEasy: '{date} · {km} km lehce',
        nextBack: '{date} · {min}–{max} min lehce',
        nextPlanned: '{date} · {name}',
        nextPace: 'Tempo {fast}–{slow} /km',
        nextBackSub: 'Návrat po pauze: volně, podle pocitu, bez hlídání tempa.',
        nextRest: 'Odpočinek. Po úsilí 10/10 si dej volno a další běh zařaď, až se tělo zotaví.',
        nextNone: 'Další běh se naplánuje podle tvých běžeckých dnů.',
        advice: 'Podle dnešního check-inu dej přednost odpočinku ({reasons}).',
        reasonFatigue: 'únava {n}/10',
        reasonSoreness: 'bolest svalů {n}/10',
        reasonBoth: '{a}, {b}'
      },
      detail: {
        figures: 'Údaje běhu',
        effortMissing: 'Úsilí není zapsané.',
        effortMissingText: 'Bez něj plán nepozná, jak náročný běh byl.',
        effortPick: 'Vyber úsilí od 1 do 10',
        effortSaved: 'Úsilí uloženo.',
        hr: 'Průměrný tep',
        elevation: 'Převýšení',
        stravaTime: 'Čas ze Stravy',
        start: 'Začátek',
        stravaData: 'Ze Stravy',
        notes: 'Z tvých dat',
        note: 'Poznámka',
        pain: 'Bolest',
        notFound: 'Tento běh už v deníku není.',
        deleteLabel: 'Smazat běh'
      },
      notes: {
        firstRun: 'První zapsaný běh',
        personalBest5k: 'Osobní rekord na 5 km',
        personalBest5kBy: 'Osobní rekord na 5 km, o {s} rychleji',
        checkpoint: 'Poprvé pod {time}',
        goal: 'Cíl splněn',
        firstOver10k: 'Poprvé přes 10 km',
        longestRun: 'Nejdelší běh',
        longestRunBy: 'Nejdelší běh, o {km} km delší',
        distanceMilestone: 'Celkem {km} km'
      }
    },
    en: {
      title: { new: 'Log a run', plan: 'Log the result', edit: 'Edit run', saved: 'Run logged', merged: 'Run merged' },
      eyebrow: { plan: 'From the plan · {date}', saved: 'Saved', merged: 'Merged with Strava' },
      form: {
        date: 'Date', type: 'Run type', distance: 'Distance', time: 'Time', note: 'Note',
        optional: 'optional',
        distanceHint: 'e.g. 5.2 or 5,2',
        timeHint: 'e.g. 21:02 or 1:09:40',
        timeRead: 'Read as {time}',
        distancePh: '0.0',
        timePh: 'mm:ss',
        notePh: 'Route, weather, how it went…',
        noteCount: '{n} of {max} characters',
        fromPlan: 'Filled in from the plan: {what}.',
        formError: 'The run could not be saved: {message}'
      },
      pace: {
        label: 'Pace',
        empty: 'Calculated from distance and time.',
        goal: 'goal pace {pace}',
        faster: '{s} faster than goal pace {pace}',
        slower: '{s} slower than goal pace {pace}',
        equal: 'exactly goal pace {pace}'
      },
      effort: {
        label: 'Effort',
        hint: 'How hard the run felt. Your next run is planned from it.',
        band: { easy: 'easy', moderate: 'moderate', hard: 'hard', max: 'max' },
        value: '{n}/10 · {band}',
        option: 'Effort {n}, {band}',
        clear: 'Clear',
        none: 'not logged'
      },
      pain: {
        toggle: 'Pain or discomfort',
        area: 'Where',
        areas: { none: 'None', knee: 'Knee', groin: 'Groin', calf: 'Calf / Achilles', foot: 'Foot', other: 'Other' },
        word: { knee: 'knee', groin: 'groin', calf: 'calf / achilles', foot: 'foot', other: 'other area' },
        prefix: 'Pain',
        level: 'Pain level',
        low: 'mild',
        high: 'severe',
        option: 'Pain level {n} of 10',
        summary: '{area} {level}/10',
        hint: 'Saved as the last line of the note, so you also see it in your history.'
      },
      dup: {
        stravaTitle: 'This run is already in from Strava.',
        stravaText: '{name}: {distance} in {time}. Merging keeps one record with your time, type, effort and note. Heart rate and elevation stay from Strava.',
        separate: 'Save as a separate run',
        separateOn: 'It will be saved as a separate run next to the Strava record.',
        mergeAgain: 'Merge after all',
        manualTitle: 'A similar run on the same day is already logged.',
        manualText: '{distance} in {time}. Check that you are not logging it twice.',
        open: 'Open the logged run'
      },
      button: {
        save: 'Save run', saveEdit: 'Save changes', merge: 'Merge with the Strava run', toWatch: 'Send to watch',
        addEffort: 'Add effort', showRun: 'Show run'
      },
      discard: { title: 'Discard this run?', body: 'What you entered will not be saved.', confirm: 'Discard', keep: 'Keep editing' },
      result: {
        summary: '{distance}, {time}, pace {pace}',
        pb: 'New 5 km personal best by {s}',
        pbFirst: 'Your first timed 5 km',
        pbFrom: 'Previous best {time} from {date}.',
        pbFirstSub: 'Your next 5 km runs will be measured against this time.',
        pbLabel: 'Personal best',
        goal: 'Goal reached: {goal}',
        milestones: 'Milestones',
        compare: 'Against a similar run',
        timeFaster: '{s} faster than your {what} on {date} ({time}).',
        timeSlower: '{s} slower than your {what} on {date} ({time}).',
        timeSame: 'Same time as your {what} on {date} ({time}).',
        paceFaster: 'Pace {s} faster than your {what} on {date} ({distance}, {pace}).',
        paceSlower: 'Pace {s} slower than your {what} on {date} ({distance}, {pace}).',
        paceSame: 'Same pace as your {what} on {date} ({distance}, {pace}).',
        compareNone: 'No similar run to compare with yet.',
        next: 'Next run',
        nextEasy: '{date} · {km} km easy',
        nextBack: '{date} · {min}–{max} min easy',
        nextPlanned: '{date} · {name}',
        nextPace: 'Pace {fast}–{slow} /km',
        nextBackSub: 'Return after a break: relaxed, by feel, no pace targets.',
        nextRest: 'Rest. After a 10/10 effort take time off and plan the next run once your body has recovered.',
        nextNone: 'Your next run is planned from your running days.',
        advice: 'From today’s check-in, put rest first ({reasons}).',
        reasonFatigue: 'fatigue {n}/10',
        reasonSoreness: 'muscle soreness {n}/10',
        reasonBoth: '{a}, {b}'
      },
      detail: {
        figures: 'Run figures',
        effortMissing: 'Effort is not logged.',
        effortMissingText: 'Without it the plan cannot tell how hard the run was.',
        effortPick: 'Pick an effort from 1 to 10',
        effortSaved: 'Effort saved.',
        hr: 'Average heart rate',
        elevation: 'Elevation gain',
        stravaTime: 'Strava time',
        start: 'Start',
        stravaData: 'From Strava',
        notes: 'From your data',
        note: 'Note',
        pain: 'Pain',
        notFound: 'This run is no longer in your log.',
        deleteLabel: 'Delete run'
      },
      notes: {
        firstRun: 'First logged run',
        personalBest5k: '5 km personal best',
        personalBest5kBy: '5 km personal best, {s} faster',
        checkpoint: 'First time under {time}',
        goal: 'Goal reached',
        firstOver10k: 'First run over 10 km',
        longestRun: 'Longest run',
        longestRunBy: 'Longest run, {km} km longer',
        distanceMilestone: '{km} km in total'
      }
    }
  };
  I18n.register('run', MESSAGES);

  const t = (key, params) => app.t('run.' + key, params);
  const tc = (key, params) => app.t('common.' + key, params);

  // ================================================================ pure helpers (exported for tests)
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const clean = v => String(v === null || v === undefined ? '' : v).replace(/[\s ]+/g, '');

  /** What people type -> a clock string for VeyvoStore: '21.02' -> '21:02', '1.09.40' -> '1:09:40', '21' -> '21:00'. */
  function normalizeTime(text) {
    const s = clean(text);
    if (!s) return '';
    if (/^\d{1,3}$/.test(s)) return s + ':00';
    if (/^\d{1,3}[.,]\d{2}$/.test(s)) return s.replace(/[.,]/, ':');
    if (/^\d{1,2}[.,:]\d{2}[.,:]\d{2}$/.test(s)) return s.replace(/[.,]/g, ':');
    return s;
  }
  /** Seconds or null ('21:02' -> 1262, '1:09:40' and '69:40' -> 4180). Range is checked by the store. */
  function parseTime(text) {
    const s = normalizeTime(text);
    if (!s) return null;
    const v = Store.parseClockDuration(s);
    return v !== null && v > 0 ? v : null;
  }
  /** '5,2 km' -> '5,2' (the store accepts a decimal comma). */
  function normalizeDistance(text) { return clean(text).replace(/km$/i, ''); }
  function parseDistance(text) {
    const s = normalizeDistance(text).replace(',', '.');
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const n = Number(s);
    return n > 0 ? n : null;
  }
  /** 1-3 easy, 4-6 moderate, 7-8 hard, 9-10 max. */
  function effortBand(n) {
    if (!isNum(n)) return null;
    return n <= 3 ? 'easy' : n <= 6 ? 'moderate' : n <= 8 ? 'hard' : 'max';
  }

  function painWords() {
    const map = Object.create(null);
    for (const loc of ['cs', 'en']) for (const area of PAIN_AREAS) map[MESSAGES[loc].pain.word[area].toLowerCase()] = area;
    return map;
  }
  const PAIN_RE = new RegExp('^(?:' + MESSAGES.cs.pain.prefix + '|' + MESSAGES.en.pain.prefix + '):\\s*(.+?)(?:\\s+(\\d{1,2})\\s*/\\s*10)?\\s*$', 'i');
  /** Splits the pain line written by this dialog off the end of a note: { note, pain: { area, level } | null }. */
  function splitPain(note) {
    const text = typeof note === 'string' ? note : '';
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let i = lines.length - 1;
    while (i >= 0 && !lines[i].trim()) i--;
    if (i < 0) return { note: text.trim(), pain: null };
    const m = PAIN_RE.exec(lines[i].replace(/ /g, ' ').trim());
    const area = m ? painWords()[m[1].trim().toLowerCase()] : null;
    if (!area) return { note: text.trim(), pain: null };
    const level = m[2] === undefined ? null : Math.min(10, Number(m[2]));
    return { note: lines.slice(0, i).join('\n').trim(), pain: { area, level } };
  }
  /** The plain-text pain line ('Bolest: koleno 4/10') in the given locale. */
  function painLine(pain, locale) {
    const m = MESSAGES[locale === 'en' ? 'en' : 'cs'].pain;
    if (!pain || !m.word[pain.area]) return '';
    return m.prefix + ': ' + m.word[pain.area] + (isNum(pain.level) ? ' ' + pain.level + '/10' : '');
  }
  function joinNote(note, pain, locale) {
    const base = String(note || '').trim();
    const line = painLine(pain, locale);
    return line ? (base ? base + '\n' + line : line) : base;
  }

  /** Most similar earlier run: distance within 25 %, same type first, then same series group, newest on ties. */
  function similarRun(runs, run) {
    if (!run || !(run.distance > 0)) return null;
    const group = charts.groupOf(run.type);
    const before = r => r.date < run.date || (r.date === run.date && (r.startTime || '') < (run.startTime || ''));
    let best = null, bestScore = Infinity;
    for (const r of runs || []) {
      if (!r || r.id === run.id || !(r.distance > 0) || !(r.movingSeconds > 0) || !before(r)) continue;
      const rel = Math.abs(r.distance - run.distance) / run.distance;
      if (rel > 0.25) continue;
      const score = rel + (r.type === run.type ? 0 : charts.groupOf(r.type) === group ? 0.08 : 0.2);
      if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && best && r.date > best.date)) { best = r; bestScore = score; }
    }
    return best;
  }
  /** Time delta for the same distance (|delta| <= 50 m), otherwise pace delta per km. Negative = faster. */
  function compareRuns(run, other) {
    if (!run || !other) return null;
    if (Math.abs(run.distance - other.distance) <= 0.05) return { mode: 'time', delta: Math.round(run.movingSeconds - other.movingSeconds) };
    return { mode: 'pace', delta: Math.round(run.movingSeconds / run.distance - other.movingSeconds / other.distance) };
  }

  // ================================================================ small DOM helpers
  function sep() { return h('i.rd-sep', { 'aria-hidden': 'true' }); }
  function typeName(type) { return fmt.typo(charts.typeLabel(type)); }
  function typeLower(type) { return typeName(type).toLocaleLowerCase(I18n.getLocale() === 'en' ? 'en-GB' : 'cs-CZ'); }
  /** app.t with one parameter rendered as its own element (bold or animated number). */
  function richT(key, params, name, make) {
    const MARK = '\u0001';
    const full = app.t(key, Object.assign({}, params, { [name]: MARK }));
    const at = full.indexOf(MARK);
    if (at < 0) return [app.t(key, params)];
    const value = fmt.typo(String(params[name]));
    let after = full.slice(at + 1);
    if (/\d$/.test(value) && after[0] === ' ') after = NB + after.slice(1);
    return [full.slice(0, at), make(value), after];
  }
  function perKm(n) { return fmt.typo(n + ' s/km'); }
  /** '6,04 km' - up to two decimals for single runs (GPS distances), '5,0 km' for round ones. */
  function kmPrecise(n) { return Format.number(n, { minDecimals: 1, maxDecimals: 2 }); }
  function kmUnitPrecise(n) { return kmPrecise(n) + NB + I18n.t('common.unit.km'); }
  function kmInput(n) { return isNum(n) ? Format.number(n, { minDecimals: 1, maxDecimals: 3, grouping: false }) : ''; }
  function clampDate(key, today) { return Runs.isDateKey(key) ? (key > today ? today : key) : today; }

  /** Roving-tabindex keyboard for a row of buttons. select(i, viaKey) runs for arrows when `selectOnMove`. */
  function rovingKeys(group, buttons, onMove) {
    group.addEventListener('keydown', e => {
      const i = buttons.indexOf(doc.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      let next = null;
      if (step) next = (i + step + buttons.length) % buttons.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      if (next === null) return;
      e.preventDefault();
      buttons.forEach((b, j) => { b.tabIndex = j === next ? 0 : -1; });
      buttons[next].focus();
      if (onMove) onMove(next);
    });
  }

  function setHead(handle, title, eyebrow) {
    handle.setTitle(title);
    const titles = handle.head.querySelector('.dlg-titles');
    let eb = titles.querySelector('.eyebrow');
    if (!eyebrow) { if (eb) eb.remove(); return; }
    if (!eb) { eb = h('span.eyebrow'); titles.insertBefore(eb, titles.firstChild); }
    dom.mount(eb, eyebrow);
  }

  function enter(el) {
    if (!el || motion.prefersReduced() || typeof el.animate !== 'function') return;
    el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }

  function findRun(id) {
    const s = app.state();
    return (s && s.runHistory || []).find(r => r.id === id) || null;
  }

  function errorList(codes) {
    return (codes || []).map(code => (I18n.has('store.error.' + code) ? app.t('store.error.' + code) : code)).join(' ');
  }

  /** One-shot highlight of the run's row/card on the page behind the dialog (home, plan, progress). */
  function flashRun(runId) {
    setTimeout(() => {
      const main = doc.getElementById('main');
      if (!main || !runId) return;
      const el = Array.prototype.find.call(main.querySelectorAll('[data-key]'), n => {
        const k = n.getAttribute('data-key');
        return k === runId || k.slice(-(runId.length + 1)) === '-' + runId;
      });
      if (!el) return;
      const target = el.closest('tr') || el;
      if (target.tagName !== 'TR' && root.getComputedStyle(target).position === 'static') return;
      motion.flash(target);
    }, 240);
  }

  // ================================================================ dialog controller
  function open(params, forced) {
    const p = params || {};
    const runId = p.runId !== undefined && p.runId !== null ? String(p.runId) : null;
    const run = runId ? findRun(runId) : null;
    if (runId && !run) { app.toast(t('detail.notFound'), { kind: 'error' }); return null; }
    let view = forced || null;
    if (!view) {
      if (run) view = p.direct || p.view === 'form' ? 'edit' : 'detail';
      else view = 'new';
    }
    const ctl = { view: null, runId: run ? run.id : null, form: null, closing: false, afterClose: null, off: null, first: true, effortAnim: false };
    ctl.handle = app.dialogs.create({
      title: '', size: 'md', kind: 'modal', className: 'rd-dlg', body: null, actions: [],
      beforeClose() {
        if (ctl.closing || ctl.view !== 'form' || !ctl.form || !ctl.form.isDirty()) return true;
        app.confirm({ title: t('discard.title'), body: t('discard.body'), confirmLabel: t('discard.confirm'), cancelLabel: t('discard.keep'), danger: true })
          .then(ok => { if (ok) { ctl.closing = true; ctl.handle.close(); } });
        return false;
      },
      onClose() {
        if (ctl.off) ctl.off();
        if (ctl.afterClose) ctl.afterClose();
      }
    });
    ctl.off = app.on('state', () => {
      if (ctl.view === 'detail' && ctl.handle.isOpen()) showDetail(ctl, ctl.runId, { refresh: true });
    });
    if (view === 'detail') showDetail(ctl, run.id, {});
    else if (view === 'edit') showForm(ctl, { mode: 'edit', run, origin: null });
    else {
      const pre = Object.assign({}, p.prefill || {});
      if (p.type) pre.type = p.type;
      if (p.distanceKm !== undefined && p.distanceKm !== null) pre.distance = p.distanceKm;
      if ((pre.distance === undefined || pre.distance === null) && pre.distanceKm !== undefined) pre.distance = pre.distanceKm;
      const fromPlan = !!(p.fromPlan || p.prefill || p.type || p.distanceKm);
      showForm(ctl, { mode: 'new', date: p.date, prefill: pre, fromPlan, planDate: Runs.isDateKey(p.date) ? p.date : null });
    }
    return ctl.handle;
  }

  /** Swap the dialog content: { view, title, eyebrow, body, actions, focus, keepScroll, animate } */
  function show(ctl, v) {
    const handle = ctl.handle;
    const scroll = handle.body.scrollTop;
    ctl.view = v.view;
    handle.panel.setAttribute('data-view', v.view);
    setHead(handle, v.title, v.eyebrow);
    dom.mount(handle.body, v.body);
    dom.mount(handle.foot, v.actions || []);
    handle.body.scrollTop = v.keepScroll ? scroll : 0;
    if (!ctl.first && v.animate !== false) enter(handle.body);
    ctl.first = false;
    const target = v.focus === undefined ? handle.panel : v.focus;
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }

  // ================================================================ form view
  function showForm(ctl, cfg) {
    const form = buildForm(ctl, cfg);
    ctl.form = form;
    const title = cfg.mode === 'edit' ? t('title.edit') : cfg.fromPlan ? t('title.plan') : t('title.new');
    let eyebrow = null;
    if (cfg.mode === 'edit') eyebrow = fmt.date(cfg.run.date, 'long');
    else if (cfg.fromPlan) eyebrow = t('eyebrow.plan', { date: fmt.date(cfg.planDate || form.date(), 'short') });
    show(ctl, { view: 'form', title, eyebrow, body: form.el, actions: form.actions, focus: form.focusEl });
  }

  function buildForm(ctl, cfg) {
    const today = app.today();
    const isEdit = cfg.mode === 'edit';
    const run = cfg.run || null;
    const pre = cfg.prefill || {};
    const split = splitPain(run ? run.note : '');
    const profile = app.state().profile || {};
    const f = {
      date: run ? run.date : clampDate(cfg.date, today),
      type: run ? (Runs.typeCode(run.type) || 'run') : (TYPES.indexOf(pre.type) >= 0 ? pre.type : 'run'),
      distance: run ? kmInput(run.distance) : (isNum(Number(pre.distance)) && Number(pre.distance) > 0 ? kmInput(Number(pre.distance)) : ''),
      time: run ? Format.duration(run.movingSeconds) : (isNum(pre.movingSeconds) && pre.movingSeconds > 0 ? Format.duration(pre.movingSeconds) : ''),
      effort: run ? (isNum(run.effort) ? run.effort : null) : (Number.isInteger(pre.effort) && pre.effort >= 1 && pre.effort <= 10 ? pre.effort : null),
      painArea: split.pain ? split.pain.area : 'none',
      painLevel: split.pain ? split.pain.level : null,
      note: split.note,
      separate: false
    };
    const snapshot = JSON.stringify(f);
    let submitted = false;
    let busy = false;
    const uid = dom.uid('rd');
    const ids = { form: uid + '-form' };
    ['date', 'type', 'distance', 'time', 'effort', 'pain', 'note'].forEach(n => { ids[n] = uid + '-' + n; });
    const boxes = {};

    function describe(name) {
      const b = boxes[name];
      if (!b || !b.target) return;
      const list = [b.hint && !b.hint.hidden ? b.hint.id : null, !b.err.hidden ? b.err.id : null].filter(Boolean);
      if (list.length) b.target.setAttribute('aria-describedby', list.join(' ')); else b.target.removeAttribute('aria-describedby');
      if (!b.err.hidden) b.target.setAttribute('aria-invalid', 'true'); else b.target.removeAttribute('aria-invalid');
    }
    function setError(name, message) {
      const b = boxes[name];
      if (!b) return;
      if (message) { dom.mount(b.err, icons.get('warning'), h('span', message)); b.err.hidden = false; b.box.classList.add('has-error'); }
      else { b.err.hidden = true; b.err.replaceChildren(); b.box.classList.remove('has-error'); }
      describe(name);
    }
    /** label + control + hint + error, aria wired. o: { legend, optional, end, hint, target } */
    function fieldBox(name, label, control, o) {
      const opt = o || {};
      const labelId = ids[name] + '-label';
      const labelEl = h(opt.legend ? 'span.field-label' : 'label.field-label', { id: labelId, for: opt.legend ? null : ids[name] },
        h('span', label), opt.optional ? h('span.opt', t('form.optional')) : null, opt.end || null);
      const hint = opt.hint ? h('p.field-hint', { id: ids[name] + '-hint' }, opt.hint) : null;
      const err = h('p.field-error', { id: ids[name] + '-err', role: 'alert', hidden: true });
      const box = h('div.field.rd-field', { class: 'rd-f-' + name }, labelEl, control, hint, err);
      boxes[name] = { box, hint, err, target: opt.target || null };
      describe(name);
      return box;
    }

    // ------------------------------------------------ date
    const dateInput = h('input.input.rd-date', { id: ids.date, type: 'date', max: today, value: f.date, 'data-key': 'rd-date' });
    const dateRel = h('span.rd-label-end');
    const paintDate = () => { dateRel.textContent = Runs.isDateKey(dateInput.value) ? fmt.relDay(dateInput.value, today) : ''; };
    dateInput.addEventListener('input', () => { f.date = dateInput.value; paintDate(); changed('date'); });
    dateInput.addEventListener('change', () => { f.date = dateInput.value; paintDate(); changed('date'); });
    paintDate();

    // ------------------------------------------------ distance + time
    const distInput = h('input.input.input-num.input-lg.rd-num', {
      id: ids.distance, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
      placeholder: t('form.distancePh'), value: f.distance, 'data-key': 'rd-distance'
    });
    const timeInput = h('input.input.input-num.input-lg.rd-num', {
      id: ids.time, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
      placeholder: t('form.timePh'), value: f.time, 'data-key': 'rd-time'
    });
    const timeHintText = t('form.timeHint');
    distInput.addEventListener('input', () => { f.distance = distInput.value; changed('distance'); });
    timeInput.addEventListener('input', () => { f.time = timeInput.value; changed('time'); });
    timeInput.addEventListener('blur', () => {
      const s = parseTime(timeInput.value);
      if (s !== null && normalizeTime(timeInput.value) !== timeInput.value.trim()) { timeInput.value = Format.duration(s); f.time = timeInput.value; paintTimeRead(); }
    });
    distInput.addEventListener('blur', () => {
      const n = parseDistance(distInput.value);
      if (n !== null && normalizeDistance(distInput.value) !== distInput.value.trim()) { distInput.value = kmInput(n); f.distance = distInput.value; }
    });
    function paintTimeRead() {
      const s = parseTime(timeInput.value);
      const typed = timeInput.value.trim();
      const show = s !== null && typed && Format.duration(s) !== typed;
      const b = boxes.time;
      if (b && b.hint) b.hint.textContent = show ? t('form.timeRead', { time: Format.duration(s) }) : timeHintText;
    }

    // ------------------------------------------------ pace strip
    const paceVal = h('span.num.rd-pace-v');
    const paceCmp = h('span.rd-pace-cmp');
    const paceEl = h('div.rd-pace', h('span.eyebrow.rd-pace-l', t('pace.label')), paceVal, paceCmp);
    let paceShown = false;
    function paintPace() {
      const km = parseDistance(distInput.value), s = parseTime(timeInput.value);
      if (!km || !s) {
        paceVal.textContent = Format.EMPTY;
        paceCmp.textContent = t('pace.empty');
        paceEl.classList.add('is-empty');
        paceEl.classList.remove('is-warn');
        paceShown = false;
        return;
      }
      const pace = s / km;
      paceVal.replaceChildren(fmt.pace(pace), h('span.unit', NB + '/km'));
      paceEl.classList.remove('is-empty');
      if (!paceShown && !motion.prefersReduced() && typeof paceVal.animate === 'function') {
        paceVal.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      }
      paceShown = true;
      if (pace < 120) {
        paceEl.classList.add('is-warn');
        paceCmp.textContent = app.t('store.notice.paceImplausible');
        return;
      }
      paceEl.classList.remove('is-warn');
      const goalPace = profile.targetSeconds && profile.goalDistanceKm ? profile.targetSeconds / profile.goalDistanceKm : null;
      if (!goalPace || !FAST[f.type]) { paceCmp.replaceChildren(); return; }
      const delta = Math.round(pace - goalPace);
      const gp = fmt.paceUnit(goalPace);
      if (delta === 0) paceCmp.replaceChildren(h('b.accent-text', t('pace.equal', { pace: gp })));
      else if (delta < 0) paceCmp.replaceChildren(...richT('run.pace.faster', { s: perKm(-delta), pace: gp }, 's', v => h('b.accent-text', v)));
      else paceCmp.replaceChildren(...richT('run.pace.slower', { s: perKm(delta), pace: gp }, 's', v => h('b', v)));
    }

    // ------------------------------------------------ type
    const typeButtons = TYPES.map(code => h('button.rd-type', {
      type: 'button', role: 'radio', 'data-key': 'rd-type:' + code, dataset: { value: code }
    }, h('i', { class: 'dot dot-' + charts.groupOf(code), 'aria-hidden': 'true' }), h('span', typeName(code))));
    const typeGroup = h('div.rd-types', { role: 'radiogroup', id: ids.type, 'aria-labelledby': ids.type + '-label' }, typeButtons);
    function paintType() {
      typeButtons.forEach((b, i) => { const on = TYPES[i] === f.type; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    }
    function selectType(i) { if (f.type === TYPES[i]) return; f.type = TYPES[i]; paintType(); changed('type'); }
    typeButtons.forEach((b, i) => b.addEventListener('click', () => selectType(i)));
    rovingKeys(typeGroup, typeButtons, selectType);
    paintType();

    // ------------------------------------------------ effort
    const effortButtons = [];
    for (let v = 1; v <= 10; v++) {
      effortButtons.push(h('button', { type: 'button', role: 'radio', 'data-key': 'rd-effort:' + v, 'aria-label': t('effort.option', { n: v, band: t('effort.band.' + effortBand(v)) }) }, String(v)));
    }
    // --n-phone: two rows of five on a phone, so every square is at least 44 px wide
    const effortScale = h('div.scale.rd-scale', { role: 'radiogroup', 'aria-labelledby': ids.effort + '-label', id: ids.effort, style: { '--n': 10, '--n-phone': 5 } }, effortButtons);
    const bandEls = BANDS.map(b => h('span', { class: ['rd-band', 'rd-band-' + b] }, t('effort.band.' + b)));
    const bandRow = h('div.rd-bands', { 'aria-hidden': 'true' }, bandEls);
    const effortRead = h('span.rd-effort-read.num');
    const effortClear = h('button.btn-link.rd-clear', { type: 'button', 'data-key': 'rd-effort-clear' }, t('effort.clear'));
    const effortEnd = h('span.rd-label-end', effortRead, effortClear);
    function paintEffort() {
      const v = f.effort;
      effortButtons.forEach((b, i) => {
        const n = i + 1;
        b.setAttribute('aria-checked', n === v ? 'true' : 'false');
        b.classList.toggle('in-range', isNum(v) && n < v);
        b.tabIndex = n === v || (!isNum(v) && i === 0) ? 0 : -1;
      });
      const band = effortBand(v);
      bandEls.forEach((el, i) => el.classList.toggle('is-on', BANDS[i] === band));
      effortRead.textContent = isNum(v) ? fmt.typo(t('effort.value', { n: v, band: t('effort.band.' + band) })) : t('effort.none');
      effortRead.classList.toggle('is-set', isNum(v));
      effortClear.hidden = !isNum(v);
    }
    function selectEffort(i) { f.effort = i + 1; paintEffort(); changed('effort'); }
    effortButtons.forEach((b, i) => b.addEventListener('click', () => selectEffort(i)));
    rovingKeys(effortScale, effortButtons, selectEffort);
    effortClear.addEventListener('click', () => { f.effort = null; paintEffort(); changed('effort'); effortButtons[0].focus(); });
    paintEffort();

    // ------------------------------------------------ pain (optional, stored in the note)
    const painOptions = ['none'].concat(PAIN_AREAS);
    const painButtons = painOptions.map(a => h('button.rd-chip', { type: 'button', role: 'radio', 'data-key': 'rd-pain:' + a }, t('pain.areas.' + a)));
    const painGroup = h('div.rd-chips', { role: 'radiogroup', 'aria-label': t('pain.area') }, painButtons);
    const levelButtons = [];
    for (let v = 0; v <= 10; v++) levelButtons.push(h('button', { type: 'button', role: 'radio', 'data-key': 'rd-pain-level:' + v, 'aria-label': t('pain.option', { n: v }) }, String(v)));
    const levelScale = h('div.scale.rd-pain-scale', { role: 'radiogroup', 'aria-label': t('pain.level'), style: { '--n': 11, '--n-phone': 6 } }, levelButtons);
    const levelWrap = h('div.rd-pain-level',
      h('span.field-label', t('pain.level')),
      levelScale,
      h('div.scale-ends', { 'aria-hidden': 'true' }, h('span', t('pain.low')), h('span', t('pain.high'))));
    const painSummary = h('span.rd-disclose-sum');
    const painOpen = f.painArea !== 'none';
    const painBody = h('div.rd-pain-body', { id: ids.pain, hidden: !painOpen },
      h('div.rd-pain-area', h('span.field-label', t('pain.area')), painGroup), levelWrap, h('p.field-hint', t('pain.hint')));
    const painToggle = h('button.rd-disclose', { type: 'button', 'aria-expanded': painOpen ? 'true' : 'false', 'aria-controls': ids.pain, 'data-key': 'rd-pain-toggle' },
      h('span.rd-disclose-t', t('pain.toggle')), h('span.opt', t('form.optional')), painSummary, icons.get('chevron-down', { className: 'rd-chev', size: 16 }));
    function paintPain() {
      painButtons.forEach((b, i) => { const on = painOptions[i] === f.painArea; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      levelButtons.forEach((b, v) => {
        b.setAttribute('aria-checked', v === f.painLevel ? 'true' : 'false');
        b.classList.toggle('in-range', isNum(f.painLevel) && v < f.painLevel);
        b.tabIndex = v === f.painLevel || (!isNum(f.painLevel) && v === 0) ? 0 : -1;
      });
      levelWrap.hidden = f.painArea === 'none';
      const set = f.painArea !== 'none';
      painSummary.textContent = set ? (isNum(f.painLevel) ? fmt.typo(t('pain.summary', { area: t('pain.areas.' + f.painArea), level: f.painLevel })) : t('pain.areas.' + f.painArea)) : '';
      painToggle.classList.toggle('has-value', set);
    }
    function selectPain(i) {
      f.painArea = painOptions[i];
      if (f.painArea === 'none') f.painLevel = null;
      paintPain(); changed('pain');
    }
    function selectLevel(v) { f.painLevel = v; paintPain(); changed('pain'); }
    painButtons.forEach((b, i) => b.addEventListener('click', () => selectPain(i)));
    rovingKeys(painGroup, painButtons, selectPain);
    levelButtons.forEach((b, v) => b.addEventListener('click', () => selectLevel(v)));
    rovingKeys(levelScale, levelButtons, selectLevel);
    painToggle.addEventListener('click', () => {
      const openNow = painBody.hidden;
      painBody.hidden = !openNow;
      painToggle.setAttribute('aria-expanded', openNow ? 'true' : 'false');
      if (openNow) { enter(painBody); const on = painButtons.find(b => b.tabIndex === 0); if (on) on.focus({ preventScroll: true }); }
    });
    paintPain();

    // ------------------------------------------------ note
    const noteInput = h('textarea.textarea.rd-note-in', { id: ids.note, rows: 3, placeholder: t('form.notePh'), 'data-key': 'rd-note' });
    noteInput.value = f.note;
    const noteCount = h('span.rd-label-end.rd-count');
    function paintCount() {
      const n = Array.from(noteInput.value).length;
      noteCount.textContent = n > 800 ? t('form.noteCount', { n, max: Store.LIMITS.maxNote }) : '';
      noteCount.classList.toggle('is-over', n > Store.LIMITS.maxNote);
    }
    noteInput.addEventListener('input', () => { f.note = noteInput.value; paintCount(); changed('note'); });
    noteInput.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
    paintCount();

    // ------------------------------------------------ duplicate check + form-level messages
    const dupEl = h('div.rd-dup', { 'aria-live': 'polite' });
    const formError = h('div.rd-form-error', { role: 'alert', hidden: true });
    let lastDup = '';
    let dupTimer = null;
    function twins() {
      if (isEdit) return { strava: null, manual: null };
      const km = parseDistance(distInput.value), s = parseTime(timeInput.value), date = dateInput.value;
      if (!km || !s || !Runs.isDateKey(date)) return { strava: null, manual: null };
      const cand = { date, distance: km, movingSeconds: s, source: 'manual' };
      const runs = app.state().runHistory || [];
      const found = Runs.findDuplicate(runs, cand);
      const strava = found && found.source === 'strava' ? found : null;
      const manual = strava ? null : runs.find(r => r.source !== 'strava' && Store.isDuplicateRun(r, cand)) || null;
      return { strava, manual };
    }
    function paintDup() {
      const tw = twins();
      const key = tw.strava ? 's:' + tw.strava.id + ':' + f.separate : tw.manual ? 'm:' + tw.manual.id : '';
      saveLabel.textContent = isEdit ? t('button.saveEdit') : tw.strava && !f.separate ? t('button.merge') : t('button.save');
      dom.mount(saveIcon, icons.get(tw.strava && !f.separate ? 'link' : 'check'));
      if (key === lastDup) return;
      lastDup = key;
      if (!key) { dupEl.replaceChildren(); return; }
      let node;
      if (tw.strava && !f.separate) {
        const r = tw.strava;
        node = h('div.callout.callout-accent.rd-dup-box',
          icons.get('link'),
          h('div.rd-dup-main',
            h('b', t('dup.stravaTitle')),
            h('p', t('dup.stravaText', { name: r.name || tc('source.strava'), distance: kmUnitPrecise(r.distance), time: Format.duration(r.movingSeconds) })),
            h('button.btn-link.rd-dup-link', { type: 'button', 'data-key': 'rd-dup-separate', onClick: () => { f.separate = true; lastDup = ''; paintDup(); } }, t('dup.separate'))));
      } else if (tw.strava) {
        node = h('div.rd-dup-line', icons.get('info', { size: 15 }), h('span', t('dup.separateOn')),
          h('button.btn-link.rd-dup-link', { type: 'button', 'data-key': 'rd-dup-merge', onClick: () => { f.separate = false; lastDup = ''; paintDup(); } }, t('dup.mergeAgain')));
      } else {
        const r = tw.manual;
        node = h('div.callout.callout-warn.rd-dup-box',
          icons.get('warning'),
          h('div.rd-dup-main',
            h('b', t('dup.manualTitle')),
            h('p', t('dup.manualText', { distance: kmUnitPrecise(r.distance), time: Format.duration(r.movingSeconds) })),
            h('button.btn-link.rd-dup-link', { type: 'button', 'data-key': 'rd-dup-open', onClick: () => app.dialogs.open('runDetail', { runId: r.id }) }, t('dup.open'), icons.get('arrow-right', { className: 'ic-end' }))));
      }
      node.classList.add('rd-in');
      dupEl.replaceChildren(node);
    }

    // ------------------------------------------------ validation
    function collect() {
      const pain = f.painArea && f.painArea !== 'none' ? { area: f.painArea, level: f.painLevel } : null;
      return {
        date: dateInput.value.trim(),
        type: f.type,
        distance: normalizeDistance(distInput.value),
        time: normalizeTime(timeInput.value),
        effort: f.effort,
        note: joinNote(noteInput.value, pain, I18n.getLocale())
      };
    }
    function validate(input) {
      if (isEdit) return Store.updateRun(app.state(), run.id, input, { today }).errors || [];
      return Store.validateRun(input, { today }).errors || [];
    }
    function paintErrors(codes, only) {
      const byField = {};
      const general = [];
      codes.forEach(code => {
        const field = FIELD_OF[code];
        if (field) { if (!byField[field]) byField[field] = app.t('store.error.' + code); }
        else general.push(code);
      });
      FIELD_ORDER.forEach(name => { if (!only || only === name) setError(name, byField[name] || null); });
      if (!only) {
        if (general.length) { dom.mount(formError, h('div.callout.callout-danger', icons.get('warning'), h('div', t('form.formError', { message: errorList(general) })))); formError.hidden = false; }
        else { formError.hidden = true; formError.replaceChildren(); }
      }
    }
    function changed(name) {
      if (name === 'distance' || name === 'time') { paintPace(); paintTimeRead(); }
      if (name === 'type') paintPace();
      if (submitted) {
        const fieldName = name === 'pain' ? 'note' : name;
        paintErrors(validate(collect()), fieldName);
      }
      if (!isEdit && (name === 'distance' || name === 'time' || name === 'date')) {
        clearTimeout(dupTimer);
        dupTimer = setTimeout(paintDup, 220);
      }
    }
    function shake(el) {
      if (!el || motion.prefersReduced() || typeof el.animate !== 'function') return;
      el.animate([{ transform: 'none' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
    }
    const focusTarget = { date: () => dateInput, distance: () => distInput, time: () => timeInput, type: () => typeButtons.find(b => b.tabIndex === 0), effort: () => effortButtons.find(b => b.tabIndex === 0), note: () => noteInput };

    function submit() {
      if (busy) return;
      submitted = true;
      clearTimeout(dupTimer);
      paintDup();
      const input = collect();
      const codes = validate(input);
      paintErrors(codes);
      if (codes.length) {
        const first = FIELD_ORDER.find(n => codes.some(c => FIELD_OF[c] === n));
        if (first) { const el = focusTarget[first](); if (el) { el.focus(); shake(boxes[first].box); } }
        return;
      }
      busy = true;
      saveBtn.classList.add('is-busy');
      let r;
      if (isEdit) r = commitEdit(ctl, run, input);
      else {
        const tw = twins();
        r = tw.strava && !f.separate ? commitMerge(ctl, tw.strava, input) : commitAdd(ctl, input);
      }
      if (r && !r.ok) {
        busy = false;
        saveBtn.classList.remove('is-busy');
        paintErrors(r.errors && r.errors.length ? r.errors : ['input-invalid']);
      }
    }

    // ------------------------------------------------ layout
    const saveLabel = h('span', isEdit ? t('button.saveEdit') : t('button.save'));
    const saveIcon = h('span.rd-save-ic', icons.get('check'));
    const saveBtn = h('button.btn.btn-primary.rd-save', { type: 'submit', form: ids.form, 'data-key': 'rd-save' }, saveIcon, saveLabel);
    const cancelBtn = h('button.btn.btn-secondary', { type: 'button', 'data-key': 'rd-cancel' }, cfg.origin === 'detail' ? tc('button.back') : tc('button.cancel'));
    cancelBtn.addEventListener('click', () => {
      if (cfg.origin === 'detail') {
        const leave = () => showDetail(ctl, run.id, {});
        if (!form.isDirty()) { leave(); return; }
        app.confirm({ title: t('discard.title'), body: t('discard.body'), confirmLabel: t('discard.confirm'), cancelLabel: t('discard.keep'), danger: true }).then(ok => { if (ok) leave(); });
      } else ctl.handle.close();
    });

    const planNote = !isEdit && cfg.fromPlan && (pre.type || pre.distance)
      ? h('div.rd-plan-note', icons.get('calendar-check', { size: 15 }),
        h('span', t('form.fromPlan', { what: fmt.typo([TYPES.indexOf(pre.type) >= 0 ? typeLower(pre.type) : null, isNum(Number(pre.distance)) && Number(pre.distance) > 0 ? fmt.km(Number(pre.distance), { trim: true }) + ' ' + I18n.t('common.unit.km') : null].filter(Boolean).join(' ')) })))
      : null;

    const rowMain = h('div.rd-row',
      fieldBox('date', t('form.date'), dateInput, { end: dateRel, target: dateInput }),
      fieldBox('distance', t('form.distance'), h('div.affix.rd-affix', distInput, h('span.affix-suffix', I18n.t('common.unit.km'))), { hint: t('form.distanceHint'), target: distInput }),
      fieldBox('time', t('form.time'), timeInput, { hint: timeHintText, target: timeInput }));
    const formEl = h('form.form.rd-form', { id: ids.form, novalidate: true, tabindex: '-1', autocomplete: 'off' },
      formError,
      planNote,
      rowMain,
      paceEl,
      dupEl,
      fieldBox('type', t('form.type'), typeGroup, { legend: true }),
      fieldBox('effort', t('effort.label'), h('div.rd-effort', effortScale, bandRow), { legend: true, optional: true, end: effortEnd, hint: t('effort.hint'), target: effortScale }),
      h('div.rd-pain', painToggle, painBody),
      fieldBox('note', t('form.note'), noteInput, { optional: true, end: noteCount, target: noteInput }));
    formEl.addEventListener('submit', e => { e.preventDefault(); submit(); });
    paintTimeRead();
    paintPace();
    if (!isEdit) paintDup();

    const phone = app.isPhone();
    const focusEl = phone ? formEl : (isEdit ? null : (f.distance ? timeInput : distInput));
    const form = {
      el: formEl,
      actions: [cancelBtn, saveBtn],
      focusEl: focusEl || formEl,
      date: () => f.date,
      isDirty: () => !busy && JSON.stringify(Object.assign({}, f, { distance: distInput.value, time: timeInput.value, note: noteInput.value, date: dateInput.value })) !== snapshot,
      done() { busy = false; }
    };
    return form;
  }

  // ================================================================ commits
  function commitAdd(ctl, input) {
    const today = app.today();
    const r = app.update(s => Store.addRun(s, input, { today }), { reason: 'run-add' });
    if (!r.ok) return r;
    showResult(ctl, r.result.run.id, { merged: false });
    return r;
  }

  /** Manual entry onto its Strava twin: typed time/distance/type/effort/note win, Strava's time stays as stravaMovingSeconds. */
  function commitMerge(ctl, twin, input) {
    const today = app.today();
    const patch = { type: input.type, distance: input.distance, time: input.time };
    if (isNum(input.effort)) patch.effort = input.effort;
    if (input.note) patch.note = input.note;
    const r = app.update(s => {
      const res = Store.updateRun(s, twin.id, patch, { today });
      if (res.ok && !(Number(twin.stravaMovingSeconds) > 0)) {
        const stored = (res.state.runHistory || []).find(x => x.id === twin.id);
        if (stored) stored.stravaMovingSeconds = twin.movingSeconds;
      }
      return res;
    }, { reason: 'run-merge' });
    if (!r.ok) return r;
    showResult(ctl, twin.id, { merged: true });
    return r;
  }

  function commitEdit(ctl, run, input) {
    const today = app.today();
    const r = app.update(s => Store.updateRun(s, run.id, input, { today }), { reason: 'run-edit', toast: app.t('store.notice.runUpdated'), undo: true });
    if (!r.ok) return r;
    ctl.form = null;
    showDetail(ctl, run.id, { saved: true });
    return r;
  }

  function removeRun(ctl, run) {
    const view = ctl.view;
    ctl.view = 'deleting';
    const r = app.update(s => Store.deleteRun(s, run.id), { reason: 'run-delete' });
    if (!r.ok) { ctl.view = view; app.toast(errorList(r.errors), { kind: 'error' }); return; }
    ctl.closing = true;
    ctl.afterClose = null;
    ctl.handle.close('deleted');
    const token = r.result && r.result.undo;
    const strava = run.source === 'strava' || !!run.stravaActivityId;
    app.toast(app.t(strava ? 'store.notice.runDeletedStrava' : 'store.notice.runDeleted'), {
      kind: 'success', icon: 'trash', duration: 5000,
      action: token ? {
        label: app.t('ui.toast.undo'),
        run: () => {
          const u = app.update(s => Store.applyUndo(s, token), { reason: 'undo', toast: app.t('ui.toast.undone') });
          if (u.ok) flashRun(run.id);
        }
      } : null
    });
  }

  // ================================================================ result view
  function showResult(ctl, runId, opts) {
    const d = app.derived();
    const run = d.runs.find(r => r.id === runId);
    ctl.form = null;
    if (!run) { ctl.closing = true; ctl.handle.close(); return; }
    ctl.runId = runId;
    ctl.afterClose = () => flashRun(runId);
    const notes = resultNotes(Runs.notesOf(d.notes, runId), run, d);
    const blocks = [resultMain(run)];
    const pb = notes.find(n => n.code === 'personalBest5k');
    const others = notes.filter(n => n.code !== 'personalBest5k');
    if (pb) blocks.push(pbBanner(run, pb, others, d));
    else {
      const milestones = milestoneBlock(others);
      if (milestones) blocks.push(milestones);
      blocks.push(compareBlock(run, d));
    }
    blocks.push(nextBlock(d));
    blocks.forEach((b, i) => { b.classList.add('reveal'); b.style.setProperty('--i', String(i)); });
    const body = h('div.rd-result', blocks);

    const done = h('button.btn.btn-primary', { type: 'button', 'data-key': 'rd-done', onClick: () => ctl.handle.close('done') }, tc('button.done'));
    const showRun = h('button.btn.btn-ghost.dlg-foot-start', { type: 'button', 'data-key': 'rd-show', onClick: () => showDetail(ctl, runId, {}) }, t('button.showRun'));
    const actions = [showRun];
    const watch = watchParams(d);
    if (watch && app.dialogs.has('workout')) {
      actions.push(h('button.btn.btn-secondary', {
        type: 'button', 'data-key': 'rd-watch',
        onClick: () => {
          ctl.afterClose = null;
          ctl.handle.close('watch');
          setTimeout(() => app.dialogs.open('workout', watch), 220);
        }
      }, icons.get('watch'), t('button.toWatch')));
    }
    actions.push(done);
    const eyebrow = h('span.rd-eb-ok', icons.get('check', { size: 14 }), h('span', t(opts.merged ? 'eyebrow.merged' : 'eyebrow.saved')));
    show(ctl, { view: 'result', title: t(opts.merged ? 'title.merged' : 'title.saved'), eyebrow, body, actions, focus: done });
  }

  function resultMain(run) {
    const pace = run.movingSeconds / run.distance;
    const meta = [h('span', typeName(run.type))];
    meta.push(sep(), h('span', fmt.date(run.date, 'short')));
    if (isNum(run.effort)) meta.push(sep(), h('span', fmt.typo(app.t('run.effort.label') + ' ' + t('effort.value', { n: run.effort, band: t('effort.band.' + effortBand(run.effort)) }))));
    const pain = splitPain(run.note).pain;
    if (pain) meta.push(sep(), h('span.rd-meta-pain', fmt.typo(painLine(pain, I18n.getLocale()))));
    return h('div.rd-res',
      h('p.rd-res-line.num', { 'aria-label': t('result.summary', { distance: kmUnitPrecise(run.distance), time: Format.duration(run.movingSeconds), pace: fmt.paceUnit(pace) }) },
        h('span', { 'aria-hidden': 'true' }, kmPrecise(run.distance), h('span.unit', NB + 'km')),
        h('i.rd-res-sep', { 'aria-hidden': 'true' }),
        h('span', { 'aria-hidden': 'true' }, Format.duration(run.movingSeconds)),
        h('i.rd-res-sep', { 'aria-hidden': 'true' }),
        h('span', { 'aria-hidden': 'true' }, fmt.pace(pace), h('span.unit', NB + '/km'))),
      h('p.rd-res-meta', h('i', { class: 'dot dot-' + charts.groupOf(run.type), 'aria-hidden': 'true' }), meta));
  }

  function noteText(n) {
    const p = n.params || {};
    switch (n.code) {
      case 'personalBest5k': return isNum(p.improvementSeconds) ? t('notes.personalBest5kBy', { s: fmt.seconds(p.improvementSeconds) }) : t('notes.personalBest5k');
      case 'checkpoint': return p.isGoal ? t('notes.goal') : t('notes.checkpoint', { time: Format.duration(p.seconds) });
      case 'firstOver10k': return t('notes.firstOver10k');
      case 'longestRun': return isNum(p.deltaKm) ? t('notes.longestRunBy', { km: fmt.km(p.deltaKm, { trim: true }) }) : t('notes.longestRun');
      case 'distanceMilestone': return t('notes.distanceMilestone', { km: Format.number(p.km, { grouping: true }) });
      case 'firstRun': return t('notes.firstRun');
      default: return '';
    }
  }
  function noteChip(n) {
    const hot = n.code === 'personalBest5k' || (n.code === 'checkpoint' && n.params && n.params.isGoal);
    const icon = n.code === 'personalBest5k' || n.code === 'checkpoint' ? 'flag' : n.code === 'distanceMilestone' ? 'route' : n.code === 'firstRun' ? 'play' : 'trend';
    return h('span', { class: ['chip', hot ? 'chip-accent' : null, 'rd-note-chip'] }, icons.get(icon), noteText(n));
  }

  /** Previous 5 km best before this run (date + time), from the chronological progression. */
  function previousBest(d, runId) {
    const prog = Runs.fiveKProgression(d.runs);
    const at = prog.findIndex(x => x.runId === runId);
    for (let i = at - 1; i >= 0; i--) if (prog[i].isPersonalBest) return prog[i];
    return null;
  }

  function pbBanner(run, pb, others, d) {
    const p = pb.params || {};
    const prev = previousBest(d, run.id);
    const goalHit = others.find(n => n.code === 'checkpoint' && n.params && n.params.isGoal);
    const rest = others.filter(n => n !== goalHit && n.code !== 'firstRun');
    const box = h('section.rd-pb', { 'aria-labelledby': 'rd-pb-t' });
    const head = h('div.rd-pb-head', icons.get('flag'), h('span.eyebrow', t('result.pbLabel')));
    let title, times = null, sub;
    if (isNum(p.improvementSeconds) && isNum(p.previousBest)) {
      let numEl = null;
      title = h('p.rd-pb-title#rd-pb-t', richT('run.result.pb', { s: fmt.seconds(p.improvementSeconds) }, 's', v => (numEl = h('span.num.rd-pb-delta', v))));
      const newEl = h('span.rd-pb-new', Format.duration(run.movingSeconds));
      times = h('div.rd-pb-times.num', { 'aria-hidden': 'true' }, h('span.rd-pb-old', Format.duration(p.previousBest)), icons.get('arrow-right'), newEl);
      sub = prev ? t('result.pbFrom', { time: Format.duration(prev.seconds), date: fmt.date(prev.date, 'short') }) : null;
      const delay = 180;
      (root.requestAnimationFrame || setTimeout)(() => {
        if (numEl) motion.countUp(numEl, p.improvementSeconds, { from: 0, duration: 450, delay, format: v => fmt.seconds(Math.round(v)) });
        motion.countUp(newEl, run.movingSeconds, { from: p.previousBest, duration: 450, delay, format: v => Format.duration(Math.round(v)) });
      });
    } else {
      title = h('p.rd-pb-title#rd-pb-t', t('result.pbFirst'), ': ', h('span.num.rd-pb-delta', Format.duration(run.movingSeconds)));
      sub = t('result.pbFirstSub');
    }
    box.append(head, title);
    if (times) box.append(times);
    if (sub) box.append(h('p.rd-pb-sub', sub));
    if (goalHit) box.append(h('p.rd-pb-goal', icons.get('check-circle'), h('span', t('result.goal', { goal: fmt.goal(d.profile) }))));
    // The Track lanes (previous best vs this best vs the goal) when this run is the current best.
    if (d.goal && d.goal.bestRunId === run.id && Number(d.goal.distanceKm || 5) === 5) {
      const host = h('div.rd-pb-lanes');
      box.append(host);
      (root.requestAnimationFrame || setTimeout)(() => charts.mount(host, o => charts.goalLanes(d.goal, Object.assign({ laneHeight: 26 }, o))));
    }
    if (rest.length) box.append(h('div.rd-note-chips', rest.map(noteChip)));
    return box;
  }

  function milestoneBlock(notes) {
    const list = notes.filter(n => n.code !== 'firstRun' || notes.length === 1);
    if (!list.length) return null;
    return h('div.rd-miles', h('span.eyebrow', t('result.milestones')), h('div.rd-note-chips', list.map(noteChip)));
  }

  function compareBlock(run, d) {
    const other = similarRun(d.runs, run);
    if (!other) return h('div.rd-cmp', icons.get('bar-chart'), h('p', t('result.compareNone')));
    const c = compareRuns(run, other);
    const what = typeLower(other.type);
    const date = fmt.date(other.date, 'short');
    let key, params, name;
    if (c.mode === 'time') {
      key = c.delta < 0 ? 'timeFaster' : c.delta > 0 ? 'timeSlower' : 'timeSame';
      params = { s: fmt.seconds(Math.abs(c.delta)), what, date, time: Format.duration(other.movingSeconds) };
      name = 's';
    } else {
      key = c.delta < 0 ? 'paceFaster' : c.delta > 0 ? 'paceSlower' : 'paceSame';
      params = { s: perKm(Math.abs(c.delta)), what, date, distance: kmUnitPrecise(other.distance), pace: fmt.paceUnit(other.movingSeconds / other.distance) };
      name = 's';
    }
    const faster = c.delta < 0;
    const text = c.delta === 0 ? [app.t('run.result.' + key, params)] : richT('run.result.' + key, params, name, v => h(faster ? 'b.accent-text' : 'b', v));
    return h('div.rd-cmp', icons.get(faster ? 'trend' : 'bar-chart'),
      h('div', h('span.eyebrow', t('result.compare')), h('p', text)));
  }

  /**
   * resultNotes(notes, run, derived): the notes the result view celebrates. A forgotten run logged
   * later (backdated) keeps its historical notes in the run log, but "new record" / "longest run" /
   * milestones only show while this run still holds the record, or when it is the latest run.
   */
  function resultNotes(notes, run, d) {
    const records = (d && d.records) || {};
    const holds = rec => !!rec && rec.runId === run.id;
    const latest = !!(d && d.latestRun && d.latestRun.id === run.id);
    return (notes || []).filter(n => {
      if (n.code === 'personalBest5k') return holds(records.fastest5k);
      if (n.code === 'longestRun') return holds(records.longestRun);
      if (n.code === 'checkpoint') return latest || (!!d.goal && d.goal.bestRunId === run.id);
      if (n.code === 'firstOver10k' || n.code === 'distanceMilestone' || n.code === 'firstRun') return latest;
      return true;
    });
  }

  /** Params for the workout sheet ("Do hodinek"): the next session everyone shows (derived.nextSession). */
  function watchParams(d) {
    const ns = d && d.nextSession;
    if (!ns || !ns.workout) return null;
    const params = { workout: JSON.parse(JSON.stringify(ns.workout)) };
    if (ns.date) params.date = ns.date;
    if (ns.templateId) params.templateId = ns.templateId;
    return params;
  }

  function nextLine(d) {
    const ns = d.nextSession;
    // A library session booked before the engine's run comes first (home, plan and the nav badge agree).
    if (ns && ns.source === 'planned' && ns.date) {
      const tpl = ns.planned && ns.planned.template;
      const name = tpl ? I18n.t(tpl.nameKey, tpl.params) : String((ns.workout && ns.workout.name) || '');
      return { line: t('result.nextPlanned', { date: fmt.date(ns.date, 'short'), name: fmt.typo(name) }), sub: null, rel: fmt.relDay(ns.date, d.today) };
    }
    const nr = d.nextRun;
    if (!nr) return { line: t('result.nextNone'), sub: null, rel: null };
    if (nr.kind === 'rest' || !nr.date) return { line: nr.kind === 'rest' ? t('result.nextRest') : t('result.nextNone'), sub: null, rel: null };
    const date = fmt.date(nr.date, 'short');
    const rel = fmt.relDay(nr.date, d.today);
    const planned = (d.planned || []).find(p => p.date === nr.date && p.template);
    if (planned) return { line: t('result.nextPlanned', { date, name: fmt.typo(I18n.t(planned.template.nameKey, planned.template.params)) }), sub: null, rel };
    if (nr.returnAfterBreak) return { line: t('result.nextBack', { date, min: nr.durationMin, max: nr.durationMax }), sub: t('result.nextBackSub'), rel };
    const sub = isNum(nr.paceFast) && isNum(nr.paceSlow) ? t('result.nextPace', { fast: fmt.pace(nr.paceFast), slow: fmt.pace(nr.paceSlow) }) : null;
    return { line: t('result.nextEasy', { date, km: fmt.km(nr.distanceKm, { trim: true }) }), sub, rel };
  }

  function adviceText(a) {
    const parts = [];
    if (isNum(a.fatigue) && a.fatigue >= 8) parts.push(t('result.reasonFatigue', { n: a.fatigue }));
    if (isNum(a.soreness) && a.soreness >= 7) parts.push(t('result.reasonSoreness', { n: a.soreness }));
    const reasons = parts.length === 2 ? t('result.reasonBoth', { a: parts[0], b: parts[1] }) : parts[0] || '';
    return t('result.advice', { reasons });
  }

  function nextBlock(d) {
    const n = nextLine(d);
    return h('section.rd-next', { 'aria-labelledby': 'rd-next-t' },
      h('div.rd-next-head', h('span.eyebrow#rd-next-t', t('result.next')), n.rel ? h('span.chip.chip-sm.rd-next-rel', n.rel) : null),
      h('p.rd-next-line', n.line),
      n.sub ? h('p.rd-next-sub', n.sub) : null,
      d.recoveryAdvice ? h('p.rd-next-advice', icons.get('warning', { size: 15 }), h('span', adviceText(d.recoveryAdvice))) : null);
  }

  // ================================================================ detail view
  function figure(label, value, unit, cls) {
    return h('div', { class: ['rd-fig', cls] }, h('span.rd-fig-l', label), h('span.num.rd-fig-v', value, unit ? h('span.unit', NB + unit) : null));
  }

  function showDetail(ctl, runId, o) {
    const opts = o || {};
    const d = app.derived();
    const run = d.runs.find(r => r.id === runId) || null;
    ctl.form = null;
    if (!run) {
      if (ctl.handle.isOpen()) { ctl.closing = true; ctl.handle.close(); }
      return;
    }
    ctl.runId = runId;
    ctl.afterClose = () => flashRun(runId);
    const split = splitPain(run.note);
    const notes = Runs.notesOf(d.notes, runId);
    const strava = run.source === 'strava' || !!run.stravaActivityId;
    const typeLabel = typeName(run.type);
    const pace = run.movingSeconds / run.distance;
    const isBest = d.records && d.records.fastest5k && d.records.fastest5k.runId === run.id;

    const figs = h('div.rd-figs', { role: 'group', 'aria-label': t('detail.figures') },
      figure(tc('field.distance'), kmPrecise(run.distance), I18n.t('common.unit.km')),
      figure(tc('field.time'), Format.duration(run.movingSeconds), null, isBest ? 'is-best' : null),
      figure(tc('field.pace'), fmt.pace(pace), '/km'));
    const tags = h('div.rd-tags',
      run.name ? app.components.create('typeTag', { type: run.type }) : null,
      h('span', { class: ['chip', strava ? 'chip-cool' : null] }, icons.get(strava ? 'link' : 'edit'), tc('source.' + (strava ? 'strava' : 'manual'))),
      run.startTime ? h('span.chip', icons.get('clock'), t('detail.start') + ' ' + run.startTime) : null);

    const blocks = [figs, tags, effortSection(ctl, run)];
    const metrics = [];
    if (isNum(run.averageHeartrate)) metrics.push(figure(t('detail.hr'), Format.number(Math.round(run.averageHeartrate)), I18n.t('common.unit.bpm'), 'rd-fig-sm'));
    if (isNum(run.elevationGain)) metrics.push(figure(t('detail.elevation'), Format.number(Math.round(run.elevationGain)), I18n.t('common.unit.m'), 'rd-fig-sm'));
    if (isNum(run.stravaMovingSeconds) && run.stravaMovingSeconds !== run.movingSeconds) metrics.push(figure(t('detail.stravaTime'), Format.duration(run.stravaMovingSeconds), null, 'rd-fig-sm'));
    if (metrics.length) blocks.push(h('section.rd-sec', h('h3.eyebrow.rd-sec-t', t('detail.stravaData')), h('div.rd-kv', metrics)));
    const chips = notes.map(noteChip);
    if (split.pain) chips.push(h('span.chip.chip-warn.rd-note-chip', icons.get('warning'), fmt.typo(painLine(split.pain, I18n.getLocale()))));
    if (chips.length) blocks.push(h('section.rd-sec', h('h3.eyebrow.rd-sec-t', t('detail.notes')), h('div.rd-note-chips', chips)));
    if (split.note) blocks.push(h('section.rd-sec', h('h3.eyebrow.rd-sec-t', t('detail.note')), h('p.rd-note', split.note)));

    const del = h('button.btn.btn-danger.dlg-foot-start', { type: 'button', 'data-key': 'rd-delete', 'aria-label': t('detail.deleteLabel') + ', ' + fmt.date(run.date, 'long'), onClick: () => removeRun(ctl, run) }, icons.get('trash'), tc('button.delete'));
    const edit = h('button.btn.btn-secondary', { type: 'button', 'data-key': 'rd-edit', onClick: () => showForm(ctl, { mode: 'edit', run, origin: 'detail' }) }, icons.get('edit'), tc('button.edit'));
    const eyebrow = fmt.date(run.date, 'long');
    const body = h('div.rd-detail', blocks);
    if (opts.refresh) {
      const active = doc.activeElement;
      const key = active && ctl.handle.el.contains(active) ? active.getAttribute('data-key') : null;
      show(ctl, { view: 'detail', title: run.name || typeLabel, eyebrow, body, actions: [del, edit], animate: false, keepScroll: true, focus: null });
      const target = key ? ctl.handle.el.querySelector('[data-key="' + (root.CSS && CSS.escape ? CSS.escape(key) : key) + '"]') : null;
      (target || ctl.handle.panel).focus({ preventScroll: true });
      return;
    }
    if (!ctl.first) blocks.forEach((b, i) => { b.classList.add('reveal'); b.style.setProperty('--i', String(i)); });
    show(ctl, { view: 'detail', title: run.name || typeLabel, eyebrow, body, actions: [del, edit], animate: !opts.saved, focus: opts.saved ? edit : undefined });
    if (opts.saved) motion.flash(figs);
  }

  function effortSection(ctl, run) {
    const sec = h('section.rd-sec.rd-effort-sec');
    const title = h('h3.eyebrow.rd-sec-t', t('effort.label'));
    if (isNum(run.effort)) {
      const animate = ctl.effortAnim === run.id;
      ctl.effortAnim = false;
      const band = effortBand(run.effort);
      sec.append(title, h('div.rd-effort-row',
        charts.meter(run.effort, 10, { size: 'lg', animate, label: t('effort.option', { n: run.effort, band: t('effort.band.' + band) }) }),
        h('span.num.rd-effort-v', String(run.effort), h('small', '/10')),
        h('span.rd-effort-band', t('effort.band.' + band))));
      return sec;
    }
    const pick = h('div.rd-quick', { hidden: true });
    const add = h('button.btn.btn-secondary.btn-sm', { type: 'button', 'data-key': 'rd-add-effort', 'aria-expanded': 'false' }, icons.get('plus'), t('button.addEffort'));
    const buttons = [];
    for (let v = 1; v <= 10; v++) {
      buttons.push(h('button', {
        type: 'button', 'data-key': 'rd-quick:' + v, tabindex: v === 1 ? '0' : '-1',
        'aria-label': t('effort.option', { n: v, band: t('effort.band.' + effortBand(v)) }),
        onClick: () => {
          ctl.effortAnim = run.id;
          const today = app.today();
          const r = app.update(s => Store.updateRun(s, run.id, { effort: v }, { today }), { reason: 'run-effort', toast: t('detail.effortSaved'), undo: true });
          if (!r.ok) { ctl.effortAnim = false; app.toast(errorList(r.errors), { kind: 'error' }); }
        }
      }, String(v)));
    }
    const scale = h('div.scale.rd-scale', { role: 'group', 'aria-label': t('detail.effortPick') }, buttons);
    rovingKeys(scale, buttons, null);
    pick.append(scale, h('div.rd-bands', { 'aria-hidden': 'true' }, BANDS.map(b => h('span', { class: ['rd-band', 'rd-band-' + b] }, t('effort.band.' + b)))));
    add.addEventListener('click', () => {
      pick.hidden = false;
      add.setAttribute('aria-expanded', 'true');
      add.hidden = true;
      enter(pick);
      buttons[0].focus({ preventScroll: true });
    });
    sec.classList.add('is-missing');
    sec.append(title, h('div.rd-missing', icons.get('gauge'), h('div.rd-missing-t', h('b', t('detail.effortMissing')), h('span', t('detail.effortMissingText'))), add), pick);
    return sec;
  }

  // ================================================================ registration
  app.dialogs.register('run', { open: params => open(params) });
  app.dialogs.register('runLog', { open: params => open(params, params && params.runId ? 'edit' : 'new') });
  app.dialogs.register('runDetail', { open: params => open(params, 'detail') });

  UI.runDialog = {
    normalizeTime, parseTime, normalizeDistance, parseDistance, effortBand, splitPain, painLine, joinNote,
    similarRun, compareRuns, resultNotes, watchParams, nextLine, MESSAGES
  };
})(globalThis);
