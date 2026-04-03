import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, typography, spacing } from '../theme';

const DISCLOSURE_ACCEPTED_KEY = 'locationDisclosureAccepted';

interface LocationDisclosureScreenProps {
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Google Play Prominent Disclosure screen for background location.
 *
 * Google requires a dedicated, standalone screen (not a dialog) that explains:
 * - What data is accessed (background location)
 * - Why it's needed
 * - How it's used
 * - A consent action before the system permission dialog
 *
 * This screen is shown once on Android before requesting ACCESS_BACKGROUND_LOCATION.
 */
export default function LocationDisclosureScreen({ onAccept, onDecline }: LocationDisclosureScreenProps) {
  const handleAccept = async () => {
    await AsyncStorage.setItem(DISCLOSURE_ACCEPTED_KEY, 'true');
    onAccept();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.iconContainer}>
          <MaterialCommunityIcons
            name="map-marker-radius"
            size={64}
            color={colors.primary}
          />
        </View>

        <Text style={styles.title}>Background Location Access</Text>

        <Text style={styles.description}>
          Autopilot America needs access to your location <Text style={styles.bold}>all the time</Text>, including when the app is closed or not in use.
        </Text>

        <View style={styles.reasonsContainer}>
          <View style={styles.reason}>
            <MaterialCommunityIcons name="car" size={24} color={colors.primary} />
            <View style={styles.reasonText}>
              <Text style={styles.reasonTitle}>Automatic Parking Detection</Text>
              <Text style={styles.reasonBody}>
                Detects when you park and automatically checks for street cleaning, permit zones, and other parking restrictions at your location.
              </Text>
            </View>
          </View>

          <View style={styles.reason}>
            <MaterialCommunityIcons name="camera" size={24} color={colors.primary} />
            <View style={styles.reasonText}>
              <Text style={styles.reasonTitle}>Camera Alerts While Driving</Text>
              <Text style={styles.reasonBody}>
                Warns you with audio alerts before you pass red-light and speed cameras, even when the app is in the background.
              </Text>
            </View>
          </View>

          <View style={styles.reason}>
            <MaterialCommunityIcons name="bell-ring" size={24} color={colors.primary} />
            <View style={styles.reasonText}>
              <Text style={styles.reasonTitle}>Move-Your-Car Alerts</Text>
              <Text style={styles.reasonBody}>
                Sends you timely reminders before street cleaning or other restrictions take effect at your parked location.
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.privacyNote}>
          Your location data is only used for parking detection and alerts. It is not shared with third parties or used for advertising. You can change this permission at any time in your device settings.
        </Text>

        <TouchableOpacity style={styles.acceptButton} onPress={handleAccept}>
          <Text style={styles.acceptButtonText}>Allow Background Location</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.declineButton} onPress={onDecline}>
          <Text style={styles.declineButtonText}>Not Now</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Check if the user has already accepted the location disclosure.
 */
export async function hasAcceptedLocationDisclosure(): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // iOS doesn't need this
  const accepted = await AsyncStorage.getItem(DISCLOSURE_ACCEPTED_KEY);
  return accepted === 'true';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    alignItems: 'center',
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
  description: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sizes.base * 1.6,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.base,
  },
  bold: {
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  reasonsContainer: {
    width: '100%',
    marginBottom: spacing.xl,
    gap: spacing.lg,
  },
  reason: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.cardBg,
    padding: spacing.base,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonText: {
    flex: 1,
  },
  reasonTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  reasonBody: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    lineHeight: typography.sizes.sm * 1.5,
  },
  privacyNote: {
    fontSize: typography.sizes.sm,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: typography.sizes.sm * 1.5,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.base,
  },
  acceptButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.base,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  acceptButtonText: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textInverse,
  },
  declineButton: {
    paddingVertical: spacing.base,
  },
  declineButtonText: {
    fontSize: typography.sizes.base,
    color: colors.textTertiary,
  },
});
