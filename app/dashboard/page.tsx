import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Copy,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { SearchTrigger } from "@/components/search-trigger";
import { JobCard } from "@/components/job-card";
import { Callout, Stat, VERDICT_COPY, formatDate } from "@/components/ui";
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

  const lastRun = get<{ id: string; finished_at: string | null; counts_json: string; error_summary: string; status: string; trigger: string }>(
    "SELECT * FROM search_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
    user.id,
  );
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

  const firstName = user.name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <AppShell>
      <PageHeader
        eyebrow="Dashboard"
        title={`${greeting}, ${firstName}`}
        description={
          lastRun?.finished_at
            ? `Last search finished ${new Date(lastRun.finished_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${lastRun.trigger} run`
            : "Run your first search to pull today's vacancies."
        }
        actions={<SearchTrigger />}
      />

      {counts.fixtureFallback && (counts.fixtureFallback as string[]).length ? (
        <div className="mb-5">
          <Callout tone="warn" title="Live sources unreachable — showing saved fixtures">
            {(counts.fixtureFallback as string[]).join(", ")} could not be reached from this environment, so the last saved
            listings were used instead. In production these adapters call the public APIs directly; every job still shows its
            real source URL and retrieval time.
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Listings reviewed"
          value={String(counts.discovered ?? 0)}
          hint={`${counts.duplicates ?? 0} duplicates merged · ${counts.closed ?? 0} closed`}
        />
        <Stat label="Strong matches" value={strong.length} hint={`${possible.length} possible with gaps`} />
        <Stat label="Awaiting approval" value={pendingApprovals.length} hint="Nothing submits without you" />
        <Stat label="Applications" value={Object.values(pipeline).reduce((a, b) => a + Number(b), 0)} hint="Across every stage" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section>
            <div className="mb-3 flex items-end justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Today&apos;s strongest matches</h2>
                <p className="text-xs text-slate-500">Ranked by a transparent 100-point model, not an opaque model.</p>
              </div>
              <Link href="/jobs" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                All jobs <ArrowRight size={12} />
              </Link>
            </div>
            {topMatches.length ? (
              <div className="space-y-3">
                {topMatches.map((entry) => (
                  <JobCard key={entry.job.id} entry={entry} />
                ))}
              </div>
            ) : (
              <div className="card card-pad text-sm text-slate-600">
                No matches yet. Run a search, or loosen your exclusions in{" "}
                <Link href="/settings" className="font-semibold text-brand-600">
                  settings
                </Link>
                .
              </div>
            )}
          </section>

          <section className="card">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-900">Search run detail</h2>
              <span className="badge-neutral">{lastRun?.status ?? "not run"}</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100 sm:grid-cols-4">
              {[
                { icon: BriefcaseBusiness, label: "Discovered", value: counts.discovered ?? 0 },
                { icon: Copy, label: "Duplicates", value: counts.duplicates ?? 0 },
                { icon: CircleSlash, label: "Closed / stale", value: counts.closed ?? 0 },
                { icon: TrendingUp, label: "Matched", value: counts.matched ?? 0 },
              ].map((item) => (
                <div key={item.label} className="px-4 py-3">
                  <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <item.icon size={11} /> {item.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{String(item.value)}</p>
                </div>
              ))}
            </div>
            <div className="divide-y divide-slate-100">
              {sources.map((source) => (
                <div key={source.name} className="flex items-center justify-between px-5 py-2.5 text-xs">
                  <span className="font-medium text-slate-700">{source.name}</span>
                  <span className="flex items-center gap-2 text-slate-500">
                    {source.last_status === "ok" ? (
                      <span className="badge-strong">
                        <CheckCircle2 size={10} /> ok
                      </span>
                    ) : source.last_status === "fixture_fallback" ? (
                      <span className="badge-possible">fixtures</span>
                    ) : source.last_status ? (
                      <span className="badge-excluded">{source.last_status}</span>
                    ) : (
                      <span className="badge-neutral">not run</span>
                    )}
                    <span className="text-[11px] text-slate-400">
                      {source.last_run_at ? new Date(source.last_run_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            {lastRun?.error_summary ? (
              <div className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-amber-700">{truncate(lastRun.error_summary, 200)}</div>
            ) : null}
          </section>
        </div>

        <div className="space-y-5">
          <section className="card card-pad">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <ShieldCheck size={15} className="text-brand-600" /> Approval gate
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              A package can only move forward with your explicit approval of that exact version.
            </p>
            <div className="mt-3 space-y-2">
              {pendingApprovals.length ? (
                pendingApprovals.map((pkg) => {
                  const job = get<{ title: string; company: string }>("SELECT title, company FROM jobs WHERE id = ?", pkg.job_id);
                  return (
                    <Link
                      key={pkg.id}
                      href={`/approvals/${pkg.id}`}
                      className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs transition hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-800">{job?.title ?? "Package"}</span>
                        <span className="block truncate text-[11px] text-slate-500">{job?.company}</span>
                      </span>
                      <span className={pkg.status === "APPROVED" ? "badge-strong" : "badge-possible"}>
                        {pkg.status === "APPROVED" ? "Approved" : "Review"}
                      </span>
                    </Link>
                  );
                })
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  No packages awaiting approval. Tailor a resume from any job to start one.
                </p>
              )}
            </div>
            <Link href="/approvals" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
              Open approval centre <ArrowRight size={12} />
            </Link>
          </section>

          <section className="card card-pad">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <CalendarClock size={15} className="text-amber-600" /> Deadlines
            </h2>
            {deadlines.length ? (
              <ul className="mt-2.5 space-y-2">
                {deadlines.map((job) => (
                  <li key={job.id} className="flex items-start justify-between gap-2 text-xs">
                    <Link href={`/jobs/${job.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-700 hover:text-brand-700">
                      {job.title}
                      <span className="block truncate text-[11px] font-normal text-slate-400">{job.company}</span>
                    </Link>
                    <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                      {formatDate(job.deadline)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">No closing dates in your current matches.</p>
            )}
          </section>

          <section className="card card-pad">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <BellRing size={15} className="text-slate-500" /> Recent activity
              </h2>
              <MarkAllRead count={unreadNotifications.length} />
            </div>
            {unreadNotifications.length ? (
              <ul className="mt-2.5 space-y-2.5">
                {unreadNotifications.map((notification) => (
                  <li key={notification.id} className="text-xs">
                    <p className="font-medium text-slate-800">{notification.title}</p>
                    <p className="mt-0.5 leading-relaxed text-slate-500">{truncate(notification.body, 140)}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                      <Clock3 size={10} />
                      {new Date(notification.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">You are all caught up.</p>
            )}
          </section>

          <section className="card card-pad">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Sparkles size={15} className="text-emerald-600" /> Profile strength
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {context.evidence.filter((fact) => fact.verification_status === "verified").length} verified facts ·{" "}
              {context.evidence.filter((fact) => fact.verification_status !== "verified").length} awaiting confirmation
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{
                  width: `${Math.round(
                    (context.evidence.filter((fact) => fact.verification_status === "verified").length /
                      Math.max(1, context.evidence.length)) *
                      100,
                  )}%`,
                }}
              />
            </div>
            <Link href="/resume" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
              Review facts <ArrowRight size={12} />
            </Link>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-900 p-4 text-white">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <BadgeCheck size={13} className="text-emerald-400" /> {VERDICT_COPY.strong.label}s: {strong.length}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
              {excluded.length} listings were hidden by your hard filters. Nothing was applied to, and nothing will be without
              your approval.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
