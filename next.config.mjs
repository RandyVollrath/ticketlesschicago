import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    SITE_URL: process.env.SITE_URL || 'http://localhost:3000',
  },
  // Serve the OAuth callback at /oauth-return so the Android app's
  // /auth/* universal-link intent filter (in v2.0.1 and earlier) does NOT
  // intercept it. Browser URL stays /oauth-return; Next.js internally
  // serves the existing /auth/callback page. Once enough Android users
  // upgrade past 2.0.1, this rewrite can be removed.
  async rewrites() {
    return [
      { source: '/oauth-return', destination: '/auth/callback' },
    ];
  },
  async headers() {
    // Pragmatic CSP — unsafe-inline for scripts/styles (legacy inline
    // snippets in _document.tsx, Tailwind, Rewardful, Stripe). It's not a
    // perfect XSS mitigation but it meaningfully shrinks the blast radius
    // of a stored-XSS bug elsewhere.
    //
    // connect-src covers Supabase, Stripe, PostHog, Sentry, Resend, our
    // APIs, and Google Maps. Tighten these once we know every endpoint.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.stripe.com https://*.stripe.network https://r.wdfl.co https://*.wdfl.co https://*.posthog.com https://*.sentry.io https://maps.googleapis.com https://*.vercel-insights.com https://*.vercel-analytics.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https: http://localhost:*",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://auth.autopilotamerica.com wss://auth.autopilotamerica.com https://api.stripe.com https://*.stripe.com https://*.posthog.com https://*.sentry.io https://*.ingest.sentry.io https://api.resend.com https://maps.googleapis.com https://*.googleapis.com https://data.cityofchicago.org https://nominatim.openstreetmap.org https://*.vercel-insights.com https://*.vercel-analytics.com https://api.wdfl.co https://*.wdfl.co https://r.wdfl.co https://api.getrewardful.com https://*.getrewardful.com",
      "frame-src 'self' https://*.stripe.com https://*.stripe.network",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com https://*.stripe.com",
      "frame-ancestors 'self'",
      'upgrade-insecure-requests',
    ].join('; ');

    const securityHeaders = [
      // Prevent MIME sniffing so a misuploaded file can't be served as HTML/JS.
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      // Clickjacking protection.
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      // Don't leak full URLs (which may carry mobile_access_token) to 3P hosts.
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Force HTTPS for a year including subdomains.
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      // Drop permissions we don't use.
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
      // Content Security Policy. Report-only would be safer for rollout, but
      // without reporting infrastructure we just apply in enforce mode — the
      // policy is loose enough to not break the app today.
      { key: 'Content-Security-Policy', value: csp },
    ];
    return [
      { source: '/:path*', headers: securityHeaders },
    ];
  },
};

const sentryWebpackPluginOptions = {
  // Suppresses all logs
  silent: true,

  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only upload source maps in production
  dryRun: process.env.NODE_ENV !== 'production',

  // Hide source maps from the client
  hideSourceMaps: true,
};

// Wrap with Sentry only if DSN is configured
const finalConfig = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;

export default finalConfig;