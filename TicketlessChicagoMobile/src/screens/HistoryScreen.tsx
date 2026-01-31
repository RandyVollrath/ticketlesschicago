import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import { StatusBadge, RuleCard } from '../components';
import { ParkingRule, Coordinates } from '../services/LocationService';
import Logger from '../utils/Logger';
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

      // Add to beginning, limit size
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

const HistoryScreen: React.FC = () => {
  const [history, setHistory] = useState<ParkingHistoryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Refs to prevent memory leaks and race conditions
  const isMountedRef = useRef(true);
  const deletingIdRef = useRef<string | null>(null);
  const clearingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const items = await ParkingHistoryService.getHistory();
      if (isMountedRef.current) {
        setHistory(items);
      }
    } catch (error) {
      log.error('Error loading history', error);
    }
  }, []);

  useEffect(() => {
    const initLoad = async () => {
      await loadHistory();
      if (isMountedRef.current) {
        setIsInitialLoading(false);
      }
    };
    initLoad();
  }, [loadHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHistory();
    if (isMountedRef.current) {
      setRefreshing(false);
    }
  }, [loadHistory]);

  const clearAllHistory = useCallback(() => {
    if (clearingRef.current) return;

    Alert.alert(
      'Clear History',
      'Are you sure you want to clear all parking history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            clearingRef.current = true;
            if (isMountedRef.current) setIsClearing(true);
            try {
              await ParkingHistoryService.clearHistory();
              if (isMountedRef.current) {
                setHistory([]);
              }
            } catch (error) {
              log.error('Error clearing history', error);
              if (isMountedRef.current) {
                Alert.alert('Error', 'Failed to clear history. Please try again.');
              }
            } finally {
              clearingRef.current = false;
              if (isMountedRef.current) {
                setIsClearing(false);
              }
            }
          },
        },
      ]
    );
  }, []);

  const deleteItem = useCallback((id: string) => {
    // Use ref to prevent concurrent deletes
    if (deletingIdRef.current !== null) return;

    Alert.alert(
      'Delete Entry',
      'Remove this parking entry from history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            deletingIdRef.current = id;
            if (isMountedRef.current) setIsDeleting(true);
            try {
              await ParkingHistoryService.deleteItem(id);
              if (isMountedRef.current) {
                setHistory(prev => prev.filter(item => item.id !== id));
              }
            } catch (error) {
              log.error('Error deleting history item', error);
              if (isMountedRef.current) {
                Alert.alert('Error', 'Failed to delete entry. Please try again.');
              }
            } finally {
              deletingIdRef.current = null;
              if (isMountedRef.current) {
                setIsDeleting(false);
              }
            }
          },
        },
      ]
    );
  }, []);

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

  const formatCoords = (coords: Coordinates): string => {
    return `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
  };

  const renderHistoryItem = useCallback(({ item }: { item: ParkingHistoryItem }) => {
    const isExpanded = expandedId === item.id;
    const hasViolations = item.rules.length > 0;
    const hasCritical = item.rules.some(r => r.severity === 'critical');
    const statusText = hasViolations
      ? `${item.rules.length} parking issue${item.rules.length > 1 ? 's' : ''} found`
      : 'No restrictions';

    return (
      <TouchableOpacity
        style={styles.historyCard}
        onPress={() => setExpandedId(isExpanded ? null : item.id)}
        onLongPress={() => deleteItem(item.id)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Parking check from ${formatDate(item.timestamp)} at ${formatTime(item.timestamp)}. ${item.address || 'Location saved'}. ${statusText}`}
        accessibilityHint={isExpanded ? 'Tap to collapse details. Long press to delete.' : 'Tap to expand details. Long press to delete.'}
        accessibilityState={{ expanded: isExpanded }}
      >
        <View style={styles.historyHeader}>
          <View style={styles.dateContainer}>
            <Text style={styles.date}>{formatDate(item.timestamp)}</Text>
            <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
          </View>
          <StatusBadge
            text={hasViolations ? `${item.rules.length} issue${item.rules.length > 1 ? 's' : ''}` : 'Clear'}
            variant={hasCritical ? 'error' : hasViolations ? 'warning' : 'success'}
            icon={hasViolations ? '⚠️' : '✓'}
          />
        </View>

        <Text style={styles.coords} numberOfLines={2}>
          📍 {item.address || formatCoords(item.coords)}
        </Text>

        {isExpanded && item.rules.length > 0 && (
          <View style={styles.rulesContainer}>
            {item.rules.map((rule, index) => (
              <RuleCard key={index} rule={rule} />
            ))}
          </View>
        )}

        {isExpanded && item.rules.length === 0 && (
          <View style={styles.clearContainer}>
            <Text style={styles.clearText}>No parking restrictions found</Text>
          </View>
        )}

        {isExpanded && item.departure && (
          <View style={styles.departureContainer}>
            <Text style={styles.departureTitle}>Departure Record</Text>
            <Text style={styles.departureText}>
              You were {Math.round(item.departure.distanceMeters)}m from your parking spot at {formatTime(item.departure.confirmedAt)}
            </Text>
            <Text style={[
              styles.departureStatus,
              { color: item.departure.isConclusive ? colors.success : colors.warning }
            ]}>
              {item.departure.isConclusive
                ? 'GPS-verified proof you left this spot'
                : 'Recorded but you were still near your car'}
            </Text>
          </View>
        )}

        <Text style={styles.expandHint}>
          {isExpanded ? 'Tap to collapse' : 'Tap for details • Hold to delete'}
        </Text>
      </TouchableOpacity>
    );
  }, [expandedId, deleteItem]);

  const renderEmptyState = useCallback(() => (
    <View style={styles.emptyState} accessibilityRole="text">
      <Text style={styles.emptyIcon}>📋</Text>
      <Text style={styles.emptyTitle}>No Parking History</Text>
      <Text style={styles.emptyText}>
        Your parking check history will appear here. Each time you check a
        location or disconnect from your car, it will be saved.
      </Text>
    </View>
  ), []);

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
              <Text style={styles.clearButton}>Clear All</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={history}
        renderItem={renderHistoryItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={renderEmptyState}
        showsVerticalScrollIndicator={false}
      />
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
  clearButton: {
    fontSize: typography.sizes.base,
    color: colors.error,
    fontWeight: typography.weights.medium,
  },
  listContent: {
    padding: spacing.base,
    paddingTop: spacing.sm,
  },
  historyCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  dateContainer: {
    flex: 1,
  },
  date: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  time: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  coords: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  rulesContainer: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clearContainer: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clearText: {
    fontSize: typography.sizes.base,
    color: colors.success,
    fontWeight: typography.weights.medium,
  },
  departureContainer: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  departureTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  departureText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  departureStatus: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
  },
  expandHint: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xxl,
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
  },
  emptyText: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sizes.base * typography.lineHeights.relaxed,
  },
});

export default HistoryScreen;
