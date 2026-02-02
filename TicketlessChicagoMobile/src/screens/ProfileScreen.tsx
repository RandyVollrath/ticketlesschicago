import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import { Button } from '../components';
import BluetoothService, { SavedCarDevice } from '../services/BluetoothService';
import AuthService, { AuthState, User } from '../services/AuthService';
import PushNotificationService from '../services/PushNotificationService';
import Logger from '../utils/Logger';
import Config from '../config/config';
import { clearUserData } from '../utils/storage';
import { StorageKeys } from '../constants';
import CameraAlertService from '../services/CameraAlertService';

const log = Logger.createLogger('SettingsScreen');

interface AppSettings {
  notificationsEnabled: boolean;
  criticalAlertsEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  notificationsEnabled: true,
  criticalAlertsEnabled: true,
};

// ──────────────────────────────────────────────────────
// Reusable Row Components
// ──────────────────────────────────────────────────────
interface SettingRowProps {
  icon: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

const SettingRow: React.FC<SettingRowProps> = ({
  icon, iconColor = colors.textSecondary, title, subtitle, value, onValueChange,
}) => (
  <View style={styles.settingRow}>
    <MaterialCommunityIcons name={icon} size={20} color={iconColor} style={styles.rowIcon} />
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
  icon: string;
  iconColor?: string;
  title: string;
  onPress: () => void;
  danger?: boolean;
  rightText?: string;
}

const LinkRow: React.FC<LinkRowProps> = ({
  icon, iconColor = colors.textSecondary, title, onPress, danger, rightText,
}) => (
  <TouchableOpacity
    style={styles.linkRow}
    onPress={onPress}
    delayPressIn={100}
    activeOpacity={0.7}
  >
    <MaterialCommunityIcons
      name={icon}
      size={20}
      color={danger ? colors.error : iconColor}
      style={styles.rowIcon}
    />
    <Text style={[styles.linkTitle, danger && styles.dangerText]}>{title}</Text>
    {rightText && <Text style={styles.rightText}>{rightText}</Text>}
    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
  </TouchableOpacity>
);

// ──────────────────────────────────────────────────────
// Section component
// ──────────────────────────────────────────────────────
interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.sectionCard}>
      {children}
    </View>
  </View>
);

const Divider = () => <View style={styles.divider} />;

// ──────────────────────────────────────────────────────
// Main Screen
// ──────────────────────────────────────────────────────
const ProfileScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [savedCar, setSavedCar] = useState<SavedCarDevice | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [cameraAlertsEnabled, setCameraAlertsEnabled] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const isMountedRef = useRef(true);
  const signingOutRef = useRef(false);
  const clearingRef = useRef(false);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    loadSettings();
    loadSavedCar();
    setCameraAlertsEnabled(CameraAlertService.isAlertEnabled());
    const unsubscribe = AuthService.subscribe((state: AuthState) => {
      if (isMountedRef.current) setUser(state.user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => { loadSavedCar(); });
    return unsubscribe;
  }, [navigation]);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(StorageKeys.APP_SETTINGS);
      if (stored) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
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
      if (isMountedRef.current) setSavedCar(device);
    } catch (error) {
      log.error('Error loading saved car', error);
    }
  }, []);

  const toggleCameraAlerts = useCallback(async (value: boolean) => {
    setCameraAlertsEnabled(value);
    await CameraAlertService.setEnabled(value);
  }, []);

  const updateSetting = (key: keyof AppSettings, value: boolean) => {
    saveSettings({ ...settings, [key]: value });
  };

  const handleSignOut = useCallback(() => {
    if (signingOutRef.current) return;
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          signingOutRef.current = true;
          if (isMountedRef.current) setIsSigningOut(true);
          try {
            await PushNotificationService.unregister();
            await clearUserData();
            await AuthService.signOut();
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          } catch (error) {
            log.error('Error signing out', error);
            signingOutRef.current = false;
            if (isMountedRef.current) {
              setIsSigningOut(false);
              Alert.alert('Error', 'Failed to sign out.');
            }
          }
        },
      },
    ]);
  }, [navigation]);

  const clearAllData = useCallback(() => {
    if (clearingRef.current) return;
    Alert.alert('Clear All Data', 'This will remove all saved data. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue', style: 'destructive',
        onPress: () => {
          Alert.alert('Are you sure?', 'All history, vehicle, and settings will be deleted.', [
            { text: 'No', style: 'cancel' },
            {
              text: 'Delete Everything', style: 'destructive',
              onPress: async () => {
                clearingRef.current = true;
                if (isMountedRef.current) setIsClearing(true);
                try {
                  await AsyncStorage.clear();
                  if (isMountedRef.current) {
                    setSettings(DEFAULT_SETTINGS);
                    setSavedCar(null);
                    setBiometricEnabled(false);
                    Alert.alert('Done', 'All data has been cleared');
                  }
                } catch (error) {
                  log.error('Error clearing data', error);
                  if (isMountedRef.current) Alert.alert('Error', 'Failed to clear data.');
                } finally {
                  clearingRef.current = false;
                  if (isMountedRef.current) setIsClearing(false);
                }
              },
            },
          ]);
        },
      },
    ]);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        {/* Account */}
        {user && (
          <Section title="Account">
            <View style={styles.accountRow}>
              <MaterialCommunityIcons name="account-circle" size={40} color={colors.primary} />
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{user.name || 'User'}</Text>
                <Text style={styles.accountEmail}>{user.email}</Text>
              </View>
            </View>
          </Section>
        )}

        {/* Preferences (merged notifications + security) */}
        <Section title="Preferences">
          <SettingRow
            icon="bell-outline"
            iconColor={colors.primary}
            title="Push Notifications"
            subtitle="Parking violation alerts"
            value={settings.notificationsEnabled}
            onValueChange={v => updateSetting('notificationsEnabled', v)}
          />
          <Divider />
          <SettingRow
            icon="bell-alert-outline"
            iconColor={colors.warning}
            title="Critical Alerts"
            subtitle="Bypass Do Not Disturb"
            value={settings.criticalAlertsEnabled}
            onValueChange={v => updateSetting('criticalAlertsEnabled', v)}
          />
          <Divider />
          <SettingRow
            icon="camera"
            iconColor={colors.info}
            title="Camera Alerts (BETA)"
            subtitle="Audio alerts near speed & red light cameras while driving"
            value={cameraAlertsEnabled}
            onValueChange={toggleCameraAlerts}
          />
        </Section>

        {/* Auto-Detection */}
        <Section title="Auto-Detection">
          <LinkRow
            icon={savedCar ? 'car-connected' : 'bluetooth-connect'}
            iconColor={colors.primary}
            title={savedCar ? savedCar.name : 'Pair Your Car'}
            rightText={savedCar ? 'Paired' : undefined}
            onPress={() => navigation.navigate('BluetoothSettings')}
          />
        </Section>

        {/* About */}
        <Section title="About">
          <LinkRow icon="web" title="Website" onPress={() => Linking.openURL('https://autopilotamerica.com')} />
          <Divider />
          <LinkRow icon="shield-lock-outline" title="Privacy Policy" onPress={() => Linking.openURL('https://autopilotamerica.com/privacy')} />
          <Divider />
          <LinkRow icon="file-document-outline" title="Terms of Service" onPress={() => Linking.openURL('https://autopilotamerica.com/terms')} />
          <Divider />
          <LinkRow icon="email-outline" title="Contact Support" onPress={() => Linking.openURL('mailto:support@autopilotamerica.com?subject=Autopilot Mobile App Support')} />
        </Section>

        {/* Danger Zone */}
        <Section title="">
          {user && (
            <>
              <LinkRow
                icon="logout"
                title={isSigningOut ? 'Signing Out...' : 'Sign Out'}
                onPress={handleSignOut}
                danger
              />
              <Divider />
            </>
          )}
          <LinkRow
            icon="trash-can-outline"
            title="Clear All Data"
            onPress={clearAllData}
            danger
          />
        </Section>

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
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },

  // Sections
  section: {
    marginBottom: spacing.base,
  },
  sectionTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  sectionCard: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    ...shadows.sm,
    overflow: 'hidden',
  },

  // Account
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
  },
  accountInfo: {
    flex: 1,
    marginLeft: spacing.md,
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

  // Setting rows
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
  rowIcon: {
    marginRight: spacing.md,
    width: 24,
    textAlign: 'center',
  },
  settingInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  settingTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.medium,
    color: colors.textPrimary,
  },
  settingSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: 1,
  },

  // Link rows
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
  linkTitle: {
    flex: 1,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
  },
  rightText: {
    fontSize: typography.sizes.sm,
    color: colors.success,
    fontWeight: typography.weights.medium,
    marginRight: spacing.xs,
  },
  dangerText: {
    color: colors.error,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 56, // icon width + padding to align with text
  },

  // Version
  version: {
    textAlign: 'center',
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    marginTop: spacing.base,
  },
});

export default ProfileScreen;
