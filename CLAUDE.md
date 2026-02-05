# Project Instructions

## Codebase Overview
- **Web app**: Next.js (pages/), deployed to Vercel via push to `main`
- **Mobile app**: React Native in `TicketlessChicagoMobile/`, iOS + Android
- **Backend**: Supabase (auth, database, RLS policies)
- **Domain**: autopilotamerica.com

## Deployment Workflow — DO THIS AFTER EVERY FEATURE / BUG FIX
After completing any feature or fix, always deploy everything:

1. **Web app**: Run `npx vercel --prod --yes` from the repo root to deploy to Vercel.
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

### Rules for Any BT Code Change
1. **Always call `ensureSavedDeviceLoaded()` before any code that calls `setCarConnected()`.**
2. **Never remove the delayed re-check timers** (2s + 5s) in `startForegroundMonitoring` and `restartBluetoothMonitoring`. They catch async profile proxy results.
3. **`saveCarDevice()` must eagerly set `savedDeviceId`** — don't rely on a separate async load.
4. **`isConnectedToCar()` must accept the `'__native_connected__'` placeholder** as "connected" — this is the defense against the race window.
5. **HomeScreen uses 3 fallback checks** (JS state → OS query → native SharedPrefs). Never reduce to fewer.
6. **The 10-second debounce in disconnect handler** filters transient BT glitches. Don't remove it.
7. **After any BT change, test on a real Android device** with: pair car → kill app → reopen → verify "Connected to [car]" shows within 5 seconds.

### Testing Bluetooth Detection
After any change to BT-related code, verify these scenarios on a physical Android device:
- [ ] Select car in Settings → HomeScreen shows "Connected to [car]" within 5s (if car BT is on)
- [ ] Car BT disconnects → after 10s debounce, parking check triggers
- [ ] Car BT reconnects → departure tracking starts
- [ ] Kill app while connected → reopen → still shows "Connected to [car]"
- [ ] App in background → car disconnects → parking notification fires

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

## Supabase Details
- Project ref: `dzhqolbhuqdcpngdayuq`
- localStorage key format: `sb-dzhqolbhuqdcpngdayuq-auth-token`
- RLS is enabled on all tables - queries must include user_id filtering
