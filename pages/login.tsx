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

      <main className="flex items-center justify-center px-8 py-16">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-3xl border border-gray-100 p-10 shadow-sm">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-3">
                Stay Compliant.<br/>Avoid Tickets.
              </h1>
              <p className="text-gray-600 leading-relaxed">
                Vehicle registration, city stickers, emissions tests, and street cleaning—all tracked automatically.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-4 mb-8">
              <div className="flex items-center space-x-3 text-sm">
                <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></div>
                <span className="text-gray-700">Automatic renewal reminders for all vehicle requirements</span>
              </div>
              
              <div className="flex items-center space-x-3 text-sm">
                <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                <span className="text-gray-700">Email, SMS, and phone alerts before deadlines</span>
              </div>
              
              <div className="flex items-center space-x-3 text-sm">
                <div className="w-2 h-2 bg-purple-500 rounded-full flex-shrink-0"></div>
                <span className="text-gray-700">$60 ticket guarantee if our system fails</span>
              </div>

              <div className="flex items-center space-x-3 text-sm">
                <div className="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0"></div>
                <span className="text-gray-700">Street cleaning notifications for Chicago</span>
              </div>
            </div>

            {/* Pro upgrade callout */}
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-2xl p-4 mb-8 border">
              <div className="text-center">
                <p className="text-sm font-medium text-gray-900 mb-1">
                  ✨ Pro ($12/mo): Full-service renewals + enhanced guarantee
                </p>
                <p className="text-xs text-gray-600">
                  We handle the paperwork, you stay compliant
                </p>
              </div>
            </div>

            {/* Sign In Button */}
            <button
              onClick={handleGoogleAuth}
              className="w-full flex items-center justify-center px-6 py-4 bg-gray-900 text-white rounded-2xl hover:bg-gray-800 font-medium transition-all duration-200"
            >
              <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            <div className="text-center mt-6 space-y-2">
              <p className="text-xs text-gray-500">
                By continuing, you agree to our Terms and Privacy Policy
              </p>
              <div className="flex items-center justify-center space-x-4 text-xs text-gray-400">
                <span>🔒 Secure</span>
                <span>🚫 No spam</span>
                <span>📧 Email only</span>
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
        </div>
      </main>
    </div>
  )
}