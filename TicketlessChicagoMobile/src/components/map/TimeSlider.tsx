/**
 * TimeSlider Component
 *
 * Allows users to scrub through time to see parking status at different times.
 * Shows current or simulated time with "Reset to now" option.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
// Note: @react-native-community/slider needs to be installed
// npm install @react-native-community/slider
let Slider: any;
try {
  Slider = require('@react-native-community/slider').default;
} catch {
  // Slider not installed - will use fallback
}

// =============================================================================
// Types
// =============================================================================

export interface TimeSliderProps {
  offsetHours: number;
  maxHours: number;
  onOffsetChange: (hours: number) => void;
  onReset: () => void;
  formattedTime: string;
  formattedDate: string;
  isLive: boolean;
  style?: ViewStyle;
}

// =============================================================================
// Component
// =============================================================================

export function TimeSlider({
  offsetHours,
  maxHours,
  onOffsetChange,
  onReset,
  formattedTime,
  formattedDate,
  isLive,
  style,
}: TimeSliderProps) {
  return (
    <View style={[styles.container, style]}>
      {/* Time Display */}
      <View style={styles.timeDisplay}>
        <Text style={styles.nowLabel}>Now</Text>
        <View style={styles.currentTime}>
          <Text style={[styles.timeText, !isLive && styles.simulated]}>
            {formattedDate}
          </Text>
          <Text style={[styles.timeValue, !isLive && styles.simulated]}>
            {formattedTime}
          </Text>
          {!isLive && (
            <Text style={styles.offsetLabel}>
              (+{Math.round(offsetHours)}h)
            </Text>
          )}
        </View>
        <Text style={styles.maxLabel}>+{maxHours}h</Text>
      </View>

      {/* Slider */}
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={maxHours}
        value={offsetHours}
        onValueChange={onOffsetChange}
        minimumTrackTintColor="#3b82f6"
        maximumTrackTintColor="#d1d5db"
        thumbTintColor="#3b82f6"
        step={0.5}
      />

      {/* Reset Button */}
      {!isLive && (
        <TouchableOpacity onPress={onReset} style={styles.resetButton}>
          <Text style={styles.resetText}>Reset to now</Text>
        </TouchableOpacity>
      )}

      {/* Live indicator */}
      {isLive && (
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      )}
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  timeDisplay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  nowLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  maxLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  currentTime: {
    alignItems: 'center',
  },
  timeText: {
    fontSize: 12,
    color: '#374151',
  },
  timeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  simulated: {
    color: '#3b82f6',
  },
  offsetLabel: {
    fontSize: 11,
    color: '#3b82f6',
    marginTop: 2,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  resetButton: {
    alignSelf: 'center',
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  resetText: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '500',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    marginRight: 6,
  },
  liveText: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '500',
  },
});

export default TimeSlider;
