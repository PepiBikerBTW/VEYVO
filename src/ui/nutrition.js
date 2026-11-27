/*
 * ui/nutrition.js - Před během / Before the run page (port of the 0.3 nutrition-ui.js into concept A "Track").
 *
 * Layout (one title only: the topbar <h1>):
 *   1. "Tvůj běh" form row: distance 5 / 6 / 10 / 21,1 / 42,2 km, expected time (min), time to the start
 *      (2-4 h / 1-2 h / < 1 h), optional start time, and "Podle dalšího běhu" (prefill from
 *      app.derived().nextSession: nearest distance option + the estimated minutes).
 *   2. [Preparation: the distance's text, the meal for the chosen time to the start with numbered food
 *      options | On the course: carbohydrate bands by duration (the runner's band highlighted), the
 *      source sentence, late-start warning, drinks, and the fuel calculator for runs > 75 min]
 *   3. Preparation timeline: a horizontal time axis (vertical on phones) counted back from the start,
 *      the current phase ("Teď") following the time-to-start choice; clock times once a start is set.
 *   4. [Checklist with animated check marks + progress fill, reset with undo | own notes]
 *   5. Sources and principles (NSWIS, AIS, Cleveland Clinic; "ověřeno 1. 10. 2026").
 *
 * Data: localStorage 'veyvo-pre-run-v1' in the 0.3 format ({ nutritionDistance, nutritionMinutes,
 * nutritionTiming, nutritionStart, nutritionRate, nutritionServing, nutritionNotes, checks: { meal,
 * drink, fuel, route, gear } }, all strings except checks), so the owner's saved checklist and notes
 * survive. Every edit saves at once; the page keeps the values in module state and writes them back on
 * every render. Content comes from VeyvoNutrition (src/nutrition-context.js) and is shown through
 * VeyvoI18n (namespace 'nutrition', the guide texts under 'nutrition.guide'). External source links
 * open through the main-process allowlist on desktop (<a target="_blank">) and through
 * VeyvoPlatform.openExternal on Android. CSS: styles/pages/nutrition.css (prefix nut-).
 *
 * Pure helpers for tests: VeyvoUI.nutrition.{ valuesOf, serialize, calcState, phaseRows, nextSuggestion,
 * SOURCES, MESSAGES }.
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI;
  const app = UI.app;
  const I18n = root.VeyvoI18n;
  const N = root.VeyvoNutrition;
  const Workouts = root.VeyvoWorkouts;
  const fmt = UI.fmt;
  const NB = '\u00a0';
  const F = N.FIELDS, L = N.LIMITS;

  /** Must match NUTRITION_SOURCES in electron/main.js exactly (the window-open allowlist). */
  const SOURCES = Object.freeze([
    Object.freeze({ id: 'nswis', url: 'https://www.nswis.com.au/nswis-news/food-choices-for-the-run-in-to-competition/' }),
    Object.freeze({ id: 'ais', url: 'https://www.ausport.gov.au/ais/nutrition/supplements/group_a/sports-foods2/sports-drink/how-and-when-do-i-use-it' }),
    Object.freeze({ id: 'cleveland', url: 'https://health.clevelandclinic.org/what-to-eat-when-youre-training-for-a-marathon' })
  ]);

  // ================================================================ texts (namespace 'nutrition')
  const CS = {
    form: {
      title: 'Tvůj běh',
      distance: 'Vzdálenost',
      minutes: 'Očekávaný čas',
      minutesUnit: 'min',
      timing: 'Do startu zbývá',
      start: 'Čas startu',
      optional: 'volitelné',
      hint: 'Čas zadej podle svého tempa. Vzdálenost sama nestačí k určení občerstvení.',
      minutesError: 'Zadej očekávanou délku běhu 10–720 minut.'
    },
    timing: { meal: '2–4 h', snack: '1–2 h', soon: 'do 1 h' },
    timingLong: { meal: '2–4 hodiny do startu', snack: '1–2 hodiny do startu', soon: 'méně než hodina do startu' },
    next: {
      text: 'Další běh {date}: {name}, asi {minutes} min',
      apply: 'Podle dalšího běhu',
      applyAria: 'Vyplnit vzdálenost a čas podle dalšího běhu: {name}, asi {minutes} min',
      applied: 'Vyplněno podle dalšího běhu: {distance}, {minutes} min.',
      matches: 'Odpovídá dalšímu běhu',
      advice: 'Dnešní regenerace radí nejdřív odpočívat (únava {fatigue}/10, bolest svalů {soreness}/10).'
    },
    save: {
      idle: 'Ukládá se automaticky v tomto zařízení',
      ok: 'Uloženo v tomto zařízení',
      failed: 'Uložení se nezdařilo. Po zavření se změny nemusí zachovat.',
      loadFailed: 'Uloženou přípravu se nepodařilo načíst. Zadej ji znovu.'
    },
    result: {
      eyebrow: 'Jídlo a pití',
      expected: '{minutes} min',
      expectedAria: 'Očekávaný čas běhu {minutes} min',
      emptyTitle: 'Doplň očekávaný čas běhu',
      emptyText: 'Jídlo a občerstvení se řídí délkou běhu, ne jen vzdáleností. Zadej 10–720 minut.',
      foodsLabel: 'Vyber jednu z variant',
      foodsNote: 'Příklady, ne pevný jídelníček. Vyber podle alergií a vlastní snášenlivosti.'
    },
    fuel: {
      title: 'Na trasu',
      sub: 'sacharidy během běhu podle jeho délky',
      bandsLabel: 'Sacharidy během běhu podle délky',
      yours: 'tvůj běh',
      noMinutes: 'Po zadání očekávaného času se zvýrazní pásmo tvého běhu.',
      lateTitle: 'Dlouhý běh bez jídla.'
    },
    calc: {
      title: 'Kolik občerstvení připravit',
      intro: 'Zadej svůj vyzkoušený cíl a obsah sacharidů z obalu. Výsledek je přepočet, ne doporučená dávka.',
      rate: 'Tvůj cíl',
      rateUnit: 'g/h',
      serving: 'Sacharidy v jedné porci',
      servingUnit: 'g',
      servingHint: 'podle obalu',
      total: 'sacharidů celkem',
      servingsWord: { one: 'porce', few: 'porce', many: 'porce', other: 'porcí' },
      per: 'po {g} g, zaokrouhleno nahoru',
      split: 'Rozděl je během běhu; nejde o dávku před startem.',
      squaresAria: { one: '{n} porce', few: '{n} porce', many: '{n} porce', other: '{n} porcí' },
      more: '+{n}',
      short: 'Výpočet občerstvení je určen pro běh delší než 75 minut.',
      noMinutes: 'Výpočet se ukáže po zadání očekávaného času běhu delšího než 75 minut.',
      missing: 'Doplň svůj vyzkoušený cíl a sacharidy v jedné porci podle obalu.',
      invalid: 'Zadej cíl 30–{max} g/h a obsah jedné porce 1–100 g.',
      summary: 'Pro tvůj zadaný cíl: {grams} g sacharidů celkem, tedy {servings} po {g} g (zaokrouhleno nahoru).',
      note: 'Součet zahrnuje všechny zdroje: gely, nápoj i jídlo. Počet porcí platí jen tehdy, pokud vše pokryješ zvoleným výrobkem. Nad 60 g/h využívej směs sacharidů až po nácviku snášenlivosti.'
    },
    timeline: {
      title: 'Časový plán přípravy',
      subStart: 'Počítáno zpět od startu v {time}',
      subNoStart: 'Zadej čas startu a doplní se konkrétní časy.',
      label: 'Časová osa přípravy před startem',
      now: 'Teď',
      prevDay: 'předchozí den',
      rel: { meal: '−4 h', snack: '−2 h', last: '−1 h', start: '0 h' },
      relAria: { meal: '4 hodiny před startem', snack: '2 hodiny před startem', last: 'hodinu před startem', start: 'start' }
    },
    check: {
      title: 'Kontrola před odchodem',
      progress: 'Připraveno {done} z {n}',
      all: 'Vše připraveno',
      reset: 'Odškrtnout pro další běh',
      resetDone: 'Seznam je odškrtnutý pro další běh.',
      undo: 'Vrátit',
      items: {
        meal: 'Jídlo před během mám naplánované a vyzkoušené.',
        drink: 'Vím, kde doplním pití nebo si ho vezmu s sebou.',
        fuel: 'Pro dlouhý běh mám připravené vyzkoušené občerstvení.',
        route: 'Mám trasu, počasí a možnost návratu zkontrolované.',
        gear: 'Mám vhodné boty, oblečení, telefon a klíče.'
      }
    },
    notes: {
      title: 'Vlastní poznámky',
      label: 'Co ti sedělo a co příště změnit',
      placeholder: 'Jídlo, čas před startem, pití a pocit při běhu…',
      hint: 'Poznámky a nastavení zůstávají v tomto zařízení. Ukládají se automaticky.',
      count: '{n} / {max}'
    },
    sources: {
      title: 'Zdroje a zásady',
      text: 'Obecné doporučení pro zdravé dospělé. Jídlo i občerstvení vyzkoušej v tréninku; při zdravotních omezeních plán prober s nutričním terapeutem. Před závodem nezkoušej nové potraviny.',
      verified: 'Podklady ověřeny 1. 10. 2026:',
      nswis: 'NSW Institute of Sport: načasování jídla',
      ais: 'Australian Institute of Sport: sacharidy během výkonu',
      cleveland: 'Cleveland Clinic: příprava na maraton',
      opens: '(otevře se v prohlížeči)'
    }
  };

  const EN = {
    form: {
      title: 'Your run',
      distance: 'Distance',
      minutes: 'Expected time',
      minutesUnit: 'min',
      timing: 'Time to the start',
      start: 'Start time',
      optional: 'optional',
      hint: 'Enter the time from your own pace. Distance alone does not tell you what fuel you need.',
      minutesError: 'Enter an expected run time of 10–720 minutes.'
    },
    timing: { meal: '2–4 h', snack: '1–2 h', soon: 'under 1 h' },
    timingLong: { meal: '2–4 hours to the start', snack: '1–2 hours to the start', soon: 'less than an hour to the start' },
    next: {
      text: 'Next run {date}: {name}, about {minutes} min',
      apply: 'From my next run',
      applyAria: 'Fill in distance and time from your next run: {name}, about {minutes} min',
      applied: 'Filled in from your next run: {distance}, {minutes} min.',
      matches: 'Matches your next run',
      advice: 'Today’s recovery check-in says rest first (fatigue {fatigue}/10, muscle soreness {soreness}/10).'
    },
    save: {
      idle: 'Saved automatically on this device',
      ok: 'Saved on this device',
      failed: 'Saving failed. Your changes may be lost when you close the app.',
      loadFailed: 'Your saved preparation could not be read. Please enter it again.'
    },
    result: {
      eyebrow: 'Food and drink',
      expected: '{minutes} min',
      expectedAria: 'Expected run time {minutes} min',
      emptyTitle: 'Enter your expected run time',
      emptyText: 'Food and fuel depend on how long you run, not only on the distance. Enter 10–720 minutes.',
      foodsLabel: 'Pick one of the options',
      foodsNote: 'Examples, not a fixed menu. Choose around allergies and what you tolerate.'
    },
    fuel: {
      title: 'On the course',
      sub: 'carbohydrate during the run by its length',
      bandsLabel: 'Carbohydrate during the run by duration',
      yours: 'your run',
      noMinutes: 'Enter your expected time to highlight the band of your run.',
      lateTitle: 'Long run without a meal.'
    },
    calc: {
      title: 'How much fuel to pack',
      intro: 'Enter your own tried target and the carbohydrate on the pack. The result is arithmetic, not a recommended dose.',
      rate: 'Your target',
      rateUnit: 'g/h',
      serving: 'Carbohydrate per serving',
      servingUnit: 'g',
      servingHint: 'from the pack',
      total: 'carbohydrate in total',
      servingsWord: { one: 'serving', other: 'servings' },
      per: '{g} g each, rounded up',
      split: 'Spread them over the run; this is not a dose before the start.',
      squaresAria: { one: '{n} serving', other: '{n} servings' },
      more: '+{n}',
      short: 'The fuel calculator is for runs longer than 75 minutes.',
      noMinutes: 'The calculator appears once your expected time is over 75 minutes.',
      missing: 'Add your tried target and the carbohydrate per serving from the pack.',
      invalid: 'Enter a target of 30–{max} g/h and 1–100 g per serving.',
      summary: 'For your target: {grams} g of carbohydrate in total, that is {servings} of {g} g (rounded up).',
      note: 'The total covers every source: gels, drinks and food. The number of servings only holds if one product covers it all. Go above 60 g/h with a carbohydrate mix only after practising it.'
    },
    timeline: {
      title: 'Preparation timeline',
      subStart: 'Counted back from your {time} start',
      subNoStart: 'Enter a start time to see clock times.',
      label: 'Timeline of the preparation before the start',
      now: 'Now',
      prevDay: 'previous day',
      rel: { meal: '−4 h', snack: '−2 h', last: '−1 h', start: '0 h' },
      relAria: { meal: '4 hours before the start', snack: '2 hours before the start', last: '1 hour before the start', start: 'start' }
    },
    check: {
      title: 'Check before you leave',
      progress: '{done} of {n} ready',
      all: 'All set',
      reset: 'Clear for the next run',
      resetDone: 'The list is cleared for your next run.',
      undo: 'Undo',
      items: {
        meal: 'My pre-run meal is planned and tried.',
        drink: 'I know where to refill or I am carrying a drink.',
        fuel: 'For a long run, my tried fuel is packed.',
        route: 'I have checked the route, the weather and a way back.',
        gear: 'I have suitable shoes, clothes, my phone and keys.'
      }
    },
    notes: {
      title: 'My notes',
      label: 'What worked and what to change next time',
      placeholder: 'Food, time before the start, drinks and how the run felt…',
      hint: 'Notes and settings stay on this device. They save automatically.',
      count: '{n} / {max}'
    },
    sources: {
      title: 'Sources and principles',
      text: 'General guidance for healthy adults. Try food and fuel in training; with a health condition, talk your plan through with a dietitian. Do not try new foods before a race.',
      verified: 'Sources checked on 1 October 2026:',
      nswis: 'NSW Institute of Sport: meal timing',
      ais: 'Australian Institute of Sport: carbohydrate during exercise',
      cleveland: 'Cleveland Clinic: marathon preparation',
      opens: '(opens in your browser)'
    }
  };

  const MESSAGES = Object.freeze({ cs: Object.assign({ guide: N.MESSAGES.cs }, CS), en: Object.assign({ guide: N.MESSAGES.en }, EN) });
  I18n.register('nutrition', MESSAGES);
  const t = (key, params) => app.t('nutrition.' + key, params);

  // ================================================================ model (pure, exported for tests)

  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const PHASE_OF_TIMING = { meal: 'meal', snack: 'snack', soon: 'last' };

  function parseNum(value) {
    if (typeof value !== 'string' || !value.trim()) return NaN;
    const n = Number(value.trim().replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }
  function field(data, k) { const v = data && data[F[k]]; return typeof v === 'string' ? v : ''; }
  const intIn = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

  /**
   * valuesOf(saved) -> the effective page values: distance ('5' when unset, the 0.4 default), timing
   * ('meal'), minutes (integer 10..720 or null, minutesError when something invalid is stored), start
   * ('HH:MM' or ''), rate / serving (numbers or NaN, raw strings kept), notes, checks { id: bool }, done.
   */
  function valuesOf(data) {
    const distance = N.distanceCode(field(data, 'distance')) ? field(data, 'distance') : '5';
    const timing = N.TIMINGS.indexOf(field(data, 'timing')) >= 0 ? field(data, 'timing') : 'meal';
    const minutesRaw = field(data, 'minutes').trim();
    const m = parseNum(minutesRaw);
    const minutes = intIn(m, L.minutesMin, L.minutesMax) ? m : null;
    const startRaw = field(data, 'start');
    const checks = {};
    N.CHECKS.forEach(id => { checks[id] = !!(data && data.checks && data.checks[id] === true); });
    return {
      distance, code: N.distanceCode(distance), timing, minutesRaw, minutes, minutesError: !!minutesRaw && minutes === null,
      start: TIME_RE.test(startRaw) ? startRaw : '',
      rateRaw: field(data, 'rate').trim(), rate: parseNum(field(data, 'rate')),
      servingRaw: field(data, 'serving').trim(), serving: parseNum(field(data, 'serving')),
      notes: field(data, 'notes'), checks, done: N.CHECKS.filter(id => checks[id]).length
    };
  }

  /** serialize(saved) -> the object to store under 'veyvo-pre-run-v1' (0.3 format, unknown keys kept). */
  function serialize(data) {
    const v = valuesOf(data);
    const out = Object.assign({}, data);
    out[F.distance] = v.distance;
    out[F.minutes] = field(data, 'minutes');
    out[F.timing] = v.timing;
    out[F.start] = field(data, 'start');
    out[F.rate] = field(data, 'rate');
    out[F.serving] = field(data, 'serving');
    out[F.notes] = field(data, 'notes');
    out.checks = Object.assign({}, data && data.checks, v.checks);
    return out;
  }

  /**
   * calcState(values) -> { kind: 'noMinutes' | 'short' | 'missing' | 'invalid' | 'ok', max, grams, servings, serving }.
   * The 0.3 rules: only for runs > 75 min; target 30-60 g/h up to 150 min, 30-90 g/h above; 1-100 g per serving.
   */
  function calcState(v) {
    if (v.minutes === null) return { kind: 'noMinutes' };
    if (v.minutes <= L.calculatorAbove) return { kind: 'short' };
    const max = N.rateMax(v.minutes);
    if (!v.rateRaw || !v.servingRaw) return { kind: 'missing', max };
    if (!intIn(v.rate, L.rateMin, max) || !intIn(v.serving, L.servingMin, L.servingMax)) return { kind: 'invalid', max };
    const b = N.fuelBudget(v.minutes, v.rate, v.serving);
    return { kind: 'ok', max, grams: b.grams, servings: b.servings, serving: v.serving };
  }

  /**
   * phaseRows(values, locale) -> the four timeline phases: { code, hours (length of the phase, 0 for
   * the start), from / to ('HH:MM' or null without a start time), prevDay, active (the phase that
   * matches "time to the start") }.
   */
  function phaseRows(v, locale) {
    const clock = v.start ? N.timeline(v.start, locale) : null;
    const active = PHASE_OF_TIMING[v.timing];
    return N.phases().map((p, i) => ({
      code: p.code,
      hours: p.offsetTo === null ? 0 : (p.offsetFrom - p.offsetTo) / 60,
      from: clock ? clock[i].from : null,
      to: clock ? clock[i].to : null,
      prevDay: clock ? clock[i].fromPrevDay : false,
      active: p.code === active
    }));
  }

  function easyMid(paces) { return paces && paces.easy ? (paces.easy.fastSecPerKm + paces.easy.slowSecPerKm) / 2 : null; }

  /**
   * nextSuggestion(derived) -> { date, name, km, distance, minutes } | null. Uses the next session
   * (derived.nextSession: a booked library session or the engine's run, the one home, plan and the
   * nav badge show) and the same planning estimate as the plan page (VeyvoUI.planModel
   * when loaded, else VeyvoWorkouts.estimate with the middle of the easy range). distance is the
   * nearest option, minutes the estimate rounded and kept within 10..720. Null on a rest day or
   * when the workout has no estimable time.
   */
  function nextSuggestion(d) {
    const ns = d && d.nextSession;
    const w = ns && ns.workout;
    if (!w || !ns.date) return null;
    let meters = null, seconds = null;
    const pm = UI && UI.planModel;
    if (pm && typeof pm.workoutStats === 'function') {
      const s = pm.workoutStats(w, d.paces);
      if (s) { meters = s.distance ? s.distance.meters : null; seconds = s.time ? s.time.seconds : null; }
    } else if (Workouts && typeof Workouts.estimate === 'function') {
      const est = Workouts.estimate(w, { easyPaceSecPerKm: easyMid(d.paces) });
      if (est && est.complete) { meters = est.distanceM || null; seconds = est.seconds || null; }
    }
    if (!meters || !seconds) return null;
    const minutes = Math.max(L.minutesMin, Math.min(L.minutesMax, Math.round(seconds / 60)));
    return { date: ns.date, name: String(w.name || ''), km: meters / 1000, distance: N.nearestDistance(meters / 1000), minutes };
  }

  UI.nutrition = { valuesOf, serialize, calcState, phaseRows, nextSuggestion, SOURCES, MESSAGES };

  // ================================================================ page state
  let data = null;            // the saved object (0.3 format)
  let lastRaw;                // the storage string last read or written
  let loadFailed = false;
  let saveState = 'idle';     // 'idle' | 'saved' | 'ok' | 'failed'
  let sourcesOpen = false;
  let refs = {};
  let prev = {};              // signatures of what is on screen, to animate only real changes
  let S = { ctx: null, container: null };

  const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
  const EASE_SPRING = 'cubic-bezier(.34, 1.45, .64, 1)';
  const FADE_UP = [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }];

  /** Interaction motion (WAAPI, transform/opacity, <= 450 ms); off with reduced motion. */
  function play(el, frames, opts) {
    if (!el || UI.motion.prefersReduced() || typeof el.animate !== 'function') return null;
    return el.animate(frames, Object.assign({ duration: 260, easing: EASE_OUT, fill: 'backwards' }, opts || {}));
  }
  /** Number tween for interaction updates (motion.countUp is for entrances only). */
  function tween(el, from, to, format) {
    if (!el) return;
    if (el._nutTween) el._nutTween.stop = true;
    if (!Number.isFinite(from) || from === to || UI.motion.prefersReduced() || !root.requestAnimationFrame) { el.textContent = format(to); return; }
    const job = { stop: false };
    el._nutTween = job;
    let t0 = null;
    const step = now => {
      if (job.stop) return;
      if (t0 === null) t0 = now;
      const k = Math.min(1, (now - t0) / 320);
      el.textContent = format(k >= 1 ? to : from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) root.requestAnimationFrame(step);
    };
    root.requestAnimationFrame(step);
  }

  function readStorage() { try { return root.localStorage.getItem(N.STORAGE_KEY); } catch (e) { return null; } }
  function load() {
    const raw = readStorage();
    if (data && (raw === lastRaw || saveState === 'failed')) return;   // unchanged, or unsaved edits in memory
    const r = N.readSaved(raw);
    data = r.data;
    loadFailed = !r.ok;
    lastRaw = raw;
    saveState = raw ? 'saved' : 'idle';
  }
  function persist() {
    data = serialize(data);
    const json = JSON.stringify(data);
    try { root.localStorage.setItem(N.STORAGE_KEY, json); lastRaw = json; saveState = 'ok'; loadFailed = false; }
    catch (e) { saveState = 'failed'; }
    paintSave(true);
  }

  /** change({ distance: '10' }, 'distance'): store, save, and repaint what depends on it. */
  function change(patch, what) {
    if (!data) load();
    let changed = false;
    Object.keys(patch).forEach(k => { if (field(data, k) !== patch[k]) { data[F[k]] = patch[k]; changed = true; } });
    if (!changed) return;
    persist();
    paint(what);
  }

  function paint(what) {
    const v = valuesOf(data);
    const anim = what !== 'render';
    paintMinutesError(v);
    fillGuide(v, anim);
    fillFuel(v, anim);
    fillCalc(v, anim);
    fillTimeline(v, anim ? what : null);
    fillNext(v);
  }

  // ================================================================ builders
  function h() { return UI.dom.h.apply(null, arguments); }
  const icon = (name, size, cls) => UI.icons.get(name, { size, className: cls });

  function labelEl(text, opts) {
    const o = opts || {};
    return h(o.forId ? 'label.field-label' : 'span.field-label', { for: o.forId || null, id: o.id || null },
      text, o.optional ? h('span.opt', o.optional) : null);
  }

  function formCard(ctx, v) {
    const comps = ctx.components;
    const distLabel = 'nut-l-distance', timingLabel = 'nut-l-timing';

    const dist = comps.create('segmented', {
      options: N.DISTANCES.map(d => ({ value: d.value, label: t('guide.profile.' + d.code + '.short') })),
      value: v.distance, key: 'nut-distance', size: 'lg',
      onChange: val => change({ distance: val }, 'distance')
    });
    dist.setAttribute('aria-labelledby', distLabel);
    dist.classList.add('nut-seg', 'nut-seg-dist');

    const minutes = comps.create('stepper', {
      value: v.minutes, min: L.minutesMin, max: L.minutesMax, step: 1, decimals: 0, start: 30,
      unit: t('form.minutesUnit'), id: 'nut-minutes', key: 'nut-minutes',
      onChange: val => change({ minutes: val === null ? '' : String(Math.round(val)) }, 'minutes')
    });
    minutes.classList.add('nut-stepper');
    // live update while typing a valid value (the stepper itself commits on change/blur)
    minutes.input.addEventListener('input', () => {
      const n = parseNum(minutes.input.value);
      if (intIn(n, L.minutesMin, L.minutesMax)) change({ minutes: String(n) }, 'minutes');
    });
    minutes.input.setAttribute('aria-describedby', 'nut-form-hint');

    const timing = comps.create('segmented', {
      options: N.TIMINGS.map(id => ({ value: id, label: t('timing.' + id) })),
      value: v.timing, key: 'nut-timing', size: 'lg',
      onChange: val => change({ timing: val }, 'timing')
    });
    timing.setAttribute('aria-labelledby', timingLabel);
    timing.classList.add('nut-seg');
    Array.from(timing.children).forEach((b, i) => b.setAttribute('title', t('timingLong.' + N.TIMINGS[i])));

    const start = h('input.input.nut-start', { type: 'time', id: 'nut-start', value: field(data, 'start'), dataset: { key: 'nut-start' } });
    const onStart = () => {
      const val = start.value;
      if (val === '' || TIME_RE.test(val)) change({ start: val }, 'start');
    };
    start.addEventListener('input', onStart);
    start.addEventListener('change', onStart);

    refs.dist = dist;
    refs.minutes = minutes;
    refs.minErr = h('p.field-error.nut-min-err', { id: 'nut-minutes-err', role: 'alert', hidden: true });
    refs.save = h('p.nut-save', { role: 'status' });
    refs.next = h('div.nut-next');

    return h('section.card.card-pad-lg.nut-card.nut-form', { 'aria-labelledby': 'nut-form-title' },
      h('div.card-head',
        h('h2.card-title#nut-form-title', t('form.title')),
        h('div.card-end', refs.save)),
      h('div.nut-form-row',
        h('div.field.nut-f-dist', labelEl(t('form.distance'), { id: distLabel }), dist),
        h('div.field.nut-f-min', labelEl(t('form.minutes'), { forId: 'nut-minutes' }), minutes, refs.minErr),
        h('div.field.nut-f-start', labelEl(t('form.start'), { forId: 'nut-start', optional: t('form.optional') }), start),
        h('div.field.nut-f-timing', labelEl(t('form.timing'), { id: timingLabel }), timing)),
      h('p.field-hint.nut-hint#nut-form-hint', t('form.hint')),
      refs.next);
  }

  function paintSave(pulse) {
    const el = refs.save;
    if (!el) return;
    const kind = saveState === 'failed' ? 'failed' : loadFailed ? 'loadFailed' : saveState === 'idle' ? 'idle' : 'ok';
    el.className = 'nut-save is-' + kind;
    UI.dom.mount(el, icon(kind === 'failed' || kind === 'loadFailed' ? 'warning' : kind === 'idle' ? 'database' : 'check', 14), h('span', t('save.' + kind)));
    if (pulse && kind === 'ok') play(el.firstChild, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE_SPRING });
  }

  function paintMinutesError(v) {
    const err = refs.minErr, input = refs.minutes && refs.minutes.input;
    if (!err || !input) return;
    err.hidden = !v.minutesError;
    UI.dom.mount(err, v.minutesError ? [icon('warning'), h('span', t('form.minutesError'))] : null);
    input.setAttribute('aria-invalid', v.minutesError ? 'true' : 'false');
    input.setAttribute('aria-describedby', v.minutesError ? 'nut-form-hint nut-minutes-err' : 'nut-form-hint');
  }

  function fillNext(v) {
    const el = refs.next, s = S.sug;
    if (!el) return;
    el.hidden = !s;
    if (!s) { UI.dom.clear(el); return; }
    const name = fmt.typo(s.name);
    const date = fmt.date(s.date, 'short');
    const matches = v.distance === s.distance && v.minutes === s.minutes;
    const hadFocus = el.contains(root.document.activeElement);
    const btn = h('button.btn.btn-secondary.btn-sm.nut-next-btn', {
      type: 'button', dataset: { key: 'nut-next-apply' },
      'aria-label': t('next.applyAria', { name, minutes: s.minutes }),
      onClick: () => applySuggestion()
    }, icon(matches ? 'check' : 'calendar-check'), h('span', matches ? t('next.matches') : t('next.apply')));
    const a = S.advice;
    const advice = a ? h('p.nut-next-advice', { role: 'status' }, icon('warning', 15),
      h('span', t('next.advice', { fatigue: a.fatigue != null ? a.fatigue : '–', soreness: a.soreness != null ? a.soreness : '–' }))) : null;
    UI.dom.mount(el, h('span.nut-next-ico', icon('calendar')), h('div.nut-next-main', h('p.nut-next-text', t('next.text', { date, name, minutes: s.minutes })), advice), btn);
    if (hadFocus) btn.focus({ preventScroll: true });
  }

  function applySuggestion() {
    const s = S.sug;
    if (!s) return;
    if (refs.dist && refs.dist.setValue) refs.dist.setValue(s.distance);
    if (refs.minutes && refs.minutes.setValue) refs.minutes.setValue(s.minutes);
    change({ distance: s.distance, minutes: String(s.minutes) }, 'next');
    const active = root.document.activeElement;
    if (!active || active === root.document.body || !root.document.contains(active)) {
      const btn = refs.next && refs.next.querySelector('button');
      if (btn) btn.focus({ preventScroll: true });
    }
    const code = N.distanceCode(s.distance);
    app.toast(t('next.applied', { distance: t('guide.profile.' + code + '.short'), minutes: s.minutes }), { kind: 'success' });
  }

  // ---------------------------------------------------------------- preparation (guide) card
  function fillGuide(v, animate) {
    const el = refs.guide;
    if (!el) return;
    if (v.minutes === null) {
      UI.dom.mount(el, S.ctx.components.create('empty', {
        // No second "Podle dalšího běhu" here: the suggestion row right above already offers it.
        icon: 'clock', title: t('result.emptyTitle'), text: t('result.emptyText')
      }));
      el.className = 'nut-guide-slot is-empty';
      prev.guide = null;
      return;
    }
    el.className = 'nut-guide-slot';
    const g = N.guide(v.distance, v.minutes, v.timing);
    const mk = 'guide.meal.' + g.meal.code;
    const head = h('div.nut-guide-head',
      h('div.nut-guide-titles',
        h('p.eyebrow', t('result.eyebrow')),
        h('h2.nut-guide-title#nut-guide-title', t('guide.profile.' + g.code + '.title'))),
      h('span.chip.nut-chip-min', icon('clock'), h('span.sr-only', t('form.minutes') + ': '), t('result.expected', { minutes: v.minutes })));
    const prep = h('p.nut-prep', t('guide.profile.' + g.code + '.prep'));
    const foods = g.meal.foods.map((_, i) => h('li.nut-food', h('span.nut-food-no.num', { 'aria-hidden': 'true' }, String(i + 1)), h('span.nut-food-text', t(mk + '.foods.' + i))));
    const meal = h('section.nut-meal', { 'aria-labelledby': 'nut-meal-title' },
      h('div.nut-meal-head',
        h('span.nut-ico', icon('fork-knife')),
        h('div.nut-meal-titles',
          h('h3.nut-meal-title#nut-meal-title', t(mk + '.name')),
          h('p.nut-meal-when', t(mk + '.when')))),
      h('p.nut-meal-text', t(mk + '.text')),
      h('p.nut-foods-label', t('result.foodsLabel')),
      h('ol.nut-foods', { class: 'n-' + foods.length }, foods),
      h('p.nut-foot', t('result.foodsNote')));
    UI.dom.mount(el, h('article.card.card-pad-lg.nut-card.nut-guide', { 'aria-labelledby': 'nut-guide-title' }, head, prep, meal));
    const p = prev.guide;
    if (animate && p) {
      if (p.code !== g.code) { play(head, FADE_UP); play(prep, FADE_UP, { delay: 40 }); }
      if (p.timing !== g.timing) {
        play(meal.querySelector('.nut-meal-head'), FADE_UP);
        play(meal.querySelector('.nut-meal-text'), FADE_UP, { delay: 30 });
        Array.from(meal.querySelectorAll('.nut-food')).forEach((li, i) => play(li, FADE_UP, { delay: 60 + i * 45 }));
      }
    } else if (animate && !p) {
      play(el.firstChild, FADE_UP, { duration: 300 });
    }
    prev.guide = { code: g.code, timing: g.timing };
  }

  // ---------------------------------------------------------------- on the course (fuel) card
  function fuelCard() {
    refs.bands = h('ol.nut-bands', { 'aria-label': t('fuel.bandsLabel') });
    refs.fuelText = h('div.nut-fuel-text');
    refs.calcInputs = calcInputs();
    refs.calcOut = h('div.nut-calc-out');
    refs.calcStatus = h('p.sr-only', { role: 'status' });
    refs.calcNote = h('p.nut-foot.nut-calc-note', t('calc.note'));
    return h('section.card.card-pad-lg.nut-card.nut-fuel', { 'aria-labelledby': 'nut-fuel-title' },
      h('div.card-head', h('h2.card-title#nut-fuel-title', t('fuel.title')), h('span.card-sub', t('fuel.sub'))),
      refs.bands,
      refs.fuelText,
      h('p.nut-drink', icon('info', 15), h('span', t('guide.drink'))),
      h('div.nut-calc', { role: 'group', 'aria-labelledby': 'nut-calc-title' },
        h('h3.nut-calc-title#nut-calc-title', t('calc.title')),
        refs.calcInputs,
        refs.calcOut,
        refs.calcStatus,
        refs.calcNote));
  }

  function fillFuel(v, animate) {
    if (!refs.bands) return;
    const band = v.minutes !== null ? N.fuelBand(v.minutes) : null;
    UI.dom.mount(refs.bands, N.FUEL_BANDS.map((b, i) => {
      const on = b === band;
      return h('li.nut-band', { class: on ? 'is-on' : null, 'aria-current': on ? 'true' : null, style: { '--i': i } },
        h('span.nut-band-lane', h('i.nut-band-fill')),
        h('span.nut-band-range', t('guide.band.' + b + '.range')),
        h('span.nut-band-value', t('guide.band.' + b + '.value')),
        on ? h('span.chip.chip-accent.chip-sm.nut-band-you', t('fuel.yours')) : null);
    }));
    const g = v.minutes !== null ? N.guide(v.distance, v.minutes, v.timing) : null;
    UI.dom.mount(refs.fuelText,
      g ? h('p.nut-fuel-p', t('guide.fuel.' + g.fuelCode)) : h('p.nut-fuel-p.faint', t('fuel.noMinutes')),
      g && g.lateLongRun ? S.ctx.components.create('callout', { kind: 'warn', icon: 'warning', title: t('fuel.lateTitle'), text: t('guide.late') }) : null);
    const p = prev.fuel;
    if (animate && p !== undefined && p !== band) {
      const on = refs.bands.querySelector('.is-on');
      if (on) {
        play(on.querySelector('.nut-band-fill'), [{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 360 });
        play(on.querySelector('.nut-band-you'), [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE_SPRING, delay: 120 });
      }
      play(refs.fuelText, FADE_UP);
    }
    if (animate && prev.late === false && g && g.lateLongRun) play(refs.fuelText.lastChild, FADE_UP, { delay: 60 });
    prev.fuel = band;
    prev.late = !!(g && g.lateLongRun);
  }

  function calcInputs() {
    const v = valuesOf(data);
    const comps = S.ctx.components;
    const mk = (k, opts) => {
      const s = comps.create('stepper', Object.assign({ decimals: 0, key: 'nut-' + k, id: 'nut-' + k }, opts, {
        onChange: val => change({ [k]: val === null ? '' : String(Math.round(val)) }, k)
      }));
      s.classList.add('nut-stepper');
      s.input.addEventListener('input', () => {
        const n = parseNum(s.input.value);
        if (Number.isInteger(n) && n >= opts.min && n <= opts.max) change({ [k]: String(n) }, k);
      });
      return s;
    };
    const rate = mk('rate', { value: Number.isFinite(v.rate) ? v.rate : null, min: L.rateMin, max: L.rateMaxLong, step: 5, start: L.rateMin, unit: t('calc.rateUnit') });
    const serving = mk('serving', { value: Number.isFinite(v.serving) ? v.serving : null, min: L.servingMin, max: L.servingMax, step: 1, start: L.servingMin, unit: t('calc.servingUnit') });
    return h('div.nut-calc-in',
      h('p.nut-calc-intro', t('calc.intro')),
      h('div.nut-calc-fields',
        h('div.field', labelEl(t('calc.rate'), { forId: 'nut-rate' }), rate),
        h('div.field', labelEl(t('calc.serving'), { forId: 'nut-serving', optional: t('calc.servingHint') }), serving)));
  }

  function fillCalc(v, animate) {
    const out = refs.calcOut;
    if (!out) return;
    const c = calcState(v);
    const usable = c.kind !== 'noMinutes' && c.kind !== 'short';
    refs.calcInputs.hidden = !usable;
    refs.calcNote.hidden = !usable;
    if (c.kind !== 'ok') {
      const text = c.kind === 'invalid' ? t('calc.invalid', { max: c.max }) : t('calc.' + c.kind);
      UI.dom.mount(out, h('p', { class: ['nut-calc-msg', c.kind === 'invalid' ? 'is-error' : null] }, icon(c.kind === 'invalid' ? 'warning' : 'info', 15), h('span', text)));
      refs.calcStatus.textContent = c.kind === 'invalid' || c.kind === 'missing' ? text : '';
      if (animate && prev.calcKind !== c.kind && prev.calcKind !== undefined) play(out.firstChild, FADE_UP);
      prev.calcKind = c.kind;
      prev.calc = null;
      return;
    }
    const grams = h('span.num.nut-big', String(c.grams));
    const count = h('span.num.nut-big', String(c.servings));
    const shown = Math.min(c.servings, 24);
    const squares = h('div.nut-squares', { role: 'img', 'aria-label': t('calc.squaresAria', { n: c.servings }) },
      Array.from({ length: shown }, (_, i) => h('i.nut-sq', { style: { '--i': i } })),
      c.servings > shown ? h('span.nut-sq-more.num', t('calc.more', { n: c.servings - shown })) : null);
    UI.dom.mount(out,
      h('div.nut-calc-nums',
        h('div.nut-calc-num', h('div.nut-calc-val', grams, h('span.unit', NB + 'g')), h('p.nut-calc-lbl', t('calc.total'))),
        h('div.nut-calc-num', h('div.nut-calc-val', count, h('span.unit', NB + t('calc.servingsWord', { n: c.servings }))), h('p.nut-calc-lbl', t('calc.per', { g: c.serving })))),
      squares,
      h('p.nut-calc-split', t('calc.split')));
    refs.calcStatus.textContent = t('calc.summary', { grams: c.grams, servings: fmt.typo(t('calc.squaresAria', { n: c.servings })), g: c.serving });
    const p = prev.calc;
    const fmtInt = x => String(Math.round(x));
    if (animate && p) {
      tween(grams, p.grams, c.grams, fmtInt);
      tween(count, p.servings, c.servings, fmtInt);
      Array.from(squares.querySelectorAll('.nut-sq')).forEach((sq, i) => {
        if (i >= p.servings) play(sq, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE_SPRING, delay: (i - p.servings) * 30 });
      });
    } else if (animate) {
      play(out.firstChild, FADE_UP);
    } else if (S.ctx && S.ctx.animate && !prev.entered) {
      S.countIn = () => {
        UI.motion.countUp(grams, c.grams, { from: 0, format: fmtInt, delay: 200 });
        UI.motion.countUp(count, c.servings, { from: 0, format: fmtInt, delay: 200 });
      };
    }
    prev.calcKind = c.kind;
    prev.calc = { grams: c.grams, servings: c.servings };
  }

  // ---------------------------------------------------------------- timeline card
  function fillTimeline(v, what) {
    const el = refs.tl;
    if (!el) return;
    const loc = I18n.getLocale();
    const rows = phaseRows(v, loc);
    const entering = !!(S.ctx && S.ctx.animate && !prev.entered);
    UI.dom.mount(refs.tlSub, v.start ? t('timeline.subStart', { time: v.start }) : t('timeline.subNoStart'));
    UI.dom.mount(el, rows.map((r, i) => {
      const isStart = r.code === 'start';
      const tick = h('div.nut-ph-tick',
        r.from
          ? h('span.nut-ph-time.num', r.from)
          : h('span.nut-ph-time.num', { 'aria-hidden': 'true' }, t('timeline.rel.' + r.code)),
        r.from && !isStart ? h('span.nut-ph-rel', { 'aria-hidden': 'true' }, t('timeline.rel.' + r.code)) : null,
        isStart ? null : h('span.sr-only', t('timeline.relAria.' + r.code)),
        r.prevDay ? h('span.nut-ph-prev', t('timeline.prevDay')) : null);
      const lane = h('div.nut-ph-lane', { 'aria-hidden': 'true' },
        isStart ? h('i.nut-ph-flag', { class: entering ? 'pop' : null, style: { '--i': 4 } })
          : h('i.nut-ph-fill', { class: entering ? 'grow-x' : null, style: { '--i': i } }));
      const body = h('div.nut-ph-body',
        h('h3.nut-ph-title', isStart ? icon('flag', 15, 'nut-ph-flag-ic') : null, h('span', t('guide.phase.' + r.code + '.title')),
          r.active ? h('span.chip.chip-accent.chip-sm.nut-now', { class: entering ? 'pop' : null, style: { '--i': 5 } }, t('timeline.now')) : null),
        h('p.nut-ph-detail', t('guide.phase.' + r.code + '.detail')));
      return h('li', { class: ['nut-ph', 'nut-ph-' + r.code, r.active && 'is-active'], style: { '--h': r.hours } }, tick, lane, body);
    }));
    if (what === 'timing') {
      const on = el.querySelector('.nut-ph.is-active');
      if (on) {
        play(on.querySelector('.nut-ph-fill'), [{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 380, easing: EASE_OUT });
        play(on.querySelector('.nut-now'), [{ transform: 'scale(.5)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE_SPRING, delay: 120 });
      }
    } else if (what === 'start' && prev.start !== v.start) {
      Array.from(el.querySelectorAll('.nut-ph-tick')).forEach((tk, i) => play(tk, [{ opacity: .2, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: i * 35 }));
      play(refs.tlSub, [{ opacity: .3 }, { opacity: 1 }], { duration: 220 });
    }
    prev.start = v.start;
  }

  // ---------------------------------------------------------------- checklist + notes
  function checklistCard(v) {
    refs.checkCount = h('span.num.nut-check-count');
    refs.checkFill = h('div.bar-fill');
    refs.checkStatus = h('p.sr-only', { role: 'status' });
    refs.checkAll = h('span.chip.chip-good.nut-check-all', { 'aria-hidden': 'true' }, icon('check-circle'), h('span', t('check.all')));
    refs.reset = h('button.btn.btn-ghost.btn-sm.nut-reset', { type: 'button', dataset: { key: 'nut-reset' }, onClick: resetChecks }, icon('refresh'), h('span', t('check.reset')));
    refs.checkInputs = {};
    const items = N.CHECKS.map(id => {
      const input = h('input.nut-check-input', { type: 'checkbox', id: 'nut-check-' + id, checked: v.checks[id], dataset: { key: 'nut-check-' + id } });
      input.addEventListener('change', () => {
        data.checks = Object.assign({}, data.checks, { [id]: input.checked });
        persist();
        paintChecks(true);
      });
      refs.checkInputs[id] = input;
      return h('li.nut-check-item', { dataset: { id } },
        h('label.nut-check', { for: input.id },
          input,
          h('span.nut-box', { 'aria-hidden': 'true' }, icon('check', 14, 'nut-box-ic')),
          h('span.nut-check-text', t('check.items.' + id))));
    });
    refs.checkList = h('ul.nut-checks-list', items);
    return h('section.card.card-pad-lg.nut-card.nut-checks', { 'aria-labelledby': 'nut-check-title' },
      h('div.card-head',
        h('h2.card-title#nut-check-title', icon('checklist', 17, 'nut-title-ic'), h('span', t('check.title'))),
        h('div.card-end.nut-check-end', refs.checkAll, h('span.nut-check-frac', { 'aria-hidden': 'true' }, refs.checkCount, h('span.nut-check-of.num', '/' + N.CHECKS.length)))),
      h('div.bar.nut-check-bar', { 'aria-hidden': 'true' }, refs.checkFill),
      refs.checkStatus,
      refs.checkList,
      h('div.nut-check-foot', refs.reset));
  }

  function paintChecks(animate) {
    if (!refs.checkList) return;
    const v = valuesOf(data);
    const n = N.CHECKS.length, f = v.done / n;
    N.CHECKS.forEach(id => {
      const li = refs.checkList.querySelector('[data-id="' + id + '"]');
      if (li) li.classList.toggle('is-done', v.checks[id]);
      const input = refs.checkInputs[id];
      if (input && input.checked !== v.checks[id]) input.checked = v.checks[id];
    });
    const before = prev.done;
    if (animate) tween(refs.checkCount, before, v.done, x => String(Math.round(x)));
    else refs.checkCount.textContent = String(v.done);
    refs.checkFill.style.setProperty('--f', String(f));
    refs.checkFill.style.transform = 'scaleX(' + f + ')';
    const all = v.done === n;
    const card = refs.checkList.closest('.nut-checks');
    if (card) card.classList.toggle('is-all', all);
    refs.checkStatus.textContent = all ? t('check.all') : t('check.progress', { done: v.done, n });
    refs.checkAll.hidden = !all;
    if (animate && all && before !== n) {
      play(refs.checkAll, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: EASE_SPRING });
      play(refs.checkAll.firstChild, [{ transform: 'rotate(-30deg) scale(.4)' }, { transform: 'none' }], { duration: 420, easing: EASE_SPRING, delay: 60 });
    }
    refs.reset.disabled = v.done === 0;
    prev.done = v.done;
  }

  function resetChecks() {
    const before = Object.assign({}, data.checks);
    if (!N.CHECKS.some(id => before[id] === true)) return;
    const cleared = Object.assign({}, before);
    N.CHECKS.forEach(id => { cleared[id] = false; });
    data.checks = cleared;
    persist();
    paintChecks(true);
    app.toast(t('check.resetDone'), {
      icon: 'refresh',
      action: { label: t('check.undo'), run: () => { load(); data.checks = Object.assign({}, data.checks, before); persist(); paintChecks(true); } }
    });
  }

  function notesCard(v) {
    const count = h('span.nut-notes-count.num', { 'aria-hidden': 'true' });
    const paintCount = len => { count.textContent = t('notes.count', { n: len, max: L.notesMax }); count.classList.toggle('is-near', len > L.notesMax * .9); };
    const ta = h('textarea.textarea.nut-notes-ta', {
      id: 'nut-notes', rows: 6, maxlength: L.notesMax, placeholder: t('notes.placeholder'),
      dataset: { key: 'nut-notes' }, 'aria-describedby': 'nut-notes-hint', value: v.notes
    });
    ta.addEventListener('input', () => {
      paintCount(ta.value.length);
      if (field(data, 'notes') !== ta.value) { data[F.notes] = ta.value; persist(); }
    });
    paintCount(v.notes.length);
    return h('section.card.card-pad-lg.nut-card.nut-notes', { 'aria-labelledby': 'nut-notes-title' },
      h('div.card-head', h('h2.card-title#nut-notes-title', icon('edit', 17, 'nut-title-ic'), h('span', t('notes.title')))),
      h('div.field.nut-notes-field',
        labelEl(t('notes.label'), { forId: 'nut-notes' }),
        ta,
        h('div.nut-notes-foot', h('p.field-hint#nut-notes-hint', t('notes.hint')), count)));
  }

  // ---------------------------------------------------------------- sources
  function openLink(event, url) {
    const P = root.VeyvoPlatform;
    if (!P || P.kind !== 'android') return;    // desktop: window-open allowlist in main.js; web: new tab
    event.preventDefault();
    Promise.resolve(P.openExternal(url)).catch(err => app.toast(app.errorText(err), { kind: 'error' }));
  }

  function sourcesCard() {
    const details = h('details.card.nut-card.nut-sources', { open: sourcesOpen },
      h('summary.nut-sources-sum',
        h('span.nut-ico', icon('info')),
        h('span.nut-sources-title', t('sources.title')),
        icon('chevron-down', 18, 'nut-sources-chev')),
      h('div.nut-sources-body',
        h('p', t('sources.text')),
        h('p.nut-sources-verified', t('sources.verified')),
        h('ul.nut-sources-list', SOURCES.map(s => h('li',
          h('a.nut-link', { href: s.url, target: '_blank', rel: 'noopener noreferrer', dataset: { key: 'nut-src-' + s.id }, onClick: e => openLink(e, s.url) },
            h('span', t('sources.' + s.id)), icon('external', 14), h('span.sr-only', ' ' + t('sources.opens'))))))));
    details.addEventListener('toggle', () => {
      if (details.open === sourcesOpen) return;   // the initial state, not a user toggle
      sourcesOpen = details.open;
      if (details.open) play(details.querySelector('.nut-sources-body'), FADE_UP, { duration: 240 });
    });
    return details;
  }

  // ================================================================ page
  app.pages.register('nutrition', {
    title: 'ui.nav.nutrition',
    render(container, ctx) {
      load();
      S.ctx = ctx;
      S.container = container;
      S.sug = nextSuggestion(ctx.derived);
      S.advice = ctx.derived.recoveryAdvice || null;
      S.countIn = null;
      refs = {};
      prev = { entered: false };
      const v = valuesOf(data);

      refs.guide = h('div.nut-guide-slot');
      refs.tl = h('ol.nut-tl', { 'aria-label': t('timeline.label') });
      refs.tlSub = h('span.card-sub.nut-tl-sub');
      const timeline = h('section.card.card-pad-lg.nut-card.nut-timeline', { 'aria-labelledby': 'nut-tl-title' },
        h('div.card-head', h('h2.card-title#nut-tl-title', t('timeline.title')), refs.tlSub),
        refs.tl);

      const page = h('div.nut',
        formCard(ctx, v),
        h('div.nut-row.nut-row-main', refs.guide, fuelCard()),
        timeline,
        h('div.nut-row.nut-row-two', checklistCard(v), notesCard(v)),
        sourcesCard());

      paintSave(false);
      paint('render');
      paintChecks(false);
      prev.entered = true;
      UI.dom.mount(container, page);

      if (ctx.animate) {
        UI.motion.reveal(page, { selector: '.nut-card, .nut-guide-slot.is-empty > .empty', stagger: 55 });
        UI.motion.fillBar(refs.checkFill, v.done / N.CHECKS.length, { delay: 260 });
        if (S.countIn) S.countIn();
        UI.motion.countUp(refs.checkCount, v.done, { from: 0, delay: 260 });
      }
    }
  });
})(globalThis);
