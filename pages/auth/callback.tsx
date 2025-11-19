import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { createBrowserSupabaseClient } from '@supabase/auth-helpers-nextjs'

// Callback page loads when OAuth completes

export default function AuthCallback() {
  const router = useRouter()
  const [supabaseClient] = useState(() => createBrowserSupabaseClient())

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {

        // Parse URL parameters
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const searchParams = new URLSearchParams(window.location.search);

        // Check for auth errors
        const errorParam = hashParams.get('error') || searchParams.get('error');
        const errorDescription = hashParams.get('error_description') || searchParams.get('error_description');

        if (errorParam) {
          console.error('Auth error:', errorParam, errorDescription);
          router.push(`/login?error=${encodeURIComponent(errorDescription || errorParam)}`);
          return;
        }

        // Handle auth tokens from URL
        let tokensFound = false;

        // Check hash for tokens (standard OAuth implicit flow)
        if (window.location.hash) {
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken) {
            try {
              const { error: sessionError } = await supabaseClient.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken || ''
              });

              if (sessionError) {
                console.error('Error setting session:', sessionError);
              } else {
                tokensFound = true;
              }
            } catch (e) {
              console.error('Exception setting session:', e);
            }
          }
        }

        // Check query params as fallback
        if (!tokensFound && searchParams.get('access_token')) {
          const accessToken = searchParams.get('access_token');
          const refreshToken = searchParams.get('refresh_token');

          if (accessToken) {
            try {
              const { error: sessionError } = await supabaseClient.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken || ''
              });

              if (!sessionError) {
                tokensFound = true;
              }
            } catch (e) {
              console.error('Exception setting session:', e);
            }
          }
        }

        // Brief wait for session to establish
        if (tokensFound) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        const { data, error } = await supabaseClient.auth.getSession()

        console.log('🔍 Session check:', {
          hasSession: !!data.session,
          email: data.session?.user?.email,
          error: error
        });

        if (error) {
          console.error('Error during auth callback:', error)
          router.push('/?error=auth_failed')
          return
        }

        if (data.session) {
          console.log('✅ Session found, processing...');
          // Wait for session to fully establish
          await new Promise(resolve => setTimeout(resolve, 500))

          // Double-check session is still valid
          const { data: recheckData } = await supabaseClient.auth.getSession()
          if (!recheckData.session) {
            console.error('Session lost, redirecting to login')
            router.push('/login?error=session_lost')
            return
          }

          // User is authenticated
          const user = recheckData.session.user

          // Handle email verification callback
          const isVerified = new URLSearchParams(window.location.search).get('verified') === 'true';
          if (isVerified && user.email_confirmed_at) {
            try {
              await fetch('/api/user/mark-verified', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id })
              });
            } catch (error) {
              console.error('Error updating verification status:', error);
            }
          }

          // Handle Google signup flow email validation
          const isGoogleSignupFlow = new URLSearchParams(window.location.search).get('flow') === 'google-signup';

          if (isGoogleSignupFlow) {
            const expectedEmail = sessionStorage.getItem('expectedGoogleEmail');

            if (expectedEmail && user.email !== expectedEmail) {
              console.error('Email mismatch - expected:', expectedEmail, 'got:', user.email);
              sessionStorage.removeItem('expectedGoogleEmail');
              router.push(`/login?error=${encodeURIComponent(`You signed in with ${user.email} but created an account with ${expectedEmail}. Please check your email (${expectedEmail}) for a magic link to access your account.`)}`);
              return;
            }

            sessionStorage.removeItem('expectedGoogleEmail');
          }

          // Check if this is a free signup flow (even if data was lost)
          const isFreeSignupFlow = new URLSearchParams(window.location.search).get('flow') === 'free-signup';

          // Check for pending signup data - try database first (most reliable), then sessionStorage/localStorage
          let pendingFreeSignup = null;
          let formData = null;

          // ONLY check database if this is explicitly a free signup flow
          if (isFreeSignupFlow) {
            console.log('Free signup flow detected - checking database for pending signup data...');
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

                // Wait briefly to ensure database write completes (reduced to 300ms)
                await new Promise(resolve => setTimeout(resolve, 300));
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
          
          // Determine redirect destination
          let redirectPath = '/settings'; // default

          // Method 1: Check OAuth state parameter (most reliable)
          const urlParams = new URLSearchParams(window.location.search);
          const stateParam = urlParams.get('state');

          if (stateParam) {
            try {
              const stateData = JSON.parse(atob(stateParam));
              if (stateData.redirect) {
                redirectPath = stateData.redirect;
              }
            } catch (e) {
              console.error('Failed to decode state parameter:', e);
            }
          }

          // Method 2: Fallback to localStorage
          if (redirectPath === '/settings') {
            try {
              const localStorageRedirect = localStorage.getItem('post_auth_redirect');
              if (localStorageRedirect) {
                redirectPath = localStorageRedirect;
                localStorage.removeItem('post_auth_redirect');
              }
            } catch (e) {
              console.error('Failed to read localStorage:', e);
            }
          }

          // Set server-side session cookie for SSR pages
          console.log('🔐 Setting server-side session...');
          try {
            const { data: finalCheck } = await supabaseClient.auth.getSession();
            if (finalCheck.session) {
              const response = await fetch('/api/auth/session', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                  access_token: finalCheck.session.access_token,
                  refresh_token: finalCheck.session.refresh_token
                })
              });

              if (response.ok) {
                console.log('✅ Server session set');
              } else {
                console.error('❌ Server session failed:', response.status);
              }
            }
          } catch (e) {
            console.error('Failed to establish server-side session:', e);
          }

          // Wait for cookie to be written
          await new Promise(resolve => setTimeout(resolve, 500));

          // Redirect to destination
          console.log('🚀 Redirecting to:', redirectPath);
          const redirectUrl = window.location.origin + redirectPath;
          window.location.href = redirectUrl;
        } else {
          // No session found
          console.error('❌ NO SESSION - redirecting to home');
          router.push('/')
        }
      } catch (error) {
        console.error('Auth callback error:', error)
        router.push('/?error=auth_failed')
      }
    }

    handleAuthCallback()
  }, [router, supabaseClient])

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