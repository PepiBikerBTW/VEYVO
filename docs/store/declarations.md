# Store declarations: drafted answers

Drafted answers for the forms in Google Play Console (*Policy and programs › App content*) and App Store Connect, for **VEYVO 0.4.x, the first store release**. They describe what the store builds actually do (see [architecture.md › Build channels](../architecture.md#build-channels)):

- **Google Play build (`play`):** permission INTERNET only. The only network traffic is the optional intervals.icu workout push (`POST https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true`) and the key check (`GET /api/v1/athlete/0`, which reads the account name), both started by the user with the user's own API key. No GitHub update check, no Strava, no Health Connect, no ads, analytics or crash-reporting SDKs. Android Auto Backup is on (`allowBackup="true"`) for app data, but the Capacitor Preferences file that holds the intervals.icu API key (`CapacitorStorage.xml`) is excluded from cloud backup (`res/xml/data_extraction_rules.xml`, `res/xml/backup_rules.xml`).
- **App Store build (`appstore`):** the same, plus read-only Apple Health (HealthKit) import of running workouts (date, distance, duration, heart rate) that stays on the iPhone, and the Apple Watch hand-off through WorkoutKit (the workout goes to Apple's Workout app on the same iPhone). `PrivacyInfo.xcprivacy` declares no tracking and no collected data types.

The developer runs no server and receives nothing from the app. Re-check every answer when a version adds a data flow: Health Connect on Android, Strava in a store build, crash reporting, purchases or anything sent to a server the developer runs. The privacy policy (https://pepibikerbtw.github.io/VEYVO/privacy/) must change first, before that version ships.

Where a form asks for a contact email, use the public contact email from the store listing ([play-listing.en.md](play-listing.en.md)) or the developer account email.

---

## Google Play

### Privacy policy
`https://pepibikerbtw.github.io/VEYVO/privacy/` (cs + en on one page). The app links it in Settings › About.

### Ads
**No, my app does not contain ads.** No ad SDK, no house ads, no sponsored content.

### Advertising ID
**No.** The app does not use the advertising ID and the manifest has no `com.google.android.gms.permission.AD_ID`.

### App access
**Recommended: "All functionality in my app is available without any access restrictions."** VEYVO has no login. The intervals.icu push is an optional link to a third-party service, used with the user's own account, like sharing to a cloud drive.

If a reviewer flags intervals.icu anyway, switch to "All or some functionality is restricted", add one instruction named *intervals.icu (optional)*, leave username and password empty and paste:

```text
VEYVO has no account or login; every feature works offline without credentials. The only optional part is sending a workout to intervals.icu, a third-party service: it needs the user's own free intervals.icu account and its API key (intervals.icu › Settings › Developer Settings), pasted in VEYVO › Settings › Connections. The developer has no account to share. Every other export (files, text) works without it.
```

### Content rating (IARC questionnaire)
Email: the developer account email (IARC sends the certificate there).

| Question | Answer |
|---|---|
| Category | **All Other App Types** (not a game, not social, not news/education, not a store or aggregator) |
| Violence, blood, fear or horror | No |
| Sexuality, nudity, suggestive content | No |
| Profanity or crude humour | No |
| Alcohol, tobacco or drugs (references or use) | No. Pre-run food and drink tips mention ordinary food, sports drinks and gels only. |
| Gambling, simulated gambling, contests, loot boxes | No |
| Hate speech or discrimination | No |
| Users can interact or exchange content with each other (chat, posts, images, voice) | No |
| Shares the user's current location with other users | No |
| Users can buy digital goods | No |
| Unrestricted internet access (a web browser or search) | No. Source links and the privacy policy open as fixed pages in the system browser. |
| NFTs or blockchain | No |

Expected result: PEGI 3, USK 0, ESRB Everyone, IARC 3+. Retake the questionnaire before adding sharing between users, a web browser or purchases.

### Target audience and content
| Question | Answer |
|---|---|
| Target age groups | **18 and over** only |
| Could the store listing unintentionally appeal to children? | No (adult running training, graphite design, no characters or games) |
| Restrict minors (Play's optional age signal) | Optional; it fits the 18+ statement in the privacy policy |

No group under 13 is selected, so the Families policy does not apply.

### News app, COVID-19 tracing, government app, financial features
News app: **No**. COVID-19 contact tracing or status: **No**. Government app: **No**. Financial features: **My app doesn't provide any financial features**.

### Health apps declaration
| Item | Answer |
|---|---|
| Health and fitness: **Activity and fitness** | Yes: run journal, effort 1–10, training plan and workouts, recovery check-in (sleep hours, fatigue, soreness) as training input |
| Health and fitness: **Nutrition and weight management** | Yes: the "Before the run" food and drink guide, fuel estimate for runs over 75 minutes, pre-run checklist (no weight or calorie tracking) |
| Period tracking, Sleep management, Stress management | No. Sleep hours are one input of the recovery check-in, not a sleep feature. |
| Medical (diagnosis, treatment, clinical decision support, medication), medical device, health research, human subjects research | **No** |
| Health Connect | **Not used** in this release |

The description of both listings contains the required notice ("not a medical device and does not diagnose, treat, cure, or prevent any medical condition" plus the advice to consult a healthcare professional), and the app shows it on the first onboarding step and in Settings › About.

When Health Connect run import ships (later version): raise `minSdk` to 26, add the privacy rationale activity, fill the separate Health Connect declaration with a reason for each data type (exercise sessions, distance, heart rate), add "Health info" to Data safety if heart rate is read, and update this file and the privacy policy first.

### Data safety
Google's definitions: data is *collected* when it is transmitted off the device; data processed only on the device is not. Transfers to a destination the user picks in a specific user-initiated action, where the user expects it, are not *sharing*. The FAQ also says an app does not need to declare collection when the user uploads data straight to their own cloud account.

Two defensible readings of the one off-device flow, the user-initiated workout push to the user's own intervals.icu account:

**A. Conservative (recommended; it cannot be called under-declared):**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only; the store build may only reach `https://intervals.icu`) |
| Which of the following methods of account creation does your app support? | **My app does not allow users to create an account** |
| Do you provide a way for users to request that their data is deleted? | **Yes.** Users delete runs or all data in the app (Settings › Data and backups › Delete all data) and workouts they sent in their intervals.icu account; uninstalling deletes everything. The developer holds no copy. |
| Data types | **Health and fitness › Fitness info** only |
| Fitness info: collected / shared | Collected: **Yes**. Shared: **No** (user-initiated transfer to the user's own account) |
| Processed ephemerally? | **No** (the workout stays in the user's intervals.icu calendar) |
| Required or optional? | **Optional: users can choose whether this data is collected** (only when they paste their own API key and press Send) |
| Purposes | **App functionality** only |
| Independent security review, UPI badge | No / not applicable |

Not declared, with the reason: run history, recovery, profile, nutrition notes and backups stay on the device (not collected); share-sheet exports (.fit, .workout, .zwo, text, backup .json) are on-device hand-offs to an app the user picks; the intervals.icu API key is a credential for the user's own account, not one of Play's data types, and only goes to intervals.icu; Android Auto Backup copies app data (without the API key) into the user's own Google account backup, which the developer cannot access.

**B. Minimal (also defensible):** "No data collected or shared", relying on the own-account upload FAQ, because nothing ever reaches the developer. Choose A unless Google's review says otherwise: a reviewer can see the network call to intervals.icu, and over-declaring an optional, user-started flow costs nothing.

Keep in sync: the privacy policy section 3, the listing line "The intervals.icu link is optional and uses your own API key", and this answer.

### Production access application (after the closed test)
Personal accounts created after 13 Nov 2023 apply in *Dashboard › Apply for production* after **at least 12 testers stayed opted in for 14 consecutive days**. Draft answers; replace every `{{…}}` with what really happened (Google checks them against the test's statistics):

| Question | Draft answer |
|---|---|
| How did you recruit users for your closed test? | Friends and running club members who run regularly, invited personally through a Google Group and a Czech/English invitation with instructions. |
| How easy was it to recruit testers? | Pick honestly (e.g. "Neither easy nor difficult"). |
| Describe the engagement you received from testers | {{TESTER_COUNT}} testers stayed opted in for the whole 14 days. They logged their own runs, used the recovery check-in, booked library sessions in the plan, exported workouts to their watches (Garmin via intervals.icu, .fit and .zwo files, text) and switched between Czech and English. |
| Summarise the feedback and how you collected it | Feedback came by email replies to the invitation and Google Play private feedback. Main points: {{FEEDBACK_SUMMARY}}. |
| Who is the intended audience? | Adult recreational runners, mainly in Czechia, who want a simple running journal and a plan towards a goal such as 5 km under 20 minutes, without an account. |
| How does your app provide value? | It turns the runner's own logged runs into a next-run suggestion, paces for structured workouts, progress charts and a goal gap, and sends the workouts to the runner's watch. Everything works offline and stays on the phone. |
| Expected installs in the first year | The lowest bracket offered (0–10K). |
| What changes did you make based on the closed test? | {{CHANGES_FROM_TEST}} (each fix shipped as a new closed-test release with a higher versionCode). |
| How did you decide the app is ready for production? | Testers used every main feature for 14 days without blocking problems, the reported issues were fixed and re-tested, the pre-launch report shows no crashes, and the app passes our unit and UI test suites. |

---

## Apple App Store

### App Privacy ("nutrition label")
**Recommended answer: "No, we do not collect data from this app" (Data Not Collected).**

Reasoning, using Apple's definitions: *collect* means transmitting data off the device in a way that lets **you (the developer) or your third-party partners** access it longer than needed to serve the request in real time. *Third-party partners* are analytics tools, ad networks, SDKs and other vendors whose code is in the app.
- Runs, recovery, profile, plan, nutrition notes and anything imported from Apple Health stay on the iPhone. The developer has no server and no access.
- Adding a workout to Apple Watch hands it to Apple's Workout app on the same iPhone (WorkoutKit); Apple syncs it to the watch. That is the operating system, not a partner of the developer.
- The only off-device transfer is the optional workout push to intervals.icu: the user pastes their own key and presses Send, and the planned workout (date, name, steps, target paces) goes straight from the iPhone into the user's own intervals.icu account. intervals.icu is a service the user signs up to, not a vendor of the developer, and there is no intervals.icu code in the app. No Apple Health data is ever sent there.
- `PrivacyInfo.xcprivacy` agrees: `NSPrivacyTracking` false, no tracking domains, no collected data types.

**Alternative (more conservative):** declare **Health & Fitness › Fitness**, purpose **App Functionality**, **not linked to the user's identity** (the developer has no accounts or identifiers), **not used for tracking**. Then add the same data type to `NSPrivacyCollectedDataTypes` in `PrivacyInfo.xcprivacy` so the label and the manifest match. Choose this only if App Review asks; the label is shown publicly and "Data Not Collected" is the accurate description of what reaches the developer.

Revisit the label before adding crash reporting, analytics, a token proxy or any server the developer runs.

### Age rating questionnaire
| Section | Question | Answer |
|---|---|---|
| In-app controls | Parental controls | No |
| | Age assurance | No |
| Capabilities | Unrestricted web access | No (fixed links open in the system browser) |
| | User-generated content shared with others | No |
| | Messaging or chat | No |
| | Advertising | No |
| | Social media features | No |
| | Shared location | No |
| Mature themes | Profanity or crude humour; horror or fear; mature or suggestive themes; alcohol, tobacco or drug use or references | None |
| | Sexual content or nudity; graphic sexual content | None |
| | Cartoon, realistic, prolonged or graphic violence; guns or weapons | None |
| Medical and wellness | **Health or wellness topics** | **Yes** (training suggestions, recovery check-in, pre-run food and drink tips) |
| | Medical or treatment information | None |
| Gambling and contests | Simulated gambling; contests; real-money gambling; loot boxes | None / No |
| Other | Dating and relationships | No |
| Made for Kids | | No |

Expected result: **9+** (driven by "Health or wellness topics"). The 18+ target in the privacy policy is about the audience the app is written for; it is not an App Store rating and needs no override.

### Export compliance
`Info.plist` sets `ITSAppUsesNonExemptEncryption` to `NO`, so App Store Connect does not ask. If it ever asks: the app uses only the encryption built into iOS (HTTPS through the system networking stack and WKWebView) and contains no encryption library of its own: **"None of the algorithms mentioned above"** / exempt, no documentation, no French declaration. Re-check before adding encrypted backups or any crypto library.

### Content rights
"Does your app contain, show, or access third-party content?" **No.** Workout files are generated by VEYVO; intervals.icu receives the user's own workouts; watch and service names appear only as text.

### App Review information
- Sign-in required: **No** (no demo account needed).
- Contact: name, phone in `+420 …` format and email go into App Store Connect *App Review Information* (not into the notes).
- Notes (max 4000 bytes), English:

> Check the menu paths in the note against the uploaded build before pasting (Apple Health and Apple Watch steps depend on the iPhone platform work).

<!-- field: app-review-notes | max: 4000 | unit: bytes -->
```text
VEYVO is a local-first running journal and training planner. There is no account and no sign-in: every feature works offline, and all data stays on the device. There are no ads, no in-app purchases, no analytics and no tracking.

Language: the app starts in Czech. To review in English, tap "Více" (More, bottom right), then "Jazyk" (Language) and choose English.

How to try it (about 3 minutes):
1. On first launch, the welcome guide asks for an optional name, a goal (for example 5 km under 20:00) and the days you can run; the defaults can be accepted. It also shows the health notice: VEYVO is not a medical device.
2. Tap "+ Log" (tab bar) and log a run, for example 5 km in 25:00 with effort 6. The result view shows the pace, any personal best and the next suggested run.
3. Overview, Plan and Progress now show the next run, the week, pace and volume charts and records, all computed on the device from the runs you log.
4. Apple Watch (WorkoutKit, iOS 17 or later): on Overview tap "Send to watch" on the next-run card (or in Plan on any session). Apple Watch is preselected. "Add to Apple Watch" opens Apple's workout preview, from which the structured workout (warm-up, intervals with pace or heart-rate alerts, cool-down) is added to the Workout app on a paired Apple Watch. "Schedule for <date>" adds it to the Workout app's scheduled workouts for that day after a permission prompt. On older iOS the workout is offered as a file through the share sheet. Other brands get a .fit or .zwo file, text, or the optional intervals.icu link.
5. Apple Health (HealthKit, read only): tap More > Settings > Connections > Apple Health > Import runs. iOS shows the Health permission sheet (read: workouts, walking + running distance, heart rate). VEYVO imports running workouts from the last 90 days (date, start time, distance, duration, average and maximum heart rate) into the run log on this iPhone; afterwards new runs are imported when the app opens. Nothing is written to Health, Health data never leaves the device and is never used for advertising. If Health has no running workouts, VEYVO says so and manual entry keeps working.
6. More > Settings > About shows the privacy policy link and the health notice. Settings > Data and backups exports and restores a backup file and deletes all data.

Optional third-party link: intervals.icu (sending workouts to the user's own calendar there) needs the user's own free intervals.icu account and API key, so it cannot be tested without one. It is not required for any other feature; you can skip it.

Native and offline: all HTML, CSS and JavaScript ship inside the app binary (Capacitor); the app downloads no code and loads no remote web content. It uses HealthKit (read-only), the system share sheet and Files for exports, and works in airplane mode.

Privacy: App Privacy is "Data Not Collected". The developer runs no server. Privacy policy: https://pepibikerbtw.github.io/VEYVO/privacy/
```

### TestFlight (external testers, optional)
Beta App Description: reuse the promotional text from [appstore-listing.en.md](appstore-listing.en.md). Feedback email: the public contact email. *What to Test*: the "What's New" text there, plus "please log a few runs, try Send to watch and switch the language in Settings".
