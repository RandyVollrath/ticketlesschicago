import BleManager, { Peripheral } from 'react-native-ble-manager';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

export interface SavedCarDevice {
  id: string;
  name: string;
  rssi?: number;
}

class BluetoothService {
  private isInitialized = false;
  private disconnectListener: any = null;
  private onCarDisconnectCallback: (() => void) | null = null;

  async initialize() {
    if (this.isInitialized) return;

    try {
      await BleManager.start({ showAlert: false });
      this.isInitialized = true;
      console.log('BLE Manager initialized');
    } catch (error) {
      console.error('BLE initialization error:', error);
    }
  }

  async startScanning(onDeviceFound: (device: Peripheral) => void): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      try {
        // Listen for discovered devices
        const discoverListener = bleManagerEmitter.addListener(
          'BleManagerDiscoverPeripheral',
          (peripheral: Peripheral) => {
            if (peripheral.name) {
              onDeviceFound(peripheral);
            }
          }
        );

        // Start scanning
        BleManager.scan([], 10, false)
          .then(() => {
            console.log('Scanning started...');

            // Stop scanning after 10 seconds
            setTimeout(() => {
              BleManager.stopScan()
                .then(() => {
                  console.log('Scanning stopped');
                  discoverListener.remove();
                  resolve();
                })
                .catch(reject);
            }, 10000);
          })
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async saveCarDevice(device: SavedCarDevice) {
    try {
      await AsyncStorage.setItem('savedCarDevice', JSON.stringify(device));
      console.log('Car device saved:', device.name);
    } catch (error) {
      console.error('Error saving car device:', error);
    }
  }

  async getSavedCarDevice(): Promise<SavedCarDevice | null> {
    try {
      const data = await AsyncStorage.getItem('savedCarDevice');
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting saved car device:', error);
      return null;
    }
  }

  async removeSavedCarDevice() {
    try {
      await AsyncStorage.removeItem('savedCarDevice');
      console.log('Car device removed');
    } catch (error) {
      console.error('Error removing car device:', error);
    }
  }

  async checkCarConnection(deviceId: string): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const isConnected = await BleManager.isPeripheralConnected(deviceId, []);
      return isConnected;
    } catch (error) {
      console.error('Error checking car connection:', error);
      return false;
    }
  }

  async monitorCarConnection(onDisconnect: () => void) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.onCarDisconnectCallback = onDisconnect;

    // Remove existing listener if any
    if (this.disconnectListener) {
      this.disconnectListener.remove();
    }

    const savedDevice = await this.getSavedCarDevice();
    if (!savedDevice) {
      console.log('No saved car device to monitor');
      return;
    }

    // Listen for disconnect events
    this.disconnectListener = bleManagerEmitter.addListener(
      'BleManagerDisconnectPeripheral',
      async (data: { peripheral: string }) => {
        console.log('Device disconnected:', data.peripheral);

        // Check if it's our saved car device
        if (data.peripheral === savedDevice.id) {
          console.log('Car disconnected! User has parked.');
          if (this.onCarDisconnectCallback) {
            this.onCarDisconnectCallback();
          }
        }
      }
    );

    // Also periodically check connection status
    this.startPeriodicConnectionCheck(savedDevice.id);
  }

  private connectionCheckInterval: NodeJS.Timeout | null = null;

  private startPeriodicConnectionCheck(deviceId: string) {
    // Clear existing interval if any
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }

    let wasConnected = false;

    this.connectionCheckInterval = setInterval(async () => {
      const isConnected = await this.checkCarConnection(deviceId);

      // Detect transition from connected to disconnected
      if (wasConnected && !isConnected) {
        console.log('Car connection lost! User has parked.');
        if (this.onCarDisconnectCallback) {
          this.onCarDisconnectCallback();
        }
      }

      wasConnected = isConnected;
    }, 5000); // Check every 5 seconds
  }

  stopMonitoring() {
    if (this.disconnectListener) {
      this.disconnectListener.remove();
      this.disconnectListener = null;
    }

    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }

    this.onCarDisconnectCallback = null;
  }

  async getConnectedDevices(): Promise<Peripheral[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const peripherals = await BleManager.getConnectedPeripherals([]);
      return peripherals;
    } catch (error) {
      console.error('Error getting connected devices:', error);
      return [];
    }
  }
}

export default new BluetoothService();
