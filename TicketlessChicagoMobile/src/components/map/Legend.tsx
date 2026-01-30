/**
 * Legend Component
 *
 * Color legend explaining what the map colors mean.
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { LAYER_COLORS } from '../../services/parking-map/types';

// =============================================================================
// Types
// =============================================================================

export interface LegendProps {
  style?: ViewStyle;
  compact?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function Legend({ style, compact = false }: LegendProps) {
  // Enhanced legend with all status types
  const legendItems = [
    {
      color: LAYER_COLORS.allowed,
      label: 'Can park now',
      icon: '✓',
    },
    {
      color: LAYER_COLORS.restricted,
      label: 'Cannot park',
      icon: '✕',
    },
    {
      color: LAYER_COLORS.towZone,
      label: 'Tow zone',
      icon: '🚛',
    },
    {
      color: LAYER_COLORS.warning,
      label: 'Restriction soon',
      icon: '⚠',
    },
    {
      color: LAYER_COLORS.permitRequired,
      label: 'Permit required',
      icon: '🅿',
    },
    {
      color: LAYER_COLORS.metered,
      label: 'Metered parking',
      icon: '🪙',
    },
    {
      color: LAYER_COLORS.conditional,
      label: 'Snow route',
      icon: '❄',
    },
    {
      color: LAYER_COLORS.unknown,
      label: 'Check signs',
      icon: '?',
    },
  ];

  if (compact) {
    return (
      <View style={[styles.containerCompact, style]}>
        {legendItems.map((item, index) => (
          <View key={index} style={styles.itemCompact}>
            <View style={[styles.colorDotCompact, { backgroundColor: item.color }]} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {legendItems.map((item, index) => (
        <View key={index} style={styles.item}>
          <View style={[styles.colorLine, { backgroundColor: item.color }]} />
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  containerCompact: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemCompact: {
    marginHorizontal: 4,
  },
  colorLine: {
    width: 20,
    height: 4,
    borderRadius: 2,
    marginRight: 8,
  },
  colorDotCompact: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  label: {
    fontSize: 12,
    color: '#4b5563',
  },
});

export default Legend;
