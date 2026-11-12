import { describe, expect, it } from "vitest";
import { scoreJob, type EvidenceFact, type MatchableJob, type Preferences, type ProfileSnapshot } from "@/lib/matching/score";

const prefs: Preferences = {
  countries: ["Ghana"],
  cities: ["Kumasi"],
  remotePreference: "remote",
  remoteRegions: ["Worldwide"],
  roleTitles: ["Frontend Developer", "React Developer"],
  roleFamilies: ["Software Development"],
  seniority: [],
  jobTypes: ["full-time"],
  industries: [],
  excludedEmployers: ["Bad Corp"],
  excludedKeywords: ["unpaid"],
  excludedLocations: [],
  salaryFloor: 24000,
  currency: "USD",
  workAuthorization: "Ghana",
  needsSponsorship: false,
};

function fact(partial: Partial<EvidenceFact> & { title: string; factType: string }): EvidenceFact {
  return {
    id: partial.id ?? crypto.randomUUID(),
    factType: partial.factType,
    title: partial.title,
    organization: partial.organization ?? "",
    location: partial.location ?? "",
    startDate: partial.startDate ?? null,
    endDate: partial.endDate ?? null,
    bullets: partial.bullets ?? [],
    skills: partial.skills ?? [],
    state: partial.state ?? "",
    verificationStatus: partial.verificationStatus ?? "verified",
    evidenceNote: partial.evidenceNote ?? "",
  };
}

const facts: EvidenceFact[] = [
  fact({ title: "React", factType: "skill", state: "professional" }),
  fact({ title: "TypeScript", factType: "skill", state: "professional" }),
  fact({ title: "SQL", factType: "skill", state: "professional" }),
  fact({ title: "Docker", factType: "skill", state: "learning" }),
  fact({
    title: "Frontend Developer",
    factType: "experience",
    organization: "Studio",
    startDate: "2023-01",
    endDate: "2025-01",
    bullets: ["Built React dashboards with TypeScript."],
  }),
  fact({ title: "BSc Computer Science", factType: "education", bullets: ["Second Class Upper"] }),
];

const profile: ProfileSnapshot = {
  headline: "Frontend developer",
  summary: "",
  location: "Kumasi, Ghana",
  workAuthorization: "Ghana",
  facts,
  yearsExperience: 2,
  educationLevel: "Bachelor's",
};

function job(overrides: Partial<MatchableJob> = {}): MatchableJob {
  return {
    title: "Frontend Developer",
    company: "Brightline Studio",
    location: "Remote (Worldwide)",
    remotePolicy: "remote",
    description:
      "We build climate products.\nRequirements\nReact and TypeScript experience.\nSQL is a plus.\nBachelor's degree or equivalent.\n$40,000 - $55,000.",
    salary: "$40,000 - $55,000",
    employmentType: "full-time",
    seniority: "junior",
    postedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    status: "open",
    ...overrides,
  };
}

describe("scoreJob", () => {
  it("rewards a strong title and skill match", () => {
    const result = scoreJob(job(), prefs, profile);
    expect(result.score).toBeGreaterThanOrEqual(55);
    expect(["strong", "possible"]).toContain(result.verdict);
    expect(result.matchedSkills).toContain("react");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("reports missing required skills as gaps instead of silently scoring them", () => {
    const result = scoreJob(
      job({
        title: "Kubernetes Platform Engineer",
        description: "Requirements\nKubernetes, AWS and Go experience.\n5 years of experience required.",
      }),
      prefs,
      profile,
    );
    expect(result.missingRequired).toEqual(expect.arrayContaining(["kubernetes", "aws", "go"]));
    expect(result.gaps.some((gap) => gap.kind === "skill" && gap.required)).toBe(true);
    expect(result.score).toBeLessThan(55);
  });

  it("excludes an on-site role when the user needs remote work", () => {
    const result = scoreJob(job({ remotePolicy: "onsite", location: "Austin, TX" }), prefs, profile);
    expect(result.verdict).toBe("excluded");
    expect(result.hardFilters.map((filter) => filter.code)).toContain("onsite");
  });

  it("excludes employers on the exclusion list even with a perfect title", () => {
    const result = scoreJob(job({ company: "Bad Corp" }), prefs, profile);
    expect(result.verdict).toBe("excluded");
    expect(result.hardFilters.map((filter) => filter.code)).toContain("excluded_employer");
  });

  it("excludes confirmed closed vacancies", () => {
    const result = scoreJob(job({ status: "closed" }), prefs, profile);
    expect(result.verdict).toBe("excluded");
    expect(result.score).toBeGreaterThan(0); // score still explains itself
  });

  it("lowers confidence when the listing has no data", () => {
    const sparse = scoreJob(
      job({ salary: null, postedAt: null, deadline: null, seniority: "unknown", description: "Join our team." }),
      prefs,
      profile,
    );
    const rich = scoreJob(job(), prefs, profile);
    expect(sparse.confidence).toBeLessThan(rich.confidence);
  });

  it("never treats a learning-only skill as fully held", () => {
    const withDocker = scoreJob(
      job({ title: "Frontend Developer", description: "Requirements\nDocker and React experience." }),
      prefs,
      profile,
    );
    const dockerComponent = withDocker.components.find((component) => component.key === "skills");
    expect(dockerComponent).toBeDefined();
    expect(withDocker.reasons.some((reason) => reason.strength === "warning")).toBe(true);
  });

  it("flags scam signals in the description", () => {
    const result = scoreJob(
      job({ description: "Requirements\nPay a training fee of $90. Send bank details and contact us on WhatsApp to apply." }),
      prefs,
      profile,
    );
    expect(result.redFlags.length).toBeGreaterThan(0);
  });

  it("weights add up to 100", () => {
    const result = scoreJob(job(), prefs, profile);
    const total = result.components.reduce((sum, component) => sum + component.weight, 0);
    expect(total).toBe(100);
  });
});
