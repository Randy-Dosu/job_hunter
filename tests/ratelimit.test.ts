import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { useTempDatabase } from "./helpers";

const temp = useTempDatabase();

let limiter: typeof import("@/lib/ratelimit");
let db: typeof import("@/lib/db");

beforeEach(async () => {
  limiter = await import("@/lib/ratelimit");
  db = await import("@/lib/db");
  limiter.resetRateLimits();
});

afterAll(() => temp.cleanup());

describe("sliding window limiter", () => {
  it("allows up to the limit inside the window", () => {
    const now = 1_000_000;
    for (let index = 0; index < 3; index++) {
      expect(limiter.rateLimit("k", 3, 60_000, now + index).ok).toBe(true);
    }
    const blocked = limiter.rateLimit("k", 3, 60_000, now + 4);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("frees capacity once the window slides", () => {
    const now = 1_000_000;
    limiter.rateLimit("slide", 1, 60_000, now);
    expect(limiter.rateLimit("slide", 1, 60_000, now + 30_000).ok).toBe(false);
    expect(limiter.rateLimit("slide", 1, 60_000, now + 60_001).ok).toBe(true);
  });

  it("keeps keys independent", () => {
    const now = 1_000_000;
    limiter.rateLimit("ip-a", 1, 60_000, now);
    expect(limiter.rateLimit("ip-a", 1, 60_000, now).ok).toBe(false);
    expect(limiter.rateLimit("ip-b", 1, 60_000, now).ok).toBe(true);
  });

  it("derives the client key from forwarded headers", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(limiter.clientKey(request, "login")).toBe("login:203.0.113.9");
    const anonymous = new Request("http://localhost/api/auth/login");
    expect(limiter.clientKey(anonymous, "login")).toBe("login:unknown");
  });
});

describe("auth endpoint protection", () => {
  it("returns 429 with retry-after after repeated failed sign-ins", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const attempt = () =>
      POST(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
          body: JSON.stringify({ email: "nobody@test.local", password: "wrong-password" }),
        }),
      );

    for (let index = 0; index < limiter.AUTH_LIMIT.limit; index++) {
      const response = await attempt();
      expect(response.status).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const body = (await blocked.json()) as { retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not block a different address", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    for (let index = 0; index < limiter.AUTH_LIMIT.limit; index++) {
      await POST(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.8" },
          body: JSON.stringify({ email: "nobody@test.local", password: "wrong-password" }),
        }),
      );
    }
    const other = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
        body: JSON.stringify({ email: "nobody@test.local", password: "wrong-password" }),
      }),
    );
    expect(other.status).toBe(401);
    // Failed sign-ins never create or reveal an account.
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count).toBe(0);
  });
});
