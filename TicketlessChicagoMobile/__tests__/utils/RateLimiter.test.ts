/**
 * Unit tests for RateLimiter utility
 */

// Reset modules before each test to get fresh RateLimiter instance
beforeEach(() => {
  jest.resetModules();
});

describe('RateLimiter', () => {
  let RateLimiter: any;

  beforeEach(() => {
    // Get a fresh instance for each test
    const module = require('../../src/utils/RateLimiter');
    RateLimiter = module.RateLimiter;
    RateLimiter.reset();
  });

  describe('isRateLimited', () => {
    it('should not rate limit first request', () => {
      const result = RateLimiter.isRateLimited('/api/test');
      expect(result.limited).toBe(false);
    });

    it('should rate limit after exceeding max requests', () => {
      // Set strict limit for testing
      RateLimiter.setConfig('/api/test', { maxRequests: 2, windowMs: 60000 });

      // First two requests should succeed
      RateLimiter.recordRequest('/api/test');
      expect(RateLimiter.isRateLimited('/api/test').limited).toBe(false);

      RateLimiter.recordRequest('/api/test');
      expect(RateLimiter.isRateLimited('/api/test').limited).toBe(false);

      // Third request should be rate limited
      RateLimiter.recordRequest('/api/test');
      const result = RateLimiter.isRateLimited('/api/test');
      expect(result.limited).toBe(true);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should track different endpoints separately', () => {
      RateLimiter.setConfig('/api/a', { maxRequests: 1, windowMs: 60000 });
      RateLimiter.setConfig('/api/b', { maxRequests: 1, windowMs: 60000 });

      RateLimiter.recordRequest('/api/a');
      RateLimiter.recordRequest('/api/a');

      expect(RateLimiter.isRateLimited('/api/a').limited).toBe(true);
      expect(RateLimiter.isRateLimited('/api/b').limited).toBe(false);
    });
  });

  describe('recordRequest', () => {
    it('should increment request count', () => {
      RateLimiter.recordRequest('/api/test');
      RateLimiter.recordRequest('/api/test');

      const status = RateLimiter.getStatus();
      expect(status.requestCounts['/api/test']?.count).toBe(2);
    });
  });

  describe('deduplicateRequest', () => {
    it('should return same promise for duplicate requests', async () => {
      let callCount = 0;
      const requestFn = () => {
        callCount++;
        return new Promise<string>((resolve) => {
          setTimeout(() => resolve('result'), 100);
        });
      };

      // Start two requests with same key simultaneously
      const promise1 = RateLimiter.deduplicateRequest('key1', requestFn);
      const promise2 = RateLimiter.deduplicateRequest('key1', requestFn);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(callCount).toBe(1); // Function should only be called once
    });

    it('should allow different keys to run in parallel', async () => {
      let callCount = 0;
      const requestFn = () => {
        callCount++;
        return Promise.resolve('result');
      };

      await Promise.all([
        RateLimiter.deduplicateRequest('key1', requestFn),
        RateLimiter.deduplicateRequest('key2', requestFn),
      ]);

      expect(callCount).toBe(2);
    });
  });

  describe('caching', () => {
    it('should cache responses', () => {
      RateLimiter.cacheResponse('key1', { data: 'test' }, 60000);
      const cached = RateLimiter.getCachedResponse('key1');
      expect(cached).toEqual({ data: 'test' });
    });

    it('should return null for non-existent cache', () => {
      const cached = RateLimiter.getCachedResponse('nonexistent');
      expect(cached).toBeNull();
    });

    it('should expire cache after duration', () => {
      // Cache with very short duration
      RateLimiter.cacheResponse('key1', { data: 'test' }, 1);

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const cached = RateLimiter.getCachedResponse('key1');
          expect(cached).toBeNull();
          resolve();
        }, 10);
      });
    });

    it('should clear specific cache key', () => {
      RateLimiter.cacheResponse('key1', { data: '1' });
      RateLimiter.cacheResponse('key2', { data: '2' });

      RateLimiter.clearCache('key1');

      expect(RateLimiter.getCachedResponse('key1')).toBeNull();
      expect(RateLimiter.getCachedResponse('key2')).toEqual({ data: '2' });
    });

    it('should clear all cache', () => {
      RateLimiter.cacheResponse('key1', { data: '1' });
      RateLimiter.cacheResponse('key2', { data: '2' });

      RateLimiter.clearCache();

      expect(RateLimiter.getCachedResponse('key1')).toBeNull();
      expect(RateLimiter.getCachedResponse('key2')).toBeNull();
    });
  });

  describe('rateLimitedRequest', () => {
    it('should return cached response when available', async () => {
      let callCount = 0;
      const requestFn = async () => {
        callCount++;
        return { data: 'fresh' };
      };

      // Cache a response
      RateLimiter.cacheResponse('/api/test', { data: 'cached' }, 60000);

      // Request should return cached value
      const result = await RateLimiter.rateLimitedRequest('/api/test', requestFn);

      expect(result).toEqual({ data: 'cached' });
      expect(callCount).toBe(0); // Request function should not be called
    });

    it('should skip cache when skipCache is true', async () => {
      let callCount = 0;
      const requestFn = async () => {
        callCount++;
        return { data: 'fresh' };
      };

      // Cache a response
      RateLimiter.cacheResponse('/api/test', { data: 'cached' }, 60000);

      // Request should skip cache
      const result = await RateLimiter.rateLimitedRequest('/api/test', requestFn, {
        skipCache: true,
      });

      expect(result).toEqual({ data: 'fresh' });
      expect(callCount).toBe(1);
    });

    it('should throw error when rate limited', async () => {
      RateLimiter.setConfig('/api/limited', { maxRequests: 0, windowMs: 60000 });
      RateLimiter.recordRequest('/api/limited'); // Exceed limit

      await expect(
        RateLimiter.rateLimitedRequest('/api/limited', async () => ({}))
      ).rejects.toThrow('Too many requests');
    });
  });

  describe('getStatus', () => {
    it('should return current status', () => {
      RateLimiter.recordRequest('/api/test');
      RateLimiter.cacheResponse('cache1', { data: '1' });

      const status = RateLimiter.getStatus();

      expect(status.requestCounts).toBeDefined();
      expect(status.pendingCount).toBe(0);
      expect(status.cacheCount).toBe(1);
    });
  });

  describe('reset', () => {
    it('should clear all data', () => {
      RateLimiter.recordRequest('/api/test');
      RateLimiter.cacheResponse('key1', { data: '1' });

      RateLimiter.reset();

      const status = RateLimiter.getStatus();
      expect(Object.keys(status.requestCounts).length).toBe(0);
      expect(status.cacheCount).toBe(0);
    });
  });
});
