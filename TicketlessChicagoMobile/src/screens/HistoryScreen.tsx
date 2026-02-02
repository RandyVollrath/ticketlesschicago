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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import { StatusBadge, RuleCard } from '../components';
import { ParkingRule, Coordinates } from '../services/LocationService';
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
}

const HISTORY_KEY = StorageKeys.PARKING_HISTORY;
const MAX_HISTORY_ITEMS = 50;

// Service to manage parking history
export const ParkingHistoryService = {
  async getHistory(): Promise<ParkingHistoryItem[]> {
    try {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      log.error('Error getting parking history', error);
      return [];
    }
  },

  async addToHistory(coords: Coordinates, rules: ParkingRule[], address?: string): Promise<void> {
    try {
      const history = await this.getHistory();
      const newItem: ParkingHistoryItem = {
        id: Date.now().toString(),
        coords,
        address: address || `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
        rules,
        timestamp: Date.now(),
      };

      const updated = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (error) {
      log.error('Error adding to parking history', error);
    }
  },

  async clearHistory(): Promise<void> {
    try {
      await AsyncStorage.removeItem(HISTORY_KEY);
    } catch (error) {
      log.error('Error clearing parking history', error);
    }
  },

  async deleteItem(id: string): Promise<void> {
    try {
      const history = await this.getHistory();
      const updated = history.filter(item => item.id !== id);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (error) {
      log.error('Error deleting history item', error);
    }
  },

  async updateItem(id: string, updates: Partial<ParkingHistoryItem>): Promise<void> {
    try {
      const history = await this.getHistory();
      const updated = history.map(item =>
        item.id === id ? { ...item, ...updates } : item
      );
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (error) {
      log.error('Error updating history item', error);
    }
  },

  /** Find the most recent history item (to attach departure data to) */
  async getMostRecent(): Promise<ParkingHistoryItem | null> {
    const history = await this.getHistory();
    return history.length > 0 ? history[0] : null;
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
          <View style={styles.departureRow}>
            <MaterialCommunityIcons
              name={item.departure.isConclusive ? 'location-exit' : 'map-marker-radius'}
              size={16}
              color={item.departure.isConclusive ? colors.success : colors.warning}
            />
            <View style={styles.departureInfo}>
              <Text style={styles.departureText}>
                Left at {formatTime(item.departure.confirmedAt)} ({Math.round(item.departure.distanceMeters)}m away)
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
  return Array.from(map.entries()).map(([, items]) => ({
    title: formatSectionDate(items[0].timestamp),
    data: items,
  }));
};

// ──────────────────────────────────────────────────────
// Main Screen
// ──────────────────────────────────────────────────────
const HistoryScreen: React.FC = () => {
  const navigation = useNavigation();
  const [history, setHistory] = useState<ParkingHistoryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
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
      if (isMountedRef.current) setHistory(items);
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHistory();
    if (isMountedRef.current) setRefreshing(false);
  }, [loadHistory]);

  const clearAllHistory = useCallback(() => {
    if (clearingRef.current) return;
    Alert.alert('Clear History', 'Are you sure you want to clear all parking history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          clearingRef.current = true;
          if (isMountedRef.current) setIsClearing(true);
          try {
            await ParkingHistoryService.clearHistory();
            if (isMountedRef.current) setHistory([]);
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
  }, []);

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

  // Group history items into date sections
  const sections = useMemo(() => groupByDate(history), [history]);

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
        {history.length > 0 && (
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

      {history.length === 0 ? (
        <>
          {renderHeader()}
          {renderEmptyState()}
        </>
      ) : (
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
  departureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
});

export default HistoryScreen;
