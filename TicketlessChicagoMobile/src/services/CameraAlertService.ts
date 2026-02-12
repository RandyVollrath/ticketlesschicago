/**
 * CameraAlertService
 *
 * Speaks audio alerts when the user is driving near speed cameras
 * or red light cameras in Chicago.
 *
 * How it works:
 * 1. Receives GPS updates (lat, lng, speed, heading) from
 *    BackgroundLocationService (iOS) or Android foreground GPS
 * 2. Filters 510 cameras down to nearby ones using a fast bounding box check
 * 3. Calculates exact distance via Haversine formula
 * 4. Filters by direction: only alerts if user's heading matches camera's
 *    monitored approach directions (±45° tolerance)
 * 4b. Filters by bearing: only alerts if camera is AHEAD of user (±30° cone),
 *     not to the side on a parallel street
 * 5. Speaks via TTS when within speed-adaptive alert radius (150-250m)
 * 6. Tracks alerted cameras to avoid repeating until user moves away (~400m)
 *
 * TTS Strategy:
 * - iOS: Uses native SpeechModule (AVSpeechSynthesizer) — zero pod dependencies
 * - Android: Uses react-native-tts (lazy-loaded to avoid iOS crash)
 *
 * Performance: The bounding box pre-filter means we only compute
 * Haversine for ~2-5 cameras per GPS update, even with 510 total.
 */

import { Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHICAGO_CAMERAS, CameraLocation } from '../data/chicago-cameras';
import CameraPassHistoryService from './CameraPassHistoryService';
import RedLightReceiptService, { RedLightTracePoint } from './RedLightReceiptService';
import BackgroundLocationService from './BackgroundLocationService';
import { distanceMeters, toRad } from '../utils/geo';
import Logger from '../utils/Logger';

const log = Logger.createLogger('CameraAlertService');

// ============================================================================
// TTS Abstraction — platform-specific speech
// ============================================================================

/**
 * iOS: Use our native SpeechModule (AVSpeechSynthesizer).
 * No pods needed — it's built into iOS and registered in Xcode project.
 */
const SpeechModule = Platform.OS === 'ios' ? NativeModules.SpeechModule : null;

/**
 * Android: Lazy-load react-native-tts to avoid NativeEventEmitter crash on iOS.
 * react-native-tts creates NativeEventEmitter(null) if the native module isn't linked.
 */
let AndroidTts: any = null;

function getAndroidTtsSync(): any {
  if (Platform.OS !== 'android') return null;
  if (!AndroidTts) {
    try {
      AndroidTts = require('react-native-tts').default;
      log.info('react-native-tts module loaded');
    } catch (e) {
      log.warn('react-native-tts not available on Android:', e);
      return null;
    }
  }
  return AndroidTts;
}

/**
 * Speak a message using the platform-appropriate TTS engine.
 * Returns true if speech was initiated, false if TTS unavailable.
 */
async function speak(message: string): Promise<boolean> {
  log.info(`TTS speak requested: "${message}"`);

  if (Platform.OS === 'ios') {
    if (SpeechModule) {
      try {
        await SpeechModule.speak(message);
        log.info('iOS TTS speak succeeded');
        return true;
      } catch (e) {
        log.error('iOS SpeechModule.speak failed', e);
        return false;
      }
    } else {
      log.warn('iOS SpeechModule not available — native module not linked');
      return false;
    }
  } else {
    const tts = getAndroidTtsSync();
    if (!tts) {
      log.warn('Android TTS module not loaded');
      return false;
    }

    try {
      // Just try to speak — the TTS engine will auto-initialize on most devices.
      // Wrapping in Promise to handle both callback and promise-based returns.
      log.info('Android TTS: calling tts.speak()...');
      const result = tts.speak(message);

      // tts.speak() returns a Promise<string> (utterance ID) on success
      if (result && typeof result.then === 'function') {
        await result;
      }

      log.info('Android TTS speak call completed');
      return true;
    } catch (e: any) {
      log.error('Android TTS speak failed:', e?.message || e);

      // If no TTS engine, prompt user to install one
      if (e?.code === 'no_engine') {
        try {
          tts.requestInstallEngine();
        } catch (e) { log.debug('Failed to request TTS engine install', e); }
      }
      return false;
    }
  }
}

/**
 * Stop any current speech.
 */
async function stopSpeech(): Promise<void> {
  if (Platform.OS === 'ios') {
    if (SpeechModule) {
      try { await SpeechModule.stop(); } catch (e) { log.debug('SpeechModule.stop() failed', e); }
    }
  } else {
    const tts = getAndroidTtsSync();
    if (tts) {
      try { tts.stop(); } catch (e) { log.debug('Android TTS stop() failed', e); }
    }
  }
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Base alert distance — used when speed is unknown or very low.
 * At higher speeds the radius scales up automatically to give ~10 seconds of warning.
 */
const BASE_ALERT_RADIUS_METERS = 150;

/**
 * Maximum alert radius cap to prevent false alerts from parallel streets.
 * Chicago blocks are ~200m wide, so 250m keeps us safely on the correct street.
 */
const MAX_ALERT_RADIUS_METERS = 250;

/**
 * Target warning time in seconds. The alert radius = speed × this value,
 * clamped between BASE and MAX. This gives a consistent ~10-second warning
 * regardless of speed.
 *
 * At 30 mph (13.4 m/s): 13.4 × 10 = 134m → alert at ~134m
 * At 35 mph (15.6 m/s): 15.6 × 10 = 156m → alert at ~156m
 * At 45 mph (20.1 m/s): 20.1 × 10 = 201m → alert at ~201m
 */
const TARGET_WARNING_SECONDS = 10;

/** Distance user must move from camera before it can re-alert */
const COOLDOWN_RADIUS_METERS = 400;

/** Minimum speed (m/s) to trigger speed camera alerts - ~10 mph, filters out walking */
const MIN_SPEED_SPEED_CAM_MPS = 4.5;

/** Minimum speed (m/s) to trigger red light camera alerts - ~2 mph.
 *  Red light cameras matter at ANY driving speed. A user going 5 mph
 *  approaching a red light camera still needs to know it's there.
 *  This only filters out standing still / slow walking. */
const MIN_SPEED_REDLIGHT_MPS = 1.0;

/** Minimum time between any two TTS announcements (ms) */
const MIN_ANNOUNCE_INTERVAL_MS = 5000;
const PASS_CAPTURE_DISTANCE_METERS = 35;
const PASS_MOVED_AWAY_DELTA_METERS = 20;
const PASS_CONFIRM_WINDOW_MS = 3 * 60 * 1000;
const PASS_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const RED_LIGHT_TRACE_WINDOW_MS = 30 * 1000;

/**
 * Bounding box size in degrees for fast pre-filter.
 * ~280m at Chicago latitude — larger than MAX_ALERT_RADIUS_METERS
 * to ensure no cameras at the edge are missed at any speed.
 */
const BBOX_DEGREES = 0.0025;

/**
 * Speed camera enforcement hours in Chicago.
 * School zones: Mon-Fri 7am-7pm. Park zones: Daily 6am-11pm.
 * Since we can't distinguish zone type per camera, we use the widest
 * enforcement window (6am-11pm daily) so we never miss a real one.
 * Outside this window, speed cameras are NOT ticketing — skip alerts.
 * Red-light cameras enforce 24/7 and are never filtered.
 */
const SPEED_CAMERA_ENFORCE_START_HOUR = 6;  // 6:00 AM
const SPEED_CAMERA_ENFORCE_END_HOUR = 23;   // 11:00 PM

/** AsyncStorage key for camera alerts enabled setting */
const STORAGE_KEY_ENABLED = 'cameraAlertsEnabled';
const STORAGE_KEY_SPEED_ENABLED = 'cameraAlertsSpeedEnabled';
const STORAGE_KEY_REDLIGHT_ENABLED = 'cameraAlertsRedLightEnabled';

// ============================================================================
// Direction Matching
// ============================================================================

/**
 * Maps approach direction codes to compass headings (degrees).
 * These are the directions the CAMERA watches — meaning the direction
 * traffic is TRAVELING when the camera captures them.
 *
 * GPS heading: 0°=North, 90°=East, 180°=South, 270°=West
 */
const APPROACH_TO_HEADING: Record<string, number> = {
  NB: 0,     // Northbound — heading north (0°)
  NEB: 45,   // Northeastbound
  EB: 90,    // Eastbound — heading east (90°)
  SEB: 135,  // Southeastbound
  SB: 180,   // Southbound — heading south (180°)
  SWB: 225,  // Southwestbound
  WB: 270,   // Westbound — heading west (270°)
  NWB: 315,  // Northwestbound
};

/**
 * Maximum angular difference (degrees) between GPS heading and camera
 * approach direction to consider a match. ±45° means if a camera watches
 * NB (0°), headings from 315° to 45° will match.
 */
const HEADING_TOLERANCE_DEGREES = 45;

/**
 * Maximum bearing-off-heading (degrees) for a camera to be considered
 * "ahead" of the user. This is the angle between the user's travel
 * direction and the bearing FROM the user TO the camera.
 *
 * 30° means the camera must be within a ±30° cone in front of the user.
 * A camera one block to the side on a parallel street (~90° off heading)
 * is filtered out. This prevents false alerts from parallel streets
 * even when the alert radius is large (150-250m).
 *
 * Fail-open when heading is unavailable (heading = -1).
 */
const MAX_BEARING_OFF_HEADING_DEGREES = 30;

/**
 * Check if the user's GPS heading matches any of the camera's approach directions.
 * Returns true if heading is within ±HEADING_TOLERANCE_DEGREES of any approach.
 *
 * If heading is unavailable (-1) or camera has no approaches, returns true
 * (fail-open — better to alert than miss).
 */
function isHeadingMatch(heading: number, approaches: string[]): boolean {
  // No heading data — fail open, alert anyway
  if (heading < 0) return true;

  // No approach data on camera — fail open
  if (approaches.length === 0) return true;

  for (const approach of approaches) {
    const targetHeading = APPROACH_TO_HEADING[approach];
    if (targetHeading === undefined) {
      // Unknown approach code — fail open
      return true;
    }

    // Angular difference accounting for wrap-around (0° ↔ 360°)
    let diff = Math.abs(heading - targetHeading);
    if (diff > 180) diff = 360 - diff;

    if (diff <= HEADING_TOLERANCE_DEGREES) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Types
// ============================================================================

interface AlertedCamera {
  /** Index in CHICAGO_CAMERAS array */
  index: number;
  /** Timestamp of last alert */
  alertedAt: number;
}

interface CameraPassTracking {
  minDistanceMeters: number;
  minDistanceTimestamp: number;
  minLatitude: number;
  minLongitude: number;
  minSpeedMps: number;
  minHeading: number;
  alertSpeedMps: number;
  alertTimestamp: number;
  lastDistanceMeters: number;
  hasBeenWithinPassDistance: boolean;
}

export interface CameraAlertStatus {
  isEnabled: boolean;
  isActive: boolean;
  totalCameras: number;
  alertedCount: number;
}

// ============================================================================
// Service
// ============================================================================

class CameraAlertServiceClass {
  private isEnabled = false;
  private speedAlertsEnabled = true;
  private redLightAlertsEnabled = true;
  private isActive = false;
  private ttsInitialized = false;
  private hasLoadedSettings = false;

  /** Set of camera indices we've already alerted about */
  private alertedCameras: Map<number, AlertedCamera> = new Map();
  /** Tracking state to infer when user has passed an alerted camera */
  private passTrackingByCamera: Map<number, CameraPassTracking> = new Map();
  /** Dedupe recently-recorded pass events by camera */
  private recentPasses: Map<number, number> = new Map();
  /** Rolling trace for red-light receipt generation */
  private recentTrace: RedLightTracePoint[] = [];

  /** Timestamp of last TTS announcement */
  private lastAnnounceTime = 0;

  /** Track last known position for cooldown clearing */
  private lastLat = 0;
  private lastLng = 0;

  /** Diagnostic: count GPS updates for periodic logging */
  private gpsUpdateCount = 0;
  /** Diagnostic: track filter stage rejections */
  private lastDiagnostic: {
    totalChecked: number;
    typeFiltered: number;
    speedFiltered: number;
    bboxFiltered: number;
    distanceFiltered: number;
    headingFiltered: number;
    bearingFiltered: number;
    passed: number;
    redlightPassed: number;
    speedPassed: number;
    nearestRedlightDistance: number;
    nearestSpeedDistance: number;
  } | null = null;

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize TTS engine. Call once during app startup.
   */
  async initialize(): Promise<void> {
    if (this.hasLoadedSettings) return;

    try {
      await this.loadPersistedSettings();

      if (this.isEnabled) {
        await this.initTts();
      }

      this.hasLoadedSettings = true;
      log.info(`CameraAlertService initialized. Enabled: ${this.isEnabled}, Cameras: ${CHICAGO_CAMERAS.length}, Platform: ${Platform.OS}`);
    } catch (error) {
      log.error('Failed to initialize CameraAlertService', error);
    }
  }

  private async loadPersistedSettings(): Promise<void> {
    const [storedGlobal, storedSpeed, storedRedLight] = await AsyncStorage.multiGet([
      STORAGE_KEY_ENABLED,
      STORAGE_KEY_SPEED_ENABLED,
      STORAGE_KEY_REDLIGHT_ENABLED,
    ]);

    const globalValue = storedGlobal[1];
    const speedValue = storedSpeed[1];
    const redLightValue = storedRedLight[1];

    this.isEnabled = globalValue === 'true';
    // Backward compatibility:
    // - If per-type toggles don't exist yet, inherit from global setting.
    // - If they exist, compute global from either being enabled.
    this.speedAlertsEnabled = speedValue == null ? this.isEnabled : speedValue === 'true';
    this.redLightAlertsEnabled = redLightValue == null ? this.isEnabled : redLightValue === 'true';
    this.isEnabled = this.speedAlertsEnabled || this.redLightAlertsEnabled;
  }

  private async persistSettings(): Promise<void> {
    await AsyncStorage.multiSet([
      [STORAGE_KEY_ENABLED, this.isEnabled ? 'true' : 'false'],
      [STORAGE_KEY_SPEED_ENABLED, this.speedAlertsEnabled ? 'true' : 'false'],
      [STORAGE_KEY_REDLIGHT_ENABLED, this.redLightAlertsEnabled ? 'true' : 'false'],
    ]);
  }

  async getSettings(): Promise<{
    enabled: boolean;
    speedEnabled: boolean;
    redLightEnabled: boolean;
  }> {
    await this.initialize();
    return {
      enabled: this.isEnabled,
      speedEnabled: this.speedAlertsEnabled,
      redLightEnabled: this.redLightAlertsEnabled,
    };
  }

  private async initTts(): Promise<void> {
    if (this.ttsInitialized) return;

    try {
      if (Platform.OS === 'ios') {
        // iOS: SpeechModule uses AVSpeechSynthesizer — no setup needed.
        // Audio session is configured in the native module's init().
        if (SpeechModule) {
          const available = await SpeechModule.isAvailable();
          if (available) {
            this.ttsInitialized = true;
            log.info('iOS native SpeechModule ready (AVSpeechSynthesizer)');
          } else {
            log.warn('iOS SpeechModule reported not available');
          }
        } else {
          log.warn('iOS SpeechModule native module not found — camera audio alerts will not work');
        }
      } else {
        // Android: Configure react-native-tts
        const tts = getAndroidTtsSync();
        if (!tts) {
          log.warn('Android TTS not available');
          return;
        }

        await tts.setDefaultLanguage('en-US');
        await tts.setDefaultRate(0.5);
        await tts.setDefaultPitch(1.0);
        // Best-effort: lower other audio while speaking alerts.
        // (Some players may pause instead of duck depending on device/engine.)
        if (typeof tts.setDucking === 'function') {
          await tts.setDucking(true);
        }

        this.ttsInitialized = true;
        log.info('Android TTS engine initialized (react-native-tts)');
      }
    } catch (error) {
      log.error('Failed to initialize TTS', error);
    }
  }

  // --------------------------------------------------------------------------
  // Enable / Disable
  // --------------------------------------------------------------------------

  async setEnabled(enabled: boolean): Promise<void> {
    this.isEnabled = enabled;
    this.speedAlertsEnabled = enabled;
    this.redLightAlertsEnabled = enabled;
    this.hasLoadedSettings = true;
    await this.persistSettings();

    if (enabled) {
      await this.initTts();
    } else {
      this.stop();
    }

    log.info(`Camera alerts ${enabled ? 'enabled' : 'disabled'}`);
  }

  isAlertEnabled(): boolean {
    return this.isEnabled;
  }

  async setSpeedAlertsEnabled(enabled: boolean): Promise<void> {
    this.speedAlertsEnabled = enabled;
    this.isEnabled = this.speedAlertsEnabled || this.redLightAlertsEnabled;
    this.hasLoadedSettings = true;
    await this.persistSettings();
    if (this.isEnabled) {
      await this.initTts();
    } else {
      this.stop();
    }
    log.info(`Speed camera alerts ${enabled ? 'enabled' : 'disabled'}`);
  }

  async setRedLightAlertsEnabled(enabled: boolean): Promise<void> {
    this.redLightAlertsEnabled = enabled;
    this.isEnabled = this.speedAlertsEnabled || this.redLightAlertsEnabled;
    this.hasLoadedSettings = true;
    await this.persistSettings();
    if (this.isEnabled) {
      await this.initTts();
    } else {
      this.stop();
    }
    log.info(`Red-light camera alerts ${enabled ? 'enabled' : 'disabled'}`);
  }

  isSpeedAlertsEnabled(): boolean {
    return this.speedAlertsEnabled;
  }

  isRedLightAlertsEnabled(): boolean {
    return this.redLightAlertsEnabled;
  }

  private isCameraTypeEnabled(cameraType: CameraLocation['type']): boolean {
    if (cameraType === 'speed') {
      if (!this.speedAlertsEnabled) return false;
      // Speed cameras only enforce during certain hours — skip alerts outside window
      const hour = new Date().getHours();
      if (hour < SPEED_CAMERA_ENFORCE_START_HOUR || hour >= SPEED_CAMERA_ENFORCE_END_HOUR) {
        return false;
      }
      return true;
    }
    // Red-light cameras enforce 24/7
    return this.redLightAlertsEnabled;
  }

  /**
   * Play a sample camera alert so the user can hear what it sounds like.
   * Used by the Settings screen preview button and useful for App Store review.
   * Returns true if speech started, false if TTS unavailable.
   */
  async previewAlert(): Promise<boolean> {
    const success = await speak('Speed camera ahead.');
    return success;
  }

  // --------------------------------------------------------------------------
  // Start / Stop (called when driving starts/stops)
  // --------------------------------------------------------------------------

  /**
   * Start listening for camera proximity.
   * Called when driving is detected.
   */
  start(): void {
    if (!this.isEnabled) return;

    this.isActive = true;
    this.alertedCameras.clear();
    this.passTrackingByCamera.clear();
    this.recentTrace = [];
    this.lastAnnounceTime = 0;
    this.gpsUpdateCount = 0;
    this.lastDiagnostic = null;
    log.info(`Camera alert monitoring started (speed=${this.speedAlertsEnabled}, redlight=${this.redLightAlertsEnabled}, cameras=${CHICAGO_CAMERAS.length})`);
  }

  /**
   * Stop monitoring. Called when parking is detected.
   */
  stop(): void {
    this.isActive = false;
    this.alertedCameras.clear();
    this.passTrackingByCamera.clear();
    this.recentTrace = [];
    stopSpeech();
    log.info('Camera alert monitoring stopped');
  }

  // --------------------------------------------------------------------------
  // Core: Process GPS Update
  // --------------------------------------------------------------------------

  /**
   * Process a GPS location update. This is the main entry point called
   * from the location listener on each GPS fix.
   *
   * @param latitude Current latitude
   * @param longitude Current longitude
   * @param speed Current speed in m/s (-1 if unavailable)
   * @param heading Current heading in degrees (0-360, -1 if unavailable)
   */
  onLocationUpdate(
    latitude: number,
    longitude: number,
    speed: number,
    heading: number = -1,
    horizontalAccuracyMeters: number | null = null
  ): void {
    if (!this.isActive || !this.isEnabled) return;

    try {
      this.gpsUpdateCount++;
      this.lastLat = latitude;
      this.lastLng = longitude;
      this.appendTracePoint(latitude, longitude, speed, heading, horizontalAccuracyMeters);

      // Clear cooldowns for cameras we've moved far from
      this.clearDistantCooldowns(latitude, longitude);
      this.updatePassTracking(latitude, longitude, speed, heading);

      // Compute speed-adaptive alert radius: faster = earlier warning
      const alertRadius = this.getAlertRadius(speed);

      // Find cameras within alert radius that match our travel direction.
      // Speed filtering is per-camera-type: red light cameras alert at any
      // driving speed (≥1 m/s), speed cameras only at ≥10 mph (4.5 m/s).
      const nearbyCameras = this.findNearbyCameras(latitude, longitude, heading, alertRadius, speed);

      // Periodic diagnostic logging (every 10 GPS updates = ~10s)
      if (this.gpsUpdateCount % 10 === 1) {
        const speedMph = speed >= 0 ? Math.round(speed * 2.237) : -1;
        const diag = this.lastDiagnostic;
        log.info(`[DIAG] GPS#${this.gpsUpdateCount}: ${latitude.toFixed(5)},${longitude.toFixed(5)} spd=${speedMph}mph hdg=${Math.round(heading)}° radius=${alertRadius}m found=${nearbyCameras.length} ` +
          `settings(speed=${this.speedAlertsEnabled},redlight=${this.redLightAlertsEnabled}) ` +
          (diag ? `filter(type=${diag.typeFiltered},spd=${diag.speedFiltered},bbox=${diag.bboxFiltered},dist=${diag.distanceFiltered},hdg=${diag.headingFiltered},brg=${diag.bearingFiltered},pass=${diag.passed}) ` +
            `nearest(rl=${diag.nearestRedlightDistance === Infinity ? 'none' : Math.round(diag.nearestRedlightDistance) + 'm'},sp=${diag.nearestSpeedDistance === Infinity ? 'none' : Math.round(diag.nearestSpeedDistance) + 'm'})` : 'no-diag'));
      }

      if (nearbyCameras.length === 0) return;

      // Alert for the closest camera we haven't alerted yet
      const now = Date.now();
      if (now - this.lastAnnounceTime < MIN_ANNOUNCE_INTERVAL_MS) return;

      for (const { index, camera, distance } of nearbyCameras) {
        if (this.alertedCameras.has(index)) continue;

        // New camera in range - speak alert
        this.announceCamera(camera, distance, speed);
        this.alertedCameras.set(index, { index, alertedAt: now });
        this.passTrackingByCamera.set(index, {
          minDistanceMeters: distance,
          minDistanceTimestamp: now,
          minLatitude: latitude,
          minLongitude: longitude,
          minSpeedMps: speed,
          minHeading: heading,
          alertSpeedMps: speed,
          alertTimestamp: now,
          lastDistanceMeters: distance,
          hasBeenWithinPassDistance: distance <= PASS_CAPTURE_DISTANCE_METERS,
        });
        this.lastAnnounceTime = now;
        break; // Only announce one per GPS update
      }
    } catch (error) {
      // Never let a camera alert bug crash the location listener.
      // Log and continue — the next GPS update will try again.
      log.error('Error in onLocationUpdate', error);
    }
  }

  private updatePassTracking(latitude: number, longitude: number, speed: number, heading: number): void {
    const now = Date.now();

    for (const [index, alerted] of this.alertedCameras) {
      if (now - alerted.alertedAt > PASS_CONFIRM_WINDOW_MS) {
        this.passTrackingByCamera.delete(index);
        continue;
      }

      const camera = CHICAGO_CAMERAS[index];
      if (!this.isCameraTypeEnabled(camera.type)) {
        this.passTrackingByCamera.delete(index);
        continue;
      }
      const distance = distanceMeters(
        latitude,
        longitude,
        camera.latitude,
        camera.longitude
      );

      const existing = this.passTrackingByCamera.get(index);
      const tracking: CameraPassTracking = existing || {
        minDistanceMeters: distance,
        minDistanceTimestamp: now,
        minLatitude: latitude,
        minLongitude: longitude,
        minSpeedMps: speed,
        minHeading: heading,
        alertSpeedMps: speed,
        alertTimestamp: alerted.alertedAt,
        lastDistanceMeters: distance,
        hasBeenWithinPassDistance: distance <= PASS_CAPTURE_DISTANCE_METERS,
      };

      if (distance < tracking.minDistanceMeters) {
        tracking.minDistanceMeters = distance;
        tracking.minDistanceTimestamp = now;
        tracking.minLatitude = latitude;
        tracking.minLongitude = longitude;
        tracking.minSpeedMps = speed;
        tracking.minHeading = heading;
      }

      if (distance <= PASS_CAPTURE_DISTANCE_METERS) {
        tracking.hasBeenWithinPassDistance = true;
      }

      const movedAwayEnough =
        distance >= tracking.minDistanceMeters + PASS_MOVED_AWAY_DELTA_METERS;
      const isPassCandidate =
        tracking.hasBeenWithinPassDistance && movedAwayEnough;

      if (isPassCandidate) {
        const recentPassAt = this.recentPasses.get(index) || 0;
        if (now - recentPassAt >= PASS_DEDUPE_WINDOW_MS) {
          this.recentPasses.set(index, now);
          CameraPassHistoryService.addPassEvent({
            camera,
            userLatitude: tracking.minLatitude,
            userLongitude: tracking.minLongitude,
            timestamp: tracking.minDistanceTimestamp,
            speedMps: tracking.minSpeedMps,
            alertSpeedMps: tracking.alertSpeedMps,
            alertTimestamp: tracking.alertTimestamp,
          });

          if (camera.type === 'redlight') {
            // Fetch accelerometer data asynchronously (fire-and-forget to not block)
            this.recordRedLightReceipt(camera, tracking, now);
          }

          const speedMph =
            tracking.minSpeedMps >= 0
              ? Math.round(tracking.minSpeedMps * 2.237)
              : null;
          log.info(
            `CAMERA PASS RECORDED: ${camera.type} @ ${camera.address} (distance=${Math.round(
              tracking.minDistanceMeters
            )}m, speed=${speedMph ?? '?'} mph)`
          );
        }

        this.passTrackingByCamera.delete(index);
      } else {
        tracking.lastDistanceMeters = distance;
        this.passTrackingByCamera.set(index, tracking);
      }
    }
  }

  private appendTracePoint(
    latitude: number,
    longitude: number,
    speedMps: number,
    heading: number,
    horizontalAccuracyMeters: number | null
  ): void {
    const now = Date.now();
    const point: RedLightTracePoint = {
      timestamp: now,
      latitude,
      longitude,
      speedMps,
      speedMph: speedMps >= 0 ? speedMps * 2.2369362920544 : -1,
      heading,
      horizontalAccuracyMeters,
    };
    this.recentTrace.push(point);
    const cutoff = now - RED_LIGHT_TRACE_WINDOW_MS;
    this.recentTrace = this.recentTrace.filter((p) => p.timestamp >= cutoff);
  }

  private getRecentTrace(now: number): RedLightTracePoint[] {
    const cutoff = now - RED_LIGHT_TRACE_WINDOW_MS;
    return this.recentTrace.filter((p) => p.timestamp >= cutoff);
  }

  /**
   * Compute the alert radius based on current speed.
   * Scales linearly with speed to give ~TARGET_WARNING_SECONDS of warning.
   * Clamped between BASE and MAX to avoid false alerts at high speeds
   * and ensure a minimum useful range at low speeds.
   */
  private getAlertRadius(speed: number): number {
    if (speed < 0) return BASE_ALERT_RADIUS_METERS; // Speed unknown
    const dynamicRadius = speed * TARGET_WARNING_SECONDS;
    return Math.max(BASE_ALERT_RADIUS_METERS, Math.min(dynamicRadius, MAX_ALERT_RADIUS_METERS));
  }

  // --------------------------------------------------------------------------
  // Spatial Search
  // --------------------------------------------------------------------------

  /**
   * Fast bounding box + Haversine search for nearby cameras.
   * Pre-filters with bounding box (O(n) but very fast comparison),
   * then computes exact distance only for candidates.
   * Filters by: (1) heading vs camera approach direction, and
   * (2) bearing-to-camera vs heading (camera must be AHEAD, not to the side).
   *
   * @param heading GPS heading in degrees (0-360), -1 if unavailable
   * @param alertRadius Speed-adaptive alert distance in meters
   */
  private findNearbyCameras(
    lat: number,
    lng: number,
    heading: number = -1,
    alertRadius: number = BASE_ALERT_RADIUS_METERS,
    speed: number = -1
  ): Array<{ index: number; camera: CameraLocation; distance: number }> {
    const results: Array<{ index: number; camera: CameraLocation; distance: number }> = [];

    // Diagnostic counters
    let typeFiltered = 0;
    let speedFiltered = 0;
    let bboxFiltered = 0;
    let distanceFiltered = 0;
    let headingFiltered = 0;
    let bearingFiltered = 0;
    let nearestRedlightDistance = Infinity;
    let nearestSpeedDistance = Infinity;

    const latMin = lat - BBOX_DEGREES;
    const latMax = lat + BBOX_DEGREES;
    const lngMin = lng - BBOX_DEGREES;
    const lngMax = lng + BBOX_DEGREES;

    for (let i = 0; i < CHICAGO_CAMERAS.length; i++) {
      const cam = CHICAGO_CAMERAS[i];
      if (!this.isCameraTypeEnabled(cam.type)) { typeFiltered++; continue; }

      // Per-type speed filtering:
      // - Speed cameras: only alert at ≥10 mph (no point alerting while crawling)
      // - Red light cameras: alert at any driving speed ≥~2 mph
      if (speed >= 0) {
        const minSpeed = cam.type === 'speed' ? MIN_SPEED_SPEED_CAM_MPS : MIN_SPEED_REDLIGHT_MPS;
        if (speed < minSpeed) { speedFiltered++; continue; }
      }

      // Fast bounding box filter
      if (cam.latitude < latMin || cam.latitude > latMax) { bboxFiltered++; continue; }
      if (cam.longitude < lngMin || cam.longitude > lngMax) { bboxFiltered++; continue; }

      // Exact distance
      const distance = distanceMeters(lat, lng, cam.latitude, cam.longitude);

      // Track nearest cameras of each type (even if outside alert radius)
      if (cam.type === 'redlight' && distance < nearestRedlightDistance) {
        nearestRedlightDistance = distance;
      } else if (cam.type === 'speed' && distance < nearestSpeedDistance) {
        nearestSpeedDistance = distance;
      }

      if (distance <= alertRadius) {
        // Direction filter: only alert if user is traveling in a direction
        // this camera monitors. Fail-open if heading unavailable.
        if (!isHeadingMatch(heading, cam.approaches)) {
          headingFiltered++;
          // Log red light heading rejections specifically
          if (cam.type === 'redlight') {
            log.info(`[DIAG] Red light HEADING REJECT: ${cam.address} approaches=${cam.approaches} userHeading=${Math.round(heading)}° dist=${Math.round(distance)}m`);
          }
          continue;
        }

        // Bearing filter: only alert if camera is ahead of us (within ±30° cone).
        // This prevents false alerts from cameras on parallel streets one block over.
        if (!this.isCameraAhead(lat, lng, cam.latitude, cam.longitude, heading)) {
          bearingFiltered++;
          if (cam.type === 'redlight') {
            const bearing = this.bearingTo(lat, lng, cam.latitude, cam.longitude);
            log.info(`[DIAG] Red light BEARING REJECT: ${cam.address} bearing=${Math.round(bearing)}° heading=${Math.round(heading)}° diff=${Math.round(Math.abs(heading - bearing) > 180 ? 360 - Math.abs(heading - bearing) : Math.abs(heading - bearing))}° dist=${Math.round(distance)}m`);
          }
          continue;
        }

        results.push({ index: i, camera: cam, distance });
      } else {
        distanceFiltered++;
      }
    }

    // Store diagnostic info
    let redlightPassed = 0;
    let speedPassed = 0;
    for (const r of results) {
      if (r.camera.type === 'redlight') redlightPassed++;
      else speedPassed++;
    }
    this.lastDiagnostic = {
      totalChecked: CHICAGO_CAMERAS.length,
      typeFiltered,
      speedFiltered,
      bboxFiltered,
      distanceFiltered,
      headingFiltered,
      bearingFiltered,
      passed: results.length,
      redlightPassed,
      speedPassed,
      nearestRedlightDistance,
      nearestSpeedDistance,
    };

    // Sort by distance (closest first)
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  /**
   * Remove cooldowns for cameras the user has moved far from.
   * This allows re-alerting if the user drives past the same camera again.
   */
  private clearDistantCooldowns(lat: number, lng: number): void {
    for (const [index, _alerted] of this.alertedCameras) {
      const cam = CHICAGO_CAMERAS[index];
      const dist = distanceMeters(lat, lng, cam.latitude, cam.longitude);
      if (dist > COOLDOWN_RADIUS_METERS) {
        this.alertedCameras.delete(index);
        this.passTrackingByCamera.delete(index);
      }
    }
  }

  // --------------------------------------------------------------------------
  // TTS Announcement
  // --------------------------------------------------------------------------

  private announceCamera(camera: CameraLocation, distanceMeters: number, speed: number = -1): void {
    // Just awareness — no speed advice (school vs park zone ambiguity)
    // and no action advice (braking at the speed limit is dangerous).
    const message = camera.type === 'redlight'
      ? 'Red-light camera ahead.'
      : 'Speed camera ahead.';

    // Log with speed context for debugging alert timing
    const speedMph = speed >= 0 ? Math.round(speed * 2.237) : -1;
    const secondsToCamera = speed > 0 ? (distanceMeters / speed).toFixed(1) : '?';
    log.info(`CAMERA ALERT: ${message} - ${camera.address} (speed: ${speedMph} mph, ~${secondsToCamera}s away, alertRadius: ${this.getAlertRadius(speed)}m)`);

    speak(message);
  }

  // --------------------------------------------------------------------------
  // Haversine Distance
  // --------------------------------------------------------------------------

  /**
   * Calculate the initial bearing (forward azimuth) from point 1 to point 2.
   * Returns degrees 0-360 (0°=North, 90°=East, 180°=South, 270°=West).
   */
  private bearingTo(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const dLng = toRad(lng2 - lng1);
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x =
      Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    const bearingRad = Math.atan2(y, x);
    return ((bearingRad * 180) / Math.PI + 360) % 360;
  }

  /**
   * Check if a camera is roughly ahead of the user (within their forward cone).
   * Computes the bearing from the user to the camera, then checks if that bearing
   * is within ±MAX_BEARING_OFF_HEADING_DEGREES of the user's GPS heading.
   *
   * This filters out cameras on parallel streets to the side.
   * Fail-open if heading is unavailable.
   */
  private isCameraAhead(
    userLat: number,
    userLng: number,
    camLat: number,
    camLng: number,
    heading: number
  ): boolean {
    // No heading — fail open
    if (heading < 0) return true;

    const bearingToCamera = this.bearingTo(userLat, userLng, camLat, camLng);

    // Angular difference accounting for wrap-around
    let diff = Math.abs(heading - bearingToCamera);
    if (diff > 180) diff = 360 - diff;

    return diff <= MAX_BEARING_OFF_HEADING_DEGREES;
  }

  // --------------------------------------------------------------------------
  // Red Light Receipt (with accelerometer evidence)
  // --------------------------------------------------------------------------

  /**
   * Record a red light receipt with GPS trace + accelerometer data.
   * Async because fetching accelerometer buffer from native is async.
   */
  private async recordRedLightReceipt(
    camera: CameraLocation,
    tracking: CameraPassTracking,
    now: number
  ): Promise<void> {
    try {
      // Fetch the last 30 seconds of accelerometer data from the native buffer
      const accelData = Platform.OS === 'ios'
        ? await BackgroundLocationService.getRecentAccelerometerData(30)
        : [];

      await RedLightReceiptService.addReceipt({
        cameraAddress: camera.address,
        cameraLatitude: camera.latitude,
        cameraLongitude: camera.longitude,
        heading: tracking.minHeading >= 0 ? tracking.minHeading : 0,
        trace: this.getRecentTrace(now),
        deviceTimestamp: tracking.minDistanceTimestamp,
        accelerometerTrace: accelData.length > 0 ? accelData : undefined,
        postedSpeedLimitMph: 30, // Chicago citywide default
      });

      if (accelData.length > 0) {
        log.info(`Red light receipt recorded with ${accelData.length} accelerometer samples`);
      }
    } catch (error) {
      log.error('Failed to record red light receipt', error);
    }
  }

  // --------------------------------------------------------------------------
  // Status
  // --------------------------------------------------------------------------

  getStatus(): CameraAlertStatus {
    return {
      isEnabled: this.isEnabled,
      isActive: this.isActive,
      totalCameras: CHICAGO_CAMERAS.length,
      alertedCount: this.alertedCameras.size,
    };
  }

  /**
   * Diagnostic info for debugging camera alert issues.
   * Returns detailed state including per-type settings and filter stats.
   */
  getDiagnosticInfo(): {
    isEnabled: boolean;
    isActive: boolean;
    speedAlertsEnabled: boolean;
    redLightAlertsEnabled: boolean;
    hasLoadedSettings: boolean;
    totalCameras: number;
    speedCameraCount: number;
    redlightCameraCount: number;
    gpsUpdateCount: number;
    alertedCount: number;
    lastDiagnostic: typeof this.lastDiagnostic;
  } {
    let speedCount = 0;
    let redlightCount = 0;
    for (let i = 0; i < CHICAGO_CAMERAS.length; i++) {
      if (CHICAGO_CAMERAS[i]?.type === 'speed') speedCount++;
      else if (CHICAGO_CAMERAS[i]?.type === 'redlight') redlightCount++;
    }
    return {
      isEnabled: this.isEnabled,
      isActive: this.isActive,
      speedAlertsEnabled: this.speedAlertsEnabled,
      redLightAlertsEnabled: this.redLightAlertsEnabled,
      hasLoadedSettings: this.hasLoadedSettings,
      totalCameras: CHICAGO_CAMERAS.length,
      speedCameraCount: speedCount,
      redlightCameraCount: redlightCount,
      gpsUpdateCount: this.gpsUpdateCount,
      alertedCount: this.alertedCameras.size,
      lastDiagnostic: this.lastDiagnostic,
    };
  }
}

// Singleton export
export default new CameraAlertServiceClass();
