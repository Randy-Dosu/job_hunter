import { z } from "zod";
import { all, get, nowIso, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withAdmin } from "@/lib/api";

/**
 * Source governance (FR-060).
 *
 * Administrators enable or disable an adapter, set its rate-limit budget and
 * record the terms review. Disabling a source stops it being fetched for every
 * user on the next run; it never deletes listings that already exist.
 */
const schema = z.object({
  slug: z.string().min(1).max(60),
  enabled: z.boolean().optional(),
  termsReviewedAt: z.string().max(40).nullable().optional(),
  notes: z.string().max(1000).optional(),
  rateLimit: z
    .object({
      maxRequestsPerHour: z.number().int().min(1).max(600).optional(),
      maxRequestsPerDay: z.number().int().min(1).max(5000).optional(),
      timeoutMs: z.number().int().min(1000).max(60_000).optional(),
    })
    .optional(),
});

export async function GET() {
  return withAdmin(async () => {
    const sources = all<Record<string, unknown>>(
      `SELECT s.*,
        (SELECT COUNT(*) FROM jobs j WHERE j.source_id = s.id) AS job_count,
        (SELECT COUNT(*) FROM jobs j WHERE j.source_id = s.id AND j.status = 'open') AS open_count,
        (SELECT COUNT(*) FROM search_runs r WHERE r.error_summary LIKE '%' || s.name || '%') AS failed_run_count
       FROM job_sources s ORDER BY s.name`,
    );
    return json({ sources });
  });
}

export async function PATCH(request: Request) {
  return withAdmin(async (user) => {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Invalid source update.", 422);

    const source = get<{
      id: string;
      name: string;
      enabled: number;
      rate_limit_config_json: string;
      terms_reviewed_at: string | null;
      notes: string;
    }>("SELECT id, name, enabled, rate_limit_config_json, terms_reviewed_at, notes FROM job_sources WHERE slug = ?", parsed.data.slug);
    if (!source) return fail("Unknown source.", 404);

    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    if (parsed.data.enabled !== undefined) {
      updates.push("enabled = ?");
      values.push(parsed.data.enabled ? 1 : 0);
    }
    if (parsed.data.notes !== undefined) {
      updates.push("notes = ?");
      values.push(parsed.data.notes);
    }
    if (parsed.data.termsReviewedAt !== undefined) {
      updates.push("terms_reviewed_at = ?");
      values.push(parsed.data.termsReviewedAt);
    }
    if (parsed.data.rateLimit) {
      let current: Record<string, number> = {};
      try {
        current = JSON.parse(source.rate_limit_config_json || "{}") as Record<string, number>;
      } catch {
        current = {};
      }
      updates.push("rate_limit_config_json = ?");
      values.push(JSON.stringify({ ...current, ...parsed.data.rateLimit }));
    }
    if (!updates.length) return fail("Nothing to update.", 422);

    run(`UPDATE job_sources SET ${updates.join(", ")} WHERE id = ?`, ...values, source.id);
    audit(user.id, "admin.source_updated", "job_source", source.id, {
      slug: parsed.data.slug,
      enabled: parsed.data.enabled,
      rateLimit: parsed.data.rateLimit,
      termsReviewedAt: parsed.data.termsReviewedAt,
      at: nowIso(),
    });
    const updated = get<Record<string, unknown>>("SELECT * FROM job_sources WHERE id = ?", source.id);
    return json({ ok: true, source: updated });
  });
}
