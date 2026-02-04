/**
 * Legend Component
 *
 * Color legend explaining what the map colors mean.
 * Swipeable: drag down to collapse, drag up (or tap) to expand.
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
  Animated,
  PanResponder,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { LAYER_COLORS } from '../../services/parking-map/types';

// Enable LayoutAnimation on Android
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// =============================================================================
// Types
// =============================================================================

export interface LegendProps {
  style?: ViewStyle;
  compact?: boolean;
}

// =============================================================================
// Legend items
// =============================================================================

const legendItems = [
  { color: LAYER_COLORS.allowed, label: 'Can park now' },
  { color: LAYER_COLORS.restricted, label: 'Cannot park' },
  { color: LAYER_COLORS.towZone, label: 'Tow zone' },
  { color: LAYER_COLORS.warning, label: 'Restriction soon' },
  { color: LAYER_COLORS.permitRequired, label: 'Permit required' },
  { color: LAYER_COLORS.metered, label: 'Metered parking' },
  { color: LAYER_COLORS.conditional, label: '2″ Snow route' },
  { color: LAYER_COLORS.unknown, label: 'Check signs' },
];

// Threshold in px to trigger collapse/expand
const SWIPE_THRESHOLD = 30;

// =============================================================================
// Component
// =============================================================================

export function Legend({ style, compact = false }: LegendProps) {
  const [expanded, setExpanded] = useState(true);
  const translateY = useRef(new Animated.Value(0)).current;

  const toggle = useCallback(
    (toExpanded: boolean) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setExpanded(toExpanded);
      // Reset drag offset
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    },
    [translateY],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        // Never steal pinch-to-zoom (2+ fingers)
        if (gestureState.numberActiveTouches > 1) return false;
        // Only capture vertical single-finger drags (avoid interfering with map)
        return (
          Math.abs(gestureState.dy) > 8 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5
        );
      },
      onPanResponderGrant: () => {
        translateY.setOffset(0);
        translateY.setValue(0);
      },
      onPanResponderMove: (_evt, gestureState) => {
        // Clamp: allow dragging down freely, limit upward drag
        const clampedDy = Math.max(-20, gestureState.dy);
        translateY.setValue(clampedDy);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        translateY.flattenOffset();
        if (gestureState.dy > SWIPE_THRESHOLD) {
          // Swiped down -> collapse
          toggle(false);
        } else if (gestureState.dy < -SWIPE_THRESHOLD) {
          // Swiped up -> expand
          toggle(true);
        } else {
          // Snap back
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 12,
          }).start();
        }
      },
    }),
  ).current;

  // ---- Compact mode (no swipe, just dots) ----
  if (compact) {
    return (
      <View style={[styles.containerCompact, style]}>
        {legendItems.map((item, index) => (
          <View key={index} style={styles.itemCompact}>
            <View
              style={[styles.colorDotCompact, { backgroundColor: item.color }]}
            />
          </View>
        ))}
      </View>
    );
  }

  // ---- Collapsed: small pill ----
  if (!expanded) {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => toggle(true)}
        style={[styles.collapsedPill, style]}>
        <View style={styles.handle} />
        <View style={styles.collapsedRow}>
          <Text style={styles.collapsedLabel}>Map Key</Text>
          {legendItems.map((item, index) => (
            <View
              key={index}
              style={[styles.collapsedDot, { backgroundColor: item.color }]}
            />
          ))}
        </View>
      </TouchableOpacity>
    );
  }

  // ---- Expanded: full legend with drag handle ----
  return (
    <Animated.View
      style={[
        styles.container,
        style,
        { transform: [{ translateY }] },
      ]}
      {...panResponder.panHandlers}>
      {/* Drag handle */}
      <View style={styles.handleRow}>
        <View style={styles.handle} />
      </View>

      {/* Legend items */}
      {legendItems.map((item, index) => (
        <View key={index} style={styles.item}>
          <View style={[styles.colorLine, { backgroundColor: item.color }]} />
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  // --- Expanded ---
  container: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  handleRow: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  colorLine: {
    width: 20,
    height: 4,
    borderRadius: 2,
    marginRight: 8,
  },
  label: {
    fontSize: 12,
    color: '#4b5563',
  },

  // --- Collapsed pill ---
  collapsedPill: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
    alignItems: 'center',
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  collapsedLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    marginRight: 6,
  },
  collapsedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 1.5,
  },

  // --- Compact (unchanged) ---
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
  itemCompact: {
    marginHorizontal: 4,
  },
  colorDotCompact: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});

export default Legend;
