import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDatabase } from "./helpers";
import type { EvidenceFact, Preferences, ProfileSnapshot } from "@/lib/matching/score";
import type { TailoredResumeContent } from "@/lib/resume/types";
import { resumeToText } from "@/lib/resume/grounding";

const temp = useTempDatabase();

type Materials = typeof import("@/lib/resume/application-materials");
let materials: Materials;
type Approvals = typeof import("@/lib/approvals");
let approvals: Approvals;
type Db = typeof import("@/lib/db");
let db: Db;

const now = new Date().toISOString();

function fact(partial: Partial<EvidenceFact> & { id: string; factType: string; title: string }): EvidenceFact {
  return {
    organization: "",
    location: "",
    startDate: null,
    endDate: null,
    bullets: [],
    skills: [],
    state: "professional",
    verificationStatus: "verified",
    evidenceNote: "",
    ...partial,
  };
}

const FACTS: EvidenceFact[] = [
  fact({
    id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    factType: "experience",
    title: "Frontend Developer",
    organization: "Acme Systems",
    startDate: "2021-03",
    bullets: ["Built a React design system used by four product teams."],
    skills: ["React", "TypeScript"],
  }),
  fact({ id: "22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa", factType: "skill", title: "React" }),
  fact({ id: "33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa", factType: "skill", title: "TypeScript" }),
  fact({
    id: "44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    factType: "skill",
    title: "Kubernetes",
    verificationStatus: "unverified",
  }),
];

const PROFILE: ProfileSnapshot = {
  headline: "Frontend developer",
  summary: "",
  location: "Kumasi, Ghana",
  workAuthorization: "Authorised to work in Ghana",
  facts: FACTS,
  yearsExperience: 3,
  educationLevel: "Bachelor's",
};

const PREFS: Preferences = {
  countries: ["Ghana"],
  cities: [],
  remotePreference: "remote",
  remoteRegions: ["worldwide"],
  roleTitles: ["Frontend Developer"],
  roleFamilies: ["Engineering"],
  seniority: ["mid"],
  jobTypes: ["full-time"],
  industries: [],
  excludedEmployers: [],
  excludedKeywords: [],
  excludedLocations: [],
  salaryFloor: 12000,
  currency: "GHS",
  workAuthorization: "Authorised to work in Ghana",
  needsSponsorship: false,
};

const JOB = {
  title: "Frontend Developer",
  company: "Northwind",
  location: "Ghana",
  description: [
    "We are hiring a Frontend Developer to build our design system.",
    "You will work with React and TypeScript every day.",
    "Do you have experience with GraphQL?",
    "Are you authorised to work in Ghana?",
    "What are your salary expectations?",
  ].join("\n"),
  requirements: "React, TypeScript and accessibility experience.",
};

const RESUME: TailoredResumeContent = {
  header: { name: "Ama Mensah", contactLines: ["ama@example.com"] },
  target: { jobTitle: JOB.title, company: JOB.company, jobId: "job-1" },
  headline: { text: "Frontend developer", evidenceIds: [FACTS[0].id] },
  summary: { text: "Frontend developer with React and TypeScript experience.", evidenceIds: [FACTS[0].id] },
  experience: [
    {
      title: "Frontend Developer",
      organization: "Acme Systems",
      location: "Remote",
      dates: "Mar 2021 – Present",
      bullets: [{ text: "Built a React design system used by four product teams.", evidenceIds: [FACTS[0].id] }],
      evidenceIds: [FACTS[0].id],
    },
  ],
  education: [],
  certifications: [],
  achievements: [],
  skills: { core: { text: "React, TypeScript", evidenceIds: [FACTS[1].id, FACTS[2].id] }, learning: null },
  omitted: [],
  generatedAt: now,
};

function draft() {
  return materials.draftApplicationMaterials({
    job: JOB,
    profile: PROFILE,
    preferences: PREFS,
    resume: RESUME,
  });
}

beforeAll(async () => {
  materials = await import("@/lib/resume/application-materials");
  approvals = await import("@/lib/approvals");
  db = await import("@/lib/db");
});

afterAll(() => temp.cleanup());

describe("questions", () => {
  it("takes questions the listing actually asks, verbatim", () => {
    const questions = materials.questionsFromListing(JOB);
    expect(questions).toContain("Do you have experience with GraphQL?");
    expect(questions).toContain("Are you authorised to work in Ghana?");
    expect(questions).toContain("What are your salary expectations?");
    // Sentences that are not questions are never turned into one.
    expect(questions.some((question) => question.includes("design system is"))).toBe(false);
  });

  it("de-duplicates and caps what it takes from a listing", () => {
    const noisy = {
      ...JOB,
      description: Array.from({ length: 12 }, (_, index) => `Do you enjoy task ${index}?`).join("\n") + "\nDo you enjoy task 0?",
      requirements: "",
    };
    const questions = materials.questionsFromListing(noisy);
    expect(questions.length).toBe(5);
    expect(new Set(questions.map((question) => question.toLowerCase())).size).toBe(questions.length);
  });

  it("classifies intent so it does not ask the same thing twice", () => {
    expect(materials.answerIntent("What are your salary expectations?")).toBe("salary");
    expect(materials.answerIntent("Will you require sponsorship?")).toBe("sponsorship");
    expect(materials.answerIntent("Why do you want this role?")).toBe("why");
    expect(materials.answerIntent("Tell us about yourself.")).toBe("generic");
  });
});

describe("drafts", () => {
  it("mixes listing questions with standard form prompts, without duplicates", () => {
    const result = draft();
    const questions = result.answers.map((answer) => answer.question);
    expect(questions).toContain("Do you have experience with GraphQL?");
    expect(questions).toContain("Are you authorised to work in Ghana?");
    expect(questions).toContain("What are your salary expectations?");
    expect(questions.length).toBeLessThanOrEqual(8);
    expect(new Set(questions.map((question) => question.toLowerCase())).size).toBe(questions.length);
    // No second "why this role" prompt behind the standard one.
    expect(questions.filter((question) => /^why /i.test(question))).toHaveLength(1);
  });

  it("cites only verified evidence and never mentions an unverified skill", () => {
    const result = draft();
    const verifiedIds = new Set(FACTS.filter((entry) => entry.verificationStatus === "verified").map((entry) => entry.id));
    for (const answer of result.answers) {
      for (const id of answer.evidenceIds) expect(verifiedIds.has(id)).toBe(true);
      expect(answer.answer).not.toMatch(/kubernetes/i);
    }
    const grounded = result.answers.filter((answer) => answer.status === "grounded");
    expect(grounded.length).toBeGreaterThan(0);
    expect(grounded.every((answer) => answer.evidenceIds.length > 0)).toBe(true);
  });

  it("marks commitments as needing confirmation", () => {
    const result = draft();
    const byQuestion = (needle: RegExp) => result.answers.find((answer) => needle.test(answer.question));
    const salary = byQuestion(/salary/i)!;
    expect(salary.status).toBe("needs_confirmation");
    expect(salary.confirmed).toBe(false);
    expect(salary.answer).toContain("GHS 12,000");

    const authorization = byQuestion(/authorised/i)!;
    expect(authorization.status).toBe("needs_confirmation");
    expect(authorization.answer).toContain("Authorised to work in Ghana");

    const start = byQuestion(/start|notice/i)!;
    expect(start.status).toBe("needs_confirmation");
    expect(start.answer).toContain("[Confirm");
  });

  it("does not guess an answer to a question it cannot ground", () => {
    const result = draft();
    const graphql = result.answers.find((answer) => answer.question === "Do you have experience with GraphQL?")!;
    expect(graphql.status).toBe("needs_confirmation");
    expect(graphql.answer).toContain("[Confirm");
    expect(result.warnings.some((warning) => warning.includes("GraphQL") || /confirmation/i.test(warning))).toBe(true);
  });

  it("drafts a cover letter that is ready to send, with commitments kept out of it", () => {
    const result = draft();
    expect(result.coverLetter).toContain("Northwind");
    expect(result.coverLetter).toContain("Ama Mensah");
    // Notice period, salary and right-to-work are answers, not bracketed text in the letter.
    expect(result.coverLetter).not.toContain("[Confirm");
    expect(result.coverLetter).not.toMatch(/notice period/i);
    expect(result.coverLetterEvidenceIds.length).toBeGreaterThan(0);
  });
});

describe("confirmation gate", () => {
  it("refuses an unconfirmed commitment", () => {
    const problems = materials.answerProblems([
      { question: "Salary?", answer: "GHS 12,000", status: "needs_confirmation", confirmed: false },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/needs your confirmation/i);
  });

  it("refuses a placeholder that was merely ticked", () => {
    const problems = materials.answerProblems([
      { question: "Start?", answer: "[Confirm: notice period]", status: "needs_confirmation", confirmed: true },
    ]);
    expect(problems.some((problem) => /placeholder/i.test(problem))).toBe(true);
  });

  it("accepts an answer the user wrote and confirmed", () => {
    expect(
      materials.answerProblems([
        { question: "Salary?", answer: "GHS 15,000 per year.", status: "needs_confirmation", confirmed: true },
        { question: "Why us?", answer: "React work.", status: "grounded", confirmed: true },
      ]),
    ).toEqual([]);
  });

  it("hashes the confirmation state, so ticking a box is part of the package", () => {
    const base = { question: "Salary?", answer: "GHS 15,000", status: "needs_confirmation" as const, source: "standard" as const, evidenceIds: [] };
    const unconfirmed = approvals.computePackageHash({
      jobId: "job-1",
      destinationUrl: "https://example.com/apply",
      resumeText: "text",
      coverLetter: "",
      answers: [{ ...base, confirmed: false }],
    });
    const confirmed = approvals.computePackageHash({
      jobId: "job-1",
      destinationUrl: "https://example.com/apply",
      resumeText: "text",
      coverLetter: "",
      answers: [{ ...base, confirmed: true }],
    });
    expect(unconfirmed).not.toBe(confirmed);
  });
});

const USER = "55555555-5555-4555-8555-555555555555";
const JOB_ID = "66666666-6666-4666-8666-666666666666";
const RESUME_ID = "77777777-7777-4777-8777-777777777777";
const SOURCE = "88888888-8888-4888-8888-888888888888";

function seedApprovalFixtures() {
  db.insert("users", {
    id: USER,
    email: "materials@test.local",
    name: "Ama Mensah",
    password_hash: "scrypt$aa$bb",
    created_at: now,
  });
  db.insert("job_sources", {
    id: SOURCE,
    name: "Test Source",
    slug: "mateialsource",
    source_type: "public_api",
    access_method: "test",
    terms_url: "https://example.com/terms",
    terms_reviewed_at: now,
    enabled: 1,
    rate_limit_config_json: "{}",
    supported_markets: "global",
    notes: "",
  });
  db.insert("jobs", {
    id: JOB_ID,
    source_id: SOURCE,
    external_id: "ext-materials",
    canonical_url: "https://example.com/jobs/materials",
    application_url: "https://employer.example.com/apply/materials",
    title: JOB.title,
    company: JOB.company,
    location: "Remote",
    remote_policy: "remote",
    description: JOB.description,
    requirements: JOB.requirements,
    salary: null,
    employment_type: "full-time",
    seniority: "mid",
    posted_at: now,
    deadline: null,
    status: "open",
    status_checked_at: now,
    content_hash: "hash-materials",
    fingerprint: "northwind|frontend developer|remote",
    first_seen_at: now,
    last_seen_at: now,
    raw_json: "{}",
  });
  db.insert("tailored_resumes", {
    id: RESUME_ID,
    user_id: USER,
    job_id: JOB_ID,
    base_resume_id: null,
    structured_content_json: JSON.stringify(RESUME),
    change_log_json: "[]",
    unsupported_json: "[]",
    model_metadata_json: "{}",
    status: "user_approved",
    version: 1,
    created_at: now,
    updated_at: now,
  });
}

function buildPackage(answers: unknown[]) {
  return approvals.createPackage({
    userId: USER,
    jobId: JOB_ID,
    destinationUrl: "https://employer.example.com/apply/materials",
    resumeId: RESUME_ID,
    resumeText: resumeToText(RESUME),
    coverLetter: "Dear Northwind hiring team,",
    answers: answers as { question: string; answer: string }[],
  });
}

describe("approval gate on answers", () => {
  beforeAll(() => {
    seedApprovalFixtures();
  });

  it("stores the answer metadata with the package", () => {
    const pkg = buildPackage([
      { question: "Salary?", answer: "GHS 15,000 per year.", status: "needs_confirmation", confirmed: true },
    ]);
    const stored = JSON.parse(pkg.answers_json) as { status: string; confirmed: boolean }[];
    expect(stored[0].status).toBe("needs_confirmation");
    expect(stored[0].confirmed).toBe(true);
  });

  it("cannot approve a package whose answer still needs confirmation", () => {
    const pkg = buildPackage([
      { question: "Salary?", answer: "GHS 15,000 per year.", status: "needs_confirmation", confirmed: false },
    ]);
    const result = approvals.approvePackage(USER, pkg.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("answers_need_confirmation");
  });

  it("can approve once the same package is rebuilt with confirmed answers", () => {
    const pkg = buildPackage([
      { question: "Salary?", answer: "GHS 15,000 per year.", status: "needs_confirmation", confirmed: true },
    ]);
    expect(approvals.approvePackage(USER, pkg.id).ok).toBe(true);
    expect(approvals.handoffPackage(USER, pkg.id).ok).toBe(true);
  });

  it("invalidates the approval when an answer is edited afterwards", () => {
    const pkg = buildPackage([
      { question: "Salary?", answer: "GHS 15,000 per year.", status: "needs_confirmation", confirmed: true },
    ]);
    expect(approvals.approvePackage(USER, pkg.id).ok).toBe(true);
    const edited = [
      { question: "Salary?", answer: "GHS 25,000 per year.", status: "needs_confirmation", evidenceIds: [], confirmationNote: "", confirmed: true, source: "standard" },
    ];
    db.run("UPDATE application_packages SET answers_json = ? WHERE id = ?", JSON.stringify(edited), pkg.id);
    expect(approvals.handoffPackage(USER, pkg.id).code).toBe("stale_approval");
  });
});
