import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Footer from '../../components/Footer';

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

export default function ProtectionGuarantee() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: COLORS.concrete,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Service Guarantee - Autopilot America</title>
        <meta name="description" content="Service guarantee conditions and covered tickets for Autopilot Protection" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
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
        <div
          onClick={() => router.push('/')}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
        >
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
            onClick={() => router.push('/protection')}
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
            Back to Protection
          </button>
        </div>

        <div className="nav-mobile" style={{ display: 'none', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/protection')}
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
        padding: '120px 32px 60px 32px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <h1 style={{
            fontSize: '36px',
            fontWeight: '700',
            color: COLORS.graphite,
            margin: '0 0 16px 0',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-1px'
          }}>
            $200/Year Service Guarantee
          </h1>
          <p style={{
            fontSize: '18px',
            color: COLORS.slate,
            margin: 0,
            lineHeight: '1.6',
            maxWidth: '600px',
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            We reimburse 80% of covered tickets up to $200/year. This is a service guarantee, not insurance.
          </p>
        </div>

        {/* What's Covered */}
        <div style={{
          backgroundColor: 'white',
          padding: '32px',
          borderRadius: '16px',
          border: `1px solid ${COLORS.border}`,
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: `${COLORS.signal}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: COLORS.graphite,
              margin: 0,
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Covered Tickets
            </h2>
          </div>
          <ul style={{
            fontSize: '15px',
            color: COLORS.slate,
            lineHeight: '2',
            paddingLeft: '20px',
            margin: 0
          }}>
            <li>Street cleaning tickets</li>
            <li>Snow ban / 2-inch snow removal tickets</li>
            <li>Expired city sticker tickets</li>
            <li>Expired license plate sticker tickets</li>
          </ul>
          <div style={{
            marginTop: '20px',
            padding: '12px 16px',
            backgroundColor: COLORS.concrete,
            borderRadius: '8px'
          }}>
            <p style={{
              fontSize: '13px',
              color: COLORS.slate,
              margin: 0,
              fontStyle: 'italic'
            }}>
              <strong>Not covered:</strong> Moving violations, towing fees, parking meter violations, hydrant violations, permit zone violations
            </p>
          </div>
        </div>

        {/* Eligibility Requirements */}
        <div style={{
          backgroundColor: '#fffbeb',
          padding: '32px',
          borderRadius: '16px',
          border: '1px solid #fbbf24',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: '#fef3c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: '#92400e',
              margin: 0,
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Eligibility Requirements
            </h2>
          </div>
          <ul style={{
            fontSize: '15px',
            color: '#78350f',
            lineHeight: '1.8',
            paddingLeft: '20px',
            margin: 0
          }}>
            <li style={{ marginBottom: '8px' }}>Active subscription when ticket was issued (30-day waiting period after signup)</li>
            <li style={{ marginBottom: '8px' }}>Complete and accurate profile (vehicle info, renewal dates, address)</li>
            <li style={{ marginBottom: '8px' }}>Ticket matches the vehicle and address in your profile</li>
            <li style={{ marginBottom: '8px' }}>Submit ticket photo within 7 days of receiving it</li>
            <li style={{ marginBottom: '8px' }}>Vehicle changes limited to once per year</li>
          </ul>
        </div>

        {/* How It Works */}
        <div style={{
          backgroundColor: 'white',
          padding: '32px',
          borderRadius: '16px',
          border: `1px solid ${COLORS.border}`,
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: `${COLORS.regulatory}10`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: COLORS.graphite,
              margin: 0,
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              How Reimbursement Works
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              { step: '1', text: 'Receive a covered ticket despite following our alerts' },
              { step: '2', text: 'Submit a photo of your ticket within 7 days' },
              { step: '3', text: 'We verify eligibility (usually within 24-48 hours)' },
              { step: '4', text: 'Receive 80% reimbursement via your original payment method' }
            ].map((item) => (
              <div key={item.step} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '8px',
                  backgroundColor: `${COLORS.regulatory}10`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px',
                  fontWeight: '600',
                  color: COLORS.regulatory,
                  flexShrink: 0
                }}>
                  {item.step}
                </div>
                <p style={{ fontSize: '15px', color: COLORS.slate, margin: 0, lineHeight: '1.6', paddingTop: '3px' }}>
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{
          marginTop: '48px',
          textAlign: 'center'
        }}>
          <button
            onClick={() => router.push('/protection')}
            style={{
              backgroundColor: COLORS.regulatory,
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              padding: '16px 32px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = COLORS.regulatoryDark;
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = COLORS.regulatory;
            }}
          >
            Get Autopilot Protection
          </button>
          <p style={{
            fontSize: '14px',
            color: COLORS.slate,
            marginTop: '16px',
            margin: '16px 0 0 0'
          }}>
            Cancel anytime. No long-term commitment.
          </p>
        </div>
      </main>

      <Footer hideDonation={true} />
    </div>
  );
}
