# Project Instructions

## Codebase Overview
- **Web app**: Next.js (pages/), deployed to Vercel via push to `main`
- **Mobile app**: React Native in `TicketlessChicagoMobile/`, iOS + Android
- **Backend**: Supabase (auth, database, RLS policies)
- **Domain**: autopilotamerica.com

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

## Cross-Platform Development Rules

**Every feature must work on BOTH iOS and Android.** Before considering any task done:

1. **Think through iOS behavior separately from Android.** Even when using the same React Native component (WebView, Linking, etc.), the underlying native implementation can behave completely differently. Don't assume "it works on Android so it works on iOS."

2. **Anything that touches native APIs needs platform verification:**
   - WebView content injection, navigation, auth
   - Push notifications and background tasks
   - Permissions (different APIs, different plist/manifest entries)
   - Deep linking and URL handling
   - Biometrics (Face ID vs fingerprint)
   - File system paths and storage behavior
   - Font loading and asset bundling

3. **When adding a native dependency or config:**
   - Android: check `AndroidManifest.xml`, `build.gradle`, any native module setup
   - iOS: check `Info.plist`, `Podfile`, entitlements, Xcode build settings
   - Both need to be updated in the same commit

4. **iOS is stricter than Android on almost everything.** If something "just works" on Android, assume iOS needs explicit configuration. Specific patterns:
   - Android auto-discovers assets/fonts; iOS requires explicit plist registration
   - Android WebView is more forgiving with JS injection; iOS WKWebView has strict ordering/timing requirements
   - Android background tasks run more freely; iOS aggressively suspends/throttles
   - Android deep links via intent filters; iOS needs both URL schemes AND Universal Links

5. **Test mental model**: When writing any platform-touching code, ask: "What would WKWebView / iOS do differently here?" If uncertain, look it up before shipping.

## iOS vs Android: Critical Differences

### WebView (react-native-webview)
These are hard-won lessons. Always account for these when writing WebView code:

1. **`onMessage` handler is REQUIRED on iOS for `injectedJavaScript` to execute.**
   Android runs `injectedJavaScript` regardless, but iOS WKWebView silently skips it if no `onMessage` prop is set on the WebView component. Always add `onMessage` even if you don't need to receive messages.

2. **iOS WKWebView does NOT inherit device-width viewport.**
   Android WebView automatically uses device width. iOS WKWebView renders at desktop width unless you explicitly inject a `<meta name="viewport">` tag. Always force the viewport in `injectedJavaScriptBeforeContentLoaded`.

3. **iOS WKWebView can encode `#` as `%23` in URL fragments.**
   Never pass auth tokens or data via URL hash fragments to a WebView. Use `localStorage` injection via `injectedJavaScriptBeforeContentLoaded` instead.

4. **CSS injection timing differs between platforms.**
   Android applies `injectedJavaScriptBeforeContentLoaded` CSS reliably. iOS may have it wiped during SPA hydration. Always inject CSS in BOTH `injectedJavaScriptBeforeContentLoaded` (early) AND `injectedJavaScript` (fallback after hydration), using an element ID for deduplication.

5. **`injectedJavaScriptBeforeContentLoaded` runs at document start (before any page JS). `injectedJavaScript` runs at document end.** Use the former for auth and viewport, the latter for cleanup and fallback CSS.

6. **`injectedJavaScriptBeforeContentLoaded` only runs ONCE per WebView instance lifetime.**
   It does NOT re-run when React re-renders or when props change. If the data being injected can change (e.g. auth session after login), you MUST force a full WebView remount by changing the `key` prop. Pattern: use a counter state (`webViewKey`) that increments on auth transitions, then set `key={webViewKey}` on the WebView.

7. **Supabase localStorage key depends on the URL used by the web app, not the mobile app.**
   The Supabase JS client generates its storage key as `sb-{first segment of hostname}-auth-token`. If the web app uses a custom domain (e.g. `https://auth.autopilotamerica.com`), the key is `sb-auth-auth-token`. The mobile app uses the direct Supabase URL (`dzhqolbhuqdcpngdayuq.supabase.co`) but when injecting auth into a WebView that loads the WEB app, you must use the WEB app's storage key, not the mobile app's.

8. **NEVER use localStorage injection for WebView auth. Use URL query params instead.**
   `injectedJavaScriptBeforeContentLoaded` writing to localStorage is unreliable on iOS WKWebView. The Supabase client singleton initializes at import time and caches "no session" BEFORE the injection script runs — a race condition that cannot be fixed with timing hacks. The reliable approach: pass `mobile_access_token` and `mobile_refresh_token` as URL query params, and have the web page call `supabase.auth.setSession()` with them before checking `getSession()`. URL params are available synchronously to page JS — no race, no iOS-specific bugs.

### Fonts / Icons
- iOS requires `UIAppFonts` entries in `Info.plist` for custom fonts. Even if the font files are bundled via CocoaPods, iOS won't find them without this plist entry. Android auto-discovers fonts from the assets folder.
- Current fonts: `MaterialCommunityIcons.ttf`, `Ionicons.ttf`

### Deep Linking
- iOS uses both custom URL schemes (`CFBundleURLSchemes` in Info.plist) and Universal Links (Associated Domains entitlement)
- Android uses intent filters in AndroidManifest.xml

## Android Bluetooth Detection — Critical Rules

Android parking detection depends on Bluetooth Classic (ACL events). The system has multiple layers and race conditions that can silently break it. Follow these rules whenever touching BT code:

### Architecture (3 layers)
1. **Native foreground service** (`BluetoothMonitorService.kt`): Registers a `BroadcastReceiver` for `ACTION_ACL_CONNECTED/DISCONNECTED`. Survives app backgrounding. Writes `is_connected` to SharedPreferences. Notifies JS via `eventListener` callback or stores as pending event.
2. **Native module bridge** (`BluetoothMonitorModule.kt`): Bridges service → JS. Sets `eventListener` on the service, emits `BtMonitorCarConnected/BtMonitorCarDisconnected` events to JS via `NativeEventEmitter`.
3. **JS-side BluetoothService** (`BluetoothService.ts`): Maintains `connectedDeviceId` + `savedDeviceId` in-memory. `isConnectedToCar()` compares these. UI components subscribe via `addConnectionListener()`.

### Race Conditions to Guard Against
1. **`savedDeviceId` not loaded when `setCarConnected(true)` fires.**
   `savedDeviceId` comes from AsyncStorage (async). If a native event fires before it's loaded, `setCarConnected()` can't match IDs. Fix: `setCarConnected()` uses `'__native_connected__'` placeholder and kicks off async load. `isConnectedToCar()` accepts the placeholder. `ensureSavedDeviceLoaded()` retroactively fixes it.

2. **`checkInitialConnectionState()` profile proxy callback timing.**
   `getProfileProxy()` in the native service is async (100-2000ms). The callback updates SharedPreferences and notifies the listener, but JS event listeners may not be subscribed yet. Fix: JS does immediate check + delayed re-checks at 2s and 5s.

3. **JS `NativeEventEmitter` not subscribed when native emits.**
   `startMonitoring()` starts the service and resolves the promise BEFORE JS subscribes to events. The initial connect event from `checkInitialConnectionState()` can be lost. Fix: rely on SharedPreferences fallback checks, not just events.

4. **Stale `is_connected=true` in SharedPreferences after app restart (away from car).**
   SharedPreferences persists across app restarts/installs. If the last session ended while connected to the car, `is_connected=true` stays forever. On next startup the app reads it and shows "Driving" even though the car BT is off. The profile proxy check finds 0 devices but that alone doesn't fix anything — you MUST explicitly call `handleDisconnect()` when all profiles report 0 devices. Fix: `checkInitialConnectionState()` uses `AtomicInteger` to track completed profile callbacks. When all complete and none found the target, it calls `handleDisconnect()` to clear the stale state. JS delayed re-checks (2s/5s) must also correct connected→disconnected, not just disconnected→connected.

### Android Foreground Service Rules (CRITICAL)
The `BluetoothMonitorService` is a foreground service. Android has strict rules about these that cause **instant app crashes** if violated:

1. **NEVER call `startForeground()` in a STOP code path.** If the service calls `startForeground()` and then immediately `stopSelf()`, and another `startForegroundService()` START intent is queued, the STOP tears down the service before the START can fulfill its `startForeground()` contract → `ForegroundServiceDidNotStartInTimeException` → app crash → service dead forever until next app restart.
2. **Use `stopService()` to stop the service, NOT `startService(ACTION_STOP)`.** Sending STOP via `startService` creates the same race: the service receives STOP, dies, but a pending START from `startForegroundService` has no service to attach to.
3. **STOP must exit early in `onStartCommand`** — before the `startForeground()` call. Only START/null actions call `startForeground()`.
4. **If the foreground service crashes, it stays dead.** Android does NOT auto-restart it (despite `START_STICKY`) after a `ForegroundServiceDidNotStartInTimeException`. The BT monitoring is silently gone until the user force-closes and reopens the app.

### Rules for Any BT Code Change
1. **Always call `ensureSavedDeviceLoaded()` before any code that calls `setCarConnected()`.**
2. **Never remove the delayed re-check timers** (2s + 5s) in `startForegroundMonitoring` and `restartBluetoothMonitoring`. They catch async profile proxy results.
3. **`saveCarDevice()` must eagerly set `savedDeviceId`** — don't rely on a separate async load.
4. **`isConnectedToCar()` must accept the `'__native_connected__'` placeholder** as "connected" — this is the defense against the race window.
5. **HomeScreen uses 3 fallback checks** (JS state → OS query → native SharedPrefs). Never reduce to fewer.
6. **The 10-second debounce in disconnect handler** filters transient BT glitches. Don't remove it.
7. **After any BT change, test on a real Android device** with: pair car → kill app → reopen → verify "Connected to [car]" shows within 5 seconds.
8. **`checkInitialConnectionState()` must handle BOTH outcomes** — device found (handleConnect) AND device not found after all profiles checked (handleDisconnect). SharedPreferences persists across restarts, so "not found" is NOT the same as "no action needed."
9. **JS delayed re-checks must be bidirectional.** They must correct state in BOTH directions: disconnected→connected AND connected→disconnected. A one-directional check leaves stale "Driving" state uncorrectable.

### Testing Bluetooth Detection
After any change to BT-related code, verify these scenarios on a physical Android device:
- [ ] Select car in Settings → HomeScreen shows "Connected to [car]" within 5s (if car BT is on)
- [ ] Car BT disconnects → after 10s debounce, parking check triggers
- [ ] Car BT reconnects → departure tracking starts
- [ ] Kill app while connected → reopen → still shows "Connected to [car]"
- [ ] App in background → car disconnects → parking notification fires
- [ ] Kill app while connected → walk away from car → reopen → should show "Waiting for..." (NOT "Driving") within 5s

## iOS Parking/Driving Detection — Critical Rules

iOS parking detection uses CoreMotion (M-series coprocessor) + CLLocationManager. The detection flow is: CoreMotion detects automotive → `isDriving = true` → GPS tracks position → CoreMotion detects stationary/walking → 5-second debounce → parking confirmed → `onParkingDetected` event fires.

### Lesson #9: NEVER stop CoreMotion after parking confirmation
CoreMotion (`CMMotionActivityManager`) uses the dedicated M-series coprocessor — it is near-zero battery cost. Stopping it after parking and relying on `significantLocationChange` (cell tower changes, ~100-500m) to restart it causes **TWO silent failures**:

1. **Departure never captured**: `onDrivingStarted` never fires for the next drive because CoreMotion isn't running. The server never records that the user left their parking spot. This has been a recurring bug — the user reported it multiple times.
2. **Second parking never detected**: If the user parks, drives somewhere else (e.g. home), and parks again — the second parking is never detected because `isDriving` is never set back to true (no CoreMotion to detect it).

**Rule**: Keep CoreMotion running always. Keep GPS in ultra-low-frequency "keepalive" mode (200m, 3km accuracy) after parking — never fully stop it. Fully stopping GPS lets iOS kill the app process, which also kills CoreMotion callbacks. `significantLocationChange` alone is too unreliable for detecting the START of a new drive — it depends on cell tower geometry, can take minutes, and doesn't fire at all for short same-area trips.

### Architecture
- **Native module**: `BackgroundLocationModule.swift` — CLLocationManager + CMMotionActivityManager
- **JS orchestrator**: `BackgroundTaskService.ts` — receives `onParkingDetected` and `onDrivingStarted` events, runs parking rule checks, handles departure tracking
- **Departure flow**: `onDrivingStarted` → `handleCarReconnection()` → `markCarReconnected()` → `scheduleDepartureConfirmation()` (2-min delay to capture new GPS) → `confirmDeparture()`

### Rules
1. **CoreMotion AND keepalive GPS must stay active at all times while monitoring is on.** GPS drops to ultra-low-frequency (200m, 3km) after parking but is NEVER fully stopped — this prevents iOS from killing the process.
2. **Departure depends on `onDrivingStarted`** firing when the user starts their next drive. If CoreMotion is stopped, this event never fires and departure is never recorded.
3. **The `minDrivingDurationSec` (10s) filter** prevents false parking events from red lights. Walking override bypasses this (walking = user exited car, not a red light). GPS speed-zero path uses the same 10s minimum plus requires 10s of sustained zero speed before confirming.
4. **The speed-based override (10s of zero speed)** catches cases where CoreMotion is slow to report stationary. Don't remove it.
5. **After parking confirmation, `isDriving` resets to false.** The ONLY way it gets set back to true is via CoreMotion reporting automotive or GPS speed > 2.5 m/s. If neither is running, the app is permanently stuck in "parked" state.

## iOS Camera Alerts — Background Reality (Critical)

**Problem:** On iOS, JavaScript can be suspended while the app is in the background even if native location/motion continues. This means a JS-based camera alert pipeline (e.g. `CameraAlertService.onLocationUpdate`) can miss alerts even when departure/parking detection later looks correct.

**Rule:** If camera alerts must work in background, implement a native iOS fallback that:
- Runs on native location callbacks (not JS timers).
- Triggers a local notification (not TTS) when near a camera.
- Dedupes/cooldowns to avoid spam.
- Uses the same filters as JS (speed windows, heading/approach match, bearing-ahead cone).

### Current Implementation (Feb 15, 2026)
- Native implementation: `TicketlessChicagoMobile/ios/TicketlessChicagoMobile/BackgroundLocationModule.swift`
  - Fires local notifications for nearby cameras when app is backgrounded.
  - Only runs when driving/automotive is true (or GPS speed indicates movement).
  - Camera dataset is embedded in Swift for guaranteed compilation.
- JS settings sync:
  - `TicketlessChicagoMobile/src/services/BackgroundLocationService.ts` exposes `setCameraAlertSettings(...)`.
  - `TicketlessChicagoMobile/src/services/CameraAlertService.ts` calls it whenever camera settings change.
  - `TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` also pushes settings at startup for safety.

### Data Generation
- Script: `scripts/generate_ios_camera_data.ts`
- Inserts 510 Chicago camera entries into the Swift file between `// CAMERA_ENTRIES_BEGIN` and `// CAMERA_ENTRIES_END`.

### Testing Checklist (iOS)
- Install a build that includes the native camera code (pulling JS is not enough).
- Ensure iOS notification permission is enabled for the app.
- Enable camera alerts in app settings (this must sync native settings).
- Background the app and drive past a known red-light camera.
- Expect a banner local notification ("Red-light camera ahead") even if JS is suspended.

## iOS CoreMotion Permission Handling & GPS-Only Fallback

iOS only prompts the user ONCE for CoreMotion (Motion & Fitness) permission. If denied, the system will never re-prompt — the user must manually enable it in Settings > Privacy > Motion & Fitness.

### Architecture (3 layers)

1. **Pre-permission primer** (`BackgroundTaskService.ts`): Before the first CoreMotion access, if auth is `notDetermined`, shows an `Alert.alert()` explaining why motion sensors are needed. This appears RIGHT BEFORE the iOS system prompt.

2. **GPS-only fallback** (`BackgroundLocationModule.swift`): When CoreMotion is denied/restricted/unavailable, `startMonitoring()` sets `gpsOnlyMode = true` and starts continuous GPS at low frequency (distanceFilter=20m, accuracy=100m) instead of waiting for CoreMotion to detect driving. The existing GPS speed fallback path (requires 4.2 m/s for 8s + 90m displacement) then detects driving from GPS speed alone.

3. **Post-denial recovery banner** (`HomeScreen.tsx`): When `MotionActivityService.getAuthorizationStatus()` returns `denied` or `restricted`, a yellow warning banner appears: "Motion & Fitness disabled — Enable in Settings for best results" with an "Open Settings" button.

### Key Behavior Differences in GPS-Only Mode
- `gpsOnlyMode = true` is set on `BackgroundLocationModule`
- `stopContinuousGps()` NEVER fully stops GPS — drops to keepalive mode (200m, 3km accuracy in normal mode; 20m, 100m in gpsOnly mode) to prevent iOS from killing the process
- Driving detection requires higher speed threshold (4.2 m/s vs 2.5 m/s with CoreMotion) and sustained duration (8s + 90m)
- Camera alerts still work via `speedSaysMoving` flag
- More battery usage than CoreMotion (which runs on M-series coprocessor at near-zero cost)

### Rules
1. **Never remove the GPS speed fallback path** (lines ~1593-1660 in BackgroundLocationModule.swift). It's the ONLY driving detection when CoreMotion is denied.
2. **`gpsOnlyMode` must be exposed in `getStatus()`** so JS can detect it and show appropriate UI.
3. **The pre-permission primer must appear BEFORE `startMonitoring()`** — once startMonitoring calls `activityManager.startActivityUpdates()`, the system prompt fires immediately.
4. **`MotionActivityModule.getAuthorizationStatus()`** is the canonical way to check CoreMotion permission from JS. Returns: `authorized`, `denied`, `restricted`, `notDetermined`, or `unknown`.
5. **The recovery banner should NOT show if location is also denied** (location denied is more critical — show that banner instead).

## Parking State Machine — Single Source of Truth

The Android parking detection state machine (`ParkingDetectionStateMachine.ts`) is the **single source of truth** for whether the user is driving or parked. Departure tracking DEPENDS on this state machine being in the correct state.

### The Invariant
**Departure tracking ONLY works if the state machine transitions from PARKED → DRIVING.**

If the state machine is in IDLE when the user drives away, departure is silently never recorded. The parking history record exists but has no departure timestamp.

### What Triggers State Machine Transitions
| Trigger | State Transition | Effect |
|---------|-----------------|--------|
| BT disconnect + 10s debounce | DRIVING → PARKING_PENDING → PARKED | `handleCarDisconnection()` |
| BT connect while PARKED | PARKED → DRIVING | `handleCarReconnection()` → departure recorded |
| BT connect while IDLE | IDLE → DRIVING | Camera alerts start, GPS caching starts, **NO departure** |
| Manual parking check | No change (was broken) | Parking recorded to history but state machine untouched |

### The Bug Pattern (Don't Repeat This)
When adding ANY new way to record parking (manual check, server restore, periodic backup, etc.), you MUST also transition the state machine to PARKED. Otherwise:
1. Parking shows in history ✓
2. User drives away
3. State machine is IDLE → DRIVING (not PARKED → DRIVING)
4. `handleCarReconnection()` never called
5. Departure never recorded
6. User sees "Departure not recorded" in history

### Rules for Any Parking-Related Code
1. **ALL parking operations must go through the state machine.** Never write to parking history without also ensuring the state machine is in PARKED state.
2. **Check the state machine before assuming departure will be tracked.** If `ParkingDetectionStateMachine.state !== 'PARKED'`, departure will NOT be captured.
3. **New entry points for parking MUST call `manualParkingConfirmed()` or equivalent.** This includes: manual checks, server restore, periodic backups, any future "assume parked" logic.
4. **The state machine persists to AsyncStorage.** On app restart, it restores to the last stable state (PARKED or DRIVING). If the parking record was from a code path that didn't update the state machine, the restored state will be wrong.

### How to Test Departure Tracking
After any parking-related code change, test ALL entry points:
- [ ] **Auto-detected parking**: BT disconnect → parking check → drive away → departure recorded
- [ ] **Manual parking check**: Tap "Check My Parking" → drive away → departure recorded
- [ ] **App restart while parked**: Kill app → reopen → drive away → departure recorded

## React State Initialization — NEVER Default to Empty

Async-loaded state (auth, user profile, feature flags, etc.) causes **intermittent bugs** when components initialize with empty defaults like `null`, `false`, or `[]` and rely on a subscription/callback to fill in the real value later. Whether the real value arrives before or after the first render is a race condition — it works sometimes and breaks sometimes, making these bugs extremely hard to reproduce.

### The Rule
**If a synchronous read exists, use it as the initial state.** Never default to "empty" when the service already has the value.

```typescript
// BAD — defaults to null, relies on subscribe callback to fix it later
const [user, setUser] = useState<User | null>(null);

// GOOD — reads current value immediately, subscribe handles future changes
const [user, setUser] = useState<User | null>(AuthService.getUser());
```

```typescript
// BAD — defaults to false, may flash "Sign In" screen before subscribe fires
const [isAuthenticated, setIsAuthenticated] = useState(false);

// GOOD — reads current auth state synchronously
const [isAuthenticated, setIsAuthenticated] = useState(AuthService.isAuthenticated());
```

### Where This Applies
- **Auth state**: Always init from `AuthService.getUser()` / `AuthService.isAuthenticated()` / `AuthService.getAuthState()`
- **Any singleton service** with a `getXxx()` method: read it at `useState` time, don't wait for a callback
- **AsyncStorage values that were already loaded by App.tsx**: If the app startup loaded them, downstream screens can read the cached value

### Additional Guards
1. **Never gate critical UI (Sign Out, navigation) on auth state being non-null.** If the user got past the login screen, they're authenticated — show the button unconditionally.
2. **Use refs (not closure captures) to track "previous" values in subscribe callbacks.** Closures over state in `useEffect` dependencies cause stale reads and infinite re-subscription loops.
3. **Subscribe effects should have `[]` dependency arrays** (run once), not `[stateVariable]` — the subscribe callback already handles updates.

## Data Persistence Strategy
- **Local-first**: AsyncStorage for immediate reads
- **Server backup**: Supabase for durability across reinstalls/devices
- Pattern: save locally first, fire-and-forget sync to server, restore from server when local is empty
- Never block the UI waiting for server sync

## Connected Devices
- Moto G 2025: `ZT4224LFTZ` (primary test device)
- Moto E5 Play: `ZY326L2GKG`

## CHI PAY Portal Scraper — How It Works

The portal scraper (`lib/chicago-portal-scraper.ts`) looks up parking tickets on the City of Chicago payment portal. It uses Playwright to automate a headless browser but **does NOT need any captcha solving service** (no API keys, $0 cost per lookup).

### Key Technical Details
- Portal URL: `https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1`
- Backend API endpoint: `POST /payments-web/api/searches`
- The Angular SPA has an hCaptcha widget that disables the Search button, but the backend API does not validate captcha tokens
- The scraper bypasses hCaptcha by: (1) filling form fields via native value setters + input/change events to trigger Angular change detection, (2) removing the `disabled` attribute from the Search button, (3) calling `.click()` via JavaScript
- The scraper intercepts the API JSON response (not HTML) for structured ticket data
- Lookup time: ~14 seconds per plate
- No CAPTCHA_API_KEY or CAPSOLVER_API_KEY needed

### API Response Format
- **200**: Tickets found — response contains `searchResult.receivables` array
- **422**: No open tickets — response has `searchResult.errorMessage: "No open receivables found"`
- **500**: Server error (usually empty/invalid fields)
- **401**: Session expired (shouldn't happen with fresh browser context)

### Autopilot Schedule
- Runs Mon/Thu via systemd user timers
- Script: `scripts/autopilot-check-portal.ts`
- Fetches monitored plates from Supabase, looks them up, creates contest letters, emails evidence requests

## `is_paid` Field — NEVER Default to True

The `user_profiles.is_paid` column tracks whether a user has an active paid subscription. Its DB column default is `false`.

### Rules
1. **NEVER set `is_paid: true` in any signup or profile creation flow.** Users start as free. The only code path that should set `is_paid: true` is the Stripe webhook's `checkout.session.completed` handler — i.e., when someone actually pays.
2. **Free alert signups are NOT paid users.** The alerts/create.ts endpoint creates free accounts. Do not mark them as paid.
3. **No triggers or defaults should set `is_paid` to true.** If you're writing a migration or trigger that touches `user_profiles`, ensure `is_paid` defaults to `false`.

### History
A bug in `pages/api/alerts/create.ts` (fixed Feb 2026) was setting `is_paid: true` for every free signup with the comment "Free users are considered 'paid' for alerts." This incorrectly marked ~20 users as paid when only 9 actually were. The bug was a single line — there's nothing ambiguous about it: free users are free.

## Supabase Details
- Project ref: `dzhqolbhuqdcpngdayuq`
- localStorage key format: `sb-dzhqolbhuqdcpngdayuq-auth-token`
- RLS is enabled on all tables - queries must include user_id filtering
