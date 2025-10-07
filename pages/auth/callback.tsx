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
          // Wait a bit to ensure session is fully established
          console.log('Session found, waiting for it to be fully established...')
          await new Promise(resolve => setTimeout(resolve, 500))
          // User is authenticated
          const user = data.session.user
          console.log('User authenticated:', user.email, 'about to process profile data')
          
          // Check if there's form data to save from localStorage (from paid signup flow)
          const pendingFormData = localStorage.getItem('pendingSignupData');
          
          if (pendingFormData) {
            console.log('Found pending signup data from payment flow, saving profile...')
            try {
              const formData = JSON.parse(pendingFormData);
              
              // Only save if this was a paid signup (has billing plan)
              if (formData.billingPlan) {
                console.log('Paid signup detected, saving profile data');
                
                // Save the profile data
                const response = await fetch('/api/save-user-profile', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    userId: user.id,
                    formData: formData
                  })
                });
                
                const result = await response.json();
                
                if (result.success) {
                  console.log('✅ Profile data saved successfully');
                  localStorage.removeItem('pendingSignupData'); // Clean up
                } else {
                  console.error('❌ Failed to save profile data:', result.error);
                }
              } else {
                console.log('No billing plan detected, skipping profile creation');
                localStorage.removeItem('pendingSignupData'); // Clean up
              }
            } catch (error) {
              console.error('❌ Error processing signup data:', error);
              localStorage.removeItem('pendingSignupData'); // Clean up on error
            }
          }
          
          // Check for redirect parameter first, then admin users, then default to settings
          const redirectTo = new URLSearchParams(window.location.search).get('redirect');
          const adminEmails = ['randyvollrath@gmail.com', 'carenvollrath@gmail.com'];

          console.log('=== REDIRECT LOGIC ===')
          console.log('redirect param:', redirectTo)
          console.log('user email:', user.email)
          console.log('is admin:', adminEmails.includes(user.email || ''))

          if (redirectTo) {
            console.log('Redirecting to:', redirectTo);
            await router.push(redirectTo);
          } else if (adminEmails.includes(user.email || '')) {
            console.log('Admin user detected, redirecting to admin panel');
            await router.push('/admin/profile-updates');
          } else {
            console.log('Executing router.push("/settings")');
            await router.push('/settings');
          }
          console.log('router.push completed, current path:', window.location.pathname)
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