import { z } from "zod";
import { all, get, insert, nowIso, uid } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";
import { assertPublicUrl, parseJobPage } from "@/lib/sources/manual";
import { jobKeys } from "@/lib/sources/normalize";
import { rescanMatches } from "@/lib/search";

const schema = z.object({ url: z.string().url().max(2000) });

const DAILY_CAP = 20;
const FETCH_TIMEOUT_MS = 8000;

/** User-supplied link ingestion (FR-017). One fetch, no bypass, strict caps. */
export async function POST(request: Request) {
  return withUser(async (user) => {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Paste a full job URL including https://.", 422);

    const target = assertPublicUrl(parsed.data.url);
    if (!target.ok) return fail(target.error, 422);

    const today = nowIso().slice(0, 10);
    const used = all<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE user_id = ? AND action = 'job.manual_import' AND created_at >= ?",
      user.id,
      `${today}T00:00:00.000Z`,
    )[0];
    if ((used?.count ?? 0) >= DAILY_CAP) return fail(`You can add ${DAILY_CAP} links per day. Try again tomorrow.`, 429);

    const source = get<{ id: string }>("SELECT id FROM job_sources WHERE slug = 'manual'");
    if (!source) return fail("Manual import is not configured on this deployment.", 503);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(target.url.toString(), {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "JobHunterBot/1.0 (+https://jobhunter.app; user-supplied link)",
          accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      return fail("That page did not load. Check the link, or add the job manually.", 502);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      return fail("That page requires sign-in, so we will not attempt to read it. Add the job manually instead.", 422);
    }
    if (!response.ok) return fail(`That page returned ${response.status}. Check the link and try again.`, 502);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return fail("That link is not a web page.", 422);
    const html = (await response.text()).slice(0, 2_000_000);

    const result = parseJobPage(html, target.url.toString());
    if (!result.ok) return fail(result.error, 422);
    const { job, warnings } = result.parsed;
    const keys = jobKeys({ ...job, sourceSlug: "manual" });
    const now = nowIso();

    const existing = get<{ id: string }>("SELECT id FROM jobs WHERE canonical_url = ?", keys.canonicalUrl);
    if (existing) {
      audit(user.id, "job.manual_import", "job", existing.id, { url: keys.canonicalUrl, duplicate: true });
      rescanMatches(user.id);
      return json({ ok: true, jobId: existing.id, duplicate: true, warnings });
    }

    const queue = all<{ id: string }>("SELECT id FROM search_runs WHERE user_id = ? LIMIT 1", user.id);
    if (!queue.length) {
      insert("search_runs", {
        id: uid(),
        user_id: user.id,
        trigger: "manual",
        run_key: null,
        started_at: now,
        finished_at: now,
        status: "completed",
        query_config_json: "{}",
        counts_json: "{}",
        error_summary: "",
      });
    }

    const jobId = uid();
    insert("jobs", {
      id: jobId,
      source_id: source.id,
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
      status: "open",
      status_checked_at: now,
      content_hash: keys.contentHash,
      fingerprint: keys.fingerprint,
      first_seen_at: now,
      last_seen_at: now,
      raw_json: JSON.stringify({ ...job.raw, importedBy: user.id, sourceUrl: target.url.toString(), warnings }).slice(0, 20_000),
    });

    audit(user.id, "job.manual_import", "job", jobId, {
      url: keys.canonicalUrl,
      parser: (job.raw as Record<string, unknown>).parser,
      warnings,
    });
    rescanMatches(user.id);
    return json({ ok: true, jobId, duplicate: false, warnings }, 201);
  });
}
