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
}

export interface LocationUpdateEvent {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  timestamp: number;
}

export interface BackgroundLocationStatus {
  isMonitoring: boolean;
  isDriving: boolean;
  hasAlwaysPermission: boolean;
  motionAvailable: boolean;
  drivingDurationSec?: number;
  lastDrivingLat?: number;
  lastDrivingLng?: number;
}

class BackgroundLocationServiceClass {
  private eventEmitter: NativeEventEmitter | null = null;
  private parkingSubscription: any = null;
  private drivingSubscription: any = null;
  private locationSubscription: any = null;
  private onParkingDetected: ((event: ParkingDetectedEvent) => void) | null = null;
  private onDrivingStarted: (() => void) | null = null;
  private isStarted = false;

  constructor() {
    if (Platform.OS === 'ios' && BackgroundLocationModule) {
      this.eventEmitter = new NativeEventEmitter(BackgroundLocationModule);
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
    onDrivingStarted?: () => void
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

      // Subscribe to native events
      if (this.eventEmitter) {
        this.parkingSubscription = this.eventEmitter.addListener(
          'onParkingDetected',
          (event: ParkingDetectedEvent) => {
            log.info('Parking detected!', {
              lat: event.latitude?.toFixed(6),
              lng: event.longitude?.toFixed(6),
              accuracy: event.accuracy?.toFixed(1),
              drivingDuration: event.drivingDurationSec?.toFixed(0),
            });
            if (this.onParkingDetected) {
              this.onParkingDetected(event);
            }
          }
        );

        this.drivingSubscription = this.eventEmitter.addListener(
          'onDrivingStarted',
          () => {
            log.debug('Driving started');
            if (this.onDrivingStarted) {
              this.onDrivingStarted();
            }
          }
        );
      }

      // Start native monitoring
      await BackgroundLocationModule.startMonitoring();

      this.isStarted = true;
      log.info('Background location monitoring started');
      return true;
    } catch (error) {
      log.error('Failed to start background location monitoring', error);
      return false;
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

    this.isStarted = false;
    this.onParkingDetected = null;
    this.onDrivingStarted = null;
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
