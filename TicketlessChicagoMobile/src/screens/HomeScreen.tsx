import React, { useEffect, useState, useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  Alert,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, RouteProp } from '@react-navigation/native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { Button, Card, RuleCard, StatusBadge } from '../components';
import LocationService, { ParkingCheckResult, Coordinates } from '../services/LocationService';
import BluetoothService, { SavedCarDevice } from '../services/BluetoothService';
import BackgroundTaskService from '../services/BackgroundTaskService';
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
  const [savedCar, setSavedCar] = useState<SavedCarDevice | null>(null);
  const [lastParkingCheck, setLastParkingCheck] = useState<ParkingCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOffline, setIsOffline] = useState(false);
  const [locationAccuracy, setLocationAccuracy] = useState<number | undefined>(undefined);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

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

  // Reload car when returning from settings
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadSavedCar();
      loadLastCheck();
    });
    return unsubscribe;
  }, [navigation]);

  const loadInitialData = async () => {
    await Promise.all([loadSavedCar(), loadLastCheck()]);
  };

  const loadSavedCar = async () => {
    const device = await BluetoothService.getSavedCarDevice();
    setSavedCar(device);
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
    log.info('Car disconnected - checking parking location');
    setLoading(true);

    try {
      const coords = await LocationService.getCurrentLocation();
      const result = await LocationService.checkParkingLocation(coords);
      await LocationService.saveParkingCheckResult(result);
      await ParkingHistoryService.addToHistory(result.coords, result.rules, result.address);

      setLastParkingCheck(result);

      if (result.rules.length > 0) {
        await LocationService.sendParkingAlert(result.rules);
      }
    } catch (error) {
      log.error('Error handling car disconnect', error);
      Alert.alert('Error', 'Failed to check parking location');
    } finally {
      setLoading(false);
    }
  };

  const startMonitoring = async () => {
    if (!savedCar) {
      Alert.alert('No Car Paired', 'Please pair your car Bluetooth device first', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pair Now', onPress: () => navigation.navigate('BluetoothSettings') },
      ]);
      return;
    }

    setLoading(true);

    try {
      // Request location permission with background access for auto-detection
      const hasLocationPermission = await LocationService.requestLocationPermission(true);
      if (!hasLocationPermission) {
        Alert.alert('Permission Denied', 'Location permission is required to check parking restrictions');
        setLoading(false);
        return;
      }

      // Small delay to ensure Android permission system is fully ready after grant
      await new Promise(resolve => setTimeout(resolve, 300));

      // Initialize and start background task service for monitoring
      await BackgroundTaskService.initialize();
      const started = await BackgroundTaskService.startMonitoring(handleCarDisconnect);

      if (started) {
        setIsMonitoring(true);
        Alert.alert('Monitoring Started', "We'll check parking restrictions when you disconnect from your car");
      } else {
        Alert.alert(
          'Could Not Start Monitoring',
          'Please check that auto-check is enabled in Settings and your car is paired.'
        );
      }
    } catch (error) {
      log.error('Error starting monitoring', error);
      Alert.alert('Error', 'Failed to start monitoring');
    } finally {
      setLoading(false);
    }
  };

  const stopMonitoring = async () => {
    await BackgroundTaskService.stopMonitoring();
    setIsMonitoring(false);
    Alert.alert('Monitoring Stopped', 'Parking detection has been disabled');
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
      await new Promise(resolve => setTimeout(resolve, 300));

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
              text={isMonitoring ? 'Active' : 'Off'}
              variant={isMonitoring ? 'success' : 'neutral'}
              icon={isMonitoring ? '●' : '○'}
            />
          }
        >
          <Text style={styles.cardDescription}>
            {isMonitoring
              ? 'Monitoring your car connection. We\'ll automatically check parking when you disconnect.'
              : savedCar
              ? 'Enable to automatically check parking when you leave your car.'
              : 'Pair your car to enable automatic parking detection.'}
          </Text>
          <View style={styles.cardActions}>
            {savedCar ? (
              <Button
                title={isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
                variant={isMonitoring ? 'secondary' : 'primary'}
                onPress={isMonitoring ? stopMonitoring : startMonitoring}
                disabled={loading}
              />
            ) : (
              <Button
                title="Pair Your Car"
                variant="primary"
                onPress={() => navigation.navigate('BluetoothSettings')}
              />
            )}
          </View>
        </Card>

        {/* Paired Car Card */}
        {savedCar && (
          <Card title="Paired Vehicle">
            <View style={styles.carRow}>
              <Text style={styles.carIcon}>🚗</Text>
              <View style={styles.carInfo}>
                <Text style={styles.carName}>{savedCar.name}</Text>
                <Text style={styles.carId}>{savedCar.id.substring(0, 17)}...</Text>
              </View>
              <Button
                title="Change"
                variant="ghost"
                size="sm"
                onPress={() => navigation.navigate('BluetoothSettings')}
              />
            </View>
          </Card>
        )}

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
  cardDescription: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    lineHeight: typography.sizes.base * typography.lineHeights.relaxed,
    marginBottom: spacing.md,
  },
  cardActions: {
    marginTop: spacing.sm,
  },
  carRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  carIcon: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  carInfo: {
    flex: 1,
  },
  carName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  carId: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
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
});

export default HomeScreen;
