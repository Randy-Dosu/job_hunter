import { createSession, loginUser } from "@/lib/auth";
import { fail, json } from "@/lib/api";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password) return fail("Email and password are required.");
  const result = loginUser({ email: body.email, password: body.password });
  if (!result.ok) return fail(result.error, 401);
  await createSession(result.userId);
  return json({ ok: true, redirect: "/dashboard" });
}
