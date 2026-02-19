import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  Platform,
  Linking,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import Config from '../config/config';
import ApiClient from '../utils/ApiClient';
import Logger from '../utils/Logger';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('CheckDestination');

// Restriction result types
interface RestrictionResult {
  streetCleaning?: {
    hasRestriction: boolean;
    message: string;
    severity: string;
    nextDate?: string;
    schedule?: string;
  };
  winterOvernightBan?: {
    active: boolean;
    message: string;
    severity: string;
  };
  twoInchSnowBan?: {
    active: boolean;
    message: string;
    severity: string;
  };
  permitZone?: {
    inPermitZone: boolean;
    message: string;
    zoneName?: string;
    severity: string;
  };
}

interface GeocodedResult {
  lat: number;
  lng: number;
  address: string;
  ward?: string;
  section?: string;
  permitZone?: string;
}

interface SavedDestination {
  id: string;
  label: string;
  address: string;
}

const SEVERITY_CONFIG: Record<string, { bg: string; border: string; icon: string; iconColor: string }> = {
  critical: { bg: colors.criticalBg, border: colors.critical, icon: 'alert-circle', iconColor: colors.critical },
  warning: { bg: colors.warningBg, border: colors.warning, icon: 'alert', iconColor: colors.warning },
  info: { bg: colors.infoBg, border: colors.info, icon: 'information', iconColor: colors.info },
  none: { bg: colors.successBg, border: colors.success, icon: 'check-circle', iconColor: colors.success },
};

export default function CheckDestinationScreen({ navigation, route }: any) {
  const isTab = route?.params?.isTab ?? !navigation.canGoBack();
  const [address, setAddress] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [geocoded, setGeocoded] = useState<GeocodedResult | null>(null);
  const [restrictions, setRestrictions] = useState<RestrictionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [mapTouched, setMapTouched] = useState(false);
  const [snowForecast, setSnowForecast] = useState<{
    hasSignificantSnow: boolean;
    significantSnowWhen: string | null;
  } | null>(null);
  const [savedDestinations, setSavedDestinations] = useState<SavedDestination[]>([]);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [pendingSaveAddress, setPendingSaveAddress] = useState<string | null>(null);
  const [pendingSaveLabel, setPendingSaveLabel] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const loadSaved = async () => {
      try {
        const raw = await AsyncStorage.getItem(StorageKeys.SAVED_DESTINATIONS);
        if (raw) setSavedDestinations(JSON.parse(raw));
      } catch (e) { log.debug('Failed to load saved destinations', e); }
    };
    loadSaved();
  }, []);

  const persistSavedDestinations = async (next: SavedDestination[]) => {
    setSavedDestinations(next);
    await AsyncStorage.setItem(StorageKeys.SAVED_DESTINATIONS, JSON.stringify(next.slice(0, 20)));
  };

  const handleCheck = useCallback(async (addressOverride?: string) => {
    const trimmed = (addressOverride ?? address).trim();
    if (!trimmed) return;

    Keyboard.dismiss();
    setIsChecking(true);
    setErrorMsg(null);
    setRestrictions(null);
    setGeocoded(null);
    setShowMap(false);
    setSnowForecast(null);

    try {
      // Run all 3 calls in parallel — find-section is the heavy one (geocode + PostGIS),
      // permit-zone and snow-forecast only need the address string / fixed coords.
      const [geoRes, permitRes, snowRes] = await Promise.all([
        ApiClient.get<any>(
          `/api/find-section?address=${encodeURIComponent(trimmed)}`,
          { timeout: 12000, showErrorAlert: false },
        ),
        ApiClient.get<any>(
          `/api/check-permit-zone?address=${encodeURIComponent(trimmed)}`,
          { timeout: 8000, showErrorAlert: false },
        ),
        // Snow forecast is city-wide — use fixed Chicago coords
        ApiClient.get<any>(
          `/api/snow-forecast?lat=41.8781&lng=-87.6298`,
          { timeout: 10000, showErrorAlert: false },
        ).catch(() => null),
      ]);

      if (!geoRes.success || !geoRes.data?.coordinates) {
        setErrorMsg('Could not find that address in Chicago. Try including the street number and name.');
        setIsChecking(false);
        return;
      }

      const d = geoRes.data;
      const { lat, lng } = d.coordinates;
      const geo: GeocodedResult = {
        lat,
        lng,
        address: d.address || trimmed,
        ward: d.ward,
        section: d.section,
      };

      // Compute severity from find-section data (no redundant check-parking call)
      const result: RestrictionResult = {};

      // Street cleaning severity based on nextCleaningDate
      if (d.nextCleaningDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cleaning = new Date(d.nextCleaningDate + 'T00:00:00');
        const diffDays = Math.round((cleaning.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const dateStr = cleaning.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        let severity: string = 'none';
        let message: string;
        if (diffDays === 0) {
          severity = 'critical';
          message = `Street cleaning TODAY (${dateStr}). Move your car!`;
        } else if (diffDays === 1) {
          severity = 'warning';
          message = `Street cleaning tomorrow (${dateStr})`;
        } else if (diffDays <= 3) {
          severity = 'info';
          message = `Street cleaning ${dateStr} (${diffDays} days)`;
        } else {
          message = `Next cleaning: ${dateStr}`;
        }

        result.streetCleaning = {
          hasRestriction: diffDays <= 1,
          message,
          severity,
          nextDate: d.nextCleaningDate,
        };
      } else {
        result.streetCleaning = { hasRestriction: false, message: 'No upcoming street cleaning scheduled', severity: 'none' };
      }

      // Winter overnight ban — Dec 1 - Apr 1, 3am-7am
      if (d.onWinterBan) {
        const now = new Date();
        const month = now.getMonth() + 1; // 1-indexed
        const inSeason = month >= 12 || month <= 3;
        const hour = now.getHours();
        const isActiveNow = inSeason && (hour >= 3 && hour < 7);
        const hoursUntilBan = inSeason
          ? (hour < 3 ? 3 - hour : hour >= 7 ? 24 - hour + 3 : 0)
          : -1;

        let severity: string = 'none';
        let message: string;
        if (isActiveNow) {
          severity = 'critical';
          message = `Winter parking ban ACTIVE on ${d.winterBanStreet || 'this street'}! No parking 3-7 AM.`;
        } else if (inSeason && hoursUntilBan <= 7) {
          severity = 'warning';
          message = `Winter ban in ${hoursUntilBan}h on ${d.winterBanStreet || 'this street'}. No parking 3-7 AM.`;
        } else if (inSeason) {
          message = `Winter overnight ban street (${d.winterBanStreet || 'this street'}). No parking 3-7 AM Dec-Apr.`;
        } else {
          message = `Winter overnight ban street (active Dec 1 - Apr 1, 3-7 AM)`;
        }

        result.winterOvernightBan = { active: isActiveNow, message, severity };
      } else {
        result.winterOvernightBan = { active: false, message: 'Not on a winter overnight ban street', severity: 'none' };
      }

      // 2-inch snow ban
      if (d.onSnowRoute) {
        const banActive = d.snowBanActive || false;
        result.twoInchSnowBan = {
          active: banActive,
          message: banActive
            ? `2-INCH SNOW BAN ACTIVE on ${d.snowRouteStreet || 'this street'}! Move your car to avoid tow.`
            : `On a 2" snow ban route (${d.snowRouteStreet || 'this street'}). Ban not currently active.`,
          severity: banActive ? 'critical' : 'none',
        };
      } else {
        result.twoInchSnowBan = { active: false, message: 'Not on a 2" snow ban route', severity: 'none' };
      }

      // Parse permit zone result
      if (permitRes.success && permitRes.data) {
        const pz = permitRes.data;
        if (pz.hasPermitZone && pz.zones?.length > 0) {
          const zone = pz.zones[0];
          geo.permitZone = String(zone.zone);
          result.permitZone = {
            inPermitZone: true,
            message: `Permit Zone ${zone.zone} — permit required`,
            zoneName: String(zone.zone),
            severity: 'warning',
          };
        } else {
          result.permitZone = {
            inPermitZone: false,
            message: 'Not in a residential permit zone',
            severity: 'none',
          };
        }
      }

      // Parse snow forecast
      if (snowRes?.success && snowRes.data) {
        setSnowForecast(snowRes.data);
      }

      setGeocoded(geo);
      setRestrictions(result);
      setShowMap(true);
    } catch (err: any) {
      log.error('Check destination error', err);
      setErrorMsg('Something went wrong. Please check your connection and try again.');
    } finally {
      setIsChecking(false);
    }
  }, [address]);

  // Count active restrictions — only warning/critical severity counts.
  // 'info' (e.g. cleaning on a future date) and 'none' are not actionable now.
  const isSevere = (s?: string) => s === 'warning' || s === 'critical';
  const activeRestrictions = restrictions
    ? [
        isSevere(restrictions.streetCleaning?.severity) && 'Street Cleaning',
        isSevere(restrictions.twoInchSnowBan?.severity) && 'Snow Ban',
        isSevere(restrictions.winterOvernightBan?.severity) && 'Winter Ban',
        isSevere(restrictions.permitZone?.severity) && 'Permit Zone',
      ].filter(Boolean) as string[]
    : [];
  const activeCount = activeRestrictions.length;

  // Build WebView URL
  const mapUrl = geocoded
    ? `${Config.API_BASE_URL}/destination-map?lat=${geocoded.lat}&lng=${geocoded.lng}&address=${encodeURIComponent(geocoded.address)}${geocoded.permitZone ? `&permitZone=${encodeURIComponent(geocoded.permitZone)}` : ''}${geocoded.ward ? `&ward=${encodeURIComponent(geocoded.ward)}` : ''}${geocoded.section ? `&section=${encodeURIComponent(geocoded.section)}` : ''}`
    : '';

  const saveCurrentDestination = useCallback(async () => {
    if (!geocoded) return;
    const defaultLabel = geocoded.address.split(',')[0] || geocoded.address;
    setPendingSaveAddress(geocoded.address);
    setPendingSaveLabel(defaultLabel);
    setSaveModalVisible(true);
  }, [geocoded, savedDestinations]);

  const confirmSaveDestination = useCallback(async () => {
    if (!pendingSaveAddress) return;
    const label = pendingSaveLabel.trim() || pendingSaveAddress.split(',')[0] || pendingSaveAddress;
    const item: SavedDestination = {
      id: `${Date.now()}`,
      label,
      address: pendingSaveAddress,
    };
    const deduped = savedDestinations.filter((d) => d.address.toLowerCase() !== pendingSaveAddress.toLowerCase());
    await persistSavedDestinations([item, ...deduped]);
    setSaveModalVisible(false);
    setPendingSaveAddress(null);
    setPendingSaveLabel('');
  }, [pendingSaveAddress, pendingSaveLabel, savedDestinations]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Modal
        transparent
        visible={saveModalVisible}
        animationType="fade"
        onRequestClose={() => setSaveModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Save Location</Text>
            <Text style={styles.modalSubtitle}>Add a label (e.g., Travis&apos;s House)</Text>
            <TextInput
              style={styles.modalInput}
              value={pendingSaveLabel}
              onChangeText={setPendingSaveLabel}
              placeholder="Label"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalActionBtn} onPress={() => setSaveModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalActionBtnPrimary} onPress={confirmSaveDestination}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        {isTab ? (
          <View style={{ width: 40 }} />
        ) : (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Icon name="arrow-left" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>{isTab ? 'Check Street' : 'Check Destination'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!mapTouched}
      >
        {/* Search Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Where are you parking?</Text>
          <Text style={styles.cardSubtitle}>
            Enter a Chicago address to see all parking restrictions in the area
          </Text>

          <View style={styles.inputRow}>
            <Icon name="map-marker" size={20} color={colors.primary} style={{ marginRight: 10 }} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="e.g. 123 N State St"
              placeholderTextColor={colors.textTertiary}
              value={address}
              onChangeText={setAddress}
              onSubmitEditing={() => handleCheck()}
              returnKeyType="search"
              autoCapitalize="words"
              autoCorrect={false}
              editable={!isChecking}
            />
            {address.length > 0 && (
              <TouchableOpacity
                onPress={() => { setAddress(''); inputRef.current?.focus(); }}
                style={{ padding: 4 }}
                accessibilityLabel="Clear address"
              >
                <Icon name="close-circle" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.checkButton, (!address.trim() || isChecking) && styles.checkButtonDisabled]}
            onPress={() => handleCheck()}
            disabled={!address.trim() || isChecking}
            accessibilityLabel="Check parking restrictions"
            accessibilityRole="button"
          >
            {isChecking ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <>
                <Icon name="shield-search" size={20} color={colors.textInverse} style={{ marginRight: 8 }} />
                <Text style={styles.checkButtonText}>Check Parking</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.savedLocationsWrap}>
            <Text style={styles.savedLocationsTitle}>Saved locations</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {savedDestinations.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.savedLocationChip}
                  onPress={() => {
                    setAddress(item.address);
                    handleCheck(item.address);
                  }}
                  onLongPress={() => {
                    Alert.alert(
                      'Remove Location',
                      `Remove "${item.label}" from saved locations?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => {
                            const next = savedDestinations.filter(d => d.id !== item.id);
                            persistSavedDestinations(next);
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Icon name="bookmark-outline" size={14} color={colors.primary} />
                  <Text style={styles.savedLocationChipText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.savedLocationChip, styles.addLocationChip]}
                onPress={() => {
                  inputRef.current?.focus();
                }}
              >
                <Icon name="plus" size={14} color={colors.primary} />
                <Text style={styles.savedLocationChipText}>Add</Text>
              </TouchableOpacity>
            </ScrollView>
            {savedDestinations.length === 0 && (
              <Text style={styles.savedLocationsHint}>
                Search an address above, then tap Save to add it here
              </Text>
            )}
          </View>
        </View>

        {/* Error */}
        {errorMsg && (
          <View style={styles.errorCard}>
            <Icon name="alert-circle-outline" size={20} color={colors.error} />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* Results */}
        {restrictions && geocoded && (
          <>
            {/* Summary */}
            <View style={[
              styles.summaryCard,
              activeCount === 0 ? styles.summaryCardClear : styles.summaryCardAlert,
            ]}>
              <Icon
                name={activeCount === 0 ? 'check-circle' : 'alert-circle'}
                size={28}
                color={activeCount === 0 ? colors.success : colors.warning}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.summaryTitle}>
                  {activeCount === 0
                    ? 'All Clear'
                    : `${activeCount} Restriction${activeCount > 1 ? 's' : ''} Found`}
                </Text>
                {activeCount > 0 && (
                  <Text style={styles.summaryDetail}>
                    {activeRestrictions.join(', ')}
                  </Text>
                )}
                <Text style={styles.summarySubtitle}>
                  {geocoded.address}
                  {geocoded.ward ? ` — Ward ${geocoded.ward}` : ''}
                </Text>
              </View>
            </View>

            {/* Individual restriction cards */}
            {renderRestrictionCard(
              'Street Cleaning',
              'broom',
              restrictions.streetCleaning?.message || '',
              restrictions.streetCleaning?.severity || 'none',
              restrictions.streetCleaning?.nextDate
                ? `Next: ${new Date(restrictions.streetCleaning.nextDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
                : undefined,
            )}
            {renderRestrictionCard(
              '2" Snow Ban',
              'snowflake',
              restrictions.twoInchSnowBan?.message || '',
              restrictions.twoInchSnowBan?.severity || 'none',
            )}
            {renderRestrictionCard(
              'Winter Overnight Ban',
              'weather-night',
              restrictions.winterOvernightBan?.message || '',
              restrictions.winterOvernightBan?.severity || 'none',
            )}
            {renderRestrictionCard(
              'Permit Zone',
              'card-account-details',
              restrictions.permitZone?.message || '',
              restrictions.permitZone?.severity || 'none',
            )}

            {/* Snow Forecast — simple 2"+ yes/no */}
            {snowForecast && (
              <View style={[
                styles.snowForecastCard,
                snowForecast.hasSignificantSnow && styles.snowForecastCardAlert,
              ]}>
                <View style={styles.snowForecastHeader}>
                  <Icon
                    name="weather-snowy-heavy"
                    size={18}
                    color={snowForecast.hasSignificantSnow ? colors.info : colors.textTertiary}
                  />
                  <Text style={[
                    styles.snowForecastTitle,
                    snowForecast.hasSignificantSnow && { color: colors.info },
                  ]}>
                    7-Day Snow Forecast
                  </Text>
                </View>
                <Text style={styles.snowForecastMessage}>
                  {snowForecast.hasSignificantSnow
                    ? `2+ inches of snow forecast${snowForecast.significantSnowWhen ? `: ${snowForecast.significantSnowWhen}` : ''}. The 2-inch snow parking ban could be activated.`
                    : 'No 2+ inches of snow in the 7-day forecast.'}
                </Text>
              </View>
            )}

            {/* Map */}
            {showMap && (
              <View style={styles.mapCard}>
                <View style={styles.mapHeader}>
                  <Icon name="map" size={18} color={colors.primary} />
                  <Text style={styles.mapHeaderText}>Area Restrictions Map</Text>
                </View>
                <View
                  style={styles.mapContainer}
                  onTouchStart={() => setMapTouched(true)}
                  onTouchEnd={() => setMapTouched(false)}
                  onTouchCancel={() => setMapTouched(false)}
                >
                  <WebView
                    source={{ uri: mapUrl }}
                    style={styles.webView}
                    javaScriptEnabled
                    domStorageEnabled
                    startInLoadingState
                    renderLoading={() => (
                      <View style={styles.mapLoading}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 8 }}>
                          Loading map...
                        </Text>
                      </View>
                    )}
                  />
                </View>
                <Text style={styles.mapHint}>
                  Pinch to zoom. Tap zones for cleaning dates.
                </Text>
              </View>
            )}

            {/* Directions button */}
            <View style={styles.resultActionsRow}>
              <TouchableOpacity
                style={styles.directionsButton}
                onPress={() => {
                  const url = Platform.OS === 'ios'
                    ? `maps:?q=${geocoded.lat},${geocoded.lng}`
                    : `geo:${geocoded.lat},${geocoded.lng}?q=${geocoded.lat},${geocoded.lng}(${encodeURIComponent(geocoded.address)})`;
                  Linking.openURL(url);
                }}
                accessibilityLabel="Open location"
                accessibilityRole="button"
              >
                <Icon name="map-marker-radius" size={20} color={colors.primary} />
                <Text style={styles.directionsText}>Open Location</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.directionsButton}
                onPress={saveCurrentDestination}
                accessibilityLabel="Save this location"
                accessibilityRole="button"
              >
                <Icon name="bookmark-plus-outline" size={20} color={colors.primary} />
                <Text style={styles.directionsText}>Save</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function renderRestrictionCard(
  title: string,
  icon: string,
  message: string,
  severity: string,
  extra?: string,
) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.none;
  return (
    <View
      key={title}
      style={[styles.restrictionCard, { backgroundColor: config.bg, borderLeftColor: config.border }]}
    >
      <View style={styles.restrictionHeader}>
        <Icon name={icon} size={18} color={config.iconColor} />
        <Text style={[styles.restrictionTitle, { color: config.iconColor }]}>{title}</Text>
        <Icon name={config.icon} size={16} color={config.iconColor} style={{ marginLeft: 'auto' }} />
      </View>
      <Text style={styles.restrictionMessage}>{message}</Text>
      {extra && <Text style={styles.restrictionExtra}>{extra}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
  },
  headerTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.base,
  },

  // Search card
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    marginBottom: spacing.base,
    ...shadows.md,
  },
  cardTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.base,
    lineHeight: 18,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : 0,
    marginBottom: spacing.base,
  },
  input: {
    flex: 1,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
    paddingVertical: Platform.OS === 'ios' ? 0 : spacing.md,
  },
  checkButton: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.primaryGlow,
  },
  checkButtonDisabled: {
    opacity: 0.5,
    ...shadows.sm,
  },
  checkButtonText: {
    color: colors.textInverse,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.bold,
  },
  savedLocationsWrap: {
    marginTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  savedLocationsTitle: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    fontWeight: typography.weights.medium,
  },
  savedLocationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginRight: spacing.xs,
  },
  savedLocationChipText: {
    marginLeft: 6,
    fontSize: typography.sizes.xs,
    color: colors.primary,
    fontWeight: typography.weights.medium,
  },
  addLocationChip: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  savedLocationsHint: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginTop: 6,
    fontStyle: 'italic',
  },

  // Error
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.criticalBg,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.base,
    gap: 10,
  },
  errorText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    color: colors.critical,
    lineHeight: 18,
  },

  // Summary
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    marginBottom: spacing.base,
    ...shadows.sm,
  },
  summaryCardClear: {
    backgroundColor: colors.successBg,
  },
  summaryCardAlert: {
    backgroundColor: colors.warningBg,
  },
  summaryTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  summaryDetail: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.warning,
    marginTop: 2,
  },
  summarySubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Restriction cards
  restrictionCard: {
    borderLeftWidth: 4,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  restrictionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  restrictionTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.bold,
  },
  restrictionMessage: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 18,
    marginLeft: 24,
  },
  restrictionExtra: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginLeft: 24,
    marginTop: 2,
  },

  // Snow Forecast
  snowForecastCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: colors.border,
  },
  snowForecastCardAlert: {
    borderLeftColor: colors.info,
    backgroundColor: colors.infoBg,
  },
  snowForecastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  snowForecastTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.bold,
    color: colors.textTertiary,
  },
  snowForecastMessage: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: 18,
    marginLeft: 24,
  },

  // Map
  mapCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    marginTop: spacing.sm,
    marginBottom: spacing.base,
    ...shadows.md,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  mapHeaderText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  mapContainer: {
    height: 400,
    backgroundColor: '#F3F4F6',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  mapLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  mapHint: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  // Directions
  directionsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    gap: 8,
  },
  directionsText: {
    color: colors.primary,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
  },
  resultActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.md,
  },
  modalTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  modalSubtitle: {
    marginTop: 4,
    marginBottom: spacing.sm,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
    color: colors.textPrimary,
    fontSize: typography.sizes.base,
  },
  modalActions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  modalActionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
  },
  modalActionBtnPrimary: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontWeight: typography.weights.medium,
  },
  modalSaveText: {
    color: colors.white,
    fontWeight: typography.weights.semibold,
  },
});
