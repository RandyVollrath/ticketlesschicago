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
function getAndroidTts(): any {
  if (Platform.OS !== 'android') return null;
  if (!AndroidTts) {
    try {
      AndroidTts = require('react-native-tts').default;
    } catch (e) {
      log.warn('react-native-tts not available on Android');
    }
  }
  return AndroidTts;
}

/**
 * Speak a message using the platform-appropriate TTS engine.
 */
async function speak(message: string): Promise<void> {
  if (Platform.OS === 'ios') {
    if (SpeechModule) {
      try {
        await SpeechModule.speak(message);
      } catch (e) {
        log.error('iOS SpeechModule.speak failed', e);
      }
    } else {
      log.warn('iOS SpeechModule not available — native module not linked');
    }
  } else {
    const tts = getAndroidTts();
    if (tts) {
      try {
        tts.speak(message);
      } catch (e) {
        log.error('Android TTS speak failed', e);
      }
    } else {
      log.warn('Android TTS not available');
    }
  }
}

/**
 * Stop any current speech.
 */
async function stopSpeech(): Promise<void> {
  if (Platform.OS === 'ios') {
    if (SpeechModule) {
      try { await SpeechModule.stop(); } catch (_) {}
    }
  } else {
    const tts = getAndroidTts();
    if (tts) {
      try { tts.stop(); } catch (_) {}
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

/** Minimum speed (m/s) to trigger alerts - ~10 mph, filters out walking */
const MIN_SPEED_MPS = 4.5;

/** Minimum time between any two TTS announcements (ms) */
const MIN_ANNOUNCE_INTERVAL_MS = 5000;

/**
 * Bounding box size in degrees for fast pre-filter.
 * ~280m at Chicago latitude — larger than MAX_ALERT_RADIUS_METERS
 * to ensure no cameras at the edge are missed at any speed.
 */
const BBOX_DEGREES = 0.0025;

/** AsyncStorage key for camera alerts enabled setting */
const STORAGE_KEY_ENABLED = 'cameraAlertsEnabled';

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
  private isActive = false;
  private ttsInitialized = false;

  /** Set of camera indices we've already alerted about */
  private alertedCameras: Map<number, AlertedCamera> = new Map();

  /** Timestamp of last TTS announcement */
  private lastAnnounceTime = 0;

  /** Track last known position for cooldown clearing */
  private lastLat = 0;
  private lastLng = 0;

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize TTS engine. Call once during app startup.
   */
  async initialize(): Promise<void> {
    try {
      // Load saved preference
      const stored = await AsyncStorage.getItem(STORAGE_KEY_ENABLED);
      this.isEnabled = stored === 'true';

      if (this.isEnabled) {
        await this.initTts();
      }

      log.info(`CameraAlertService initialized. Enabled: ${this.isEnabled}, Cameras: ${CHICAGO_CAMERAS.length}, Platform: ${Platform.OS}`);
    } catch (error) {
      log.error('Failed to initialize CameraAlertService', error);
    }
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
        const tts = getAndroidTts();
        if (!tts) {
          log.warn('Android TTS not available');
          return;
        }

        await tts.setDefaultLanguage('en-US');
        await tts.setDefaultRate(0.5);
        await tts.setDefaultPitch(1.0);

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
    await AsyncStorage.setItem(STORAGE_KEY_ENABLED, enabled ? 'true' : 'false');

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
    this.lastAnnounceTime = 0;
    log.info('Camera alert monitoring started');
  }

  /**
   * Stop monitoring. Called when parking is detected.
   */
  stop(): void {
    this.isActive = false;
    this.alertedCameras.clear();
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
  onLocationUpdate(latitude: number, longitude: number, speed: number, heading: number = -1): void {
    if (!this.isActive || !this.isEnabled) return;

    // Don't alert if not moving fast enough (filters out walking, sitting)
    if (speed >= 0 && speed < MIN_SPEED_MPS) return;

    this.lastLat = latitude;
    this.lastLng = longitude;

    // Clear cooldowns for cameras we've moved far from
    this.clearDistantCooldowns(latitude, longitude);

    // Compute speed-adaptive alert radius: faster = earlier warning
    const alertRadius = this.getAlertRadius(speed);

    // Find cameras within alert radius that match our travel direction
    const nearbyCameras = this.findNearbyCameras(latitude, longitude, heading, alertRadius);

    if (nearbyCameras.length === 0) return;

    // Alert for the closest camera we haven't alerted yet
    const now = Date.now();
    if (now - this.lastAnnounceTime < MIN_ANNOUNCE_INTERVAL_MS) return;

    for (const { index, camera, distance } of nearbyCameras) {
      if (this.alertedCameras.has(index)) continue;

      // New camera in range - speak alert
      this.announceCamera(camera, distance, speed);
      this.alertedCameras.set(index, { index, alertedAt: now });
      this.lastAnnounceTime = now;
      break; // Only announce one per GPS update
    }
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
    alertRadius: number = BASE_ALERT_RADIUS_METERS
  ): Array<{ index: number; camera: CameraLocation; distance: number }> {
    const results: Array<{ index: number; camera: CameraLocation; distance: number }> = [];

    const latMin = lat - BBOX_DEGREES;
    const latMax = lat + BBOX_DEGREES;
    const lngMin = lng - BBOX_DEGREES;
    const lngMax = lng + BBOX_DEGREES;

    for (let i = 0; i < CHICAGO_CAMERAS.length; i++) {
      const cam = CHICAGO_CAMERAS[i];

      // Fast bounding box filter
      if (cam.latitude < latMin || cam.latitude > latMax) continue;
      if (cam.longitude < lngMin || cam.longitude > lngMax) continue;

      // Exact distance
      const distance = this.haversineMeters(lat, lng, cam.latitude, cam.longitude);
      if (distance <= alertRadius) {
        // Direction filter: only alert if user is traveling in a direction
        // this camera monitors. Fail-open if heading unavailable.
        if (!isHeadingMatch(heading, cam.approaches)) continue;

        // Bearing filter: only alert if camera is ahead of us (within ±30° cone).
        // This prevents false alerts from cameras on parallel streets one block over.
        if (!this.isCameraAhead(lat, lng, cam.latitude, cam.longitude, heading)) continue;

        results.push({ index: i, camera: cam, distance });
      }
    }

    // Sort by distance (closest first)
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  /**
   * Remove cooldowns for cameras the user has moved far from.
   * This allows re-alerting if the user drives past the same camera again.
   */
  private clearDistantCooldowns(lat: number, lng: number): void {
    for (const [index, alerted] of this.alertedCameras) {
      const cam = CHICAGO_CAMERAS[index];
      const dist = this.haversineMeters(lat, lng, cam.latitude, cam.longitude);
      if (dist > COOLDOWN_RADIUS_METERS) {
        this.alertedCameras.delete(index);
      }
    }
  }

  // --------------------------------------------------------------------------
  // TTS Announcement
  // --------------------------------------------------------------------------

  private announceCamera(camera: CameraLocation, distanceMeters: number, speed: number = -1): void {
    const type = camera.type === 'speed' ? 'Speed camera' : 'Red light camera';
    const dist = Math.round(distanceMeters);

    // Keep it short and clear for driving
    const message = `${type} ahead, ${dist} meters`;

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
   * Calculate distance between two lat/lng points in meters.
   * Uses the Haversine formula.
   */
  private haversineMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const R = 6371000; // Earth radius in meters
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

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
    const dLng = this.toRad(lng2 - lng1);
    const lat1Rad = this.toRad(lat1);
    const lat2Rad = this.toRad(lat2);

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
}

// Singleton export
export default new CameraAlertServiceClass();
