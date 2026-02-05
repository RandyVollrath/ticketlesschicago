import { Platform, PermissionsAndroid, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';
import { StorageKeys } from '../constants';

// Native module for persistent Android BT monitoring foreground service
const BluetoothMonitorModule = Platform.OS === 'android' ? NativeModules.BluetoothMonitorModule : null;

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
        // Activity Recognition for driving/parking detection (Android 10+)
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
      ]);

      const allGranted =
        granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;

      // Activity Recognition is optional — don't fail BT setup if denied
      const arGranted = granted['android.permission.ACTIVITY_RECOGNITION'] === PermissionsAndroid.RESULTS.GRANTED;
      log.debug('Bluetooth permissions:', allGranted ? 'granted' : 'denied', 'Activity Recognition:', arGranted ? 'granted' : 'denied');
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
      // Eagerly set savedDeviceId so isConnectedToCar() works immediately
      // after device selection, without waiting for ensureSavedDeviceLoaded().
      this.savedDeviceId = device.id;
      log.debug('Car device saved:', device.name, 'id:', device.id);
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
   *
   * Uses multiple sources in priority order:
   * 1. Native foreground service (BluetoothMonitorModule) - most reliable,
   *    tracks ACL events which cover A2DP/HFP audio profiles used by cars
   * 2. react-native-bluetooth-classic getConnectedDevices() - only finds
   *    RFCOMM (SPP) connections, NOT A2DP audio. Unreliable for car stereos.
   */
  async isConnectedToSavedCar(): Promise<boolean> {
    const savedDevice = await this.getSavedCarDevice();
    if (!savedDevice) return false;

    if (Platform.OS === 'android') {
      // Source 1: Native foreground service state (ACL-based, most reliable)
      // This tracks BluetoothDevice.ACTION_ACL_CONNECTED/DISCONNECTED which
      // fire for ALL Bluetooth profiles including A2DP audio.
      if (BluetoothMonitorModule) {
        try {
          const nativeConnected = await BluetoothMonitorModule.isCarConnected();
          if (nativeConnected) {
            log.debug('Car connected (native service ACL state)');
            return true;
          }
        } catch (e) {
          log.debug('Native module isCarConnected check failed:', e);
        }
      }

      // Source 2: react-native-bluetooth-classic (RFCOMM only, less reliable for cars)
      if (RNBluetoothClassic && savedDevice.address) {
        try {
          const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
          const rfcommConnected = connectedDevices.some((d: any) =>
            d.address === savedDevice.address || d.name === savedDevice.name
          );
          if (rfcommConnected) {
            log.debug('Car connected (RFCOMM/SPP profile)');
            return true;
          }
        } catch (error) {
          log.debug('Error checking RFCOMM connected devices', error);
        }
      }

      return false;
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
    if (this.connectedDeviceId === null) return false;
    // Match either the real savedDeviceId or the placeholder set when
    // savedDeviceId wasn't loaded yet. Without this, isConnectedToCar()
    // returns false during the window between setCarConnected(true) and
    // ensureSavedDeviceLoaded() completing — causing the disconnect handler
    // to think the car isn't connected and the HomeScreen to show "Not connected."
    return this.connectedDeviceId === this.savedDeviceId || this.connectedDeviceId === '__native_connected__';
  }

  /**
   * Set the car connection state from an external source (e.g., the native
   * foreground service). When the native BluetoothMonitorModule fires
   * BtMonitorCarConnected/Disconnected events, BackgroundTaskService calls
   * this to keep JS-side state in sync and notify UI listeners.
   */
  setCarConnected(connected: boolean): void {
    if (connected) {
      // Use savedDeviceId to make isConnectedToCar() return true
      if (this.savedDeviceId) {
        this.connectedDeviceId = this.savedDeviceId;
      } else {
        // savedDeviceId not loaded yet — use placeholder and kick off async load.
        // The placeholder makes isConnectedToCar() return true (see below),
        // and ensureSavedDeviceLoaded() will retroactively fix it.
        this.connectedDeviceId = '__native_connected__';
        log.warn('setCarConnected(true) called before savedDeviceId loaded — using placeholder, loading now');
        this.ensureSavedDeviceLoaded().catch(() => {});
      }
      this.notifyConnected();
      log.debug('Car connection state set to CONNECTED (external)');
    } else {
      this.connectedDeviceId = null;
      this.notifyDisconnected();
      log.debug('Car connection state set to DISCONNECTED (external)');
    }
  }

  /**
   * Ensure savedDeviceId is populated (needed for isConnectedToCar).
   * Call this during initialization so native service events can correctly
   * update the JS-side connection state.
   *
   * Also retroactively fixes the connectedDeviceId if it was set to the
   * '__native_connected__' placeholder before savedDeviceId was available.
   */
  async ensureSavedDeviceLoaded(): Promise<void> {
    if (this.savedDeviceId) return;
    const saved = await this.getSavedCarDevice();
    if (saved) {
      this.savedDeviceId = saved.id;
      log.debug(`savedDeviceId loaded: ${saved.id} (${saved.name})`);

      // If setCarConnected(true) was called before we loaded, it used a
      // placeholder. Now that we have the real ID, upgrade it so
      // isConnectedToCar() works with exact match too.
      if (this.connectedDeviceId === '__native_connected__') {
        this.connectedDeviceId = saved.id;
        log.info('Retroactively fixed placeholder connectedDeviceId → real savedDeviceId');
      }
    } else {
      log.warn('ensureSavedDeviceLoaded: no saved car device found in AsyncStorage');
    }
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
