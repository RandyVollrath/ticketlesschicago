import Geolocation from '@react-native-community/geolocation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, PermissionsAndroid } from 'react-native';
import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native';
import { config } from '../config/env';

export interface LocationCoords {
  latitude: number;
  longitude: number;
  timestamp: number;
}

export interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone';
  message: string;
  restriction: string;
  address: string;
}

class LocationService {
  private watchId: number | null = null;
  private lastKnownLocation: LocationCoords | null = null;

  async requestLocationPermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        ]);

        return (
          granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.ACCESS_BACKGROUND_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } catch (err) {
        console.warn('Location permission error:', err);
        return false;
      }
    }
    // iOS permissions are handled via Info.plist
    return true;
  }

  async getCurrentLocation(): Promise<LocationCoords> {
    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) => {
          const coords: LocationCoords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timestamp: position.timestamp,
          };
          this.lastKnownLocation = coords;
          resolve(coords);
        },
        (error) => reject(error),
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        }
      );
    });
  }

  startWatchingLocation(onLocationChange: (coords: LocationCoords) => void) {
    this.watchId = Geolocation.watchPosition(
      (position) => {
        const coords: LocationCoords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: position.timestamp,
        };
        this.lastKnownLocation = coords;
        onLocationChange(coords);
      },
      (error) => console.error('Location watch error:', error),
      {
        enableHighAccuracy: true,
        distanceFilter: 10, // Update every 10 meters
        interval: 5000, // Check every 5 seconds
      }
    );
  }

  stopWatchingLocation() {
    if (this.watchId !== null) {
      Geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  async checkParkingRules(coords: LocationCoords): Promise<ParkingRule[]> {
    let retries = 3;
    let lastError: Error | null = null;

    while (retries > 0) {
      try {
        console.log(`Checking parking rules at: ${coords.latitude}, ${coords.longitude}`);

        // Call your backend API
        const response = await fetch(config.parkingCheckEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            latitude: coords.latitude,
            longitude: coords.longitude,
          }),
          // Add timeout
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        console.log('Parking rules response:', data);
        return data.rules || [];

      } catch (error) {
        lastError = error as Error;
        console.error(`Error checking parking rules (${retries} retries left):`, error);
        retries--;

        if (retries > 0) {
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, (4 - retries) * 1000));
        }
      }
    }

    // All retries failed
    console.error('All retries failed for parking rules check:', lastError);
    throw lastError || new Error('Failed to check parking rules');
  }

  async sendParkingAlert(rules: ParkingRule[]) {
    // Request notification permissions
    const settings = await notifee.requestPermission();

    if (settings.authorizationStatus === AuthorizationStatus.DENIED) {
      console.log('Notification permission denied');
      return;
    }

    // Create notification channel for Android
    const channelId = await notifee.createChannel({
      id: 'parking-alerts',
      name: 'Parking Alerts',
      importance: AndroidImportance.HIGH,
    });

    // Send notification for each rule violation
    for (const rule of rules) {
      await notifee.displayNotification({
        title: `⚠️ ${rule.type === 'street_cleaning' ? 'Street Cleaning' : rule.type === 'snow_route' ? 'Snow Route' : 'Permit Zone'}`,
        body: rule.message,
        android: {
          channelId,
          importance: AndroidImportance.HIGH,
          pressAction: {
            id: 'default',
          },
        },
        ios: {
          sound: 'default',
          critical: true,
        },
      });
    }
  }

  async saveLastParkingLocation(coords: LocationCoords, rules: ParkingRule[]) {
    try {
      await AsyncStorage.setItem('lastParkingLocation', JSON.stringify({
        coords,
        rules,
        timestamp: Date.now(),
      }));
    } catch (error) {
      console.error('Error saving parking location:', error);
    }
  }

  async getLastParkingLocation(): Promise<{ coords: LocationCoords; rules: ParkingRule[]; timestamp: number } | null> {
    try {
      const data = await AsyncStorage.getItem('lastParkingLocation');
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting parking location:', error);
      return null;
    }
  }

  getLastKnownLocation(): LocationCoords | null {
    return this.lastKnownLocation;
  }
}

export default new LocationService();
