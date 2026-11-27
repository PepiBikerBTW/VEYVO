/*
 * VeyvoNutrition - the pre-run food and drink guide behind the 'Před během' / 'Before the run' page.
 *
 * Classic UMD script (no DOM, no clock, no network). General guidance for healthy adults, faithful to
 * the sources checked on 1 October 2026:
 *   - NSW Institute of Sport: timing of the pre-event meal and snack, familiar low-fat/low-fibre food;
 *   - Australian Institute of Sport: carbohydrate during exercise by duration (none < 45 min, a small
 *     amount for intense 45-75 min, 30-60 g/h for longer, up to 90 g/h glucose+fructose > 2.5-3 h);
 *   - Cleveland Clinic: carbohydrate preparation in the days before a marathon.
 * No number here is invented: the bands are the sources' ranges and fuelBudget() is plain arithmetic
 * on the runner's own inputs (expected minutes, their tried g/h target, grams per serving).
 *
 * API (0.3-compatible; every text defaults to Czech, pass locale 'en' for English):
 *   guide(distance, minutes, timing, locale?) -> { distance, code, name, prep, timing, meal: { code,
 *       title, name, when, text, foods }, fuelCode, fuel, longRun, lateLongRun }       throws RangeError
 *   timeline(start 'HH:MM', locale?) -> [{ code, time, title, detail, from, to, fromPrevDay,
 *       toPrevDay, offsetFrom, offsetTo }]                                              throws RangeError
 *   phases() -> the same four phases without clock times (offsets in minutes before the start)
 *   fuelBudget(minutes, gramsPerHour, gramsPerServing) -> { grams, servings }          throws RangeError
 *   fuelBand(minutes) -> 'none' | 'small' | 'moderate' | 'high'; rateMax(minutes) -> 60 | 90
 *   distanceCode(value) -> 'd5' | 'd6' | 'd10' | 'd21' | 'd42' | null; nearestDistance(km) -> '5' | … | '42.2'
 *   readSaved(raw) -> { ok, data } (the 'veyvo-pre-run-v1' object, unknown keys kept)
 *   DISTANCES, TIMINGS, PHASES, CHECKS, STORAGE_KEY, FIELDS, LIMITS, MESSAGES { cs, en }, profiles (cs)
 * The UI registers MESSAGES as the i18n subtree 'nutrition.guide' so every visible text goes through
 * VeyvoI18n.t; the strings returned here are the same texts for Node tests and non-UI callers.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'veyvo-pre-run-v1';
  /** Saved field names: the element ids of the 0.3 page, kept so the owner's saved data survives. */
  const FIELDS = Object.freeze({
    distance: 'nutritionDistance', minutes: 'nutritionMinutes', timing: 'nutritionTiming', start: 'nutritionStart',
    rate: 'nutritionRate', serving: 'nutritionServing', notes: 'nutritionNotes'
  });
  const LIMITS = Object.freeze({
    minutesMin: 10, minutesMax: 720,           // expected duration of the run
    rateMin: 30, rateMaxModerate: 60, rateMaxLong: 90,
    servingMin: 1, servingMax: 100,
    calculatorAbove: 75,                        // the fuel calculator is for runs longer than 75 min
    notesMax: 2000
  });

  /** Distance options: `value` is what 0.3 stored ('21.1'), `code` is the i18n-safe key (no dots). */
  const DISTANCES = Object.freeze([
    Object.freeze({ value: '5', code: 'd5', km: 5 }),
    Object.freeze({ value: '6', code: 'd6', km: 6 }),
    Object.freeze({ value: '10', code: 'd10', km: 10 }),
    Object.freeze({ value: '21.1', code: 'd21', km: 21.1 }),
    Object.freeze({ value: '42.2', code: 'd42', km: 42.2 })
  ]);
  const TIMINGS = Object.freeze(['meal', 'snack', 'soon']);
  /** Preparation phases, minutes before the start. `timing` links a phase to the "time to start" choice. */
  const PHASES = Object.freeze([
    Object.freeze({ code: 'meal', offsetFrom: 240, offsetTo: 120, timing: 'meal' }),
    Object.freeze({ code: 'snack', offsetFrom: 120, offsetTo: 60, timing: 'snack' }),
    Object.freeze({ code: 'last', offsetFrom: 60, offsetTo: 0, timing: 'soon' }),
    Object.freeze({ code: 'start', offsetFrom: 0, offsetTo: null, timing: null })
  ]);
  const CHECKS = Object.freeze(['meal', 'drink', 'fuel', 'route', 'gear']);
  const FUEL_BANDS = Object.freeze(['none', 'small', 'moderate', 'high']);

  // ---------------------------------------------------------------- texts (cs + en, same placeholders)

  const MESSAGES = Object.freeze({
    cs: {
      profile: {
        d5: {
          name: '5 km', short: '5 km', title: 'Příprava na 5 km',
          prep: 'Krátký rychlý běh, třeba test na 5 km, snese hlavně lehký žaludek. Navazuj na běžná jídla během dne, poslední větší jídlo si dej s odstupem a před startem omez tuk a vlákninu.'
        },
        d6: {
          name: '6 km', short: '6 km', title: 'Příprava na 6 km',
          prep: 'Před kratším během navazuj na běžná jídla během dne. Svačinu zvol podle hladu a času od posledního jídla.'
        },
        d10: {
          name: '10 km', short: '10 km', title: 'Příprava na 10 km',
          prep: 'Připrav si známé sacharidové jídlo. Pro občerstvení na trase rozhoduje očekávaný čas, zvlášť při závodním tempu.'
        },
        d21: {
          name: 'Půlmaraton · 21,1 km', short: '21,1 km', title: 'Příprava na půlmaraton',
          prep: 'Vyzkoušej snídani i občerstvení při dlouhém tréninku. Připrav si gely nebo nápoj a ověř občerstvovací stanice.'
        },
        d42: {
          name: 'Maraton · 42,2 km', short: '42,2 km', title: 'Příprava na maraton',
          prep: 'Příprava začíná v předchozích dnech. Zařazuj známé sacharidové potraviny; nespoléhej na jednu velkou večeři. Večer například rýži nebo bílé těstoviny s menší porcí libové bílkoviny.'
        }
      },
      meal: {
        meal: {
          title: 'Hlavní jídlo · 2–4 hodiny před startem', name: 'Hlavní jídlo', when: '2–4 hodiny před startem',
          text: 'Dej jídlu čas na trávení. Množství přizpůsob hladu, délce běhu a tomu, co máš vyzkoušené.',
          foods: ['Rýže s menší porcí tofu nebo kuřete.', 'Bílé těstoviny s lehkou rajčatovou omáčkou.', 'Bílý toast s džemem a banán, pokud běžíš ráno.']
        },
        snack: {
          title: 'Menší svačina · 1–2 hodiny před startem', name: 'Menší svačina', when: '1–2 hodiny před startem',
          text: 'Vyber jednu známou, lehce stravitelnou variantu s malým množstvím tuku a vlákniny.',
          foods: ['Banán.', 'Bílý toast nebo rohlík s džemem či medem.']
        },
        soon: {
          title: 'Do startu zbývá méně než hodina', name: 'Poslední hodina', when: 'méně než hodina do startu',
          text: 'Velké jídlo už nedoháněj. Tekutiny upíjej postupně; při dlouhém nebo intenzivním běhu může pomoci vyzkoušený sportovní nápoj.',
          foods: ['Voda po malých doušcích.', 'Vyzkoušený sacharidový nápoj pro dlouhý nebo intenzivní běh.']
        }
      },
      fuel: {
        none: 'Během výkonu kratšího než 45 minut sacharidy obvykle nejsou potřeba.',
        small: 'Při intenzivním běhu 45–75 minut může pomoci malé množství sacharidů. Nejde o povinnost pro každý lehký běh.',
        moderate: 'Pro vytrvalostní běh této délky se běžně používá 30–60 g sacharidů za hodinu. Započítej gely i nápoje a plán nejprve vyzkoušej v tréninku.',
        high: 'U běhů nad 2,5–3 hodiny lze po nácviku využít až 90 g sacharidů za hodinu ze směsi glukózy a fruktózy. Není to automatický cíl pro začátečníka; množství zvyšuj podle tolerance.'
      },
      band: {
        none: { range: 'pod 45 min', value: 'obvykle není potřeba' },
        small: { range: '45–75 min', value: 'malé množství' },
        moderate: { range: '76–150 min', value: '30–60 g/h' },
        high: { range: 'nad 150 min', value: 'až 90 g/h' }
      },
      late: 'Pokud jsi před dlouhým během nejedl, samotný nápoj těsně před startem nenahradí předchozí jídlo. Zvaž posunutí startu.',
      drink: 'Připrav dostupné pití podle počasí, pocení a občerstvovacích míst.',
      phase: {
        meal: { title: 'Hlavní jídlo', detail: 'Vyber jednu variantu jídla výše. Porci přizpůsob vlastní zkušenosti; není potřeba sníst všechny příklady.' },
        snack: { title: 'Volitelná svačina', detail: 'Podle hladu a předchozího jídla si dej banán nebo bílé pečivo s džemem. Svačina není další povinné jídlo.' },
        last: { title: 'Poslední hodina', detail: 'Připrav pití, vyzkoušené občerstvení a vybavení. Nedoháněj přípravu velkým jídlem.' },
        start: { title: 'Start', detail: 'Použij občerstvení, které máš vyzkoušené při tréninku.' }
      },
      range: '{from} až {to}',
      previousDay: '{time} (předchozí den)',
      error: {
        minutes: 'Zadej očekávanou délku běhu 10–720 minut.',
        start: 'Zadej čas startu.',
        budget: 'Zkontroluj délku běhu, cíl sacharidů a údaj na obalu.'
      }
    },
    en: {
      profile: {
        d5: {
          name: '5 km', short: '5 km', title: 'Preparing for 5 km',
          prep: 'A short, fast run such as a 5 km test mostly needs a settled stomach. Build on your usual meals during the day, leave a gap after your last bigger meal and keep fat and fibre low before the start.'
        },
        d6: {
          name: '6 km', short: '6 km', title: 'Preparing for 6 km',
          prep: 'Before a shorter run, build on your usual meals during the day. Choose a snack by how hungry you are and how long ago you last ate.'
        },
        d10: {
          name: '10 km', short: '10 km', title: 'Preparing for 10 km',
          prep: 'Have a familiar carbohydrate meal. Whether you need fuel on the course depends on your expected time, especially at race pace.'
        },
        d21: {
          name: 'Half marathon · 21.1 km', short: '21.1 km', title: 'Preparing for a half marathon',
          prep: 'Try out both your breakfast and your on-course fuel on a long training run. Have gels or a drink ready and check where the aid stations are.'
        },
        d42: {
          name: 'Marathon · 42.2 km', short: '42.2 km', title: 'Preparing for a marathon',
          prep: 'Preparation starts in the days before. Include familiar carbohydrate foods; do not rely on one big dinner. In the evening, for example, rice or white pasta with a smaller portion of lean protein.'
        }
      },
      meal: {
        meal: {
          title: 'Main meal · 2–4 hours before the start', name: 'Main meal', when: '2–4 hours before the start',
          text: 'Give the meal time to digest. Adjust the amount to your hunger, the length of the run and what you have tried before.',
          foods: ['Rice with a smaller portion of tofu or chicken.', 'White pasta with a light tomato sauce.', 'White toast with jam and a banana if you run in the morning.']
        },
        snack: {
          title: 'Smaller snack · 1–2 hours before the start', name: 'Smaller snack', when: '1–2 hours before the start',
          text: 'Pick one familiar, easily digested option that is low in fat and fibre.',
          foods: ['A banana.', 'White toast or a white roll with jam or honey.']
        },
        soon: {
          title: 'Less than an hour to the start', name: 'Last hour', when: 'less than an hour to the start',
          text: 'Do not try to catch up with a big meal now. Sip fluids gradually; for a long or intense run a sports drink you have tried before can help.',
          foods: ['Water in small sips.', 'A tried carbohydrate drink for a long or intense run.']
        }
      },
      fuel: {
        none: 'During exercise shorter than 45 minutes, carbohydrate is usually not needed.',
        small: 'During an intense run of 45–75 minutes, a small amount of carbohydrate can help. It is not a must for every easy run.',
        moderate: 'For an endurance run of this length, 30–60 g of carbohydrate per hour is commonly used. Count gels and drinks alike, and try the plan in training first.',
        high: 'For runs over 2.5–3 hours, up to 90 g of carbohydrate per hour from a glucose and fructose mix can be used after practice. It is not an automatic target for a beginner; increase the amount as you tolerate it.'
      },
      band: {
        none: { range: 'under 45 min', value: 'usually not needed' },
        small: { range: '45–75 min', value: 'a small amount' },
        moderate: { range: '76–150 min', value: '30–60 g/h' },
        high: { range: 'over 150 min', value: 'up to 90 g/h' }
      },
      late: 'If you have not eaten before a long run, a drink just before the start will not replace the earlier meal. Consider moving the start.',
      drink: 'Plan your drinks for the weather, how much you sweat and where you can refill.',
      phase: {
        meal: { title: 'Main meal', detail: 'Pick one of the meal options above. Size the portion from your own experience; you do not need to eat every example.' },
        snack: { title: 'Optional snack', detail: 'Depending on hunger and your last meal, have a banana or white bread with jam. The snack is not another compulsory meal.' },
        last: { title: 'Last hour', detail: 'Get your drink, tried fuel and kit ready. Do not make up for it with a big meal.' },
        start: { title: 'Start', detail: 'Use the fuel you have tried in training.' }
      },
      range: '{from} to {to}',
      previousDay: '{time} (previous day)',
      error: {
        minutes: 'Enter an expected run time of 10–720 minutes.',
        start: 'Enter the start time.',
        budget: 'Check the run time, your carbohydrate target and the amount on the pack.'
      }
    }
  });

  // ---------------------------------------------------------------- helpers

  function lang(locale) {
    const code = typeof locale === 'string' ? locale.toLowerCase().slice(0, 2) : 'cs';
    return code === 'en' ? 'en' : 'cs';
  }
  function fill(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m));
  }
  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

  /** 'd5' … 'd42' for a stored distance value ('5', 6, '21.1' …), else null. */
  function distanceCode(value) {
    const s = String(value);
    const found = DISTANCES.find(d => d.value === s);
    return found ? found.code : null;
  }
  /** The option closest to a distance in km (for "prefill from the next run"). */
  function nearestDistance(km) {
    if (!isNum(km) || km <= 0) return DISTANCES[0].value;
    let best = DISTANCES[0];
    for (const d of DISTANCES) if (Math.abs(Math.log(d.km / km)) < Math.abs(Math.log(best.km / km))) best = d;
    return best.value;
  }
  /** Carbohydrate band by duration (AIS): < 45 none, 45-75 small, 76-150 moderate, > 150 high. */
  function fuelBand(minutes) {
    if (!isNum(minutes)) return null;
    return minutes < 45 ? 'none' : minutes <= 75 ? 'small' : minutes <= 150 ? 'moderate' : 'high';
  }
  /** Highest g/h the calculator accepts: 60 up to 150 min, 90 above (after practice). */
  function rateMax(minutes) { return isNum(minutes) && minutes > 150 ? LIMITS.rateMaxLong : LIMITS.rateMaxModerate; }
  function validMinutes(minutes) { return isNum(minutes) && minutes >= LIMITS.minutesMin && minutes <= LIMITS.minutesMax; }

  // ---------------------------------------------------------------- guide

  /**
   * guide(distance, minutes, timing, locale = 'cs') -> the recommendation for one run.
   * distance: '5' | '6' | '10' | '21.1' | '42.2' (string or number); minutes: 10..720 (a number);
   * timing: 'meal' (2-4 h to the start) | 'snack' (1-2 h) | 'soon' (< 1 h). Throws RangeError otherwise.
   */
  function guide(distance, minutes, timing, locale) {
    const text = MESSAGES[lang(locale)];
    const code = distanceCode(distance);
    if (!code || TIMINGS.indexOf(timing) < 0 || !validMinutes(minutes)) throw new RangeError(text.error.minutes);
    const profile = text.profile[code], meal = text.meal[timing], fuelCode = fuelBand(minutes);
    return {
      distance: DISTANCES.find(d => d.code === code).value,
      code,
      name: profile.name,
      title: profile.title,
      prep: profile.prep,
      timing,
      meal: { code: timing, title: meal.title, name: meal.name, when: meal.when, text: meal.text, foods: meal.foods.slice() },
      fuelCode,
      fuel: text.fuel[fuelCode],
      longRun: minutes > LIMITS.calculatorAbove,
      lateLongRun: minutes > LIMITS.calculatorAbove && timing === 'soon'
    };
  }

  // ---------------------------------------------------------------- timeline

  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  function clock(base, offset) {
    const raw = base - offset, value = ((raw % 1440) + 1440) % 1440;
    return { time: String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0'), prevDay: raw < 0 };
  }

  /** phases() -> [{ code, offsetFrom, offsetTo, timing }] (minutes before the start; no clock needed). */
  function phases() { return PHASES.map(p => Object.assign({}, p)); }

  /**
   * timeline('17:00', locale = 'cs') -> four phases counted back from the planned start:
   *   [{ code, time: '13:00 až 15:00', title, detail, from: '13:00', to: '15:00' | null,
   *      fromPrevDay, toPrevDay, offsetFrom, offsetTo, timing }]
   * Times wrap across midnight; a time on the day before is marked (fromPrevDay / toPrevDay and
   * '(předchozí den)' in `time`). Throws RangeError for anything but a valid 'HH:MM'.
   */
  function timeline(start, locale) {
    const text = MESSAGES[lang(locale)];
    if (typeof start !== 'string' || !TIME_RE.test(start)) throw new RangeError(text.error.start);
    const [h, m] = start.split(':').map(Number), base = h * 60 + m;
    const label = c => (c.prevDay ? fill(text.previousDay, { time: c.time }) : c.time);
    return PHASES.map(p => {
      const from = clock(base, p.offsetFrom);
      const to = p.offsetTo === null ? null : clock(base, p.offsetTo);
      return {
        code: p.code,
        time: to ? fill(text.range, { from: label(from), to: label(to) }) : label(from),
        title: text.phase[p.code].title,
        detail: text.phase[p.code].detail,
        from: from.time, to: to ? to.time : null,
        fromPrevDay: from.prevDay, toPrevDay: to ? to.prevDay : false,
        offsetFrom: p.offsetFrom, offsetTo: p.offsetTo, timing: p.timing
      };
    });
  }

  // ---------------------------------------------------------------- fuel calculator

  /**
   * fuelBudget(minutes, gramsPerHour, gramsPerServing) -> { grams, servings }: carbohydrate for the
   * whole run at the runner's own tried target, servings rounded up. Only for runs > 75 min;
   * the target is 30-60 g/h up to 150 min and 30-90 g/h above; a serving holds 1-100 g.
   */
  function fuelBudget(minutes, rate, perServing) {
    if (![minutes, rate, perServing].every(isNum) || minutes <= LIMITS.calculatorAbove || minutes > LIMITS.minutesMax ||
      rate < LIMITS.rateMin || rate > LIMITS.rateMaxLong || (minutes <= 150 && rate > LIMITS.rateMaxModerate) ||
      perServing < LIMITS.servingMin || perServing > LIMITS.servingMax) {
      throw new RangeError(MESSAGES.cs.error.budget);
    }
    const grams = Math.round(minutes / 60 * rate);
    return { grams, servings: Math.ceil(grams / perServing) };
  }

  // ---------------------------------------------------------------- saved page state

  /**
   * readSaved(raw) -> { ok, data }: parses the 'veyvo-pre-run-v1' value (string or object).
   * data keeps every saved key; the known fields are strings and `checks` is { id: boolean }.
   * ok is false only for a value that cannot be read (data is then {}); null/empty is ok.
   */
  function readSaved(raw) {
    let value = raw;
    if (raw === null || raw === undefined || raw === '') return { ok: true, data: { checks: {} } };
    if (typeof raw === 'string') {
      try { value = JSON.parse(raw); } catch (e) { return { ok: false, data: { checks: {} } }; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, data: { checks: {} } };
    const data = Object.assign({}, value);
    Object.keys(FIELDS).forEach(k => {
      const id = FIELDS[k];
      if (id in data && typeof data[id] !== 'string') delete data[id];
    });
    const checks = {};
    if (data.checks && typeof data.checks === 'object' && !Array.isArray(data.checks)) {
      Object.keys(data.checks).forEach(k => { checks[k] = data.checks[k] === true; });
    }
    data.checks = checks;
    return { ok: true, data };
  }

  /** 0.3 API: Czech names and preparation texts keyed by the stored distance value. */
  const profiles = {};
  DISTANCES.forEach(d => { profiles[d.value] = { name: MESSAGES.cs.profile[d.code].name, prep: MESSAGES.cs.profile[d.code].prep }; });

  const api = {
    STORAGE_KEY, FIELDS, LIMITS, DISTANCES, TIMINGS, PHASES, CHECKS, FUEL_BANDS, MESSAGES,
    guide, profiles, timeline, phases, fuelBudget, fuelBand, rateMax, distanceCode, nearestDistance, readSaved
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VeyvoNutrition = api;
})(globalThis);
