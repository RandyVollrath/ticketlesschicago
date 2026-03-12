# Apple App Store Review History

Reference file for all Apple review feedback received for Autopilot America (iOS).

---

## Rejection #1 — March 4, 2026 (v1.0.14)

**Guideline 3.1.1 - In-App Purchase**

> We noticed that your app offers a premium "Autopilot plan" (including automatic ticket detection, contest letters, and evidence gathering) that appears to be purchasable outside of in-app purchase. Specifically, the app includes a payment flow or link to an external website for purchasing this premium plan. All digital goods and services consumed within the app must use in-app purchase.

**Resolution**: Stripped all paid plan references from iOS UI. Wrapped paid features behind `Platform.OS !== 'ios'` and `(isPaidUser || Platform.OS !== 'ios')` guards. Changed onboarding slide 5 from "Upgrade to Autopilot Premium" to generic contest language. Committed in `312b5b1b`.

---

## Response #1 — March 5, 2026

Randy replied to the rejection:

> Hello, we have removed access to the external payment from the iOS app. Users can still access the premium features if they have already paid via the website, but there is no longer any way to purchase from within the iOS app. We believe this is compliant with Guideline 3.1.1 as the premium features are not digital content consumed within the app, but rather a service that includes physical mail (contest letters sent to city hall) and automated ticket monitoring.

---

## Rejection #2 — March 11, 2026 (v1.0.14)

### Issue 1: Guideline 3.1.1 - In-App Purchase

> We noticed your app offers the "Autopilot plan" that is accessible in the app but is not available for purchase using in-app purchase. Specifically, the Autopilot plan is available for $49/year.

**Resolution**: Further audit confirmed all $49/year text and upgrade CTAs were inside platform guards. The reviewer likely saw the build before the March 5 fix was submitted. Resubmitted as v1.0.17 build 19.

### Issue 2: Guideline 2.1 - Information Needed

> We need a sample license plate number to fully review your app. Please provide a valid license plate number that we can use during our review in the Review Notes section of your app's page on App Store Connect or in a reply to this message.

**Resolution**: Randy replied with license plate FJ86396 (IL). Created demo account `appreview@autopilotamerica.com` / `AppReview2026x` with this plate's data pre-populated. Added email+password login to LoginScreen.tsx. Committed in `90bbb943`.

---

## Response #2 — March 11, 2026

Randy replied:

> FJ86396

---

## Previous Feedback (Pre-March 2026)

Based on codebase analysis, these guidelines were previously addressed:

### Guideline 2.5.4 - Background Modes

The `audio` UIBackgroundMode was removed from Info.plist because Apple flagged the app for using background audio without proper justification. Native TTS (`AVSpeechSynthesizer`) in `BackgroundLocationModule.swift` was disabled with early returns in `speakCameraAlert()` and `forceSpeakCameraAlert()`. Camera alerts on iOS now use local notifications only (no spoken audio).

**Current status**: `configureSpeechAudioSession()` also disabled (March 2026) to prevent AVAudioSession from being configured for `.playback` mode even though speech was already disabled. `testBackgroundTTS()` also disabled.

**Files affected**:
- `ios/TicketlessChicagoMobile/Info.plist` — `audio` removed from UIBackgroundModes
- `ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` — TTS functions disabled with early returns

### Guideline 4.8 - Sign in with Apple

App offers Google OAuth login, so Sign in with Apple is required. Implemented and working.

**Files**: `LoginScreen.tsx` (line ~298), `AuthService.ts` (`signInWithApple()`), entitlements file.

### Guideline 5.1.1 - Data Deletion

Account deletion implemented with double-confirmation dialog. Calls backend `DELETE /api/users` endpoint.

**Files**: `ProfileScreen.tsx` (line ~633), `AuthService.ts` (`deleteAccount()`).

### Guideline 2.1 - App Completeness (Earlier Issues)

- **Unresponsive buttons**: Previously had buttons that did nothing when tapped. Fixed.
- **Outside Chicago**: App is designed for Chicago drivers only. Added clear messaging.

---

## Rejection #3 — March 12, 2026 (v1.0.17, build 19)

### Issue 1: Guideline 2.1(a) - Sign in with Apple Error

> An error message appeared when signing in with Apple.
> Tested on: iPad Air 11-inch (M3) and iPhone 17 Pro Max, iOS/iPadOS 26.3

**Root Cause**: Most likely the Supabase Apple provider's "Authorized Client IDs" field does not include the iOS bundle ID `fyi.ticketless.app`. For native `signInWithIdToken`, Supabase validates the Apple ID token's `aud` claim against Authorized Client IDs. The web OAuth uses the Services ID, but native iOS uses the bundle ID — both must be configured.

**Resolution**:
1. **REQUIRED (Dashboard)**: In Supabase Dashboard > Authentication > Providers > Apple, add `fyi.ticketless.app` to the "Authorized Client IDs" field. The main "Client ID" should be the Apple Services ID (for web OAuth).
2. **Code**: Improved error message in `AuthService.signInWithApple()` to show user-friendly message instead of raw Supabase error.

### Issue 2: Guideline 3.1.1 - In-App Purchase (STILL)

> The app still accesses digital content purchased outside the app, such as paid plans, but that content isn't available to purchase using In-App Purchase.

**Root Cause**: The previous fix hid pricing/upgrade CTAs in the native UI, but:
1. **ProfileScreen "Website" link** opened `autopilotamerica.com` in Safari, which prominently shows "$49/year" pricing and "Become a Founding Member" purchase CTAs.
2. **ProfileScreen "Terms of Service" link** opened a page that mentions "$49/year" subscription pricing.
3. **Paid dashboard** (`renderPaidDashboard`) showed subscription info for paid users who purchased via Stripe — "accessing digital content purchased outside the app."
4. **Mailing Address and Autopilot Settings sections** were visible to paid users on iOS — these are paid features purchased externally.

**Resolution**:
1. Removed "Website" link from ProfileScreen on iOS (links to pricing page).
2. Removed "Terms of Service" link from ProfileScreen on iOS (terms mention $49/year).
3. Forced free dashboard for ALL iOS users (even paid) — `renderPaidDashboard` blocked on iOS.
4. Changed Mailing Address and Autopilot Settings sections from `(isPaidUser || Platform.OS !== 'ios')` to `Platform.OS !== 'ios'` — completely hidden on iOS for ALL users.
5. Added `Platform.OS === 'ios'` early return in `handleUpgrade()` as safety guard.

---

## Current Compliance Status (March 12, 2026)

| Guideline | Status | Notes |
|-----------|--------|-------|
| 3.1.1 (IAP) | FIX APPLIED | All paid UI, external pricing links, and paid dashboard hidden on iOS |
| 2.1(a) (Apple Sign In) | NEEDS DASHBOARD FIX | Add bundle ID to Supabase Apple provider Authorized Client IDs |
| 2.5.4 (Background Modes) | PASS | `audio` mode removed, all TTS disabled |
| 4.8 (Sign in with Apple) | PASS (code) | Implementation correct; needs Supabase config fix |
| 5.1.1 (Account Deletion) | PASS | Double-confirm + backend deletion |
| 2.3.1 (Hidden Features) | PASS | Debug overlay gated behind explicit tap |

---

## Demo Account for Apple Review

- **Email**: appreview@autopilotamerica.com
- **Password**: AppReview2026x
- **License Plate**: FJ86396 (Illinois)
- **User ID**: f9802745-c11d-4698-9b1e-54a1892fb654
- **Features**: Free user (no paid features visible on iOS)
- **Login method**: Email + password (added to LoginScreen for review testing)

---

## Key Files for Compliance

- `src/screens/LoginScreen.tsx` — Sign in with Apple, email+password login
- `src/screens/NativeAlertsScreen.tsx` — ALL paid features hidden on iOS (not just for free users)
- `src/screens/OnboardingScreen.tsx` — No premium references
- `src/screens/ProfileScreen.tsx` — Account deletion, Website/Terms links hidden on iOS
- `src/services/AuthService.ts` — Apple sign-in with improved error handling
- `ios/TicketlessChicagoMobile/Info.plist` — Background modes (no `audio`)
- `ios/TicketlessChicagoMobile/BackgroundLocationModule.swift` — TTS disabled
- `ios/TicketlessChicagoMobile/TicketlessChicagoMobile.entitlements` — Apple sign-in
