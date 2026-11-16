"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  CircleSlash,
  FileUp,
  Loader2,
  Plus,
  RefreshCw,
  ShieldQuestion,
  Trash2,
} from "lucide-react";

type Fact = {
  id: string;
  fact_type: string;
  title: string;
  organization: string;
  location: string;
  start_date: string | null;
  end_date: string | null;
  bullets_json: string;
  state: string;
  verification_status: string;
  evidence_note: string;
};

const STATUS_STYLES: Record<string, string> = {
  verified: "chip-moss",
  unverified: "chip-warn",
  outdated: "chip",
};

export function ResumeUpload({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ documentId: string; facts: Fact[]; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resumes", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setPreview({ documentId: data.documentId, facts: data.parsed.facts, warnings: data.parsed.warnings ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const importFacts = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const res = await fetch("/api/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId: preview.documentId,
          items: preview.facts.map((fact) => ({
            factType: fact.fact_type,
            title: fact.title,
            organization: fact.organization,
            location: fact.location,
            startDate: fact.start_date,
            endDate: fact.end_date,
            bullets: JSON.parse(fact.bullets_json || "[]"),
            skills: [],
            state: fact.state,
            verificationStatus: "unverified",
            evidenceNote: "Imported from your uploaded resume — confirm each fact before it can be used.",
          })),
        }),
      });
      if (!res.ok) throw new Error("Could not import facts");
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={compact ? "" : "space-y-3"}>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-[#fbfaf8] px-4 py-4 text-center text-xs font-medium text-ink-soft transition hover:border-[#bdb8b0] hover:bg-[#f1eee9]/40">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
        Upload a new base resume version (TXT, MD, PDF, DOCX)
        <input
          type="file"
          accept=".txt,.md,.pdf,.docx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
          }}
        />
      </label>
      {error ? <p className="rounded-md bg-clay-50 px-3 py-2 text-xs text-clay-700">{error}</p> : null}
      {preview ? (
        <div className="rounded-[10px] border border-line bg-surface p-3">
          <p className="text-xs font-semibold text-ink">
            Extracted {preview.facts.length} facts — imported as unverified until you confirm them.
          </p>
          {preview.warnings.length ? (
            <ul className="mt-1 space-y-0.5 text-[11px] text-[#8a5a06]">
              {preview.warnings.slice(0, 4).map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={importFacts} disabled={loading}>
              Import facts
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPreview(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FactEditor({ facts }: { facts: Fact[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ factType: "experience", title: "", organization: "", startDate: "", endDate: "", bullets: "" });
  const [error, setError] = useState<string | null>(null);

  const setStatus = async (fact: Fact, status: string) => {
    setBusy(fact.id);
    try {
      const res = await fetch(`/api/evidence/${fact.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verificationStatus: status }),
      });
      if (!res.ok) throw new Error("Could not update fact");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (fact: Fact) => {
    setBusy(fact.id);
    try {
      const res = await fetch(`/api/evidence/${fact.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete fact");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!form.title.trim()) return;
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              factType: form.factType,
              title: form.title,
              organization: form.organization,
              startDate: form.startDate || null,
              endDate: form.endDate || null,
              bullets: form.bullets.split("\n").map((line) => line.trim()).filter(Boolean),
              state: form.factType === "skill" ? "professional" : "",
              verificationStatus: "verified",
              evidenceNote: "Added manually and confirmed by you.",
            },
          ],
        }),
      });
      if (!res.ok) throw new Error("Could not save fact");
      setForm({ factType: "experience", title: "", organization: "", startDate: "", endDate: "", bullets: "" });
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted">
          Only <span className="font-semibold text-moss-700">verified</span> facts can be used in a tailored resume.
        </p>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setAdding((current) => !current)}>
          <Plus size={12} /> Add fact
        </button>
      </div>

      {adding ? (
        <div className="mb-3 rounded-[10px] border border-line bg-surface p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="field text-xs" value={form.factType} onChange={(event) => setForm({ ...form, factType: event.target.value })}>
              <option value="experience">Experience</option>
              <option value="education">Education</option>
              <option value="skill">Skill</option>
              <option value="certification">Certification</option>
              <option value="achievement">Achievement</option>
            </select>
            <input
              className="field text-xs"
              placeholder="Title (e.g. Frontend Developer)"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
            <input
              className="field text-xs"
              placeholder="Organisation"
              value={form.organization}
              onChange={(event) => setForm({ ...form, organization: event.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="field text-xs"
                placeholder="Start (2024-09)"
                value={form.startDate}
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              />
              <input
                className="field text-xs"
                placeholder="End (blank = now)"
                value={form.endDate}
                onChange={(event) => setForm({ ...form, endDate: event.target.value })}
              />
            </div>
          </div>
          <textarea
            className="field mt-2 min-h-20 text-xs"
            placeholder="One achievement per line. Only add things that actually happened."
            value={form.bullets}
            onChange={(event) => setForm({ ...form, bullets: event.target.value })}
          />
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={add} disabled={busy === "new"}>
              {busy === "new" ? <Loader2 size={12} className="animate-spin" /> : <BadgeCheck size={12} />} Save as verified
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mb-2 rounded-md bg-clay-50 px-3 py-2 text-xs text-clay-700">{error}</p> : null}

      <div className="space-y-2">
        {facts.map((fact) => {
          const bullets: string[] = JSON.parse(fact.bullets_json || "[]");
          return (
            <div key={fact.id} className="rounded-[10px] border border-line bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-start gap-2">
                <span className="chip capitalize">{fact.fact_type}</span>
                {fact.fact_type === "skill" && fact.state === "learning" ? <span className="chip-warn">learning only</span> : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {fact.title}
                    {fact.organization ? <span className="font-normal text-muted"> · {fact.organization}</span> : null}
                  </p>
                  <p className="text-[11px] text-muted">
                    {[fact.start_date, fact.end_date ?? (fact.start_date ? "Present" : null)].filter(Boolean).join(" – ")}
                    {fact.location ? ` · ${fact.location}` : ""}
                  </p>
                  {bullets.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {bullets.map((bullet, index) => (
                        <li key={index} className="text-[11px] leading-relaxed text-muted">
                          • {bullet}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-1 text-[10px] italic text-muted">{fact.evidence_note}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className={STATUS_STYLES[fact.verification_status] ?? "chip"}>
                    {fact.verification_status === "verified" ? (
                      <BadgeCheck size={10} />
                    ) : fact.verification_status === "outdated" ? (
                      <RefreshCw size={10} />
                    ) : (
                      <ShieldQuestion size={10} />
                    )}
                    {fact.verification_status}
                  </span>
                  <div className="flex items-center gap-1">
                    {fact.verification_status !== "verified" ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm px-1.5 py-1"
                        onClick={() => setStatus(fact, "verified")}
                        disabled={busy === fact.id}
                        title="Mark verified"
                      >
                        <BadgeCheck size={12} />
                      </button>
                    ) : null}
                    {fact.verification_status !== "outdated" ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm px-1.5 py-1"
                        onClick={() => setStatus(fact, "outdated")}
                        disabled={busy === fact.id}
                        title="Mark outdated"
                      >
                        <RefreshCw size={12} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-ghost btn-sm px-1.5 py-1 text-clay-500 hover:bg-clay-50"
                      onClick={() => remove(fact)}
                      disabled={busy === fact.id}
                      title="Delete fact"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {!facts.length ? (
          <div className="rounded-[10px] border border-dashed border-line-strong px-4 py-8 text-center text-xs text-muted">
            <CircleSlash size={16} className="mx-auto mb-1.5 text-muted" />
            No profile facts yet. Import a resume or add one manually.
          </div>
        ) : null}
      </div>
    </div>
  );
}
