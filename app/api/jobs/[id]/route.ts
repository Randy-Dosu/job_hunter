import { getMatch } from "@/lib/search";
import { fail, json, withUser } from "@/lib/api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const entry = getMatch(user.id, id);
    if (!entry) return fail("Job not found in your feed.", 404);
    return json({
      job: entry.job,
      match: entry.match,
    });
  });
}
