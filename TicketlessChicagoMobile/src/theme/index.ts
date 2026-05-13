import { StyleSheet, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// Brand Colors - Autopilot America (matched to autopilotamerica.com web palette)
export const colors = {
  // Primary - Regulatory Blue (web: #2563EB / navy #0F172A)
  primary: '#2563EB',
  primaryDark: '#0F172A',
  primaryLight: '#3B82F6',
  primaryTint: '#EFF6FF', // Light blue tint for secondary buttons

  // Secondary - retained yellow for tip backgrounds only (SettingsScreen)
  // Not a brand color; do not extend to new surfaces.
  secondary: '#FFD60A',
  secondaryDark: '#E6C109',
  secondaryLight: '#FFF9DB',

  // Status Colors (web: emerald/orange/red)
  success: '#10B981',
  warning: '#F97316',
  error: '#EF4444',
  info: '#3B82F6',

  // Severity Colors (for parking rules) — tinted versions of status colors
  critical: '#EF4444',
  criticalBg: '#FEE2E2',
  warningBg: '#FEF3C7',
  infoBg: '#DBEAFE',
  successBg: '#D1FAE5',

  // Neutrals - web off-white background
  white: '#FFFFFF',
  background: '#F8FAFC',
  cardBg: '#FFFFFF',
  border: '#E2E8F0',
  divider: '#E2E8F0',

  // Text - web charcoal + slate
  textPrimary: '#1E293B',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.5)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',
};

// Typography - matched to autopilotamerica.com (Space Grotesk display + Inter body)
// IMPORTANT: When applying these custom fonts, use the weight-specific
// fontFamily (e.g. 'Inter-SemiBold') and DROP fontWeight. Combining a
// fontFamily with a numeric fontWeight produces synthetic faux-bold on iOS.
export const typography = {
  // Font Families — PostScript name on iOS, filename (minus .ttf) on Android.
  // Names match across both platforms for these specific TTFs.
  fontFamily: {
    displayRegular: 'SpaceGrotesk-Regular',
    displayBold: 'SpaceGrotesk-Bold',
    body: 'Inter-Regular',
    bodyMedium: 'Inter-Medium',
    bodySemibold: 'Inter-SemiBold',
    bodyBold: 'Inter-Bold',
  },

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

  // Font Weights (still exported for legacy callers; prefer fontFamily above)
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

// Border Radius — matched to web (Tailwind rounded-md/lg/xl = 6/8/12px;
// the larger steps stay above web because mobile primitives are bigger,
// but the whole scale is tightened so cards/sheets stop feeling bubbly.
export const borderRadius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
  full: 9999,
};

// Shadows — matched to web's box-shadow stack (subtle, not floaty).
// Web uses 0 2px 4px rgba(0,0,0,0.05) for light cards and ~0 10px 25px -5px
// rgba(0,0,0,0.1) for modals. Mobile's previous shadow scale was 2-3x heavier.
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.10,
    shadowRadius: 15,
    elevation: 6,
  },
  // Primary button shadow — subtle depth, no colored glow
  primaryGlow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
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

  // Cards — borderRadius matched to web login formCard (16px)
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xl,
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

  // Typography — Space Grotesk for display, Inter for body
  title: {
    fontFamily: typography.fontFamily.displayBold,
    fontSize: typography.sizes.xxl,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: typography.fontFamily.bodyMedium,
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
  },
  heading: {
    fontFamily: typography.fontFamily.displayBold,
    fontSize: typography.sizes.lg,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    lineHeight: typography.sizes.base * typography.lineHeights.normal,
  },
  caption: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
  },

  // Buttons — proportions matched to web (padding ~12x24, height ~44-48)
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    ...shadows.primaryGlow,
  },
  primaryButtonText: {
    fontFamily: typography.fontFamily.bodySemibold,
    color: colors.textInverse,
    fontSize: typography.sizes.md,
  },
  secondaryButton: {
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryButtonText: {
    fontFamily: typography.fontFamily.bodySemibold,
    color: colors.primary,
    fontSize: typography.sizes.base,
  },
  dangerButton: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  dangerButtonText: {
    fontFamily: typography.fontFamily.bodySemibold,
    color: colors.textInverse,
    fontSize: typography.sizes.base,
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
    fontFamily: typography.fontFamily.body,
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
    fontFamily: typography.fontFamily.bodySemibold,
    fontSize: typography.sizes.xs,
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
