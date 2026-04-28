import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import AuthService from '../services/AuthService';
import Logger from '../utils/Logger';

const log = Logger.createLogger('RenewalDatesPromptCard');

const DISMISS_KEY = 'autopilot.renewal_dates_prompt_dismissed_v1';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Phase = 'loading' | 'hidden' | 'visible' | 'saving';

const RenewalDatesPromptCard: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [cityStickerExpiry, setCityStickerExpiry] = useState('');
  const [licensePlateExpiry, setLicensePlateExpiry] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dismissed = await AsyncStorage.getItem(DISMISS_KEY);
        if (dismissed === 'true') {
          if (!cancelled) setPhase('hidden');
          return;
        }

        const user = AuthService.getUser();
        if (!user) {
          if (!cancelled) setPhase('hidden');
          return;
        }

        const supabase = AuthService.getSupabaseClient();
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('is_paid, has_contesting, city_sticker_expiry, license_plate_expiry')
          .eq('user_id', user.id)
          .maybeSingle();

        const paid = profile?.is_paid === true || profile?.has_contesting === true;
        const hasCity = Boolean(profile?.city_sticker_expiry);
        const hasPlate = Boolean(profile?.license_plate_expiry);

        if (!paid) {
          if (!cancelled) setPhase('hidden');
          return;
        }

        if (hasCity && hasPlate) {
          await AsyncStorage.setItem(DISMISS_KEY, 'true');
          if (!cancelled) setPhase('hidden');
          return;
        }

        if (!cancelled) {
          setCityStickerExpiry(profile?.city_sticker_expiry || '');
          setLicensePlateExpiry(profile?.license_plate_expiry || '');
          setPhase('visible');
        }
      } catch (e) {
        log.warn('Failed to evaluate renewal-dates prompt', e);
        if (!cancelled) setPhase('hidden');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSkip = useCallback(async () => {
    await AsyncStorage.setItem(DISMISS_KEY, 'true');
    setPhase('hidden');
  }, []);

  const handleSave = useCallback(async () => {
    const city = cityStickerExpiry.trim();
    const plate = licensePlateExpiry.trim();

    if (!city && !plate) {
      Alert.alert('Add at least one date', 'Enter your city sticker or license plate expiry, or tap "Skip for now".');
      return;
    }
    if (city && !ISO_DATE_RE.test(city)) {
      Alert.alert('Invalid date', 'City sticker expiry must be in YYYY-MM-DD format.');
      return;
    }
    if (plate && !ISO_DATE_RE.test(plate)) {
      Alert.alert('Invalid date', 'License plate expiry must be in YYYY-MM-DD format.');
      return;
    }

    setPhase('saving');
    try {
      const user = AuthService.getUser();
      if (!user) throw new Error('Not authenticated');
      const supabase = AuthService.getSupabaseClient();

      const updates: Record<string, string | null> = {
        updated_at: new Date().toISOString(),
      };
      if (city) updates.city_sticker_expiry = city;
      if (plate) updates.license_plate_expiry = plate;

      const { error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('user_id', user.id);

      if (error) throw error;

      await AsyncStorage.setItem(DISMISS_KEY, 'true');
      setPhase('hidden');
    } catch (e: any) {
      log.error('Failed to save renewal dates', e);
      Alert.alert('Could not save', e?.message || 'Please try again.');
      setPhase('visible');
    }
  }, [cityStickerExpiry, licensePlateExpiry]);

  if (phase === 'loading' || phase === 'hidden') return null;

  const saving = phase === 'saving';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="calendar-clock" size={24} color={colors.primary} />
        <Text style={styles.title}>Add your renewal dates</Text>
      </View>
      <Text style={styles.subtitle}>
        We'll send you a heads-up before your city sticker or license plate expires so you don't get a $200 ticket. You can find both dates on your current sticker.
      </Text>

      <Text style={styles.fieldLabel}>City sticker expiry</Text>
      <TextInput
        style={styles.input}
        value={cityStickerExpiry}
        onChangeText={setCityStickerExpiry}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        editable={!saving}
      />

      <Text style={styles.fieldLabel}>License plate expiry</Text>
      <TextInput
        style={styles.input}
        value={licensePlateExpiry}
        onChangeText={setLicensePlateExpiry}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        editable={!saving}
      />

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.skipButton}
          onPress={handleSkip}
          disabled={saving}
          activeOpacity={0.7}
        >
          <Text style={styles.skipButtonText}>Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.7}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
    marginBottom: spacing.base,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    ...shadows.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
    marginLeft: spacing.sm,
  },
  subtitle: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.base,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  skipButton: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    fontWeight: typography.weights.medium,
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: typography.sizes.base,
    color: '#fff',
    fontWeight: typography.weights.semibold,
  },
});

export default RenewalDatesPromptCard;
