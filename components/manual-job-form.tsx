"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Plus } from "lucide-react";

export function ManualJobForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const response = await fetch("/api/jobs/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; warnings?: string[]; jobId?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not read that link");
      setWarnings(data.warnings ?? []);
      setUrl("");
      router.refresh();
      router.push(`/jobs/${data.jobId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that link");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ink hover:underline"
        onClick={() => setOpen(true)}
      >
        <Plus size={12} /> Add a job by URL
      </button>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
        <Link2 size={12} /> Add a job by URL
      </p>
      <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
        One public page, read once. No sign-in pages or CAPTCHAs, and nothing is filled in for you.
      </p>
      <input
        className="field mt-2"
        placeholder="https://company.com/jobs/123"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        aria-label="Job URL"
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={busy || !url.trim()}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add job
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error ? <p className="mt-1.5 text-[11px] text-clay-700">{error}</p> : null}
      {warnings.length ? (
        <ul className="mt-1.5 space-y-0.5 text-[10.5px] leading-relaxed text-[#8a5a06]">
          {warnings.map((warning) => (
            <li key={warning}>· {warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
