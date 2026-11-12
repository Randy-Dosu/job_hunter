"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ExternalLink, Loader2, Save } from "lucide-react";

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
  preparing: "badge-neutral",
  approved: "badge-brand",
  awaiting_manual_completion: "badge-possible",
  submitted: "badge-strong",
  interview: "badge-brand",
  offer: "badge-strong",
  rejected: "badge-low",
  withdrawn: "badge-neutral",
  closed: "badge-neutral",
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
    <article className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <Link href={`/jobs/${jobId}`} className="text-sm font-semibold text-slate-900 hover:text-brand-700">
            {title}
          </Link>
          <p className="mt-0.5 text-xs text-slate-500">
            {company} · {location}
          </p>
          <p className="mt-1 text-[10px] text-slate-400">
            Updated {new Date(lastUpdatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            {submittedAt ? ` · submitted ${new Date(submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
            {confirmationReference ? ` · ref ${confirmationReference}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={STATUS_STYLES[status] ?? "badge-neutral"}>{status.replaceAll("_", " ")}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
            <ChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} /> Manage
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-slate-100 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`status-${id}`}>
                Status
              </label>
              <select
                id={`status-${id}`}
                className="input text-xs"
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
                <p className="mt-1 text-[10px] text-amber-700">Record confirmations from the approval centre, not here.</p>
              ) : null}
            </div>
            <div>
              <label className="label" htmlFor={`next-${id}`}>
                Next action
              </label>
              <input
                id={`next-${id}`}
                className="input text-xs"
                value={nextAction}
                onChange={(event) => setNextAction(event.target.value)}
                placeholder="Follow up on 20 Nov"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="label" htmlFor={`notes-${id}`}>
              Notes
            </label>
            <textarea
              id={`notes-${id}`}
              className="input min-h-16 text-xs"
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
            {saved ? <span className="text-[11px] text-emerald-700">Saved</span> : null}
            {error ? <span className="text-[11px] text-rose-600">{error}</span> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
