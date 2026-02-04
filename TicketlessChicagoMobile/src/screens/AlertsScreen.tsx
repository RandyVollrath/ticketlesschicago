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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  // Re-check auth when screen is focused (user may have just logged in)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      checkAuth();
    });
    return unsubscribe;
  }, [navigation]);

  const checkAuth = useCallback(() => {
    const authenticated = AuthService.isAuthenticated();
    setIsAuthenticated(authenticated);
    if (!authenticated) {
      setIsLoading(false);
    }
  }, []);

  // Get the full Supabase session to inject into WebView
  const authStateObj = AuthService.getAuthState();
  const session = authStateObj?.session;

  // Primary auth mechanism: pass tokens in the URL hash fragment.
  // The web Supabase client has detectSessionInUrl: true, so during its
  // initialize() call it parses the hash, calls setSession(), and the user
  // is authenticated before any React component mounts.  This is the same
  // mechanism Supabase uses for OAuth redirect callbacks — no JS injection
  // timing issues, works on both Android and iOS.
  const webViewUrl = session
    ? `${SETTINGS_URL}#access_token=${encodeURIComponent(session.access_token)}&refresh_token=${encodeURIComponent(session.refresh_token)}&expires_in=${session.expires_in}&expires_at=${session.expires_at || Math.floor(Date.now() / 1000) + session.expires_in}&token_type=bearer`
    : SETTINGS_URL;

  // CSS & cleanup — runs AFTER page loads.
  // Hides site chrome and fixes layout for narrow mobile viewports.
  const injectedJavaScript = `
    (function() {
      try {
        // Hide the dark header div that sits between <nav> and <main>
        var main = document.querySelector('main');
        if (main) {
          var el = main.previousElementSibling;
          while (el) {
            el.style.display = 'none';
            el = el.previousElementSibling;
          }
        }

        var style = document.createElement('style');
        style.textContent = [
          /* --- hide site chrome --- */
          'nav, footer, .site-header, .site-footer, .site-nav { display: none !important; }',
          'body { padding-top: 0 !important; margin: 0 !important; }',

          /* --- full-width layout for WebView --- */
          'main { max-width: 100% !important; padding: 10px 10px 24px !important; margin-top: 0 !important; }',

          /* --- tighter card padding --- */
          'main > div { margin-bottom: 14px !important; }',
          'main > div > div:last-child { padding: 16px !important; }',
          'main > div > div:first-child { padding: 12px 16px !important; }',
          'main > div > div:first-child h3 { font-size: 16px !important; }',

          /* --- toggle rows: prevent label from pushing toggle off-screen --- */
          'main > div > div:last-child > div { gap: 8px !important; }',
          'main > div > div:last-child > div > div:first-child { min-width: 0; flex: 1 1 0%; }',
          'main > div > div:last-child > div > div:first-child h4 { font-size: 14px !important; word-break: break-word; }',
          'main > div > div:last-child > div > div:first-child p { font-size: 12px !important; word-break: break-word; }',

          /* --- day-selector checkboxes: tighter fit --- */
          'main label[style*="cursor: pointer"] { padding: 6px 8px !important; font-size: 13px !important; gap: 6px !important; }',

          /* --- renewal date / flex-wrap sections: stack on narrow screens --- */
          'main div[style*="flex-wrap: wrap"] { gap: 8px !important; }',
          'main div[style*="flex: 1 1"] { flex: 1 1 100% !important; }',

          /* --- inputs inside cards --- */
          'main input, main select { font-size: 14px !important; padding: 8px 10px !important; }',
        ].join(' ');
        document.head.appendChild(style);
      } catch(e) { console.error('Injection error:', e); }
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
          ref={webViewRef}
          source={{ uri: webViewUrl }}
          style={styles.webView}
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
