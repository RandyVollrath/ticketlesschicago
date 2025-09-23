import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // First, check if there's an ongoing auth flow by checking URL fragments
        if (window.location.hash) {
          console.log('URL hash detected, waiting for auth to complete...')
          // Wait a moment for Supabase to process the auth
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
        
        const { data, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('Error during auth callback:', error)
          router.push('/?error=auth_failed')
          return
        }

        if (data.session) {
          // User is authenticated, now check if they have a paid subscription
          const user = data.session.user
          
          // Check if user exists in our database with subscription
          const { data: userProfile, error: profileError } = await supabase
            .from('users')
            .select('*')
            .eq('email', user.email)
            .single()

          if (userProfile) {
            // Option 2: Existing user - check subscription status
            console.log('Found existing user:', userProfile.email, 'subscription_status:', userProfile.subscription_status, 'stripe_customer_id:', userProfile.stripe_customer_id)
            
            // Check if they have an active subscription (you may need to adjust this logic based on your subscription field)
            const hasActiveSubscription = userProfile.subscription_status === 'active' || 
                                        userProfile.subscription_status === 'trialing' ||
                                        userProfile.subscription_status === 'paid' ||
                                        userProfile.stripe_customer_id // If they have a stripe customer ID, they've paid
            
            console.log('hasActiveSubscription:', hasActiveSubscription)
            
            if (hasActiveSubscription) {
              // Existing paid user - redirect to settings
              console.log('User has active subscription, redirecting to settings')
              router.push('/settings')
            } else {
              // Existing user but no subscription - redirect to signup flow
              console.log('User exists but no subscription, redirecting to signup')
              router.push(`/?email=${encodeURIComponent(user.email)}&step=signup`)
            }
          } else {
            // Option 1: New user - redirect to signup flow with pre-filled email
            console.log('New user, redirecting to signup flow')
            router.push(`/?email=${encodeURIComponent(user.email)}&step=signup`)
          }
        } else {
          // No session, redirect to home
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