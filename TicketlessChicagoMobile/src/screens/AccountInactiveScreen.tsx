import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing } from '../theme';
import AuthService from '../services/AuthService';
import Logger from '../utils/Logger';

const log = Logger.createLogger('AccountInactiveScreen');

interface AccountInactiveScreenProps {
  onSignOut: () => void;
  onRetryCheck: () => void;
}

/**
 * Shown when a user logs in but doesn't have an active paid account.
 * Directs them to the website to purchase a membership.
 *
 * On iOS: No pricing or purchase links are shown (App Store guideline 3.1.1).
 * On Android: Shows the website URL with pricing.
 */
export default function AccountInactiveScreen({ onSignOut, onRetryCheck }: AccountInactiveScreenProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const user = AuthService.getUser();

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await AuthService.signOut();
      onSignOut();
    } catch (error) {
      log.error('Sign out failed', error);
    } finally {
      setSigningOut(false);
    }
  };

  const handleRetryCheck = async () => {
    setChecking(true);
    try {
      onRetryCheck();
    } finally {
      // Parent will re-check and navigate away if paid
      setTimeout(() => setChecking(false), 3000);
    }
  };

  const handleOpenWebsite = () => {
    Linking.openURL('https://autopilotamerica.com/start');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <MaterialCommunityIcons
            name="shield-lock-outline"
            size={64}
            color={colors.primary}
          />
        </View>

        {/* Title */}
        <Text style={styles.title}>Account Not Active</Text>

        {/* Message - different per platform */}
        {Platform.OS === 'ios' ? (
          <Text style={styles.message}>
            Your account needs to be activated before you can use the app.
            If you've already activated, tap the button below to refresh.
          </Text>
        ) : (
          <Text style={styles.message}>
            Your account needs to be activated before you can use the app.
            Visit autopilotamerica.com to activate your membership.
          </Text>
        )}

        {/* Email display */}
        {user?.email && (
          <View style={styles.emailBadge}>
            <MaterialCommunityIcons name="email-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.emailText}>{user.email}</Text>
          </View>
        )}

        {/* Open website button - Android only. iOS App Store Guideline 3.1.1
           prohibits linking to external purchase flows. */}
        {Platform.OS !== 'ios' && (
          <TouchableOpacity style={styles.primaryButton} onPress={handleOpenWebsite}>
            <MaterialCommunityIcons name="web" size={20} color={colors.textInverse} />
            <Text style={styles.primaryButtonText}>Activate on Website</Text>
          </TouchableOpacity>
        )}

        {/* Refresh / retry button */}
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleRetryCheck}
          disabled={checking}
        >
          {checking ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <MaterialCommunityIcons name="refresh" size={20} color={colors.primary} />
              <Text style={styles.secondaryButtonText}>I've already activated</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Sign out */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          <Text style={styles.signOutText}>
            {signingOut ? 'Signing out...' : 'Sign in with a different account'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  message: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sizes.base * typography.lineHeights.relaxed,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.base,
  },
  emailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.cardBg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xxl,
  },
  emailText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.base,
    borderRadius: 12,
    width: '100%',
    marginBottom: spacing.md,
  },
  primaryButtonText: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textInverse,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryTint,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.base,
    borderRadius: 12,
    width: '100%',
    marginBottom: spacing.md,
  },
  secondaryButtonText: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.primary,
  },
  signOutButton: {
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  signOutText: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
  },
});
