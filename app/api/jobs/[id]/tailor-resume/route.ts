import { get, insert, nowIso, parseJson, uid } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";
import { getProfileContext } from "@/lib/profile";
import { generateTailoredResume } from "@/lib/resume/generate";
import type { TailoredResumeContent } from "@/lib/resume/types";
import { resumeToText } from "@/lib/resume/grounding";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const job = get<{
      id: string;
      title: string;
      company: string;
      description: string;
      requirements: string;
      seniority: string;
      location: string;
      status: string;
    }>("SELECT id, title, company, description, requirements, seniority, location, status FROM jobs WHERE id = ?", id);
    if (!job) return fail("Job not found.", 404);
    if (job.status === "closed") return fail("This vacancy is closed, so no application material can be prepared for it.", 409);

    const context = getProfileContext(user.id);
    const verified = context.evidence.filter((fact) => fact.verification_status === "verified");
    if (!verified.length) {
      return fail("Add and verify at least one profile fact before generating a resume.", 422, { code: "no_evidence" });
    }

    const claimed = get<{ id: string }>("SELECT id FROM jobs WHERE id = ? AND status = 'open'", id);
    if (!claimed) return fail("This vacancy is no longer open.", 409);

    const userRow = get<{ email: string; name: string }>("SELECT email, name FROM users WHERE id = ?", user.id)!;
    const contactLines = [
      context.profile.location,
      userRow.email,
      context.profile.phone,
      ...parseJson<{ label: string; url: string }[]>(context.profile.links_json, []).map((link) => link.url.replace(/^https?:\/\//, "")),
    ].filter(Boolean) as string[];

    const result = await generateTailoredResume({
      candidateName: userRow.name,
      contactLines,
      job,
      profile: context.snapshot,
      preferences: context.preferences,
      baseResumeText: context.baseResume?.content_text ?? null,
    });

    const resumeId = uid();
    insert("tailored_resumes", {
      id: resumeId,
      user_id: user.id,
      job_id: id,
      base_resume_id: context.baseResume?.id ?? null,
      structured_content_json: JSON.stringify(result.content),
      change_log_json: JSON.stringify(result.changeLog),
      unsupported_json: JSON.stringify(result.unsupported),
      model_metadata_json: JSON.stringify(result.metadata),
      status: "draft",
      version: 1,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    audit(user.id, "resume.generated", "tailored_resume", resumeId, {
      jobId: id,
      engine: result.metadata.engine,
      provider: result.metadata.provider,
      unsupported: result.unsupported.length,
      evidenceUsed: result.metadata.evidenceUsed,
    });

    return json({
      ok: true,
      resumeId,
      unsupported: result.unsupported.length,
      redirect: `/resumes/${resumeId}`,
      preview: resumeToText(result.content).slice(0, 200),
    });
  });
}

export type { TailoredResumeContent };
