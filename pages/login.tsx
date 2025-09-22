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
    <div className="min-h-screen bg-gray-50">
      <Head>
        <title>Login - Ticketless Chicago</title>
      </Head>

      {/* Simple header */}
      <header className="px-6 py-4">
        <div className="flex justify-between items-center max-w-6xl mx-auto">
          <div className="text-xl font-semibold text-gray-900">Ticketless</div>
          <div className="flex items-center space-x-6 text-sm">
            <a href="/" className="text-gray-600 hover:text-gray-900">How It Works</a>
            <a href="/" className="text-gray-600 hover:text-gray-900">Pricing</a>
            <a href="/" className="text-gray-600 hover:text-gray-900">Support</a>
          </div>
        </div>
      </header>

      <main className="flex items-center justify-center px-6 py-20">
        <div className="w-full max-w-md">
          {/* Clean card design */}
          <div className="bg-white rounded-lg border border-gray-200 p-8 shadow-sm">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">
                Never Get a $60 Ticket Again
              </h1>
              
              <div className="space-y-3 text-left mt-6 mb-8">
                <div className="text-sm text-gray-600">Your free account includes:</div>
                
                <div className="flex items-start space-x-3">
                  <span className="text-base">📧</span>
                  <span className="text-sm text-gray-900">Free email alerts before street cleaning</span>
                </div>
                
                <div className="flex items-start space-x-3">
                  <span className="text-base">📅</span>
                  <span className="text-sm text-gray-900">Calendar reminders so you never forget</span>
                </div>
                
                <div className="flex items-start space-x-3">
                  <span className="text-base">💰</span>
                  <span className="text-sm text-gray-900">Help avoid $60 tickets with timely reminders</span>
                </div>
                
                <div className="flex items-start space-x-3">
                  <span className="text-base">🛡️</span>
                  <span className="text-sm text-gray-900">Ticket guarantee – we reimburse your first $60 ticket</span>
                </div>
              </div>

              <div className="bg-blue-50 rounded-lg p-4 mb-6">
                <div className="text-sm font-medium text-blue-900 mb-1">
                  💎 Upgrade to Pro ($12/mo):
                </div>
                <div className="text-sm text-blue-800">
                  SMS + phone alerts + track 5 addresses + enhanced guarantee
                </div>
              </div>
            </div>

            {/* Google Sign In Button */}
            <button
              onClick={handleGoogleAuth}
              className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 font-medium text-gray-900 transition-colors mb-6"
            >
              <svg className="w-4 h-4 mr-3" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            <div className="space-y-2 text-center">
              <div className="flex items-center text-xs text-gray-600">
                <svg className="w-3 h-3 mr-2 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span><strong>Secure:</strong> Login directly with Google - no third-party redirects</span>
              </div>
              <div className="flex items-center text-xs text-gray-600">
                <svg className="w-3 h-3 mr-2 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span><strong>Private:</strong> We only store your email and preferences</span>
              </div>
            </div>

            {message && (
              <div className={`mt-4 p-3 rounded-lg text-sm ${
                message.type === 'success' 
                  ? 'bg-green-50 text-green-700' 
                  : 'bg-red-50 text-red-700'
              }`}>
                {message.text}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}