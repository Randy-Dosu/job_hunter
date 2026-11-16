import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { FeedbackButtons, TailorResumeButton } from "@/components/job-actions";
import { Callout, CompanyMark, MatchScore, SourceLink, VerdictBadge, formatDate } from "@/components/ui";
import { getMatch } from "@/lib/search";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
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
  const unsupportedCount = tailored ? (JSON.parse(tailored.unsupported_json || "[]") as unknown[]).length : 0;
  const descriptionBlocks = job.description
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <AppShell>
      <Link href="/jobs" className="mb-4 inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
        <ArrowLeft size={13} /> All jobs
      </Link>

      {match.verdict === "excluded" ? (
        <div className="mb-4">
          <Callout tone="danger" title="Excluded by one of your hard filters">
            {match.gaps.length
              ? match.gaps.map((gap) => gap.text).join(" ")
              : "A closed vacancy, excluded employer or location preference blocked this listing."}{" "}
            <Link href="/settings#market" className="underline">
              Review exclusions
            </Link>
            .
          </Callout>
        </div>
      ) : null}

      <header className="border-b border-line pb-5">
        <div className="flex flex-wrap items-start gap-4">
          <CompanyMark name={job.company} size={54} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <VerdictBadge verdict={match.verdict} />
              <span className="text-[11.5px] text-muted">·</span>
              <span className="text-[11.5px] text-muted">{job.source_name}</span>
              <span className="text-[11.5px] text-muted">·</span>
              <span className="text-[11.5px] text-muted">Found {formatRelative(job.first_seen_at)}</span>
            </div>
            <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink">{job.title}</h1>
            <p className="mt-1 text-[13px] text-ink-soft">
              {job.company}
              <span className="text-muted"> · {job.location} · </span>
              <span className="capitalize">{job.remote_policy}</span>
              <span className="text-muted"> · </span>
              <span className="capitalize">{job.employment_type}</span>
              {job.salary ? (
                <>
                  <span className="text-muted"> · </span>
                  <span className="font-medium text-moss-700">{job.salary}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <a
              href={job.application_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="btn-secondary"
              title="Opens the employer's own application page"
            >
              <ExternalLink size={13} /> Official page
            </a>
            <TailorResumeButton jobId={job.id} existingResumeId={tailored?.id ?? null} />
          </div>
        </div>
      </header>

      <div className="mt-7 grid gap-9 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-7">
          <section>
            <h2 className="text-[13px] font-semibold text-ink">About the role</h2>
            <div className="prose-body mt-2">
              {descriptionBlocks.map((block, index) => (
                <p key={index} className="whitespace-pre-line">
                  {block}
                </p>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[13px] font-semibold text-ink">Requirements in the listing</h2>
            <p className="mt-0.5 text-[11.5px] text-muted">Extracted deterministically from the description and checked against your evidence.</p>
            <div className="mt-3 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="label-xs mb-1.5">Required</p>
                <ul className="space-y-1">
                  {requirements.required.map((req) => {
                    const held = heldSkills.get(req.skill) ?? 0;
                    return (
                      <li key={req.skill} className="flex items-start gap-2 text-[12.5px]">
                        <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${held === 1 ? "bg-moss-600" : held > 0 ? "bg-[#c58a12]" : "bg-clay-500"}`} />
                        <span className={held ? "text-ink-soft" : "text-muted"}>
                          {skillLabel(req.skill)}
                          {held > 0 && held < 1 ? <span className="ml-1 text-[10.5px] text-[#8a5a06]">learning only</span> : null}
                          {!held ? <span className="ml-1 text-[10.5px] text-clay-700">not evidenced</span> : null}
                        </span>
                      </li>
                    );
                  })}
                  {!requirements.required.length ? <li className="text-[12px] text-muted">No explicit requirements detected.</li> : null}
                </ul>
              </div>
              <div>
                <p className="label-xs mb-1.5">Preferred</p>
                <ul className="space-y-1">
                  {requirements.preferred.map((req) => (
                    <li key={req.skill} className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#c9c5be]" />
                      {skillLabel(req.skill)}
                    </li>
                  ))}
                  {!requirements.preferred.length ? <li className="text-[12px] text-muted">No preferred skills detected.</li> : null}
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

          <section className="border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <SourceLink href={job.canonical_url} label={`View original listing on ${job.source_name}`} />
                <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                  Source ID {job.external_id} · first seen {formatRelative(job.first_seen_at)} · last checked {formatRelative(job.last_seen_at)} · status{" "}
                  <span className={job.status === "open" ? "text-moss-700" : "text-clay-700"}>{job.status}</span>
                </p>
              </div>
              <FeedbackButtons jobId={job.id} current={match.feedback} />
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section className="rounded-[10px] border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-ink">Match details</h2>
                <p className="mt-0.5 text-[11.5px] text-muted">{match.confidence}% data confidence</p>
              </div>
              <MatchScore score={match.score} verdict={match.verdict} size="lg" />
            </div>

            <div className="mt-4 space-y-2.5">
              {match.components.map((component) => (
                <div key={component.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11.5px] text-ink-soft">{component.label}</span>
                    <span className="number text-[11px] text-muted">
                      {component.points.toFixed(1)}/{component.weight}
                    </span>
                  </div>
                  <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[#eeeae4]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(component.score * 100)}%`,
                        background: component.score >= 0.75 ? "#17694a" : component.score >= 0.45 ? "#c58a12" : "#b5451f",
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                    {component.note}
                    {component.confidence < 0.5 ? <span className="ml-1 text-[#8a5a06]">low data</span> : null}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-[13px] font-semibold text-ink">Strong evidence</h2>
            <ul className="mt-2 space-y-1.5">
              {match.reasons.map((reason) => (
                <li key={`${reason.dimension}-${reason.text}`} className="flex gap-2 text-[12px] leading-relaxed text-ink-soft">
                  <span
                    className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${
                      reason.strength === "strong" ? "bg-moss-600" : reason.strength === "warning" ? "bg-[#c58a12]" : "bg-[#c9c5be]"
                    }`}
                  />
                  {reason.text}
                </li>
              ))}
              {!match.reasons.length ? <li className="text-[12px] text-muted">No supporting evidence found.</li> : null}
            </ul>

            <h2 className="mt-4 text-[13px] font-semibold text-ink">Gaps</h2>
            <ul className="mt-2 space-y-1.5">
              {match.gaps.map((gap, index) => (
                <li key={`${gap.text}-${index}`} className="flex gap-2 text-[12px] leading-relaxed text-ink-soft">
                  <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${gap.required ? "bg-clay-500" : "bg-[#c58a12]"}`} />
                  <span>
                    {gap.text}
                    <span className={`ml-1 text-[10px] font-semibold uppercase tracking-[0.05em] ${gap.required ? "text-clay-700" : "text-[#8a5a06]"}`}>
                      {gap.required ? "required" : "preference"}
                    </span>
                  </span>
                </li>
              ))}
              {!match.gaps.length ? <li className="text-[12px] text-moss-700">No required qualification is missing from your verified profile.</li> : null}
            </ul>
          </section>

          <section className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-[13px] font-semibold text-ink">Vacancy</h2>
            <dl className="mt-2 divide-y divide-line">
              <div className="kv">
                <dt>Employer</dt>
                <dd>{job.company}</dd>
              </div>
              <div className="kv">
                <dt>Location</dt>
                <dd className="capitalize">{job.location}</dd>
              </div>
              <div className="kv">
                <dt>Salary</dt>
                <dd>{job.salary ?? "Not disclosed"}</dd>
              </div>
              <div className="kv">
                <dt>Posted</dt>
                <dd>{job.posted_at ? formatDate(job.posted_at, { day: "numeric", month: "short", year: "numeric" }) : "Unknown"}</dd>
              </div>
              <div className="kv">
                <dt>Deadline</dt>
                <dd>{job.deadline ? formatDate(job.deadline, { day: "numeric", month: "short", year: "numeric" }) : "Not stated"}</dd>
              </div>
              <div className="kv">
                <dt>Status</dt>
                <dd>
                  <span className={job.status === "open" ? "chip-moss" : job.status === "closed" ? "chip-clay" : "chip"}>{job.status}</span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-[13px] font-semibold text-ink">Application</h2>
            <dl className="mt-2 space-y-2 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Tailored resume</dt>
                <dd>
                  {tailored ? (
                    <Link href={`/resumes/${tailored.id}`} className="font-medium text-ink hover:underline">
                      {tailored.status === "user_approved" ? "Approved" : "Draft"}
                      {unsupportedCount ? ` · ${unsupportedCount} flagged` : ""}
                    </Link>
                  ) : (
                    <span className="text-muted">Not created</span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Package</dt>
                <dd>
                  {pkg ? (
                    <Link href={`/approvals/${pkg.id}`} className="font-medium text-ink hover:underline">
                      {pkg.status.replaceAll("_", " ").toLowerCase()}
                    </Link>
                  ) : (
                    <span className="text-muted">Not assembled</span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Application</dt>
                <dd className="text-ink">{application ? application.status.replaceAll("_", " ") : "Nothing submitted"}</dd>
              </div>
            </dl>
            <p className="mt-2.5 border-t border-line pt-2.5 text-[10.5px] leading-relaxed text-muted">
              Confirm the vacancy is still open and check the work-authorization wording on the employer&apos;s site. Job Hunter never
              submits for you.
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
