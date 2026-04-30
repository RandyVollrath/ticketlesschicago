import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import {
  chicagoDateISO,
  formatChicagoDate,
  getChicagoNow,
} from '../utils/chicagoTime';

export type WhenMode = 'now' | 'specific' | 'range';

export interface WhenSelection {
  mode: WhenMode;
  // For 'specific': single date + hour
  date?: string;       // YYYY-MM-DD in Chicago tz
  hour?: number;       // 0-23 in Chicago tz
  // For 'range':
  startDate?: string;
  endDate?: string;
}

interface Props {
  value: WhenSelection;
  onChange: (next: WhenSelection) => void;
  // How many days into the future the date strip allows. Default 30.
  horizonDays?: number;
}

// Build a list of YYYY-MM-DD strings starting at "today in Chicago",
// going forward `count` days. Used by the date-strip modal.
function buildDateStrip(count: number): string[] {
  const out: string[] = [];
  const start = getChicagoNow();
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

// Short label for the date strip pills: "Today", "Tomorrow", "Tue 6"
function shortDateLabel(iso: string, todayISO: string, tomorrowISO: string): string {
  if (iso === todayISO) return 'Today';
  if (iso === tomorrowISO) return 'Tomorrow';
  const parsed = new Date(iso + 'T12:00:00');
  const dow = parsed.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Chicago' });
  const day = parsed.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/Chicago' });
  return `${dow} ${day}`;
}

const MODE_OPTIONS: Array<{ key: WhenMode; label: string; icon: string }> = [
  { key: 'now', label: 'Now', icon: 'clock-outline' },
  { key: 'specific', label: 'Date & time', icon: 'calendar-clock' },
  { key: 'range', label: 'Date range', icon: 'calendar-range' },
];

export function WhenPicker({ value, onChange, horizonDays = 30 }: Props) {
  const [pickerOpen, setPickerOpen] = useState<null | 'specific-date' | 'specific-hour' | 'range-start' | 'range-end'>(null);

  const todayISO = useMemo(() => chicagoDateISO(), []);
  const tomorrowISO = useMemo(() => {
    const d = getChicagoNow();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  const dateStrip = useMemo(() => buildDateStrip(horizonDays), [horizonDays]);

  const setMode = useCallback((mode: WhenMode) => {
    if (mode === 'now') {
      onChange({ mode: 'now' });
    } else if (mode === 'specific') {
      onChange({
        mode: 'specific',
        date: value.date || todayISO,
        hour: value.hour ?? new Date().getHours(),
      });
    } else {
      // For range: default to today + 7 days
      const week = dateStrip[Math.min(6, dateStrip.length - 1)];
      onChange({
        mode: 'range',
        startDate: value.startDate || todayISO,
        endDate: value.endDate || week,
      });
    }
  }, [onChange, value, todayISO, dateStrip]);

  const pillLabel = (iso?: string) => iso ? formatChicagoDate(iso) : 'Pick date';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon name="calendar-clock-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.headerText}>When are you parking?</Text>
      </View>

      {/* Segmented control */}
      <View style={styles.segmentRow}>
        {MODE_OPTIONS.map(opt => {
          const active = value.mode === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => setMode(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.label}
            >
              <Icon
                name={opt.icon}
                size={14}
                color={active ? colors.white : colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Pills under the segmented control */}
      {value.mode === 'specific' && (
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={styles.pill}
            onPress={() => setPickerOpen('specific-date')}
            accessibilityLabel="Choose date"
          >
            <Icon name="calendar" size={14} color={colors.primary} />
            <Text style={styles.pillText}>{pillLabel(value.date)}</Text>
            <Icon name="chevron-down" size={14} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.pill}
            onPress={() => setPickerOpen('specific-hour')}
            accessibilityLabel="Choose hour"
          >
            <Icon name="clock-outline" size={14} color={colors.primary} />
            <Text style={styles.pillText}>{value.hour !== undefined ? formatHour(value.hour) : 'Pick time'}</Text>
            <Icon name="chevron-down" size={14} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {value.mode === 'range' && (
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={styles.pill}
            onPress={() => setPickerOpen('range-start')}
            accessibilityLabel="Choose start date"
          >
            <Icon name="ray-start" size={14} color={colors.primary} />
            <Text style={styles.pillText}>{pillLabel(value.startDate)}</Text>
            <Icon name="chevron-down" size={14} color={colors.textTertiary} />
          </TouchableOpacity>
          <Text style={styles.rangeArrow}>→</Text>
          <TouchableOpacity
            style={styles.pill}
            onPress={() => setPickerOpen('range-end')}
            accessibilityLabel="Choose end date"
          >
            <Icon name="ray-end" size={14} color={colors.primary} />
            <Text style={styles.pillText}>{pillLabel(value.endDate)}</Text>
            <Icon name="chevron-down" size={14} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Modal: date strip */}
      <Modal
        visible={pickerOpen === 'specific-date' || pickerOpen === 'range-start' || pickerOpen === 'range-end'}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(null)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={styles.sheetDismissArea} activeOpacity={1} onPress={() => setPickerOpen(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {pickerOpen === 'specific-date' ? 'Pick a date'
                : pickerOpen === 'range-start' ? 'Trip starts'
                : 'Trip ends'}
            </Text>
            <Text style={styles.sheetSubtitle}>Chicago time</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
              <View style={styles.dateGrid}>
                {dateStrip.map(iso => {
                  const selected = pickerOpen === 'specific-date' ? value.date === iso
                    : pickerOpen === 'range-start' ? value.startDate === iso
                    : value.endDate === iso;
                  // Disable end-dates before start-date in range mode
                  const disabled = pickerOpen === 'range-end' && value.startDate ? iso < value.startDate : false;
                  return (
                    <TouchableOpacity
                      key={iso}
                      style={[styles.dateChip, selected && styles.dateChipSelected, disabled && styles.dateChipDisabled]}
                      disabled={disabled}
                      onPress={() => {
                        if (pickerOpen === 'specific-date') onChange({ ...value, date: iso });
                        else if (pickerOpen === 'range-start') {
                          // Snap end forward if it's now before start
                          const newEnd = value.endDate && value.endDate < iso ? iso : value.endDate;
                          onChange({ ...value, startDate: iso, endDate: newEnd });
                        } else {
                          onChange({ ...value, endDate: iso });
                        }
                        setPickerOpen(null);
                      }}
                    >
                      {iso === todayISO ? (
                        <Text style={[styles.dateChipBig, selected && styles.dateChipTextSelected, disabled && styles.dateChipTextDisabled]}>Today</Text>
                      ) : iso === tomorrowISO ? (
                        <Text style={[styles.dateChipBig, selected && styles.dateChipTextSelected, disabled && styles.dateChipTextDisabled]}>Tom.</Text>
                      ) : (
                        <>
                          <Text style={[styles.dateChipDow, selected && styles.dateChipTextSelected, disabled && styles.dateChipTextDisabled]}>
                            {shortDateLabel(iso, todayISO, tomorrowISO).split(' ')[0]}
                          </Text>
                          <Text style={[styles.dateChipDay, selected && styles.dateChipTextSelected, disabled && styles.dateChipTextDisabled]}>
                            {shortDateLabel(iso, todayISO, tomorrowISO).split(' ')[1]}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal: hour grid */}
      <Modal
        visible={pickerOpen === 'specific-hour'}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(null)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={styles.sheetDismissArea} activeOpacity={1} onPress={() => setPickerOpen(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Pick a time</Text>
            <Text style={styles.sheetSubtitle}>Chicago time</Text>
            <View style={styles.hourGrid}>
              {Array.from({ length: 24 }, (_, h) => {
                const selected = value.hour === h;
                return (
                  <TouchableOpacity
                    key={h}
                    style={[styles.hourChip, selected && styles.hourChipSelected]}
                    onPress={() => {
                      onChange({ ...value, hour: h });
                      setPickerOpen(null);
                    }}
                  >
                    <Text style={[styles.hourChipText, selected && styles.hourChipTextSelected]}>
                      {formatHour(h)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  headerText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colors.textSecondary,
  },

  // Segmented control
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: borderRadius.full,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: borderRadius.full,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.white,
  },

  // Pills
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primaryTint,
    borderRadius: borderRadius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '20',
  },
  pillText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.primary,
  },
  rangeArrow: {
    fontSize: typography.sizes.md,
    color: colors.textTertiary,
    fontWeight: typography.weights.bold,
  },

  // Sheet (modal) — bottom-anchored card
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheetDismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xxl : spacing.lg,
    ...shadows.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  sheetSubtitle: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginTop: 2,
    marginBottom: spacing.md,
  },

  // Date grid (rendered as flex-wrap pills, 7 wide for "weeks")
  dateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: spacing.md,
  },
  dateChip: {
    width: '13.5%',
    minWidth: 44,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dateChipDisabled: {
    opacity: 0.35,
  },
  dateChipDow: {
    fontSize: 10,
    fontWeight: typography.weights.semibold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  dateChipDay: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },
  dateChipTextSelected: {
    color: colors.white,
  },
  dateChipTextDisabled: {
    color: colors.textTertiary,
  },
  dateChipBig: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.bold,
    color: colors.textPrimary,
  },

  // Hour grid (4 cols x 6 rows)
  hourGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hourChip: {
    width: '23%',
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hourChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  hourChipText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.textPrimary,
  },
  hourChipTextSelected: {
    color: colors.white,
  },
});

export default WhenPicker;
