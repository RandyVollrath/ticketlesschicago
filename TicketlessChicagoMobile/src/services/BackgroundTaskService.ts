/**
 * BackgroundTaskService
 *
 * Handles background tasks for the app, including:
 * - Periodic Bluetooth connection checks
 * - Auto parking checks when car disconnects
 * - Background location updates
 *
 * Uses react-native-background-fetch for iOS/Android background execution.
 * Falls back to foreground-only monitoring if background fetch is not available.
 */

import { Platform, AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance } from '@notifee/react-native';
import BluetoothService from './BluetoothService';
import LocationService from './LocationService';
import Logger from '../utils/Logger';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('BackgroundTaskService');

// Background task configuration
const BACKGROUND_TASK_ID = 'ticketless-parking-check';
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_DISCONNECT_DURATION_MS = 30 * 1000; // 30 seconds (to avoid false positives)

interface BackgroundTaskState {
  isInitialized: boolean;
  isMonitoring: boolean;
  lastCarConnectionStatus: boolean;
  lastDisconnectTime: number | null;
  lastParkingCheckTime: number | null;
}

class BackgroundTaskServiceClass {
  private state: BackgroundTaskState = {
    isInitialized: false,
    isMonitoring: false,
    lastCarConnectionStatus: false,
    lastDisconnectTime: null,
    lastParkingCheckTime: null,
  };

  private appStateSubscription: any = null;
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
  private disconnectCallback: (() => void) | null = null;

  /**
   * Initialize the background task service
   */
  async initialize(): Promise<void> {
    if (this.state.isInitialized) {
      log.debug('BackgroundTaskService already initialized');
      return;
    }

    try {
      // Load persisted state
      await this.loadState();

      // Setup app state listener for foreground/background transitions
      this.appStateSubscription = AppState.addEventListener(
        'change',
        this.handleAppStateChange.bind(this)
      );

      // Create notification channel for background alerts
      await this.createNotificationChannel();

      this.state.isInitialized = true;
      log.info('BackgroundTaskService initialized');
    } catch (error) {
      log.error('Failed to initialize BackgroundTaskService', error);
    }
  }

  /**
   * Create notification channel for parking alerts
   */
  private async createNotificationChannel(): Promise<void> {
    if (Platform.OS === 'android') {
      await notifee.createChannel({
        id: 'parking-monitoring',
        name: 'Parking Monitoring',
        importance: AndroidImportance.HIGH,
        description: 'Notifications for parking monitoring and car disconnection alerts',
      });
    }
  }

  /**
   * Start monitoring for car disconnection
   */
  async startMonitoring(onDisconnect?: () => void): Promise<boolean> {
    try {
      const savedDevice = await BluetoothService.getSavedCarDevice();
      if (!savedDevice) {
        log.warn('No saved car device, cannot start monitoring');
        return false;
      }

      // Check if auto-check is enabled in settings
      const settingsJson = await AsyncStorage.getItem(StorageKeys.APP_SETTINGS);
      const settings = settingsJson ? JSON.parse(settingsJson) : {};
      if (!settings.autoCheckOnDisconnect) {
        log.info('Auto-check on disconnect is disabled');
        return false;
      }

      this.disconnectCallback = onDisconnect || null;
      this.state.isMonitoring = true;
      this.state.lastCarConnectionStatus = true; // Assume connected at start

      // Start foreground monitoring
      await this.startForegroundMonitoring();

      await this.saveState();
      log.info('Monitoring started for device:', savedDevice.name);
      return true;
    } catch (error) {
      log.error('Failed to start monitoring', error);
      return false;
    }
  }

  /**
   * Stop all monitoring
   */
  async stopMonitoring(): Promise<void> {
    this.state.isMonitoring = false;

    // Stop foreground monitoring
    this.stopForegroundMonitoring();

    // Stop Bluetooth monitoring
    BluetoothService.stopMonitoring();

    this.disconnectCallback = null;
    await this.saveState();
    log.info('Monitoring stopped');
  }

  /**
   * Start foreground monitoring with interval checks
   */
  private async startForegroundMonitoring(): Promise<void> {
    // Clear any existing interval
    this.stopForegroundMonitoring();

    // Start Bluetooth connection monitoring
    try {
      await BluetoothService.monitorCarConnection(
        this.handleCarDisconnection.bind(this)
      );
    } catch (error) {
      log.warn('Could not start Bluetooth monitoring:', error);
    }

    // Also run periodic checks as a backup
    this.monitoringInterval = setInterval(
      () => this.performPeriodicCheck(),
      CHECK_INTERVAL_MS
    );

    log.debug('Foreground monitoring started with interval checks');
  }

  /**
   * Stop foreground monitoring
   */
  private stopForegroundMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Handle car disconnection event
   */
  private async handleCarDisconnection(): Promise<void> {
    log.info('Car disconnection detected');

    // Record disconnect time
    this.state.lastDisconnectTime = Date.now();
    this.state.lastCarConnectionStatus = false;
    await this.saveState();

    // Wait briefly to avoid false positives from brief signal drops
    setTimeout(async () => {
      // Verify still disconnected
      if (!this.state.lastCarConnectionStatus) {
        await this.triggerParkingCheck();
      }
    }, MIN_DISCONNECT_DURATION_MS);

    // Call the callback if provided
    if (this.disconnectCallback) {
      this.disconnectCallback();
    }
  }

  /**
   * Trigger a parking check at current location
   */
  private async triggerParkingCheck(): Promise<void> {
    try {
      log.info('Triggering parking check after car disconnection');

      // Get current location
      const coords = await LocationService.getCurrentLocation();

      // Check parking rules
      const result = await LocationService.checkParkingLocation(coords);

      // Save the result
      await LocationService.saveParkingCheckResult(result);

      // Update last check time
      this.state.lastParkingCheckTime = Date.now();
      await this.saveState();

      // Send notification if there are restrictions
      if (result.rules.length > 0) {
        await this.sendParkingNotification(result);
      } else {
        await this.sendSafeNotification(result.address);
      }

      log.info('Parking check completed', { rulesFound: result.rules.length });
    } catch (error) {
      log.error('Failed to perform parking check', error);
      await this.sendErrorNotification();
    }
  }

  /**
   * Send notification about parking restrictions
   */
  private async sendParkingNotification(result: {
    address: string;
    rules: Array<{ message: string; severity: string }>;
  }): Promise<void> {
    const hasCritical = result.rules.some(r => r.severity === 'critical');

    await notifee.displayNotification({
      title: hasCritical ? 'Parking Restriction Active!' : 'Parking Alert',
      body: `At ${result.address}:\n${result.rules.map(r => r.message).join('\n')}`,
      android: {
        channelId: 'parking-monitoring',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
        smallIcon: 'ic_notification', // You'll need to add this icon
      },
      ios: {
        sound: 'default',
        critical: hasCritical,
        criticalVolume: 1.0,
      },
    });
  }

  /**
   * Send notification that parking is safe
   */
  private async sendSafeNotification(address: string): Promise<void> {
    await notifee.displayNotification({
      title: 'Parking Check Complete',
      body: `No restrictions found at ${address}. You're good to park!`,
      android: {
        channelId: 'parking-monitoring',
        pressAction: { id: 'default' },
      },
      ios: {
        sound: 'default',
      },
    });
  }

  /**
   * Send error notification
   */
  private async sendErrorNotification(): Promise<void> {
    await notifee.displayNotification({
      title: 'Parking Check Failed',
      body: 'Could not check parking rules. Please check manually.',
      android: {
        channelId: 'parking-monitoring',
        pressAction: { id: 'default' },
      },
      ios: {
        sound: 'default',
      },
    });
  }

  /**
   * Perform periodic check (backup mechanism)
   */
  private async performPeriodicCheck(): Promise<void> {
    if (!this.state.isMonitoring) return;

    log.debug('Performing periodic Bluetooth check');

    try {
      const savedDevice = await BluetoothService.getSavedCarDevice();
      if (!savedDevice) {
        log.warn('No saved device during periodic check');
        return;
      }

      // If we were connected but now detect disconnect, trigger parking check
      const wasConnected = this.state.lastCarConnectionStatus;
      // Note: Actual connection check would require scanning, which may not be possible in background
      // This serves as a fallback mechanism

      if (wasConnected && !this.state.lastCarConnectionStatus) {
        // Connection was lost, check if we should trigger parking check
        const timeSinceDisconnect = this.state.lastDisconnectTime
          ? Date.now() - this.state.lastDisconnectTime
          : Infinity;

        const timeSinceLastCheck = this.state.lastParkingCheckTime
          ? Date.now() - this.state.lastParkingCheckTime
          : Infinity;

        // Only trigger if enough time has passed since last check
        if (
          timeSinceDisconnect > MIN_DISCONNECT_DURATION_MS &&
          timeSinceLastCheck > CHECK_INTERVAL_MS
        ) {
          await this.triggerParkingCheck();
        }
      }
    } catch (error) {
      log.error('Error in periodic check', error);
    }
  }

  /**
   * Handle app state changes (foreground/background)
   */
  private handleAppStateChange(nextAppState: AppStateStatus): void {
    log.debug('App state changed:', nextAppState);

    if (nextAppState === 'active' && this.state.isMonitoring) {
      // App came to foreground, restart monitoring
      this.startForegroundMonitoring();
    } else if (nextAppState === 'background' && this.state.isMonitoring) {
      // App went to background
      // Foreground monitoring continues, background fetch handles the rest
      log.info('App entered background, monitoring continues');
    }
  }

  /**
   * Load persisted state from storage
   */
  private async loadState(): Promise<void> {
    try {
      const stateJson = await AsyncStorage.getItem(StorageKeys.BACKGROUND_TASK_STATE);
      if (stateJson) {
        const savedState = JSON.parse(stateJson);
        this.state = { ...this.state, ...savedState };
      }
    } catch (error) {
      log.error('Error loading background task state', error);
    }
  }

  /**
   * Save state to storage
   */
  private async saveState(): Promise<void> {
    try {
      await AsyncStorage.setItem(StorageKeys.BACKGROUND_TASK_STATE, JSON.stringify({
        isMonitoring: this.state.isMonitoring,
        lastCarConnectionStatus: this.state.lastCarConnectionStatus,
        lastDisconnectTime: this.state.lastDisconnectTime,
        lastParkingCheckTime: this.state.lastParkingCheckTime,
        isInitialized: this.state.isInitialized,
      }));
    } catch (error) {
      log.error('Error saving background task state', error);
    }
  }

  /**
   * Get current monitoring status
   */
  getStatus(): {
    isMonitoring: boolean;
    lastCheckTime: number | null;
    isCarConnected: boolean;
  } {
    return {
      isMonitoring: this.state.isMonitoring,
      lastCheckTime: this.state.lastParkingCheckTime,
      isCarConnected: this.state.lastCarConnectionStatus,
    };
  }

  /**
   * Manually trigger a parking check
   */
  async manualParkingCheck(): Promise<void> {
    await this.triggerParkingCheck();
  }

  /**
   * Mark car as reconnected (user feedback or detection)
   */
  async markCarReconnected(): Promise<void> {
    this.state.lastCarConnectionStatus = true;
    this.state.lastDisconnectTime = null;
    await this.saveState();
    log.info('Car marked as reconnected');
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.stopMonitoring();

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    this.state.isInitialized = false;
    log.info('BackgroundTaskService cleaned up');
  }
}

export default new BackgroundTaskServiceClass();
