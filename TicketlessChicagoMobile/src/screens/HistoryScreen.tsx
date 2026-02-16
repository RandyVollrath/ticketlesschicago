import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import { StatusBadge, RuleCard } from '../components';
import { ParkingRule, Coordinates } from '../services/LocationService';
import AuthService from '../services/AuthService';
import CameraPassHistoryService, { CameraPassHistoryItem } from '../services/CameraPassHistoryService';
import RedLightReceiptService, { RedLightReceipt } from '../services/RedLightReceiptService';
import AppEvents from '../services/AppEvents';
import Logger from '../utils/Logger';
import Config from '../config/config';
import { StorageKeys } from '../constants';

const log = Logger.createLogger('HistoryScreen');

export interface ParkingHistoryItem {
  id: string;
  coords: Coordinates;
  address?: string;
  rules: ParkingRule[];
  timestamp: number;
  // Departure tracking (for ticket contesting)
  departure?: {
    confirmedAt: number;       // When departure was recorded
    distanceMeters: number;    // Distance from parking spot
    isConclusive: boolean;     // Far enough to prove departure
    latitude: number;
    longitude: number;
  };
  detectionMeta?: {
    detectionSource?: string;
    locationSource?: string;
    accuracy?: number;
    drivingDurationSec?: number;
    nativeTimestamp?: number;
    driveSessionId?: string | null;
    recordedAt: number;
  };
}

const HISTORY_KEY = StorageKeys.PARKING_HISTORY;
const MAX_HISTORY_ITEMS = 50;

// ──────────────────────────────────────────────────────
// Supabase sync helpers (fire-and-forget, never blocks UI)
// ──────────────────────────────────────────────────────

/** Push a new history item to Supabase. Fails silently. */
const syncAddToServer = async (item: ParkingHistoryItem): Promise<void> => {
  try {
    if (!AuthService.isAuthenticated()) return;
    const userId = AuthService.getUser()?.id;
    if (!userId) return;

    const supabase = AuthService.getSupabaseClient();
    const { error } = await supabase.from('parking_location_history').insert({
      user_id: userId,
      latitude: item.coords.latitude,
      longitude: item.coords.longitude,
      address: item.address || null,
      parked_at: new Date(item.timestamp).toISOString(),
      // Map rules to known columns
      on_winter_ban_street: item.rules.some(r => r.type === 'winter_ban'),
      winter_ban_street_name: item.rules.find(r => r.type === 'winter_ban')?.streetName || null,
      on_snow_route: item.rules.some(r => r.type === 'snow_route'),
      snow_route_name: item.rules.find(r => r.type === 'snow_route')?.streetName || null,
      street_cleaning_date: item.rules.find(r => r.type === 'street_cleaning')?.nextDate || null,
      street_cleaning_ward: item.rules.find(r => r.type === 'street_cleaning')?.ward || null,
      street_cleaning_section: item.rules.find(r => r.type === 'street_cleaning')?.section || null,
      permit_zone: item.rules.find(r => r.type === 'permit_zone')?.zone || null,
      permit_restriction_schedule: item.rules.find(r => r.type === 'permit_zone')?.schedule || null,
    });
    if (error) log.debug('Sync add failed (non-fatal)', error.message);
    else log.debug('History synced to server');
  } catch (e) {
    log.debug('Sync add exception (non-fatal)', e);
  }
};

/** Push departure data update to Supabase. Fails silently. */
const syncDepartureToServer = async (item: ParkingHistoryItem): Promise<void> => {
  try {
    if (!AuthService.isAuthenticated() || !item.departure) return;
    const userId = AuthService.getUser()?.id;
    if (!userId) return;

    const supabase = AuthService.getSupabaseClient();
    const parkedAtIso = new Date(item.timestamp).toISOString();
    const departureIso = new Date(item.departure.confirmedAt).toISOString();

    // First attempt: exact parked_at match
    const { data: exactUpdatedRows, error } = await supabase
      .from('parking_location_history')
      .update({
        departure_latitude: item.departure.latitude,
        departure_longitude: item.departure.longitude,
        departure_confirmed_at: departureIso,
        departure_distance_meters: item.departure.distanceMeters,
        cleared_at: departureIso,
      })
      .eq('user_id', userId)
      .eq('parked_at', parkedAtIso)
      .select('id');

    if (!error && exactUpdatedRows && exactUpdatedRows.length > 0) return;

    // Fallback: timestamp drift tolerance. Find nearby parking rows and update best match.
    const { data: candidates, error: candidateError } = await supabase
      .from('parking_location_history')
      .select('id, parked_at')
      .eq('user_id', userId)
      .is('departure_confirmed_at', null)
      .order('parked_at', { ascending: false })
      .limit(20);

    if (candidateError || !candidates || candidates.length === 0) {
      if (error) log.debug('Sync departure failed (non-fatal)', error.message);
      return;
    }

    const targetMs = new Date(parkedAtIso).getTime();
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const best = candidates
      .map((c: any) => ({ id: c.id, diff: Math.abs(new Date(c.parked_at).getTime() - targetMs) }))
      .sort((a: any, b: any) => a.diff - b.diff)[0];

    if (!best || best.diff > SIX_HOURS_MS) return;

    const { error: fallbackUpdateError } = await supabase
      .from('parking_location_history')
      .update({
        departure_latitude: item.departure.latitude,
        departure_longitude: item.departure.longitude,
        departure_confirmed_at: departureIso,
        departure_distance_meters: item.departure.distanceMeters,
        cleared_at: departureIso,
      })
      .eq('id', best.id)
      .eq('user_id', userId);

    if (fallbackUpdateError) {
      log.debug('Sync departure fallback failed (non-fatal)', fallbackUpdateError.message);
    } else {
      log.debug('Sync departure fallback succeeded', { matchedRecordId: best.id, diffMs: best.diff });
    }
  } catch (e) {
    log.debug('Sync departure exception (non-fatal)', e);
  }
};

/** Restore history from Supabase when local storage is empty. */
const restoreFromServer = async (): Promise<ParkingHistoryItem[]> => {
  try {
    if (!AuthService.isAuthenticated()) return [];
    const supabase = AuthService.getSupabaseClient();
    const { data, error } = await supabase
      .from('parking_location_history')
      .select('*')
      .order('parked_at', { ascending: false })
      .limit(MAX_HISTORY_ITEMS);

    if (error || !data || data.length === 0) return [];

    // Convert server rows back to ParkingHistoryItem format
    const items: ParkingHistoryItem[] = data.map((row: any) => {
      const rules: ParkingRule[] = [];
      if (row.on_winter_ban_street) {
        rules.push({ type: 'winter_ban', severity: 'critical', streetName: row.winter_ban_street_name || '', description: 'Winter overnight parking ban' } as ParkingRule);
      }
      if (row.on_snow_route) {
        rules.push({ type: 'snow_route', severity: 'warning', streetName: row.snow_route_name || '', description: 'Snow route' } as ParkingRule);
      }
      if (row.street_cleaning_date) {
        rules.push({ type: 'street_cleaning', severity: 'warning', nextDate: row.street_cleaning_date, ward: row.street_cleaning_ward || '', section: row.street_cleaning_section || '', description: 'Street cleaning' } as ParkingRule);
      }
      if (row.permit_zone) {
        rules.push({ type: 'permit_zone', severity: 'info', zone: row.permit_zone, schedule: row.permit_restriction_schedule || '', description: `Permit zone ${row.permit_zone}` } as ParkingRule);
      }

      const item: ParkingHistoryItem = {
        id: new Date(row.parked_at).getTime().toString(),
        coords: { latitude: parseFloat(row.latitude), longitude: parseFloat(row.longitude) },
        address: row.address || undefined,
        rules,
        timestamp: new Date(row.parked_at).getTime(),
      };

      if (row.departure_confirmed_at) {
        item.departure = {
          confirmedAt: new Date(row.departure_confirmed_at).getTime(),
          distanceMeters: row.departure_distance_meters || 0,
          isConclusive: (row.departure_distance_meters || 0) > 50,
          latitude: row.departure_latitude || 0,
          longitude: row.departure_longitude || 0,
        };
      }
      return item;
    });

    // Save restored data locally so subsequent reads are fast
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    log.info(`Restored ${items.length} history items from server`);
    return items;
  } catch (e) {
    log.debug('Restore from server failed (non-fatal)', e);
    return [];
  }
};

// ──────────────────────────────────────────────────────
// Service to manage parking history (local-first + server sync)
// ──────────────────────────────────────────────────────
export const ParkingHistoryService = {
  async getHistory(): Promise<ParkingHistoryItem[]> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const local: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];

      // If local is empty but user is authenticated, try restoring from server
      if (local.length === 0 && AuthService.isAuthenticated()) {
        return await restoreFromServer();
      }
      return local;
    } catch (error) {
      log.error('Error getting parking history', error);
      return [];
    }
  },

  async addToHistory(
    coords: Coordinates,
    rules: ParkingRule[],
    address?: string,
    nativeTimestamp?: number,
    detectionMeta?: ParkingHistoryItem['detectionMeta']
  ): Promise<void> {
    try {
      // Read existing history directly (avoid `this` binding issues when called cross-module)
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];

      // Use the native event timestamp (when the car actually stopped) if available,
      // otherwise fall back to Date.now() (when the check completed).
      // On iOS, the native timestamp comes from CoreMotion/GPS detection and is
      // typically 30-120s earlier than Date.now() due to detection + API delays.
      const parkTime = nativeTimestamp || Date.now();
      if (nativeTimestamp) {
        const delayMs = Date.now() - nativeTimestamp;
        log.info(`Using native timestamp for parking time (${Math.round(delayMs / 1000)}s more accurate than Date.now())`);
      }

      const newItem: ParkingHistoryItem = {
        id: Date.now().toString(),
        coords,
        address: address || `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
        rules,
        timestamp: parkTime,
        detectionMeta,
      };

      const updated = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      AppEvents.emit('parking-history-updated');
      log.info(`Saved to parking history: "${newItem.address}" (${rules.length} rules, ${updated.length} total items)`);

      // Fire-and-forget sync to server
      syncAddToServer(newItem);
    } catch (error) {
      log.error('Error adding to parking history', error);
    }
  },

  async clearHistory(): Promise<void> {
    try {
      await AsyncStorage.removeItem(HISTORY_KEY);
      AppEvents.emit('parking-history-updated');
    } catch (error) {
      log.error('Error clearing parking history', error);
    }
  },

  async deleteItem(id: string): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
      const updated = history.filter(item => item.id !== id);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      AppEvents.emit('parking-history-updated');
    } catch (error) {
      log.error('Error deleting history item', error);
    }
  },

  async updateItem(id: string, updates: Partial<ParkingHistoryItem>): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
      const updated = history.map(item =>
        item.id === id ? { ...item, ...updates } : item
      );
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      AppEvents.emit('parking-history-updated');

      // If departure data was added, sync it to server
      if (updates.departure) {
        const updatedItem = updated.find(item => item.id === id);
        if (updatedItem) syncDepartureToServer(updatedItem);
      }
    } catch (error) {
      log.error('Error updating history item', error);
    }
  },

  /** Find the most recent history item (to attach departure data to) */
  async getMostRecent(): Promise<ParkingHistoryItem | null> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      const history: ParkingHistoryItem[] = stored ? JSON.parse(stored) : [];
      return history.length > 0 ? history[0] : null;
    } catch (error) {
      log.error('Error getting most recent history item', error);
      return null;
    }
  },
};

// ──────────────────────────────────────────────────────
// Stats Header Component
// ──────────────────────────────────────────────────────
interface StatsProps {
  totalChecks: number;
  violationsFound: number;
  estimatedSaved: number;
}

const StatsHeader: React.FC<StatsProps> = ({ totalChecks, violationsFound, estimatedSaved }) => (
  <View style={styles.statsCard}>
    <View style={styles.statItem}>
      <MaterialCommunityIcons name="map-marker-check" size={20} color={colors.primary} />
      <Text style={styles.statValue}>{totalChecks}</Text>
      <Text style={styles.statLabel}>Checks</Text>
    </View>
    <View style={styles.statDivider} />
    <View style={styles.statItem}>
      <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.warning} />
      <Text style={styles.statValue}>{violationsFound}</Text>
      <Text style={styles.statLabel}>Alerts</Text>
    </View>
    <View style={styles.statDivider} />
    <View style={styles.statItem}>
      <MaterialCommunityIcons name="piggy-bank-outline" size={20} color={colors.success} />
      <Text style={[styles.statValue, styles.statHighlight]}>
        ~${estimatedSaved}
      </Text>
      <Text style={styles.statLabel}>Saved</Text>
    </View>
  </View>
);

interface CameraSpeedRowProps {
  item: CameraPassHistoryItem;
}

const CameraSpeedRow: React.FC<CameraSpeedRowProps> = ({ item }) => {
  const speedText = item.userSpeedMph != null ? `${Math.round(item.userSpeedMph)} mph` : 'Unknown';
  const expectedText = item.expectedSpeedMph != null ? `${Math.round(item.expectedSpeedMph)} mph` : 'N/A';
  const overBy = item.speedDeltaMph != null ? Math.round(item.speedDeltaMph) : null;
  const overColor =
    overBy == null ? colors.textSecondary : overBy > 0 ? colors.error : colors.success;

  return (
    <View style={styles.cameraSpeedCard}>
      <View style={styles.cameraSpeedHeader}>
        <Text style={styles.cameraSpeedType}>
          {item.cameraType === 'speed' ? 'Speed Camera' : 'Red Light Camera'}
        </Text>
        <Text style={styles.cameraSpeedTime}>
          {formatDate(item.timestamp)} {formatTime(item.timestamp)}
        </Text>
      </View>
      <Text style={styles.cameraSpeedAddress}>{item.cameraAddress}</Text>
      <View style={styles.cameraSpeedMetrics}>
        <View style={styles.cameraSpeedMetric}>
          <Text style={styles.cameraSpeedMetricLabel}>Your speed</Text>
          <Text style={styles.cameraSpeedMetricValue}>{speedText}</Text>
        </View>
        <View style={styles.cameraSpeedMetric}>
          <Text style={styles.cameraSpeedMetricLabel}>Expected</Text>
          <Text style={styles.cameraSpeedMetricValue}>{expectedText}</Text>
        </View>
        <View style={styles.cameraSpeedMetric}>
          <Text style={styles.cameraSpeedMetricLabel}>Delta</Text>
          <Text style={[styles.cameraSpeedMetricValue, { color: overColor }]}>
            {overBy == null ? 'N/A' : overBy > 0 ? `+${overBy} mph` : `${overBy} mph`}
          </Text>
        </View>
      </View>
    </View>
  );
};

interface RedLightReceiptRowProps {
  item: RedLightReceipt;
}

const RedLightReceiptRow: React.FC<RedLightReceiptRowProps> = ({ item }) => {
  const approach = item.approachSpeedMph != null ? `${Math.round(item.approachSpeedMph)} mph` : 'Unknown';
  const minSpeed = item.minSpeedMph != null ? `${Math.round(item.minSpeedMph)} mph` : 'Unknown';
  const uncertainty = item.estimatedSpeedAccuracyMph != null ? `±${item.estimatedSpeedAccuracyMph.toFixed(1)} mph` : 'N/A';
  const stopText = item.fullStopDetected && item.fullStopDurationSec != null
    ? `Stopped ${item.fullStopDurationSec.toFixed(1)}s`
    : 'No full stop detected';
  const timeline = RedLightReceiptService.buildTimelineSummary(item);

  return (
    <View style={styles.cameraSpeedCard}>
      <View style={styles.cameraSpeedHeader}>
        <Text style={styles.cameraSpeedType}>Red Light Receipt</Text>
        <Text style={styles.cameraSpeedTime}>
          {formatDate(item.deviceTimestamp)} {formatTime(item.deviceTimestamp)}
        </Text>
      </View>
      <Text style={styles.cameraSpeedAddress}>{item.cameraAddress}</Text>
      <Text style={styles.redLightTimelineText}>{timeline}</Text>
      <View style={styles.cameraSpeedMetrics}>
        <View style={styles.cameraSpeedMetric}>
          <Text style={styles.cameraSpeedMetricLabel}>Approach</Text>
          <Text style={styles.cameraSpeedMetricValue}>{approach}</Text>
        </View>
        <View style={styles.cameraSpeedMetric}>
          <Text style={styles.cameraSpeedMetricLabel}>Min speed</Text>
          <Text style={styles.cameraSpeedMetricValue}>{minSpeed}</Text>
        </View>
        <View style={styles.cameraSpeedMetric}>
          <Text style={styles.cameraSpeedMetricLabel}>Accuracy</Text>
          <Text style={styles.cameraSpeedMetricValue}>{uncertainty}</Text>
        </View>
      </View>
      <Text style={styles.redLightStopText}>{stopText}</Text>
    </View>
  );
};

// ──────────────────────────────────────────────────────
// Timeline Item Component
// ──────────────────────────────────────────────────────
interface TimelineItemProps {
  item: ParkingHistoryItem;
  isExpanded: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const TimelineItem: React.FC<TimelineItemProps> = ({
  item,
  isExpanded,
  isFirst,
  isLast,
  onPress,
  onLongPress,
}) => {
  const hasViolations = item.rules.length > 0;
  const hasCritical = item.rules.some(r => r.severity === 'critical');

  const dotColor = hasCritical
    ? colors.error
    : hasViolations
      ? colors.warning
      : colors.success;

  return (
    <TouchableOpacity
      style={styles.timelineRow}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Parking check at ${item.address || 'saved location'}. ${hasViolations ? `${item.rules.length} issues found` : 'Clear'}`}
      accessibilityHint={isExpanded ? 'Tap to collapse. Hold to delete.' : 'Tap to expand. Hold to delete.'}
    >
      {/* Timeline spine */}
      <View style={styles.timelineSpine}>
        {!isFirst && <View style={[styles.timelineLine, styles.timelineLineTop]} />}
        <View style={[styles.timelineDot, { backgroundColor: dotColor }]}>
          <MaterialCommunityIcons
            name={hasViolations ? 'alert' : 'check'}
            size={10}
            color={colors.white}
          />
        </View>
        {!isLast && <View style={[styles.timelineLine, styles.timelineLineBottom]} />}
      </View>

      {/* Content card */}
      <View style={[styles.timelineCard, isExpanded && styles.timelineCardExpanded]}>
        <View style={styles.timelineHeader}>
          <View style={styles.timelineDateWrap}>
            <Text style={styles.timelineTime}>{formatTime(item.timestamp)}</Text>
            <Text style={styles.timelineDate}>{formatDate(item.timestamp)}</Text>
          </View>
          <StatusBadge
            text={hasViolations ? `${item.rules.length} issue${item.rules.length > 1 ? 's' : ''}` : 'Clear'}
            variant={hasCritical ? 'error' : hasViolations ? 'warning' : 'success'}
          />
        </View>

        <View style={styles.timelineAddress}>
          <MaterialCommunityIcons name="map-marker" size={14} color={colors.textTertiary} />
          <Text style={styles.timelineAddressText} numberOfLines={isExpanded ? 3 : 1}>
            {item.address || `${item.coords.latitude.toFixed(4)}, ${item.coords.longitude.toFixed(4)}`}
          </Text>
        </View>

        {/* Expanded: rules */}
        {isExpanded && item.rules.length > 0 && (
          <View style={styles.timelineRules}>
            {item.rules.map((rule, index) => (
              <RuleCard key={index} rule={rule} />
            ))}
          </View>
        )}

        {isExpanded && item.rules.length === 0 && (
          <View style={styles.timelineClear}>
            <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
            <Text style={styles.timelineClearText}>No parking restrictions found</Text>
          </View>
        )}

        {/* Expanded: departure record */}
        {isExpanded && item.departure && (
          <View style={styles.departureSection}>
            <View style={styles.departureRow}>
              <MaterialCommunityIcons
                name={item.departure.isConclusive ? 'location-exit' : 'map-marker-radius'}
                size={16}
                color={item.departure.isConclusive ? colors.success : colors.warning}
              />
              <View style={styles.departureInfo}>
                <Text style={styles.departureText}>
                  Left at {formatTime(item.departure.confirmedAt)}
                </Text>
                <Text style={[
                  styles.departureStatus,
                  { color: item.departure.isConclusive ? colors.success : colors.warning },
                ]}>
                  {item.departure.isConclusive
                    ? 'GPS-verified departure'
                    : 'Still near parking spot'}
                </Text>
              </View>
            </View>
            <Text style={styles.departureExplainer}>
              Departure records help you contest unfair tickets by proving when you left.
            </Text>
          </View>
        )}

        {/* Expanded: no departure data */}
        {isExpanded && !item.departure && (
          <View style={styles.noDepartureRow}>
            <MaterialCommunityIcons name="car-off" size={14} color={colors.textTertiary} />
            <Text style={styles.noDepartureText}>Departure not recorded</Text>
          </View>
        )}

        {/* Expanded: action buttons (map + share) */}
        {isExpanded && (
          <View style={styles.historyActions}>
            <TouchableOpacity
              style={styles.historyActionBtn}
              onPress={() => {
                const { latitude, longitude } = item.coords;
                const url = Platform.select({
                  ios: `http://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(item.address || 'Parking spot')}`,
                  android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodeURIComponent(item.address || 'Parking spot')})`,
                });
                if (url) Linking.openURL(url).catch((e) => log.debug('Failed to open maps URL', e));
              }}
            >
              <MaterialCommunityIcons name="map-outline" size={14} color={colors.primary} />
              <Text style={styles.historyActionText}>Open in Maps</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.historyActionBtn}
              onPress={async () => {
                const status = item.rules.length > 0
                  ? `${item.rules.length} restriction${item.rules.length > 1 ? 's' : ''}`
                  : 'All clear';
                const mapUrl = `https://maps.google.com/?q=${item.coords.latitude},${item.coords.longitude}`;
                const msg = `${status} at ${item.address || 'my parking spot'} (${formatDate(item.timestamp)} ${formatTime(item.timestamp)})\n${mapUrl}`;
                try { await Share.share({ message: msg }); } catch { /* cancelled */ }
              }}
            >
              <MaterialCommunityIcons name="share-variant" size={14} color={colors.primary} />
              <Text style={styles.historyActionText}>Share</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Expand hint */}
        <View style={styles.expandRow}>
          <MaterialCommunityIcons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textTertiary}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
};

// ──────────────────────────────────────────────────────
// Formatting helpers
// ──────────────────────────────────────────────────────
const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatSectionDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
};

/** Get a date key (YYYY-MM-DD) for grouping */
const getDateKey = (timestamp: number): string => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface HistorySection {
  title: string;
  data: ParkingHistoryItem[];
}

interface CameraPassSection {
  title: string;
  data: CameraPassHistoryItem[];
}

interface RedLightReceiptSection {
  title: string;
  data: RedLightReceipt[];
}

/** Group a flat history array into sections by date */
const groupByDate = (items: ParkingHistoryItem[]): HistorySection[] => {
  const map = new Map<string, ParkingHistoryItem[]>();
  for (const item of items) {
    const key = getDateKey(item.timestamp);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  // Items are already in reverse-chronological order, so sections come out
  // in the right order (most recent date first).
  return Array.from(map.entries()).map(([, grouped]) => ({
    title: formatSectionDate(grouped[0].timestamp),
    data: grouped,
  }));
};

const groupCameraPassesByDate = (items: CameraPassHistoryItem[]): CameraPassSection[] => {
  const map = new Map<string, CameraPassHistoryItem[]>();
  for (const item of items) {
    const key = getDateKey(item.timestamp);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return Array.from(map.entries()).map(([, grouped]) => ({
    title: formatSectionDate(grouped[0].timestamp),
    data: grouped,
  }));
};

const groupRedLightReceiptsByDate = (items: RedLightReceipt[]): RedLightReceiptSection[] => {
  const map = new Map<string, RedLightReceipt[]>();
  for (const item of items) {
    const key = getDateKey(item.deviceTimestamp);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return Array.from(map.entries()).map(([, grouped]) => ({
    title: formatSectionDate(grouped[0].deviceTimestamp),
    data: grouped,
  }));
};

// ──────────────────────────────────────────────────────
// Main Screen
// ──────────────────────────────────────────────────────
const HistoryScreen: React.FC = () => {
  const navigation = useNavigation();
  const [history, setHistory] = useState<ParkingHistoryItem[]>([]);
  const [cameraPassHistory, setCameraPassHistory] = useState<CameraPassHistoryItem[]>([]);
  const [redLightReceipts, setRedLightReceipts] = useState<RedLightReceipt[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'parking' | 'camera' | 'redlight'>('parking');
  const [, setIsDeleting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const isMountedRef = useRef(true);
  const deletingIdRef = useRef<string | null>(null);
  const clearingRef = useRef(false);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const items = await ParkingHistoryService.getHistory();
      const passItems = await CameraPassHistoryService.getHistory();
      const receiptItems = await RedLightReceiptService.getReceipts();
      if (isMountedRef.current) setHistory(items);
      if (isMountedRef.current) setCameraPassHistory(passItems);
      if (isMountedRef.current) setRedLightReceipts(receiptItems);
    } catch (error) {
      log.error('Error loading history', error);
    }
  }, []);

  useEffect(() => {
    const initLoad = async () => {
      await loadHistory();
      if (isMountedRef.current) setIsInitialLoading(false);
    };
    initLoad();
  }, [loadHistory]);

  // Reload history when switching to this tab (catches background parking events)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadHistory();
    });
    return unsubscribe;
  }, [navigation, loadHistory]);

  useEffect(() => {
    const offParking = AppEvents.on('parking-history-updated', loadHistory);
    const offCamera = AppEvents.on('camera-pass-history-updated', loadHistory);
    const offRedLight = AppEvents.on('red-light-receipts-updated', loadHistory);
    return () => {
      offParking();
      offCamera();
      offRedLight();
    };
  }, [loadHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHistory();
    if (isMountedRef.current) setRefreshing(false);
  }, [loadHistory]);

  const clearAllHistory = useCallback(() => {
    if (clearingRef.current) return;
    const isParkingView = activeView === 'parking';
    const isCameraView = activeView === 'camera';
    Alert.alert(
      isParkingView ? 'Clear Parking History' : isCameraView ? 'Clear Camera Speeds' : 'Clear Red Light Receipts',
      isParkingView
        ? 'Are you sure you want to clear all parking history?'
        : isCameraView
          ? 'Are you sure you want to clear all camera speed pass history?'
          : 'Are you sure you want to clear all red-light receipt history?',
      [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          clearingRef.current = true;
          if (isMountedRef.current) setIsClearing(true);
          try {
            if (isParkingView) {
              await ParkingHistoryService.clearHistory();
              if (isMountedRef.current) setHistory([]);
            } else if (isCameraView) {
              await CameraPassHistoryService.clearHistory();
              if (isMountedRef.current) setCameraPassHistory([]);
            } else {
              await RedLightReceiptService.clearReceipts();
              if (isMountedRef.current) setRedLightReceipts([]);
            }
          } catch (error) {
            log.error('Error clearing history', error);
            if (isMountedRef.current) Alert.alert('Error', 'Failed to clear history.');
          } finally {
            clearingRef.current = false;
            if (isMountedRef.current) setIsClearing(false);
          }
        },
      },
    ]);
  }, [activeView]);

  const deleteItem = useCallback((id: string) => {
    if (deletingIdRef.current !== null) return;
    Alert.alert('Delete Entry', 'Remove this parking entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          deletingIdRef.current = id;
          if (isMountedRef.current) setIsDeleting(true);
          try {
            await ParkingHistoryService.deleteItem(id);
            if (isMountedRef.current) setHistory(prev => prev.filter(item => item.id !== id));
          } catch (error) {
            log.error('Error deleting', error);
            if (isMountedRef.current) Alert.alert('Error', 'Failed to delete.');
          } finally {
            deletingIdRef.current = null;
            if (isMountedRef.current) setIsDeleting(false);
          }
        },
      },
    ]);
  }, []);

  // Compute stats from history
  const stats = useMemo(() => {
    const violations = history.filter(item => item.rules.length > 0).length;
    return {
      totalChecks: history.length,
      violationsFound: violations,
      estimatedSaved: Math.floor(violations * Config.STATS.VIOLATION_TO_TICKET_RATE) * Config.STATS.AVERAGE_TICKET_COST,
    };
  }, [history]);

  const renderCameraEmptyState = useCallback(() => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons name="speedometer-slow" size={48} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>No camera passes yet</Text>
      <Text style={styles.emptyText}>
        Drive with camera alerts enabled and we&apos;ll capture your speed when you pass camera locations.
      </Text>
    </View>
  ), []);

  const renderRedLightEmptyState = useCallback(() => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons name="traffic-light-outline" size={48} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>No red-light receipts yet</Text>
      <Text style={styles.emptyText}>
        Drive with camera alerts enabled and we&apos;ll build a receipt timeline near red-light camera intersections.
      </Text>
    </View>
  ), []);

  // Group history items into date sections
  const sections = useMemo(() => groupByDate(history), [history]);
  const cameraSections = useMemo(
    () => groupCameraPassesByDate(cameraPassHistory),
    [cameraPassHistory]
  );
  const redLightSections = useMemo(
    () => groupRedLightReceiptsByDate(redLightReceipts),
    [redLightReceipts]
  );

  const renderTimelineItem = useCallback(({ item, index, section }: {
    item: ParkingHistoryItem;
    index: number;
    section: HistorySection;
  }) => (
    <TimelineItem
      item={item}
      isExpanded={expandedId === item.id}
      isFirst={index === 0}
      isLast={index === section.data.length - 1}
      onPress={() => setExpandedId(expandedId === item.id ? null : item.id)}
      onLongPress={() => deleteItem(item.id)}
    />
  ), [expandedId, deleteItem]);

  const renderSectionHeader = useCallback(({ section }: { section: HistorySection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  ), []);

  const renderEmptyState = useCallback(() => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons name="clock-outline" size={48} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>No history yet</Text>
      <Text style={styles.emptyText}>
        Every time you park, we'll check for restrictions and save the results here. Go park somewhere!
      </Text>
    </View>
  ), []);

  const renderHeader = useCallback(() => {
    if (history.length === 0) return null;
    return <StatsHeader {...stats} />;
  }, [history.length, stats]);

  if (isInitialLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>History</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading history...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        {((activeView === 'parking' && history.length > 0) ||
          (activeView === 'camera' && cameraPassHistory.length > 0) ||
          (activeView === 'redlight' && redLightReceipts.length > 0)) && (
          <TouchableOpacity
            onPress={clearAllHistory}
            disabled={isClearing}
            accessibilityLabel="Clear all history"
            accessibilityRole="button"
          >
            {isClearing ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} />
            )}
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.viewToggleRow}>
        <TouchableOpacity
          style={[styles.viewToggleBtn, activeView === 'parking' && styles.viewToggleBtnActive]}
          onPress={() => setActiveView('parking')}
        >
          <Text style={[styles.viewToggleText, activeView === 'parking' && styles.viewToggleTextActive]}>
            Parking
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.viewToggleBtn, activeView === 'camera' && styles.viewToggleBtnActive]}
          onPress={() => setActiveView('camera')}
        >
          <Text style={[styles.viewToggleText, activeView === 'camera' && styles.viewToggleTextActive]}>
            Camera Speeds
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.viewToggleBtn, activeView === 'redlight' && styles.viewToggleBtnActive]}
          onPress={() => setActiveView('redlight')}
        >
          <Text style={[styles.viewToggleText, activeView === 'redlight' && styles.viewToggleTextActive]}>
            Red Light
          </Text>
        </TouchableOpacity>
      </View>

      {activeView === 'parking' && history.length === 0 ? (
        <>
          {renderHeader()}
          {renderEmptyState()}
        </>
      ) : activeView === 'parking' ? (
        <SectionList
          sections={sections}
          renderItem={renderTimelineItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListHeaderComponent={renderHeader}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      ) : activeView === 'camera' && cameraPassHistory.length === 0 ? (
        renderCameraEmptyState()
      ) : activeView === 'camera' ? (
        <SectionList
          sections={cameraSections}
          renderItem={({ item }) => <CameraSpeedRow item={item} />}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      ) : redLightReceipts.length === 0 ? (
        renderRedLightEmptyState()
      ) : (
        <SectionList
          sections={redLightSections}
          renderItem={({ item }) => <RedLightReceiptRow item={item} />}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  viewToggleRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    padding: 4,
  },
  viewToggleBtn: {
    flex: 1,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  viewToggleBtnActive: {
    backgroundColor: colors.primary,
  },
  viewToggleText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    fontWeight: typography.weights.medium,
  },
  viewToggleTextActive: {
    color: colors.white,
  },
  listContent: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  // Stats header
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  statHighlight: {
    color: colors.success,
  },
  statLabel: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
  },

  // Section headers
  sectionHeader: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    paddingLeft: 32 + spacing.sm, // align with card content (past the timeline spine)
  },
  sectionHeaderText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Timeline
  timelineRow: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  timelineSpine: {
    width: 32,
    alignItems: 'center',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
  },
  timelineLineTop: {
    marginBottom: 0,
  },
  timelineLineBottom: {
    marginTop: 0,
  },
  timelineDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  timelineCard: {
    flex: 1,
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginLeft: spacing.sm,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  timelineCardExpanded: {
    ...shadows.md,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  timelineDateWrap: {},
  timelineTime: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  timelineDate: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginTop: 1,
  },
  timelineAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  timelineAddressText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  timelineRules: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  timelineClear: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  timelineClearText: {
    fontSize: typography.sizes.sm,
    color: colors.success,
    fontWeight: typography.weights.medium,
    marginLeft: spacing.sm,
  },

  // Departure
  departureSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  departureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  departureInfo: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  departureText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  departureStatus: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    marginTop: 2,
  },
  departureExplainer: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    marginLeft: spacing.sm + 16, // align with departure text (icon width + marginLeft)
  },
  noDepartureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  noDepartureText: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },

  // History item actions
  historyActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.sm,
  },
  historyActionText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colors.primary,
  },

  // Expand hint
  expandRow: {
    alignItems: 'center',
    marginTop: spacing.xs,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    padding: spacing.xxl,
    marginTop: spacing.xxl,
  },
  emptyTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sizes.base * typography.lineHeights.relaxed,
  },
  cameraSpeedCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  cameraSpeedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cameraSpeedType: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
  cameraSpeedTime: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
  },
  cameraSpeedAddress: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  cameraSpeedMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cameraSpeedMetric: {
    flex: 1,
  },
  cameraSpeedMetricLabel: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginBottom: 2,
  },
  cameraSpeedMetricValue: {
    fontSize: typography.sizes.sm,
    color: colors.textPrimary,
    fontWeight: typography.weights.semibold,
  },
  redLightTimelineText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: typography.sizes.sm * typography.lineHeights.relaxed,
  },
  redLightStopText: {
    marginTop: spacing.sm,
    fontSize: typography.sizes.sm,
    color: colors.textPrimary,
    fontWeight: typography.weights.medium,
  },
});

export default HistoryScreen;
