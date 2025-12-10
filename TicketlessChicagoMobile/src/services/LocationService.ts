import { Platform, PermissionsAndroid, Alert } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native';
import ApiClient, { ApiErrorType } from '../utils/ApiClient';
import Logger from '../utils/Logger';
import { validateChicagoCoordinates, validateParkingApiResponse } from '../utils/validation';
import { RateLimiter } from '../utils/RateLimiter';

const log = Logger.createLogger('LocationService');

export interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban';
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ParkingCheckResult {
  coords: Coordinates;
  address: string;
  rules: ParkingRule[];
  timestamp: number;
}

class LocationServiceClass {
  async requestLocationPermission(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      return true; // iOS permissions handled via Info.plist
    }

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'Ticketless Chicago needs access to your location to check parking restrictions',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      log.error('Error requesting location permission', err);
      return false;
    }
  }

  getCurrentLocation(): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          log.error('Error getting location', error);
          reject(error);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });
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

    // Street cleaning
    if (data?.streetCleaning?.hasRestriction) {
      rules.push({
        type: 'street_cleaning',
        message: data.streetCleaning.message,
        severity: data.streetCleaning.timing === 'NOW' ? 'critical' : 'warning',
      });
    }

    // Winter overnight ban
    if (data?.winterOvernightBan?.active) {
      rules.push({
        type: 'winter_ban',
        message: data.winterOvernightBan.message,
        severity: data.winterOvernightBan.severity || 'warning',
      });
    }

    // 2-inch snow ban
    if (data?.twoInchSnowBan?.active) {
      rules.push({
        type: 'snow_route',
        message: data.twoInchSnowBan.message,
        severity: data.twoInchSnowBan.severity || 'critical',
      });
    }

    // Permit zones
    if (data?.permitZone?.inPermitZone) {
      rules.push({
        type: 'permit_zone',
        message: data.permitZone.message,
        severity: 'info',
      });
    }

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
        'lastParkingLocation',
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
        'lastParkingLocation',
        JSON.stringify(result)
      );
    } catch (error) {
      log.error('Error saving parking check result', error);
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
