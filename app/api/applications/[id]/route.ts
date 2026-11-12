import { z } from "zod";
import { get, nowIso, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";

const schema = z.object({
  status: z
    .enum([
      "saved",
      "reviewing",
      "preparing",
      "approved",
      "awaiting_manual_completion",
      "confirmation_pending",
      "submitted",
      "interview",
      "rejected",
      "withdrawn",
      "closed",
      "offer",
    ])
    .optional(),
  notes: z.string().max(4000).optional(),
  nextAction: z.string().max(300).optional(),
  nextActionAt: z.string().max(40).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const existing = get<Record<string, unknown>>("SELECT * FROM applications WHERE id = ? AND user_id = ?", id, user.id);
    if (!existing) return fail("Application not found.", 404);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Invalid status update. Use /submit to record a submission.", 422);
    const data = parsed.data;
    run(
      `UPDATE applications SET status = ?, notes = ?, next_action = ?, next_action_at = ?, last_updated_at = ? WHERE id = ? AND user_id = ?`,
      data.status ?? (existing.status as string),
      data.notes ?? (existing.notes as string),
      data.nextAction ?? (existing.next_action as string),
      data.nextActionAt !== undefined ? data.nextActionAt : (existing.next_action_at as string | null),
      nowIso(),
      id,
      user.id,
    );
    audit(user.id, "application.status_changed", "application", id, { from: existing.status, to: data.status ?? existing.status });
    return json({ ok: true });
  });
}
