import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

// IMMEDIATE LOG - runs when file loads
console.log('🔴 CALLBACK.TSX FILE LOADED - This proves the page is being accessed')
console.log('🔴 Current URL when file loaded:', typeof window !== 'undefined' ? window.location.href : 'server')

export default function AuthCallback() {
  const router = useRouter()

  console.log('🟡 AuthCallback component rendering')

  useEffect(() => {
    console.log('🟢 useEffect starting')
    const handleAuthCallback = async () => {
      try {
        console.log('Auth callback started')
        console.log('Current URL:', window.location.href)
        console.log('URL hash:', window.location.hash)
        console.log('URL search:', window.location.search)

        // CRITICAL: Parse hash IMMEDIATELY before Supabase modifies it
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const searchParams = new URLSearchParams(window.location.search);

        // Extract redirect parameter NOW (before it gets lost)
        const hashRedirect = hashParams.get('redirect');
        console.log('🎯 Captured redirect from hash IMMEDIATELY:', hashRedirect);

        const errorParam = hashParams.get('error') || searchParams.get('error');
        const errorDescription = hashParams.get('error_description') || searchParams.get('error_description');

        if (errorParam) {
          console.error('❌ Auth error in URL:', errorParam, errorDescription);
          router.push(`/login?error=${encodeURIComponent(errorDescription || errorParam)}`);
          return;
        }

        // Explicitly handle auth tokens from URL (both hash and query params)
        // Supabase should auto-detect with detectSessionInUrl: true, but we'll do it manually for reliability
        let tokensFound = false;

        // Check hash first (standard for implicit flow)
        if (window.location.hash) {
          console.log('🔍 Checking URL hash for tokens...');
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken) {
            console.log('✅ Found tokens in hash, setting session explicitly...');
            try {
              const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken || ''
              });

              if (sessionError) {
                console.error('❌ Error setting session from hash:', sessionError);
              } else {
                console.log('✅ Session established from hash tokens');
                tokensFound = true;
              }
            } catch (e) {
              console.error('❌ Exception setting session:', e);
            }
          }
        }

        // Also check query params (some auth flows use this)
        if (!tokensFound && searchParams.get('access_token')) {
          console.log('🔍 Found tokens in query params, setting session...');
          const accessToken = searchParams.get('access_token');
          const refreshToken = searchParams.get('refresh_token');

          if (accessToken) {
            try {
              const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken || ''
              });

              if (sessionError) {
                console.error('❌ Error setting session from query:', sessionError);
              } else {
                console.log('✅ Session established from query params');
                tokensFound = true;
              }
            } catch (e) {
              console.error('❌ Exception setting session:', e);
            }
          }
        }

        // Wait briefly for session to be fully established (reduced from 1000ms to 300ms)
        if (tokensFound) {
          console.log('⏳ Waiting for session to be fully established...');
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        const { data, error } = await supabase.auth.getSession()
        console.log('Session check result:', {
          hasSession: !!data.session,
          userId: data.session?.user?.id,
          email: data.session?.user?.email,
          error,
          fullData: data,
          fullError: error
        })

        // Log the full URL for debugging
        console.log('Full callback URL:', window.location.href)

        if (error) {
          console.error('Error during auth callback:', error)
          router.push('/?error=auth_failed')
          return
        }

        if (data.session) {
          // Reduced wait time for faster redirect (500ms instead of 1500ms)
          console.log('Session found, waiting for it to be fully established...')
          await new Promise(resolve => setTimeout(resolve, 500))

          // Double-check session is still valid
          const { data: recheckData } = await supabase.auth.getSession()
          if (!recheckData.session) {
            console.error('❌ Session lost after initial check, redirecting to login')
            router.push('/login?error=session_lost')
            return
          }

          // User is authenticated
          const user = recheckData.session.user
          console.log('User authenticated:', user.email, 'about to process profile data')

          // Check if this is an email verification callback
          const isVerified = new URLSearchParams(window.location.search).get('verified') === 'true';
          if (isVerified && user.email_confirmed_at) {
            console.log('✅ Email verified successfully');
            // Mark email as verified in users table
            try {
              await fetch('/api/user/mark-verified', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id })
              });
              console.log('✅ Email verification status updated in database');
            } catch (error) {
              console.error('Error updating verification status:', error);
            }
          }

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
          
          // Get redirect destination - try multiple sources
          console.log('=== STARTING REDIRECT LOGIC ===');
          console.log('Current URL:', window.location.href);

          let redirectPath = '/settings'; // default

          // Method 1: Check query parameter (app_redirect)
          const urlParams = new URLSearchParams(window.location.search);
          const queryRedirect = urlParams.get('app_redirect');
          console.log('Query param app_redirect:', queryRedirect);

          // Method 2: Check localStorage
          let localStorageRedirect = null;
          try {
            // Debug: Show ALL localStorage keys
            console.log('🔍 ALL localStorage keys:', Object.keys(localStorage));
            console.log('🔍 ALL localStorage:', JSON.stringify(localStorage));

            localStorageRedirect = localStorage.getItem('post_auth_redirect');
            console.log('📦 localStorage post_auth_redirect:', localStorageRedirect);

            if (localStorageRedirect) {
              console.log('✅ Found redirect in localStorage!');
              localStorage.removeItem('post_auth_redirect'); // Clean up
            } else {
              console.log('❌ localStorage post_auth_redirect is NULL/EMPTY');
            }
          } catch (e) {
            console.error('❌ Failed to read localStorage:', e);
          }

          // Use first available value - prioritize query param (now using Supabase's official queryParams option)
          redirectPath = queryRedirect || localStorageRedirect || '/settings';
          console.log('Final redirectPath:', redirectPath);

          // Debug info to diagnose failures
          console.log('🔍 REDIRECT DEBUG:', {
            queryParamValue: queryRedirect,
            localStorageValue: localStorageRedirect,
            finalDecision: redirectPath,
            source: queryRedirect ? 'query param (Supabase queryParams)' : localStorageRedirect ? 'localStorage' : 'default fallback'
          });

          console.log('=== POST-AUTH REDIRECT ===')
          console.log('user email:', user.email)
          console.log('🍪 redirect from cookie:', redirectPath)
          console.log('final redirect path:', redirectPath)
          console.log('current path:', window.location.pathname)

          // Use window.location for absolute redirect - bypasses Next.js router
          const redirectUrl = window.location.origin + redirectPath;
          console.log('Full redirect URL:', redirectUrl)

          // TEMPORARY: Add 5 second delay so user can read console logs
          console.log('⏳ WAITING 5 SECONDS - CHECK CONSOLE LOGS ABOVE');
          console.log('⏳ Look for queryParamValue and localStorageValue');
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Perform redirect
          console.log('🚀 REDIRECTING NOW to:', redirectUrl);
          console.log('Calling window.location.href =', redirectUrl);
          window.location.href = redirectUrl;
          console.log('After setting window.location.href (may not print)');
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