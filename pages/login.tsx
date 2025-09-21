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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) {
        throw error
      }
    } catch (error: any) {
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
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>Login - Ticketless Chicago</title>
      </Head>

      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 
              className="text-2xl font-bold text-gray-900 cursor-pointer"
              onClick={() => router.push('/')}
            >
              Ticketless Chicago
            </h1>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/')}
                className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm"
              >
                Home
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-sm mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-semibold text-gray-900 mb-3">
            {fromSignup ? 'Welcome to Ticketless' : 'Sign in to Ticketless'}
          </h1>
          <p className="text-gray-500 text-sm">
            {fromSignup 
              ? 'Your account is ready. Choose how to continue.'
              : 'Access your vehicle protection dashboard'
            }
          </p>
        </div>

        {/* Primary Google Sign In Button */}
        <button
          onClick={handleGoogleAuth}
          className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md shadow-sm bg-white text-gray-700 hover:bg-gray-50 font-medium mb-4 transition-colors"
        >
          <svg className="w-4 h-4 mr-3" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        {!fromSignup && (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-white text-gray-400">or</span>
              </div>
            </div>

            {/* Email Option - Minimal */}
            <form onSubmit={handleEmailAuth}>
              <div className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors"
                >
                  {loading ? 'Sending...' : 'Continue with Email'}
                </button>
              </div>
            </form>
          </>
        )}

        {message && (
          <div className={`mt-4 p-3 rounded-md text-sm ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-700' 
              : 'bg-red-50 text-red-700'
          }`}>
            {message.text}
          </div>
        )}

        {fromSignup && (
          <div className="mt-6 p-4 bg-blue-50 rounded-md">
            <p className="text-sm text-blue-700 text-center">
              ✨ <strong>Pro tip:</strong> Use Google for the fastest access
            </p>
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500">
            Need help?{' '}
            <a href="mailto:ticketlesschicago@gmail.com" className="text-blue-600 hover:text-blue-700">
              Contact support
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}