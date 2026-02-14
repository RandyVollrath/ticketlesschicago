import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../lib/supabase';

const COLORS = {
  bg: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E2E8F0',
  text: '#0F172A',
  muted: '#64748B',
  primary: '#2563EB',
  success: '#16A34A',
  danger: '#DC2626',
};

export default function GuaranteeRequestPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [ticketIds, setTicketIds] = useState('');
  const [confirmEligible, setConfirmEligible] = useState(false);
  const [activeMembership, setActiveMembership] = useState(false);
  const [docsOnTime, setDocsOnTime] = useState(false);
  const [afterStart, setAfterStart] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setEmail(user.email);
      if (user?.phone) setPhone(user.phone);
    };
    loadUser();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/guarantee/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          accountEmail: email,
          accountPhone: phone,
          hadEligibleTicketContested: confirmEligible,
          ticketIds,
          membershipRemainedActive: activeMembership,
          docsProvidedOnTime: docsOnTime,
          ticketsAfterMembershipStart: afterStart,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to submit request');

      setSuccess('Guarantee Review request submitted. We will contact you after review.');
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <Head>
        <title>Guarantee Review Request | Autopilot America</title>
      </Head>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 20px' }}>
        <Link href="/guarantee" style={{ color: COLORS.primary, textDecoration: 'none', fontSize: 14 }}>
          ← Back to Guarantee
        </Link>

        <h1 style={{ fontSize: 34, margin: '18px 0 10px 0' }}>Request a Guarantee Review</h1>
        <p style={{ marginTop: 0, color: COLORS.muted, lineHeight: 1.6 }}>
          Submit this form if you believe you qualify under the First Dismissal Guarantee.
        </p>

        <form onSubmit={handleSubmit} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 18 }}>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Account email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
          </label>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Account phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: '100%', padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
          </label>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Ticket IDs (optional)</span>
            <textarea value={ticketIds} onChange={(e) => setTicketIds(e.target.value)} rows={3} style={{ width: '100%', padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
          </label>

          <label style={{ display: 'flex', gap: 10, marginBottom: 10, color: COLORS.muted }}>
            <input type="checkbox" checked={confirmEligible} onChange={(e) => setConfirmEligible(e.target.checked)} />
            I had at least one eligible ticket contested during my membership year.
          </label>

          <label style={{ display: 'flex', gap: 10, marginBottom: 10, color: COLORS.muted }}>
            <input type="checkbox" checked={activeMembership} onChange={(e) => setActiveMembership(e.target.checked)} />
            My membership remained active.
          </label>

          <label style={{ display: 'flex', gap: 10, marginBottom: 10, color: COLORS.muted }}>
            <input type="checkbox" checked={docsOnTime} onChange={(e) => setDocsOnTime(e.target.checked)} />
            I provided requested documentation on time.
          </label>

          <label style={{ display: 'flex', gap: 10, marginBottom: 14, color: COLORS.muted }}>
            <input type="checkbox" checked={afterStart} onChange={(e) => setAfterStart(e.target.checked)} />
            Tickets were issued after my membership start date.
          </label>

          {error && <p style={{ color: COLORS.danger, marginTop: 0 }}>{error}</p>}
          {success && <p style={{ color: COLORS.success, marginTop: 0 }}>{success}</p>}

          <button type="submit" disabled={loading} style={{ background: COLORS.primary, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 16px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Submitting...' : 'Submit Guarantee Review'}
          </button>
        </form>
      </main>
    </div>
  );
}
