import { get, parseJson } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";
import { getProfileContext } from "@/lib/profile";
import { extractRequirements } from "@/lib/matching/requirements";
import { draftApplicationMaterials } from "@/lib/resume/application-materials";
import type { TailoredResumeContent } from "@/lib/resume/types";

/**
 * FR-037: draft a cover letter and answers to the application questions, grounded in
 * verified facts. Nothing is persisted — the user edits and confirms in the workspace,
 * and the confirmed material is what the package assembles (and hashes).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const job = get<{
      id: string;
      title: string;
      company: string;
      location: string;
      description: string;
      requirements: string;
      status: string;
    }>("SELECT id, title, company, location, description, requirements, status FROM jobs WHERE id = ?", id);
    if (!job) return fail("Job not found.", 404);
    if (job.status === "closed") {
      return fail("This vacancy is closed, so no application material can be prepared for it.", 409);
    }

    const resume = get<{ id: string; structured_content_json: string; status: string }>(
      "SELECT id, structured_content_json, status FROM tailored_resumes WHERE user_id = ? AND job_id = ? ORDER BY created_at DESC LIMIT 1",
      user.id,
      id,
    );
    if (!resume) {
      return fail("Tailor a resume for this job first — the answers are built from the same verified facts.", 422, {
        code: "no_resume",
      });
    }

    const context = getProfileContext(user.id);
    if (!context.evidence.some((fact) => fact.verification_status === "verified")) {
      return fail("Verify at least one profile fact before drafting application material.", 422, { code: "no_evidence" });
    }

    const content = parseJson<TailoredResumeContent>(resume.structured_content_json, {} as TailoredResumeContent);
    const extracted = extractRequirements(`${job.description}\n${job.requirements}`, job.title);
    const held = new Set(
      context.evidence
        .filter((fact) => fact.verification_status === "verified" && fact.fact_type === "skill")
        .map((fact) => fact.title.toLowerCase()),
    );

    const materials = draftApplicationMaterials({
      job,
      profile: context.snapshot,
      preferences: context.preferences,
      resume: content,
      requirements: {
        matched: [...extracted.required, ...extracted.preferred]
          .map((requirement) => requirement.skill)
          .filter((skill) => held.has(skill)),
        missing: extracted.required.map((requirement) => requirement.skill).filter((skill) => !held.has(skill)),
      },
    });

    audit(user.id, "application_materials.drafted", "job", id, {
      resumeId: resume.id,
      answers: materials.answers.length,
      needsConfirmation: materials.answers.filter((answer) => answer.status === "needs_confirmation").length,
    });

    return json({ ok: true, resumeId: resume.id, resumeStatus: resume.status, materials });
  });
}
