import { createHash } from "node:crypto";
import { all, get, insert, nowIso, parseJson, run, uid } from "@/lib/db";
import { audit } from "@/lib/audit";
import { resumeToText } from "@/lib/resume/grounding";
import type { TailoredResumeContent } from "@/lib/resume/types";
import type { JobRow } from "@/lib/search";

export type PackageRow = {
  id: string;
  user_id: string;
  job_id: string;
  resume_id: string | null;
  cover_letter: string;
  answers_json: string;
  destination_url: string;
  package_hash: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ApprovalRow = {
  id: string;
  user_id: string;
  package_id: string;
  approval_hash: string;
  destination_url: string;
  approved_at: string;
  approval_method: string;
  revoked_at: string | null;
};

/** A package hash binds approval to the exact materials and destination. */
export function computePackageHash(input: {
  jobId: string;
  destinationUrl: string;
  resumeText: string;
  coverLetter: string;
  answers: unknown;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        jobId: input.jobId,
        destinationUrl: input.destinationUrl,
        resumeText: input.resumeText.replace(/\s+\n/g, "\n").trim(),
        coverLetter: input.coverLetter.trim(),
        answers: input.answers,
      }),
    )
    .digest("hex");
}

export function loadPackage(userId: string, packageId: string) {
  const pkg = get<PackageRow>("SELECT * FROM application_packages WHERE id = ? AND user_id = ?", packageId, userId);
  if (!pkg) return null;
  const job = get<JobRow & { source_name: string }>(
    `SELECT j.*, s.name AS source_name FROM jobs j JOIN job_sources s ON s.id = j.source_id WHERE j.id = ?`,
    pkg.job_id,
  );
  const resume = pkg.resume_id
    ? get<{ id: string; structured_content_json: string; change_log_json: string; unsupported_json: string; model_metadata_json: string; status: string }>(
        "SELECT * FROM tailored_resumes WHERE id = ? AND user_id = ?",
        pkg.resume_id,
        userId,
      )
    : null;
  const approval = get<ApprovalRow>(
    "SELECT * FROM application_approvals WHERE package_id = ? AND revoked_at IS NULL ORDER BY approved_at DESC LIMIT 1",
    packageId,
  );
  const application = get<Record<string, unknown>>(
    "SELECT * FROM applications WHERE user_id = ? AND job_id = ?",
    userId,
    pkg.job_id,
  );
  return {
    pkg,
    job: job ?? null,
    resume,
    approval: approval ?? null,
    application: application ?? null,
    currentHash: resume
      ? computePackageHash({
          jobId: pkg.job_id,
          destinationUrl: pkg.destination_url,
          resumeText: resumeToText(parseJson<TailoredResumeContent>(resume.structured_content_json, {} as TailoredResumeContent)),
          coverLetter: pkg.cover_letter,
          answers: parseJson(pkg.answers_json, []),
        })
      : pkg.package_hash,
  };
}

export function createPackage(input: {
  userId: string;
  jobId: string;
  destinationUrl: string;
  resumeId: string | null;
  resumeText: string;
  coverLetter: string;
  answers: { question: string; answer: string }[];
}): PackageRow {
  const hash = computePackageHash({
    jobId: input.jobId,
    destinationUrl: input.destinationUrl,
    resumeText: input.resumeText,
    coverLetter: input.coverLetter,
    answers: input.answers,
  });
  const existing = get<PackageRow>(
    "SELECT * FROM application_packages WHERE user_id = ? AND job_id = ? ORDER BY created_at DESC LIMIT 1",
    input.userId,
    input.jobId,
  );
  const now = nowIso();
  if (existing) {
    run(
      `UPDATE application_packages SET resume_id = ?, cover_letter = ?, answers_json = ?, destination_url = ?, package_hash = ?, status = 'PENDING_APPROVAL', updated_at = ? WHERE id = ?`,
      input.resumeId,
      input.coverLetter,
      JSON.stringify(input.answers),
      input.destinationUrl,
      hash,
      now,
      existing.id,
    );
    run("UPDATE application_approvals SET revoked_at = ? WHERE package_id = ? AND revoked_at IS NULL", now, existing.id);
    audit(input.userId, "package.updated", "application_package", existing.id, { hash });
    return get<PackageRow>("SELECT * FROM application_packages WHERE id = ?", existing.id)!;
  }
  const id = uid();
  insert("application_packages", {
    id,
    user_id: input.userId,
    job_id: input.jobId,
    resume_id: input.resumeId,
    cover_letter: input.coverLetter,
    answers_json: JSON.stringify(input.answers),
    destination_url: input.destinationUrl,
    package_hash: hash,
    status: "PENDING_APPROVAL",
    created_at: now,
    updated_at: now,
  });
  audit(input.userId, "package.created", "application_package", id, { hash, jobId: input.jobId });
  return get<PackageRow>("SELECT * FROM application_packages WHERE id = ?", id)!;
}

/** Editing a resume invalidates every approval that referenced it. */
export function invalidateApprovalsForResume(userId: string, resumeId: string) {
  const packages = all<{ id: string }>(
    "SELECT id FROM application_packages WHERE user_id = ? AND resume_id = ?",
    userId,
    resumeId,
  );
  for (const pkg of packages) {
    run("UPDATE application_approvals SET revoked_at = ? WHERE package_id = ? AND revoked_at IS NULL", nowIso(), pkg.id);
    run("UPDATE application_packages SET status = 'PENDING_APPROVAL', updated_at = ? WHERE id = ?", nowIso(), pkg.id);
  }
  return packages.length;
}

export type ActionResult = { ok: boolean; error?: string; code?: string };

export function approvePackage(userId: string, packageId: string, method = "explicit_click"): ActionResult {
  const loaded = loadPackage(userId, packageId);
  if (!loaded) return { ok: false, error: "Package not found", code: "not_found" };
  if (!loaded.job || loaded.job.status === "closed") {
    return { ok: false, error: "This vacancy is closed and can no longer be applied to.", code: "job_closed" };
  }
  if (!loaded.resume) return { ok: false, error: "Attach a tailored resume before approving.", code: "missing_resume" };
  if (loaded.pkg.package_hash !== loaded.currentHash) {
    return { ok: false, error: "The package changed since it was assembled. Review it again, then approve.", code: "hash_mismatch" };
  }
  const hash = loaded.currentHash;
  insert("application_approvals", {
    id: uid(),
    user_id: userId,
    package_id: packageId,
    approval_hash: hash,
    destination_url: loaded.pkg.destination_url,
    approved_at: nowIso(),
    approval_method: method,
    revoked_at: null,
  });
  run("UPDATE application_packages SET status = 'APPROVED', updated_at = ? WHERE id = ?", nowIso(), packageId);
  const existingApplication = get<{ id: string; status: string }>(
    "SELECT id, status FROM applications WHERE user_id = ? AND job_id = ?",
    userId,
    loaded.pkg.job_id,
  );
  if (existingApplication) {
    if (!["submitted", "interview", "offer"].includes(existingApplication.status)) {
      run(
        "UPDATE applications SET package_id = ?, status = 'approved', last_updated_at = ? WHERE id = ?",
        packageId,
        nowIso(),
        existingApplication.id,
      );
    }
  } else {
    insert("applications", {
      id: uid(),
      user_id: userId,
      job_id: loaded.pkg.job_id,
      package_id: packageId,
      status: "approved",
      last_updated_at: nowIso(),
      notes: "",
    });
  }
  audit(userId, "package.approved", "application_package", packageId, { hash, destination: loaded.pkg.destination_url });
  return { ok: true };
}

export function revokeApproval(userId: string, packageId: string): ActionResult {
  run("UPDATE application_approvals SET revoked_at = ? WHERE package_id = ? AND revoked_at IS NULL", nowIso(), packageId);
  run("UPDATE application_packages SET status = 'PENDING_APPROVAL', updated_at = ? WHERE id = ? AND user_id = ?", nowIso(), packageId, userId);
  audit(userId, "package.approval_revoked", "application_package", packageId);
  return { ok: true };
}

/**
 * Manual handoff: the safe default. We verify the approval chain, then hand
 * the user to the official application page. We never claim submission.
 */
export function handoffPackage(userId: string, packageId: string): ActionResult & { destinationUrl?: string } {
  const loaded = loadPackage(userId, packageId);
  if (!loaded) return { ok: false, error: "Package not found", code: "not_found" };
  if (!loaded.approval) return { ok: false, error: "Approval required before opening the application.", code: "not_approved" };
  if (loaded.approval.approval_hash !== loaded.currentHash) {
    return { ok: false, error: "Approval does not match the current package. Approve the latest version first.", code: "stale_approval" };
  }
  const existing = get<{ id: string; status: string }>(
    "SELECT id, status FROM applications WHERE user_id = ? AND job_id = ?",
    userId,
    loaded.pkg.job_id,
  );
  if (existing && ["submitted", "interview", "confirmation_pending"].includes(existing.status)) {
    return { ok: false, error: "An application for this vacancy was already submitted.", code: "duplicate_submission" };
  }
  const now = nowIso();
  if (existing) {
    run(
      "UPDATE applications SET status = 'awaiting_manual_completion', package_id = ?, last_updated_at = ?, next_action = ? WHERE id = ?",
      packageId,
      now,
      "Complete the application on the employer's site and confirm it here",
      existing.id,
    );
  } else {
    insert("applications", {
      id: uid(),
      user_id: userId,
      job_id: loaded.pkg.job_id,
      package_id: packageId,
      status: "awaiting_manual_completion",
      last_updated_at: now,
      notes: "",
      next_action: "Complete the application on the employer's site and confirm it here",
    });
  }
  run("UPDATE application_packages SET status = 'SUBMISSION_PENDING', updated_at = ? WHERE id = ?", now, packageId);
  audit(userId, "application.handoff_opened", "application_package", packageId, { destination: loaded.pkg.destination_url });
  return { ok: true, destinationUrl: loaded.pkg.destination_url };
}

export function markSubmitted(userId: string, applicationId: string, confirmationReference: string): ActionResult {
  const app = get<{ id: string; job_id: string; package_id: string | null; status: string }>(
    "SELECT * FROM applications WHERE id = ? AND user_id = ?",
    applicationId,
    userId,
  );
  if (!app) return { ok: false, error: "Application not found", code: "not_found" };
  if (app.status === "submitted") return { ok: true }; // idempotent
  if (!app.package_id) return { ok: false, error: "No approved package is linked to this application.", code: "no_package" };
  const approval = get<ApprovalRow>(
    "SELECT * FROM application_approvals WHERE package_id = ? AND revoked_at IS NULL ORDER BY approved_at DESC LIMIT 1",
    app.package_id,
  );
  if (!approval) return { ok: false, error: "A valid approval is required before recording a submission.", code: "not_approved" };
  const loaded = loadPackage(userId, app.package_id);
  if (!loaded || approval.approval_hash !== loaded.currentHash) {
    return { ok: false, error: "The package changed after approval. Re-approve before submitting.", code: "stale_approval" };
  }
  run(
    "UPDATE applications SET status = 'submitted', submitted_at = ?, confirmation_reference = ?, last_updated_at = ?, next_action = ? WHERE id = ?",
    nowIso(),
    confirmationReference.slice(0, 200),
    nowIso(),
    "Follow up in 10 days if you have not heard back",
    applicationId,
  );
  run("UPDATE application_packages SET status = 'SUBMITTED', updated_at = ? WHERE id = ?", nowIso(), app.package_id);
  audit(userId, "application.submitted", "application", applicationId, { confirmationReference });
  return { ok: true };
}
