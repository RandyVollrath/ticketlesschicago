import { Platform, PermissionsAndroid, NativeEventEmitter, NativeModules } from 'react-native';
import BleManager from 'react-native-ble-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SavedCarDevice {
  id: string;
  name: string;
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
      console.log('BLE Manager initialized');
    } catch (error) {
      console.error('Error initializing BLE Manager:', error);
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
      console.error('Error requesting Bluetooth permission:', err);
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

    bleManagerEmitter.addListener('BleManagerDiscoverPeripheral', handleDiscoverPeripheral);

    try {
      await BleManager.scan([], 10, false);
    } catch (error) {
      console.error('Error scanning for devices:', error);
      throw error;
    }
  }

  async saveCarDevice(device: SavedCarDevice): Promise<void> {
    try {
      await AsyncStorage.setItem('savedCarDevice', JSON.stringify(device));
    } catch (error) {
      console.error('Error saving car device:', error);
      throw error;
    }
  }

  async getSavedCarDevice(): Promise<SavedCarDevice | null> {
    try {
      const deviceJson = await AsyncStorage.getItem('savedCarDevice');
      return deviceJson ? JSON.parse(deviceJson) : null;
    } catch (error) {
      console.error('Error getting saved car device:', error);
      return null;
    }
  }

  async deleteSavedCarDevice(): Promise<void> {
    try {
      await AsyncStorage.removeItem('savedCarDevice');
    } catch (error) {
      console.error('Error deleting saved car device:', error);
      throw error;
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
          console.log('Car disconnected:', data.peripheral);
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
      console.log('Connected to car for monitoring:', savedDevice.name);
    } catch (error) {
      // Device might not be in range, but we'll still monitor for when it connects/disconnects
      console.log('Could not connect to car (might not be in range):', error);
    }
  }

  stopMonitoring(): void {
    if (this.monitoringSubscription) {
      this.monitoringSubscription.remove();
      this.monitoringSubscription = null;
    }

    if (this.connectedDeviceId) {
      BleManager.disconnect(this.connectedDeviceId).catch((error) => {
        console.error('Error disconnecting from device:', error);
      });
      this.connectedDeviceId = null;
    }

    this.disconnectCallback = null;
  }
}

export default new BluetoothServiceClass();
