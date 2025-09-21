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
        router.push('/dashboard')
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
          redirectTo: `${window.location.origin}/dashboard`
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
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <Head>
        <title>Login - Ticketless Chicago</title>
      </Head>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16">
        <div className="text-center mb-8">
          <h1 className="text-5xl mb-4">🚗 Ticketless Chicago</h1>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Never Get Another Chicago Ticket
          </h2>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="lg:grid lg:grid-cols-2">
            {/* Left side - Benefits */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-8 lg:p-10 text-white">
              <div className="mb-6">
                <h3 className="text-2xl font-bold mb-6">
                  🎉 Never Get Another Compliance Ticket
                </h3>
                <p className="text-blue-100 mb-6">Your account includes:</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-start">
                  <span className="text-xl mr-3">📧</span>
                  <div>
                    <p className="font-semibold">Email & SMS alerts before renewals</p>
                    <p className="text-blue-100 text-sm">City stickers, plates, emissions</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <span className="text-xl mr-3">📅</span>
                  <div>
                    <p className="font-semibold">Calendar reminders so you never forget</p>
                    <p className="text-blue-100 text-sm">Sync with Google, Apple, Outlook</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <span className="text-xl mr-3">💰</span>
                  <div>
                    <p className="font-semibold">Save hundreds on tickets</p>
                    <p className="text-blue-100 text-sm">City stickers alone are $200+ in fines</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <span className="text-xl mr-3">🛡️</span>
                  <div>
                    <p className="font-semibold">Ticket guarantee</p>
                    <p className="text-blue-100 text-sm">We reimburse compliance tickets*</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 p-4 bg-blue-800/30 rounded-lg">
                <p className="text-sm font-semibold mb-2">
                  💎 Pro Features ($12/mo):
                </p>
                <p className="text-sm text-blue-100">
                  Auto-renewal handling + Phone call alerts + Track unlimited vehicles + Full ticket protection
                </p>
              </div>
            </div>

            {/* Right side - Login */}
            <div className="p-8 lg:p-10">
              <div className="mb-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  {fromSignup ? 'Welcome! Access Your Account' : 'Sign In'}
                </h3>
                <p className="text-gray-600">
                  {fromSignup 
                    ? 'Your protection is active. Sign in to manage your vehicles.'
                    : 'Access your vehicle protection dashboard'
                  }
                </p>
              </div>

              {/* Google Sign In Button */}
              <button
                onClick={handleGoogleAuth}
                className="w-full flex items-center justify-center px-6 py-3 border-2 border-gray-300 rounded-lg bg-white hover:bg-gray-50 font-medium text-gray-900 transition-all hover:shadow-md"
              >
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
              </button>

              <div className="mt-6 space-y-3">
                <div className="flex items-center text-sm text-gray-600">
                  <svg className="w-4 h-4 mr-2 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span><strong>Secure:</strong> Login directly with Google - no passwords needed</span>
                </div>
                <div className="flex items-center text-sm text-gray-600">
                  <svg className="w-4 h-4 mr-2 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span><strong>Private:</strong> We only store your email and vehicle info</span>
                </div>
              </div>

              {message && (
                <div className={`mt-6 p-4 rounded-lg text-sm ${
                  message.type === 'success' 
                    ? 'bg-green-50 text-green-700 border border-green-200' 
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {message.text}
                </div>
              )}

              <div className="mt-8 pt-8 border-t border-gray-200">
                <p className="text-center text-sm text-gray-600">
                  Need help? Email{' '}
                  <a href="mailto:ticketlesschicago@gmail.com" className="text-blue-600 hover:text-blue-700 font-medium">
                    ticketlesschicago@gmail.com
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <a 
            href="/"
            className="text-gray-600 hover:text-gray-900 text-sm font-medium"
          >
            ← Back to Homepage
          </a>
        </div>
      </main>
    </div>
  )
}