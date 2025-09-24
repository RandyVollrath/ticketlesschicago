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

        // Modern approach: Direct Google OAuth instead of magic links
        console.log('Payment successful, initiating modern OAuth flow for:', email)

        // Show success message and instructions
        setLoading(false)

      } catch (error: any) {
        console.error('Error during auth success:', error)
        setError(error.message)
        setLoading(false)
        
        // Fallback: redirect to login page after delay
        setTimeout(() => {
          router.push('/login')
        }, 3000)
      }
    }

    if (router.isReady) {
      handleAuthSuccess()
    }
  }, [router])

  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>Welcome to Ticketless Chicago</title>
      </Head>

      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm p-8 text-center">
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Setting up your account...</h2>
              <p className="text-gray-600">Please wait while we complete your registration.</p>
            </>
          ) : error ? (
            <>
              <div className="text-red-500 text-4xl mb-4">⚠️</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Something went wrong</h2>
              <p className="text-gray-600 mb-4">{error}</p>
              <p className="text-sm text-gray-500">Redirecting to login page...</p>
            </>
          ) : (
            <>
              <div className="text-green-500 text-4xl mb-4">🎉</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Payment Successful!</h2>
              
              <p className="text-gray-600 mb-4">
                Your account has been created! Click below to sign in with Google and access your dashboard.
              </p>
              <div className="bg-blue-50 p-4 rounded-lg mb-4">
                <p className="text-sm text-blue-800">
                  🚀 <strong>One-click sign in</strong> - Use the same Google account you used for payment.
                </p>
              </div>
              
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
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-medium mb-3"
              >
                Sign In with Google
              </button>
              
              <button
                onClick={() => router.push('/login?from=signup')}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium text-sm"
              >
                Use Email/Password Instead
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}