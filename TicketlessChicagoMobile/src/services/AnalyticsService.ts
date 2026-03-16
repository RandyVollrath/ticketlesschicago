/**
 * AnalyticsService
 *
 * Dual-provider analytics: Firebase Analytics + PostHog.
 * Firebase handles mobile-native events (sessions, screen views, crash correlation).
 * PostHog provides product analytics visible on the same dashboard as the web app.
 *
 * Every event is sent to BOTH providers so we have redundancy and can query
 * either system. PostHog is the primary product analytics tool.
 */

import { Platform } from 'react-native';
import Logger from '../utils/Logger';
import Config from '../config/config';

const log = Logger.createLogger('Analytics');

// ── PostHog Configuration ──
// Same project as the web app so mobile + web events appear together
const POSTHOG_API_KEY = 'phc_3s7oTxBY3lqd5DQ76Pz0b0jzaiWs00Dt6mwzRkhwCQp';
const POSTHOG_HOST = 'https://us.i.posthog.com';

// ── Firebase Analytics interface ──
interface FirebaseAnalyticsInstance {
  logEvent: (name: string, params?: Record<string, any>) => Promise<void>;
  logScreenView: (params: { screen_name: string; screen_class?: string }) => Promise<void>;
  setUserId: (id: string | null) => Promise<void>;
  setUserProperties: (properties: Record<string, string | null>) => Promise<void>;
  setUserProperty: (name: string, value: string | null) => Promise<void>;
  setAnalyticsCollectionEnabled: (enabled: boolean) => Promise<void>;
}

let firebaseAnalytics: FirebaseAnalyticsInstance | null = null;

// ── PostHog instance ──
// Use dynamic import so the PostHog class is the constructor, not a namespace
let posthogClient: any = null;

async function loadFirebaseAnalytics(): Promise<void> {
  try {
    const firebaseModule = await import('@react-native-firebase/analytics');
    firebaseAnalytics = firebaseModule.default();
    log.info('Firebase Analytics loaded');
  } catch (error) {
    log.warn('Firebase Analytics not available:', error);
    firebaseAnalytics = null;
  }
}

async function loadPostHog(): Promise<void> {
  try {
    const PostHogModule = await import('posthog-react-native');
    const PostHog = PostHogModule.default;
    posthogClient = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      // Capture app lifecycle events (install, update, open, background)
      captureAppLifecycleEvents: true,
      // Send events promptly — small user base, telemetry is critical
      flushAt: 5,
      flushInterval: 15000, // 15 seconds
    });
    log.info('PostHog loaded (project: us.posthog.com)');
  } catch (error) {
    log.warn('PostHog not available:', error);
    posthogClient = null;
  }
}

class AnalyticsServiceClass {
  private isInitialized = false;
  private currentScreen: string | null = null;

  /**
   * Initialize both analytics providers — call once at app startup
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!Config.ENABLE_ANALYTICS) {
      log.info('Analytics disabled in config (dev mode)');
      this.isInitialized = true;
      return;
    }

    // Load both providers in parallel
    await Promise.all([
      loadFirebaseAnalytics(),
      loadPostHog(),
    ]);

    this.isInitialized = true;
    log.info(`AnalyticsService initialized (firebase=${!!firebaseAnalytics}, posthog=${!!posthogClient})`);
  }

  // ── User Identification ──

  /**
   * Set the current user ID for all future events.
   * PostHog uses identify(); Firebase uses setUserId().
   */
  async setUserId(userId: string | null): Promise<void> {
    try {
      if (firebaseAnalytics) {
        await firebaseAnalytics.setUserId(userId);
      }
      if (posthogClient && userId) {
        posthogClient.identify(userId, {
          platform: Platform.OS,
          app_version: Config.APP_VERSION,
          build_number: Config.BUILD_NUMBER,
        });
      } else if (posthogClient && !userId) {
        posthogClient.reset();
      }
      log.debug('User ID set:', userId ? '[set]' : '[cleared]');
    } catch (error) {
      log.warn('Failed to set user ID:', error);
    }
  }

  /**
   * Set user properties for segmentation
   */
  async setUserProperties(properties: Record<string, string | null>): Promise<void> {
    try {
      if (firebaseAnalytics) {
        await firebaseAnalytics.setUserProperties(properties);
      }
      if (posthogClient) {
        // PostHog uses $set for person properties
        const setProps: Record<string, any> = {};
        for (const [key, value] of Object.entries(properties)) {
          if (value !== null) setProps[key] = value;
        }
        if (Object.keys(setProps).length > 0) {
          posthogClient.capture('$set', { $set: setProps });
        }
      }
      log.debug('User properties set:', Object.keys(properties));
    } catch (error) {
      log.warn('Failed to set user properties:', error);
    }
  }

  // ── Screen Views ──

  /**
   * Log a screen view — call when navigating to a new screen
   */
  async logScreenView(screenName: string): Promise<void> {
    if (screenName === this.currentScreen) return; // deduplicate
    this.currentScreen = screenName;

    try {
      if (firebaseAnalytics) {
        await firebaseAnalytics.logScreenView({
          screen_name: screenName,
          screen_class: screenName,
        });
      }
      if (posthogClient) {
        posthogClient.screen(screenName, {
          platform: Platform.OS,
        });
      }
    } catch (error) {
      log.warn('Failed to log screen view:', error);
    }
  }

  // ── Generic Event ──

  /**
   * Log a custom event to both Firebase and PostHog
   */
  async logEvent(name: string, params?: Record<string, any>): Promise<void> {
    try {
      // Add platform to all PostHog events for easy filtering
      const posthogParams = {
        ...params,
        platform: Platform.OS,
        app_version: Config.APP_VERSION,
      };

      if (firebaseAnalytics) {
        await firebaseAnalytics.logEvent(name, params);
      }
      if (posthogClient) {
        posthogClient.capture(name, posthogParams);
      }
      log.debug('Event logged:', name);
    } catch (error) {
      log.warn('Failed to log event:', error);
    }
  }

  // ── Convenience methods for key app events ──

  /** User signed up or logged in */
  async logLogin(method: string): Promise<void> {
    await this.logEvent('login', { method });
  }

  async logSignUp(method: string): Promise<void> {
    await this.logEvent('sign_up', { method });
  }

  /** User checked a destination/address */
  async logAddressCheck(address: string, hasResults: boolean): Promise<void> {
    await this.logEvent('address_check', {
      has_results: hasResults,
      // Don't log full address for privacy — just whether it worked
    });
  }

  /** User toggled a setting */
  async logSettingChanged(setting: string, value: boolean | string): Promise<void> {
    await this.logEvent('setting_changed', {
      setting_name: setting,
      setting_value: String(value),
    });
  }

  /** Parking detection events */
  async logParkingDetected(source: string, params?: Record<string, any>): Promise<void> {
    await this.logEvent('parking_detected', { source, ...params });
  }

  async logDepartureDetected(params?: Record<string, any>): Promise<void> {
    await this.logEvent('departure_detected', params);
  }

  /** Camera alert fired — critical for measuring camera alert reliability */
  async logCameraAlert(cameraType: string, params?: Record<string, any>): Promise<void> {
    await this.logEvent('camera_alert_fired', { camera_type: cameraType, ...params });
  }

  /** Native camera alert fired (from native iOS/Android code via JS bridge) */
  async logNativeCameraAlert(params: Record<string, any>): Promise<void> {
    await this.logEvent('native_camera_alert_fired', params);
  }

  /** Bluetooth car connected/disconnected */
  async logCarConnection(connected: boolean, params?: Record<string, any>): Promise<void> {
    await this.logEvent('car_connection', { connected, ...params });
  }

  /** User viewed their parking history */
  async logViewParkingHistory(count: number): Promise<void> {
    await this.logEvent('view_parking_history', { item_count: count });
  }

  /** App opened / foregrounded */
  async logAppOpen(): Promise<void> {
    await this.logEvent('app_open');
  }

  /** Driving started (CoreMotion/BT) */
  async logDrivingStarted(source: string): Promise<void> {
    await this.logEvent('driving_started', { source });
  }

  /** Background monitoring started/stopped */
  async logMonitoringChanged(enabled: boolean): Promise<void> {
    await this.logEvent('monitoring_changed', { enabled });
  }

  /**
   * Force flush any queued PostHog events
   * Call this before the app is about to be killed or backgrounded
   */
  async flush(): Promise<void> {
    try {
      if (posthogClient) {
        await posthogClient.flush();
      }
    } catch (error) {
      log.warn('PostHog flush failed:', error);
    }
  }

  /**
   * Check if analytics is available
   */
  isAvailable(): boolean {
    return firebaseAnalytics !== null || posthogClient !== null;
  }

  /**
   * Check if PostHog specifically is available
   */
  isPostHogAvailable(): boolean {
    return posthogClient !== null;
  }
}

// Export singleton
export const AnalyticsService = new AnalyticsServiceClass();
export default AnalyticsService;
