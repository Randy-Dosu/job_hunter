import { z } from "zod";
import { all, insert, nowIso, uid } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";

const factSchema = z.object({
  factType: z.enum(["experience", "education", "skill", "certification", "achievement"]),
  title: z.string().min(1).max(160),
  organization: z.string().max(160).optional().default(""),
  location: z.string().max(120).optional().default(""),
  startDate: z.string().max(20).nullable().optional(),
  endDate: z.string().max(20).nullable().optional(),
  bullets: z.array(z.string().max(600)).max(20).optional().default([]),
  skills: z.array(z.string().max(80)).max(30).optional().default([]),
  state: z.string().max(20).optional().default(""),
  verificationStatus: z.enum(["verified", "unverified", "outdated"]).optional().default("unverified"),
  evidenceNote: z.string().max(400).optional().default(""),
});

export async function GET() {
  return withUser(async (user) =>
    json({ evidence: all("SELECT * FROM profile_evidence WHERE user_id = ? ORDER BY fact_type, start_date DESC", user.id) }),
  );
}

export async function POST(request: Request) {
  return withUser(async (user) => {
    const body = (await request.json().catch(() => ({}))) as { documentId?: string; items?: unknown };
    const items = z.array(factSchema).max(120).safeParse(body.items);
    if (!items.success) return fail("Some extracted facts were invalid.", 422);
    const now = nowIso();
    for (const fact of items.data) {
      insert("profile_evidence", {
        id: uid(),
        user_id: user.id,
        fact_type: fact.factType,
        title: fact.title,
        organization: fact.organization ?? "",
        location: fact.location ?? "",
        start_date: fact.startDate ?? null,
        end_date: fact.endDate ?? null,
        bullets_json: JSON.stringify(fact.bullets ?? []),
        skills_json: JSON.stringify(fact.skills ?? []),
        state: fact.state ?? "",
        verification_status: fact.verificationStatus ?? "unverified",
        source_document_id: body.documentId ?? null,
        evidence_note:
          fact.evidenceNote ||
          `Imported from ${body.documentId ? "your uploaded resume" : "your profile"} — ${
            fact.verificationStatus === "verified" ? "confirmed by you" : "awaiting your confirmation"
          }.`,
        created_at: now,
        updated_at: now,
      });
    }
    audit(user.id, "evidence.imported", "profile_evidence", body.documentId ?? "", { count: items.data.length });
    return json({ ok: true, count: items.data.length });
  });
}
