import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import MobileNav from '../components/MobileNav'

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
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [authMethod, setAuthMethod] = useState<'google' | 'magic-link' | 'password' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
    const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  const fromSignup = router.query.from === 'signup'

  const getRedirectUrl = () => {
    const redirect = router.query.redirect as string
    return redirect || '/settings'
  }

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const redirectUrl = getRedirectUrl()
        window.location.href = redirectUrl
        return
      }
    }
    checkUser()

    if (router.query.error) {
      setMessage({
        type: 'error',
        text: router.query.error as string
      })
    }

  }, [router])

  const handleGoogleAuth = async () => {
    try {
      setLoading(true)
      setAuthMethod('google')

      const redirectUrl = getRedirectUrl()

      try {
        localStorage.setItem('post_auth_redirect', redirectUrl);
      } catch (e) {
        console.error('Failed to set localStorage:', e);
      }

      const callbackUrl = `${window.location.origin}/auth/callback`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl
        }
      })

      if (error) throw error
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'An error occurred with Google sign in'
      })
      setLoading(false)
      setAuthMethod(null)
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      setMessage({
        type: 'error',
        text: 'Please enter your email address'
      })
      return
    }

    setLoading(true)
    setMessage(null)
    setAuthMethod('magic-link')

    try {
      const redirectUrl = getRedirectUrl()

      const cookieResponse = await fetch('/api/auth/set-redirect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect: redirectUrl }),
        credentials: 'include'
      });

      if (!cookieResponse.ok) {
        throw new Error('Failed to set redirect cookie');
      }

      const response = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send magic link')
      }

      setMessage({
        type: 'success',
        text: data.message || 'Check your email for the magic link! It should arrive within a few seconds.'
      })
    } catch (error: any) {
      let errorMessage = error.message || 'An error occurred sending the magic link'

      if (error.message?.includes('rate limit')) {
        errorMessage = 'Too many attempts. Please wait a few minutes and try again.'
      }

      setMessage({
        type: 'error',
        text: errorMessage
      })
    } finally {
      setLoading(false)
      setAuthMethod(null)
    }
  }

  const handlePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setMessage({
        type: 'error',
        text: 'Please enter both email and password'
      })
      return
    }

    setLoading(true)
    setMessage(null)
    setAuthMethod('password')

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email,
        password: password
      })

      if (signInError?.message === 'Invalid login credentials') {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: email,
          password: password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: {
              source: 'ticketless-america-login'
            }
          }
        })

        if (signUpError) {
          setMessage({
            type: 'error',
            text: 'Invalid email or password. Please try again or use the magic link option below.'
          })
        } else if (signUpData?.user?.identities?.length === 0) {
          setMessage({
            type: 'error',
            text: 'Account exists but password is incorrect. Please try again or use the magic link option below.'
          })
        } else {
          setMessage({
            type: 'success',
            text: 'Account created! Please check your email to verify your account before signing in.'
          })
        }
      } else if (signInError) {
        throw signInError
      } else {
        const redirectUrl = getRedirectUrl()
        window.location.href = redirectUrl
      }
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'An error occurred during authentication'
      })
    } finally {
      setLoading(false)
      setAuthMethod(null)
    }
  }


  return (
    <div style={{ minHeight: '100vh', backgroundColor: COLORS.concrete, fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Sign In - Autopilot America</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
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

        <div className="nav-desktop" style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="/check-your-street" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Check Your Street</a>
          <a href="/alerts/signup" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Free Alerts</a>
          <a href="/protection" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Protection</a>
        </div>

        <div className="nav-mobile" style={{ display: 'none', alignItems: 'center' }}>
          <MobileNav />
        </div>
      </nav>

      <main style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '104px 32px 60px 32px',
        minHeight: 'calc(100vh - 72px)'
      }}>
        <div style={{ width: '100%', maxWidth: '420px' }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            border: `1px solid ${COLORS.border}`,
            padding: '40px'
          }}>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{
                fontSize: '28px',
                fontWeight: '700',
                color: COLORS.graphite,
                marginBottom: '12px',
                margin: '0 0 12px 0',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '-1px'
              }}>
                Welcome Back
              </h1>
              <p style={{ fontSize: '15px', color: COLORS.slate, margin: 0 }}>
                Sign in to manage your alerts and protection
              </p>
            </div>

            {/* Authentication Options */}
            <div style={{ marginBottom: '24px' }}>
              {/* Google Sign In Button */}
              <button
                onClick={handleGoogleAuth}
                disabled={loading}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '10px',
                  backgroundColor: loading && authMethod === 'google' ? COLORS.concrete : 'white',
                  fontWeight: '500',
                  color: COLORS.graphite,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginBottom: '16px',
                  fontSize: '15px',
                  opacity: loading && authMethod !== 'google' ? 0.5 : 1
                }}
              >
                <svg style={{ width: '20px', height: '20px' }} viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {loading && authMethod === 'google' ? 'Signing in...' : 'Continue with Google'}
              </button>

              {/* Divider */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                margin: '20px 0',
                gap: '12px'
              }}>
                <div style={{ flex: 1, height: '1px', backgroundColor: COLORS.border }}></div>
                <span style={{ fontSize: '13px', color: COLORS.slate }}>or email me a login link</span>
                <div style={{ flex: 1, height: '1px', backgroundColor: COLORS.border }}></div>
              </div>

              {/* Email for Magic Link */}
              <div style={{ marginBottom: '12px' }}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '10px',
                    fontSize: '15px',
                    backgroundColor: loading ? COLORS.concrete : 'white',
                    cursor: loading ? 'not-allowed' : 'text',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleMagicLink(e);
                }}
                disabled={loading || !email}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '10px',
                  backgroundColor: loading && authMethod === 'magic-link' ? COLORS.concrete : 'white',
                  color: COLORS.graphite,
                  fontWeight: '500',
                  cursor: loading || !email ? 'not-allowed' : 'pointer',
                  fontSize: '15px',
                  opacity: !email ? 0.5 : 1,
                  marginBottom: '8px'
                }}
              >
                {loading && authMethod === 'magic-link' ? 'Sending link...' : 'Send Magic Link'}
              </button>

              <p style={{
                fontSize: '13px',
                color: COLORS.slate,
                textAlign: 'center',
                lineHeight: '1.4',
                margin: 0
              }}>
                We'll email you a secure link - no password needed
              </p>

            </div>

            {message && (
              <div style={{
                marginTop: '16px',
                padding: '14px 16px',
                borderRadius: '10px',
                fontSize: '14px',
                backgroundColor: message.type === 'success' ? `${COLORS.signal}10` : '#fef2f2',
                color: message.type === 'success' ? COLORS.signal : '#dc2626',
                border: `1px solid ${message.type === 'success' ? `${COLORS.signal}30` : '#fecaca'}`,
                lineHeight: '1.5'
              }}>
                {message.text}
              </div>
            )}

            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <p style={{ fontSize: '12px', color: COLORS.slate, margin: 0 }}>
                By continuing, you agree to our{' '}
                <a href="/terms" style={{ color: COLORS.regulatory, textDecoration: 'none' }}>Terms of Service</a>
                {' '}and{' '}
                <a href="/privacy" style={{ color: COLORS.regulatory, textDecoration: 'none' }}>Privacy Policy</a>
              </p>
            </div>
          </div>

          {/* New User CTA */}
          <div style={{
            marginTop: '24px',
            padding: '20px',
            backgroundColor: `${COLORS.regulatory}08`,
            border: `1px solid ${COLORS.regulatory}20`,
            borderRadius: '12px',
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '14px', color: COLORS.graphite, margin: '0 0 12px 0' }}>
              New to Autopilot America?
            </p>
            <button
              onClick={() => router.push('/alerts/signup')}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Get Free Alerts
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
