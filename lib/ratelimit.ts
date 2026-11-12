/**
 * Small in-process sliding-window limiter for unauthenticated endpoints.
 *
 * This is deliberately not distributed: it protects a single Node process from
 * credential stuffing and accidental loops. A multi-instance deployment should
 * put the same policy in front of the app (or move the store to Redis); the
 * limits themselves are the contract, not this implementation.
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 5000;

export type LimitResult = { ok: boolean; remaining: number; retryAfterMs: number; limit: number };

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): LimitResult {
  const expiry = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((stamp) => stamp > expiry);
  if (hits.length >= limit) {
    const oldest = hits[0];
    buckets.set(key, hits);
    return { ok: false, remaining: 0, retryAfterMs: Math.max(0, oldest + windowMs - now), limit };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) {
    // Drop the least recently used key rather than growing without bound.
    const oldestKey = buckets.keys().next().value;
    if (oldestKey !== undefined) buckets.delete(oldestKey);
  }
  return { ok: true, remaining: Math.max(0, limit - hits.length), retryAfterMs: 0, limit };
}

/** Best-effort client identity for unauthenticated requests. */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

export function resetRateLimits() {
  buckets.clear();
}

export const AUTH_LIMIT = { limit: 10, windowMs: 5 * 60_000 };
