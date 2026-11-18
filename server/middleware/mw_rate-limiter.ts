import { Request, Response, NextFunction } from "express";
import { logger } from "../../src/core/logger/logger";

export interface RateLimiterOptions {
  name: string;
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
}

interface BucketEntry {
  timestamps: number[];
  lastSeen: number;
}

const ALL_LIMITERS = new Set<Map<string, BucketEntry>>();

export function resetAllRateLimiters(): void {
  for (const store of ALL_LIMITERS) {
    store.clear();
  }
}

export function extractClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Sliding-window per-key rate limiter middleware.
 * Returns HTTP 429 with Retry-After and X-RateLimit-* headers when exceeded.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, BucketEntry>();
  ALL_LIMITERS.add(buckets);

  const MAX_BUCKETS = 5000;

  return function mwRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const windowStart = now - options.windowMs;
    const key = options.keyGenerator ? options.keyGenerator(req) : extractClientIp(req);

    // Bounded cleanup to avoid unbounded memory growth
    if (buckets.size > MAX_BUCKETS) {
      for (const [k, entry] of buckets.entries()) {
        if (entry.lastSeen < windowStart) {
          buckets.delete(k);
        }
      }
      if (buckets.size > MAX_BUCKETS) {
        const firstKey = buckets.keys().next().value;
        if (firstKey !== undefined) buckets.delete(firstKey);
      }
    }

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [], lastSeen: now };
    }

    bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);
    bucket.lastSeen = now;

    const resetEpochSec = Math.ceil((now + options.windowMs) / 1000);
    res.setHeader("X-RateLimit-Limit", String(options.maxRequests));
    res.setHeader("X-RateLimit-Reset", String(resetEpochSec));

    if (bucket.timestamps.length >= options.maxRequests) {
      const oldestInWindow = bucket.timestamps[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((oldestInWindow + options.windowMs - now) / 1000));
      buckets.set(key, bucket);

      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("Retry-After", String(retryAfterSec));

      logger.recordMetric("rate_limit");
      logger.warn(`Rate limit exceeded on [${options.name}]`, {
        module: "rate-limiter",
        action: options.name,
        tenantId: req.tenantContext?.tenantId,
        userId: req.authUser?.uid,
        meta: { key, limit: options.maxRequests, windowMs: options.windowMs },
      });

      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message:
            options.message ||
            "Prea multe cereri într-un interval scurt. Vă rugăm să reîncercați în câteva secunde.",
        },
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    bucket.timestamps.push(now);
    buckets.set(key, bucket);
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, options.maxRequests - bucket.timestamps.length)));
    next();
  };
}
