import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import ReimbursementRequest from '../components/ReimbursementRequest';

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

export default function SubmitTicket() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasProtection, setHasProtection] = useState(false);

  useEffect(() => {
    checkAccess();
  }, []);

  async function checkAccess() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push('/login?redirect=/submit-ticket');
        return;
      }

      setUser(currentUser);

      // Check if user has protection
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('has_protection')
        .eq('user_id', currentUser.id)
        .single();

      if (!profile?.has_protection) {
        router.push('/protection');
        return;
      }

      setHasProtection(true);
    } catch (error) {
      console.error('Error checking access:', error);
      router.push('/');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: COLORS.concrete,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: `3px solid ${COLORS.border}`,
          borderTopColor: COLORS.regulatory,
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!hasProtection) {
    return null;
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: COLORS.concrete,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Submit Ticket for Reimbursement - Autopilot America</title>
        <meta name="description" content="Submit a parking ticket for reimbursement under your Autopilot Protection" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          ::selection { background: #10B981; color: white; }
          @media (max-width: 768px) {
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
          }
          .nav-mobile { display: none; }
        `}</style>
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '72px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${COLORS.border}`,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px'
      }}>
        <div onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: COLORS.regulatory,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <span style={{
            fontSize: '18px',
            fontWeight: '700',
            color: COLORS.graphite,
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Autopilot America
          </span>
        </div>

        <div className="nav-desktop" style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/settings')}
            style={{
              color: COLORS.slate,
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back to Settings
          </button>
        </div>

        <div className="nav-mobile" style={{ display: 'none', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/settings')}
            style={{
              color: COLORS.slate,
              background: 'none',
              border: `1px solid ${COLORS.border}`,
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Back
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '104px 32px 60px 32px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: '700',
            color: COLORS.graphite,
            margin: '0 0 16px 0',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-1px'
          }}>
            Submit Ticket for Reimbursement
          </h1>
          <p style={{
            fontSize: '16px',
            color: COLORS.slate,
            margin: 0,
            lineHeight: '1.6',
            maxWidth: '600px',
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            We reimburse 80% of eligible tickets up to $200/year. Submit your ticket photos and details below.
            Tickets must match the address and vehicle in your profile at the time of issue.
          </p>
        </div>

        {/* Info Banner */}
        <div style={{
          backgroundColor: `${COLORS.regulatory}08`,
          border: `1px solid ${COLORS.regulatory}30`,
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '32px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px'
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <p style={{ fontSize: '14px', color: COLORS.slate, margin: 0, lineHeight: '1.5' }}>
            <strong style={{ color: COLORS.graphite }}>Covered tickets:</strong> Street cleaning, snow ban, expired city sticker, expired license plate.
            Submit within 7 days of receiving the ticket.
          </p>
        </div>

        {user && <ReimbursementRequest userId={user.id} />}
      </main>
    </div>
  );
}
