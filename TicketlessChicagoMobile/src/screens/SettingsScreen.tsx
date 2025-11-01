import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Peripheral } from 'react-native-ble-manager';
import BluetoothService, { SavedCarDevice } from '../services/BluetoothService';

const SettingsScreen: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Peripheral[]>([]);
  const [savedCar, setSavedCar] = useState<SavedCarDevice | null>(null);

  useEffect(() => {
    loadSavedCar();
  }, []);

  const loadSavedCar = async () => {
    const device = await BluetoothService.getSavedCarDevice();
    setSavedCar(device);
  };

  const startScanning = async () => {
    setScanning(true);
    setDevices([]);

    try {
      await BluetoothService.startScanning((device) => {
        setDevices((prev) => {
          // Avoid duplicates
          const exists = prev.find((d) => d.id === device.id);
          if (exists) return prev;
          return [...prev, device];
        });
      });
    } catch (error) {
      console.error('Scanning error:', error);
      Alert.alert('Error', 'Failed to scan for Bluetooth devices');
    } finally {
      setScanning(false);
    }
  };

  const selectDevice = async (device: Peripheral) => {
    const carDevice: SavedCarDevice = {
      id: device.id,
      name: device.name || device.id,
      rssi: device.rssi,
    };

    await BluetoothService.saveCarDevice(carDevice);
    setSavedCar(carDevice);

    Alert.alert(
      'Car Paired!',
      `${carDevice.name} has been saved as your car. We'll monitor when you disconnect from it.`
    );
  };

  const removeCar = async () => {
    Alert.alert(
      'Remove Car',
      'Are you sure you want to remove your paired car?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await BluetoothService.removeSavedCarDevice();
            setSavedCar(null);
          },
        },
      ]
    );
  };

  const renderDevice = ({ item }: { item: Peripheral }) => (
    <TouchableOpacity
      style={styles.deviceCard}
      onPress={() => selectDevice(item)}
    >
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
        <Text style={styles.deviceId}>{item.id}</Text>
      </View>
      <Text style={styles.rssi}>{item.rssi ? `${item.rssi} dBm` : ''}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>

      {/* Saved Car Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Paired Car</Text>
        {savedCar ? (
          <View style={styles.savedCarCard}>
            <View style={styles.savedCarInfo}>
              <Text style={styles.savedCarName}>🚗 {savedCar.name}</Text>
              <Text style={styles.savedCarId}>{savedCar.id}</Text>
            </View>
            <TouchableOpacity onPress={removeCar} style={styles.removeButton}>
              <Text style={styles.removeButtonText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.noCarText}>No car paired yet</Text>
        )}
      </View>

      {/* Scan Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Find Your Car</Text>
        <Text style={styles.instructions}>
          Turn on Bluetooth in your car and tap "Scan for Devices" below.
          Select your car from the list to pair it.
        </Text>

        <TouchableOpacity
          style={[styles.scanButton, scanning && styles.scanButtonDisabled]}
          onPress={startScanning}
          disabled={scanning}
        >
          {scanning ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.scanButtonText}>🔍 Scan for Devices</Text>
          )}
        </TouchableOpacity>

        {scanning && (
          <Text style={styles.scanningText}>Scanning for 10 seconds...</Text>
        )}

        {devices.length > 0 && (
          <View style={styles.devicesList}>
            <Text style={styles.devicesTitle}>
              Found {devices.length} device{devices.length !== 1 ? 's' : ''}:
            </Text>
            <FlatList
              data={devices}
              renderItem={renderDevice}
              keyExtractor={(item) => item.id}
              style={styles.flatList}
            />
          </View>
        )}
      </View>

      {/* Info Section */}
      <View style={styles.section}>
        <Text style={styles.infoTitle}>How it works:</Text>
        <Text style={styles.infoText}>
          1. Pair your car's Bluetooth{'\n'}
          2. Turn on monitoring in the app{'\n'}
          3. When you disconnect from your car, we'll automatically check parking restrictions at your location{'\n'}
          4. You'll get an instant notification if there are any restrictions
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    backgroundColor: '#fff',
    padding: 16,
    marginTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  savedCarCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  savedCarInfo: {
    flex: 1,
  },
  savedCarName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  savedCarId: {
    fontSize: 12,
    color: '#666',
  },
  removeButton: {
    padding: 8,
    paddingHorizontal: 16,
    backgroundColor: '#ff4444',
    borderRadius: 6,
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  noCarText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  instructions: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 16,
  },
  scanButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  scanButtonDisabled: {
    backgroundColor: '#999',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scanningText: {
    fontSize: 14,
    color: '#007AFF',
    textAlign: 'center',
    marginTop: 8,
  },
  devicesList: {
    marginTop: 16,
  },
  devicesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  flatList: {
    maxHeight: 300,
  },
  deviceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  deviceId: {
    fontSize: 12,
    color: '#999',
  },
  rssi: {
    fontSize: 12,
    color: '#666',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 22,
  },
});

export default SettingsScreen;
