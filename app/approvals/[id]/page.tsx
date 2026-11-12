import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ApprovalActions } from "@/components/approval-actions";
import { Callout, CompanyMark, SourceLink, formatDate } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, parseJson } from "@/lib/db";
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
  const answers = parseJson<{ question: string; answer: string }[]>(pkg.answers_json, []);
  const history = all<{ action: string; created_at: string; actor: string; metadata_json: string }>(
    "SELECT action, created_at, actor, metadata_json FROM audit_events WHERE user_id = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 8",
    user.id,
    pkg.id,
  );

  return (
    <AppShell>
      <Link href="/approvals" className="mb-4 inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
        <ArrowLeft size={13} /> Approval centre
      </Link>

      <PageHeader
        title={job.title}
        description={`${job.company} · ${job.location} · package v${pkg.package_hash.slice(0, 8)} · assembled ${formatDate(pkg.updated_at, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`}
        actions={<SourceLink href={job.canonical_url} label={`Source: ${job.source_name ?? "listing"}`} />}
      />

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <section className="rounded-[10px] border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <FileText size={13} className="text-muted" /> Application materials
              </h2>
              {resume ? (
                <Link href={`/resumes/${resume.id}`} className="text-[11.5px] font-medium text-ink hover:underline">
                  Open workspace
                </Link>
              ) : null}
            </div>

            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted">Tailored resume</p>
                <span className={resume?.status === "user_approved" ? "chip-moss" : "chip"}>
                  {resume ? resume.status.replaceAll("_", " ") : "missing"}
                </span>
              </div>
              {content ? (
                <div className="mt-2 max-h-80 overflow-auto rounded-md border border-line bg-[#fbfaf8] p-3">
                  <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink-soft">{resumeToText(content)}</pre>
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-muted">No resume attached to this package.</p>
              )}

              {pkg.cover_letter ? (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted">Cover letter · drafted from verified facts</p>
                  <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink-soft">{pkg.cover_letter}</pre>
                </div>
              ) : (
                <p className="mt-3 border-t border-line pt-3 text-[11.5px] text-muted">No cover letter included in this package.</p>
              )}

              {answers.length ? (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted">Application questions</p>
                  <dl className="mt-1.5 space-y-2">
                    {answers.map((answer) => (
                      <div key={answer.question}>
                        <dt className="text-[11.5px] font-medium text-ink">{answer.question}</dt>
                        <dd className="mt-0.5 text-[12px] text-ink-soft">{answer.answer}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-[13px] font-semibold text-ink">Destination &amp; identity</h2>
            <dl className="mt-2 divide-y divide-line">
              <div className="kv">
                <dt>Official application URL</dt>
                <dd className="max-w-[62%] break-all text-right font-mono text-[11px]">{pkg.destination_url}</dd>
              </div>
              <div className="kv">
                <dt>Employer</dt>
                <dd className="flex items-center gap-1.5">
                  <CompanyMark name={job.company} size={18} />
                  {job.company}
                </dd>
              </div>
              <div className="kv">
                <dt>Listing status</dt>
                <dd>
                  <span className={job.status === "open" ? "chip-moss" : "chip-clay"}>{job.status}</span>
                </dd>
              </div>
              <div className="kv">
                <dt>Personal data included</dt>
                <dd className="text-right">Name, contact details and resume only</dd>
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

          <section className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-[13px] font-semibold text-ink">Package activity</h2>
            <ol className="mt-2 divide-y divide-line">
              {history.map((event, index) => (
                <li key={index} className="flex items-baseline justify-between gap-3 py-1.5 text-[11.5px]">
                  <span className="capitalize text-ink-soft">{event.action.replaceAll(".", " · ").replaceAll("_", " ")}</span>
                  <span className="shrink-0 tabular-nums text-muted">{new Date(event.created_at).toLocaleString("en-GB")}</span>
                </li>
              ))}
              {!history.length ? <li className="py-1.5 text-[11.5px] text-muted">No events recorded yet.</li> : null}
            </ol>
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <ShieldCheck size={13} className={approvalValid ? "text-moss-600" : "text-[#8a5a06]"} /> Consent gate
            </h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              This is the only place an application can move forward. You approve this exact package, not future edits.
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

          <section className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-[13px] font-semibold text-ink">Integrity check</h2>
            <dl className="mt-2 divide-y divide-line">
              <div className="kv">
                <dt>Current hash</dt>
                <dd className="font-mono text-[11px]">{currentHash.slice(0, 16)}…</dd>
              </div>
              <div className="kv">
                <dt>Approved hash</dt>
                <dd className="font-mono text-[11px]">{approval ? `${approval.approval_hash.slice(0, 16)}…` : "—"}</dd>
              </div>
              <div className="kv">
                <dt>State</dt>
                <dd className={approvalValid ? "font-medium text-moss-700" : approval ? "font-medium text-[#8a5a06]" : "text-muted"}>
                  {approvalValid ? "valid" : approval ? "stale — re-approve" : "not approved"}
                </dd>
              </div>
            </dl>
            <p className="mt-2 border-t border-line pt-2 text-[10.5px] leading-relaxed text-muted">
              The hash covers resume text, cover letter, answers and destination URL. Any edit produces a new hash, so an earlier approval
              cannot be reused.
            </p>
          </section>

          <section className="rounded-[10px] border border-line bg-[#fbfaf8] p-4 text-[11.5px] leading-relaxed text-ink-soft">
            <p className="font-semibold text-ink">If you approve</p>
            <ul className="mt-1.5 space-y-1">
              <li>· Approval is recorded with a timestamp and this package hash</li>
              <li>· A tracker entry appears in “approved” state</li>
              <li>· You get a link to the employer&apos;s own application page</li>
              <li>· Nothing is sent to the employer by Job Hunter</li>
            </ul>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
