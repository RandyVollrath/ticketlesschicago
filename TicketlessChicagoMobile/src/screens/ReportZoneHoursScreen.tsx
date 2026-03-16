import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchCamera } from 'react-native-image-picker';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import ApiClient from '../utils/ApiClient';
import Logger from '../utils/Logger';

const log = Logger.createLogger('ReportZoneHours');

interface RouteParams {
  zone?: string;
  currentSchedule?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export default function ReportZoneHoursScreen({ navigation, route }: any) {
  const params: RouteParams = route?.params || {};
  const [schedule, setSchedule] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64Data, setPhotoBase64Data] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resultMessage, setResultMessage] = useState('');

  const handleTakePhoto = async () => {
    try {
      const result = await launchCamera({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1600,
        maxHeight: 1600,
        includeBase64: true,
        saveToPhotos: false,
      });

      if (result.didCancel || !result.assets?.length) return;

      const asset = result.assets[0];
      if (asset.uri) {
        setPhotoUri(asset.uri);
        setPhotoBase64Data(asset.base64 || null);
      }
    } catch (err: any) {
      log.error('Camera error:', err?.message);
      Alert.alert('Camera Error', 'Could not open camera. Please check permissions.');
    }
  };

  const handleSubmit = async () => {
    if (!schedule.trim()) {
      Alert.alert('Missing Hours', 'Please enter the enforcement hours shown on the sign.');
      return;
    }
    if (!photoUri || !photoBase64Data) {
      Alert.alert('Photo Required', 'Please take a photo of the permit zone sign.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await ApiClient.post('/api/mobile/report-zone-hours', {
        zone: params.zone || '',
        schedule: schedule.trim(),
        currentSchedule: params.currentSchedule || '',
        address: params.address || '',
        latitude: params.latitude,
        longitude: params.longitude,
        photoBase64: photoBase64Data,
      });

      if (response.success || response.applied) {
        setSubmitted(true);
        setResultMessage(response.message || 'Thanks for the correction!');
      } else {
        setResultMessage(response.message || 'We received your report. We\'ll review it shortly.');
        setSubmitted(true);
      }
    } catch (err: any) {
      log.error('Submit error:', err?.message);
      const msg = err?.response?.data?.error || err?.message || 'Something went wrong';
      Alert.alert('Error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Icon name="arrow-left" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Correction Submitted</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.successContainer}>
          <Icon name="check-circle" size={48} color={colors.success} />
          <Text style={styles.successTitle}>Thank you</Text>
          <Text style={styles.successMessage}>{resultMessage}</Text>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Icon name="arrow-left" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Correct Zone Hours</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Context */}
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            Zone {params.zone}
            {params.currentSchedule ? ` currently shows: ${params.currentSchedule}` : ''}
          </Text>
          {params.address ? (
            <Text style={styles.infoSubtext}>{params.address}</Text>
          ) : null}
        </View>

        {/* Schedule input */}
        <Text style={styles.label}>Enforcement hours on the sign</Text>
        <TextInput
          style={styles.input}
          placeholder='e.g. "Mon-Fri 6am-6pm" or "All Days 6pm-6am"'
          placeholderTextColor={colors.textTertiary}
          value={schedule}
          onChangeText={setSchedule}
          autoCapitalize="none"
          returnKeyType="done"
        />

        {/* Photo */}
        <Text style={styles.label}>Photo of the sign</Text>
        {photoUri ? (
          <View style={styles.photoContainer}>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            <TouchableOpacity
              style={styles.retakeButton}
              onPress={handleTakePhoto}
            >
              <Icon name="camera-retake" size={16} color={colors.textSecondary} />
              <Text style={styles.retakeText}>Retake</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.cameraButton} onPress={handleTakePhoto}>
            <Icon name="camera" size={24} color={colors.primary} />
            <Text style={styles.cameraButtonText}>Take photo of sign</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.hint}>
          Photo must be taken at the sign location. GPS in the photo verifies it.
        </Text>

        {/* Submit */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!schedule.trim() || !photoUri || !photoBase64Data || isSubmitting) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!schedule.trim() || !photoUri || !photoBase64Data || isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.submitButtonText}>Submit Correction</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
  },
  headerTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.base,
  },
  infoCard: {
    backgroundColor: colors.infoBg,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
  },
  infoText: {
    fontSize: typography.sizes.sm,
    color: colors.textPrimary,
    fontWeight: typography.weights.medium,
  },
  infoSubtext: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  label: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  cameraButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary + '30',
    paddingVertical: spacing.lg,
    marginBottom: spacing.sm,
    gap: 8,
  },
  cameraButtonText: {
    color: colors.primary,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
  },
  photoContainer: {
    marginBottom: spacing.sm,
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: borderRadius.md,
    backgroundColor: colors.border,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: 4,
  },
  retakeText: {
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
  },
  hint: {
    fontSize: 11,
    color: colors.textTertiary,
    marginBottom: spacing.xl,
    lineHeight: 15,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.primaryGlow,
  },
  submitButtonDisabled: {
    opacity: 0.5,
    ...shadows.sm,
  },
  submitButtonText: {
    color: colors.textInverse,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.bold,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  successTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  successMessage: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  doneButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
  },
  doneButtonText: {
    color: colors.textInverse,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
  },
});
