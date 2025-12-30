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
      if (error) throw error;
      setSuccess('Check your email for a sign-in link.');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
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
            color: COLORS.regulatory,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 500,
          }}>
            Start for $24/year
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
            Welcome back
          </h1>
          <p style={{
            fontSize: 15,
            color: COLORS.slate,
            margin: '0 0 32px 0',
            textAlign: 'center',
          }}>
            Sign in to manage your tickets and plates.
          </p>

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
              Get started
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
