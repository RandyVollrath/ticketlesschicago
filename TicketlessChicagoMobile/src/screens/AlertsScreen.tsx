import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import AuthService from '../services/AuthService';
import Config from '../config/config';
import Logger from '../utils/Logger';

const log = Logger.createLogger('AlertsScreen');

const SETTINGS_URL = `${Config.API_BASE_URL}/settings`;

const AlertsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(AuthService.isAuthenticated());
  // Session key: changes when auth state changes, forcing WebView to remount
  // with fresh injected scripts. Without this, the WebView keeps the stale
  // injection from its initial mount (injectedJavaScriptBeforeContentLoaded
  // only runs once per WebView instance).
  const [webViewKey, setWebViewKey] = useState(0);
  const webViewRef = useRef<WebView>(null);
  // Track previous auth state via ref to avoid closure issues with subscribe
  const wasAuthRef = useRef(isAuthenticated);
  const lastTokenSignatureRef = useRef<string | null>(null);
  // Guard against infinite load_error → remount → load_error loops
  const loadErrorRetryCountRef = useRef(0);

  const remountWebViewIfTokenChanged = useCallback(() => {
    const authState = AuthService.getAuthState();
    const currentSig = authState.session
      ? `${authState.session.access_token.slice(-16)}:${authState.session.refresh_token.slice(-16)}`
      : null;
    if (currentSig !== lastTokenSignatureRef.current) {
      lastTokenSignatureRef.current = currentSig;
      setWebViewKey((prev) => prev + 1);
    }
  }, []);

  const syncAlertsAuth = useCallback(async () => {
    // Best-effort re-hydration if auth wasn't initialized yet.
    if (AuthService.isLoading()) {
      await AuthService.initialize();
    }

    const authenticated = AuthService.isAuthenticated();
    setIsAuthenticated(authenticated);
    if (!authenticated) {
      setIsLoading(false);
      return;
    }

    // Keep settings WebView auth stable even if access token rotated/expired.
    await AuthService.refreshToken();
    remountWebViewIfTokenChanged();
  }, [remountWebViewIfTokenChanged]);

  // Re-check auth when screen is focused (user may have just logged in)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Reset error retry counter on re-focus so user gets a fresh attempt
      loadErrorRetryCountRef.current = 0;
      syncAlertsAuth().catch((error) => {
        log.error('Failed to sync alerts auth on focus', error);
      });
    });
    return unsubscribe;
  }, [navigation, syncAlertsAuth]);

  useEffect(() => {
    syncAlertsAuth().catch((error) => {
      log.error('Failed to sync alerts auth on mount', error);
    });
  }, [syncAlertsAuth]);

  // Subscribe to auth state changes so we catch login/logout from any screen
  useEffect(() => {
    const unsubscribe = AuthService.subscribe((state) => {
      const nowAuth = state.isAuthenticated;
      setIsAuthenticated(nowAuth);

      // When user transitions from logged-out to logged-in (or vice versa),
      // bump the key to force a full WebView remount with the new session.
      if (wasAuthRef.current !== nowAuth) {
        wasAuthRef.current = nowAuth;
        remountWebViewIfTokenChanged();
        if (!nowAuth) setIsLoading(false);
      } else if (nowAuth) {
        // Session can rotate while staying authenticated (token refresh).
        remountWebViewIfTokenChanged();
      }
    });
    return () => unsubscribe();
  }, [remountWebViewIfTokenChanged]);

  // Read session fresh each render — combined with webViewKey, this ensures
  // the WebView always gets the current session tokens when it mounts.
  const authStateObj = AuthService.getAuthState();
  const session = authStateObj?.session;

  // Auth mechanism: pass tokens as URL query params.
  // The web settings page reads mobile_access_token & mobile_refresh_token
  // from the URL and calls supabase.auth.setSession() before loadData().
  //
  // WHY NOT localStorage injection?
  // iOS WKWebView has a race condition: the Supabase client singleton
  // initializes and caches "no session" at import time, BEFORE
  // injectedJavaScriptBeforeContentLoaded can write to localStorage.
  // URL query params are available synchronously — no race condition.
  const settingsUrl = session
    ? `${SETTINGS_URL}?mobile_access_token=${encodeURIComponent(session.access_token)}&mobile_refresh_token=${encodeURIComponent(session.refresh_token)}`
    : SETTINGS_URL;

  // Runs at DOCUMENT START — forces mobile viewport + injects CSS early.
  const injectedJavaScriptBeforeContentLoaded = `
    (function() {
      try {
        // 1. Force mobile viewport (iOS WKWebView needs this)
        var vp = document.querySelector('meta[name="viewport"]');
        if (!vp) {
          vp = document.createElement('meta');
          vp.name = 'viewport';
          document.head.appendChild(vp);
        }
        vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';

        // 2. Inject mobile CSS early (will apply to all DOM elements as they appear)
        var style = document.createElement('style');
        style.id = '__autopilot_mobile_css';
        style.textContent = [
          'nav, footer, .site-header, .site-footer, .site-nav { display: none !important; }',
          'body { padding-top: 0 !important; margin: 0 !important; }',
          'main { max-width: 100% !important; padding: 10px 10px 24px !important; margin-top: 0 !important; }',
          'main > div { margin-bottom: 14px !important; }',
          'main > div > div:last-child { padding: 16px !important; }',
          'main > div > div:first-child { padding: 12px 16px !important; }',
          'main > div > div:first-child h3 { font-size: 16px !important; }',
          'main > div > div:last-child > div { gap: 8px !important; }',
          'main > div > div:last-child > div > div:first-child { min-width: 0; flex: 1 1 0%; }',
          'main > div > div:last-child > div > div:first-child h4 { font-size: 14px !important; word-break: break-word; }',
          'main > div > div:last-child > div > div:first-child p { font-size: 12px !important; word-break: break-word; }',
          'main label[style*="cursor: pointer"] { padding: 6px 8px !important; font-size: 13px !important; gap: 6px !important; }',
          'main div[style*="flex-wrap: wrap"] { gap: 8px !important; }',
          'main div[style*="flex: 1 1"] { flex: 1 1 100% !important; }',
          'main input, main select { font-size: 14px !important; padding: 8px 10px !important; }',
        ].join(' ');
        document.head.appendChild(style);
      } catch(e) { console.warn('WebView injection error', e); }
    })();
    true;
  `;

  // Runs at DOCUMENT END — clean up site chrome that rendered after the SPA hydrated.
  const injectedJavaScript = `
    (function() {
      try {
        // Hide elements between nav and main (dark header bar, etc.)
        var main = document.querySelector('main');
        if (main) {
          var el = main.previousElementSibling;
          while (el) {
            el.style.display = 'none';
            el = el.previousElementSibling;
          }
        }

        // Re-inject CSS if it got wiped by SPA navigation
        if (!document.getElementById('__autopilot_mobile_css')) {
          var style = document.createElement('style');
          style.id = '__autopilot_mobile_css';
          style.textContent = [
            'nav, footer, .site-header, .site-footer, .site-nav { display: none !important; }',
            'body { padding-top: 0 !important; margin: 0 !important; }',
            'main { max-width: 100% !important; padding: 10px 10px 24px !important; margin-top: 0 !important; }',
            'main > div { margin-bottom: 14px !important; }',
            'main > div > div:last-child { padding: 16px !important; }',
            'main > div > div:first-child { padding: 12px 16px !important; }',
            'main > div > div:first-child h3 { font-size: 16px !important; }',
            'main > div > div:last-child > div { gap: 8px !important; }',
            'main > div > div:last-child > div > div:first-child { min-width: 0; flex: 1 1 0%; }',
            'main > div > div:last-child > div > div:first-child h4 { font-size: 14px !important; word-break: break-word; }',
            'main > div > div:last-child > div > div:first-child p { font-size: 12px !important; word-break: break-word; }',
            'main label[style*="cursor: pointer"] { padding: 6px 8px !important; font-size: 13px !important; gap: 6px !important; }',
            'main div[style*="flex-wrap: wrap"] { gap: 8px !important; }',
            'main div[style*="flex: 1 1"] { flex: 1 1 100% !important; }',
            'main input, main select { font-size: 14px !important; padding: 8px 10px !important; }',
          ].join(' ');
          document.head.appendChild(style);
        }

        // Detect Next.js "Application Error" crash screen and notify native app immediately.
        // Without this, the user stares at a generic error for 20+ seconds.
        function checkForAppError() {
          var bodyText = document.body ? document.body.innerText : '';
          if (bodyText.indexOf('Application error') !== -1 || bodyText.indexOf('client-side exception') !== -1) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage('load_error');
            return true;
          }
          return false;
        }
        if (!checkForAppError()) {
          // Check again after React hydration (500ms, 1.5s, 3s)
          setTimeout(checkForAppError, 500);
          setTimeout(checkForAppError, 1500);
          setTimeout(checkForAppError, 3000);
        }

        // Also catch any future unhandled errors that crash the page
        window.addEventListener('error', function(e) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage('load_error');
        });

        // Signal injection complete
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage('injection_done');
      } catch(e) { console.warn('WebView injection error', e); }
    })();
    true;
  `;

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Alerts</Text>
        </View>
        <View style={styles.unauthContainer}>
          <MaterialCommunityIcons
            name="bell-ring-outline"
            size={48}
            color={colors.textTertiary}
          />
          <Text style={styles.unauthTitle}>Sign in to manage alerts</Text>
          <Text style={styles.unauthText}>
            Get notified about street cleaning, snow bans, tow alerts, and more. Sign in to customize your preferences.
          </Text>
          <TouchableOpacity
            style={styles.signInButton}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.8}
            accessibilityLabel="Sign in"
            accessibilityRole="button"
            accessibilityHint="Navigate to sign-in screen"
          >
            <Text style={styles.signInButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (isAuthenticated && !session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Alerts</Text>
        </View>
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Syncing your account...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
        {!isLoading && !hasError && (
          <TouchableOpacity
            onPress={() => webViewRef.current?.reload()}
            accessibilityLabel="Refresh alerts settings"
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="refresh"
              size={20}
              color={colors.primary}
            />
          </TouchableOpacity>
        )}
      </View>

      {hasError ? (
        <View style={styles.errorContainer} accessibilityRole="alert">
          <MaterialCommunityIcons
            name="wifi-off"
            size={48}
            color={colors.textTertiary}
          />
          <Text style={styles.errorTitle}>Couldn't load settings</Text>
          <Text style={styles.errorText}>
            Check your internet connection and try again.
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setHasError(false);
              setIsLoading(true);
              webViewRef.current?.reload();
            }}
            activeOpacity={0.8}
            accessibilityLabel="Retry loading settings"
            accessibilityRole="button"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          key={`alerts-webview-${webViewKey}`}
          ref={webViewRef}
          source={{ uri: settingsUrl }}
          style={styles.webView}
          injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
          injectedJavaScript={injectedJavaScript}
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            log.error('WebView error', nativeEvent);
            setHasError(true);
            setIsLoading(false);
          }}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            log.error('WebView HTTP error', nativeEvent.statusCode);
            if (nativeEvent.statusCode >= 500) {
              setHasError(true);
            }
          }}
          onShouldStartLoadWithRequest={(request) => {
            // Block navigation to sign-in or any non-settings page BEFORE
            // the WebView starts loading it.  onNavigationStateChange fires
            // after the load starts and can't prevent it.
            const url = request.url || '';
            if (url.includes('/auth/signin') || url.includes('/login')) {
              log.warn('Blocked WebView navigation to sign-in:', url);
              setIsAuthenticated(false);
              setIsLoading(false);
              return false; // Block the navigation
            }
            return true;
          }}
          onNavigationStateChange={(navState) => {
            // Fallback detection (some SPA navigations don't trigger
            // onShouldStartLoadWithRequest since they're JS-driven pushState).
            if (navState.url && !navState.url.includes('/settings')) {
              log.warn('WebView navigating away from settings:', navState.url);
              if (navState.url.includes('/auth/signin') || navState.url.includes('/login')) {
                setIsAuthenticated(false);
                setIsLoading(false);
              }
            }
          }}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading your settings...</Text>
            </View>
          )}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          onMessage={(event) => {
            // Required for injectedJavaScript to execute on iOS WKWebView.
            // Also receives our 'injection_done' signal and 'auth_failed' from the web page.
            const msg = event.nativeEvent.data;
            if (msg === 'injection_done') {
              log.debug('WebView CSS/auth injection confirmed');
            } else if (msg === 'auth_failed') {
              // Web page couldn't authenticate with the provided tokens.
              // Show the native unauthenticated UI instead of letting the
              // WebView redirect to the web sign-in page.
              log.warn('WebView auth_failed — showing native sign-in prompt');
              setIsAuthenticated(false);
              setIsLoading(false);
            } else if (msg === 'load_error') {
              // Web page crashed or loadData() threw.
              // Try refreshing auth once — the crash may be from expired tokens.
              // If that doesn't help, show the sign-in screen (better than error).
              loadErrorRetryCountRef.current += 1;
              if (loadErrorRetryCountRef.current > 1) {
                // Already retried once — don't loop. Show sign-in prompt.
                log.warn('WebView load_error — already retried, showing sign-in');
                setIsAuthenticated(false);
                setIsLoading(false);
                return;
              }
              log.warn('WebView load_error — attempting auth refresh (attempt 1)');
              AuthService.refreshToken().then(() => {
                const refreshedSession = AuthService.getAuthState()?.session;
                if (refreshedSession) {
                  // Got a fresh session — remount WebView with new tokens
                  log.info('WebView load_error — retrying with refreshed token');
                  remountWebViewIfTokenChanged();
                } else {
                  // No valid session — show sign-in prompt
                  log.warn('WebView load_error — no valid session, showing sign-in');
                  setIsAuthenticated(false);
                  setIsLoading(false);
                }
              }).catch(() => {
                log.warn('WebView load_error — refresh failed, showing sign-in');
                setIsAuthenticated(false);
                setIsLoading(false);
              });
            }
          }}
          cacheEnabled={true}
          userAgent={`AutopilotMobile/${Config.APP_VERSION} (${Platform.OS})`}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
  },

  // Unauthenticated state
  unauthContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  unauthTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  unauthText: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sizes.base * 1.5,
    marginBottom: spacing.lg,
  },
  signInButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    ...shadows.sm,
  },
  signInButtonText: {
    color: colors.white,
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
  },

  // Error state
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  errorTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  errorText: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    ...shadows.sm,
  },
  retryButtonText: {
    color: colors.white,
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
  },
});

export default AlertsScreen;
