import posthog from 'posthog-js'

// Track initialization state
let isInitialized = false
let initPromise: Promise<void> | null = null

export const initPostHog = () => {
  if (typeof window !== 'undefined' && !initPromise) {
    const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
    const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

    if (apiKey) {
      initPromise = new Promise((resolve) => {
        posthog.init(apiKey, {
          api_host: apiHost,
          person_profiles: 'identified_only',
          capture_pageviews: true,
          capture_pageleave: true,
          loaded: (ph) => {
            isInitialized = true
            if (process.env.NODE_ENV === 'development') {
              ph.debug()
            }
            resolve()
          }
        })
        // Resolve after timeout if loaded callback doesn't fire
        setTimeout(() => {
          isInitialized = true
          resolve()
        }, 2000)
      })
    }
  }
}

/**
 * Safe capture that waits for PostHog to initialize
 * Use this instead of posthog.capture() directly
 */
export const capture = (event: string, properties?: Record<string, any>) => {
  if (typeof window === 'undefined') return

  const doCapture = () => {
    if (posthog && typeof posthog.capture === 'function') {
      posthog.capture(event, properties)
    }
  }

  if (isInitialized) {
    doCapture()
  } else if (initPromise) {
    initPromise.then(doCapture)
  } else {
    // PostHog not initialized yet, wait a bit and try
    setTimeout(doCapture, 500)
  }
}

/**
 * Server-side event capture for PostHog
 * Uses the Capture API directly since posthog-js is client-only
 */
export const captureServerEvent = async (
  distinctId: string,
  event: string,
  properties?: Record<string, any>
) => {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

  if (!apiKey) {
    console.warn('PostHog API key not configured for server-side tracking')
    return
  }

  try {
    await fetch(`${apiHost}/capture/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        properties: {
          distinct_id: distinctId,
          ...properties,
        },
        timestamp: new Date().toISOString(),
      }),
    })
  } catch (error) {
    console.error('PostHog server-side capture error:', error)
  }
}

export { posthog }
