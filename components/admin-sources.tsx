"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";

export type AdminSource = {
  slug: string;
  name: string;
  accessMethod: string;
  termsUrl: string;
  termsReviewedAt: string | null;
  enabled: boolean;
  supportedMarkets: string;
  notes: string;
  lastStatus: string | null;
  lastRunAt: string | null;
  jobCount: number;
  openCount: number;
  failedRunCount: number;
  maxRequestsPerHour: number | null;
  maxRequestsPerDay: number | null;
  timeoutMs: number | null;
};

export function AdminSources({ sources }: { sources: AdminSource[] }) {
  return (
    <div className="space-y-3">
      {sources.map((source) => (
        <SourceRow key={source.slug} source={source} />
      ))}
    </div>
  );
}

function SourceRow({ source }: { source: AdminSource }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(source.enabled);
  const [notes, setNotes] = useState(source.notes);
  const [reviewedAt, setReviewedAt] = useState(source.termsReviewedAt ? source.termsReviewedAt.slice(0, 10) : "");
  const [perHour, setPerHour] = useState(source.maxRequestsPerHour?.toString() ?? "");
  const [perDay, setPerDay] = useState(source.maxRequestsPerDay?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const rateLimit: Record<string, number> = {};
      if (perHour.trim()) rateLimit.maxRequestsPerHour = Number(perHour);
      if (perDay.trim()) rateLimit.maxRequestsPerDay = Number(perDay);
      const response = await fetch("/api/admin/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: source.slug,
          enabled,
          notes,
          termsReviewedAt: reviewedAt ? new Date(reviewedAt).toISOString() : null,
          ...(Object.keys(rateLimit).length ? { rateLimit } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update the source");
      setMessage("Saved");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the source");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-[10px] border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-ink">{source.name}</h3>
            <span className={enabled ? "chip-moss" : "chip-clay"}>{enabled ? "enabled" : "disabled"}</span>
            <span className="chip">{source.accessMethod}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {source.supportedMarkets} · {source.jobCount} listings ({source.openCount} open) · last run{" "}
            {source.lastRunAt ? new Date(source.lastRunAt).toLocaleString("en-GB") : "never"} ·{" "}
            <span className={source.lastStatus === "ok" ? "text-moss-700" : source.lastStatus ? "text-[#8a5a06]" : ""}>
              {source.lastStatus ?? "no status"}
            </span>
            {source.failedRunCount ? ` · ${source.failedRunCount} failed runs` : ""}
          </p>
        </div>
        <a
          href={source.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink"
        >
          Terms
        </a>
      </div>

      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex items-center gap-2 text-[12px] text-ink-soft">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Source enabled
        </label>
        <div>
          <label className="field-label" htmlFor={`perhour-${source.slug}`}>
            Max requests / hour
          </label>
          <input
            id={`perhour-${source.slug}`}
            className="field"
            inputMode="numeric"
            value={perHour}
            onChange={(event) => setPerHour(event.target.value)}
            placeholder="unset"
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`perday-${source.slug}`}>
            Max requests / day
          </label>
          <input
            id={`perday-${source.slug}`}
            className="field"
            inputMode="numeric"
            value={perDay}
            onChange={(event) => setPerDay(event.target.value)}
            placeholder="unset"
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`terms-${source.slug}`}>
            Terms reviewed
          </label>
          <input
            id={`terms-${source.slug}`}
            type="date"
            className="field"
            value={reviewedAt}
            onChange={(event) => setReviewedAt(event.target.value)}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="field-label" htmlFor={`notes-${source.slug}`}>
            Governance notes
          </label>
          <textarea
            id={`notes-${source.slug}`}
            className="field min-h-14"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Access method, attribution requirements, quotas, anything a reviewer needs."
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save source
        </button>
        {message ? <span className="text-[11px] text-moss-700">{message}</span> : null}
        {error ? <span className="text-[11px] text-clay-700">{error}</span> : null}
        <span className="ml-auto text-[10.5px] text-muted">
          Disabling stops the next fetch for everyone; budgets are enforced per fetch and a source over budget is skipped with a reason.
        </span>
      </div>
    </article>
  );
}
