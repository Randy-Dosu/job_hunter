import { all } from "@/lib/db";
import { json, withUser } from "@/lib/api";

/**
 * The caller's own audit trail (never another user's). Optional `action` prefix and
 * `limit` filters keep it usable from the tracker and export screens.
 */
export async function GET(request: Request) {
  return withUser(async (user) => {
    const url = new URL(request.url);
    const action = (url.searchParams.get("action") ?? "").trim();
    const limitParam = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 200) : 50;

    const events = action
      ? all(
          "SELECT * FROM audit_events WHERE user_id = ? AND action LIKE ? ORDER BY created_at DESC LIMIT ?",
          user.id,
          `${action}%`,
          limit,
        )
      : all("SELECT * FROM audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", user.id, limit);
    return json({ events });
  });
}
