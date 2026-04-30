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
import LocationService from '../services/LocationService';
import AnalyticsService from '../services/AnalyticsService';
import WhenPicker, { WhenSelection } from '../components/WhenPicker';
import {
  chicagoDateISO,
  chicagoDateTimeToInstant,
  formatChicagoDate,
  formatChicagoTime,
  getChicagoNow,
  toChicagoWallClock,
} from '../utils/chicagoTime';
import { evalPermitSchedule } from '../utils/permitScheduleEval';
import { filterDotPermits, FilteredPermit, DotPermit, describePermit } from '../utils/dotPermitFilter';

const log = Logger.createLogger('CheckDestination');

// Session-level cache for the citywide CDOT permits payload (~14k rows,
// ~5MB JSON). Refetched at most once every 30 minutes per app launch so
// repeated searches in date-range mode don't hit the network repeatedly.
let _dotPermitsCache: { fetchedAt: number; permits: DotPermit[] } | null = null;
async function fetchDotPermits(): Promise<DotPermit[]> {
  const now = Date.now();
  if (_dotPermitsCache && (now - _dotPermitsCache.fetchedAt) < 30 * 60 * 1000) {
    return _dotPermitsCache.permits;
  }
  const r = await ApiClient.get<any>('/api/dot-permits/all?days=60', {
    timeout: 15000,
    showErrorAlert: false,
  });
  if (r.success && Array.isArray(r.data?.permits)) {
    _dotPermitsCache = { fetchedAt: now, permits: r.data.permits };
    return r.data.permits;
  }
  return [];
}

// Restriction result types
interface RestrictionResult {
  streetCleaning?: {
    hasRestriction: boolean;
    message: string;
    severity: string;
    nextDate?: string;
    subsequentDate?: string;
    schedule?: string;
    datesInRange?: string[]; // populated only in 'range' mode
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
    restrictionSchedule?: string;
  };
  tempNoParking?: {
    permits: FilteredPermit[];
    severity: string;
  };
}

// Resolved query parameters derived from a WhenSelection. The screen passes
// these through to the API and the local restriction evaluators.
interface WhenQuery {
  // Optional date-range params for find-section. Both empty for "now".
  startDateParam?: string;
  endDateParam?: string;
  // The instant we're evaluating restrictions against. For 'now' this is
  // current time; for 'specific' it's the chosen day+hour; for 'range'
  // it's the start of the range at noon (representative).
  evalInstant: Date;
  // Range bounds for temp-no-parking overlap (always set; for 'now' both
  // are today's Chicago date).
  rangeStartISO: string;
  rangeEndISO: string;
  // Human-readable "Showing for: …" label (or null when 'now').
  banner: string | null;
}

function buildWhenQuery(sel: WhenSelection): WhenQuery {
  const today = chicagoDateISO();
  if (sel.mode === 'now') {
    return {
      evalInstant: new Date(),
      rangeStartISO: today,
      rangeEndISO: today,
      banner: null,
    };
  }
  if (sel.mode === 'specific' && sel.date && sel.hour !== undefined) {
    const instant = chicagoDateTimeToInstant(sel.date, sel.hour);
    return {
      startDateParam: sel.date,
      endDateParam: sel.date,
      evalInstant: instant,
      rangeStartISO: sel.date,
      rangeEndISO: sel.date,
      banner: `${formatChicagoDate(sel.date)} at ${formatChicagoTime(instant)}`,
    };
  }
  if (sel.mode === 'range' && sel.startDate && sel.endDate) {
    // Use noon of the start date as the representative instant. We can
    // do better by checking each day, but for permit-zone / winter-ban
    // "is it ever active during your visit?" the noon-of-start heuristic
    // is good enough for v1.
    const instant = chicagoDateTimeToInstant(sel.startDate, 12);
    return {
      startDateParam: sel.startDate,
      endDateParam: sel.endDate,
      evalInstant: instant,
      rangeStartISO: sel.startDate,
      rangeEndISO: sel.endDate,
      banner: `${formatChicagoDate(sel.startDate)} → ${formatChicagoDate(sel.endDate)}`,
    };
  }
  // Fallback when 'specific'/'range' selected but missing fields
  return {
    evalInstant: new Date(),
    rangeStartISO: today,
    rangeEndISO: today,
    banner: null,
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
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [snowForecast, setSnowForecast] = useState<{
    hasSignificantSnow: boolean;
    significantSnowWhen: string | null;
  } | null>(null);
  const [savedDestinations, setSavedDestinations] = useState<SavedDestination[]>([]);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [pendingSaveAddress, setPendingSaveAddress] = useState<string | null>(null);
  const [pendingSaveLabel, setPendingSaveLabel] = useState('');
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [whenSelection, setWhenSelection] = useState<WhenSelection>({ mode: 'now' });
  const [whenBanner, setWhenBanner] = useState<string | null>(null);
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

  // Build the restriction blocks from a find-section response + permit-zone
  // response + WhenQuery. Pulled out of handleCheck/handleCurrentLocation
  // so both call sites stay in sync. Pure function — no setState here.
  const computeRestrictions = useCallback((
    d: any,
    permitRes: any,
    whenQuery: WhenQuery,
  ): { result: RestrictionResult; geo: GeocodedResult } => {
    const geo: GeocodedResult = {
      lat: d.coordinates.lat,
      lng: d.coordinates.lng,
      address: d.address || address,
      ward: d.ward,
      section: d.section,
    };

    const result: RestrictionResult = {};
    const isRange = whenSelection.mode === 'range';

    // ────────────────── Street cleaning ──────────────────
    if (isRange && Array.isArray(d.datesInRange) && d.datesInRange.length > 0) {
      const count = d.datesInRange.length;
      const severity = count >= 1 ? 'warning' : 'none';
      result.streetCleaning = {
        hasRestriction: count > 0,
        message: count === 1
          ? `1 cleaning day during your visit`
          : `${count} cleaning days during your visit`,
        severity,
        nextDate: d.datesInRange[0],
        datesInRange: d.datesInRange,
      };
    } else if (isRange) {
      result.streetCleaning = {
        hasRestriction: false,
        message: 'No street cleaning scheduled during your visit',
        severity: 'none',
        datesInRange: [],
      };
    } else if (d.nextCleaningDate) {
      // 'now' or 'specific' mode — relative to whenQuery.evalInstant.
      const evalDay = chicagoDateISO(whenQuery.evalInstant);
      const cleaning = d.nextCleaningDate;
      const cleaningTime = new Date(cleaning + 'T00:00:00').getTime();
      const evalTime = new Date(evalDay + 'T00:00:00').getTime();
      const diffDays = Math.round((cleaningTime - evalTime) / (1000 * 60 * 60 * 24));
      const dateStr = formatChicagoDate(cleaning);

      let severity: string = 'none';
      let message: string;
      if (diffDays === 0) {
        severity = 'critical';
        message = whenSelection.mode === 'specific'
          ? `Street cleaning ON your visit day (${dateStr})`
          : `Street cleaning TODAY (${dateStr}). Move your car!`;
      } else if (diffDays === 1) {
        severity = 'warning';
        message = `Street cleaning the day after (${dateStr})`;
      } else if (diffDays <= 3 && diffDays > 0) {
        severity = 'warning';
        message = `Street cleaning ${dateStr} (${diffDays} days after your visit)`;
      } else if (diffDays > 0) {
        severity = 'none';
        message = `Next cleaning: ${dateStr} (${diffDays} days after)`;
      } else {
        // diffDays < 0 — cleaning is before the eval day; not relevant
        severity = 'none';
        message = `No upcoming cleaning near your visit`;
      }

      result.streetCleaning = {
        hasRestriction: diffDays === 0 || diffDays === 1,
        message,
        severity,
        nextDate: cleaning,
        subsequentDate: d.subsequentCleaningDate || undefined,
      };
    } else {
      result.streetCleaning = {
        hasRestriction: false,
        message: 'No upcoming street cleaning scheduled',
        severity: 'none',
      };
    }

    // ────────────────── Winter overnight ban ──────────────────
    // Evaluate against whenQuery.evalInstant in Chicago wall-clock.
    if (d.onWinterBan) {
      const cw = toChicagoWallClock(whenQuery.evalInstant);
      const month = cw.getMonth() + 1; // 1-indexed
      const inSeason = month >= 12 || month <= 3;
      const hour = cw.getHours();
      const isActiveAtTime = inSeason && hour >= 3 && hour < 7;

      let severity: string = 'none';
      let message: string;
      if (isActiveAtTime && whenSelection.mode === 'now') {
        severity = 'critical';
        message = `Winter parking ban ACTIVE on ${d.winterBanStreet || 'this street'}! No parking 3-7 AM.`;
      } else if (isActiveAtTime) {
        severity = 'critical';
        message = `Winter ban active at your selected time on ${d.winterBanStreet || 'this street'}.`;
      } else if (inSeason) {
        message = `Winter overnight ban street (${d.winterBanStreet || 'this street'}). No parking 3-7 AM Dec-Apr.`;
      } else {
        message = `Winter overnight ban street (active Dec 1 - Apr 1, 3-7 AM)`;
      }

      result.winterOvernightBan = { active: isActiveAtTime, message, severity };
    } else {
      result.winterOvernightBan = { active: false, message: 'Not on a winter overnight ban street', severity: 'none' };
    }

    // ────────────────── 2-inch snow ban ──────────────────
    // City only publishes live status — we can't predict for future dates.
    if (d.onSnowRoute) {
      const banActive = d.snowBanActive || false;
      if (whenSelection.mode === 'now') {
        result.twoInchSnowBan = {
          active: banActive,
          message: banActive
            ? `2-INCH SNOW BAN ACTIVE on ${d.snowRouteStreet || 'this street'}! Move your car to avoid tow.`
            : `On a 2" snow ban route (${d.snowRouteStreet || 'this street'}). Ban not currently active.`,
          severity: banActive ? 'critical' : 'none',
        };
      } else {
        result.twoInchSnowBan = {
          active: false,
          message: `On a 2" snow ban route (${d.snowRouteStreet || 'this street'}). Bans are activated only when 2"+ falls — can't predict for future dates.`,
          severity: 'info',
        };
      }
    } else {
      result.twoInchSnowBan = { active: false, message: 'Not on a 2" snow ban route', severity: 'none' };
    }

    // ────────────────── Permit zone ──────────────────
    if (permitRes?.success && permitRes.data) {
      const pz = permitRes.data;
      if (pz.hasPermitZone && pz.zones?.length > 0) {
        const zone = pz.zones[0];
        geo.permitZone = String(zone.zone);
        const schedule = zone.restrictionSchedule;

        if (whenSelection.mode === 'now' || whenSelection.mode === 'specific') {
          const evalResult = evalPermitSchedule(schedule, whenQuery.evalInstant);
          const sev = evalResult.state === 'active' ? 'critical'
            : evalResult.state === 'inactive' ? 'none' : 'warning';
          result.permitZone = {
            inPermitZone: true,
            message: `Permit Zone ${zone.zone} — ${evalResult.reason}`,
            zoneName: String(zone.zone),
            severity: sev,
            restrictionSchedule: schedule,
          };
        } else {
          // Range mode: just show the schedule text + warn that permit
          // hours apply during the visit if they apply at all.
          const scheduleText = schedule ? `Enforced ${schedule}` : 'Permit required (hours vary by block)';
          result.permitZone = {
            inPermitZone: true,
            message: `Permit Zone ${zone.zone} — ${scheduleText}`,
            zoneName: String(zone.zone),
            severity: 'warning',
            restrictionSchedule: schedule,
          };
        }
      } else {
        result.permitZone = {
          inPermitZone: false,
          message: 'Permit not currently needed',
          severity: 'none',
        };
      }
    }

    return { result, geo };
  }, [address, whenSelection]);

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

    const whenQuery = buildWhenQuery(whenSelection);
    setWhenBanner(whenQuery.banner);

    try {
      // Build find-section URL with optional date params.
      let findUrl = `/api/find-section?address=${encodeURIComponent(trimmed)}`;
      if (whenQuery.startDateParam && whenQuery.endDateParam) {
        findUrl += `&startDate=${whenQuery.startDateParam}&endDate=${whenQuery.endDateParam}`;
      }

      // Fetch DOT permits only when the user picked a non-now mode — saves
      // the ~5MB payload on the common path.
      const dotPromise = whenSelection.mode !== 'now'
        ? fetchDotPermits().catch(() => [] as DotPermit[])
        : Promise.resolve([] as DotPermit[]);

      const [geoRes, permitRes, snowRes, dotPermits] = await Promise.all([
        ApiClient.get<any>(findUrl, { timeout: 12000, showErrorAlert: false }),
        ApiClient.get<any>(
          `/api/check-permit-zone?address=${encodeURIComponent(trimmed)}`,
          { timeout: 8000, showErrorAlert: false },
        ),
        ApiClient.get<any>(
          `/api/snow-forecast?lat=41.8781&lng=-87.6298`,
          { timeout: 10000, showErrorAlert: false },
        ).catch(() => null),
        dotPromise,
      ]);

      const geocodingSucceeded = geoRes.data?.geocoding_successful && geoRes.data?.coordinates;
      if (!geoRes.success && !geocodingSucceeded) {
        setErrorMsg('Could not find that address in Chicago. Try including the street number and name.');
        setIsChecking(false);
        return;
      }

      const d = geoRes.data;
      const { result, geo } = computeRestrictions(d, permitRes, whenQuery);

      // Temp no parking — only relevant for non-now modes.
      if (whenSelection.mode !== 'now' && dotPermits.length > 0) {
        const filtered = filterDotPermits(dotPermits, {
          centerLat: geo.lat,
          centerLng: geo.lng,
          radiusMeters: 200,
          startISO: whenQuery.rangeStartISO,
          endISO: whenQuery.rangeEndISO,
        });
        if (filtered.length > 0) {
          result.tempNoParking = { permits: filtered.slice(0, 5), severity: 'warning' };
        }
      }

      if (snowRes?.success && snowRes.data) setSnowForecast(snowRes.data);

      setGeocoded(geo);
      setRestrictions(result);
      setShowMap(true);
      void AnalyticsService.logAddressCheck(trimmed, result !== null);
    } catch (err: any) {
      log.error('Check destination error', err);
      setErrorMsg('Something went wrong. Please check your connection and try again.');
      void AnalyticsService.logEvent('address_check_error');
    } finally {
      setIsChecking(false);
    }
  }, [address, whenSelection, computeRestrictions]);

  const handleCurrentLocation = useCallback(async () => {
    Keyboard.dismiss();
    setIsGettingLocation(true);
    setErrorMsg(null);
    setRestrictions(null);
    setGeocoded(null);
    setShowMap(false);
    setSnowForecast(null);

    const whenQuery = buildWhenQuery(whenSelection);
    setWhenBanner(whenQuery.banner);

    try {
      const hasPermission = await LocationService.requestLocationPermission();
      if (!hasPermission) {
        setErrorMsg('Location permission is required. Please enable it in Settings.');
        return;
      }

      const coords = await LocationService.getCurrentLocation();
      const lat = coords.latitude;
      const lng = coords.longitude;

      let findUrl = `/api/find-section?lat=${lat}&lng=${lng}`;
      if (whenQuery.startDateParam && whenQuery.endDateParam) {
        findUrl += `&startDate=${whenQuery.startDateParam}&endDate=${whenQuery.endDateParam}`;
      }

      const dotPromise = whenSelection.mode !== 'now'
        ? fetchDotPermits().catch(() => [] as DotPermit[])
        : Promise.resolve([] as DotPermit[]);

      const [geoRes, snowRes, dotPermits] = await Promise.all([
        ApiClient.get<any>(findUrl, { timeout: 12000, showErrorAlert: false }),
        ApiClient.get<any>(
          `/api/snow-forecast?lat=41.8781&lng=-87.6298`,
          { timeout: 10000, showErrorAlert: false },
        ).catch(() => null),
        dotPromise,
      ]);

      if (!geoRes.success || !geoRes.data?.coordinates) {
        setErrorMsg('Could not identify restrictions at your location. You may be outside Chicago.');
        return;
      }

      const d = geoRes.data;
      const resolvedAddress = d.address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      setAddress(resolvedAddress);

      const permitRes = await ApiClient.get<any>(
        `/api/check-permit-zone?address=${encodeURIComponent(resolvedAddress)}`,
        { timeout: 8000, showErrorAlert: false },
      ).catch(() => ({ success: false }));

      const { result, geo } = computeRestrictions({ ...d, address: resolvedAddress }, permitRes, whenQuery);

      if (whenSelection.mode !== 'now' && dotPermits.length > 0) {
        const filtered = filterDotPermits(dotPermits, {
          centerLat: geo.lat,
          centerLng: geo.lng,
          radiusMeters: 200,
          startISO: whenQuery.rangeStartISO,
          endISO: whenQuery.rangeEndISO,
        });
        if (filtered.length > 0) {
          result.tempNoParking = { permits: filtered.slice(0, 5), severity: 'warning' };
        }
      }

      if (snowRes?.success && snowRes.data) setSnowForecast(snowRes.data);

      setGeocoded(geo);
      setRestrictions(result);
      setShowMap(true);
    } catch (err: any) {
      log.error('Current location check error', err);
      setErrorMsg('Something went wrong. Please check your connection and try again.');
    } finally {
      setIsGettingLocation(false);
      setIsChecking(false);
    }
  }, [whenSelection, computeRestrictions]);

  // Count active restrictions — only warning/critical severity counts.
  // 'info' (e.g. cleaning on a future date) and 'none' are not actionable now.
  const isSevere = (s?: string) => s === 'warning' || s === 'critical';
  const activeRestrictions = restrictions
    ? [
        isSevere(restrictions.streetCleaning?.severity) && 'Street Cleaning',
        isSevere(restrictions.twoInchSnowBan?.severity) && 'Snow Ban',
        isSevere(restrictions.winterOvernightBan?.severity) && 'Winter Ban',
        isSevere(restrictions.permitZone?.severity) && 'Permit Zone',
        isSevere(restrictions.tempNoParking?.severity) && 'Temp No Parking',
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
        keyboardShouldPersistTaps="always"
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

          <WhenPicker value={whenSelection} onChange={setWhenSelection} />

          <TouchableOpacity
            style={[styles.checkButton, (!address.trim() || isChecking || isGettingLocation) && styles.checkButtonDisabled]}
            onPress={() => handleCheck()}
            disabled={!address.trim() || isChecking || isGettingLocation}
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

          <TouchableOpacity
            style={[styles.currentLocationButton, (isChecking || isGettingLocation) && styles.checkButtonDisabled]}
            onPress={handleCurrentLocation}
            disabled={isChecking || isGettingLocation}
            accessibilityLabel="Use current location"
            accessibilityRole="button"
          >
            {isGettingLocation ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Icon name="crosshairs-gps" size={18} color={colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.currentLocationButtonText}>Use Current Location</Text>
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
                  if (geocoded) {
                    // If we have a search result, save it directly
                    saveCurrentDestination();
                  } else {
                    inputRef.current?.focus();
                  }
                }}
              >
                <Icon name="plus" size={14} color={colors.primary} />
                <Text style={styles.savedLocationChipText}>
                  {geocoded ? 'Save' : 'Add'}
                </Text>
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
            {/* "Showing for: …" banner — only when not 'now' */}
            {whenBanner && (
              <View style={styles.whenBanner}>
                <Icon name="calendar-clock" size={14} color={colors.primary} />
                <Text style={styles.whenBannerText}>Showing for: {whenBanner}</Text>
                <TouchableOpacity
                  onPress={() => {
                    setWhenSelection({ mode: 'now' });
                    setWhenBanner(null);
                    if (address.trim()) handleCheck();
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.whenBannerReset}>Reset to now</Text>
                </TouchableOpacity>
              </View>
            )}

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
            {(() => {
              const sc = restrictions.streetCleaning;
              const severity = sc?.severity || 'none';
              const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.none;
              const dates = sc?.datesInRange;
              return (
                <View key="Street Cleaning" style={[styles.restrictionCard, { backgroundColor: config.bg, borderLeftColor: config.border }]}>
                  <View style={styles.restrictionHeader}>
                    <Icon name="broom" size={18} color={config.iconColor} />
                    <Text style={[styles.restrictionTitle, { color: config.iconColor }]}>Street Cleaning</Text>
                    <Icon name={config.icon} size={16} color={config.iconColor} style={{ marginLeft: 'auto' }} />
                  </View>
                  <Text style={styles.restrictionMessage}>{sc?.message || ''}</Text>
                  {dates && dates.length > 0 && (
                    <View style={styles.dateChipRow}>
                      {dates.map(d => (
                        <View key={d} style={styles.cleaningDateChip}>
                          <Text style={styles.cleaningDateChipText}>{formatChicagoDate(d)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {!dates && sc?.nextDate && (
                    (() => {
                      const label = formatNextCleaningLabel(sc.severity, sc.nextDate, sc.subsequentDate);
                      return label ? <Text style={styles.restrictionExtra}>{label}</Text> : null;
                    })()
                  )}
                </View>
              );
            })()}
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
            {restrictions.tempNoParking && restrictions.tempNoParking.permits.length > 0 && (() => {
              const tnp = restrictions.tempNoParking!;
              const config = SEVERITY_CONFIG[tnp.severity] || SEVERITY_CONFIG.warning;
              return (
                <View key="Temp No Parking" style={[styles.restrictionCard, { backgroundColor: config.bg, borderLeftColor: config.border }]}>
                  <View style={styles.restrictionHeader}>
                    <Icon name="sign-caution" size={18} color={config.iconColor} />
                    <Text style={[styles.restrictionTitle, { color: config.iconColor }]}>Temporary No Parking</Text>
                    <Icon name={config.icon} size={16} color={config.iconColor} style={{ marginLeft: 'auto' }} />
                  </View>
                  <Text style={styles.restrictionMessage}>
                    {tnp.permits.length} CDOT permit{tnp.permits.length === 1 ? '' : 's'} overlap your visit within 200m
                  </Text>
                  <View style={styles.tnpList}>
                    {tnp.permits.map((p, idx) => (
                      <View key={(p.applicationNumber || '') + idx} style={styles.tnpItem}>
                        <Text style={styles.tnpItemTitle}>{describePermit(p)}</Text>
                        <Text style={styles.tnpItemDetail}>
                          {formatChicagoDate(p.startISO)} → {formatChicagoDate(p.endISO)}
                        </Text>
                        {p.comments ? (
                          <Text style={styles.tnpItemComment} numberOfLines={2}>{p.comments}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              );
            })()}

            {(() => {
              const pz = restrictions.permitZone;
              const severity = pz?.severity || 'none';
              const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.none;
              return (
                <View
                  key="Permit Zone"
                  style={[styles.restrictionCard, { backgroundColor: config.bg, borderLeftColor: config.border }]}
                >
                  <View style={styles.restrictionHeader}>
                    <Icon name="card-account-details" size={18} color={config.iconColor} />
                    <Text style={[styles.restrictionTitle, { color: config.iconColor }]}>Permit Zone</Text>
                    <Icon name={config.icon} size={16} color={config.iconColor} style={{ marginLeft: 'auto' }} />
                  </View>
                  <Text style={styles.restrictionMessage}>{pz?.message || ''}</Text>
                  {pz?.inPermitZone && (
                    <TouchableOpacity
                      onPress={() => navigation.navigate('ReportZoneHours', {
                        zone: pz.zoneName,
                        currentSchedule: pz.restrictionSchedule || '',
                        address: geocoded?.address || address,
                        latitude: geocoded?.lat,
                        longitude: geocoded?.lng,
                      })}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.correctionLink}>Submit a correction</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}

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
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity
                    onPress={() => setMapFullscreen(true)}
                    style={styles.mapExpandButton}
                    accessibilityLabel="Expand map to fullscreen"
                    accessibilityRole="button"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon name="arrow-expand" size={16} color={colors.primary} />
                    <Text style={styles.mapExpandText}>Expand</Text>
                  </TouchableOpacity>
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
                  Pinch to zoom. Tap zones for cleaning dates. Tap Expand for fullscreen.
                </Text>
              </View>
            )}

            {/* Fullscreen map modal */}
            <Modal
              visible={mapFullscreen}
              animationType="slide"
              presentationStyle="fullScreen"
              onRequestClose={() => setMapFullscreen(false)}
            >
              <SafeAreaView style={styles.fullscreenMapContainer} edges={['top']}>
                <View style={styles.fullscreenMapHeader}>
                  <Icon name="map" size={18} color={colors.primary} />
                  <Text style={styles.fullscreenMapTitle} numberOfLines={1}>
                    {geocoded?.address || 'Area Restrictions Map'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setMapFullscreen(false)}
                    style={styles.fullscreenCloseButton}
                    accessibilityLabel="Close fullscreen map"
                    accessibilityRole="button"
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Icon name="close" size={24} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>
                <WebView
                  source={{ uri: mapUrl }}
                  style={{ flex: 1, backgroundColor: 'transparent' }}
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
              </SafeAreaView>
            </Modal>

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

// Format an ISO YYYY-MM-DD as a Chicago-local short string. Parsing naked
// YYYY-MM-DD defaults to UTC, which renders Apr 17 as "Thu, Apr 16" on any
// device west of UTC — always anchor to local noon before formatting.
function formatIsoDateChicago(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// The "Next:" subline under the street-cleaning card. When today IS a cleaning
// day, the red alert already says "TODAY" — showing "Next: today" is noise, so
// jump to the subsequent distinct date.
function formatNextCleaningLabel(
  severity: string | undefined,
  nextDate: string | undefined,
  subsequentDate: string | undefined,
): string | undefined {
  if (!nextDate) return undefined;
  if (severity === 'critical' && subsequentDate) {
    return `Next: ${formatIsoDateChicago(subsequentDate)}`;
  }
  if (severity === 'critical') return undefined;
  return `Next: ${formatIsoDateChicago(nextDate)}`;
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
  currentLocationButton: {
    flexDirection: 'row',
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  currentLocationButtonText: {
    color: colors.primary,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
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
  correctionLink: {
    fontSize: 11,
    color: colors.textTertiary,
    marginLeft: 24,
    marginTop: 6,
    textDecorationLine: 'underline' as const,
  },

  // "Showing for: …" banner
  whenBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary + '20',
  },
  whenBannerText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
  whenBannerReset: {
    fontSize: typography.sizes.xs,
    color: colors.primary,
    textDecorationLine: 'underline',
    fontWeight: typography.weights.medium,
  },

  // Cleaning date chips (range mode)
  dateChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
    marginLeft: 24,
  },
  cleaningDateChip: {
    backgroundColor: colors.warning + '15',
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  cleaningDateChipText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    color: colors.warning,
  },

  // Temp No Parking list
  tnpList: {
    marginTop: spacing.sm,
    marginLeft: 24,
    gap: spacing.xs,
  },
  tnpItem: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  tnpItemTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  tnpItemDetail: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  tnpItemComment: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginTop: 4,
    fontStyle: 'italic',
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
    height: 520,
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
  mapExpandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: borderRadius.sm,
    backgroundColor: '#E6EFFF',
  },
  mapExpandText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    color: colors.primary,
  },
  fullscreenMapContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fullscreenMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    // Generous vertical breathing room so the close button sits well below
    // the iPhone Dynamic Island / notch and isn't crowded against the top
    // edge — previously the button was just 12px below the safe-area top
    // and felt untappable on devices with intrusive top hardware.
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.cardBg,
  },
  fullscreenMapTitle: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  fullscreenCloseButton: {
    // 44×44 minimum touch target (Apple HIG) — the previous 4px padding gave
    // a 32×32-ish target which was too small to hit reliably with a thumb,
    // especially when the button sat against the screen edge.
    padding: spacing.sm,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
