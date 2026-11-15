/**
 * In-memory sliding-window rate limiter.
 *
 * Sufficient for a single free-tier instance. For multi-instance deployments the
 * same interface can be implemented over Postgres/Upstash without touching
 * callers (see `RateLimiter`).
 */

export interface RateLimiter {
  /** Returns the decision and how long the caller should wait. */
  check(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number };
  reset(key?: string): void;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: (() => number) | undefined;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const hits = new Map<string, number[]>();
  const now = options.now ?? Date.now;

  // Opportunistic cleanup so a long-lived process does not leak memory.
  let lastSweep = now();
  const sweep = (current: number) => {
    if (current - lastSweep < options.windowMs) return;
    lastSweep = current;
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((time) => current - time < options.windowMs);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  };

  return {
    check(key) {
      const current = now();
      sweep(current);
      const existing = (hits.get(key) ?? []).filter((time) => current - time < options.windowMs);
      if (existing.length >= options.limit) {
        const oldest = existing[0] ?? current;
        const retryAfterMs = Math.max(0, options.windowMs - (current - oldest));
        hits.set(key, existing);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }
      existing.push(current);
      hits.set(key, existing);
      return {
        allowed: true,
        remaining: Math.max(0, options.limit - existing.length),
        retryAfterSeconds: 0,
      };
    },
    reset(key) {
      if (key) hits.delete(key);
      else hits.clear();
    },
  };
}
