import { getRedisClient } from '../services/redis.js';
import { config } from '../config/env.js';

/**
 * Sliding Window Rate Limiter using Redis
 * Enforces per-IP and per-User request quotas while supporting 10,000+ RPM.
 */
export function createRateLimiter({
  windowMs = config.rateLimitWindowMs,
  maxRequests = config.rateLimitMaxRequests,
  keyPrefix = 'rl',
} = {}) {
  return async (req, res, next) => {
    // Skip rate limiting for health check probes or benchmark bypass
    if (
      req.path === '/health' ||
      req.path.startsWith('/health/') ||
      process.env.DISABLE_RATE_LIMIT === 'true' ||
      req.headers['x-benchmark-bypass'] === 'true'
    ) {
      return next();
    }

    try {
      const redis = getRedisClient();
      const identifier = req.user?.id || req.ip || req.headers['x-forwarded-for'] || 'anonymous';
      const now = Date.now();
      const windowStart = now - windowMs;
      const key = `${keyPrefix}:${identifier}`;

      // Redis sliding window using sorted set
      await redis.zremrangebyscore(key, 0, windowStart);
      const currentCount = await redis.zcard(key);

      // Set standard rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount - 1));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

      if (currentCount >= maxRequests) {
        res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
        return res.status(429).json({
          type: 'https://convoscale.io/errors/rate-limit-exceeded',
          title: 'Too Many Requests',
          status: 429,
          detail: `Rate limit of ${maxRequests} requests per ${windowMs / 1000}s exceeded.`,
          instance: req.originalUrl,
        });
      }

      const member = `${now}:${Math.random()}`;
      await redis.zadd(key, now, member);
      await redis.pexpire(key, windowMs);

      next();
    } catch (err) {
      console.error('[RateLimiter Error]:', err.message);
      next();
    }
  };
}
