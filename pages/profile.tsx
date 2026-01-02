import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { DashboardLayout } from './dashboard';

const COLORS = {
  primary: '#0F172A',
  accent: '#10B981',
  highlight: '#F97316',
  bgDark: '#020617',
  bgLight: '#F8FAFC',
  bgSection: '#F1F5F9',
  textDark: '#1E293B',
  textLight: '#FFFFFF',
  textMuted: '#64748B',
  border: '#E2E8F0',
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  successLight: '#D1FAE5',
  warningLight: '#FEF3C7',
};

const FONTS = {
  heading: '"Space Grotesk", sans-serif',
  body: '"Inter", sans-serif',
};

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington DC' },
];

const STATE_CODES = US_STATES.map(s => s.code);

const TICKET_TYPES = [
  { id: 'expired_plates', label: 'Expired Plates', winRate: 75 },
  { id: 'no_city_sticker', label: 'No City Sticker', winRate: 70 },
  { id: 'expired_meter', label: 'Expired Meter', winRate: 67 },
  { id: 'disabled_zone', label: 'Disabled Zone', winRate: 68 },
  { id: 'street_cleaning', label: 'Street Cleaning', winRate: 34 },
  { id: 'rush_hour', label: 'Rush Hour', winRate: 37 },
  { id: 'fire_hydrant', label: 'Fire Hydrant', winRate: 44 },
];

interface Plate {
  id: string;
  plate: string;
  state: string;
  status: 'active' | 'paused';
  is_leased_or_company: boolean;
}

interface Settings {
  auto_mail_enabled: boolean;
  require_approval: boolean;
  allowed_ticket_types: string[];
  never_auto_mail_unknown: boolean;
  email_on_ticket_found: boolean;
  email_on_letter_mailed: boolean;
  email_on_approval_needed: boolean;
}

interface Subscription {
  status: string;
  current_period_end: string | null;
}

// Toggle component
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 48,
        height: 26,
        borderRadius: 26,
        backgroundColor: checked ? COLORS.accent : '#CBD5E1',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        transition: 'background-color 0.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute',
        height: 20,
        width: 20,
        left: checked ? 25 : 3,
        top: 3,
        backgroundColor: COLORS.textLight,
        borderRadius: '50%',
        transition: 'left 0.2s',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

// Card component
function Card({
  title,
  children,
  isOpen,
  onToggle,
  warning,
  badge,
  alwaysOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
  warning?: boolean;
  badge?: React.ReactNode;
  alwaysOpen?: boolean;
}) {
  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      border: warning ? `2px solid ${COLORS.highlight}` : `1px solid ${COLORS.border}`,
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      <div
        onClick={onToggle}
        style={{
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: onToggle ? 'pointer' : 'default',
          backgroundColor: warning ? '#FFF7ED' : '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{
            margin: 0,
            fontFamily: FONTS.heading,
            fontSize: 18,
            color: COLORS.primary,
            fontWeight: 600,
          }}>
            {title}
          </h3>
          {badge}
        </div>
        {onToggle && (
          <span style={{
            color: COLORS.textMuted,
            fontSize: 20,
            fontWeight: 300,
            transition: 'transform 0.2s',
          }}>
            {isOpen ? '−' : '+'}
          </span>
        )}
      </div>
      {(isOpen || alwaysOpen) && (
        <div style={{
          padding: '0 24px 24px',
          borderTop: onToggle ? `1px solid ${COLORS.bgSection}` : 'none',
          paddingTop: onToggle ? 24 : 0,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Input component
function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  error,
  style,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  error?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ marginBottom: 16, flex: '1 1 200px', ...style }}>
      <label style={{
        display: 'block',
        fontSize: 13,
        fontWeight: 600,
        color: COLORS.textMuted,
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
      }}>
        {label}
        {required && <span style={{ color: COLORS.danger, marginLeft: 4 }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '12px 16px',
          borderRadius: 8,
          border: `1.5px solid ${error ? COLORS.highlight : COLORS.border}`,
          fontSize: 16,
          fontFamily: FONTS.body,
          color: COLORS.primary,
          outline: 'none',
          backgroundColor: COLORS.bgLight,
          transition: 'border-color 0.2s, box-shadow 0.2s',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Profile fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('IL');
  const [zip, setZip] = useState('');

  // Plate
  const [plate, setPlate] = useState<Plate | null>(null);
  const [plateNumber, setPlateNumber] = useState('');
  const [plateState, setPlateState] = useState('IL');
  const [plateIsLeased, setPlateIsLeased] = useState(false);
  const [plateSaving, setPlateSaving] = useState(false);
  const [plateError, setPlateError] = useState('');

  // Subscription
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  // Settings
  const [settings, setSettings] = useState<Settings>({
    auto_mail_enabled: true,
    require_approval: false,
    allowed_ticket_types: ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone'],
    never_auto_mail_unknown: true,
    email_on_ticket_found: true,
    email_on_letter_mailed: true,
    email_on_approval_needed: true,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Expandable sections
  const [sections, setSections] = useState({
    address: false,
    prefs: false,
    notifs: false,
    sub: false,
  });

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if required fields are complete
  const isProfileComplete = firstName.trim() && lastName.trim();
  const hasPlate = plate !== null;
  const hasAddress = addressLine1.trim() && city.trim() && zip.trim();
  const isSetupComplete = isProfileComplete && hasPlate;

  const toggleSection = (key: keyof typeof sections) => {
    setSections({ ...sections, [key]: !sections[key] });
  };

  // Debounced auto-save for profile
  const autoSaveProfile = useCallback(async (data: {
    firstName: string;
    lastName: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    zip: string;
  }) => {
    if (!userId) return;
    setSaveStatus('saving');

    const { error } = await supabase
      .from('autopilot_profiles')
      .upsert({
        user_id: userId,
        first_name: data.firstName || null,
        last_name: data.lastName || null,
        full_name: `${data.firstName} ${data.lastName}`.trim() || null,
        mailing_address_line1: data.addressLine1 || null,
        mailing_address_line2: data.addressLine2 || null,
        mailing_city: data.city || null,
        mailing_state: data.state || null,
        mailing_zip: data.zip || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      setSaveStatus('error');
    } else {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || loading) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      autoSaveProfile({ firstName, lastName, addressLine1, addressLine2, city, state, zip });
    }, 1000);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [firstName, lastName, addressLine1, addressLine2, city, state, zip, userId, loading, autoSaveProfile]);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/get-started');
      return;
    }

    setEmail(session.user.email || '');
    setUserId(session.user.id);

    // Load profile
    const { data: profileData } = await supabase
      .from('autopilot_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    if (profileData) {
      if (profileData.first_name || profileData.last_name) {
        setFirstName(profileData.first_name || '');
        setLastName(profileData.last_name || '');
      } else if (profileData.full_name) {
        const nameParts = profileData.full_name.trim().split(' ');
        setFirstName(nameParts[0] || '');
        setLastName(nameParts.slice(1).join(' ') || '');
      }
      setAddressLine1(profileData.mailing_address_line1 || '');
      setAddressLine2(profileData.mailing_address_line2 || '');
      setCity(profileData.mailing_city || '');
      setState(profileData.mailing_state || 'IL');
      setZip(profileData.mailing_zip || '');
    }

    // Load plate
    const { data: plateData } = await supabase
      .from('monitored_plates')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    if (plateData) {
      setPlate(plateData);
      setPlateNumber(plateData.plate);
      setPlateState(plateData.state);
      setPlateIsLeased(plateData.is_leased_or_company);
    }

    // Load subscription
    const { data: subData } = await supabase
      .from('autopilot_subscriptions')
      .select('status, current_period_end')
      .eq('user_id', session.user.id)
      .single();

    if (subData) setSubscription(subData);

    // Load settings
    const { data: settingsData } = await supabase
      .from('autopilot_settings')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    if (settingsData) {
      setSettings({
        auto_mail_enabled: settingsData.auto_mail_enabled,
        require_approval: settingsData.require_approval,
        allowed_ticket_types: settingsData.allowed_ticket_types || [],
        never_auto_mail_unknown: settingsData.never_auto_mail_unknown,
        email_on_ticket_found: settingsData.email_on_ticket_found,
        email_on_letter_mailed: settingsData.email_on_letter_mailed,
        email_on_approval_needed: settingsData.email_on_approval_needed,
      });
    }

    setLoading(false);
  };

  const savePlate = async () => {
    if (!userId) return;
    setPlateError('');
    setPlateSaving(true);

    const plateUpper = plateNumber.toUpperCase().trim();
    if (!plateUpper) {
      setPlateError('Please enter your license plate number.');
      setPlateSaving(false);
      return;
    }

    if (plate) {
      // Update existing
      const { error } = await supabase
        .from('monitored_plates')
        .update({
          plate: plateUpper,
          state: plateState,
          is_leased_or_company: plateIsLeased,
          updated_at: new Date().toISOString(),
        })
        .eq('id', plate.id);

      if (error) {
        setPlateError('Failed to update plate.');
      } else {
        setPlate({ ...plate, plate: plateUpper, state: plateState, is_leased_or_company: plateIsLeased });
      }
    } else {
      // Create new
      const { data, error } = await supabase
        .from('monitored_plates')
        .insert({
          user_id: userId,
          plate: plateUpper,
          state: plateState,
          is_leased_or_company: plateIsLeased,
          status: 'active',
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          setPlateError('This plate is already registered.');
        } else {
          setPlateError('Failed to add plate.');
        }
      } else if (data) {
        setPlate(data);
      }
    }
    setPlateSaving(false);
  };

  const saveSettings = async () => {
    if (!userId) return;
    setSettingsSaving(true);

    await supabase
      .from('autopilot_settings')
      .upsert({
        user_id: userId,
        ...settings,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    setSettingsSaving(false);
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

  if (loading) {
    return (
      <DashboardLayout activePage="profile">
        <main style={{ padding: 48, textAlign: 'center' }}>
          <p style={{ color: COLORS.textMuted, fontFamily: FONTS.body }}>Loading...</p>
        </main>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activePage="profile">
      <Head>
        <title>My Controller - Autopilot America</title>
        <style>{`
          input:focus, select:focus {
            border-color: ${COLORS.accent} !important;
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15) !important;
          }
        `}</style>
      </Head>

      {/* Header */}
      <div style={{
        backgroundColor: COLORS.primary,
        padding: '32px 5% 80px',
        color: COLORS.textLight,
        marginBottom: -50,
      }}>
        <div style={{
          maxWidth: 800,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 20,
        }}>
          <div>
            <h1 style={{
              fontFamily: FONTS.heading,
              fontSize: 32,
              fontWeight: 700,
              margin: '0 0 8px',
            }}>
              My Controller
            </h1>
            <p style={{ margin: 0, opacity: 0.7, fontSize: 15 }}>{email}</p>
          </div>
          {subscription && (
            <div style={{
              padding: '8px 16px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              backgroundColor: subscription.status === 'active' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(249, 115, 22, 0.2)',
              color: subscription.status === 'active' ? COLORS.accent : COLORS.highlight,
              border: `1px solid ${subscription.status === 'active' ? COLORS.accent : COLORS.highlight}`,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{ fontSize: 10 }}>●</span>
              {subscription.status === 'active' ? 'Monitoring Active' : 'Setup Required'}
            </div>
          )}
        </div>
      </div>

      <main style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: '0 20px 40px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Setup Warning */}
        {!isSetupComplete && (
          <div style={{
            backgroundColor: '#FFF7ED',
            border: `1px solid ${COLORS.highlight}`,
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 15,
            boxShadow: '0 4px 12px rgba(249, 115, 22, 0.15)',
          }}>
            <div style={{ fontSize: 28 }}>⚠️</div>
            <div>
              <h4 style={{ margin: '0 0 4px', color: '#9A3412', fontWeight: 700, fontFamily: FONTS.heading }}>
                Setup Incomplete
              </h4>
              <p style={{ margin: 0, fontSize: 14, color: '#C2410C' }}>
                {!isProfileComplete && !hasPlate && 'Enter your name and license plate to start monitoring for tickets.'}
                {!isProfileComplete && hasPlate && 'Enter your name to complete your profile.'}
                {isProfileComplete && !hasPlate && 'Add your license plate to start monitoring for tickets.'}
              </p>
            </div>
          </div>
        )}

        {/* Primary Settings Card - Always Visible */}
        <Card title="Vehicle & Owner" alwaysOpen badge={
          saveStatus !== 'idle' && (
            <span style={{
              fontSize: 12,
              fontWeight: 500,
              color: saveStatus === 'saving' ? COLORS.accent : saveStatus === 'saved' ? COLORS.accent : COLORS.danger,
              marginLeft: 8,
            }}>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : 'Error'}
            </span>
          )
        }>
          {/* License Plate */}
          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}>
              Vehicle to Protect <span style={{ color: COLORS.danger }}>*</span>
            </label>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              border: `2px solid ${COLORS.primary}`,
              borderRadius: 8,
              padding: 4,
              backgroundColor: '#fff',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            }}>
              <select
                value={plateState}
                onChange={(e) => setPlateState(e.target.value)}
                style={{
                  backgroundColor: COLORS.primary,
                  color: '#fff',
                  fontSize: 11,
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: 'none',
                  fontWeight: 700,
                  marginRight: 8,
                  cursor: 'pointer',
                }}
              >
                {US_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.code}</option>
                ))}
              </select>
              <input
                type="text"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                placeholder="ABC1234"
                style={{
                  border: 'none',
                  fontSize: 24,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: COLORS.primary,
                  width: 140,
                  outline: 'none',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              />
            </div>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              marginTop: 12,
              fontSize: 14,
              color: COLORS.textMuted,
            }}>
              <input
                type="checkbox"
                checked={plateIsLeased}
                onChange={(e) => setPlateIsLeased(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: COLORS.primary }}
              />
              This is a leased or company vehicle
            </label>

            {plateError && (
              <div style={{
                padding: 10,
                borderRadius: 8,
                backgroundColor: COLORS.dangerLight,
                color: COLORS.danger,
                fontSize: 13,
                marginTop: 12,
              }}>
                {plateError}
              </div>
            )}

            <button
              onClick={savePlate}
              disabled={plateSaving || !plateNumber.trim()}
              style={{
                marginTop: 16,
                padding: '12px 24px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: plateSaving || !plateNumber.trim() ? '#CBD5E1' : COLORS.primary,
                color: COLORS.textLight,
                fontSize: 14,
                fontWeight: 600,
                cursor: plateSaving || !plateNumber.trim() ? 'not-allowed' : 'pointer',
                fontFamily: FONTS.body,
              }}
            >
              {plateSaving ? 'Saving...' : plate ? 'Update Plate' : 'Save Plate'}
            </button>
          </div>

          {/* Name Fields */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <Input
              label="First Name"
              value={firstName}
              onChange={setFirstName}
              placeholder="John"
              required
              error={!firstName.trim()}
            />
            <Input
              label="Last Name"
              value={lastName}
              onChange={setLastName}
              placeholder="Smith"
              required
              error={!lastName.trim()}
            />
          </div>
          <p style={{ fontSize: 12, color: COLORS.textMuted, margin: '4px 0 0' }}>
            As it appears on your vehicle registration
          </p>
        </Card>

        {/* Mailing Address - Expandable */}
        <Card
          title="Mailing Address"
          isOpen={sections.address}
          onToggle={() => toggleSection('address')}
          warning={!hasAddress}
          badge={!hasAddress && (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor: COLORS.warningLight,
              color: '#92400E',
            }}>
              NEEDED FOR LETTERS
            </span>
          )}
        >
          <Input
            label="Street Address"
            value={addressLine1}
            onChange={setAddressLine1}
            placeholder="123 Main Street"
          />
          <Input
            label="Apt, Suite, Unit"
            value={addressLine2}
            onChange={setAddressLine2}
            placeholder="Apt 4B"
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <Input
              label="City"
              value={city}
              onChange={setCity}
              placeholder="Chicago"
              style={{ flex: '2 1 150px' }}
            />
            <div style={{ marginBottom: 16, flex: '1 1 100px' }}>
              <label style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}>
                State
              </label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: `1.5px solid ${COLORS.border}`,
                  fontSize: 16,
                  fontFamily: FONTS.body,
                  color: COLORS.primary,
                  outline: 'none',
                  backgroundColor: COLORS.bgLight,
                  cursor: 'pointer',
                }}
              >
                {STATE_CODES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <Input
              label="ZIP Code"
              value={zip}
              onChange={setZip}
              placeholder="60601"
              style={{ flex: '1 1 100px' }}
            />
          </div>
          <p style={{ fontSize: 12, color: COLORS.textMuted, margin: 0 }}>
            Changes save automatically
          </p>
        </Card>

        {/* Defense Preferences - Expandable */}
        <Card
          title="Defense Preferences"
          isOpen={sections.prefs}
          onToggle={() => toggleSection('prefs')}
        >
          {/* Autopilot Mode Toggle */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            paddingBottom: 20,
            borderBottom: `1px solid ${COLORS.bgSection}`,
          }}>
            <div>
              <h4 style={{
                margin: '0 0 4px',
                fontSize: 16,
                fontWeight: 600,
                color: COLORS.primary,
                fontFamily: FONTS.heading,
              }}>
                Autopilot Mode
              </h4>
              <p style={{ margin: 0, fontSize: 14, color: COLORS.textMuted }}>
                Automatically mail letters for new tickets
              </p>
            </div>
            <Toggle
              checked={settings.auto_mail_enabled}
              onChange={(checked) => setSettings({
                ...settings,
                auto_mail_enabled: checked,
                require_approval: !checked,
              })}
            />
          </div>

          {/* Require Approval Toggle */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 24,
            paddingBottom: 20,
            borderBottom: `1px solid ${COLORS.bgSection}`,
          }}>
            <div>
              <h4 style={{
                margin: '0 0 4px',
                fontSize: 16,
                fontWeight: 600,
                color: COLORS.primary,
                fontFamily: FONTS.heading,
              }}>
                Require Approval
              </h4>
              <p style={{ margin: 0, fontSize: 14, color: COLORS.textMuted }}>
                Review letters before they're mailed
              </p>
            </div>
            <Toggle
              checked={settings.require_approval}
              onChange={(checked) => setSettings({
                ...settings,
                require_approval: checked,
                auto_mail_enabled: !checked,
              })}
            />
          </div>

          {/* Ticket Types */}
          <label style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            color: COLORS.textMuted,
            marginBottom: 15,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}>
            Contest these ticket types:
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
            {TICKET_TYPES.map(type => (
              <label key={type.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 15,
                cursor: 'pointer',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={settings.allowed_ticket_types.includes(type.id)}
                  onChange={() => toggleTicketType(type.id)}
                  style={{ width: 18, height: 18, accentColor: COLORS.primary }}
                />
                <span style={{ flex: 1 }}>{type.label}</span>
                <span style={{
                  fontSize: 12,
                  color: type.winRate >= 60 ? COLORS.accent : COLORS.textMuted,
                  fontWeight: 600,
                }}>
                  {type.winRate}% win rate
                </span>
              </label>
            ))}
          </div>

          <button
            onClick={saveSettings}
            disabled={settingsSaving}
            style={{
              padding: '12px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: COLORS.primary,
              color: COLORS.textLight,
              fontSize: 14,
              fontWeight: 600,
              cursor: settingsSaving ? 'not-allowed' : 'pointer',
              opacity: settingsSaving ? 0.7 : 1,
              fontFamily: FONTS.body,
            }}
          >
            {settingsSaving ? 'Saving...' : 'Save Preferences'}
          </button>
        </Card>

        {/* Notifications - Expandable */}
        <Card
          title="Notifications"
          isOpen={sections.notifs}
          onToggle={() => toggleSection('notifs')}
        >
          {[
            { key: 'email_on_ticket_found', label: 'Email me when a ticket is found' },
            { key: 'email_on_letter_mailed', label: 'Email me when a letter is mailed' },
            { key: 'email_on_approval_needed', label: 'Email me when approval is needed' },
          ].map(({ key, label }, index, arr) => (
            <div key={key} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 0',
              borderBottom: index < arr.length - 1 ? `1px solid ${COLORS.bgSection}` : 'none',
            }}>
              <span style={{ fontSize: 15, color: COLORS.textDark }}>{label}</span>
              <Toggle
                checked={(settings as any)[key]}
                onChange={(checked) => setSettings({ ...settings, [key]: checked })}
              />
            </div>
          ))}

          <button
            onClick={saveSettings}
            disabled={settingsSaving}
            style={{
              marginTop: 20,
              padding: '12px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: COLORS.primary,
              color: COLORS.textLight,
              fontSize: 14,
              fontWeight: 600,
              cursor: settingsSaving ? 'not-allowed' : 'pointer',
              opacity: settingsSaving ? 0.7 : 1,
              fontFamily: FONTS.body,
            }}
          >
            {settingsSaving ? 'Saving...' : 'Save Notifications'}
          </button>
        </Card>

        {/* Subscription - Expandable */}
        <Card
          title="Subscription"
          isOpen={sections.sub}
          onToggle={() => toggleSection('sub')}
          badge={subscription?.status === 'active' && (
            <span style={{
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: COLORS.successLight,
              color: COLORS.accent,
              borderRadius: 4,
            }}>
              ACTIVE
            </span>
          )}
        >
          {subscription ? (
            <>
              <div style={{
                backgroundColor: COLORS.bgSection,
                padding: 16,
                borderRadius: 8,
                marginBottom: 20,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: COLORS.textDark }}>Annual Protection</span>
                  <span style={{ fontWeight: 700, color: COLORS.primary }}>$24.00/yr</span>
                </div>
                <div style={{ fontSize: 14, color: COLORS.textMuted }}>
                  Next billing: {subscription.current_period_end
                    ? new Date(subscription.current_period_end).toLocaleDateString()
                    : 'N/A'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{
                  flex: '1 1 120px',
                  padding: 12,
                  backgroundColor: COLORS.bgLight,
                  borderRadius: 8,
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 4 }}>PLATES</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.primary }}>1</div>
                </div>
                <div style={{
                  flex: '1 1 120px',
                  padding: 12,
                  backgroundColor: COLORS.successLight,
                  borderRadius: 8,
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 12, color: COLORS.accent, marginBottom: 4 }}>LETTERS</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.accent }}>Unlimited</div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <p style={{ fontSize: 14, color: COLORS.textMuted, margin: '0 0 16px' }}>No active subscription</p>
              <Link
                href="/get-started"
                style={{
                  display: 'inline-block',
                  padding: '12px 24px',
                  backgroundColor: COLORS.accent,
                  color: COLORS.primary,
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Subscribe Now
              </Link>
            </div>
          )}
        </Card>
      </main>
    </DashboardLayout>
  );
}
