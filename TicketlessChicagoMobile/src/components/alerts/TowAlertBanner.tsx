/**
 * Tow Alert Banner Component
 *
 * Displays urgent parking alerts with countdown timer,
 * action buttons, and estimated costs.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { TowAlert } from '../../services/alerts/TowAlertService';

// =============================================================================
// Types
// =============================================================================

export interface TowAlertBannerProps {
  alert: TowAlert;
  onDismiss: () => void;
  onRelocate: () => void;
  onSnooze: (minutes: number) => void;
}

// =============================================================================
// Component
// =============================================================================

export function TowAlertBanner({
  alert,
  onDismiss,
  onRelocate,
  onSnooze,
}: TowAlertBannerProps) {
  const backgroundColor = {
    critical: '#dc2626', // Red
    warning: '#f59e0b', // Amber
    info: '#3b82f6', // Blue
  }[alert.severity];

  return (
    <Animated.View style={[styles.banner, { backgroundColor }]}>
      {/* Close button */}
      <TouchableOpacity style={styles.closeButton} onPress={onDismiss}>
        <Text style={styles.closeText}>×</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        {/* Alert icon */}
        <Text style={styles.icon}>
          {alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'}
        </Text>

        {/* Message */}
        <Text style={styles.message}>{alert.message}</Text>

        {/* Countdown timer */}
        {alert.deadline && (
          <CountdownTimer deadline={alert.deadline} />
        )}

        {/* Action required */}
        <Text style={styles.action}>{alert.actionRequired}</Text>

        {/* Cost estimate */}
        {(alert.estimatedFine || alert.estimatedTowCost) && (
          <View style={styles.costContainer}>
            {alert.estimatedFine && (
              <Text style={styles.cost}>Fine: ${alert.estimatedFine}</Text>
            )}
            {alert.estimatedTowCost && (
              <Text style={styles.cost}>+ ${alert.estimatedTowCost} tow fee</Text>
            )}
          </View>
        )}
      </View>

      {/* Buttons */}
      <View style={styles.buttons}>
        <TouchableOpacity style={styles.relocateButton} onPress={onRelocate}>
          <Text style={styles.relocateText}>Find Safe Parking →</Text>
        </TouchableOpacity>

        {alert.severity !== 'critical' && (
          <TouchableOpacity
            style={styles.snoozeButton}
            onPress={() => onSnooze(15)}
          >
            <Text style={styles.snoozeText}>Remind in 15 min</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

// =============================================================================
// Countdown Timer Subcomponent
// =============================================================================

interface CountdownTimerProps {
  deadline: Date;
}

function CountdownTimer({ deadline }: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(
    deadline.getTime() - Date.now()
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(deadline.getTime() - Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline]);

  if (remaining <= 0) {
    return (
      <View style={styles.countdownExpired}>
        <Text style={styles.countdownExpiredText}>TIME'S UP!</Text>
      </View>
    );
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const isUrgent = minutes < 5;

  return (
    <View style={[styles.countdown, isUrgent && styles.countdownUrgent]}>
      <Text style={[styles.countdownText, isUrgent && styles.countdownUrgentText]}>
        {minutes}:{seconds.toString().padStart(2, '0')}
      </Text>
      {isUrgent && <Text style={styles.urgentLabel}>MOVE NOW!</Text>}
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  banner: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 1,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 22,
  },
  content: {
    padding: 16,
    paddingTop: 20,
    alignItems: 'center',
  },
  icon: {
    fontSize: 32,
    marginBottom: 8,
  },
  message: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  action: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  countdown: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  countdownUrgent: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  countdownText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  countdownUrgentText: {
    fontSize: 28,
  },
  countdownExpired: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  countdownExpiredText: {
    color: '#dc2626',
    fontSize: 18,
    fontWeight: '700',
  },
  urgentLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  costContainer: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  cost: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 13,
    fontWeight: '500',
  },
  buttons: {
    flexDirection: 'column',
    padding: 12,
    paddingTop: 0,
    gap: 8,
  },
  relocateButton: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  relocateText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
  },
  snoozeButton: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  snoozeText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 13,
  },
});

export default TowAlertBanner;
