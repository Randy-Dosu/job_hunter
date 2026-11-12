import { z } from "zod";
import { get, nowIso, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";

const schema = z.object({ feedback: z.enum(["relevant", "not_relevant", "dismissed", "applied"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Unknown feedback value.", 422);
    const match = get<{ id: string }>("SELECT id FROM job_matches WHERE user_id = ? AND job_id = ?", user.id, id);
    if (!match) return fail("Match not found.", 404);
    run("UPDATE job_matches SET feedback = ? WHERE id = ?", parsed.data.feedback, match.id);
    audit(user.id, "match.feedback", "job_match", match.id, { feedback: parsed.data.feedback, jobId: id, at: nowIso() });
    return json({ ok: true });
  });
}
