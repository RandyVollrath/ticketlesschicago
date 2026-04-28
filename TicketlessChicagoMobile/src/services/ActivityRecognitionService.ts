import { Platform, PermissionsAndroid, NativeModules, NativeEventEmitter, EmitterSubscription } from 'react-native';
import Logger from '../utils/Logger';

/**
 * ActivityRecognitionService — Android-only.
 *
 * Wraps the native ActivityTransitionModule (Google Play services Activity
 * Recognition API) and exposes a small surface to the parking pipeline.
 *
 * Why this exists:
 * On Android our only motion-based parking signal is Bluetooth ACL. Activity
 * Recognition runs on a low-power sensor hub and gives an independent
 * IN_VEHICLE → not-IN_VEHICLE signal that supplements (or replaces) BT for
 * users without car BT.
 *
 * Mirrors BluetoothService.ts in shape: addListener(...) / removeListener(...),
 * permission helpers, start/stop monitoring.
 */

const ActivityTransitionModule = Platform.OS === 'android'
  ? NativeModules.ActivityTransitionModule
  : null;

const log = Logger.createLogger('ActivityRecognitionService');

export interface ActivityRecognitionListener {
  onDrivingStarted: (timestamp: number) => void;
  onParkingDetected: (timestamp: number) => void;
}

class ActivityRecognitionServiceClass {
  private listeners: ActivityRecognitionListener[] = [];
  private drivingSub: EmitterSubscription | null = null;
  private parkingSub: EmitterSubscription | null = null;
  private monitoring = false;

  isAvailable(): boolean {
    return Platform.OS === 'android' && !!ActivityTransitionModule;
  }

  /**
   * Check whether ACTIVITY_RECOGNITION runtime permission is granted.
   * Returns true on iOS (n/a) and on Android < 29 (granted at install).
   */
  async hasPermission(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      return await ActivityTransitionModule.hasPermission();
    } catch (e) {
      log.warn('hasPermission failed', e);
      return false;
    }
  }

  /**
   * Request the ACTIVITY_RECOGNITION runtime permission. Returns true if
   * granted (or not required). The caller should show a primer first.
   */
  async requestPermission(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    if (typeof Platform.Version === 'number' && Platform.Version < 29) return true; // granted at install on Android < Q
    try {
      const result = await PermissionsAndroid.request(
        // @ts-ignore — string permission accepted at runtime; PermissionsAndroid
        // typedefs lag behind Android Q additions.
        'android.permission.ACTIVITY_RECOGNITION',
        {
          title: 'Detect when you park',
          message:
            'Autopilot uses your phone’s motion sensor (the same one fitness apps ' +
            'use) to detect when you stop driving. This is the backup that catches ' +
            'parking when your car Bluetooth doesn’t reconnect.',
          buttonPositive: 'Allow',
          buttonNegative: 'Not now',
        }
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (e) {
      log.error('requestPermission failed', e);
      return false;
    }
  }

  /**
   * Start receiving Activity Transition updates. Idempotent — safe to call
   * multiple times. Returns true if started or already running.
   */
  async startMonitoring(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    const granted = await this.hasPermission();
    if (!granted) {
      log.info('ACTIVITY_RECOGNITION not granted — skipping startMonitoring');
      return false;
    }

    // Subscribe to native events BEFORE requesting updates so the first event
    // can be delivered directly. This mirrors the BT path.
    this.attachNativeSubscriptions();

    try {
      await ActivityTransitionModule.startMonitoring();
      this.monitoring = true;
      log.info('Activity transition monitoring started');
      return true;
    } catch (e) {
      log.error('startMonitoring failed', e);
      this.detachNativeSubscriptions();
      return false;
    }
  }

  async stopMonitoring(): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await ActivityTransitionModule.stopMonitoring();
    } catch (e) {
      log.warn('stopMonitoring failed', e);
    }
    this.detachNativeSubscriptions();
    this.monitoring = false;
  }

  /**
   * Drain any events the receiver stored while JS was paused. Returns the
   * raw flags so the caller can decide whether to feed them to the state machine.
   */
  async checkPendingEvents(): Promise<{
    pendingDrivingStarted: boolean;
    pendingParkingDetected: boolean;
  }> {
    if (!this.isAvailable()) {
      return { pendingDrivingStarted: false, pendingParkingDetected: false };
    }
    try {
      return await ActivityTransitionModule.checkPendingEvents();
    } catch (e) {
      log.warn('checkPendingEvents failed', e);
      return { pendingDrivingStarted: false, pendingParkingDetected: false };
    }
  }

  async isCurrentlyDriving(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      return await ActivityTransitionModule.isCurrentlyDriving();
    } catch (e) {
      return false;
    }
  }

  isMonitoring(): boolean {
    return this.monitoring;
  }

  addListener(listener: ActivityRecognitionListener): void {
    this.listeners.push(listener);
  }

  removeListener(listener: ActivityRecognitionListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private attachNativeSubscriptions(): void {
    if (!this.isAvailable()) return;
    if (this.drivingSub || this.parkingSub) return; // already attached

    try {
      const emitter = new NativeEventEmitter(ActivityTransitionModule);

      this.drivingSub = emitter.addListener(
        'ActivityDrivingStarted',
        (event: { timestamp?: number }) => {
          const ts = event?.timestamp ?? Date.now();
          log.info(`AR DrivingStarted received @ ${ts}`);
          this.notifyDrivingStarted(ts);
        }
      );

      this.parkingSub = emitter.addListener(
        'ActivityParkingDetected',
        (event: { timestamp?: number }) => {
          const ts = event?.timestamp ?? Date.now();
          log.info(`AR ParkingDetected received @ ${ts}`);
          this.notifyParkingDetected(ts);
        }
      );

      log.info('NativeEventEmitter subscriptions registered for AR events');
    } catch (e) {
      log.error('Failed to subscribe to AR NativeEventEmitter', e);
    }
  }

  private detachNativeSubscriptions(): void {
    try { this.drivingSub?.remove(); } catch (e) { /* ignore */ }
    try { this.parkingSub?.remove(); } catch (e) { /* ignore */ }
    this.drivingSub = null;
    this.parkingSub = null;
  }

  private notifyDrivingStarted(timestamp: number): void {
    this.listeners.forEach((l) => {
      try { l.onDrivingStarted(timestamp); }
      catch (e) { log.error('Listener threw on driving started', e); }
    });
  }

  private notifyParkingDetected(timestamp: number): void {
    this.listeners.forEach((l) => {
      try { l.onParkingDetected(timestamp); }
      catch (e) { log.error('Listener threw on parking detected', e); }
    });
  }
}

export default new ActivityRecognitionServiceClass();
