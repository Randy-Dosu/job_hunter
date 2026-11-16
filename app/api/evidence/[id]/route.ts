import { z } from "zod";
import { get, nowIso, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";

const patchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  organization: z.string().max(160).optional(),
  location: z.string().max(120).optional(),
  startDate: z.string().max(20).nullable().optional(),
  endDate: z.string().max(20).nullable().optional(),
  bullets: z.array(z.string().max(600)).max(20).optional(),
  state: z.string().max(20).optional(),
  verificationStatus: z.enum(["verified", "unverified", "outdated"]).optional(),
  evidenceNote: z.string().max(400).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const existing = get<Record<string, unknown>>("SELECT * FROM profile_evidence WHERE id = ? AND user_id = ?", id, user.id);
    if (!existing) return fail("Fact not found.", 404);
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Invalid fact update.", 422);
    const data = parsed.data;
    run(
      `UPDATE profile_evidence SET title = ?, organization = ?, location = ?, start_date = ?, end_date = ?,
       bullets_json = ?, state = ?, verification_status = ?, evidence_note = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      data.title ?? (existing.title as string),
      data.organization ?? (existing.organization as string),
      data.location ?? (existing.location as string),
      data.startDate !== undefined ? data.startDate : (existing.start_date as string | null),
      data.endDate !== undefined ? data.endDate : (existing.end_date as string | null),
      data.bullets ? JSON.stringify(data.bullets) : (existing.bullets_json as string),
      data.state ?? (existing.state as string),
      data.verificationStatus ?? (existing.verification_status as string),
      data.evidenceNote ?? (existing.evidence_note as string),
      nowIso(),
      id,
      user.id,
    );
    audit(user.id, "evidence.updated", "profile_evidence", id, { verificationStatus: data.verificationStatus });
    return json({ ok: true });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const existing = get("SELECT id FROM profile_evidence WHERE id = ? AND user_id = ?", id, user.id);
    if (!existing) return fail("Fact not found.", 404);
    run("DELETE FROM profile_evidence WHERE id = ? AND user_id = ?", id, user.id);
    audit(user.id, "evidence.deleted", "profile_evidence", id);
    return json({ ok: true });
  });
}
