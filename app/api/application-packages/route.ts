import { z } from "zod";
import { all, get, parseJson } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";
import { createPackage } from "@/lib/approvals";
import { generateCoverLetter } from "@/lib/resume/generate";
import { resumeToText } from "@/lib/resume/grounding";
import type { TailoredResumeContent } from "@/lib/resume/types";

const schema = z.object({
  jobId: z.string().uuid(),
  resumeId: z.string().uuid().nullable().optional(),
  includeCoverLetter: z.boolean().optional().default(false),
  coverLetter: z.string().max(8000).optional(),
  answers: z.array(z.object({ question: z.string().max(300), answer: z.string().max(2000) })).max(20).optional(),
});

export async function GET() {
  return withUser(async (user) =>
    json({
      packages: all(
        `SELECT p.*, j.title, j.company FROM application_packages p JOIN jobs j ON j.id = p.job_id
         WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
        user.id,
      ),
    }),
  );
}

export async function POST(request: Request) {
  return withUser(async (user) => {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Invalid package request.", 422);
    const { jobId, resumeId, includeCoverLetter, answers } = parsed.data;

    const job = get<{ id: string; title: string; company: string; application_url: string; canonical_url: string; status: string }>(
      "SELECT id, title, company, application_url, canonical_url, status FROM jobs WHERE id = ?",
      jobId,
    );
    if (!job) return fail("Job not found.", 404);
    if (job.status === "closed") return fail("This vacancy is closed.", 409);

    const resume = resumeId
      ? get<{ id: string; structured_content_json: string; status: string }>(
          "SELECT id, structured_content_json, status FROM tailored_resumes WHERE id = ? AND user_id = ?",
          resumeId,
          user.id,
        )
      : get<{ id: string; structured_content_json: string; status: string }>(
          "SELECT id, structured_content_json, status FROM tailored_resumes WHERE job_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1",
          jobId,
          user.id,
        );
    if (!resume) return fail("Generate a tailored resume for this job first.", 422);
    if (resume.status !== "user_approved") {
      return fail("Approve the tailored resume itself before assembling an application package.", 409, { code: "resume_not_approved" });
    }

    const content = parseJson<TailoredResumeContent>(resume.structured_content_json, {} as TailoredResumeContent);
    const coverLetter = parsed.data.coverLetter?.trim()
      ? parsed.data.coverLetter.trim()
      : includeCoverLetter
        ? generateCoverLetter(content, job.company, job.title)
        : "";

    const pkg = createPackage({
      userId: user.id,
      jobId,
      destinationUrl: job.application_url || job.canonical_url,
      resumeId: resume.id,
      resumeText: resumeToText(content),
      coverLetter,
      answers: answers ?? [],
    });
    audit(user.id, "package.assembled", "application_package", pkg.id, { jobId, resumeId: resume.id });
    return json({ ok: true, packageId: pkg.id, redirect: `/approvals/${pkg.id}` });
  });
}
