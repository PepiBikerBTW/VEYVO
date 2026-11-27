/*
 * VeyvoUI.app - the VEYVO 0.4 runtime: state, derived data, navigation, dialogs, toasts, theme,
 * language, Strava background sync, updates, daily backups and the Android back button.
 * Full contract with examples: docs/ui-architecture.md.
 *
 *   app.start()                                   boot (ui/boot.js calls it once)
 *   app.state()                                   frozen v2 state snapshot (never mutate)
 *   app.update(draft => { ... }, { reason, toast, undo, render })
 *   app.update(s => VeyvoStore.addRun(s, input, { today: app.today() }), { toast: '…', undo: true })
 *   app.derived()                                 memoized per state version + today + locale
 *   app.navigate('plan', { params })              page transition, title, nav, history
 *   app.pages.register(name, { title, render(container, ctx), actions?, eyebrow?, onLeave? })
 *   app.dialogs.register(name, { open(params, app) }) / app.dialogs.open(name, params) / .create({...})
 *   app.components.register(name, factory) / app.components.create(name, props)
 *   app.toast(message, { action: { label, run }, kind, duration })
 *   app.confirm({ title, body, confirmLabel, danger }) -> Promise<boolean>
 *   app.setTheme('dark' | 'light'), app.setLanguage('cs' | 'en'), app.t(key, params)
 *   app.strava.{ supported, status(), sync({ manual }), connect(secret), disconnect(), refresh() }
 *   app.updates.{ supported, status(), check(), install() }
 *   app.on('state' | 'navigate' | 'today' | 'theme' | 'language' | 'strava' | 'updates' | 'backup' | 'dialog' | 'ready', cb) -> off
 */
(function (root) {
  'use strict';

  const UI = root.VeyvoUI = root.VeyvoUI || {};
  const dom = UI.dom, icons = UI.icons, motion = UI.motion, charts = UI.charts, fmt = UI.fmt;
  const h = dom.h, $ = dom.$, $$ = dom.$$;
  const doc = root.document;
  const Store = root.VeyvoStore, I18n = root.VeyvoI18n, Format = root.VeyvoFormat, Runs = root.VeyvoRuns;
  const Training = root.VeyvoTraining, Workouts = root.VeyvoWorkouts, Platform = root.VeyvoPlatform;

  // ================================================================ texts (namespace 'ui')
  const MESSAGES = {
    cs: {
      skip: 'Přeskočit na obsah',
      goal: '{distance} km pod {time}',
      goalDistance: 'Cíl {distance} km',
      nav: {
        label: 'Hlavní navigace', home: 'Přehled', plan: 'Můj plán', progress: 'Výkonnost', nutrition: 'Před během',
        settings: 'Nastavení', log: 'Zapsat běh', more: 'Více', nextRun: 'Další běh:'
      },
      tab: { home: 'Přehled', plan: 'Plán', log: 'Zapsat', progress: 'Výkonnost', more: 'Více' },
      profile: { anonymous: 'Běžec', edit: 'Upravit profil a cíl' },
      theme: { toLight: 'Přepnout na světlý režim', toDark: 'Přepnout na tmavý režim' },
      dialog: { close: 'Zavřít' },
      toast: { close: 'Zavřít oznámení', undo: 'Vrátit', undone: 'Vráceno.' },
      confirm: { title: 'Opravdu pokračovat?' },
      strava: {
        name: 'Strava',
        connect: 'Připojit Stravu',
        syncing: 'Synchronizuji…',
        never: 'Zatím bez synchronizace',
        todayAt: 'dnes {time}',
        syncedAt: 'Synchronizováno {when}',
        errorShort: 'Strava: chyba',
        imported: { one: 'Ze Stravy přibyl {n} běh.', few: 'Ze Stravy přibyly {n} běhy.', many: 'Ze Stravy přibylo {n} běhu.', other: 'Ze Stravy přibylo {n} běhů.' },
        upToDate: 'Běhy ze Stravy jsou aktuální.',
        failed: 'Synchronizace Stravy se nezdařila: {message}',
        connectFailed: 'Stravu se nepodařilo připojit: {message}',
        connectedToast: 'Strava je připojená. Načítám běhy.',
        finishInBrowser: 'Dokonči přihlášení ke Stravě v prohlížeči.',
        disconnected: 'Strava je odpojená.'
      },
      updates: {
        ready: 'Verze {version} je stažená a připravená.',
        restart: 'Restartovat',
        available: 'Je dostupná nová verze {version}.',
        download: 'Stáhnout'
      },
      backup: { failed: 'Denní zálohu se nepodařilo uložit: {message}' },
      boot: {
        safeStart: 'Spustit bez uložených dat',
        safeStartHint: 'Uložená data zůstanou v kopii v zařízení. Pak je obnovíš v Nastavení › Data › Automatické zálohy.'
      },
      errors: {
        pageFailed: 'Tuto stránku se nepodařilo zobrazit.',
        unknown: 'Něco se nepovedlo.',
        dialogMissing: 'Tato část ještě není hotová.',
        code: {
          auth_required: 'Strava odmítla uložené přihlášení (401). Připoj účet znovu.',
          strava_http: 'Strava odpověděla chybou {status}. Zkus to později.'
        }
      },
      more: { title: 'Více', darkMode: 'Tmavý režim', language: 'Jazyk', profile: 'Profil a cíl' },
      stub: { title: 'Tato stránka se připravuje', text: 'Obsah sem doplní další krok vývoje verze 0.4.' },
      shortcut: { log: 'Zkratka N' }
    },
    en: {
      skip: 'Skip to content',
      goal: '{distance} km under {time}',
      goalDistance: 'Goal {distance} km',
      nav: {
        label: 'Main navigation', home: 'Overview', plan: 'My plan', progress: 'Progress', nutrition: 'Before the run',
        settings: 'Settings', log: 'Log a run', more: 'More', nextRun: 'Next run:'
      },
      tab: { home: 'Overview', plan: 'Plan', log: 'Log', progress: 'Progress', more: 'More' },
      profile: { anonymous: 'Runner', edit: 'Edit profile and goal' },
      theme: { toLight: 'Switch to light mode', toDark: 'Switch to dark mode' },
      dialog: { close: 'Close' },
      toast: { close: 'Dismiss notification', undo: 'Undo', undone: 'Undone.' },
      confirm: { title: 'Are you sure?' },
      strava: {
        name: 'Strava',
        connect: 'Connect Strava',
        syncing: 'Syncing…',
        never: 'Not synced yet',
        todayAt: 'today {time}',
        syncedAt: 'Synced {when}',
        errorShort: 'Strava: error',
        imported: { one: '{n} new run from Strava.', other: '{n} new runs from Strava.' },
        upToDate: 'Strava runs are up to date.',
        failed: 'Strava sync failed: {message}',
        connectFailed: 'Strava could not be connected: {message}',
        connectedToast: 'Strava is connected. Loading runs.',
        finishInBrowser: 'Finish the Strava sign-in in your browser.',
        disconnected: 'Strava is disconnected.'
      },
      updates: {
        ready: 'Version {version} is downloaded and ready.',
        restart: 'Restart',
        available: 'Version {version} is available.',
        download: 'Download'
      },
      backup: { failed: 'The daily backup could not be saved: {message}' },
      boot: {
        safeStart: 'Start without the saved data',
        safeStartHint: 'The saved data stays in a copy on this device. You can then restore it in Settings › Data › Automatic backups.'
      },
      errors: {
        pageFailed: 'This page could not be shown.',
        unknown: 'Something went wrong.',
        dialogMissing: 'This part is not ready yet.',
        code: {
          auth_required: 'Strava rejected the saved sign-in (401). Connect the account again.',
          strava_http: 'Strava answered with error {status}. Try again later.'
        }
      },
      more: { title: 'More', darkMode: 'Dark mode', language: 'Language', profile: 'Profile and goal' },
      stub: { title: 'This page is being built', text: 'The next 0.4 development step fills it in.' },
      shortcut: { log: 'Shortcut N' }
    }
  };
  I18n.register('ui', MESSAGES);

  /** t(key, params): VeyvoI18n.t + Czech typography (non-breaking spaces). Use it for every visible string. */
  function t(key, params) { return fmt.typo(I18n.t(key, params)); }

  // ================================================================ internals
  let state = null;
  let version = 0;
  let started = false, ready = false;
  let todayKey = null, todayOverride = null;
  let currentPage = null, pageParams = null;
  let derivedCache = null;
  let loadReport = null;
  let midnightTimer = null;
  const pages = new Map();
  const dialogDefs = new Map();
  const componentDefs = new Map();
  const actionDefs = new Map();
  const listeners = new Map();
  const dialogStack = [];
  const els = {};
  const mqPhone = root.matchMedia ? root.matchMedia('(max-width: 760px)') : { matches: false, addEventListener() {} };
  const mqRail = root.matchMedia ? root.matchMedia('(max-width: 960px) and (min-width: 761px)') : { matches: false, addEventListener() {} };

  const memory = new Map();
  const storage = (function () {
    try { const s = root.localStorage; s.getItem('veyvo-probe'); return s; } catch (e) {
      return { getItem: k => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) };
    }
  })();
  function readLS(key) { try { return storage.getItem(key); } catch (e) { return null; } }
  function writeLS(key, value) { try { storage.setItem(key, value); } catch (e) { /* storage full: not critical here */ } }

  function emit(type, detail) {
    (listeners.get(type) || []).slice().forEach(cb => { try { cb(detail); } catch (err) { console.error('VeyvoUI.app listener', type, err); } });
  }
  function on(type, cb) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(cb);
    return () => { const list = listeners.get(type) || []; const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); };
  }
  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.keys(value).forEach(k => deepFreeze(value[k]));
    }
    return value;
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  function errorText(err) {
    if (err && err.code && I18n.has('platform.error.' + err.code)) return t('platform.error.' + err.code);
    if (err && err.code && I18n.has('ui.errors.code.' + err.code)) {
      const status = /\((\d{3})\)/.exec(String(err.message || ''));
      return t('ui.errors.code.' + err.code, { status: status ? status[1] : '–' });
    }
    const message = err && (err.message || (typeof err === 'string' ? err : ''));
    return String(message || t('ui.errors.unknown')).replace(/^\[[a-z_]+\]\s*/i, '');
  }

  // ================================================================ today
  function computeToday() { return todayOverride || Format.toDateKey(new Date()); }
  function scheduleMidnight() {
    clearTimeout(midnightTimer);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    midnightTimer = setTimeout(checkToday, Math.min(next - now, 2147483000));
  }
  function checkToday() {
    if (ready) dailyUpdateCheck();
    const key = computeToday();
    if (key !== todayKey) {
      todayKey = key;
      derivedCache = null;
      emit('today', key);
      renderAll({ animate: false, reason: 'date' });
      maybeBackup();
    }
    scheduleMidnight();
  }

  // ================================================================ derived data
  function findLast(list, test) { for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return list[i]; return null; }

  /** computeDerived(state, today): every derived field (docs/ui-architecture.md section 4), pure. */
  function computeDerived(s, today) {
    const profile = s.profile, locale = I18n.getLocale();
    const runs = Runs.sortRuns(s.runHistory);
    const pastRuns = runs.filter(r => r.date <= today);
    const latestRun = pastRuns.length ? pastRuns[pastRuns.length - 1] : (runs.length ? runs[runs.length - 1] : null);
    // Baseline for the engine's easy pace: the latest 5 km test, else the latest 5 km effort - only runs
    // the engine accepts as a 5 km reference (VeyvoRuns.isFiveKAttempt: 4.95-5.2 km, plausible pace).
    const baselineRun = findLast(runs, r => r.type === 'test5k' && Runs.isFiveKAttempt(r)) || findLast(runs, r => Runs.isFiveKAttempt(r));
    let nextRun = latestRun ? Training.nextRunAfterRun(latestRun, profile.days, today, baselineRun) : null;
    // The engine always plans from tomorrow on. Keep today in play until a run is logged today:
    // evaluated as of yesterday, a run that lands on today is today's run (home, plan and the nav
    // badge then all say "Dnes"). A return after a break already starts today.
    if (latestRun && latestRun.date < today && nextRun && nextRun.kind !== 'rest' && nextRun.date !== today) {
      const asOfYesterday = Training.nextRunAfterRun(latestRun, profile.days, Runs.addDays(today, -1), baselineRun);
      if (asOfYesterday && asOfYesterday.kind !== 'rest' && asOfYesterday.date === today) nextRun = asOfYesterday;
    }
    const records = Runs.records(runs);
    const goal = Runs.goalProgress(profile, runs);
    const recoveryToday = s.recoveryLogs.find(l => l.date === today) || null;
    // Same rule as 0.3 (journal.js renderRecovery): fatigue >= 8 or soreness >= 7 -> rest first.
    const recoveryAdvice = recoveryToday && ((recoveryToday.fatigue || 0) >= 8 || (recoveryToday.soreness || 0) >= 7)
      ? { code: 'rest', fatigue: recoveryToday.fatigue, soreness: recoveryToday.soreness } : null;
    const paces = Workouts.derivePaces({
      best5kSeconds: records.fastest5k ? records.fastest5k.value : null,
      targetSeconds: profile.goalDistanceKm === 5 ? profile.targetSeconds : null
    });
    const library = Workouts.library(paces, { locale });
    const planned = (s.plannedWorkouts || []).map(p => {
      const template = library.find(tpl => tpl.id === p.templateId) || null;
      return Object.assign({}, p, { template, workout: template ? datedWorkout(template.workout, p.date) : null });
    });
    const plannedForNext = nextRun && nextRun.date ? planned.find(p => p.date === nextRun.date && p.workout) : null;
    const nextWorkout = plannedForNext ? plannedForNext.workout : (nextRun ? Workouts.fromNextRun(nextRun, profile, { locale }) : null);
    // nextSession: the next thing to do, whichever comes first - a scheduled library session from
    // today on (on a day without a logged run) or the engine's run. The runner's own plan wins a tie.
    const runDates = new Set(runs.map(r => r.date));
    const upcoming = planned.find(p => p.workout && p.date >= today && !runDates.has(p.date)) || null;
    const engineDate = nextRun && nextRun.kind !== 'rest' && nextRun.date ? nextRun.date : null;
    let nextSession = null;
    if (upcoming && (!engineDate || upcoming.date <= engineDate)) nextSession = { source: 'planned', date: upcoming.date, templateId: upcoming.templateId, planned: upcoming, workout: upcoming.workout };
    else if (engineDate && nextWorkout) nextSession = { source: 'engine', date: engineDate, templateId: plannedForNext ? plannedForNext.templateId : null, planned: plannedForNext, workout: nextWorkout };
    const weekStrip = Runs.weekStrip(runs, { todayKey: today, profile, nextRun }).map(day => {
      const p = planned.find(x => x.date === day.date);
      return p ? Object.assign({}, day, { plannedWorkout: p }) : day;
    });
    return {
      today, locale, profile,
      runs, runsDesc: runs.slice().reverse(), hasRuns: runs.length > 0,
      latestRun, baselineRun,
      totals: Runs.totals(runs),
      last7: Runs.lastNDays(runs, today, 7),
      weekly: Runs.weeklyTotals(runs, today, 12),
      goal, records,
      notes: Runs.runNotes(runs, profile),
      milestones: Runs.milestones(runs, profile),
      legacyMilestones: s.legacyMilestones,
      streak: Runs.currentStreakWeeks(runs, today, profile),
      nextRun, nextWorkout, nextSession, planned, weekStrip,
      recoveryToday, recoveryAdvice,
      paces, library
    };
  }
  function datedWorkout(workout, date) {
    const copy = clone(workout);
    copy.id = workout.id + '-' + date;
    copy.date = date;
    return copy;
  }
  /** derived(): memoized per state version, today and locale. Frozen; never mutate. */
  function derived() {
    const key = version + '|' + todayKey + '|' + I18n.getLocale();
    if (derivedCache && derivedCache.key === key) return derivedCache.value;
    const value = deepFreeze(computeDerived(state, todayKey));
    derivedCache = { key, value };
    return value;
  }

  // ================================================================ state updates
  /**
   * update(mutator, { reason, toast, toastKind, undo, render }) -> { ok, state, prev, result, errors? }
   * mutator(draft) may: mutate the draft (a deep copy); return a whole v2 state; return a VeyvoStore
   * edit result ({ ok, state, undo, errors }) - ok:false aborts and returns its errors; or return false
   * to cancel. Then: save (VeyvoStore.save) -> daily backup -> derived recomputed -> shell + current
   * page re-rendered without entrance animations (render: 'shell' re-renders only the shell, false
   * nothing) -> 'state' event -> optional toast; undo: true adds an Undo action (VeyvoStore undo token
   * when the result carries one, otherwise the previous snapshot).
   */
  function update(mutator, options) {
    const o = options || {};
    if (!state) throw new Error('VeyvoUI.app.update before start()');
    const prev = state;
    const draft = clone(prev);
    let result;
    try { result = mutator(draft); } catch (err) {
      console.error('VeyvoUI.app.update', err);
      toast(t('ui.errors.unknown'), { kind: 'error' });
      return { ok: false, error: err, state: prev };
    }
    if (result === false) return { ok: false, cancelled: true, state: prev };
    let next = draft, undoToken = null;
    if (result && typeof result === 'object') {
      if (result.schemaVersion === Store.SCHEMA_VERSION) next = result;
      else if ('ok' in result && 'state' in result) {
        if (!result.ok) return { ok: false, errors: result.errors || [], result, state: prev };
        next = result.state;
        undoToken = result.undo || null;
      }
    }
    const done = commit(next, o, prev, undoToken);
    if (!done.ok) return { ok: false, saved: false, error: done.error, errors: [done.error], result, state: prev };
    return { ok: true, state, prev, result };
  }

  /** Back to prev after a change that cannot be shown or saved: what you see is what is stored. */
  function rollback(prev) {
    state = prev;
    version += 1;
    derivedCache = null;
  }

  function commit(next, o, prev, undoToken) {
    if (next === prev) next = clone(prev);
    deepFreeze(next);
    state = next;
    version += 1;
    derivedCache = null;
    // Never store a state the app cannot show: it would fail again on every launch.
    try { derived(); } catch (err) {
      console.error('VeyvoUI.app.update: the new state cannot be shown', err);
      rollback(prev);
      toast(t('ui.errors.unknown'), { kind: 'error' });
      return { ok: false, error: 'derive-failed' };
    }
    const saved = Store.save(storage, next);
    if (!saved.ok) {
      // Nothing was written: keep the stored state, show only the error (no success or Undo toast),
      // and let the caller keep its form open so a retry cannot add the change twice.
      rollback(prev);
      toast(t('store.error.' + saved.error), { kind: 'error', duration: 12000 });
      return { ok: false, error: saved.error };
    }
    maybeBackup();
    if (o.render === 'shell') renderShell();
    else if (o.render !== false) renderAll({ animate: false, reason: o.reason || 'update' });
    emit('state', { reason: o.reason || 'update', prev, next });
    if (o.toast || o.undo) {
      let action = null;
      if (o.undo) {
        action = {
          label: t('ui.toast.undo'),
          run: () => {
            if (undoToken) update(s => Store.applyUndo(s, undoToken), { reason: 'undo', toast: t('ui.toast.undone') });
            else update(() => clone(prev), { reason: 'undo', toast: t('ui.toast.undone') });
          }
        };
      }
      toast(o.toast || t('common.status.saved'), { action, kind: o.toastKind || 'success' });
    }
    return { ok: true };
  }

  // ================================================================ backups (once per day where supported)
  let backupWarned = false;
  let backupLast = null;      // { ok, path | error, at } of the latest daily snapshot (Settings shows a failure)
  let loadNotice = null;      // the start-up notice while it waits to be shown (a backup failure joins it)
  function maybeBackup() {
    const B = Platform.backup;
    if (!B || !B.supported || !state || !todayKey) return;
    if (!state.runHistory.length && !state.recoveryLogs.length) return;
    const key = 'veyvo-last-backup';
    if (readLS(key) === todayKey) return;
    writeLS(key, todayKey);
    const snapshot = state;
    Platform.version().catch(() => null)
      .then(v => B.snapshot(Store.exportBackup(snapshot, readLS(Store.NUTRITION_KEY), { appVersion: v, exportedAt: new Date(), legacy: readLS(Store.LEGACY_BACKUP_KEY) })))
      .then(r => {
        backupLast = { ok: true, path: (r && r.path) || null, at: new Date().toISOString() };
        emit('backup', { ok: true, path: r && r.path });
      }, err => {
        writeLS(key, '');
        backupLast = { ok: false, error: err, at: new Date().toISOString() };
        emit('backup', { ok: false, error: err });
        if (backupWarned) return;
        backupWarned = true;
        const message = t('ui.backup.failed', { message: errorText(err) });
        // On the upgrade launch the migration notice follows within 600 ms and would replace this toast.
        if (loadNotice) { loadNotice.messages.push(message); loadNotice.kind = 'error'; }
        else toast(message, { kind: 'error' });
      });
  }

  // ================================================================ pages + navigation
  function sectionFor(name, create) {
    let section = els.main && els.main.querySelector('[data-page="' + name + '"]');
    if (!section && create && els.main) {
      section = h('section.page', { dataset: { page: name }, 'aria-labelledby': 'page-title', hidden: true });
      els.main.append(section);
    }
    return section;
  }
  const pagesApi = {
    /** register(name, { title: i18nKey, render(container, ctx), actions?(ctx) -> Node, eyebrow?(ctx) -> string, onLeave?() }) */
    register(name, def) {
      if (!name || !def || typeof def.render !== 'function') throw new Error('VeyvoUI.app.pages.register: need a name and render()');
      pages.set(name, def);
      if (els.main) sectionFor(name, true);
      if (ready && name === currentPage) renderAll({ animate: false, reason: 'register' });
    },
    get: name => pages.get(name) || null,
    list: () => Array.from(pages.keys()),
    current: () => currentPage
  };

  function ctx(opts) {
    return {
      app: api, state, derived: derived(), today: todayKey, locale: I18n.getLocale(),
      t, fmt, dom, h, icons, motion, charts, components: componentsApi, platform: Platform,
      animate: !!opts.animate, reason: opts.reason || 'render', params: pageParams, isPhone: mqPhone.matches
    };
  }

  function pageFromHash() {
    const name = String(root.location && root.location.hash || '').replace(/^#\/?/, '').split(/[?/]/)[0];
    return pages.has(name) ? name : null;
  }

  /** navigate(name, { params, animate = true, focus = true, replace }) */
  function navigate(name, options) {
    const o = options || {};
    let target = name;
    if (!pages.has(target)) { console.warn('VeyvoUI.app.navigate: unknown page', name); target = 'home'; }
    const prev = currentPage;
    if (prev && prev !== target) {
      const pd = pages.get(prev);
      if (pd && typeof pd.onLeave === 'function') { try { pd.onLeave(); } catch (err) { console.error(err); } }
    }
    currentPage = target;
    pageParams = o.params || null;
    sectionFor(target, true);
    $$('[data-page]', els.main).forEach(sec => { sec.hidden = sec.getAttribute('data-page') !== target; });
    if (!o.fromHash) { try { root.history.replaceState(null, '', '#' + target); } catch (e) { /* file:// without history */ } }
    if (els.main) els.main.scrollTop = 0;
    renderShell();
    renderPage({ animate: o.animate !== false, reason: 'navigate' });
    if (prev !== target) motion.pageEnter(sectionFor(target));
    if (o.focus !== false && ready && els.title) els.title.focus({ preventScroll: true });
    emit('navigate', { from: prev, to: target, params: pageParams });
  }

  function activeKey(section) {
    const a = doc.activeElement;
    if (!a || !section.contains(a)) return null;
    if (a.getAttribute('data-key')) return a.getAttribute('data-key');
    return a.id ? '#' + a.id : null;
  }
  function restoreFocus(section, key) {
    if (!key) return;
    let el = null;
    try { el = key[0] === '#' ? section.querySelector('#' + CSS.escape(key.slice(1))) : section.querySelector('[data-key="' + CSS.escape(key) + '"]'); } catch (e) { el = null; }
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  function renderPage(opts) {
    const o = opts || {};
    const def = pages.get(currentPage);
    const section = sectionFor(currentPage, true);
    if (!def || !section) return;
    const animate = !!o.animate && !motion.prefersReduced();
    section.dataset.anim = animate ? 'on' : 'off';
    const scroller = els.main;
    const keepScroll = !animate && scroller ? scroller.scrollTop : 0;
    const focusKey = !animate ? activeKey(section) : null;
    try {
      def.render(section, ctx({ animate, reason: o.reason }));
    } catch (err) {
      console.error('VeyvoUI page "' + currentPage + '" failed', err);
      dom.mount(section, componentsApi.create('empty', {
        icon: 'warning', title: t('ui.errors.pageFailed'), text: String(err && err.message || err),
        actions: [h('button.btn.btn-secondary', { type: 'button', onClick: () => renderPage({ animate: false }) }, t('common.button.retry'))]
      }));
    }
    icons.hydrate(section);
    I18n.apply(section);
    if (!animate && scroller) { scroller.scrollTop = keepScroll; restoreFocus(section, focusKey); }
  }

  function renderAll(opts) { renderShell(); renderPage(opts || { animate: false }); }

  // ================================================================ shell
  function cacheShell() {
    els.app = $('#app');
    els.main = $('#main');
    els.nav = $('#nav');
    els.lane = $('.nav-lane', els.nav || doc);
    els.title = $('#page-title');
    els.date = $('[data-slot="date"]');
    els.badge = $('[data-slot="next-badge"]');
    els.conn = $('[data-slot="connection"]');
    els.profile = $('[data-slot="profile"]');
    els.mProfile = $('[data-slot="m-profile"]');
    els.actions = $('[data-slot="topbar-actions"]');
    els.dialogRoot = $('#dialog-root') || doc.body;
    els.toastRoot = $('#toast-root');
    pages.forEach((def, name) => sectionFor(name, true));
  }

  function positionLane() {
    if (!els.nav || !els.lane) return;
    const active = els.nav.querySelector('.nav-item[aria-current="page"]');
    if (!active) { els.lane.style.setProperty('--lane-o', '0'); return; }
    const y = active.offsetTop + (active.offsetHeight - 20) / 2;
    els.lane.style.setProperty('--lane-y', y + 'px');
    els.lane.style.setProperty('--lane-o', '1');
  }

  function stravaWhen(iso) {
    if (!iso) return null;
    const local = new Date(iso);
    if (!Number.isFinite(local.getTime())) return null;
    const key = Format.toDateKey(local);
    if (key === todayKey) return t('ui.strava.todayAt', { time: String(local.getHours()).padStart(2, '0') + ':' + String(local.getMinutes()).padStart(2, '0') });
    return fmt.date(key, 'short');
  }

  function renderConnection() {
    const slot = els.conn;
    if (!slot || !state) return;
    if (!Platform.strava || !Platform.strava.supported) { slot.hidden = true; return; }
    slot.hidden = false;
    const s = state.strava;
    let cls, icon, title, sub = null;
    if (stravaBusy) { cls = 'is-busy'; icon = 'refresh'; title = t('ui.strava.syncing'); }
    else if (!s.connected) { cls = 'is-off'; icon = 'link'; title = t('ui.strava.connect'); }
    else if (s.lastError) { cls = 'is-error'; icon = 'warning'; title = t('ui.strava.errorShort'); sub = s.lastError; }
    else { cls = 'is-ok'; icon = 'link'; title = t('ui.strava.name'); sub = s.lastSync ? stravaWhen(s.lastSync) : t('ui.strava.never'); }
    const full = s.lastError || (s.connected && s.lastSync ? t('ui.strava.syncedAt', { when: stravaWhen(s.lastSync) }) : null);
    slot.replaceChildren(h('button.conn', { type: 'button', class: cls, dataset: { action: 'connection' }, title: full, 'aria-label': full ? title + ', ' + full : title },
      icons.get(icon), h('span.conn-text', h('span', title), sub ? h('small.truncate', sub) : null), h('span.conn-dot', { 'aria-hidden': 'true' })));
  }

  function avatarNode(profile) {
    const initial = (profile.name || '').trim().charAt(0).toLocaleUpperCase(I18n.getLocale());
    return h('span.avatar', { 'aria-hidden': 'true' }, initial || icons.get('user', { size: 16 }));
  }

  function renderProfile() {
    if (!state) return;
    const p = state.profile;
    const name = p.name || t('ui.profile.anonymous');
    const dark = state.theme !== 'light';
    if (els.profile) {
      els.profile.replaceChildren(
        h('button.me-main', { type: 'button', dataset: { action: 'profile' }, title: t('ui.profile.edit') },
          avatarNode(p),
          h('span.me-text', h('span.me-name.truncate', name), h('span.me-goal.truncate', fmt.goal(p)))),
        h('button.icon-btn.icon-btn-sm', { type: 'button', dataset: { action: 'toggle-theme' }, 'aria-label': t(dark ? 'ui.theme.toLight' : 'ui.theme.toDark'), title: t(dark ? 'ui.theme.toLight' : 'ui.theme.toDark') },
          icons.get(dark ? 'sun' : 'moon', { size: 16 })));
    }
    if (els.mProfile) {
      els.mProfile.replaceChildren(avatarNode(p));
      els.mProfile.setAttribute('aria-label', t('ui.nav.more'));
    }
  }

  function renderShell() {
    if (!state) return;
    I18n.apply(doc.body);
    const d = derived();
    $$('[data-nav]').forEach(a => { if (a.getAttribute('data-nav') === currentPage) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    // Phone tab bar: a page without its own tab (Před během) lives under "Více", so that tab lights up.
    const moreTab = $('#tabbar [data-action="more"]');
    if (moreTab) moreTab.classList.toggle('is-current', !!currentPage && !$('#tabbar [data-nav="' + currentPage + '"]'));
    if (mqRail.matches) $$('.sidebar .nav-item').forEach(a => { const label = a.querySelector('.side-label'); if (label) a.title = label.textContent; });
    else $$('.sidebar .nav-item[title]').forEach(a => a.removeAttribute('title'));
    positionLane();
    if (els.badge) {
      const next = d.nextSession;
      if (next && next.date) {
        const isToday = next.date === d.today;
        els.badge.hidden = false;
        els.badge.classList.toggle('is-today', isToday);
        els.badge.replaceChildren(h('span.sr-only', t('ui.nav.nextRun') + ' '), isToday ? I18n.t('common.today') : fmt.date(next.date, 'short'));
      } else { els.badge.hidden = true; els.badge.replaceChildren(); }
    }
    const def = pages.get(currentPage);
    const title = def ? t(def.title) : '';
    if (els.title) els.title.textContent = title;
    doc.title = title ? title + ' · VEYVO' : 'VEYVO';
    const c = ctx({ animate: false, reason: 'shell' });
    if (els.date) els.date.textContent = def && typeof def.eyebrow === 'function' ? def.eyebrow(c) : fmt.date(todayKey, 'long');
    if (els.actions) {
      let node = null;
      try { node = def && typeof def.actions === 'function' ? def.actions(c) : null; } catch (err) { console.error(err); }
      els.actions.replaceChildren();
      if (node) els.actions.append(node);
    }
    renderConnection();
    renderProfile();
  }

  // ================================================================ dialogs
  /**
   * create({ title, eyebrow, body, actions, size: 'sm'|'md'|'lg', kind: 'modal'|'sheet', className,
   *          dismissible = true, initialFocus, onClose(result), beforeClose(result) -> false to keep open })
   * -> handle { el, panel, head, body, foot, titleEl, close(result), setTitle(text), setBusy(bool), isOpen() }
   * Native <dialog>.showModal(): page inert, Esc closes, focus returns to the opener. Desktop: centred
   * modal or right side sheet. Phone (<= 760 px): bottom sheet (sheets are full height).
   */
  function createDialog(options) {
    const o = Object.assign({ size: 'md', kind: 'modal', dismissible: true }, options || {});
    const titleId = dom.uid('dlg-t');
    const titleEl = h('h2.dlg-title', { id: titleId }, o.title || '');
    const closeBtn = o.dismissible ? h('button.icon-btn.dlg-close', { type: 'button', 'aria-label': t('ui.dialog.close'), title: t('ui.dialog.close') }, icons.get('x')) : null;
    const head = h('div.dlg-head', h('div.dlg-titles', o.eyebrow ? h('span.eyebrow', o.eyebrow) : null, titleEl), closeBtn);
    const body = h('div.dlg-body');
    const bodyContent = typeof o.body === 'string' ? h('p', o.body) : o.body;
    if (bodyContent) dom.mount(body, bodyContent);
    const foot = h('div.dlg-foot');
    (o.actions || []).forEach(a => foot.append(a && a.nodeType ? a : h('button', { type: 'button', class: ['btn', 'btn-' + (a.kind || 'secondary')], onClick: () => a.run && a.run(handle) }, a.label)));
    const panel = h('div.dlg-panel', { tabindex: '-1' }, h('div.dlg-grab', { 'aria-hidden': 'true' }), head, body, foot);
    const el = h('dialog', { class: ['dlg', 'dlg-' + o.kind, 'dlg-' + o.size, o.className], 'aria-labelledby': titleId }, panel);
    const opener = doc.activeElement;
    let closed = false, downOnBackdrop = false;
    const handle = {
      el, panel, head, body, foot, titleEl,
      isOpen: () => !closed,
      setTitle(text) { titleEl.textContent = text; },
      setBusy(busy) { panel.setAttribute('aria-busy', busy ? 'true' : 'false'); $$('button', foot).forEach(b => { b.disabled = !!busy; }); },
      close(result) {
        if (closed) return;
        if (typeof o.beforeClose === 'function' && o.beforeClose(result) === false) return;
        closed = true;
        const i = dialogStack.indexOf(handle);
        if (i >= 0) dialogStack.splice(i, 1);
        const finish = () => {
          if (els.toastRoot && el.contains(els.toastRoot)) placeToasts();
          try { el.close(); } catch (e) { /* already closed */ }
          el.remove();
          if (opener && typeof opener.focus === 'function' && doc.contains(opener)) opener.focus({ preventScroll: true });
          if (typeof o.onClose === 'function') { try { o.onClose(result); } catch (err) { console.error(err); } }
          emit('dialog', { open: false, count: dialogStack.length });
        };
        if (motion.prefersReduced()) finish();
        else { el.classList.add('is-closing'); setTimeout(finish, 190); }
      }
    };
    if (closeBtn) closeBtn.addEventListener('click', () => handle.close());
    el.addEventListener('cancel', e => { e.preventDefault(); if (o.dismissible) handle.close(); });
    el.addEventListener('pointerdown', e => { downOnBackdrop = e.target === el; });
    el.addEventListener('click', e => { if (e.target === el && downOnBackdrop && o.dismissible) handle.close(); downOnBackdrop = false; });
    els.dialogRoot.append(el);
    icons.hydrate(el);
    el.showModal();
    dialogStack.push(handle);
    // Initial focus: the given element, else the first form field, else the panel itself (no ring).
    const initial = typeof o.initialFocus === 'string' ? $(o.initialFocus, el) : o.initialFocus;
    const field = dom.focusables(body).find(n => n.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea'));
    (initial || field || panel).focus({ preventScroll: true });
    placeToasts();
    emit('dialog', { open: true, count: dialogStack.length });
    return handle;
  }

  const dialogsApi = {
    /** register(name, { open(params, app) -> handle | Promise }) */
    register(name, def) {
      if (!name || !def || typeof def.open !== 'function') throw new Error('VeyvoUI.app.dialogs.register: need a name and open()');
      dialogDefs.set(name, def);
    },
    has: name => dialogDefs.has(name),
    open(name, params) {
      const def = dialogDefs.get(name);
      if (!def) { toast(t('ui.errors.dialogMissing'), { kind: 'error' }); return null; }
      try { return def.open(params || {}, api); } catch (err) {
        console.error('VeyvoUI dialog "' + name + '" failed', err);
        toast(t('ui.errors.unknown'), { kind: 'error' });
        return null;
      }
    },
    create: createDialog,
    close(result) { const top = dialogStack[dialogStack.length - 1]; if (top) top.close(result); },
    closeAll() { dialogStack.slice().reverse().forEach(d => d.close()); },
    isOpen: () => dialogStack.length > 0,
    top: () => dialogStack[dialogStack.length - 1] || null
  };

  /** confirm({ title, body, confirmLabel, cancelLabel, danger }) -> Promise<boolean> (styled dialog). */
  function confirm(options) {
    const o = options || {};
    return new Promise(resolve => {
      let result = false;
      const cancel = h('button.btn.btn-secondary', { type: 'button' }, o.cancelLabel || t('common.button.cancel'));
      const ok = h('button', { type: 'button', class: ['btn', o.danger ? 'btn-danger-solid' : 'btn-primary'] }, o.confirmLabel || t('common.button.confirm'));
      const d = createDialog({
        title: o.title || t('ui.confirm.title'), size: 'sm', kind: 'modal', className: 'dlg-confirm',
        body: o.body ? (typeof o.body === 'string' ? h('p', fmt.typo(o.body)) : o.body) : null,
        actions: [cancel, ok], initialFocus: o.danger ? cancel : ok,
        onClose: () => resolve(result)
      });
      cancel.addEventListener('click', () => d.close(false));
      ok.addEventListener('click', () => { result = true; d.close(true); });
    });
  }

  // ================================================================ toast
  let currentToast = null;
  /** The toast region lives in the top-most open dialog (top layer, not inert) or in <body>. */
  function placeToasts() {
    const region = els.toastRoot;
    if (!region) return;
    const top = dialogStack[dialogStack.length - 1];
    const host = top ? top.el : doc.body;
    if (region.parentNode !== host) host.appendChild(region);
  }
  /** toast(message, { action: { label, run }, kind: 'info'|'success'|'error', duration, icon }) -> { dismiss() } */
  function toast(message, options) {
    const o = options || {};
    const region = els.toastRoot || $('#toast-root');
    if (!region) { console.log('[toast]', message); return { dismiss() {} }; }
    if (currentToast) currentToast.dismiss(true);
    placeToasts();
    const kind = o.kind || 'info';
    const duration = o.duration || (o.action ? 6500 : kind === 'error' ? 7000 : 3200);
    const iconName = o.icon || (kind === 'error' ? 'warning' : kind === 'success' ? 'check-circle' : 'info');
    let timer = null, remaining = duration, startedAt = 0, gone = false;
    const el = h('div', { class: ['toast', 'is-' + kind], role: kind === 'error' ? 'alert' : null, style: { '--toast-ms': duration + 'ms' } },
      icons.get(iconName), h('div.toast-msg', fmt.typo(message)));
    const handle = {
      el,
      dismiss(immediate) {
        if (gone) return;
        gone = true;
        clearTimeout(timer);
        if (currentToast === handle) currentToast = null;
        if (immediate || motion.prefersReduced()) el.remove();
        else { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 180); }
      }
    };
    if (o.action && o.action.label) {
      el.append(h('button.toast-action', { type: 'button', onClick: () => { handle.dismiss(); try { o.action.run(); } catch (err) { console.error(err); } } }, o.action.label));
    }
    el.append(h('button.toast-close', { type: 'button', 'aria-label': t('ui.toast.close'), onClick: () => handle.dismiss() }, icons.get('x', { size: 15 })));
    if (!motion.prefersReduced()) el.append(h('span.toast-timer', { 'aria-hidden': 'true' }));
    const run = () => { startedAt = Date.now(); timer = setTimeout(() => handle.dismiss(), remaining); };
    const pause = () => { clearTimeout(timer); remaining = Math.max(1200, remaining - (Date.now() - startedAt)); };
    el.addEventListener('mouseenter', pause);
    el.addEventListener('mouseleave', run);
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', run);
    region.append(el);
    currentToast = handle;
    run();
    return handle;
  }

  // ================================================================ theme + language
  function applyTheme(theme) {
    const html = doc.documentElement;
    html.dataset.theme = theme;
    const cs = root.getComputedStyle(html);
    const bg = cs.getPropertyValue('--titlebar-bg').trim() || (theme === 'light' ? '#F2F3F5' : '#0D0E11');
    const fg = cs.getPropertyValue('--titlebar-fg').trim() || (theme === 'light' ? '#0E1013' : '#F3F4F6');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bg);
    try { Platform.setTitleBarTheme({ color: bg, symbolColor: fg }); } catch (err) { /* window chrome is cosmetic */ }
  }
  /** setTheme('dark' | 'light'): [data-theme], native title bar colours, saved in state.theme. */
  function setTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    const apply = () => {
      applyTheme(next);
      if (state && state.theme !== next) update(s => { s.theme = next; }, { reason: 'theme', render: 'shell' });
      else renderShell();
      emit('theme', next);
    };
    if (ready && typeof doc.startViewTransition === 'function' && !motion.prefersReduced()) doc.startViewTransition(apply);
    else apply();
  }
  /** setLanguage('cs' | 'en'): VeyvoI18n locale, <html lang>, state.language, full re-render. */
  function setLanguage(locale) {
    const next = Format.normalizeLocale(locale, 'cs');
    I18n.setLocale(next);
    doc.documentElement.lang = next;
    derivedCache = null;
    if (state && state.language !== next) update(s => { s.language = next; }, { reason: 'language' });
    else renderAll({ animate: false, reason: 'language' });
    emit('language', next);
  }

  // ================================================================ Strava (desktop)
  let stravaBusy = false, stravaAthlete = null, stravaTimer = null;
  const STRAVA_EVERY_MS = 5 * 60 * 1000;

  /** Electron main's activity -> v2 Run (date + start time sliced from start_date_local, never new Date()). */
  function stravaToRun(a) {
    if (!a || a.id === undefined || a.id === null) return null;
    const local = String(a.startDateLocal || a.startDate || '');
    const clock = local.slice(11, 16);
    return {
      id: 'strava-' + a.id, stravaActivityId: String(a.id), source: 'strava',
      date: local.slice(0, 10), startTime: /^\d{2}:\d{2}$/.test(clock) ? clock : null, type: 'run',
      name: typeof a.name === 'string' ? a.name : '', distance: a.distanceKm, movingSeconds: a.movingTime,
      effort: null, note: '',
      averageHeartrate: Number.isFinite(a.averageHeartrate) && a.averageHeartrate > 0 ? a.averageHeartrate : null,
      elevationGain: Number.isFinite(a.totalElevationGain) ? a.totalElevationGain : null
    };
  }
  function stravaStatus() {
    const s = state ? state.strava : { connected: false, lastSync: null, lastError: null };
    return { supported: !!(Platform.strava && Platform.strava.supported), connected: !!s.connected, busy: stravaBusy, lastSync: s.lastSync, lastError: s.lastError, athlete: stravaAthlete };
  }
  function setStravaError(message, show) {
    const previous = state.strava.lastError;
    update(s => { s.strava = Object.assign({}, s.strava, { lastError: String(message).slice(0, 500) }); }, { reason: 'strava-error', render: 'shell' });
    if (show || previous !== String(message).slice(0, 500)) toast(t('ui.strava.failed', { message }), { kind: 'error', action: { label: t('common.button.retry'), run: () => stravaSync({ manual: true }) } });
  }
  /**
   * sync({ manual }) -> Promise<{ ok, added?, updated?, error? }>. Imports through
   * VeyvoStore.importStravaRuns (duplicate rules, typed time wins, deleted runs stay deleted), stores
   * lastSync / lastError and surfaces failures (sidebar status + toast). Never throws.
   */
  async function stravaSync(options) {
    const o = options || {};
    if (!Platform.strava || !Platform.strava.supported) return { ok: false, unsupported: true };
    if (stravaBusy) return { ok: false, busy: true };
    if (!state.strava.connected && !o.manual) return { ok: false, disconnected: true };
    stravaBusy = true;
    renderConnection();
    emit('strava', stravaStatus());
    try {
      const list = await Platform.strava.sync();
      const incoming = (Array.isArray(list) ? list : []).map(stravaToRun).filter(Boolean);
      let summary = null;
      const changed = (() => {
        const probe = Store.importStravaRuns(state, incoming);
        return probe.added > 0 || probe.updated > 0;
      })();
      update(s => {
        const r = Store.importStravaRuns(s, incoming);
        summary = r;
        const next = r.state;
        next.strava = Object.assign({}, next.strava, { connected: true, lastSync: new Date().toISOString(), lastError: null });
        return next;
      }, { reason: 'strava-sync', render: changed ? true : 'shell' });
      if (summary.added > 0) toast(t('ui.strava.imported', { n: summary.added }), { kind: 'success' });
      else if (o.manual) toast(t('ui.strava.upToDate'), { kind: 'success' });
      return { ok: true, added: summary.added, updated: summary.updated, ignored: summary.ignored };
    } catch (err) {
      stravaBusy = false;
      setStravaError(errorText(err), !!o.manual);
      return { ok: false, error: err };
    } finally {
      stravaBusy = false;
      renderConnection();
      emit('strava', stravaStatus());
    }
  }
  async function stravaRefresh() {
    if (!Platform.strava || !Platform.strava.supported) return stravaStatus();
    const st = await Platform.strava.status();
    stravaAthlete = st && st.athlete ? st.athlete : null;
    if (!!(st && st.connected) !== state.strava.connected) update(s => { s.strava = Object.assign({}, s.strava, { connected: !!(st && st.connected) }); }, { reason: 'strava-status', render: 'shell' });
    emit('strava', stravaStatus());
    return stravaStatus();
  }
  /** connect(clientSecret): opens the Strava sign-in in the browser; resolves when the browser opened (throws on error). */
  async function stravaConnect(secret) {
    await Platform.strava.connect(secret);
    toast(t('ui.strava.finishInBrowser'));
  }
  async function stravaDisconnect() {
    await Platform.strava.disconnect();
    stravaAthlete = null;
    update(s => { s.strava = Object.assign({}, s.strava, { connected: false, lastError: null }); }, { reason: 'strava-disconnect', render: 'shell', toast: t('ui.strava.disconnected') });
    emit('strava', stravaStatus());
  }
  function initStrava() {
    if (!Platform.strava || !Platform.strava.supported) return;
    Platform.strava.onEvent(ev => {
      if (!ev) return;
      if (ev.type === 'connected') {
        stravaAthlete = ev.status && ev.status.athlete ? ev.status.athlete : stravaAthlete;
        update(s => { s.strava = Object.assign({}, s.strava, { connected: true, lastError: null }); }, { reason: 'strava-connected', render: 'shell' });
        toast(t('ui.strava.connectedToast'));
        stravaSync({ manual: false });
      } else if (ev.type === 'error') {
        const message = ev.message || t('ui.errors.unknown');
        update(s => { s.strava = Object.assign({}, s.strava, { lastError: String(message).slice(0, 500) }); }, { reason: 'strava-error', render: 'shell' });
        toast(t('ui.strava.connectFailed', { message }), { kind: 'error' });
      }
      emit('strava', stravaStatus());
    });
    stravaRefresh().then(st => { if (st.connected) stravaSync(); }).catch(err => setStravaError(errorText(err), false));
    stravaTimer = setInterval(() => { if (state.strava.connected) stravaSync(); }, STRAVA_EVERY_MS);
  }

  // ================================================================ updates
  let updateStatus = null;
  const UPDATE_CHECK_KEY = 'veyvo-update-check';    // Android: the day of the last successful daily check
  const UPDATE_STATUS_KEY = 'veyvo-update-status';  // Android: { type, version, pageUrl, checkedAt, installed } of that check
  const UPDATE_RESULTS = ['current', 'available', 'newer'];
  let updateChecking = false;
  function readUpdateRecord() {
    try { const rec = JSON.parse(readLS(UPDATE_STATUS_KEY) || 'null'); return rec && typeof rec === 'object' && UPDATE_RESULTS.indexOf(rec.type) >= 0 ? rec : null; } catch (e) { return null; }
  }
  /** Android: ask GitHub once a day; the day only counts once a check really answered (offline: retry later). */
  function dailyUpdateCheck() {
    const U = Platform.updates;
    if (Platform.kind !== 'android' || !U || !U.supported || updateChecking || readLS(UPDATE_CHECK_KEY) === todayKey) return;
    updateChecking = true;
    const day = todayKey;
    Promise.resolve().then(() => U.check()).then(info => {
      // offline, or a release without its APK yet: checked again on the next launch / return to the app
      if (Platform.util.updateCheckCounts(info)) writeLS(UPDATE_CHECK_KEY, day);
    }, () => null).then(() => { updateChecking = false; });
  }
  function initUpdates() {
    const U = Platform.updates;
    if (!U || !U.supported) return;
    U.onStatus(st => {
      updateStatus = st ? Object.assign({}, st, st.checkedAt || ['current', 'available', 'newer', 'error', 'ready'].indexOf(st.type) < 0 ? {} : { checkedAt: new Date().toISOString() }) : null;
      if (Platform.kind === 'android' && updateStatus && UPDATE_RESULTS.indexOf(updateStatus.type) >= 0) {
        const rec = { type: updateStatus.type, version: updateStatus.version || null, pageUrl: updateStatus.pageUrl || null, checkedAt: updateStatus.checkedAt };
        Platform.version().catch(() => null).then(v => writeLS(UPDATE_STATUS_KEY, JSON.stringify(Object.assign(rec, { installed: v || null }))));
      }
      emit('updates', updateStatus);
      if (!st) return;
      if (st.type === 'ready') {
        toast(t('ui.updates.ready', { version: st.version || '' }), { duration: 15000, icon: 'download', action: { label: t('ui.updates.restart'), run: () => U.install().catch(err => toast(errorText(err), { kind: 'error' })) } });
      } else if (st.type === 'available' && Platform.kind === 'android') {
        toast(t('ui.updates.available', { version: st.version || '' }), { duration: 12000, icon: 'download', action: { label: t('ui.updates.download'), run: () => U.install().catch(err => toast(errorText(err), { kind: 'error' })) } });
      }
    });
    if (Platform.kind === 'android') {
      // Settings shows the last answer after a restart (not "not checked yet") while it still fits this install.
      const rec = readUpdateRecord();
      if (rec) {
        Platform.version().catch(() => null).then(v => {
          const restored = Platform.util.restoredUpdateStatus(rec, v);
          if (updateStatus || !restored) return;
          // an APK found earlier is looked up again, so "Stáhnout" has its download link after a restart
          if (restored.type === 'available') { U.check().catch(() => null); return; }
          updateStatus = restored;
          emit('updates', updateStatus);
        });
      }
      dailyUpdateCheck();
    }
  }

  // ================================================================ components registry
  const componentsApi = {
    register(name, factory) { if (typeof factory !== 'function') throw new Error('components.register needs a factory'); componentDefs.set(name, factory); },
    has: name => componentDefs.has(name),
    get: name => componentDefs.get(name) || null,
    create(name, props) {
      const factory = componentDefs.get(name);
      if (!factory) throw new Error('VeyvoUI.app.components: unknown component "' + name + '"');
      return factory(props || {}, api);
    },
    list: () => Array.from(componentDefs.keys())
  };

  function radioKeys(group, items, select) {
    group.addEventListener('keydown', e => {
      const map = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      const i = items.indexOf(doc.activeElement);
      if (i < 0) return;
      let next = null;
      if (map[e.key]) next = (i + map[e.key] + items.length) % items.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      if (next === null) return;
      e.preventDefault();
      items[next].focus();
      select(next);
    });
  }

  /** segmented({ options: [{ value, label, count?, icon?, dot? }], value, onChange(value), label, size, key }) */
  componentsApi.register('segmented', p => {
    const el = h('div.segmented', { role: 'radiogroup', 'aria-label': p.label || null, class: p.size === 'lg' ? 'segmented-lg' : null });
    const opts = p.options || [];
    const buttons = opts.map(opt => h('button', { type: 'button', role: 'radio', dataset: { value: String(opt.value), key: p.key ? p.key + ':' + opt.value : undefined } },
      opt.dot ? h('i', { class: 'dot dot-' + opt.dot }) : null,
      opt.icon ? icons.get(opt.icon, { size: 14 }) : null,
      h('span', opt.label),
      opt.count !== undefined && opt.count !== null ? h('span.seg-count', String(opt.count)) : null));
    let value = p.value;
    function paint() {
      const found = opts.some(o => o.value === value);
      buttons.forEach((b, i) => {
        const on = opts[i].value === value;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on || (!found && i === 0) ? 0 : -1;
      });
    }
    function select(i) { const v = opts[i].value; if (v === value) return; value = v; paint(); if (p.onChange) p.onChange(v); }
    buttons.forEach((b, i) => b.addEventListener('click', () => select(i)));
    radioKeys(el, buttons, select);
    el.append.apply(el, buttons);
    paint();
    el.getValue = () => value;
    el.setValue = v => { value = v; paint(); };
    return el;
  });

  /** scale({ min = 1, max = 10, value, onChange(v), label, lowLabel, highLabel, fill, key }) - 1..10 squares (radiogroup) */
  componentsApi.register('scale', p => {
    const min = Number.isInteger(p.min) ? p.min : 1, max = Number.isInteger(p.max) ? p.max : 10;
    let value = p.value;
    const n = max - min + 1;
    // phones: more than 7 squares go into two rows, so every square stays at least 44 px wide
    const group = h('div.scale', { role: 'radiogroup', 'aria-label': p.label || null, style: n > 7 ? { '--n': n, '--n-phone': Math.ceil(n / 2) } : { '--n': n } });
    const buttons = [];
    for (let v = min; v <= max; v++) buttons.push(h('button', { type: 'button', role: 'radio', dataset: { value: v, key: p.key ? p.key + ':' + v : undefined }, 'aria-label': p.label ? p.label + ' ' + v : null }, String(v)));
    function paint() {
      buttons.forEach((b, i) => {
        const v = min + i;
        b.setAttribute('aria-checked', v === value ? 'true' : 'false');
        b.classList.toggle('in-range', !!p.fill && value !== null && value !== undefined && v < value);
        b.tabIndex = v === value || ((value === null || value === undefined) && i === 0) ? 0 : -1;
      });
    }
    function select(i) { value = min + i; paint(); if (p.onChange) p.onChange(value); }
    buttons.forEach((b, i) => b.addEventListener('click', () => select(i)));
    radioKeys(group, buttons, select);
    group.append.apply(group, buttons);
    paint();
    const wrapEl = h('div.scale-wrap', group, p.lowLabel || p.highLabel ? h('div.scale-ends', { 'aria-hidden': 'true' }, h('span', p.lowLabel || ''), h('span', p.highLabel || '')) : null);
    wrapEl.getValue = () => value;
    wrapEl.setValue = v => { value = v; paint(); };
    return wrapEl;
  });

  /** dayToggles({ value: [0..6], onChange(days), label, min = 1 }) - square Po..Ne toggles (0 = Monday) */
  componentsApi.register('dayToggles', p => {
    let days = Array.isArray(p.value) ? p.value.slice() : [];
    const min = Number.isInteger(p.min) ? p.min : 1;
    const el = h('div.day-toggles', { role: 'group', 'aria-label': p.label || null });
    const buttons = [0, 1, 2, 3, 4, 5, 6].map(d => h('button.day-toggle', { type: 'button', 'aria-label': I18n.t('common.weekdayLong.' + d), dataset: { key: p.key ? p.key + ':' + d : undefined } }, I18n.t('common.weekdayMin.' + d)));
    function paint() { buttons.forEach((b, d) => b.setAttribute('aria-pressed', days.indexOf(d) >= 0 ? 'true' : 'false')); }
    buttons.forEach((b, d) => b.addEventListener('click', () => {
      const has = days.indexOf(d) >= 0;
      if (has && days.length <= min) { b.animate && !motion.prefersReduced() && b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 220 }); return; }
      days = has ? days.filter(x => x !== d) : days.concat([d]).sort((a, b2) => a - b2);
      paint();
      if (p.onChange) p.onChange(days.slice());
    }));
    el.append.apply(el, buttons);
    paint();
    el.getValue = () => days.slice();
    return el;
  });

  /** stepper({ value, min, max, step = 1, decimals = 0, unit, label, id, onChange(v) }) - [−] value [+] */
  componentsApi.register('stepper', p => {
    const step = p.step || 1, decimals = Number.isInteger(p.decimals) ? p.decimals : 0;
    const min = Number.isFinite(p.min) ? p.min : -Infinity, max = Number.isFinite(p.max) ? p.max : Infinity;
    let value = Number.isFinite(p.value) ? p.value : null;
    const show = v => (v === null ? '' : Format.number(v, { minDecimals: decimals, maxDecimals: decimals, grouping: false }));
    const input = h('input', { type: 'text', inputmode: 'decimal', id: p.id || null, 'aria-label': p.label || null, value: show(value), dataset: { key: p.key || undefined } });
    const minus = h('button', { type: 'button', 'aria-label': '−' + Format.number(step), tabindex: '-1' }, icons.get('minus', { size: 16 }));
    const plus = h('button', { type: 'button', 'aria-label': '+' + Format.number(step), tabindex: '-1' }, icons.get('plus', { size: 16 }));
    function set(v, notify) {
      const clamped = v === null ? null : Math.max(min, Math.min(max, v));
      value = clamped === null ? null : Number(clamped.toFixed(Math.max(decimals, 3)));
      input.value = show(value);
      minus.disabled = value !== null && value <= min;
      plus.disabled = value !== null && value >= max;
      if (notify && p.onChange) p.onChange(value);
    }
    minus.addEventListener('click', () => set((value === null ? (Number.isFinite(p.start) ? p.start : min) : value) - step, true));
    plus.addEventListener('click', () => set((value === null ? (Number.isFinite(p.start) ? p.start - step : min) : value) + step, true));
    input.addEventListener('keydown', e => { if (e.key === 'ArrowUp') { e.preventDefault(); plus.click(); } else if (e.key === 'ArrowDown') { e.preventDefault(); minus.click(); } });
    input.addEventListener('change', () => {
      const raw = input.value.trim().replace(/\s/g, '').replace(',', '.');
      if (!raw) { set(null, true); return; }
      const n = Number(raw);
      set(Number.isFinite(n) ? n : value, true);
    });
    const el = h('div.stepper', minus, input, p.unit ? h('span.stepper-unit', p.unit) : null, plus);
    set(value, false);
    el.input = input;
    el.getValue = () => value;
    el.setValue = v => set(v, false);
    return el;
  });

  /** switch({ checked, onChange(bool), label }) -> <label class="check-row"><input class="switch" role="switch"> label</label> */
  componentsApi.register('switch', p => {
    const input = h('input.switch', { type: 'checkbox', role: 'switch', checked: !!p.checked, dataset: { key: p.key || undefined } });
    input.addEventListener('change', () => p.onChange && p.onChange(input.checked));
    const el = h('label.check-row', input, h('span', p.label || ''));
    el.input = input;
    return el;
  });

  /** range({ value, min, max, step, label, id, onChange(v) }) - slider with accent fill */
  componentsApi.register('range', p => {
    const input = h('input.range', { type: 'range', min: p.min ?? 0, max: p.max ?? 10, step: p.step ?? 1, value: p.value ?? 0, id: p.id || null, 'aria-label': p.label || null, dataset: { key: p.key || undefined } });
    const paint = () => { const f = (Number(input.value) - Number(input.min)) / ((Number(input.max) - Number(input.min)) || 1); input.style.setProperty('--fill', (f * 100) + '%'); };
    input.addEventListener('input', () => { paint(); if (p.onChange) p.onChange(Number(input.value)); });
    paint();
    return input;
  });

  /** field({ label, control, hint, error, optional, id }) - label + control + hint/error, wired with aria */
  componentsApi.register('field', p => {
    const id = p.id || (p.control && p.control.id) || dom.uid('f');
    const target = p.control && (p.control.matches && p.control.matches('input, select, textarea') ? p.control : (p.control.input || (p.control.querySelector && p.control.querySelector('input, select, textarea'))));
    if (target && !target.id) target.id = id;
    const hintId = p.hint ? dom.uid('h') : null, errId = p.error ? dom.uid('e') : null;
    if (target) {
      const ids = [hintId, errId].filter(Boolean).join(' ');
      if (ids) target.setAttribute('aria-describedby', ids);
      if (p.error) target.setAttribute('aria-invalid', 'true');
    }
    return h('div.field',
      h('label.field-label', { for: target ? target.id : null }, p.label, p.optional ? h('span.opt', p.optional === true ? '' : p.optional) : null),
      p.control,
      p.hint ? h('p.field-hint', { id: hintId }, p.hint) : null,
      p.error ? h('p.field-error', { id: errId, role: 'alert' }, icons.get('warning'), h('span', p.error)) : null);
  });

  /** stat({ label, value, unit, sub, hot, small, countTo: { to, from, format } }) - stat tile */
  componentsApi.register('stat', p => {
    const valueEl = h('span.num', p.value === undefined || p.value === null ? Format.EMPTY : String(p.value));
    const el = h('div.stat', { class: [p.hot && 'stat-hot', p.small && 'stat-sm'] },
      h('span.stat-label', p.label),
      h('span.stat-value', valueEl, p.unit ? h('span.unit', ' ' + p.unit) : null),
      p.sub ? h('span.stat-sub', p.sub) : null);
    if (p.countTo && Number.isFinite(p.countTo.to)) {
      (root.requestAnimationFrame || setTimeout)(() => motion.countUp(valueEl, p.countTo.to, { from: p.countTo.from, format: p.countTo.format, delay: p.countTo.delay }));
    }
    return el;
  });

  /** empty({ icon, title, text, actions: [Node], center }) - empty state */
  componentsApi.register('empty', p => h('div.empty', { class: p.center ? 'empty-center' : null },
    p.icon ? h('span.empty-icon', icons.get(p.icon)) : null,
    p.title ? h('p.empty-title', p.title) : null,
    p.text ? h('p.empty-text', p.text) : null,
    p.actions && p.actions.length ? h('div.empty-actions', p.actions) : null));

  /** skeleton({ lines = 3, title = true, block }) - loading placeholder (aria-busy on the wrapper) */
  componentsApi.register('skeleton', p => {
    const el = h('div.skeleton', { 'aria-busy': 'true', 'aria-label': I18n.t('common.status.loading') });
    if (p.block) el.append(h('div.skel.skel-block'));
    if (p.title !== false && !p.block) el.append(h('div.skel.skel-title', { style: { marginBottom: '14px' } }));
    for (let i = 0; i < (p.lines === undefined ? 3 : p.lines); i++) el.append(h('div.skel.skel-line', { style: { width: (92 - i * 14) + '%' } }));
    return el;
  });

  /** typeTag({ type }) - series dot + localized run type */
  componentsApi.register('typeTag', p => h('span.type-tag', h('i', { class: 'dot dot-' + charts.groupOf(p.type) }), charts.typeLabel(p.type)));
  /** valueUnit({ value, unit, cls }) - '5,0 km' with the unit in small text */
  componentsApi.register('valueUnit', p => dom.val(p.value, p.unit, { cls: p.cls }));
  /** meter({ value, max, variant, size, label, animate }) - 10-segment meter */
  componentsApi.register('meter', p => charts.meter(p.value, p.max, p));
  /** legend({ groups, goal, plan }) */
  componentsApi.register('legend', p => charts.legend(p));
  /** callout({ kind: 'info'|'warn'|'danger'|'accent', icon, title, text, children }) */
  componentsApi.register('callout', p => h('div', { class: ['callout', p.kind ? 'callout-' + p.kind : null], role: p.kind === 'danger' ? 'alert' : null },
    icons.get(p.icon || (p.kind === 'warn' || p.kind === 'danger' ? 'warning' : 'info')),
    h('div', p.title ? h('b', p.title + ' ') : null, p.text || null, p.children || null)));
  /** placeholder({ title }) - what the stub page modules render until the real page lands */
  componentsApi.register('placeholder', p => componentsApi.create('empty', { icon: p.icon || 'info', title: p.title || t('ui.stub.title'), text: t('ui.stub.text') }));

  // ================================================================ actions + the shell's own dialogs
  const actionsApi = {
    /** register(name, fn(dataset, element)): handles clicks on any [data-action="name"] in the app */
    register(name, fn) { actionDefs.set(name, fn); },
    run(name, data, el) { const fn = actionDefs.get(name); if (fn) fn(data || {}, el || null); },
    has: name => actionDefs.has(name)
  };
  actionsApi.register('log-run', data => dialogsApi.open('run', { mode: 'new', date: data && data.date }));
  actionsApi.register('settings', data => dialogsApi.open('settings', { section: data && data.section }));
  actionsApi.register('profile', () => dialogsApi.open('settings', { section: 'profile' }));
  actionsApi.register('connection', () => dialogsApi.open('settings', { section: 'connections' }));
  actionsApi.register('toggle-theme', () => setTheme(state.theme === 'light' ? 'dark' : 'light'));
  actionsApi.register('more', () => dialogsApi.open('more'));
  actionsApi.register('navigate', data => navigate(data.page || 'home', { params: data.params ? JSON.parse(data.params) : null }));

  dialogsApi.register('more', {
    open() {
      const p = state.profile;
      let d = null;
      const go = fn => () => { d.close(); setTimeout(fn, 200); };
      const row = (icon, title, sub, run) => h('button.list-row', { type: 'button', onClick: run }, icons.get(icon),
        h('span.list-row-main', h('span.list-row-title', title), sub ? h('span.list-row-sub', sub) : null), icons.get('chevron-right', { className: 'ic-end', size: 16 }));
      const st = stravaStatus();
      const list = h('div.list',
        row('user', p.name || t('ui.profile.anonymous'), fmt.goal(p), go(() => dialogsApi.open('settings', { section: 'profile' }))),
        row('checklist', t('ui.nav.nutrition'), null, go(() => navigate('nutrition'))),
        row('settings', t('ui.nav.settings'), null, go(() => dialogsApi.open('settings'))),
        st.supported ? row('link', t('ui.strava.name'), st.connected ? (st.lastError || t('common.status.connected')) : t('ui.strava.connect'), go(() => dialogsApi.open('settings', { section: 'connections' }))) : null);
      const lang = componentsApi.create('segmented', {
        label: t('ui.more.language'), value: I18n.getLocale(),
        options: [{ value: 'cs', label: I18n.t('common.language.cs') }, { value: 'en', label: I18n.t('common.language.en') }],
        onChange: v => { d.close(); setLanguage(v); setTimeout(() => dialogsApi.open('more'), 220); }
      });
      const theme = componentsApi.create('switch', { checked: state.theme !== 'light', label: t('ui.more.darkMode'), onChange: v => setTheme(v ? 'dark' : 'light') });
      d = createDialog({
        title: t('ui.more.title'), kind: 'modal', size: 'sm', className: 'dlg-more',
        body: [list, h('div.more-prefs', { style: { display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '18px' } },
          h('div.field', h('span.field-label', t('ui.more.language')), lang), theme)]
      });
      return d;
    }
  });

  function wireShell() {
    doc.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const navEl = e.target.closest && e.target.closest('[data-nav]');
      if (navEl) { e.preventDefault(); navigate(navEl.getAttribute('data-nav')); return; }
      const actEl = e.target.closest && e.target.closest('[data-action]');
      if (actEl && actionDefs.has(actEl.getAttribute('data-action'))) { e.preventDefault(); actionsApi.run(actEl.getAttribute('data-action'), Object.assign({}, actEl.dataset), actEl); }
    });
    root.addEventListener('hashchange', () => { const p = pageFromHash(); if (p && p !== currentPage) navigate(p, { fromHash: true }); });
    doc.addEventListener('keydown', e => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || dom.isTyping(e) || dialogStack.length) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); actionsApi.run('log-run', {}); }
    });
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) checkToday(); });
    root.addEventListener('focus', checkToday);
    let resizeTimer = null;
    root.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(positionLane, 80); });
    const relayout = () => renderAll({ animate: false, reason: 'layout' });
    if (mqPhone.addEventListener) mqPhone.addEventListener('change', relayout);
    if (mqRail.addEventListener) mqRail.addEventListener('change', relayout);
  }

  function initBackButton() {
    if (Platform.kind !== 'android') return;
    const App = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.App;
    if (!App || typeof App.addListener !== 'function') return;
    App.addListener('backButton', () => {
      if (dialogStack.length) dialogsApi.close();
      else if (currentPage !== 'home') navigate('home');
      else if (typeof App.exitApp === 'function') App.exitApp();
    });
  }

  function showLoadNotices(report) {
    if (!report) return;
    const w = report.warnings || [];
    const count = code => w.filter(x => x.code === code).length;
    const messages = [];
    if (report.recoveredFromCorruption) messages.push(t(report.corruptKey ? 'store.notice.corrupt' : 'store.notice.corruptCopyFailed'));
    if (count('storage-read-failed')) messages.push(t('store.notice.storageReadFailed'));
    if (count('schema-newer')) messages.push(t('store.notice.schemaNewer'));
    if (report.fromVersion === 1 && state.runHistory.length) messages.push(t('store.notice.migrated'));
    if (count('run-twins-merged')) messages.push(t('store.notice.runsMerged', { n: count('run-twins-merged') }));
    if (count('run-dropped')) messages.push(t('store.notice.runsDropped', { n: count('run-dropped') }));
    if (report.fromVersion === 1 && count('state-key-dropped') && readLS(Store.LEGACY_BACKUP_KEY)) messages.push(t('store.notice.legacyKept'));
    if (report.saveError) messages.push(t('store.error.' + report.saveError));
    if (!messages.length) return;
    loadNotice = { messages, kind: report.recoveredFromCorruption || report.saveError ? 'error' : 'info' };
    setTimeout(() => {
      const n = loadNotice;
      loadNotice = null;
      if (n) toast(n.messages.join(' '), { kind: n.kind, duration: n.kind === 'error' ? 12000 : 10000 });
    }, 600);
  }

  // ================================================================ start
  function start() {
    if (started) return api;
    started = true;
    const html = doc.documentElement;
    html.dataset.platform = Platform.kind;
    try {
      // dev hooks (screenshots/tests): ?today=YYYY-MM-DD pins the date, ?motion=off freezes motion
      const query = new root.URLSearchParams(root.location.search);
      const q = query.get('today');
      if (q && Runs.isDateKey(q)) todayOverride = q;
      if (query.get('motion') === 'off') html.dataset.motion = 'off';
    } catch (e) { /* no query string */ }
    todayKey = computeToday();
    loadReport = Store.load(storage, {});
    state = deepFreeze(loadReport.state);
    if (loadReport.needsSave) {
      const saved = Store.save(storage, state);
      if (!saved.ok) loadReport = Object.assign({}, loadReport, { saveError: saved.error });
    }
    if (typeof Platform.registerMessages === 'function') Platform.registerMessages(I18n);
    I18n.setLocale(state.language);
    html.lang = state.language;
    applyTheme(state.theme);
    cacheShell();
    icons.hydrate(doc.body);
    wireShell();
    navigate(pageFromHash() || 'home', { animate: true, focus: false, fromHash: false });
    ready = true;
    html.classList.add('is-ready');
    scheduleMidnight();
    showLoadNotices(loadReport);
    initStrava();
    initUpdates();
    initBackButton();
    maybeBackup();
    if (!state.profile.onboarded && !state.runHistory.length && dialogDefs.has('onboarding')) setTimeout(() => dialogsApi.open('onboarding', {}), 350);
    emit('ready', api);
    return api;
  }

  const api = {
    start,
    isReady: () => ready,
    state: () => state,
    update,
    derived,
    today: () => todayKey,
    t,
    navigate,
    page: () => currentPage,
    params: () => pageParams,
    refresh: opts => renderAll(Object.assign({ animate: false, reason: 'refresh' }, opts || {})),
    pages: pagesApi,
    dialogs: dialogsApi,
    components: componentsApi,
    actions: actionsApi,
    toast,
    confirm,
    setTheme,
    setLanguage,
    theme: () => (state ? state.theme : 'dark'),
    language: () => I18n.getLocale(),
    isPhone: () => mqPhone.matches,
    strava: {
      get supported() { return !!(Platform.strava && Platform.strava.supported); },
      status: stravaStatus, sync: stravaSync, connect: stravaConnect, disconnect: stravaDisconnect, refresh: stravaRefresh,
      toRun: stravaToRun
    },
    updates: {
      get supported() { return !!(Platform.updates && Platform.updates.supported); },
      status: () => updateStatus,
      check: () => Platform.updates.check(),
      install: () => Platform.updates.install()
    },
    storage: { get: readLS, set: writeLS },
    /** backupStatus(): { ok, path | error, at } of the latest daily backup this session, or null. */
    backupStatus: () => backupLast,
    errorText,
    /** deriveFrom(state, today): the derived fields for any v2 state (tests; the app uses derived()). */
    deriveFrom: (s, today) => computeDerived(s, today),
    on,
    MESSAGES
  };
  UI.app = api;
})(globalThis);
