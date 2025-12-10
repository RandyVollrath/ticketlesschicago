import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, useNavigation, RouteProp, NavigationProp } from '@react-navigation/native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { Button, Card, RuleCard } from '../components';
import LocationService, { Coordinates, ParkingCheckResult } from '../services/LocationService';
import NetworkStatus from '../utils/NetworkStatus';
import Logger from '../utils/Logger';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('MapScreen');

// Route params type for notification deep linking
type MapScreenRouteParams = {
  Map: {
    lat?: number;
    lng?: number;
    fromNotification?: boolean;
  };
};

const MapScreen: React.FC = () => {
  const route = useRoute<RouteProp<MapScreenRouteParams, 'Map'>>();
  const navigation = useNavigation<NavigationProp<MapScreenRouteParams>>();
  const [lastLocation, setLastLocation] = useState<ParkingCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);

  // Refs to prevent memory leaks and race conditions
  const isMountedRef = useRef(true);
  const notificationProcessedRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Subscribe to network status
  useEffect(() => {
    const unsubscribe = NetworkStatus.addListener((isConnected) => {
      if (isMountedRef.current) {
        setIsOffline(!isConnected);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    loadLastLocation();
    getCurrentLocationSilent();
  }, []);

  // Handle navigation from notification with specific coordinates
  // Uses ref to prevent re-processing if component re-renders
  useEffect(() => {
    const checkNotificationLocation = async () => {
      // Extract params immediately before any async operations
      const lat = route.params?.lat;
      const lng = route.params?.lng;
      const fromNotification = route.params?.fromNotification;

      // Skip if already processed or missing required params
      if (!fromNotification || notificationProcessedRef.current || !lat || !lng) {
        return;
      }

      // Mark as processed immediately
      notificationProcessedRef.current = true;

      // Clear the params to prevent re-triggering
      navigation.setParams({ lat: undefined, lng: undefined, fromNotification: undefined });

      // Check parking at the notification's coordinates
      if (isMountedRef.current) setLoading(true);

      try {
        const coords: Coordinates = {
          latitude: lat,
          longitude: lng,
        };
        const result = await LocationService.checkParkingLocation(coords);
        await LocationService.saveParkingCheckResult(result);

        if (isMountedRef.current) {
          setLastLocation(result);
        }
      } catch (error) {
        log.error('Error checking notification location', error);
        if (isMountedRef.current) {
          Alert.alert('Error', 'Failed to check parking at notification location');
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    checkNotificationLocation();
  }, [route.params?.fromNotification, route.params?.lat, route.params?.lng, navigation]);

  const loadLastLocation = async () => {
    try {
      const stored = await AsyncStorage.getItem(StorageKeys.LAST_PARKING_LOCATION);
      if (stored && isMountedRef.current) {
        try {
          const parsed = JSON.parse(stored);
          setLastLocation(parsed);
        } catch (parseError) {
          log.error('Corrupted location data, clearing', parseError);
          await AsyncStorage.removeItem(StorageKeys.LAST_PARKING_LOCATION);
        }
      }
    } catch (error) {
      log.error('Error loading last location', error);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const getCurrentLocationSilent = async () => {
    try {
      const hasPermission = await LocationService.requestLocationPermission();
      if (!isMountedRef.current) return;

      if (hasPermission) {
        const coords = await LocationService.getCurrentLocation();
        if (isMountedRef.current) {
          setCurrentLocation(coords);
        }
      } else {
        setLocationPermissionDenied(true);
      }
    } catch (error) {
      log.error('Error getting current location', error);
    }
  };

  const openInMaps = useCallback((coords: Coordinates) => {
    const scheme = Platform.select({
      ios: 'maps:0,0?q=',
      android: 'geo:0,0?q=',
    });
    const latLng = `${coords.latitude},${coords.longitude}`;
    const label = 'My Parked Car';
    const url = Platform.select({
      ios: `${scheme}${label}@${latLng}`,
      android: `${scheme}${latLng}(${label})`,
    });

    if (url) {
      Linking.openURL(url).catch(err => {
        log.error('Failed to open maps', err);
        Alert.alert('Error', 'Could not open maps application');
      });
    }
  }, []);

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

  const checkCurrentLocation = useCallback(async () => {
    if (!currentLocation) return;

    setLoading(true);
    try {
      const result = await LocationService.checkParkingLocation(currentLocation);
      await LocationService.saveParkingCheckResult(result);
      if (isMountedRef.current) {
        setLastLocation(result);
      }
    } catch (error) {
      log.error('Error checking location', error);
      if (isMountedRef.current) {
        Alert.alert('Error', 'Failed to check parking restrictions');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [currentLocation]);

  const formatCoords = (coords: Coordinates): string => {
    return `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours < 1) {
      return `${diffMinutes} minutes ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading parking location...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>No internet connection</Text>
        </View>
      )}
      <View style={styles.content}>
        <Text style={styles.title}>Your Parking</Text>

        {lastLocation ? (
          <>
            <Card title="Last Parked Location" subtitle={formatTime(lastLocation.timestamp)}>
              <View style={styles.addressContainer}>
                <Text style={styles.coordsIcon}>📍</Text>
                <View style={styles.addressInfo}>
                  <Text style={styles.addressText} numberOfLines={2}>
                    {lastLocation.address || formatCoords(lastLocation.coords)}
                  </Text>
                  {lastLocation.address && (
                    <Text style={styles.coordsSubtext}>
                      {formatCoords(lastLocation.coords)}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.buttonRow}>
                <Button
                  title="Open in Maps"
                  variant="secondary"
                  size="sm"
                  onPress={() => openInMaps(lastLocation.coords)}
                  style={styles.mapButton}
                />
                <Button
                  title="Get Directions"
                  variant="primary"
                  size="sm"
                  onPress={() => getDirections(lastLocation.coords)}
                  style={styles.mapButton}
                />
              </View>
            </Card>

            {lastLocation.rules.length > 0 ? (
              <Card title="Parking Restrictions">
                {lastLocation.rules.map((rule, index) => (
                  <RuleCard key={index} rule={rule} />
                ))}
              </Card>
            ) : (
              <Card>
                <View style={styles.allClear}>
                  <Text style={styles.allClearIcon}>✅</Text>
                  <Text style={styles.allClearText}>No parking restrictions at this location</Text>
                </View>
              </Card>
            )}

            {currentLocation ? (
              <Card title="Current Location">
                <View style={styles.coordsContainer}>
                  <Text style={styles.coordsIcon}>📱</Text>
                  <Text style={styles.coordsText}>
                    {formatCoords(currentLocation)}
                  </Text>
                </View>
                <Button
                  title="Check Restrictions Here"
                  variant="secondary"
                  onPress={checkCurrentLocation}
                  disabled={isOffline}
                />
              </Card>
            ) : locationPermissionDenied ? (
              <Card>
                <View style={styles.permissionDenied}>
                  <Text style={styles.permissionIcon}>📍</Text>
                  <Text style={styles.permissionTitle}>Location Unavailable</Text>
                  <Text style={styles.permissionText}>
                    Enable location access in Settings to check restrictions at your current location
                  </Text>
                </View>
              </Card>
            ) : null}
          </>
        ) : (
          <Card>
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🚗</Text>
              <Text style={styles.emptyTitle}>No Parking Location Saved</Text>
              <Text style={styles.emptyText}>
                Your last parking location will appear here when you disconnect
                from your car's Bluetooth or manually check a location.
              </Text>
              {currentLocation && (
                <Button
                  title="Save Current Location"
                  variant="primary"
                  onPress={checkCurrentLocation}
                  disabled={isOffline}
                  style={styles.saveButton}
                />
              )}
            </View>
          </Card>
        )}
      </View>
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
  content: {
    flex: 1,
    padding: spacing.base,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  addressInfo: {
    flex: 1,
  },
  addressText: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.medium,
    color: colors.textPrimary,
    lineHeight: typography.sizes.base * 1.4,
  },
  coordsSubtext: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: spacing.xs,
  },
  coordsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  coordsIcon: {
    fontSize: typography.sizes.lg,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  coordsText: {
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mapButton: {
    flex: 1,
  },
  allClear: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
  },
  allClearIcon: {
    fontSize: typography.sizes.lg,
    marginRight: spacing.sm,
  },
  allClearText: {
    fontSize: typography.sizes.base,
    color: colors.success,
    fontWeight: typography.weights.medium,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sizes.base * typography.lineHeights.relaxed,
  },
  saveButton: {
    marginTop: spacing.lg,
  },
  permissionDenied: {
    alignItems: 'center',
    padding: spacing.md,
  },
  permissionIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  permissionTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  permissionText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sizes.sm * typography.lineHeights.relaxed,
  },
});

export default MapScreen;
