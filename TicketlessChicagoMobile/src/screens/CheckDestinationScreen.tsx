import React, { useState, useRef, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import Config from '../config/config';
import ApiClient from '../utils/ApiClient';
import Logger from '../utils/Logger';

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
  const inputRef = useRef<TextInput>(null);

  const handleCheck = useCallback(async () => {
    const trimmed = address.trim();
    if (!trimmed) return;

    Keyboard.dismiss();
    setIsChecking(true);
    setErrorMsg(null);
    setRestrictions(null);
    setGeocoded(null);
    setShowMap(false);

    try {
      // Step 1: Geocode the address via find-section
      const geoRes = await ApiClient.get<any>(
        `/api/find-section?address=${encodeURIComponent(trimmed)}`,
        { timeout: 12000, showErrorAlert: false },
      );

      if (!geoRes.success || !geoRes.data?.coordinates) {
        setErrorMsg('Could not find that address in Chicago. Try including the street number and name.');
        setIsChecking(false);
        return;
      }

      const { lat, lng } = geoRes.data.coordinates;
      const geo: GeocodedResult = {
        lat,
        lng,
        address: geoRes.data.address || trimmed,
        ward: geoRes.data.ward,
        section: geoRes.data.section,
      };

      // Step 2: Check all restrictions at the location + check permit zone
      const [parkingRes, permitRes] = await Promise.all([
        ApiClient.get<any>(
          `/api/mobile/check-parking?lat=${lat}&lng=${lng}&accuracy=10&confidence=high`,
          { timeout: 12000, showErrorAlert: false },
        ),
        ApiClient.get<any>(
          `/api/check-permit-zone?address=${encodeURIComponent(trimmed)}`,
          { timeout: 8000, showErrorAlert: false },
        ),
      ]);

      const result: RestrictionResult = {};

      // Parse parking check results
      if (parkingRes.success && parkingRes.data) {
        const d = parkingRes.data;
        result.streetCleaning = d.streetCleaning
          ? {
              hasRestriction: d.streetCleaning.hasRestriction,
              message: d.streetCleaning.message || 'No street cleaning info',
              severity: d.streetCleaning.severity || 'none',
              nextDate: d.streetCleaning.nextDate,
              schedule: d.streetCleaning.schedule,
            }
          : { hasRestriction: false, message: 'No street cleaning scheduled', severity: 'none' };

        result.winterOvernightBan = d.winterOvernightBan
          ? {
              active: d.winterOvernightBan.active,
              message: d.winterOvernightBan.message || 'No winter ban',
              severity: d.winterOvernightBan.severity || 'none',
            }
          : { active: false, message: 'Not on a winter ban street', severity: 'none' };

        result.twoInchSnowBan = d.twoInchSnowBan
          ? {
              active: d.twoInchSnowBan.active,
              message: d.twoInchSnowBan.message || 'No snow ban',
              severity: d.twoInchSnowBan.severity || 'none',
            }
          : { active: false, message: 'Not on a snow ban route', severity: 'none' };
      }

      // Parse permit zone result
      if (permitRes.success && permitRes.data) {
        const pz = permitRes.data;
        if (pz.hasPermitZone && pz.zones?.length > 0) {
          const zone = pz.zones[0];
          geo.permitZone = String(zone.zone);
          result.permitZone = {
            inPermitZone: true,
            message: `Permit Zone ${zone.zone} — permit required during restricted hours`,
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
    ? `${Config.API_BASE_URL}/destination-map?lat=${geocoded.lat}&lng=${geocoded.lng}&address=${encodeURIComponent(geocoded.address)}${geocoded.permitZone ? `&permitZone=${encodeURIComponent(geocoded.permitZone)}` : ''}`
    : '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
              onSubmitEditing={handleCheck}
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
            onPress={handleCheck}
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

            {/* Map */}
            {showMap && (
              <View style={styles.mapCard}>
                <View style={styles.mapHeader}>
                  <Icon name="map" size={18} color={colors.primary} />
                  <Text style={styles.mapHeaderText}>Area Restrictions Map</Text>
                </View>
                <View style={styles.mapContainer}>
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
                    // Prevent navigation away from the map page
                    onShouldStartLoadWithRequest={(req) => {
                      if (req.url.includes('/destination-map')) return true;
                      // Open external links in the browser
                      if (req.url.startsWith('http')) {
                        Linking.openURL(req.url);
                        return false;
                      }
                      return true;
                    }}
                  />
                </View>
                <Text style={styles.mapHint}>
                  Pinch to zoom. Tap zones for cleaning dates.
                </Text>
              </View>
            )}

            {/* Directions button */}
            <TouchableOpacity
              style={styles.directionsButton}
              onPress={() => {
                const scheme = Platform.OS === 'ios' ? 'maps:' : 'geo:';
                const url = Platform.OS === 'ios'
                  ? `maps:?daddr=${geocoded.lat},${geocoded.lng}`
                  : `geo:${geocoded.lat},${geocoded.lng}?q=${geocoded.lat},${geocoded.lng}(${encodeURIComponent(geocoded.address)})`;
                Linking.openURL(url);
              }}
              accessibilityLabel="Get directions"
              accessibilityRole="button"
            >
              <Icon name="directions" size={20} color={colors.primary} />
              <Text style={styles.directionsText}>Get Directions</Text>
            </TouchableOpacity>
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
});
