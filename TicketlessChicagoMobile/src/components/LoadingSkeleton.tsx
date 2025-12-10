/**
 * LoadingSkeleton Component
 *
 * Provides skeleton loading states for various UI elements.
 * Creates a shimmer animation effect while content is loading.
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ViewStyle, Easing, DimensionValue } from 'react-native';
import { colors, spacing, borderRadius } from '../theme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * Basic skeleton element with shimmer animation
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius: radius = borderRadius.sm,
  style,
}) => {
  const shimmerValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const shimmerAnimation = Animated.loop(
      Animated.timing(shimmerValue, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    shimmerAnimation.start();

    return () => shimmerAnimation.stop();
  }, [shimmerValue]);

  const translateX = shimmerValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  return (
    <View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius: radius,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.shimmer,
          {
            transform: [{ translateX }],
          },
        ]}
      />
    </View>
  );
};

/**
 * Card skeleton with typical content layout
 */
export const CardSkeleton: React.FC<{ style?: ViewStyle }> = ({ style }) => (
  <View style={[styles.cardSkeleton, style]}>
    <Skeleton width="60%" height={16} style={styles.marginBottom} />
    <Skeleton width="100%" height={12} style={styles.marginBottomSm} />
    <Skeleton width="80%" height={12} style={styles.marginBottomSm} />
    <Skeleton width="40%" height={12} />
  </View>
);

/**
 * List item skeleton
 */
export const ListItemSkeleton: React.FC<{ style?: ViewStyle }> = ({ style }) => (
  <View style={[styles.listItemSkeleton, style]}>
    <Skeleton width={40} height={40} borderRadius={20} />
    <View style={styles.listItemContent}>
      <Skeleton width="70%" height={14} style={styles.marginBottomSm} />
      <Skeleton width="50%" height={12} />
    </View>
  </View>
);

/**
 * Parking check result skeleton
 */
export const ParkingResultSkeleton: React.FC<{ style?: ViewStyle }> = ({ style }) => (
  <View style={[styles.cardSkeleton, style]}>
    {/* Header */}
    <View style={styles.parkingHeader}>
      <Skeleton width={24} height={24} borderRadius={12} />
      <View style={styles.parkingHeaderText}>
        <Skeleton width="80%" height={14} style={styles.marginBottomSm} />
        <Skeleton width="50%" height={10} />
      </View>
    </View>
    {/* Rules */}
    <View style={styles.parkingRules}>
      <Skeleton width="100%" height={60} borderRadius={borderRadius.md} style={styles.marginBottomSm} />
      <Skeleton width="100%" height={60} borderRadius={borderRadius.md} />
    </View>
  </View>
);

/**
 * Profile screen skeleton
 */
export const ProfileSkeleton: React.FC = () => (
  <View style={styles.profileContainer}>
    {/* Account section */}
    <CardSkeleton style={styles.marginBottom} />
    {/* Stats section */}
    <View style={[styles.cardSkeleton, styles.marginBottom]}>
      <View style={styles.statsRow}>
        <Skeleton width={60} height={40} />
        <Skeleton width={60} height={40} />
        <Skeleton width={60} height={40} />
      </View>
    </View>
    {/* Settings sections */}
    <CardSkeleton style={styles.marginBottom} />
    <CardSkeleton />
  </View>
);

/**
 * History list skeleton
 */
export const HistorySkeleton: React.FC = () => (
  <View>
    {[1, 2, 3, 4].map((i) => (
      <ListItemSkeleton key={i} style={styles.marginBottom} />
    ))}
  </View>
);

/**
 * Home screen skeleton
 */
export const HomeSkeleton: React.FC = () => (
  <View style={styles.homeContainer}>
    {/* Header */}
    <View style={styles.homeHeader}>
      <Skeleton width="40%" height={16} style={styles.marginBottomSm} />
      <Skeleton width="70%" height={28} />
    </View>
    {/* Main button */}
    <Skeleton width="100%" height={56} borderRadius={borderRadius.lg} style={styles.marginBottom} />
    {/* Cards */}
    <CardSkeleton style={styles.marginBottom} />
    <CardSkeleton style={styles.marginBottom} />
    <ParkingResultSkeleton />
  </View>
);

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  shimmer: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.cardBg,
    opacity: 0.5,
  },
  cardSkeleton: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  listItemSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  listItemContent: {
    flex: 1,
    marginLeft: spacing.md,
  },
  marginBottom: {
    marginBottom: spacing.md,
  },
  marginBottomSm: {
    marginBottom: spacing.sm,
  },
  parkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  parkingHeaderText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  parkingRules: {
    marginTop: spacing.sm,
  },
  profileContainer: {
    padding: spacing.base,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
  },
  homeContainer: {
    padding: spacing.base,
  },
  homeHeader: {
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
});

export default {
  Skeleton,
  CardSkeleton,
  ListItemSkeleton,
  ParkingResultSkeleton,
  ProfileSkeleton,
  HistorySkeleton,
  HomeSkeleton,
};
