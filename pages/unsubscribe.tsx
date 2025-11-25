import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

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

export default function Unsubscribe() {
  const router = useRouter();
  const { email } = router.query;
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleUnsubscribe = async () => {
    if (!email) {
      setError('No email provided');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/drip/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(true);
      } else {
        setError(data.error || 'Failed to unsubscribe');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Unsubscribe - Autopilot America</title>
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
          backgroundColor: 'white',
          borderRadius: '16px',
          border: `1px solid ${COLORS.border}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
          padding: '48px',
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center'
        }}>
          {success ? (
            <>
              {/* Success Icon */}
              <div style={{
                width: '64px',
                height: '64px',
                backgroundColor: `${COLORS.signal}15`,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto'
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>

              <h1 style={{
                fontSize: '26px',
                fontWeight: '700',
                color: COLORS.graphite,
                marginBottom: '12px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '-0.5px'
              }}>
                You're Unsubscribed
              </h1>

              <p style={{
                fontSize: '15px',
                color: COLORS.slate,
                lineHeight: '1.6',
                marginBottom: '16px'
              }}>
                You won't receive marketing emails from us anymore.
              </p>

              <div style={{
                backgroundColor: `${COLORS.regulatory}08`,
                border: `1px solid ${COLORS.regulatory}20`,
                borderRadius: '10px',
                padding: '14px 18px',
                marginBottom: '28px'
              }}>
                <p style={{
                  fontSize: '13px',
                  color: COLORS.slate,
                  lineHeight: '1.5',
                  margin: 0
                }}>
                  You'll still receive important alerts about street cleaning and parking bans if you have an active account.
                </p>
              </div>

              <a
                href="/"
                style={{
                  display: 'inline-block',
                  backgroundColor: COLORS.regulatory,
                  color: 'white',
                  padding: '14px 28px',
                  borderRadius: '10px',
                  textDecoration: 'none',
                  fontWeight: '600',
                  fontSize: '15px',
                  transition: 'background-color 0.2s'
                }}
              >
                Return to Homepage
              </a>
            </>
          ) : (
            <>
              {/* Mail Icon */}
              <div style={{
                width: '64px',
                height: '64px',
                backgroundColor: COLORS.concrete,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto'
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.slate} strokeWidth="1.5">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                  <line x1="2" y1="20" x2="8" y2="14"/>
                  <line x1="22" y1="20" x2="16" y2="14"/>
                </svg>
              </div>

              <h1 style={{
                fontSize: '26px',
                fontWeight: '700',
                color: COLORS.graphite,
                marginBottom: '12px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '-0.5px'
              }}>
                Unsubscribe
              </h1>

              <p style={{
                fontSize: '15px',
                color: COLORS.slate,
                lineHeight: '1.6',
                marginBottom: '24px'
              }}>
                Click below to stop receiving marketing emails from Autopilot America.
              </p>

              {email && (
                <div style={{
                  backgroundColor: COLORS.concrete,
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginBottom: '24px'
                }}>
                  <p style={{
                    fontSize: '14px',
                    color: COLORS.slate,
                    margin: 0
                  }}>
                    Email: <strong style={{ color: COLORS.graphite }}>{email}</strong>
                  </p>
                </div>
              )}

              {error && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '10px',
                  padding: '14px',
                  marginBottom: '20px',
                  color: '#dc2626',
                  fontSize: '14px'
                }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleUnsubscribe}
                disabled={loading || !email}
                style={{
                  backgroundColor: loading ? COLORS.slate : '#dc2626',
                  color: 'white',
                  padding: '14px 32px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: '600',
                  fontSize: '15px',
                  cursor: loading || !email ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  transition: 'all 0.2s',
                  marginBottom: '24px'
                }}
              >
                {loading ? 'Processing...' : 'Unsubscribe from Marketing'}
              </button>

              <p style={{
                fontSize: '13px',
                color: COLORS.slate,
                lineHeight: '1.6'
              }}>
                You'll continue to receive important account alerts (street cleaning, parking bans, etc.) unless you delete your account.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
