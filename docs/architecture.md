# VEYVO 0.4 architecture

One web core (`src/`) runs in two shells:

- **Windows desktop**: Electron (`electron/main.js` + `electron/preload.js`) loads `src/index.html` from disk.
- **Android**: Capacitor (`mobile/`) copies `src/` + `assets/` into `mobile/www` (`npm run sync` in `mobile/`) and wraps it in a WebView.

There is no bundler. Every file in `src/` is a **classic script** loaded by `<script src>` (the CSP is `script-src 'self'`, and ES modules over `file://` are unreliable in Electron). Shared logic uses the UMD pattern so Node tests can `require()` the same file:

```js
(function (root) {
  const Format = root.VeyvoFormat || (typeof require === 'function' ? require('./format.js') : null);
  // ...pure code...
  const api = { /* exports */ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VeyvoRuns = api;
})(globalThis);
```

Rules for `src/core/**`: pure functions, no DOM access, no `Date.now()` hidden inside calculations (pass `today` as `'YYYY-MM-DD'`), no network. Each core module has a `tests/<name>.test.js` run by `npm test` (`node --test "tests/*.test.js"`).

## Files and global names

| File | Global | Purpose |
|---|---|---|
| `src/vendor/workoutkit.js` | `VeyvoWorkoutKit` | Vendored `@bibixx/workoutkit` 0.2.0 (MIT) – Apple `.workout` encoder |
| `src/core/format.js` | `VeyvoFormat` | Locale-aware dates, durations, pace, distance, plurals, relative days |
| `src/core/i18n.js` | `VeyvoI18n` | `register(ns, {cs, en})`, `t(key, params)`, `setLocale`, `apply(root)` for `[data-i18n]` |
| `src/core/runs-model.js` | `VeyvoRuns` | Run types, records, best efforts, weekly totals, goal progress, derived milestones/notes, week strip, Strava dedupe |
| `src/core/store.js` | `VeyvoStore` | State schema v2, migrations from legacy state, safe load/save, backup export/import |
| `src/core/workouts.js` | `VeyvoWorkouts` | Structured workout model, validation, session library, plan → workout, printable text |
| `src/core/export/fit.js` | `VeyvoFit` | Own FIT workout encoder (Garmin, also opened by WatchFit on iPhone) |
| `src/core/export/apple.js` | `VeyvoApple` | Workout → Apple `.workout` bytes via `VeyvoWorkoutKit` |
| `src/core/export/zwo.js` | `VeyvoZwo` | Workout → Zwift/TrainingPeaks `.zwo` XML (run) |
| `src/core/export/intervals.js` | `VeyvoIntervals` | Workout → intervals.icu workout text + `events/bulk` payload; API calls go through `VeyvoPlatform.http` |
| `src/platform.js` | `VeyvoPlatform` | Desktop/Android/web adapter (files, sharing, http, secrets, backups, updates, Strava, Garmin drive copy) |
| `src/training-context.js` | `VeyvoTraining` | Existing next-run rule engine (keep API; accept new run type codes) |
| `src/nutrition-context.js` | `VeyvoNutrition` | Před během content (cs + en), timeline and fuel rules; storage key `veyvo-pre-run-v1` |
| `src/ui/**` | `VeyvoUI.*` | UI runtime (`dom`, `fmt`, `icons`, `motion`, `charts`, `app`) and page modules — contract in [`docs/ui-architecture.md`](ui-architecture.md) |

The Garmin FIT SDK (`@garmin/fitsdk`) is a **devDependency used only by tests** to decode our files. Its licence forbids redistributing the SDK source, so it must never be copied into `src/`.

## State schema v2 (`localStorage['veyvo-state']`)

The storage key stays `veyvo-state` so existing desktop data is migrated, not lost. Nutrition keeps its own key `veyvo-pre-run-v1`.

```js
{
  schemaVersion: 2,
  profile: { name: '', goalDistanceKm: 5, targetSeconds: 1200, days: [1, 6], onboarded: false },
  // days: 0 = Monday … 6 = Sunday (same convention as VeyvoTraining). Legacy [1,6] = Tuesday + Sunday.
  runHistory: [Run],
  recoveryLogs: [{ date: 'YYYY-MM-DD', sleepHours, fatigue /*1-10*/, soreness /*0-10*/, note }],
  legacyMilestones: [{ date, label }],          // old state.milestones, read-only
  ignoredStravaIds: ['123', …],                 // Strava activities the runner deleted: never re-imported
  plannedWorkouts: [{ date, templateId }],      // one library session per date (VeyvoWorkouts.LIBRARY_IDS)
  exportLog: [{ at: ISO, workoutId, format }],  // newest 50 exports ('fit' | 'apple' | 'zwo' | 'intervals' | …)
  theme: 'dark' | 'light',
  language: 'cs' | 'en',
  strava: { connected: false, lastSync: null, lastError: null },
  intervals: { enabled: false, lastPush: null, lastError: null }, // API key lives in VeyvoPlatform.secrets
  ui: { lastSeenVersion: null }
}

Run = {
  id: string,                    // 'm-<timestamp>' manual, 'strava-<id>' Strava
  source: 'manual' | 'strava',
  date: 'YYYY-MM-DD',            // local calendar date of the run
  startTime: 'HH:MM' | null,
  type: 'run' | 'easy' | 'long' | 'tempo' | 'intervals' | 'test5k' | 'race',
  distance: number,              // km
  movingSeconds: number,
  effort: 1..10 | null,
  note: string,
  name?: string, stravaActivityId?: string, stravaMovingSeconds?: number,
  averageHeartrate?: number | null, elevationGain?: number | null
}
```

Run ids are never an `Object.prototype` name (`constructor`, `toString`, `__proto__`, …): such ids become `m-<id>`. 0.3.4 shared-chat runs (`source: 'chatgpt'`, `T12:00:00`) migrate as manual runs without a start time and with `importedFrom: 'chatgpt'`. Legacy `stravaActivityIds` without a run (wiped in 0.3) become `ignoredStravaIds`. Top-level 0.3 keys that v2 drops (`chatHistory`, `weekReviews`, …) stay in `veyvo-state-backup-v1` and travel in backups as `legacy`.

Manual + Strava twins (same date, |Δkm| < 0.15, |Δs| < 90) become one record: Strava gives id, name, heart rate, elevation and start time; the **manual entry's distance and moving time win** (owner decision 2026-11-27: the typed time is authoritative) and Strava's time is kept as `stravaMovingSeconds`. Deleting a Strava run adds its id to `ignoredStravaIds` (`VeyvoStore.deleteRun`); `VeyvoStore.importStravaRuns(state, runs)` skips those ids, and `applyBackup(…, { mode: 'merge' })` does not bring them back either.

Legacy → v2 migration: Czech type labels map to codes (`Běh`→`run`, `Lehký běh`→`easy`, `Dlouhý běh`→`long`, `Tempo`→`tempo`, `Intervaly`→`intervals`, `Test 5 km`→`test5k`, `Závod`→`race`). `date` values like `2026-11-24T00:00:00` or Strava `2026-11-24T19:30:00Z` (local time with a fake Z) become `date: '2026-11-24'` and `startTime: '19:30'` by string slicing, never by `new Date()`. `time` strings are dropped once `movingSeconds` is known. `stravaActivityIds` is derived from `runHistory`. The old line that forced `profile.days = [1,6]` on every launch is gone.

## Workout model (`VeyvoWorkouts`)

```js
Workout = {
  id: string, name: string /* ≤ 40 chars; Garmin shows 15 */, sport: 'running',
  date?: 'YYYY-MM-DD', description?: string, source: 'plan' | 'library' | 'custom',
  steps: Array<Step | Repeat>
}
Step = {
  kind: 'step',
  intensity: 'warmup' | 'active' | 'recovery' | 'rest' | 'cooldown',
  duration: { type: 'time', seconds } | { type: 'distance', meters } | { type: 'open' },
  target: { type: 'open' } | { type: 'pace', fastSecPerKm, slowSecPerKm } | { type: 'hr', lowBpm, highBpm },
  label?: string
}
Repeat = { kind: 'repeat', count: 1..99, steps: Step[] }   // one level only
```

Validation: at most 50 FIT steps after flattening (each repeat counts as one extra step), repeat count 1–99, pace fast < slow, all numbers finite.

## Platform adapter (`VeyvoPlatform`)

```js
VeyvoPlatform = {
  kind: 'desktop' | 'android' | 'web',
  version(): Promise<string>,
  saveFile({ name, mime, data /* Uint8Array | string */ }): Promise<{ saved, path?, shared? }>,
  openExternal(url): Promise<void>,
  http({ url, method, headers, body }): Promise<{ status, ok, text, json }>,  // allowlisted hosts only
  secrets: { get(name), set(name, value), remove(name) },                      // desktop: safeStorage
  backup: { snapshot(json, { kind? }): Promise<{ path }>, list(), read(name) }, // daily 'veyvo-YYYY-MM-DD.json' (keep 14); kind 'replace' | 'wipe': safety copy 'veyvo-YYYY-MM-DD-HHMMSS-before-<kind>.json' (keep 10)
  updates: { supported, check(), install(), onStatus(cb) },
  strava: { supported, status(), connect(secret), sync(), disconnect(), onEvent(cb) },
  garmin: { supported, findDrives(): Promise<[{ root, label }]>, copy({ name, data, root }) },
  setTitleBarTheme({ color, symbolColor }): void                                // desktop: title bar overlay; Android: SystemBars style
}
```

Desktop implements it over `window.veyvo` (preload IPC). Android uses `window.Capacitor.Plugins` (Filesystem, Share, Preferences, Browser, App, CapacitorHttp). Web (tests/screenshots) uses safe fallbacks (download via `<a download>`, no secrets).

## Design direction

Base: concept **A "Track"**: graphite + one orange signal, Barlow Condensed numerals + Inter UI, goal-gap hero, lane-strip week, charts from real data. Grafted ideas: D's "today" headline + inline 3-tap recovery check-in, C's chart tooltips + range tabs + next-run date in the nav, B's derived notes in the run log. Polished motion allowed (transform/opacity, respects `prefers-reduced-motion`). Responsive: sidebar on desktop, bottom tab bar under 760 px for Android.
