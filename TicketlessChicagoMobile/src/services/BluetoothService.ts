import { Platform, PermissionsAndroid, NativeEventEmitter, NativeModules } from 'react-native';
import BleManager from 'react-native-ble-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';

const log = Logger.createLogger('BluetoothService');

export interface SavedCarDevice {
  id: string;
  name: string;
  rssi?: number;
}

const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

class BluetoothServiceClass {
  private monitoringSubscription: any = null;
  private disconnectCallback: (() => void) | null = null;
  private connectedDeviceId: string | null = null;

  async initialize(): Promise<void> {
    try {
      await BleManager.start({ showAlert: false });
      log.debug('BLE Manager initialized');
    } catch (error) {
      log.error('Error initializing BLE Manager', error);
    }
  }

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

      return (
        granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
      );
    } catch (err) {
      log.error('Error requesting Bluetooth permission', err);
      return false;
    }
  }

  async scanForDevices(callback: (devices: SavedCarDevice[]) => void): Promise<void> {
    await this.initialize();

    const hasPermission = await this.requestBluetoothPermission();
    if (!hasPermission) {
      throw new Error('Bluetooth permission denied');
    }

    const devices: Map<string, SavedCarDevice> = new Map();

    const handleDiscoverPeripheral = (peripheral: any) => {
      if (peripheral.name && peripheral.id) {
        devices.set(peripheral.id, {
          id: peripheral.id,
          name: peripheral.name,
        });
        callback(Array.from(devices.values()));
      }
    };

    // Add listeners and store subscriptions for cleanup
    const discoverSubscription = bleManagerEmitter.addListener(
      'BleManagerDiscoverPeripheral',
      handleDiscoverPeripheral
    );

    const stopSubscription = bleManagerEmitter.addListener(
      'BleManagerStopScan',
      () => {
        // Clean up listeners when scan completes
        discoverSubscription.remove();
        stopSubscription.remove();
      }
    );

    try {
      await BleManager.scan([], 10, false);
    } catch (error) {
      // Clean up listeners on error
      discoverSubscription.remove();
      stopSubscription.remove();
      throw error;
    }
  }

  async saveCarDevice(device: SavedCarDevice): Promise<void> {
    try {
      await AsyncStorage.setItem('savedCarDevice', JSON.stringify(device));
      log.debug('Car device saved', device.name);
    } catch (error) {
      log.error('Error saving car device', error);
      throw error;
    }
  }

  async getSavedCarDevice(): Promise<SavedCarDevice | null> {
    try {
      const deviceJson = await AsyncStorage.getItem('savedCarDevice');
      return deviceJson ? JSON.parse(deviceJson) : null;
    } catch (error) {
      log.error('Error getting saved car device', error);
      return null;
    }
  }

  async deleteSavedCarDevice(): Promise<void> {
    try {
      await AsyncStorage.removeItem('savedCarDevice');
      log.debug('Car device deleted');
    } catch (error) {
      log.error('Error deleting saved car device', error);
      throw error;
    }
  }

  // Alias for deleteSavedCarDevice
  async removeSavedCarDevice(): Promise<void> {
    return this.deleteSavedCarDevice();
  }

  // Alias for scanForDevices
  async startScanning(callback: (device: SavedCarDevice) => void): Promise<void> {
    await this.scanForDevices((devices) => {
      // Call back with the most recent device
      if (devices.length > 0) {
        callback(devices[devices.length - 1]);
      }
    });
  }

  // Stop Bluetooth scanning
  async stopScanning(): Promise<void> {
    try {
      await BleManager.stopScan();
      log.debug('Bluetooth scanning stopped');
    } catch (error) {
      log.error('Error stopping Bluetooth scan', error);
    }
  }

  async monitorCarConnection(onDisconnect: () => void): Promise<void> {
    await this.initialize();

    const savedDevice = await this.getSavedCarDevice();
    if (!savedDevice) {
      throw new Error('No saved car device');
    }

    this.disconnectCallback = onDisconnect;

    // Listen for disconnect events
    this.monitoringSubscription = bleManagerEmitter.addListener(
      'BleManagerDisconnectPeripheral',
      (data: any) => {
        if (data.peripheral === savedDevice.id) {
          log.info('Car disconnected', data.peripheral);
          if (this.disconnectCallback) {
            this.disconnectCallback();
          }
        }
      }
    );

    // Try to connect to the device to monitor it
    try {
      await BleManager.connect(savedDevice.id);
      this.connectedDeviceId = savedDevice.id;
      log.info('Connected to car for monitoring', savedDevice.name);
    } catch (error) {
      // Device might not be in range, but we'll still monitor for when it connects/disconnects
      log.debug('Could not connect to car (might not be in range)', error);
    }
  }

  stopMonitoring(): void {
    if (this.monitoringSubscription) {
      this.monitoringSubscription.remove();
      this.monitoringSubscription = null;
    }

    if (this.connectedDeviceId) {
      BleManager.disconnect(this.connectedDeviceId).catch((error) => {
        log.error('Error disconnecting from device', error);
      });
      this.connectedDeviceId = null;
    }

    this.disconnectCallback = null;
    log.debug('Bluetooth monitoring stopped');
  }
}

export default new BluetoothServiceClass();
