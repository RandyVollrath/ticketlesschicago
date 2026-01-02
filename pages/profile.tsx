import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { DashboardLayout } from './dashboard';

const COLORS = {
  primary: '#0066FF',
  primaryLight: '#E6F0FF',
  deepHarbor: '#0F172A',
  graphite: '#1E293B',
  slate: '#64748B',
  slateLight: '#94A3B8',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  white: '#FFFFFF',
  background: '#F8FAFC',
  success: '#10B981',
  successLight: '#D1FAE5',
  successDark: '#059669',
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  warningDark: '#D97706',
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
        backgroundColor: checked ? COLORS.success : COLORS.slateLight,
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
        backgroundColor: COLORS.white,
        borderRadius: '50%',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

// Expandable Section component
function ExpandableSection({
  title,
  subtitle,
  icon,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{
      backgroundColor: COLORS.white,
      borderRadius: 12,
      border: `1px solid ${COLORS.border}`,
      marginBottom: 16,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          backgroundColor: COLORS.primaryLight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: COLORS.primary,
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor }}>
              {title}
            </span>
            {badge}
          </div>
          {subtitle && (
            <span style={{ fontSize: 13, color: COLORS.slate, marginTop: 2, display: 'block' }}>
              {subtitle}
            </span>
          )}
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke={COLORS.slate}
          strokeWidth="2"
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && (
        <div style={{
          padding: '0 20px 20px 20px',
          borderTop: `1px solid ${COLORS.borderLight}`,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Icons
const UserIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

const CarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11.3 1 12.2 1 13.1V16c0 .6.4 1 1 1h2"/>
    <circle cx="7" cy="17" r="2"/>
    <circle cx="17" cy="17" r="2"/>
  </svg>
);

const MapPinIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);

const MailIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);

const BellIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);

const CreditCardIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
    <line x1="1" y1="10" x2="23" y2="10"/>
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
  </svg>
);

const WarningIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
  </svg>
);

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

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if required fields are complete
  const isProfileComplete = firstName.trim() && lastName.trim();
  const hasPlate = plate !== null;
  const isSetupComplete = isProfileComplete && hasPlate;

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

  const inputStyle = (hasError: boolean = false): React.CSSProperties => ({
    width: '100%',
    padding: '12px 14px',
    borderRadius: 8,
    border: `1.5px solid ${hasError ? COLORS.warning : COLORS.border}`,
    fontSize: 15,
    boxSizing: 'border-box' as const,
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    backgroundColor: COLORS.white,
  });

  if (loading) {
    return (
      <DashboardLayout activePage="profile">
        <main style={{ padding: 48, textAlign: 'center' }}>
          <p style={{ color: COLORS.slate }}>Loading...</p>
        </main>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activePage="profile">
      <Head>
        <title>Profile - Autopilot America</title>
        <style>{`
          input:focus, select:focus {
            border-color: ${COLORS.primary} !important;
            box-shadow: 0 0 0 3px ${COLORS.primaryLight} !important;
          }
        `}</style>
      </Head>

      <main style={{ maxWidth: 700, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header with subscription status */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.deepHarbor, margin: 0 }}>
              Profile
            </h1>
            {subscription && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 600,
                backgroundColor: subscription.status === 'active' ? COLORS.successLight : COLORS.warningLight,
                color: subscription.status === 'active' ? COLORS.successDark : COLORS.warningDark,
              }}>
                {subscription.status === 'active' && <CheckCircleIcon />}
                {subscription.status === 'active' ? 'Active' : 'Pending'}
              </span>
            )}
          </div>
          <p style={{ fontSize: 15, color: COLORS.slate, margin: 0 }}>
            {email}
          </p>
        </div>

        {/* Setup Progress Warning */}
        {!isSetupComplete && (
          <div style={{
            padding: 16,
            borderRadius: 12,
            marginBottom: 20,
            backgroundColor: COLORS.warningLight,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}>
            <div style={{ color: COLORS.warningDark, flexShrink: 0, marginTop: 2 }}>
              <WarningIcon />
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.warningDark, margin: '0 0 4px 0' }}>
                Complete your setup
              </p>
              <p style={{ fontSize: 13, color: '#92400E', margin: 0, lineHeight: 1.5 }}>
                {!isProfileComplete && !hasPlate && 'Enter your name and license plate to start monitoring for tickets.'}
                {!isProfileComplete && hasPlate && 'Enter your name to complete your profile.'}
                {isProfileComplete && !hasPlate && 'Add your license plate to start monitoring for tickets.'}
              </p>
            </div>
          </div>
        )}

        {/* REQUIRED: Name Section - Always visible, not collapsible */}
        <div style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1.5px solid ${!isProfileComplete ? COLORS.warning : COLORS.border}`,
          marginBottom: 16,
          padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: COLORS.primaryLight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.primary,
            }}>
              <UserIcon />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor }}>
                Your Name
              </span>
              <span style={{
                marginLeft: 8,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: COLORS.dangerLight,
                color: COLORS.danger,
                borderRadius: 4,
              }}>
                REQUIRED
              </span>
            </div>
            {saveStatus !== 'idle' && (
              <span style={{
                fontSize: 12,
                fontWeight: 500,
                color: saveStatus === 'saving' ? COLORS.primary : saveStatus === 'saved' ? COLORS.successDark : COLORS.danger,
              }}>
                {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Error'}
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                style={inputStyle(!firstName.trim())}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                Last Name
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
                style={inputStyle(!lastName.trim())}
              />
            </div>
          </div>
          <p style={{ fontSize: 12, color: COLORS.slateLight, margin: '8px 0 0 0' }}>
            As it appears on your vehicle registration
          </p>
        </div>

        {/* REQUIRED: License Plate Section - Always visible, not collapsible */}
        <div style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1.5px solid ${!hasPlate ? COLORS.warning : COLORS.border}`,
          marginBottom: 16,
          padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: COLORS.primaryLight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.primary,
            }}>
              <CarIcon />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor }}>
                License Plate
              </span>
              <span style={{
                marginLeft: 8,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: COLORS.dangerLight,
                color: COLORS.danger,
                borderRadius: 4,
              }}>
                REQUIRED
              </span>
            </div>
            {plate && (
              <span style={{
                fontSize: 12,
                fontWeight: 500,
                color: plate.status === 'active' ? COLORS.successDark : COLORS.slate,
              }}>
                {plate.status === 'active' ? 'Monitoring' : 'Paused'}
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                Plate Number
              </label>
              <input
                type="text"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                placeholder="ABC1234"
                style={{
                  ...inputStyle(!plateNumber.trim()),
                  fontFamily: 'monospace',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                State
              </label>
              <select
                value={plateState}
                onChange={(e) => setPlateState(e.target.value)}
                style={{ ...inputStyle(), cursor: 'pointer' }}
              >
                {US_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
            <input
              type="checkbox"
              checked={plateIsLeased}
              onChange={(e) => setPlateIsLeased(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: COLORS.primary }}
            />
            <span style={{ fontSize: 13, color: COLORS.graphite }}>
              This is a leased or company vehicle
            </span>
          </label>

          {plateError && (
            <div style={{
              padding: 10,
              borderRadius: 8,
              backgroundColor: COLORS.dangerLight,
              color: COLORS.danger,
              fontSize: 13,
              marginBottom: 12,
            }}>
              {plateError}
            </div>
          )}

          <button
            onClick={savePlate}
            disabled={plateSaving || !plateNumber.trim()}
            style={{
              width: '100%',
              padding: '12px 20px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: plateSaving || !plateNumber.trim() ? COLORS.slateLight : COLORS.primary,
              color: COLORS.white,
              fontSize: 14,
              fontWeight: 600,
              cursor: plateSaving || !plateNumber.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {plateSaving ? 'Saving...' : plate ? 'Update Plate' : 'Save Plate'}
          </button>
        </div>

        {/* Mailing Address - Expandable */}
        <ExpandableSection
          title="Mailing Address"
          subtitle="For contest letters"
          icon={<MapPinIcon />}
          defaultOpen={false}
        >
          <div style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                Street Address
              </label>
              <input
                type="text"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="123 Main Street"
                style={inputStyle()}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                Apt, Suite, Unit (optional)
              </label>
              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Apt 4B"
                style={inputStyle()}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                  City
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Chicago"
                  style={inputStyle()}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                  State
                </label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  style={{ ...inputStyle(), cursor: 'pointer' }}
                >
                  {STATE_CODES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                  ZIP
                </label>
                <input
                  type="text"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="60601"
                  maxLength={10}
                  style={inputStyle()}
                />
              </div>
            </div>
            <p style={{ fontSize: 12, color: COLORS.slateLight, margin: 0 }}>
              Changes save automatically
            </p>
          </div>
        </ExpandableSection>

        {/* Letter Preferences - Expandable */}
        <ExpandableSection
          title="Letter Preferences"
          subtitle="Auto-mail and contest settings"
          icon={<MailIcon />}
          defaultOpen={false}
        >
          <div style={{ paddingTop: 16 }}>
            {/* Auto-mail toggle */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderBottom: `1px solid ${COLORS.borderLight}`,
            }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 500, color: COLORS.graphite, margin: '0 0 2px 0' }}>
                  Auto-mail contest letters
                </p>
                <p style={{ fontSize: 12, color: COLORS.slate, margin: 0 }}>
                  Automatically send letters when tickets are found
                </p>
              </div>
              <Toggle
                checked={settings.auto_mail_enabled}
                onChange={(checked) => setSettings({
                  ...settings,
                  auto_mail_enabled: checked,
                  require_approval: !checked
                })}
              />
            </div>

            {/* Require approval */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderBottom: `1px solid ${COLORS.borderLight}`,
            }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 500, color: COLORS.graphite, margin: '0 0 2px 0' }}>
                  Require my approval first
                </p>
                <p style={{ fontSize: 12, color: COLORS.slate, margin: 0 }}>
                  Review letters before they're mailed
                </p>
              </div>
              <Toggle
                checked={settings.require_approval}
                onChange={(checked) => setSettings({
                  ...settings,
                  require_approval: checked,
                  auto_mail_enabled: !checked
                })}
              />
            </div>

            {/* Ticket types */}
            <div style={{ padding: '16px 0' }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: COLORS.graphite, margin: '0 0 12px 0' }}>
                Allowed ticket types for auto-mail
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {TICKET_TYPES.map(type => (
                  <label key={type.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={settings.allowed_ticket_types.includes(type.id)}
                      onChange={() => toggleTicketType(type.id)}
                      style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                    />
                    <span style={{ flex: 1, fontSize: 13, color: COLORS.graphite }}>{type.label}</span>
                    <span style={{
                      fontSize: 11,
                      color: type.winRate >= 60 ? COLORS.successDark : COLORS.slate,
                      fontWeight: 500,
                    }}>
                      {type.winRate}% win rate
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={saveSettings}
              disabled={settingsSaving}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: COLORS.primary,
                color: COLORS.white,
                fontSize: 14,
                fontWeight: 600,
                cursor: settingsSaving ? 'not-allowed' : 'pointer',
                opacity: settingsSaving ? 0.7 : 1,
              }}
            >
              {settingsSaving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </ExpandableSection>

        {/* Notifications - Expandable */}
        <ExpandableSection
          title="Notifications"
          subtitle="Email alerts"
          icon={<BellIcon />}
          defaultOpen={false}
        >
          <div style={{ paddingTop: 16 }}>
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
                borderBottom: index < arr.length - 1 ? `1px solid ${COLORS.borderLight}` : 'none',
              }}>
                <span style={{ fontSize: 14, color: COLORS.graphite }}>{label}</span>
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
                marginTop: 16,
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: COLORS.primary,
                color: COLORS.white,
                fontSize: 14,
                fontWeight: 600,
                cursor: settingsSaving ? 'not-allowed' : 'pointer',
                opacity: settingsSaving ? 0.7 : 1,
              }}
            >
              {settingsSaving ? 'Saving...' : 'Save Notifications'}
            </button>
          </div>
        </ExpandableSection>

        {/* Subscription - Expandable */}
        <ExpandableSection
          title="Subscription"
          subtitle={subscription?.status === 'active' ? '$24/year' : 'Manage your plan'}
          icon={<CreditCardIcon />}
          defaultOpen={false}
          badge={subscription?.status === 'active' && (
            <span style={{
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: COLORS.successLight,
              color: COLORS.successDark,
              borderRadius: 4,
            }}>
              ACTIVE
            </span>
          )}
        >
          <div style={{ paddingTop: 16 }}>
            {subscription ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ padding: 14, backgroundColor: COLORS.background, borderRadius: 8 }}>
                  <p style={{ fontSize: 12, color: COLORS.slateLight, margin: '0 0 4px 0', textTransform: 'uppercase' }}>Plan</p>
                  <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.graphite, margin: 0 }}>Autopilot Annual</p>
                </div>
                <div style={{ padding: 14, backgroundColor: COLORS.background, borderRadius: 8 }}>
                  <p style={{ fontSize: 12, color: COLORS.slateLight, margin: '0 0 4px 0', textTransform: 'uppercase' }}>Renews</p>
                  <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.graphite, margin: 0 }}>
                    {subscription.current_period_end
                      ? new Date(subscription.current_period_end).toLocaleDateString()
                      : 'N/A'}
                  </p>
                </div>
                <div style={{ padding: 14, backgroundColor: COLORS.background, borderRadius: 8 }}>
                  <p style={{ fontSize: 12, color: COLORS.slateLight, margin: '0 0 4px 0', textTransform: 'uppercase' }}>Plates</p>
                  <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.graphite, margin: 0 }}>1 included</p>
                </div>
                <div style={{ padding: 14, backgroundColor: COLORS.successLight, borderRadius: 8 }}>
                  <p style={{ fontSize: 12, color: COLORS.successDark, margin: '0 0 4px 0', textTransform: 'uppercase' }}>Letters</p>
                  <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.successDark, margin: 0 }}>Unlimited</p>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 16px 0' }}>No active subscription</p>
                <a
                  href="/get-started"
                  style={{
                    display: 'inline-block',
                    padding: '12px 24px',
                    backgroundColor: COLORS.primary,
                    color: COLORS.white,
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Subscribe Now
                </a>
              </div>
            )}
          </div>
        </ExpandableSection>
      </main>
    </DashboardLayout>
  );
}
