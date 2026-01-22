import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import Geolocation, { GeoPosition, GeoError, GeoOptions } from 'react-native-geolocation-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native';
import ApiClient, { ApiErrorType } from '../utils/ApiClient';
import Logger from '../utils/Logger';
import { validateChicagoCoordinates, validateParkingApiResponse } from '../utils/validation';
import { RateLimiter } from '../utils/RateLimiter';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('LocationService');

export interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban' | 'rush_hour' | 'tow_zone';
  message: string;
  severity: 'critical' | 'warning' | 'info';
  // Additional metadata for enhanced display
  schedule?: string;
  zoneName?: string;
  nextDate?: string;
  isActiveNow?: boolean;
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

export type LocationAccuracy = 'high' | 'balanced' | 'low';

// Watch subscription ID for continuous tracking
let watchId: number | null = null;

// Last known good location cache
interface CachedLocation {
  coords: Coordinates;
  timestamp: number;
}
let lastKnownLocation: CachedLocation | null = null;
const LOCATION_CACHE_MAX_AGE_MS = 60000; // 1 minute

export interface ParkingCheckResult {
  coords: Coordinates;
  address: string;
  rules: ParkingRule[];
  timestamp: number;
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
            title: 'Background Location Permission',
            message:
              'Ticketless Chicago needs background location access to automatically check parking restrictions when you disconnect from your car, even when the app is closed.',
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
        { enableHighAccuracy: false, timeout: 5000, maximumAge: Infinity }
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
  getCurrentLocation(accuracy: LocationAccuracy = 'high'): Promise<Coordinates> {
    const options: GeoOptions = this.getLocationOptions(accuracy);

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

          resolve(coords);
        },
        (error: GeoError) => {
          log.error('Error getting location', { code: error.code, message: error.message });

          // If high accuracy fails, try balanced accuracy as fallback
          if (accuracy === 'high') {
            log.info('Falling back to balanced accuracy');
            this.getCurrentLocation('balanced')
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
   */
  private getLocationOptions(accuracy: LocationAccuracy): GeoOptions {
    switch (accuracy) {
      case 'high':
        return {
          enableHighAccuracy: true,
          timeout: 20000, // 20 seconds for high accuracy
          maximumAge: 5000, // Only use cache if < 5 seconds old
          forceRequestLocation: true, // Force new GPS reading on Android
          forceLocationManager: true, // Use Android LocationManager to avoid Play Services crash
          showLocationDialog: true, // Show dialog if location is off (Android)
        };
      case 'balanced':
        return {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 30000, // Accept 30-second old cache
          forceRequestLocation: false,
          forceLocationManager: true, // Use Android LocationManager to avoid Play Services crash
          showLocationDialog: true,
        };
      case 'low':
        return {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 60000, // Accept 1-minute old cache
          forceRequestLocation: false,
          forceLocationManager: true, // Use location manager (faster but less accurate)
          showLocationDialog: false,
        };
    }
  }

  /**
   * Get high-accuracy location by waiting for GPS to stabilize
   * This method waits for a position with accuracy better than the threshold
   * or times out after the specified duration
   */
  async getHighAccuracyLocation(
    targetAccuracyMeters: number = 20,
    maxWaitMs: number = 30000
  ): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      let bestPosition: Coordinates | null = null;
      let resolved = false;
      const startTime = Date.now();

      const options = {
        enableHighAccuracy: true,
        distanceFilter: 0, // Get all updates
        interval: 1000, // Android: check every second
        fastestInterval: 500, // Android: accept faster updates
        forceRequestLocation: true,
        forceLocationManager: true, // Use Android LocationManager to avoid Play Services crash
        showLocationDialog: true,
      };

      const id = Geolocation.watchPosition(
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

          log.debug('High accuracy update', {
            accuracy: coords.accuracy ? `${coords.accuracy.toFixed(1)}m` : 'unknown',
            elapsed: `${Date.now() - startTime}ms`,
          });

          // Keep track of best position
          if (!bestPosition || (coords.accuracy && bestPosition.accuracy && coords.accuracy < bestPosition.accuracy)) {
            bestPosition = coords;
          }

          // If we've achieved target accuracy, resolve immediately
          if (coords.accuracy && coords.accuracy <= targetAccuracyMeters && !resolved) {
            resolved = true;
            Geolocation.clearWatch(id);
            log.info(`Achieved target accuracy: ${coords.accuracy.toFixed(1)}m`);
            resolve(coords);
          }
        },
        (error: GeoError) => {
          if (!resolved) {
            Geolocation.clearWatch(id);
            reject(error);
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
            log.info(`Timeout reached, using best position: ${bestPosition.accuracy?.toFixed(1)}m accuracy`);
            resolve(bestPosition);
          } else {
            // Fall back to regular getCurrentLocation
            this.getCurrentLocation('balanced')
              .then(resolve)
              .catch(reject);
          }
        }
      }, maxWaitMs);
    });
  }

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
    onRetry?: (attempt: number, maxAttempts: number) => void
  ): Promise<Coordinates> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use high accuracy for first attempt, fall back to balanced for retries
        const accuracy: LocationAccuracy = attempt === 1 ? 'high' : 'balanced';
        const coords = await this.getCurrentLocation(accuracy);

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

    const endpoint = `/api/mobile/check-parking?lat=${coords.latitude}&lng=${coords.longitude}`;

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
      const errorMessage =
        response.error?.type === ApiErrorType.NETWORK_ERROR
          ? 'No internet connection. Please check your network and try again.'
          : response.error?.type === ApiErrorType.TIMEOUT_ERROR
          ? 'Request timed out. The server may be busy. Please try again.'
          : 'Failed to check parking rules. Please try again.';

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

    // Rush hour restrictions (when enabled on backend)
    if (data?.rushHour?.hasRestriction) {
      const severity = data.rushHour.isActiveNow ? 'critical' :
                       (data.rushHour.severity || 'info');
      rules.push({
        type: 'rush_hour',
        message: data.rushHour.message,
        severity: severity as 'critical' | 'warning' | 'info',
        schedule: data.rushHour.schedule,
        isActiveNow: data.rushHour.isActiveNow,
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
    };
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
      const response = await ApiClient.post<any>('/api/mobile/clear-parked-location', {}, {
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
      const response = await ApiClient.post<any>('/api/mobile/confirm-departure', {
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
