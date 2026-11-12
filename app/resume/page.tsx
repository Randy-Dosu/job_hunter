import Link from "next/link";
import { ArrowRight, BadgeCheck, FileText, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { FactEditor, ResumeUpload } from "@/components/resume-tools";
import { Stat, formatDate } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getProfileContext } from "@/lib/profile";
import { all } from "@/lib/db";
import { highestEducation, totalYearsExperience } from "@/lib/matching/score";

export const dynamic = "force-dynamic";

export default async function ResumeProfilePage() {
  const user = await requireUser();
  const context = getProfileContext(user.id);
  const documents = all<{ id: string; filename: string; version: number; created_at: string; is_base: number; parse_status: string }>(
    "SELECT id, filename, version, created_at, is_base, parse_status FROM resume_documents WHERE user_id = ? ORDER BY created_at DESC",
    user.id,
  );
  const verified = context.evidence.filter((fact) => fact.verification_status === "verified");
  const pending = context.evidence.filter((fact) => fact.verification_status !== "verified");
  const years = totalYearsExperience(context.snapshot.facts);
  const education = highestEducation(context.snapshot.facts);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Profile"
        title="Resume & verified facts"
        description="This is the single source of truth. If a claim is not here and verified, it cannot appear in a tailored resume."
        actions={
          <Link href="/onboarding" className="btn-secondary">
            Re-run guided import
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Verified facts" value={verified.length} hint={`${pending.length} awaiting confirmation`} />
        <Stat label="Experience" value={`${years} yrs`} hint="Calculated from verified dates" />
        <Stat label="Highest education" value={education ?? "None"} hint="Used for education requirements" />
        <Stat label="Base resume" value={context.baseResume ? `v${documents[0]?.version ?? 1}` : "None"} hint={context.baseResume?.filename ?? "Upload to begin"} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="card card-pad">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <ShieldCheck size={15} className="text-brand-600" /> Profile facts
          </h2>
          <div className="mt-3">
            <FactEditor
              facts={context.evidence.map((fact) => ({
                id: fact.id,
                fact_type: fact.fact_type,
                title: fact.title,
                organization: fact.organization,
                location: fact.location,
                start_date: fact.start_date,
                end_date: fact.end_date,
                bullets_json: fact.bullets_json,
                state: fact.state,
                verification_status: fact.verification_status,
                evidence_note: fact.evidence_note,
              }))}
            />
          </div>
        </section>

        <div className="space-y-5">
          <section className="card card-pad">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <FileText size={15} className="text-slate-500" /> Base resume versions
            </h2>
            <ul className="mt-2.5 space-y-2">
              {documents.map((document) => (
                <li key={document.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{document.filename}</span>
                    <span className="block text-[11px] text-slate-400">
                      v{document.version} · {formatDate(document.created_at, { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                      {document.parse_status}
                    </span>
                  </span>
                  {document.is_base ? <span className="badge-brand shrink-0">active</span> : null}
                </li>
              ))}
              {!documents.length ? <li className="text-xs text-slate-500">No base resume uploaded yet.</li> : null}
            </ul>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <ResumeUpload />
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">What the generator may use</h2>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
              <li className="flex items-start gap-1.5">
                <BadgeCheck size={12} className="mt-0.5 shrink-0 text-emerald-600" /> Reorder verified achievements by relevance
              </li>
              <li className="flex items-start gap-1.5">
                <BadgeCheck size={12} className="mt-0.5 shrink-0 text-emerald-600" /> Rewrite a summary from your own facts
              </li>
              <li className="flex items-start gap-1.5">
                <BadgeCheck size={12} className="mt-0.5 shrink-0 text-emerald-600" /> Emphasise matched skills and education
              </li>
              <li className="flex items-start gap-1.5 text-rose-700">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" /> Never invent employers, dates, metrics or skills
              </li>
              <li className="flex items-start gap-1.5 text-rose-700">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" /> Never turn “learning” into professional experience
              </li>
            </ul>
            <Link href="/jobs" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
              Pick a job to tailor for <ArrowRight size={12} />
            </Link>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-600">
            <p className="font-semibold text-slate-800">Evidence, not vibes</p>
            <p className="mt-1">
              Each fact carries the document it came from and who confirmed it. Generated resumes keep those evidence links, so
              the change log can show exactly which fact justifies every line.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
