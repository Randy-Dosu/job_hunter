import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDatabase } from "./helpers";

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
let manual: typeof import("@/lib/sources/manual");
let userId: string;
let userToken: string;

const JSONLD_PAGE = `<!doctype html><html><head><title>Frontend Developer at Northwind</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Frontend Developer",
  "hiringOrganization": { "@type": "Organization", "name": "Northwind Labs" },
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Berlin", "addressCountry": "DE" } },
  "description": "<h2>About the role</h2><p>Build React and TypeScript interfaces.</p><h2>Requirements</h2><ul><li>3 years with React</li></ul>",
  "employmentType": "FULL_TIME",
  "datePosted": "2026-11-01",
  "validThrough": "2026-12-01",
  "baseSalary": { "@type": "MonetaryAmount", "currency": "EUR", "value": { "@type": "QuantitativeValue", "minValue": 55000, "maxValue": 75000, "unitText": "YEAR" } },
  "url": "https://northwind.example/jobs/123",
  "directApplyTo": "https://northwind.example/apply/123"
}
</script></head><body></body></html>`;

const META_PAGE = `<!doctype html><html><head>
<title>Junior Data Analyst — Parcelly</title>
<meta property="og:site_name" content="Parcelly" />
<meta property="og:description" content="Analyse delivery data with SQL and Python. Remote within Europe." />
</head><body></body></html>`;

const EMPTY_PAGE = `<!doctype html><html><head></head><body><div>Loading…</div></body></html>`;

beforeAll(async () => {
  db = await import("@/lib/db");
  manual = await import("@/lib/sources/manual");
  userId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert("users", { id: userId, email: "import@test.local", name: "Import", password_hash: "x", created_at: now });
  db.insert("job_preferences", {
    id: crypto.randomUUID(),
    user_id: userId,
    role_titles_json: '["Frontend Developer"]',
    remote_preference: "remote",
    updated_at: now,
  });
  userToken = crypto.randomUUID();
  db.insert("sessions", {
    id: userToken,
    user_id: userId,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: now,
  });
});

beforeEach(() => {
  session.token = null;
  vi.unstubAllGlobals();
});

afterAll(() => temp.cleanup());

describe("job page parsing", () => {
  it("reads a schema.org JobPosting", () => {
    const result = manual.parseJobPage(JSONLD_PAGE, "https://northwind.example/jobs/123");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { job, warnings } = result.parsed;
    expect(job.title).toBe("Frontend Developer");
    expect(job.company).toBe("Northwind Labs");
    expect(job.location).toContain("Berlin");
    expect(job.remotePolicy).toBe("unknown"); // an office role in Berlin, with no remote wording
    expect(job.salary).toContain("55,000");
    expect(job.employmentType).toBe("full-time");
    expect(job.applicationUrl).toBe("https://northwind.example/apply/123");
    expect(job.requirements).toContain("React");
    expect(warnings).toHaveLength(0);
  });

  it("falls back to page metadata and says so", () => {
    const result = manual.parseJobPage(META_PAGE, "https://parcelly.example/jobs/9");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.job.title).toContain("Junior Data Analyst");
    expect(result.parsed.job.company).toBe("Parcelly");
    expect(result.parsed.warnings.length).toBeGreaterThan(0);
  });

  it("refuses a page with no recognisable job", () => {
    const result = manual.parseJobPage(EMPTY_PAGE, "https://example.com/x");
    expect(result.ok).toBe(false);
  });

  it("blocks internal addresses and non-http schemes", () => {
    expect(manual.assertPublicUrl("http://localhost:3000/admin").ok).toBe(false);
    expect(manual.assertPublicUrl("http://127.0.0.1/secrets").ok).toBe(false);
    expect(manual.assertPublicUrl("http://192.168.1.10/jobs").ok).toBe(false);
    expect(manual.assertPublicUrl("http://172.16.4.2/jobs").ok).toBe(false);
    expect(manual.assertPublicUrl("file:///etc/passwd").ok).toBe(false);
    expect(manual.assertPublicUrl("https://user:pass@example.com/job").ok).toBe(false);
    expect(manual.assertPublicUrl("https://boards.example.com/jobs/1").ok).toBe(true);
  });
});

describe("import endpoint", () => {
  it("requires a session", async () => {
    const { POST } = await import("@/app/api/jobs/import/route");
    const response = await POST(
      new Request("http://localhost/api/jobs/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://northwind.example/jobs/123" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("imports once and de-duplicates a second import of the same URL", async () => {
    session.token = userToken;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSONLD_PAGE, { status: 200, headers: { "content-type": "text/html" } })),
      ),
    );
    const { POST } = await import("@/app/api/jobs/import/route");
    const call = () =>
      POST(
        new Request("http://localhost/api/jobs/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://northwind.example/jobs/123" }),
        }),
      );

    const first = await call();
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { jobId: string };
    const row = db.get<{ source_id: string; title: string }>("SELECT source_id, title FROM jobs WHERE id = ?", firstBody.jobId);
    expect(row?.title).toBe("Frontend Developer");
    const source = db.get<{ slug: string }>("SELECT slug FROM job_sources WHERE id = ?", row!.source_id);
    expect(source?.slug).toBe("manual");

    const second = await call();
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { duplicate: boolean; jobId: string };
    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.jobId).toBe(firstBody.jobId);
    const count = db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM jobs WHERE canonical_url = ?",
      "https://northwind.example/jobs/123",
    );
    expect(count?.count).toBe(1);
  });

  it("stops politely at a sign-in wall", async () => {
    session.token = userToken;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));
    const { POST } = await import("@/app/api/jobs/import/route");
    const response = await POST(
      new Request("http://localhost/api/jobs/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://private.example/jobs/9" }),
      }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("sign-in");
  });

  it("enforces a daily import cap", async () => {
    session.token = userToken;
    const now = new Date().toISOString();
    for (let index = 0; index < 20; index++) {
      db.insert("audit_events", {
        id: crypto.randomUUID(),
        user_id: userId,
        actor: "user",
        action: "job.manual_import",
        entity_type: "job",
        entity_id: crypto.randomUUID(),
        metadata_json: "{}",
        created_at: now,
      });
    }
    const { POST } = await import("@/app/api/jobs/import/route");
    const response = await POST(
      new Request("http://localhost/api/jobs/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://northwind.example/jobs/999" }),
      }),
    );
    expect(response.status).toBe(429);
  });
});
