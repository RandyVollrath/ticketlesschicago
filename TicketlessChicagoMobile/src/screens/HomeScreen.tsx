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
  NativeModules,
  Share,
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

// Native module for querying BT connection state directly from foreground service
const BluetoothMonitorModule = Platform.OS === 'android' ? NativeModules.BluetoothMonitorModule : null;

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
  { icon: 'traffic-light', label: 'Red Light' },
  { icon: 'speedometer', label: 'Speed' },
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

const QUICK_START_DISMISSED_KEY = 'quickStartDismissed';
const BATTERY_WARNING_DISMISSED_KEY = 'batteryWarningDismissed';

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
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [checkingAddress, setCheckingAddress] = useState<string | null>(null);
  const [showBatteryWarning, setShowBatteryWarning] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

  // Guard against double-tap on parking check
  const isCheckingRef = useRef(false);

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

  // Check BT connection status from all available sources
  const refreshBtStatus = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const savedDevice = await BluetoothService.getSavedCarDevice();
      if (!savedDevice) {
        setSavedCarName(null);
        setIsCarConnected(false);
        return;
      }
      setSavedCarName(savedDevice.name);

      // Check multiple sources — any one being true means connected:
      // 1. BluetoothService JS-side state (set by event listeners)
      let connected = BluetoothService.isConnectedToCar();

      // 2. Query OS-level connected devices directly
      if (!connected) {
        connected = await BluetoothService.isConnectedToSavedCar();
      }

      // 3. Query the native foreground service state (most reliable)
      if (!connected && BluetoothMonitorModule) {
        try {
          connected = await BluetoothMonitorModule.isCarConnected();
        } catch (e) {
          // Module may not be ready yet
        }
      }

      setIsCarConnected(connected);
    } catch (error) {
      log.debug('Error checking Bluetooth status', error);
    }
  }, []);

  // Load saved car name; subscribe to BT events on Android
  useEffect(() => {
    refreshBtStatus();

    if (Platform.OS === 'android') {
      const onConnect = () => setIsCarConnected(true);
      const onDisconnect = () => setIsCarConnected(false);
      BluetoothService.addConnectionListener(onConnect, onDisconnect);

      // Re-check after a delay to catch late-initializing native service
      const recheckTimer = setTimeout(refreshBtStatus, 3000);

      return () => {
        BluetoothService.removeConnectionListener(onConnect, onDisconnect);
        clearTimeout(recheckTimer);
      };
    }
  }, [isMonitoring, refreshBtStatus]);

  // Reload data when returning from other screens (or from Settings app)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      loadLastCheck();
      refreshBtStatus();
      // Re-check location permission (user may have just enabled it in Settings)
      if (locationDenied) {
        const hasPermission = await LocationService.requestLocationPermission(true);
        if (hasPermission) {
          setLocationDenied(false);
          if (!isMonitoring) {
            autoStartMonitoring();
          }
        }
      }
    });
    return unsubscribe;
  }, [navigation, refreshBtStatus, locationDenied, isMonitoring]);

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
    const interval = setInterval(updateActivity, 15000); // Poll every 15s — cosmetic only, native module handles real detection
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

  const loadInitialData = async () => {
    await loadLastCheck();

    // Show Quick Start card if not previously dismissed
    try {
      const dismissed = await AsyncStorage.getItem(QUICK_START_DISMISSED_KEY);
      if (!dismissed) {
        setShowQuickStart(true);
      }
    } catch (e) {
      // Non-critical
    }

    // Android: check battery optimization status
    // Always check actual exemption — show banner if not exempt, regardless of prior dismissal
    if (Platform.OS === 'android' && BluetoothMonitorModule) {
      try {
        const exempt = await BluetoothMonitorModule.isBatteryOptimizationExempt();
        if (!exempt) {
          setShowBatteryWarning(true);
        }
      } catch (e) {
        // Non-critical - module may not support this method
      }
    }
  };

  const dismissQuickStart = useCallback(async () => {
    setShowQuickStart(false);
    try {
      await AsyncStorage.setItem(QUICK_START_DISMISSED_KEY, 'true');
    } catch (e) {
      // Non-critical
    }
  }, []);

  const dismissBatteryWarning = useCallback(() => {
    // Only dismiss for current session — will re-appear on next launch
    // if exemption still hasn't been granted
    setShowBatteryWarning(false);
  }, []);

  const autoStartMonitoring = async () => {
    // Small delay to let the UI render first, but properly await everything
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const hasLocationPermission = await LocationService.requestLocationPermission(true);
      if (!hasLocationPermission) {
        log.warn('Location permission not granted, monitoring not auto-started');
        setLocationDenied(true);
        return;
      }
      setLocationDenied(false);

      await BackgroundTaskService.initialize();
      log.info('BackgroundTaskService initialized, starting monitoring...');
      const started = await BackgroundTaskService.startMonitoring(handleCarDisconnect, handleCarReconnect);
      if (started) {
        setIsMonitoring(true);
        log.info('Monitoring auto-started successfully');
      } else {
        log.warn('Monitoring returned false - may not be active');
      }
    } catch (error) {
      log.error('Error auto-starting monitoring:', error);
    }
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
    // Small delay to ensure AsyncStorage write from BackgroundTaskService completes
    await new Promise(resolve => setTimeout(resolve, 300));
    await loadLastCheck();
  };

  const handleCarReconnect = () => {
    log.info('Driving started - clearing stale parking result');
    // Clear the parking result so user sees a clean "monitoring" state
    // while driving. BackgroundTaskService.markCarReconnected() already
    // cleared AsyncStorage; we also clear React state so the UI updates.
    setLastParkingCheck(null);
    setIsCarConnected(true);
  };

  const stopMonitoring = async () => {
    await BackgroundTaskService.stopMonitoring();
    setIsMonitoring(false);
  };

  const resumeMonitoring = async () => {
    await autoStartMonitoring();
  };

  const performParkingCheck = useCallback(async (showAllClearAlert: boolean = true, useHighAccuracy: boolean = true) => {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;

    setLoading(true);
    setIsGettingLocation(true);
    setLocationAccuracy(undefined);
    setCheckingAddress(null);

    // Overall timeout — show a helpful message if the whole check takes too long
    const OVERALL_TIMEOUT_MS = 30000;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      setLoading(false);
      setIsGettingLocation(false);
      setCheckingAddress(null);
      isCheckingRef.current = false;
      Alert.alert(
        'Check Timed Out',
        'GPS or network is too slow right now. Try moving to an open area with better signal, then try again.',
      );
    }, OVERALL_TIMEOUT_MS);

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

      if (timedOut) return;

      let coords: Coordinates | undefined;

      // iOS: Try to use the car's parking location from native module first.
      // The native module captures GPS at the moment the car stops, BEFORE
      // the user walks away. This gives much more accurate parking check results.
      if (Platform.OS === 'ios') {
        try {
          const parkingLoc = await BackgroundLocationService.getLastDrivingLocation();
          if (parkingLoc && parkingLoc.latitude && parkingLoc.longitude) {
            // Only use if reasonably recent (within last 2 hours)
            const ageMs = Date.now() - parkingLoc.timestamp;
            if (ageMs < 2 * 60 * 60 * 1000) {
              coords = {
                latitude: parkingLoc.latitude,
                longitude: parkingLoc.longitude,
                accuracy: parkingLoc.accuracy,
              };
              log.info(`Using car's parking location: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} ±${coords.accuracy?.toFixed(0)}m (${Math.round(ageMs / 60000)}min old)`);
            }
          }
        } catch (e) {
          log.debug('Could not get parking location from native module', e);
        }
      }

      // Fallback: get user's current GPS location
      if (!coords) {
        if (useHighAccuracy) {
          coords = await LocationService.getHighAccuracyLocation(20, 15000);
        } else {
          coords = await LocationService.getCurrentLocation('high');
        }
      }

      if (timedOut) return;

      setLocationAccuracy(coords.accuracy);
      setIsGettingLocation(false);
      setCheckingAddress('Scanning restrictions...');

      const result = await LocationService.checkParkingLocation(coords);
      if (timedOut) return;

      setCheckingAddress(result.address);
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
      if (timedOut) return;
      log.error('Error checking location', error);
      Alert.alert('Error', 'Failed to check parking location. Please try again.');
    } finally {
      clearTimeout(timeoutId);
      if (!timedOut) {
        setLoading(false);
        setIsGettingLocation(false);
        setCheckingAddress(null);
        isCheckingRef.current = false;
      }
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

  const shareParkingResult = useCallback(async () => {
    if (!lastParkingCheck) return;
    const { address, rules, coords } = lastParkingCheck;
    const status = rules.length > 0
      ? `${rules.length} parking restriction${rules.length > 1 ? 's' : ''} found`
      : 'No parking restrictions';
    const ruleList = rules.length > 0
      ? '\n' + rules.map(r => `• ${r.message || r.type}`).join('\n')
      : '';
    const mapUrl = `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
    const message = `${status} at ${address}${ruleList}\n\n${mapUrl}\n\nChecked with Ticketless Chicago`;

    try {
      await Share.share({ message });
    } catch (error) {
      log.debug('Share cancelled or failed', error);
    }
  }, [lastParkingCheck]);

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
  const isDriving = (() => {
    if (Platform.OS === 'ios') return currentActivity === 'automotive';
    if (Platform.OS === 'android') return isCarConnected;
    return false;
  })();

  const getHeroState = (): HeroState => {
    if (loading) return 'checking';
    if (!isMonitoring) return 'paused';

    // Always show last parking result if we have one — this is what the user
    // cares about most. Driving status is shown separately in the status row.
    if (lastParkingCheck) {
      return lastParkingCheck.rules.length > 0 ? 'violation' : 'clear';
    }

    // No parking result yet — show driving or ready
    if (isDriving) return 'driving';
    return 'ready';
  };

  const heroState = getHeroState();
  const heroAddress = lastParkingCheck
    ? `${lastParkingCheck.address} · ${formatTimeSince(lastParkingCheck.timestamp)}`
    : undefined;
  const heroConfig = getHeroConfig(
    heroState,
    lastParkingCheck?.rules.length || 0,
    heroAddress,
  );

  // Speed helper for debug (m/s to mph)
  const speedMph = (ms: number) => (ms * 2.237).toFixed(0);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      {isOffline && (
        <View style={styles.offlineBanner} accessibilityRole="alert" accessibilityLabel="No internet connection. Camera alerts still work offline.">
          <MaterialCommunityIcons name="wifi-off" size={14} color={colors.textPrimary} />
          <Text style={styles.offlineBannerText}> No internet — camera alerts still work offline</Text>
        </View>
      )}
      {showBatteryWarning && Platform.OS === 'android' && (
        <View style={styles.batteryBanner}>
          <View style={styles.batteryBannerContent}>
            <MaterialCommunityIcons name="battery-alert-variant-outline" size={18} color={colors.warning} />
            <View style={styles.batteryBannerTextWrap}>
              <Text style={styles.batteryBannerTitle}>Background detection may be restricted</Text>
              <Text style={styles.batteryBannerBody}>
                Your phone may kill the app in the background. Tap to fix.
              </Text>
            </View>
            <TouchableOpacity
              onPress={dismissBatteryWarning}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Dismiss battery warning"
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="close" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
          <View style={styles.batteryBannerActions}>
            <TouchableOpacity
              style={styles.batteryBannerBtn}
              onPress={async () => {
                try {
                  if (BluetoothMonitorModule) {
                    await BluetoothMonitorModule.requestBatteryOptimizationExemption();
                    // System dialog overlays the app (no AppState change),
                    // so poll every second until exemption is granted or timeout
                    let checks = 0;
                    const pollInterval = setInterval(async () => {
                      checks++;
                      try {
                        const exempt = await BluetoothMonitorModule.isBatteryOptimizationExempt();
                        if (exempt) {
                          clearInterval(pollInterval);
                          setShowBatteryWarning(false);
                          await AsyncStorage.setItem(BATTERY_WARNING_DISMISSED_KEY, 'true');
                        }
                      } catch (_) {}
                      if (checks >= 15) clearInterval(pollInterval); // Stop after 15s
                    }, 1000);
                  }
                } catch (e) {
                  log.debug('Battery exemption request failed', e);
                }
              }}
              accessibilityLabel="Disable battery optimization"
              accessibilityRole="button"
              accessibilityHint="Prevents your phone from killing background parking detection"
            >
              <Text style={styles.batteryBannerBtnText}>Disable Optimization</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.batteryBannerBtnSecondary}
              onPress={() => Linking.openURL('https://dontkillmyapp.com')}
              accessibilityLabel="Device guide"
              accessibilityRole="link"
              accessibilityHint="Opens dontkillmyapp.com with device-specific instructions"
            >
              <Text style={styles.batteryBannerBtnSecondaryText}>Device Guide</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {locationDenied && (
        <View style={styles.permissionBanner} accessibilityRole="alert">
          <View style={styles.permissionBannerContent}>
            <MaterialCommunityIcons name="map-marker-off" size={18} color={colors.error} />
            <View style={styles.permissionBannerTextWrap}>
              <Text style={styles.permissionBannerTitle}>Location access required</Text>
              <Text style={styles.permissionBannerBody}>
                {Platform.OS === 'ios'
                  ? 'Set location to "Always" so we can check parking rules when you park and send advance tow warnings.'
                  : 'Allow location "All the time" so we can auto-check parking when your car\'s Bluetooth disconnects.'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.permissionBannerBtn}
            onPress={() => Linking.openSettings()}
            accessibilityLabel="Open device settings"
            accessibilityRole="button"
            accessibilityHint="Opens system settings to grant location permission"
          >
            <Text style={styles.permissionBannerBtnText}>Open Settings</Text>
          </TouchableOpacity>
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
          accessibilityRole={heroState === 'clear' || heroState === 'violation' ? 'button' : 'summary'}
          accessibilityHint={heroState === 'clear' || heroState === 'violation' ? 'Double tap to toggle details' : undefined}
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

          {/* Parking timer — show elapsed time since parking check */}
          {lastParkingCheck && (heroState === 'clear' || heroState === 'violation') && (
            <View style={styles.heroTimerRow}>
              <View style={styles.heroTimerBadge}>
                <MaterialCommunityIcons name="timer-outline" size={12} color={heroConfig.textColor} />
                <Text style={[styles.heroTimerText, { color: heroConfig.textColor }]}>
                  Parked {formatTimeSince(lastParkingCheck.timestamp)}
                </Text>
              </View>
              {isDriving && (
                <View style={styles.drivingBadge}>
                  <MaterialCommunityIcons name="car" size={12} color={colors.white} />
                  <Text style={styles.drivingBadgeText}>Driving</Text>
                </View>
              )}
            </View>
          )}

          {/* Stale result warning — restrictions may have changed */}
          {lastParkingCheck && (heroState === 'clear' || heroState === 'violation') &&
           (currentTime.getTime() - lastParkingCheck.timestamp > 2 * 60 * 60 * 1000) && (
            <TouchableOpacity
              style={styles.staleWarning}
              onPress={checkCurrentLocation}
              activeOpacity={0.7}
              accessibilityLabel="Result may be outdated. Tap to re-check parking restrictions."
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="refresh" size={12} color={colors.warning} />
              <Text style={styles.staleWarningText}>
                Result may be outdated — tap to re-check
              </Text>
            </TouchableOpacity>
          )}

          {/* Driving overlay badge — show only when no parking result */}
          {isDriving && heroState !== 'clear' && heroState !== 'violation' && (
            <View style={[styles.drivingBadge, { marginTop: spacing.sm }]}>
              <MaterialCommunityIcons name="car" size={12} color={colors.white} />
              <Text style={styles.drivingBadgeText}>Driving</Text>
            </View>
          )}

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
                  accessibilityLabel="Get directions to parked car"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons name="navigation-variant" size={14} color={colors.white} />
                  <Text style={styles.heroActionText}>Directions</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.heroActionButton}
                  onPress={shareParkingResult}
                  accessibilityLabel="Share parking result"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons name="share-variant" size={14} color={colors.white} />
                  <Text style={styles.heroActionText}>Share</Text>
                </TouchableOpacity>
                <Text style={styles.heroTimestamp}>
                  {formatTimeSince(lastParkingCheck.timestamp)}
                </Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* ──── Quick Start Tips ──── */}
        {showQuickStart && (
          <View style={styles.quickStartCard}>
            <View style={styles.quickStartHeader}>
              <MaterialCommunityIcons name="rocket-launch-outline" size={20} color={colors.primary} />
              <Text style={styles.quickStartTitle}>Quick Start</Text>
              <TouchableOpacity
                onPress={dismissQuickStart}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Dismiss quick start tips"
              >
                <MaterialCommunityIcons name="close" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
            {Platform.OS === 'android' && !savedCarName && (
              <TouchableOpacity
                style={styles.quickStartItem}
                onPress={() => navigation.navigate('BluetoothSettings')}
                accessibilityLabel="Pair your car's Bluetooth for auto-detection"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons name="bluetooth-connect" size={16} color={colors.warning} />
                <Text style={styles.quickStartItemText}>Pair your car's Bluetooth for auto-detection</Text>
                <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
            {Platform.OS === 'ios' && (
              <View style={styles.quickStartItem}>
                <MaterialCommunityIcons name="map-marker-check" size={16} color={colors.success} />
                <Text style={styles.quickStartItemText}>Allow "Always" location for background parking detection</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.quickStartItem}
              onPress={() => navigation.navigate('Settings')}
              accessibilityLabel="Enable Camera Alerts in Settings for speed and red light warnings"
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="camera" size={16} color={colors.info} />
              <Text style={styles.quickStartItemText}>Enable Camera Alerts in Settings for speed/red light warnings</Text>
              <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            <View style={styles.quickStartItem}>
              <MaterialCommunityIcons name="parking" size={16} color={colors.primary} />
              <Text style={styles.quickStartItemText}>Set your home permit zone in Settings to avoid false alerts</Text>
            </View>
            <TouchableOpacity
              style={styles.quickStartDismiss}
              onPress={dismissQuickStart}
              accessibilityLabel="Got it, dismiss quick start tips"
              accessibilityRole="button"
            >
              <Text style={styles.quickStartDismissText}>Got it</Text>
            </TouchableOpacity>
          </View>
        )}

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

        {/* Check progress / address display */}
        {loading && checkingAddress && (
          <View style={styles.checkingProgress}>
            <MaterialCommunityIcons name="map-marker" size={14} color={colors.primary} />
            <Text style={styles.checkingProgressText} numberOfLines={1}>{checkingAddress}</Text>
          </View>
        )}
        {loading && isGettingLocation && !checkingAddress && (
          <View style={styles.checkingProgress}>
            <MaterialCommunityIcons name="crosshairs-gps" size={14} color={colors.textTertiary} />
            <Text style={styles.checkingProgressText}>Acquiring GPS signal...</Text>
          </View>
        )}

        {/* GPS Accuracy - inline after check */}
        {locationAccuracy !== undefined && !loading && (
          <View style={styles.accuracyContainer}>
            <View style={[
              styles.accuracyDot,
              { backgroundColor: LocationService.getAccuracyDescription(locationAccuracy).color }
            ]} />
            <Text style={styles.accuracyText}>
              {LocationService.getAccuracyDescription(locationAccuracy).label} ({locationAccuracy.toFixed(0)}m)
            </Text>
            {locationAccuracy > 50 && (
              <Text style={styles.accuracyHint}> — try moving outdoors</Text>
            )}
          </View>
        )}

        {/* ──── Android: BT status or pair prompt ──── */}
        {Platform.OS === 'android' && (
          <TouchableOpacity
            style={styles.statusCard}
            onPress={!savedCarName ? () => navigation.navigate('BluetoothSettings') : undefined}
            activeOpacity={!savedCarName ? 0.7 : 1}
            accessibilityLabel={
              savedCarName
                ? isCarConnected
                  ? `Connected to ${savedCarName}`
                  : `Waiting for ${savedCarName}`
                : 'Pair your car for auto-detection'
            }
            accessibilityRole={!savedCarName ? 'button' : 'text'}
            accessibilityHint={!savedCarName ? 'Opens Bluetooth pairing screen' : undefined}
          >
            <MaterialCommunityIcons
              name={isCarConnected ? 'bluetooth-connect' : savedCarName ? 'bluetooth-off' : 'bluetooth'}
              size={22}
              color={isCarConnected ? colors.success : savedCarName ? colors.textTertiary : colors.primary}
            />
            <Text style={styles.statusRowText}>
              {savedCarName
                ? isCarConnected
                  ? `Connected to ${savedCarName}`
                  : `Waiting for ${savedCarName}`
                : 'Pair your car for auto-detection'}
            </Text>
            {!savedCarName && (
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
            )}
          </TouchableOpacity>
        )}

        {/* ──── iOS: motion activity status ──── */}
        {Platform.OS === 'ios' && isMonitoring && (
          <View
            style={styles.statusCard}
            accessibilityLabel={`Motion status: ${
              currentActivity === 'automotive' ? 'Driving detected' :
              currentActivity === 'walking' ? 'Walking' :
              currentActivity === 'stationary' ? 'Stationary' : 'Monitoring'
            }`}
            accessibilityRole="text"
          >
            <MaterialCommunityIcons
              name={currentActivity === 'automotive' ? 'car' : currentActivity === 'walking' ? 'walk' : 'shield-check-outline'}
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

        {/* ──── Check Destination Parking ──── */}
        <TouchableOpacity
          style={styles.destinationCard}
          onPress={() => navigation.getParent()?.navigate('CheckDestination')}
          accessibilityLabel="Check destination parking"
          accessibilityRole="button"
          activeOpacity={0.7}
        >
          <View style={styles.destinationIcon}>
            <MaterialCommunityIcons name="map-search" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.destinationTitle}>Check Destination Parking</Text>
            <Text style={styles.destinationSubtitle}>See restrictions before you go</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* ──── Protection Coverage ──── */}
        <View style={styles.protectionCard}>
          <Text style={styles.protectionTitle}>We check for</Text>
          <View style={styles.protectionStrip}>
            {PROTECTION_ITEMS.map((item, index) => (
              <View key={index} style={styles.protectionChip} accessibilityLabel={`${item.label} checked`}>
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

        {/* ──── Pause (subtle, at the bottom) ──── */}
        {isMonitoring && (
          <TouchableOpacity
            style={styles.pauseLink}
            onPress={stopMonitoring}
            accessibilityLabel="Pause parking detection"
          >
            <Text style={styles.pauseLinkText}>Pause detection</Text>
          </TouchableOpacity>
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
    flex: 1,
  },

  // ──── Battery Warning Banner ────
  batteryBanner: {
    backgroundColor: '#FFF8E1',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: '#FFE082',
  },
  batteryBannerContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  batteryBannerTextWrap: {
    flex: 1,
  },
  batteryBannerTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  batteryBannerBody: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  batteryBannerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginLeft: 26, // aligned with text (icon width + gap)
  },
  batteryBannerBtn: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.sm,
  },
  batteryBannerBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    color: colors.white,
  },
  batteryBannerBtnSecondary: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  batteryBannerBtnSecondaryText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    color: colors.warning,
  },

  // ──── Permission Banner ────
  permissionBanner: {
    backgroundColor: '#FDE8E8',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: '#F5C6C6',
  },
  permissionBannerContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  permissionBannerTextWrap: {
    flex: 1,
  },
  permissionBannerTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  permissionBannerBody: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  permissionBannerBtn: {
    backgroundColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    marginLeft: 26,
  },
  permissionBannerBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    color: colors.white,
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
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.sm,
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
    marginLeft: 'auto',
  },
  staleWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,193,7,0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    marginTop: spacing.xs,
    gap: 4,
  },
  staleWarningText: {
    fontSize: typography.sizes.xs,
    color: colors.warning,
    fontWeight: typography.weights.medium,
  },
  heroTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  heroTimerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  heroTimerText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    opacity: 0.85,
  },
  drivingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  drivingBadgeText: {
    fontSize: typography.sizes.xs,
    color: colors.white,
    fontWeight: typography.weights.semibold,
  },

  // ──── Quick Start Tips ────
  quickStartCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    ...shadows.sm,
  },
  quickStartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  quickStartTitle: {
    flex: 1,
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  quickStartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  quickStartItemText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  quickStartDismiss: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  quickStartDismissText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.primary,
  },

  // Resume button
  resumeButton: {
    marginBottom: spacing.lg,
  },

  // Main button
  mainButton: {
    marginBottom: spacing.md,
  },

  // Checking progress
  checkingProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  checkingProgressText: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontWeight: typography.weights.medium,
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
  accuracyHint: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },

  // ──── Status Card (single row) ────
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  statusRowText: {
    flex: 1,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    marginLeft: spacing.md,
  },

  // ──── Check Destination ────
  destinationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xl,
    padding: spacing.base,
    marginBottom: spacing.base,
    ...shadows.sm,
  },
  destinationIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  destinationTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  destinationSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 1,
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

  // ──── Pause link (subtle, bottom of page) ────
  pauseLink: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  pauseLinkText: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
  },
});

export default HomeScreen;
