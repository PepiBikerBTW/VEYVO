# VEYVO for iOS: build and release on the Mac

The iOS app is the shared web core (`src/`) in a Capacitor 8 shell (`mobile/ios`, Swift Package Manager, no CocoaPods). The owner builds, signs and uploads it in Xcode on his own Mac. GitHub Actions only compiles it for the simulator without signing (`.github/workflows/ios-ci.yml`), so no Apple certificates or keys are stored anywhere in the repository or in CI.

Publisher (the legal name shown as the seller and in the copyright line): Josef Kožíšek. Public contact (App Review contact and TestFlight feedback email): pepik.kozisek@seznam.cz.

## Project facts

| Setting | Value | Where |
|---|---|---|
| Bundle ID | `com.veyvo.coach` (same as Android) | `project.pbxproj` `PRODUCT_BUNDLE_IDENTIFIER` |
| Display name | VEYVO | `Info.plist`, `en.lproj` / `cs.lproj` `InfoPlist.strings` |
| Minimum iOS | 15.0 (Capacitor 8 minimum, also Apple's April 2027 rule) | `IPHONEOS_DEPLOYMENT_TARGET` |
| Devices | iPhone only (`TARGETED_DEVICE_FAMILY = 1`), portrait only | `project.pbxproj`, `Info.plist` |
| Version | `MARKETING_VERSION` = root `package.json` version, `CURRENT_PROJECT_VERSION` = major·10000 + minor·100 + patch (0.4.0 → 400, same as the Android versionCode) | `mobile/scripts/ios-version.mjs` |
| Build channel | `appstore`: no self-updater, no APK links, no GitHub API calls, no Strava | `npm run sync:ios` → `sync-web.mjs --channel appstore` |
| Capabilities | HealthKit (read only), no background modes | `App/App.entitlements` |
| Native plugins | `VeyvoWorkoutKit` (Apple Watch via WorkoutKit, iOS 17+) and `VeyvoHealth` (Apple Health import, read only), registered by `VeyvoBridgeViewController` | `App/Veyvo*.swift`, see [Native features](#native-features) |
| Weak linking | `OTHER_LDFLAGS = -weak_framework WorkoutKit`, so iOS 15 and 16 still launch (CI checks it with `otool`) | `project.pbxproj` |
| Export compliance | `ITSAppUsesNonExemptEncryption = NO` (only the HTTPS built into iOS) | `Info.plist` |
| Privacy manifest | no tracking, no collected data; required-reason APIs: UserDefaults `CA92.1` (Preferences plugin), file timestamps `C617.1` (Filesystem plugin) | `App/PrivacyInfo.xcprivacy` |
| Icon / launch | 1024 × 1024 opaque app icon; launch screen is graphite `#0D0E11` with the icon at 120 pt | `Assets.xcassets`, `LaunchScreen.storyboard` |

Why iPhone only: an iPad app must support every orientation for multitasking, needs 13-inch screenshots and its own layout testing. VEYVO still runs on iPads in iPhone compatibility mode. Adding iPad later means `TARGETED_DEVICE_FAMILY = "1,2"`, all four orientations under `UISupportedInterfaceOrientations~ipad`, and iPad screenshots.

---

## Česky: postup na Macu

### Jednou na začátku

1. Nainstaluj **Xcode 26 nebo novější** z Mac App Storu (doporučeno Xcode 27: od dubna 2027 Apple přijímá jen buildy s iOS 27 SDK). Spusť ho jednou, potvrď licenci a v *Xcode › Settings › Components* stáhni platformu iOS.
2. Nainstaluj **Node.js 22 LTS** (nodejs.org nebo `brew install node@22`). Git přidá `xcode-select --install`.
3. Aktivuj **Apple Developer Program** (Individual, 99 USD ročně) a v Xcode se přihlas: *Xcode › Settings › Accounts › +*.
4. Naklonuj repozitář: `git clone https://github.com/PepiBikerBTW/VEYVO.git` (příště jen `git pull`).

### Každé vydání

1. `cd VEYVO/mobile && npm ci && npm run sync:ios`
   (zkopíruje web do iOS projektu s kanálem `appstore`, aktualizuje Swift balíčky a zapíše verzi z `package.json`).
2. `npm run open:ios` nebo otevři `mobile/ios/App/App.xcodeproj` (projekt se Swift Package Managerem nemá `.xcworkspace`). Xcode při prvním otevření stáhne balíčky Capacitoru.
3. Cíl **App › Signing & Capabilities**: zapni *Automatically manage signing*, jako **Team** vyber svůj tým, Bundle Identifier musí být `com.veyvo.coach`. Xcode sám zaregistruje App ID. Změna týmu zapíše `DEVELOPMENT_TEAM` do `project.pbxproj`; to není tajemství a může se commitnout.
4. Zkontroluj, že je v seznamu schopnost **HealthKit** (bere se z `App.entitlements`). Nezapínej *Clinical Health Records* ani *Background Delivery*.
5. Připoj iPhone kabelem, na telefonu zapni *Nastavení › Soukromí a zabezpečení › Režim pro vývojáře*, vyber iPhone jako cíl a spusť (⌘R). Projdi kontrolní seznam níže.
6. Pokud už tahle verze jednou nahraná byla, zvyš patch verzi v kořenovém `package.json` (doporučeno), nebo spusť `npm run ios:version -- --upload 2` (build 400.2).
7. Cíl *Any iOS Device (arm64)*, pak **Product › Archive**. V Organizeru dej *Validate App* a potom **Distribute App › App Store Connect › Upload**.
8. **TestFlight**: po zpracování (obvykle 15–30 minut) se přidej jako interního testera a nainstaluj build přes aplikaci TestFlight. Externí testeři potřebují Beta App Review, popis bety a e-mail pro zpětnou vazbu `pepik.kozisek@seznam.cz`.
9. **Odeslání ke schválení**: v App Store Connect vyplň screenshoty (6,9″ 1320 × 2868 a 6,3″ 1206 × 2622), popis cs + en, Support URL, Privacy Policy URL, copyright `2026 Josef Kožíšek`, App Privacy *Data Not Collected*, věkové hodnocení, kategorii Health & Fitness a cenu Zdarma. V *App Review Information* zaškrtni, že přihlášení není potřeba, kontakt `pepik.kozisek@seznam.cz`, a vlož poznámku pro App Review (níže, anglicky). Pak *Submit for Review*.

---

## English: steps on the Mac

### Once

1. Install **Xcode 26 or later** from the Mac App Store (Xcode 27 recommended: from April 2027 Apple only accepts builds made with the iOS 27 SDK). Open it once, accept the licence and download the iOS platform in *Xcode › Settings › Components*.
2. Install **Node.js 22 LTS** (nodejs.org or `brew install node@22`). `xcode-select --install` provides Git.
3. Enrol in the **Apple Developer Program** (Individual, USD 99 a year) and sign in to Xcode: *Xcode › Settings › Accounts › +*.
4. Clone the repository: `git clone https://github.com/PepiBikerBTW/VEYVO.git` (later just `git pull`).

### Every release

1. `cd VEYVO/mobile && npm ci && npm run sync:ios`
   (copies the web app with the `appstore` channel, updates the Swift packages and writes the version from `package.json`).
2. `npm run open:ios`, or open `mobile/ios/App/App.xcodeproj` (a Swift Package Manager project has no `.xcworkspace`). Xcode resolves the Capacitor packages the first time.
3. Target **App › Signing & Capabilities**: turn on *Automatically manage signing*, choose your **Team**, keep the bundle identifier `com.veyvo.coach`. Xcode registers the App ID. Choosing the team writes `DEVELOPMENT_TEAM` into `project.pbxproj`; it is not a secret and can be committed.
4. Check that the **HealthKit** capability is listed (it comes from `App.entitlements`). Do not enable *Clinical Health Records* or *Background Delivery*.
5. Connect the iPhone by cable, turn on *Settings › Privacy & Security › Developer Mode* on the phone, select it as the run destination and press Run (⌘R). Go through the device checklist below.
6. If this version was uploaded before, raise the patch version in the root `package.json` (preferred), or run `npm run ios:version -- --upload 2` (build 400.2).
7. Choose *Any iOS Device (arm64)*, then **Product › Archive**. In the Organizer use *Validate App*, then **Distribute App › App Store Connect › Upload**.
8. **TestFlight**: once processed (usually 15–30 minutes), add yourself as an internal tester and install the build with the TestFlight app. External testers need Beta App Review, a beta description and the feedback email `pepik.kozisek@seznam.cz`.
9. **Submit for review**: in App Store Connect add the screenshots (6.9-inch 1320 × 2868 and 6.3-inch 1206 × 2622), cs + en descriptions, Support URL, Privacy Policy URL, copyright `2026 Josef Kožíšek`, App Privacy *Data Not Collected*, the age rating questionnaire, category Health & Fitness and price Free. Under *App Review Information* mark that no sign-in is required, give the contact `pepik.kozisek@seznam.cz` and paste the App Review note below. Then *Submit for Review*.

---

## Device checklist / Kontrola na iPhonu

- Launch screen is graphite with the icon, no white flash before the app appears. / Úvodní obrazovka je grafitová s ikonou, bez bílého probliknutí.
- Home-screen icon is sharp and fills the mask. / Ikona na ploše je ostrá a vyplňuje masku.
- Status bar text is readable in the dark and the light theme. / Stavový řádek je čitelný v tmavém i světlém motivu.
- Czech and English switch works; the Health permission text appears in the phone's language. / Přepínání cs/en funguje; text žádosti o Zdraví je v jazyce telefonu.
- The keyboard does not cover inputs in the run dialog and settings (the outer web view does not scroll: `ios.scrollEnabled = false`). / Klávesnice nezakrývá pole v dialogu běhu a v nastavení.
- Apple Health import (*Více › Nastavení › Propojení › Apple Zdraví › Importovat běhy*) asks for permission once, imports the last 90 days of runs, and a manual run of the same day keeps its typed time but gains heart rate. Reopening the app imports new runs on its own. / Import ze Zdraví požádá o svolení, načte 90 dní běhů a ručně zapsaný běh si nechá svůj čas, jen dostane tep. Po znovuotevření aplikace se nové běhy načtou samy.
- *Do hodinek › Apple Watch › Přidat do Apple Watch* shows Apple's workout preview; after adding, the workout is in the Workout app on the watch with its steps and pace or heart-rate alerts (iOS 17+, paired watch). *Naplánovat na …* puts it into the Workout app's scheduled list for that day (asks for permission once). / Náhled tréninku od Applu se otevře a trénink dorazí do hodinek i s kroky a hlídáním tempa nebo tepu; naplánovaný trénink se ukáže v Cvičení na hodinkách.
- On an iOS 16 simulator or device the app launches and the Apple Watch card offers the `.workout` file instead. / Na iOS 16 se aplikace spustí a karta Apple Watch nabídne soubor `.workout`.
- Export (.fit, .zwo) and backup open the share sheet. / Export a záloha otevřou nabídku sdílení.
- No update prompt, APK link, Windows/Android download or Strava screen anywhere (App Store rules 2.3.10 and 2.5.2). / Nikde není nabídka aktualizace, odkaz na APK, Windows/Android ani Strava.

## App Review note (paste into App Store Connect)

The note to paste is the `app-review-notes` field in [`store/declarations.md`](store/declarations.md) (section App Store). It is the only copy: `npm test` checks it for the 4000-byte limit and for words App Review rejects (other platforms, Strava). It covers the Czech start language and how to switch to English, Apple Health (*More › Settings › Connections › Apple Health › Import runs*) and Apple Watch (*Send to watch › Add to Apple Watch / Schedule for …*). Check that the menu labels still match the build before pasting.

Text pro App Review je pole `app-review-notes` v [`store/declarations.md`](store/declarations.md) (jediná kopie, hlídaná testy). Před vložením ověř, že názvy menu odpovídají buildu.

## For developers / Pro vývojáře

- **Version**: `npm run sync:ios` runs `scripts/ios-version.mjs`, which rewrites `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `project.pbxproj` from the root `package.json`. Commit the changed `project.pbxproj` with each version bump.
- **Channel**: `scripts/sync-web.mjs --channel appstore` sets `channel: 'appstore'` in `www/src/build-info.js` and removes `// #if-channel github` … `// #end-channel` blocks from the copy in `www/`. It stops with an error if `src/platform.js` does not know the channel yet.
- **Native code**: the root view controller is `VeyvoBridgeViewController` (`ios/App/App/VeyvoBridgeViewController.swift`), created in `SceneDelegate.swift` (Capacitor 8.5+ UIScene template) and also named in `Main.storyboard`. It registers the app's own plugins in `capacitorDidLoad()` with `bridge?.registerPluginInstance(...)`. A new Swift file needs a `PBXFileReference`, a `PBXBuildFile`, an entry in the `App` group and in the Sources phase of `project.pbxproj` (Xcode does this when you add the file through *File › Add Files*). `capacitor.config.json`'s `packageClassList` is regenerated by `cap sync` and only lists npm plugins, so do not edit it by hand.
- **Privacy manifest**: re-check `App/PrivacyInfo.xcprivacy` whenever a plugin is added; HealthKit and WorkoutKit need no required-reason entries. If Apple Health import is not part of a release, remove the HealthKit entitlement and `NSHealthShareUsageDescription`, because App Review rejects unused HealthKit access.
- **Never commit**: `ios/App/App/public`, `DerivedData`, `xcuserdata`, archives, `.ipa`, certificates, provisioning profiles or App Store Connect keys (`mobile/ios/.gitignore`). Do commit `App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` once Xcode creates it.
- **Icons**: the 1024 × 1024 icon (cropped to the rounded square of `assets/veyvo-icon.png`, flattened onto `#0D0E11`, saved as RGB without an alpha channel) and the launch icon were rendered with Chromium canvas. Regenerate them if `assets/veyvo-icon.png` changes; Apple rejects app icons that have an alpha channel.

## Native features

Two local Capacitor plugins in Swift, written against Apple's documented APIs (declarations checked against developer.apple.com on 2026-11-27). They have not been compiled yet: the first compile is the iOS CI job or the owner's Mac. `tests/mobile-sync.test.js` checks the JS <-> Swift contract (plugin and method names, request fields, error codes, project entries) and `tests/ui-ios.cjs` drives the iPhone UI against recording fakes of both plugins.

### `VeyvoWorkoutKit` (Apple Watch, `VeyvoWorkoutKitPlugin.swift`)

JS: `VeyvoPlatform.watch` (`src/platform.js`), used by the workout sheet (`src/ui/workout-sheet.js`).

| JS (`VeyvoPlatform.watch`) | Plugin call | Answer |
|---|---|---|
| `supported` (sync), `check()` | `isSupported()` | `{ supported, preview, schedule, maxScheduled? , reason? }`; `supported` is false below iOS 17 |
| `preview(workout, { indoor, locale })` | `preview({ workoutJson, indoor, planId })` | `{ shown: true }` after Apple's preview sheet closes (it does not say whether the workout was added) |
| `schedule(workout, 'YYYY-MM-DD', { indoor, locale })` | `schedule({ workoutJson, indoor, planId, date, hour: 7 })` | `{ scheduled: true, id, date, replaced }` |
| `listScheduled()` | `listScheduled()` | `{ workouts: [{ id, date, time, name, complete }] }` |
| `clearScheduled()` | `clearScheduled()` | `{ removed }` |

`workoutJson` is the VEYVO workout model (`docs/architecture.md`) as a JSON string from `VeyvoPlatform.util.watchPayload`: `{ id, name, date?, steps }`, with `label`s added for steps Apple cannot name itself (`rest`, a warm-up or cool-down in the middle). `planId` is a deterministic UUID of workout id + day, so scheduling the same workout again replaces it. Mapping (the same as the `.workout` file of `src/core/export/apple.js`): a first `warmup` step becomes `CustomWorkout.warmup`, a last `cooldown` step `cooldown`, every other item an `IntervalBlock` (a repeat with its count, a single step with 1 iteration); `active` is `.work`, everything else `.recovery`; time, distance and open durations become `WorkoutGoal.time / .distance / .open`; a pace range becomes `SpeedRangeAlert` (current speed, `1000 / slowSecPerKm` up to `1000 / fastSecPerKm` m/s, so the faster pace is the higher speed) and a heart-rate range `HeartRateRangeAlert` (counts per minute). Every goal and alert is checked with `CustomWorkout.supportsGoal` / `supportsAlert`. Scheduling asks for WorkoutScheduler permission, removes VEYVO's plan for the same day first, removes past plans only when `maxAllowedScheduledWorkoutCount` is reached (going over it can wipe the whole list) and schedules at 07:00 local time (for today after 07:00: the next minute).

Error codes: `watch_unsupported`, `watch_invalid`, `watch_step_unsupported`, `watch_busy`, `watch_denied`, `watch_limit`, `watch_date`, `watch_failed` (texts: `platform.error.<code>`).

### `VeyvoHealth` (Apple Health, `VeyvoHealthPlugin.swift`)

JS: `VeyvoPlatform.health`, used by Settings › Propojení › Apple Zdraví (`src/ui/settings.js`), stored with `VeyvoStore.importHealthRuns`.

| JS (`VeyvoPlatform.health`) | Plugin call | Answer |
|---|---|---|
| `isAvailable()` | `isAvailable()` | `{ available }` (`HKHealthStore.isHealthDataAvailable()`) |
| `requestAuthorization()` | `requestAuthorization()` | `{ requested }`; read only: workouts, `distanceWalkingRunning`, `heartRate` |
| `importRuns({ since })` | `importRuns({ since: ISO, limit: 1000 })` | `{ runs: [{ healthId, startDate, date, startTime, distanceKm?, movingSeconds, averageHeartrate?, maxHeartrate?, sourceName, indoor? }] }` |

Only `HKWorkoutActivityType.running` workouts that started at or after `since` are read. `date` / `startTime` are local, `healthId` is `HKWorkout.uuid.uuidString`. The store skips rows without a distance, matches runs by `healthId` and the duplicate rules (a manual run keeps its typed time and gains heart rate), keeps deleted runs deleted (`ignoredHealthIds`) and reads 90 days on the first import, then from 7 days before the last one. Error codes: `health_unavailable`, `health_failed`.

## NOTES for the first Xcode build / Poznámky k prvnímu buildu v Xcode

Nothing below could be compiled or run on Linux. Each point says what to check; most are one-line fixes if Xcode disagrees.

1. **`workoutPreview` and weak linking.** `View.workoutPreview(_:isPresented:)` is declared in the cross-import overlay `_WorkoutKit_SwiftUI` and only appears when `SwiftUI` and `WorkoutKit` are imported in the same file (they are). WorkoutKit exists from iOS 17, the app targets iOS 15: `-weak_framework WorkoutKit` is set and every WorkoutKit symbol is `@available(iOS 17.0, *)`, so the linker should weak-link the overlay as well. The CI step "WorkoutKit is weak-linked" fails on a strong link. Also run the app once on an iOS 16 simulator. If the overlay is linked strongly, add `-weak_framework _WorkoutKit_SwiftUI` to `OTHER_LDFLAGS` too.
2. **Preview host.** The preview is a SwiftUI sheet hosted in a clear `UIHostingController` presented `.overFullScreen` over the web view; `isPresented` is set one run-loop turn after `onAppear`. When it turns `false` (or the empty layer is tapped), the session dismisses from the host's *presenter*, which removes the host and Apple's sheet together; it waits up to 2 s for a running transition and always settles the JS call, and a presentation that UIKit refuses rejects with `watch_failed` instead of leaving the button busy. (Fixed in review: `host.dismiss` alone only closed the sheet when Apple's own close button was used, leaving an invisible layer that blocked every tap.) Check on a device: close the preview with Apple's close button, by swiping it down, and after *Add*; after each VEYVO must react to taps at once. A second tap while it is open answers `watch_busy`.
3. **`WorkoutPlan.id`.** Resolved in review: `WorkoutPlan` conforms to `Identifiable` (and `Hashable`, `Sendable`) and its initializer is `init(_ workout: WorkoutPlan.Workout, id: UUID = UUID())`, so `plan.id` is a `UUID`; `"\(plan.id)"` is its upper-case `uuidString`.
4. **Schedule date.** `DateComponents` with `.calendar, .timeZone, .year, .month, .day, .hour, .minute` from `Calendar.autoupdatingCurrent`. Apple's WWDC23 sample used `dateComponents(in: .autoupdatingCurrent, from:)`; switch to that if a scheduled workout does not show up on the watch. Scheduled workouts have known sync problems on iOS 18.2 and 26.0.1 (Apple forums); the preview path is unaffected. A workout scheduled for today after 07:00 is scheduled for the next minute instead (a start time in the past may never reach the watch); check once that such a workout appears on the watch.
5. **Scheduler permission.** `WorkoutScheduler.requestAuthorization()` shows its own prompt. Where the user turns it back on after "Don't Allow" is not documented; `platform.error.watch_denied` says "in the iPhone Settings for VEYVO". Correct the text if it lives elsewhere.
6. **`WorkoutScheduler.isSupported`** may be false on an iPhone without a paired watch; the sheet then hides "Naplánovat na …" and keeps "Přidat do Apple Watch". `maxAllowedScheduledWorkoutCount` has no documented value (15 at WWDC23, 50 measured on iOS 17); the code only reads it.
7. **Step names.** `WorkoutStep(goal:alert:displayName:)` is iOS 18+. On iOS 17 steps show Apple's names (a VEYVO rest step shows as recovery).
8. **Supported goals and alerts.** If `CustomWorkout.supportsGoal(.open, …)` or `supportsAlert` answers false for running, the plugin rejects with `watch_step_unsupported` instead of crashing. Try a library session with an open "do stisku Lap" cool-down and one with heart-rate targets.
9. **HealthKit statistics.** Distance and heart rate come from `HKWorkout.statistics(for:)` (iOS 16+), then `totalDistance` (deprecated from iOS 27.3; a warning only with that SDK), then an `HKStatisticsQuery` over the workout's time (all sources, so a watch worn at the same time counts). Compare one imported run with the Fitness app. `movingSeconds` is `HKWorkout.duration`, which should exclude pauses for Apple Watch workouts; other apps may write the elapsed time. Check one paused run.
10. **`HKQuery.predicateForWorkouts(with:)`** has no availability entry in today's docs but is not deprecated; `predicateForWorkoutActivities(workoutActivityType:)` (iOS 16) is the alternative.
11. **Denied Health access** cannot be detected (iOS returns no workouts). The card then says "V Apple Zdraví VEYVO žádné běhy nenašlo…" and points to the Health app's profile › apps list; check that wording against the real Czech and English menu names.
12. **Swift concurrency.** The App target is in Swift 5 mode (`SWIFT_VERSION = 5.0`), with the default minimal concurrency checking and no default actor isolation. Keep it that way: Capacitor 8.6.3 has no `Sendable` or `@MainActor` annotations (`CAPPlugin` and `CAPPluginCall` are plain Objective-C classes), so Swift 6 mode turns every `call` captured by `Task { }` or `DispatchQueue.main.async` into an error, in VEYVO's plugins and in Capacitor's own. If Xcode offers *Update to recommended settings*, accepting it is fine, but leave *Swift Language Version* at 5 and *Default Actor Isolation* at `nonisolated`. UI work runs on the main queue (`DispatchQueue.main.async`, the same pattern as `@capacitor/share`); no captured `var` is mutated in a `@Sendable` closure. Expected warnings: `@UIApplicationMain` is deprecated (Capacitor's template `AppDelegate.swift`; `@main` is the drop-in replacement) and possibly `HKWorkout.totalDistance`.
13. **Plugin registration.** `registerPluginInstance` in `capacitorDidLoad()` injects `Capacitor.Plugins.VeyvoWorkoutKit` and `Capacitor.Plugins.VeyvoHealth` before the page loads. In Safari's Web Inspector (Develop › iPhone › VEYVO) `Object.keys(Capacitor.Plugins)` must list both, and `VeyvoPlatform.kind` must be `'ios'`.
14. **App language.** The web UI starts in Czech (`state.language`), independent of the iPhone language; the App Review note tells the reviewer how to switch. Defaulting to the device language on first launch is a separate decision (`src/ui/app.js`).
15. **API review (2026-11-27).** Every WorkoutKit and HealthKit call was checked against Apple's declarations: `CustomWorkout(activity:location:displayName:warmup:blocks:cooldown:)`, `supportsGoal` / `supportsAlert`, `IntervalBlock(steps:iterations:)`, `IntervalStep(_:step:)`, `WorkoutStep(goal:alert:)` and the iOS 18 `displayName:` variant, `WorkoutGoal.time(_, .seconds)` / `.distance(_, .meters)` / `.open`, `SpeedRangeAlert(target:metric:)`, `HeartRateRangeAlert(target:)` with `WorkoutAlertMetric.countPerMinute` (a `UnitFrequency`), `WorkoutScheduler.shared`, `isSupported`, `maxAllowedScheduledWorkoutCount` (both static), `authorizationState` and `scheduledWorkouts` (`get async`, awaited), `requestAuthorization()`, `schedule(_:at:)`, `remove(_:at:)`, `removeAllWorkouts()` (all `async`), `ScheduledWorkoutPlan.plan / date / complete`, `View.workoutPreview(_:isPresented:)` (iOS 17), and the HealthKit query, statistics and source APIs. Capacitor 8.6.3: `CAPBridgedPlugin` (`identifier`, `jsName`, `pluginMethods` with `CAPPluginMethod(name:returnType:)`), `@objc func x(_ call: CAPPluginCall)`, `call.reject(message, code, error)`, `CAPBridgeProtocol.registerPluginInstance` and `capacitorDidLoad()` (called in `loadView`, before the page loads) all match the installed sources. `project.pbxproj`: 51 unique ids, no dangling reference, all five Swift files in a file reference, a build file, the App group and the Sources phase. Main.storyboard: `customClass="VeyvoBridgeViewController" customModule="App" customModuleProvider="target"`.
16. **`NSHealthUpdateUsageDescription`.** Apple requires it only for apps that write to Health, so it is left out (a test enforces that). Some developers report an upload error ITMS-90683 naming this key for read-only apps. If the upload is refused for it, add the key to `Info.plist` and both `InfoPlist.strings` files with en "VEYVO never saves anything to Apple Health. It only reads your running workouts." / cs "VEYVO do aplikace Zdraví nic neukládá, jen z ní čte tvoje běžecké tréninky.", and drop the `NSHealthUpdateUsageDescription` assertion in `tests/mobile-sync.test.js`.
17. **Scene storyboard.** `Info.plist` keeps `UISceneStoryboardFile = Main` and `UIMainStoryboardFile = Main`, as Capacitor's 8.5 template and update guide do, while `SceneDelegate` creates the window with `VeyvoBridgeViewController()` itself. If Safari's Web Inspector ever lists two VEYVO pages (two bridges), remove both storyboard keys from `Info.plist`: the scene delegate does not need them.

