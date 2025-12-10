/**
 * Rate Limiter and Request Deduplication Utility
 *
 * Prevents:
 * - Too many API calls in a short time
 * - Duplicate simultaneous requests to the same endpoint
 * - Unnecessary API calls when data is fresh
 */

import Logger from './Logger';

const log = Logger.createLogger('RateLimiter');

interface RateLimitConfig {
  maxRequests: number; // Maximum number of requests allowed
  windowMs: number; // Time window in milliseconds
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// Default rate limit: 10 requests per minute
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60 * 1000,
};

// Cache duration: 30 seconds
const DEFAULT_CACHE_DURATION_MS = 30 * 1000;

class RateLimiterClass {
  private requestCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private pendingRequests: Map<string, Promise<any>> = new Map();
  private cache: Map<string, CacheEntry<any>> = new Map();
  private config: Map<string, RateLimitConfig> = new Map();

  /**
   * Set rate limit config for a specific endpoint pattern
   */
  setConfig(endpoint: string, config: RateLimitConfig): void {
    this.config.set(endpoint, config);
  }

  /**
   * Get rate limit config for an endpoint
   */
  private getConfig(endpoint: string): RateLimitConfig {
    // Check for exact match
    if (this.config.has(endpoint)) {
      return this.config.get(endpoint)!;
    }

    // Check for pattern matches
    for (const [pattern, config] of this.config.entries()) {
      if (endpoint.includes(pattern)) {
        return config;
      }
    }

    return DEFAULT_RATE_LIMIT;
  }

  /**
   * Check if a request is rate limited
   */
  isRateLimited(endpoint: string): { limited: boolean; retryAfterMs?: number } {
    const config = this.getConfig(endpoint);
    const key = this.getEndpointKey(endpoint);
    const now = Date.now();

    const entry = this.requestCounts.get(key);

    if (!entry || now >= entry.resetAt) {
      // No entry or window expired - not limited
      return { limited: false };
    }

    if (entry.count >= config.maxRequests) {
      const retryAfterMs = entry.resetAt - now;
      log.warn(`Rate limited: ${endpoint}, retry after ${retryAfterMs}ms`);
      return { limited: true, retryAfterMs };
    }

    return { limited: false };
  }

  /**
   * Record a request for rate limiting
   */
  recordRequest(endpoint: string): void {
    const config = this.getConfig(endpoint);
    const key = this.getEndpointKey(endpoint);
    const now = Date.now();

    const entry = this.requestCounts.get(key);

    if (!entry || now >= entry.resetAt) {
      // Start new window
      this.requestCounts.set(key, {
        count: 1,
        resetAt: now + config.windowMs,
      });
    } else {
      // Increment count in current window
      entry.count++;
    }
  }

  /**
   * Deduplicate requests - return existing promise if request is in flight
   */
  async deduplicateRequest<T>(
    key: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    // Check if same request is already in flight
    if (this.pendingRequests.has(key)) {
      log.debug(`Deduplicating request: ${key}`);
      return this.pendingRequests.get(key) as Promise<T>;
    }

    // Create new request
    const promise = requestFn()
      .finally(() => {
        this.pendingRequests.delete(key);
      });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Get cached response if available and fresh
   */
  getCachedResponse<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      // Cache expired
      this.cache.delete(key);
      return null;
    }

    log.debug(`Cache hit: ${key}`);
    return entry.data as T;
  }

  /**
   * Cache a response
   */
  cacheResponse<T>(key: string, data: T, durationMs: number = DEFAULT_CACHE_DURATION_MS): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + durationMs,
    });
  }

  /**
   * Clear cached response
   */
  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Wrap an API call with rate limiting, deduplication, and caching
   */
  async rateLimitedRequest<T>(
    endpoint: string,
    requestFn: () => Promise<T>,
    options: {
      skipCache?: boolean;
      cacheDurationMs?: number;
    } = {}
  ): Promise<T> {
    const { skipCache = false, cacheDurationMs = DEFAULT_CACHE_DURATION_MS } = options;
    const cacheKey = endpoint;

    // Check cache first
    if (!skipCache) {
      const cached = this.getCachedResponse<T>(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    // Check rate limit
    const rateLimitStatus = this.isRateLimited(endpoint);
    if (rateLimitStatus.limited) {
      throw new Error(
        `Too many requests. Please wait ${Math.ceil((rateLimitStatus.retryAfterMs || 0) / 1000)} seconds.`
      );
    }

    // Record this request
    this.recordRequest(endpoint);

    // Deduplicate and execute
    const result = await this.deduplicateRequest(cacheKey, requestFn);

    // Cache successful result
    this.cacheResponse(cacheKey, result, cacheDurationMs);

    return result;
  }

  /**
   * Get a simplified key for an endpoint (removes query params for grouping)
   */
  private getEndpointKey(endpoint: string): string {
    // Remove query parameters for rate limiting purposes
    // e.g., /api/parking?lat=1&lng=2 -> /api/parking
    const questionMarkIndex = endpoint.indexOf('?');
    return questionMarkIndex >= 0 ? endpoint.substring(0, questionMarkIndex) : endpoint;
  }

  /**
   * Get current rate limit status for debugging
   */
  getStatus(): {
    requestCounts: Record<string, { count: number; resetAt: number }>;
    pendingCount: number;
    cacheCount: number;
  } {
    return {
      requestCounts: Object.fromEntries(this.requestCounts),
      pendingCount: this.pendingRequests.size,
      cacheCount: this.cache.size,
    };
  }

  /**
   * Reset all rate limiting data
   */
  reset(): void {
    this.requestCounts.clear();
    this.pendingRequests.clear();
    this.cache.clear();
    log.info('Rate limiter reset');
  }
}

// Export singleton instance
export const RateLimiter = new RateLimiterClass();

// Configure rate limits for specific endpoints
RateLimiter.setConfig('/api/mobile/check-parking', { maxRequests: 5, windowMs: 60000 }); // 5/min
RateLimiter.setConfig('/api/push', { maxRequests: 3, windowMs: 60000 }); // 3/min

export default RateLimiter;
