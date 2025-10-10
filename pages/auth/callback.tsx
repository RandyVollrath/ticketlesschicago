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
        console.log('URL search:', window.location.search)

        // Check for error in URL first
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const searchParams = new URLSearchParams(window.location.search);
        const errorParam = hashParams.get('error') || searchParams.get('error');
        const errorDescription = hashParams.get('error_description') || searchParams.get('error_description');

        if (errorParam) {
          console.error('Auth error in URL:', errorParam, errorDescription);
          router.push(`/login?error=${encodeURIComponent(errorDescription || errorParam)}`);
          return;
        }

        // First, check if there's an ongoing auth flow by checking URL fragments
        if (window.location.hash) {
          console.log('URL hash detected, waiting for auth to complete...')
          // Wait longer for Supabase to process the auth
          await new Promise(resolve => setTimeout(resolve, 2000))
        }

        const { data, error } = await supabase.auth.getSession()
        console.log('Session check result:', {
          hasSession: !!data.session,
          userId: data.session?.user?.id,
          email: data.session?.user?.email,
          error
        })

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

          // Check if this is a Google signup flow where we need to validate email
          const isGoogleSignupFlow = new URLSearchParams(window.location.search).get('flow') === 'google-signup';

          if (isGoogleSignupFlow) {
            const expectedEmail = sessionStorage.getItem('expectedGoogleEmail');
            console.log('Google signup flow - expected email:', expectedEmail, 'actual email:', user.email);

            if (expectedEmail && user.email !== expectedEmail) {
              console.error('❌ Email mismatch! Form email:', expectedEmail, 'Google email:', user.email);
              sessionStorage.removeItem('expectedGoogleEmail');
              router.push(`/login?error=${encodeURIComponent(`You signed in with ${user.email} but created an account with ${expectedEmail}. Please check your email (${expectedEmail}) for a magic link to access your account.`)}`);
              return;
            }

            // Email matches, clean up and proceed
            sessionStorage.removeItem('expectedGoogleEmail');
            console.log('✅ Email matches, proceeding...');
          }

          // Check if this is a free signup flow (even if data was lost)
          const isFreeSignupFlow = new URLSearchParams(window.location.search).get('flow') === 'free-signup';

          // Check for pending signup data - try database first (most reliable), then sessionStorage/localStorage
          let pendingFreeSignup = null;
          let formData = null;

          // Try database first
          if (isFreeSignupFlow || user.email) {
            console.log('Checking database for pending signup data...');
            try {
              const dbResponse = await fetch(`/api/pending-signup/get?email=${encodeURIComponent(user.email || '')}`);
              if (dbResponse.ok) {
                const result = await dbResponse.json();
                if (result.success && result.data) {
                  console.log('✅ Found pending signup in database');
                  formData = {
                    firstName: result.data.first_name,
                    lastName: result.data.last_name,
                    email: result.data.email,
                    phone: result.data.phone,
                    licensePlate: result.data.license_plate,
                    address: result.data.address,
                    zip: result.data.zip,
                    vin: result.data.vin,
                    make: result.data.make,
                    model: result.data.model,
                    citySticker: result.data.city_sticker,
                    token: result.data.token
                  };
                  pendingFreeSignup = 'from-database';
                }
              }
            } catch (error) {
              console.error('Error checking database for pending signup:', error);
            }
          }

          // Fallback to sessionStorage/localStorage if database didn't have it
          if (!pendingFreeSignup) {
            console.log('No data in database, checking sessionStorage...');
            pendingFreeSignup = sessionStorage.getItem('pendingFreeSignup');
          }

          if (!pendingFreeSignup) {
            console.log('No data in sessionStorage, checking localStorage...');
            pendingFreeSignup = localStorage.getItem('pendingFreeSignup');
          }

          if (pendingFreeSignup && pendingFreeSignup !== 'from-database') {
            formData = JSON.parse(pendingFreeSignup);
          }

          if (formData) {
            console.log('Found pending free signup data, creating account...')
            console.log('Signup data source:', pendingFreeSignup === 'from-database' ? 'database' : 'storage')
            try {
              // IMPORTANT: Use the authenticated user's email, not the form email
              // This ensures Google OAuth users get their Google email saved
              formData.email = user.email;

              console.log('Creating free account with email:', user.email);

              // Create the free account with the form data
              const response = await fetch('/api/alerts/create', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
              });

              const result = await response.json();

              if (result.success) {
                console.log('✅ Free account created successfully');

                // Clean up pending signup from all sources
                sessionStorage.removeItem('pendingFreeSignup');
                localStorage.removeItem('pendingFreeSignup');

                // Delete from database
                try {
                  await fetch(`/api/pending-signup/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: user.email })
                  });
                  console.log('✅ Cleaned up pending signup from database');
                } catch (error) {
                  console.error('Failed to delete pending signup:', error);
                }

                // Wait a moment to ensure database write completes
                await new Promise(resolve => setTimeout(resolve, 1000));
                // Redirect to success page
                router.push('/alerts/success');
                return;
              } else {
                console.error('❌ Failed to create free account:', result.error);
                router.push('/alerts/signup?error=signup_failed');
                return;
              }
            } catch (error) {
              console.error('❌ Error processing free signup:', error);
              sessionStorage.removeItem('pendingFreeSignup'); // Clean up on error
              router.push('/alerts/signup?error=signup_failed');
              return;
            }
          } else if (isFreeSignupFlow) {
            // Free signup flow but no data found - sessionStorage was cleared
            console.error('❌ Free signup flow detected but no form data found');
            sessionStorage.removeItem('pendingFreeSignup');
            localStorage.removeItem('pendingFreeSignup');
            router.push('/alerts/signup?error=data_lost');
            return;
          }

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