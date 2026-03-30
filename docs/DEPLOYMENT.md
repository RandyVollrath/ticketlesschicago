# Deployment Workflow, Release Checklist, and Version Bumping

> Extracted from CLAUDE.md. Covers the full deployment workflow (web, Android, iOS, Firebase), release verification checklist, and version bumping rules.

## Deployment Workflow — DO THIS AFTER EVERY CHANGE
After completing any code/content/config change (feature, bug fix, copy update, styling tweak, migration wiring), always deploy everything:

0. **No dirty working tree at handoff (mandatory)**:
   - Before you report completion, run `git status --porcelain` and ensure it is empty.
   - If not empty: finish the work (or revert partial edits), then **commit**, **pull --rebase**, **push**, and **deploy** in the same session.

1. **Web app**: Run `npx vercel --prod --yes` from the repo root to deploy to Vercel.
   - This is mandatory on every completed task in this repo.
   - Do not stop at "changes made locally."
   - Report the production deployment URL after each deploy.
2. **Android APK**: Run `./gradlew assembleRelease` in `TicketlessChicagoMobile/android/`.
3. **Install on connected devices**: Check via `adb devices`. Install on any connected device:
   ```
   adb -s ZT4224LFTZ install -r TicketlessChicagoMobile/android/app/build/outputs/apk/release/app-release.apk
   adb -s ZY326L2GKG install -r TicketlessChicagoMobile/android/app/build/outputs/apk/release/app-release.apk
   ```
4. **Firebase App Distribution (OTA updates)**: ALWAYS upload after building the APK so the user can install remotely without being near the computer. Use the Firebase CLI:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/home/randy-vollrath/ticketless-chicago/firebase-admin-key.json \
     firebase appdistribution:distribute \
     /home/randy-vollrath/ticketless-chicago/TicketlessChicagoMobile/android/app/build/outputs/apk/release/app-release.apk \
     --app 1:450290119882:android:16850ef983b271ea3ff033 \
     --testers "hiautopilotamerica@gmail.com"
   ```
   - Service account: `firebase-admin-key.json` (has Firebase App Distribution Admin role)
   - Tester: `hiautopilotamerica@gmail.com` (uses Firebase App Tester on phone)
   - **IMPORTANT**: The version must be bumped (new versionCode) or Firebase will reject/deduplicate the upload
5. **iOS**: user builds locally on Mac by pulling from git and building in Xcode.
6. **Always push to GitHub after making changes** — the user expects all work deployed to production.
7. **Completion rule**: A task is not complete until deployment has finished and deployment status/URL is reported.
8. **No local leftovers**: Never leave a dirty working tree at handoff. Commit, push, and deploy in the same working session for every completed change.

## Release Checklist — Verify After Every Deploy
After deploying, verify these critical user flows work:
1. **Web auto-login**: Visit `autopilotamerica.com/settings` in a browser where the user previously signed in. Confirm the session persists and the user is NOT asked to log in again. If session doesn't persist, check Supabase auth cookie/localStorage handling.
2. **Alerts signup → settings redirect**: Complete a free alerts signup via email magic link. After clicking the link, confirm the user lands on `/settings` already authenticated (not on the login page).
3. **Mobile WebView auth**: Open the settings page from the mobile app. Confirm the WebView auto-authenticates via URL query params (`mobile_access_token`, `mobile_refresh_token`).

## Version Bumping
**Only bump versions for actual releases** (new features, app store submissions, or when Firebase App Distribution needs a distinct build). Do NOT bump for every bug fix or deploy — rebuilding and reinstalling the same version is fine.

When releasing, bump ALL THREE locations and keep them in sync:

1. **Android**: `TicketlessChicagoMobile/android/app/build.gradle`
   - `versionCode` (integer, e.g., 10)
   - `versionName` (string, e.g., "1.0.9")

2. **Config**: `TicketlessChicagoMobile/src/config/config.ts`
   - `APP_VERSION` (e.g., '1.0.9')
   - `BUILD_NUMBER` (e.g., '10')

3. **iOS**: `TicketlessChicagoMobile/ios/TicketlessChicagoMobile.xcodeproj/project.pbxproj`
   - `MARKETING_VERSION` (e.g., 1.0.9) — appears twice in the file
   - `CURRENT_PROJECT_VERSION` (e.g., 10) — appears twice in the file
   - Use `replace_all: true` when editing to update both occurrences

**CRITICAL**: iOS versions are stored in `project.pbxproj`, NOT in `Info.plist` (which just references build variables). If you only update Android and config.ts, iOS will have stale version numbers and the user will have to manually fix it in Xcode.

## Connected Devices
- Moto G 2025: `ZT4224LFTZ` (primary test device)
- Moto E5 Play: `ZY326L2GKG`
