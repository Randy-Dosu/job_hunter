import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AdminSources, type AdminSource } from "@/components/admin-sources";
import { Callout, Stat, formatDate } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, parseJson } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminSourcesPage() {
  const user = await requireUser();

  if (user.role !== "admin") {
    return (
      <AppShell>
        <PageHeader title="Source governance" description="Administrator access required." />
        <Callout tone="danger" title="You do not have access to this page">
          Source governance controls which job boards the product is allowed to read, so it is limited to administrators. If you need
          access, ask the account owner.
        </Callout>
        <p className="mt-4 text-[12px] text-muted">
          <Link href="/dashboard" className="link">
            Back to your dashboard
          </Link>
        </p>
      </AppShell>
    );
  }

  const sourceRows = all<{
    id: string;
    name: string;
    slug: string;
    access_method: string;
    terms_url: string;
    terms_reviewed_at: string | null;
    enabled: number;
    rate_limit_config_json: string;
    supported_markets: string;
    notes: string;
    last_status: string | null;
    last_run_at: string | null;
  }>("SELECT * FROM job_sources ORDER BY name");

  const sources: AdminSource[] = sourceRows.map((row) => {
    const counts = all<{ job_count: number; open_count: number; failed_run_count: number }>(
      `SELECT
        (SELECT COUNT(*) FROM jobs WHERE source_id = ?) AS job_count,
        (SELECT COUNT(*) FROM jobs WHERE source_id = ? AND status = 'open') AS open_count,
        (SELECT COUNT(*) FROM search_runs WHERE error_summary LIKE '%' || ? || '%') AS failed_run_count`,
      row.id,
      row.id,
      row.name,
    )[0];
    const rate = parseJson<{ maxRequestsPerHour?: number; maxRequestsPerDay?: number; timeoutMs?: number }>(
      row.rate_limit_config_json,
      {},
    );
    return {
      slug: row.slug,
      name: row.name,
      accessMethod: row.access_method,
      termsUrl: row.terms_url,
      termsReviewedAt: row.terms_reviewed_at,
      enabled: row.enabled === 1,
      supportedMarkets: row.supported_markets,
      notes: row.notes,
      lastStatus: row.last_status,
      lastRunAt: row.last_run_at,
      jobCount: counts?.job_count ?? 0,
      openCount: counts?.open_count ?? 0,
      failedRunCount: counts?.failed_run_count ?? 0,
      maxRequestsPerHour: rate.maxRequestsPerHour ?? null,
      maxRequestsPerDay: rate.maxRequestsPerDay ?? null,
      timeoutMs: rate.timeoutMs ?? null,
    };
  });

  // Quality review (FR-063): reported bad matches, parse failures, uncertain data.
  const feedback = all<{ feedback: string; title: string; company: string; score: number; matched_at: string }>(
    `SELECT m.feedback, j.title, j.company, m.score, m.matched_at
     FROM job_matches m JOIN jobs j ON j.id = m.job_id
     WHERE m.feedback IN ('not_relevant','dismissed')
     ORDER BY m.matched_at DESC LIMIT 8`,
  );
  const parseFailures = all<{ id: string; filename: string; parse_status: string; created_at: string }>(
    "SELECT id, filename, parse_status, created_at FROM resume_documents WHERE parse_status <> 'parsed' ORDER BY created_at DESC LIMIT 8",
  );
  const lowConfidence = all<{ count: number }>(
    "SELECT COUNT(*) AS count FROM job_matches WHERE confidence < 50",
  )[0];
  const staleJobs = all<{ count: number }>("SELECT COUNT(*) AS count FROM jobs WHERE status = 'uncertain'")[0];
  const failedRuns = all<{ id: string; started_at: string; error_summary: string }>(
    "SELECT id, started_at, error_summary FROM search_runs WHERE error_summary <> '' ORDER BY started_at DESC LIMIT 5",
  );

  return (
    <AppShell>
      <PageHeader
        title="Source governance"
        description="Which boards we may read, what limits apply, and where the data looks wrong. One place, audited."
        meta={<span>{sources.filter((source) => source.enabled).length} of {sources.length} sources enabled</span>}
      />

      <div className="mb-5 grid grid-cols-2 gap-y-4 divide-line rounded-[10px] border border-line bg-surface py-3 sm:grid-cols-4 sm:divide-x">
        <Stat label="Listings" value={sources.reduce((total, source) => total + source.jobCount, 0)} hint="Across all sources" />
        <Stat label="Unverified" value={staleJobs?.count ?? 0} tone="clay" hint="Listing not seen recently" />
        <Stat label="Low confidence" value={lowConfidence?.count ?? 0} hint="Matches missing listing data" />
        <Stat label="Parse failures" value={parseFailures.length} hint="Uploads needing review" />
      </div>

      <AdminSources sources={sources} />

      <div className="mt-7 grid gap-4 lg:grid-cols-2">
        <section className="rounded-[10px] border border-line bg-surface">
          <div className="border-b border-line px-4 py-2.5">
            <h2 className="text-[13px] font-semibold text-ink">Reported bad matches</h2>
          </div>
          <ul className="divide-y divide-line">
            {feedback.map((row, index) => (
              <li key={`${row.title}-${index}`} className="flex items-baseline justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-ink">{row.title}</span>
                  <span className="text-[10.5px] text-muted">
                    {row.company} · scored {Math.round(row.score)} · {row.feedback.replaceAll("_", " ")}
                  </span>
                </span>
                <span className="shrink-0 text-[10.5px] text-muted">{formatDate(row.matched_at, { day: "numeric", month: "short" })}</span>
              </li>
            ))}
            {!feedback.length ? <li className="px-4 py-3 text-[11.5px] text-muted">No negative feedback yet.</li> : null}
          </ul>
        </section>

        <section className="rounded-[10px] border border-line bg-surface">
          <div className="border-b border-line px-4 py-2.5">
            <h2 className="text-[13px] font-semibold text-ink">Ingestion and parsing faults</h2>
          </div>
          <ul className="divide-y divide-line">
            {failedRuns.map((run) => (
              <li key={run.id} className="px-4 py-2">
                <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#8a5a06]">
                  <ShieldAlert size={11} /> Search run {formatDate(run.started_at, { day: "numeric", month: "short" })}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[10.5px] text-muted">{run.error_summary}</p>
              </li>
            ))}
            {parseFailures.map((document) => (
              <li key={document.id} className="px-4 py-2">
                <p className="text-[11.5px] font-medium text-ink-soft">{document.filename}</p>
                <p className="text-[10.5px] text-muted">
                  {document.parse_status.replaceAll("_", " ")} · {formatDate(document.created_at, { day: "numeric", month: "short" })}
                </p>
              </li>
            ))}
            {!failedRuns.length && !parseFailures.length ? (
              <li className="px-4 py-3 text-[11.5px] text-muted">No ingestion or parsing faults recorded.</li>
            ) : null}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
