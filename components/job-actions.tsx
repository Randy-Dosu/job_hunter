"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ThumbsDown, ThumbsUp, Wand2, XCircle } from "lucide-react";

export function TailorResumeButton({ jobId, existingResumeId }: { jobId: string; existingResumeId?: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/tailor-resume`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not generate a resume");
      router.push(data.redirect ?? `/resumes/${data.resumeId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setLoading(false);
    }
  };

  if (existingResumeId) {
    return (
      <a href={`/resumes/${existingResumeId}`} className="btn-secondary">
        <Wand2 size={14} /> Open tailored resume
      </a>
    );
  }

  return (
    <div>
      <button type="button" onClick={run} disabled={loading} className="btn-primary">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
        {loading ? "Building from verified facts…" : "Tailor a resume"}
      </button>
      {error ? <p className="mt-1 max-w-xs text-[11px] text-clay-700">{error}</p> : null}
    </div>
  );
}

export function FeedbackButtons({ jobId, current }: { jobId: string; current: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [loading, setLoading] = useState<string | null>(null);

  const send = async (feedback: "relevant" | "not_relevant" | "dismissed") => {
    setLoading(feedback);
    try {
      const res = await fetch(`/api/jobs/${jobId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (res.ok) {
        setValue(feedback);
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted">Was this relevant?</span>
      <button
        type="button"
        onClick={() => send("relevant")}
        className={`btn-sm btn ${value === "relevant" ? "bg-moss-50 text-moss-700 ring-1 ring-moss-100" : "btn-ghost"}`}
        aria-pressed={value === "relevant"}
      >
        {loading === "relevant" ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />} Yes
      </button>
      <button
        type="button"
        onClick={() => send("not_relevant")}
        className={`btn-sm btn ${value === "not_relevant" ? "bg-clay-50 text-clay-700 ring-1 ring-clay-100" : "btn-ghost"}`}
        aria-pressed={value === "not_relevant"}
      >
        {loading === "not_relevant" ? <Loader2 size={12} className="animate-spin" /> : <ThumbsDown size={12} />} No
      </button>
      <button
        type="button"
        onClick={() => send("dismissed")}
        className={`btn-sm btn ${value === "dismissed" ? "bg-[#f1eee9] text-ink-soft" : "btn-ghost"}`}
        aria-pressed={value === "dismissed"}
      >
        {loading === "dismissed" ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Dismiss
      </button>
      {value === "relevant" ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-moss-600">
          <CheckCircle2 size={11} /> saved
        </span>
      ) : null}
    </div>
  );
}
