"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

export type VariantView = {
  id: string;
  name: string;
  roleFamily: string;
  emphasis: string[];
  isDefault: boolean;
};

export function ResumeVariants({ variants }: { variants: VariantView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [roleFamily, setRoleFamily] = useState("");
  const [emphasis, setEmphasis] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy("create");
    setError(null);
    try {
      const response = await fetch("/api/resume-variants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          roleFamily,
          emphasis: emphasis
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save the variant");
      setName("");
      setRoleFamily("");
      setEmphasis("");
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the variant");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/resume-variants/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not delete the variant");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the variant");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-[10px] border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-ink">Resume variants</h2>
        <button type="button" className="text-[11.5px] font-medium text-ink hover:underline" onClick={() => setOpen((current) => !current)}>
          {open ? "Close" : "New variant"}
        </button>
      </div>

      <ul className="divide-y divide-line">
        {variants.map((variant) => (
          <li key={variant.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-ink">
                {variant.name}
                {variant.isDefault ? <span className="chip-moss ml-1.5">default</span> : null}
              </p>
              <p className="text-[10.5px] text-muted">
                {variant.roleFamily || "any role family"}
                {variant.emphasis.length ? ` · emphasis: ${variant.emphasis.join(", ")}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-clay-50 hover:text-clay-700"
              onClick={() => remove(variant.id)}
              disabled={busy === variant.id}
              aria-label={`Delete ${variant.name}`}
            >
              {busy === variant.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            </button>
          </li>
        ))}
        {!variants.length ? (
          <li className="px-4 py-3 text-[11.5px] leading-relaxed text-muted">
            No variants yet. A variant re-orders the evidence you already verified for a role family — it never adds a claim.
          </li>
        ) : null}
      </ul>

      {open ? (
        <div className="space-y-2 border-t border-line px-4 py-3">
          <div>
            <label className="field-label" htmlFor="variant-name">
              Name
            </label>
            <input id="variant-name" className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Frontend focus" />
          </div>
          <div>
            <label className="field-label" htmlFor="variant-family">
              Role family
            </label>
            <input
              id="variant-family"
              className="field"
              value={roleFamily}
              onChange={(event) => setRoleFamily(event.target.value)}
              placeholder="Frontend Developer"
            />
            <p className="field-hint">Matching job titles use this variant automatically.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="variant-emphasis">
              Emphasis words
            </label>
            <input
              id="variant-emphasis"
              className="field"
              value={emphasis}
              onChange={(event) => setEmphasis(event.target.value)}
              placeholder="accessibility, design systems, Tailwind"
            />
            <p className="field-hint">Comma separated. Only re-weights evidence that already exists.</p>
          </div>
          <button type="button" className="btn-primary btn-sm" onClick={create} disabled={busy === "create" || name.trim().length < 2}>
            {busy === "create" ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Save variant
          </button>
          {error ? <p className="text-[11px] text-clay-700">{error}</p> : null}
        </div>
      ) : error ? (
        <p className="border-t border-line px-4 py-2 text-[11px] text-clay-700">{error}</p>
      ) : null}
    </section>
  );
}
