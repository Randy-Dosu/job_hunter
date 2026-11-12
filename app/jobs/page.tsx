import Link from "next/link";
import { Inbox, ShieldAlert, Sparkles } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { JobCard } from "@/components/job-card";
import { SearchTrigger } from "@/components/search-trigger";
import { Callout, EmptyState } from "@/components/ui";
import { ensureBootstrapSearch, listMatches, type MatchView } from "@/lib/search";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "All relevant" },
  { key: "strong", label: "Strong" },
  { key: "possible", label: "Possible with gaps" },
  { key: "low", label: "Low match" },
  { key: "excluded", label: "Excluded" },
];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  await ensureBootstrapSearch(user.id);
  const { tab = "all" } = await searchParams;

  const all = listMatches(user.id, { includeExcluded: true });
  const relevant = all.filter((entry) => entry.match.verdict !== "excluded");
  const excluded = all.filter((entry) => entry.match.verdict === "excluded");

  const filtered: MatchView[] =
    tab === "excluded"
      ? excluded
      : tab === "all"
        ? relevant
        : relevant.filter((entry) => entry.match.verdict === tab);

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
        eyebrow="Discovery"
        title="Job feed"
        description="Every vacancy here passed through normalization, duplicate detection and a freshness check. Scores explain themselves."
        actions={<SearchTrigger />}
      />

      {excluded.length ? (
        <div className="mb-5">
          <Callout tone="info" title={`${excluded.length} listings hidden by your hard filters`}>
            They stay visible under the <Link href="/jobs?tab=excluded" className="font-semibold underline">Excluded</Link> tab so
            you can check the reasoning, but they never count towards your matches.
          </Callout>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-slate-200 pb-3">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "all" ? "/jobs" : `/jobs?tab=${item.key}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === item.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {item.label}
            <span className={`ml-1.5 ${tab === item.key ? "text-white/70" : "text-slate-400"}`}>{counts[item.key as keyof typeof counts]}</span>
          </Link>
        ))}
      </div>

      {filtered.length ? (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <JobCard key={`${entry.job.id}-${entry.match.id}`} entry={entry} />
          ))}
        </div>
      ) : tab === "excluded" ? (
        <EmptyState
          icon={<ShieldAlert size={20} />}
          title="Nothing has been filtered out"
          description="When a listing breaks one of your hard filters — a closed vacancy, an excluded employer or an on-site role you cannot take — it will appear here with the exact reason."
          action={{ href: "/jobs", label: "Back to relevant jobs" }}
        />
      ) : (
        <EmptyState
          icon={<Inbox size={20} />}
          title="No jobs in this bucket yet"
          description="Run a search, or widen your role titles and market in settings. We never pad the feed with irrelevant listings to look busy."
          action={{ href: "/settings", label: "Adjust preferences" }}
        />
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 px-4 py-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles size={13} className="text-brand-500" />
          Scores weight role relevance, required skills, seniority, location, education, salary, industry and freshness.
        </span>
        <Link href="/settings#sources" className="font-semibold text-brand-600 hover:underline">
          Review allowed sources
        </Link>
      </div>
    </AppShell>
  );
}
