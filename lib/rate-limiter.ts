import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from './supabase';

// ── In-memory rate limit cache ──
// Avoids hitting Supabase on every single request during traffic surges.
// Each Vercel function instance gets its own cache — that's fine, it just
// means limits are per-instance which is MORE lenient, not less.
// Entries auto-expire when their window passes.
const rateLimitCache = new Map<string, number[]>();

function getCacheKey(identifier: string, action: string): string {
  return `${action}:${identifier}`;
}

function cleanExpiredEntries(key: string, windowMs: number): number[] {
  const entries = rateLimitCache.get(key) || [];
  const cutoff = Date.now() - windowMs;
  const valid = entries.filter(ts => ts > cutoff);
  if (valid.length === 0) {
    rateLimitCache.delete(key);
  } else {
    rateLimitCache.set(key, valid);
  }
  return valid;
}

// Periodically clean the entire cache to prevent memory leaks
let lastCacheClean = 0;
function maybeCleanCache() {
  const now = Date.now();
  if (now - lastCacheClean < 60_000) return;
  lastCacheClean = now;
  for (const [key, entries] of rateLimitCache) {
    const valid = entries.filter(ts => ts > now - 3_600_000);
    if (valid.length === 0) {
      rateLimitCache.delete(key);
    } else {
      rateLimitCache.set(key, valid);
    }
  }
}

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
 * Check if action is rate limited.
 * Uses in-memory cache (no DB hit per request).
 */
export async function checkRateLimit(
  identifier: string,
  action: RateLimitAction
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[action];
  const key = getCacheKey(identifier, action);

  maybeCleanCache();

  const cached = cleanExpiredEntries(key, config.windowMs);
  const currentCount = cached.length;
  const remaining = Math.max(0, config.limit - currentCount);
  const allowed = currentCount < config.limit;

  let resetIn = 0;
  if (!allowed && cached.length > 0) {
    const oldest = Math.min(...cached);
    resetIn = Math.max(0, oldest + config.windowMs - Date.now());
  }

  return { allowed, remaining, resetIn, limit: config.limit };
}

/**
 * Record a rate-limited action.
 * Writes to in-memory cache immediately, fire-and-forgets DB insert.
 */
export async function recordRateLimitAction(
  identifier: string,
  action: RateLimitAction
): Promise<void> {
  // Record in memory first (instant)
  const key = getCacheKey(identifier, action);
  const entries = rateLimitCache.get(key) || [];
  entries.push(Date.now());
  rateLimitCache.set(key, entries);

  // Fire-and-forget DB insert
  try {
    const { error } = await supabaseAdmin
      .from('rate_limits')
      .insert({
        identifier,
        action,
      } as { identifier: string; action: string });

    if (error) {
      console.error('Failed to record rate limit action:', error.message);
    }
  } catch (error) {
    console.error('Failed to record rate limit action:', error instanceof Error ? error.message : error);
  }
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
