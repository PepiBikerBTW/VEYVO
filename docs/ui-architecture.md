# VEYVO 0.4 UI architecture

The binding contract for everyone who builds on the 0.4 UI foundation. Read [`architecture.md`](architecture.md) first: classic UMD scripts, no bundler, CSP `script-src 'self'`, state schema v2, the workout model and `VeyvoPlatform`. This document covers `src/ui/**`, `src/styles/**` and `src/index.html`.

Design base: concept A "Track". It uses graphite near-black, ONE orange signal (`--accent`) and a sparing cool blue (`--cool`). Barlow Condensed (`.num`) sets every number, time and distance, and Inter sets UI text. Icons are stroke SVGs and the geometry is square-ish. The grafted ideas are:
- D's "today" headline sentence and the inline 3-tap recovery check-in (home + recovery agents)
- C's chart tooltip, range tabs and the next-run date badge in the nav (done in the shell)
- B's derived notes column in the run log (progress agent)

---

## 1. Files and ownership

| File | Owner | Registers | i18n namespace | CSS (prefix) |
|---|---|---|---|---|
| `src/index.html` | foundation (integrator edits) | shell markup, page `<section>`s, script/style order | — | — |
| `src/styles/fonts.css`, `tokens.css`, `base.css`, `shell.css`, `components.css`, `motion.css` | foundation | — | — | shared, unprefixed |
| `src/ui/dom.js` | foundation | `VeyvoUI.dom`, `VeyvoUI.fmt` | — | — |
| `src/ui/icons.js` | foundation | `VeyvoUI.icons` | — | — |
| `src/ui/motion.js` | foundation | `VeyvoUI.motion` | — | — |
| `src/ui/charts.js` | foundation | `VeyvoUI.charts` | `charts` | `.vchart`, `.ch-*`, `.ln-*` |
| `src/ui/app.js` | foundation | `VeyvoUI.app`, dialog `more`, built-in components and actions | `ui` | — |
| `src/ui/home.js` | home agent | page `home` | `home` | `styles/pages/home.css` (`home-`) |
| `src/ui/plan.js` | plan agent | page `plan` | `plan` | `styles/pages/plan.css` (`plan-`) |
| `src/ui/progress.js` | progress agent | page `progress` | `progress` | `styles/pages/progress.css` (`prog-`) |
| `src/ui/nutrition.js` | nutrition agent | page `nutrition` | `nutrition` | `styles/pages/nutrition.css` (`nut-`) |
| `src/ui/run-dialog.js` | run-dialog agent | dialog `run` | `run` | `styles/pages/run-dialog.css` (`rd-`) |
| `src/ui/recovery.js` | recovery agent | dialog `recovery`, component `recoveryCheckin` | `recovery` | `styles/pages/recovery.css` (`rec-`) |
| `src/ui/workout-sheet.js` | workout agent | dialog `workout` | `workout` | `styles/pages/workout-sheet.css` (`ws-`) |
| `src/ui/settings.js` | settings agent | dialog `settings` | `settings` | `styles/pages/settings.css` (`set-`) |
| `src/ui/onboarding.js` | onboarding agent | dialog `onboarding` | `onboarding` | `styles/pages/onboarding.css` (`onb-`) |
| `src/ui/boot.js` | foundation | calls `VeyvoUI.app.start()` | — | — |

Every page or dialog file is currently a **stub** that registers a placeholder. Replace the whole file and keep the registration name. The page CSS files exist and are already linked from `index.html`, so **page agents never edit `index.html`**. If you need a new script, ask the integrator.

Script order (checked by `tests/ui-foundation.test.js`):
0. `build-info.js` (the build channel, see [Build channels](architecture.md#build-channels))
1. Vendor and core: `vendor/workoutkit.js` → `core/format.js` → `core/i18n.js` → `core/runs-model.js` → `core/store.js` → `core/workouts.js` → `core/export/{fit,apple,zwo,intervals}.js`
2. Engines and platform: `training-context.js` → `nutrition-context.js` → `platform.js`
3. UI foundation: `ui/dom.js` → `ui/icons.js` → `ui/motion.js` → `ui/charts.js` → `ui/app.js`
4. Pages and dialogs: `ui/home.js`, `plan.js`, `progress.js`, `run-dialog.js`, `recovery.js`, `workout-sheet.js`, `settings.js`, `onboarding.js`, `nutrition.js`
5. `ui/boot.js` last

The 0.3 UI (`journal.js`, `nutrition-ui.js`, `styles.css`, `calendar-context.js`, `time-context.js`) was removed in 0.4: `VeyvoRuns.weekStrip` replaces the calendar and `time-context` hard-coded "Pepa".

Module pattern for UI files (classic script, no `module.exports`):

```js
(function (root) {
  'use strict';
  const app = root.VeyvoUI.app;
  // register i18n, pages/dialogs/components here — never touch the DOM before app.start()
})(globalThis);
```

---

## 2. `VeyvoUI.app` — the runtime

| API | Contract |
|---|---|
| `start()` | Called once by `boot.js`. It loads state with `VeyvoStore.load(localStorage)`, applies language and theme, builds the shell, navigates to `location.hash` or `home`, and starts the timers, Strava, updates, the back button and the daily backup. It opens `onboarding` when `profile.onboarded` is false and there are no runs. |
| `isReady()` | True after `start()`. |
| `state()` | The current v2 state, **deep-frozen**. Never mutate it; use `update`. |
| `update(mutator, opts?)` | See §3. Returns `{ ok, state, prev, result, errors? }`. |
| `derived()` | Memoized per (state version, today, locale) and deep-frozen. Fields are in §4. |
| `today()` | Local `'YYYY-MM-DD'`. The app re-renders after midnight, on `visibilitychange` and on window `focus`, and emits `'today'`. Dev override: `index.html?today=2026-11-27`. |
| `t(key, params?)` | `VeyvoI18n.t` plus Czech typography (`fmt.typo`). **Use it for every visible string.** |
| `navigate(page, { params, animate = true, focus = true })` | Runs the page transition (`motion.pageEnter`), updates `document.title` (`<Title> · VEYVO`), `aria-current` and the nav lane, rewrites `#hash` and moves focus to the page `<h1>`. It is also driven by `[data-nav="page"]` clicks and `hashchange`. |
| `page()`, `params()` | The current page name and its params. |
| `refresh(opts?)` | Re-renders the shell and the current page (`animate: false`). |
| `pages.register(name, def)` / `pages.get` / `pages.list` / `pages.current` | See §5. |
| `dialogs.register(name, { open(params, app) })` | See §6. |
| `dialogs.open(name, params)` | Returns whatever `open` returns, usually the handle. An unknown name shows an error toast. |
| `dialogs.create(opts)` | Builds a styled native `<dialog>` (§6). |
| `dialogs.close(result)` / `closeAll()` / `isOpen()` / `top()` / `has(name)` | Close the top dialog, close all, query the stack, check a registration. |
| `components.register(name, factory(props, app))` / `create(name, props)` / `has` / `get` / `list` | See §7. |
| `actions.register(name, fn(dataset, el))` / `run(name, data)` / `has` | A click on any `[data-action="name"]` runs `fn`. Built-in actions are listed in §8. |
| `toast(message, { kind: 'info' \| 'success' \| 'error', action: { label, run }, duration, icon })` | Shows one toast at a time (a new one replaces the old) and returns `{ dismiss() }`. It sits above open dialogs. Hovering or focusing pauses the timer. The default duration is 3.2 s, 6.5 s with an action and 7 s for errors. |
| `confirm({ title, body, confirmLabel, cancelLabel, danger })` | Returns `Promise<boolean>`. It is a styled modal (never `window.confirm`). With `danger`, focus starts on Cancel and the confirm button is `.btn-danger-solid`. |
| `setTheme('dark' \| 'light')` | Sets `<html data-theme>` and `theme-color`, sends `VeyvoPlatform.setTitleBarTheme({ color: --titlebar-bg, symbolColor: --titlebar-fg })`, saves `state.theme` and cross-fades through View Transitions. Emits `'theme'`. |
| `setLanguage('cs' \| 'en')` | Calls `VeyvoI18n.setLocale`, sets `<html lang>`, saves `state.language` and re-renders everything. Emits `'language'`. |
| `theme()`, `language()`, `isPhone()` | The current values. `isPhone()` means ≤ 760 px. |
| `build` | `{ channel: 'github' \| 'play' \| 'appstore', store }` from `VeyvoPlatform.build`. A store build (`store: true`) shows no updater, no Strava and no text about the Windows app, APK files or GitHub; use a `…Store` text variant where a text would name them (checked by `tests/build-channel.test.js`). `<html data-channel>` carries the channel. |
| `strava.supported` / `status()` / `sync({ manual })` / `connect(secret)` / `disconnect()` / `refresh()` / `toRun(activity)` | See §9. |
| `updates.supported` / `status()` / `check()` / `install()` | See §9. |
| `storage.get(key)` / `storage.set(key, value)` | Safe `localStorage` that never throws. Use it for small per-device flags. |
| `backupStatus()` | `{ ok, path \| error, at }` of the latest daily backup this session, or `null`. Settings › Data shows a failure. |
| `errorText(err)` | Readable text for an error: the localized `platform.error.<code>` text when one exists, otherwise the message. |
| `on(event, cb)` | Returns `off()`. Events are listed below. |

| Event | Payload |
|---|---|
| `'ready'` | — |
| `'state'` | `{ reason, prev, next }` |
| `'navigate'` | `{ from, to, params }` |
| `'today'` | `key` |
| `'theme'` | — |
| `'language'` | — |
| `'strava'` | `status` |
| `'updates'` | `status` |
| `'backup'` | `{ ok, path \| error }` |
| `'dialog'` | `{ open, count }` |

---

## 3. Changing state: `app.update`

```js
// 1) a VeyvoStore edit helper (preferred: validation, error codes and an undo token)
const r = app.update(s => VeyvoStore.addRun(s, input, { today: app.today() }),
  { reason: 'run-add', toast: app.t('store.notice.runSaved'), undo: true });
if (!r.ok) showErrors(r.errors.map(code => app.t('store.error.' + code)));

// 2) mutate the draft (a deep copy)
app.update(s => { s.profile = Object.assign({}, s.profile, { name: 'Pepa' }); }, { reason: 'profile' });

// 3) return false to cancel
```

The mutator can mutate the draft, return a whole v2 state, return a `VeyvoStore` result `{ ok, state, undo, errors }` (with `ok: false` nothing changes and you get `errors` back), or return `false` to cancel.

After a change, `update` runs these steps in order:
0. `derived` is computed for the new state. If that throws, the change is rolled back and never saved (a state the app cannot show would fail on every launch).
1. `VeyvoStore.save`. A failure such as `storage-full` rolls the change back, shows a long error toast (no success or Undo toast) and `update` returns `{ ok: false, saved: false, errors: ['storage-full'] }`, so a form stays open and a retry cannot add the change twice.
2. The daily backup, if it hasn't run today.
3. `derived` is recomputed.
4. The shell and the current page are re-rendered **without entrance animations**.
5. The `'state'` event is emitted.
6. The optional toast is shown.

`undo: true` adds an "Undo" action to the toast. It uses the Store's undo token when the result has one (`VeyvoStore.applyUndo`), otherwise the previous snapshot.

Options:
- `render: 'shell'` re-renders only the chrome. Use it for background bookkeeping such as Strava `lastSync`.
- `render: false` re-renders nothing.

Never write to `localStorage['veyvo-state']` yourself. Nutrition keeps its own key `VeyvoStore.NUTRITION_KEY` (`veyvo-pre-run-v1`), which the nutrition page owns; it is included in backups.

`VeyvoStore` edit helpers (all pure, all return `{ ok, state, errors, undo }`):
- Runs: `addRun`, `updateRun`, `deleteRun` (a Strava run's id goes to `ignoredStravaIds`)
- Recovery: `upsertRecovery` (fields left undefined keep the day's values, so it suits a 3-tap check-in), `deleteRecovery`
- Profile: `setProfile`
- **New in 0.4:**
  - `schedulePlanned(state, { date, templateId }, { today })`, `unschedulePlanned(state, date)`
  - `logExport(state, { at, workoutId, format })`, which keeps the newest 50
  - `restoreIgnoredStrava(state, ids?)`
  - `importStravaRuns(state, runs)`
  - `importHealthRuns(state, rows, { at })`, `restoreIgnoredHealth(state, ids?)`, `healthImportSince(state, now)` (iPhone, Apple Health; Settings › Propojení)
  - `applyUndo`

Error and notice texts are under `store.error.<code>` and `store.notice.*`, including `runSaved`, `runUpdated`, `runDeleted`, `runDeletedStrava`, `runDeletedHealth`, `healthRestored`, `recoverySaved`, `profileSaved`, `plannedSaved`, `plannedRemoved`, `stravaRestored` and `undo`.

---

## 4. `app.derived()`

Everything is computed from the user's data with the core modules; there are no invented numbers.

| Field | Source / meaning |
|---|---|
| `today`, `locale`, `profile` | Inputs. |
| `runs` | `VeyvoRuns.sortRuns(runHistory)`, oldest first. |
| `runsDesc` | Newest first. |
| `hasRuns` | — |
| `latestRun` | The last run dated ≤ today. |
| `baselineRun` | The latest `test5k` of 4.95–5.2 km, else the latest 5 km effort (`VeyvoRuns.isFiveKAttempt`, 4.95–5.2 km): the easy-pace basis for the engine, which uses the same window. |
| `totals` | `VeyvoRuns.totals`: `{ count, distanceKm, movingSeconds, avgPaceSecPerKm }`. |
| `last7` | `VeyvoRuns.lastNDays(runs, today, 7)`. |
| `weekly` | `VeyvoRuns.weeklyTotals(runs, today, 12)`, Monday weeks, oldest first, the last one `isCurrent`. |
| `goal` | `VeyvoRuns.goalProgress(profile, runs)`: `best`, `bestDate`, `bestRunId`, `bestPace`, `target`, `targetPace`, `gapSeconds`, `pacePerKmGap`, `previousBest(Date)`, `improvementSeconds`, `improvementDays`, `fraction`, `checkpoints[]`, `next`, `reached`, `attempts`. |
| `records` | `VeyvoRuns.records`: `fastest5k`, `fastestPace`, `longestRun`, `longestDuration`, `biggestWeek`, `mostRunsWeek`. |
| `notes` | `VeyvoRuns.runNotes`: `{ runId: [{ code, params }] }`. The codes are `firstRun`, `personalBest5k`, `checkpoint`, `firstOver10k`, `longestRun` and `distanceMilestone`; **the progress agent translates them** in its namespace. |
| `milestones`, `legacyMilestones` | The chronological derived milestones, plus the read-only 0.3 ones. |
| `streak` | `VeyvoRuns.currentStreakWeeks`. |
| `nextRun` | `VeyvoTraining.nextRunAfterRun(latestRun, profile.days, today, baselineRun)`, or `null` when there are no runs. `kind: 'rest'` has `date: null`. The engine always plans from tomorrow on, so **today stays in play** until a run is logged today: when the same call evaluated as of yesterday lands on today, that is the next run (home, plan and the nav badge all say "Dnes"). |
| `nextWorkout` | The planned library session for `nextRun.date` if one is scheduled, else `VeyvoWorkouts.fromNextRun(nextRun, profile, { locale })`, else `null`. |
| `nextSession` | What comes first: `{ source: 'planned' \| 'engine', date, templateId, planned, workout }`. A library session booked from today on (on a day without a logged run) wins when it is on or before the engine's date; otherwise the engine's run. `null` when there is neither. The nav badge, home, the plan's "Další trénink" panel, the run result ("Další běh", "Do hodinek") and Před během ("Podle dalšího běhu") follow it, so a session booked for Saturday before the engine's Sunday run is shown everywhere. |
| `planned` | `plannedWorkouts` joined with the library: `[{ date, templateId, template, workout }]`. `workout` is dated, with id `lib-<id>-<date>`. |
| `weekStrip` | `VeyvoRuns.weekStrip(...)` for this week, plus `plannedWorkout` on days with a scheduled session. |
| `recoveryToday` | Today's log or `null`. |
| `recoveryAdvice` | `{ code: 'rest', fatigue, soreness }` when fatigue ≥ 8 or soreness ≥ 7 (the 0.3 rule), else `null`. Home and plan **must** show it on the next-run card, so the check-in and the card never contradict each other (confirmed 0.3 bug). |
| `paces` | `VeyvoWorkouts.derivePaces({ best5kSeconds: records.fastest5k, targetSeconds })`, or `null`. |
| `library` | `VeyvoWorkouts.library(paces, { locale })`. |

---

## 5. Pages

```js
app.pages.register('progress', {
  title: 'ui.nav.progress',                 // i18n key for <h1> + document.title
  eyebrow(ctx) { return ctx.t('progress.range', { … }); },   // optional, replaces the date next to the title
  actions(ctx) { return ctx.components.create('segmented', { … }); }, // optional, topbar slot (keep it tiny on phones)
  render(container, ctx) {
    ctx.dom.mount(container, header, board, charts, table);  // ALWAYS rebuild the whole container
  },
  onLeave() {}                               // optional
});
```

`render(container, ctx)` must be **idempotent**: it replaces all content each time. It runs:
- on navigation (`ctx.animate === true`, entrance animations play)
- after every `app.update` (`ctx.animate === false`; the container has `data-anim="off"`, so CSS and JS motion are suppressed)
- on language, date and layout changes

The runtime keeps the scroll position across non-animated renders. It restores focus to the element that had it when that element has a stable `data-key="…"` or `id`, so **give every interactive control a stable `data-key`**. This is what keeps the inline 3-tap check-in keyboard-usable after each save.

Background updates such as a Strava sync re-render the page only when the data changed. Pages with free-text inputs (nutrition, notes) must keep unsaved input in module variables and write it back on render.

`ctx` fields:

| Field | Value |
|---|---|
| `app` | The runtime. |
| `state` | Frozen state. |
| `derived` | See §4. |
| `today`, `locale` | — |
| `t` | `app.t`. |
| `fmt`, `dom`, `h` | Builders and formatting. |
| `icons`, `motion`, `charts` | Foundation modules. |
| `components` | The registry. |
| `platform` | `VeyvoPlatform`. |
| `animate`, `reason`, `params`, `isPhone` | Render context. |

Layout helpers available to pages: `.page` is already a flex column with a 16 px gap. Use `.grid-main-side` (main plus a 300–360 px side column), `.grid-2`, `.stat-board`, `.card .card-pad`. All of them collapse at ≤ 960 px.

---

## 6. Dialogs

```js
app.dialogs.register('run', {
  open(params, app) {
    const d = app.dialogs.create({
      title: app.t('run.titleNew'), eyebrow: null, size: 'md', kind: 'modal',
      body: form,                           // Node | Node[] | string
      actions: [cancelBtn, saveBtn],        // Nodes, or { label, kind: 'primary'|'secondary'|…, run(handle) }
      initialFocus: '#rd-distance',         // default: first text field, else the panel (no focus ring)
      dismissible: true,                    // Esc, backdrop click, close button
      beforeClose(result) { return !dirty || confirmDiscard(); }, // false keeps it open
      onClose(result) {}
    });
    return d;   // handle: { el, panel, head, body, foot, titleEl, close(result), setTitle, setBusy(bool), isOpen() }
  }
});
```

- `kind: 'modal'` is a centred card. Sizes: `sm` 420, `md` 560, `lg` 760 px.
- `kind: 'sheet'` is a right side sheet on desktop. Use it for settings and the workout sheet.
- On a phone (≤ 760 px) **every dialog is a bottom sheet**. Sheets and `className: 'dlg-full'` are full height; modals size to their content. A grab bar is drawn and safe-area padding is applied.
- The dialog is a native `<dialog>` opened with `showModal()`: the page is inert, Esc runs the animated close and focus returns to the opener. Closing animates in 190 ms.
- Android back closes the top dialog first.

Registered names and the params their callers use. Keep them stable; the shell and other pages call them.

| Name | Params |
|---|---|
| `run` | `{ mode: 'new' \| 'edit', runId?, date?, prefill?: { type, distance, movingSeconds, … }, fromPlan? }`. `mode: 'edit'` opens the run detail; add `direct: true` for the edit form, `focus: 'effort'` to land on the effort scale. |
| `runLog`, `runDetail` | Aliases registered by `run-dialog.js`: `runLog { date?, type?, distanceKm?, prefill? }` or `{ runId }`, `runDetail { runId }`. |
| `recovery` | `{ date? }` |
| `workout` (alias `workoutExport`) | `{ workout?, date?, templateId? }`; none of them: `derived.nextWorkout`. |
| `settings` | `{ section?: 'profile' \| 'appearance' \| 'connections' \| 'data' \| 'updates' \| 'about', connect?: true (opens the Strava connect form), backupText?, backupName? (import preview, used by onboarding) }`. A store build has no `updates` section (it opens `about`) and no Strava group. |
| `onboarding` | `{}` |
| `more` | Shell, phone "Více" sheet. |

---

## 7. Components (`app.components.create(name, props)`)

Built-ins all return DOM elements:

| Name | Props | Notes |
|---|---|---|
| `segmented` | `options: [{ value, label, count?, icon?, dot? }], value, onChange(v), label, size: 'lg', key` | `role="radiogroup"`, arrow keys, roving tabindex. Range tabs and filters. |
| `scale` | `min = 1, max = 10, value, onChange(v), label, lowLabel, highLabel, fill, key` | 1–10 squares (effort, fatigue, soreness); `fill` tints the values below. |
| `dayToggles` | `value: [0..6], onChange(days), label, min = 1` | Po–Ne square toggles, 0 = Monday (`profile.days`). |
| `stepper` | `value, min, max, step, decimals, unit, label, id, onChange(v), key` | [−] value [+]. Typing accepts a decimal comma; ↑/↓ step. |
| `switch` | `checked, onChange(bool), label, key` | Square-ish switch with `role="switch"`. |
| `range` | `value, min, max, step, label, id, onChange(v)` | Slider with an accent fill. |
| `field` | `label, control, hint, error, optional, id` | Wires `for`, `aria-describedby` and `aria-invalid`. |
| `stat` | `label, value, unit, sub, hot, small, countTo: { to, from, format }` | Stat tile. `hot` is the orange signal tile; at most one per board. |
| `empty` | `icon, title, text, actions: [Node], center` | Empty state. |
| `skeleton` | `lines, title, block` | Loading state. |
| `typeTag` | `type` | Series dot plus the localized run type. |
| `valueUnit` | `value, unit, cls` | `5,0 km` with a small unit. |
| `meter` | `value, max, variant: 'accent' \| 'cool', size: 'lg', label, animate` | 10-segment meter. |
| `legend` | `groups, goal, plan` | Shared chart legend. |
| `callout` | `kind: 'info' \| 'warn' \| 'danger' \| 'accent', icon, title, text, children` | — |
| `placeholder` | — | Used by the stubs. |

Pages may register their own components, e.g. `recoveryCheckin` (owned by `recovery.js` and used by home). Name them in camelCase. A factory gets `(props, app)` and returns an element.

---

## 8. Shell

- **Desktop (Windows):** `titleBarStyle: 'hidden'` with a 42 px overlay; the caption buttons sit top-right.
  - Only non-scrolling chrome is draggable: `.brand` and `.topbar`. Interactive children are automatically `no-drag`; mark anything else with `.no-drag`.
  - `html[data-platform="desktop"] .topbar` keeps 150 px free on the right.
  - Content scrolls in `#main` (`.main-scroll`), *below* the drag area, which fixes the 0.3 "clicks swallowed under the drag strip" bug.
- **Sidebar slots, filled by the runtime:**
  - the "Zapsat běh" button (`data-action="log-run"`, shortcut **N**)
  - the nav with SVG icons and a sliding orange lane line
  - the **next-run date badge** beside "Můj plán" (`ne 29. 11.`, or "Dnes")
  - the Strava status, which opens Settings › connections
  - Nastavení
  - the profile: initial, name and goal from `state.profile` (nothing hard-coded), plus the theme toggle
- **Topbar:** `<h1 id="page-title">` (the page title) and the date eyebrow `pátek 27. listopadu` (or `eyebrow(ctx)`), and the `actions(ctx)` slot.
- **Breakpoints:**

  | Width | Layout |
  |---|---|
  | > 1180 px | 220 px sidebar |
  | 961–1180 | 212 px compact sidebar, 24 px gutters (the 1120 × 720 minimum window) |
  | 761–960 | 72 px icon rail (labels stay for screen readers, `title` tooltips) |
  | ≤ 760 | phone: compact header (brand mark, title and date, avatar button → "Více"), bottom tab bar [Přehled, Plán, **+ Zapsat**, Výkonnost, Více], safe-area insets, touch targets ≥ 44 px |
- **Built-in actions** (`data-action` on any element):

  | Action | Effect |
  |---|---|
  | `log-run` (`data-date`) | Opens dialog `run` with `{ mode: 'new', date }`. |
  | `settings` (`data-section`) | Opens Settings at that section. |
  | `profile` | Opens Settings › profile. |
  | `connection` | Opens Settings › connections. |
  | `toggle-theme` | Switches the theme. |
  | `more` | Opens the phone "Více" sheet. |
  | `navigate` (`data-page`) | Navigates to the page. |
- **Navigation from anywhere:** `<a href="#plan" data-nav="plan">`.

---

## 9. Platform wiring inside the runtime

- **Strava (desktop only, `app.strava.supported`):**
  - At start it calls `status()`; if connected, it runs `sync()`. It then syncs every 5 min while connected, and immediately after the `connected` event.
  - `sync()` maps activities with `strava.toRun`: the date and start time are sliced from `startDateLocal`, never parsed with `new Date()`. It imports with `VeyvoStore.importStravaRuns`, so duplicate rules apply, the typed time wins and deleted runs stay deleted. It stores `strava.lastSync`.
  - **Errors are never swallowed.** They are stored in `strava.lastError` (shown in the sidebar slot as "Strava: chyba", with the text in the tooltip) and toasted with a Retry action. Background repeats of the same error are not re-toasted.
  - `electron/main.js` throws coded errors (`[code] message`, turned into `error.code` by `VeyvoPlatform`): `auth_required` for a 401/403 or a refused refresh token, `strava_http` for any other HTTP status, `network` when Strava is unreachable. `app.errorText` translates them (`ui.errors.code.*`) and keeps the status ("… (401) …"), so Settings shows "Vyžaduje nové přihlášení" after a background sync too.
  - Settings uses `app.strava.connect(secret)`, `disconnect()`, `sync({ manual: true })` and `status()`, and listens to `app.on('strava')`.
- **Updates:** (the `github` channel only; a store build has `app.updates.supported === false` and no Aktualizace section)
  - Desktop updater events go to `app.on('updates')` and `app.updates.status()`. `ready` shows a toast with "Restartovat" (`install()`).
  - Android checks GitHub once a day; `available` shows a toast with "Stáhnout". The day only counts once GitHub answered and a newer release already has its APK (offline: retried on the next launch or return to the app). A newer release without an APK is `{ type: 'newer', version, pageUrl }`, never "current". The last answer is kept in `localStorage['veyvo-update-status']` and shown after a restart while it fits the installed version.
  - Settings shows the current state and calls `check()` / `install()`.
- **Backups:** after the first change each day (and at start), `VeyvoPlatform.backup.snapshot(VeyvoStore.exportBackup(state, nutrition, { legacy: localStorage['veyvo-state-backup-v1'], … }))` runs wherever it is supported (desktop: userData/backups, keep 14; Android: Data/backups). The first failure is toasted (joined to the start-up migration notice when that is pending), every result is sent as `'backup'` and kept for `app.backupStatus()`, which Settings › Data shows. The day of the last snapshot is kept in `localStorage['veyvo-last-backup']`.
- **Safety copies:** before Nahradit (replace) and Smazat vše (wipe), Settings saves the current data with `backup.snapshot(json, { kind: 'replace' | 'wipe' })` as its own file `veyvo-YYYY-MM-DD-HHMMSS-before-<kind>.json`. It never overwrites the daily file or an earlier copy, the newest 10 copies are kept apart from the 14 daily backups, and they are listed (and restorable) in Automatické zálohy. A failed safety copy asks before going on (replace and wipe alike); an empty state needs none.
- **Android back button:** closes the top dialog, else goes to `home`, else exits the app (`App.exitApp`).
- **Legacy migration notices:** the `VeyvoStore.load` report is shown once as a toast (e.g. "1 běh ze Stravy byl spojen s ručním zápisem.", corrupt data kept, runs dropped).

---

## 10. i18n and typography

- Register your namespace once at load time, in **both languages**, with identical `{param}` names:

  ```js
  VeyvoI18n.register('home', { cs: { today: { rest: 'Dnes odpočívej.' } }, en: { today: { rest: 'Rest today.' } } });
  ```

  `VeyvoI18n.audit('home')` must come back empty. Copy the check in `tests/ui-foundation.test.js` for your namespace.
- **Every visible string goes through `app.t` / `ctx.t`.** That includes `aria-label`, `title`, placeholders, tooltips and chart text. No Czech literals in code.
- Plurals use objects: Czech needs `one / few / many / other`, English `one / other`, e.g. `{ one: '{n} běh', few: '{n} běhy', many: '{n} běhu', other: '{n} běhů' }`. Call `t(key, { n })`. Reuse `common.count.*`: runs, workouts, days, weeks, km, hours, minutes, seconds.
- Shared words live in `common.*`:
  - `runType.<code>` and `runTypeShort`
  - `weekdayShort`, `weekdayMin`, `weekdayLong`, `onWeekday` (index 0 = Monday)
  - `field.*`, `unit.*`, `button.*`, `status.*`, `language.*`, `theme.*`
- Shell strings live in `ui.*`, chart strings in `charts.*`, Store texts in `store.*`, platform errors in `platform.error.<code>` and workout names in `workouts.*`.
- **Typography (`VeyvoUI.fmt`)** always produces non-breaking spaces:

  | Call | Output |
  |---|---|
  | `kmUnit(5)` | `5,0 km` |
  | `km(5)` | `5,0` |
  | `paceUnit(252)` | `4:12 /km` |
  | `pace` | `4:12` |
  | `duration(1262)` | `21:02` (`1:09:40` from 1 hour up) |
  | `durationWords` | `5 h 41 min` |
  | `seconds(-62)` | `−62 s` (U+2212 minus) |
  | `hours(7.2)` | `7,2 h` |
  | `date(key, style)` | `út 24. 11.`; styles: `short`, `dayMonth`, `long` (`úterý 24. listopadu`), … |
  | `relDay(key, today)` | `za 3 dny` |
  | `weekRange` | `23.–29. 11.` |
  | `count('common.count.runs', 3)` | `3 běhy` |
  | `goal(profile)` | `5 km pod 20:00` |
  | `typo(text)` | Applies the rules below to any string you assemble yourself. |

  `typo` keeps a number together with the unit or word after it. In Czech it also binds one-letter prepositions and conjunctions to the next word (`v neděli`, `k cíli`), except unit letters after a number.
- Numbers in the UI wear `.num` (Barlow Condensed, tabular). Put units in a small `.unit` span: `dom.val('5,0', 'km')` or the `valueUnit` component.

---

## 11. CSS conventions

- **Tokens only** (`tokens.css`). Never write raw hex in page CSS.

  | Group | Tokens |
  |---|---|
  | Surfaces | `--bg`, `--surface-0` (chrome) … `--surface-3` (hover/chips) |
  | Lines | `--line`, `--line-soft`, `--line-strong`, `--card-line` |
  | Text | `--text`, `--text-muted`, `--text-faint` |
  | Accent | `--accent` (fills/marks), `--accent-text` (orange *text*), `--accent-ink` (text on orange), `--accent-soft` / `-soft-2` / `-line` |
  | Cool | `--cool`, `--cool-text`, `--cool-soft` |
  | Status | `--good`, `--warn`, `--danger` (+ `-soft`) |
  | Series | `--series-fast`, `--series-quality`, `--series-easy`, `--series-goal`, `--series-plan` |
  | Marks | `--mark-track`, `--seg-on`, `--seg-off` |

  Also available: radii `--r-xs`…`--r-lg` (≤ 10 px), spacing `--sp-1`…`--sp-9`, type `--fs-*` / `--num-*`, motion `--dur-1`…`--dur-5` and `--ease-*`, plus `--safe-*` insets.

  Every text token holds ≥ 4.5:1 on all surfaces in both themes. The light accent text is `#B34205`, one step darker than concept A's `#C24A08`, because `#C24A08` measures 4.42:1 on the light page background.
- **Shared classes** (components.css): `.btn` with `.btn-primary`, `-secondary`, `-ghost`, `-outline`, `-danger`, `-danger-solid`, `-sm`, `-lg`, `-block`, `-link`, `.is-busy`. The rest:

  | Group | Classes |
  |---|---|
  | Icon buttons | `.icon-btn`, `.icon-btn-sm` |
  | Chips, tags, badges | `.chip` with `-accent`, `-cool`, `-good`, `-warn`, `-danger`, `-plan`, `-solid`, `-sm`; `.dot`, `.dot-fast`, `-quality`, `-easy`; `.type-tag`; `.badge-count`; `.kbd` |
  | Cards | `.card` with `.card-pad`, `-pad-lg`, `-raised`, `-signal` (orange top edge), `-glow`; `.card-head`, `.card-title`, `.card-sub`, `.card-end` (also `.sec-*`) |
  | Stats | `.stat-board`, `.stat`, `.stat-row`, `.stat-hot` |
  | Meters and bars | `.meter`, `.bar > .bar-fill` |
  | Tables | `.table` with `.r`, `.n`, `.dt`, `tr.is-clickable`, `tr.group-row`; `.table-wrap` |
  | Forms | `.form`, `.form-row`, `.field`, `.input`, `.input-num`, `.select`, `.textarea`, `.affix`, `.check`, `.switch`, `.range` |
  | Lists and notices | `.list`, `.list-row`, `.callout`, `.empty`, `.skel` |
  | Charts and legend | `.legend`, `.vchart` |
  | Text helpers | `.eyebrow`, `.num`, `.unit`, `.muted`, `.faint`, `.accent-text`, `.truncate`, `.nowrap`, `.sr-only` |
- **Page classes** start with the page prefix (`home-`, `plan-`, `prog-`, `nut-`, `rd-`, `rec-`, `ws-`, `set-`, `onb-`) and live in your `styles/pages/*.css`. Don't restyle shared classes globally. Compose them, or scope overrides under your prefix.
- **Owner rules:**
  - Border radius ≤ 10 px everywhere (no pills), no purple, no emoji or unicode glyph icons, no marketing filler, no cursor effects, no invented metrics.
  - Light and dark must both work. Put `color-scheme` on the theme roots, not on components.
  - Phone (≤ 760 px): touch targets ≥ 44 px (the shared components already comply) and 16 px inputs.
  - Test at 1480×940, 1120×720 and 412×915.
- **Accessibility:**
  - Use real buttons and links; `:focus-visible` rings come from base.css.
  - Icon-only buttons need `aria-label`.
  - Every chart is `role="img"` with `<title>` and `<desc>`.
  - Use `aria-live` for status text.
  - Never remove the focus outline without a replacement.

---

## 12. Motion

Motion is purposeful and polished, transform and opacity only, and ≤ 450 ms. It switches off with `prefers-reduced-motion`, `<html data-motion="off">` and inside `[data-anim="off"]`. The runtime marks the page container that way on data re-renders, so entrance motion plays on navigation only.

- **CSS classes (motion.css):**

  | Class | Effect |
  |---|---|
  | `.reveal` | Rise in; stagger with `style="--i: n"`. |
  | `.stagger` | Children rise in one by one. |
  | `.fade-in`, `.pop` | Fade or spring pop (with `--i`). |
  | `.grow-y` | Bars grow from their base (SVG-safe). |
  | `.grow-x` | Lane fills grow from the left. |
  | `.draw-line` | Applied to a clip rect for a line draw-in. |
  | `.fill-x` | With `--f`. |
  | `.meter.is-anim` | Segments appear one after another. |
  | `.page-enter` | Page transition. |
  | `.is-flash` | Via `motion.flash`. |

  Buttons, the nav, tabs, chips, switches, scale squares and day toggles already have press and selection micro-interactions.
- **JS (`VeyvoUI.motion`):**

  | Function | Use |
  |---|---|
  | `countUp(el, to, { from, duration ≤ 450, delay, format })` | Choose a meaningful `from`, e.g. count the best time down from the previous best. |
  | `reveal(container, { selector, stagger })` | Staggered rise-in. |
  | `drawLine(svgEl)` | Draw-in via a clip rect. |
  | `growBars(svg)` | Re-play after a range-tab switch. |
  | `fillBar(el, fraction, { delay, from })` | Progress fill. |
  | `pageEnter(el)` | Page transition. |
  | `flash(el)` | Highlight the row or card that just changed; it needs `position: relative`. |
  | `prefersReduced()`, `suppressed(el)` | Checks. |

  All of them jump to the end state when motion is suppressed, so call them unconditionally.

---

## 13. Charts (`VeyvoUI.charts`)

Charts are pure SVG built from real data. Each one returns `<div class="vchart">` with an accessible `<svg role="img">`. Mount them responsively:

```js
const host = h('div');                                   // append it to the page first
container.append(card(host));
charts.mount(host, o => charts.paceChart(d.runs, Object.assign({ goalPace: d.goal.targetPace, range, today: d.today, bestRunId: d.goal.bestRunId }, o)));
// mount(...) -> { update(nextBuilder?, animate?), destroy() }; it re-renders on resize without animation
```

| Builder | Options | Notes |
|---|---|---|
| `weeklyVolume(weeks, …)` | `planned` (km still planned this week: dashed ghost bar and a `5,0 + 3` label), `stackedByType`, `showCounts` (run count under each week), `height`, `currentLabel` | Value labels; hover/keyboard tooltip per week. |
| `paceChart(runs, …)` | `goalPace`, `range: '4w' \| '3m' \| '6m' \| '1y' \| 'all'`, `today`, `bestRunId`, `labelFiveK = true`, `gapMarker = true`, `height` | Y axis inverted (faster is higher). Dashed goal line, direct labels on 5 km results and a pace label at each series' end. The gap bracket reads `−12 s/km`. Hover crosshair and tooltip; the svg is focusable and arrows step through runs, with a live region. |
| `goalLanes(goal)` | — | The Track board. Lane 1 is the previous best, lane 2 the current best (orange), with a hatched gap labelled `62 s` and a checkered finish at the target. The scale is chosen from the data (`22:00 → 20:00` for the owner). Handles 0 or 1 attempts and a missing target. |
| `meter(value, max = 10, opts)` | `opts` as the `meter` component | — |
| `sparkline(values, { width, height, area, invert, label })` | — | — |
| `legend({ groups, goal, plan })` | — | — |

`groupOf(type)` and `typeLabel(type)` are also exported.

**One series encoding everywhere:**

| Group | Run types | Colour token | Dot class |
|---|---|---|---|
| Běh a závod | `run`, `test5k`, `race` | `--series-fast` (orange) | `.dot-fast` |
| Intervaly a tempo | `intervals`, `tempo` | `--series-quality` (blue) | `.dot-quality` |
| Lehké a dlouhé | `easy`, `long` | `--series-easy` (graphite) | `.dot-easy` |

Show a legend whenever two or more series are visible. All charts handle empty and one-point data.

---

## 14. Icons (`VeyvoUI.icons`)

`icons.get(name, { size, className, title })` returns an `<svg class="ic">` on a 24 grid, 1.75 stroke, `currentColor`. It is `aria-hidden` unless `title` is given. In static markup, write `<span data-icon="name"></span>`; the runtime calls `icons.hydrate(container)` after every render.

Names:
- Navigation: `home` (grid), `house`, `calendar`, `calendar-check`, `calendar-plus`, `trend`, `bar-chart`, `checklist`, `fork-knife`, `settings`, `more`, `menu`, `user`
- Actions: `plus`, `minus`, `play`, `check`, `x`, `chevron-left|right|up|down`, `arrow-left|right|up|down`, `external`, `download`, `upload`, `share`, `link`, `refresh`, `trash`, `edit`, `copy`, `undo`, `filter`, `search`
- Running data: `flag`, `target`, `clock`, `timer`, `route`, `gauge`, `heart`, `watch`, `mountain`, `repeat`, `list`, `file`, `database`, `lock`
- Status and appearance: `info`, `warning`, `check-circle`, `x-circle`, `moon`, `sun`, `language`

Aliases: `plan`, `chart`, `distance`, `pace`, `sync`, `delete`, `strava` → `link`, `garmin` → `watch`, `export`, `import`, `goal`, `close`, `success`, `error`, and others. There are no brand logos and no flame or lightning gimmicks.

---

## 15. Visual dev workflow

```bash
E=<path to an Electron binary>   # the Linux build lives in the session scratchpad: …/scratchpad/electron-linux/electron
$E --ozone-platform=headless --no-sandbox tests/visual/screenshots.cjs --out /tmp/shots \
   --page home,plan,progress,nutrition,kit --theme dark,light --lang cs,en --size desktop,min,phone [--full]
   [--dialog run:'{"mode":"new"}'] [--eval "VeyvoUI.app.navigate('plan')"] [--seed demo|empty|legacy|file.json]
   [--platform desktop|web] [--strava off|connected|error] [--today 2026-11-27] [--anim]
```

The script writes `<out>/<page>[-<dialog>]-<theme>-<lang>-<w>x<h>.png` and prints the page's console warnings and errors. It seeds data through `tests/visual/stub-preload.cjs` (localStorage before load plus a fake `window.veyvo`).
- The `demo` seed holds the owner's 9 runs (27. 10. – 24. 11. 2026), shifted by whole weeks so the last run is always in the past week, plus recovery logged today and profile "Pepa".
- `--page kit` injects `tests/visual/kit.js`, a living style guide of every shared component and chart with real data.

Look at your screenshots in both themes and all three sizes before you finish.

Tests: `npm test` must stay green. `tests/ui-foundation.test.js` guards:
- the i18n completeness of `ui` and `charts`
- typography
- the script order
- no `innerHTML`, no glyph icons, radii ≤ 10 px, the reduced-motion kill switch

Add a similar audit for your namespace.

**Electron UI tests** (`npm run test:ui`, run on Windows CI with the repo's Electron; by hand with any Electron ≥ 38, e.g. `<linux electron> --ozone-platform=headless --no-sandbox tests/ui-app.cjs`):

| File | Covers |
|---|---|
| `tests/ui-harness.cjs` | Shared harness: real `src/index.html` + the real sandboxed `electron/preload.js`; every IPC channel answered by a recording stub (`t.ipc.calls`, `t.ipc.set`); in-memory partition; `?today=2026-11-27` pinned; page helpers `window.T`; real keyboard/mouse input (`t.key`, `t.clickOn`); console errors fail the run. |
| `tests/ui-app.cjs` | First-launch onboarding → profile saved and persisted; legacy 0.3 storage → v2 with correct totals; drag strip (draggable, no-drag controls, clear of the caption buttons, content below it); cs → en on every page and dialog, live and after a restart, and back; theme + title bar colour persisted; Settings days → plan week + nav badge; updater card; 1120 × 720 and phone layouts (no sideways scroll, 44 px targets, tab bar); 360 px controls ≥ 44 × 44 px; safe-area insets at 915 × 412; a failed backup on the upgrade launch stays visible; onboarding refuses an oversized backup. |
| `tests/ui-flows.cjs` | Inline check-in autosave keeps focus and drives the rest advice; log a run (`12,4`, `69:40`) → result view → Přehled, Výkonnost, Můj plán; edit and delete with Undo; Esc and the discard question; Strava import through `app.strava.sync` (twin merge, re-sync, deleted run ignored, 401 → "Vyžaduje nové přihlášení"); booking a library session (next session, badge, × + Undo); FIT bytes + `saveFile`, Apple `.workout` bytes, copy as text; check-in saved on `pagehide`; plan day menu without the Popover API; a crafted backup (`toString` ids) cannot brick the app; storage full never claims "saved". |
| `tests/ui-nutrition.cjs` | Před během saves under `veyvo-pre-run-v1` (0.3 format, unknown keys kept) and restores after a restart; calculator, midnight timeline, checklist reset + Undo, "Podle dalšího běhu"; Settings replace / Undo / wipe while the page is open (safety copies, failed safety copy asks); English; layouts. |

---

## 16. Integration notes (0.4)

- **Removed:** the 0.3 UI (`journal.js`, `nutrition-ui.js`, `styles.css`, `calendar-context.js`, `time-context.js`) with its tests (`calendar.test.js`, `time-context.test.js`, `time-ui.cjs`, `update-ui.cjs`, `nutrition-ui.cjs`). `VeyvoRuns.weekStrip` (tested in `runs-model.test.js`) replaces the calendar.
- **First paint:** `electron/main.js` (window + title bar overlay) and `mobile/capacitor.config.json` use the graphite `#0D0E11`.
- **Shared component fixes:** scale squares and day toggles centre their label; on phones every `sheet` dialog is a bottom sheet of `fit-content` height (it used to stick to the top), segmented buttons are 44 px tall and `.btn-link` gets an invisible 44 px hit area; the "Více" tab lights up on pages without their own tab (Před během).
- **0.4 release review fixes:** one 5 km window (4.95–5.2 km) in the engine, the records and the pace baseline; a 10/10 effort means rest for 3 days only; run ids named like `Object.prototype` keys are renamed (`VeyvoRuns.notesOf` reads notes safely) and `boot.js` offers "Spustit bez uložených dat" (the stored state is kept under `veyvo-state-corrupt-*`); safety copies before replace/wipe; nutrition is written before the state on replace, merge, wipe and Undo; the check-in flushes on `pagehide` / hidden page; Android system bars follow the theme (`SystemBars.setStyle`); safe-area insets above 760 px; 44 px targets at 360 px (two-row 1–10 scales via `--n-phone`).
- **Open:** `VeyvoRuns.mergeStravaIntoManual` (`runs-model.js`, core) still keeps Strava's moving time. The app never calls it (imports go through `VeyvoStore.importStravaRuns`, where the typed time wins), but the helper should be aligned or removed in core.
