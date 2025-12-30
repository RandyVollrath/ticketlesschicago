import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { DashboardLayout } from './dashboard';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
  danger: '#DC2626',
};

const TICKET_TYPES = [
  { id: 'expired_plates', label: 'Expired Plates', winRate: 75 },
  { id: 'no_city_sticker', label: 'No City Sticker', winRate: 70 },
  { id: 'expired_meter', label: 'Expired Meter', winRate: 67 },
  { id: 'disabled_zone', label: 'Disabled Zone', winRate: 68 },
  { id: 'street_cleaning', label: 'Street Cleaning', winRate: 34 },
  { id: 'rush_hour', label: 'Rush Hour', winRate: 37 },
  { id: 'fire_hydrant', label: 'Fire Hydrant', winRate: 44 },
  { id: 'other_unknown', label: 'Other / Unknown', winRate: null },
];

interface Settings {
  auto_mail_enabled: boolean;
  require_approval: boolean;
  allowed_ticket_types: string[];
  never_auto_mail_unknown: boolean;
  email_on_ticket_found: boolean;
  email_on_letter_mailed: boolean;
  email_on_approval_needed: boolean;
}

// Toggle switch component
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 52,
        height: 28,
        borderRadius: 28,
        backgroundColor: checked ? COLORS.signal : COLORS.slate,
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background-color 0.2s',
      }}
    >
      <span style={{
        position: 'absolute',
        height: 22,
        width: 22,
        left: checked ? 27 : 3,
        top: 3,
        backgroundColor: COLORS.white,
        borderRadius: '50%',
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({
    auto_mail_enabled: true,
    require_approval: false,
    allowed_ticket_types: ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone'],
    never_auto_mail_unknown: true,
    email_on_ticket_found: true,
    email_on_letter_mailed: true,
    email_on_approval_needed: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/get-started');
      return;
    }

    const { data } = await supabase
      .from('autopilot_settings')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    if (data) {
      setSettings({
        auto_mail_enabled: data.auto_mail_enabled,
        require_approval: data.require_approval,
        allowed_ticket_types: data.allowed_ticket_types || [],
        never_auto_mail_unknown: data.never_auto_mail_unknown,
        email_on_ticket_found: data.email_on_ticket_found,
        email_on_letter_mailed: data.email_on_letter_mailed,
        email_on_approval_needed: data.email_on_approval_needed,
      });
    }
    setLoading(false);
  };

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    setSaved(false);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error: updateError } = await supabase
      .from('autopilot_settings')
      .upsert({
        user_id: session.user.id,
        ...settings,
        updated_at: new Date().toISOString(),
      });

    if (updateError) {
      setError('Failed to save settings. Please try again.');
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  };

  const toggleTicketType = (typeId: string) => {
    if (settings.allowed_ticket_types.includes(typeId)) {
      setSettings({
        ...settings,
        allowed_ticket_types: settings.allowed_ticket_types.filter(t => t !== typeId),
      });
    } else {
      setSettings({
        ...settings,
        allowed_ticket_types: [...settings.allowed_ticket_types, typeId],
      });
    }
  };

  const handleRevokeAuth = async () => {
    if (!confirm('Are you sure? This will stop all letter mailing immediately and pause checks until re-authorized.')) {
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await supabase
      .from('autopilot_subscriptions')
      .update({ authorization_revoked_at: new Date().toISOString() })
      .eq('user_id', session.user.id);

    router.push('/');
  };

  if (loading) {
    return (
      <DashboardLayout activePage="settings">
        <main style={{ padding: 48, textAlign: 'center' }}>Loading...</main>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activePage="settings">
      <Head>
        <title>Settings - Autopilot America</title>
      </Head>

      <main style={{ maxWidth: 700, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.deepHarbor, margin: '0 0 32px 0' }}>
          Settings
        </h1>

        {/* Letter Preferences */}
        <section style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
          marginBottom: 24,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 20px 0' }}>
            Letter preferences
          </h2>

          {/* Auto-mail toggle */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 0',
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: '0 0 4px 0' }}>
                Auto-mail contest letters
              </p>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>
                If off, we'll always request approval first.
              </p>
            </div>
            <Toggle
              checked={settings.auto_mail_enabled}
              onChange={(checked) => setSettings({ ...settings, auto_mail_enabled: checked })}
            />
          </div>

          {/* Require approval toggle */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 0',
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: '0 0 4px 0' }}>
                Require my approval before mailing
              </p>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>
                We generate the letter and notify you. You approve or reject it.
              </p>
            </div>
            <Toggle
              checked={settings.require_approval}
              onChange={(checked) => setSettings({ ...settings, require_approval: checked })}
            />
          </div>

          {/* Ticket types */}
          <div style={{ padding: '20px 0' }}>
            <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: '0 0 4px 0' }}>
              Allowed ticket types for auto-mail
            </p>
            <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 16px 0' }}>
              Only these will be auto-mailed. Others will be skipped or require approval.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {TICKET_TYPES.filter(t => t.id !== 'other_unknown').map(type => (
                <label key={type.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settings.allowed_ticket_types.includes(type.id)}
                    onChange={() => toggleTicketType(type.id)}
                    style={{ width: 18, height: 18, accentColor: COLORS.regulatory }}
                  />
                  <span style={{ flex: 1, fontSize: 14, color: COLORS.graphite }}>{type.label}</span>
                  {type.winRate && (
                    <span style={{
                      fontSize: 12,
                      color: type.winRate >= 60 ? COLORS.signal : COLORS.slate,
                      fontWeight: 500,
                    }}>
                      {type.winRate}% win rate
                    </span>
                  )}
                </label>
              ))}
            </div>

            <p style={{
              fontSize: 13,
              color: COLORS.slate,
              margin: '16px 0 0 0',
              padding: '12px 16px',
              backgroundColor: COLORS.concrete,
              borderRadius: 8,
            }}>
              Tip: Start with the ticket types you're most confident you want to contest.
            </p>
          </div>

          {/* Never auto-mail unknown */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 0',
            borderTop: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: '0 0 4px 0' }}>
                Never auto-mail 'Other/Unknown' violations
              </p>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>
                These always require manual review.
              </p>
            </div>
            <Toggle
              checked={settings.never_auto_mail_unknown}
              onChange={(checked) => setSettings({ ...settings, never_auto_mail_unknown: checked })}
            />
          </div>
        </section>

        {/* Notifications */}
        <section style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
          marginBottom: 24,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 20px 0' }}>
            Notifications
          </h2>

          {[
            { key: 'email_on_ticket_found', label: 'Email me when a ticket is found' },
            { key: 'email_on_letter_mailed', label: 'Email me when a letter is mailed' },
            { key: 'email_on_approval_needed', label: 'Email me when approval is needed' },
          ].map(({ key, label }, index, arr) => (
            <div key={key} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderBottom: index < arr.length - 1 ? `1px solid ${COLORS.border}` : 'none',
            }}>
              <span style={{ fontSize: 14, color: COLORS.graphite }}>{label}</span>
              <Toggle
                checked={(settings as any)[key]}
                onChange={(checked) => setSettings({ ...settings, [key]: checked })}
              />
            </div>
          ))}
        </section>

        {/* Save Button */}
        {error && (
          <div style={{
            backgroundColor: '#FEF2F2',
            border: `1px solid #FECACA`,
            color: COLORS.danger,
            padding: 12,
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {saved && (
          <div style={{
            backgroundColor: '#F0FDF4',
            border: `1px solid #BBF7D0`,
            color: '#166534',
            padding: 12,
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 16,
          }}>
            Saved.
          </div>
        )}

        <button
          onClick={saveSettings}
          disabled={saving}
          style={{
            padding: '14px 32px',
            borderRadius: 8,
            border: 'none',
            backgroundColor: COLORS.regulatory,
            color: COLORS.white,
            fontSize: 15,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
            marginBottom: 48,
          }}
        >
          {saving ? 'Saving...' : 'Save settings'}
        </button>

        {/* Legal / Authorization */}
        <section style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 16px 0' }}>
            Authorization
          </h2>
          <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 20px 0', lineHeight: 1.6 }}>
            By using this service, you authorize Autopilot America to prepare and submit ticket contest letters on your behalf.
          </p>
          <button
            onClick={handleRevokeAuth}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: `1px solid ${COLORS.danger}`,
              backgroundColor: COLORS.white,
              color: COLORS.danger,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Revoke authorization
          </button>
          <p style={{ fontSize: 13, color: COLORS.danger, margin: '12px 0 0 0' }}>
            Revoking stops all letter mailing immediately and pauses checks until re-authorized.
          </p>
        </section>
      </main>
    </DashboardLayout>
  );
}
