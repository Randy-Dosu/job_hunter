import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useTempDatabase } from "./helpers";

const temp = useTempDatabase();

let db: typeof import("@/lib/db");
let notifyModule: typeof import("@/lib/notify");
let search: typeof import("@/lib/search");

const USER = "88888888-8888-4888-8888-888888888888";
const SOURCE = "99999999-9999-4999-8999-999999999999";

function addJob(overrides: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert("jobs", {
    id,
    source_id: SOURCE,
    external_id: `ext-${id}`,
    canonical_url: `https://example.com/jobs/${id}`,
    application_url: `https://example.com/apply/${id}`,
    title: "Frontend Developer",
    company: "Example Ltd",
    location: "Remote",
    remote_policy: "remote",
    description: "React role",
    responsibilities: "",
    requirements: "React",
    salary: null,
    employment_type: "full-time",
    seniority: "junior",
    posted_at: now,
    deadline: null,
    status: "open",
    status_checked_at: now,
    content_hash: `hash-${id}`,
    fingerprint: `example|frontend|${id}`,
    first_seen_at: now,
    last_seen_at: now,
    raw_json: "{}",
    ...overrides,
  });
  return id;
}

function addMatch(jobId: string, verdict = "strong") {
  db.insert("job_matches", {
    id: crypto.randomUUID(),
    user_id: USER,
    job_id: jobId,
    score: 88,
    confidence: 90,
    verdict,
    reasons_json: "[]",
    gaps_json: "[]",
    components_json: "[]",
    feedback: null,
    matched_at: new Date().toISOString(),
  });
}

beforeAll(async () => {
  db = await import("@/lib/db");
  notifyModule = await import("@/lib/notify");
  search = await import("@/lib/search");
  const now = new Date().toISOString();
  db.insert("users", { id: USER, email: "notify@test.local", name: "Notify", password_hash: "x", created_at: now });
  db.insert("job_preferences", {
    id: crypto.randomUUID(),
    user_id: USER,
    notify_email: 1,
    notify_in_app: 1,
    schedule_enabled: 1,
    timezone: "UTC",
    search_time: "07:00",
    days_of_week_json: "[1,2,3,4,5]",
    updated_at: now,
  });
  db.insert("job_sources", {
    id: SOURCE,
    name: "Test Source",
    slug: "notifytest",
    source_type: "public_api",
    access_method: "test",
    terms_url: "https://example.com/terms",
    terms_reviewed_at: now,
    enabled: 1,
    rate_limit_config_json: "{}",
    supported_markets: "global",
    notes: "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.NOTIFY_FROM;
});

afterAll(() => temp.cleanup());

describe("notification delivery", () => {
  it("stores in-app notifications", async () => {
    const result = await notifyModule.notify({
      userId: USER,
      type: "digest",
      title: "Stored only",
      body: "in app",
      channel: "in_app",
    });
    expect(result.deliveryStatus).toBe("stored");
    const row = db.get<{ channel: string; delivery_status: string }>(
      "SELECT channel, delivery_status FROM notifications WHERE id = ?",
      result.id,
    );
    expect(row?.channel).toBe("in_app");
    expect(row?.delivery_status).toBe("stored");
  });

  it("suppresses email honestly when no provider is configured", async () => {
    const result = await notifyModule.notify({
      userId: USER,
      type: "deadline",
      title: "No provider",
      channel: "both",
    });
    expect(result.deliveryStatus).toBe("suppressed");
    expect(result.deliveryError).toContain("No email provider configured");
    const row = db.get<{ channel: string; delivery_status: string }>(
      "SELECT channel, delivery_status FROM notifications WHERE id = ?",
      result.id,
    );
    expect(row?.channel).toBe("both");
    expect(row?.delivery_status).toBe("suppressed");
  });

  it("delivers email when a provider is configured", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.NOTIFY_FROM = "jobs@example.com";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await notifyModule.notify({
      userId: USER,
      type: "digest",
      title: "Provider configured",
      body: "body",
      channel: "both",
    });
    expect(result.deliveryStatus).toBe("sent");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { to: string[]; subject: string };
    expect(body.to).toEqual(["notify@test.local"]);
    expect(body.subject).toContain("Provider configured");
  });

  it("records a failed provider call instead of pretending it was sent", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.NOTIFY_FROM = "jobs@example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));

    const result = await notifyModule.notify({ userId: USER, type: "digest", title: "Provider fails", channel: "both" });
    expect(result.deliveryStatus).toBe("failed");
    expect(result.deliveryError).toContain("500");
  });

  it("deduplicates by key", async () => {
    const first = await notifyModule.notify({
      userId: USER,
      type: "job_changed",
      title: "Once",
      channel: "in_app",
      dedupeKey: "unique-key-1",
    });
    const second = await notifyModule.notify({
      userId: USER,
      type: "job_changed",
      title: "Once again",
      channel: "in_app",
      dedupeKey: "unique-key-1",
    });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    const count = db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND dedupe_key = ?",
      USER,
      "unique-key-1",
    );
    expect(count?.count).toBe(1);
  });
});

describe("alert sweep", () => {
  it("raises a closing-deadline alert once per listing", async () => {
    const jobId = addJob({ deadline: new Date(Date.now() + 24 * 3_600_000).toISOString(), title: "Closing Role" });
    addMatch(jobId);

    const first = await notifyModule.runAlertSweep(new Date(), USER);
    expect(first.deadlines).toBeGreaterThanOrEqual(1);

    const rows = db.all<{ title: string; type: string }>(
      "SELECT title, type FROM notifications WHERE user_id = ? AND type = 'deadline'",
      USER,
    );
    expect(rows.some((row) => row.title.includes("Closing Role"))).toBe(true);

    const second = await notifyModule.runAlertSweep(new Date(), USER);
    expect(second.deadlines).toBe(0);
  });

  it("raises a follow-up reminder once and stamps the application", async () => {
    const jobId = addJob({ title: "Reminder Role" });
    const applicationId = crypto.randomUUID();
    db.insert("applications", {
      id: applicationId,
      user_id: USER,
      job_id: jobId,
      package_id: null,
      status: "approved",
      last_updated_at: new Date().toISOString(),
      notes: "",
      next_action: "Send a follow-up note",
      next_action_at: new Date(Date.now() - 3_600_000).toISOString(),
    });

    const first = await notifyModule.runAlertSweep(new Date(), USER);
    expect(first.reminders).toBe(1);
    const app = db.get<{ reminder_sent_at: string | null }>(
      "SELECT reminder_sent_at FROM applications WHERE id = ?",
      applicationId,
    );
    expect(app?.reminder_sent_at).toBeTruthy();

    const second = await notifyModule.runAlertSweep(new Date(), USER);
    expect(second.reminders).toBe(0);
  });
});

describe("vacancy liveness", () => {
  it("marks stale listings uncertain and long-abandoned ones closed", async () => {
    const stale = addJob({
      title: "Stale Role",
      last_seen_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });
    const abandoned = addJob({
      title: "Abandoned Role",
      status: "uncertain",
      last_seen_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    const expired = addJob({
      title: "Expired Role",
      deadline: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const result = await search.recheckJobLiveness(new Date());
    expect(result.uncertain).toBeGreaterThanOrEqual(1);
    expect(result.closed).toBeGreaterThanOrEqual(2);

    const staleRow = db.get<{ status: string }>("SELECT status FROM jobs WHERE id = ?", stale);
    const abandonedRow = db.get<{ status: string }>("SELECT status FROM jobs WHERE id = ?", abandoned);
    const expiredRow = db.get<{ status: string }>("SELECT status FROM jobs WHERE id = ?", expired);
    expect(staleRow?.status).toBe("uncertain");
    expect(abandonedRow?.status).toBe("closed");
    expect(expiredRow?.status).toBe("closed");
  });

  it("warns a user once when a job they have a package for closes", async () => {
    const jobId = addJob({
      title: "Packaged Role",
      deadline: new Date(Date.now() - 3_600_000).toISOString(),
    });
    addMatch(jobId);
    db.insert("application_packages", {
      id: crypto.randomUUID(),
      user_id: USER,
      job_id: jobId,
      resume_id: null,
      cover_letter: "",
      answers_json: "[]",
      destination_url: "https://example.com/apply",
      package_hash: "hash",
      status: "PENDING_APPROVAL",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await search.recheckJobLiveness(new Date());
    await search.recheckJobLiveness(new Date());

    const rows = db.all<{ id: string }>(
      "SELECT id FROM notifications WHERE user_id = ? AND type = 'vacancy_closed' AND payload_json LIKE ?",
      USER,
      `%${jobId}%`,
    );
    expect(rows).toHaveLength(1);
  });
});
