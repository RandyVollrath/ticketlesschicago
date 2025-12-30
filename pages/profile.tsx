import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
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
  warning: '#F59E0B',
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
  full_name: string | null;
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

export default function ProfilePage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('IL');
  const [zip, setZip] = useState('');

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

    // Load profile
    const { data: profileData } = await supabase
      .from('autopilot_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    if (profileData) {
      setProfile(profileData);
      setFullName(profileData.full_name || '');
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

  const saveProfile = async () => {
    setSaving(true);
    setMessage(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from('autopilot_profiles')
      .upsert({
        user_id: session.user.id,
        full_name: fullName || null,
        mailing_address_line1: addressLine1 || null,
        mailing_address_line2: addressLine2 || null,
        mailing_city: city || null,
        mailing_state: state || null,
        mailing_zip: zip || null,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      setMessage({ type: 'error', text: 'Failed to save profile. Please try again.' });
    } else {
      setMessage({ type: 'success', text: 'Profile saved successfully.' });
      setTimeout(() => setMessage(null), 3000);
    }

    setSaving(false);
  };

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { label: string; color: string; bg: string }> = {
      active: { label: 'Active', color: COLORS.signal, bg: 'rgba(16, 185, 129, 0.1)' },
      pending: { label: 'Pending', color: COLORS.warning, bg: 'rgba(245, 158, 11, 0.1)' },
      canceled: { label: 'Canceled', color: COLORS.danger, bg: 'rgba(220, 38, 38, 0.1)' },
      past_due: { label: 'Past Due', color: COLORS.danger, bg: 'rgba(220, 38, 38, 0.1)' },
    };
    const config = configs[status] || configs.pending;
    return (
      <span style={{
        padding: '4px 12px',
        borderRadius: 20,
        fontSize: 13,
        fontWeight: 500,
        backgroundColor: config.bg,
        color: config.color,
      }}>
        {config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <DashboardLayout activePage="profile">
        <main style={{ padding: 48, textAlign: 'center' }}>Loading...</main>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activePage="profile">
      <Head>
        <title>Profile - Autopilot America</title>
      </Head>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
          Profile
        </h1>
        <p style={{ fontSize: 15, color: COLORS.slate, margin: '0 0 32px 0' }}>
          Manage your account and mailing information for contest letters.
        </p>

        {/* Subscription Status */}
        <section style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: 0 }}>
              Subscription
            </h2>
            {subscription && getStatusBadge(subscription.status)}
          </div>

          {subscription ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Plan</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                  Autopilot Annual ($24/year)
                </p>
              </div>
              <div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Renews</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                  {subscription.current_period_end
                    ? new Date(subscription.current_period_end).toLocaleDateString()
                    : 'N/A'}
                </p>
              </div>
              <div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Letters Used</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                  {subscription.letters_used_this_period} / {subscription.letters_included} included
                </p>
              </div>
              <div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Additional Letters</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                  $12 each
                </p>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <p style={{ fontSize: 15, color: COLORS.slate, margin: '0 0 16px 0' }}>
                No active subscription found.
              </p>
              <Link href="/get-started" style={{
                display: 'inline-block',
                padding: '12px 24px',
                backgroundColor: COLORS.regulatory,
                color: COLORS.white,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
              }}>
                Subscribe Now
              </Link>
            </div>
          )}
        </section>

        {/* Account Info */}
        <section style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
          marginBottom: 24,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 20px 0' }}>
            Account
          </h2>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              disabled
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                backgroundColor: COLORS.concrete,
                fontSize: 15,
                color: COLORS.slate,
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: 12, color: COLORS.slate, margin: '4px 0 0 0' }}>
              Contact support to change your email address.
            </p>
          </div>
        </section>

        {/* Mailing Information */}
        <section style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
          marginBottom: 24,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
            Mailing Information
          </h2>
          <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 20px 0' }}>
            This information appears on your contest letters. Required for letter generation.
          </p>

          {message && (
            <div style={{
              padding: 12,
              borderRadius: 8,
              marginBottom: 20,
              backgroundColor: message.type === 'success' ? '#F0FDF4' : '#FEF2F2',
              border: `1px solid ${message.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
              color: message.type === 'success' ? '#166534' : COLORS.danger,
              fontSize: 14,
            }}>
              {message.text}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                Full Name (as it appears on registration)
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Smith"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                Address Line 1
              </label>
              <input
                type="text"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="123 Main Street"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                Address Line 2 (optional)
              </label>
              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Apt 4B"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                  City
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Chicago"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    fontSize: 15,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                  State
                </label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    fontSize: 15,
                    backgroundColor: COLORS.white,
                    boxSizing: 'border-box',
                  }}
                >
                  {US_STATES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 6 }}>
                  ZIP Code
                </label>
                <input
                  type="text"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="60601"
                  maxLength={10}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    fontSize: 15,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <button
              onClick={saveProfile}
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
                alignSelf: 'flex-start',
              }}
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </section>

        {/* Quick Links */}
        <section style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 16px 0' }}>
            Quick Links
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Link href="/settings" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: COLORS.concrete,
              borderRadius: 8,
              textDecoration: 'none',
              color: COLORS.graphite,
              fontSize: 14,
              fontWeight: 500,
            }}>
              <span>Auto-mail & notification settings</span>
              <span style={{ color: COLORS.slate }}>→</span>
            </Link>

            <Link href="/plates" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: COLORS.concrete,
              borderRadius: 8,
              textDecoration: 'none',
              color: COLORS.graphite,
              fontSize: 14,
              fontWeight: 500,
            }}>
              <span>Manage monitored plates</span>
              <span style={{ color: COLORS.slate }}>→</span>
            </Link>

            <Link href="/tickets" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: COLORS.concrete,
              borderRadius: 8,
              textDecoration: 'none',
              color: COLORS.graphite,
              fontSize: 14,
              fontWeight: 500,
            }}>
              <span>View all tickets</span>
              <span style={{ color: COLORS.slate }}>→</span>
            </Link>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
