import React, { useEffect, useState, useCallback, useRef } from 'react';
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
import BackgroundLocationService, { LocationUpdateEvent } from '../services/BackgroundLocationService';
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
        subtitle: 'Watching for when you park',
        bgColor: colors.primary,
        iconColor: colors.white,
        textColor: colors.white,
      };
    case 'checking':
      return {
        icon: 'radar',
        title: 'Checking...',
        subtitle: 'Scanning restrictions at your spot',
        bgColor: colors.primary,
        iconColor: colors.white,
        textColor: colors.white,
      };
    case 'clear':
      return {
        icon: 'shield-check',
        title: 'All clear',
        subtitle: address || 'No restrictions here',
        bgColor: colors.success,
        iconColor: colors.white,
        textColor: colors.white,
      };
    case 'violation':
      return {
        icon: 'alert-circle',
        title: `${ruleCount} restriction${ruleCount > 1 ? 's' : ''} found`,
        subtitle: address || 'Move your car',
        bgColor: colors.error,
        iconColor: colors.white,
        textColor: colors.white,
      };
    case 'paused':
      return {
        icon: 'pause-circle-outline',
        title: 'Paused',
        subtitle: 'Tap Resume below',
        bgColor: colors.primaryTint,
        iconColor: colors.primary,
        textColor: colors.textPrimary,
      };
    case 'ready':
    default:
      return {
        icon: 'shield-check-outline',
        title: 'Watching',
        subtitle: 'Ready for your next drive',
        bgColor: colors.primaryTint,
        iconColor: colors.primary,
        textColor: colors.textPrimary,
      };
  }
};

// ──────────────────────────────────────────────────────
// Protection Status - compact icon strip
// ──────────────────────────────────────────────────────
const PROTECTION_ITEMS = [
  { icon: 'broom', label: 'Cleaning' },
  { icon: 'snowflake', label: 'Winter' },
  { icon: 'weather-snowy-heavy', label: 'Snow' },
  { icon: 'parking', label: 'Permits' },
  { icon: 'car-clock', label: 'Rush Hr' },
];

// ──────────────────────────────────────────────────────
// iOS Debug Overlay Types
// ──────────────────────────────────────────────────────
interface DebugTransition {
  time: string;
  activity: string;
  confidence: string;
  speed: number;
}

const MAX_DEBUG_LOG = 30;

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
  const [currentConfidence, setCurrentConfidence] = useState<string>('');
  const [isCarConnected, setIsCarConnected] = useState(false);
  const [savedCarName, setSavedCarName] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // iOS Debug Overlay state
  const [showDebug, setShowDebug] = useState(false);
  const [debugSpeed, setDebugSpeed] = useState<number>(0);
  const [debugAccuracy, setDebugAccuracy] = useState<number>(0);
  const [debugTransitions, setDebugTransitions] = useState<DebugTransition[]>([]);
  const [debugBgStatus, setDebugBgStatus] = useState<string>('');
  const debugTransitionsRef = useRef<DebugTransition[]>([]);

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
        const prevActivity = currentActivity;
        setCurrentActivity(activity.activity);
        setCurrentConfidence(activity.confidence);

        // Log transitions for debug overlay
        if (activity.activity !== prevActivity && showDebug) {
          const now = new Date();
          const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
          const entry: DebugTransition = {
            time: timeStr,
            activity: `${prevActivity} -> ${activity.activity}`,
            confidence: activity.confidence,
            speed: debugSpeed,
          };
          const updated = [entry, ...debugTransitionsRef.current].slice(0, MAX_DEBUG_LOG);
          debugTransitionsRef.current = updated;
          setDebugTransitions(updated);
        }
      }
    };

    updateActivity();
    const interval = setInterval(updateActivity, 5000); // Poll every 5s for debug
    return () => clearInterval(interval);
  }, [isMonitoring, showDebug]);

  // iOS debug: subscribe to real-time location updates for speed/accuracy
  useEffect(() => {
    if (Platform.OS !== 'ios' || !showDebug) return;

    const removeListener = BackgroundLocationService.addLocationListener((event: LocationUpdateEvent) => {
      setDebugSpeed(event.speed >= 0 ? event.speed : 0);
      setDebugAccuracy(event.accuracy);
    });

    // Also poll background location status
    const statusInterval = setInterval(async () => {
      try {
        const status = await BackgroundLocationService.getStatus();
        const parts = [];
        parts.push(status.isMonitoring ? 'MON:ON' : 'MON:OFF');
        parts.push(status.isDriving ? 'DRV:YES' : 'DRV:NO');
        parts.push(status.hasAlwaysPermission ? 'PERM:ALWAYS' : 'PERM:NO');
        parts.push(status.motionAvailable ? 'CM:YES' : 'CM:NO');
        if (status.drivingDurationSec) {
          parts.push(`DUR:${status.drivingDurationSec}s`);
        }
        setDebugBgStatus(parts.join(' | '));
      } catch (e) {
        // ignore
      }
    }, 3000);

    return () => {
      removeListener();
      clearInterval(statusInterval);
    };
  }, [showDebug]);

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

  // Speed helper for debug (m/s to mph)
  const speedMph = (ms: number) => (ms * 2.237).toFixed(0);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      {isOffline && (
        <View style={styles.offlineBanner}>
          <MaterialCommunityIcons name="wifi-off" size={14} color={colors.textPrimary} />
          <Text style={styles.offlineBannerText}> No internet</Text>
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
          <View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.title}>Autopilot</Text>
          </View>
          {/* iOS Debug toggle - triple-tap the title area */}
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              onPress={() => setShowDebug(!showDebug)}
              style={styles.debugToggle}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons
                name="bug-outline"
                size={18}
                color={showDebug ? colors.primary : colors.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* ──── iOS Debug Overlay ──── */}
        {Platform.OS === 'ios' && showDebug && (
          <View style={styles.debugPanel}>
            <View style={styles.debugHeader}>
              <Text style={styles.debugTitle}>iOS Motion Debug</Text>
              <TouchableOpacity onPress={() => {
                debugTransitionsRef.current = [];
                setDebugTransitions([]);
              }}>
                <Text style={styles.debugClear}>Clear</Text>
              </TouchableOpacity>
            </View>

            {/* Current state */}
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>Activity</Text>
              <Text style={[
                styles.debugValue,
                currentActivity === 'automotive' && { color: colors.primary },
                currentActivity === 'stationary' && { color: colors.success },
              ]}>
                {currentActivity.toUpperCase()}
              </Text>
            </View>
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>Confidence</Text>
              <Text style={styles.debugValue}>{currentConfidence || '---'}</Text>
            </View>
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>Speed</Text>
              <Text style={styles.debugValue}>
                {debugSpeed > 0 ? `${speedMph(debugSpeed)} mph (${debugSpeed.toFixed(1)} m/s)` : '0 mph'}
              </Text>
            </View>
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>GPS Acc</Text>
              <Text style={styles.debugValue}>{debugAccuracy > 0 ? `${debugAccuracy.toFixed(0)}m` : '---'}</Text>
            </View>
            <View style={styles.debugRow}>
              <Text style={styles.debugLabel}>Hero</Text>
              <Text style={styles.debugValue}>{heroState}</Text>
            </View>

            {/* Background status */}
            {debugBgStatus ? (
              <Text style={styles.debugBgStatus}>{debugBgStatus}</Text>
            ) : null}

            {/* Transition log */}
            {debugTransitions.length > 0 && (
              <View style={styles.debugLogSection}>
                <Text style={styles.debugLogTitle}>Transitions:</Text>
                {debugTransitions.map((t, i) => (
                  <Text key={i} style={styles.debugLogEntry}>
                    {t.time} {t.activity} [{t.confidence}] {speedMph(t.speed)}mph
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ──── Hero Card ──── */}
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
          accessibilityLabel={`${heroConfig.title}. ${heroConfig.subtitle}`}
        >
          <View style={styles.heroContent}>
            <View style={[
              styles.heroIconCircle,
              { backgroundColor: heroState === 'ready' || heroState === 'paused'
                ? 'rgba(0,102,255,0.1)'
                : 'rgba(255,255,255,0.2)' },
            ]}>
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
                size={20}
                color={heroConfig.textColor}
                style={{ opacity: 0.7 }}
              />
            )}
          </View>

          {/* Expanded details */}
          {showDetails && lastParkingCheck && (
            <View style={styles.heroExpanded}>
              <View style={styles.heroDivider} />
              {lastParkingCheck.rules.length > 0 ? (
                lastParkingCheck.rules.map((rule, index) => (
                  <View key={index} style={styles.heroRuleRow}>
                    <MaterialCommunityIcons name="alert" size={14} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.heroRuleText}>{rule.message || rule.type}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.heroExpandedText}>No restrictions. Park with peace of mind.</Text>
              )}
              <View style={styles.heroActions}>
                <TouchableOpacity
                  style={styles.heroActionButton}
                  onPress={() => getDirections(lastParkingCheck.coords)}
                >
                  <MaterialCommunityIcons name="navigation-variant" size={14} color={colors.white} />
                  <Text style={styles.heroActionText}>Directions</Text>
                </TouchableOpacity>
                <Text style={styles.heroTimestamp}>
                  {formatTimeSince(lastParkingCheck.timestamp)}
                </Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* ──── Paused: Resume button ──── */}
        {!isMonitoring && (
          <Button
            title="Resume"
            variant="primary"
            size="md"
            onPress={resumeMonitoring}
            icon={<MaterialCommunityIcons name="play-circle-outline" size={20} color={colors.white} />}
            style={styles.resumeButton}
          />
        )}

        {/* ──── Check Parking Button ──── */}
        <Button
          title={isGettingLocation ? 'Getting GPS...' : loading ? 'Checking...' : 'Check My Parking'}
          onPress={checkCurrentLocation}
          loading={loading}
          size="lg"
          style={styles.mainButton}
          icon={!loading ? <MaterialCommunityIcons name="crosshairs-gps" size={20} color={colors.white} /> : undefined}
        />

        {/* GPS Accuracy - inline after check */}
        {locationAccuracy !== undefined && (
          <View style={styles.accuracyContainer}>
            <View style={[
              styles.accuracyDot,
              { backgroundColor: LocationService.getAccuracyDescription(locationAccuracy).color }
            ]} />
            <Text style={styles.accuracyText}>
              {LocationService.getAccuracyDescription(locationAccuracy).label} ({locationAccuracy.toFixed(0)}m)
            </Text>
          </View>
        )}

        {/* ──── Status Row: BT + Pause (grouped) ──── */}
        {isMonitoring && (
          <View style={styles.statusCard}>
            {/* Android: BT connection status */}
            {Platform.OS === 'android' && (
              <TouchableOpacity
                style={styles.statusRow}
                onPress={!savedCarName ? () => navigation.navigate('BluetoothSettings') : undefined}
                activeOpacity={!savedCarName ? 0.7 : 1}
              >
                <MaterialCommunityIcons
                  name={isCarConnected ? 'bluetooth-connect' : savedCarName ? 'bluetooth-off' : 'bluetooth'}
                  size={22}
                  color={isCarConnected ? colors.success : colors.textTertiary}
                />
                <Text style={styles.statusRowText}>
                  {savedCarName
                    ? isCarConnected
                      ? `Connected to ${savedCarName}`
                      : `Waiting for ${savedCarName}`
                    : 'Pair your car'}
                </Text>
                {!savedCarName && (
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
                )}
              </TouchableOpacity>
            )}

            {/* iOS: motion activity */}
            {Platform.OS === 'ios' && (
              <View style={styles.statusRow}>
                <MaterialCommunityIcons
                  name={currentActivity === 'automotive' ? 'car' : 'walk'}
                  size={22}
                  color={currentActivity === 'automotive' ? colors.primary : colors.textTertiary}
                />
                <Text style={styles.statusRowText}>
                  {currentActivity === 'automotive' ? 'Driving detected' :
                   currentActivity === 'walking' ? 'Walking' :
                   currentActivity === 'stationary' ? 'Stationary' : 'Monitoring'}
                </Text>
              </View>
            )}

            {/* Divider */}
            <View style={styles.statusDivider} />

            {/* Pause button */}
            <TouchableOpacity
              style={styles.statusRow}
              onPress={stopMonitoring}
              accessibilityLabel="Pause parking detection"
            >
              <MaterialCommunityIcons name="pause-circle-outline" size={22} color={colors.textTertiary} />
              <Text style={styles.statusRowText}>Pause detection</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ──── Android: Pair car prompt (only if not paired AND not monitoring) ──── */}
        {Platform.OS === 'android' && !savedCarName && !isMonitoring && (
          <TouchableOpacity
            style={styles.setupBanner}
            onPress={() => navigation.navigate('BluetoothSettings')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="bluetooth" size={22} color={colors.primary} />
            <Text style={styles.setupBannerText}>Pair your car for auto-detection</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        )}

        {/* ──── Protection Coverage - compact horizontal strip ──── */}
        <View style={styles.protectionCard}>
          <Text style={styles.protectionTitle}>We check for</Text>
          <View style={styles.protectionStrip}>
            {PROTECTION_ITEMS.map((item, index) => (
              <View key={index} style={styles.protectionChip}>
                <MaterialCommunityIcons
                  name={item.icon}
                  size={16}
                  color={colors.success}
                />
                <Text style={styles.protectionChipText}>{item.label}</Text>
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
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineBannerText: {
    color: colors.textPrimary,
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
  },
  scrollView: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  greeting: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  title: {
    fontSize: typography.sizes.xxxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  debugToggle: {
    padding: spacing.sm,
    marginTop: spacing.xs,
  },

  // ──── Debug Panel ────
  debugPanel: {
    backgroundColor: '#1a1a2e',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  debugTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.bold,
    color: '#00ff88',
  },
  debugClear: {
    fontSize: typography.sizes.xs,
    color: '#ff6b6b',
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  debugLabel: {
    fontSize: typography.sizes.xs,
    color: '#888',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  debugValue: {
    fontSize: typography.sizes.xs,
    color: '#fff',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: typography.weights.bold,
  },
  debugBgStatus: {
    fontSize: 9,
    color: '#666',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  debugLogSection: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: spacing.xs,
  },
  debugLogTitle: {
    fontSize: typography.sizes.xs,
    color: '#888',
    marginBottom: 2,
  },
  debugLogEntry: {
    fontSize: 9,
    color: '#aaa',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 14,
  },

  // ──── Hero Card ────
  heroCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
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
    fontSize: typography.sizes.base,
    lineHeight: typography.sizes.base * typography.lineHeights.relaxed,
  },
  heroExpanded: {
    marginTop: spacing.md,
  },
  heroDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: spacing.sm,
  },
  heroRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
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
    marginTop: spacing.xs,
  },
  heroActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  heroActionText: {
    color: colors.white,
    fontSize: typography.sizes.xs,
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
    marginBottom: spacing.lg,
  },

  // Main button
  mainButton: {
    marginBottom: spacing.md,
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

  // ──── Status Card (BT + Pause grouped) ────
  statusCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    ...shadows.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
  },
  statusRowText: {
    flex: 1,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    marginLeft: spacing.md,
  },
  statusDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },

  // ──── Setup Banner (BT pair when not monitoring) ────
  setupBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  setupBannerText: {
    flex: 1,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    marginLeft: spacing.md,
  },

  // ──── Protection Coverage ────
  protectionCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
    ...shadows.sm,
  },
  protectionTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
    marginBottom: spacing.md,
  },
  protectionStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  protectionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    gap: 6,
  },
  protectionChipText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.weights.medium,
  },
});

export default HomeScreen;
