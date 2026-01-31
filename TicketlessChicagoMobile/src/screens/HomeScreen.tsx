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
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, RouteProp } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import { Button, Card, RuleCard, StatusBadge } from '../components';
import LocationService, { ParkingCheckResult, ParkingRule, Coordinates } from '../services/LocationService';
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

// ──────────────────────────────────────────────────────
// Hero Card States
// ──────────────────────────────────────────────────────
type HeroState = 'ready' | 'driving' | 'checking' | 'clear' | 'violation' | 'paused';

interface HeroConfig {
  icon: string;
  title: string;
  subtitle: string;
  bgColor: string;
  iconColor: string;
  textColor: string;
}

const getHeroConfig = (
  state: HeroState,
  ruleCount: number,
  address?: string,
): HeroConfig => {
  switch (state) {
    case 'driving':
      return {
        icon: 'car',
        title: 'Driving',
        subtitle: 'We\'ll check parking when you stop.',
        bgColor: colors.primary,
        iconColor: colors.white,
        textColor: colors.white,
      };
    case 'checking':
      return {
        icon: 'radar',
        title: 'Checking...',
        subtitle: 'Scanning parking restrictions at your location.',
        bgColor: colors.primary,
        iconColor: colors.white,
        textColor: colors.white,
      };
    case 'clear':
      return {
        icon: 'shield-check',
        title: 'All Clear',
        subtitle: address || 'No parking restrictions found.',
        bgColor: colors.success,
        iconColor: colors.white,
        textColor: colors.white,
      };
    case 'violation':
      return {
        icon: 'alert-circle',
        title: `${ruleCount} Issue${ruleCount > 1 ? 's' : ''} Found`,
        subtitle: address || 'Parking restrictions detected.',
        bgColor: colors.error,
        iconColor: colors.white,
        textColor: colors.white,
      };
    case 'paused':
      return {
        icon: 'pause-circle-outline',
        title: 'Paused',
        subtitle: 'Parking detection is paused.',
        bgColor: colors.background,
        iconColor: colors.textTertiary,
        textColor: colors.textPrimary,
      };
    case 'ready':
    default:
      return {
        icon: 'shield-check-outline',
        title: 'Ready',
        subtitle: 'Autopilot is watching for your next drive.',
        bgColor: colors.cardBg,
        iconColor: colors.primary,
        textColor: colors.textPrimary,
      };
  }
};

// ──────────────────────────────────────────────────────
// Protection Status - databases we check
// ──────────────────────────────────────────────────────
const PROTECTION_ITEMS = [
  { icon: 'broom', label: 'Street Cleaning' },
  { icon: 'snowflake', label: 'Winter Overnight Ban' },
  { icon: 'weather-snowy-heavy', label: 'Snow Route Ban' },
  { icon: 'parking', label: 'Permit Zones' },
  { icon: 'car-clock', label: 'Rush Hour' },
];

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
  const [showDetails, setShowDetails] = useState(false);

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
        navigation.setParams({ autoCheck: undefined, fromNotification: undefined });
        await performParkingCheck();
      }
    };
    handleAutoCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.autoCheck]);

  // Reload data when returning from other screens
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      loadLastCheck();
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
    const interval = setInterval(updateActivity, 10000);
    return () => clearInterval(interval);
  }, [isMonitoring]);

  // Load saved car name; subscribe to BT events on Android
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

      await new Promise<void>(resolve => setTimeout(resolve, 300));

      const servicesEnabled = await LocationService.checkLocationServicesEnabled();
      if (!servicesEnabled) {
        await LocationService.promptEnableLocationServices();
        setLoading(false);
        setIsGettingLocation(false);
        return;
      }

      let coords: Coordinates;
      if (useHighAccuracy) {
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

  const getDirections = useCallback((coords: Coordinates) => {
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${coords.latitude},${coords.longitude}&dirflg=w`,
      android: `google.navigation:q=${coords.latitude},${coords.longitude}&mode=w`,
    });
    if (url) {
      Linking.openURL(url).catch(err => {
        log.error('Failed to open directions', err);
        Alert.alert('Error', 'Could not open navigation');
      });
    }
  }, []);

  // ──────────────────────────────────────────────────────
  // Derive hero state from app state
  // ──────────────────────────────────────────────────────
  const getHeroState = (): HeroState => {
    if (loading) return 'checking';
    if (!isMonitoring) return 'paused';

    // iOS: use CoreMotion activity
    if (Platform.OS === 'ios') {
      if (currentActivity === 'automotive') return 'driving';
    }
    // Android: use Bluetooth connection
    if (Platform.OS === 'android') {
      if (isCarConnected) return 'driving';
    }

    // If we have a recent check result (< 2 hours), show its state
    if (lastParkingCheck) {
      const ageMs = Date.now() - lastParkingCheck.timestamp;
      if (ageMs < 2 * 60 * 60 * 1000) {
        return lastParkingCheck.rules.length > 0 ? 'violation' : 'clear';
      }
    }

    return 'ready';
  };

  const heroState = getHeroState();
  const heroConfig = getHeroConfig(
    heroState,
    lastParkingCheck?.rules.length || 0,
    lastParkingCheck?.address,
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      {isOffline && (
        <View style={styles.offlineBanner}>
          <MaterialCommunityIcons name="wifi-off" size={14} color={colors.textPrimary} />
          <Text style={styles.offlineBannerText}> No internet connection</Text>
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

        {/* Hero Card - state-driven */}
        <TouchableOpacity
          style={[
            styles.heroCard,
            { backgroundColor: heroConfig.bgColor },
            (heroState === 'ready' || heroState === 'paused') && styles.heroCardBorder,
          ]}
          onPress={() => {
            if (heroState === 'clear' || heroState === 'violation') {
              setShowDetails(!showDetails);
            }
          }}
          activeOpacity={heroState === 'clear' || heroState === 'violation' ? 0.8 : 1}
          accessibilityRole="text"
          accessibilityLabel={`${heroConfig.title}. ${heroConfig.subtitle}`}
        >
          <View style={styles.heroContent}>
            <View style={[styles.heroIconCircle, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <MaterialCommunityIcons
                name={heroConfig.icon}
                size={32}
                color={heroConfig.iconColor}
              />
            </View>
            <View style={styles.heroTextWrap}>
              <Text style={[styles.heroTitle, { color: heroConfig.textColor }]}>
                {heroConfig.title}
              </Text>
              <Text
                style={[styles.heroSubtitle, { color: heroConfig.textColor, opacity: 0.85 }]}
                numberOfLines={2}
              >
                {heroConfig.subtitle}
              </Text>
            </View>
            {(heroState === 'clear' || heroState === 'violation') && (
              <MaterialCommunityIcons
                name={showDetails ? 'chevron-up' : 'chevron-down'}
                size={24}
                color={heroConfig.textColor}
                style={{ opacity: 0.7 }}
              />
            )}
          </View>

          {/* Expanded details for clear/violation */}
          {showDetails && lastParkingCheck && (
            <View style={styles.heroExpanded}>
              <View style={styles.heroDivider} />
              {lastParkingCheck.rules.length > 0 ? (
                lastParkingCheck.rules.map((rule, index) => (
                  <View key={index} style={styles.heroRuleRow}>
                    <MaterialCommunityIcons
                      name="alert"
                      size={16}
                      color="rgba(255,255,255,0.9)"
                    />
                    <Text style={styles.heroRuleText}>{rule.message || rule.type}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.heroExpandedText}>
                  No restrictions at this location. You're good to park here.
                </Text>
              )}
              <View style={styles.heroActions}>
                <TouchableOpacity
                  style={styles.heroActionButton}
                  onPress={() => getDirections(lastParkingCheck.coords)}
                >
                  <MaterialCommunityIcons name="navigation-variant" size={16} color={colors.white} />
                  <Text style={styles.heroActionText}>Directions</Text>
                </TouchableOpacity>
                <Text style={styles.heroTimestamp}>
                  {formatTimeSince(lastParkingCheck.timestamp)}
                </Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* Pause/Resume - only when paused */}
        {!isMonitoring && (
          <Button
            title="Resume Monitoring"
            variant="primary"
            size="md"
            onPress={resumeMonitoring}
            icon={<MaterialCommunityIcons name="play-circle-outline" size={20} color={colors.white} />}
            style={styles.resumeButton}
          />
        )}

        {/* Car Pairing Prompt - Android only */}
        {Platform.OS === 'android' && !savedCarName && (
          <TouchableOpacity
            style={styles.pairCarCard}
            onPress={() => navigation.navigate('BluetoothSettings')}
            activeOpacity={0.8}
          >
            <View style={styles.pairCarContent}>
              <MaterialCommunityIcons name="bluetooth-connect" size={28} color={colors.white} />
              <View style={styles.pairCarTextWrap}>
                <Text style={styles.pairCarTitle}>Pair Your Car</Text>
                <Text style={styles.pairCarSubtitle}>
                  One-time setup so we can detect when you park.
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color="rgba(255,255,255,0.7)" />
            </View>
          </TouchableOpacity>
        )}

        {/* Quick Action Button */}
        <Button
          title={isGettingLocation ? 'Getting GPS...' : loading ? 'Checking...' : 'Check My Parking'}
          onPress={checkCurrentLocation}
          loading={loading}
          size="lg"
          style={styles.mainButton}
          icon={!loading ? <MaterialCommunityIcons name="crosshairs-gps" size={20} color={colors.white} /> : undefined}
        />

        {/* GPS Accuracy */}
        {locationAccuracy !== undefined && (
          <View style={styles.accuracyContainer}>
            <View style={[
              styles.accuracyDot,
              { backgroundColor: LocationService.getAccuracyDescription(locationAccuracy).color }
            ]} />
            <Text style={styles.accuracyText}>
              GPS: {LocationService.getAccuracyDescription(locationAccuracy).label} ({locationAccuracy.toFixed(0)}m)
            </Text>
          </View>
        )}

        {/* Android BT Status */}
        {isMonitoring && Platform.OS === 'android' && (
          <View style={styles.btStatusRow}>
            <MaterialCommunityIcons
              name={isCarConnected ? 'bluetooth-connect' : 'bluetooth-off'}
              size={16}
              color={isCarConnected ? colors.success : colors.textTertiary}
            />
            <Text style={styles.btStatusText}>
              {savedCarName
                ? isCarConnected
                  ? `Connected to ${savedCarName}`
                  : `Waiting for ${savedCarName}`
                : 'No car paired'}
            </Text>
          </View>
        )}

        {/* Monitoring Toggle (when active) */}
        {isMonitoring && (
          <TouchableOpacity
            style={styles.pauseRow}
            onPress={stopMonitoring}
            accessibilityLabel="Pause parking detection"
          >
            <MaterialCommunityIcons name="pause-circle-outline" size={18} color={colors.textTertiary} />
            <Text style={styles.pauseText}>Pause detection</Text>
          </TouchableOpacity>
        )}

        {/* Protection Status - what we check */}
        <View style={styles.protectionCard}>
          <Text style={styles.protectionTitle}>Protection Coverage</Text>
          <View style={styles.protectionGrid}>
            {PROTECTION_ITEMS.map((item, index) => (
              <View key={index} style={styles.protectionItem}>
                <MaterialCommunityIcons
                  name={item.icon}
                  size={18}
                  color={colors.primary}
                />
                <Text style={styles.protectionLabel}>{item.label}</Text>
                <MaterialCommunityIcons
                  name="check-circle"
                  size={14}
                  color={colors.success}
                />
              </View>
            ))}
          </View>
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
  offlineBanner: {
    backgroundColor: colors.warning,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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

  // Hero Card
  heroCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.base,
    ...shadows.md,
  },
  heroCardBorder: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  heroTextWrap: {
    flex: 1,
  },
  heroTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.sizes.sm * typography.lineHeights.relaxed,
  },
  heroExpanded: {
    marginTop: spacing.md,
  },
  heroDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: spacing.md,
  },
  heroRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  heroRuleText: {
    marginLeft: spacing.sm,
    fontSize: typography.sizes.sm,
    color: colors.white,
    flex: 1,
  },
  heroExpandedText: {
    fontSize: typography.sizes.sm,
    color: colors.white,
    opacity: 0.9,
    marginBottom: spacing.sm,
  },
  heroActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  heroActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  heroActionText: {
    color: colors.white,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    marginLeft: spacing.xs,
  },
  heroTimestamp: {
    color: colors.white,
    fontSize: typography.sizes.xs,
    opacity: 0.7,
  },

  // Resume button
  resumeButton: {
    marginBottom: spacing.base,
  },

  // Main button
  mainButton: {
    marginBottom: spacing.sm,
  },

  // Accuracy
  accuracyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
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

  // BT status
  btStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    ...shadows.sm,
  },
  btStatusText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },

  // Pause row
  pauseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    paddingVertical: spacing.xs,
  },
  pauseText: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    marginLeft: spacing.xs,
  },

  // Car pairing card
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
  pairCarTextWrap: {
    flex: 1,
    marginLeft: spacing.md,
  },
  pairCarTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
    color: colors.white,
    marginBottom: 2,
  },
  pairCarSubtitle: {
    fontSize: typography.sizes.sm,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 18,
  },

  // Protection status
  protectionCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
    ...shadows.sm,
  },
  protectionTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  protectionGrid: {
    gap: spacing.sm,
  },
  protectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  protectionLabel: {
    flex: 1,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
});

export default HomeScreen;
