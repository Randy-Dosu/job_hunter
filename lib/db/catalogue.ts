import type { DatabaseSync } from "node:sqlite";

/**
 * Reviewed source catalogue.
 *
 * These rows are configuration, not sample content: each one records the access
 * method, terms review, markets and request budget a source is allowed. They are
 * ensured on open, so an install is immediately able to search, and an admin
 * console always has something truthful to govern. No accounts, jobs or matches
 * are ever seeded.
 */
export const SOURCE_CATALOGUE = [
  {
    name: "Remotive",
    slug: "remotive",
    sourceType: "public_api",
    accessMethod: "Public JSON API (no key)",
    termsUrl: "https://remotive.com/api/remote-jobs",
    supportedMarkets: "Global remote",
    notes: "Attribution required. Rate limited to one request per hour per IP in our configuration.",
    rateLimit: { maxRequestsPerHour: 4, timeoutMs: 8000 },
  },
  {
    name: "Arbeitnow",
    slug: "arbeitnow",
    sourceType: "public_feed",
    accessMethod: "Public job-board API (no key)",
    termsUrl: "https://www.arbeitnow.com/api/job-board-api",
    supportedMarkets: "Europe, global remote",
    notes: "Free public API for job aggregation. Pagination supported.",
    rateLimit: { maxRequestsPerHour: 6, timeoutMs: 8000 },
  },
  {
    name: "Remote OK",
    slug: "remoteok",
    sourceType: "public_feed",
    accessMethod: "Public RSS/JSON feed with attribution",
    termsUrl: "https://remoteok.com/api",
    supportedMarkets: "Global remote",
    notes: "Requires visible attribution and a link back to the original listing.",
    rateLimit: { maxRequestsPerHour: 4, timeoutMs: 8000 },
  },
  {
    name: "Manual import",
    slug: "manual",
    sourceType: "user_supplied",
    accessMethod: "Single URL pasted by the user",
    termsUrl: "https://jobhunter.app/terms/manual-import",
    supportedMarkets: "Any",
    notes:
      "User-supplied link. Fetched once, politely, with no login, no CAPTCHA handling and no bypass of access controls. The user is responsible for the terms of the site they paste.",
    rateLimit: { maxRequestsPerDay: 20, timeoutMs: 8000 },
  },
];

export function ensureSourceCatalogue(db: DatabaseSync) {
  const insert = db.prepare(
    `INSERT INTO job_sources (id, name, slug, source_type, access_method, terms_url, terms_reviewed_at, enabled,
      rate_limit_config_json, supported_markets, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  for (const source of SOURCE_CATALOGUE) {
    const existing = db.prepare("SELECT id FROM job_sources WHERE slug = ?").get(source.slug) as { id: string } | undefined;
    if (existing) continue;
    insert.run(
      crypto.randomUUID(),
      source.name,
      source.slug,
      source.sourceType,
      source.accessMethod,
      source.termsUrl,
      now,
      JSON.stringify(source.rateLimit),
      source.supportedMarkets,
      source.notes,
    );
  }
}
