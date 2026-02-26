import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import Geolocation, { GeoPosition, GeoError, GeoOptions } from 'react-native-geolocation-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native';
import ApiClient, { ApiErrorType } from '../utils/ApiClient';
import { distanceMeters } from '../utils/geo';
import Logger from '../utils/Logger';
import { validateChicagoCoordinates, validateParkingApiResponse } from '../utils/validation';
import { RateLimiter } from '../utils/RateLimiter';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('LocationService');

export interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban' | 'tow_zone' | 'metered_parking';
  message: string;
  severity: 'critical' | 'warning' | 'info';
  // Additional metadata for enhanced display
  schedule?: string;
  zoneName?: string;
  nextDate?: string;
  isActiveNow?: boolean;
  // Metered parking metadata
  timeLimitMinutes?: number;
  estimatedRate?: string;
  isEnforcedNow?: boolean;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number; // in meters
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
}

/**
 * Enhanced coordinates with confidence metadata from burst sampling
 */
export interface EnhancedCoordinates extends Coordinates {
  /** Number of GPS samples that contributed to this position */
  sampleCount: number;
  /** Standard deviation of samples in meters - lower is better */
  spreadMeters: number;
  /** Confidence tier based on accuracy + sample consistency */
  confidence: LocationConfidence;
}

export type LocationConfidence = 'high' | 'medium' | 'low' | 'very_low';

export type LocationAccuracy = 'high' | 'balanced' | 'low';

// Constants for burst sampling
const BURST_MIN_SAMPLES = 3;
const BURST_TARGET_SAMPLES = 5;
const BURST_MAX_WAIT_MS = 6000; // shorter window to avoid walk-away drift
const BURST_OUTLIER_THRESHOLD_METERS = 50; // discard samples >50m from median

// Watch subscription ID for continuous tracking
let watchId: number | null = null;

// Last known good location cache
interface CachedLocation {
  coords: Coordinates;
  timestamp: number;
}
let lastKnownLocation: CachedLocation | null = null;
const LOCATION_CACHE_MAX_AGE_MS = 120000; // 2 minutes - allows using cached location from recent driving

export interface ParkingCheckResult {
  coords: Coordinates;
  address: string;
  rules: ParkingRule[];
  timestamp: number;
  /** Raw API response data — used by BackgroundTaskService for scheduling advance reminders */
  rawApiData?: any;
}

class LocationServiceClass {
  /**
   * Request location permissions with support for background location on Android
   * @param includeBackground - Whether to request background location (Android 10+)
   */
  async requestLocationPermission(includeBackground: boolean = false): Promise<boolean> {
    if (Platform.OS === 'ios') {
      // iOS: Request authorization through the native Geolocation API
      return new Promise((resolve) => {
        Geolocation.requestAuthorization('always');
        // Give iOS time to process the request
        setTimeout(() => resolve(true), 500);
      });
    }

    try {
      // First, request fine location permission
      const fineLocationGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'Ticketless Chicago needs access to your location to check parking restrictions where you park.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );

      if (fineLocationGranted !== PermissionsAndroid.RESULTS.GRANTED) {
        log.warn('Fine location permission denied');
        return false;
      }

      // For Android 10+ (API 29+), request background location separately
      if (includeBackground && Number(Platform.Version) >= 29) {
        const backgroundGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
          {
            title: 'Allow Background Location',
            message:
              'To automatically check parking restrictions when you park, please select "Allow all the time" on the next screen. This lets Autopilot protect you even when the app is closed.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );

        if (backgroundGranted !== PermissionsAndroid.RESULTS.GRANTED) {
          log.warn('Background location permission denied - auto-detection may not work when app is closed');
          // Still return true since we have foreground permission
          // Background is optional but recommended
        }
      }

      return true;
    } catch (err) {
      log.error('Error requesting location permission', err);
      return false;
    }
  }

  /**
   * Check if location services are enabled on the device
   */
  async checkLocationServicesEnabled(): Promise<boolean> {
    return new Promise((resolve) => {
      Geolocation.getCurrentPosition(
        () => resolve(true),
        (error) => {
          // Error code 2 means position unavailable (services disabled)
          // Error code 1 means permission denied
          if (error.code === 2) {
            resolve(false);
          } else {
            resolve(true); // Services enabled but other error
          }
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: Infinity, forceLocationManager: true }
      );
    });
  }

  /**
   * Prompt user to enable location services
   */
  async promptEnableLocationServices(): Promise<void> {
    Alert.alert(
      'Location Services Disabled',
      'Please enable location services in your device settings to use parking detection.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => {
            if (Platform.OS === 'ios') {
              Linking.openURL('app-settings:');
            } else {
              Linking.openSettings();
            }
          },
        },
      ]
    );
  }

  /**
   * Get current location with high accuracy using native GPS
   * Uses multiple strategies to get the most accurate position:
   * 1. Try high accuracy first (uses GPS + network)
   * 2. Wait for better accuracy if initial reading is poor
   * 3. Fall back to balanced accuracy if high accuracy fails
   */
  getCurrentLocation(accuracy: LocationAccuracy = 'high', forceNoCache: boolean = false): Promise<Coordinates> {
    const options: GeoOptions = this.getLocationOptions(accuracy);

    // When forceNoCache is true, never accept cached positions from the OS.
    // This is critical for parking checks where the device cache may contain
    // a stale position from while driving (which could be blocks away).
    if (forceNoCache) {
      options.maximumAge = 0;
    }

    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position: GeoPosition) => {
          const coords: Coordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
          };

          log.debug('Location obtained', {
            lat: coords.latitude.toFixed(6),
            lng: coords.longitude.toFixed(6),
            accuracy: coords.accuracy ? `${coords.accuracy.toFixed(1)}m` : 'unknown',
          });

          // Always cache successful location reads for background fallback
          this.cacheLocation(coords);

          resolve(coords);
        },
        (error: GeoError) => {
          log.error('Error getting location', { code: error.code, message: error.message });

          // If high accuracy fails, try balanced accuracy as fallback
          if (accuracy === 'high') {
            log.info('Falling back to balanced accuracy');
            this.getCurrentLocation('balanced', forceNoCache)
              .then(resolve)
              .catch(reject);
          } else {
            reject(error);
          }
        },
        options
      );
    });
  }

  /**
   * Get location options based on desired accuracy level
   * Prioritize accuracy - we need precise locations for parking checks
   */
  private getLocationOptions(accuracy: LocationAccuracy): GeoOptions {
    switch (accuracy) {
      case 'high':
        return {
          enableHighAccuracy: true,
          timeout: 15000, // 15 seconds for GPS
          maximumAge: 5000, // Only accept 5-second old cache for high accuracy
          forceRequestLocation: true, // Force new GPS reading
          forceLocationManager: true, // Use Android LocationManager to avoid Play Services crash
          showLocationDialog: true, // Show dialog if location is off (Android)
        };
      case 'balanced':
        return {
          enableHighAccuracy: true,
          timeout: 12000, // 12 seconds
          maximumAge: 15000, // Accept 15-second old cache
          forceRequestLocation: true, // Force fresh location
          forceLocationManager: true, // Use Android LocationManager to avoid Play Services crash
          showLocationDialog: true,
        };
      case 'low':
        return {
          enableHighAccuracy: false,
          timeout: 8000, // 8 seconds
          maximumAge: 30000, // Accept 30-second old cache
          forceRequestLocation: false,
          forceLocationManager: true, // Use location manager
          showLocationDialog: true,
        };
    }
  }

  /**
   * Get high-accuracy location by waiting for GPS to stabilize
   * This method waits for a position with accuracy better than the threshold
   * or times out after the specified duration.
   *
   * Returns plain Coordinates for backward compatibility.
   * Use getParkingLocation() for the full burst-sampled + confidence result.
   */
  async getHighAccuracyLocation(
    targetAccuracyMeters: number = 50,
    maxWaitMs: number = 20000,
    forceNoCache: boolean = false
  ): Promise<Coordinates> {
    // Use watchPosition on BOTH platforms for consistent burst behavior
    return new Promise((resolve, reject) => {
      let bestPosition: Coordinates | null = null;
      let resolved = false;
      const startTime = Date.now();

      const options = {
        enableHighAccuracy: true,
        distanceFilter: 0,
        interval: 1000,
        fastestInterval: 500,
        forceRequestLocation: true,
        forceLocationManager: true,
        showLocationDialog: true,
      };

      log.info(`Getting high accuracy location (target: ${targetAccuracyMeters}m, platform: ${Platform.OS})`);

      const id = Geolocation.watchPosition(
        (position: GeoPosition) => {
          if (resolved) return;

          const coords: Coordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
          };

          log.debug('High accuracy update', {
            accuracy: coords.accuracy ? `${coords.accuracy.toFixed(1)}m` : 'unknown',
            elapsed: `${Date.now() - startTime}ms`,
          });

          // Keep track of best position
          if (!bestPosition || (coords.accuracy && bestPosition.accuracy && coords.accuracy < bestPosition.accuracy)) {
            bestPosition = coords;
          }

          // If we've achieved target accuracy, resolve immediately
          if (coords.accuracy && coords.accuracy <= targetAccuracyMeters) {
            resolved = true;
            Geolocation.clearWatch(id);
            log.info(`Achieved target accuracy: ${coords.accuracy.toFixed(1)}m in ${Date.now() - startTime}ms`);
            this.cacheLocation(coords);
            resolve(coords);
          }
        },
        (error: GeoError) => {
          if (!resolved) {
            resolved = true;
            Geolocation.clearWatch(id);
            log.error('watchPosition error in getHighAccuracyLocation', { code: error.code, message: error.message });

            // Return best position if we have one, otherwise fall back
            if (bestPosition) {
              log.info(`Watch errored but have best position: ${bestPosition.accuracy?.toFixed(1)}m`);
              this.cacheLocation(bestPosition);
              resolve(bestPosition);
            } else {
              // Fall back to single getCurrentPosition
              this.getCurrentLocation('high', forceNoCache)
                .then((coords) => { this.cacheLocation(coords); resolve(coords); })
                .catch(reject);
            }
          }
        },
        options
      );

      // Timeout handler - return best position we got
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          Geolocation.clearWatch(id);

          if (bestPosition) {
            log.info(`Timeout reached (${maxWaitMs}ms), using best: ${bestPosition.accuracy?.toFixed(1)}m`);
            this.cacheLocation(bestPosition);
            resolve(bestPosition);
          } else {
            this.getCurrentLocation('balanced', forceNoCache)
              .then((coords) => { this.cacheLocation(coords); resolve(coords); })
              .catch(reject);
          }
        }
      }, maxWaitMs);
    });
  }

  /**
   * Burst-sample GPS for parking location.
   *
   * Collects multiple GPS fixes over ~10 seconds, discards outliers,
   * and returns the weighted-average position with confidence metadata.
   *
   * This is the primary method to call when the car parks (BT disconnects).
   * It produces a much more accurate "where am I parked" coordinate than
   * a single getCurrentPosition call.
   */
  async getParkingLocation(): Promise<EnhancedCoordinates> {
    return new Promise((resolve, reject) => {
      const samples: Coordinates[] = [];
      let resolved = false;
      const startTime = Date.now();

      const options = {
        enableHighAccuracy: true,
        distanceFilter: 0,
        interval: 800,
        fastestInterval: 400,
        forceRequestLocation: true,
        forceLocationManager: true,
        showLocationDialog: true,
      };

      log.info('Starting burst sampling for parking location');

      const id = Geolocation.watchPosition(
        (position: GeoPosition) => {
          if (resolved) return;

          const coords: Coordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
          };

          // Only keep samples with reported accuracy under 100m
          if (coords.accuracy && coords.accuracy <= 100) {
            samples.push(coords);
            log.debug(`Burst sample ${samples.length}: ${coords.accuracy.toFixed(1)}m`, {
              lat: coords.latitude.toFixed(6),
              lng: coords.longitude.toFixed(6),
            });
          }

          // Resolve early if we have enough high-quality samples
          if (samples.length >= BURST_TARGET_SAMPLES) {
            resolved = true;
            Geolocation.clearWatch(id);
            const result = this.processBurstSamples(samples);
            log.info(`Burst complete (early): ${samples.length} samples, ${result.accuracy?.toFixed(1)}m accuracy, confidence=${result.confidence}`);
            this.cacheLocation(result);
            resolve(result);
          }
        },
        (error: GeoError) => {
          if (!resolved) {
            log.warn('Burst sampling watch error', { code: error.code, message: error.message });
            // Don't reject yet - wait for timeout to use whatever samples we have
          }
        },
        options
      );

      // After BURST_MAX_WAIT_MS, process whatever we have
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        Geolocation.clearWatch(id);

        if (samples.length >= BURST_MIN_SAMPLES) {
          const result = this.processBurstSamples(samples);
          log.info(`Burst complete (timeout): ${samples.length} samples, ${result.accuracy?.toFixed(1)}m accuracy, confidence=${result.confidence}`);
          this.cacheLocation(result);
          resolve(result);
        } else if (samples.length > 0) {
          // Not enough for proper averaging - use single best
          const best = samples.reduce((a, b) =>
            (a.accuracy || 9999) < (b.accuracy || 9999) ? a : b
          );
          const result: EnhancedCoordinates = {
            ...best,
            sampleCount: samples.length,
            spreadMeters: 0,
            confidence: this.computeConfidence(best.accuracy || 9999, 0, samples.length),
          };
          log.info(`Burst incomplete: ${samples.length} samples, using best at ${best.accuracy?.toFixed(1)}m`);
          this.cacheLocation(result);
          resolve(result);
        } else {
          // No samples at all - fall back to single-shot
          log.warn('Burst sampling got 0 samples, falling back to single-shot');
          this.getHighAccuracyLocation(50, 15000, true)
            .then((coords) => {
              resolve({
                ...coords,
                sampleCount: 1,
                spreadMeters: 0,
                confidence: this.computeConfidence(coords.accuracy || 9999, 0, 1),
              });
            })
            .catch(reject);
        }
      }, BURST_MAX_WAIT_MS);
    });
  }

  /**
   * Process burst samples: discard outliers, compute weighted average.
   *
   * Algorithm:
   * 1. Compute the median position (robust to outliers)
   * 2. Discard any sample > BURST_OUTLIER_THRESHOLD_METERS from median
   * 3. Compute accuracy-weighted average of remaining samples
   * 4. Calculate spread (standard deviation) as a consistency metric
   * 5. Assign a confidence tier
   */
  private processBurstSamples(samples: Coordinates[]): EnhancedCoordinates {
    if (samples.length === 0) {
      throw new Error('Cannot process empty sample set');
    }

    if (samples.length === 1) {
      return {
        ...samples[0],
        sampleCount: 1,
        spreadMeters: 0,
        confidence: this.computeConfidence(samples[0].accuracy || 9999, 0, 1),
      };
    }

    // Step 1: Find median position (sort by lat, pick middle)
    const sortedByLat = [...samples].sort((a, b) => a.latitude - b.latitude);
    const sortedByLng = [...samples].sort((a, b) => a.longitude - b.longitude);
    const midIdx = Math.floor(samples.length / 2);
    const medianLat = sortedByLat[midIdx].latitude;
    const medianLng = sortedByLng[midIdx].longitude;

    // Step 2: Discard outliers
    const filtered = samples.filter((s) => {
      const dist = distanceMeters(s.latitude, s.longitude, medianLat, medianLng);
      return dist <= BURST_OUTLIER_THRESHOLD_METERS;
    });

    // If too aggressive, fall back to all samples
    const usable = filtered.length >= BURST_MIN_SAMPLES ? filtered : samples;

    // Step 3: Accuracy-weighted average
    // Weight = 1 / accuracy^2 (inverse variance weighting)
    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLng = 0;
    let bestAccuracy = 9999;
    let bestHeading: number | null = null;
    let bestSpeed: number | null = null;

    for (const s of usable) {
      const acc = s.accuracy || 50; // default 50m if missing
      const weight = 1 / (acc * acc);
      totalWeight += weight;
      weightedLat += s.latitude * weight;
      weightedLng += s.longitude * weight;

      if (acc < bestAccuracy) {
        bestAccuracy = acc;
        bestHeading = s.heading ?? null;
        bestSpeed = s.speed ?? null;
      }
    }

    const avgLat = weightedLat / totalWeight;
    const avgLng = weightedLng / totalWeight;

    // Step 4: Compute spread (RMS distance from average)
    let sumSquaredDist = 0;
    for (const s of usable) {
      const dist = distanceMeters(s.latitude, s.longitude, avgLat, avgLng);
      sumSquaredDist += dist * dist;
    }
    const spreadMeters = Math.sqrt(sumSquaredDist / usable.length);

    // The effective accuracy is the better of: best reported accuracy, or the spread
    // This accounts for cases where GPS reports good accuracy but samples scatter
    const effectiveAccuracy = Math.max(Math.min(bestAccuracy, spreadMeters * 2), spreadMeters);

    // Step 5: Confidence
    const confidence = this.computeConfidence(effectiveAccuracy, spreadMeters, usable.length);

    return {
      latitude: avgLat,
      longitude: avgLng,
      accuracy: effectiveAccuracy,
      altitude: usable[0].altitude,
      altitudeAccuracy: usable[0].altitudeAccuracy,
      heading: bestHeading,
      speed: bestSpeed,
      sampleCount: usable.length,
      spreadMeters,
      confidence,
    };
  }

  /**
   * Compute confidence tier based on accuracy, spread, and sample count.
   *
   * high:     accuracy <= 15m AND spread <= 10m AND samples >= 3
   * medium:   accuracy <= 30m AND spread <= 25m AND samples >= 2
   * low:      accuracy <= 75m
   * very_low: everything else
   */
  private computeConfidence(
    accuracyMeters: number,
    spreadMeters: number,
    sampleCount: number
  ): LocationConfidence {
    if (accuracyMeters <= 15 && spreadMeters <= 10 && sampleCount >= 3) {
      return 'high';
    }
    if (accuracyMeters <= 30 && spreadMeters <= 25 && sampleCount >= 2) {
      return 'medium';
    }
    if (accuracyMeters <= 75) {
      return 'low';
    }
    return 'very_low';
  }

  /**
   * Haversine distance between two lat/lng points in meters.
   * Used for outlier detection and spread calculation.
   */
  // haversineDistance removed — now imported from utils/geo.ts

  /**
   * Start continuous location watching for better accuracy over time
   * Returns a cleanup function to stop watching
   */
  startWatchingLocation(
    onLocationUpdate: (coords: Coordinates) => void,
    onError?: (error: GeoError) => void,
    distanceFilterMeters: number = 10
  ): () => void {
    // Clear any existing watch
    this.stopWatchingLocation();

    const options = {
      enableHighAccuracy: true,
      distanceFilter: distanceFilterMeters,
      interval: 5000, // Android: 5 second intervals
      fastestInterval: 2000, // Android: accept faster if available
      forceRequestLocation: true,
      forceLocationManager: true, // Use Android LocationManager to avoid Play Services crash
      showLocationDialog: true,
    };

    watchId = Geolocation.watchPosition(
      (position: GeoPosition) => {
        const coords: Coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        };
        onLocationUpdate(coords);
      },
      (error: GeoError) => {
        log.error('Watch position error', error);
        onError?.(error);
      },
      options
    );

    log.info('Started watching location');

    return () => this.stopWatchingLocation();
  }

  /**
   * Stop watching location updates
   */
  stopWatchingLocation(): void {
    if (watchId !== null) {
      Geolocation.clearWatch(watchId);
      watchId = null;
      log.info('Stopped watching location');
    }
  }

  /**
   * Get location with automatic retry on failure
   * Tries up to maxRetries times with exponential backoff
   */
  async getLocationWithRetry(
    maxRetries: number = 3,
    onRetry?: (attempt: number, maxAttempts: number) => void,
    forceNoCache: boolean = false
  ): Promise<Coordinates> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use high accuracy for first attempt, fall back to balanced for retries
        const accuracy: LocationAccuracy = attempt === 1 ? 'high' : 'balanced';
        const coords = await this.getCurrentLocation(accuracy, forceNoCache);

        // Cache successful location
        this.cacheLocation(coords);

        return coords;
      } catch (error) {
        lastError = error as Error;
        log.warn(`Location attempt ${attempt}/${maxRetries} failed`, error);

        if (attempt < maxRetries) {
          // Notify caller of retry
          onRetry?.(attempt, maxRetries);

          // Exponential backoff: 1s, 2s, 4s...
          const delayMs = Math.pow(2, attempt - 1) * 1000;
          await new Promise<void>(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries failed - try to return cached location if available
    const cached = this.getCachedLocation();
    if (cached) {
      log.info('Using cached location after retry failures');
      return cached;
    }

    throw lastError || new Error('Failed to get location after multiple attempts');
  }

  /**
   * Cache a location for later use
   */
  private cacheLocation(coords: Coordinates): void {
    lastKnownLocation = {
      coords,
      timestamp: Date.now(),
    };
  }

  /**
   * Get cached location if still valid
   */
  getCachedLocation(): Coordinates | null {
    if (!lastKnownLocation) return null;

    const age = Date.now() - lastKnownLocation.timestamp;
    if (age > LOCATION_CACHE_MAX_AGE_MS) {
      lastKnownLocation = null;
      return null;
    }

    return lastKnownLocation.coords;
  }

  /**
   * Get the last known location regardless of age (useful for showing approximate position)
   */
  getLastKnownLocation(): Coordinates | null {
    return lastKnownLocation?.coords || null;
  }

  /**
   * Clear the location cache
   */
  clearLocationCache(): void {
    lastKnownLocation = null;
  }

  /**
   * Get accuracy description for UI display
   */
  getAccuracyDescription(accuracyMeters?: number): { label: string; color: string } {
    if (!accuracyMeters) {
      return { label: 'Unknown', color: '#6B7280' }; // gray
    }

    if (accuracyMeters <= 10) {
      return { label: 'Excellent', color: '#10B981' }; // green
    } else if (accuracyMeters <= 25) {
      return { label: 'Good', color: '#10B981' }; // green
    } else if (accuracyMeters <= 50) {
      return { label: 'Fair', color: '#F59E0B' }; // amber
    } else if (accuracyMeters <= 100) {
      return { label: 'Poor', color: '#F59E0B' }; // amber
    } else {
      return { label: 'Very Poor', color: '#EF4444' }; // red
    }
  }

  /**
   * Get confidence description for UI display.
   * Uses the richer EnhancedCoordinates confidence tier if available.
   */
  getConfidenceDescription(confidence: LocationConfidence): { label: string; color: string; caveat: string } {
    switch (confidence) {
      case 'high':
        return { label: 'High Confidence', color: '#10B981', caveat: '' };
      case 'medium':
        return { label: 'Good', color: '#10B981', caveat: '' };
      case 'low':
        return { label: 'Approximate', color: '#F59E0B', caveat: 'Restrictions shown may include nearby streets.' };
      case 'very_low':
        return { label: 'Low Accuracy', color: '#EF4444', caveat: 'Location uncertain. Please verify restrictions manually.' };
    }
  }

  async checkParkingRules(coords: Coordinates): Promise<ParkingRule[]> {
    const result = await this.checkParkingLocation(coords);
    return result.rules;
  }

  async checkParkingLocation(coords: Coordinates): Promise<ParkingCheckResult> {
    // Validate coordinates
    const coordValidation = validateChicagoCoordinates(coords);
    if (!coordValidation.valid) {
      throw new Error(coordValidation.error || 'Invalid coordinates');
    }

    // Log warning if outside Chicago
    if (coordValidation.warning) {
      log.warn(coordValidation.warning);
    }

    // Pass accuracy + heading to server so it can decide whether to snap-to-street
    // and disambiguate which street the car is on at intersections.
    const accuracyParam = coords.accuracy ? `&accuracy=${coords.accuracy.toFixed(1)}` : '';
    const confidenceParam = (coords as EnhancedCoordinates).confidence
      ? `&confidence=${(coords as EnhancedCoordinates).confidence}`
      : '';
    const headingParam = (coords.heading != null && coords.heading >= 0) ? `&heading=${coords.heading.toFixed(1)}` : '';
    const endpoint = `/api/mobile/check-parking?lat=${coords.latitude}&lng=${coords.longitude}${accuracyParam}${confidenceParam}${headingParam}`;

    // Use rate-limited request with caching
    const response = await RateLimiter.rateLimitedRequest(
      endpoint,
      async () => {
        return ApiClient.get<any>(endpoint, {
          retries: 3,
          timeout: 20000, // 20 second timeout for location checks
          showErrorAlert: false, // Handle errors ourselves
        });
      },
      {
        cacheDurationMs: 30000, // Cache for 30 seconds
      }
    );

    if (!response.success) {
      // Provide more specific error messages
      let errorMessage: string;
      if (response.error?.message === 'outside_chicago') {
        errorMessage = 'This app monitors Chicago parking restrictions. Your current location appears to be outside the Chicago area. Please use the app when parked in Chicago.';
      } else if (response.error?.type === ApiErrorType.NETWORK_ERROR) {
        errorMessage = 'No internet connection. Please check your network and try again.';
      } else if (response.error?.type === ApiErrorType.TIMEOUT_ERROR) {
        errorMessage = 'Request timed out. The server may be busy. Please try again.';
      } else {
        errorMessage = 'Failed to check parking rules. Please try again.';
      }

      throw new Error(errorMessage);
    }

    // Validate API response
    const responseValidation = validateParkingApiResponse(response.data);
    if (!responseValidation.valid) {
      log.error('Invalid API response structure', response.data);
      throw new Error(responseValidation.error || 'Invalid server response');
    }

    const data = response.data;
    const rules: ParkingRule[] = [];

    // Street cleaning - only show as active restriction if it's NOW or TODAY
    // Don't show UPCOMING as it means it's off-season (like January, before April 1)
    if (data?.streetCleaning?.hasRestriction &&
        (data.streetCleaning.timing === 'NOW' || data.streetCleaning.timing === 'TODAY')) {
      const severity = data.streetCleaning.timing === 'NOW' ? 'critical' : 'warning';
      rules.push({
        type: 'street_cleaning',
        message: data.streetCleaning.message,
        severity: severity as 'critical' | 'warning',
        schedule: data.streetCleaning.schedule,
        nextDate: data.streetCleaning.nextDate,
        isActiveNow: data.streetCleaning.timing === 'NOW',
      });
    }

    // Winter overnight ban
    if (data?.winterOvernightBan?.active) {
      rules.push({
        type: 'winter_ban',
        message: data.winterOvernightBan.message,
        severity: (data.winterOvernightBan.severity || 'warning') as 'critical' | 'warning' | 'info',
        schedule: `${data.winterOvernightBan.startTime} - ${data.winterOvernightBan.endTime}`,
        isActiveNow: true,
      });
    }

    // 2-inch snow ban (most urgent - tow risk)
    if (data?.twoInchSnowBan?.active) {
      rules.push({
        type: 'snow_route',
        message: data.twoInchSnowBan.message,
        severity: (data.twoInchSnowBan.severity || 'critical') as 'critical' | 'warning' | 'info',
        isActiveNow: true,
      });
    }

    // Permit zones - show if in zone (even if not currently restricted)
    if (data?.permitZone?.inPermitZone) {
      const severity = data.permitZone.permitRequired ? 'warning' :
                       (data.permitZone.severity || 'info');
      rules.push({
        type: 'permit_zone',
        message: data.permitZone.message,
        severity: severity as 'critical' | 'warning' | 'info',
        zoneName: data.permitZone.zoneName,
        schedule: data.permitZone.restrictionSchedule,
        isActiveNow: data.permitZone.permitRequired,
      });
    }

    // Metered parking zone — only show when meters are currently enforced.
    // If parked outside enforcement hours, BackgroundTaskService schedules
    // a notification for when meters become active (8am next weekday).
    if (data?.meteredParking?.inMeteredZone && data.meteredParking.isEnforcedNow) {
      rules.push({
        type: 'metered_parking',
        message: data.meteredParking.message,
        severity: 'warning',
        isActiveNow: true,
        timeLimitMinutes: data.meteredParking.timeLimitMinutes || 120,
        estimatedRate: data.meteredParking.estimatedRate,
        isEnforcedNow: true,
        schedule: `Mon–Sat 8am–10pm, ${data.meteredParking.estimatedRate || '$2.50/hr'}`,
      });
    }

    // Sort rules by severity (critical first, then warning, then info)
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    rules.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      coords,
      address: data?.address || `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
      rules,
      timestamp: Date.now(),
      rawApiData: data, // Preserve for BackgroundTaskService advance reminder scheduling
    };
  }

  /**
   * Save parked location to the server for cron-based push notification reminders.
   * This populates the user_parked_vehicles table, enabling the server-side
   * mobile-parking-reminders cron to send timed notifications (9pm winter ban,
   * 8pm/7am street cleaning, 7am permit zone).
   *
   * @param coords Parking coordinates
   * @param parkingData Restriction data from the check-parking API response
   * @param address Street address
   * @param fcmToken Firebase Cloud Messaging token for push delivery
   */
  async saveParkedLocationToServer(
    coords: Coordinates,
    parkingData: any,
    address: string,
    fcmToken: string
  ): Promise<{ success: boolean; id?: string }> {
    try {
      const payload: any = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        address,
        fcm_token: fcmToken,
        on_winter_ban_street: !!(parkingData?.winterOvernightBan?.active || parkingData?.winterBan?.found),
        winter_ban_street_name: parkingData?.winterOvernightBan?.streetName || null,
        on_snow_route: !!(parkingData?.twoInchSnowBan?.active || parkingData?.snowRoute),
        snow_route_name: parkingData?.twoInchSnowBan?.streetName || null,
        street_cleaning_date: parkingData?.streetCleaning?.nextDate || null,
        street_cleaning_ward: parkingData?.streetCleaning?.ward || null,
        street_cleaning_section: parkingData?.streetCleaning?.section || null,
        permit_zone: parkingData?.permitZone?.zoneName || null,
        permit_restriction_schedule: parkingData?.permitZone?.restrictionSchedule || null,
      };

      const response = await ApiClient.authPost<any>('/api/mobile/save-parked-location', payload, {
        retries: 2,
        timeout: 15000,
        showErrorAlert: false,
      });

      if (response.success && response.data) {
        log.info('Parked location saved to server', { id: response.data.id });
        return { success: true, id: response.data.id };
      }

      log.warn('Failed to save parked location to server', response.error);
      return { success: false };
    } catch (error) {
      // Non-fatal: server save is for cron reminders, local notifications still work
      log.error('Error saving parked location to server (non-fatal)', error);
      return { success: false };
    }
  }

  async saveLastParkingLocation(coords: Coordinates, rules: ParkingRule[], address?: string): Promise<void> {
    try {
      await AsyncStorage.setItem(
        StorageKeys.LAST_PARKING_LOCATION,
        JSON.stringify({
          coords,
          rules,
          address: address || `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      log.error('Error saving parking location', error);
    }
  }

  async saveParkingCheckResult(result: ParkingCheckResult): Promise<void> {
    try {
      await AsyncStorage.setItem(
        StorageKeys.LAST_PARKING_LOCATION,
        JSON.stringify(result)
      );
    } catch (error) {
      log.error('Error saving parking check result', error);
    }
  }

  /**
   * Clear parked location when user leaves (car reconnects)
   * Returns the parking history ID needed for departure confirmation
   */
  async clearParkedLocation(): Promise<{
    success: boolean;
    parking_history_id: string | null;
    cleared_at: string;
    parked_location: { latitude: number; longitude: number; address: string | null } | null;
    departure_confirmation_delay_ms: number;
  }> {
    try {
      const response = await ApiClient.authPost<any>('/api/mobile/clear-parked-location', {}, {
        retries: 2,
        timeout: 15000,
        showErrorAlert: false,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to clear parked location');
      }

      log.info('Parked location cleared', {
        historyId: response.data.parking_history_id,
        clearedAt: response.data.cleared_at,
      });

      return {
        success: true,
        parking_history_id: response.data.parking_history_id || null,
        cleared_at: response.data.cleared_at,
        parked_location: response.data.parked_location || null,
        departure_confirmation_delay_ms: response.data.departure_confirmation_delay_ms || 120000,
      };
    } catch (error) {
      log.error('Error clearing parked location', error);
      throw error;
    }
  }

  /**
   * Confirm departure from parking spot
   * This proves the user was no longer at their parking spot at a specific time
   * Used as evidence for contesting tickets with erroneous timestamps
   */
  async confirmDeparture(
    parkingHistoryId: string,
    latitude: number,
    longitude: number,
    accuracyMeters?: number
  ): Promise<{
    parking_history_id: string;
    parked_at: string;
    cleared_at: string;
    departure_confirmed_at: string;
    distance_from_parked_meters: number;
    is_conclusive: boolean;
  }> {
    try {
      const response = await ApiClient.authPost<any>('/api/mobile/confirm-departure', {
        parking_history_id: parkingHistoryId,
        latitude,
        longitude,
        accuracy_meters: accuracyMeters,
      }, {
        retries: 2,
        timeout: 15000,
        showErrorAlert: false,
      });

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to confirm departure');
      }

      log.info('Departure confirmed', {
        historyId: response.data.data.parking_history_id,
        distance: response.data.data.distance_from_parked_meters,
        isConclusive: response.data.data.is_conclusive,
      });

      return {
        parking_history_id: response.data.data.parking_history_id,
        parked_at: response.data.data.parked_at,
        cleared_at: response.data.data.cleared_at,
        departure_confirmed_at: response.data.data.departure_confirmed_at,
        distance_from_parked_meters: response.data.data.distance_from_parked_meters,
        is_conclusive: response.data.data.is_conclusive,
      };
    } catch (error) {
      log.error('Error confirming departure', error);
      throw error;
    }
  }

  async sendParkingAlert(rules: ParkingRule[]): Promise<void> {
    try {
      // Request notification permission and check if granted
      const settings = await notifee.requestPermission();

      const hasPermission =
        settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
        settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;

      // Create notification channel for Android (always do this even if no permission)
      const channelId = await notifee.createChannel({
        id: 'parking-alerts',
        name: 'Parking Alerts',
        importance: AndroidImportance.HIGH,
      });

      // Get the highest severity
      const hasCritical = rules.some(r => r.severity === 'critical');

      // Build notification message
      const title = hasCritical
        ? 'Parking Restriction Active NOW!'
        : 'Parking Restriction';

      const body = rules.map(r => r.message).join('\n\n');

      // Display notification only if permission granted
      if (hasPermission) {
        await notifee.displayNotification({
          title,
          body,
          android: {
            channelId,
            importance: AndroidImportance.HIGH,
            pressAction: {
              id: 'default',
            },
          },
          ios: {
            sound: 'default',
            critical: hasCritical,
            criticalVolume: 1.0,
          },
        });
        log.debug('Parking alert notification sent');
      } else {
        log.warn('Notification permission not granted, skipping push notification');
      }

      // Always show an in-app alert as fallback
      Alert.alert(title, body);
    } catch (error) {
      log.error('Error sending parking alert', error);
      // Still try to show an alert even if notification fails
      try {
        const hasCritical = rules.some(r => r.severity === 'critical');
        const title = hasCritical ? 'Parking Restriction Active!' : 'Parking Restriction';
        const body = rules.map(r => r.message).join('\n\n');
        Alert.alert(title, body);
      } catch {
        // Ignore if alert also fails
      }
    }
  }
}

export default new LocationServiceClass();
