import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { initPostHog, posthog } from '../lib/posthog'
import { ToastProvider, ToastConnector } from '../components/Toast'

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()

  useEffect(() => {
    // CRITICAL: Intercept OAuth redirects that land on wrong pages
    // Supabase may redirect to homepage or /settings instead of /auth/callback
    if (typeof window !== 'undefined') {
      const currentPath = window.location.pathname
      const hash = window.location.hash

      // Check if we have OAuth tokens in the URL hash
      const hasOAuthTokens = hash.includes('access_token') || hash.includes('refresh_token')

      if (hasOAuthTokens && currentPath !== '/auth/callback') {
        console.log('🚨 INTERCEPTED: OAuth tokens detected on wrong page:', currentPath)
        console.log('🔄 FORCING redirect to /auth/callback with tokens')

        // Force redirect to callback page with tokens preserved
        window.location.replace('/auth/callback' + hash)
        return
      }

      // Log where user actually lands after OAuth (for debugging)
      if (hasOAuthTokens) {
        console.log('✅ OAuth tokens detected on correct page:', currentPath)
      }
    }

    // Initialize PostHog
    initPostHog()

    // Track page views
    const handleRouteChange = () => {
      if (typeof window !== 'undefined') {
        posthog?.capture('$pageview')
      }
    }

    router.events.on('routeChangeComplete', handleRouteChange)

    return () => {
      router.events.off('routeChangeComplete', handleRouteChange)
    }
  }, [router.events])

  return (
    <ToastProvider>
      <ToastConnector />
      <Component {...pageProps} />
    </ToastProvider>
  )
}