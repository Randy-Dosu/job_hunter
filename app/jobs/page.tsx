import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { JobCard } from "@/components/job-card";
import { ManualJobForm } from "@/components/manual-job-form";
import { SearchTrigger } from "@/components/search-trigger";
import { Callout, EmptyState } from "@/components/ui";
import { listMatches, type MatchView } from "@/lib/search";
import { requireUser } from "@/lib/auth";
import { getProfileContext } from "@/lib/profile";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All relevant" },
  { key: "strong", label: "Strong match" },
  { key: "possible", label: "Possible with gaps" },
  { key: "low", label: "Low match" },
  { key: "excluded", label: "Excluded" },
];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { tab = "all" } = await searchParams;
  const context = getProfileContext(user.id);
  const prefs = context.preferences;

  const all = listMatches(user.id, { includeExcluded: true });
  const relevant = all.filter((entry) => entry.match.verdict !== "excluded");
  const excluded = all.filter((entry) => entry.match.verdict === "excluded");
  const filtered: MatchView[] =
    tab === "excluded" ? excluded : tab === "all" ? relevant : relevant.filter((entry) => entry.match.verdict === tab);

  const counts = {
    all: relevant.length,
    strong: relevant.filter((entry) => entry.match.verdict === "strong").length,
    possible: relevant.filter((entry) => entry.match.verdict === "possible").length,
    low: relevant.filter((entry) => entry.match.verdict === "low").length,
    excluded: excluded.length,
  };

  return (
    <AppShell>
      <PageHeader
        title="Jobs"
        description="Normalized, de-duplicated and freshness-checked. Scores show what matched and what did not."
        actions={<SearchTrigger />}
      />

      <div className="grid gap-8 lg:grid-cols-[196px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-6">
          <div>
            <p className="label-xs mb-1.5">Match</p>
            <nav className="space-y-0.5">
              {FILTERS.map((filter) => {
                const active = tab === filter.key;
                return (
                  <Link
                    key={filter.key}
                    href={filter.key === "all" ? "/jobs" : `/jobs?tab=${filter.key}`}
                    className={`side-link ${active ? "side-link-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span>{filter.label}</span>
                    <span className={`number text-[11.5px] ${active ? "text-ink" : "text-muted"}`}>{counts[filter.key as keyof typeof counts]}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="border-t border-line pt-4">
            <p className="label-xs mb-1.5">Your market</p>
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Arrangement</dt>
                <dd className="text-right capitalize text-ink">{prefs.remotePreference}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Regions</dt>
                <dd className="max-w-[110px] truncate text-right text-ink">{prefs.remoteRegions.join(", ") || "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Salary floor</dt>
                <dd className="text-right text-ink">
                  {prefs.salaryFloor ? `${prefs.currency} ${prefs.salaryFloor.toLocaleString()}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Exclusions</dt>
                <dd className="text-right text-ink">
                  {prefs.excludedEmployers.length + prefs.excludedKeywords.length + prefs.excludedLocations.length}
                </dd>
              </div>
            </dl>
            <div className="mt-2.5 flex flex-col items-start gap-2">
              <Link href="/settings#market" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ink hover:underline">
                <SlidersHorizontal size={11} /> Edit filters
              </Link>
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <ManualJobForm />
          </div>

          {prefs.roleTitles.length ? (
            <div className="border-t border-line pt-4">
              <p className="label-xs mb-1.5">Target titles</p>
              <ul className="space-y-0.5 text-[12px] text-ink-soft">
                {prefs.roleTitles.slice(0, 6).map((title) => (
                  <li key={title} className="truncate">
                    {title}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>

        <div className="min-w-0">
          {tab === "excluded" && excluded.length ? (
            <div className="mb-4">
              <Callout tone="note" title={`${excluded.length} listings hidden by your hard filters`}>
                They remain visible here so you can check the reasoning. Adjust an exclusion in{" "}
                <Link href="/settings#market" className="link">
                  settings
                </Link>{" "}
                to bring them back.
              </Callout>
            </div>
          ) : null}

          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[12px] text-muted">
              <span className="font-medium text-ink">{filtered.length}</span> {filtered.length === 1 ? "role" : "roles"}
              <span className="mx-1.5 text-line-strong">·</span>
              sorted by match
            </p>
            <Link href="/jobs" className="text-[11.5px] text-muted hover:text-ink hover:underline">
              Reset filter
            </Link>
          </div>

          {filtered.length ? (
            <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
              {filtered.map((entry) => (
                <JobCard key={`${entry.job.id}-${entry.match.id}`} entry={entry} />
              ))}
            </div>
          ) : tab === "excluded" ? (
            <EmptyState
              title="Nothing has been filtered out"
              description="When a listing breaks a hard filter — a closed vacancy, an excluded employer, or an on-site role you cannot take — it appears here with the exact reason."
              action={{ href: "/jobs", label: "Back to relevant jobs" }}
            />
          ) : (
            <EmptyState
              title="No jobs in this bucket yet"
              description="Run a search, or widen your role titles and market in settings. The feed is never padded with irrelevant listings."
              action={{ href: "/settings#market", label: "Adjust preferences" }}
            />
          )}

          <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
            Scores weight role relevance, required skills, seniority, location, education, salary, industry and freshness. Missing
            fields lower confidence rather than counting as a match.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
