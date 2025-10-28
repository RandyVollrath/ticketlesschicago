import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [authMethod, setAuthMethod] = useState<'google' | 'magic-link' | 'passkey' | 'password' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [passkeysSupported, setPasskeysSupported] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  // Check if user is coming from signup
  const fromSignup = router.query.from === 'signup'

  useEffect(() => {
    // Check if user is already logged in
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        router.push('/settings')
      }
    }
    checkUser()

    // Check for error message in query params
    if (router.query.error) {
      setMessage({
        type: 'error',
        text: router.query.error as string
      })
    }

    // Check if passkeys are supported
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      setPasskeysSupported(true)
    }
  }, [router])

  const handleGoogleAuth = async () => {
    try {
      setLoading(true)
      setAuthMethod('google')
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
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
      // Use our custom API endpoint that sends via Resend for faster delivery
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
      console.error('Magic link error details:', {
        message: error.message,
        fullError: error
      })

      let errorMessage = error.message || 'An error occurred sending the magic link'

      // Handle common errors
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
      // First try to sign in
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email,
        password: password
      })

      if (signInError?.message === 'Invalid login credentials') {
        // Could be new user or wrong password - try to create account
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
          // Signup failed - likely means wrong password for existing user
          setMessage({
            type: 'error',
            text: 'Invalid email or password. Please try again or use the magic link option below.'
          })
        } else if (signUpData?.user?.identities?.length === 0) {
          // User already exists (Supabase returns user with empty identities)
          setMessage({
            type: 'error',
            text: 'Account exists but password is incorrect. Please try again or use the magic link option below.'
          })
        } else {
          // New account created successfully
          setMessage({
            type: 'success',
            text: 'Account created! Please check your email to verify your account before signing in.'
          })
        }
      } else if (signInError) {
        throw signInError
      } else {
        // Successful sign in
        router.push('/settings')
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

  const handlePasskeyAuth = async () => {
    if (!passkeysSupported) {
      setMessage({
        type: 'error',
        text: 'Passkeys are not supported on this device or browser'
      })
      return
    }

    setLoading(true)
    setAuthMethod('passkey')
    setMessage(null)

    try {
      // Import the library dynamically to avoid SSR issues
      const { startAuthentication } = await import('@simplewebauthn/browser')

      const response = await fetch('/api/auth/passkey/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      })

      if (!response.ok) throw new Error('Failed to start passkey authentication')

      const options = await response.json()
      const assertion = await startAuthentication({ optionsJSON: options })

      const verifyResponse = await fetch('/api/auth/passkey/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...assertion,
          challenge: options.challenge
        })
      })

      if (!verifyResponse.ok) throw new Error('Failed to verify passkey')

      const result = await verifyResponse.json()
      if (result.verified && result.session) {
        // Session has been set via cookies, now initialize Supabase client with the session
        console.log('Passkey verified, setting session')
        
        // Set the session in Supabase client
        await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token
        })
        
        console.log('Session set, redirecting to settings')
        router.push('/settings')
      }
    } catch (error: any) {
      console.error('Passkey auth error:', error)
      let errorMessage = 'No passkeys found. Please sign in with email first to register a passkey.'
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Passkey authentication was cancelled or failed'
      } else if (error.message && error.message.includes('No passkey found')) {
        errorMessage = '🔐 No passkeys registered yet. Sign in with email below, then go to Settings to add a passkey for faster future logins!'
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Sign In - Autopilot America</title>
        <style>{`
          @media (max-width: 768px) {
            header {
              height: 70px !important;
            }
            header > div {
              padding: 0 12px !important;
            }
            header > div > div:first-child {
              margin-right: 8px !important;
            }
            header > div > div:first-child > div:first-child {
              width: 42px !important;
              height: 42px !important;
              font-size: 22px !important;
            }
            header > div > div:first-child > div:last-child > span:first-child {
              font-size: 20px !important;
            }
            header > div > div:first-child > div:last-child > span:last-child {
              font-size: 10px !important;
            }
            header > div > div:last-child {
              gap: 8px !important;
              font-size: 13px !important;
              flex: 1;
              justify-content: flex-end;
              overflow-x: auto;
              overflow-y: hidden;
              -webkit-overflow-scrolling: touch;
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            header > div > div:last-child::-webkit-scrollbar {
              display: none;
            }
            header > div > div:last-child a {
              font-size: 13px !important;
            }
          }
        `}</style>
      </Head>

      {/* Clean header */}
      <header style={{
        backgroundColor: 'white',
        borderBottom: '1px solid #e5e7eb',
        height: '90px',
        display: 'flex',
        alignItems: 'center'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          maxWidth: '1200px',
          width: '100%',
          margin: '0 auto',
          padding: '0 48px'
        }}>
          <div
            onClick={() => router.push('/')}
            style={{ display: 'flex', alignItems: 'center', gap: '16px', marginRight: '24px', cursor: 'pointer' }}
          >
            <div style={{
              width: '52px',
              height: '52px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.12)'
            }}>
              🛡️
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
              <span style={{ fontSize: '28px', fontWeight: '700', color: '#000', letterSpacing: '-0.5px' }}>
                Autopilot
              </span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#666', letterSpacing: '2px' }}>
                AMERICA
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', fontSize: '14px' }}>
            <a href="/" style={{ color: '#6b7280', textDecoration: 'none' }}>How It Works</a>
            <a href="/" style={{ color: '#6b7280', textDecoration: 'none' }}>Pricing</a>
            <a href="/" style={{ color: '#6b7280', textDecoration: 'none' }}>Support</a>
          </div>
        </div>
      </header>

      <main style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '80px 32px' 
      }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            border: '1px solid #e5e7eb', 
            padding: '40px',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{
                fontSize: '30px',
                fontWeight: 'bold',
                color: '#111827',
                marginBottom: '16px',
                margin: '0 0 16px 0'
              }}>
                Never Get a Ticket Again
              </h1>
              
              {/* Free Features */}
              <div style={{ textAlign: 'left', marginBottom: '20px' }}>
                <p style={{ fontSize: '14px', color: '#059669', fontWeight: '600', marginBottom: '12px' }}>
                  ✓ FREE Alerts (Always Free):
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      backgroundColor: '#10b981',
                      borderRadius: '50%',
                      marginTop: '6px',
                      flexShrink: 0
                    }}></div>
                    <span style={{ fontSize: '14px', color: '#374151' }}>
                      Street cleaning alerts for your block
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      backgroundColor: '#10b981',
                      borderRadius: '50%',
                      marginTop: '6px',
                      flexShrink: 0
                    }}></div>
                    <span style={{ fontSize: '14px', color: '#374151' }}>
                      Snow removal notifications
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      backgroundColor: '#10b981',
                      borderRadius: '50%',
                      marginTop: '6px',
                      flexShrink: 0
                    }}></div>
                    <span style={{ fontSize: '14px', color: '#374151' }}>
                      Email, SMS, and phone alerts
                    </span>
                  </div>
                </div>
              </div>

              {/* Paid Features */}
              <div style={{
                backgroundColor: '#eff6ff',
                border: '2px solid #3b82f6',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '32px'
              }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#1e40af', marginBottom: '8px' }}>
                  🛡️ Ticket Protection ($10/mo or $100/year):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <span style={{ color: '#3b82f6', fontSize: '14px', flexShrink: 0 }}>•</span>
                    <span style={{ fontSize: '13px', color: '#1e40af' }}>
                      <strong>Guaranteed no more tickets</strong> for street cleaning, city stickers, or license plate stickers — or we will pay them
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <span style={{ color: '#3b82f6', fontSize: '14px', flexShrink: 0 }}>•</span>
                    <span style={{ fontSize: '13px', color: '#1e40af' }}>
                      No more worrying about renewals — we handle registration on your behalf
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Authentication Options */}
            <div style={{ marginBottom: '24px' }}>
              {/* Google Sign In Button - Primary Option */}
              <button
                onClick={handleGoogleAuth}
                disabled={loading}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '12px 16px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: loading && authMethod === 'google' ? '#f3f4f6' : 'white',
                  fontWeight: '500',
                  color: '#111827',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginBottom: '16px',
                  fontSize: '16px',
                  opacity: loading && authMethod !== 'google' ? 0.5 : 1
                }}
              >
                <svg style={{ width: '20px', height: '20px', marginRight: '12px' }} viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {loading && authMethod === 'google' ? 'Signing in...' : 'Continue with Google'}
              </button>

              <p style={{
                fontSize: '13px',
                color: '#6b7280',
                textAlign: 'center',
                lineHeight: '1.4',
                marginBottom: '0'
              }}>
                New users will be created automatically when you sign in with Google
              </p>

              {/* Divider */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                margin: '24px 0 20px 0',
                gap: '12px'
              }}>
                <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>or email me a login link</span>
                <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
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
                    padding: '12px 16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '15px',
                    backgroundColor: loading ? '#f9fafb' : 'white',
                    cursor: loading ? 'not-allowed' : 'text'
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
                  padding: '12px 16px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: loading && authMethod === 'magic-link' ? '#f3f4f6' : 'white',
                  color: '#374151',
                  fontWeight: '500',
                  cursor: loading || !email ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  opacity: !email ? 0.5 : 1,
                  marginBottom: '8px'
                }}
              >
                {loading && authMethod === 'magic-link' ? 'Sending link...' : 'Send Magic Link'}
              </button>

              <p style={{
                fontSize: '12px',
                color: '#9ca3af',
                textAlign: 'center',
                lineHeight: '1.4'
              }}>
                We'll email you a secure link - no password needed
              </p>

              {/* Advanced Options */}
              {passkeysSupported && (
                <div style={{ 
                  marginTop: '20px',
                  paddingTop: '20px',
                  borderTop: '1px solid #e5e7eb'
                }}>
                  <p style={{ 
                    fontSize: '12px', 
                    color: '#6b7280', 
                    marginBottom: '12px',
                    textAlign: 'center'
                  }}>
                    Advanced: Biometric sign-in
                  </p>
                  <button
                    onClick={handlePasskeyAuth}
                    disabled={loading}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '10px 16px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      backgroundColor: loading && authMethod === 'passkey' ? '#f3f4f6' : 'white',
                      fontWeight: '500',
                      color: '#6b7280',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      opacity: loading && authMethod !== 'passkey' ? 0.5 : 1
                    }}
                  >
                    <svg style={{ width: '16px', height: '16px', marginRight: '8px' }} viewBox="0 0 24 24" fill="none">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" fill="currentColor"/>
                    </svg>
                    {loading && authMethod === 'passkey' ? 'Authenticating...' : 'Sign in with Face ID / Touch ID'}
                  </button>
                </div>
              )}
            </div>

            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '12px', color: '#6b7280' }}>
                By continuing, you agree to our Terms of Service and Privacy Policy
              </p>
            </div>

            {message && (
              <div style={{
                marginTop: '16px',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '14px',
                backgroundColor: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
                color: message.type === 'success' ? '#166534' : '#dc2626'
              }}>
                {message.text}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}