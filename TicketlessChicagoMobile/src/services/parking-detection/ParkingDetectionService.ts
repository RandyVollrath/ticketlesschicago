/**
 * Parking Detection Service
 *
 * Multi-signal parking detection combining:
 * - Bluetooth car connection status
 * - Motion/GPS for stationary detection
 * - Accelerometer for fine-grained movement
 *
 * The goal: Detect parking WHILE still connected to car Bluetooth,
 * not just when the car turns off (which is too late).
 *
 * FEATURE FLAG: smartFeatures.bluetoothDetection
 */

import { StreetSegment } from '../parking-map/types';

// =============================================================================
// Types
// =============================================================================

export interface BluetoothDevice {
  id: string;
  name: string;
  isCarDevice: boolean;
}

export interface ParkingDetectionConfig {
  // User's car Bluetooth devices
  pairedCarDevices: BluetoothDevice[];

  // Detection thresholds
  stationaryDurationSeconds: number; // How long stopped = parked (default: 120)
  motionThresholdMPS: number; // Below this = stopped (default: 0.5 m/s)

  // Behavior flags
  autoCheckOnPark: boolean;
  sendImmediateAlert: boolean;
  saveLocationForFindMyCar: boolean;
}

export interface ParkingEvent {
  id: string;
  timestamp: Date;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number;
    address?: string;
  };
  trigger: 'motion-stopped' | 'bluetooth-disconnect' | 'manual';
  confidence: 'high' | 'medium' | 'low';
  segment?: StreetSegment;
}

export interface MotionData {
  // From accelerometer
  acceleration: { x: number; y: number; z: number };

  // From GPS
  speed: number | null; // meters per second
  speedAccuracy: number | null;

  // Calculated
  isStationary: boolean;
  confidence: number; // 0-1
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_DETECTION_CONFIG: ParkingDetectionConfig = {
  pairedCarDevices: [],
  stationaryDurationSeconds: 120, // 2 minutes stopped = parked
  motionThresholdMPS: 0.5, // 0.5 m/s = basically stopped
  autoCheckOnPark: true,
  sendImmediateAlert: true,
  saveLocationForFindMyCar: true,
};

// =============================================================================
// Parking Detection Service
// =============================================================================

class ParkingDetectionService {
  private config: ParkingDetectionConfig = DEFAULT_DETECTION_CONFIG;
  private listeners: Array<(event: ParkingEvent) => void> = [];
  private isMonitoring = false;

  /**
   * Initialize with user configuration
   */
  async initialize(config: Partial<ParkingDetectionConfig>): Promise<void> {
    this.config = { ...DEFAULT_DETECTION_CONFIG, ...config };
    console.log('[ParkingDetection] Initialized with config:', {
      devices: this.config.pairedCarDevices.length,
      stationaryDuration: this.config.stationaryDurationSeconds,
    });
  }

  /**
   * Start monitoring for parking events
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log('[ParkingDetection] Already monitoring');
      return;
    }

    this.isMonitoring = true;
    console.log('[ParkingDetection] Started monitoring');

    // In production, this would:
    // 1. Start Bluetooth connection monitoring
    // 2. Start motion detection when connected to car
    // 3. Use state machine to detect parking
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.isMonitoring = false;
    console.log('[ParkingDetection] Stopped monitoring');
  }

  /**
   * Get current configuration
   */
  getConfig(): ParkingDetectionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ParkingDetectionConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Add a paired car device
   */
  addCarDevice(device: BluetoothDevice): void {
    const existing = this.config.pairedCarDevices.find((d) => d.id === device.id);
    if (!existing) {
      this.config.pairedCarDevices.push({ ...device, isCarDevice: true });
      console.log('[ParkingDetection] Added car device:', device.name);
    }
  }

  /**
   * Remove a paired car device
   */
  removeCarDevice(deviceId: string): void {
    this.config.pairedCarDevices = this.config.pairedCarDevices.filter(
      (d) => d.id !== deviceId
    );
    console.log('[ParkingDetection] Removed car device:', deviceId);
  }

  /**
   * Manually trigger parking detection (for testing or manual use)
   */
  async triggerManualParking(location: {
    latitude: number;
    longitude: number;
  }): Promise<ParkingEvent> {
    const event: ParkingEvent = {
      id: this.generateEventId(),
      timestamp: new Date(),
      location: {
        ...location,
        accuracy: 10, // Assume good accuracy for manual
      },
      trigger: 'manual',
      confidence: 'high',
    };

    await this.handleParkingDetected(event);
    return event;
  }

  /**
   * Subscribe to parking events
   */
  onParkingDetected(callback: (event: ParkingEvent) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  /**
   * Handle parking detection
   */
  private async handleParkingDetected(event: ParkingEvent): Promise<void> {
    console.log('[ParkingDetection] Parking detected:', {
      trigger: event.trigger,
      confidence: event.confidence,
      location: `${event.location.latitude.toFixed(5)}, ${event.location.longitude.toFixed(5)}`,
    });

    // Save event
    await this.saveParkingEvent(event);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ParkingDetection] Listener error:', error);
      }
    }

    // Auto-check parking restrictions if enabled
    if (this.config.autoCheckOnPark) {
      // This would trigger the TowAlertService
      console.log('[ParkingDetection] Auto-checking parking restrictions...');
    }
  }

  /**
   * Save parking event to storage
   */
  private async saveParkingEvent(event: ParkingEvent): Promise<void> {
    // In production, save to AsyncStorage
    console.log('[ParkingDetection] Saved parking event:', event.id);
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `park-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if currently monitoring
   */
  isCurrentlyMonitoring(): boolean {
    return this.isMonitoring;
  }

  /**
   * Get list of paired car devices
   */
  getPairedCarDevices(): BluetoothDevice[] {
    return [...this.config.pairedCarDevices];
  }
}

// Singleton instance
export const parkingDetectionService = new ParkingDetectionService();

export default parkingDetectionService;
