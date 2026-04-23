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
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827' }}>Autopilot America</div>
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
                  }}>Welcome to Autopilot America!</h1>
                  
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
                  <div style={{ marginBottom: '8px' }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
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

                {/* Check-your-email card */}
                <div style={{
                  backgroundColor: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  borderRadius: '12px',
                  padding: '24px',
                  marginBottom: '24px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>📬</div>
                  <h3 style={{
                    fontSize: '18px',
                    fontWeight: '700',
                    color: '#1E3A8A',
                    margin: '0 0 8px 0',
                  }}>
                    Check your email
                  </h3>
                  <p style={{ fontSize: '14px', color: '#1E40AF', margin: 0, lineHeight: 1.5 }}>
                    We just sent you a one-tap sign-in link. Tap it on your phone to open the app — or on your laptop to open the web dashboard.
                  </p>
                </div>

                {/* App store buttons */}
                <div style={{ marginBottom: '28px' }}>
                  <p style={{ fontSize: '13px', color: '#6B7280', textAlign: 'center', margin: '0 0 12px 0', fontWeight: 500 }}>
                    Don&apos;t have the app yet? Install it first:
                  </p>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <a
                      href="https://apps.apple.com/us/app/autopilot-america/id6758504333"
                      style={{
                        flex: '1 1 180px',
                        backgroundColor: '#000',
                        color: '#fff',
                        padding: '12px 16px',
                        borderRadius: '8px',
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        fontWeight: 600,
                        fontSize: '14px',
                      }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 12.536a4.51 4.51 0 012.152-3.784 4.62 4.62 0 00-3.634-1.965c-1.529-.16-2.993.915-3.76.915-.792 0-1.968-.9-3.24-.876a4.839 4.839 0 00-4.072 2.481c-1.754 3.036-.446 7.492 1.234 9.942.84 1.2 1.823 2.54 3.113 2.493 1.254-.053 1.727-.8 3.241-.8 1.505 0 1.944.8 3.264.77 1.35-.022 2.203-1.22 3.02-2.43.649-.856 1.144-1.801 1.478-2.805a4.364 4.364 0 01-2.796-3.941zm-2.47-7.22a4.449 4.449 0 001.02-3.22 4.566 4.566 0 00-2.952 1.524 4.253 4.253 0 00-1.044 3.094 3.773 3.773 0 002.976-1.398z"/></svg>
                      App Store
                    </a>
                    <a
                      href="https://play.google.com/store/apps/details?id=fyi.ticketless.app"
                      style={{
                        flex: '1 1 180px',
                        backgroundColor: '#000',
                        color: '#fff',
                        padding: '12px 16px',
                        borderRadius: '8px',
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        fontWeight: 600,
                        fontSize: '14px',
                      }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24"><path fill="#EA4335" d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92z"/><path fill="#FBBC04" d="M16.81 15.019l-2.71-1.566 2.268-2.268 2.71 1.566c1.065.615 1.065 1.653 0 2.268z"/><path fill="#4285F4" d="M13.792 12L3.61 1.814a1 1 0 011.228.086l11.972 6.91L13.792 12z"/><path fill="#34A853" d="M13.792 12l3.018 3.19-11.972 6.91a1 1 0 01-1.228.086L13.792 12z"/></svg>
                      Google Play
                    </a>
                  </div>
                </div>

                {/* Didn't get the email fallback */}
                <div style={{
                  backgroundColor: '#F9FAFB',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  marginBottom: '8px',
                  fontSize: '13px',
                  color: '#4B5563',
                  textAlign: 'center',
                  lineHeight: 1.6,
                }}>
                  Didn&apos;t get the email? Check spam, or{' '}
                  <a href="/login?from=signup" style={{ color: '#2563EB', fontWeight: 600 }}>
                    sign in manually
                  </a>.
                </div>

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