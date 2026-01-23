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
  const [pairedDevices, setPairedDevices] = useState<SavedCarDevice[]>([]);
  const [savedCar, setSavedCar] = useState<SavedCarDevice | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [manualCarName, setManualCarName] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Refs to prevent memory leaks and race conditions
  const isMountedRef = useRef(true);
  const loadingRef = useRef(false);
  const selectingRef = useRef(false);
  const removingRef = useRef(false);

  // Check if Classic Bluetooth is supported (Android only)
  const supportsClassicBT = BluetoothService.supportsClassicBluetooth();

  // Cleanup on unmount
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

  const loadPairedDevices = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setPairedDevices([]);

    try {
      const devices = await BluetoothService.getPairedDevices();
      if (isMountedRef.current) {
        setPairedDevices(devices);
        if (devices.length === 0 && supportsClassicBT) {
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
  }, [supportsClassicBT]);

  const selectDevice = useCallback(async (device: SavedCarDevice) => {
    if (selectingRef.current) return;
    selectingRef.current = true;
    setIsSelecting(true);

    try {
      await BluetoothService.saveCarDevice(device);
      if (isMountedRef.current) {
        setSavedCar(device);
        setPairedDevices([]);
        setShowManualEntry(false);
        Alert.alert(
          'Car Saved!',
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
          `"${trimmedName}" has been saved. Note: On iOS, automatic disconnect detection is limited. You may need to manually check parking when you park.`
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
      accessibilityHint="Double tap to save this device as your car"
    >
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
        <Text style={styles.deviceId}>{item.address || item.id}</Text>
      </View>
      {isSelecting && <ActivityIndicator size="small" color={colors.primary} />}
    </TouchableOpacity>
  ), [isSelecting, selectDevice]);

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
                accessibilityHint="Double tap to remove this car"
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

        {/* Pair Car Section - Platform specific */}
        {!savedCar && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {Platform.OS === 'android' ? 'Select Your Car' : 'Add Your Car'}
            </Text>

            {Platform.OS === 'android' && supportsClassicBT ? (
              <>
                <Text style={styles.instructions}>
                  First, make sure your car is paired in your phone's Bluetooth settings.
                  Then tap the button below to see your paired devices and select your car.
                </Text>

                <TouchableOpacity
                  style={[styles.actionButton, loading && styles.actionButtonDisabled]}
                  onPress={loadPairedDevices}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel={loading ? 'Loading paired devices' : 'Show paired Bluetooth devices'}
                  accessibilityHint="Double tap to see devices paired with your phone"
                  accessibilityState={{ busy: loading }}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.actionButtonText}>Show Paired Devices</Text>
                  )}
                </TouchableOpacity>

                {pairedDevices.length > 0 && (
                  <View style={styles.devicesList}>
                    <Text style={styles.devicesTitle}>
                      Select your car from {pairedDevices.length} paired device{pairedDevices.length !== 1 ? 's' : ''}:
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

                {/* Manual entry option for Android too */}
                <TouchableOpacity
                  style={styles.linkButton}
                  onPress={() => setShowManualEntry(!showManualEntry)}
                >
                  <Text style={styles.linkButtonText}>
                    {showManualEntry ? 'Hide manual entry' : "Can't find your car? Enter manually"}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.instructions}>
                {Platform.OS === 'ios'
                  ? "Due to iOS restrictions, we can't automatically detect your car's Bluetooth. Please enter your car's name below (e.g., \"My Honda\" or \"Work Car\")."
                  : "Enter a name for your car below. This helps you identify which car you're monitoring."}
              </Text>
            )}

            {/* Manual Entry Section */}
            {(showManualEntry || Platform.OS === 'ios') && (
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
                  accessibilityRole="button"
                  accessibilityLabel="Save car name"
                  accessibilityHint="Double tap to save this car name"
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
          <Text style={styles.infoTitle}>How it works:</Text>
          <Text style={styles.infoText}>
            {Platform.OS === 'android' && supportsClassicBT ? (
              '1. Pair your car in phone Settings > Bluetooth\n' +
              '2. Select your car from the list above\n' +
              '3. When you disconnect from your car, we\'ll automatically check parking restrictions\n' +
              '4. You\'ll get an instant notification if there are any restrictions'
            ) : (
              '1. Save your car name above\n' +
              '2. When you park, open the app to check parking restrictions\n' +
              '3. We\'ll show you any street cleaning, permit zones, or snow bans\n' +
              '4. Set up alerts to stay notified about parking restrictions'
            )}
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
