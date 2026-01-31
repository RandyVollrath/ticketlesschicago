import React, { useEffect, useState, useCallback } from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  Alert,
  RefreshControl,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, RouteProp } from '@react-navigation/native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { Button, Card, RuleCard, StatusBadge } from '../components';
import LocationService, { ParkingCheckResult, Coordinates } from '../services/LocationService';
import BackgroundTaskService from '../services/BackgroundTaskService';
import BluetoothService from '../services/BluetoothService';
import MotionActivityService from '../services/MotionActivityService';
import { ParkingHistoryService } from './HistoryScreen';
import Logger from '../utils/Logger';
import Config from '../config/config';
import NetworkStatus from '../utils/NetworkStatus';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('HomeScreen');

// Route params type
type HomeScreenRouteParams = {
  autoCheck?: boolean;
  fromNotification?: boolean;
};

const HomeScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const route = useRoute<RouteProp<{ Home: HomeScreenRouteParams }, 'Home'>>();
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [lastParkingCheck, setLastParkingCheck] = useState<ParkingCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOffline, setIsOffline] = useState(false);
  const [locationAccuracy, setLocationAccuracy] = useState<number | undefined>(undefined);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [currentActivity, setCurrentActivity] = useState<string>('unknown');
  const [isCarConnected, setIsCarConnected] = useState(false);
  const [savedCarName, setSavedCarName] = useState<string | null>(null);

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to network status
  useEffect(() => {
    const unsubscribe = NetworkStatus.addListener((isConnected) => {
      setIsOffline(!isConnected);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    loadInitialData();
    autoStartMonitoring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle auto-check from notification
  useEffect(() => {
    const handleAutoCheck = async () => {
      if (route.params?.autoCheck) {
        // Clear the param to prevent re-triggering
        navigation.setParams({ autoCheck: undefined, fromNotification: undefined });
        // Trigger parking check
        await performParkingCheck();
      }
    };
    handleAutoCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.autoCheck]);

  // Reload data when returning from other screens (e.g. after pairing car)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      loadLastCheck();
      // Refresh saved car name (in case user just paired)
      try {
        const savedDevice = await BluetoothService.getSavedCarDevice();
        setSavedCarName(savedDevice?.name || null);
      } catch (e) {
        // ignore
      }
    });
    return unsubscribe;
  }, [navigation]);

  // Poll activity status on iOS when monitoring
  useEffect(() => {
    if (!isMonitoring || Platform.OS !== 'ios') return;

    const updateActivity = async () => {
      const activity = await MotionActivityService.getCurrentActivity();
      if (activity) {
        setCurrentActivity(activity.activity);
      }
    };

    updateActivity();
    const interval = setInterval(updateActivity, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [isMonitoring]);

  // Load saved car name on all platforms; subscribe to BT events on Android
  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        const savedDevice = await BluetoothService.getSavedCarDevice();
        if (savedDevice) {
          setSavedCarName(savedDevice.name);
          if (Platform.OS === 'android') {
            const connected = BluetoothService.isConnectedToCar() ||
              await BluetoothService.isConnectedToSavedCar();
            setIsCarConnected(connected);
          }
        } else {
          setSavedCarName(null);
          setIsCarConnected(false);
        }
      } catch (error) {
        log.debug('Error checking initial Bluetooth status', error);
      }
    };

    checkInitialStatus();

    // Subscribe to Bluetooth connect/disconnect events (Android only)
    if (Platform.OS === 'android') {
      const onConnect = () => setIsCarConnected(true);
      const onDisconnect = () => setIsCarConnected(false);
      BluetoothService.addConnectionListener(onConnect, onDisconnect);

      return () => {
        BluetoothService.removeConnectionListener(onConnect, onDisconnect);
      };
    }
  }, [isMonitoring]);

  const loadInitialData = async () => {
    await loadLastCheck();
  };

  const autoStartMonitoring = async () => {
    // Defer monitoring startup so the UI renders first
    setTimeout(async () => {
      try {
        const hasLocationPermission = await LocationService.requestLocationPermission(true);
        if (!hasLocationPermission) {
          log.debug('Location permission not granted, monitoring not auto-started');
          return;
        }

        await BackgroundTaskService.initialize();
        const started = await BackgroundTaskService.startMonitoring(handleCarDisconnect);
        if (started) {
          setIsMonitoring(true);
          log.info('Monitoring auto-started');
        }
      } catch (error) {
        log.error('Error auto-starting monitoring', error);
      }
    }, 500);
  };

  const loadLastCheck = async () => {
    try {
      const stored = await AsyncStorage.getItem(StorageKeys.LAST_PARKING_LOCATION);
      if (stored) {
        setLastParkingCheck(JSON.parse(stored));
      }
    } catch (error) {
      log.error('Error loading last check', error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadInitialData();
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCarDisconnect = async () => {
    // BackgroundTaskService already handles the full parking check + notification.
    // This callback just refreshes the UI with the saved result.
    log.info('Parking detected - refreshing UI');
    await loadLastCheck();
  };

  const stopMonitoring = async () => {
    await BackgroundTaskService.stopMonitoring();
    setIsMonitoring(false);
  };

  const resumeMonitoring = async () => {
    await autoStartMonitoring();
  };

  // Core parking check logic - used by both manual check and auto-check
  const performParkingCheck = useCallback(async (showAllClearAlert: boolean = true, useHighAccuracy: boolean = true) => {
    setLoading(true);
    setIsGettingLocation(true);
    setLocationAccuracy(undefined);

    try {
      const hasPermission = await LocationService.requestLocationPermission();
      if (!hasPermission) {
        Alert.alert('Permission Required', 'Please enable location access to check parking restrictions');
        setLoading(false);
        setIsGettingLocation(false);
        return;
      }

      // Small delay to ensure Android permission system is fully ready after grant
      await new Promise<void>(resolve => setTimeout(resolve, 300));

      // Check if location services are enabled
      const servicesEnabled = await LocationService.checkLocationServicesEnabled();
      if (!servicesEnabled) {
        await LocationService.promptEnableLocationServices();
        setLoading(false);
        setIsGettingLocation(false);
        return;
      }

      // Use high-accuracy location for parking checks to ensure we get the right street
      let coords: Coordinates;
      if (useHighAccuracy) {
        // Wait for GPS to stabilize and get accuracy within 20 meters
        coords = await LocationService.getHighAccuracyLocation(20, 15000);
      } else {
        coords = await LocationService.getCurrentLocation('high');
      }

      setLocationAccuracy(coords.accuracy);
      setIsGettingLocation(false);

      const result = await LocationService.checkParkingLocation(coords);
      await LocationService.saveParkingCheckResult(result);
      await ParkingHistoryService.addToHistory(result.coords, result.rules, result.address);

      setLastParkingCheck(result);

      if (result.rules.length > 0) {
        await LocationService.sendParkingAlert(result.rules);
      } else if (showAllClearAlert) {
        const accuracyInfo = coords.accuracy
          ? ` (accuracy: ${coords.accuracy.toFixed(0)}m)`
          : '';
        Alert.alert('All Clear!', `No parking restrictions at ${result.address}${accuracyInfo}`);
      }
    } catch (error) {
      log.error('Error checking location', error);
      Alert.alert('Error', 'Failed to check parking location. Please try again.');
    } finally {
      setLoading(false);
      setIsGettingLocation(false);
    }
  }, []);

  const checkCurrentLocation = useCallback(() => {
    performParkingCheck(true);
  }, [performParkingCheck]);

  const getGreeting = (): string => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const formatTimeSince = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>No internet connection</Text>
        </View>
      )}
      <ScrollView
        contentContainerStyle={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>{getGreeting()}</Text>
          <Text style={styles.title}>Autopilot</Text>
        </View>

        {/* Car Pairing Prompt - shown prominently when no car is saved */}
        {!savedCarName && (
          <TouchableOpacity
            style={styles.pairCarCard}
            onPress={() => navigation.navigate('BluetoothSettings')}
            activeOpacity={0.8}
          >
            <View style={styles.pairCarContent}>
              <Text style={styles.pairCarIcon}>🚗</Text>
              <View style={styles.pairCarTextWrap}>
                <Text style={styles.pairCarTitle}>Pair Your Car</Text>
                <Text style={styles.pairCarSubtitle}>
                  Connect via Bluetooth for automatic parking alerts when you park.
                </Text>
              </View>
              <Text style={styles.pairCarChevron}>›</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Quick Action */}
        <Button
          title={isGettingLocation ? 'Getting GPS...' : loading ? 'Checking...' : 'Check My Parking'}
          onPress={checkCurrentLocation}
          loading={loading}
          size="lg"
          style={styles.mainButton}
        />

        {/* Location Accuracy Indicator */}
        {locationAccuracy !== undefined && (
          <View style={styles.accuracyContainer}>
            <View style={[
              styles.accuracyDot,
              { backgroundColor: LocationService.getAccuracyDescription(locationAccuracy).color }
            ]} />
            <Text style={styles.accuracyText}>
              GPS Accuracy: {LocationService.getAccuracyDescription(locationAccuracy).label} ({locationAccuracy.toFixed(0)}m)
            </Text>
          </View>
        )}

        {/* Monitoring Status Card */}
        <Card
          title="Auto-Detection"
          headerRight={
            <StatusBadge
              text={isMonitoring ? 'Active' : 'Paused'}
              variant={isMonitoring ? 'success' : 'neutral'}
              icon={isMonitoring ? '●' : '○'}
            />
          }
        >
          {isMonitoring && Platform.OS === 'android' && (
            <View style={styles.btStatusRow}>
              <View style={[styles.btStatusDot, { backgroundColor: isCarConnected ? colors.success : colors.textTertiary }]} />
              <Text style={styles.btStatusText}>
                {savedCarName
                  ? isCarConnected
                    ? `Connected to ${savedCarName}`
                    : `Not connected to ${savedCarName}`
                  : 'No car paired — go to Settings to pair'}
              </Text>
            </View>
          )}
          <Text style={styles.cardDescription}>
            {isMonitoring
              ? Platform.OS === 'ios'
                ? `Current: ${currentActivity === 'automotive' ? 'Driving' : currentActivity === 'walking' ? 'Walking' : currentActivity === 'stationary' ? 'Stationary' : currentActivity}. We'll check parking when you stop.`
                : isCarConnected
                  ? 'Driving detected. We\'ll check parking when you disconnect.'
                  : savedCarName
                    ? 'Waiting for Bluetooth connection to your car.'
                    : 'Pair your car in Settings to enable auto-detection.'
              : 'Parking detection is paused.'}
          </Text>
          {isMonitoring ? (
            <Button
              title="Pause"
              variant="ghost"
              size="sm"
              onPress={stopMonitoring}
            />
          ) : (
            <Button
              title="Resume"
              variant="primary"
              size="sm"
              onPress={resumeMonitoring}
            />
          )}
        </Card>

        {/* Last Check Results */}
        {lastParkingCheck && (
          <Card
            title="Last Parking Check"
            subtitle={formatTimeSince(lastParkingCheck.timestamp)}
          >
            <View style={styles.locationRow}>
              <Text style={styles.locationIcon}>📍</Text>
              <Text style={styles.locationText} numberOfLines={2}>
                {lastParkingCheck.address}
              </Text>
            </View>
            {lastParkingCheck.rules.length > 0 ? (
              <View style={styles.rulesContainer}>
                {lastParkingCheck.rules.map((rule, index) => (
                  <RuleCard key={index} rule={rule} />
                ))}
              </View>
            ) : (
              <View style={styles.allClear}>
                <Text style={styles.allClearIcon}>✅</Text>
                <Text style={styles.allClearText}>No parking restrictions found</Text>
              </View>
            )}
            <Button
              title="View on Map"
              variant="secondary"
              size="sm"
              onPress={() => navigation.navigate('Map')}
              style={styles.viewMapButton}
            />
          </Card>
        )}

        {/* Tips Card */}
        <Card title="Quick Tips">
          <View style={styles.tip}>
            <Text style={styles.tipIcon}>💡</Text>
            <Text style={styles.tipText}>
              Street cleaning usually happens between {Config.PARKING_RULES.STREET_CLEANING_START_HOUR} AM - {Config.PARKING_RULES.STREET_CLEANING_END_HOUR - 12} PM on scheduled days
            </Text>
          </View>
          <View style={styles.tip}>
            <Text style={styles.tipIcon}>❄️</Text>
            <Text style={styles.tipText}>
              Winter overnight parking bans are active Dec {Config.PARKING_RULES.WINTER_BAN_START_DAY} - Apr {Config.PARKING_RULES.WINTER_BAN_END_DAY} ({Config.PARKING_RULES.WINTER_BAN_START_HOUR} AM - {Config.PARKING_RULES.WINTER_BAN_END_HOUR} AM)
            </Text>
          </View>
          <View style={styles.tip}>
            <Text style={styles.tipIcon}>🚨</Text>
            <Text style={styles.tipText}>
              Snow routes are enforced during {Config.PARKING_RULES.SNOW_BAN_INCHES}"+ snowfall events
            </Text>
          </View>
          <View style={styles.tip}>
            <Text style={styles.tipIcon}>🅿️</Text>
            <Text style={styles.tipText}>
              We also check permit zones - avoid tickets in residential permit areas
            </Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  offlineBanner: {
    backgroundColor: colors.warning,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    alignItems: 'center',
  },
  offlineBannerText: {
    color: colors.textPrimary,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
  },
  scrollView: {
    padding: spacing.base,
  },
  header: {
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  greeting: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: typography.sizes.xxxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  mainButton: {
    marginBottom: spacing.sm,
  },
  accuracyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    paddingVertical: spacing.xs,
  },
  accuracyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  accuracyText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  btStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
  },
  btStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  btStatusText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.textPrimary,
  },
  cardDescription: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    lineHeight: typography.sizes.base * typography.lineHeights.relaxed,
    marginBottom: spacing.md,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  locationIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  locationText: {
    flex: 1,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.medium,
    color: colors.textPrimary,
    lineHeight: typography.sizes.base * typography.lineHeights.normal,
  },
  rulesContainer: {
    marginTop: spacing.sm,
  },
  allClear: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.successBg,
    borderRadius: borderRadius.md,
  },
  allClearIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  allClearText: {
    fontSize: typography.sizes.base,
    color: colors.success,
    fontWeight: typography.weights.medium,
  },
  viewMapButton: {
    marginTop: spacing.md,
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  tipIcon: {
    fontSize: typography.sizes.md,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  tipText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: typography.sizes.sm * typography.lineHeights.relaxed,
  },
  pairCarCard: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
  },
  pairCarContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pairCarIcon: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  pairCarTextWrap: {
    flex: 1,
  },
  pairCarTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.white,
    marginBottom: 4,
  },
  pairCarSubtitle: {
    fontSize: typography.sizes.sm,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 18,
  },
  pairCarChevron: {
    fontSize: 28,
    color: 'rgba(255,255,255,0.7)',
    marginLeft: spacing.sm,
  },
});

export default HomeScreen;
