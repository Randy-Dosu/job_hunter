import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Callout, CompanyMark, EmptyState, formatDate } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, get, parseJson } from "@/lib/db";
import { computePackageHash, type PackageRow } from "@/lib/approvals";
import { resumeToText } from "@/lib/resume/grounding";
import type { TailoredResumeContent } from "@/lib/resume/types";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "chip" },
  PENDING_APPROVAL: { label: "Awaiting approval", className: "chip-warn" },
  SUBMISSION_PENDING: { label: "Approved — ready to submit", className: "chip-moss" },
  SUBMITTED: { label: "Marked submitted", className: "chip" },
  REVOKED: { label: "Approval revoked", className: "chip-clay" },
};

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

  const rows = packages.map((pkg) => {
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
    const approval = get<{ approval_hash: string; revoked_at: string | null; approved_at: string }>(
      "SELECT approval_hash, revoked_at, approved_at FROM application_approvals WHERE package_id = ? AND revoked_at IS NULL ORDER BY approved_at DESC LIMIT 1",
      pkg.id,
    );
    return { pkg, valid: Boolean(approval && approval.approval_hash === currentHash), approval };
  });

  const waiting = rows.filter((row) => !row.valid && row.pkg.status !== "SUBMITTED").length;

  return (
    <AppShell>
      <PageHeader
        title="Approval centre"
        description="Approval is bound to one vacancy and one exact package hash. Change the resume, letter or answers afterwards and the approval lapses."
        meta={
          <>
            <span>
              {packages.length} package{packages.length === 1 ? "" : "s"}
            </span>
            <span className="text-line-strong">/</span>
            <span className={waiting ? "font-medium text-[#8a5a06]" : undefined}>{waiting} need a decision</span>
          </>
        }
      />

      {rows.length ? (
        <div className="space-y-4">
          {waiting ? (
            <Callout tone="warn" title={`${waiting} package${waiting === 1 ? "" : "s"} waiting on you`}>
              Read the resume, cover letter and answers before approving. Nothing reaches an employer until you do.
            </Callout>
          ) : null}

          <div className="table-shell">
            <table className="w-full table-fixed text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.07em] text-muted">
                  <th className="w-[46%] px-4 py-2 font-medium">Role</th>
                  <th className="w-[20%] px-3 py-2 font-medium">Approval</th>
                  <th className="hidden w-[18%] px-3 py-2 font-medium sm:table-cell">Updated</th>
                  <th className="w-[16%] px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ pkg, valid, approval }) => {
                  const status = STATUS_COPY[pkg.status] ?? { label: pkg.status.replaceAll("_", " ").toLowerCase(), className: "chip" };
                  return (
                    <tr key={pkg.id} className="border-b border-line last:border-0 hover:bg-[#fbfaf8]">
                      <td className="px-4 py-2.5">
                        <Link href={`/approvals/${pkg.id}`} className="flex items-center gap-2.5 group">
                          <CompanyMark name={pkg.company} size={30} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-ink group-hover:underline">{pkg.title}</span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted">
                              {pkg.company} · {pkg.source_name}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`${valid ? "chip-moss" : status.className}`}>
                          {valid ? (
                            <>
                              <ShieldCheck size={10} /> Approved
                            </>
                          ) : (
                            status.label
                          )}
                        </span>
                        <span className="mt-1 block font-mono text-[10px] text-muted">
                          {valid && approval ? `hash ${approval.approval_hash.slice(0, 8)}` : pkg.cover_letter ? "cover letter" : "no cover letter"}
                        </span>
                      </td>
                      <td className="hidden px-3 py-2.5 text-[11.5px] text-muted sm:table-cell">
                        {formatDate(pkg.updated_at, { day: "numeric", month: "short" })}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/approvals/${pkg.id}`} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ink hover:underline">
                          Review <ArrowUpRight size={11} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11.5px] leading-relaxed text-muted">
            Destination URLs are shown in full on each package. Job Hunter never posts on your behalf — after approval you open the employer
            page, submit, then mark the application in the tracker.
          </p>
        </div>
      ) : (
        <EmptyState
          icon={<ShieldCheck size={16} />}
          title="No application packages yet"
          description="Tailor a resume for a job, review it, then assemble a package. Nothing can leave your account without a package-specific approval."
          action={{ href: "/jobs", label: "Find a job to tailor for" }}
        />
      )}
    </AppShell>
  );
}
