import { listMatches } from "@/lib/search";
import { json, withUser } from "@/lib/api";

export async function GET(request: Request) {
  return withUser(async (user) => {
    const params = new URL(request.url).searchParams;
    const verdict = params.get("verdict") ?? undefined;
    const includeExcluded = params.get("includeExcluded") === "true";
    const minScore = Number(params.get("minScore") ?? 0);
    const results = listMatches(user.id, { verdict, includeExcluded }).filter((entry) => entry.match.score >= minScore);
    return json({
      count: results.length,
      jobs: results.map(({ job, match }) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        remotePolicy: job.remote_policy,
        salary: job.salary,
        postedAt: job.posted_at,
        deadline: job.deadline,
        status: job.status,
        source: job.source_name,
        sourceUrl: job.canonical_url,
        applicationUrl: job.application_url,
        match: {
          score: match.score,
          confidence: match.confidence,
          verdict: match.verdict,
          reasons: match.reasons,
          gaps: match.gaps,
          feedback: match.feedback,
        },
      })),
    });
  });
}
