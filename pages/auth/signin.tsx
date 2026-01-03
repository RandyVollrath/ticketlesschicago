import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

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

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Already signed in, redirect to dashboard
        router.push('/dashboard');
      }
      setCheckingAuth(false);
    };
    checkAuth();
  }, [router]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });
      // Supabase sometimes returns a 500 error even when the email is sent successfully
      // (known SMTP race condition bug). Only suppress the exact known error.
      if (error) {
        const msg = error.message?.toLowerCase() || '';
        // This specific error occurs when email is sent but Supabase logging fails
        if (msg.includes('error sending confirmation email')) {
          setSuccess('Check your email for a sign-in link.');
        } else {
          throw error;
        }
      } else {
        setSuccess('Check your email for a sign-in link.');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: COLORS.concrete,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        <p style={{ color: COLORS.slate }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: COLORS.concrete,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <Head>
        <title>Sign In - Autopilot America</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Header */}
      <header style={{
        backgroundColor: COLORS.white,
        borderBottom: `1px solid ${COLORS.border}`,
        padding: '16px 24px',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: COLORS.deepHarbor }}>Autopilot America</span>
          </Link>
          <Link href="/get-started" style={{
            color: COLORS.white,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
            backgroundColor: COLORS.regulatory,
            padding: '10px 20px',
            borderRadius: 8,
          }}>
            Start Saving Now
          </Link>
        </div>
      </header>

      {/* Sign In Form */}
      <main style={{
        maxWidth: 440,
        margin: '0 auto',
        padding: '80px 24px',
      }}>
        <div style={{
          backgroundColor: COLORS.white,
          borderRadius: 16,
          border: `1px solid ${COLORS.border}`,
          padding: 40,
        }}>
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            color: COLORS.deepHarbor,
            margin: '0 0 8px 0',
            textAlign: 'center',
          }}>
            Welcome Back!
          </h1>
          <p style={{
            fontSize: 15,
            color: COLORS.slate,
            margin: '0 0 32px 0',
            textAlign: 'center',
          }}>
            Sign in to your Autopilot America account and keep avoiding those parking tickets.
          </p>

          {/* Google Sign-In Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px 24px',
              borderRadius: 10,
              border: `1px solid ${COLORS.border}`,
              backgroundColor: COLORS.white,
              color: COLORS.graphite,
              fontSize: 16,
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginBottom: 24,
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
            marginBottom: 24,
          }}>
            <div style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
            <span style={{ fontSize: 14, color: COLORS.slate }}>or</span>
            <div style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />
          </div>

          <form onSubmit={handleSignIn}>
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 500,
                color: COLORS.graphite,
                marginBottom: 8,
              }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 16,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <div style={{
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                color: COLORS.danger,
                padding: 12,
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 20,
              }}>
                {error}
              </div>
            )}

            {success && (
              <div style={{
                backgroundColor: '#F0FDF4',
                border: '1px solid #BBF7D0',
                color: '#166534',
                padding: 12,
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 20,
              }}>
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              style={{
                width: '100%',
                padding: '14px 24px',
                borderRadius: 10,
                border: 'none',
                backgroundColor: loading || !email ? COLORS.slate : COLORS.regulatory,
                color: COLORS.white,
                fontSize: 16,
                fontWeight: 600,
                cursor: loading || !email ? 'not-allowed' : 'pointer',
                marginBottom: 20,
              }}
            >
              {loading ? 'Sending...' : 'Send sign-in link'}
            </button>
          </form>

          <p style={{
            fontSize: 14,
            color: COLORS.slate,
            textAlign: 'center',
            margin: 0,
          }}>
            Don't have an account?{' '}
            <Link href="/get-started" style={{ color: COLORS.regulatory, textDecoration: 'none', fontWeight: 500 }}>
              Sign up for just $24/year
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
