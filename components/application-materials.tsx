"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import type { AnswerDraft, ApplicationMaterials as Materials } from "@/lib/resume/application-materials";

const PLACEHOLDER = "[confirm";

function blockingProblems(answers: AnswerDraft[]): string[] {
  const problems: string[] = [];
  answers.forEach((answer, index) => {
    const label = `Q${index + 1}`;
    if (!answer.answer.trim()) problems.push(`${label} has no answer yet.`);
    else if (answer.confirmed && answer.answer.toLowerCase().includes(PLACEHOLDER)) {
      problems.push(`${label} still contains a bracketed placeholder.`);
    }
    if (answer.status === "needs_confirmation" && !answer.confirmed) {
      problems.push(`${label} needs your confirmation.`);
    }
  });
  return problems;
}

export function ApplicationMaterials({
  jobId,
  resumeId,
  approved,
  packageId,
}: {
  jobId: string;
  resumeId: string;
  approved: boolean;
  packageId: string | null;
}) {
  const router = useRouter();
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [answers, setAnswers] = useState<AnswerDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const problems = blockingProblems(answers);
  const pending = answers.filter((answer) => answer.status === "needs_confirmation" && !answer.confirmed).length;
  const canAssemble = approved && answers.length > 0 && problems.length === 0;

  const draft = async () => {
    setBusy("draft");
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/application-materials`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not draft the material");
      const next = data.materials as Materials;
      setMaterials(next);
      setCoverLetter(next.coverLetter);
      setAnswers(next.answers.map((answer) => ({ ...answer, answer: answer.answer, confirmed: answer.status === "grounded" })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drafting failed");
    } finally {
      setBusy(null);
    }
  };

  const assemble = async (withMaterials: boolean) => {
    setBusy("assemble");
    setError(null);
    try {
      const res = await fetch("/api/application-packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          withMaterials
            ? { jobId, resumeId, coverLetter, answers }
            : { jobId, resumeId, includeCoverLetter: false, answers: [] },
        ),
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

  const updateAnswer = (index: number, patch: Partial<AnswerDraft>) =>
    setAnswers((current) => current.map((answer, position) => (position === index ? { ...answer, ...patch } : answer)));

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Cover letter &amp; application answers</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            Drafted from the same verified facts as the resume. Items that need your decision are marked and block approval until you
            confirm them.
          </p>
        </div>
        <button type="button" className="btn-secondary btn-sm shrink-0" onClick={draft} disabled={busy !== null}>
          {busy === "draft" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {materials ? "Redraft" : "Draft"}
        </button>
      </div>

      {materials ? (
        <>
          {materials.warnings.length ? (
            <ul className="mt-3 space-y-1 rounded-md bg-[#fdf9ef] px-3 py-2 text-[11px] leading-relaxed text-[#8a5a06]">
              {materials.warnings.map((warning) => (
                <li key={warning} className="flex gap-1.5">
                  <AlertTriangle size={11} className="mt-[2px] shrink-0" /> {warning}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3">
            <span className="label-xs">Cover letter</span>
            <textarea
              className="field mt-1 min-h-40 text-[12px] leading-relaxed"
              value={coverLetter}
              onChange={(event) => setCoverLetter(event.target.value)}
              aria-label="Cover letter"
            />
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="label-xs">Application questions</p>
              <span className="text-[10.5px] text-muted">
                {answers.length} question{answers.length === 1 ? "" : "s"} · {pending} awaiting your confirmation
              </span>
            </div>

            {answers.map((answer, index) => (
              <div key={`${answer.question}-${index}`} className="rounded-md border border-line bg-[#fbfaf8] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="max-w-[75%] text-[12px] font-medium text-ink">{answer.question}</p>
                  <span className={answer.status === "grounded" ? "chip-moss" : "chip-warn"}>
                    {answer.status === "grounded" ? "from verified facts" : "needs your confirmation"}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] uppercase tracking-[0.06em] text-muted">
                  {answer.source === "listing" ? "asked in the listing" : "standard form question"}
                  {answer.evidenceIds.length ? ` · ${answer.evidenceIds.length} evidence link${answer.evidenceIds.length === 1 ? "" : "s"}` : ""}
                </p>
                <textarea
                  className="field mt-1.5 min-h-24 text-[12px] leading-relaxed"
                  value={answer.answer}
                  onChange={(event) => updateAnswer(index, { answer: event.target.value })}
                  aria-label={answer.question}
                />
                {answer.confirmationNote ? (
                  <p className="mt-1 text-[10.5px] leading-relaxed text-[#8a5a06]">{answer.confirmationNote}</p>
                ) : null}
                <label className="mt-1.5 flex items-start gap-1.5 text-[11px] text-ink-soft">
                  <input
                    type="checkbox"
                    className="mt-[2px]"
                    checked={answer.confirmed}
                    onChange={(event) => updateAnswer(index, { confirmed: event.target.checked })}
                  />
                  {answer.status === "grounded"
                    ? "I have read this and it is accurate"
                    : "I confirm this statement and want it sent as written"}
                </label>
              </div>
            ))}
          </div>

          {problems.length ? (
            <p className="mt-3 text-[11px] leading-relaxed text-[#8a5a06]">
              Before assembling: {problems.slice(0, 3).join(" ")}
              {problems.length > 3 ? ` (+${problems.length - 3} more)` : ""}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Nothing drafted yet. The draft includes the questions this listing actually asks plus the usual form prompts, each with the
          evidence behind it.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {packageId ? (
          <Link href={`/approvals/${packageId}`} className="btn-secondary btn-sm">
            Open existing package
          </Link>
        ) : (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => assemble(Boolean(materials))}
            disabled={busy === "assemble" || !approved || (materials ? !canAssemble : false)}
            title={
              !approved
                ? "Approve the resume first"
                : materials && !canAssemble
                  ? "Confirm every answer before assembling"
                  : undefined
            }
          >
            {busy === "assemble" ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
            Assemble application package
          </button>
        )}
        {!approved ? <span className="text-[10.5px] text-muted">Approve the resume to unlock assembly.</span> : null}
        {approved && materials && pending > 0 ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-[#8a5a06]">
            <AlertTriangle size={11} /> {pending} answer{pending === 1 ? "" : "s"} awaiting confirmation
          </span>
        ) : null}
        {approved && materials && pending === 0 && problems.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-moss-700">
            <CheckCircle2 size={11} /> everything confirmed
          </span>
        ) : null}
      </div>

      {error ? <p className="mt-2 rounded-md bg-clay-50 px-3 py-2 text-[11px] text-clay-700">{error}</p> : null}
    </div>
  );
}
