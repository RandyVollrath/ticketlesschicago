/**
 * Car Detection Service (Bluetooth)
 *
 * Detects when user parks by monitoring Bluetooth disconnection from car.
 * Auto-saves parking location and sets reminders.
 *
 * FEATURE FLAG: smartFeatures.bluetoothDetection
 */

import { StreetSegment } from '../parking-map/types';
import { getUpcomingWarnings } from '../parking-map/warning-calculator';

// =============================================================================
// Types
// =============================================================================

export interface CarBluetoothConfig {
  deviceName: string; // e.g., "My Car Stereo"
  deviceId: string;
  autoDetect: boolean;
}

export interface ParkingLocation {
  coordinates: [number, number]; // [longitude, latitude]
  timestamp: Date;
  address?: string;
  photoUrl?: string;
  notes?: string;
  segment?: StreetSegment;
}

export interface ParkingReminder {
  id: string;
  time: Date;
  title: string;
  body: string;
  location: [number, number];
  segmentId?: string;
}

// =============================================================================
// Storage Keys
// =============================================================================

const STORAGE_KEYS = {
  BLUETOOTH_CONFIG: 'car-bluetooth-config',
  PARKED_LOCATION: 'parked-car-location',
  PARKING_HISTORY: 'parking-history',
};

// =============================================================================
// Car Detection Service
// =============================================================================

class CarDetectionService {
  private config: CarBluetoothConfig | null = null;
  private listeners: Array<(location: ParkingLocation) => void> = [];

  /**
   * Initialize the car detection service
   */
  async initialize(): Promise<void> {
    // Load saved config
    // In production, this would load from AsyncStorage
    console.log('[CarDetection] Initializing...');
  }

  /**
   * Configure Bluetooth device for car detection
   */
  async configureDevice(config: CarBluetoothConfig): Promise<void> {
    this.config = config;
    // Save to storage
    console.log('[CarDetection] Device configured:', config.deviceName);
  }

  /**
   * Get current configuration
   */
  getConfig(): CarBluetoothConfig | null {
    return this.config;
  }

  /**
   * Handle Bluetooth disconnection event
   * Called when user disconnects from car Bluetooth
   */
  async onBluetoothDisconnect(config: CarBluetoothConfig): Promise<void> {
    if (!config.autoDetect) {
      return;
    }

    console.log('[CarDetection] Bluetooth disconnected from:', config.deviceName);

    try {
      // Get current location
      const location = await this.getCurrentLocation();

      // Find nearest street segment
      const segment = await this.findNearestSegment(location);

      // Get upcoming warnings for this location
      if (segment) {
        const warnings = getUpcomingWarnings(segment, new Date());

        // Schedule reminders for any upcoming restrictions
        for (const warning of warnings) {
          const reminderTime = new Date(
            Date.now() + (warning.minutesUntil - 15) * 60000
          );

          await this.scheduleReminder({
            id: `${segment.properties.segmentId}-${Date.now()}`,
            time: reminderTime,
            title: 'Move your car',
            body: warning.message,
            location,
            segmentId: segment.properties.segmentId,
          });
        }
      }

      // Save parking location
      const parkingLocation: ParkingLocation = {
        coordinates: location,
        timestamp: new Date(),
        segment: segment || undefined,
      };

      await this.saveParkingLocation(parkingLocation);

      // Notify listeners
      for (const listener of this.listeners) {
        listener(parkingLocation);
      }
    } catch (error) {
      console.error('[CarDetection] Error handling disconnect:', error);
    }
  }

  /**
   * Get current GPS location
   * Stub - would use react-native-geolocation-service in production
   */
  private async getCurrentLocation(): Promise<[number, number]> {
    // In production, this would use the actual GPS
    // For now, return Chicago center as default
    return [-87.6298, 41.8781];
  }

  /**
   * Find the nearest street segment to a location
   * Stub - would query local segment database
   */
  private async findNearestSegment(
    _location: [number, number]
  ): Promise<StreetSegment | null> {
    // In production, this would query the segment database
    // For now, return null
    return null;
  }

  /**
   * Schedule a parking reminder notification
   */
  private async scheduleReminder(reminder: ParkingReminder): Promise<void> {
    // In production, use react-native-push-notification
    console.log('[CarDetection] Scheduling reminder:', {
      title: reminder.title,
      body: reminder.body,
      time: reminder.time.toISOString(),
    });
  }

  /**
   * Save parking location
   */
  async saveParkingLocation(location: ParkingLocation): Promise<void> {
    // In production, save to AsyncStorage
    console.log('[CarDetection] Saved parking location:', location.coordinates);
  }

  /**
   * Get saved parking location
   */
  async getParkingLocation(): Promise<ParkingLocation | null> {
    // In production, load from AsyncStorage
    return null;
  }

  /**
   * Clear saved parking location
   */
  async clearParkingLocation(): Promise<void> {
    // In production, clear from AsyncStorage
    console.log('[CarDetection] Cleared parking location');
  }

  /**
   * Subscribe to parking events
   */
  onParkingDetected(callback: (location: ParkingLocation) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }
}

// Singleton instance
export const carDetectionService = new CarDetectionService();

export default carDetectionService;
