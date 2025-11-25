import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

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

export default function Custom404() {
  const router = useRouter();

  return (
    <>
      <Head>
        <title>Page Not Found - Autopilot America</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`::selection { background: #10B981; color: white; }`}</style>
      </Head>

      <div style={{
        minHeight: '100vh',
        backgroundColor: COLORS.concrete,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{
          textAlign: 'center',
          maxWidth: '500px'
        }}>
          {/* 404 Icon */}
          <div style={{
            width: '120px',
            height: '120px',
            backgroundColor: `${COLORS.regulatory}10`,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 32px auto'
          }}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M16 16s-1.5-2-4-2-4 2-4 2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </div>

          <h1 style={{
            fontSize: '72px',
            fontWeight: '700',
            color: COLORS.graphite,
            margin: '0 0 8px 0',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-2px',
            lineHeight: '1'
          }}>
            404
          </h1>

          <h2 style={{
            fontSize: '24px',
            fontWeight: '600',
            color: COLORS.graphite,
            margin: '0 0 12px 0',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Page Not Found
          </h2>

          <p style={{
            fontSize: '16px',
            color: COLORS.slate,
            lineHeight: '1.6',
            marginBottom: '32px'
          }}>
            The page you're looking for doesn't exist or has been moved. Let's get you back on track.
          </p>

          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
            <button
              onClick={() => router.push('/')}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                padding: '14px 28px',
                fontSize: '15px',
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
              Go to Homepage
            </button>
            <button
              onClick={() => router.back()}
              style={{
                backgroundColor: 'white',
                color: COLORS.graphite,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '10px',
                padding: '14px 28px',
                fontSize: '15px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = COLORS.slate;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = COLORS.border;
              }}
            >
              Go Back
            </button>
          </div>

          {/* Quick Links */}
          <div style={{
            marginTop: '48px',
            paddingTop: '32px',
            borderTop: `1px solid ${COLORS.border}`
          }}>
            <p style={{
              fontSize: '13px',
              color: COLORS.slate,
              marginBottom: '16px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontWeight: '500'
            }}>
              Popular Pages
            </p>
            <div style={{
              display: 'flex',
              gap: '24px',
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}>
              <a href="/alerts/signup" style={{ color: COLORS.regulatory, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Free Alerts</a>
              <a href="/protection" style={{ color: COLORS.regulatory, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Protection</a>
              <a href="/check-your-street" style={{ color: COLORS.regulatory, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Street Cleaning</a>
              <a href="/settings" style={{ color: COLORS.regulatory, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>My Account</a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
