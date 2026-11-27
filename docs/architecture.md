# VEYVO 0.4 architecture

One web core (`src/`) runs in three shells:

- **Windows desktop**: Electron (`electron/main.js` + `electron/preload.js`) loads `src/index.html` from disk.
- **Android**: Capacitor (`mobile/`) copies `src/` + `assets/` into `mobile/www` (`npm run sync` in `mobile/`) and wraps it in a WebView.
- **iPhone**: the same Capacitor project (`mobile/ios`, `npm run sync:ios`, App Store channel) plus two Swift plugins of its own: `VeyvoWorkoutKit` (Apple Watch through WorkoutKit) and `VeyvoHealth` (Apple Health import, read only). See [`ios-release.md`](ios-release.md#native-features).

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
| `src/build-info.js` | `VEYVO_BUILD` | Build channel `{ channel: 'github' }`, rewritten by `mobile/scripts/sync-web.mjs` for store builds (see [Build channels](#build-channels)); loaded first |
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
| `src/platform.js` | `VeyvoPlatform` | Desktop/Android/iOS/web adapter (files, sharing, http, secrets, backups, updates, Strava, Garmin drive copy, Apple Watch, Apple Health) |
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
  ignoredHealthIds: ['6F1C…-…', …],             // Apple Health workout UUIDs the runner deleted: never re-imported
  plannedWorkouts: [{ date, templateId }],      // one library session per date (VeyvoWorkouts.LIBRARY_IDS)
  exportLog: [{ at: ISO, workoutId, format }],  // newest 50 exports ('fit' | 'apple' | 'zwo' | 'intervals' | …)
  theme: 'dark' | 'light',
  language: 'cs' | 'en',
  strava: { connected: false, lastSync: null, lastError: null },
  intervals: { enabled: false, lastPush: null, lastError: null }, // API key lives in VeyvoPlatform.secrets
  health: { enabled: false, lastImport: null, lastError: null },  // Apple Health import (iPhone); enabled after the first import
  ui: { lastSeenVersion: null }
}

Run = {
  id: string,                    // 'm-<timestamp>' manual, 'strava-<id>' Strava, 'health-<UUID>' Apple Health
  source: 'manual' | 'strava' | 'health',
  date: 'YYYY-MM-DD',            // local calendar date of the run
  startTime: 'HH:MM' | null,
  type: 'run' | 'easy' | 'long' | 'tempo' | 'intervals' | 'test5k' | 'race',
  distance: number,              // km
  movingSeconds: number,
  effort: 1..10 | null,
  note: string,
  name?: string, stravaActivityId?: string, stravaMovingSeconds?: number,
  averageHeartrate?: number | null, elevationGain?: number | null,
  healthId?: string,             // HKWorkout UUID (upper case); also on a manual/Strava run that absorbed its Health copy
  maxHeartrate?: number, sourceName?: string   // Health: the app that wrote the workout ('Cvičení', 'Garmin Connect')
}
```

Run ids are never an `Object.prototype` name (`constructor`, `toString`, `__proto__`, …): such ids become `m-<id>`. 0.3.4 shared-chat runs (`source: 'chatgpt'`, `T12:00:00`) migrate as manual runs without a start time and with `importedFrom: 'chatgpt'`. Legacy `stravaActivityIds` without a run (wiped in 0.3) become `ignoredStravaIds`. Top-level 0.3 keys that v2 drops (`chatHistory`, `weekReviews`, …) stay in `veyvo-state-backup-v1` and travel in backups as `legacy`.

Manual + Strava twins (same date, |Δkm| < 0.15, |Δs| < 90) become one record: Strava gives id, name, heart rate, elevation and start time; the **manual entry's distance and moving time win** (owner decision 2026-11-27: the typed time is authoritative) and Strava's time is kept as `stravaMovingSeconds`. Deleting a Strava run adds its id to `ignoredStravaIds` (`VeyvoStore.deleteRun`); `VeyvoStore.importStravaRuns(state, runs)` skips those ids, and `applyBackup(…, { mode: 'merge' })` does not bring them back either.

Apple Health (`VeyvoStore.importHealthRuns(state, rows, { at })`, rows from `VeyvoPlatform.health.importRuns`): a run is matched by its Health workout id, then by the duplicate rule. A Health copy never overrides a manual or Strava record: it only fills its blanks (start time, heart rate, the writing app, the workout id). Two Health workouts with different ids are one run only when they started at most 10 minutes apart (two apps wrote the same run). Rows without a distance are skipped. Deleting a run with a `healthId` adds it to `ignoredHealthIds`. The first import reads 90 days, later ones start 7 days before `health.lastImport` (`VeyvoStore.healthImportSince`).

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
  kind: 'desktop' | 'android' | 'ios' | 'web',
  build: { channel: 'github' | 'play' | 'appstore', store: boolean },          // window.VEYVO_BUILD (src/build-info.js)
  version(): Promise<string>,
  saveFile({ name, mime, data /* Uint8Array | string */ }): Promise<{ saved, path?, shared? }>,
  openExternal(url): Promise<void>,
  http({ url, method, headers, body }): Promise<{ status, ok, text, json }>,  // intervals.icu; + api.github.com in 'github' only
  secrets: { get(name), set(name, value), remove(name) },                      // desktop: safeStorage
  backup: { snapshot(json, { kind? }): Promise<{ path }>, list(), read(name) }, // daily 'veyvo-YYYY-MM-DD.json' (keep 14); kind 'replace' | 'wipe': safety copy 'veyvo-YYYY-MM-DD-HHMMSS-before-<kind>.json' (keep 10)
  updates: { supported, check(), install(), onStatus(cb) },
  strava: { supported, status(), connect(secret), sync(), disconnect(), onEvent(cb) },
  garmin: { supported, findDrives(): Promise<[{ root, label }]>, copy({ name, data, root }) },
  watch: { supported, canSchedule, check(), preview(workout, { indoor, locale }), schedule(workout, 'YYYY-MM-DD', opts), listScheduled(), clearScheduled() }, // iOS 17+: WorkoutKit
  health: { supported, isAvailable(), requestAuthorization(), importRuns({ since }) },  // iOS: HealthKit, read only
  setTitleBarTheme({ color, symbolColor }): void                                // desktop: title bar overlay; Android: SystemBars style
}
```

Desktop implements it over `window.veyvo` (preload IPC). Android and iOS use `window.Capacitor.Plugins` (Filesystem, Share, Preferences, Browser, App, CapacitorHttp); iOS adds `VeyvoWorkoutKit` and `VeyvoHealth` and never has an updater. `watch` and `health` exist on every adapter with `supported: false` outside iOS. Web (tests/screenshots) uses safe fallbacks (download via `<a download>`, no secrets).

On Android, `secrets` are Capacitor Preferences (SharedPreferences `CapacitorStorage.xml`, not encrypted). Auto Backup stays on for app data, but `res/xml/backup_rules.xml` (Android 6–11) and `res/xml/data_extraction_rules.xml` (Android 12+, cloud backup) exclude that file, so the intervals.icu API key never reaches the user's Google backup (`tests/mobile-sync.test.js`).

## Build channels

One source tree ships through several channels. `src/build-info.js` (the first script in `index.html`) sets `globalThis.VEYVO_BUILD = { channel }`; code reads it through `VeyvoPlatform.build` / `VeyvoUI.app.build` (`{ channel, store }`), and any unknown value counts as `github`.

| Channel | Ships as | Built with (in `mobile/`) |
|---|---|---|
| `github` | Windows app (electron-updater) and the Android APK on GitHub releases (daily GitHub check, APK opened in the browser) | `npm run build:github:apk` (same as `build:release`); the committed `src/build-info.js` |
| `play` | Google Play app bundle (AAB) | `npm run build:play:aab` (`sync-web.mjs --channel play`, `cap sync android`, `gradlew bundleRelease`) |
| `appstore` | Apple App Store (iOS) | `npm run sync:ios`, see [`ios-release.md`](ios-release.md) |

`mobile/scripts/sync-web.mjs --channel <c>` (or `VEYVO_CHANNEL=<c>`; default `github`) copies `src/` and `assets/` into `mobile/www`. For a store channel it also:
- rewrites `www/src/build-info.js` to that channel;
- deletes every block between the lines `// #if-channel github` and `// #end-channel` from the copied JS. `src/platform.js` wraps the whole GitHub updater (release URLs, `releaseInfo`, the Android update check, `api.github.com` in the http allowlist) this way, so a store binary does not even contain it. The same code also checks the channel at run time, so the unstripped source behaves the same in tests;
- fails when the copy still contains `api.github.com`, `releases/latest` or `.apk`, or when `index.html` does not load `build-info.js` first.

What a store build (`store: true`) changes, all covered by `tests/build-channel.test.js`:
- **Updates:** `VeyvoPlatform.updates.supported === false` on every adapter, and Settings has no Aktualizace section (`VeyvoUI.settings.sectionsFor`). Google Play's Device and Network Abuse policy allows updates only through Play.
- **Network:** the http allowlist is `intervals.icu` only (`util.httpHostsFor`).
- **Strava:** not shown anywhere, not even the "Strava zatím jen ve Windows verzi" note (`VeyvoUI.settings.connectionsFor`).
- **Wording:** no text about the Windows app, APK files or GitHub. Texts that name them have a `…Store` variant or sit in a part a store build does not render; the test lists each one (`NOT_IN_STORE`), so a new one fails until it is handled.
- **Garmin on Android:** the workout sheet's Garmin card steers to intervals.icu ("Garmin bez kabelu"), because Garmin Connect cannot import workout files; the `.fit` file stays behind "Pro pokročilé: USB z počítače" (`VeyvoUI.workoutSheet.garminViaIntervals`).

Every channel shows the health notice ("VEYVO není zdravotnický prostředek…") in Settings › O aplikaci and on the first onboarding step, plus the privacy policy link `https://pepibikerbtw.github.io/VEYVO/privacy/` (`VeyvoUI.settings.PRIVACY_URL`, opened with `VeyvoPlatform.openExternal`).

**Android versionCode** (`mobile/android/app/build.gradle`): `major × 1000000 + minor × 10000 + patch × 100 + VEYVO_BUILD_NUMBER` (0–99, default 0), so 0.4.1 is 40100. Play burns a versionCode on every upload, test tracks included: a second upload of the same version is built with `VEYVO_BUILD_NUMBER=1`, `2`, …. The old scheme gave 0.4.0 the code 400, so APKs installed from GitHub still update. The tag workflow (`.github/workflows/release.yml`, job `play-bundle`) builds the signed `play` AAB when the keystore secrets exist and keeps it as a workflow artifact, never on the public release.

## Design direction

Base: concept **A "Track"**: graphite + one orange signal, Barlow Condensed numerals + Inter UI, goal-gap hero, lane-strip week, charts from real data. Grafted ideas: D's "today" headline + inline 3-tap recovery check-in, C's chart tooltips + range tabs + next-run date in the nav, B's derived notes in the run log. Polished motion allowed (transform/opacity, respects `prefers-reduced-motion`). Responsive: sidebar on desktop, bottom tab bar under 760 px for Android.
