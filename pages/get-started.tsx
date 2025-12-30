import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
  danger: '#DC2626',
};

export default function GetStarted() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signup');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');

  // Checkout state
  const [consentChecked, setConsentChecked] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        setEmail(session.user.email || '');
      }
      setLoading(false);
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user);
        setEmail(session.user.email || '');
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => authListener?.subscription.unsubscribe();
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');

    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/get-started`,
          },
        });
        if (error) throw error;
        setAuthSuccess('Check your email for a sign-in link.');
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/get-started`,
          },
        });
        if (error) throw error;
        setAuthSuccess('Check your email for a sign-in link.');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Something went wrong');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (!consentChecked) {
      setAuthError('Please accept the authorization to continue.');
      return;
    }

    setCheckoutLoading(true);
    setAuthError('');

    try {
      const response = await fetch('/api/autopilot/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Something went wrong');
      setCheckoutLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.concrete, minHeight: '100vh' }}>
      <Head>
        <title>Get Started - Autopilot America</title>
        <meta name="description" content="Start auto-contesting Chicago parking tickets for $24/year" />
      </Head>

      {/* Header */}
      <header style={{
        backgroundColor: COLORS.white,
        borderBottom: `1px solid ${COLORS.border}`,
        padding: '16px 24px',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: COLORS.deepHarbor }}>Autopilot America</span>
          </Link>
        </div>
      </header>

      <main style={{ padding: '48px 24px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {/* Plan Card */}
          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            overflow: 'hidden',
            marginBottom: 24,
          }}>
            <div style={{
              backgroundColor: COLORS.regulatory,
              color: COLORS.white,
              padding: '12px 24px',
              fontSize: 14,
              fontWeight: 600,
            }}>
              AUTO-CONTEST PLAN
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 16 }}>
                <span style={{ fontSize: 36, fontWeight: 700, color: COLORS.deepHarbor }}>$24</span>
                <span style={{ fontSize: 16, color: COLORS.slate, marginLeft: 8 }}>/year</span>
              </div>
              <div style={{ fontSize: 14, color: COLORS.slate, lineHeight: 1.8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.signal}>
                    <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" clipRule="evenodd" />
                  </svg>
                  Weekly ticket checks
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.signal}>
                    <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" clipRule="evenodd" />
                  </svg>
                  1 mailed contest letter included per year
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.signal}>
                    <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" clipRule="evenodd" />
                  </svg>
                  $12 per additional mailed letter
                </div>
              </div>
            </div>
          </div>

          {/* Auth or Checkout */}
          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            padding: 24,
          }}>
            {!user ? (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
                  {authMode === 'signup' ? 'Create your account' : 'Sign in'}
                </h2>
                <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 24px 0' }}>
                  {authMode === 'signup' ? 'Enter your email to get started.' : 'Welcome back! Enter your email to sign in.'}
                </p>

                <form onSubmit={handleAuth}>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 8 }}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        fontSize: 16,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 8,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {authError && (
                    <div style={{
                      backgroundColor: '#FEF2F2',
                      border: `1px solid #FECACA`,
                      color: COLORS.danger,
                      padding: 12,
                      borderRadius: 8,
                      fontSize: 14,
                      marginBottom: 16,
                    }}>
                      {authError}
                    </div>
                  )}

                  {authSuccess && (
                    <div style={{
                      backgroundColor: '#F0FDF4',
                      border: `1px solid #BBF7D0`,
                      color: '#166534',
                      padding: 12,
                      borderRadius: 8,
                      fontSize: 14,
                      marginBottom: 16,
                    }}>
                      {authSuccess}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading}
                    style={{
                      width: '100%',
                      backgroundColor: COLORS.regulatory,
                      color: COLORS.white,
                      padding: '14px 24px',
                      borderRadius: 8,
                      border: 'none',
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: authLoading ? 'not-allowed' : 'pointer',
                      opacity: authLoading ? 0.7 : 1,
                    }}
                  >
                    {authLoading ? 'Sending...' : 'Continue with email'}
                  </button>
                </form>

                <p style={{ fontSize: 14, color: COLORS.slate, marginTop: 16, textAlign: 'center' }}>
                  {authMode === 'signup' ? (
                    <>Already have an account? <button onClick={() => setAuthMode('signin')} style={{ color: COLORS.regulatory, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Sign in</button></>
                  ) : (
                    <>New here? <button onClick={() => setAuthMode('signup')} style={{ color: COLORS.regulatory, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Create account</button></>
                  )}
                </p>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
                  Complete your subscription
                </h2>
                <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 24px 0' }}>
                  Signed in as <strong>{user.email}</strong>
                </p>

                {/* Consent Checkbox */}
                <div style={{
                  backgroundColor: COLORS.concrete,
                  padding: 16,
                  borderRadius: 8,
                  marginBottom: 24,
                }}>
                  <label style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={consentChecked}
                      onChange={(e) => setConsentChecked(e.target.checked)}
                      style={{ width: 20, height: 20, marginTop: 2 }}
                    />
                    <div>
                      <span style={{ fontSize: 14, color: COLORS.graphite, fontWeight: 500 }}>
                        I authorize Autopilot America to submit ticket contest letters on my behalf, including generating and mailing a letter using the information I provide.
                      </span>
                      <p style={{ fontSize: 13, color: COLORS.slate, margin: '8px 0 0 0' }}>
                        You can disable auto-mail and require manual approval at any time in Settings.
                      </p>
                    </div>
                  </label>
                </div>

                {authError && (
                  <div style={{
                    backgroundColor: '#FEF2F2',
                    border: `1px solid #FECACA`,
                    color: COLORS.danger,
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 14,
                    marginBottom: 16,
                  }}>
                    {authError}
                  </div>
                )}

                <button
                  onClick={handleCheckout}
                  disabled={checkoutLoading || !consentChecked}
                  style={{
                    width: '100%',
                    backgroundColor: consentChecked ? COLORS.regulatory : COLORS.slate,
                    color: COLORS.white,
                    padding: '14px 24px',
                    borderRadius: 8,
                    border: 'none',
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: (checkoutLoading || !consentChecked) ? 'not-allowed' : 'pointer',
                    opacity: (checkoutLoading || !consentChecked) ? 0.7 : 1,
                  }}
                >
                  {checkoutLoading ? 'Loading...' : 'Subscribe & continue'}
                </button>

                <p style={{ fontSize: 13, color: COLORS.slate, marginTop: 16, textAlign: 'center' }}>
                  You'll be redirected to Stripe for secure payment.
                </p>
              </>
            )}
          </div>

          {/* Trust text */}
          <p style={{
            fontSize: 13,
            color: COLORS.slate,
            textAlign: 'center',
            marginTop: 24,
            lineHeight: 1.6,
          }}>
            Autopilot America is not a law firm and does not provide legal advice.
            <br />
            Outcomes vary; contesting does not guarantee dismissal.
          </p>
        </div>
      </main>
    </div>
  );
}
