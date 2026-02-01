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

  // Build the injected JS - pass the full session so the website's
  // Supabase client can use it (including refresh_token)
  const sessionJson = session ? JSON.stringify(session).replace(/'/g, "\\'") : '';

  const injectedJavaScript = session
    ? `
      (function() {
        try {
          var key = 'sb-dzhqolbhuqdcpngdayuq-auth-token';
          var existing = localStorage.getItem(key);
          if (!existing) {
            localStorage.setItem(key, '${sessionJson}');
            window.location.reload();
          }

          // Hide site navigation/header/footer for cleaner in-app experience
          var style = document.createElement('style');
          style.textContent = 'nav, header, footer, .site-header, .site-footer, .site-nav { display: none !important; } body { padding-top: 0 !important; }';
          document.head.appendChild(style);

          // Scroll to notification preferences section if visible
          setTimeout(function() {
            var el = document.querySelector('[data-section="notifications"]');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }, 1500);
        } catch(e) { console.error('Injection error:', e); }
      })();
      true;
    `
    : `
      (function() {
        try {
          var style = document.createElement('style');
          style.textContent = 'nav, header, footer, .site-header, .site-footer, .site-nav { display: none !important; } body { padding-top: 0 !important; }';
          document.head.appendChild(style);
        } catch(e) {}
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
            accessibilityLabel="Refresh"
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
        <View style={styles.errorContainer}>
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
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: SETTINGS_URL }}
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
