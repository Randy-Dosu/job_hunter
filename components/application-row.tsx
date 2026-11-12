"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ExternalLink, Loader2, Save } from "lucide-react";
import { CompanyMark } from "@/components/ui";

const STATUSES = [
  "preparing",
  "approved",
  "awaiting_manual_completion",
  "submitted",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "closed",
];

const STATUS_STYLES: Record<string, string> = {
  preparing: "chip",
  approved: "chip-moss",
  awaiting_manual_completion: "chip-warn",
  submitted: "chip-moss",
  interview: "chip-moss",
  offer: "chip-moss",
  rejected: "chip-clay",
  withdrawn: "chip",
  closed: "chip",
};

export function ApplicationRow({
  id,
  title,
  company,
  location,
  status: initialStatus,
  notes: initialNotes,
  nextAction: initialNextAction,
  submittedAt,
  confirmationReference,
  lastUpdatedAt,
  packageId,
  jobId,
  sourceUrl,
}: {
  id: string;
  title: string;
  company: string;
  location: string;
  status: string;
  notes: string;
  nextAction: string;
  submittedAt: string | null;
  confirmationReference: string | null;
  lastUpdatedAt: string;
  packageId: string | null;
  jobId: string;
  sourceUrl: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [notes, setNotes] = useState(initialNotes);
  const [nextAction, setNextAction] = useState(initialNextAction);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = { notes, nextAction };
      if (status !== "submitted") body.status = status;
      const res = await fetch(`/api/applications/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="border-b border-line last:border-0">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3 transition hover:bg-[#fbfaf8]">
        <CompanyMark name={company} size={34} />
        <div className="min-w-0 flex-1">
          <Link href={`/jobs/${jobId}`} className="text-[13.5px] font-medium text-ink hover:underline">
            {title}
          </Link>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {company} · {location}
          </p>
          <p className="mt-0.5 text-[10.5px] text-muted">
            Updated {new Date(lastUpdatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            {submittedAt ? ` · submitted ${new Date(submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
            {confirmationReference ? ` · ref ${confirmationReference}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${STATUS_STYLES[status] ?? "chip"} capitalize`}>{status.replaceAll("_", " ")}</span>
          <button type="button" className="btn-ghost btn-sm -mr-1.5" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
            <ChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} /> Manage
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line bg-[#fbfaf8] px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor={`status-${id}`}>
                Status
              </label>
              <select
                id={`status-${id}`}
                className="field"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                disabled={initialStatus === "submitted" && status === "submitted"}
              >
                {STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {option.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              {status === "submitted" ? (
                <p className="field-hint text-[#8a5a06]">Record confirmations from the approval centre, not here.</p>
              ) : null}
            </div>
            <div>
              <label className="field-label" htmlFor={`next-${id}`}>
                Next action
              </label>
              <input
                id={`next-${id}`}
                className="field"
                value={nextAction}
                onChange={(event) => setNextAction(event.target.value)}
                placeholder="Follow up on 20 Nov"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="field-label" htmlFor={`notes-${id}`}>
              Notes
            </label>
            <textarea
              id={`notes-${id}`}
              className="field min-h-16"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Recruiter name, interview details, anything you want to remember."
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
            </button>
            {packageId ? (
              <Link href={`/approvals/${packageId}`} className="btn-secondary btn-sm">
                View package
              </Link>
            ) : null}
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn-ghost btn-sm">
              <ExternalLink size={12} /> Original listing
            </a>
            {saved ? <span className="text-[11px] text-moss-700">Saved</span> : null}
            {error ? <span className="text-[11px] text-clay-700">{error}</span> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
