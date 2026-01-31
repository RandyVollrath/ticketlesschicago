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
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BluetoothService, { SavedCarDevice } from '../services/BluetoothService';
import { colors, typography, spacing, borderRadius } from '../theme';
import Logger from '../utils/Logger';

const log = Logger.createLogger('SettingsScreen');

const SettingsScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<SavedCarDevice[]>([]);
  const [savedCar, setSavedCar] = useState<SavedCarDevice | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const isMountedRef = useRef(true);
  const loadingRef = useRef(false);
  const selectingRef = useRef(false);
  const removingRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
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

  // Load system-paired Classic Bluetooth devices (Android only)
  const loadPairedDevices = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setPairedDevices([]);

    try {
      const devices = await BluetoothService.getPairedDevices();
      if (isMountedRef.current) {
        setPairedDevices(devices);
        if (devices.length === 0) {
          Alert.alert(
            'No Paired Devices',
            'No Bluetooth devices found. Make sure your car\'s Bluetooth is paired in your phone\'s Settings > Bluetooth first, then come back here.',
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error) {
      log.error('Error loading paired devices', error);
      if (isMountedRef.current) {
        Alert.alert('Error', 'Failed to load Bluetooth devices. Please ensure Bluetooth is enabled and permissions are granted.');
      }
    } finally {
      loadingRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
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
        setPairedDevices([]);
        Alert.alert(
          'Car Paired!',
          `${device.name} has been saved. We'll automatically check parking rules when you disconnect from it (turn off your car).`
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
      'Are you sure you want to remove your paired car? You\'ll stop getting automatic parking alerts.',
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
      accessibilityLabel={`Select ${item.name || 'Unknown Device'} as your car`}
    >
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
        <Text style={styles.deviceId}>{item.address || item.id}</Text>
      </View>
      {isSelecting ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Text style={styles.selectText}>Select</Text>
      )}
    </TouchableOpacity>
  ), [isSelecting, selectDevice]);

  // iOS: Background location + motion sensors for parking detection
  if (Platform.OS === 'ios') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Automatic Parking Detection</Text>
            <Text style={styles.instructions}>
              Autopilot uses background location and motion sensors to automatically detect when you park. No setup needed - it works out of the box.
            </Text>
            <Text style={styles.instructions}>
              You'll see a blue location indicator at the top of your screen while monitoring is active. This is normal and means the app is tracking your driving to detect parking.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.infoTitle}>How it works</Text>
            <Text style={styles.infoText}>
              {'1. Drive and park as usual\n' +
               '2. Your iPhone detects the transition from driving to stopped\n' +
               '3. After ~90 seconds stopped, we confirm you\'ve parked\n' +
               '4. We check parking rules at your location\n' +
               '5. You get a notification if there\'s a restriction'}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.infoTitle}>Location Permission</Text>
            <Text style={styles.infoText}>
              For best results, allow "Always" location access in Settings {'>'} Privacy {'>'} Location Services {'>'} Autopilot America. This lets the app detect parking even when it's in the background.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.infoTitle}>Battery</Text>
            <Text style={styles.infoText}>
              Background location uses some battery. For best experience, charge your phone in your car while driving.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Android: Bluetooth pairing screen
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Saved Car Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Car</Text>
          {savedCar ? (
            <View style={styles.savedCarCard}>
              <View style={styles.savedCarInfo}>
                <Text style={styles.savedCarName}>{savedCar.name}</Text>
                <Text style={styles.savedCarId}>
                  {savedCar.address || savedCar.id}
                </Text>
              </View>
              <TouchableOpacity
                onPress={removeCar}
                style={[styles.removeButton, isRemoving && styles.buttonDisabled]}
                disabled={isRemoving}
                accessibilityRole="button"
                accessibilityLabel="Remove paired car"
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

        {/* Pair Car Section - only shown when no car is saved */}
        {!savedCar && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Your Car</Text>

            <Text style={styles.instructions}>
              Your phone's Bluetooth must already be paired with your car (in Settings {'>'} Bluetooth). Tap below to see your paired devices and pick your car.
            </Text>

            {/* Show Paired Devices Button */}
            <TouchableOpacity
              style={[styles.actionButton, loading && styles.actionButtonDisabled]}
              onPress={loadPairedDevices}
              disabled={loading}
            >
              {loading ? (
                <View style={styles.scanningRow}>
                  <ActivityIndicator color={colors.white} />
                  <Text style={styles.actionButtonText}>  Loading paired devices...</Text>
                </View>
              ) : (
                <Text style={styles.actionButtonText}>Show My Bluetooth Devices</Text>
              )}
            </TouchableOpacity>

            {/* Device List */}
            {pairedDevices.length > 0 && (
              <View style={styles.devicesList}>
                <Text style={styles.devicesTitle}>
                  Tap your car ({pairedDevices.length} paired device{pairedDevices.length !== 1 ? 's' : ''}):
                </Text>
                <FlatList
                  data={pairedDevices}
                  renderItem={renderDevice}
                  keyExtractor={(item) => item.id}
                  style={styles.flatList}
                  scrollEnabled={false}
                />
              </View>
            )}
          </View>
        )}

        {/* Info Section */}
        <View style={styles.section}>
          <Text style={styles.infoTitle}>How it works</Text>
          <Text style={styles.infoText}>
            {'1. Pick your car\'s Bluetooth from the list above (one-time setup)\n' +
             '2. Drive and park as usual\n' +
             '3. When you turn off your car, Bluetooth disconnects\n' +
             '4. We instantly check parking rules and notify you'}
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
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    backgroundColor: colors.textTertiary,
  },
  actionButtonText: {
    color: colors.white,
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
  },
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
    maxHeight: 400,
  },
  deviceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.background,
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
  selectText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.primary,
    marginLeft: spacing.sm,
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
