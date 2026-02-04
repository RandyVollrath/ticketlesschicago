import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, commonStyles, shadows } from '../theme';
import AuthService from '../services/AuthService';
import GoogleLogo from '../components/GoogleLogo';
import Logger from '../utils/Logger';

const log = Logger.createLogger('LoginScreen');

interface LoginScreenProps {
  onAuthSuccess?: () => void;
}

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateEmail = (email: string): boolean => {
  return EMAIL_REGEX.test(email.trim());
};

export default function LoginScreen({ onAuthSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Refs to prevent memory leaks and double-submissions
  const isMountedRef = useRef(true);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleMagicLink = async () => {
    if (isProcessingRef.current) return;

    if (!email) {
      setError('Please enter your email');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    isProcessingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const result = await AuthService.signInWithMagicLink(email.trim());

      if (!isMountedRef.current) return;

      if (result.success) {
        setMagicLinkSent(true);
      } else {
        setError(result.error || 'Failed to send magic link');
      }
    } catch (err) {
      log.error('Magic link error', err);
      if (isMountedRef.current) {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
      isProcessingRef.current = false;
    }
  };

  const handleGoogleSignIn = async () => {
    if (isProcessingRef.current) return;

    isProcessingRef.current = true;
    setGoogleLoading(true);
    setError(null);

    try {
      const result = await AuthService.signInWithGoogle();

      if (!isMountedRef.current) return;

      if (result.success) {
        onAuthSuccess?.();
      } else {
        setError(result.error || 'Google sign-in failed');
      }
    } catch (err) {
      log.error('Google sign-in error', err);
      if (isMountedRef.current) {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setGoogleLoading(false);
      }
      isProcessingRef.current = false;
    }
  };

  const handleAppleSignIn = async () => {
    if (isProcessingRef.current) return;

    isProcessingRef.current = true;
    setAppleLoading(true);
    setError(null);

    try {
      const result = await AuthService.signInWithApple();

      if (!isMountedRef.current) return;

      if (result.success) {
        onAuthSuccess?.();
      } else {
        if (result.error !== 'Sign in was cancelled') {
          setError(result.error || 'Apple sign-in failed');
        }
      }
    } catch (err) {
      log.error('Apple sign-in error', err);
      if (isMountedRef.current) {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setAppleLoading(false);
      }
      isProcessingRef.current = false;
    }
  };

  const handleResendLink = () => {
    setMagicLinkSent(false);
    handleMagicLink();
  };

  // Success state after magic link is sent
  if (magicLinkSent) {
    return (
      <SafeAreaView style={commonStyles.safeArea}>
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✉️</Text>
          <Text style={styles.successTitle}>Check Your Email</Text>
          <Text style={styles.successMessage}>
            We sent a magic link to{'\n'}
            <Text style={styles.emailHighlight}>{email}</Text>
          </Text>
          <Text style={styles.successInstructions}>
            Click the link in your email to sign in. The link will expire in 1 hour.
          </Text>

          <TouchableOpacity
            style={styles.resendButton}
            onPress={handleResendLink}
            disabled={loading}
            accessibilityLabel="Resend magic link"
            accessibilityRole="button"
            accessibilityState={{ disabled: loading }}
          >
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.resendText}>Resend magic link</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.changeEmailButton}
            onPress={() => setMagicLinkSent(false)}
            accessibilityLabel="Use a different email"
            accessibilityRole="button"
          >
            <Text style={styles.changeEmailText}>Use a different email</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={commonStyles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="always"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.logo}>Autopilot</Text>
            <Text style={styles.tagline}>Never get a parking ticket again</Text>
          </View>

          {/* Form Card */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Sign In</Text>
            <Text style={styles.formSubtitle}>
              Enter your email and we'll send you a magic link to sign in instantly - no password needed.
            </Text>

            {error && (
              <View style={styles.errorContainer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Email field */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor={colors.textTertiary}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (error) setError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                accessibilityLabel="Email address"
                accessibilityHint="Enter your email to receive a magic link"
              />
            </View>

            {/* Apple Sign In Button (iOS only) */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={[styles.appleButton, appleLoading && styles.buttonDisabled]}
                onPress={handleAppleSignIn}
                disabled={appleLoading || googleLoading || loading}
                accessibilityLabel="Continue with Apple"
                accessibilityRole="button"
                accessibilityState={{ disabled: appleLoading || googleLoading || loading }}
              >
                {appleLoading ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="apple" size={20} color={colors.white} />
                    <Text style={styles.appleButtonText}>Continue with Apple</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Google Sign In Button */}
            <TouchableOpacity
              style={[styles.googleButton, googleLoading && styles.buttonDisabled]}
              onPress={handleGoogleSignIn}
              disabled={googleLoading || appleLoading || loading}
              accessibilityLabel="Continue with Google"
              accessibilityRole="button"
              accessibilityState={{ disabled: googleLoading || appleLoading || loading }}
            >
              {googleLoading ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <>
                  <GoogleLogo size={20} />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Magic Link Button */}
            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleMagicLink}
              disabled={loading || googleLoading}
              accessibilityLabel="Send magic link"
              accessibilityRole="button"
              accessibilityHint="Sends a sign-in link to your email"
              accessibilityState={{ disabled: loading || googleLoading }}
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>Send Magic Link</Text>
              )}
            </TouchableOpacity>

            <View style={styles.benefitsContainer}>
              <View style={styles.benefitRow}>
                <Text style={styles.benefitIcon}>✨</Text>
                <Text style={styles.benefitText}>No password to remember</Text>
              </View>
              <View style={styles.benefitRow}>
                <Text style={styles.benefitIcon}>🔒</Text>
                <Text style={styles.benefitText}>Secure one-time link</Text>
              </View>
              <View style={styles.benefitRow}>
                <Text style={styles.benefitIcon}>⚡</Text>
                <Text style={styles.benefitText}>Sign in with one click</Text>
              </View>
            </View>
          </View>

          <Text style={styles.disclaimer}>
            By continuing, you agree to our Terms of Service and Privacy Policy
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logo: {
    fontSize: typography.sizes.xxxl,
    fontWeight: typography.weights.bold,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  tagline: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
  },
  formCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.lg,
  },
  formTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  formSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: typography.sizes.sm * 1.5,
  },
  errorContainer: {
    backgroundColor: colors.criticalBg,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
  },
  appleButton: {
    backgroundColor: '#000000',
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
    minHeight: 48,
  },
  appleButtonText: {
    color: '#FFFFFF',
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.medium,
  },
  googleButton: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    marginTop: spacing.sm,
    gap: spacing.sm,
    minHeight: 48,
  },
  googleButtonText: {
    color: colors.textPrimary,
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.medium,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textTertiary,
    fontSize: typography.sizes.sm,
    marginHorizontal: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    minHeight: 48,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
  },
  benefitsContainer: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  benefitIcon: {
    fontSize: typography.sizes.base,
    marginRight: spacing.sm,
  },
  benefitText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  disclaimer: {
    color: colors.textTertiary,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  // Success state styles
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  successIcon: {
    fontSize: 64,
    marginBottom: spacing.lg,
  },
  successTitle: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  successMessage: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emailHighlight: {
    fontWeight: typography.weights.semibold,
    color: colors.primary,
  },
  successInstructions: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  resendButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  resendText: {
    color: colors.primary,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.medium,
  },
  changeEmailButton: {
    paddingVertical: spacing.md,
  },
  changeEmailText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
  },
});
