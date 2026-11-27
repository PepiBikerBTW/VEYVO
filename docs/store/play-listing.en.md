# Google Play: store listing (English, en-US)

Paste into Play Console: *Grow users › Store presence › Main store listing* (default language en-US; add cs-CZ from [play-listing.cs.md](play-listing.cs.md) as a translation). The `text` blocks are pasted exactly as they are; `node docs/store/count-chars.cjs` (and `npm test`) checks the lengths.

For the **first Google Play release** (`play` channel): no Strava, no GitHub updates, no Health Connect. When Health Connect run import arrives, update this description, Data safety and the Health apps declaration (see [declarations.md](declarations.md)).

## App name (max 30 characters)
<!-- field: name | max: 30 -->
```text
VEYVO: Running Journal & Plan
```

## Short description (max 80 characters)
<!-- field: short | max: 80 -->
```text
A running journal and training plan, no account. Send workouts to your watch.
```

## Full description (max 4000 characters)
<!-- field: full | max: 4000 -->
```text
VEYVO is a running journal and training plan. Log a run and VEYVO works out your pace from your own runs, shows how far you are from your goal and suggests the next session for the days you can run. Then send the workout to your watch. No account needed: everything stays on your phone.

Overview
• Today's suggestion: run or rest, and when your next session is
• Your next run with its distance and pace range
• A goal for 5 km, 10 km, a half marathon, a marathon or your own distance: your best time, the target and what is left
• Recovery in three taps: sleep, fatigue and muscle soreness. When fatigue or soreness is high, VEYVO suggests rest.

My plan
• A week built around the days you pick
• A session library: easy run, long run, 6 × 400 m, 5 × 1 km, 3 × 2 km at threshold pace and a 5 km test
• Paces based on your best 5 km run and your goal time

Progress
• A chart of the pace of every run with your goal line
• Weekly volume, personal bests and milestones
• A run log with notes worked out from your data, such as a new best or your longest run
• Right after you log a run you see its pace and any personal best

To your watch
Send a structured workout with intervals and target paces where you need it:
• Garmin, COROS, Suunto, Huawei and Amazfit watches through your intervals.icu account
• Apple Watch as a .workout file that you open on an iPhone
• Zwift and TrainingPeaks as a .zwo file
• a .fit file for Garmin watches connected to a computer by cable
• as text for Polar, Samsung, Pixel Watch and others

Before the run
A timeline for food and drink before you run, a fuel estimate for runs longer than 75 minutes and a checklist before you head out. General guidance for healthy adults with links to its sources (NSW Institute of Sport, Australian Institute of Sport, Cleveland Clinic).

Your data
• No account, no ads, no analytics, no tracking
• Your data stays on your phone and the app works offline
• An automatic daily backup on the phone, plus a backup file you can restore on another device
• The intervals.icu link is optional and uses your own API key
• Czech and English, dark and light theme

VEYVO is free.

VEYVO is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. Its training, recovery and nutrition tips are general guidance. Consult a healthcare professional before starting a training or nutrition program.

Garmin, Apple Watch, COROS, Suunto, Huawei, Amazfit, Polar, Samsung, Pixel Watch, Zwift, TrainingPeaks and intervals.icu are trademarks of their respective owners. VEYVO is not affiliated with or endorsed by them.
```

## Release notes, first release (max 500 characters)
Play Console: *Release › (track) › Create release › Release notes*, language `<en-US>`.
<!-- field: release-notes | max: 500 -->
```text
First release on Google Play. A run journal, a training plan built around the days you can run, progress from your own runs, workouts for your watch through intervals.icu or as a file, and tips before you run. In Czech and English, with no account and no ads.
```

## Category and contact details
| Play Console field | Value |
|---|---|
| App or game | App |
| Category | Health & Fitness |
| Tags (up to 5, picked from Google's list) | Running, Fitness tracking, Workout (or the closest ones offered) |
| Email (public) | pepik.kozisek@seznam.cz |
| Website | https://pepibikerbtw.github.io/VEYVO/ |
| Phone | leave empty (optional; not shown for a non-trader) |
| Privacy policy | https://pepibikerbtw.github.io/VEYVO/privacy/ |
| Price | Free. Google does not let an app published as free become paid later; paid extras later can only be in-app purchases (Google Play Billing), see [owner-checklist.md](owner-checklist.md). |

## Graphics (`docs/store/graphics/`)
| Field | File | Size |
|---|---|---|
| App icon | `play-icon-512.png` | 512 × 512, 32-bit PNG, fully opaque |
| Feature graphic | `play-feature-en.png` | 1024 × 500, 24-bit PNG |
| Phone screenshots (order 1–6) | `play-phone-en-1-overview.png` … `play-phone-en-6-result.png` | 1080 × 2400, 24-bit PNG |

The screenshots come from the real app (`play` build) with demo data: the developer's own nine runs from 27 Oct to 24 Nov 2026, with today set to 27 Nov 2026. `tests/visual/store-graphics.cjs` recreates them (see the script header). A YouTube video is optional; there is none yet.
