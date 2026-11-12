import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ResumeWorkspace } from "@/components/resume-workspace";
import { requireUser } from "@/lib/auth";
import { get, parseJson } from "@/lib/db";
import { getProfileContext } from "@/lib/profile";
import type { ChangeLogEntry, TailoredResumeContent, UnsupportedClaim } from "@/lib/resume/types";

export const dynamic = "force-dynamic";

export default async function TailoredResumePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const resume = get<{
    id: string;
    job_id: string;
    structured_content_json: string;
    change_log_json: string;
    unsupported_json: string;
    model_metadata_json: string;
    status: string;
    base_resume_id: string | null;
  }>("SELECT * FROM tailored_resumes WHERE id = ? AND user_id = ?", id, user.id);
  if (!resume) notFound();

  const job = get<{ id: string; title: string; company: string }>("SELECT id, title, company FROM jobs WHERE id = ?", resume.job_id);
  if (!job) notFound();
  const pkg = get<{ id: string }>(
    "SELECT id FROM application_packages WHERE user_id = ? AND resume_id = ? ORDER BY updated_at DESC LIMIT 1",
    user.id,
    id,
  );
  const base = resume.base_resume_id
    ? get<{ content_text: string }>("SELECT content_text FROM resume_documents WHERE id = ? AND user_id = ?", resume.base_resume_id, user.id)
    : getProfileContext(user.id).baseResume;

  return (
    <AppShell>
      <Link href={`/jobs/${job.id}`} className="mb-4 inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
        <ArrowLeft size={13} /> Back to the vacancy
      </Link>
      <PageHeader
        title={`Resume for ${job.title}`}
        description={`${job.company} · draft built only from your verified facts · review every change before you export or package it`}
        actions={
          <span className={resume.status === "user_approved" ? "chip-moss" : "chip-warn"}>
            <ShieldCheck size={10} /> {resume.status === "user_approved" ? "Approved by you" : "Draft — needs your approval"}
          </span>
        }
      />
      <ResumeWorkspace
        resumeId={resume.id}
        content={parseJson<TailoredResumeContent>(resume.structured_content_json, {} as TailoredResumeContent)}
        changeLog={parseJson<ChangeLogEntry[]>(resume.change_log_json, [])}
        unsupported={parseJson<UnsupportedClaim[]>(resume.unsupported_json, [])}
        metadata={parseJson(resume.model_metadata_json, {
          engine: "evidence-grounded",
          provider: "deterministic-rules-v1",
          evidenceUsed: 0,
          requirementsMatched: [],
          requirementsMissing: [],
          generatedAt: new Date().toISOString(),
          warnings: [],
        })}
        baseResumeText={base?.content_text ?? null}
        job={job}
        status={resume.status}
        packageId={pkg?.id ?? null}
      />
    </AppShell>
  );
}
