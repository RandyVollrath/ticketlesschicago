import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

interface NotificationPreferencesProps {
  userId: string;
  onSave?: () => void;
}

interface Preferences {
  // Street Cleaning Alerts
  street_cleaning_sms: boolean;
  street_cleaning_email: boolean;
  notify_days_array: number[];
  notify_evening_before: boolean;

  // Snow Ban Alerts
  snow_ban_sms: boolean;
  snow_ban_email: boolean;

  // Renewal Reminders
  renewal_reminder_sms: boolean;
  renewal_reminder_email: boolean;
  renewal_reminder_days: number;

  // Marketing
  marketing_emails: boolean;

  // Phone calls
  phone_call_enabled: boolean;
}

const defaultPreferences: Preferences = {
  street_cleaning_sms: true,
  street_cleaning_email: true,
  notify_days_array: [1],
  notify_evening_before: false,
  snow_ban_sms: true,
  snow_ban_email: true,
  renewal_reminder_sms: true,
  renewal_reminder_email: true,
  renewal_reminder_days: 30,
  marketing_emails: true,
  phone_call_enabled: false,
};

// Icons
const Icons = {
  bell: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  mail: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  phone: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  messageSquare: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  snowflake: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M20 12l-4-4V4" />
      <path d="M4 12l4-4V4" />
      <path d="M20 12l-4 4v4" />
      <path d="M4 12l4 4v4" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </svg>
  ),
  calendar: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  car: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
      <circle cx="6.5" cy="16.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  ),
};

export default function NotificationPreferences({ userId, onSave }: NotificationPreferencesProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);

  useEffect(() => {
    loadPreferences();
  }, [userId]);

  async function loadPreferences() {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('notify_days_array, notify_evening_before, phone_call_enabled, notify_sms, notify_email, marketing_consent')
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      if (data) {
        setPreferences({
          ...defaultPreferences,
          notify_days_array: data.notify_days_array || [1],
          notify_evening_before: data.notify_evening_before || false,
          phone_call_enabled: data.phone_call_enabled || false,
          street_cleaning_sms: data.notify_sms !== false,
          street_cleaning_email: data.notify_email !== false,
          snow_ban_sms: data.notify_sms !== false,
          snow_ban_email: data.notify_email !== false,
          renewal_reminder_sms: data.notify_sms !== false,
          renewal_reminder_email: data.notify_email !== false,
          marketing_emails: data.marketing_consent !== false,
        });
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
    } finally {
      setLoading(false);
    }
  }

  async function savePreferences() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          notify_days_array: preferences.notify_days_array,
          notify_evening_before: preferences.notify_evening_before,
          phone_call_enabled: preferences.phone_call_enabled,
          sms_enabled: preferences.street_cleaning_sms,
          email_enabled: preferences.street_cleaning_email,
          marketing_opt_out: !preferences.marketing_emails,
        })
        .eq('user_id', userId);

      if (error) throw error;

      toast.success('Notification preferences saved');
      if (onSave) onSave();
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast.error('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  }

  const toggleDayNotification = (day: number) => {
    setPreferences(prev => {
      const days = prev.notify_days_array.includes(day)
        ? prev.notify_days_array.filter(d => d !== day)
        : [...prev.notify_days_array, day].sort((a, b) => a - b);
      return { ...prev, notify_days_array: days };
    });
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: COLORS.slate }}>
        Loading preferences...
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '16px',
      border: `1px solid ${COLORS.border}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px',
        borderBottom: `1px solid ${COLORS.border}`,
        backgroundColor: COLORS.concrete,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: `${COLORS.regulatory}10`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: COLORS.regulatory,
          }}>
            {Icons.bell}
          </div>
          <div>
            <h3 style={{
              fontSize: '18px',
              fontWeight: '600',
              color: COLORS.graphite,
              margin: 0,
              fontFamily: '"Space Grotesk", sans-serif',
            }}>
              Notification Preferences
            </h3>
            <p style={{ fontSize: '14px', color: COLORS.slate, margin: '4px 0 0 0' }}>
              Control how and when you receive alerts
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px' }}>
        {/* Street Cleaning Alerts */}
        <PreferenceSection
          icon={Icons.car}
          iconColor={COLORS.warning}
          title="Street Cleaning Alerts"
          description="Get notified before street cleaning"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Channels */}
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              <ToggleSwitch
                label="SMS Text"
                icon={Icons.messageSquare}
                checked={preferences.street_cleaning_sms}
                onChange={(checked) => setPreferences(p => ({ ...p, street_cleaning_sms: checked }))}
              />
              <ToggleSwitch
                label="Email"
                icon={Icons.mail}
                checked={preferences.street_cleaning_email}
                onChange={(checked) => setPreferences(p => ({ ...p, street_cleaning_email: checked }))}
              />
            </div>

            {/* Timing */}
            <div>
              <p style={{ fontSize: '13px', fontWeight: '500', color: COLORS.slate, margin: '0 0 10px 0' }}>
                Notify me:
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { day: 0, label: 'Day of' },
                  { day: 1, label: '1 day before' },
                  { day: 2, label: '2 days before' },
                  { day: 3, label: '3 days before' },
                ].map(({ day, label }) => (
                  <button
                    key={day}
                    onClick={() => toggleDayNotification(day)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      border: `1px solid ${preferences.notify_days_array.includes(day) ? COLORS.regulatory : COLORS.border}`,
                      backgroundColor: preferences.notify_days_array.includes(day) ? `${COLORS.regulatory}10` : 'white',
                      color: preferences.notify_days_array.includes(day) ? COLORS.regulatory : COLORS.slate,
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <ToggleSwitch
              label="Evening before (8 PM reminder)"
              checked={preferences.notify_evening_before}
              onChange={(checked) => setPreferences(p => ({ ...p, notify_evening_before: checked }))}
            />
          </div>
        </PreferenceSection>

        {/* Snow Ban Alerts */}
        <PreferenceSection
          icon={Icons.snowflake}
          iconColor="#3b82f6"
          title="Snow Ban Alerts"
          description="Alerts for 2-inch snow parking bans"
        >
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <ToggleSwitch
              label="SMS Text"
              icon={Icons.messageSquare}
              checked={preferences.snow_ban_sms}
              onChange={(checked) => setPreferences(p => ({ ...p, snow_ban_sms: checked }))}
            />
            <ToggleSwitch
              label="Email"
              icon={Icons.mail}
              checked={preferences.snow_ban_email}
              onChange={(checked) => setPreferences(p => ({ ...p, snow_ban_email: checked }))}
            />
          </div>
        </PreferenceSection>

        {/* Renewal Reminders */}
        <PreferenceSection
          icon={Icons.calendar}
          iconColor={COLORS.signal}
          title="Renewal Reminders"
          description="City sticker and license plate renewal alerts"
        >
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <ToggleSwitch
              label="SMS Text"
              icon={Icons.messageSquare}
              checked={preferences.renewal_reminder_sms}
              onChange={(checked) => setPreferences(p => ({ ...p, renewal_reminder_sms: checked }))}
            />
            <ToggleSwitch
              label="Email"
              icon={Icons.mail}
              checked={preferences.renewal_reminder_email}
              onChange={(checked) => setPreferences(p => ({ ...p, renewal_reminder_email: checked }))}
            />
          </div>
        </PreferenceSection>

        {/* Phone Calls */}
        <PreferenceSection
          icon={Icons.phone}
          iconColor="#8b5cf6"
          title="Phone Call Alerts"
          description="Receive voice calls for critical alerts"
          isLast
        >
          <ToggleSwitch
            label="Enable phone call alerts"
            checked={preferences.phone_call_enabled}
            onChange={(checked) => setPreferences(p => ({ ...p, phone_call_enabled: checked }))}
          />
          <p style={{ fontSize: '12px', color: COLORS.slate, margin: '8px 0 0 0' }}>
            We'll only call for urgent alerts like same-day street cleaning
          </p>
        </PreferenceSection>

        {/* Marketing */}
        <div style={{
          padding: '16px 0 0 0',
          borderTop: `1px solid ${COLORS.border}`,
          marginTop: '8px',
        }}>
          <ToggleSwitch
            label="Product updates and tips"
            checked={preferences.marketing_emails}
            onChange={(checked) => setPreferences(p => ({ ...p, marketing_emails: checked }))}
          />
          <p style={{ fontSize: '12px', color: COLORS.slate, margin: '8px 0 0 0' }}>
            Occasional emails about new features and Chicago parking tips
          </p>
        </div>

        {/* Save Button */}
        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${COLORS.border}` }}>
          <button
            onClick={savePreferences}
            disabled={saving}
            style={{
              backgroundColor: saving ? COLORS.slate : COLORS.regulatory,
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              padding: '12px 24px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
              transition: 'all 0.2s',
            }}
          >
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Preference Section Component
function PreferenceSection({
  icon,
  iconColor,
  title,
  description,
  children,
  isLast = false,
}: {
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  description: string;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div style={{
      paddingBottom: isLast ? 0 : '20px',
      marginBottom: isLast ? 0 : '20px',
      borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          backgroundColor: `${iconColor}15`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: iconColor,
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <div>
          <h4 style={{ fontSize: '15px', fontWeight: '600', color: COLORS.graphite, margin: 0 }}>
            {title}
          </h4>
          <p style={{ fontSize: '13px', color: COLORS.slate, margin: '2px 0 0 0' }}>
            {description}
          </p>
        </div>
      </div>
      <div style={{ paddingLeft: '44px' }}>
        {children}
      </div>
    </div>
  );
}

// Toggle Switch Component
function ToggleSwitch({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      cursor: 'pointer',
    }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: '44px',
          height: '24px',
          borderRadius: '12px',
          backgroundColor: checked ? COLORS.signal : COLORS.border,
          position: 'relative',
          transition: 'background-color 0.2s',
          cursor: 'pointer',
        }}
      >
        <div style={{
          position: 'absolute',
          top: '2px',
          left: checked ? '22px' : '2px',
          width: '20px',
          height: '20px',
          borderRadius: '10px',
          backgroundColor: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.2s',
        }} />
      </div>
      {icon && <span style={{ color: COLORS.slate, display: 'flex' }}>{icon}</span>}
      <span style={{ fontSize: '14px', color: COLORS.graphite, fontWeight: '500' }}>{label}</span>
    </label>
  );
}
