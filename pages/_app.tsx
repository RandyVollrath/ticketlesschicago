import '../styles/globals.css'
import 'leaflet/dist/leaflet.css'
import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { initPostHog, posthog } from '../lib/posthog'
import { ToastProvider, ToastConnector } from '../components/Toast'

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Detect mobile WebView — it passes auth via URL query params, not hash.
    // Skip OAuth redirect interception and PostHog in this context because:
    // 1. PostHog init accesses browser APIs that can crash in WKWebView/Android WebView
    // 2. OAuth hash redirect is irrelevant (mobile uses mobile_access_token params)
    const isMobileWebView = window.location.search?.includes('mobile_access_token') ||
      !!(window as any).ReactNativeWebView

    if (!isMobileWebView) {
      // CRITICAL: Intercept OAuth redirects that land on wrong pages
      // Supabase may redirect to homepage or /settings instead of /oauth-return
      const currentPath = window.location.pathname
      const hash = window.location.hash

      // Check if we have OAuth tokens in the URL hash
      const hasOAuthTokens = hash.includes('access_token') || hash.includes('refresh_token')

      if (hasOAuthTokens && currentPath !== '/oauth-return') {
        console.log('🚨 INTERCEPTED: OAuth tokens detected on wrong page:', currentPath)
        console.log('🔄 FORCING redirect to /oauth-return with tokens')

        // Force redirect to callback page with tokens preserved
        window.location.replace('/oauth-return' + hash)
        return
      }

      // Log where user actually lands after OAuth (for debugging)
      if (hasOAuthTokens) {
        console.log('✅ OAuth tokens detected on correct page:', currentPath)
      }

      // Initialize PostHog (skip in WebView — it can crash accessing browser APIs)
      initPostHog()
    }

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

  // ── Site-wide Rewardful affiliate capture ──
  // Runs on EVERY page so the moment rw.js initializes (typically on the
  // first ?via=... landing page), we persist the referral to localStorage.
  // /start (and any other checkout CTA) reads from this key, so the affiliate
  // survives the Google-OAuth round-trip that wipes window.Rewardful between
  // the home page click and the post-OAuth checkout. Skipped in WebView.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const isMobileWebView = window.location.search?.includes('mobile_access_token') ||
      !!(window as any).ReactNativeWebView
    if (isMobileWebView) return

    const STORAGE_KEY = 'start_rewardful_referral'

    const captureReferral = () => {
      try {
        const ref = (window as any).Rewardful?.referral
        if (ref && typeof ref === 'string') {
          localStorage.setItem(STORAGE_KEY, ref)
        }
      } catch { /* non-fatal */ }
    }

    // Try immediately in case rw.js already initialized.
    captureReferral()

    // Subscribe to Rewardful's ready event (fires when rw.js boots).
    try {
      const rewardful = (window as any).rewardful
      if (typeof rewardful === 'function') {
        rewardful('ready', captureReferral)
      }
    } catch { /* non-fatal */ }

    // Aggressive polling: rw.js loads async from r.wdfl.co and the user can
    // click a CTA before init completes. Check at multiple intervals so we
    // win the race even on slow networks.
    const timers = [200, 500, 1000, 2000, 4000].map((ms) =>
      window.setTimeout(captureReferral, ms),
    )
    return () => { timers.forEach(window.clearTimeout) }
  }, [])

  return (
    <ToastProvider>
      <ToastConnector />
      <Component {...pageProps} />
    </ToastProvider>
  )
}