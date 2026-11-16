import { all } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { fail } from "@/lib/api";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return fail("Sign in to export your data.", 401);
  const uid = user.id;
  const payload = {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email, name: user.name },
    profile: all("SELECT * FROM candidate_profiles WHERE user_id = ?", uid),
    evidence: all("SELECT * FROM profile_evidence WHERE user_id = ?", uid),
    preferences: all("SELECT * FROM job_preferences WHERE user_id = ?", uid),
    resumes: all("SELECT id, filename, file_type, version, is_base, created_at FROM resume_documents WHERE user_id = ?", uid),
    tailoredResumes: all("SELECT * FROM tailored_resumes WHERE user_id = ?", uid),
    applications: all("SELECT * FROM applications WHERE user_id = ?", uid),
    packages: all("SELECT * FROM application_packages WHERE user_id = ?", uid),
    approvals: all("SELECT * FROM application_approvals WHERE user_id = ?", uid),
    matches: all("SELECT * FROM job_matches WHERE user_id = ?", uid),
    searchRuns: all("SELECT * FROM search_runs WHERE user_id = ?", uid),
    auditEvents: all("SELECT * FROM audit_events WHERE user_id = ?", uid),
  };
  audit(uid, "data.exported", "user", uid, {});
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="job-hunter-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
