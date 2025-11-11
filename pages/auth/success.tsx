import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../../lib/supabase'

export default function AuthSuccess() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const handleAuthSuccess = async () => {
      try {
        // Get the session ID from URL params (passed from Stripe success redirect)
        const { session_id, email } = router.query

        if (!session_id || !email) {
          throw new Error('Missing session information')
        }

        // Check if user is already logged in
        const { data: { session } } = await supabase.auth.getSession()

        if (session) {
          // User is already logged in, redirect directly to settings
          console.log('User already logged in, redirecting to settings')
          window.location.href = '/settings'
          return
        }

        // Modern approach: Direct Google OAuth instead of magic links
        console.log('Payment successful, initiating modern OAuth flow for:', email)

        // Track conversion with Rewardful client-side (backup for webhook)
        if ((window as any).rewardful && typeof email === 'string') {
          console.log('Tracking Rewardful conversion for:', email);
          (window as any).rewardful('convert', { email: email });
        }

        // Show success message and instructions
        setLoading(false)

      } catch (error: any) {
        console.error('Error during auth success:', error)
        setError(error.message)
        setLoading(false)

        // Fallback: redirect to settings if there's a session, otherwise login
        const { data: { session } } = await supabase.auth.getSession()
        setTimeout(() => {
          if (session) {
            window.location.href = '/settings'
          } else {
            router.push('/login')
          }
        }, 3000)
      }
    }

    if (router.isReady) {
      handleAuthSuccess()
    }
  }, [router])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Payment Successful - Autopilot America</title>
      </Head>

      {/* Professional header */}
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
            <span style={{ color: '#10b981' }}>✓ Payment Confirmed</span>
          </div>
        </div>
      </header>

      <main style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '80px 32px' 
      }}>
        <div style={{ width: '100%', maxWidth: '480px' }}>
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            border: '1px solid #e5e7eb', 
            padding: '48px',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
          }}>
            {loading ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  border: '3px solid #e5e7eb',
                  borderTop: '3px solid #3b82f6',
                  borderRadius: '50%',
                  margin: '0 auto 24px',
                  animation: 'spin 1s linear infinite'
                }}></div>
                <h2 style={{ 
                  fontSize: '24px', 
                  fontWeight: 'bold', 
                  color: '#111827',
                  marginBottom: '12px'
                }}>Setting up your account...</h2>
                <p style={{ fontSize: '16px', color: '#6b7280' }}>
                  Please wait while we complete your registration.
                </p>
              </div>
            ) : error ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ 
                  width: '64px', 
                  height: '64px', 
                  backgroundColor: '#fee2e2',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 24px',
                  fontSize: '32px'
                }}>⚠️</div>
                <h2 style={{ 
                  fontSize: '24px', 
                  fontWeight: 'bold', 
                  color: '#111827',
                  marginBottom: '12px'
                }}>Something went wrong</h2>
                <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '16px' }}>
                  {error}
                </p>
                <p style={{ fontSize: '14px', color: '#9ca3af' }}>
                  Redirecting to login page...
                </p>
              </div>
            ) : (
              <>
                {/* Success icon */}
                <div style={{ 
                  width: '80px', 
                  height: '80px', 
                  backgroundColor: '#d1fae5',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 32px'
                }}>
                  <svg style={{ width: '40px', height: '40px', color: '#10b981' }} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>

                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <h1 style={{ 
                    fontSize: '36px', 
                    fontWeight: 'bold', 
                    color: '#111827',
                    marginBottom: '8px'
                  }}>🎉 Welcome to Ticketless!</h1>
                  
                  <p style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    color: '#10b981',
                    marginBottom: '16px'
                  }}>
                    You're officially protected from street cleaning violations!
                  </p>
                  
                  <p style={{ 
                    fontSize: '16px', 
                    color: '#6b7280',
                    lineHeight: '1.6'
                  }}>
                    Your payment was successful and your account has been created. 
                    Sign in below to access your dashboard and get alerts for street cleaning, snow removal, and renewal deadlines.
                  </p>
                </div>

                {/* Celebration banner */}
                <div style={{ 
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  borderRadius: '12px',
                  padding: '24px',
                  marginBottom: '32px',
                  color: 'white',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>🚗💚✨</div>
                  <h3 style={{ 
                    fontSize: '18px', 
                    fontWeight: '700',
                    marginBottom: '8px',
                    margin: '0 0 8px 0'
                  }}>You're All Set!</h3>
                  <p style={{ fontSize: '14px', opacity: '0.9', margin: '0' }}>
                    Never miss street cleaning, snow removal alerts, or renewal deadlines again
                  </p>
                </div>

                {/* Next steps card */}
                <div style={{ 
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: '32px'
                }}>
                  <h3 style={{ 
                    fontSize: '16px', 
                    fontWeight: '700',
                    color: '#1e293b',
                    marginBottom: '16px',
                    margin: '0 0 16px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    🚀 What's Next
                  </h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        backgroundColor: '#3b82f6',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '12px',
                        fontWeight: '600',
                        flexShrink: 0,
                        marginTop: '2px'
                      }}>1</div>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: '600', color: '#1e293b', marginBottom: '4px' }}>
                          Sign in with Google
                        </div>
                        <div style={{ fontSize: '13px', color: '#64748b' }}>
                          Access your personalized dashboard
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        backgroundColor: '#10b981',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '12px',
                        fontWeight: '600',
                        flexShrink: 0,
                        marginTop: '2px'
                      }}>2</div>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: '600', color: '#1e293b', marginBottom: '4px' }}>
                          Review your vehicle info
                        </div>
                        <div style={{ fontSize: '13px', color: '#64748b' }}>
                          We've saved all your details - just verify they're correct
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        backgroundColor: '#f59e0b',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '12px',
                        fontWeight: '600',
                        flexShrink: 0,
                        marginTop: '2px'
                      }}>3</div>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: '600', color: '#1e293b', marginBottom: '4px' }}>
                          Receive your first alert
                        </div>
                        <div style={{ fontSize: '13px', color: '#64748b' }}>
                          Get alerts for street cleaning, snow removal, and renewals
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Sign in buttons */}
                <button
                  onClick={async () => {
                    const { error } = await supabase.auth.signInWithOAuth({
                      provider: 'google',
                      options: {
                        redirectTo: `${window.location.origin}/auth/callback`
                      }
                    });
                    if (error) {
                      console.error('OAuth error:', error);
                    }
                  }}
                  style={{
                    width: '100%',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    padding: '14px 24px',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    border: 'none',
                    cursor: 'pointer',
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    transition: 'background-color 0.15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
                >
                  <svg style={{ width: '20px', height: '20px' }} viewBox="0 0 24 24">
                    <path fill="white" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="white" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="white" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="white" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>
                
                <button
                  onClick={() => router.push('/login?from=signup')}
                  style={{
                    width: '100%',
                    backgroundColor: '#f3f4f6',
                    color: '#374151',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '500',
                    border: '1px solid #e5e7eb',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                >
                  Use Email Instead
                </button>

                {/* Support link */}
                <p style={{ 
                  textAlign: 'center',
                  marginTop: '24px',
                  fontSize: '14px',
                  color: '#6b7280'
                }}>
                  Need help? <a href="/support" style={{ color: '#3b82f6', textDecoration: 'none' }}>Contact support</a>
                </p>
              </>
            )}
          </div>
        </div>
      </main>

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}