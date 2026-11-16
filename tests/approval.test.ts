import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDatabase } from "./helpers";
import { resumeToText } from "@/lib/resume/grounding";

const temp = useTempDatabase();

type Db = typeof import("@/lib/db");
let db: Db;
let approvals: typeof import("@/lib/approvals");

const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const RESUME = "33333333-3333-4333-8333-333333333333";

let RESUME_TEXT = "";

function seed() {
  const now = new Date().toISOString();
  db.insert("users", {
    id: USER,
    email: "approval@test.local",
    name: "Test User",
    password_hash: "scrypt$aa$bb",
    created_at: now,
  });
  db.insert("job_sources", {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Test Source",
    slug: "testsource",
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
    id: JOB,
    source_id: "44444444-4444-4444-8444-444444444444",
    external_id: "ext-1",
    canonical_url: "https://example.com/jobs/1",
    application_url: "https://employer.example.com/apply/1",
    title: "Frontend Developer",
    company: "Example Ltd",
    location: "Remote",
    remote_policy: "remote",
    description: "React role",
    responsibilities: "",
    requirements: "",
    salary: null,
    employment_type: "full-time",
    seniority: "junior",
    posted_at: now,
    deadline: null,
    status: "open",
    status_checked_at: now,
    content_hash: "hash",
    fingerprint: "example|frontend developer|remote",
    first_seen_at: now,
    last_seen_at: now,
    raw_json: "{}",
  });

  const content = {
    header: { name: "Test User", contactLines: ["test@example.com"] },
    target: { jobTitle: "Frontend Developer", company: "Example Ltd", jobId: JOB },
    headline: { text: "Frontend developer", evidenceIds: ["ev-1"] },
    summary: { text: "Frontend developer with React experience.", evidenceIds: ["ev-1"] },
    experience: [],
    education: [],
    certifications: [],
    achievements: [],
    skills: { core: { text: "React", evidenceIds: ["ev-1"] }, learning: null },
    omitted: [],
    generatedAt: now,
  };
  RESUME_TEXT = resumeToText(content);
  db.insert("tailored_resumes", {
    id: RESUME,
    user_id: USER,
    job_id: JOB,
    base_resume_id: null,
    structured_content_json: JSON.stringify(content),
    change_log_json: "[]",
    unsupported_json: "[]",
    model_metadata_json: "{}",
    status: "user_approved",
    version: 1,
    created_at: now,
    updated_at: now,
  });
}

beforeAll(async () => {
  db = await import("@/lib/db");
  approvals = await import("@/lib/approvals");
  seed();
});

afterAll(() => temp.cleanup());

function buildPackage(coverLetter = "Dear team,") {
  return approvals.createPackage({
    userId: USER,
    jobId: JOB,
    destinationUrl: "https://employer.example.com/apply/1",
    resumeId: RESUME,
    resumeText: RESUME_TEXT,
    coverLetter,
    answers: [{ question: "Why us?", answer: "Because." }],
  });
}

describe("package hashing", () => {
  it("is deterministic for identical material", () => {
    const input = {
      jobId: JOB,
      destinationUrl: "https://employer.example.com/apply/1",
      resumeText: "Same text",
      coverLetter: "Same letter",
      answers: [],
    };
    expect(approvals.computePackageHash(input)).toBe(approvals.computePackageHash(input));
  });

  it("changes when the cover letter changes", () => {
    const base = {
      jobId: JOB,
      destinationUrl: "https://employer.example.com/apply/1",
      resumeText: "Same text",
      coverLetter: "Letter A",
      answers: [],
    };
    expect(approvals.computePackageHash(base)).not.toBe(
      approvals.computePackageHash({ ...base, coverLetter: "Letter B" }),
    );
  });

  it("changes when the destination changes", () => {
    const base = {
      jobId: JOB,
      destinationUrl: "https://employer.example.com/apply/1",
      resumeText: "Same text",
      coverLetter: "Same letter",
      answers: [],
    };
    expect(approvals.computePackageHash(base)).not.toBe(
      approvals.computePackageHash({ ...base, destinationUrl: "https://evil.example.com/apply" }),
    );
  });

  it("changes when an answer changes", () => {
    const base = {
      jobId: JOB,
      destinationUrl: "https://employer.example.com/apply/1",
      resumeText: "Same text",
      coverLetter: "Same letter",
      answers: [{ question: "Why us?", answer: "Because." }],
    };
    expect(approvals.computePackageHash(base)).not.toBe(
      approvals.computePackageHash({ ...base, answers: [{ question: "Why us?", answer: "Different." }] }),
    );
  });
});

describe("approval gate", () => {
  it("cannot hand off before approval", () => {
    const pkg = buildPackage();
    const result = approvals.handoffPackage(USER, pkg.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("not_approved");
  });

  it("approves, then hands off to the official page", () => {
    const pkg = buildPackage();
    expect(approvals.approvePackage(USER, pkg.id).ok).toBe(true);
    const result = approvals.handoffPackage(USER, pkg.id);
    expect(result.ok).toBe(true);
    expect(result.destinationUrl).toBe("https://employer.example.com/apply/1");
  });

  it("blocks submission when the package changed after approval", () => {
    const pkg = buildPackage("Original letter");
    expect(approvals.approvePackage(USER, pkg.id).ok).toBe(true);
    // Simulate a material edit that invalidates the stored approval.
    db.run("UPDATE application_packages SET cover_letter = ? WHERE id = ?", "Edited letter", pkg.id);
    const result = approvals.handoffPackage(USER, pkg.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("stale_approval");
  });

  it("revoking approval blocks handoff", () => {
    const pkg = buildPackage();
    approvals.approvePackage(USER, pkg.id);
    approvals.revokeApproval(USER, pkg.id);
    expect(approvals.handoffPackage(USER, pkg.id).code).toBe("not_approved");
  });

  it("records a submission once and stays idempotent", () => {
    const pkg = buildPackage();
    approvals.approvePackage(USER, pkg.id);
    const handoff = approvals.handoffPackage(USER, pkg.id);
    expect(handoff.ok).toBe(true);
    const application = db.get<{ id: string }>("SELECT id FROM applications WHERE user_id = ? AND job_id = ?", USER, JOB)!;
    expect(approvals.markSubmitted(USER, application.id, "REF-1").ok).toBe(true);
    expect(approvals.markSubmitted(USER, application.id, "REF-1").ok).toBe(true);
    const row = db.get<{ status: string; confirmation_reference: string }>(
      "SELECT status, confirmation_reference FROM applications WHERE id = ?",
      application.id,
    )!;
    expect(row.status).toBe("submitted");
    expect(row.confirmation_reference).toBe("REF-1");
  });

  it("does not let another user use the package", () => {
    const pkg = buildPackage();
    const otherUser = "55555555-5555-4555-8555-555555555555";
    db.insert("users", {
      id: otherUser,
      email: "other@test.local",
      name: "Other",
      password_hash: "scrypt$aa$bb",
      created_at: new Date().toISOString(),
    });
    expect(approvals.approvePackage(otherUser, pkg.id).code).toBe("not_found");
  });
});

function buildPackageForNewJob(coverLetter = "Dear team,") {
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert("jobs", {
    id: jobId,
    source_id: "44444444-4444-4444-8444-444444444444",
    external_id: `ext-${jobId}`,
    canonical_url: `https://example.com/jobs/${jobId}`,
    application_url: `https://employer.example.com/apply/${jobId}`,
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
    content_hash: `hash-${jobId}`,
    fingerprint: `example|frontend|${jobId}`,
    first_seen_at: now,
    last_seen_at: now,
    raw_json: "{}",
  });
  return approvals.createPackage({
    userId: USER,
    jobId,
    destinationUrl: `https://employer.example.com/apply/${jobId}`,
    resumeId: RESUME,
    resumeText: RESUME_TEXT,
    coverLetter,
    answers: [{ question: "Why us?", answer: "Because." }],
  });
}

describe("save and reject", () => {
  it("parks a package without approving it", () => {
    const pkg = buildPackageForNewJob();
    expect(approvals.savePackageForLater(USER, pkg.id).ok).toBe(true);
    const row = db.get<{ status: string }>("SELECT status FROM application_packages WHERE id = ?", pkg.id)!;
    expect(row.status).toBe("SAVED");
    // A saved package is still unapproved, so handoff stays blocked.
    expect(approvals.handoffPackage(USER, pkg.id).code).toBe("not_approved");
    expect(approvals.approvePackage(USER, pkg.id).ok).toBe(true);
  });

  it("rejects a package, revokes approval and blocks handoff", () => {
    const pkg = buildPackageForNewJob();
    expect(approvals.approvePackage(USER, pkg.id).ok).toBe(true);
    expect(approvals.rejectPackage(USER, pkg.id, "Salary too low").ok).toBe(true);
    expect(approvals.handoffPackage(USER, pkg.id).code).toBe("rejected");
    expect(approvals.approvePackage(USER, pkg.id).code).toBe("rejected");
    const row = db.get<{ status: string }>("SELECT status FROM application_packages WHERE id = ?", pkg.id)!;
    expect(row.status).toBe("REJECTED");
    const approval = db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM application_approvals WHERE package_id = ? AND revoked_at IS NULL",
      pkg.id,
    )!;
    expect(approval.count).toBe(0);
  });

  it("refuses to reject or park an application that was already submitted", () => {
    const pkg = buildPackageForNewJob();
    approvals.approvePackage(USER, pkg.id);
    approvals.handoffPackage(USER, pkg.id);
    const application = db.get<{ id: string }>(
      "SELECT id FROM applications WHERE user_id = ? AND job_id = ?",
      USER,
      pkg.job_id,
    )!;
    expect(approvals.markSubmitted(USER, application.id, "REF-2").ok).toBe(true);
    expect(approvals.rejectPackage(USER, pkg.id).code).toBe("already_submitted");
    expect(approvals.savePackageForLater(USER, pkg.id).code).toBe("in_flight");
  });

  it("records a follow-up date when a submission is confirmed", () => {
    const pkg = buildPackageForNewJob();
    approvals.approvePackage(USER, pkg.id);
    approvals.handoffPackage(USER, pkg.id);
    const application = db.get<{ id: string }>(
      "SELECT id FROM applications WHERE user_id = ? AND job_id = ?",
      USER,
      pkg.job_id,
    )!;
    approvals.markSubmitted(USER, application.id, "REF-3");
    const row = db.get<{ next_action_at: string | null }>(
      "SELECT next_action_at FROM applications WHERE id = ?",
      application.id,
    )!;
    expect(row.next_action_at).toBeTruthy();
    expect(new Date(row.next_action_at!).getTime()).toBeGreaterThan(Date.now());
  });
});
