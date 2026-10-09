import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../db.js';

/**
 * Simple in-memory rate limiter.
 * Limits requests per IP per time window.
 *
 * Environment variables:
 *   RATE_LIMIT_ENABLED - 'true' to enable (default: true)
 *   RATE_LIMIT_MAX - max requests per window (default: 100)
 *   RATE_LIMIT_WINDOW_MS - window in milliseconds (default: 60000 = 1 minute)
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

export function rateLimiter(): MiddlewareHandler<AppEnv> {
  const enabled = process.env.RATE_LIMIT_ENABLED !== 'false';
  const maxRequests = Number(process.env.RATE_LIMIT_MAX ?? 100);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);

  return async (c, next) => {
    if (!enabled) {
      await next();
      return;
    }

    // Get client IP
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';

    const now = Date.now();
    let entry = store.get(ip);

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      store.set(ip, entry);
    }

    entry.count++;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({
        success: false,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      }, 429);
    }

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(maxRequests - entry.count));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetTime / 1000)));

    await next();
  };
}
