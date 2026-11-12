import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { MatchView } from "@/lib/search";
import { CompanyMark, MatchScore, SourceLink, VerdictBadge } from "./ui";
import { formatRelative } from "@/lib/text";

function salaryLine(salary: string | null) {
  return salary ? salary : null;
}

export function JobCard({ entry }: { entry: MatchView }) {
  const { job, match } = entry;
  const topReason = match.reasons.find((reason) => reason.strength === "strong") ?? match.reasons[0];
  const requiredGap = match.gaps.find((gap) => gap.required) ?? match.gaps[0];
  const tags = [
    job.remote_policy === "remote" ? "Remote" : job.remote_policy === "hybrid" ? "Hybrid" : job.remote_policy === "onsite" ? "On-site" : null,
    job.employment_type !== "unknown" ? job.employment_type : null,
    job.seniority !== "unknown" ? job.seniority : null,
  ].filter(Boolean) as string[];

  return (
    <article className="group border-b border-line bg-surface first:rounded-t-[10px] last:rounded-b-[10px] hover:bg-[#fcfbf9]">
      <div className="flex gap-3.5 p-4">
        <CompanyMark name={job.company} size={40} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/jobs/${job.id}`}
                className="block truncate text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-ink hover:underline"
              >
                {job.title}
              </Link>
              <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">
                {job.company}
                <span className="text-muted"> · {job.location}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <div className="hidden sm:block">
                <MatchScore score={match.score} verdict={match.verdict} />
              </div>
              <span className="sm:hidden">
                <VerdictBadge verdict={match.verdict} withLabel={false} />
              </span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            {salaryLine(job.salary) ? <span className="font-semibold text-moss-700">{job.salary}</span> : <span className="text-muted">Salary not disclosed</span>}
            {tags.map((tag) => (
              <span key={tag} className="capitalize text-muted">
                · {tag}
              </span>
            ))}
          </div>

          {topReason ? (
            <p className="mt-2 line-clamp-1 text-[12px] leading-relaxed text-ink-soft">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-moss-700">Match</span>
              {topReason.text}
            </p>
          ) : null}
          {requiredGap ? (
            <p className="mt-0.5 line-clamp-1 text-[12px] leading-relaxed text-muted">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-clay-700">Gap</span>
              {requiredGap.text}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <SourceLink href={job.canonical_url} label={job.source_name ?? "Source"} muted />
            <span className="text-[11px] text-muted">Posted {formatRelative(job.posted_at)}</span>
            {job.deadline ? <span className="text-[11px] text-clay-700">Closes {formatRelative(job.deadline)}</span> : null}
            <Link
              href={`/jobs/${job.id}`}
              className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-ink hover:underline"
            >
              View role <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
