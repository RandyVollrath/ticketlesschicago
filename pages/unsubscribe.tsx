import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

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
      </Head>

      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          padding: '40px',
          maxWidth: '500px',
          width: '100%'
        }}>
          {success ? (
            <>
              <h1 style={{
                fontSize: '28px',
                fontWeight: '700',
                color: '#111827',
                marginBottom: '16px',
                textAlign: 'center'
              }}>
                ✅ You're unsubscribed
              </h1>

              <p style={{
                fontSize: '16px',
                color: '#6b7280',
                lineHeight: '1.6',
                textAlign: 'center',
                marginBottom: '24px'
              }}>
                You won't receive marketing emails from us anymore.
              </p>

              <p style={{
                fontSize: '14px',
                color: '#9ca3af',
                lineHeight: '1.6',
                textAlign: 'center',
                marginBottom: '24px'
              }}>
                (You'll still receive important alerts about street cleaning and snow bans if you have an active account.)
              </p>

              <div style={{ textAlign: 'center' }}>
                <a
                  href="/"
                  style={{
                    display: 'inline-block',
                    backgroundColor: '#0052cc',
                    color: 'white',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    fontWeight: '600'
                  }}
                >
                  Return to Homepage
                </a>
              </div>
            </>
          ) : (
            <>
              <h1 style={{
                fontSize: '28px',
                fontWeight: '700',
                color: '#111827',
                marginBottom: '16px',
                textAlign: 'center'
              }}>
                Unsubscribe from marketing emails
              </h1>

              <p style={{
                fontSize: '16px',
                color: '#6b7280',
                lineHeight: '1.6',
                textAlign: 'center',
                marginBottom: '24px'
              }}>
                We're sorry to see you go. Click below to stop receiving marketing emails from Autopilot America.
              </p>

              {email && (
                <p style={{
                  fontSize: '14px',
                  color: '#9ca3af',
                  textAlign: 'center',
                  marginBottom: '24px'
                }}>
                  Email: <strong>{email}</strong>
                </p>
              )}

              {error && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  color: '#991b1b',
                  fontSize: '14px'
                }}>
                  {error}
                </div>
              )}

              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={handleUnsubscribe}
                  disabled={loading || !email}
                  style={{
                    backgroundColor: loading ? '#9ca3af' : '#dc2626',
                    color: 'white',
                    padding: '12px 32px',
                    borderRadius: '8px',
                    border: 'none',
                    fontWeight: '600',
                    fontSize: '16px',
                    cursor: loading || !email ? 'not-allowed' : 'pointer'
                  }}
                >
                  {loading ? 'Unsubscribing...' : 'Unsubscribe'}
                </button>
              </div>

              <p style={{
                fontSize: '13px',
                color: '#9ca3af',
                lineHeight: '1.6',
                textAlign: 'center',
                marginTop: '24px'
              }}>
                You'll continue to receive important account alerts (street cleaning, snow bans, etc.) unless you delete your account.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
