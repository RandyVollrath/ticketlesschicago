/**
 * MotionActivityService
 *
 * Battery-efficient parking detection using iOS CMMotionActivityManager.
 *
 * Tiered approach:
 * - Tier A (cheap): CMMotionActivityManager detects Automotive → Walking/Stationary
 * - Tier B (medium): Only act on activity transitions, not continuous polling
 * - Tier C (expensive): High-accuracy GPS only when confirming parking spot
 *
 * This is MUCH more battery efficient than continuous GPS monitoring.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('MotionActivityService');

// Get the native module (iOS only)
const { MotionActivityModule } = NativeModules;

// Activity types from CMMotionActivityManager
type ActivityType = 'unknown' | 'stationary' | 'walking' | 'running' | 'cycling' | 'automotive';

interface ActivityChangeEvent {
  activity: ActivityType;
  previousActivity: ActivityType;
  confidence: 'low' | 'medium' | 'high';
  timestamp: number;
}

interface MotionState {
  isMonitoring: boolean;
  currentActivity: ActivityType;
  lastAutomotiveTime: number | null;
  lastParkingCheckTime: number | null;
  wasRecentlyDriving: boolean;
}

// Configuration
const PARKING_CONFIRMATION_DELAY_MS = 90 * 1000; // 90 seconds after stopping to confirm parking
const MIN_DRIVING_DURATION_MS = 60 * 1000; // Must be driving for at least 1 minute
const PARKING_CHECK_COOLDOWN_MS = 5 * 60 * 1000; // Don't check parking more than once per 5 minutes

class MotionActivityServiceClass {
  private state: MotionState = {
    isMonitoring: false,
    currentActivity: 'unknown',
    lastAutomotiveTime: null,
    lastParkingCheckTime: null,
    wasRecentlyDriving: false,
  };

  private eventEmitter: NativeEventEmitter | null = null;
  private activitySubscription: any = null;
  private parkingConfirmationTimeout: ReturnType<typeof setTimeout> | null = null;
  private onParkingDetected: (() => void) | null = null;
  private onDepartureDetected: (() => void) | null = null;

  constructor() {
    if (Platform.OS === 'ios' && MotionActivityModule) {
      this.eventEmitter = new NativeEventEmitter(MotionActivityModule);
    }
  }

  /**
   * Check if motion activity detection is available
   */
  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios' || !MotionActivityModule) {
      return false;
    }

    try {
      return await MotionActivityModule.isAvailable();
    } catch (error) {
      log.error('Error checking motion availability', error);
      return false;
    }
  }

  /**
   * Start monitoring for parking events using motion activity
   * This is very battery efficient - uses CMMotionActivityManager
   */
  async startMonitoring(
    onParkingDetected: () => void,
    onDepartureDetected?: () => void
  ): Promise<boolean> {
    if (Platform.OS !== 'ios' || !MotionActivityModule) {
      log.warn('Motion activity not available on this platform');
      return false;
    }

    if (this.state.isMonitoring) {
      log.debug('Motion monitoring already active');
      return true;
    }

    try {
      this.onParkingDetected = onParkingDetected;
      this.onDepartureDetected = onDepartureDetected || null;

      // Load persisted state
      await this.loadState();

      // Subscribe to activity changes
      if (this.eventEmitter) {
        this.activitySubscription = this.eventEmitter.addListener(
          'onActivityChange',
          this.handleActivityChange.bind(this)
        );
      }

      // Start native monitoring
      await MotionActivityModule.startMonitoring();

      // Get current activity
      const currentActivity = await MotionActivityModule.getCurrentActivity();
      this.state.currentActivity = currentActivity.activity;

      this.state.isMonitoring = true;
      await this.saveState();

      log.info('Motion-based parking detection started', {
        currentActivity: this.state.currentActivity,
      });

      return true;
    } catch (error) {
      log.error('Failed to start motion monitoring', error);
      return false;
    }
  }

  /**
   * Stop monitoring
   */
  async stopMonitoring(): Promise<void> {
    if (Platform.OS === 'ios' && MotionActivityModule) {
      try {
        await MotionActivityModule.stopMonitoring();
      } catch (error) {
        log.error('Error stopping native monitoring', error);
      }
    }

    if (this.activitySubscription) {
      this.activitySubscription.remove();
      this.activitySubscription = null;
    }

    if (this.parkingConfirmationTimeout) {
      clearTimeout(this.parkingConfirmationTimeout);
      this.parkingConfirmationTimeout = null;
    }

    this.state.isMonitoring = false;
    this.onParkingDetected = null;
    this.onDepartureDetected = null;

    await this.saveState();
    log.info('Motion monitoring stopped');
  }

  /**
   * Handle activity change events from the native module
   * This is the key detection logic - very battery efficient
   */
  private handleActivityChange(event: ActivityChangeEvent): void {
    log.debug('Activity change', event);

    const { activity, previousActivity, confidence } = event;

    // Update state
    this.state.currentActivity = activity;

    // Track when we're driving
    if (activity === 'automotive') {
      this.state.lastAutomotiveTime = Date.now();
      this.state.wasRecentlyDriving = true;

      // Cancel any pending parking check - we're driving again
      if (this.parkingConfirmationTimeout) {
        log.debug('Cancelling pending parking check - user is driving');
        clearTimeout(this.parkingConfirmationTimeout);
        this.parkingConfirmationTimeout = null;
      }
    }

    // Detect parking: Automotive → Stationary/Walking (with high/medium confidence)
    if (
      previousActivity === 'automotive' &&
      (activity === 'stationary' || activity === 'walking') &&
      confidence !== 'low'
    ) {
      this.handlePotentialParking();
    }

    // Detect departure: Was parked (stationary/walking), now driving
    if (
      (previousActivity === 'stationary' || previousActivity === 'walking') &&
      activity === 'automotive' &&
      this.state.lastParkingCheckTime !== null
    ) {
      this.handleDeparture();
    }

    this.saveState();
  }

  /**
   * Handle potential parking detection
   */
  private handlePotentialParking(): void {
    // Check if we were driving long enough
    if (!this.state.lastAutomotiveTime) {
      log.debug('No recent driving detected - ignoring');
      return;
    }

    const drivingDuration = Date.now() - this.state.lastAutomotiveTime;
    if (drivingDuration < MIN_DRIVING_DURATION_MS) {
      log.debug('Driving duration too short - likely false positive');
      return;
    }

    // Check cooldown
    if (this.state.lastParkingCheckTime) {
      const timeSinceLastCheck = Date.now() - this.state.lastParkingCheckTime;
      if (timeSinceLastCheck < PARKING_CHECK_COOLDOWN_MS) {
        log.debug('Parking check cooldown active - skipping');
        return;
      }
    }

    log.info('Potential parking detected - waiting for confirmation...');

    // Wait to confirm (not just a red light or traffic)
    this.parkingConfirmationTimeout = setTimeout(() => {
      this.confirmParking();
    }, PARKING_CONFIRMATION_DELAY_MS);
  }

  /**
   * Confirm parking after delay
   */
  private confirmParking(): void {
    // Verify still stationary/walking (not driving again)
    if (this.state.currentActivity === 'automotive') {
      log.info('User started driving again - parking not confirmed');
      return;
    }

    log.info('Parking confirmed! Triggering parking check...');
    this.state.lastParkingCheckTime = Date.now();
    this.state.wasRecentlyDriving = false;

    if (this.onParkingDetected) {
      this.onParkingDetected();
    }

    this.saveState();
  }

  /**
   * Handle departure detection
   */
  private handleDeparture(): void {
    log.info('Departure detected - user is driving again');

    if (this.onDepartureDetected) {
      this.onDepartureDetected();
    }

    // Reset so we can detect next parking
    this.state.lastParkingCheckTime = null;
  }

  /**
   * Get current status
   */
  getStatus(): {
    isMonitoring: boolean;
    currentActivity: ActivityType;
    wasRecentlyDriving: boolean;
    isAvailable: boolean;
  } {
    return {
      isMonitoring: this.state.isMonitoring,
      currentActivity: this.state.currentActivity,
      wasRecentlyDriving: this.state.wasRecentlyDriving,
      isAvailable: Platform.OS === 'ios' && MotionActivityModule !== null,
    };
  }

  /**
   * Get current activity (one-time query)
   */
  async getCurrentActivity(): Promise<{ activity: ActivityType; confidence: string } | null> {
    if (Platform.OS !== 'ios' || !MotionActivityModule) {
      return null;
    }

    try {
      return await MotionActivityModule.getCurrentActivity();
    } catch (error) {
      log.error('Error getting current activity', error);
      return null;
    }
  }

  /**
   * Load persisted state
   */
  private async loadState(): Promise<void> {
    try {
      const stateJson = await AsyncStorage.getItem(StorageKeys.MOTION_ACTIVITY_STATE);
      if (stateJson) {
        const savedState = JSON.parse(stateJson);
        this.state.lastParkingCheckTime = savedState.lastParkingCheckTime || null;
        this.state.lastAutomotiveTime = savedState.lastAutomotiveTime || null;
        this.state.wasRecentlyDriving = savedState.wasRecentlyDriving || false;
      }
    } catch (error) {
      log.error('Error loading motion state', error);
    }
  }

  /**
   * Save state
   */
  private async saveState(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        StorageKeys.MOTION_ACTIVITY_STATE,
        JSON.stringify({
          isMonitoring: this.state.isMonitoring,
          currentActivity: this.state.currentActivity,
          lastParkingCheckTime: this.state.lastParkingCheckTime,
          lastAutomotiveTime: this.state.lastAutomotiveTime,
          wasRecentlyDriving: this.state.wasRecentlyDriving,
        })
      );
    } catch (error) {
      log.error('Error saving motion state', error);
    }
  }
}

export default new MotionActivityServiceClass();
