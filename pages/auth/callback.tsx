import React, { useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

// Callback page loads when OAuth completes

export default function AuthCallback() {
  const router = useRouter()
  const [debugInfo, setDebugInfo] = React.useState<string>('')
  const [mobileAppUrl, setMobileAppUrl] = React.useState<string | null>(null)
  const [showFallback, setShowFallback] = React.useState(false)

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        setDebugInfo('🔄 Starting OAuth callback...')

        // Check if this is a mobile app callback (from magic link)
        // Mobile app sets a specific parameter or we detect by user agent
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const isMobileApp = searchParams.get('mobile') === 'true' ||
                           searchParams.get('redirect_to')?.startsWith('ticketlesschicago://');

        // If this is a mobile app callback, redirect to the app with tokens
        if (isMobileApp) {
          const accessToken = hashParams.get('access_token') || searchParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');
          const error = hashParams.get('error') || searchParams.get('error');
          const errorDescription = hashParams.get('error_description') || searchParams.get('error_description');

          let queryString = '';

          if (error) {
            queryString = `?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(errorDescription || '')}`;
          } else if (accessToken) {
            queryString = `?access_token=${encodeURIComponent(accessToken)}`;
            if (refreshToken) {
              queryString += `&refresh_token=${encodeURIComponent(refreshToken)}`;
            }
          }

          const customSchemeUrl = `ticketlesschicago://auth/callback${queryString}`;

          // Detect Android to use Intent URL (Chrome blocks custom scheme redirects via JS)
          const ua = navigator.userAgent || '';
          const isAndroid = /android/i.test(ua);

          // Detect WebView (Samsung Email, Outlook, etc.) — these don't support intent:// either
          const isWebView = /wv|WebView/i.test(ua) || /FBAN|FBAV|Instagram|Line\//i.test(ua);

          // Build the intent URL for Chrome/Custom Tabs on Android
          const intentUrl = `intent://auth/callback${queryString}#Intent;scheme=ticketlesschicago;package=fyi.ticketless.app;end`;

          // Store the fallback URL — always use custom scheme for the clickable link
          // (user taps bypass Chrome's JS restriction)
          setMobileAppUrl(customSchemeUrl);

          if (isAndroid) {
            if (isWebView) {
              // WebViews don't support intent:// — try custom scheme directly,
              // then immediately show the fallback button
              console.log('📱 Android WebView detected, using custom scheme + fallback');
              setDebugInfo('📱 Opening app...');
              window.location.href = customSchemeUrl;
              // Show fallback immediately since WebViews usually block this
              setShowFallback(true);
            } else {
              // Chrome / Custom Tabs — intent:// is the reliable path
              console.log('📱 Android Chrome detected, using Intent URL');
              setDebugInfo('📱 Opening app...');
              window.location.href = intentUrl;
            }
          } else {
            // iOS — custom scheme works reliably via JS
            console.log('📱 iOS detected, redirecting to:', customSchemeUrl);
            setDebugInfo('📱 Redirecting to mobile app...');
            window.location.href = customSchemeUrl;
          }

          // Fallback: if auto-redirect didn't fire after 1.5 seconds, show button
          setTimeout(() => {
            setShowFallback(true);
          }, 1500);
          return;
        }

        // Variables already declared above for mobile check

        console.log('📍 Callback URL:', window.location.href);
        console.log('🔗 Hash params:', Array.from(hashParams.entries()));
        console.log('🔗 Search params:', Array.from(searchParams.entries()));

        // Check for auth errors
        const errorParam = hashParams.get('error') || searchParams.get('error');
        const errorDescription = hashParams.get('error_description') || searchParams.get('error_description');

        if (errorParam) {
          console.error('Auth error:', errorParam, errorDescription);
          setDebugInfo(`❌ Auth error: ${errorDescription || errorParam}`)
          await new Promise(r => setTimeout(r, 2000))
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
              const { error: sessionError } = await supabase.auth.setSession({
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
              const { error: sessionError } = await supabase.auth.setSession({
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

        const { data, error } = await supabase.auth.getSession()

        console.log('🔍 Session check:', {
          hasSession: !!data.session,
          email: data.session?.user?.email,
          error: error
        });

        setDebugInfo(`🔍 Session check: ${data.session ? '✅ Found' : '❌ Not found'}`);

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
          const { data: recheckData } = await supabase.auth.getSession()
          if (!recheckData.session) {
            console.error('Session lost, redirecting to login')
            router.push('/login?error=session_lost')
            return
          }

          // User is authenticated
          const user = recheckData.session.user

          // IMPORTANT: Check for Protection Google flow FIRST, before checking user profile
          // This ensures new users signing up for Protection get to Stripe, not free signup
          const urlFlowParam = new URLSearchParams(window.location.search).get('flow');
          const sessionFlowParam = sessionStorage.getItem('pendingProtectionFlow');
          const isProtectionGoogleFlow = urlFlowParam === 'protection-google' || sessionFlowParam === 'protection-google';

          console.log('🔍 Flow detection - URL param:', urlFlowParam, 'Session param:', sessionFlowParam);

          if (isProtectionGoogleFlow) {
            console.log('🛡️ Protection Google flow detected - checking for pending checkout data...');
            // Clean up the flow indicator
            sessionStorage.removeItem('pendingProtectionFlow');
            const pendingCheckout = sessionStorage.getItem('pendingProtectionCheckout');

            if (pendingCheckout) {
              console.log('✅ Found pending protection checkout, redirecting to Stripe...');
              setDebugInfo('✅ Redirecting to payment...');

              try {
                const checkoutData = JSON.parse(pendingCheckout);
                // Add user info from Google OAuth
                checkoutData.email = user.email;
                checkoutData.userId = user.id;

                // Call the checkout API
                const response = await fetch('/api/protection/checkout', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(checkoutData)
                });

                const result = await response.json();

                if (!response.ok) {
                  throw new Error(result.error || 'Checkout failed');
                }

                // Clean up sessionStorage
                sessionStorage.removeItem('pendingProtectionCheckout');

                // Redirect to Stripe
                if (result.url) {
                  window.location.href = result.url;
                  return;
                }
              } catch (error: any) {
                console.error('❌ Error processing protection checkout:', error);
                sessionStorage.removeItem('pendingProtectionCheckout');
                router.push(`/protection?error=${encodeURIComponent(error.message || 'Checkout failed')}`);
                return;
              }
            } else {
              console.error('❌ Protection Google flow but no pending checkout data');
              router.push('/protection?error=session_expired');
              return;
            }
          }

          // Check if this user has a profile (existing user vs new OAuth user)
          const { data: userProfile } = await supabase
            .from('user_profiles')
            .select('email, has_contesting')
            .eq('user_id', user.id)
            .maybeSingle();

          if (!userProfile) {
            // New user signed in with OAuth - create account profile
            console.log('🆕 New OAuth user detected - creating profile...');
            setDebugInfo(`🆕 Welcome! Setting up your account...`);

            // Create a basic profile for the new user
            const { error: insertError } = await supabase
              .from('user_profiles')
              .insert({
                user_id: user.id,
                email: user.email,
                has_contesting: false, // Not yet activated - needs to complete purchase
                created_at: new Date().toISOString(),
              });

            if (insertError) {
              console.error('Error creating user profile:', insertError);
              // Don't block - they can still use the app
            } else {
              console.log('✅ User profile created successfully');
            }

            // Link any orphaned FOIA history requests submitted before signup
            try {
              await fetch('/api/foia/link-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, email: user.email }),
              });
            } catch (e) {
              // Non-critical — don't block signup
            }

            await new Promise(r => setTimeout(r, 500));
            // Redirect to settings so they can complete their profile
            router.push('/settings?welcome=true');
            return;
          }

          console.log('✅ Existing user profile found');
          setDebugInfo(`✅ Welcome back! Redirecting to app...`);

          // Link any orphaned FOIA history requests (in case user submitted one while logged out)
          try {
            fetch('/api/foia/link-user', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: user.id, email: user.email }),
            }); // fire-and-forget — don't await
          } catch (e) {
            // Non-critical
          }

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

          // Check if this is a legacy signup flow (even if data was lost)
          const isFreeSignupFlow = new URLSearchParams(window.location.search).get('flow') === 'free-signup';

          // Check for pending signup data - try database first (most reliable), then sessionStorage/localStorage
          let pendingSignup = null;
          let formData = null;

          // ONLY check database if this is explicitly a free signup flow
          if (isFreeSignupFlow) {
            console.log('Legacy signup flow detected - checking database for pending signup data...');
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
                  pendingSignup = 'from-database';
                }
              }
            } catch (error) {
              console.error('Error checking database for pending signup:', error);
            }
          }

          // Fallback to sessionStorage/localStorage if database didn't have it
          if (!pendingSignup) {
            console.log('No data in database, checking sessionStorage...');
            pendingSignup = sessionStorage.getItem('pendingSignup');
          }

          if (!pendingSignup) {
            console.log('No data in sessionStorage, checking localStorage...');
            pendingSignup = localStorage.getItem('pendingSignup');
          }

          if (pendingSignup && pendingSignup !== 'from-database') {
            formData = JSON.parse(pendingSignup);
          }

          if (formData) {
            console.log('Found pending signup data, creating account...')
            console.log('Signup data source:', pendingSignup === 'from-database' ? 'database' : 'storage')
            try {
              // IMPORTANT: Use the authenticated user's email, not the form email
              // This ensures Google OAuth users get their Google email saved
              formData.email = user.email;

              console.log('Creating free account with email:', user.email);

              // Create the free account with the form data
              // Pass the authenticated user ID to skip auth user creation
              const response = await fetch('/api/alerts/create', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  ...formData,
                  authenticatedUserId: user.id // Pass the OAuth user ID
                })
              });

              const result = await response.json();

              if (result.success) {
                console.log('✅ Free account created successfully');

                // Link any orphaned FOIA history requests submitted before signup
                try {
                  await fetch('/api/foia/link-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: user.id, email: user.email }),
                  });
                } catch (e) {
                  // Non-critical
                }

                // Clean up pending signup from all sources
                sessionStorage.removeItem('pendingSignup');
                localStorage.removeItem('pendingSignup');

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
                router.push('/start?error=signup_failed');
                return;
              }
            } catch (error) {
              console.error('❌ Error processing free signup:', error);
              sessionStorage.removeItem('pendingSignup'); // Clean up on error
              router.push('/start?error=signup_failed');
              return;
            }
          } else if (isFreeSignupFlow) {
            // Free signup flow but no data found - sessionStorage was cleared
            console.error('❌ Free signup flow detected but no form data found');
            sessionStorage.removeItem('pendingSignup');
            localStorage.removeItem('pendingSignup');
            router.push('/start?error=data_lost');
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

          // Check for protection query param (from Protection signup)
          const searchParams = new URLSearchParams(window.location.search);
          const isProtectionSignup = searchParams.get('protection') === 'true';
          if (isProtectionSignup) {
            redirectPath = '/settings?protection=true';
            console.log('🛡️ Protection signup detected - will poll for webhook completion');
          }

          // Check localStorage for redirect (overrides protection param)
          try {
            const localStorageRedirect = localStorage.getItem('post_auth_redirect');
            console.log('📦 localStorage redirect:', localStorageRedirect);
            if (localStorageRedirect) {
              redirectPath = localStorageRedirect;
              localStorage.removeItem('post_auth_redirect');
            }
          } catch (e) {
            console.error('Failed to read localStorage:', e);
          }

          // Set server-side session cookie for SSR pages
          console.log('🔐 Setting server-side session...');
          try {
            const { data: finalCheck } = await supabase.auth.getSession();
            if (finalCheck.session) {
              // Set a timeout for the API call
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

              try {
                const response = await fetch('/api/auth/session', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  credentials: 'include',
                  body: JSON.stringify({
                    access_token: finalCheck.session.access_token,
                    refresh_token: finalCheck.session.refresh_token
                  }),
                  signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                  console.log('✅ Server session set');
                  // Wait a bit for cookie to propagate
                  await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                  console.error('❌ Server session failed:', response.status);
                }
              } catch (fetchError: any) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                  console.warn('⚠️  Server session API timed out after 3s - proceeding anyway');
                } else {
                  console.error('❌ Server session fetch error:', fetchError);
                }
              }
            }
          } catch (e) {
            console.error('Failed to establish server-side session:', e);
          }

          // Redirect to destination
          console.log('🚀 Redirecting to:', redirectPath);
          const redirectUrl = window.location.origin + redirectPath;
          window.location.href = redirectUrl;
        } else {
          // No session found
          console.error('❌ NO SESSION FOUND AFTER AUTH');
          console.error('URL hash:', window.location.hash);
          console.error('URL search:', window.location.search);
          console.error('Full URL:', window.location.href);

          // Show user-friendly error
          router.push('/login?error=' + encodeURIComponent('Authentication failed. Please try again. If this persists, try using the magic link option instead.'))
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
      <div className="bg-white rounded-lg shadow-md p-8 text-center max-w-md">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Completing sign in...</h2>
        <p className="text-gray-600 mb-4">Please wait while we verify your account.</p>
        {debugInfo && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-left">
            <p className="font-mono text-xs">{debugInfo}</p>
          </div>
        )}
        {showFallback && mobileAppUrl && (
          <div className="mt-6 border-t pt-4">
            <p className="text-gray-500 text-sm mb-3">Didn&apos;t open automatically? Tap the button below.</p>
            <a
              href={mobileAppUrl}
              className="inline-block bg-blue-600 text-white font-semibold py-3 px-8 rounded-lg hover:bg-blue-700 transition-colors text-lg"
            >
              Open Autopilot America
            </a>
            <p className="text-gray-400 text-xs mt-3">
              If the app still doesn&apos;t open, make sure it&apos;s installed, then try tapping the link in your email again.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}