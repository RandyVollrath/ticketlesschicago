/**
 * AnalyticsService
 *
 * Firebase Analytics tracking for user engagement, screen views, and key events.
 * Automatically tracks sessions; this service adds custom event and user tracking.
 *
 * Firebase Analytics auto-tracks:
 * - first_open, session_start, app_update, os_update
 * - screen_view (when logScreenView is called)
 *
 * This service adds:
 * - User identification (setUserId, setUserProperties)
 * - Screen view logging
 * - Custom events for key user actions
 */

import Logger from '../utils/Logger';
import Config from '../config/config';

const log = Logger.createLogger('Analytics');

interface FirebaseAnalyticsInstance {
  logEvent: (name: string, params?: Record<string, any>) => Promise<void>;
  logScreenView: (params: { screen_name: string; screen_class?: string }) => Promise<void>;
  setUserId: (id: string | null) => Promise<void>;
  setUserProperties: (properties: Record<string, string | null>) => Promise<void>;
  setUserProperty: (name: string, value: string | null) => Promise<void>;
  setAnalyticsCollectionEnabled: (enabled: boolean) => Promise<void>;
}

let analytics: FirebaseAnalyticsInstance | null = null;

async function loadAnalytics(): Promise<void> {
  if (!Config.ENABLE_ANALYTICS) {
    log.info('Analytics disabled in config (dev mode)');
    return;
  }

  try {
    const firebaseAnalytics = await import('@react-native-firebase/analytics');
    analytics = firebaseAnalytics.default();
    log.info('Firebase Analytics loaded successfully');
  } catch (error) {
    log.warn('Firebase Analytics not available:', error);
    analytics = null;
  }
}

class AnalyticsServiceClass {
  private isInitialized = false;
  private currentScreen: string | null = null;

  /**
   * Initialize analytics — call once at app startup
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await loadAnalytics();
    this.isInitialized = true;

    if (analytics) {
      log.info('AnalyticsService initialized');
    }
  }

  /**
   * Set the current user ID for all future events
   */
  async setUserId(userId: string | null): Promise<void> {
    try {
      if (analytics) {
        await analytics.setUserId(userId);
        log.debug('User ID set:', userId ? '[set]' : '[cleared]');
      }
    } catch (error) {
      log.warn('Failed to set user ID:', error);
    }
  }

  /**
   * Set user properties for segmentation in Firebase Console
   */
  async setUserProperties(properties: Record<string, string | null>): Promise<void> {
    try {
      if (analytics) {
        await analytics.setUserProperties(properties);
        log.debug('User properties set:', Object.keys(properties));
      }
    } catch (error) {
      log.warn('Failed to set user properties:', error);
    }
  }

  /**
   * Log a screen view — call when navigating to a new screen
   */
  async logScreenView(screenName: string): Promise<void> {
    if (screenName === this.currentScreen) return; // deduplicate
    this.currentScreen = screenName;

    try {
      if (analytics) {
        await analytics.logScreenView({
          screen_name: screenName,
          screen_class: screenName,
        });
      }
    } catch (error) {
      log.warn('Failed to log screen view:', error);
    }
  }

  /**
   * Log a custom event
   */
  async logEvent(name: string, params?: Record<string, any>): Promise<void> {
    try {
      if (analytics) {
        await analytics.logEvent(name, params);
        log.debug('Event logged:', name);
      }
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
  async logParkingDetected(source: string): Promise<void> {
    await this.logEvent('parking_detected', { source });
  }

  async logDepartureDetected(): Promise<void> {
    await this.logEvent('departure_detected');
  }

  /** Camera alert fired */
  async logCameraAlert(cameraType: string): Promise<void> {
    await this.logEvent('camera_alert', { camera_type: cameraType });
  }

  /** Bluetooth car connected/disconnected */
  async logCarConnection(connected: boolean): Promise<void> {
    await this.logEvent('car_connection', { connected });
  }

  /** User viewed their parking history */
  async logViewParkingHistory(count: number): Promise<void> {
    await this.logEvent('view_parking_history', { item_count: count });
  }

  /** App opened / foregrounded */
  async logAppOpen(): Promise<void> {
    await this.logEvent('app_open');
  }

  /**
   * Check if analytics is available
   */
  isAvailable(): boolean {
    return analytics !== null;
  }
}

// Export singleton
export const AnalyticsService = new AnalyticsServiceClass();
export default AnalyticsService;
