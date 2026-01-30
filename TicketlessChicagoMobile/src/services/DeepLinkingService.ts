import { Linking, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthService from './AuthService';
import Logger from '../utils/Logger';

const log = Logger.createLogger('DeepLinking');

// URL scheme for the app
const URL_SCHEME = 'autopilotamerica://';

// Deep link routes
export const DEEP_LINK_ROUTES = {
  AUTH_CALLBACK: 'auth/callback',
  AUTH_RESET_PASSWORD: 'auth/reset-password',
  PARKING_CHECK: 'parking/check',
  PARKING_HISTORY: 'parking/history',
} as const;

export type DeepLinkRoute = typeof DEEP_LINK_ROUTES[keyof typeof DEEP_LINK_ROUTES];

// Simple params type for URL query parameters
type URLParams = Record<string, string>;

interface DeepLinkHandler {
  route: string;
  handler: (params: URLParams, navigation?: any) => Promise<void>;
}

/**
 * Simple URL query string parser (works in React Native without polyfills)
 */
function parseQueryString(query: string): URLParams {
  const params: URLParams = {};
  if (!query) return params;

  // Remove leading ? or #
  const cleanQuery = query.replace(/^[?#]/, '');

  cleanQuery.split('&').forEach(part => {
    const [key, value] = part.split('=');
    if (key) {
      params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
    }
  });

  return params;
}

/**
 * Simple URL parser (works in React Native without polyfills)
 */
function parseUrl(url: string): { protocol: string; host: string; pathname: string; query: string; hash: string } {
  // Match URL components
  const match = url.match(/^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/);

  return {
    protocol: match?.[2] || '',
    host: match?.[4] || '',
    pathname: match?.[5] || '',
    query: match?.[7] || '',
    hash: match?.[9] || '',
  };
}

// Token validation regex (JWT format: 3 base64 parts separated by dots)
const JWT_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/**
 * Validate if a string looks like a valid JWT token
 */
function isValidToken(token: string | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  return JWT_REGEX.test(token);
}

/**
 * Validate and parse a coordinate string
 */
function parseCoordinate(value: string | undefined, min: number, max: number): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

class DeepLinkingServiceClass {
  private handlers: DeepLinkHandler[] = [];
  private navigationRef: any = null;
  private isInitialized = false;

  /**
   * Initialize deep linking service
   */
  async initialize(navigationRef?: any): Promise<() => void> {
    if (this.isInitialized) {
      return () => {}; // No-op cleanup
    }

    this.navigationRef = navigationRef;

    // Register default handlers
    this.registerDefaultHandlers();

    // Handle initial URL (app opened via deep link)
    const initialUrl = await Linking.getInitialURL();
    if (initialUrl) {
      log.debug('App opened with deep link', initialUrl);
      await this.handleUrl(initialUrl);
    }

    // Listen for incoming deep links
    const subscription = Linking.addEventListener('url', async (event) => {
      log.debug('Deep link received', event.url);
      await this.handleUrl(event.url);
    });

    this.isInitialized = true;
    log.info('Deep linking service initialized');

    // Return cleanup function (can be used in useEffect)
    return () => {
      subscription.remove();
    };
  }

  /**
   * Set navigation reference for deep link navigation
   */
  setNavigationRef(ref: any): void {
    this.navigationRef = ref;
  }

  /**
   * Register a custom deep link handler
   */
  registerHandler(route: string, handler: (params: URLParams, navigation?: any) => Promise<void>): void {
    this.handlers.push({ route, handler });
  }

  /**
   * Register default handlers for auth callbacks
   */
  private registerDefaultHandlers(): void {
    // Auth callback handler (magic link / OAuth)
    this.registerHandler(DEEP_LINK_ROUTES.AUTH_CALLBACK, async (params) => {
      log.debug('Handling auth callback');

      // Extract tokens from URL
      const accessToken = params.access_token;
      const refreshToken = params.refresh_token;
      const errorDescription = params.error_description;

      if (errorDescription) {
        log.error('Auth error', errorDescription);
        Alert.alert('Authentication Error', 'Failed to sign in. Please try again.');
        return;
      }

      // Validate token format before using
      if (!isValidToken(accessToken) || !isValidToken(refreshToken)) {
        log.error('Invalid token format in auth callback');
        Alert.alert('Authentication Error', 'Invalid authentication link. Please request a new one.');
        return;
      }

      // Set the session with the tokens
      try {
        const supabase = AuthService.getSupabaseClient();
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          log.error('Error setting session', error);
          Alert.alert('Authentication Error', 'Failed to complete sign in. Please try again.');
          return;
        }

        log.info('Auth session set successfully');

        // Mark as having seen login
        await AsyncStorage.setItem('hasSeenLogin', 'true');

        // Navigate to main app
        if (this.navigationRef?.isReady()) {
          this.navigationRef.reset({
            index: 0,
            routes: [{ name: 'MainTabs' }],
          });
        }
      } catch (error) {
        log.error('Error handling auth callback', error);
        Alert.alert('Error', 'Something went wrong. Please try again.');
      }
    });

    // Password reset handler
    this.registerHandler(DEEP_LINK_ROUTES.AUTH_RESET_PASSWORD, async (params) => {
      log.debug('Handling password reset callback');

      const accessToken = params.access_token;
      const refreshToken = params.refresh_token;
      const type = params.type;

      // Validate token format
      if (!isValidToken(accessToken) || !isValidToken(refreshToken)) {
        log.error('Invalid token format in password reset callback');
        Alert.alert('Error', 'Invalid password reset link. Please request a new one.');
        return;
      }

      if (type === 'recovery') {
        try {
          const supabase = AuthService.getSupabaseClient();
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            log.error('Error setting password reset session', error);
            Alert.alert('Error', 'Failed to complete password reset. Please try again.');
            return;
          }

          log.info('Password reset session established');

          // Navigate to main app - user is now authenticated and can change password in settings
          if (this.navigationRef?.isReady()) {
            Alert.alert(
              'Password Reset',
              'You are now signed in. You can update your password in your account settings.',
              [{ text: 'OK' }]
            );
            this.navigationRef.reset({
              index: 0,
              routes: [{ name: 'MainTabs' }],
            });
          }
        } catch (error) {
          log.error('Error handling password reset', error);
          Alert.alert('Error', 'Failed to complete password reset. Please try again.');
        }
      }
    });

    // Parking check handler
    this.registerHandler(DEEP_LINK_ROUTES.PARKING_CHECK, async (params) => {
      const lat = parseCoordinate(params.lat, -90, 90);
      const lng = parseCoordinate(params.lng, -180, 180);

      if (lat === null || lng === null) {
        log.warn('Invalid coordinates in parking check deep link', params);
        return;
      }

      if (this.navigationRef?.isReady()) {
        this.navigationRef.navigate('MainTabs', {
          screen: 'Map',
          params: {
            latitude: lat,
            longitude: lng,
          },
        });
      }
    });

    // Parking history handler
    this.registerHandler(DEEP_LINK_ROUTES.PARKING_HISTORY, async () => {
      if (this.navigationRef?.isReady()) {
        this.navigationRef.navigate('MainTabs', {
          screen: 'History',
        });
      }
    });
  }

  /**
   * Handle a deep link URL
   */
  async handleUrl(url: string): Promise<boolean> {
    try {
      let path = '';
      let params: URLParams = {};

      // Handle custom schemes (autopilotamerica:// or ticketlesschicago://)
      if (url.startsWith(URL_SCHEME) || url.startsWith('ticketlesschicago://')) {
        const scheme = url.startsWith(URL_SCHEME) ? URL_SCHEME : 'ticketlesschicago://';
        const withoutScheme = url.substring(scheme.length);
        const [pathPart, queryPart] = withoutScheme.split('?');
        path = pathPart;
        params = parseQueryString(queryPart || '');

        // Also parse hash fragment for OAuth callbacks
        const hashIndex = (queryPart || '').indexOf('#');
        if (hashIndex !== -1) {
          const hashPart = (queryPart || '').substring(hashIndex + 1);
          params = { ...params, ...parseQueryString(hashPart) };
        }
      }
      // Handle https scheme
      else if (url.startsWith('https://') || url.startsWith('http://')) {
        const parsed = parseUrl(url);
        path = parsed.pathname.replace(/^\//, ''); // Remove leading slash

        // Parse query params
        params = parseQueryString(parsed.query);

        // Also check hash for Supabase auth callbacks (they use fragment)
        if (parsed.hash) {
          const hashParams = parseQueryString(parsed.hash);
          params = { ...params, ...hashParams };
        }
      }

      log.debug('Parsed deep link', { path });

      // Find and execute matching handler
      for (const { route, handler } of this.handlers) {
        if (path.startsWith(route) || path === route) {
          await handler(params, this.navigationRef);
          return true;
        }
      }

      log.debug('No handler found for path', path);
      return false;
    } catch (error) {
      log.error('Error handling deep link', error);
      return false;
    }
  }

  /**
   * Generate a deep link URL
   */
  generateDeepLink(route: DeepLinkRoute, params?: Record<string, string>): string {
    let url = `${URL_SCHEME}${route}`;
    if (params && Object.keys(params).length > 0) {
      const queryString = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      url += `?${queryString}`;
    }
    return url;
  }

  /**
   * Check if the app can open a URL
   */
  async canOpenUrl(url: string): Promise<boolean> {
    try {
      return await Linking.canOpenURL(url);
    } catch (error) {
      log.error('Error checking if URL can be opened', error);
      return false;
    }
  }

  /**
   * Open an external URL
   */
  async openUrl(url: string): Promise<boolean> {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return true;
      } else {
        log.warn('Cannot open URL', url);
        return false;
      }
    } catch (error) {
      log.error('Error opening URL', error);
      return false;
    }
  }

  /**
   * Get the linking configuration for React Navigation
   */
  getLinkingConfig() {
    return {
      prefixes: [URL_SCHEME, 'ticketlesschicago://', 'https://autopilotamerica.com'],
      config: {
        screens: {
          Onboarding: 'onboarding',
          Login: 'login',
          MainTabs: {
            screens: {
              Home: 'home',
              Map: 'map',
              History: 'history',
              Profile: 'profile',
            },
          },
          BluetoothSettings: 'settings/bluetooth',
        },
      },
    };
  }
}

export default new DeepLinkingServiceClass();
