import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

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
  white: '#FFFFFF',
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

const VIOLATION_LABELS: Record<string, string> = {
  expired_plates: 'Expired Plates',
  no_city_sticker: 'No City Sticker',
  expired_meter: 'Expired Meter',
  disabled_zone: 'Disabled Zone',
  street_cleaning: 'Street Cleaning',
  rush_hour: 'Rush Hour',
  fire_hydrant: 'Fire Hydrant',
  red_light: 'Red Light Camera',
  speed_camera: 'Speed Camera',
  other_unknown: 'Other',
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  found: { label: 'Found', color: COLORS.highlight, bg: 'rgba(249, 115, 22, 0.1)' },
  letter_generated: { label: 'Letter Ready', color: COLORS.accent, bg: 'rgba(16, 185, 129, 0.1)' },
  needs_approval: { label: 'Needs Approval', color: COLORS.danger, bg: 'rgba(239, 68, 68, 0.1)' },
  approved: { label: 'Approved', color: COLORS.accent, bg: 'rgba(16, 185, 129, 0.1)' },
  mailed: { label: 'Mailed', color: COLORS.accent, bg: 'rgba(16, 185, 129, 0.1)' },
  skipped: { label: 'Skipped', color: COLORS.textMuted, bg: 'rgba(100, 116, 139, 0.1)' },
  failed: { label: 'Failed', color: COLORS.danger, bg: 'rgba(239, 68, 68, 0.1)' },
};

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

interface Ticket {
  id: string;
  plate: string;
  state: string;
  ticket_number: string | null;
  violation_type: string;
  violation_date: string | null;
  amount: number | null;
  location: string | null;
  status: string;
  skip_reason: string | null;
  found_at: string;
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

// Simple Nav Layout
function DashboardLayout({ children, activePage }: { children: React.ReactNode; activePage: string }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/get-started');
      } else {
        setUser(session.user);
      }
    };
    checkAuth();
  }, [router]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div style={{ fontFamily: FONTS.body, minHeight: '100vh', backgroundColor: COLORS.bgSection }}>
      {/* Top Nav */}
      <nav style={{
        backgroundColor: COLORS.primary,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <span style={{
              fontFamily: FONTS.heading,
              fontSize: 20,
              fontWeight: 800,
              color: COLORS.textLight
            }}>
              AUTOPILOT<span style={{ color: COLORS.accent }}>.</span>
            </span>
          </Link>

          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 14,
                color: COLORS.textLight,
              }}
            >
              <span>{user?.email?.split('@')[0] || 'Account'}</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z" clipRule="evenodd" />
              </svg>
            </button>

            {menuOpen && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 4,
                backgroundColor: COLORS.white,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                minWidth: 160,
                zIndex: 1000,
              }}>
                <button
                  onClick={handleSignOut}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: 14,
                    color: COLORS.danger,
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {children}
    </div>
  );
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
function Card({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: COLORS.white,
      borderRadius: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      border: `1px solid ${COLORS.border}`,
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 24px',
        borderBottom: `1px solid ${COLORS.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
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
      <div style={{ padding: 24 }}>
        {children}
      </div>
    </div>
  );
}

// Stat Card
function StatCard({ label, value, subtext }: { label: string; value: string | number; subtext?: string }) {
  return (
    <div style={{
      backgroundColor: COLORS.white,
      borderRadius: 12,
      border: `1px solid ${COLORS.border}`,
      padding: 20,
      flex: '1 1 150px',
    }}>
      <p style={{
        fontSize: 12,
        fontWeight: 600,
        color: COLORS.textMuted,
        margin: '0 0 8px 0',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        {label}
      </p>
      <p style={{
        fontSize: 28,
        fontWeight: 700,
        color: COLORS.primary,
        margin: 0,
        fontFamily: FONTS.heading,
      }}>
        {value}
      </p>
      {subtext && (
        <p style={{ fontSize: 12, color: COLORS.textMuted, margin: '6px 0 0 0' }}>
          {subtext}
        </p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  // Profile fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('IL');
  const [zip, setZip] = useState('');
  const [profileSaveStatus, setProfileSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Plate - auto-save
  const [plate, setPlate] = useState<Plate | null>(null);
  const [plateNumber, setPlateNumber] = useState('');
  const [plateState, setPlateState] = useState('IL');
  const [plateIsLeased, setPlateIsLeased] = useState(false);
  const [plateSaveStatus, setPlateSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [plateError, setPlateError] = useState('');

  // Tickets
  const [tickets, setTickets] = useState<Ticket[]>([]);

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

  // Stats
  const [nextCheckDate, setNextCheckDate] = useState('');

  const profileTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const plateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadRef = useRef(true);

  // Check if required fields are complete
  const isProfileComplete = firstName.trim() && lastName.trim();
  const hasPlate = plate !== null || plateNumber.trim().length >= 2;
  const hasAddress = addressLine1.trim() && city.trim() && zip.trim();

  // Auto-save profile
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
    setProfileSaveStatus('saving');

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

    if (!error) {
      setProfileSaveStatus('saved');
      setTimeout(() => setProfileSaveStatus('idle'), 2000);
    }
  }, [userId]);

  // Auto-save plate
  const autoSavePlate = useCallback(async (plateNum: string, plateS: string, isLeased: boolean) => {
    if (!userId) return;
    const plateUpper = plateNum.toUpperCase().trim();

    if (plateUpper.length < 2) {
      return; // Don't save incomplete plates
    }

    setPlateError('');
    setPlateSaveStatus('saving');

    if (plate) {
      // Update existing
      const { error } = await supabase
        .from('monitored_plates')
        .update({
          plate: plateUpper,
          state: plateS,
          is_leased_or_company: isLeased,
          updated_at: new Date().toISOString(),
        })
        .eq('id', plate.id);

      if (error) {
        setPlateSaveStatus('error');
        setPlateError('Failed to update plate');
      } else {
        setPlate({ ...plate, plate: plateUpper, state: plateS, is_leased_or_company: isLeased });
        setPlateSaveStatus('saved');
        setTimeout(() => setPlateSaveStatus('idle'), 2000);
      }
    } else {
      // Create new
      const { data, error } = await supabase
        .from('monitored_plates')
        .insert({
          user_id: userId,
          plate: plateUpper,
          state: plateS,
          is_leased_or_company: isLeased,
          status: 'active',
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          setPlateError('This plate is already registered');
          setPlateSaveStatus('error');
        } else {
          setPlateError('Failed to add plate');
          setPlateSaveStatus('error');
        }
      } else if (data) {
        setPlate(data);
        setPlateSaveStatus('saved');
        setTimeout(() => setPlateSaveStatus('idle'), 2000);
      }
    }
  }, [userId, plate]);

  // Watch profile fields for auto-save
  useEffect(() => {
    if (!userId || loading || initialLoadRef.current) return;
    if (profileTimeoutRef.current) clearTimeout(profileTimeoutRef.current);
    profileTimeoutRef.current = setTimeout(() => {
      autoSaveProfile({ firstName, lastName, addressLine1, addressLine2, city, state, zip });
    }, 1000);
    return () => {
      if (profileTimeoutRef.current) clearTimeout(profileTimeoutRef.current);
    };
  }, [firstName, lastName, addressLine1, addressLine2, city, state, zip, userId, loading, autoSaveProfile]);

  // Watch plate fields for auto-save
  useEffect(() => {
    if (!userId || loading || initialLoadRef.current) return;
    if (plateTimeoutRef.current) clearTimeout(plateTimeoutRef.current);
    plateTimeoutRef.current = setTimeout(() => {
      autoSavePlate(plateNumber, plateState, plateIsLeased);
    }, 1500);
    return () => {
      if (plateTimeoutRef.current) clearTimeout(plateTimeoutRef.current);
    };
  }, [plateNumber, plateState, plateIsLeased, userId, loading, autoSavePlate]);

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

    // Load tickets
    const { data: ticketsData } = await supabase
      .from('detected_tickets')
      .select('*')
      .eq('user_id', session.user.id)
      .order('found_at', { ascending: false })
      .limit(10);

    if (ticketsData) setTickets(ticketsData);

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

    // Calculate next Monday or Thursday
    const today = new Date();
    const dayOfWeek = today.getDay();
    let daysUntilCheck = (8 - dayOfWeek) % 7; // Days until Monday
    if (daysUntilCheck === 0) daysUntilCheck = 7;
    const nextCheck = new Date(today);
    nextCheck.setDate(today.getDate() + daysUntilCheck);
    setNextCheckDate(nextCheck.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));

    setLoading(false);
    // Mark initial load complete after a short delay
    setTimeout(() => { initialLoadRef.current = false; }, 100);
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
      <DashboardLayout activePage="dashboard">
        <main style={{ padding: 48, textAlign: 'center' }}>
          <p style={{ color: COLORS.textMuted }}>Loading...</p>
        </main>
      </DashboardLayout>
    );
  }

  const ticketsFound = tickets.length;
  const lettersMailed = tickets.filter(t => t.status === 'mailed').length;
  const needsApproval = tickets.filter(t => t.status === 'needs_approval');

  return (
    <DashboardLayout activePage="dashboard">
      <Head>
        <title>Dashboard - Autopilot America</title>
        <style>{`
          input:focus, select:focus {
            border-color: ${COLORS.accent} !important;
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15) !important;
            outline: none;
          }
        `}</style>
      </Head>

      {/* Header */}
      <div style={{
        backgroundColor: COLORS.primary,
        padding: '24px 5% 70px',
        color: COLORS.textLight,
        marginBottom: -50,
      }}>
        <div style={{
          maxWidth: 900,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 16,
        }}>
          <div>
            <h1 style={{
              fontFamily: FONTS.heading,
              fontSize: 28,
              fontWeight: 700,
              margin: '0 0 6px',
            }}>
              Dashboard
            </h1>
            <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>{email}</p>
          </div>
          {subscription && (
            <div style={{
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: 12,
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
              <span style={{ fontSize: 8 }}>●</span>
              {subscription.status === 'active' ? 'Monitoring Active' : 'Setup Required'}
            </div>
          )}
        </div>
      </div>

      <main style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '0 20px 40px',
        position: 'relative',
        zIndex: 1,
      }}>

        {/* Stats Row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <StatCard label="Plates" value={plate ? 1 : 0} />
          <StatCard label="Tickets Found" value={ticketsFound} subtext="All time" />
          <StatCard label="Letters Mailed" value={lettersMailed} subtext="All time" />
          <StatCard label="Next Check" value={nextCheckDate} />
        </div>

        {/* Setup Warning */}
        {(!isProfileComplete || !hasPlate || !hasAddress) && (
          <div style={{
            backgroundColor: '#FFF7ED',
            border: `1px solid ${COLORS.highlight}`,
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 15,
          }}>
            <div style={{ fontSize: 24 }}>⚠️</div>
            <div>
              <h4 style={{ margin: '0 0 4px', color: '#9A3412', fontWeight: 700, fontFamily: FONTS.heading, fontSize: 15 }}>
                Complete Your Setup
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: '#C2410C' }}>
                {!hasPlate ? 'Add your license plate to start monitoring. ' : ''}
                {!isProfileComplete ? 'Enter your name. ' : ''}
                {!hasAddress ? 'Add your mailing address for contest letters.' : ''}
              </p>
            </div>
          </div>
        )}

        {/* Needs Approval Alert */}
        {needsApproval.length > 0 && (
          <div style={{
            backgroundColor: COLORS.dangerLight,
            border: `1px solid ${COLORS.danger}`,
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 24,
          }}>
            <h4 style={{ margin: '0 0 8px', color: COLORS.danger, fontWeight: 700, fontSize: 15 }}>
              {needsApproval.length} ticket{needsApproval.length > 1 ? 's' : ''} need{needsApproval.length === 1 ? 's' : ''} your approval
            </h4>
            <p style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>
              Review and approve the contest letters below before they can be mailed.
            </p>
          </div>
        )}

        {/* Vehicle & Owner Card */}
        <Card title="Vehicle & Owner" badge={
          (profileSaveStatus !== 'idle' || plateSaveStatus !== 'idle') && (
            <span style={{
              fontSize: 12,
              fontWeight: 500,
              color: plateSaveStatus === 'error' ? COLORS.danger : COLORS.accent,
            }}>
              {plateSaveStatus === 'saving' || profileSaveStatus === 'saving' ? 'Saving...' :
               plateSaveStatus === 'error' ? plateError : '✓ Saved'}
            </span>
          )
        }>
          {/* License Plate */}
          <div style={{ marginBottom: 24 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}>
              License Plate
            </label>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              border: `2px solid ${COLORS.primary}`,
              borderRadius: 8,
              padding: 4,
              backgroundColor: '#fff',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
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
                  fontSize: 22,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: COLORS.primary,
                  width: 130,
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
              fontSize: 13,
              color: COLORS.textMuted,
            }}>
              <input
                type="checkbox"
                checked={plateIsLeased}
                onChange={(e) => setPlateIsLeased(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: COLORS.primary }}
              />
              Leased or company vehicle
            </label>
          </div>

          {/* Name Fields */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                Last Name
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <p style={{ fontSize: 11, color: COLORS.textMuted, margin: '8px 0 0' }}>
            As it appears on your vehicle registration. Changes save automatically.
          </p>
        </Card>

        {/* Mailing Address Card */}
        <Card title="Mailing Address" badge={
          !hasAddress && (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor: COLORS.warningLight,
              color: '#92400E',
            }}>
              NEEDED
            </span>
          )
        }>
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Street Address
            </label>
            <input
              type="text"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="123 Main Street"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Apt / Unit
            </label>
            <input
              type="text"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              placeholder="Apt 4B"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ flex: '2 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                City
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Chicago"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 80px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                State
              </label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  cursor: 'pointer',
                }}
              >
                {STATE_CODES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                ZIP
              </label>
              <input
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="60601"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Tickets Card */}
        <Card title="Recent Tickets" badge={
          tickets.length > 0 && (
            <span style={{ fontSize: 12, color: COLORS.textMuted }}>
              {tickets.length} total
            </span>
          )
        }>
          {tickets.length === 0 ? (
            <p style={{ color: COLORS.textMuted, fontSize: 14, margin: 0, textAlign: 'center', padding: '20px 0' }}>
              No tickets found yet. We check your plate weekly.
            </p>
          ) : (
            <div>
              {tickets.slice(0, 5).map((ticket, index) => {
                const statusInfo = STATUS_LABELS[ticket.status] || STATUS_LABELS.found;
                return (
                  <div
                    key={ticket.id}
                    style={{
                      padding: '14px 0',
                      borderBottom: index < Math.min(tickets.length, 5) - 1 ? `1px solid ${COLORS.border}` : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{
                          fontFamily: 'monospace',
                          fontSize: 14,
                          fontWeight: 600,
                          color: COLORS.primary,
                        }}>
                          {ticket.plate}
                        </span>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 500,
                          backgroundColor: statusInfo.bg,
                          color: statusInfo.color,
                        }}>
                          {statusInfo.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                        {VIOLATION_LABELS[ticket.violation_type] || ticket.violation_type}
                        {ticket.amount && ` • $${ticket.amount}`}
                        {' • '}
                        {new Date(ticket.found_at).toLocaleDateString()}
                      </div>
                    </div>
                    {ticket.status === 'needs_approval' && (
                      <Link href={`/tickets/${ticket.id}`} style={{
                        padding: '6px 14px',
                        borderRadius: 6,
                        backgroundColor: COLORS.primary,
                        color: COLORS.white,
                        fontSize: 12,
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}>
                        Review
                      </Link>
                    )}
                  </div>
                );
              })}
              {tickets.length > 5 && (
                <Link href="/tickets" style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '12px 0',
                  fontSize: 13,
                  color: COLORS.accent,
                  textDecoration: 'none',
                  fontWeight: 600,
                }}>
                  View all {tickets.length} tickets →
                </Link>
              )}
            </div>
          )}
        </Card>

        {/* Settings Card */}
        <Card title="Autopilot Settings">
          {/* Autopilot Mode Toggle */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Auto-mail letters
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Automatically mail contest letters when tickets are found
              </p>
            </div>
            <Toggle
              checked={settings.auto_mail_enabled}
              onChange={(checked) => {
                setSettings({
                  ...settings,
                  auto_mail_enabled: checked,
                  require_approval: !checked,
                });
              }}
            />
          </div>

          {/* Require Approval Toggle */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Require approval
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Review letters before they're mailed
              </p>
            </div>
            <Toggle
              checked={settings.require_approval}
              onChange={(checked) => {
                setSettings({
                  ...settings,
                  require_approval: checked,
                  auto_mail_enabled: !checked,
                });
              }}
            />
          </div>

          {/* Ticket Types */}
          <div style={{ marginBottom: 20 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              Contest these ticket types
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              {TICKET_TYPES.map(type => (
                <label key={type.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 14,
                  cursor: 'pointer',
                  color: COLORS.textDark,
                }}>
                  <input
                    type="checkbox"
                    checked={settings.allowed_ticket_types.includes(type.id)}
                    onChange={() => toggleTicketType(type.id)}
                    style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                  />
                  <span>{type.label}</span>
                  <span style={{
                    fontSize: 11,
                    color: type.winRate >= 60 ? COLORS.accent : COLORS.textMuted,
                    fontWeight: 600,
                    marginLeft: 'auto',
                  }}>
                    {type.winRate}%
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
              color: COLORS.textLight,
              fontSize: 14,
              fontWeight: 600,
              cursor: settingsSaving ? 'not-allowed' : 'pointer',
              opacity: settingsSaving ? 0.7 : 1,
            }}
          >
            {settingsSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </Card>

        {/* Subscription Card */}
        {subscription && (
          <Card title="Subscription" badge={
            <span style={{
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: subscription.status === 'active' ? COLORS.successLight : COLORS.warningLight,
              color: subscription.status === 'active' ? COLORS.accent : '#92400E',
              borderRadius: 4,
            }}>
              {subscription.status === 'active' ? 'ACTIVE' : 'INACTIVE'}
            </span>
          }>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{
                flex: '1 1 150px',
                padding: 16,
                backgroundColor: COLORS.bgLight,
                borderRadius: 8,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4, textTransform: 'uppercase' }}>Plan</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.primary }}>$24/year</div>
              </div>
              <div style={{
                flex: '1 1 150px',
                padding: 16,
                backgroundColor: COLORS.bgLight,
                borderRadius: 8,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4, textTransform: 'uppercase' }}>Next Billing</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.primary }}>
                  {subscription.current_period_end
                    ? new Date(subscription.current_period_end).toLocaleDateString()
                    : 'N/A'}
                </div>
              </div>
              <div style={{
                flex: '1 1 150px',
                padding: 16,
                backgroundColor: COLORS.successLight,
                borderRadius: 8,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 11, color: COLORS.accent, marginBottom: 4, textTransform: 'uppercase' }}>Letters</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.accent }}>Unlimited</div>
              </div>
            </div>
          </Card>
        )}
      </main>
    </DashboardLayout>
  );
}

export { DashboardLayout };
