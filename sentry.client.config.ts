import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production
  enabled: process.env.NODE_ENV === 'production',

  // Adjust sample rate for production
  tracesSampleRate: 0.1, // 10% of transactions

  // Capture 100% of errors
  sampleRate: 1.0,

  // Don't send PII
  sendDefaultPii: false,

  // Filter out common noise
  ignoreErrors: [
    // Browser extensions
    /extensions\//i,
    /^chrome:\/\//i,
    // Network errors (user's connection issues)
    'Network request failed',
    'Failed to fetch',
    'Load failed',
    // User cancelled
    'AbortError',
  ],

  beforeSend(event) {
    // Don't send events in development
    if (process.env.NODE_ENV !== 'production') {
      return null;
    }
    return event;
  },
});
