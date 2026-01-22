import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, borderRadius, spacing } from '../theme';
import { ParkingRule } from '../services/LocationService';

interface RuleCardProps {
  rule: ParkingRule;
}

const getRuleIcon = (type: ParkingRule['type']): string => {
  switch (type) {
    case 'street_cleaning':
      return '🧹';
    case 'snow_route':
      return '❄️';
    case 'permit_zone':
      return '🅿️';
    case 'winter_ban':
      return '🌙';
    case 'rush_hour':
      return '🚗';
    case 'tow_zone':
      return '🚨';
    default:
      return '⚠️';
  }
};

const getRuleLabel = (type: ParkingRule['type']): string => {
  switch (type) {
    case 'street_cleaning':
      return 'Street Cleaning';
    case 'snow_route':
      return 'Snow Route';
    case 'permit_zone':
      return 'Permit Zone';
    case 'winter_ban':
      return 'Winter Overnight Ban';
    case 'rush_hour':
      return 'Rush Hour';
    case 'tow_zone':
      return 'Tow Zone';
    default:
      return 'Parking Rule';
  }
};

const getSeverityStyle = (severity: ParkingRule['severity']) => {
  switch (severity) {
    case 'critical':
      return {
        backgroundColor: colors.criticalBg,
        borderColor: colors.critical,
        textColor: colors.critical,
      };
    case 'warning':
      return {
        backgroundColor: colors.warningBg,
        borderColor: colors.warning,
        textColor: colors.warning,
      };
    case 'info':
    default:
      return {
        backgroundColor: colors.infoBg,
        borderColor: colors.info,
        textColor: colors.info,
      };
  }
};

const RuleCard: React.FC<RuleCardProps> = ({ rule }) => {
  const severityStyle = getSeverityStyle(rule.severity);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: severityStyle.backgroundColor,
          borderLeftColor: severityStyle.borderColor,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.icon}>{getRuleIcon(rule.type)}</Text>
        <View style={styles.headerText}>
          <Text style={[styles.label, { color: severityStyle.textColor }]}>
            {getRuleLabel(rule.type)}
            {rule.zoneName ? ` - ${rule.zoneName}` : ''}
          </Text>
          {rule.isActiveNow && (
            <View style={[styles.activeBadge, { backgroundColor: severityStyle.borderColor }]}>
              <Text style={styles.activeBadgeText}>ACTIVE NOW</Text>
            </View>
          )}
        </View>
      </View>
      <Text style={styles.message}>{rule.message}</Text>
      {rule.schedule && (
        <View style={styles.scheduleRow}>
          <Text style={styles.scheduleIcon}>📅</Text>
          <Text style={styles.scheduleText}>{rule.schedule}</Text>
        </View>
      )}
      {rule.nextDate && !rule.isActiveNow && (
        <View style={styles.scheduleRow}>
          <Text style={styles.scheduleIcon}>⏰</Text>
          <Text style={styles.scheduleText}>Next: {rule.nextDate}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderLeftWidth: 4,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  headerText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  icon: {
    fontSize: typography.sizes.md,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  label: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
  },
  activeBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.xs,
  },
  activeBadgeText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.bold,
    color: colors.white,
  },
  message: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: typography.sizes.sm * typography.lineHeights.relaxed,
    marginBottom: spacing.xs,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  scheduleIcon: {
    fontSize: typography.sizes.xs,
    marginRight: spacing.xs,
  },
  scheduleText: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
  },
});

export default RuleCard;
