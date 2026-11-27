# VEYVO

VEYVO is a running journal for Windows and Android, in Czech and English. Log each run's distance, time and perceived effort (1–10). VEYVO plans the next easy run, tracks your goal (for example 5 km under 20:00), shows charts, records and milestones from your own runs, and exports structured workouts to your watch.

## Features

- **Přehled (overview):** today's headline, the goal gap, the next run, an inline recovery check-in, this week and recent runs.
- **Můj plán (plan):** a week grid, the next workout as steps, and a session library (easy, 6×400 m, 5×1 km, 3×2 km threshold, long run, 5 km test) with paces derived from your goal and best 5 km.
- **Výkonnost (progress):** pace and weekly-volume charts, a run log with derived notes, personal records and milestones.
- **Před během (pre-run):** source-based nutrition and preparation timeline, carb calculator, checklist and notes.
- **Do hodinek (send to watch):** Garmin `.fit` (USB), Apple Watch `.workout` (via iPhone), COROS / Suunto / Huawei / Amazfit / wireless Garmin via intervals.icu, Zwift / TrainingPeaks `.zwo`, and text for everything else.
- **Data:** stored locally on the device, automatic daily backups on Windows, export/import of backup files, optional Strava import (Windows).

## Development

- `npm test` runs the unit tests (Node 22+).
- `npm run test:ui` runs the Electron UI tests.
- `npm start` starts the Windows app; `npm run build` creates the Windows installer and portable app.
- Android: `cd mobile && npm ci && npm run build:debug` builds a debug APK (Java 21 and the Android SDK required). Release signing reads `VEYVO_KEYSTORE_PATH`, `VEYVO_KEYSTORE_PASSWORD`, `VEYVO_KEY_ALIAS` and `VEYVO_KEY_PASSWORD` from the environment.

Architecture: [docs/architecture.md](docs/architecture.md) and [docs/ui-architecture.md](docs/ui-architecture.md).

Fonts: Inter and Barlow Condensed (SIL Open Font License). Apple workout encoding: vendored [@bibixx/workoutkit](https://github.com/bibixx/workoutkit) (MIT).
