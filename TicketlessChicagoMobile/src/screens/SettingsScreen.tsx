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
import BackgroundTaskService from '../services/BackgroundTaskService';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
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

      // Start (or restart) the native Bluetooth foreground service so
      // it can detect ACL connect/disconnect events for this device.
      // Without this, the BroadcastReceiver is never registered and
      // connection events are silently missed.
      try {
        await BackgroundTaskService.restartBluetoothMonitoring();
        log.info('BT monitoring started for newly selected car:', device.name);
      } catch (btError) {
        log.warn('Failed to start BT monitoring after device selection:', btError);
      }

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

  // ─── Step indicator component ───
  const Step = ({ num, text }: { num: string; text: string }) => (
    <View style={styles.stepRow}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepNum}>{num}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );

  // ─── iOS ───
  if (Platform.OS === 'ios') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroCard}>
            <Text style={styles.heroEmoji}>{'📍'}</Text>
            <Text style={styles.heroTitle}>Automatic Parking Detection</Text>
            <Text style={styles.heroSubtitle}>
              No setup needed — your iPhone handles everything.
            </Text>
          </View>

          <View style={styles.stepsCard}>
            <Step num="1" text="Drive and park as usual" />
            <Step num="2" text="iPhone detects when you stop" />
            <Step num="3" text="We check parking rules" />
            <Step num="4" text="Notification with the result" />
          </View>

          <View style={styles.tipCard}>
            <Text style={styles.tipLabel}>Tip</Text>
            <Text style={styles.tipText}>
              For best results, set location access to "Always" in Settings {'>'} Privacy {'>'} Location Services {'>'} Autopilot America.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Android ───
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero */}
        <View style={styles.heroCard}>
          <Text style={styles.heroEmoji}>{savedCar ? '🚗' : '📡'}</Text>
          <Text style={styles.heroTitle}>
            {savedCar ? 'Connected' : 'Pair Your Car'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {savedCar
              ? `${savedCar.name} is set up for instant parking alerts.`
              : 'Link your car\'s Bluetooth for the fastest alerts.'}
          </Text>
        </View>

        {/* Saved car card */}
        {savedCar && (
          <View style={styles.connectedCard}>
            <View style={styles.connectedInfo}>
              <Text style={styles.connectedName}>{savedCar.name}</Text>
              <Text style={styles.connectedAddr}>
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
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Text style={styles.removeButtonText}>Remove</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Pair section — only when no car saved */}
        {!savedCar && (
          <View style={styles.pairSection}>
            <Text style={styles.pairInstructions}>
              Make sure your car is already paired in your phone's Bluetooth settings, then tap below.
            </Text>

            <TouchableOpacity
              style={[styles.pairButton, loading && styles.pairButtonDisabled]}
              onPress={loadPairedDevices}
              disabled={loading}
            >
              {loading ? (
                <View style={styles.scanningRow}>
                  <ActivityIndicator color={colors.white} />
                  <Text style={styles.pairButtonText}>  Loading...</Text>
                </View>
              ) : (
                <Text style={styles.pairButtonText}>Show My Bluetooth Devices</Text>
              )}
            </TouchableOpacity>

            {pairedDevices.length > 0 && (
              <View style={styles.devicesList}>
                <Text style={styles.devicesTitle}>
                  Tap your car ({pairedDevices.length} device{pairedDevices.length !== 1 ? 's' : ''}):
                </Text>
                <FlatList
                  data={pairedDevices}
                  renderItem={renderDevice}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                />
              </View>
            )}
          </View>
        )}

        {/* How it works — compact steps */}
        <View style={styles.stepsCard}>
          {!savedCar && <Step num="1" text="Select your car above (one time)" />}
          <Step num={savedCar ? '1' : '2'} text="Drive and park as usual" />
          <Step num={savedCar ? '2' : '3'} text="Engine off = instant detection" />
          <Step num={savedCar ? '3' : '4'} text="Get notified of any restrictions" />
        </View>

        {/* Speed context — compact, not a wall of text */}
        {!savedCar && (
          <View style={styles.tipCard}>
            <Text style={styles.tipLabel}>Why Bluetooth?</Text>
            <Text style={styles.tipText}>
              Bluetooth detects parking in seconds. Without it, the app uses motion sensors which can take 1–2 minutes.
            </Text>
          </View>
        )}
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
    padding: spacing.base,
    paddingBottom: spacing.xxl,
  },

  // ─── Hero card ───
  heroCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xxl,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.base,
    ...shadows.md,
  },
  heroEmoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ─── Connected car ───
  connectedCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
    ...shadows.sm,
  },
  connectedInfo: {
    flex: 1,
  },
  connectedName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  connectedAddr: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
  },
  removeButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.error,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  removeButtonText: {
    color: colors.error,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
  },

  // ─── Pair section ───
  pairSection: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xxl,
    padding: spacing.xl,
    marginBottom: spacing.base,
    ...shadows.md,
  },
  pairInstructions: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.base,
    textAlign: 'center',
  },
  pairButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    ...shadows.primaryGlow,
  },
  pairButtonDisabled: {
    backgroundColor: colors.textTertiary,
    ...shadows.sm,
  },
  pairButtonText: {
    color: colors.white,
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
  },
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  devicesList: {
    marginTop: spacing.lg,
  },
  devicesTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
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
    marginBottom: 2,
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

  // ─── Steps card ───
  stepsCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xxl,
    padding: spacing.xl,
    marginBottom: spacing.base,
    ...shadows.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  stepNum: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  stepText: {
    flex: 1,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
    lineHeight: 20,
  },

  // ─── Tip card ───
  tipCard: {
    backgroundColor: colors.secondaryLight,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
  },
  tipLabel: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.bold,
    color: colors.secondaryDark,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tipText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});

export default SettingsScreen;
