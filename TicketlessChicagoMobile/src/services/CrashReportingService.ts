/**
 * CrashReportingService
 *
 * Provides crash reporting and analytics functionality.
 * Uses Firebase Crashlytics when available, with graceful fallback.
 *
 * Setup required:
 * 1. Install: npm install @react-native-firebase/app @react-native-firebase/crashlytics
 * 2. Add GoogleService-Info.plist (iOS) and google-services.json (Android)
 * 3. Configure native projects per Firebase setup guide
 */

import Logger from '../utils/Logger';
import Config from '../config/config';

const log = Logger.createLogger('CrashReporting');

// Crashlytics interface (matches @react-native-firebase/crashlytics API)
interface CrashlyticsInstance {
  log: (message: string) => void;
  recordError: (error: Error, jsErrorName?: string) => void;
  setUserId: (userId: string) => Promise<null>;
  setAttribute: (key: string, value: string) => Promise<null>;
  setAttributes: (attributes: Record<string, string>) => Promise<null>;
  crash: () => void;
  setCrashlyticsCollectionEnabled: (enabled: boolean) => Promise<null>;
}

let crashlytics: CrashlyticsInstance | null = null;

// Try to load Firebase Crashlytics
async function loadCrashlytics(): Promise<void> {
  if (!Config.ENABLE_CRASH_REPORTING) {
    log.info('Crash reporting is disabled in config');
    return;
  }

  try {
    // Dynamic import to avoid errors if Firebase is not installed
    const firebaseCrashlytics = await import('@react-native-firebase/crashlytics');
    crashlytics = firebaseCrashlytics.default();
    log.info('Firebase Crashlytics loaded successfully');
  } catch (error) {
    log.warn('Firebase Crashlytics not available. Crash reporting disabled.', error);
    crashlytics = null;
  }
}

class CrashReportingServiceClass {
  private isInitialized = false;
  private pendingLogs: string[] = [];
  private userId: string | null = null;

  /**
   * Initialize the crash reporting service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await loadCrashlytics();

    // Flush any pending logs
    if (crashlytics && this.pendingLogs.length > 0) {
      this.pendingLogs.forEach(msg => crashlytics?.log(msg));
      this.pendingLogs = [];
    }

    // Restore user ID if set
    if (crashlytics && this.userId) {
      await crashlytics.setUserId(this.userId);
    }

    this.isInitialized = true;
    log.info('CrashReportingService initialized');
  }

  /**
   * Log a message (appears in crash reports)
   */
  logMessage(message: string): void {
    if (crashlytics) {
      crashlytics.log(message);
    } else if (this.pendingLogs.length < 100) {
      // Queue logs until Crashlytics is initialized (max 100)
      this.pendingLogs.push(message);
    }
  }

  /**
   * Record a non-fatal error
   */
  recordError(error: Error, context?: string): void {
    // Always log locally
    log.error(`[CrashReport] ${context || 'Error'}`, error);

    if (crashlytics) {
      if (context) {
        crashlytics.log(`Context: ${context}`);
      }
      crashlytics.recordError(error, context);
    }
  }

  /**
   * Record an error from a caught exception
   */
  recordException(
    error: unknown,
    context?: string
  ): void {
    const normalizedError =
      error instanceof Error
        ? error
        : new Error(String(error));

    this.recordError(normalizedError, context);
  }

  /**
   * Set user identifier for crash reports
   */
  async setUser(userId: string | null): Promise<void> {
    this.userId = userId;

    if (crashlytics && userId) {
      await crashlytics.setUserId(userId);
    }
  }

  /**
   * Set custom attribute for crash reports
   */
  async setAttribute(key: string, value: string): Promise<void> {
    if (crashlytics) {
      await crashlytics.setAttribute(key, value);
    }
  }

  /**
   * Set multiple custom attributes
   */
  async setAttributes(attributes: Record<string, string>): Promise<void> {
    if (crashlytics) {
      await crashlytics.setAttributes(attributes);
    }
  }

  /**
   * Log a breadcrumb event
   */
  logBreadcrumb(
    category: string,
    message: string,
    data?: Record<string, any>
  ): void {
    const breadcrumb = `[${category}] ${message}${data ? ': ' + JSON.stringify(data) : ''}`;
    this.logMessage(breadcrumb);
    log.debug('Breadcrumb:', breadcrumb);
  }

  /**
   * Log a navigation event
   */
  logNavigation(screenName: string, params?: Record<string, any>): void {
    this.logBreadcrumb('Navigation', `Navigated to ${screenName}`, params);
  }

  /**
   * Log a user action
   */
  logAction(action: string, details?: Record<string, any>): void {
    this.logBreadcrumb('Action', action, details);
  }

  /**
   * Log an API call
   */
  logApiCall(method: string, endpoint: string, status?: number): void {
    this.logBreadcrumb('API', `${method} ${endpoint}`, { status });
  }

  /**
   * Test crash (for testing crash reporting setup)
   * WARNING: This will crash the app!
   */
  testCrash(): void {
    if (__DEV__) {
      log.warn('Test crash triggered in development mode');
      if (crashlytics) {
        crashlytics.crash();
      } else {
        throw new Error('Test crash - Crashlytics not available');
      }
    } else {
      log.warn('Test crash disabled in production');
    }
  }

  /**
   * Enable or disable crash reporting
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (crashlytics) {
      await crashlytics.setCrashlyticsCollectionEnabled(enabled);
      log.info(`Crash reporting ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Check if crash reporting is available
   */
  isAvailable(): boolean {
    return crashlytics !== null;
  }
}

// Export singleton instance
export const CrashReporting = new CrashReportingServiceClass();

export default CrashReporting;
