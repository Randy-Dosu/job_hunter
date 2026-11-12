"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BadgeCheck,
  Check,
  Download,
  FileText,
  Loader2,
  Pencil,
  Printer,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { ChangeLogEntry, TailoredResumeContent, UnsupportedClaim } from "@/lib/resume/types";

type Metadata = {
  engine: string;
  provider: string;
  evidenceUsed: number;
  requirementsMatched: string[];
  requirementsMissing: string[];
  generatedAt: string;
  warnings: string[];
};

const LOG_STYLES: Record<string, string> = {
  reordered: "chip",
  emphasized: "chip-moss",
  omitted: "chip",
  rewritten: "chip-warn",
  added: "chip-moss",
  unchanged: "chip",
};

export function ResumeWorkspace({
  resumeId,
  content: initialContent,
  changeLog,
  unsupported: initialUnsupported,
  metadata,
  baseResumeText,
  job,
  status,
  packageId,
}: {
  resumeId: string;
  content: TailoredResumeContent;
  changeLog: ChangeLogEntry[];
  unsupported: UnsupportedClaim[];
  metadata: Metadata;
  baseResumeText: string | null;
  job: { id: string; title: string; company: string };
  status: string;
  packageId: string | null;
}) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [unsupported, setUnsupported] = useState(initialUnsupported);
  const [editing, setEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(initialContent.summary.text);
  const [headlineDraft, setHeadlineDraft] = useState(initialContent.headline.text);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBase, setShowBase] = useState(false);
  const [includeCover, setIncludeCover] = useState(true);
  const [approved, setApproved] = useState(status === "user_approved");

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/tailored-resumes/${resumeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: summaryDraft, headline: headlineDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setUnsupported(data.unsupported ?? []);
      setContent((current) => ({
        ...current,
        summary: { ...current.summary, text: summaryDraft },
        headline: { ...current.headline, text: headlineDraft },
      }));
      setApproved(false);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    setBusy("approve");
    setError(null);
    try {
      const res = await fetch(`/api/tailored-resumes/${resumeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "user_approved" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not approve");
      if ((data.unsupported ?? []).length) {
        setUnsupported(data.unsupported);
        throw new Error("Fix the flagged statements before approving this resume.");
      }
      setApproved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  };

  const assemble = async () => {
    setBusy("package");
    setError(null);
    try {
      const res = await fetch("/api/application-packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id, resumeId, includeCoverLetter: includeCover }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not assemble the package");
      router.push(data.redirect ?? `/approvals/${data.packageId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assembly failed");
      setBusy(null);
    }
  };

  const sections: { heading: string; entries: TailoredResumeContent["experience"] }[] = [
    { heading: "Experience", entries: content.experience },
    { heading: "Education", entries: content.education },
    { heading: "Certifications", entries: content.certifications },
    { heading: "Projects & achievements", entries: content.achievements },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#fbfaf8] px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-ink-soft">
              <FileText size={13} /> Preview · tailored for{" "}
              <span className="font-semibold text-ink">
                {job.title} · {job.company}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <a href={`/api/tailored-resumes/${resumeId}/export?format=pdf`} className="btn-secondary btn-sm">
                <Download size={12} /> PDF
              </a>
              <a href={`/api/tailored-resumes/${resumeId}/export?format=docx`} className="btn-secondary btn-sm">
                <Download size={12} /> DOCX
              </a>
              <button type="button" className="btn-ghost btn-sm no-print" onClick={() => window.print()}>
                <Printer size={12} /> Print
              </button>
            </div>
          </div>

          <div className="px-5 py-6 sm:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">{content.header.name}</h2>
            <p className="mt-1 text-[11px] text-muted">{content.header.contactLines.join("  ·  ")}</p>

            <div className="mt-4">
              {editing ? (
                <input className="field text-sm" value={headlineDraft} onChange={(event) => setHeadlineDraft(event.target.value)} />
              ) : (
                <p className="text-sm font-medium text-ink">{content.headline.text}</p>
              )}
            </div>

            <div className="mt-4">
              <h3 className="border-b border-line pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Summary</h3>
              {editing ? (
                <textarea
                  className="field mt-2 min-h-28 text-sm"
                  value={summaryDraft}
                  onChange={(event) => setSummaryDraft(event.target.value)}
                />
              ) : (
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{content.summary.text}</p>
              )}
            </div>

            {sections
              .filter((section) => section.entries.length)
              .map((section) => (
                <div key={section.heading} className="mt-4">
                  <h3 className="border-b border-line pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                    {section.heading}
                  </h3>
                  <div className="mt-2 space-y-3">
                    {section.entries.map((entry, index) => (
                      <div key={`${entry.title}-${index}`}>
                        <p className="text-[13px] font-semibold text-ink">{entry.title}</p>
                        <p className="text-[11px] italic text-muted">
                          {[entry.organization, entry.location, entry.dates].filter(Boolean).join("  ·  ")}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {entry.bullets.map((bullet, bulletIndex) => (
                            <li key={bulletIndex} className="flex gap-1.5 text-[12px] leading-relaxed text-ink-soft">
                              <span className="text-muted">•</span>
                              {bullet.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

            {content.skills.core.text ? (
              <div className="mt-4">
                <h3 className="border-b border-line pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Skills</h3>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{content.skills.core.text}</p>
                {content.skills.learning?.text ? (
                  <p className="mt-1 text-[11px] italic leading-relaxed text-muted">{content.skills.learning.text}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="card card-pad no-print">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Base vs tailored</h3>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowBase((current) => !current)}>
              {showBase ? "Hide base resume" : "Compare with base resume"}
            </button>
          </div>
          {showBase ? (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-[#fbfaf8] p-3 font-mono text-[11px] leading-relaxed text-ink-soft">
              {baseResumeText ?? "No base resume text stored. Your facts are still the source of truth."}
            </pre>
          ) : (
            <p className="mt-1 text-xs text-muted">
              The tailored draft reorders and reframes your verified facts; it never adds new claims. Open the comparison to see the
              original source text.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4 no-print">
        <div className="card card-pad">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Sparkles size={14} className="text-ink" /> Generation summary
          </h3>
          <dl className="mt-2.5 space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <dt className="text-muted">Engine</dt>
              <dd className="font-medium text-ink">{metadata.engine}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Provider</dt>
              <dd className="max-w-[60%] truncate text-right font-medium text-ink">{metadata.provider}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Evidence used</dt>
              <dd className="font-medium text-ink">{metadata.evidenceUsed} facts</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Requirements matched</dt>
              <dd className="font-medium text-moss-700">{metadata.requirementsMatched.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Requirements missing</dt>
              <dd className="font-medium text-[#8a5a06]">{metadata.requirementsMissing.length}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            Generated {new Date(metadata.generatedAt).toLocaleString("en-GB")}. Approach: deterministic selection and rewriting over
            verified facts; every sentence carries an evidence link.
          </p>
          {metadata.warnings.length ? (
            <ul className="mt-2 space-y-1">
              {metadata.warnings.map((warning) => (
                <li key={warning} className="rounded bg-[#fdf9ef] px-2 py-1 text-[10px] text-[#8a5a06]">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {unsupported.length ? (
          <div className="card border-clay-100 card-pad">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-clay-700">
              <ShieldAlert size={15} /> {unsupported.length} unsupported statement{unsupported.length === 1 ? "" : "s"}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-clay-700/80">
              These lines could not be traced to a verified fact. Approving is blocked until they are removed or backed by evidence.
            </p>
            <ul className="mt-2 space-y-1.5">
              {unsupported.map((item, index) => (
                <li key={`${item.reason}-${index}`} className="rounded bg-clay-50 px-2 py-1.5 text-[11px] text-clay-700">
                  <span className="font-semibold capitalize">{item.reason.replaceAll("_", " ")}:</span> {item.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="card border-moss-100 card-pad">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-moss-700">
              <ShieldCheck size={15} /> Evidence check passed
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-moss-700/80">
              Every claim in this draft maps to a verified profile fact. Skills and numbers were cross-checked against your evidence.
            </p>
          </div>
        )}

        <div className="card card-pad">
          <h3 className="text-sm font-semibold text-ink">Change log</h3>
          <p className="mt-0.5 text-[11px] text-muted">Exactly what the generator did to your base resume.</p>
          <ol className="mt-2.5 space-y-2.5">
            {changeLog.map((entry) => (
              <li key={entry.id} className="border-l-2 border-line pl-2.5">
                <div className="flex items-center gap-1.5">
                  <span className={LOG_STYLES[entry.type] ?? "chip"}>{entry.type}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{entry.section}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{entry.description}</p>
                {entry.evidenceIds.length ? (
                  <p className="mt-0.5 text-[10px] text-muted">
                    {entry.evidenceIds.length} evidence link{entry.evidenceIds.length === 1 ? "" : "s"}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="card card-pad">
          <h3 className="text-sm font-semibold text-ink">Your review</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {editing ? (
              <>
                <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy === "save"}>
                  {busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save edits
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(false);
                    setSummaryDraft(content.summary.text);
                    setHeadlineDraft(content.headline.text);
                  }}
                >
                  <X size={12} /> Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
                <Pencil size={12} /> Edit summary or headline
              </button>
            )}
            <button
              type="button"
              className={`btn-sm btn ${approved ? "bg-moss-50 text-moss-700 ring-1 ring-moss-100" : "btn-secondary"}`}
              onClick={approve}
              disabled={busy === "approve" || approved || unsupported.length > 0}
              title={unsupported.length ? "Resolve flagged statements first" : undefined}
            >
              {busy === "approve" ? <Loader2 size={12} className="animate-spin" /> : <BadgeCheck size={12} />}
              {approved ? "Resume approved" : "Approve this resume"}
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            Approving the resume is not approving an application. Editing it afterwards invalidates any application approval.
          </p>

          <div className="mt-4 border-t border-line pt-3">
            <label className="flex items-center gap-2 text-[11px] text-ink-soft">
              <input type="checkbox" checked={includeCover} onChange={(event) => setIncludeCover(event.target.checked)} />
              Include a cover letter drafted from the same verified facts
            </label>
            {packageId ? (
              <Link href={`/approvals/${packageId}`} className="btn-secondary mt-2 w-full">
                Open existing package
              </Link>
            ) : (
              <button
                type="button"
                className="btn-primary mt-2 w-full"
                onClick={assemble}
                disabled={!approved || busy === "package"}
                title={!approved ? "Approve the resume first" : undefined}
              >
                {busy === "package" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                Assemble application package
              </button>
            )}
            {!approved ? <p className="mt-1 text-center text-[10px] text-muted">Approve the resume to unlock the approval centre.</p> : null}
          </div>
        </div>

        {error ? <p className="rounded-md bg-clay-50 px-3 py-2 text-xs text-clay-700">{error}</p> : null}
      </div>
    </div>
  );
}
