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
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BluetoothService, { SavedCarDevice } from '../services/BluetoothService';
import { colors, typography, spacing, borderRadius } from '../theme';
import Logger from '../utils/Logger';

const log = Logger.createLogger('SettingsScreen');

const SettingsScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<SavedCarDevice[]>([]);
  const [nearbyDevices, setNearbyDevices] = useState<SavedCarDevice[]>([]);
  const [savedCar, setSavedCar] = useState<SavedCarDevice | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [manualCarName, setManualCarName] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);

  const isMountedRef = useRef(true);
  const loadingRef = useRef(false);
  const selectingRef = useRef(false);
  const removingRef = useRef(false);

  const supportsClassicBT = BluetoothService.supportsClassicBluetooth();

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Stop any BLE scanning on unmount
      BluetoothService.stopScanning().catch(() => {});
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

  // Android: Load system-paired Classic Bluetooth devices
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
            'No Bluetooth devices found. Make sure your car is paired in your phone\'s Bluetooth settings first.',
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

  // iOS: Scan for nearby BLE devices
  const scanForNearbyDevices = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setScanning(true);
    setNearbyDevices([]);

    try {
      await BluetoothService.scanForDevices((devices) => {
        if (isMountedRef.current) {
          // Filter to show only named devices (likely car systems, not random beacons)
          const named = devices.filter(d => d.name && d.name !== 'Unknown Device');
          setNearbyDevices(named);
        }
      });

      // Scan runs for 10 seconds, then stops automatically
      setTimeout(() => {
        loadingRef.current = false;
        if (isMountedRef.current) {
          setScanning(false);
        }
      }, 11000);
    } catch (error) {
      log.error('Error scanning for devices', error);
      loadingRef.current = false;
      if (isMountedRef.current) {
        setScanning(false);
        Alert.alert('Error', 'Failed to scan for Bluetooth devices. Make sure Bluetooth is enabled.');
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
        setNearbyDevices([]);
        setShowManualEntry(false);
        Alert.alert(
          'Car Saved!',
          Platform.OS === 'ios'
            ? `${device.name} has been saved. We'll automatically check parking when you stop driving.`
            : `${device.name} has been saved. We'll check parking when you disconnect from it.`
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

  const saveManualCar = useCallback(async () => {
    const trimmedName = manualCarName.trim();
    if (!trimmedName) {
      Alert.alert('Error', 'Please enter a name for your car.');
      return;
    }

    if (selectingRef.current) return;
    selectingRef.current = true;
    setIsSelecting(true);

    try {
      const device = await BluetoothService.saveManualCarDevice(trimmedName);
      if (isMountedRef.current) {
        setSavedCar(device);
        setManualCarName('');
        setShowManualEntry(false);
        Alert.alert(
          'Car Saved!',
          Platform.OS === 'ios'
            ? `"${trimmedName}" has been saved. We'll automatically check parking when you stop driving.`
            : `"${trimmedName}" has been saved. We'll check parking when you disconnect from it.`
        );
      }
    } catch (error) {
      log.error('Error saving manual car', error);
      if (isMountedRef.current) {
        Alert.alert('Error', 'Failed to save car. Please try again.');
      }
    } finally {
      selectingRef.current = false;
      if (isMountedRef.current) {
        setIsSelecting(false);
      }
    }
  }, [manualCarName]);

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
      accessibilityLabel={`Select ${item.name || 'Unknown Device'} as your car`}
    >
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
        <Text style={styles.deviceId}>{item.address || item.id}</Text>
      </View>
      {isSelecting && <ActivityIndicator size="small" color={colors.primary} />}
    </TouchableOpacity>
  ), [isSelecting, selectDevice]);

  const allDevices = [...pairedDevices, ...nearbyDevices];

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
                  {savedCar.isManualEntry ? 'Manually entered' : (savedCar.address || savedCar.id)}
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
            <Text style={styles.noCarText}>No car saved yet</Text>
          )}
        </View>

        {/* Pair Car Section */}
        {!savedCar && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Your Car</Text>

            <Text style={styles.instructions}>
              {Platform.OS === 'android'
                ? 'Make sure your car is paired in your phone\'s Bluetooth settings, then tap below to find it.'
                : 'Make sure you\'re connected to your car\'s Bluetooth, then tap below to find it. If your car doesn\'t appear, you can enter the name manually.'}
            </Text>

            {/* Find Bluetooth Devices Button */}
            <TouchableOpacity
              style={[styles.actionButton, (loading || scanning) && styles.actionButtonDisabled]}
              onPress={Platform.OS === 'android' && supportsClassicBT ? loadPairedDevices : scanForNearbyDevices}
              disabled={loading || scanning}
            >
              {loading || scanning ? (
                <View style={styles.scanningRow}>
                  <ActivityIndicator color={colors.white} />
                  <Text style={styles.actionButtonText}>
                    {scanning ? '  Scanning for devices...' : '  Loading...'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.actionButtonText}>Find Bluetooth Devices</Text>
              )}
            </TouchableOpacity>

            {/* Device List */}
            {allDevices.length > 0 && (
              <View style={styles.devicesList}>
                <Text style={styles.devicesTitle}>
                  Select your car ({allDevices.length} device{allDevices.length !== 1 ? 's' : ''} found):
                </Text>
                <FlatList
                  data={allDevices}
                  renderItem={renderDevice}
                  keyExtractor={(item) => item.id}
                  style={styles.flatList}
                  scrollEnabled={false}
                />
              </View>
            )}

            {/* Manual entry fallback */}
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => setShowManualEntry(!showManualEntry)}
            >
              <Text style={styles.linkButtonText}>
                {showManualEntry ? 'Hide manual entry' : "Can't find your car? Enter name manually"}
              </Text>
            </TouchableOpacity>

            {showManualEntry && (
              <View style={styles.manualEntrySection}>
                <Text style={styles.manualEntryLabel}>Car Name</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g., My Honda, Family Car"
                  placeholderTextColor={colors.textTertiary}
                  value={manualCarName}
                  onChangeText={setManualCarName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={saveManualCar}
                />
                <TouchableOpacity
                  style={[styles.actionButton, (!manualCarName.trim() || isSelecting) && styles.actionButtonDisabled]}
                  onPress={saveManualCar}
                  disabled={!manualCarName.trim() || isSelecting}
                >
                  {isSelecting ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.actionButtonText}>Save Car</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Info Section */}
        <View style={styles.section}>
          <Text style={styles.infoTitle}>How it works</Text>
          <Text style={styles.infoText}>
            {Platform.OS === 'android'
              ? '1. Select your car\'s Bluetooth above (one-time setup)\n' +
                '2. Drive and park as usual\n' +
                '3. When you turn off your car, Bluetooth disconnects\n' +
                '4. We instantly check parking rules and notify you'
              : '1. Save your car above (one-time setup)\n' +
                '2. Drive and park as usual\n' +
                '3. When you stop and park, we detect it via motion sensors\n' +
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
  linkButton: {
    marginTop: spacing.base,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  linkButtonText: {
    color: colors.primary,
    fontSize: typography.sizes.sm,
    textDecorationLine: 'underline',
  },
  manualEntrySection: {
    marginTop: spacing.base,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  manualEntryLabel: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: typography.sizes.md,
    color: colors.textPrimary,
    marginBottom: spacing.base,
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
