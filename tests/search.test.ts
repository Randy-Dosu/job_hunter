import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDatabase } from "./helpers";

const temp = useTempDatabase();

let db: typeof import("@/lib/db");
let search: typeof import("@/lib/search");

const USER = "66666666-6666-4666-8666-666666666666";

beforeAll(async () => {
  db = await import("@/lib/db");
  search = await import("@/lib/search");
  const now = new Date().toISOString();
  db.insert("users", { id: USER, email: "search@test.local", name: "Search", password_hash: "x", created_at: now });
  db.insert("candidate_profiles", {
    id: crypto.randomUUID(),
    user_id: USER,
    headline: "Frontend developer",
    summary: "",
    location: "Kumasi, Ghana",
    phone: "",
    links_json: "[]",
    work_authorization: "Ghana",
    needs_sponsorship: 0,
    timezone: "Africa/Accra",
    created_at: now,
    updated_at: now,
  });
  db.insert("job_preferences", {
    id: crypto.randomUUID(),
    user_id: USER,
    countries_json: '["Ghana"]',
    cities_json: "[]",
    remote_preference: "remote",
    remote_regions_json: '["Worldwide"]',
    role_titles_json: '["Frontend Developer","React Developer","Software Engineer"]',
    role_families_json: "[]",
    seniority_json: "[]",
    job_types_json: "[]",
    industries_json: "[]",
    excluded_employers_json: "[]",
    excluded_keywords_json: "[]",
    excluded_locations_json: "[]",
    salary_floor: null,
    currency: "USD",
    language: "en",
    work_authorization: "Ghana",
    needs_sponsorship: 0,
    days_of_week_json: "[1,2,3,4,5]",
    search_time: "07:00",
    timezone: "Africa/Accra",
    notify_email: 0,
    notify_in_app: 1,
    schedule_enabled: 1,
    enabled_source_ids_json: "[]",
    updated_at: now,
  });
  const now2 = new Date().toISOString();
  for (const skill of ["React", "TypeScript", "JavaScript", "Node.js", "SQL", "PostgreSQL", "Git", "Tailwind CSS", "REST APIs"]) {
    db.insert("profile_evidence", {
      id: crypto.randomUUID(),
      user_id: USER,
      fact_type: "skill",
      title: skill,
      organization: "",
      location: "",
      start_date: null,
      end_date: null,
      bullets_json: "[]",
      skills_json: "[]",
      state: "professional",
      verification_status: "verified",
      source_document_id: null,
      evidence_note: "test fixture",
      created_at: now2,
      updated_at: now2,
    });
  }
  db.insert("profile_evidence", {
    id: crypto.randomUUID(),
    user_id: USER,
    fact_type: "experience",
    title: "Frontend Developer",
    organization: "Freelance",
    location: "Kumasi, Ghana",
    start_date: "2023-01",
    end_date: null,
    bullets_json: JSON.stringify(["Built React and TypeScript dashboards."]),
    skills_json: JSON.stringify(["React", "TypeScript"]),
    state: "",
    verification_status: "verified",
    source_document_id: null,
    evidence_note: "test fixture",
    created_at: now2,
    updated_at: now2,
  });
  db.insert("profile_evidence", {
    id: crypto.randomUUID(),
    user_id: USER,
    fact_type: "education",
    title: "BSc Computer Science",
    organization: "KNUST",
    location: "Kumasi",
    start_date: "2021-09",
    end_date: "2025-07",
    bullets_json: "[]",
    skills_json: "[]",
    state: "",
    verification_status: "verified",
    source_document_id: null,
    evidence_note: "test fixture",
    created_at: now2,
    updated_at: now2,
  });

  const sources = [
    ["Remotive", "remotive", "https://remotive.com/api/remote-jobs"],
    ["Arbeitnow", "arbeitnow", "https://www.arbeitnow.com/api/job-board-api"],
    ["Remote OK", "remoteok", "https://remoteok.com/api"],
  ];
  for (const [name, slug, terms] of sources) {
    const existing = db.get<{ id: string }>("SELECT id FROM job_sources WHERE slug = ?", slug);
    if (existing) {
      db.run("UPDATE job_sources SET enabled = 1 WHERE id = ?", existing.id);
      continue;
    }
    db.insert("job_sources", {
      id: crypto.randomUUID(),
      name,
      slug,
      source_type: "public_api",
      access_method: "test",
      terms_url: terms,
      terms_reviewed_at: now,
      enabled: 1,
      rate_limit_config_json: "{}",
      supported_markets: "global",
      notes: "",
      last_run_at: null,
      last_status: null,
    });
  }
});

afterAll(() => temp.cleanup());

describe("search pipeline", () => {
  it("ingests, normalises and scores listings", async () => {
    const result = await search.runSearch(USER, "manual");
    expect(result.counts).not.toBeNull();
    const counts = result.counts!;
    expect(counts.discovered).toBeGreaterThan(5);
    expect(counts.matched).toBeGreaterThan(0);
    const jobs = db.all("SELECT id, canonical_url, source_id FROM jobs");
    expect(jobs.length).toBe(counts.created + counts.duplicates);
    const matches = db.all<{ verdict: string }>("SELECT verdict FROM job_matches WHERE user_id = ?", USER);
    expect(matches.some((match) => match.verdict === "strong")).toBe(true);
    expect(matches.some((match) => match.verdict === "excluded")).toBe(true);
  }, 40_000);

  it("does not create duplicates on a second run", async () => {
    const before = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM jobs")!;
    await search.runSearch(USER, "manual");
    const after = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM jobs")!;
    // Only genuinely new listings (none in fixtures) would increase the count.
    expect(after.count).toBeLessThanOrEqual(before.count + 1);
  }, 40_000);

  it("makes scheduled runs idempotent per window", async () => {
    const first = await search.runSearch(USER, "scheduled");
    expect(first.duplicateRun).toBe(false);
    const second = await search.runSearch(USER, "scheduled");
    expect(second.duplicateRun).toBe(true);
  }, 40_000);
});

describe("source budgets", () => {
  it("skips a source that has spent its hourly budget and says why", async () => {
    const source = db.get<{ id: string; slug: string }>("SELECT id, slug FROM job_sources ORDER BY name LIMIT 1")!;
    db.run(
      "UPDATE job_sources SET rate_limit_config_json = ? WHERE id = ?",
      JSON.stringify({ maxRequestsPerHour: 1 }),
      source.id,
    );
    // Pretend the source was already fetched inside this hour.
    search.recordSourceFetch(source.id, "ok");

    const budget = search.sourceBudget(source.id);
    expect(budget.allowed).toBe(false);
    if (!budget.allowed) expect(budget.reason).toContain("hourly limit");

    const result = await search.runSearch(USER, "manual");
    expect(result.duplicateRun).toBe(false);
    expect(result.counts!.sourcesSkipped).toBe(1);
    const row = db.get<{ error_summary: string; counts_json: string }>(
      "SELECT error_summary, counts_json FROM search_runs WHERE id = ?",
      result.runId,
    )!;
    expect(row.error_summary).toContain("skipped");
    expect(row.error_summary).toContain("hourly limit");
    const sourceRow = db.get<{ last_status: string }>("SELECT last_status FROM job_sources WHERE id = ?", source.id)!;
    expect(sourceRow.last_status).toBe("rate_limited");
  });

  it("lets a source fetch again once its window clears", () => {
    // A source that no earlier run has fetched (the manual-import source).
    const source = db.get<{ id: string; slug: string }>("SELECT id, slug FROM job_sources WHERE slug = 'manual'")!;
    db.run(
      "UPDATE job_sources SET rate_limit_config_json = ? WHERE id = ?",
      JSON.stringify({ maxRequestsPerHour: 2 }),
      source.id,
    );
    search.recordSourceFetch(source.id, "ok", new Date(Date.now() - 2 * 3_600_000));
    expect(search.sourceBudget(source.id).allowed).toBe(true);
  });
});
