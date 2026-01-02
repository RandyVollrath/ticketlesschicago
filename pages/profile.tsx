import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
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
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

interface Profile {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null; // Legacy field, will be deprecated
  mailing_address_line1: string | null;
  mailing_address_line2: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
}

interface Subscription {
  status: string;
  current_period_end: string | null;
  letters_used_this_period: number;
  letters_included: number;
}

// Icon components
const CheckCircleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" fill="currentColor"/>
  </svg>
);

const WarningIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
  </svg>
);

const CreditCardIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
    <line x1="1" y1="10" x2="23" y2="10"/>
  </svg>
);

const UserIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

const MapPinIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const CarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11.3 1 12.2 1 13.1V16c0 .6.4 1 1 1h2"/>
    <circle cx="7" cy="17" r="2"/>
    <circle cx="17" cy="17" r="2"/>
  </svg>
);

const TicketIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
    <path d="M13 5v2"/>
    <path d="M13 17v2"/>
    <path d="M13 11v2"/>
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

const LoaderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);

export default function ProfilePage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('IL');
  const [zip, setZip] = useState('');

  // Track if profile is complete - last name is required for ticket lookup
  const isProfileComplete = firstName.trim() && lastName.trim() && addressLine1.trim() && city.trim() && state && zip.trim();

  // Debounced auto-save
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const autoSave = useCallback(async (data: {
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
        full_name: `${data.firstName} ${data.lastName}`.trim() || null, // Keep for backwards compatibility
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

  // Trigger auto-save on field changes
  useEffect(() => {
    if (!userId || loading) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      autoSave({ firstName, lastName, addressLine1, addressLine2, city, state, zip });
    }, 1000); // 1 second debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [firstName, lastName, addressLine1, addressLine2, city, state, zip, userId, loading, autoSave]);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
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
      setProfile(profileData);
      // Try to use first/last name, fall back to parsing full_name for legacy users
      if (profileData.first_name || profileData.last_name) {
        setFirstName(profileData.first_name || '');
        setLastName(profileData.last_name || '');
      } else if (profileData.full_name) {
        // Parse legacy full_name into first/last
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

    // Load subscription
    const { data: subData } = await supabase
      .from('autopilot_subscriptions')
      .select('status, current_period_end, letters_used_this_period, letters_included')
      .eq('user_id', session.user.id)
      .single();

    if (subData) {
      setSubscription(subData);
    }

    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
      active: {
        label: 'Active',
        color: COLORS.successDark,
        bg: COLORS.successLight,
        icon: <CheckCircleIcon />
      },
      pending: {
        label: 'Pending',
        color: COLORS.warningDark,
        bg: COLORS.warningLight,
        icon: <LoaderIcon />
      },
      canceled: {
        label: 'Canceled',
        color: COLORS.danger,
        bg: COLORS.dangerLight,
        icon: null
      },
      past_due: {
        label: 'Past Due',
        color: COLORS.danger,
        bg: COLORS.dangerLight,
        icon: <WarningIcon />
      },
    };
    const config = configs[status] || configs.pending;
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 20,
        fontSize: 13,
        fontWeight: 600,
        backgroundColor: config.bg,
        color: config.color,
      }}>
        {config.icon}
        {config.label}
      </span>
    );
  };

  const inputStyle = (hasError: boolean = false): React.CSSProperties => ({
    width: '100%',
    padding: '14px 16px',
    borderRadius: 10,
    border: `1.5px solid ${hasError ? COLORS.warning : COLORS.border}`,
    fontSize: 15,
    boxSizing: 'border-box' as const,
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    backgroundColor: COLORS.white,
  });

  const cardStyle: React.CSSProperties = {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    border: `1px solid ${COLORS.border}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    overflow: 'hidden',
  };

  if (loading) {
    return (
      <DashboardLayout activePage="profile">
        <main style={{
          padding: 48,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
        }}>
          <div style={{ color: COLORS.primary, marginBottom: 16 }}>
            <LoaderIcon />
          </div>
          <p style={{ color: COLORS.slate, fontSize: 15 }}>Loading profile...</p>
        </main>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activePage="profile">
      <Head>
        <title>Profile - Autopilot America</title>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          input:focus, select:focus {
            border-color: ${COLORS.primary} !important;
            box-shadow: 0 0 0 3px ${COLORS.primaryLight} !important;
          }
        `}</style>
      </Head>

      <main style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: '40px 24px',
        minHeight: '100vh',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{
            fontSize: 32,
            fontWeight: 700,
            color: COLORS.deepHarbor,
            margin: '0 0 8px 0',
            letterSpacing: '-0.02em',
          }}>
            Profile
          </h1>
          <p style={{
            fontSize: 16,
            color: COLORS.slate,
            margin: 0,
            lineHeight: 1.5,
          }}>
            Manage your account and mailing information for contest letters.
          </p>
        </div>

        {/* Subscription Status Card */}
        <section style={{ ...cardStyle, marginBottom: 24 }}>
          <div style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${COLORS.borderLight}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: COLORS.primaryLight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.primary,
            }}>
              <CreditCardIcon />
            </div>
            <div style={{ flex: 1 }}>
              <h2 style={{
                fontSize: 18,
                fontWeight: 600,
                color: COLORS.deepHarbor,
                margin: 0
              }}>
                Subscription
              </h2>
            </div>
            {subscription && getStatusBadge(subscription.status)}
          </div>

          <div style={{ padding: 24 }}>
            {subscription ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 24,
              }}>
                <div style={{
                  padding: 16,
                  backgroundColor: COLORS.background,
                  borderRadius: 12,
                }}>
                  <p style={{
                    fontSize: 13,
                    color: COLORS.slateLight,
                    margin: '0 0 6px 0',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 500,
                  }}>
                    Plan
                  </p>
                  <p style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: COLORS.graphite,
                    margin: 0
                  }}>
                    Autopilot Annual
                  </p>
                  <p style={{
                    fontSize: 13,
                    color: COLORS.slate,
                    margin: '4px 0 0 0'
                  }}>
                    $24/year
                  </p>
                </div>
                <div style={{
                  padding: 16,
                  backgroundColor: COLORS.background,
                  borderRadius: 12,
                }}>
                  <p style={{
                    fontSize: 13,
                    color: COLORS.slateLight,
                    margin: '0 0 6px 0',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 500,
                  }}>
                    Renews
                  </p>
                  <p style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: COLORS.graphite,
                    margin: 0
                  }}>
                    {subscription.current_period_end
                      ? new Date(subscription.current_period_end).toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'N/A'}
                  </p>
                </div>
                <div style={{
                  padding: 16,
                  backgroundColor: COLORS.background,
                  borderRadius: 12,
                }}>
                  <p style={{
                    fontSize: 13,
                    color: COLORS.slateLight,
                    margin: '0 0 6px 0',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 500,
                  }}>
                    Plates Monitored
                  </p>
                  <p style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: COLORS.graphite,
                    margin: 0
                  }}>
                    1 plate included
                  </p>
                </div>
                <div style={{
                  padding: 16,
                  backgroundColor: COLORS.successLight,
                  borderRadius: 12,
                }}>
                  <p style={{
                    fontSize: 13,
                    color: COLORS.successDark,
                    margin: '0 0 6px 0',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 500,
                  }}>
                    Contest Letters
                  </p>
                  <p style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: COLORS.successDark,
                    margin: 0
                  }}>
                    Unlimited
                  </p>
                </div>
              </div>
            ) : (
              <div style={{
                textAlign: 'center',
                padding: '32px 20px',
                backgroundColor: COLORS.background,
                borderRadius: 12,
              }}>
                <div style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  backgroundColor: COLORS.primaryLight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                  color: COLORS.primary,
                }}>
                  <CreditCardIcon />
                </div>
                <p style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: COLORS.graphite,
                  margin: '0 0 8px 0'
                }}>
                  No active subscription
                </p>
                <p style={{
                  fontSize: 14,
                  color: COLORS.slate,
                  margin: '0 0 20px 0'
                }}>
                  Subscribe to start monitoring your plates automatically.
                </p>
                <Link href="/get-started" style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '14px 28px',
                  backgroundColor: COLORS.primary,
                  color: COLORS.white,
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  textDecoration: 'none',
                  transition: 'transform 0.1s, box-shadow 0.2s',
                }}>
                  Subscribe Now
                  <ChevronRightIcon />
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* Account Info Card */}
        <section style={{ ...cardStyle, marginBottom: 24 }}>
          <div style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${COLORS.borderLight}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: COLORS.primaryLight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.primary,
            }}>
              <UserIcon />
            </div>
            <h2 style={{
              fontSize: 18,
              fontWeight: 600,
              color: COLORS.deepHarbor,
              margin: 0
            }}>
              Account
            </h2>
          </div>

          <div style={{ padding: 24 }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 500,
                color: COLORS.graphite,
                marginBottom: 8
              }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                disabled
                style={{
                  ...inputStyle(),
                  backgroundColor: COLORS.background,
                  color: COLORS.slate,
                  cursor: 'not-allowed',
                }}
              />
              <p style={{
                fontSize: 13,
                color: COLORS.slateLight,
                margin: '8px 0 0 0'
              }}>
                Contact support to change your email address.
              </p>
            </div>
          </div>
        </section>

        {/* Mailing Information Card */}
        <section style={{
          ...cardStyle,
          marginBottom: 24,
          border: !isProfileComplete
            ? `2px solid ${COLORS.warning}`
            : `1px solid ${COLORS.border}`,
        }}>
          <div style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${COLORS.borderLight}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: COLORS.primaryLight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: COLORS.primary,
              }}>
                <MapPinIcon />
              </div>
              <div>
                <h2 style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: COLORS.deepHarbor,
                  margin: 0
                }}>
                  Mailing Address
                </h2>
                <p style={{
                  fontSize: 13,
                  color: COLORS.slate,
                  margin: '2px 0 0 0'
                }}>
                  Required for contest letters
                </p>
              </div>
            </div>

            {/* Save Status Indicator */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              backgroundColor:
                saveStatus === 'saving' ? COLORS.primaryLight :
                saveStatus === 'saved' ? COLORS.successLight :
                saveStatus === 'error' ? COLORS.dangerLight : 'transparent',
              color:
                saveStatus === 'saving' ? COLORS.primary :
                saveStatus === 'saved' ? COLORS.successDark :
                saveStatus === 'error' ? COLORS.danger : 'transparent',
              transition: 'all 0.2s',
              opacity: saveStatus === 'idle' ? 0 : 1,
            }}>
              {saveStatus === 'saving' && <LoaderIcon />}
              {saveStatus === 'saved' && <CheckCircleIcon />}
              {saveStatus === 'error' && <WarningIcon />}
              {saveStatus === 'saving' && 'Saving...'}
              {saveStatus === 'saved' && 'Saved'}
              {saveStatus === 'error' && 'Error'}
            </div>
          </div>

          <div style={{ padding: 24 }}>
            {/* Incomplete Profile Warning */}
            {!isProfileComplete && (
              <div style={{
                padding: 16,
                borderRadius: 12,
                marginBottom: 24,
                backgroundColor: COLORS.warningLight,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
              }}>
                <div style={{ color: COLORS.warningDark, flexShrink: 0, marginTop: 2 }}>
                  <WarningIcon />
                </div>
                <div>
                  <p style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: COLORS.warningDark,
                    margin: '0 0 4px 0',
                  }}>
                    Complete your mailing address
                  </p>
                  <p style={{
                    fontSize: 13,
                    color: '#92400E',
                    margin: 0,
                    lineHeight: 1.5,
                  }}>
                    Your mailing address is required to automatically send contest letters on your behalf.
                  </p>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* First Name and Last Name */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 500,
                    color: COLORS.graphite,
                    marginBottom: 8
                  }}>
                    First Name <span style={{ color: COLORS.danger }}>*</span>
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
                  <label style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 500,
                    color: COLORS.graphite,
                    marginBottom: 8
                  }}>
                    Last Name <span style={{ color: COLORS.danger }}>*</span>
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
              <p style={{
                fontSize: 12,
                color: COLORS.slateLight,
                margin: '-12px 0 0 0'
              }}>
                As it appears on your vehicle registration
              </p>

              {/* Street Address */}
              <div>
                <label style={{
                  display: 'block',
                  fontSize: 14,
                  fontWeight: 500,
                  color: COLORS.graphite,
                  marginBottom: 8
                }}>
                  Street Address <span style={{ color: COLORS.danger }}>*</span>
                </label>
                <input
                  type="text"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  placeholder="123 Main Street"
                  style={inputStyle(!addressLine1.trim())}
                />
              </div>

              {/* Apt/Suite */}
              <div>
                <label style={{
                  display: 'block',
                  fontSize: 14,
                  fontWeight: 500,
                  color: COLORS.graphite,
                  marginBottom: 8
                }}>
                  Apt, Suite, Unit{' '}
                  <span style={{ color: COLORS.slateLight, fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                  placeholder="Apt 4B"
                  style={inputStyle()}
                />
              </div>

              {/* City, State, ZIP */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr',
                gap: 16
              }}>
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 500,
                    color: COLORS.graphite,
                    marginBottom: 8
                  }}>
                    City <span style={{ color: COLORS.danger }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Chicago"
                    style={inputStyle(!city.trim())}
                  />
                </div>
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 500,
                    color: COLORS.graphite,
                    marginBottom: 8
                  }}>
                    State <span style={{ color: COLORS.danger }}>*</span>
                  </label>
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    style={{
                      ...inputStyle(),
                      cursor: 'pointer',
                    }}
                  >
                    {US_STATES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 500,
                    color: COLORS.graphite,
                    marginBottom: 8
                  }}>
                    ZIP <span style={{ color: COLORS.danger }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="60601"
                    maxLength={10}
                    style={inputStyle(!zip.trim())}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Quick Links Card */}
        <section style={cardStyle}>
          <div style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${COLORS.borderLight}`,
          }}>
            <h2 style={{
              fontSize: 18,
              fontWeight: 600,
              color: COLORS.deepHarbor,
              margin: 0
            }}>
              Quick Links
            </h2>
          </div>

          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Link href="/settings" style={{
                display: 'flex',
                alignItems: 'center',
                padding: '16px 20px',
                backgroundColor: COLORS.background,
                borderRadius: 12,
                textDecoration: 'none',
                color: COLORS.graphite,
                transition: 'background-color 0.15s',
              }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: COLORS.white,
                  border: `1px solid ${COLORS.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: COLORS.slate,
                  marginRight: 14,
                }}>
                  <SettingsIcon />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{
                    fontSize: 15,
                    fontWeight: 500,
                    margin: 0,
                    color: COLORS.graphite,
                  }}>
                    Auto-mail & Notifications
                  </p>
                  <p style={{
                    fontSize: 13,
                    color: COLORS.slateLight,
                    margin: '2px 0 0 0'
                  }}>
                    Configure automatic mailing preferences
                  </p>
                </div>
                <div style={{ color: COLORS.slateLight }}>
                  <ChevronRightIcon />
                </div>
              </Link>

              <Link href="/plates" style={{
                display: 'flex',
                alignItems: 'center',
                padding: '16px 20px',
                backgroundColor: COLORS.background,
                borderRadius: 12,
                textDecoration: 'none',
                color: COLORS.graphite,
                transition: 'background-color 0.15s',
              }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: COLORS.white,
                  border: `1px solid ${COLORS.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: COLORS.slate,
                  marginRight: 14,
                }}>
                  <CarIcon />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{
                    fontSize: 15,
                    fontWeight: 500,
                    margin: 0,
                    color: COLORS.graphite,
                  }}>
                    Monitored Plates
                  </p>
                  <p style={{
                    fontSize: 13,
                    color: COLORS.slateLight,
                    margin: '2px 0 0 0'
                  }}>
                    Add or manage your license plate
                  </p>
                </div>
                <div style={{ color: COLORS.slateLight }}>
                  <ChevronRightIcon />
                </div>
              </Link>

              <Link href="/tickets" style={{
                display: 'flex',
                alignItems: 'center',
                padding: '16px 20px',
                backgroundColor: COLORS.background,
                borderRadius: 12,
                textDecoration: 'none',
                color: COLORS.graphite,
                transition: 'background-color 0.15s',
              }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: COLORS.white,
                  border: `1px solid ${COLORS.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: COLORS.slate,
                  marginRight: 14,
                }}>
                  <TicketIcon />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{
                    fontSize: 15,
                    fontWeight: 500,
                    margin: 0,
                    color: COLORS.graphite,
                  }}>
                    View All Tickets
                  </p>
                  <p style={{
                    fontSize: 13,
                    color: COLORS.slateLight,
                    margin: '2px 0 0 0'
                  }}>
                    See detected tickets and contest status
                  </p>
                </div>
                <div style={{ color: COLORS.slateLight }}>
                  <ChevronRightIcon />
                </div>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
