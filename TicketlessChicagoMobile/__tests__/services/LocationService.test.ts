/**
 * LocationService Unit Tests
 */

import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock dependencies
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  PermissionsAndroid: {
    PERMISSIONS: { ACCESS_FINE_LOCATION: 'ACCESS_FINE_LOCATION' },
    RESULTS: { GRANTED: 'granted' },
    request: jest.fn(),
  },
  Alert: { alert: jest.fn() },
}));

jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('@notifee/react-native', () => ({
  displayNotification: jest.fn(),
  createChannel: jest.fn().mockResolvedValue('parking-alerts'),
  requestPermission: jest.fn(),
  AndroidImportance: { HIGH: 4 },
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import after mocks are set up
import LocationService, {
  ParkingRule,
  Coordinates,
  ParkingCheckResult,
} from '../../src/services/LocationService';
import Geolocation from '@react-native-community/geolocation';
import notifee from '@notifee/react-native';

describe('LocationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestLocationPermission', () => {
    it('should return true when permission is granted on Android', async () => {
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue('granted');

      const result = await LocationService.requestLocationPermission();

      expect(result).toBe(true);
      expect(PermissionsAndroid.request).toHaveBeenCalledWith(
        'ACCESS_FINE_LOCATION',
        expect.any(Object)
      );
    });

    it('should return false when permission is denied on Android', async () => {
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue('denied');

      const result = await LocationService.requestLocationPermission();

      expect(result).toBe(false);
    });

    it('should handle permission request errors', async () => {
      (PermissionsAndroid.request as jest.Mock).mockRejectedValue(new Error('Permission error'));

      const result = await LocationService.requestLocationPermission();

      expect(result).toBe(false);
    });
  });

  describe('getCurrentLocation', () => {
    it('should resolve with coordinates on success', async () => {
      const mockPosition = {
        coords: {
          latitude: 41.8781,
          longitude: -87.6298,
        },
      };

      (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((success) => {
        success(mockPosition);
      });

      const result = await LocationService.getCurrentLocation();

      expect(result).toEqual({
        latitude: 41.8781,
        longitude: -87.6298,
      });
    });

    it('should reject on geolocation error', async () => {
      const mockError = { code: 1, message: 'Location unavailable' };

      (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((_, error) => {
        error(mockError);
      });

      await expect(LocationService.getCurrentLocation()).rejects.toEqual(mockError);
    });
  });

  describe('checkParkingLocation', () => {
    const mockCoords: Coordinates = {
      latitude: 41.8781,
      longitude: -87.6298,
    };

    it('should return parking check result with rules', async () => {
      const mockResponse = {
        success: true,
        address: '123 N State St, Chicago',
        streetCleaning: {
          hasRestriction: true,
          message: 'Street cleaning Tuesday 9am-3pm',
          timing: 'TODAY',
        },
        winterOvernightBan: { active: false, message: '' },
        twoInchSnowBan: { active: false, message: '' },
        permitZone: { inPermitZone: false, message: '' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await LocationService.checkParkingLocation(mockCoords);

      expect(result.address).toBe('123 N State St, Chicago');
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0].type).toBe('street_cleaning');
      expect(result.coords).toEqual(mockCoords);
    });

    it('should handle multiple parking restrictions', async () => {
      const mockResponse = {
        success: true,
        address: '456 W Madison St',
        streetCleaning: { hasRestriction: true, message: 'Street cleaning', timing: 'NOW' },
        winterOvernightBan: { active: true, message: 'Winter ban active', severity: 'critical' },
        twoInchSnowBan: { active: true, message: 'Snow ban', severity: 'critical' },
        permitZone: { inPermitZone: true, message: 'Permit required' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await LocationService.checkParkingLocation(mockCoords);

      expect(result.rules).toHaveLength(4);
      expect(result.rules.map(r => r.type)).toEqual([
        'street_cleaning',
        'winter_ban',
        'snow_route',
        'permit_zone',
      ]);
    });

    it('should return empty rules when no restrictions', async () => {
      const mockResponse = {
        success: true,
        address: '789 N Michigan Ave',
        streetCleaning: { hasRestriction: false, message: '' },
        winterOvernightBan: { active: false, message: '' },
        twoInchSnowBan: { active: false, message: '' },
        permitZone: { inPermitZone: false, message: '' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await LocationService.checkParkingLocation(mockCoords);

      expect(result.rules).toHaveLength(0);
    });

    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(LocationService.checkParkingLocation(mockCoords)).rejects.toThrow(
        'Failed to check parking rules'
      );
    });

    it('should fallback to coordinates for address on missing address', async () => {
      const mockResponse = {
        success: true,
        streetCleaning: { hasRestriction: false, message: '' },
        winterOvernightBan: { active: false, message: '' },
        twoInchSnowBan: { active: false, message: '' },
        permitZone: { inPermitZone: false, message: '' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await LocationService.checkParkingLocation(mockCoords);

      expect(result.address).toBe('41.878100, -87.629800');
    });
  });

  describe('saveParkingCheckResult', () => {
    it('should save result to AsyncStorage', async () => {
      const mockResult: ParkingCheckResult = {
        coords: { latitude: 41.8781, longitude: -87.6298 },
        address: '123 N State St',
        rules: [],
        timestamp: Date.now(),
      };

      await LocationService.saveParkingCheckResult(mockResult);

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'lastParkingLocation',
        JSON.stringify(mockResult)
      );
    });
  });

  describe('sendParkingAlert', () => {
    it('should display notification with critical severity', async () => {
      const rules: ParkingRule[] = [
        { type: 'street_cleaning', message: 'Move your car!', severity: 'critical' },
      ];

      await LocationService.sendParkingAlert(rules);

      expect(notifee.displayNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Parking Restriction Active NOW'),
        })
      );
    });

    it('should display notification with warning severity', async () => {
      const rules: ParkingRule[] = [
        { type: 'winter_ban', message: 'Winter ban upcoming', severity: 'warning' },
      ];

      await LocationService.sendParkingAlert(rules);

      expect(notifee.displayNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Parking Restriction'),
        })
      );
    });

    it('should combine multiple rule messages', async () => {
      const rules: ParkingRule[] = [
        { type: 'street_cleaning', message: 'Message 1', severity: 'warning' },
        { type: 'winter_ban', message: 'Message 2', severity: 'warning' },
      ];

      await LocationService.sendParkingAlert(rules);

      expect(notifee.displayNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Message 1'),
        })
      );
    });
  });

  describe('checkParkingRules (backward compatibility)', () => {
    it('should return only rules array', async () => {
      const mockCoords: Coordinates = { latitude: 41.8781, longitude: -87.6298 };
      const mockResponse = {
        success: true,
        address: '123 N State St',
        streetCleaning: { hasRestriction: true, message: 'Street cleaning', timing: 'TODAY' },
        winterOvernightBan: { active: false, message: '' },
        twoInchSnowBan: { active: false, message: '' },
        permitZone: { inPermitZone: false, message: '' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await LocationService.checkParkingRules(mockCoords);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('street_cleaning');
    });
  });
});
