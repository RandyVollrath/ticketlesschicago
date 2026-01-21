import { StyleSheet, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// Brand Colors - Autopilot America (Gemini 3 Flash recommended)
export const colors = {
  // Primary - Vibrant Electric Blue
  primary: '#0066FF',
  primaryDark: '#004DCC',
  primaryLight: '#3388FF',
  primaryTint: '#F0F6FF', // Light blue tint for secondary buttons

  // Secondary - Vibrant Yellow for tips/accents
  secondary: '#FFD60A',
  secondaryDark: '#E6C109',
  secondaryLight: '#FFF9DB', // Soft yellow for tip backgrounds

  // Status Colors
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  info: '#5AC8FA',

  // Severity Colors (for parking rules)
  critical: '#FF3B30',
  criticalBg: '#fff5f5',
  warningBg: '#fff8e6',
  infoBg: '#f0f8ff',
  successBg: '#f0fff4',

  // Neutrals - Cool Off-White background
  white: '#FFFFFF',
  background: '#F5F7FA',
  cardBg: '#FFFFFF',
  border: '#E9ECEF',
  divider: '#E9ECEF',

  // Text - Deep Charcoal and Muted Slate
  textPrimary: '#1A1C1E',
  textSecondary: '#6C727A',
  textTertiary: '#ADB5BD',
  textInverse: '#FFFFFF',

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.5)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',
};

// Typography - Clean, modern hierarchy
export const typography = {
  // Font Sizes
  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 22,
    xl: 24,
    xxl: 28,
    xxxl: 34,
  },

  // Font Weights (as string literals for React Native)
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },

  // Line Heights
  lineHeights: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
  },

  // Letter Spacing
  letterSpacing: {
    tight: -0.5,
    normal: 0,
    wide: 0.3,
    wider: 1.2,
  },
};

// Spacing
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
};

// Border Radius - More rounded for modern look
export const borderRadius = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  full: 9999,
};

// Shadows - Modern "Soft Depth" shadows (Gemini 3 recommended)
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 32,
    elevation: 8,
  },
  // Primary button glow effect
  primaryGlow: {
    shadowColor: '#0066FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
};

// Screen Dimensions
export const screen = {
  width,
  height,
  isSmall: width < 375,
  isMedium: width >= 375 && width < 414,
  isLarge: width >= 414,
};

// Common Styles
export const commonStyles = StyleSheet.create({
  // Containers
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.base,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Cards - Modern floating cards with soft shadows
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xxl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },

  // Typography
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.medium,
    color: colors.textSecondary,
  },
  heading: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    lineHeight: typography.sizes.base * typography.lineHeights.normal,
  },
  caption: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
  },

  // Buttons - Modern with depth (Gemini 3 recommended)
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 64,
    ...shadows.primaryGlow,
  },
  primaryButtonText: {
    color: colors.textInverse,
    fontSize: 18,
    fontWeight: typography.weights.bold,
  },
  secondaryButton: {
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
  },
  dangerButton: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  dangerButtonText: {
    color: colors.textInverse,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
  },

  // Row layouts
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.base,
  },

  // Input
  input: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
  },

  // Status badges
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  badgeText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
  },
});

// Rule severity styles
export const severityStyles = StyleSheet.create({
  criticalCard: {
    backgroundColor: colors.criticalBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.critical,
    padding: spacing.md,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },
  warningCard: {
    backgroundColor: colors.warningBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    padding: spacing.md,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },
  infoCard: {
    backgroundColor: colors.infoBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.info,
    padding: spacing.md,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },
  successCard: {
    backgroundColor: colors.successBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
    padding: spacing.md,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },
});

export default {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  screen,
  commonStyles,
  severityStyles,
};
