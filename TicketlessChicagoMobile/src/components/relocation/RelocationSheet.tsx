/**
 * Relocation Sheet Component
 *
 * Bottom sheet showing safe parking suggestions nearby.
 * Shows both street parking and garage options.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {
  relocationService,
  RelocationSuggestion,
} from '../../services/relocation/RelocationService';

// =============================================================================
// Types
// =============================================================================

export interface RelocationSheetProps {
  visible: boolean;
  currentLocation: { latitude: number; longitude: number };
  onClose: () => void;
  onNavigate: (suggestion: RelocationSuggestion) => void;
}

type FilterType = 'all' | 'street' | 'garage';

// =============================================================================
// Component
// =============================================================================

export function RelocationSheet({
  visible,
  currentLocation,
  onClose,
  onNavigate,
}: RelocationSheetProps) {
  const [suggestions, setSuggestions] = useState<RelocationSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      loadSuggestions();
    }
  }, [visible, currentLocation]);

  const loadSuggestions = async () => {
    setLoading(true);
    setError(null);

    try {
      const results = await relocationService.findSafeParking(
        currentLocation,
        { permits: [] },
        {
          maxDistance: 800, // ~0.5 miles
          minSafeHours: 2,
          includeGarages: true,
        }
      );
      setSuggestions(results);
    } catch (err) {
      setError('Failed to load parking suggestions');
      console.error('[RelocationSheet] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredSuggestions = suggestions.filter(
    (s) => filter === 'all' || s.parkingType === filter
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.handle} />
            <Text style={styles.title}>Safe Parking Nearby</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Filter buttons */}
          <View style={styles.filters}>
            <FilterButton
              label="All"
              active={filter === 'all'}
              onPress={() => setFilter('all')}
            />
            <FilterButton
              label="Street"
              active={filter === 'street'}
              onPress={() => setFilter('street')}
            />
            <FilterButton
              label="Garage"
              active={filter === 'garage'}
              onPress={() => setFilter('garage')}
            />
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text style={styles.loadingText}>Finding safe parking...</Text>
            </View>
          ) : error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={loadSuggestions}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : filteredSuggestions.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🅿️</Text>
              <Text style={styles.emptyText}>
                No safe parking found within 0.5 miles.
              </Text>
              <Text style={styles.emptySubtext}>
                Try expanding your search or check a different time.
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredSuggestions}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <SuggestionCard
                  suggestion={item}
                  onNavigate={() => onNavigate(item)}
                />
              )}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// =============================================================================
// Filter Button
// =============================================================================

interface FilterButtonProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function FilterButton({ label, active, onPress }: FilterButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.filterButton, active && styles.filterButtonActive]}
      onPress={onPress}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// =============================================================================
// Suggestion Card
// =============================================================================

interface SuggestionCardProps {
  suggestion: RelocationSuggestion;
  onNavigate: () => void;
}

function SuggestionCard({ suggestion, onNavigate }: SuggestionCardProps) {
  const scoreColor = getScoreColor(suggestion.score);

  return (
    <TouchableOpacity style={styles.card} onPress={onNavigate}>
      <View style={styles.cardLeft}>
        {/* Icon */}
        <Text style={styles.cardIcon}>
          {suggestion.parkingType === 'garage' ? '🏢' : '🅿️'}
        </Text>

        {/* Details */}
        <View style={styles.cardDetails}>
          <Text style={styles.cardAddress} numberOfLines={1}>
            {suggestion.address}
          </Text>

          <Text style={styles.cardDistance}>
            {Math.round(suggestion.distance)}m • {suggestion.walkingTime} min walk
          </Text>

          {/* Street parking info */}
          {suggestion.parkingType === 'street' && suggestion.safeUntil && (
            <Text style={styles.cardSafeUntil}>
              ✓ Safe until {formatTime(suggestion.safeUntil)}
              {suggestion.safeForHours && ` (${suggestion.safeForHours.toFixed(1)}h)`}
            </Text>
          )}

          {/* Garage info */}
          {suggestion.parkingType === 'garage' && suggestion.garageInfo && (
            <View style={styles.garageInfo}>
              <Text style={styles.garageName}>{suggestion.garageInfo.name}</Text>
              {suggestion.garageInfo.hourlyRate && (
                <Text style={styles.garageRate}>
                  ${suggestion.garageInfo.hourlyRate}/hr
                  {suggestion.garageInfo.dailyMax && ` (max $${suggestion.garageInfo.dailyMax}/day)`}
                </Text>
              )}
              {suggestion.garageInfo.availability && (
                <Text
                  style={[
                    styles.garageAvailability,
                    suggestion.garageInfo.availability === 'available' &&
                      styles.availabilityGood,
                    suggestion.garageInfo.availability === 'limited' &&
                      styles.availabilityLimited,
                    suggestion.garageInfo.availability === 'full' &&
                      styles.availabilityFull,
                  ]}
                >
                  {suggestion.garageInfo.availability === 'available'
                    ? '● Available'
                    : suggestion.garageInfo.availability === 'limited'
                      ? '● Limited'
                      : '● Full'}
                </Text>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Score and navigate */}
      <View style={styles.cardRight}>
        <View style={[styles.scoreBadge, { backgroundColor: scoreColor }]}>
          <Text style={styles.scoreText}>{suggestion.score}</Text>
        </View>
        <Text style={styles.navigateIcon}>→</Text>
      </View>
    </TouchableOpacity>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e'; // Green
  if (score >= 60) return '#eab308'; // Yellow
  if (score >= 40) return '#f97316'; // Orange
  return '#ef4444'; // Red
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: '50%',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#d1d5db',
    borderRadius: 2,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    top: 28,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#3b82f6',
  },
  filters: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  filterButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
  },
  filterButtonActive: {
    backgroundColor: '#3b82f6',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 12,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    color: '#6b7280',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 15,
    color: '#ef4444',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 24,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardLeft: {
    flex: 1,
    flexDirection: 'row',
  },
  cardIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  cardDetails: {
    flex: 1,
  },
  cardAddress: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  cardDistance: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  cardSafeUntil: {
    fontSize: 13,
    color: '#059669',
    marginTop: 4,
    fontWeight: '500',
  },
  garageInfo: {
    marginTop: 4,
  },
  garageName: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  garageRate: {
    fontSize: 12,
    color: '#6b7280',
  },
  garageAvailability: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  availabilityGood: {
    color: '#059669',
  },
  availabilityLimited: {
    color: '#f59e0b',
  },
  availabilityFull: {
    color: '#ef4444',
  },
  cardRight: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  scoreBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  navigateIcon: {
    fontSize: 20,
    color: '#9ca3af',
    marginTop: 4,
  },
});

export default RelocationSheet;
