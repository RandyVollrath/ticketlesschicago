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
      return '🚫';
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
      return 'Winter Ban';
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
        <Text style={[styles.label, { color: severityStyle.textColor }]}>
          {getRuleLabel(rule.type)}
        </Text>
      </View>
      <Text style={styles.message}>{rule.message}</Text>
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
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  icon: {
    fontSize: typography.sizes.md,
    marginRight: spacing.sm,
  },
  label: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
  },
  message: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: typography.sizes.sm * typography.lineHeights.relaxed,
  },
});

export default RuleCard;
