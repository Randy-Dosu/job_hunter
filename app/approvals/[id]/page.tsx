import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ApprovalActions } from "@/components/approval-actions";
import { Callout, SourceLink, formatDate } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, get, parseJson } from "@/lib/db";
import { loadPackage } from "@/lib/approvals";
import { resumeToText } from "@/lib/resume/grounding";
import type { TailoredResumeContent, UnsupportedClaim } from "@/lib/resume/types";

export const dynamic = "force-dynamic";

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const loaded = loadPackage(user.id, id);
  if (!loaded || !loaded.job) notFound();

  const { pkg, job, resume, approval, application, currentHash } = loaded;
  const content = resume ? parseJson<TailoredResumeContent>(resume.structured_content_json, {} as TailoredResumeContent) : null;
  const unsupported = resume ? parseJson<UnsupportedClaim[]>(resume.unsupported_json, []) : [];
  const approvalValid = Boolean(approval && approval.approval_hash === currentHash);
  const history = all<{ action: string; created_at: string; actor: string; metadata_json: string }>(
    "SELECT action, created_at, actor, metadata_json FROM audit_events WHERE user_id = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 8",
    user.id,
    pkg.id,
  );

  return (
    <AppShell>
      <Link href="/approvals" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={13} /> Approval centre
      </Link>
      <PageHeader
        eyebrow="Final check"
        title={job.title}
        description={`${job.company} · ${job.location} · package v${pkg.package_hash.slice(0, 8)} · assembled ${formatDate(pkg.updated_at, { day: "numeric", month: "short", year: "numeric" })}`}
        actions={<SourceLink href={job.canonical_url} label={`Source: ${job.source_name ?? "listing"}`} />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="card card-pad">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <FileText size={15} className="text-slate-500" /> Application materials
            </h2>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700">Tailored resume</p>
                {resume ? (
                  <Link href={`/resumes/${resume.id}`} className="text-[11px] font-semibold text-brand-600 hover:underline">
                    Open workspace
                  </Link>
                ) : null}
              </div>
              {content ? (
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-slate-700">
                  {resumeToText(content)}
                </pre>
              ) : (
                <p className="mt-2 text-xs text-slate-500">No resume attached to this package.</p>
              )}
            </div>

            {pkg.cover_letter ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold text-slate-700">Cover letter (drafted from verified facts)</p>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-slate-700">{pkg.cover_letter}</pre>
              </div>
            ) : (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">No cover letter included in this package.</p>
            )}

            {parseJson<{ question: string; answer: string }[]>(pkg.answers_json, []).length ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-semibold text-slate-700">Application questions</p>
                {parseJson<{ question: string; answer: string }[]>(pkg.answers_json, []).map((answer) => (
                  <div key={answer.question} className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="text-[11px] font-medium text-slate-700">{answer.question}</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">{answer.answer}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Destination &amp; identity</h2>
            <dl className="mt-2.5 space-y-2 text-xs">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Official application URL</dt>
                <dd className="max-w-[62%] break-all text-right font-medium text-slate-800">{pkg.destination_url}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Employer</dt>
                <dd className="text-right font-medium text-slate-800">{job.company}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Listing status</dt>
                <dd className={job.status === "open" ? "badge-strong" : "badge-excluded"}>{job.status}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Personal data included</dt>
                <dd className="max-w-[62%] text-right text-slate-700">Name, contact details and resume only</dd>
              </div>
            </dl>
            {job.status !== "open" ? (
              <div className="mt-3">
                <Callout tone="danger" title="This vacancy is no longer open">
                  Approval and handoff are disabled. Check the employer site before doing anything else.
                </Callout>
              </div>
            ) : null}
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Audit trail for this package</h2>
            <ol className="mt-2 space-y-1.5">
              {history.map((event, index) => (
                <li key={index} className="flex items-start justify-between gap-3 text-[11px]">
                  <span className="font-medium capitalize text-slate-700">{event.action.replaceAll(".", " · ").replaceAll("_", " ")}</span>
                  <span className="shrink-0 text-slate-400">{new Date(event.created_at).toLocaleString("en-GB")}</span>
                </li>
              ))}
              {!history.length ? <li className="text-[11px] text-slate-500">No events recorded yet.</li> : null}
            </ol>
          </section>
        </div>

        <div className="space-y-4">
          <section className="card card-pad">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <ShieldCheck size={15} className="text-brand-600" /> Consent gate
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              This is the only place an application can move forward. You are approving this package version, not future changes.
            </p>
            <div className="mt-3">
              <ApprovalActions
                packageId={pkg.id}
                destinationUrl={pkg.destination_url}
                status={pkg.status}
                approvalValid={approvalValid}
                approvalAt={approval?.approved_at ?? null}
                applicationId={(application?.id as string) ?? null}
                applicationStatus={(application?.status as string) ?? null}
                resumeApproved={resume?.status === "user_approved"}
                unsupportedCount={unsupported.length}
              />
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Package integrity</h2>
            <dl className="mt-2 space-y-1.5 text-[11px]">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Current hash</dt>
                <dd className="font-mono text-slate-700">{currentHash.slice(0, 16)}…</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Approved hash</dt>
                <dd className="font-mono text-slate-700">{approval ? `${approval.approval_hash.slice(0, 16)}…` : "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Match</dt>
                <dd className={approvalValid ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                  {approvalValid ? "valid" : approval ? "stale — re-approve" : "not approved"}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              The hash covers the resume text, cover letter, answers and destination URL. Any edit produces a different hash, so the
              previous approval cannot be reused.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-[11px] leading-relaxed text-slate-600">
            <p className="font-semibold text-slate-800">What happens when you click approve</p>
            <ul className="mt-1.5 space-y-1">
              <li>· Your approval is recorded with a timestamp and the package hash</li>
              <li>· A tracker entry is created in “approved” state</li>
              <li>· You get a link to the employer&apos;s own application page</li>
              <li>· Nothing is sent to the employer by Job Hunter</li>
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
