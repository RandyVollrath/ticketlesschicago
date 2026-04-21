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