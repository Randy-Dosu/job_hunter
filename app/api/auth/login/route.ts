import { createSession, loginUser } from "@/lib/auth";
import { fail, json, tooMany } from "@/lib/api";
import { AUTH_LIMIT, clientKey, rateLimit } from "@/lib/ratelimit";

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "login"), AUTH_LIMIT.limit, AUTH_LIMIT.windowMs);
  if (!limit.ok) return tooMany(limit.retryAfterMs, "Too many sign-in attempts. Wait a few minutes and try again.");
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password) return fail("Email and password are required.");
  const result = loginUser({ email: body.email, password: body.password });
  if (!result.ok) return fail(result.error, 401);
  await createSession(result.userId);
  return json({ ok: true, redirect: "/dashboard" });
}
