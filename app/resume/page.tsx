import Link from "next/link";
import { ArrowRight, Check, FileText, ShieldCheck, X } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { FactEditor, ResumeUpload } from "@/components/resume-tools";
import { ResumeVariants } from "@/components/resume-variants";
import { Stat, formatDate } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getProfileContext } from "@/lib/profile";
import { all } from "@/lib/db";
import { highestEducation, totalYearsExperience } from "@/lib/matching/score";
import { listVariants } from "@/lib/resume/variants";

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
  const variants = listVariants(user.id).map((variant) => ({
    id: variant.id,
    name: variant.name,
    roleFamily: variant.roleFamily,
    emphasis: variant.emphasis,
    isDefault: variant.isDefault,
  }));

  return (
    <AppShell>
      <PageHeader
        title="Resume & evidence"
        description="The single source of truth. If a claim is not here and verified, it cannot appear in a tailored resume."
        actions={
          <Link href="/onboarding" className="btn-secondary">
            Re-run guided import
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-y-4 divide-line rounded-[10px] border border-line bg-surface py-3 sm:grid-cols-4 sm:divide-x">
        <Stat label="Verified facts" value={verified.length} hint={`${pending.length} awaiting confirmation`} />
        <Stat label="Experience" value={`${years} yrs`} hint="From verified dates" />
        <Stat label="Education" value={education ?? "None"} hint="Used for degree filters" />
        <Stat
          label="Base resume"
          value={context.baseResume ? `v${documents[0]?.version ?? 1}` : "None"}
          hint={context.baseResume?.filename ?? "Upload to begin"}
        />
      </div>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-[10px] border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <ShieldCheck size={13} className="text-moss-600" /> Profile facts
            </h2>
            <span className="text-[11px] text-muted">
              {verified.length} verified · {pending.length} unconfirmed
            </span>
          </div>
          <div className="px-4 py-3">
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

        <div className="min-w-0 space-y-4">
          <section className="rounded-[10px] border border-line bg-surface">
            <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
              <FileText size={13} className="text-muted" />
              <h2 className="text-[13px] font-semibold text-ink">Base resume versions</h2>
            </div>
            <ul className="divide-y divide-line">
              {documents.map((document) => (
                <li key={document.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{document.filename}</span>
                    <span className="block text-[10.5px] text-muted">
                      v{document.version} · {formatDate(document.created_at, { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                      {document.parse_status}
                    </span>
                  </span>
                  {document.is_base ? <span className="chip-moss shrink-0">active</span> : null}
                </li>
              ))}
              {!documents.length ? <li className="px-4 py-2.5 text-[12px] text-muted">No base resume uploaded yet.</li> : null}
            </ul>
            <div className="border-t border-line px-4 py-3">
              <ResumeUpload />
            </div>
          </section>

          <ResumeVariants variants={variants} />

          <section className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-[13px] font-semibold text-ink">What the generator may do</h2>
            <ul className="mt-2 space-y-1.5 text-[12px]">
              {[
                "Reorder verified achievements by relevance",
                "Rewrite a summary from your own facts",
                "Emphasise matched skills and education",
              ].map((item) => (
                <li key={item} className="flex items-start gap-1.5 text-ink-soft">
                  <Check size={12} className="mt-0.5 shrink-0 text-moss-600" /> {item}
                </li>
              ))}
              {["Never invent employers, dates, metrics or skills", "Never turn “learning” into professional experience"].map((item) => (
                <li key={item} className="flex items-start gap-1.5 text-clay-700">
                  <X size={12} className="mt-0.5 shrink-0" /> {item}
                </li>
              ))}
            </ul>
            <Link href="/jobs" className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-ink hover:underline">
              Pick a job to tailor for <ArrowRight size={12} />
            </Link>
          </section>

          <section className="rounded-[10px] border border-line bg-[#fbfaf8] p-4 text-[11.5px] leading-relaxed text-ink-soft">
            <p className="font-semibold text-ink">Evidence, not vibes</p>
            <p className="mt-1">
              Each fact carries the document it came from and who confirmed it. Generated resumes keep those evidence links, so the change
              log can show exactly which fact justifies every line.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
