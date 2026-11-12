import { get } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { fail, json } from "@/lib/api";

export async function POST() {
  const demo = get<{ id: string }>("SELECT id FROM users WHERE email = ?", "demo@jobhunter.app");
  if (!demo) return fail("The demo account is not available in this environment.", 404);
  await createSession(demo.id);
  return json({ ok: true, redirect: "/dashboard" });
}
