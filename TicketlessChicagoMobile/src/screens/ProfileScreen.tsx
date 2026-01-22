import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, typography, spacing } from '../theme';
import { Card, Button } from '../components';
import BluetoothService, { SavedCarDevice } from '../services/BluetoothService';
import AuthService, { AuthState, User } from '../services/AuthService';
import PushNotificationService from '../services/PushNotificationService';
import Logger from '../utils/Logger';
import Config from '../config/config';
import { clearUserData } from '../utils/storage';
import { StorageKeys } from '../constants';
import BiometricService, { BiometricType } from '../services/BiometricService';

const log = Logger.createLogger('ProfileScreen');

interface AppSettings {
  notificationsEnabled: boolean;
  backgroundLocationEnabled: boolean;
  autoCheckOnDisconnect: boolean;
  criticalAlertsEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  notificationsEnabled: true,
  backgroundLocationEnabled: false,
  autoCheckOnDisconnect: true,
  criticalAlertsEnabled: true,
};

// Extracted components to avoid re-creation on each render
interface SettingRowProps {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

const SettingRow: React.FC<SettingRowProps> = ({ title, subtitle, value, onValueChange }) => (
  <View style={styles.settingRow}>
    <View style={styles.settingInfo}>
      <Text style={styles.settingTitle}>{title}</Text>
      {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: colors.border, true: colors.primaryLight }}
      thumbColor={value ? colors.primary : colors.textTertiary}
    />
  </View>
);

interface LinkRowProps {
  title: string;
  onPress: () => void;
  icon?: string;
  danger?: boolean;
}

const LinkRow: React.FC<LinkRowProps> = ({ title, onPress, icon, danger }) => (
  <TouchableOpacity style={styles.linkRow} onPress={onPress}>
    {icon && <Text style={styles.linkIcon}>{icon}</Text>}
    <Text style={[styles.linkTitle, danger && styles.dangerText]}>{title}</Text>
    <Text style={styles.chevron}>›</Text>
  </TouchableOpacity>
);

const ProfileScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [savedCar, setSavedCar] = useState<SavedCarDevice | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState({
    totalChecks: 0,
    violationsFound: 0,
    daysSaved: 0,
  });
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricName, setBiometricName] = useState('Biometric');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Refs to prevent memory leaks and race conditions
  const isMountedRef = useRef(true);
  const signingOutRef = useRef(false);
  const clearingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    loadSettings();
    loadSavedCar();
    loadStats();
    loadBiometricStatus();

    // Subscribe to auth state changes
    const unsubscribe = AuthService.subscribe((state: AuthState) => {
      if (isMountedRef.current) {
        setUser(state.user);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadSavedCar();
    });
    return unsubscribe;
  }, [navigation]);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(StorageKeys.APP_SETTINGS);
      if (stored) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
      }
    } catch (error) {
      log.error('Error loading settings', error);
    }
  };

  const saveSettings = async (newSettings: AppSettings) => {
    try {
      await AsyncStorage.setItem(StorageKeys.APP_SETTINGS, JSON.stringify(newSettings));
      setSettings(newSettings);
    } catch (error) {
      log.error('Error saving settings', error);
    }
  };

  const loadSavedCar = useCallback(async () => {
    try {
      const device = await BluetoothService.getSavedCarDevice();
      if (isMountedRef.current) {
        setSavedCar(device);
      }
    } catch (error) {
      log.error('Error loading saved car', error);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const history = await AsyncStorage.getItem(StorageKeys.PARKING_HISTORY);
      if (history && isMountedRef.current) {
        const items = JSON.parse(history);
        if (Array.isArray(items)) {
          const violations = items.filter((item: any) => item.rules?.length > 0).length;
          setStats({
            totalChecks: items.length,
            violationsFound: violations,
            daysSaved: Math.floor(violations * Config.STATS.VIOLATION_TO_TICKET_RATE), // Configurable rate
          });
        }
      }
    } catch (error) {
      log.error('Error loading stats', error);
    }
  }, []);

  const loadBiometricStatus = async () => {
    try {
      await BiometricService.initialize();
      const status = BiometricService.getStatus();
      setBiometricAvailable(status.available);
      setBiometricEnabled(status.enabled);
      setBiometricName(status.typeName);
    } catch (error) {
      log.error('Error loading biometric status', error);
    }
  };

  const handleBiometricToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        const success = await BiometricService.enable();
        if (success) {
          setBiometricEnabled(true);
          Alert.alert('Success', `${biometricName} authentication enabled`);
        } else {
          Alert.alert('Failed', `Could not enable ${biometricName} authentication`);
        }
      } else {
        await BiometricService.disable();
        setBiometricEnabled(false);
      }
    } catch (error) {
      log.error('Error toggling biometric', error);
      Alert.alert('Error', 'Failed to update biometric settings');
    }
  };

  const updateSetting = (key: keyof AppSettings, value: boolean) => {
    const newSettings = { ...settings, [key]: value };
    saveSettings(newSettings);
  };

  const openWebsite = () => {
    Linking.openURL('https://ticketless.fyi');
  };

  const openPrivacyPolicy = () => {
    Linking.openURL('https://ticketless.fyi/privacy');
  };

  const openTerms = () => {
    Linking.openURL('https://ticketless.fyi/terms');
  };

  const contactSupport = () => {
    Linking.openURL('mailto:support@ticketless.fyi?subject=Mobile App Support');
  };

  const handleSignOut = useCallback(() => {
    if (signingOutRef.current) return;

    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            signingOutRef.current = true;
            if (isMountedRef.current) setIsSigningOut(true);

            try {
              // Unregister push notifications
              await PushNotificationService.unregister();
              // Clear user-specific data (preserves app settings and onboarding state)
              await clearUserData();
              // Disable biometric if enabled
              await BiometricService.disable();
              // Sign out from Supabase
              await AuthService.signOut();
              // Navigate to login
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            } catch (error) {
              log.error('Error signing out', error);
              signingOutRef.current = false;
              if (isMountedRef.current) {
                setIsSigningOut(false);
                Alert.alert('Error', 'Failed to sign out. Please try again.');
              }
            }
          },
        },
      ]
    );
  }, [navigation]);

  const clearAllData = useCallback(() => {
    if (clearingRef.current) return;

    Alert.alert(
      'Clear All Data',
      'This will remove all saved data including your paired car, history, and settings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            // Second confirmation
            Alert.alert(
              'Are you absolutely sure?',
              'All your parking history, saved vehicle, and settings will be permanently deleted.',
              [
                { text: 'No, keep my data', style: 'cancel' },
                {
                  text: 'Yes, delete everything',
                  style: 'destructive',
                  onPress: async () => {
                    clearingRef.current = true;
                    if (isMountedRef.current) setIsClearing(true);

                    try {
                      await AsyncStorage.clear();
                      if (isMountedRef.current) {
                        setSettings(DEFAULT_SETTINGS);
                        setSavedCar(null);
                        setStats({ totalChecks: 0, violationsFound: 0, daysSaved: 0 });
                        setBiometricEnabled(false);
                        Alert.alert('Done', 'All data has been cleared');
                      }
                    } catch (error) {
                      log.error('Error clearing data', error);
                      if (isMountedRef.current) {
                        Alert.alert('Error', 'Failed to clear data. Please try again.');
                      }
                    } finally {
                      clearingRef.current = false;
                      if (isMountedRef.current) {
                        setIsClearing(false);
                      }
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        {/* Account Card */}
        {user && (
          <Card title="Account">
            <View style={styles.accountContainer}>
              <View style={styles.accountInfo}>
                <Text style={styles.accountIcon}>👤</Text>
                <View style={styles.accountDetails}>
                  <Text style={styles.accountName}>{user.name || 'User'}</Text>
                  <Text style={styles.accountEmail}>{user.email}</Text>
                </View>
              </View>
              <Button
                title={isSigningOut ? 'Signing Out...' : 'Sign Out'}
                variant="secondary"
                size="sm"
                onPress={handleSignOut}
                disabled={isSigningOut}
                loading={isSigningOut}
              />
            </View>
          </Card>
        )}

        {/* Stats Card */}
        <Card title="Your Stats">
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.totalChecks}</Text>
              <Text style={styles.statLabel}>Checks</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.violationsFound}</Text>
              <Text style={styles.statLabel}>Violations</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, styles.statHighlight]}>
                ~${stats.daysSaved * Config.STATS.AVERAGE_TICKET_COST}
              </Text>
              <Text style={styles.statLabel}>Saved</Text>
            </View>
          </View>
        </Card>

        {/* Paired Car */}
        <Card title="Paired Vehicle">
          {savedCar ? (
            <View style={styles.carContainer}>
              <View style={styles.carInfo}>
                <Text style={styles.carIcon}>🚗</Text>
                <View>
                  <Text style={styles.carName}>{savedCar.name}</Text>
                  <Text style={styles.carId}>{savedCar.id}</Text>
                </View>
              </View>
              <Button
                title="Change"
                variant="secondary"
                size="sm"
                onPress={() => navigation.navigate('BluetoothSettings')}
              />
            </View>
          ) : (
            <View style={styles.noCarContainer}>
              <Text style={styles.noCarText}>No vehicle paired</Text>
              <Button
                title="Pair Vehicle"
                variant="primary"
                size="sm"
                onPress={() => navigation.navigate('BluetoothSettings')}
              />
            </View>
          )}
        </Card>

        {/* Notification Settings */}
        <Card title="Notifications">
          <SettingRow
            title="Push Notifications"
            subtitle="Get alerts for parking violations"
            value={settings.notificationsEnabled}
            onValueChange={v => updateSetting('notificationsEnabled', v)}
          />
          <View style={styles.settingDivider} />
          <SettingRow
            title="Critical Alerts"
            subtitle="Bypass Do Not Disturb for urgent violations"
            value={settings.criticalAlertsEnabled}
            onValueChange={v => updateSetting('criticalAlertsEnabled', v)}
          />
        </Card>

        {/* Detection Settings */}
        <Card title="Auto-Detection">
          <SettingRow
            title="Auto Check on Disconnect"
            subtitle="Check parking when you leave your car"
            value={settings.autoCheckOnDisconnect}
            onValueChange={v => updateSetting('autoCheckOnDisconnect', v)}
          />
          <View style={styles.settingDivider} />
          <SettingRow
            title="Background Location"
            subtitle="Enable for more accurate detection"
            value={settings.backgroundLocationEnabled}
            onValueChange={v => updateSetting('backgroundLocationEnabled', v)}
          />
        </Card>

        {/* Security Settings */}
        {biometricAvailable && (
          <Card title="Security">
            <SettingRow
              title={`${biometricName} Login`}
              subtitle={`Use ${biometricName} to secure the app`}
              value={biometricEnabled}
              onValueChange={handleBiometricToggle}
            />
          </Card>
        )}

        {/* Links */}
        <Card title="About">
          <LinkRow title="Visit Website" icon="🌐" onPress={openWebsite} />
          <View style={styles.settingDivider} />
          <LinkRow title="Privacy Policy" icon="🔒" onPress={openPrivacyPolicy} />
          <View style={styles.settingDivider} />
          <LinkRow title="Terms of Service" icon="📄" onPress={openTerms} />
          <View style={styles.settingDivider} />
          <LinkRow title="Contact Support" icon="📧" onPress={contactSupport} />
        </Card>

        {/* Danger Zone */}
        <Card>
          <LinkRow
            title="Clear All Data"
            icon="🗑️"
            onPress={clearAllData}
            danger
          />
        </Card>

        {/* Version */}
        <Text style={styles.version}>Autopilot v{Config.APP_VERSION}</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.base,
  },
  // Account
  accountContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  accountInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  accountIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  accountDetails: {
    flex: 1,
  },
  accountName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  accountEmail: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  statHighlight: {
    color: colors.success,
  },
  statLabel: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
  },
  // Car
  carContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  carInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  carIcon: {
    fontSize: 24,
    marginRight: spacing.md,
  },
  carName: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  carId: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  noCarContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noCarText: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
  },
  // Settings
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  settingInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  settingTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.medium,
    color: colors.textPrimary,
  },
  settingSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  settingDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  // Links
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  linkIcon: {
    fontSize: typography.sizes.md,
    marginRight: spacing.md,
  },
  linkTitle: {
    flex: 1,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
  },
  chevron: {
    fontSize: typography.sizes.lg,
    color: colors.textTertiary,
  },
  dangerText: {
    color: colors.error,
  },
  // Version
  version: {
    textAlign: 'center',
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    marginTop: spacing.lg,
    marginBottom: spacing.xxl,
  },
});

export default ProfileScreen;
