import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDatabase } from "./helpers";

/**
 * Route-level authorization.
 *
 * `withUser`/`withAdmin` resolve the caller from the session cookie, so these
 * tests swap `next/headers` for a controllable store: the handler code under
 * test is the real one, only the cookie jar is fake.
 */
const session = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (session.token ? { name, value: session.token } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));

const temp = useTempDatabase();

let db: typeof import("@/lib/db");
let users: { alice: string; bob: string; admin: string };
let tokens: { alice: string; bob: string; admin: string };
let evidenceId: string;
let applicationId: string;
let jobId: string;
let sourceId: string;

function tokenFor(userId: string) {
  const token = crypto.randomUUID();
  db.insert("sessions", {
    id: token,
    user_id: userId,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date().toISOString(),
  });
  return token;
}

beforeAll(async () => {
  db = await import("@/lib/db");
  const now = new Date().toISOString();
  users = { alice: crypto.randomUUID(), bob: crypto.randomUUID(), admin: crypto.randomUUID() };
  db.insert("users", { id: users.alice, email: "alice@test.local", name: "Alice", password_hash: "x", role: "user", created_at: now });
  db.insert("users", { id: users.bob, email: "bob@test.local", name: "Bob", password_hash: "x", role: "user", created_at: now });
  db.insert("users", { id: users.admin, email: "admin@test.local", name: "Admin", password_hash: "x", role: "admin", created_at: now });
  tokens = {
    alice: tokenFor(users.alice),
    bob: tokenFor(users.bob),
    admin: tokenFor(users.admin),
  };

  sourceId = crypto.randomUUID();
  db.insert("job_sources", {
    id: sourceId,
    name: "Auth Source",
    slug: "authsource",
    source_type: "public_api",
    access_method: "test",
    terms_url: "https://example.com/terms",
    terms_reviewed_at: now,
    enabled: 1,
    rate_limit_config_json: "{}",
    supported_markets: "global",
    notes: "",
  });

  jobId = crypto.randomUUID();
  db.insert("jobs", {
    id: jobId,
    source_id: sourceId,
    external_id: `ext-${jobId}`,
    canonical_url: "https://example.com/jobs/auth-1",
    application_url: "https://example.com/apply/auth-1",
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
    content_hash: "hash",
    fingerprint: "example|frontend|auth",
    first_seen_at: now,
    last_seen_at: now,
    raw_json: "{}",
  });

  evidenceId = crypto.randomUUID();
  db.insert("profile_evidence", {
    id: evidenceId,
    user_id: users.alice,
    fact_type: "experience",
    title: "Frontend Developer",
    organization: "Acme",
    location: "Remote",
    start_date: "2024-01",
    end_date: null,
    bullets_json: "[]",
    skills_json: "[]",
    state: "professional",
    verification_status: "verified",
    source_document_id: null,
    evidence_note: "",
    created_at: now,
    updated_at: now,
  });

  applicationId = crypto.randomUUID();
  db.insert("applications", {
    id: applicationId,
    user_id: users.alice,
    job_id: jobId,
    package_id: null,
    status: "reviewing",
    last_updated_at: now,
    notes: "alice notes",
    next_action: "",
  });
});

beforeEach(() => {
  session.token = null;
});

afterAll(() => temp.cleanup());

describe("unauthenticated requests", () => {
  it("rejects a read without a session", async () => {
    const { GET } = await import("@/app/api/jobs/route");
    const response = await GET(new Request("http://localhost/api/jobs"));
    expect(response.status).toBe(401);
  });

  it("rejects a write without a session", async () => {
    const { POST } = await import("@/app/api/search-runs/route");
    const response = await POST(new Request("http://localhost/api/search-runs", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
  });

  it("rejects admin routes without a session", async () => {
    const { GET } = await import("@/app/api/admin/sources/route");
    const response = await GET();
    expect(response.status).toBe(401);
  });
});

describe("cross-user access", () => {
  it("lets an owner read their own job feed", async () => {
    session.token = tokens.alice;
    const { GET } = await import("@/app/api/jobs/route");
    const response = await GET(new Request("http://localhost/api/jobs"));
    expect(response.status).toBe(200);
  });

  it("does not let another user edit someone else's evidence", async () => {
    session.token = tokens.bob;
    const { PATCH } = await import("@/app/api/evidence/[id]/route");
    const response = await PATCH(
      new Request(`http://localhost/api/evidence/${evidenceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Hijacked" }),
      }),
      { params: Promise.resolve({ id: evidenceId }) },
    );
    expect(response.status).toBe(404);
    const row = db.get<{ title: string }>("SELECT title FROM profile_evidence WHERE id = ?", evidenceId);
    expect(row?.title).toBe("Frontend Developer");
  });

  it("does not let another user change someone else's application", async () => {
    session.token = tokens.bob;
    const { PATCH } = await import("@/app/api/applications/[id]/route");
    const response = await PATCH(
      new Request(`http://localhost/api/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      { params: Promise.resolve({ id: applicationId }) },
    );
    expect(response.status).toBe(404);
    const row = db.get<{ status: string }>("SELECT status FROM applications WHERE id = ?", applicationId);
    expect(row?.status).toBe("reviewing");
  });

  it("does not let another user approve a package they do not own", async () => {
    session.token = tokens.bob;
    const pkgId = crypto.randomUUID();
    db.insert("application_packages", {
      id: pkgId,
      user_id: users.alice,
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
    const { POST } = await import("@/app/api/application-packages/[id]/approve/route");
    const response = await POST(
      new Request(`http://localhost/api/application-packages/${pkgId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }),
      { params: Promise.resolve({ id: pkgId }) },
    );
    expect(response.status).toBe(404);
    const approvals = db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM application_approvals WHERE package_id = ?",
      pkgId,
    );
    expect(approvals?.count).toBe(0);
  });
});

describe("admin boundary", () => {
  it("refuses source governance to a normal user", async () => {
    session.token = tokens.alice;
    const { GET, PATCH } = await import("@/app/api/admin/sources/route");
    expect((await GET()).status).toBe(403);
    const response = await PATCH(
      new Request("http://localhost/api/admin/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "authsource", enabled: false }),
      }),
    );
    expect(response.status).toBe(403);
    const row = db.get<{ enabled: number }>("SELECT enabled FROM job_sources WHERE id = ?", sourceId);
    expect(row?.enabled).toBe(1);
  });

  it("lets an administrator disable a source and set its limits", async () => {
    session.token = tokens.admin;
    const { PATCH } = await import("@/app/api/admin/sources/route");
    const response = await PATCH(
      new Request("http://localhost/api/admin/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "authsource", enabled: false, rateLimit: { maxRequestsPerHour: 3 } }),
      }),
    );
    expect(response.status).toBe(200);
    const row = db.get<{ enabled: number; rate_limit_config_json: string }>(
      "SELECT enabled, rate_limit_config_json FROM job_sources WHERE id = ?",
      sourceId,
    );
    expect(row?.enabled).toBe(0);
    expect(JSON.parse(row!.rate_limit_config_json)).toMatchObject({ maxRequestsPerHour: 3 });
  });

  it("rejects an empty or invalid governance update", async () => {
    session.token = tokens.admin;
    const { PATCH } = await import("@/app/api/admin/sources/route");
    const empty = await PATCH(
      new Request("http://localhost/api/admin/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "authsource" }),
      }),
    );
    expect(empty.status).toBe(422);
    const unknown = await PATCH(
      new Request("http://localhost/api/admin/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "does-not-exist", enabled: true }),
      }),
    );
    expect(unknown.status).toBe(404);
  });
});

describe("activity and search history endpoints", () => {
  it("returns only the caller's audit trail", async () => {
    db.insert("audit_events", {
      id: crypto.randomUUID(),
      user_id: users.alice,
      actor: "user",
      action: "test.alice_event",
      entity_type: "job",
      entity_id: "",
      metadata_json: "{}",
      created_at: new Date().toISOString(),
    });

    session.token = tokens.bob;
    const { GET } = await import("@/app/api/audit-events/route");
    const bobResponse = await GET(new Request("http://localhost/api/audit-events"));
    expect(bobResponse.status).toBe(200);
    const bob = (await bobResponse.json()) as { events: { action: string }[] };
    expect(bob.events.some((event) => event.action === "test.alice_event")).toBe(false);

    session.token = tokens.alice;
    const aliceResponse = await GET(new Request("http://localhost/api/audit-events?limit=5"));
    const alice = (await aliceResponse.json()) as { events: { action: string }[] };
    expect(alice.events.some((event) => event.action === "test.alice_event")).toBe(true);
    expect(alice.events.length).toBeLessThanOrEqual(5);
  });

  it("rejects an activity read without a session", async () => {
    const { GET } = await import("@/app/api/audit-events/route");
    expect((await GET(new Request("http://localhost/api/audit-events"))).status).toBe(401);
  });

  it("does not expose another user's search run", async () => {
    const runId = crypto.randomUUID();
    db.insert("search_runs", {
      id: runId,
      user_id: users.alice,
      trigger: "manual",
      run_key: null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "succeeded",
      query_config_json: "{}",
      counts_json: "{}",
      error_summary: "",
    });

    session.token = tokens.bob;
    const { GET } = await import("@/app/api/search-runs/[id]/route");
    const denied = await GET(new Request(`http://localhost/api/search-runs/${runId}`), {
      params: Promise.resolve({ id: runId }),
    });
    expect(denied.status).toBe(404);

    session.token = tokens.alice;
    const allowed = await GET(new Request(`http://localhost/api/search-runs/${runId}`), {
      params: Promise.resolve({ id: runId }),
    });
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as { run: { id: string; status: string } };
    expect(body.run.id).toBe(runId);
  });
});
