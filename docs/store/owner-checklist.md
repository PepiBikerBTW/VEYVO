# Store launch: owner checklist

The steps only the owner can do, in order, for Google Play and the Apple App Store. Status: 2026-11-27. Decisions so far: publisher **Josef Kožíšek** (individual, Czech Republic); **free at launch with no in-app purchases and no ads**; **EU non-trader** in both stores; the iPhone app is built and uploaded **on your own Mac with Xcode** ([ios-release.md](../ios-release.md)); run import comes from **Apple Health on iPhone now** and **Health Connect on Android in a later version**, not in the first Play release.

Google Play is the critical path because of its 14-day closed test. Run both stores in parallel and start Play first. A realistic first public Play release is mid-January 2027 (the test runs over Christmas); the App Store can be earlier if review accepts the app the first time.

Texts to paste are in this folder: [play-listing.cs.md](play-listing.cs.md), [play-listing.en.md](play-listing.en.md), [appstore-listing.cs.md](appstore-listing.cs.md), [appstore-listing.en.md](appstore-listing.en.md), [declarations.md](declarations.md), [tester-invite.md](tester-invite.md). Graphics are in [graphics/](graphics/).

---

## 1. Before the accounts

- [ ] **Trader status: declare "non-trader" in both stores.** Free, no purchases, no ads, no donations and not run through a business (no IČO for software work) points to non-trader. This is your own legal self-assessment: a false non-trader declaration can get the account suspended. Consequences for launching paid extras later are in [section 8](#8-later-paid-extras-what-changes-when-you-start-charging).
- [ ] **Accept what becomes public.** Google shows your legal name, country and the developer email on the listing. Apple shows your legal name as the seller. With non-trader status neither shows your address or phone.
- [ ] Use the public contact email from the store listings for both developer accounts' public contact, the support page and App Review.

## 2. Google Play Console account (US$25 once, about 3 business days)

- [ ] Create a **personal** account at play.google.com/console with your own Google account. Pay with your own credit or debit card (no prepaid cards).
- [ ] Payments profile with your legal name and address, then identity verification with an ID card or passport.
- [ ] Verify the contact email and phone. Set the **developer name** (e.g. "VEYVO" or your name) and the public developer email.
- [ ] **Trader status: "I'm not a trader"** (asked right at account creation).
- [ ] Install the **Play Console app** on an Android phone and complete the device verification.

## 3. Apple Developer Program (USD 99 a year, usually 24–48 hours)

- [ ] Turn on two-factor authentication for an Apple Account in your legal name; enrol as an **Individual** (web, or the Apple Developer app with an ID photo). Your own card; no D-U-N-S number needed.
- [ ] In App Store Connect › **Business**: accept the agreements (the Free Apps Agreement is part of the program license) and complete the **Digital Services Act** item: **"This is not a trader account"**. Do it right after enrolment; without a declared status the app is not offered in the EU.

## 4. Testers (start now, it is the slowest part)

- [ ] Recruit **15–20 Android testers** (friends, running club, family), at least 12 must stay opted in for 14 consecutive days.
- [ ] Create the Google Group and send the invitation from [tester-invite.md](tester-invite.md) once the closed release is live (step 6).

## 5. Website and policy (minutes)

- [ ] After the site is pushed to `main`: GitHub › Settings › Pages › Build and deployment › Source: **GitHub Actions**. The workflow `.github/workflows/pages.yml` publishes `site/` on every change.
- [ ] Open https://pepibikerbtw.github.io/VEYVO/, `/privacy/` and `/support/` on your phone; read the privacy policy (effective 1 December 2026) and the health notice once more. Both stores check that the policy URL loads.

## 6. Google Play: app, closed test, production

- [ ] **App signing (decide before the first upload; it cannot be undone once testers install):** recommended, keep Google's default **Google-generated app signing key** and use the existing release keystore in `~/.veyvo-keys` as the **upload key**. Never regenerate that keystore. Consequence: the GitHub APK and the Play app have different signatures, so on your own phone export a backup in the GitHub APK first (Settings › Data and backups › Export backup), uninstall it, install the Play version and restore the backup.
- [ ] Add the 4 keystore secrets to the GitHub repository (`VEYVO_ANDROID_KEYSTORE_BASE64`, `VEYVO_ANDROID_KEYSTORE_PASSWORD`, `VEYVO_ANDROID_KEY_ALIAS`, `VEYVO_ANDROID_KEY_PASSWORD`) so a version tag builds the signed Play bundle (job `play-bundle`, a workflow artifact, never on the public release). Locally: `cd mobile && npm run build:play:aab`.
- [ ] *Create app*: name from the listing, default language **English (United States)**, App, **Free**, accept the declarations. Package `com.veyvo.coach` is fixed by the first upload.
- [ ] *App content*: paste every answer from [declarations.md](declarations.md) (privacy policy, ads: no, app access, content rating, target audience 18+, news, Data safety, Health apps declaration, government, financial features, advertising ID).
- [ ] *Store listing*: en-US from [play-listing.en.md](play-listing.en.md), add the cs-CZ translation from [play-listing.cs.md](play-listing.cs.md); category Health & Fitness; icon, feature graphic and 6 phone screenshots per language from `graphics/`.
- [ ] *Internal testing*: upload the AAB, install it on your phone through the internal test link, check it (back button, offline start, export, backup). Read the pre-launch report.
- [ ] *Closed testing*: create the track, add the Google Group, promote the build and send it for review (a few hours to about 7 days for a new account). When it is live, send the invitation.
- [ ] Run the **14-day closed test**. Keep a feedback log and ship at least one fix during the test. Every upload needs a new versionCode: raise the patch version, or build the same version again with `VEYVO_BUILD_NUMBER=1`, `2`, … ([architecture.md](../architecture.md#build-channels)).
- [ ] *Dashboard › Apply for production* with the drafted answers in [declarations.md](declarations.md#production-access-application-after-the-closed-test), filled in with what really happened (usually 7 days or less).
- [ ] *Production*: create the release with **managed publishing** on, send for review, then publish when you are ready.

## 7. App Store (on your Mac)

- [ ] Follow [ios-release.md](../ios-release.md): `npm run sync:ios`, open the project in Xcode, choose your team with automatic signing, run it on a real iPhone (iOS 17+ for the Apple Watch workout; ideally with a paired Apple Watch) and test the Apple Health import there. Simulators cannot test HealthKit or the watch properly.
- [ ] Archive, validate and upload; add yourself as an internal TestFlight tester and install the build from TestFlight.
- [ ] Create the App Store Connect record: English (U.S.) primary from [appstore-listing.en.md](appstore-listing.en.md), Czech from [appstore-listing.cs.md](appstore-listing.cs.md), Health & Fitness, price Free, support / marketing / privacy URLs, copyright `2026 Josef Kožíšek`, screenshots (6.9-inch set required, 6.3-inch set optional).
- [ ] **Before submitting, compare the description with the uploaded build**: Apple Health import, Apple Watch and intervals.icu must work as described, or delete that paragraph (guideline 2.3.1).
- [ ] App Privacy **Data Not Collected**, age rating questionnaire, App Review information (no sign-in, your phone in `+420` format, email) and the App Review note, all from [declarations.md](declarations.md). Then *Submit for Review* (Apple: 90 % within 48 hours; slower around 20–27 December).
- [ ] Budget 1–3 review rounds: guideline 4.2 (apps built on a web view) is the main risk. Answer in App Store Connect, point to the native features in the review note, fix and resubmit.

## 8. Later: paid extras (what changes when you start charging)

Free with no purchases lets you be a **non-trader**. Selling paid extras makes VEYVO a commercial activity, so you would have to **switch to trader in both stores before the first paid feature ships**. Nothing of this is needed for the free launch; plan for it before you add purchases.

**Google Play**
- Switch the account to **trader** (Play Console › Account details › About you) and confirm trader status per app. As a personal account trader, **your phone number and address are shown on Google Play** (for personal accounts from 1 March 2027) and in the EU your name replaces Google in "Offered by". Traders also give a **Terms of Service link** per app.
- Turn the payments profile into a **merchant account** (Play Console › Setup › Payments profile): bank account for payouts, tax information (Google asks for US tax forms such as W-8BEN for withholding). Google keeps a service fee (15 % on the first US$1M per year with the 15 % tier).
- Paid extras must use **Google Play Billing** (in-app products or subscriptions). A free app can never become a paid app, so paid extras are always in-app purchases.
- Update the privacy policy, Data safety (purchase history is processed by Google), the listing ("contains in-app purchases" is shown automatically) and the IARC questionnaire ("users can buy digital goods").

**Apple**
- Change the DSA status to **trader**: address (or a P.O. box), phone and email are **shown on the EU product page**, verified with documents. 2026 reports show trader verification taking **weeks to months**, with the app unavailable in the EU meanwhile, so do it well ahead.
- Accept the **Paid Apps Agreement**, add **bank account** and **tax forms** (W-8BEN; Czech tax residency) in App Store Connect › Business. Apply for the **App Store Small Business Program** (15 % commission instead of 30 %).
- Purchases must use Apple **in-app purchase**. Update App Privacy only if the developer starts receiving purchase data (StoreKit alone does not change the label), the age rating answers and the review note.

**Czech tax and trade licence (ask an accountant or tax adviser before the first sale)**
- Regular income from selling software is normally a business activity: expect a **trade licence** (volná živnost, e.g. *Poskytování software, poradenství v oblasti informačních technologií…*), **OSVČ** registration with the tax office, social security (ČSSZ) and health insurance, and income tax returns.
- **VAT:** Apple and Google sell to consumers and handle consumer VAT, but you receive services from their Irish companies, which can make you an *identifikovaná osoba* for VAT. Have this confirmed for your situation.
- Keep the store payout reports; they are your sales records.

Code: purchases are not implemented. A future `pro` flag can be added to the state when paid extras are designed; nothing in the 0.4 code depends on it.

## 9. Later: Health Connect on Android

Before the version with Health Connect run import goes to Play: update the privacy policy (new section, new effective date), Data safety (Fitness info and Health info if heart rate is read), the Health apps declaration and the separate **Health Connect** declaration with a reason for each data type, and the Play listing text. Health Connect also needs Android 8.0+ (`minSdk` 26) and an in-app privacy rationale screen.

## 10. Recurring

- Apple membership every year (USD 99). Play target API: API 37 required from August 2027. From April 2027 Play needs foldable screenshots and Apple needs builds made with the iOS 27 SDK.
- Change the privacy policy **before** any release that changes what data leaves the device, and keep the Play Data safety form and the Apple App Privacy label in step with it.
