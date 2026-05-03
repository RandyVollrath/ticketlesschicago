import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { borderRadius, colors, shadows, spacing, typography } from '../../theme';
import type { NotificationData } from '../../services/PushNotificationService';

type BannerSeverity = NonNullable<NotificationData['severity']>;

export interface ForegroundNotificationBannerProps {
  title: string;
  body: string;
  data: NotificationData;
  onPress: () => void;
  onDismiss: () => void;
}

function getBannerVisuals(data: NotificationData): {
  accent: string;
  icon: string;
  badge: string;
  severity: BannerSeverity;
} {
  const severity: BannerSeverity = data.severity || 'info';

  if (data.type === 'sweeper_passed') {
    return { accent: colors.success, icon: 'truck-check-outline', badge: 'Spot Open', severity: 'info' };
  }
  if (data.type === 'meter_max_expiring' || data.type === 'meter_zone_active') {
    return { accent: colors.warning, icon: 'timer-alert-outline', badge: 'Meter', severity: 'warning' };
  }
  if (data.type === 'street_cleaning_reminder') {
    return { accent: colors.warning, icon: 'broom', badge: 'Street Cleaning', severity: 'warning' };
  }
  if (data.type === 'permit_reminder') {
    return { accent: '#8B5CF6', icon: 'parking', badge: 'Permit Zone', severity: 'warning' };
  }
  if (data.type === 'dot_permit_reminder') {
    return { accent: colors.error, icon: 'road-variant', badge: 'No Parking', severity: 'warning' };
  }
  if (data.type === 'snow_ban_reminder' || data.type === 'snow_ban_alert') {
    return { accent: colors.info, icon: 'weather-snowy-heavy', badge: 'Snow Route', severity };
  }
  if (data.type === 'winter_ban_reminder') {
    return { accent: '#3B82F6', icon: 'snowflake', badge: 'Winter Ban', severity: 'warning' };
  }

  return { accent: colors.primary, icon: 'bell-outline', badge: 'Autopilot', severity };
}

export default function ForegroundNotificationBanner({
  title,
  body,
  data,
  onPress,
  onDismiss,
}: ForegroundNotificationBannerProps) {
  const insets = useSafeAreaInsets();
  const visuals = getBannerVisuals(data);

  return (
    <View pointerEvents="box-none" style={[styles.container, { top: insets.top + spacing.sm }]}>
      <Pressable style={[styles.card, { borderLeftColor: visuals.accent }]} onPress={onPress}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconWrap, { backgroundColor: `${visuals.accent}18` }]}>
              <MaterialCommunityIcons name={visuals.icon as any} size={18} color={visuals.accent} />
            </View>
            <Text style={[styles.badge, { color: visuals.accent }]}>{visuals.badge}</Text>
          </View>
          <TouchableOpacity
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss alert banner"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons name="close" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.body} numberOfLines={2}>{body}</Text>
        <View style={styles.footer}>
          <Text style={styles.footerText}>Open</Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 1000,
  },
  card: {
    backgroundColor: colors.cardBg,
    borderLeftWidth: 4,
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing.base,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    ...shadows.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: borderRadius.full,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  badge: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    letterSpacing: typography.letterSpacing.wider,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    marginBottom: 4,
  },
  body: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    lineHeight: 18,
  },
  footer: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 2,
    marginTop: spacing.sm,
  },
  footerText: {
    color: colors.primary,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
  },
});
