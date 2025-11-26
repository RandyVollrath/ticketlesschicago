import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import TicketContester from '../components/TicketContester';
import MobileNav from '../components/MobileNav';

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

export default function ContestTicket() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push('/login?redirect=/contest-ticket');
        return;
      }

      setUser(currentUser);
    } catch (error) {
      console.error('Error checking auth:', error);
      router.push('/login?redirect=/contest-ticket');
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

  if (!user) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: COLORS.concrete, fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Contest Your Ticket - Autopilot America</title>
        <meta name="description" content="Automatically generate professional contest letters for parking tickets" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
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

        <div className="nav-mobile" style={{ display: 'none', alignItems: 'center' }}>
          <MobileNav user={user} />
        </div>
      </nav>

      {/* Main Content */}
      <main style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: '104px 32px 60px 32px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '12px' }}>
            <h1 style={{
              fontSize: '32px',
              fontWeight: '700',
              color: COLORS.graphite,
              margin: 0,
              fontFamily: '"Space Grotesk", sans-serif',
              letterSpacing: '-1px'
            }}>
              Contest Your Ticket
            </h1>
            <span style={{
              backgroundColor: COLORS.regulatory,
              color: 'white',
              padding: '4px 12px',
              borderRadius: '100px',
              fontSize: '12px',
              fontWeight: '600',
              letterSpacing: '0.5px'
            }}>
              BETA
            </span>
          </div>
          <p style={{
            fontSize: '16px',
            color: COLORS.slate,
            margin: 0,
            lineHeight: '1.6',
            maxWidth: '600px',
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            Upload a photo of your ticket and we'll analyze it, help you identify grounds for contesting,
            and generate a professional contest letter with an evidence checklist.
          </p>
        </div>

        <TicketContester userId={user.id} />

        {/* Info Section */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '32px',
          border: `1px solid ${COLORS.border}`,
          marginTop: '32px'
        }}>
          <h3 style={{
            fontSize: '18px',
            fontWeight: '600',
            color: COLORS.graphite,
            margin: '0 0 24px 0',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            How It Works
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {[
              { step: '1', title: 'Upload Your Ticket', desc: 'Take a photo of your parking ticket (front side with all details visible).' },
              { step: '2', title: 'AI Extracts Details', desc: 'Our AI reads the ticket and extracts ticket number, violation code, amount, location, and date.' },
              { step: '3', title: 'Select Contest Grounds', desc: 'Choose the reasons why you believe the ticket was issued incorrectly.' },
              { step: '4', title: 'Get Your Letter & Checklist', desc: 'Receive a professionally formatted contest letter and evidence checklist. Print, sign, and mail!' }
            ].map((item) => (
              <div key={item.step} style={{ display: 'flex', gap: '16px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  backgroundColor: `${COLORS.regulatory}10`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  fontWeight: '600',
                  color: COLORS.regulatory,
                  flexShrink: 0
                }}>
                  {item.step}
                </div>
                <div>
                  <h4 style={{ fontSize: '15px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 4px 0' }}>
                    {item.title}
                  </h4>
                  <p style={{ fontSize: '14px', color: COLORS.slate, margin: 0, lineHeight: '1.5' }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Note */}
        <div style={{
          marginTop: '24px',
          padding: '16px 20px',
          backgroundColor: '#fef3c7',
          border: '1px solid #fbbf24',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px'
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p style={{ fontSize: '14px', color: '#92400e', margin: 0, lineHeight: '1.5' }}>
            <strong>Note:</strong> This tool generates contest letters based on your input. It does not provide legal advice.
            For complex cases or if you need additional support, consider consulting with a traffic attorney.
          </p>
        </div>
      </main>
    </div>
  );
}
