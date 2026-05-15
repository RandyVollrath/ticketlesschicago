/**
 * Rate limiter for API routes.
 *
 * Backed by Upstash Redis when its env vars are configured (durable across
 * Vercel instances), otherwise falls back to per-instance in-memory counting.
 * Backend logic lives in lib/rate-limit-backend.ts.
 */

import { checkAndIncrement } from './rate-limit-backend';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Atomically check + increment a rate limit for `identifier`.
 *
 * The original sync signature is preserved by wrapping the async backend in
 * a Promise. Callers that did `if (!checkRateLimit(...).success)` synchronously
 * still need to await; check callsites if you change a tight loop.
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  // Derive a stable action label from the window+limit so different presets
  // get separate buckets in Redis without callers having to pass a name.
  const action = `legacy_${config.maxRequests}_${config.windowMs}`;
  const r = await checkAndIncrement(identifier, action, config.maxRequests, config.windowMs);
  return {
    success: r.allowed,
    remaining: r.remaining,
    resetAt: Date.now() + r.resetMs,
  };
}

/**
 * Get client IP from Next.js request
 */
export function getClientIp(req: { headers: { [key: string]: string | string[] | undefined } }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0];
  }
  return req.headers['x-real-ip'] as string || 'unknown';
}

// Preset configurations
export const RATE_LIMITS = {
  // Auth endpoints - stricter limits
  auth: { maxRequests: 5, windowMs: 60000 },      // 5 per minute

  // Login/signup - very strict
  login: { maxRequests: 10, windowMs: 300000 },   // 10 per 5 minutes

  // General API - more lenient
  api: { maxRequests: 60, windowMs: 60000 },      // 60 per minute

  // Webhooks - very lenient (trusted sources)
  webhook: { maxRequests: 1000, windowMs: 60000 }, // 1000 per minute
};
