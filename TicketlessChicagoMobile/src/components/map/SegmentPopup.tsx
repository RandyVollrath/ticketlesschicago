/**
 * SegmentPopup Component
 *
 * Detail popup when user taps a street segment on the map.
 * Shows parking status, restrictions, and "Set reminder" button.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import {
  StreetSegment,
  ParkingStatus,
  LAYER_COLORS,
} from '../../services/parking-map/types';
import { formatRestrictionDescription } from '../../services/parking-map/compute';
import { typography, colors} from '../../theme';

// =============================================================================
// Types
// =============================================================================

export interface SegmentPopupProps {
  segment: StreetSegment;
  time: Date;
  onClose: () => void;
  onSetReminder: (segment: StreetSegment) => void;
}

// =============================================================================
// Component
// =============================================================================

export function SegmentPopup({
  segment,
  time,
  onClose,
  onSetReminder,
}: SegmentPopupProps) {
  const {
    streetName,
    blockStart,
    blockEnd,
    restrictions,
    currentStatus,
    nextChange,
    dataConfidence,
  } = segment.properties;

  /**
   * Get status display info
   */
  const getStatusDisplay = (status: ParkingStatus) => {
    switch (status) {
      case 'allowed':
        return {
          icon: '✓',
          text: 'Parking allowed',
          color: LAYER_COLORS.allowed,
          bgColor: '#dcfce7',
        };
      case 'restricted':
        return {
          icon: '✕',
          text: 'No parking',
          color: LAYER_COLORS.restricted,
          bgColor: colors.criticalBg,
        };
      case 'warning':
        return {
          icon: '⚠',
          text: 'Restriction starting soon',
          color: LAYER_COLORS.warning,
          bgColor: '#fef9c3',
        };
      default:
        return {
          icon: '?',
          text: 'Check posted signs',
          color: LAYER_COLORS.unknown,
          bgColor: colors.background,
        };
    }
  };

  const statusDisplay = getStatusDisplay(currentStatus);

  /**
   * Format next change time
   */
  const formatNextChange = () => {
    if (!nextChange) return null;

    const changeTime = new Date(nextChange.time);
    const now = new Date();
    const diffMs = changeTime.getTime() - now.getTime();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    const diffMins = Math.round(diffMs / (1000 * 60));

    let timeStr = '';
    if (diffMins < 60) {
      timeStr = `in ${diffMins} minutes`;
    } else if (diffHours < 24) {
      timeStr = `in ${diffHours} hours`;
    } else {
      timeStr = changeTime.toLocaleDateString('en-US', {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      });
    }

    const statusText =
      nextChange.toStatus === 'restricted' ? 'becomes restricted' : 'becomes available';

    return `${statusText} ${timeStr}`;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.streetName}>{streetName}</Text>
          <Text style={styles.blockRange}>
            {blockStart && blockEnd ? `${blockStart} - ${blockEnd}` : 'Block details unavailable'}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Status Banner */}
      <View style={[styles.statusBanner, { backgroundColor: statusDisplay.bgColor }]}>
        <Text style={[styles.statusIcon, { color: statusDisplay.color }]}>
          {statusDisplay.icon}
        </Text>
        <Text style={[styles.statusText, { color: statusDisplay.color }]}>
          {statusDisplay.text}
        </Text>
      </View>

      {/* Restrictions */}
      {restrictions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Restrictions</Text>
          <ScrollView style={styles.restrictionsList}>
            {restrictions.map((restriction, index) => (
              <View key={index} style={styles.restrictionItem}>
                <View style={styles.restrictionBullet} />
                <Text style={styles.restrictionText}>
                  {formatRestrictionDescription(restriction)}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Next Change */}
      {nextChange && (
        <View style={styles.nextChange}>
          <Text style={styles.nextChangeLabel}>Next change:</Text>
          <Text style={styles.nextChangeText}>{formatNextChange()}</Text>
        </View>
      )}

      {/* Confidence indicator */}
      {dataConfidence !== 'high' && (
        <Text style={styles.confidenceNote}>
          ℹ️ Data may vary within block. Check posted signs.
        </Text>
      )}

      {/* Action Button */}
      <TouchableOpacity
        onPress={() => onSetReminder(segment)}
        style={styles.reminderButton}
      >
        <Text style={styles.reminderButtonText}>🔔 Set parking reminder</Text>
      </TouchableOpacity>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 140,
    left: 16,
    right: 16,
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    maxHeight: 350,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerText: {
    flex: 1,
  },
  streetName: {
    fontSize: 18,
    fontFamily: typography.fontFamily.bodySemibold,
    color: colors.primaryDark,
  },
  blockRange: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  closeIcon: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  statusIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  statusText: {
    fontSize: 15,
    fontFamily: typography.fontFamily.bodySemibold,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: typography.fontFamily.bodySemibold,
    color: colors.textPrimary,
    marginBottom: 6,
  },
  restrictionsList: {
    maxHeight: 100,
  },
  restrictionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  restrictionBullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textTertiary,
    marginTop: 7,
    marginRight: 8,
  },
  restrictionText: {
    flex: 1,
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  nextChange: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  nextChangeLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginRight: 6,
  },
  nextChangeText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontFamily: typography.fontFamily.bodyMedium,
  },
  confidenceNote: {
    fontSize: 12,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  reminderButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  reminderButtonText: {
    color: colors.white,
    fontSize: 15,
    fontFamily: typography.fontFamily.bodySemibold,
  },
});

export default SegmentPopup;
