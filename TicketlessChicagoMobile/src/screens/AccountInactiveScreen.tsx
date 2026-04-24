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
  ScrollView,
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

const VALUE_PROPS = [
  {
    icon: 'car-brake-alert' as const,
    title: 'Automatic Parking Violation Detection',
    desc: 'Knows when and where you park — alerts you before you get a ticket.',
  },
  {
    icon: 'broom' as const,
    title: 'Street Cleaning Alerts',
    desc: 'Get notified before sweepers arrive so you can move your car in time.',
  },
  {
    icon: 'camera' as const,
    title: 'Speed & Red Light Camera Alerts',
    desc: 'Audio warnings when you approach enforcement cameras.',
  },
  {
    icon: 'gavel' as const,
    title: 'Automatic Ticket Contesting',
    desc: 'We check for new tickets and file contests on your behalf.',
  },
];

/**
 * Shown when a user logs in but doesn't have an active account.
 *
 * On iOS: Shows In-App Purchase button ($79/yr) to activate account via Apple IAP.
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
      const errorDetail = IAPService.getLastError();
      Alert.alert(
        'Purchase Not Available',
        errorDetail
          ? `In-App Purchase failed to load.\n\nDiagnostic: ${errorDetail}`
          : 'In-App Purchase is still loading. Please try again in a moment.',
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
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Hero */}
          <View style={styles.iconContainer}>
            <MaterialCommunityIcons
              name="shield-car"
              size={64}
              color={colors.primary}
            />
          </View>

          <Text style={styles.title}>Stop Getting Chicago Parking Tickets</Text>

          <Text style={styles.subtitle}>
            The average Chicago driver pays $300+/year in parking tickets. Autopilot pays for itself with a single avoided ticket.
          </Text>

          {/* Value props */}
          <View style={styles.valuePropsList}>
            {VALUE_PROPS.map((prop) => (
              <View key={prop.title} style={styles.valuePropRow}>
                <View style={styles.valuePropIcon}>
                  <MaterialCommunityIcons name={prop.icon} size={22} color={colors.primary} />
                </View>
                <View style={styles.valuePropText}>
                  <Text style={styles.valuePropTitle}>{prop.title}</Text>
                  <Text style={styles.valuePropDesc}>{prop.desc}</Text>
                </View>
              </View>
            ))}
          </View>

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
                  ? (annualPrice || '$79') + '/year'
                  : (monthlyPrice || '$9') + '/month'}
              </Text>
              {billingPlan === 'monthly' && (
                <Text style={styles.savingsHint}>
                  $108/year — save 27% with annual
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
                        ? (annualPrice || '$79') + '/year'
                        : (monthlyPrice || '$9') + '/month'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Subscription details required by App Store Guideline 3.1.2(c) */}
              <Text style={styles.subscriptionDisclosure}>
                {billingPlan === 'annual'
                  ? 'Auto-renewable yearly subscription. '
                  : 'Auto-renewable monthly subscription. '}
                Payment will be charged to your Apple ID account at confirmation of purchase.
                Subscription automatically renews unless canceled at least 24 hours before the end of the current period.
                Manage subscriptions in Settings {'>'} Apple ID {'>'} Subscriptions.
              </Text>
              <View style={styles.legalLinks}>
                <TouchableOpacity onPress={() => Linking.openURL('https://autopilotamerica.com/terms')}>
                  <Text style={styles.legalLinkText}>Terms of Use</Text>
                </TouchableOpacity>
                <Text style={styles.legalSeparator}>|</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://autopilotamerica.com/privacy')}>
                  <Text style={styles.legalLinkText}>Privacy Policy</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Android: Open website button */}
          {Platform.OS !== 'ios' && (
            <TouchableOpacity style={styles.primaryButton} onPress={handleOpenWebsite}>
              <MaterialCommunityIcons name="shield-check" size={20} color={colors.textInverse} />
              <Text style={styles.primaryButtonText}>Get Started — From $9.99/mo</Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sizes.sm * typography.lineHeights.relaxed,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  valuePropsList: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  valuePropRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  valuePropIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.base,
    flexShrink: 0,
  },
  valuePropText: {
    flex: 1,
  },
  valuePropTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  valuePropDesc: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    lineHeight: typography.sizes.xs * typography.lineHeights.relaxed,
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
  subscriptionDisclosure: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 15,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  legalLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  legalLinkText: {
    fontSize: 12,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  legalSeparator: {
    fontSize: 12,
    color: colors.textTertiary,
    marginHorizontal: spacing.sm,
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
