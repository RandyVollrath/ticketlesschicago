import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing } from '../theme';
import AuthService from '../services/AuthService';
import IAPService, { type BillingPlan } from '../services/IAPService';
import Logger from '../utils/Logger';

const log = Logger.createLogger('AccountInactiveScreen');

interface AccountInactiveScreenProps {
  onSignOut: () => void;
  onRetryCheck: () => void;
}

/**
 * Shown when a user logs in but doesn't have an active account.
 *
 * On iOS: Shows In-App Purchase button ($119.99) to activate account via Apple IAP.
 * On Android: Shows a clickable "Set Up on Website" button linking to autopilotamerica.com.
 */
export default function AccountInactiveScreen({ onSignOut, onRetryCheck }: AccountInactiveScreenProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [billingPlan, setBillingPlan] = useState<BillingPlan>('annual');
  const [iapReady, setIapReady] = useState(false);
  const [monthlyAvailable, setMonthlyAvailable] = useState(false);
  const [annualPrice, setAnnualPrice] = useState<string | null>(null);
  const [monthlyPrice, setMonthlyPrice] = useState<string | null>(null);
  const user = AuthService.getUser();

  useEffect(() => {
    if (Platform.OS === 'ios') {
      initializeIAP();
    }

    return () => {
      if (Platform.OS === 'ios') {
        IAPService.cleanup();
      }
    };
  }, []);

  const initializeIAP = async () => {
    await IAPService.initialize();
    setIapReady(IAPService.isAvailable('annual'));
    setMonthlyAvailable(IAPService.isMonthlyAvailable());
    setAnnualPrice(IAPService.getPrice('annual'));
    setMonthlyPrice(IAPService.getPrice('monthly'));
  };

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

  const handlePurchase = async () => {
    if (!IAPService.isAvailable(billingPlan)) {
      Alert.alert(
        'Purchase Not Available',
        'In-App Purchase is still loading. Please try again in a moment.',
      );
      return;
    }

    setPurchasing(true);
    try {
      await IAPService.purchase((success, error) => {
        setPurchasing(false);
        if (success) {
          onRetryCheck();
        } else if (error && error !== 'Purchase cancelled') {
          Alert.alert('Purchase Failed', error);
        }
      }, billingPlan);
    } catch (error: any) {
      setPurchasing(false);
      log.error('Purchase error', error);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
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
        <Text style={styles.title}>Activate Your Account</Text>

        {/* Message */}
        <Text style={styles.message}>
          {Platform.OS === 'ios'
            ? `Automatic parking violation detection, street cleaning alerts, and ticket contesting — all in one app.`
            : `An active Autopilot account is required to use this app.\n\nVisit autopilotamerica.com to set up your account.`}
        </Text>

        {/* Email display */}
        {user?.email && (
          <View style={styles.emailBadge}>
            <MaterialCommunityIcons name="email-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.emailText}>{user.email}</Text>
          </View>
        )}

        {/* iOS: Billing toggle + In-App Purchase button */}
        {Platform.OS === 'ios' && (
          <>
            {/* Billing plan toggle */}
            <View style={styles.billingToggle}>
              <TouchableOpacity
                style={[styles.toggleOption, billingPlan === 'annual' && styles.toggleOptionActive]}
                onPress={() => setBillingPlan('annual')}
              >
                <Text style={[styles.toggleText, billingPlan === 'annual' && styles.toggleTextActive]}>
                  Annual
                </Text>
                {billingPlan === 'annual' && (
                  <Text style={styles.toggleSavings}>Save 45%</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleOption, billingPlan === 'monthly' && styles.toggleOptionActive]}
                onPress={() => setBillingPlan('monthly')}
              >
                <Text style={[styles.toggleText, billingPlan === 'monthly' && styles.toggleTextActive]}>
                  Monthly
                </Text>
              </TouchableOpacity>
            </View>

            {/* Price display */}
            <Text style={styles.priceText}>
              {billingPlan === 'annual'
                ? (annualPrice || '$119.99') + '/year'
                : (monthlyPrice || '$14.99') + '/month'}
            </Text>
            {billingPlan === 'monthly' && (
              <Text style={styles.savingsHint}>
                $179.88/year — save 45% with annual
              </Text>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, purchasing && styles.buttonDisabled]}
              onPress={handlePurchase}
              disabled={purchasing}
            >
              {purchasing ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <>
                  <MaterialCommunityIcons name="shield-check" size={20} color={colors.textInverse} />
                  <Text style={styles.primaryButtonText}>
                    Subscribe — {billingPlan === 'annual'
                      ? (annualPrice || '$119.99') + '/year'
                      : (monthlyPrice || '$14.99') + '/month'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* Android: Open website button */}
        {Platform.OS !== 'ios' && (
          <TouchableOpacity style={styles.primaryButton} onPress={handleOpenWebsite}>
            <MaterialCommunityIcons name="web" size={20} color={colors.textInverse} />
            <Text style={styles.primaryButtonText}>Set Up on Website</Text>
          </TouchableOpacity>
        )}

        {/* iOS: "Already have an account?" for users who purchased on the web */}
        {Platform.OS === 'ios' && (
          <Text style={styles.existingAccountHint}>
            Already purchased on autopilotamerica.com? Tap below to refresh.
          </Text>
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
              <Text style={styles.secondaryButtonText}>I've already set up my account</Text>
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
  billingToggle: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    width: '100%',
    marginBottom: spacing.md,
  },
  toggleOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleOptionActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.textSecondary,
  },
  toggleTextActive: {
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  toggleSavings: {
    fontSize: 11,
    fontWeight: typography.weights.semibold,
    color: '#10B981',
    marginTop: 2,
  },
  priceText: {
    fontSize: typography.sizes.xxl || 32,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  savingsHint: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    textAlign: 'center',
    marginBottom: spacing.md,
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
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textInverse,
  },
  existingAccountHint: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    textAlign: 'center',
    marginBottom: spacing.sm,
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
