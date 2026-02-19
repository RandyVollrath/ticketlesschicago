import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  ActivityIndicator,
  Platform,
  Animated as RNAnimated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import { Button } from '../components';
import BluetoothService, { SavedCarDevice } from '../services/BluetoothService';
import AuthService, { AuthState, User } from '../services/AuthService';
import PushNotificationService from '../services/PushNotificationService';
import ApiClient from '../utils/ApiClient';
import Logger from '../utils/Logger';
import Config from '../config/config';
import { clearUserData } from '../utils/storage';
import { StorageKeys } from '../constants';
import CameraAlertService from '../services/CameraAlertService';
import BackgroundLocationService from '../services/BackgroundLocationService';

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
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}

const SettingRow: React.FC<SettingRowProps> = ({
  icon, iconColor = colors.textSecondary, title, subtitle, value, disabled = false, onValueChange,
}) => (
  <View style={styles.settingRow} accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ''}, ${value ? 'on' : 'off'}`}>
    <MaterialCommunityIcons name={icon} size={20} color={iconColor} style={styles.rowIcon} />
    <View style={styles.settingInfo}>
      <Text style={styles.settingTitle}>{title}</Text>
      {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.border, true: colors.primaryLight }}
      thumbColor={value ? colors.primary : colors.textTertiary}
      accessibilityLabel={title}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
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
    accessibilityLabel={`${title}${rightText ? `, ${rightText}` : ''}`}
    accessibilityRole="button"
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
  const [user, setUser] = useState<User | null>(AuthService.getUser());
  const [cameraAlertsEnabled, setCameraAlertsEnabled] = useState(false);
  const [speedCameraAlertsEnabled, setSpeedCameraAlertsEnabled] = useState(false);
  const [redLightCameraAlertsEnabled, setRedLightCameraAlertsEnabled] = useState(false);
  const [cameraSettingsLoaded, setCameraSettingsLoaded] = useState(false);
  const [meterExpiryAlertsEnabled, setMeterExpiryAlertsEnabled] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [homePermitZone, setHomePermitZone] = useState<string>('');
  const [permitZoneEditing, setPermitZoneEditing] = useState(false);
  const [permitZoneInput, setPermitZoneInput] = useState('');

  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const feedbackOpacity = useRef(new RNAnimated.Value(0)).current;
  const feedbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMountedRef = useRef(true);
  const signingOutRef = useRef(false);
  const clearingRef = useRef(false);
  const deletingAccountRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
    };
  }, []);

  const showFeedback = useCallback((message: string) => {
    if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
    setFeedbackMessage(message);
    RNAnimated.timing(feedbackOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    feedbackTimeout.current = setTimeout(() => {
      RNAnimated.timing(feedbackOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => setFeedbackMessage(null));
    }, 2500);
  }, [feedbackOpacity]);

  useEffect(() => {
    loadSettings();
    loadSavedCar();
    loadHomePermitZone();
    loadCameraAlertSettings();
    loadMeterExpiryAlertSetting();
    const unsubscribe = AuthService.subscribe((state: AuthState) => {
      if (isMountedRef.current) setUser(state.user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadSavedCar();
      loadCameraAlertSettings();
    });
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

  const loadCameraAlertSettings = useCallback(async () => {
    try {
      const cameraSettings = await CameraAlertService.getSettings();
      if (!isMountedRef.current) return;
      setCameraAlertsEnabled(cameraSettings.enabled);
      setSpeedCameraAlertsEnabled(cameraSettings.speedEnabled);
      setRedLightCameraAlertsEnabled(cameraSettings.redLightEnabled);
    } catch (error) {
      log.error('Error loading camera alert settings', error);
    } finally {
      if (isMountedRef.current) setCameraSettingsLoaded(true);
    }
  }, []);

  const loadMeterExpiryAlertSetting = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem('meterExpiryAlertsEnabled');
      if (!isMountedRef.current) return;
      // Default to true if never set
      setMeterExpiryAlertsEnabled(stored === null ? true : stored === 'true');
    } catch (error) {
      log.error('Error loading meter expiry alert setting', error);
    }
  }, []);

  const toggleMeterExpiryAlerts = useCallback(async (value: boolean) => {
    setMeterExpiryAlertsEnabled(value);
    await AsyncStorage.setItem('meterExpiryAlertsEnabled', value.toString());
    showFeedback(value ? 'Meter expiry alerts enabled' : 'Meter expiry alerts disabled');
  }, [showFeedback]);

  /**
   * Load home permit zone from AsyncStorage (local cache).
   * On first load, also try to fetch from user_profiles on server
   * (pre-populated from Autopilot America addresses).
   */
  const loadHomePermitZone = useCallback(async () => {
    try {
      // Check local storage first
      const stored = await AsyncStorage.getItem(StorageKeys.HOME_PERMIT_ZONE);
      if (stored) {
        if (isMountedRef.current) {
          setHomePermitZone(stored);
          setPermitZoneInput(stored);
        }
        return;
      }

      // No local value — try to derive from user profile
      if (AuthService.isAuthenticated()) {
        try {
          const userId = AuthService.getUser()?.id;
          if (!userId) return;

          const response = await ApiClient.authGet<any>(`/api/user-profile?userId=${userId}`, {
            retries: 1,
            timeout: 10000,
            showErrorAlert: false,
          });
          if (!response.success || !response.data) return;

          // 1. Check if permit_zone_number is already set on profile
          const serverZone = response.data.permit_zone_number ||
                             response.data.vehicle_zone || '';
          if (serverZone && isMountedRef.current) {
            const zoneStr = String(serverZone);
            setHomePermitZone(zoneStr);
            setPermitZoneInput(zoneStr);
            await AsyncStorage.setItem(StorageKeys.HOME_PERMIT_ZONE, zoneStr);
            log.info(`Pre-populated home permit zone from profile: ${zoneStr}`);
            return;
          }

          // 2. No zone stored — try to derive from their home address
          const homeAddress = response.data.home_address_full ||
                              response.data.street_address || '';
          if (homeAddress && isMountedRef.current) {
            try {
              const zoneResponse = await ApiClient.get<any>(
                `/api/check-permit-zone?address=${encodeURIComponent(homeAddress)}`,
                { retries: 1, timeout: 10000, showErrorAlert: false }
              );
              if (zoneResponse.success && zoneResponse.data?.hasPermitZone && zoneResponse.data.zones?.length > 0) {
                const derivedZone = String(zoneResponse.data.zones[0].zone);
                if (isMountedRef.current) {
                  setHomePermitZone(derivedZone);
                  setPermitZoneInput(derivedZone);
                  await AsyncStorage.setItem(StorageKeys.HOME_PERMIT_ZONE, derivedZone);
                  log.info(`Derived home permit zone from address "${homeAddress}": ${derivedZone}`);
                }
              }
            } catch (zoneErr) {
              log.debug('Could not derive permit zone from address (non-fatal):', zoneErr);
            }
          }
        } catch (serverError) {
          // Non-fatal — user can set it manually
          log.debug('Could not fetch profile for permit zone (non-fatal):', serverError);
        }
      }
    } catch (error) {
      log.error('Error loading home permit zone', error);
    }
  }, []);

  const saveHomePermitZone = useCallback(async (zone: string) => {
    const trimmed = zone.trim();
    try {
      if (trimmed) {
        await AsyncStorage.setItem(StorageKeys.HOME_PERMIT_ZONE, trimmed);
      } else {
        await AsyncStorage.removeItem(StorageKeys.HOME_PERMIT_ZONE);
      }
      setHomePermitZone(trimmed);
      setPermitZoneEditing(false);
      log.info(`Home permit zone ${trimmed ? `set to: ${trimmed}` : 'cleared'}`);
      showFeedback(trimmed ? `Home zone set to ${trimmed}` : 'Home zone cleared');
    } catch (error) {
      log.error('Error saving home permit zone', error);
    }
  }, [showFeedback]);

  const toggleCameraAlerts = useCallback(async (value: boolean) => {
    try {
      setCameraAlertsEnabled(value);
      setSpeedCameraAlertsEnabled(value);
      setRedLightCameraAlertsEnabled(value);
      await CameraAlertService.setEnabled(value);
      await loadCameraAlertSettings();
      showFeedback(value ? 'Camera alerts enabled' : 'Camera alerts disabled');
    } catch (error) {
      log.error('Error updating camera alerts', error);
      await loadCameraAlertSettings();
      Alert.alert('Save failed', 'Could not save camera alert settings. Please try again.');
    }
  }, [loadCameraAlertSettings, showFeedback]);

  const toggleSpeedCameraAlerts = useCallback(async (value: boolean) => {
    try {
      setSpeedCameraAlertsEnabled(value);
      await CameraAlertService.setSpeedAlertsEnabled(value);
      await loadCameraAlertSettings();
      showFeedback(value ? 'Speed camera alerts enabled' : 'Speed camera alerts disabled');
    } catch (error) {
      log.error('Error updating speed camera alerts', error);
      await loadCameraAlertSettings();
      Alert.alert('Save failed', 'Could not save speed camera setting. Please try again.');
    }
  }, [loadCameraAlertSettings, showFeedback]);

  const toggleRedLightCameraAlerts = useCallback(async (value: boolean) => {
    try {
      setRedLightCameraAlertsEnabled(value);
      await CameraAlertService.setRedLightAlertsEnabled(value);
      await loadCameraAlertSettings();
      showFeedback(value ? 'Red-light alerts enabled' : 'Red-light alerts disabled');
    } catch (error) {
      log.error('Error updating red-light camera alerts', error);
      await loadCameraAlertSettings();
      Alert.alert('Save failed', 'Could not save red-light camera setting. Please try again.');
    }
  }, [loadCameraAlertSettings, showFeedback]);

  const updateSetting = (key: keyof AppSettings, value: boolean) => {
    saveSettings({ ...settings, [key]: value });
    const labels: Record<keyof AppSettings, string> = {
      notificationsEnabled: 'Push notifications',
      criticalAlertsEnabled: 'Critical alerts',
    };
    showFeedback(`${labels[key]} ${value ? 'enabled' : 'disabled'}`);
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
                    setHomePermitZone('');
                    setPermitZoneInput('');
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

  const handleDeleteAccount = useCallback(() => {
    if (deletingAccountRef.current) return;
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'Your account, parking history, and all personal data will be permanently deleted.',
              [
                { text: 'No, keep my account', style: 'cancel' },
                {
                  text: 'Yes, delete my account',
                  style: 'destructive',
                  onPress: async () => {
                    deletingAccountRef.current = true;
                    if (isMountedRef.current) setIsDeletingAccount(true);
                    try {
                      await AsyncStorage.clear();
                      const result = await AuthService.deleteAccount();
                      if (result.success) {
                        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
                      } else {
                        if (isMountedRef.current) {
                          Alert.alert('Error', result.error || 'Failed to delete account. Please try again.');
                        }
                      }
                    } catch (error) {
                      log.error('Error deleting account', error);
                      if (isMountedRef.current) {
                        Alert.alert('Error', 'Failed to delete account. Please try again.');
                      }
                    } finally {
                      deletingAccountRef.current = false;
                      if (isMountedRef.current) setIsDeletingAccount(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Inline feedback banner */}
      {feedbackMessage && (
        <RNAnimated.View
          style={[styles.feedbackBanner, { opacity: feedbackOpacity }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={feedbackMessage}
        >
          <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
          <Text style={styles.feedbackText}>{feedbackMessage}</Text>
        </RNAnimated.View>
      )}
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
          {!cameraSettingsLoaded ? (
            <View style={styles.settingRow}>
              <MaterialCommunityIcons name="camera" size={20} color={colors.info} style={styles.rowIcon} />
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Camera Alerts (BETA)</Text>
                <Text style={styles.settingSubtitle}>Loading saved camera alert setting...</Text>
              </View>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <SettingRow
              icon="camera"
              iconColor={colors.info}
              title="Camera Alerts (BETA)"
              subtitle="Audio alerts when approaching speed & red light cameras while driving"
              value={cameraAlertsEnabled}
              onValueChange={toggleCameraAlerts}
            />
          )}
          {cameraSettingsLoaded && cameraAlertsEnabled && (
            <>
              <Divider />
              <SettingRow
                icon="speedometer"
                iconColor={colors.info}
                title="Speed Cameras"
                subtitle="Audio cue before known speed cameras"
                value={speedCameraAlertsEnabled}
                onValueChange={toggleSpeedCameraAlerts}
              />
              <Divider />
              <SettingRow
                icon="traffic-light"
                iconColor={colors.info}
                title="Red-Light Cameras"
                subtitle="Audio cue before known red-light cameras"
                value={redLightCameraAlertsEnabled}
                onValueChange={toggleRedLightCameraAlerts}
              />
              <Divider />
              <LinkRow
                icon="volume-high"
                iconColor={colors.info}
                title="Preview Alert Sound"
                onPress={async () => {
                  // Show immediate feedback that we're trying
                  Alert.alert('Testing...', 'Attempting to speak. Check your volume is up.');

                  try {
                    const success = await CameraAlertService.previewAlert();
                    if (!success) {
                      Alert.alert(
                        'Text-to-Speech Unavailable',
                        'Could not initialize TTS. Please check Settings > Accessibility > Text-to-Speech and ensure a TTS engine is installed.',
                        [{ text: 'OK' }]
                      );
                    }
                  } catch (err: any) {
                    Alert.alert('TTS Error', err?.message || String(err));
                  }
                }}
              />
              {Platform.OS === 'ios' && (
                <>
                  <Divider />
                  <LinkRow
                    icon="cellphone-sound"
                    iconColor={colors.info}
                    title="Test Background Alert"
                    onPress={async () => {
                      Alert.alert(
                        'Background Audio Test',
                        'After pressing OK, you have 5 seconds to leave the app (press Home or swipe up). You will hear a spoken camera alert and see a notification while the app is in the background.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'OK',
                            onPress: async () => {
                              try {
                                await BackgroundLocationService.testBackgroundTTS(5);
                              } catch (err: any) {
                                Alert.alert('Error', err?.message || String(err));
                              }
                            },
                          },
                        ]
                      );
                    }}
                  />
                </>
              )}
            </>
          )}
          <Divider />
          <SettingRow
            icon="timer-alert-outline"
            iconColor={colors.warning}
            title="Meter Expiry Alerts"
            subtitle="Notify when max meter time is about to expire"
            value={meterExpiryAlertsEnabled}
            onValueChange={toggleMeterExpiryAlerts}
          />
        </Section>

        {/* Permit Zone */}
        <Section title="Your Permit Zone">
          <View style={styles.permitZoneRow}>
            <MaterialCommunityIcons name="parking" size={20} color={colors.primary} style={styles.rowIcon} />
            <View style={styles.settingInfo}>
              {permitZoneEditing ? (
                <View style={styles.permitZoneEditRow}>
                  <TextInput
                    style={styles.permitZoneInput}
                    value={permitZoneInput}
                    onChangeText={setPermitZoneInput}
                    placeholder="e.g. 383"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="default"
                    autoCapitalize="characters"
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => saveHomePermitZone(permitZoneInput)}
                    accessibilityLabel="Home permit zone number"
                    accessibilityHint="Enter your zone number, for example 383"
                  />
                  <TouchableOpacity
                    style={styles.permitZoneSaveBtn}
                    onPress={() => saveHomePermitZone(permitZoneInput)}
                    accessibilityLabel="Save permit zone"
                    accessibilityRole="button"
                  >
                    <Text style={styles.permitZoneSaveBtnText}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.permitZoneCancelBtn}
                    onPress={() => { setPermitZoneEditing(false); setPermitZoneInput(homePermitZone); }}
                    accessibilityLabel="Cancel editing"
                    accessibilityRole="button"
                  >
                    <Text style={styles.permitZoneCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => { setPermitZoneEditing(true); setPermitZoneInput(homePermitZone); }}
                  accessibilityLabel={homePermitZone ? `Home permit zone ${homePermitZone}. Tap to edit.` : 'Set your home permit zone'}
                  accessibilityRole="button"
                  accessibilityHint="Opens zone number editor"
                >
                  <Text style={styles.settingTitle}>
                    {homePermitZone ? `Zone ${homePermitZone}` : 'Set your home zone'}
                  </Text>
                  <Text style={styles.settingSubtitle}>
                    {homePermitZone
                      ? "You won't be notified when parked in this zone"
                      : 'Tap to set - avoids unnecessary permit zone alerts'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {!permitZoneEditing && (
              <MaterialCommunityIcons name="pencil" size={18} color={colors.textTertiary} />
            )}
          </View>
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
          <LinkRow
            icon="logout"
            title={isSigningOut ? 'Signing Out...' : 'Sign Out'}
            onPress={handleSignOut}
            danger
          />
          <Divider />
          <LinkRow
            icon="trash-can-outline"
            title="Clear All Data"
            onPress={clearAllData}
            danger
          />
          <Divider />
          <LinkRow
            icon="account-remove"
            title={isDeletingAccount ? 'Deleting Account...' : 'Delete Account'}
            onPress={handleDeleteAccount}
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

  // Permit zone
  permitZoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
  permitZoneEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  permitZoneInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  permitZoneSaveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  permitZoneSaveBtnText: {
    color: '#fff',
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
  },
  permitZoneCancelBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  permitZoneCancelBtnText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 56, // icon width + padding to align with text
  },

  // Feedback banner
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successBg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    gap: spacing.sm,
  },
  feedbackText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.success,
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
