"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

export function SearchTrigger({ label = "Run search now", variant = "primary" }: { label?: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/search-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      const counts = data.counts;
      setSummary(
        counts
          ? `${counts.discovered} listings reviewed · ${counts.created} new · ${counts.duplicates} duplicates removed`
          : "A search already ran in this window.",
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={run} disabled={loading} className={variant === "primary" ? "btn-primary" : "btn-secondary"}>
        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {loading ? "Searching approved sources…" : label}
      </button>
      {summary ? <p className="text-[11px] text-moss-700">{summary}</p> : null}
      {error ? <p className="max-w-xs text-right text-[11px] text-clay-700">{error}</p> : null}
    </div>
  );
}
