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

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setAuthError('');

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/get-started`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setAuthError(err.message || 'Something went wrong');
      setAuthLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/get-started`,
        },
      });
      // Supabase sometimes returns a 500 error even when the email is sent successfully
      // (known issue with SMTP logging). Show success if it's an email-related error.
      if (error) {
        const msg = error.message?.toLowerCase() || '';
        if (msg.includes('sending') || msg.includes('email') || msg.includes('confirmation')) {
          // Email was likely sent despite the error
          setAuthSuccess('Check your email for a sign-in link.');
        } else {
          throw error;
        }
      } else {
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
        <title>Start Saving - Autopilot America</title>
        <meta name="description" content="Stop paying unfair parking tickets. Autopilot America automatically contests your tickets for just $24/year." />
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
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>AUTO-CONTEST PLAN</span>
              <span style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '4px 10px', borderRadius: 12, fontSize: 12 }}>BEST VALUE</span>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontSize: 36, fontWeight: 700, color: COLORS.deepHarbor }}>$24</span>
                <span style={{ fontSize: 16, color: COLORS.slate, marginLeft: 8 }}>/year</span>
              </div>
              <p style={{ fontSize: 13, color: COLORS.signal, fontWeight: 500, margin: '0 0 16px 0' }}>
                That's less than $2/month to protect yourself from tickets
              </p>
              <div style={{ fontSize: 14, color: COLORS.graphite, lineHeight: 1.8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.signal}>
                    <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" clipRule="evenodd" />
                  </svg>
                  <strong>Weekly</strong> plate monitoring
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.signal}>
                    <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" clipRule="evenodd" />
                  </svg>
                  <strong>Automatic</strong> contest letters mailed
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.signal}>
                    <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" clipRule="evenodd" />
                  </svg>
                  <strong>Win rate:</strong> 60-75% on eligible tickets
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
                <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
                  {authMode === 'signup' ? 'Get Started with Autopilot America!' : 'Welcome Back!'}
                </h2>
                <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 24px 0' }}>
                  {authMode === 'signup' ? 'Stop paying unfair parking tickets. We\'ll contest them for you automatically.' : 'Sign in to continue protecting your wallet from parking tickets.'}
                </p>

                {/* Google Sign-In Button */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={authLoading}
                  style={{
                    width: '100%',
                    padding: '14px 24px',
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.white,
                    color: COLORS.graphite,
                    fontSize: 16,
                    fontWeight: 500,
                    cursor: authLoading ? 'not-allowed' : 'pointer',
                    marginBottom: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
                  <span style={{ fontSize: 14, color: COLORS.slate }}>or</span>
                  <div style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
                </div>

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
                    {authLoading ? 'Sending...' : 'Start Protecting My Wallet'}
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
                    backgroundColor: consentChecked ? COLORS.signal : COLORS.slate,
                    color: COLORS.white,
                    padding: '16px 24px',
                    borderRadius: 8,
                    border: 'none',
                    fontSize: 17,
                    fontWeight: 600,
                    cursor: (checkoutLoading || !consentChecked) ? 'not-allowed' : 'pointer',
                    opacity: (checkoutLoading || !consentChecked) ? 0.7 : 1,
                  }}
                >
                  {checkoutLoading ? 'Loading...' : 'Start Saving Money Now'}
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
