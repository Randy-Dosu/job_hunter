import { createSession, registerUser } from "@/lib/auth";
import { fail, json, tooMany } from "@/lib/api";
import { AUTH_LIMIT, clientKey, rateLimit } from "@/lib/ratelimit";

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "signup"), AUTH_LIMIT.limit, AUTH_LIMIT.windowMs);
  if (!limit.ok) return tooMany(limit.retryAfterMs, "Too many sign-up attempts from this address.");
  const body = (await request.json().catch(() => ({}))) as { name?: string; email?: string; password?: string };
  if (!body.email || !body.password) return fail("Email and password are required.");
  const result = registerUser({ name: body.name ?? "", email: body.email, password: body.password });
  if (!result.ok) return fail(result.error, 400);
  await createSession(result.userId);
  return json({ ok: true, redirect: "/onboarding" });
}
