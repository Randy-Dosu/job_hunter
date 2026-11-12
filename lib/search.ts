import { all, get, insert, nowIso, parseJson, run, uid } from "@/lib/db";
import { getProfileContext, toPreferences } from "@/lib/profile";
import { scoreJob } from "@/lib/matching/score";
import { adapters } from "@/lib/sources/adapters";
import { jobKeys } from "@/lib/sources/normalize";
import type { NormalizedJob, SearchCriteria } from "@/lib/sources/types";
import { truncate } from "@/lib/text";

export type SearchCounts = {
  sourcesAttempted: number;
  sourcesFailed: number;
  discovered: number;
  duplicates: number;
  closed: number;
  created: number;
  updated: number;
  matched: number;
  strong: number;
  fixtureFallback: string[];
};

export type JobRow = {
  id: string;
  source_id: string;
  external_id: string;
  canonical_url: string;
  application_url: string;
  title: string;
  company: string;
  location: string;
  remote_policy: string;
  description: string;
  responsibilities: string;
  requirements: string;
  salary: string | null;
  employment_type: string;
  seniority: string;
  posted_at: string | null;
  deadline: string | null;
  status: string;
  content_hash: string;
  fingerprint: string;
  first_seen_at: string;
  last_seen_at: string;
  source_name?: string;
  source_slug?: string;
};

export function buildCriteria(userId: string): SearchCriteria {
  const prefs = getProfileContext(userId).preferences;
  return {
    roleTitles: prefs.roleTitles,
    keywords: prefs.roleFamilies,
    countries: prefs.countries,
    remotePreference: prefs.remotePreference,
    limitPerSource: 40,
  };
}

function enabledSourceSlugs(userId: string): string[] {
  const prefs = getProfileContext(userId).prefsRow;
  const ids = parseJson<string[]>(prefs.enabled_source_ids_json, []);
  const rows = ids.length
    ? all<{ slug: string }>("SELECT slug FROM job_sources WHERE enabled = 1 AND id IN (" + ids.map(() => "?").join(",") + ")", ...ids)
    : all<{ slug: string; }>("SELECT slug FROM job_sources WHERE enabled = 1");
  return rows.map((row) => row.slug);
}

function upsertJob(
  userId: string,
  sourceId: string,
  job: NormalizedJob,
  counts: SearchCounts,
): { id: string; isNew: boolean; changed: boolean } {
  const keys = jobKeys(job);
  const now = nowIso();
  const deadlinePassed = job.deadline ? new Date(job.deadline).getTime() < Date.now() : false;
  const status = deadlinePassed || /applications? (closed|have closed)/i.test(job.description) ? "closed" : "open";

  const existing = get<JobRow>("SELECT * FROM jobs WHERE source_id = ? AND external_id = ?", sourceId, job.externalId);
  if (existing) {
    const changed = existing.content_hash !== keys.contentHash;
    run(
      `UPDATE jobs SET title = ?, company = ?, location = ?, remote_policy = ?, seniority = ?, employment_type = ?,
        description = ?, requirements = ?, salary = ?, deadline = ?, application_url = ?, status = ?, content_hash = ?,
        last_seen_at = ?, status_checked_at = ? WHERE id = ?`,
      job.title,
      job.company,
      job.location,
      job.remotePolicy,
      job.seniority,
      job.employmentType,
      job.description,
      job.requirements,
      job.salary,
      job.deadline,
      job.applicationUrl,
      status,
      keys.contentHash,
      now,
      now,
      existing.id,
    );
    counts.updated += 1;
    return { id: existing.id, isNew: false, changed };
  }

  const byUrl = get<{ id: string; content_hash: string }>("SELECT id, content_hash FROM jobs WHERE canonical_url = ?", keys.canonicalUrl);
  const byFingerprint = get<{ id: string; content_hash: string }>(
    "SELECT id, content_hash FROM jobs WHERE fingerprint = ? AND last_seen_at > ?",
    keys.fingerprint,
    new Date(Date.now() - 30 * 86_400_000).toISOString(),
  );

  if (byUrl) {
    run("UPDATE jobs SET last_seen_at = ? WHERE id = ?", now, byUrl.id);
    counts.duplicates += 1;
    return { id: byUrl.id, isNew: false, changed: byUrl.content_hash !== keys.contentHash };
  }
  if (byFingerprint) {
    run("UPDATE jobs SET last_seen_at = ? WHERE id = ?", now, byFingerprint.id);
    counts.duplicates += 1;
    return { id: byFingerprint.id, isNew: false, changed: byFingerprint.content_hash !== keys.contentHash };
  }

  // Same employer + title + location but a different source: merge as a duplicate
  // of the earliest record and keep provenance in raw_json.
  const id = uid();
  insert("jobs", {
    id,
    source_id: sourceId,
    external_id: job.externalId,
    canonical_url: keys.canonicalUrl,
    application_url: job.applicationUrl,
    title: job.title,
    company: job.company,
    location: job.location,
    remote_policy: job.remotePolicy,
    description: job.description,
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    salary: job.salary,
    employment_type: job.employmentType,
    seniority: job.seniority,
    posted_at: job.postedAt,
    deadline: job.deadline,
    status,
    status_checked_at: now,
    content_hash: keys.contentHash,
    fingerprint: keys.fingerprint,
    first_seen_at: now,
    last_seen_at: now,
    raw_json: JSON.stringify(job.raw).slice(0, 20_000),
  });
  counts.created += 1;
  if (status === "closed") counts.closed += 1;
  return { id, isNew: true, changed: false };
}

export function rescanMatches(userId: string) {
  const context = getProfileContext(userId);
  const jobs = all<JobRow>("SELECT * FROM jobs");
  let strong = 0;
  for (const job of jobs) {
    const result = scoreJob(
      {
        title: job.title,
        company: job.company,
        location: job.location,
        remotePolicy: job.remote_policy,
        description: job.description,
        salary: job.salary,
        employmentType: job.employment_type,
        seniority: job.seniority,
        postedAt: job.posted_at,
        deadline: job.deadline,
        status: job.status,
      },
      context.preferences,
      context.snapshot,
    );
    if (result.verdict === "strong") strong += 1;
    const existing = get<{ id: string }>("SELECT id FROM job_matches WHERE user_id = ? AND job_id = ?", userId, job.id);
    if (existing) {
      run(
        `UPDATE job_matches SET score = ?, confidence = ?, verdict = ?, reasons_json = ?, gaps_json = ?, components_json = ?, matched_at = ? WHERE id = ?`,
        result.score,
        result.confidence,
        result.verdict,
        JSON.stringify(result.reasons),
        JSON.stringify(result.gaps),
        JSON.stringify(result.components),
        nowIso(),
        existing.id,
      );
    } else {
      insert("job_matches", {
        id: uid(),
        user_id: userId,
        job_id: job.id,
        score: result.score,
        confidence: result.confidence,
        verdict: result.verdict,
        reasons_json: JSON.stringify(result.reasons),
        gaps_json: JSON.stringify(result.gaps),
        components_json: JSON.stringify(result.components),
        feedback: null,
        matched_at: nowIso(),
      });
    }
  }
  return { total: jobs.length, strong };
}

export async function runSearch(userId: string, trigger: "manual" | "scheduled" = "manual") {
  const runId = uid();
  const startedAt = nowIso();
  const slugList = enabledSourceSlugs(userId);
  const criteria = buildCriteria(userId);
  const runKey =
    trigger === "scheduled" ? `${userId}:scheduled:${startedAt.slice(0, 10)}` : null;

  try {
    insert("search_runs", {
      id: runId,
      user_id: userId,
      trigger,
      run_key: runKey,
      started_at: startedAt,
      status: "running",
      query_config_json: JSON.stringify(criteria),
      counts_json: "{}",
      error_summary: "",
    });
  } catch {
    // Unique run_key: a scheduled run already happened in this window.
    const existing = get<{ id: string }>("SELECT id FROM search_runs WHERE run_key = ?", runKey)!;
    return { runId: existing.id, duplicateRun: true, counts: null as SearchCounts | null };
  }

  const counts: SearchCounts = {
    sourcesAttempted: slugList.length,
    sourcesFailed: 0,
    discovered: 0,
    duplicates: 0,
    closed: 0,
    created: 0,
    updated: 0,
    matched: 0,
    strong: 0,
    fixtureFallback: [],
  };
  const errors: string[] = [];

  const sourceRows = all<{ id: string; slug: string }>("SELECT id, slug FROM job_sources");
  const sourceBySlug = new Map(sourceRows.map((row) => [row.slug, row.id]));

  const results = await Promise.all(
    adapters
      .filter((adapter) => slugList.includes(adapter.slug))
      .map(async (adapter) => ({ adapter, outcome: await adapter.search(criteria) })),
  );

  const seenIds = new Set<string>();
  for (const { adapter, outcome } of results) {
    const sourceId = sourceBySlug.get(adapter.slug);
    if (!sourceId) continue;
    if (outcome.error) {
      counts.sourcesFailed += 1;
      errors.push(`${adapter.name}: ${outcome.error}`);
    }
    if (outcome.usedFixture) counts.fixtureFallback.push(adapter.name);
    counts.discovered += outcome.jobs.length;
    for (const job of outcome.jobs) {
      const { id } = upsertJob(userId, sourceId, job, counts);
      seenIds.add(id);
    }
    run(
      "UPDATE job_sources SET last_run_at = ?, last_status = ? WHERE id = ?",
      nowIso(),
      outcome.error ? (outcome.usedFixture ? "fixture_fallback" : "error") : "ok",
      sourceId,
    );
  }

  const scores = rescanMatches(userId);
  counts.matched = scores.total;
  counts.strong = scores.strong;

  const finishedAt = nowIso();
  const allFailedWithoutData = counts.sourcesFailed === counts.sourcesAttempted && counts.discovered === 0;
  run(
    "UPDATE search_runs SET finished_at = ?, status = ?, counts_json = ?, error_summary = ? WHERE id = ?",
    finishedAt,
    allFailedWithoutData ? "failed" : errors.length ? "partial" : "completed",
    JSON.stringify(counts),
    errors.join(" · ").slice(0, 1000),
    runId,
  );

  const strongJobs = all<{ title: string; company: string; job_id: string }>(
    `SELECT j.title, j.company, m.job_id FROM job_matches m JOIN jobs j ON j.id = m.job_id
     WHERE m.user_id = ? AND m.verdict = 'strong' AND j.status = 'open' ORDER BY m.score DESC LIMIT 3`,
    userId,
  );

  insert("notifications", {
    id: uid(),
    user_id: userId,
    type: "digest",
    title: `Daily search complete — ${counts.created} new role${counts.created === 1 ? "" : "s"}`,
    body: strongJobs.length
      ? `Top matches: ${strongJobs.map((job) => `${job.title} at ${job.company}`).join("; ")}. ${counts.duplicates} duplicate listings removed.`
      : `${counts.discovered} listings reviewed, ${counts.duplicates} duplicates removed. No strong matches in this run.`,
    payload_json: JSON.stringify({ runId, counts }),
    read_at: null,
    created_at: finishedAt,
  });

  insert("audit_events", {
    id: uid(),
    user_id: userId,
    actor: "system",
    action: "search.completed",
    entity_type: "search_run",
    entity_id: runId,
    metadata_json: JSON.stringify(counts),
    created_at: finishedAt,
  });

  return { runId, duplicateRun: false, counts };
}

let bootstrapPromise: Promise<unknown> | null = null;

/** First visit: run a real search so the dashboard is never empty. */
export async function ensureBootstrapSearch(userId: string) {
  const anyJob = get<{ id: string }>("SELECT id FROM jobs LIMIT 1");
  if (anyJob) return;
  if (!bootstrapPromise) {
    bootstrapPromise = runSearch(userId, "scheduled").finally(() => {
      bootstrapPromise = null;
    });
  }
  await bootstrapPromise;
}

export type MatchView = {
  match: {
    id: string;
    score: number;
    confidence: number;
    verdict: string;
    reasons: { dimension: string; text: string; strength: string }[];
    gaps: { kind: string; text: string; required: boolean }[];
    components: { key: string; label: string; weight: number; score: number; points: number; confidence: number; note: string }[];
    feedback: string | null;
    matched_at: string;
  };
  job: JobRow;
};

export function listMatches(userId: string, options: { verdict?: string; includeExcluded?: boolean; limit?: number } = {}): MatchView[] {
  const params: (string | number)[] = [userId];
  let clause = "WHERE m.user_id = ?";
  if (options.verdict) {
    clause += " AND m.verdict = ?";
    params.push(options.verdict);
  } else if (!options.includeExcluded) {
    clause += " AND m.verdict != 'excluded'";
  }
  params.push(options.limit ?? 200);
  const rows = all<Record<string, unknown>>(
    `SELECT m.*, j.*, m.id AS match_id, j.id AS job_id, s.name AS source_name, s.slug AS source_slug
     FROM job_matches m
     JOIN jobs j ON j.id = m.job_id
     JOIN job_sources s ON s.id = j.source_id
     ${clause}
     ORDER BY CASE m.verdict WHEN 'strong' THEN 0 WHEN 'possible' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, m.score DESC
     LIMIT ?`,
    ...params,
  );

  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      match: {
        id: String(r.match_id),
        score: Number(r.score),
        confidence: Number(r.confidence),
        verdict: String(r.verdict),
        reasons: parseJson(r.reasons_json as string, []),
        gaps: parseJson(r.gaps_json as string, []),
        components: parseJson(r.components_json as string, []),
        feedback: (r.feedback as string) ?? null,
        matched_at: String(r.matched_at),
      },
      job: {
        id: String(r.job_id),
        source_id: String(r.source_id),
        external_id: String(r.external_id),
        canonical_url: String(r.canonical_url),
        application_url: String(r.application_url),
        title: String(r.title),
        company: String(r.company),
        location: String(r.location),
        remote_policy: String(r.remote_policy),
        description: String(r.description),
        responsibilities: String(r.responsibilities ?? ""),
        requirements: String(r.requirements ?? ""),
        salary: (r.salary as string) ?? null,
        employment_type: String(r.employment_type),
        seniority: String(r.seniority),
        posted_at: (r.posted_at as string) ?? null,
        deadline: (r.deadline as string) ?? null,
        status: String(r.status),
        content_hash: String(r.content_hash),
        fingerprint: String(r.fingerprint),
        first_seen_at: String(r.first_seen_at),
        last_seen_at: String(r.last_seen_at),
        source_name: String(r.source_name ?? ""),
        source_slug: String(r.source_slug ?? ""),
      },
    };
  });
}

export function getMatch(userId: string, jobId: string): MatchView | null {
  return listMatches(userId, { includeExcluded: true }).find((entry) => entry.job.id === jobId) ?? null;
}

export function dashboardCounts(userId: string) {
  const runs = all<{ id: string; finished_at: string | null; counts_json: string; status: string; trigger: string }>(
    "SELECT * FROM search_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
    userId,
  );
  const pipeline = all<{ status: string; status_count: number }>(
    "SELECT status, COUNT(*) AS status_count FROM applications WHERE user_id = ? GROUP BY status",
    userId,
  );
  const unread = get<{ count: number }>("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL", userId);
  const pendingApprovals = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM application_packages WHERE user_id = ? AND status IN ('PENDING_APPROVAL','APPROVED')",
    userId,
  );
  const latest = runs[0];
  return {
    lastRun: latest
      ? {
          id: latest.id,
          finishedAt: latest.finished_at,
          status: latest.status,
          trigger: latest.trigger,
          counts: parseJson<SearchCounts | Record<string, never>>(latest.counts_json, {}),
        }
      : null,
    pipeline: Object.fromEntries(pipeline.map((row) => [row.status, row.status_count])),
    unread: unread?.count ?? 0,
    pendingApprovals: pendingApprovals?.count ?? 0,
  };
}

export { truncate };
