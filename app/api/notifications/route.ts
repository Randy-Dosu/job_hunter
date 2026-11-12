import { all, nowIso, run } from "@/lib/db";
import { json, withUser } from "@/lib/api";

export async function GET() {
  return withUser(async (user) =>
    json({ notifications: all("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", user.id) }),
  );
}

export async function POST() {
  return withUser(async (user) => {
    run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", nowIso(), user.id);
    return json({ ok: true });
  });
}
