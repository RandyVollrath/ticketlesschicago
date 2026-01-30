/**
 * Bluetooth Service
 *
 * Monitors Bluetooth connections to detect car connection/disconnection.
 * This is the primary trigger for parking detection.
 *
 * iOS: Uses CBCentralManager with state restoration
 * Android: Uses BluetoothAdapter with BroadcastReceiver
 *
 * Required packages (production):
 * - react-native-bluetooth-state-manager
 * - @config-plugins/react-native-ble-plx
 */

import { BluetoothDevice } from './ParkingDetectionService';

// =============================================================================
// Types
// =============================================================================

export type BluetoothState =
  | 'unknown'
  | 'resetting'
  | 'unsupported'
  | 'unauthorized'
  | 'off'
  | 'on';

export interface BluetoothServiceConfig {
  // Scan settings
  scanDurationSeconds: number;
  backgroundScanEnabled: boolean;
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_BLUETOOTH_CONFIG: BluetoothServiceConfig = {
  scanDurationSeconds: 10,
  backgroundScanEnabled: true,
};

// =============================================================================
// Bluetooth Service
// =============================================================================

class BluetoothService {
  private config: BluetoothServiceConfig = DEFAULT_BLUETOOTH_CONFIG;
  private connectedDevices: Set<string> = new Set();
  private carDeviceIds: Set<string> = new Set();
  private bluetoothState: BluetoothState = 'unknown';

  // Callbacks
  private connectCallbacks: Array<(device: BluetoothDevice) => void> = [];
  private disconnectCallbacks: Array<(device: BluetoothDevice) => void> = [];
  private stateCallbacks: Array<(state: BluetoothState) => void> = [];

  /**
   * Initialize with user's car devices
   */
  async initialize(userCarDevices: BluetoothDevice[]): Promise<void> {
    this.carDeviceIds = new Set(userCarDevices.map((d) => d.id));
    console.log(
      '[BluetoothService] Initialized with',
      userCarDevices.length,
      'car devices'
    );

    // In production, set up native Bluetooth monitoring here
    // This would use:
    // - iOS: CBCentralManager with state restoration for background
    // - Android: BroadcastReceiver for ACTION_ACL_CONNECTED/DISCONNECTED
  }

  /**
   * Add a car device to monitor
   */
  addCarDevice(device: BluetoothDevice): void {
    this.carDeviceIds.add(device.id);
    console.log('[BluetoothService] Added car device:', device.name);
  }

  /**
   * Remove a car device
   */
  removeCarDevice(deviceId: string): void {
    this.carDeviceIds.delete(deviceId);
    this.connectedDevices.delete(deviceId);
    console.log('[BluetoothService] Removed car device:', deviceId);
  }

  /**
   * Get all paired Bluetooth devices
   * In production, this queries the native Bluetooth API
   */
  async getPairedDevices(): Promise<BluetoothDevice[]> {
    // In production, query native module for paired devices
    // For now, return empty array
    console.log('[BluetoothService] Getting paired devices...');
    return [];
  }

  /**
   * Check if Bluetooth is enabled
   */
  isBluetoothEnabled(): boolean {
    return this.bluetoothState === 'on';
  }

  /**
   * Get current Bluetooth state
   */
  getBluetoothState(): BluetoothState {
    return this.bluetoothState;
  }

  /**
   * Check if connected to any car Bluetooth device
   */
  isConnectedToCarBluetooth(): boolean {
    for (const deviceId of this.connectedDevices) {
      if (this.carDeviceIds.has(deviceId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get list of connected car devices
   */
  getConnectedCarDevices(): string[] {
    return [...this.connectedDevices].filter((id) => this.carDeviceIds.has(id));
  }

  /**
   * Subscribe to car Bluetooth connection events
   */
  onCarBluetoothConnect(callback: (device: BluetoothDevice) => void): () => void {
    this.connectCallbacks.push(callback);
    return () => {
      this.connectCallbacks = this.connectCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Subscribe to car Bluetooth disconnection events
   */
  onCarBluetoothDisconnect(
    callback: (device: BluetoothDevice) => void
  ): () => void {
    this.disconnectCallbacks.push(callback);
    return () => {
      this.disconnectCallbacks = this.disconnectCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  /**
   * Subscribe to Bluetooth state changes
   */
  onBluetoothStateChange(callback: (state: BluetoothState) => void): () => void {
    this.stateCallbacks.push(callback);
    return () => {
      this.stateCallbacks = this.stateCallbacks.filter((cb) => cb !== callback);
    };
  }

  // =============================================================================
  // Native Event Handlers (called by native module in production)
  // =============================================================================

  /**
   * Called by native module when Bluetooth state changes
   */
  handleBluetoothStateChange(state: BluetoothState): void {
    const previousState = this.bluetoothState;
    this.bluetoothState = state;

    console.log('[BluetoothService] State changed:', previousState, '->', state);

    // Notify listeners
    for (const callback of this.stateCallbacks) {
      try {
        callback(state);
      } catch (error) {
        console.error('[BluetoothService] State callback error:', error);
      }
    }
  }

  /**
   * Called by native module when device connects
   */
  handleDeviceConnected(deviceId: string, deviceName: string): void {
    this.connectedDevices.add(deviceId);

    // Is this a car device?
    if (this.carDeviceIds.has(deviceId)) {
      console.log('[BluetoothService] Car device connected:', deviceName);

      const device: BluetoothDevice = {
        id: deviceId,
        name: deviceName,
        isCarDevice: true,
      };

      // Notify listeners
      for (const callback of this.connectCallbacks) {
        try {
          callback(device);
        } catch (error) {
          console.error('[BluetoothService] Connect callback error:', error);
        }
      }
    }
  }

  /**
   * Called by native module when device disconnects
   */
  handleDeviceDisconnected(deviceId: string, deviceName: string): void {
    this.connectedDevices.delete(deviceId);

    // Is this a car device?
    if (this.carDeviceIds.has(deviceId)) {
      console.log('[BluetoothService] Car device disconnected:', deviceName);

      const device: BluetoothDevice = {
        id: deviceId,
        name: deviceName,
        isCarDevice: true,
      };

      // Notify listeners
      for (const callback of this.disconnectCallbacks) {
        try {
          callback(device);
        } catch (error) {
          console.error('[BluetoothService] Disconnect callback error:', error);
        }
      }
    }
  }

  // =============================================================================
  // Testing/Development Methods
  // =============================================================================

  /**
   * Simulate car Bluetooth connection (for testing)
   */
  simulateCarConnect(deviceId: string, deviceName: string): void {
    console.log('[BluetoothService] Simulating car connect:', deviceName);
    this.carDeviceIds.add(deviceId);
    this.handleDeviceConnected(deviceId, deviceName);
  }

  /**
   * Simulate car Bluetooth disconnection (for testing)
   */
  simulateCarDisconnect(deviceId: string, deviceName: string): void {
    console.log('[BluetoothService] Simulating car disconnect:', deviceName);
    this.handleDeviceDisconnected(deviceId, deviceName);
  }
}

// Singleton instance
export const bluetoothService = new BluetoothService();

export default bluetoothService;
