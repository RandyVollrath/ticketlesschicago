import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BluetoothService, { SavedCarDevice } from '../services/BluetoothService';
import { colors, typography, spacing, borderRadius } from '../theme';
import Logger from '../utils/Logger';

const log = Logger.createLogger('SettingsScreen');

const SettingsScreen: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<SavedCarDevice[]>([]);
  const [savedCar, setSavedCar] = useState<SavedCarDevice | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // Refs to prevent memory leaks and race conditions
  const isMountedRef = useRef(true);
  const scanningRef = useRef(false);
  const selectingRef = useRef(false);
  const removingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Stop any active scan when unmounting
      if (scanningRef.current) {
        BluetoothService.stopScanning().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    loadSavedCar();
  }, []);

  const loadSavedCar = useCallback(async () => {
    try {
      const device = await BluetoothService.getSavedCarDevice();
      if (isMountedRef.current) {
        setSavedCar(device);
      }
    } catch (error) {
      log.error('Error loading saved car', error);
    }
  }, []);

  const startScanning = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    setDevices([]);

    try {
      await BluetoothService.startScanning((device) => {
        if (isMountedRef.current) {
          setDevices((prev) => {
            // Avoid duplicates
            const exists = prev.find((d) => d.id === device.id);
            if (exists) return prev;
            return [...prev, device];
          });
        }
      });
    } catch (error) {
      log.error('Scanning error', error);
      if (isMountedRef.current) {
        Alert.alert('Error', 'Failed to scan for Bluetooth devices. Please ensure Bluetooth is enabled.');
      }
    } finally {
      scanningRef.current = false;
      if (isMountedRef.current) {
        setScanning(false);
      }
    }
  }, []);

  const selectDevice = useCallback(async (device: SavedCarDevice) => {
    if (selectingRef.current) return;
    selectingRef.current = true;
    setIsSelecting(true);

    try {
      await BluetoothService.saveCarDevice(device);
      if (isMountedRef.current) {
        setSavedCar(device);
        Alert.alert(
          'Car Paired!',
          `${device.name} has been saved as your car. We'll monitor when you disconnect from it.`
        );
      }
    } catch (error) {
      log.error('Error saving car device', error);
      if (isMountedRef.current) {
        Alert.alert('Error', 'Failed to save car. Please try again.');
      }
    } finally {
      selectingRef.current = false;
      if (isMountedRef.current) {
        setIsSelecting(false);
      }
    }
  }, []);

  const removeCar = useCallback(() => {
    if (removingRef.current) return;

    Alert.alert(
      'Remove Car',
      'Are you sure you want to remove your paired car?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            removingRef.current = true;
            if (isMountedRef.current) setIsRemoving(true);

            try {
              await BluetoothService.removeSavedCarDevice();
              if (isMountedRef.current) {
                setSavedCar(null);
              }
            } catch (error) {
              log.error('Error removing car', error);
              if (isMountedRef.current) {
                Alert.alert('Error', 'Failed to remove car. Please try again.');
              }
            } finally {
              removingRef.current = false;
              if (isMountedRef.current) {
                setIsRemoving(false);
              }
            }
          },
        },
      ]
    );
  }, []);

  const renderDevice = useCallback(({ item }: { item: SavedCarDevice }) => (
    <TouchableOpacity
      style={[styles.deviceCard, isSelecting && styles.deviceCardDisabled]}
      onPress={() => selectDevice(item)}
      disabled={isSelecting}
      accessibilityRole="button"
      accessibilityLabel={`Pair with ${item.name || 'Unknown Device'}. Signal strength: ${item.rssi ? `${item.rssi} dBm` : 'unknown'}`}
      accessibilityHint="Double tap to pair this device as your car"
    >
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
        <Text style={styles.deviceId}>{item.id}</Text>
      </View>
      <Text style={styles.rssi}>{item.rssi ? `${item.rssi} dBm` : ''}</Text>
    </TouchableOpacity>
  ), [isSelecting, selectDevice]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Saved Car Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Paired Car</Text>
          {savedCar ? (
            <View style={styles.savedCarCard}>
              <View style={styles.savedCarInfo}>
                <Text style={styles.savedCarName}>🚗 {savedCar.name}</Text>
                <Text style={styles.savedCarId}>{savedCar.id}</Text>
              </View>
              <TouchableOpacity
                onPress={removeCar}
                style={[styles.removeButton, isRemoving && styles.buttonDisabled]}
                disabled={isRemoving}
                accessibilityRole="button"
                accessibilityLabel="Remove paired car"
                accessibilityHint="Double tap to unpair this car"
              >
                {isRemoving ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.removeButtonText}>Remove</Text>
                )}
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
            accessibilityRole="button"
            accessibilityLabel={scanning ? 'Scanning for Bluetooth devices' : 'Scan for Bluetooth devices'}
            accessibilityHint="Double tap to start scanning for your car's Bluetooth"
            accessibilityState={{ busy: scanning }}
          >
            {scanning ? (
              <ActivityIndicator color={colors.white} />
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
                scrollEnabled={false}
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
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  section: {
    backgroundColor: colors.cardBg,
    padding: spacing.base,
    marginTop: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  savedCarCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.infoBg,
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  savedCarInfo: {
    flex: 1,
  },
  savedCarName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  savedCarId: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  removeButton: {
    padding: spacing.sm,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.error,
    borderRadius: borderRadius.sm,
    minWidth: 80,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  removeButtonText: {
    color: colors.white,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
  },
  noCarText: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  instructions: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.base,
  },
  scanButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  scanButtonDisabled: {
    backgroundColor: colors.textTertiary,
  },
  scanButtonText: {
    color: colors.white,
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
  },
  scanningText: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  devicesList: {
    marginTop: spacing.base,
  },
  devicesTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  flatList: {
    maxHeight: 300,
  },
  deviceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deviceCardDisabled: {
    opacity: 0.6,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.medium,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  deviceId: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
  },
  rssi: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  infoTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  infoText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});

export default SettingsScreen;
