import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, borderRadius, spacing } from '../theme';
import Icon from '../components/Icon';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusBadgeProps {
  text: string;
  variant?: BadgeVariant;
  /** MaterialCommunityIcons icon name */
  icon?: string;
}

const getVariantStyles = (variant: BadgeVariant) => {
  switch (variant) {
    case 'success':
      return {
        backgroundColor: colors.successBg,
        textColor: colors.success,
      };
    case 'warning':
      return {
        backgroundColor: colors.warningBg,
        textColor: colors.warning,
      };
    case 'error':
      return {
        backgroundColor: colors.criticalBg,
        textColor: colors.critical,
      };
    case 'info':
      return {
        backgroundColor: colors.infoBg,
        textColor: colors.info,
      };
    case 'neutral':
    default:
      return {
        backgroundColor: colors.background,
        textColor: colors.textSecondary,
      };
  }
};

const StatusBadge: React.FC<StatusBadgeProps> = ({
  text,
  variant = 'neutral',
  icon,
}) => {
  const variantStyles = getVariantStyles(variant);

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: variantStyles.backgroundColor },
      ]}
    >
      {icon && (
        <Icon
          name={icon}
          size={12}
          color={variantStyles.textColor}
          style={styles.icon}
        />
      )}
      <Text style={[styles.text, { color: variantStyles.textColor }]}>
        {text}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: spacing.xs,
  },
  text: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.fontFamily.bodySemibold,
  },
});

export default StatusBadge;
