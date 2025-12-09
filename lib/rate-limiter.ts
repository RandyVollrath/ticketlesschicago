import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from './supabase';

// Rate limit configurations
export const RATE_LIMITS = {
  magic_link: { limit: 3, windowMs: 60 * 60 * 1000 }, // 3 per hour
  auth: { limit: 10, windowMs: 15 * 60 * 1000 }, // 10 per 15 minutes
  checkout: { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour
  api: { limit: 100, windowMs: 60 * 1000 }, // 100 per minute
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
  limit: number;
}

/**
 * Get client IP from Next.js API request headers
 */
export function getClientIP(req: NextApiRequest): string {
  // Check x-forwarded-for (standard for proxies/load balancers)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip.trim();
  }

  // Check x-real-ip
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // Fallback to socket address
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Check if action is rate limited
 */
export async function checkRateLimit(
  identifier: string,
  action: RateLimitAction
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[action];
  const windowStart = new Date(Date.now() - config.windowMs).toISOString();

  try {
    // Count actions in window
    const { count, error } = await supabaseAdmin
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('identifier', identifier)
      .eq('action', action)
      .gte('created_at', windowStart);

    if (error) {
      console.error('Rate limit check error:', error);
      // Allow on error to not block legitimate users
      return { allowed: true, remaining: config.limit, resetIn: 0, limit: config.limit };
    }

    const currentCount = count || 0;
    const remaining = Math.max(0, config.limit - currentCount);
    const allowed = currentCount < config.limit;

    // Calculate reset time
    let resetIn = 0;
    if (!allowed) {
      const { data: oldestEntry } = await supabaseAdmin
        .from('rate_limits')
        .select('created_at')
        .eq('identifier', identifier)
        .eq('action', action)
        .gte('created_at', windowStart)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (oldestEntry) {
        const oldestTime = new Date((oldestEntry as { created_at: string }).created_at).getTime();
        resetIn = Math.max(0, oldestTime + config.windowMs - Date.now());
      }
    }

    return { allowed, remaining, resetIn, limit: config.limit };
  } catch (error) {
    console.error('Rate limit check exception:', error);
    return { allowed: true, remaining: config.limit, resetIn: 0, limit: config.limit };
  }
}

/**
 * Record a rate-limited action
 */
export async function recordRateLimitAction(
  identifier: string,
  action: RateLimitAction
): Promise<void> {
  try {
    await (supabaseAdmin.from('rate_limits') as any).insert({
      identifier,
      action,
    });
  } catch (error) {
    console.error('Failed to record rate limit action:', error);
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
