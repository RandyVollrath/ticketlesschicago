/**
 * Simple in-memory rate limiter for API routes
 *
 * Note: This resets on server restart and doesn't work across multiple
 * Vercel serverless instances. For production, consider using Redis.
 * However, this still provides protection against basic abuse.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

export interface RateLimitConfig {
  maxRequests: number;  // Max requests per window
  windowMs: number;     // Window size in milliseconds
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check if a request should be rate limited
 *
 * @param identifier - Unique identifier (IP, user ID, etc.)
 * @param config - Rate limit configuration
 * @returns Result indicating if request is allowed
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const key = identifier;

  let entry = rateLimitStore.get(key);

  // If no entry or window expired, create new one
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 1,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetAt: entry.resetAt,
    };
  }

  // Increment count
  entry.count++;

  // Check if over limit
  if (entry.count > config.maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  return {
    success: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
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
