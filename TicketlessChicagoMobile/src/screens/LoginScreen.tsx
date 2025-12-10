import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { colors, typography, spacing, borderRadius, commonStyles, shadows } from '../theme';
import AuthService from '../services/AuthService';
import Logger from '../utils/Logger';

const log = Logger.createLogger('LoginScreen');

interface LoginScreenProps {
  onAuthSuccess?: () => void;
}

type AuthMode = 'login' | 'signup' | 'forgot';

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateEmail = (email: string): boolean => {
  return EMAIL_REGEX.test(email.trim());
};

export default function LoginScreen({ onAuthSuccess }: LoginScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs to prevent memory leaks and double-submissions
  const isMountedRef = useRef(true);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleLogin = async () => {
    if (isProcessingRef.current) return;

    if (!email || !password) {
      setError('Please enter your email and password');
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
      const result = await AuthService.signInWithEmail(email.trim(), password);

      if (!isMountedRef.current) return;

      if (result.success) {
        onAuthSuccess?.();
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (err) {
      log.error('Login error', err);
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

  const handleSignup = async () => {
    if (isProcessingRef.current) return;

    if (!email || !password) {
      setError('Please enter your email and password');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    isProcessingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const result = await AuthService.signUpWithEmail(email.trim(), password, name.trim());

      if (!isMountedRef.current) return;

      if (result.success) {
        if (result.needsVerification) {
          Alert.alert(
            'Check Your Email',
            'We sent you a verification link. Please check your email to complete signup.',
            [{ text: 'OK', onPress: () => setMode('login') }]
          );
        } else {
          onAuthSuccess?.();
        }
      } else {
        setError(result.error || 'Signup failed');
      }
    } catch (err) {
      log.error('Signup error', err);
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
        Alert.alert(
          'Check Your Email',
          'We sent you a magic link. Click the link in your email to sign in.',
          [{ text: 'OK' }]
        );
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

  const handleForgotPassword = async () => {
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
      const result = await AuthService.sendPasswordReset(email.trim());

      if (!isMountedRef.current) return;

      if (result.success) {
        Alert.alert(
          'Check Your Email',
          'We sent you a password reset link. Check your email to reset your password.',
          [{ text: 'OK', onPress: () => setMode('login') }]
        );
      } else {
        setError(result.error || 'Failed to send reset email');
      }
    } catch (err) {
      log.error('Password reset error', err);
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

  const handleSkip = () => {
    onAuthSuccess?.();
  };

  return (
    <SafeAreaView style={commonStyles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.logo}>Ticketless</Text>
            <Text style={styles.tagline}>Never get a parking ticket again</Text>
          </View>

          {/* Form Card */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {mode === 'login' && 'Welcome Back'}
              {mode === 'signup' && 'Create Account'}
              {mode === 'forgot' && 'Reset Password'}
            </Text>

            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Name field (signup only) */}
            {mode === 'signup' && (
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Name (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Your name"
                  placeholderTextColor={colors.textTertiary}
                  value={name}
                  onChangeText={(text) => {
                    setName(text);
                    if (error) setError(null);
                  }}
                  autoCapitalize="words"
                />
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
              />
            </View>

            {/* Password field (not for forgot mode) */}
            {mode !== 'forgot' && (
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter password"
                  placeholderTextColor={colors.textTertiary}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (error) setError(null);
                  }}
                  secureTextEntry
                />
              </View>
            )}

            {/* Primary Action Button */}
            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={() => {
                if (mode === 'login') handleLogin();
                else if (mode === 'signup') handleSignup();
                else handleForgotPassword();
              }}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {mode === 'login' && 'Sign In'}
                  {mode === 'signup' && 'Create Account'}
                  {mode === 'forgot' && 'Send Reset Link'}
                </Text>
              )}
            </TouchableOpacity>

            {/* Magic Link Option (login only) */}
            {mode === 'login' && (
              <TouchableOpacity
                style={styles.magicLinkButton}
                onPress={handleMagicLink}
                disabled={loading}
              >
                <Text style={styles.magicLinkText}>Send me a magic link instead</Text>
              </TouchableOpacity>
            )}

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Mode Switcher */}
            {mode === 'login' && (
              <>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    setMode('signup');
                    setError(null);
                  }}
                >
                  <Text style={styles.secondaryButtonText}>Create an Account</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.linkButton}
                  onPress={() => {
                    setMode('forgot');
                    setError(null);
                  }}
                >
                  <Text style={styles.linkText}>Forgot your password?</Text>
                </TouchableOpacity>
              </>
            )}

            {mode === 'signup' && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setMode('login');
                  setError(null);
                }}
              >
                <Text style={styles.secondaryButtonText}>Already have an account? Sign In</Text>
              </TouchableOpacity>
            )}

            {mode === 'forgot' && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setMode('login');
                  setError(null);
                }}
              >
                <Text style={styles.secondaryButtonText}>Back to Sign In</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Skip Button */}
          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipText}>Continue without account</Text>
          </TouchableOpacity>

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
    marginBottom: spacing.lg,
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
  },
  magicLinkButton: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  magicLinkText: {
    color: colors.primary,
    fontSize: typography.sizes.sm,
  },
  divider: {
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
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.sm,
  },
  secondaryButton: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.medium,
  },
  linkButton: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  linkText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
  },
  skipButton: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  skipText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.base,
  },
  disclaimer: {
    color: colors.textTertiary,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
