import { all, get } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";
import { runSearch } from "@/lib/search";

export async function GET() {
  return withUser(async (user) =>
    json({ runs: all("SELECT * FROM search_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 20", user.id) }),
  );
}

export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = (await request.json().catch(() => ({}))) as { trigger?: string };
    const running = get<{ id: string }>(
      "SELECT id FROM search_runs WHERE user_id = ? AND status = 'running' AND started_at > ?",
      user.id,
      new Date(Date.now() - 2 * 60_000).toISOString(),
    );
    if (running) return fail("A search is already running. Give it a few seconds.", 409);
    const result = await runSearch(user.id, body.trigger === "scheduled" ? "scheduled" : "manual");
    audit(user.id, "search.triggered", "search_run", result.runId, { trigger: body.trigger ?? "manual" });
    return json({ ok: true, ...result });
  });
}
