# WebView Rules — iOS vs Android Critical Differences

> Extracted from CLAUDE.md. Covers WebView platform differences, web pages embedded in mobile WebView, and WebView-specific cross-platform rules.

## WebView (react-native-webview) — Hard-Won Lessons
Always account for these when writing WebView code:

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

## Fonts / Icons
- iOS requires `UIAppFonts` entries in `Info.plist` for custom fonts. Even if the font files are bundled via CocoaPods, iOS won't find them without this plist entry. Android auto-discovers fonts from the assets folder.
- Current fonts: `MaterialCommunityIcons.ttf`, `Ionicons.ttf`

## Deep Linking
- iOS uses both custom URL schemes (`CFBundleURLSchemes` in Info.plist) and Universal Links (Associated Domains entitlement)
- Android uses intent filters in AndroidManifest.xml

## Web Pages Embedded in Mobile WebView — Shared Components

Some pages are loaded BOTH as standalone web pages AND inside the mobile app's WebView (or as iframes on the website). When adding mobile-specific CSS or behavior, you MUST ensure it doesn't break the page in other contexts.

### `touch-action: none` Kills Iframe Interactions
`touch-action: none` on `html`, `body`, or container elements prevents ALL pointer interactions (mouse clicks, touch taps, drag) when the page is loaded inside an iframe. Leaflet maps handle their own touch events — they don't need `touch-action: none`. This was added for the mobile WebView `destination-map.tsx` page but broke the map embedded as an iframe on `check-your-street.tsx`.

**Rule:** Never set `touch-action: none` on html/body or map containers. Leaflet handles its own touch events. If you need to prevent scroll-bounce on mobile WebView, use more targeted approaches.

### Decorative Overlays Need `pointerEvents: 'none'`
Absolute-positioned decorative elements (grid backgrounds, gradient overlays) that cover their parent section will intercept clicks on form inputs below them. Always add `pointerEvents: 'none'` to purely decorative positioned overlays.

### `isMobileWebView` Must Be Stable Across Re-renders
If a page uses `router.replace()` or `router.push()` (which strips/changes URL params), any value derived from `window.location.search` will change on re-render. Use `useRef` initialized from URL params for values that must persist across the component lifetime. See `pages/settings.tsx` for the `isMobileWebViewRef` pattern.

### WebView `onShouldStartLoadWithRequest` Cannot Catch SPA Navigations
Next.js `router.push()` uses `history.pushState()` — a client-side navigation that does NOT trigger WebView's `onShouldStartLoadWithRequest` (which only fires for full page loads/link clicks). To intercept SPA navigations, use `onNavigationStateChange` as a fallback.

### `loadData()` and Other Async Functions Must Have try-catch
If a web page loaded in the mobile WebView throws an unhandled exception, Next.js shows a client-side error page that's impossible to recover from inside the WebView. All async data-loading functions on pages that can be loaded in a WebView MUST have try-catch wrappers. On error, post a `load_error` message to `ReactNativeWebView` so the native app can show a retry UI.

## Cross-Platform WebView Development Rules

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
