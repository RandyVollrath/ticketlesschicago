import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { initPostHog, posthog } from '../lib/posthog'

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()

  useEffect(() => {
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

  return <Component {...pageProps} />
}