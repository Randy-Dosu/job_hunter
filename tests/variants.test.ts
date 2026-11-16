import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDatabase } from "./helpers";

const temp = useTempDatabase();

let db: typeof import("@/lib/db");
let variants: typeof import("@/lib/resume/variants");
let generate: typeof import("@/lib/resume/generate");
let grounding: typeof import("@/lib/resume/grounding");
let profileModule: typeof import("@/lib/profile");

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeAll(async () => {
  db = await import("@/lib/db");
  variants = await import("@/lib/resume/variants");
  generate = await import("@/lib/resume/generate");
  grounding = await import("@/lib/resume/grounding");
  profileModule = await import("@/lib/profile");

  const now = new Date().toISOString();
  db.insert("users", { id: USER, email: "variants@test.local", name: "Ama Serwaa", password_hash: "x", created_at: now });
  db.insert("users", { id: OTHER, email: "other-variants@test.local", name: "Other", password_hash: "x", created_at: now });
  db.insert("candidate_profiles", {
    id: crypto.randomUUID(),
    user_id: USER,
    headline: "Junior developer — React and data",
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
    role_titles_json: '["Frontend Developer","Data Analyst"]',
    remote_preference: "remote",
    remote_regions_json: '["Worldwide"]',
    updated_at: now,
  });

  const insertFact = (fact: Record<string, unknown>) =>
    db.insert("profile_evidence", {
      id: crypto.randomUUID(),
      user_id: USER,
      fact_type: "experience",
      title: "",
      organization: "",
      location: "",
      start_date: null,
      end_date: null,
      bullets_json: "[]",
      skills_json: "[]",
      state: "professional",
      verification_status: "verified",
      source_document_id: null,
      evidence_note: "",
      created_at: now,
      updated_at: now,
      ...fact,
    });

  insertFact({
    title: "Frontend Developer (Freelance)",
    organization: "Self-employed",
    start_date: "2024-09",
    bullets_json: JSON.stringify([
      "Built React and TypeScript dashboards for three small businesses.",
      "Turned Figma designs into accessible Tailwind CSS components.",
    ]),
    skills_json: '["React","TypeScript","Tailwind CSS"]',
  });
  insertFact({
    title: "Data Analyst (Volunteer)",
    organization: "Kumasi Open Data",
    start_date: "2023-01",
    end_date: "2023-12",
    bullets_json: JSON.stringify([
      "Wrote SQL queries for a public transport dataset.",
      "Built Python notebooks summarising survey results.",
    ]),
    skills_json: '["SQL","Python","pandas"]',
  });
  insertFact({
    fact_type: "skill",
    title: "React",
    state: "professional",
    skills_json: '["React"]',
  });
});

afterAll(() => temp.cleanup());

describe("resume variants", () => {
  it("creates, lists and deletes a variant", () => {
    const created = variants.createVariant(USER, {
      name: "Frontend focus",
      roleFamily: "Frontend Developer",
      emphasis: ["accessibility", "design systems"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const listed = variants.listVariants(USER);
    expect(listed.map((variant) => variant.name)).toContain("Frontend focus");
    expect(listed[0].emphasis).toEqual(["accessibility", "design systems"]);

    expect(variants.deleteVariant(USER, created.variant.id).ok).toBe(true);
    expect(variants.listVariants(USER).map((variant) => variant.name)).not.toContain("Frontend focus");
  });

  it("rejects duplicate names and trims absurd emphasis lists", () => {
    expect(variants.createVariant(USER, { name: "Data focus", roleFamily: "Data" }).ok).toBe(true);
    expect(variants.createVariant(USER, { name: "Data focus" }).ok).toBe(false);
    const wide = variants.createVariant(USER, {
      name: "Wide list",
      emphasis: Array.from({ length: 30 }, (_, index) => `word-${index}`),
    });
    expect(wide.ok).toBe(true);
    if (!wide.ok) return;
    expect(wide.variant.emphasis.length).toBe(12);
  });

  it("does not let another user delete someone else's variant", () => {
    const created = variants.createVariant(USER, { name: "Support focus", roleFamily: "Support" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(variants.deleteVariant(OTHER, created.variant.id).ok).toBe(false);
    expect(variants.listVariants(USER).map((variant) => variant.name)).toContain("Support focus");
  });

  it("resolves a variant from the vacancy title, falling back to the default", () => {
    const data = variants.createVariant(USER, { name: "Analytics", roleFamily: "Data Analyst", emphasis: ["SQL", "pandas"], isDefault: false });
    expect(data.ok).toBe(true);
    expect(variants.resolveVariant(USER, "Junior Data Analyst")?.name).toBe("Analytics");
    // No family matches: falls back to the default (none set here), so no variant.
    expect(variants.resolveVariant(USER, "Registered Nurse")).toBeNull();
  });

  it("re-orders verified evidence without adding claims", async () => {
    const context = profileModule.getProfileContext(USER);
    const job = {
      id: crypto.randomUUID(),
      title: "Data Analyst",
      company: "Example Ltd",
      description: "We need SQL and Python to analyse transport data.",
      requirements: "SQL, Python, pandas",
      seniority: "junior",
      location: "Remote",
    };
    const variant = variants.resolveVariant(USER, job.title);
    expect(variant?.name).toBe("Analytics");

    const withVariant = await generate.generateTailoredResume({
      candidateName: "Ama Serwaa",
      contactLines: ["Kumasi, Ghana"],
      job,
      profile: context.snapshot,
      preferences: context.preferences,
      variant: variant ? { name: variant.name, emphasis: variant.emphasis } : null,
    });
    const withoutVariant = await generate.generateTailoredResume({
      candidateName: "Ama Serwaa",
      contactLines: ["Kumasi, Ghana"],
      job,
      profile: context.snapshot,
      preferences: context.preferences,
    });

    expect(withVariant.metadata.variant).toBe("Analytics");
    expect(withoutVariant.metadata.variant).toBeUndefined();
    // Emphasis pushes the data role ahead of the web role.
    expect(withVariant.content.experience[0].title).toContain("Data Analyst");
    // Grounding rules still hold: nothing unsupported, everything traceable.
    expect(grounding.validateResume(withVariant.content, context.snapshot.facts)).toHaveLength(0);
    expect(withVariant.unsupported).toHaveLength(0);
    expect(withVariant.changeLog.some((entry) => entry.section === "Variant")).toBe(true);
  });
});
