/**
 * BackgroundLocationService
 *
 * iOS-only service that uses CLLocationManager with:
 * - significantLocationChange monitoring (wakes app from background)
 * - Continuous location updates (tracks position while running)
 * - CoreMotion integration (distinguishes driving from walking)
 *
 * Detection flow:
 * 1. App starts background location monitoring
 * 2. iOS keeps app alive with continuous location updates
 * 3. CoreMotion + speed detect when user transitions from driving to stopped
 * 4. After 90 seconds stopped (not a red light), parking is confirmed
 * 5. Event fires to BackgroundTaskService which does parking rule check
 *
 * The significantLocationChange is a backup - if iOS kills the app,
 * it will wake it back up on next ~100-500m location change.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import Logger from '../utils/Logger';

const log = Logger.createLogger('BackgroundLocationService');

// Native module (iOS only)
const { BackgroundLocationModule } = NativeModules;

export type PermissionStatus = 'always' | 'when_in_use' | 'not_determined' | 'denied' | 'restricted' | 'unknown';

export interface ParkingDetectedEvent {
  timestamp: number;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  drivingDurationSec?: number;
  detectionSource?: string;
  locationSource?: 'stop_start' | 'last_driving' | 'last_high_speed' | 'current_fallback' | 'current_refined' | 'stale_retry_candidate' | 'short_drive_recovery' | 'recovery_accurate_gps';
  driftFromParkingMeters?: number;  // How far user walked from car before confirmation
}

export interface LocationUpdateEvent {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  /** Heading in degrees (0-360), -1 if unavailable. iOS: CLLocation.course */
  heading: number;
  timestamp: number;
}

export interface BackgroundLocationStatus {
  isMonitoring: boolean;
  isDriving: boolean;
  hasAlwaysPermission: boolean;
  motionAvailable: boolean;
  motionAuthStatus?: 'authorized' | 'denied' | 'restricted' | 'notDetermined' | 'unknown';
  gpsOnlyMode?: boolean;
  backgroundRefreshStatus?: 'available' | 'denied' | 'restricted' | 'unknown';
  lowPowerModeEnabled?: boolean;
  notificationsAuthorized?: boolean;
  vehicleSignalConnected?: boolean;
  recentVehicleSignal?: boolean;
  parkingFinalizationPending?: boolean;
  queueActive?: boolean;
  queueAgeSec?: number | null;
  speedZeroAgeSec?: number | null;
  coreMotionUnknownAgeSec?: number | null;
  coreMotionNonAutoAgeSec?: number | null;
  heartbeatActive?: boolean;
  healthRecoveryCount?: number;
  drivingDurationSec?: number;
  lastDrivingLat?: number;
  lastDrivingLng?: number;
  lastLocationCallbackAgeSec?: number | null;
  lastParkingDecisionConfidence?: number;
  lastParkingDecisionHoldReason?: string;
  lastParkingDecisionSource?: string;
  lastParkingDecisionTs?: number;
}

class BackgroundLocationServiceClass {
  private eventEmitter: NativeEventEmitter | null = null;
  private parkingSubscription: any = null;
  private drivingSubscription: any = null;
  private locationSubscription: any = null;
  private onParkingDetected: ((event: ParkingDetectedEvent) => void) | null = null;
  private onDrivingStarted: ((timestamp?: number) => void) | null = null;
  private onPossibleDriving: (() => void) | null = null;
  private possibleDrivingSubscription: any = null;
  private isStarted = false;

  constructor() {
    if (Platform.OS === 'ios' && BackgroundLocationModule) {
      this.eventEmitter = new NativeEventEmitter(BackgroundLocationModule);
    }
  }

  /**
   * iOS-native camera alerts (background-safe). Mirrors CameraAlertService settings.
   */
  async setCameraAlertSettings(enabled: boolean, speedEnabled: boolean, redlightEnabled: boolean): Promise<boolean> {
    if (Platform.OS !== 'ios' || !BackgroundLocationModule?.setCameraAlertSettings) return false;
    try {
      return await BackgroundLocationModule.setCameraAlertSettings(enabled, speedEnabled, redlightEnabled);
    } catch (e) {
      log.warn('Failed to set native camera settings', e);
      return false;
    }
  }

  async reportParkingFalsePositive(latitude: number, longitude: number): Promise<boolean> {
    if (Platform.OS !== 'ios' || !BackgroundLocationModule?.reportParkingFalsePositive) return false;
    try {
      return await BackgroundLocationModule.reportParkingFalsePositive(latitude, longitude);
    } catch (e) {
      log.warn('Failed to report false positive parking', e);
      return false;
    }
  }

  async reportParkingConfirmed(latitude: number, longitude: number): Promise<boolean> {
    if (Platform.OS !== 'ios' || !BackgroundLocationModule?.reportParkingConfirmed) return false;
    try {
      return await BackgroundLocationModule.reportParkingConfirmed(latitude, longitude);
    } catch (e) {
      log.warn('Failed to report confirmed parking', e);
      return false;
    }
  }

  /**
   * Check if the service is available (iOS only)
   */
  isAvailable(): boolean {
    return Platform.OS === 'ios' && BackgroundLocationModule != null;
  }

  /**
   * Request location permissions
   * Apple requires a two-step process: WhenInUse first, then Always
   */
  async requestPermissions(): Promise<PermissionStatus> {
    if (!this.isAvailable()) {
      log.warn('BackgroundLocationModule not available');
      return 'denied';
    }

    try {
      const status = await BackgroundLocationModule.requestPermissions();
      log.info('Permission request result:', status);
      return status as PermissionStatus;
    } catch (error) {
      log.error('Error requesting permissions', error);
      return 'denied';
    }
  }

  /**
   * Get current permission status
   */
  async getPermissionStatus(): Promise<PermissionStatus> {
    if (!this.isAvailable()) {
      return 'denied';
    }

    try {
      return await BackgroundLocationModule.getPermissionStatus() as PermissionStatus;
    } catch (error) {
      log.error('Error getting permission status', error);
      return 'unknown';
    }
  }

  /**
   * Start background location monitoring for parking detection
   * This is the main entry point - call once during app setup
   */
  async startMonitoring(
    onParkingDetected: (event: ParkingDetectedEvent) => void,
    onDrivingStarted?: (timestamp?: number) => void,
    onPossibleDriving?: () => void
  ): Promise<boolean> {
    if (!this.isAvailable()) {
      log.warn('Background location not available on this platform');
      return false;
    }

    if (this.isStarted) {
      log.debug('Already monitoring');
      return true;
    }

    try {
      // Store callbacks
      this.onParkingDetected = onParkingDetected;
      this.onDrivingStarted = onDrivingStarted || null;
      this.onPossibleDriving = onPossibleDriving || null;

      // Subscribe to native events
      if (this.eventEmitter) {
        this.parkingSubscription = this.eventEmitter.addListener(
          'onParkingDetected',
          (event: ParkingDetectedEvent) => {
            log.info('Parking detected (live event)!', {
              lat: event.latitude?.toFixed(6),
              lng: event.longitude?.toFixed(6),
              accuracy: event.accuracy?.toFixed(1),
              drivingDuration: event.drivingDurationSec?.toFixed(0),
            });
            if (this.onParkingDetected) {
              this.onParkingDetected(event);
            }
            // Clear the pending parking event queue since JS received this live.
            // Prevents the same event from being replayed on next startMonitoring.
            BackgroundLocationModule.acknowledgeParkingEvent?.()
              .catch((e: any) => log.warn('Failed to ack pending parking event:', e));
          }
        );

        this.drivingSubscription = this.eventEmitter.addListener(
          'onDrivingStarted',
          (event: { timestamp?: number; source?: string; speed?: number }) => {
            log.debug('Driving started', { timestamp: event?.timestamp, source: event?.source });
            if (this.onDrivingStarted) {
              this.onDrivingStarted(event?.timestamp);
            }
          }
        );

        // onPossibleDriving fires BEFORE onDrivingStarted — when CoreMotion
        // first detects automotive but GPS hasn't confirmed speed yet.
        // Used to start camera alerts early so we don't miss nearby cameras
        // during the GPS cold start period (5-15 seconds).
        this.possibleDrivingSubscription = this.eventEmitter.addListener(
          'onPossibleDriving',
          (event: { timestamp?: number; source?: string }) => {
            log.info('Possible driving detected (pre-GPS)', { source: event?.source });
            if (this.onPossibleDriving) {
              this.onPossibleDriving();
            }
          }
        );
      }

      // Start native monitoring
      await BackgroundLocationModule.startMonitoring();

      this.isStarted = true;
      log.info('Background location monitoring started');

      // Check for pending parking events that were persisted by native code
      // when JS was suspended by iOS and sendEvent was silently lost.
      this.checkPendingParkingEvent();

      return true;
    } catch (error) {
      log.error('Failed to start background location monitoring', error);
      return false;
    }
  }

  /**
   * Check for a parking event that native persisted but JS never received.
   * This handles the case where iOS suspends JS while native code continues
   * running — sendEvent("onParkingDetected") is silently lost.
   */
  private async checkPendingParkingEvent(): Promise<void> {
    try {
      const pendingEvent = await BackgroundLocationModule.getPendingParkingEvent();
      if (!pendingEvent || pendingEvent === null) {
        log.debug('No pending parking event in native queue');
        return;
      }

      const ageSec = pendingEvent._persistedAt
        ? (Date.now() / 1000 - pendingEvent._persistedAt)
        : -1;
      log.info('Found pending parking event from native queue', {
        lat: pendingEvent.latitude?.toFixed?.(6),
        lng: pendingEvent.longitude?.toFixed?.(6),
        accuracy: pendingEvent.accuracy?.toFixed?.(1),
        ageSec: ageSec.toFixed(0),
        detectionSource: pendingEvent.detectionSource,
      });

      // Feed it through the same onParkingDetected handler
      if (this.onParkingDetected) {
        const event: ParkingDetectedEvent = {
          timestamp: pendingEvent.timestamp,
          latitude: pendingEvent.latitude,
          longitude: pendingEvent.longitude,
          accuracy: pendingEvent.accuracy,
          drivingDurationSec: pendingEvent.drivingDurationSec,
          detectionSource: pendingEvent.detectionSource,
          locationSource: pendingEvent.locationSource,
          driftFromParkingMeters: pendingEvent.driftFromParkingMeters,
        };

        log.info('Processing pending parking event through onParkingDetected handler');
        await this.onParkingDetected(event);
      }

      // Acknowledge the event so it's not replayed again
      await BackgroundLocationModule.acknowledgeParkingEvent();
      log.info('Acknowledged pending parking event — cleared from native queue');
    } catch (error) {
      log.warn('Error checking pending parking event:', error);
    }
  }

  /**
   * Stop all monitoring
   */
  async stopMonitoring(): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      await BackgroundLocationModule.stopMonitoring();
    } catch (error) {
      log.error('Error stopping native monitoring', error);
    }

    // Clean up subscriptions
    if (this.parkingSubscription) {
      this.parkingSubscription.remove();
      this.parkingSubscription = null;
    }
    if (this.drivingSubscription) {
      this.drivingSubscription.remove();
      this.drivingSubscription = null;
    }
    if (this.locationSubscription) {
      this.locationSubscription.remove();
      this.locationSubscription = null;
    }
    if (this.possibleDrivingSubscription) {
      this.possibleDrivingSubscription.remove();
      this.possibleDrivingSubscription = null;
    }

    this.isStarted = false;
    this.onParkingDetected = null;
    this.onDrivingStarted = null;
    this.onPossibleDriving = null;
    log.info('Background location monitoring stopped');
  }

  /**
   * Get current monitoring status
   */
  async getStatus(): Promise<BackgroundLocationStatus> {
    if (!this.isAvailable()) {
      return {
        isMonitoring: false,
        isDriving: false,
        hasAlwaysPermission: false,
        motionAvailable: false,
      };
    }

    try {
      return await BackgroundLocationModule.getStatus();
    } catch (error) {
      log.error('Error getting status', error);
      return {
        isMonitoring: false,
        isDriving: false,
        hasAlwaysPermission: false,
        motionAvailable: false,
      };
    }
  }

  /**
   * Get the last known driving location (probable parking spot)
   * This is saved while the user is driving and is the most accurate
   * representation of where the car is parked
   */
  async getLastDrivingLocation(): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number;
    timestamp: number;
  } | null> {
    if (!this.isAvailable()) return null;

    try {
      const result = await BackgroundLocationModule.getLastDrivingLocation();
      return result || null;
    } catch (error) {
      log.error('Error getting last driving location', error);
      return null;
    }
  }

  /**
   * Get recent accelerometer data from the native rolling buffer.
   * Returns last N seconds of accelerometer + gravity data at 10Hz.
   * Used for red light camera evidence (deceleration/stop proof).
   */
  async getRecentAccelerometerData(seconds: number = 30): Promise<Array<{
    timestamp: number;
    x: number; y: number; z: number;
    gx: number; gy: number; gz: number;
  }>> {
    if (!this.isAvailable()) return [];
    try {
      return await BackgroundLocationModule.getRecentAccelerometerData(seconds);
    } catch (error) {
      log.error('Error getting accelerometer data', error);
      return [];
    }
  }

  /**
   * Get pending red-light camera evidence captured natively while JS was suspended.
   * Returns an array of receipt-compatible objects (may be empty).
   * Call acknowledgeRedLightEvidence() after processing to clear the queue.
   */
  async getPendingRedLightEvidence(): Promise<any[]> {
    if (!this.isAvailable()) return [];
    try {
      const evidence = await BackgroundLocationModule.getPendingRedLightEvidence();
      return evidence || [];
    } catch (error) {
      log.error('Error getting pending red-light evidence', error);
      return [];
    }
  }

  /**
   * Acknowledge that pending red-light evidence has been processed.
   * Clears the native UserDefaults queue.
   */
  async acknowledgeRedLightEvidence(): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await BackgroundLocationModule.acknowledgeRedLightEvidence();
    } catch (error) {
      log.error('Error acknowledging red-light evidence', error);
    }
  }

  /**
   * Returns the native parking-detection debug log tail.
   */
  async getDebugLogs(lineCount: number = 200): Promise<string> {
    if (!this.isAvailable()) return '';
    try {
      return await BackgroundLocationModule.getDebugLogs(lineCount);
    } catch (error) {
      log.error('Error getting debug logs', error);
      return '';
    }
  }

  /**
   * Truncate native parking-detection debug log.
   */
  async clearDebugLogs(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      return !!(await BackgroundLocationModule.clearDebugLogs());
    } catch (error) {
      log.error('Error clearing debug logs', error);
      return false;
    }
  }

  /**
   * Metadata for the native debug log file.
   */
  async getDebugLogInfo(): Promise<{ exists: boolean; path: string | null; sizeBytes: number }> {
    if (!this.isAvailable()) return { exists: false, path: null, sizeBytes: 0 };
    try {
      const info = await BackgroundLocationModule.getDebugLogInfo();
      return {
        exists: !!info?.exists,
        path: typeof info?.path === 'string' ? info.path : null,
        sizeBytes: Number(info?.sizeBytes || 0),
      };
    } catch (error) {
      log.error('Error getting debug log info', error);
      return { exists: false, path: null, sizeBytes: 0 };
    }
  }

  /**
   * Copies the native debug log to a timestamped temp file and returns that path.
   */
  async exportDebugLog(): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      const path = await BackgroundLocationModule.exportDebugLog();
      return typeof path === 'string' ? path : null;
    } catch (error) {
      log.error('Error exporting debug log', error);
      return null;
    }
  }

  /**
   * Returns native parking-decision trace tail (JSON lines).
   */
  async getDecisionLogs(lineCount: number = 200): Promise<string> {
    if (!this.isAvailable() || !BackgroundLocationModule.getDecisionLogs) return '';
    try {
      return await BackgroundLocationModule.getDecisionLogs(lineCount);
    } catch (error) {
      log.error('Error getting decision logs', error);
      return '';
    }
  }

  /**
   * Truncate native parking-decision trace.
   */
  async clearDecisionLogs(): Promise<boolean> {
    if (!this.isAvailable() || !BackgroundLocationModule.clearDecisionLogs) return false;
    try {
      return !!(await BackgroundLocationModule.clearDecisionLogs());
    } catch (error) {
      log.error('Error clearing decision logs', error);
      return false;
    }
  }

  /**
   * Metadata for native parking-decision trace.
   */
  async getDecisionLogInfo(): Promise<{ exists: boolean; path: string | null; sizeBytes: number }> {
    if (!this.isAvailable() || !BackgroundLocationModule.getDecisionLogInfo) {
      return { exists: false, path: null, sizeBytes: 0 };
    }
    try {
      const info = await BackgroundLocationModule.getDecisionLogInfo();
      return {
        exists: !!info?.exists,
        path: typeof info?.path === 'string' ? info.path : null,
        sizeBytes: Number(info?.sizeBytes || 0),
      };
    } catch (error) {
      log.error('Error getting decision log info', error);
      return { exists: false, path: null, sizeBytes: 0 };
    }
  }

  /**
   * Copy native decision trace to timestamped temp file.
   */
  async exportDecisionLog(): Promise<string | null> {
    if (!this.isAvailable() || !BackgroundLocationModule.exportDecisionLog) return null;
    try {
      const path = await BackgroundLocationModule.exportDecisionLog();
      return typeof path === 'string' ? path : null;
    } catch (error) {
      log.error('Error exporting decision log', error);
      return null;
    }
  }

  /**
   * Subscribe to real-time location updates (for debugging/display)
   */
  addLocationListener(callback: (event: LocationUpdateEvent) => void): () => void {
    if (!this.eventEmitter) {
      return () => {};
    }

    const sub = this.eventEmitter.addListener('onLocationUpdate', callback);
    return () => sub.remove();
  }
}

export default new BackgroundLocationServiceClass();
