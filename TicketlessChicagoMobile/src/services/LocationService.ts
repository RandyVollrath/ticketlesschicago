import { Platform, PermissionsAndroid, Alert } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance } from '@notifee/react-native';
import Config from '../config/config';

export interface ParkingRule {
  type: 'street_cleaning' | 'snow_route' | 'permit_zone' | 'winter_ban';
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface Coordinates {
  latitude: number;
  longitude: number;
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
      console.error('Error requesting location permission:', err);
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
          console.error('Error getting location:', error);
          reject(error);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });
  }

  async checkParkingRules(coords: Coordinates): Promise<ParkingRule[]> {
    try {
      const response = await fetch(
        `${Config.API_BASE_URL}/api/check-parking-location-enhanced?lat=${coords.latitude}&lng=${coords.longitude}`
      );

      if (!response.ok) {
        throw new Error('Failed to check parking rules');
      }

      const data = await response.json();
      const rules: ParkingRule[] = [];

      // Street cleaning
      if (data.streetCleaning?.hasRestriction) {
        rules.push({
          type: 'street_cleaning',
          message: data.streetCleaning.message,
          severity: data.streetCleaning.timing === 'NOW' ? 'critical' : 'warning',
        });
      }

      // Winter overnight ban
      if (data.winterOvernightBan?.active) {
        rules.push({
          type: 'winter_ban',
          message: data.winterOvernightBan.message,
          severity: data.winterOvernightBan.severity || 'warning',
        });
      }

      // 2-inch snow ban
      if (data.twoInchSnowBan?.active) {
        rules.push({
          type: 'snow_route',
          message: data.twoInchSnowBan.message,
          severity: data.twoInchSnowBan.severity || 'critical',
        });
      }

      // Permit zones
      if (data.permitZone?.inPermitZone) {
        rules.push({
          type: 'permit_zone',
          message: data.permitZone.message,
          severity: 'info',
        });
      }

      return rules;
    } catch (error) {
      console.error('Error checking parking rules:', error);
      throw error;
    }
  }

  async saveLastParkingLocation(coords: Coordinates, rules: ParkingRule[]): Promise<void> {
    try {
      await AsyncStorage.setItem(
        'lastParkingLocation',
        JSON.stringify({
          coords,
          rules,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.error('Error saving parking location:', error);
    }
  }

  async sendParkingAlert(rules: ParkingRule[]): Promise<void> {
    try {
      // Request notification permission
      await notifee.requestPermission();

      // Create notification channel for Android
      const channelId = await notifee.createChannel({
        id: 'parking-alerts',
        name: 'Parking Alerts',
        importance: AndroidImportance.HIGH,
      });

      // Get the highest severity
      const hasCritical = rules.some(r => r.severity === 'critical');
      const severity = hasCritical ? 'critical' : 'warning';

      // Build notification message
      const title = hasCritical
        ? '🚨 Parking Restriction Active NOW!'
        : '⚠️ Parking Restriction';

      const body = rules.map(r => r.message).join('\n\n');

      // Display notification
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

      // Also show an alert
      Alert.alert(title, body);
    } catch (error) {
      console.error('Error sending parking alert:', error);
    }
  }
}

export default new LocationServiceClass();
