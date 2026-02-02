/**
 * CameraAlertService
 *
 * Speaks audio alerts when the user is driving near speed cameras
 * or red light cameras in Chicago.
 *
 * How it works:
 * 1. Receives GPS updates from BackgroundLocationService (iOS) or
 *    the Android foreground GPS service
 * 2. Filters 510 cameras down to nearby ones using a fast bounding box check
 * 3. Calculates exact distance via Haversine formula
 * 4. Speaks via TTS when within alert radius (~200m)
 * 5. Tracks alerted cameras to avoid repeating until user moves away (~500m)
 *
 * Performance: The bounding box pre-filter means we only compute
 * Haversine for ~2-5 cameras per GPS update, even with 510 total.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHICAGO_CAMERAS, CameraLocation } from '../data/chicago-cameras';
import Logger from '../utils/Logger';

const log = Logger.createLogger('CameraAlertService');

// Lazy-load TTS to avoid NativeEventEmitter crash on iOS
// react-native-tts creates a NativeEventEmitter(null) if native module isn't linked
let Tts: any = null;
function getTts(): any {
  if (!Tts) {
    try {
      Tts = require('react-native-tts').default;
    } catch (e) {
      log.warn('react-native-tts not available');
    }
  }
  return Tts;
}

// ============================================================================
// Configuration
// ============================================================================

/** Distance in meters at which to trigger the alert */
const ALERT_RADIUS_METERS = 200;

/** Distance user must move from camera before it can re-alert */
const COOLDOWN_RADIUS_METERS = 500;

/** Minimum speed (m/s) to trigger alerts - ~10 mph, filters out walking */
const MIN_SPEED_MPS = 4.5;

/** Minimum time between any two TTS announcements (ms) */
const MIN_ANNOUNCE_INTERVAL_MS = 8000;

/** Bounding box size in degrees for fast pre-filter (~250m at Chicago latitude) */
const BBOX_DEGREES = 0.0025;

/** AsyncStorage key for camera alerts enabled setting */
const STORAGE_KEY_ENABLED = 'cameraAlertsEnabled';

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

      log.info(`CameraAlertService initialized. Enabled: ${this.isEnabled}, Cameras: ${CHICAGO_CAMERAS.length}`);
    } catch (error) {
      log.error('Failed to initialize CameraAlertService', error);
    }
  }

  private async initTts(): Promise<void> {
    if (this.ttsInitialized) return;

    try {
      const tts = getTts();
      if (!tts) {
        log.warn('TTS not available on this platform');
        return;
      }

      // Configure TTS
      await tts.setDefaultLanguage('en-US');
      await tts.setDefaultRate(Platform.OS === 'ios' ? 0.52 : 0.5);
      await tts.setDefaultPitch(1.0);

      // iOS: allow mixing with other audio (navigation, music)
      if (Platform.OS === 'ios') {
        await tts.setDucking(true);
      }

      this.ttsInitialized = true;
      log.info('TTS engine initialized');
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
    const tts = getTts();
    if (tts) tts.stop();
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
   */
  onLocationUpdate(latitude: number, longitude: number, speed: number): void {
    if (!this.isActive || !this.isEnabled) return;

    // Don't alert if not moving fast enough (filters out walking, sitting)
    if (speed >= 0 && speed < MIN_SPEED_MPS) return;

    this.lastLat = latitude;
    this.lastLng = longitude;

    // Clear cooldowns for cameras we've moved far from
    this.clearDistantCooldowns(latitude, longitude);

    // Find cameras within alert radius
    const nearbyCameras = this.findNearbyCameras(latitude, longitude);

    if (nearbyCameras.length === 0) return;

    // Alert for the closest camera we haven't alerted yet
    const now = Date.now();
    if (now - this.lastAnnounceTime < MIN_ANNOUNCE_INTERVAL_MS) return;

    for (const { index, camera, distance } of nearbyCameras) {
      if (this.alertedCameras.has(index)) continue;

      // New camera in range - speak alert
      this.announceCamera(camera, distance);
      this.alertedCameras.set(index, { index, alertedAt: now });
      this.lastAnnounceTime = now;
      break; // Only announce one per GPS update
    }
  }

  // --------------------------------------------------------------------------
  // Spatial Search
  // --------------------------------------------------------------------------

  /**
   * Fast bounding box + Haversine search for nearby cameras.
   * Pre-filters with bounding box (O(n) but very fast comparison),
   * then computes exact distance only for candidates.
   */
  private findNearbyCameras(
    lat: number,
    lng: number
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
      if (distance <= ALERT_RADIUS_METERS) {
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

  private announceCamera(camera: CameraLocation, distanceMeters: number): void {
    const type = camera.type === 'speed' ? 'Speed camera' : 'Red light camera';
    const dist = Math.round(distanceMeters);

    // Keep it short and clear for driving
    const message = `${type} ahead, ${dist} meters`;

    log.info(`CAMERA ALERT: ${message} - ${camera.address}`);

    try {
      const tts = getTts();
      if (tts) tts.speak(message);
    } catch (error) {
      log.error('TTS speak failed', error);
    }
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
