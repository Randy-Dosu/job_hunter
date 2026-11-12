import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AppShell, PageHeader, SectionHeading } from "@/components/app-shell";
import { SearchTrigger } from "@/components/search-trigger";
import { JobCard } from "@/components/job-card";
import { Callout, Stat, formatDate } from "@/components/ui";
import { MarkAllRead } from "@/components/mark-read";
import { ensureBootstrapSearch, listMatches } from "@/lib/search";
import { all, get } from "@/lib/db";
import { getProfileContext } from "@/lib/profile";
import { requireUser } from "@/lib/auth";
import { truncate } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const context = getProfileContext(user.id);
  if (!context.profile.headline && context.evidence.length === 0) redirect("/onboarding");

  await ensureBootstrapSearch(user.id);

  const matches = listMatches(user.id);
  const strong = matches.filter((entry) => entry.match.verdict === "strong");
  const possible = matches.filter((entry) => entry.match.verdict === "possible");
  const excluded = listMatches(user.id, { includeExcluded: true }).filter((entry) => entry.match.verdict === "excluded");

  const runs = all<{ id: string; finished_at: string | null; counts_json: string; error_summary: string; status: string; trigger: string; started_at: string }>(
    "SELECT * FROM search_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 4",
    user.id,
  );
  const lastRun = runs[0];
  let counts: Record<string, unknown> = {};
  try {
    counts = lastRun ? (JSON.parse(lastRun.counts_json) as Record<string, unknown>) : {};
  } catch {
    counts = {};
  }

  const applications = all<{ status: string; count: number }>(
    "SELECT status, COUNT(*) AS count FROM applications WHERE user_id = ? GROUP BY status",
    user.id,
  );
  const pipeline = Object.fromEntries(applications.map((row) => [row.status, row.count]));
  const totalApplications = Object.values(pipeline).reduce((sum, value) => sum + Number(value), 0);

  const pendingApprovals = all<{ id: string; job_id: string; status: string; updated_at: string }>(
    "SELECT id, job_id, status, updated_at FROM application_packages WHERE user_id = ? AND status IN ('PENDING_APPROVAL','APPROVED') ORDER BY updated_at DESC LIMIT 3",
    user.id,
  );
  const deadlines = all<{ id: string; title: string; company: string; deadline: string }>(
    "SELECT j.id, j.title, j.company, j.deadline FROM jobs j JOIN job_matches m ON m.job_id = j.id WHERE m.user_id = ? AND j.deadline IS NOT NULL AND j.status = 'open' ORDER BY j.deadline ASC LIMIT 4",
    user.id,
  );
  const unreadNotifications = all<{ id: string; title: string; body: string; created_at: string; type: string }>(
    "SELECT id, title, body, created_at, type FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 3",
    user.id,
  );
  const topMatches = (strong.length ? strong : possible).slice(0, 3);
  const sources = all<{ name: string; last_status: string | null; last_run_at: string | null; enabled: number }>(
    "SELECT name, last_status, last_run_at, enabled FROM job_sources ORDER BY name",
  );
  const verifiedFacts = context.evidence.filter((fact) => fact.verification_status === "verified").length;
  const factRatio = Math.round((verifiedFacts / Math.max(1, context.evidence.length)) * 100);

  const firstName = user.name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <AppShell>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={
          lastRun?.finished_at
            ? `Last search ${new Date(lastRun.finished_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${lastRun.trigger} run · ${String(counts.sourcesAttempted ?? 0)} sources`
            : "Run your first search to pull today's vacancies."
        }
        actions={<SearchTrigger />}
      />

      {counts.fixtureFallback && (counts.fixtureFallback as string[]).length ? (
        <div className="mb-5">
          <Callout tone="warn" title="Live sources unreachable — saved fixtures in use">
            {(counts.fixtureFallback as string[]).join(", ")} could not be reached from this environment, so the last saved listings
            were used. In production the adapters call the public APIs directly; every job keeps its real source URL and retrieval
            time.
          </Callout>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-y-4 rounded-[10px] border border-line bg-surface px-4 py-4 sm:grid-cols-4">
        <Stat label="Listings reviewed" value={String(counts.discovered ?? 0)} hint={`${counts.duplicates ?? 0} duplicates · ${counts.closed ?? 0} closed`} />
        <Stat label="Strong matches" value={strong.length} hint={`${possible.length} possible with gaps`} tone="moss" />
        <Stat label="Awaiting approval" value={pendingApprovals.length} hint="Nothing sends without you" tone={pendingApprovals.length ? "clay" : undefined} />
        <Stat label="Applications" value={totalApplications} hint="Across every stage" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionHeading
              title="Today's strongest matches"
              count={strong.length}
              action={
                <Link href="/jobs" className="inline-flex items-center gap-1 text-[12px] font-medium text-ink hover:underline">
                  All jobs <ArrowRight size={12} />
                </Link>
              }
            />
            {topMatches.length ? (
              <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
                {topMatches.map((entry) => (
                  <JobCard key={entry.job.id} entry={entry} />
                ))}
              </div>
            ) : (
              <div className="rounded-[10px] border border-line bg-surface px-4 py-6 text-[13px] text-muted">
                No matches yet. Run a search, or loosen your exclusions in{" "}
                <Link href="/settings" className="link">
                  settings
                </Link>
                .
              </div>
            )}
          </section>

          <section>
            <SectionHeading
              title="Search runs"
              action={
                <Link href="/settings#schedule" className="text-[12px] text-muted hover:text-ink hover:underline">
                  Schedule
                </Link>
              }
            />
            <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
              <table className="table-shell">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Trigger</th>
                    <th className="text-right">Found</th>
                    <th className="text-right">New</th>
                    <th className="text-right">Dupes</th>
                    <th className="text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    let runCounts: Record<string, unknown> = {};
                    try {
                      runCounts = JSON.parse(run.counts_json) as Record<string, unknown>;
                    } catch {
                      runCounts = {};
                    }
                    return (
                      <tr key={run.id}>
                        <td className="whitespace-nowrap text-ink">
                          {new Date(run.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="capitalize text-muted">{run.trigger}</td>
                        <td className="text-right text-ink">{String(runCounts.discovered ?? 0)}</td>
                        <td className="text-right text-ink">{String(runCounts.created ?? 0)}</td>
                        <td className="text-right text-ink">{String(runCounts.duplicates ?? 0)}</td>
                        <td className="text-right">
                          <span className={run.status === "completed" ? "chip-moss" : run.status === "failed" ? "chip-clay" : "chip-warn"}>
                            {run.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!runs.length ? (
                    <tr>
                      <td colSpan={6} className="text-muted">
                        No runs yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {lastRun?.error_summary ? <p className="mt-2 text-[11.5px] text-[#7a5710]">{truncate(lastRun.error_summary, 200)}</p> : null}

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-muted">
              {sources.map((source) => (
                <span key={source.name} className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      source.last_status === "ok" ? "bg-moss-600" : source.last_status ? "bg-[#c58a12]" : "bg-[#c9c5be]"
                    }`}
                  />
                  {source.name}
                  <span className="text-[10.5px] text-[#9aa0a8]">{source.last_status ?? "not run"}</span>
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-[10px] border border-line bg-surface p-4 sm:p-5">
            <h2 className="text-[13px] font-semibold text-ink">Filtering summary</h2>
            <dl className="mt-2 divide-y divide-line">
              <div className="kv">
                <dt>Strong matches</dt>
                <dd className="number">{strong.length}</dd>
              </div>
              <div className="kv">
                <dt>Possible with gaps</dt>
                <dd className="number">{possible.length}</dd>
              </div>
              <div className="kv">
                <dt>Hidden by your hard filters</dt>
                <dd className="number">
                  <Link href="/jobs?tab=excluded" className="link-quiet">
                    {excluded.length}
                  </Link>
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              Hard filters — closed vacancies, excluded employers, on-site roles you cannot take — outrank any score.
            </p>
          </section>
        </div>

        <div className="space-y-7">
          <section>
            <SectionHeading
              title="Needs your review"
              action={
                <Link href="/approvals" className="text-[12px] text-muted hover:text-ink hover:underline">
                  Approval centre
                </Link>
              }
            />
            <div className="divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-surface">
              {pendingApprovals.length ? (
                pendingApprovals.map((pkg) => {
                  const job = get<{ title: string; company: string }>("SELECT title, company FROM jobs WHERE id = ?", pkg.job_id);
                  return (
                    <Link key={pkg.id} href={`/approvals/${pkg.id}`} className="block px-3.5 py-2.5 hover:bg-[#fcfbf9]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[12.5px] font-semibold text-ink">{job?.title ?? "Package"}</p>
                          <p className="truncate text-[11.5px] text-muted">{job?.company}</p>
                        </div>
                        <span className={pkg.status === "APPROVED" ? "chip-moss" : "chip"}>{pkg.status === "APPROVED" ? "Approved" : "Review"}</span>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <p className="px-3.5 py-3 text-[12px] leading-relaxed text-muted">
                  Nothing awaiting approval. Tailor a resume from any job to start a package.
                </p>
              )}
            </div>
          </section>

          <section>
            <SectionHeading title="Deadlines" />
            <div className="divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-surface">
              {deadlines.length ? (
                deadlines.map((job) => (
                  <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-[#fcfbf9]">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink">{job.title}</span>
                      <span className="block truncate text-[11.5px] text-muted">{job.company}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-clay-700">Closes {formatDate(job.deadline)}</span>
                  </Link>
                ))
              ) : (
                <p className="px-3.5 py-3 text-[12px] text-muted">No closing dates in your current matches.</p>
              )}
            </div>
          </section>

          <section id="activity">
            <SectionHeading
              title="Activity"
              action={<MarkAllRead count={unreadNotifications.length} />}
            />
            <div className="rounded-[10px] border border-line bg-surface px-3.5 py-3">
              {unreadNotifications.length ? (
                <ul className="space-y-3">
                  {unreadNotifications.map((notification) => (
                    <li key={notification.id}>
                      <p className="text-[12px] font-medium text-ink">{notification.title}</p>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{truncate(notification.body, 130)}</p>
                      <p className="mt-0.5 text-[10.5px] text-[#9aa0a8]">
                        {new Date(notification.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">You are all caught up.</p>
              )}
            </div>
          </section>

          <section className="rounded-[10px] border border-line bg-[#fbfaf8] p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[12.5px] font-semibold text-ink">Profile evidence</h2>
              <span className="number text-[12px] text-ink">{verifiedFacts} verified</span>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#eae6df]">
              <div className="h-full rounded-full bg-moss-600" style={{ width: `${factRatio}%` }} />
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              {context.evidence.length - verifiedFacts} facts still need confirmation. Only verified facts can appear in a resume.
            </p>
            <Link href="/resume" className="mt-2 inline-block text-[11.5px] font-medium text-ink hover:underline">
              Review facts →
            </Link>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
