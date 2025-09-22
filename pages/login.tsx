import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
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
  }, [router])

  const handleGoogleAuth = async () => {
    try {
      console.log('Starting Google OAuth...')
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/settings`
        }
      })

      console.log('OAuth response:', { data, error })

      if (error) {
        console.error('OAuth error:', error)
        throw error
      }
    } catch (error: any) {
      console.error('Google auth failed:', error)
      setMessage({
        type: 'error',
        text: error.message || 'An error occurred with Google sign in'
      })
    }
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email: email,
          password: password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`
          }
        })

        if (error) {
          throw error
        }

        setMessage({
          type: 'success',
          text: 'Check your email to verify your account!'
        })
      } else {
        // For existing users, send magic link (since they may not have passwords)
        const { error } = await supabase.auth.signInWithOtp({
          email: email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`
          }
        })

        if (error) {
          throw error
        }

        setMessage({
          type: 'success',
          text: 'Check your email for the login link!'
        })
      }
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'An error occurred during authentication'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Sign In - Ticketless America</title>
      </Head>

      {/* Clean header */}
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          maxWidth: '1200px', 
          margin: '0 auto', 
          padding: '24px 32px' 
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827' }}>Ticketless</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '32px', fontSize: '14px' }}>
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
                Never Miss Street Cleaning Again
              </h1>
              
              <div style={{ textAlign: 'left', marginBottom: '32px' }}>
                <p style={{ fontSize: '14px', color: '#6b7280', fontWeight: '500', marginBottom: '12px' }}>
                  Alerts for Street Cleaning and Snow Removal on your block:
                </p>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ 
                      width: '8px', 
                      height: '8px', 
                      backgroundColor: '#3b82f6', 
                      borderRadius: '50%', 
                      marginTop: '8px',
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
                      marginTop: '8px',
                      flexShrink: 0
                    }}></div>
                    <span style={{ fontSize: '14px', color: '#374151' }}>
                      Snow removal notifications for your area
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ 
                      width: '8px', 
                      height: '8px', 
                      backgroundColor: '#8b5cf6', 
                      borderRadius: '50%', 
                      marginTop: '8px',
                      flexShrink: 0
                    }}></div>
                    <span style={{ fontSize: '14px', color: '#374151' }}>
                      We pay 80% of tickets you receive, up to $200/year
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ 
                      width: '8px', 
                      height: '8px', 
                      backgroundColor: '#f59e0b', 
                      borderRadius: '50%', 
                      marginTop: '8px',
                      flexShrink: 0
                    }}></div>
                    <span style={{ fontSize: '14px', color: '#374151' }}>
                      Email and SMS alerts to keep you informed
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ 
                backgroundColor: '#eff6ff', 
                border: '1px solid #bfdbfe', 
                borderRadius: '12px', 
                padding: '16px', 
                marginBottom: '32px' 
              }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#1e40af', marginBottom: '4px' }}>
                  Plus: City Sticker & License Renewal Service
                </div>
                <div style={{ fontSize: '14px', color: '#1e40af' }}>
                  We handle renewals for you + up to $200/year ticket coverage
                </div>
              </div>
            </div>

            {/* Google Sign In Button */}
            <button
              onClick={handleGoogleAuth}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px 16px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                backgroundColor: 'white',
                fontWeight: '500',
                color: '#111827',
                cursor: 'pointer',
                marginBottom: '24px',
                fontSize: '16px'
              }}
            >
              <svg style={{ width: '20px', height: '20px', marginRight: '12px' }} viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

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