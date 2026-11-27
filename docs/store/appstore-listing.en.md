# App Store: metadata (English, U.S.)

Paste into App Store Connect: *Apps › VEYVO › App Store › (localization English (U.S.))*. English is the primary language; Czech is in [appstore-listing.cs.md](appstore-listing.cs.md). The `text` blocks are pasted exactly as they are; `node docs/store/count-chars.cjs` (and `npm test`) checks the lengths. App Privacy, age rating, export compliance and the App Review note are in [declarations.md](declarations.md).

Rules these texts follow: no mention of Android, Windows, Google Play or GitHub (guideline 2.3.10); watch and service names only as descriptive compatibility, never in the name, subtitle or keywords (2.3.7, 4.1); no medical claims (1.4.1); the Apple Health integration is named in the description (2.5.1).

> **Before you submit, check the iPhone build:** the description mentions importing runs from Apple Health (read-only), sending to intervals.icu and adding a workout to Apple Watch. If the uploaded build lacks one of these, delete that paragraph or line first; otherwise review can reject the app under guideline 2.3.1 (inaccurate metadata).

## Name (max 30 characters)
<!-- field: name | max: 30 -->
```text
VEYVO: Running Journal & Plan
```

## Subtitle (max 30 characters)
<!-- field: subtitle | max: 30 -->
```text
Plan, goal and watch workouts
```

## Promotional text (max 170 characters)
Can be changed at any time without a new version.
<!-- field: promo | max: 170 -->
```text
Log a run and VEYVO works out your pace, shows how far you are from your goal and suggests your next session. No account, no ads, your data stays on your iPhone.
```

## Description (max 4000 characters)
<!-- field: description | max: 4000 -->
```text
VEYVO is a running journal and training plan. Log a run and VEYVO works out your pace from your own runs, shows how far you are from your goal and suggests the next session for the days you can run. Then add the workout to your watch. No account needed: everything stays on your iPhone.

Overview
• Today's suggestion: run or rest, and when your next session is
• Your next run with its distance and pace range
• A goal for 5 km, 10 km, a half marathon, a marathon or your own distance: your best time, the target and what is left
• Recovery in three taps: sleep, fatigue and muscle soreness. When fatigue or soreness is high, VEYVO suggests rest.

Runs from Apple Health
If you allow it, VEYVO imports your runs from Apple Health. Access is read-only: VEYVO writes nothing to Apple Health, and the imported data stays on your iPhone. You can also log runs by hand.

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
• Apple Watch: add the workout to the Workout app (iOS 17 and watchOS 10 or later)
• Garmin, COROS, Suunto, Huawei and Amazfit watches through your intervals.icu account
• Zwift and TrainingPeaks as a .zwo file
• as text for other watches and apps

Before the run
A timeline for food and drink before you run, a fuel estimate for runs longer than 75 minutes and a checklist before you head out. General guidance for healthy adults with links to its sources (NSW Institute of Sport, Australian Institute of Sport, Cleveland Clinic).

Your data
• No account, no ads, no analytics, no tracking
• Your data stays on your iPhone and the app works offline
• A backup file you can restore on another device
• The intervals.icu link is optional and uses your own API key
• Czech and English, dark and light theme

VEYVO is free.

VEYVO is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. Its training, recovery and nutrition tips are general guidance. Consult a healthcare professional before starting a training or nutrition program.

Garmin, COROS, Suunto, Huawei, Amazfit, Zwift, TrainingPeaks and intervals.icu are trademarks of their respective owners. VEYVO is not affiliated with or endorsed by them.
```

## Keywords (max 100 bytes, commas without spaces)
They do not repeat words from the name and subtitle (the App Store indexes those already) and contain no third-party trademarks.
<!-- field: keywords | max: 100 | unit: bytes -->
```text
run,runner,pace,5k,10k,half marathon,marathon,intervals,tracker,training,recovery,race,log,fitness
```

## What's New (first version)
App Store Connect does not show this field for an app's first version; keep it for the next version or use it for TestFlight (*What to Test*).
<!-- field: whats-new | max: 4000 -->
```text
First release for iPhone. A run journal, a training plan built around the days you can run, progress from your own runs, workouts for Apple Watch and other watches, run import from Apple Health and tips before you run. In Czech and English, with no account and no ads.
```

## Other fields
| App Store Connect field | Value |
|---|---|
| Primary language | English (U.S.); Czech as an extra localization. Storefronts with neither language then show English. |
| Category | Health & Fitness; optional secondary category Sports |
| Support URL | https://pepibikerbtw.github.io/VEYVO/support/ |
| Marketing URL | https://pepibikerbtw.github.io/VEYVO/ |
| Privacy Policy URL | https://pepibikerbtw.github.io/VEYVO/privacy/ |
| Copyright | 2026 Josef Kožíšek |
| Price | Free (USD 0), all countries or at least the EU |
| Bundle ID / SKU | `com.veyvo.coach` / `veyvo-ios` |
| Age rating | as answered in [declarations.md](declarations.md); expected result 9+ |

## Screenshots (`docs/store/graphics/`, PNG without an alpha channel)
| Display size | Files (order 1–6) | Size |
|---|---|---|
| iPhone 6.9-inch (required set) | `ios-6.9-en-1-overview.png` … `ios-6.9-en-6-result.png` | 1320 × 2868 |
| iPhone 6.3-inch (extra set) | `ios-6.3-en-1-overview.png` … `ios-6.3-en-6-result.png` | 1206 × 2622 |

The screenshots come from the real app (`appstore` build) with demo data: the developer's own nine runs from 27 Oct to 24 Nov 2026, with today set to 27 Nov 2026. Once the iPhone build has its own platform adapter (file sharing, intervals.icu, Apple Health), render them again with `tests/visual/store-graphics.cjs --only ios69,ios63` (see the script header) so the Send to watch sheet shows the same options as the app on an iPhone.
