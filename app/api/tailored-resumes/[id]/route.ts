import { z } from "zod";
import { get, nowIso, parseJson, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";
import { validateResume } from "@/lib/resume/grounding";
import { invalidateApprovalsForResume } from "@/lib/approvals";
import { getProfileContext } from "@/lib/profile";
import type { TailoredResumeContent } from "@/lib/resume/types";

const schema = z.object({
  summary: z.string().max(1200).optional(),
  headline: z.string().max(200).optional(),
  status: z.enum(["draft", "user_approved"]).optional(),
  resolutionNotes: z.string().max(2000).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const row = get<Record<string, unknown>>("SELECT * FROM tailored_resumes WHERE id = ? AND user_id = ?", id, user.id);
    if (!row) return fail("Resume not found.", 404);
    return json({ resume: row });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const row = get<{
      id: string;
      structured_content_json: string;
      change_log_json: string;
      status: string;
    }>("SELECT * FROM tailored_resumes WHERE id = ? AND user_id = ?", id, user.id);
    if (!row) return fail("Resume not found.", 404);

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Invalid resume edit.", 422);
    const data = parsed.data;

    const content = parseJson<TailoredResumeContent>(row.structured_content_json, {} as TailoredResumeContent);
    if (data.summary !== undefined) {
      content.summary = { ...content.summary, text: data.summary.trim() };
    }
    if (data.headline !== undefined) {
      content.headline = { ...content.headline, text: data.headline.trim() };
    }

    const context = getProfileContext(user.id);
    const unsupported = validateResume(content, context.snapshot.facts);
    const changeLog = parseJson<unknown[]>(row.change_log_json, []);
    if (data.summary !== undefined || data.headline !== undefined) {
      changeLog.push({
        id: crypto.randomUUID(),
        type: "rewritten",
        section: data.summary !== undefined ? "Summary" : "Headline",
        description: "Edited manually by you. Every change was re-checked against your verified facts.",
        evidenceIds: content.summary.evidenceIds,
      });
    }

    const contentChanged = data.summary !== undefined || data.headline !== undefined;
    // Any material edit drops the resume back to draft and revokes approvals
    // that referenced the previous version (PRD FR-042).
    const nextStatus = contentChanged ? "draft" : (data.status ?? row.status);

    run(
      "UPDATE tailored_resumes SET structured_content_json = ?, change_log_json = ?, unsupported_json = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      JSON.stringify(content),
      JSON.stringify(changeLog),
      JSON.stringify(unsupported),
      nextStatus,
      nowIso(),
      id,
      user.id,
    );

    const revokedPackages = invalidateApprovalsForResume(user.id, id);
    audit(user.id, contentChanged ? "resume.edited" : "resume.approved_by_user", "tailored_resume", id, {
      unsupported: unsupported.length,
      revokedPackages,
    });

    return json({ ok: true, unsupported });
  });
}
