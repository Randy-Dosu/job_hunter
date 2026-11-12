import { get } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { fail, json, tooMany } from "@/lib/api";
import { clientKey, rateLimit } from "@/lib/ratelimit";

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "demo"), 20, 5 * 60_000);
  if (!limit.ok) return tooMany(limit.retryAfterMs, "The demo account is rate limited. Try again shortly.");
  const demo = get<{ id: string }>("SELECT id FROM users WHERE email = ?", "demo@jobhunter.app");
  if (!demo) return fail("The demo account is not available in this environment.", 404);
  await createSession(demo.id);
  return json({ ok: true, redirect: "/dashboard" });
}
