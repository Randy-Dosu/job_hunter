import { get } from "@/lib/db";
import { fail, json, withUser } from "@/lib/api";

/** Read one search run: counts, per-source status and error summary. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const run = get<Record<string, unknown>>(
      "SELECT * FROM search_runs WHERE id = ? AND user_id = ?",
      id,
      user.id,
    );
    if (!run) return fail("Search run not found.", 404);
    return json({ run });
  });
}
