/**
 * Rate-limit backend with transparent Upstash fallback.
 *
 * Why: lib/rate-limiter.ts and lib/rate-limit.ts both used in-memory Maps.
 * On Vercel each function instance has its own Map, so a determined attacker
 * could fan out across N concurrent instances and get N× the "limit." For
 * paid-API endpoints (Vision, geocoding, SMS, email) that's a real bill-burn
 * vector.
 *
 * This backend hands you durable, atomic check-and-increment via Upstash
 * Redis when those env vars are present; otherwise it transparently falls
 * back to the same in-memory behavior as before. So nothing breaks if Upstash
 * isn't provisioned yet — the security floor just gets higher when it is.
 *
 * Set up: install the **Upstash Redis** integration from Vercel Marketplace.
 * Vercel auto-injects UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or
 * KV_REST_API_URL + KV_REST_API_TOKEN, both formats supported).
 */

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

const upstashUrl =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  process.env.STORAGE_REDIS_REST_URL;

const upstashToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  process.env.STORAGE_REDIS_REST_TOKEN;

const redis = upstashUrl && upstashToken
  ? new Redis({ url: upstashUrl, token: upstashToken })
  : null;

// Cache Ratelimit instances per (action, limit, windowMs) tuple so we don't
// recreate them on every request.
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(action: string, limit: number, windowMs: number): Ratelimit | null {
  if (!redis) return null;
  const cacheKey = `${action}:${limit}:${windowMs}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      prefix: `rl:${action}`,
      analytics: false,
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

// Per-process in-memory fallback. Same semantics as the prior Map-based
// implementations: sliding window of timestamps per (action, identifier).
const memCache = new Map<string, number[]>();
let lastMemClean = 0;
function maybeCleanMemCache() {
  const now = Date.now();
  if (now - lastMemClean < 60_000) return;
  lastMemClean = now;
  for (const [key, entries] of memCache) {
    const valid = entries.filter(ts => ts > now - 3_600_000);
    if (valid.length === 0) memCache.delete(key);
    else memCache.set(key, valid);
  }
}

export interface RateLimitOutcome {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limit: number;
}

/**
 * Atomically check whether `identifier` may perform `action`, and (if Upstash
 * is configured) increment the count for that identifier. Falls back to
 * in-memory counting if Upstash isn't configured.
 *
 * Note: this is atomic check-and-increment. Even failed-downstream requests
 * count against the limit. This is intentional — otherwise an attacker can
 * keep firing requests that fail validation forever without hitting any cap.
 */
export async function checkAndIncrement(
  identifier: string,
  action: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitOutcome> {
  const limiter = getLimiter(action, limit, windowMs);

  if (limiter) {
    try {
      const r = await limiter.limit(identifier);
      return {
        allowed: r.success,
        remaining: Math.max(0, r.remaining),
        resetMs: Math.max(0, r.reset - Date.now()),
        limit,
      };
    } catch (err) {
      // Upstash hiccup — log and fall through to in-memory so we never
      // accidentally lock everyone out due to a transient Redis error.
      console.warn('[rate-limit] Upstash error, falling back to memory:', err instanceof Error ? err.message : err);
    }
  }

  maybeCleanMemCache();
  const key = `${action}:${identifier}`;
  const now = Date.now();
  const cutoff = now - windowMs;
  const entries = (memCache.get(key) || []).filter(t => t > cutoff);
  const allowed = entries.length < limit;
  if (allowed) entries.push(now);
  memCache.set(key, entries);
  const resetMs = entries.length > 0 ? Math.max(0, entries[0] + windowMs - now) : 0;
  return {
    allowed,
    remaining: Math.max(0, limit - entries.length),
    resetMs,
    limit,
  };
}

export function rateLimitBackend(): 'upstash' | 'memory' {
  return redis ? 'upstash' : 'memory';
}
