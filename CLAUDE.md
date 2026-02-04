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
3. **Install on Moto G**: Check if the Moto G (serial `ZT4224LFTZ`) is connected via `adb devices`. If it shows up, install the APK automatically:
   ```
   adb -s ZT4224LFTZ install -r TicketlessChicagoMobile/android/app/build/outputs/apk/release/app-release.apk
   ```
   Also install on any other connected device (e.g. Moto E5 Play `ZY326L2GKG`).
4. **iOS**: user builds locally on Mac by pulling from git and building in Xcode.
5. **Always push to GitHub after making changes** — the user expects all work deployed to production.

## Version Bumping
- When releasing, bump BOTH `TicketlessChicagoMobile/android/app/build.gradle` (versionCode + versionName) AND `TicketlessChicagoMobile/src/config/config.ts` (APP_VERSION + BUILD_NUMBER). Keep them in sync.

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

### Fonts / Icons
- iOS requires `UIAppFonts` entries in `Info.plist` for custom fonts. Even if the font files are bundled via CocoaPods, iOS won't find them without this plist entry. Android auto-discovers fonts from the assets folder.
- Current fonts: `MaterialCommunityIcons.ttf`, `Ionicons.ttf`

### Deep Linking
- iOS uses both custom URL schemes (`CFBundleURLSchemes` in Info.plist) and Universal Links (Associated Domains entitlement)
- Android uses intent filters in AndroidManifest.xml

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
