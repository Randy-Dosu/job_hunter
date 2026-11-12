import { run } from "@/lib/db";
import { destroySession } from "@/lib/auth";
import { fail, json, withUser } from "@/lib/api";

export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = (await request.json().catch(() => ({}))) as { confirm?: string };
    if (body.confirm !== "DELETE") return fail('Type DELETE to confirm account deletion.', 422);
    run("DELETE FROM users WHERE id = ?", user.id);
    await destroySession();
    return json({ ok: true });
  });
}
