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
    <div className="min-h-screen bg-white">
      <Head>
        <title>Sign In - Ticketless Chicago</title>
      </Head>

      {/* Clean header */}
      <header className="border-b border-gray-100">
        <div className="flex justify-between items-center max-w-6xl mx-auto px-8 py-6">
          <div className="text-2xl font-bold text-black">Ticketless</div>
          <div className="flex items-center space-x-8 text-sm">
            <a href="/" className="text-gray-500 hover:text-black transition-colors">How It Works</a>
            <a href="/" className="text-gray-500 hover:text-black transition-colors">Pricing</a>
            <a href="/" className="text-gray-500 hover:text-black transition-colors">Support</a>
          </div>
        </div>
      </header>

      <main className="flex items-center justify-center px-8 py-20">
        <div className="w-full max-w-lg">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-black mb-4">
              Never Get a $60 Ticket Again
            </h1>
            <p className="text-xl text-gray-600">
              Join thousands avoiding street cleaning tickets with smart reminders
            </p>
          </div>

          {/* Benefits */}
          <div className="mb-12">
            <div className="text-center mb-8">
              <span className="inline-block bg-gray-100 text-gray-700 px-4 py-2 rounded-full text-sm font-medium">
                Free Account Includes
              </span>
            </div>
            
            <div className="grid gap-6">
              <div className="flex items-start space-x-4">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <span className="text-lg">📧</span>
                </div>
                <div>
                  <h3 className="font-semibold text-black">Email Alerts</h3>
                  <p className="text-gray-600 text-sm">Get notified before street cleaning in your area</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4">
                <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                  <span className="text-lg">📅</span>
                </div>
                <div>
                  <h3 className="font-semibold text-black">Calendar Reminders</h3>
                  <p className="text-gray-600 text-sm">Never forget with automated calendar events</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4">
                <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                  <span className="text-lg">🛡️</span>
                </div>
                <div>
                  <h3 className="font-semibold text-black">Ticket Guarantee</h3>
                  <p className="text-gray-600 text-sm">We'll reimburse your first $60 ticket if our system fails</p>
                </div>
              </div>
            </div>

            <div className="mt-8 p-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl border border-blue-200">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-900 mb-2">
                  💎 Upgrade to Pro ($12/month)
                </div>
                <p className="text-blue-800 text-sm">
                  SMS alerts • Phone calls • Track 5 addresses • Enhanced guarantee
                </p>
              </div>
            </div>
          </div>

          {/* Sign In */}
          <div className="space-y-6">
            <button
              onClick={handleGoogleAuth}
              className="w-full flex items-center justify-center px-6 py-4 bg-black text-white rounded-xl hover:bg-gray-800 font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            <div className="text-center space-y-2">
              <p className="text-xs text-gray-500">
                By signing in, you agree to our Terms of Service and Privacy Policy
              </p>
              <div className="flex items-center justify-center space-x-6 text-xs text-gray-400">
                <span className="flex items-center">
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Secure Google OAuth
                </span>
                <span className="flex items-center">
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                  </svg>
                  Privacy Protected
                </span>
              </div>
            </div>
          </div>

          {message && (
            <div className={`mt-6 p-4 rounded-xl border ${
              message.type === 'success' 
                ? 'bg-green-50 text-green-700 border-green-200' 
                : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {message.text}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}