import Link from "next/link";
import { ArrowRight, MapPin, Wallet } from "lucide-react";
import type { MatchView } from "@/lib/search";
import { ScoreRing, SourceLink, VerdictBadge, formatDate } from "./ui";
import { formatRelative } from "@/lib/text";

export function JobCard({ entry, compact = false }: { entry: MatchView; compact?: boolean }) {
  const { job, match } = entry;
  const topReason = match.reasons.find((reason) => reason.strength === "strong") ?? match.reasons[0];
  const topGap = match.gaps.find((gap) => gap.required) ?? match.gaps[0];

  return (
    <article className="card transition hover:border-slate-300 hover:shadow-[0_2px_6px_rgba(16,24,40,0.06),0_18px_40px_-28px_rgba(16,24,40,0.4)]">
      <div className="flex gap-4 p-4 sm:p-5">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-sm font-semibold text-slate-600">
          {job.company.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/jobs/${job.id}`} className="text-[15px] font-semibold leading-tight text-slate-900 hover:text-brand-700">
                {job.title}
              </Link>
              <p className="mt-0.5 text-xs text-slate-500">
                {job.company}
                <span className="mx-1.5 text-slate-300">·</span>
                <span className="capitalize">{job.remote_policy}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                {job.employment_type}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <VerdictBadge verdict={match.verdict} />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MapPin size={11} /> {job.location}
            </span>
            {job.salary ? (
              <span className="inline-flex items-center gap-1">
                <Wallet size={11} /> {job.salary}
              </span>
            ) : null}
            <span>Posted {formatRelative(job.posted_at)}</span>
            {job.deadline ? <span className="text-amber-700">Closes {formatDate(job.deadline)}</span> : null}
          </div>

          {!compact ? (
            <div className="mt-2.5 space-y-1">
              {topReason ? (
                <p className="text-[12px] leading-relaxed text-slate-600">
                  <span className="font-medium text-emerald-700">Why: </span>
                  {topReason.text}
                </p>
              ) : null}
              {topGap ? (
                <p className="text-[12px] leading-relaxed text-slate-600">
                  <span className="font-medium text-amber-700">Gap: </span>
                  {topGap.text}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
            <div className="flex items-center gap-3">
              <SourceLink href={job.canonical_url} label={job.source_name ?? "Source"} />
              <span className="text-[11px] text-slate-400">{match.confidence}% confidence</span>
            </div>
            <Link href={`/jobs/${job.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
              Review match <ArrowRight size={12} />
            </Link>
          </div>
        </div>
        <div className="hidden sm:block">
          <ScoreRing score={Math.round(match.score)} confidence={match.confidence} verdict={match.verdict} />
        </div>
      </div>
    </article>
  );
}
