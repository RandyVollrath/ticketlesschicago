import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        console.log('Auth callback started')
        console.log('Current URL:', window.location.href)
        console.log('URL hash:', window.location.hash)
        
        // First, check if there's an ongoing auth flow by checking URL fragments
        if (window.location.hash) {
          console.log('URL hash detected, waiting for auth to complete...')
          // Wait a moment for Supabase to process the auth
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
        
        const { data, error } = await supabase.auth.getSession()
        console.log('Session check result:', { session: !!data.session, error })
        
        if (error) {
          console.error('Error during auth callback:', error)
          router.push('/?error=auth_failed')
          return
        }

        if (data.session) {
          // User is authenticated - for now, just redirect all authenticated users to settings
          const user = data.session.user
          console.log('User authenticated:', user.email, 'about to redirect to settings')
          
          // Always redirect authenticated users to settings page
          // (The settings page will handle creating profile if needed)
          console.log('Executing router.push("/settings")')
          router.push('/settings')
          console.log('router.push executed')
        } else {
          // No session, redirect to home
          console.log('No session found, redirecting to home')
          router.push('/')
        }
      } catch (error) {
        console.error('Auth callback error:', error)
        router.push('/?error=auth_failed')
      }
    }

    handleAuthCallback()
  }, [router])

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Completing sign up...</h2>
        <p className="text-gray-600">Please wait while we verify your account.</p>
      </div>
    </div>
  )
}