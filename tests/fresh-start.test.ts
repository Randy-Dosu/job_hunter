import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDatabase } from "./helpers";

const temp = useTempDatabase();

let db: typeof import("@/lib/db");
let auth: typeof import("@/lib/auth");

beforeAll(async () => {
  db = await import("@/lib/db");
  auth = await import("@/lib/auth");
});

afterAll(() => temp.cleanup());

describe("no seeded or demo data", () => {
  it("starts with an empty database", () => {
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count).toBe(0);
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM jobs")?.count).toBe(0);
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM profile_evidence")?.count).toBe(0);
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM notifications")?.count).toBe(0);
    // The reviewed source catalogue is configuration (access method, terms, budgets),
    // not sample content; no listings or accounts come with it.
    const sources = db.all<{ slug: string }>("SELECT slug FROM job_sources ORDER BY slug").map((row) => row.slug);
    expect(sources).toEqual(["arbeitnow", "manual", "remoteok", "remotive"]);
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM jobs")?.count).toBe(0);
  });

  it("creates accounts with no sample profile, facts or packages", () => {
    const result = auth.registerUser({ name: "New Person", email: "new@example.com", password: "correct-horse" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const profile = db.get<{ headline: string; summary: string }>(
      "SELECT headline, summary FROM candidate_profiles WHERE user_id = ?",
      result.userId,
    );
    expect(profile?.headline).toBe("");
    expect(profile?.summary).toBe("");
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM profile_evidence WHERE user_id = ?", result.userId)?.count).toBe(0);
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM application_packages")?.count).toBe(0);
    expect(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM tailored_resumes")?.count).toBe(0);
    const user = db.get<{ role: string }>("SELECT role FROM users WHERE id = ?", result.userId);
    expect(user?.role).toBe("user");
  });

  it("grants administrator rights only through ADMIN_EMAILS", () => {
    process.env.ADMIN_EMAILS = "boss@example.com, owner@example.com";
    const result = auth.registerUser({ name: "Boss", email: "boss@example.com", password: "correct-horse" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const user = db.get<{ role: string }>("SELECT role FROM users WHERE id = ?", result.userId);
    expect(user?.role).toBe("admin");
    process.env.ADMIN_EMAILS = "";
    const plain = auth.registerUser({ name: "Plain", email: "plain@example.com", password: "correct-horse" });
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(db.get<{ role: string }>("SELECT role FROM users WHERE id = ?", plain.userId)?.role).toBe("user");
  });
});
