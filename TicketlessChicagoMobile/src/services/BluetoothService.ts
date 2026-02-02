import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('BluetoothService');

export interface SavedCarDevice {
  id: string;
  name: string;
  address?: string; // Bluetooth MAC address for Classic BT
}

// Import Classic Bluetooth for Android
let RNBluetoothClassic: any = null;
if (Platform.OS === 'android') {
  try {
    RNBluetoothClassic = require('react-native-bluetooth-classic').default;
  } catch (e) {
    log.warn('react-native-bluetooth-classic not available');
  }
}


type ConnectionListener = {
  onConnect: () => void;
  onDisconnect: () => void;
};

class BluetoothServiceClass {
  private disconnectCallback: (() => void) | null = null;
  private reconnectCallback: (() => void) | null = null;
  private connectedDeviceId: string | null = null;
  private savedDeviceId: string | null = null;
  private classicBtDisconnectListener: any = null;
  private classicBtConnectListener: any = null;
  private connectionListeners: ConnectionListener[] = [];

  /**
   * Check if Bluetooth is available and enabled
   */
  async isBluetoothEnabled(): Promise<boolean> {
    if (Platform.OS === 'android' && RNBluetoothClassic) {
      try {
        return await RNBluetoothClassic.isBluetoothEnabled();
      } catch (error) {
        log.error('Error checking Bluetooth state', error);
        return false;
      }
    }
    // On iOS, we can't easily check - assume true
    return true;
  }

  /**
   * Request Bluetooth permissions
   */
  async requestBluetoothPermission(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      return true; // iOS permissions handled via Info.plist
    }

    try {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);

      const allGranted =
        granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;

      log.debug('Bluetooth permissions:', allGranted ? 'granted' : 'denied');
      return allGranted;
    } catch (err) {
      log.error('Error requesting Bluetooth permission', err);
      return false;
    }
  }

  /**
   * Get list of paired/bonded Bluetooth devices from the system
   * This returns Classic Bluetooth devices on Android (like car audio)
   * On iOS, returns empty array (Classic BT access is restricted)
   */
  async getPairedDevices(): Promise<SavedCarDevice[]> {
    const hasPermission = await this.requestBluetoothPermission();
    if (!hasPermission) {
      throw new Error('Bluetooth permission denied');
    }

    if (Platform.OS === 'android' && RNBluetoothClassic) {
      try {
        const bondedDevices = await RNBluetoothClassic.getBondedDevices();
        log.debug(`Found ${bondedDevices.length} bonded Classic BT devices`);

        return bondedDevices.map((device: any) => ({
          id: device.address || device.id,
          name: device.name || 'Unknown Device',
          address: device.address,
        }));
      } catch (error) {
        log.error('Error getting bonded devices', error);
        return [];
      }
    }

    // iOS: Classic Bluetooth access is restricted to MFi devices
    // Return empty array - user will need to manually enter car name
    log.debug('iOS: Classic BT not accessible, returning empty list');
    return [];
  }

  /**
   * Check if Classic Bluetooth is supported on this device
   */
  supportsClassicBluetooth(): boolean {
    return Platform.OS === 'android' && RNBluetoothClassic !== null;
  }

  /**
   * Save a car device (either from paired list or manual entry)
   */
  async saveCarDevice(device: SavedCarDevice): Promise<void> {
    try {
      await AsyncStorage.setItem(StorageKeys.SAVED_CAR_DEVICE, JSON.stringify(device));
      log.debug('Car device saved:', device.name);
    } catch (error) {
      log.error('Error saving car device', error);
      throw error;
    }
  }

  async getSavedCarDevice(): Promise<SavedCarDevice | null> {
    try {
      const deviceJson = await AsyncStorage.getItem(StorageKeys.SAVED_CAR_DEVICE);
      return deviceJson ? JSON.parse(deviceJson) : null;
    } catch (error) {
      log.error('Error getting saved car device', error);
      return null;
    }
  }

  async deleteSavedCarDevice(): Promise<void> {
    try {
      await AsyncStorage.removeItem(StorageKeys.SAVED_CAR_DEVICE);
      this.stopMonitoring();
      log.debug('Car device deleted');
    } catch (error) {
      log.error('Error deleting saved car device', error);
      throw error;
    }
  }

  async removeSavedCarDevice(): Promise<void> {
    return this.deleteSavedCarDevice();
  }

  /**
   * Check if currently connected to the saved car (Android Classic BT)
   */
  async isConnectedToSavedCar(): Promise<boolean> {
    const savedDevice = await this.getSavedCarDevice();
    if (!savedDevice) return false;

    if (Platform.OS === 'android' && RNBluetoothClassic && savedDevice.address) {
      try {
        const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
        return connectedDevices.some((d: any) =>
          d.address === savedDevice.address || d.name === savedDevice.name
        );
      } catch (error) {
        log.debug('Error checking connected devices', error);
        return false;
      }
    }

    // For manual entries or iOS, we can't directly check
    return false;
  }

  /**
   * Monitor for car disconnection events (Android Classic BT)
   */
  async monitorCarConnection(
    onDisconnect: () => void,
    onReconnect?: () => void
  ): Promise<void> {
    const savedDevice = await this.getSavedCarDevice();
    if (!savedDevice) {
      throw new Error('No saved car device');
    }

    this.disconnectCallback = onDisconnect;
    this.reconnectCallback = onReconnect || null;
    this.savedDeviceId = savedDevice.id;

    // Android: Use Classic Bluetooth events
    if (Platform.OS === 'android' && RNBluetoothClassic && savedDevice.address) {
      try {
        // Listen for ALL device DISCONNECTION events (ACL level)
        this.classicBtDisconnectListener = RNBluetoothClassic.onDeviceDisconnected((event: any) => {
          const eventAddress = event?.device?.address || event?.address;
          const eventName = event?.device?.name || event?.name;
          log.info(`[BT EVENT] DISCONNECT: name="${eventName}" addr="${eventAddress}" (watching for: "${savedDevice.name}" addr="${savedDevice.address}")`);

          // Check if this is our saved car (by address or name)
          if (eventAddress === savedDevice.address ||
              (savedDevice.name && eventName === savedDevice.name)) {
            log.info('CAR DISCONNECTED (Classic BT):', savedDevice.name);
            this.connectedDeviceId = null;
            this.notifyDisconnected();
            if (this.disconnectCallback) {
              Promise.resolve(this.disconnectCallback()).catch(err =>
                log.error('Error in disconnect callback:', err)
              );
            }
          } else {
            log.debug(`Ignoring disconnect from non-car device: ${eventName} (${eventAddress})`);
          }
        });

        // Listen for ALL device CONNECTION events (ACL level)
        this.classicBtConnectListener = RNBluetoothClassic.onDeviceConnected((event: any) => {
          const eventAddress = event?.device?.address || event?.address;
          const eventName = event?.device?.name || event?.name;
          log.info(`[BT EVENT] CONNECT: name="${eventName}" addr="${eventAddress}" (watching for: "${savedDevice.name}" addr="${savedDevice.address}")`);

          // Check if this is our saved car (by address or name)
          if (eventAddress === savedDevice.address ||
              (savedDevice.name && eventName === savedDevice.name)) {
            log.info('CAR CONNECTED (Classic BT):', savedDevice.name);
            this.connectedDeviceId = savedDevice.id;
            this.notifyConnected();
            if (this.reconnectCallback) {
              Promise.resolve(this.reconnectCallback()).catch(err =>
                log.error('Error in reconnect callback:', err)
              );
            }
          }
        });

        // Check initial connection state and notify listeners immediately.
        // Without this, HomeScreen gets stuck on "Waiting" because listeners
        // only fire on transitions — if the car is already connected, no
        // transition event ever fires.
        const isConnected = await this.isConnectedToSavedCar();
        this.connectedDeviceId = isConnected ? savedDevice.id : null;
        if (isConnected) {
          this.notifyConnected();
        }

        // Also check bluetooth enabled state
        const btEnabled = await this.isBluetoothEnabled();
        log.info(`Car monitoring started. BT enabled: ${btEnabled}, Currently ${isConnected ? 'CONNECTED' : 'NOT connected'} to ${savedDevice.name} (addr: ${savedDevice.address})`);

      } catch (error) {
        log.error('Error setting up Classic BT monitoring:', error);
        throw error;
      }
    } else {
      // iOS or manual entry
      log.warn(`Classic BT monitoring not available. Platform=${Platform.OS}, hasLib=${!!RNBluetoothClassic}, hasAddr=${!!savedDevice.address}`);
      // For iOS/manual entries, we'll rely on periodic checks
      // The actual monitoring will be handled by BackgroundTaskService
    }
  }

  isConnectedToCar(): boolean {
    return this.connectedDeviceId !== null && this.connectedDeviceId === this.savedDeviceId;
  }

  /**
   * Register a listener for Bluetooth connection state changes.
   * No polling - fires only on actual connect/disconnect events.
   */
  addConnectionListener(onConnect: () => void, onDisconnect: () => void): void {
    this.connectionListeners.push({ onConnect, onDisconnect });
  }

  removeConnectionListener(onConnect: () => void, onDisconnect: () => void): void {
    this.connectionListeners = this.connectionListeners.filter(
      l => l.onConnect !== onConnect || l.onDisconnect !== onDisconnect
    );
  }

  private notifyConnected(): void {
    this.connectionListeners.forEach(l => l.onConnect());
  }

  private notifyDisconnected(): void {
    this.connectionListeners.forEach(l => l.onDisconnect());
  }

  stopMonitoring(): void {
    // Clean up Classic BT disconnect listener
    if (this.classicBtDisconnectListener) {
      try {
        this.classicBtDisconnectListener.remove();
      } catch (e) {
        // Ignore cleanup errors
      }
      this.classicBtDisconnectListener = null;
    }

    // Clean up Classic BT connect listener
    if (this.classicBtConnectListener) {
      try {
        this.classicBtConnectListener.remove();
      } catch (e) {
        // Ignore cleanup errors
      }
      this.classicBtConnectListener = null;
    }

    this.connectedDeviceId = null;
    this.disconnectCallback = null;
    this.reconnectCallback = null;
    this.savedDeviceId = null;
    log.debug('Bluetooth monitoring stopped');
  }

}

export default new BluetoothServiceClass();
