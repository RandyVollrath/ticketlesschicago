import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from './supabase';
import { checkAndIncrement } from './rate-limit-backend';

// Rate-limit storage lives in lib/rate-limit-backend.ts — that module routes
// through Upstash Redis when its env vars are configured, otherwise falls
// back to per-instance in-memory counting (the prior behavior). Same public
// API either way, so callers here don't change.

// Rate limit configurations
export const RATE_LIMITS = {
  magic_link: { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour (raised from 3 for signup surges)
  auth: { limit: 50, windowMs: 15 * 60 * 1000 }, // 50 per 15 minutes (raised from 10 for signup surges)
  checkout: { limit: 50, windowMs: 60 * 60 * 1000 }, // 50 per hour (raised from 10 — Stripe handles the real throttling)
  api: { limit: 100, windowMs: 60 * 1000 }, // 100 per minute
  vision_api: { limit: 20, windowMs: 60 * 60 * 1000 }, // 20 per hour (expensive GPT-4V calls)
  geocoding: { limit: 50, windowMs: 60 * 60 * 1000 }, // 50 per hour (Google Maps API)
  upload: { limit: 20, windowMs: 60 * 60 * 1000 }, // 20 uploads per hour per IP
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
  limit: number;
}

/**
 * Get the real client IP.
 *
 * On Vercel, x-vercel-forwarded-for is set by the Vercel edge and can be
 * trusted. x-forwarded-for is client-spoofable at the *first* position —
 * Vercel appends the real IP at the *end* of the list — so if we fall back to
 * x-forwarded-for we take the LAST entry, not the first.
 *
 * Taking the first entry (prior behavior) let an attacker bypass per-IP rate
 * limits by rotating the leading x-forwarded-for value they sent.
 */
export function getClientIP(req: NextApiRequest): string {
  const vercelFwd = req.headers['x-vercel-forwarded-for'];
  if (vercelFwd) {
    const ip = Array.isArray(vercelFwd) ? vercelFwd[0] : vercelFwd.split(',')[0];
    return ip.trim();
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    // Trust the last (proxy-appended) entry, not the first (client-supplied).
    if (parts.length > 0) return parts[parts.length - 1];
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Atomically check + increment the limit for (identifier, action).
 *
 * IMPORTANT semantic change vs. the prior implementation: this now counts
 * every check, not only checks followed by `recordRateLimitAction`. That
 * closes a bypass where a caller could fire invalid requests forever without
 * incrementing the counter. Callers that previously called check + record
 * still work — `recordRateLimitAction` is now a no-op.
 */
export async function checkRateLimit(
  identifier: string,
  action: RateLimitAction
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[action];
  const r = await checkAndIncrement(identifier, action, config.limit, config.windowMs);
  return {
    allowed: r.allowed,
    remaining: r.remaining,
    resetIn: r.resetMs,
    limit: r.limit,
  };
}

/**
 * Deprecated: checkRateLimit now increments atomically. This is kept as a
 * no-op so existing call sites continue to compile and run unchanged. The
 * fire-and-forget DB insert is intentionally dropped — Upstash is our source
 * of truth for rate-limit state.
 */
export async function recordRateLimitAction(
  _identifier: string,
  _action: RateLimitAction
): Promise<void> {
  // intentionally empty
}

/**
 * Rate limiting middleware for Next.js API routes
 */
export function withRateLimit(
  action: RateLimitAction,
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const ip = getClientIP(req);
    const result = await checkRateLimit(ip, action);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    if (result.resetIn > 0) {
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + result.resetIn / 1000));
    }

    if (!result.allowed) {
      console.warn(`Rate limit exceeded for ${ip} on action ${action}`);
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Please try again in ${Math.ceil(result.resetIn / 1000)} seconds.`,
        retryAfter: Math.ceil(result.resetIn / 1000),
      });
    }

    // Record the action before processing
    await recordRateLimitAction(ip, action);

    // Process the request
    return handler(req, res);
  };
}

/**
 * Rate limit by email (for magic link requests)
 */
export async function checkEmailRateLimit(email: string): Promise<RateLimitResult> {
  // Normalize email
  const normalizedEmail = email.toLowerCase().trim();
  return checkRateLimit(`email:${normalizedEmail}`, 'magic_link');
}

/**
 * Record magic link request for email
 */
export async function recordMagicLinkRequest(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  await recordRateLimitAction(`email:${normalizedEmail}`, 'magic_link');
}
