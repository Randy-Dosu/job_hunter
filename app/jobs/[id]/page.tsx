import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarDays,
  CircleAlert,
  ExternalLink,
  MapPin,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { FeedbackButtons, TailorResumeButton } from "@/components/job-actions";
import { Callout, ConfidenceBar, ScoreRing, SourceLink, VERDICT_COPY, VerdictBadge, formatDate } from "@/components/ui";
import { getMatch } from "@/lib/search";
import { requireUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { extractRequirements, skillLabel } from "@/lib/matching/requirements";
import { verifiedSkills } from "@/lib/matching/score";
import { getProfileContext } from "@/lib/profile";
import { formatRelative } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const entry = getMatch(user.id, id);
  if (!entry) notFound();
  const { job, match } = entry;

  const context = getProfileContext(user.id);
  const heldSkills = verifiedSkills(context.snapshot.facts);
  const requirements = extractRequirements(`${job.description}\n${job.requirements}`, job.title);
  const tailored = get<{ id: string; status: string; unsupported_json: string }>(
    "SELECT id, status, unsupported_json FROM tailored_resumes WHERE user_id = ? AND job_id = ? ORDER BY created_at DESC LIMIT 1",
    user.id,
    id,
  );
  const pkg = get<{ id: string; status: string }>(
    "SELECT id, status FROM application_packages WHERE user_id = ? AND job_id = ? ORDER BY updated_at DESC LIMIT 1",
    user.id,
    id,
  );
  const application = get<{ id: string; status: string }>("SELECT id, status FROM applications WHERE user_id = ? AND job_id = ?", user.id, id);
  const verdictCopy = VERDICT_COPY[match.verdict] ?? VERDICT_COPY.low;
  const unsupportedCount = tailored ? JSON.parse(tailored.unsupported_json || "[]").length : 0;

  const descriptionBlocks = job.description
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <AppShell>
      <Link href="/jobs" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={13} /> Back to feed
      </Link>

      <PageHeader
        eyebrow={`${job.source_name} · found ${formatRelative(job.first_seen_at)}`}
        title={job.title}
        description={`${job.company} · ${job.location} · ${job.remote_policy} · ${job.employment_type}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a href={job.application_url} target="_blank" rel="noopener noreferrer nofollow" className="btn-secondary">
              <ExternalLink size={14} /> Official application
            </a>
            <TailorResumeButton jobId={job.id} existingResumeId={tailored?.id ?? null} />
          </div>
        }
      />

      {match.verdict === "excluded" ? (
        <div className="mb-5">
          <Callout tone="danger" title="This job is excluded by a hard filter">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {match.reasons
                .filter((reason) => reason.strength === "warning")
                .map((reason) => (
                  <li key={reason.text}>{reason.text}</li>
                ))}
              {match.verdict === "excluded" && match.gaps.length === 0 ? <li>One of your exclusions matched this listing.</li> : null}
            </ul>
            <p className="mt-1.5 text-xs opacity-80">
              Hard filters always beat a high numeric score. Adjust exclusions in settings if this was too strict.
            </p>
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="card card-pad">
            <div className="flex items-center gap-4">
              <ScoreRing score={Math.round(match.score)} confidence={match.confidence} verdict={match.verdict} size={72} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <VerdictBadge verdict={match.verdict} />
                  <span className="text-[11px] text-slate-500">{verdictCopy.blurb}</span>
                </div>
                <div className="mt-2">
                  <ConfidenceBar value={match.confidence} />
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-2.5">
              {match.components.map((component) => (
                <div key={component.key}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{component.label}</span>
                    <span className="text-slate-500">
                      {component.points.toFixed(1)} / {component.weight}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${
                        component.score >= 0.75 ? "bg-emerald-500" : component.score >= 0.45 ? "bg-amber-400" : "bg-rose-400"
                      }`}
                      style={{ width: `${Math.round(component.score * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {component.note}
                    {component.confidence < 0.5 ? <span className="ml-1 text-amber-600">(low data confidence)</span> : null}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Why this was recommended</h2>
            <ul className="mt-2 space-y-2">
              {match.reasons.map((reason) => (
                <li key={`${reason.dimension}-${reason.text}`} className="flex gap-2 text-sm">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      reason.strength === "strong" ? "bg-emerald-500" : reason.strength === "warning" ? "bg-amber-500" : "bg-slate-400"
                    }`}
                  />
                  <span className="text-slate-600">{reason.text}</span>
                </li>
              ))}
              {!match.reasons.length ? <li className="muted">No supporting evidence was found in your profile.</li> : null}
            </ul>

            <h2 className="mt-5 text-sm font-semibold text-slate-900">Gaps to weigh up</h2>
            <ul className="mt-2 space-y-2">
              {match.gaps.map((gap, index) => (
                <li key={`${gap.text}-${index}`} className="flex gap-2 text-sm">
                  <TriangleAlert size={13} className={`mt-1 shrink-0 ${gap.required ? "text-rose-500" : "text-amber-500"}`} />
                  <span className="text-slate-600">
                    {gap.text}
                    <span className={`ml-1.5 text-[10px] font-semibold uppercase tracking-wide ${gap.required ? "text-rose-500" : "text-amber-600"}`}>
                      {gap.required ? "required" : "preference"}
                    </span>
                  </span>
                </li>
              ))}
              {!match.gaps.length ? (
                <li className="flex items-center gap-1.5 text-sm text-emerald-700">
                  <BadgeCheck size={14} /> No required qualification is missing from your verified profile.
                </li>
              ) : null}
            </ul>
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Requirements extracted from the listing</h2>
            <p className="mt-1 text-xs text-slate-500">
              Structured deterministically from the job description. “Required” means we found it in a requirements section.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Required</p>
                <ul className="mt-1.5 space-y-1">
                  {requirements.required.map((req) => {
                    const held = heldSkills.has(req.skill);
                    return (
                      <li key={req.skill} className="flex items-center gap-1.5 text-xs">
                        {held ? <BadgeCheck size={12} className="text-emerald-600" /> : <CircleAlert size={12} className="text-rose-500" />}
                        <span className={held ? "text-slate-700" : "text-slate-500"}>{skillLabel(req.skill)}</span>
                      </li>
                    );
                  })}
                  {!requirements.required.length ? <li className="muted text-xs">No explicit requirements detected.</li> : null}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Preferred</p>
                <ul className="mt-1.5 space-y-1">
                  {requirements.preferred.map((req) => (
                    <li key={req.skill} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <Sparkles size={12} className="text-slate-400" /> {skillLabel(req.skill)}
                    </li>
                  ))}
                  {!requirements.preferred.length ? <li className="muted text-xs">No preferred skills detected.</li> : null}
                </ul>
              </div>
            </div>
            {requirements.redFlags.length ? (
              <div className="mt-4">
                <Callout tone="danger" title="Warning signs in this listing">
                  {requirements.redFlags.join("; ")}. Never pay a fee, share bank details, or move to informal channels to apply.
                </Callout>
              </div>
            ) : null}
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Job description</h2>
            <div className="mt-3 space-y-2.5">
              {descriptionBlocks.map((block, index) => (
                <p key={index} className="whitespace-pre-line text-[13px] leading-relaxed text-slate-600">
                  {block}
                </p>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Vacancy facts</h2>
            <dl className="mt-3 space-y-2.5 text-xs">
              {[
                { icon: Building2, label: "Employer", value: job.company },
                { icon: MapPin, label: "Location", value: `${job.location} · ${job.remote_policy}` },
                { icon: Wallet, label: "Salary", value: job.salary ?? "Not disclosed" },
                { icon: CalendarDays, label: "Posted", value: job.posted_at ? formatDate(job.posted_at, { day: "numeric", month: "short", year: "numeric" }) : "Unknown" },
                { icon: CalendarDays, label: "Deadline", value: job.deadline ? formatDate(job.deadline, { day: "numeric", month: "short", year: "numeric" }) : "Not stated" },
              ].map((fact) => (
                <div key={fact.label} className="flex items-start justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-slate-500">
                    <fact.icon size={12} /> {fact.label}
                  </dt>
                  <dd className="max-w-[60%] text-right font-medium capitalize text-slate-800">{fact.value}</dd>
                </div>
              ))}
              <div className="flex items-start justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-slate-500">
                  <ShieldAlert size={12} /> Status
                </dt>
                <dd className="text-right">
                  <span className={job.status === "open" ? "badge-strong" : job.status === "closed" ? "badge-excluded" : "badge-possible"}>
                    {job.status}
                  </span>
                </dd>
              </div>
            </dl>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <SourceLink href={job.canonical_url} label={`View on ${job.source_name}`} />
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                Source ID {job.external_id} · first seen {formatRelative(job.first_seen_at)} · last checked {formatRelative(job.last_seen_at)}
              </p>
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Application state</h2>
            <ul className="mt-2 space-y-2 text-xs">
              <li className="flex items-center justify-between">
                <span className="text-slate-500">Tailored resume</span>
                {tailored ? (
                  <Link href={`/resumes/${tailored.id}`} className="font-semibold text-brand-600 hover:underline">
                    {tailored.status === "user_approved" ? "Approved by you" : "Draft"}
                    {unsupportedCount ? ` · ${unsupportedCount} flagged` : ""}
                  </Link>
                ) : (
                  <span className="text-slate-400">not created</span>
                )}
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-500">Package</span>
                {pkg ? (
                  <Link href={`/approvals/${pkg.id}`} className="font-semibold text-brand-600 hover:underline">
                    {pkg.status.replaceAll("_", " ").toLowerCase()}
                  </Link>
                ) : (
                  <span className="text-slate-400">not assembled</span>
                )}
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-500">Application</span>
                {application ? (
                  <span className="font-medium capitalize text-slate-700">{application.status.replaceAll("_", " ")}</span>
                ) : (
                  <span className="text-slate-400">nothing submitted</span>
                )}
              </li>
            </ul>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <FeedbackButtons jobId={job.id} current={match.feedback} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-600">
            <p className="flex items-center gap-1.5 font-semibold text-slate-800">
              <ShieldAlert size={13} className="text-brand-600" /> Before you apply
            </p>
            <p className="mt-1.5">
              Confirm the vacancy is still open on the employer&apos;s site, check the work-authorization wording, and read the
              deadline in the original listing. We never submit for you without a job-specific approval.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
