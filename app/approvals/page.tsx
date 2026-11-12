import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { EmptyState, formatDate } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, get, parseJson } from "@/lib/db";
import { computePackageHash } from "@/lib/approvals";
import { resumeToText } from "@/lib/resume/grounding";
import type { TailoredResumeContent } from "@/lib/resume/types";
import type { PackageRow } from "@/lib/approvals";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const user = await requireUser();
  const packages = all<PackageRow & { title: string; company: string; source_name: string }>(
    `SELECT p.*, j.title, j.company, s.name AS source_name
     FROM application_packages p
     JOIN jobs j ON j.id = p.job_id
     JOIN job_sources s ON s.id = j.source_id
     WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
    user.id,
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Consent"
        title="Approval centre"
        description="Approval is bound to one vacancy and one exact package hash. If any material changes, the approval expires and must be given again."
      />

      {packages.length ? (
        <div className="space-y-3">
          {packages.map((pkg) => {
            const resume = pkg.resume_id
              ? get<{ structured_content_json: string }>("SELECT structured_content_json FROM tailored_resumes WHERE id = ? AND user_id = ?", pkg.resume_id, user.id)
              : null;
            const currentHash = resume
              ? computePackageHash({
                  jobId: pkg.job_id,
                  destinationUrl: pkg.destination_url,
                  resumeText: resumeToText(parseJson<TailoredResumeContent>(resume.structured_content_json, {} as TailoredResumeContent)),
                  coverLetter: pkg.cover_letter,
                  answers: parseJson(pkg.answers_json, []),
                })
              : pkg.package_hash;
            const approval = get<{ approval_hash: string; revoked_at: string | null }>(
              "SELECT approval_hash, revoked_at FROM application_approvals WHERE package_id = ? AND revoked_at IS NULL ORDER BY approved_at DESC LIMIT 1",
              pkg.id,
            );
            const approvalValid = Boolean(approval && approval.approval_hash === currentHash);
            return (
              <article key={pkg.id} className="card p-4 transition hover:border-slate-300">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/approvals/${pkg.id}`} className="text-sm font-semibold text-slate-900 hover:text-brand-700">
                      {pkg.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {pkg.company} · {pkg.source_name} · assembled {formatDate(pkg.updated_at, { day: "numeric", month: "short" })}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-slate-400">Destination: {pkg.destination_url}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span
                      className={
                        approvalValid
                          ? "badge-strong"
                          : pkg.status === "SUBMITTED"
                            ? "badge-neutral"
                            : pkg.status === "SUBMISSION_PENDING"
                              ? "badge-possible"
                              : "badge-possible"
                      }
                    >
                      <ShieldCheck size={10} />
                      {approvalValid ? "Approved" : pkg.status.replaceAll("_", " ").toLowerCase()}
                    </span>
                    <Link href={`/approvals/${pkg.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                      Review package <ArrowRight size={12} />
                    </Link>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-400">
                  <span>{pkg.cover_letter ? "Cover letter included" : "No cover letter"}</span>
                  <span>Hash {pkg.package_hash.slice(0, 10)}…</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<ShieldCheck size={20} />}
          title="No application packages yet"
          description="Tailor a resume from any job, approve it, then assemble a package. Nothing can be submitted without a package-specific approval."
          action={{ href: "/jobs", label: "Find a job to tailor for" }}
        />
      )}
    </AppShell>
  );
}
