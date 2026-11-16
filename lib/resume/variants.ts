import { all, get, insert, nowIso, run, uid } from "@/lib/db";

/**
 * Resume variants (FR-038).
 *
 * A variant is a named emphasis for a role family — "Frontend", "Data",
 * "Support" — not a second CV. It only re-orders and weights evidence the user
 * has already verified; nothing new can be introduced by selecting one.
 */

export type ResumeVariant = {
  id: string;
  userId: string;
  name: string;
  roleFamily: string;
  emphasis: string[];
  isDefault: boolean;
  createdAt: string;
};

type VariantRow = {
  id: string;
  user_id: string;
  name: string;
  role_family: string;
  emphasis_json: string;
  is_default: number;
  created_at: string;
};

function toVariant(row: VariantRow): ResumeVariant {
  let emphasis: string[] = [];
  try {
    const parsed = JSON.parse(row.emphasis_json) as unknown;
    if (Array.isArray(parsed)) emphasis = parsed.map((entry) => String(entry)).filter(Boolean);
  } catch {
    emphasis = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    roleFamily: row.role_family,
    emphasis,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  };
}

export function listVariants(userId: string): ResumeVariant[] {
  return all<VariantRow>(
    "SELECT * FROM resume_variants WHERE user_id = ? ORDER BY is_default DESC, created_at ASC",
    userId,
  ).map(toVariant);
}

export type VariantInput = { name: string; roleFamily?: string; emphasis?: string[]; isDefault?: boolean };

export function createVariant(userId: string, input: VariantInput): { ok: true; variant: ResumeVariant } | { ok: false; error: string } {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Give the variant a name of at least two characters." };
  if (name.length > 60) return { ok: false, error: "Keep the variant name under 60 characters." };
  const roleFamily = (input.roleFamily ?? "").trim().slice(0, 60);
  const emphasis = (input.emphasis ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((entry) => entry.slice(0, 40));

  const existing = get<{ id: string }>("SELECT id FROM resume_variants WHERE user_id = ? AND name = ?", userId, name);
  if (existing) return { ok: false, error: "A variant with that name already exists." };

  if (input.isDefault) {
    run("UPDATE resume_variants SET is_default = 0 WHERE user_id = ?", userId);
  }
  const id = uid();
  insert("resume_variants", {
    id,
    user_id: userId,
    name,
    role_family: roleFamily,
    emphasis_json: JSON.stringify(emphasis),
    is_default: input.isDefault ? 1 : 0,
    created_at: nowIso(),
  });
  const created = get<VariantRow>("SELECT * FROM resume_variants WHERE id = ?", id)!;
  return { ok: true, variant: toVariant(created) };
}

export function deleteVariant(userId: string, id: string): { ok: boolean; error?: string } {
  const row = get<{ id: string }>("SELECT id FROM resume_variants WHERE id = ? AND user_id = ?", id, userId);
  if (!row) return { ok: false, error: "Variant not found." };
  run("DELETE FROM resume_variants WHERE id = ? AND user_id = ?", id, userId);
  return { ok: true };
}

/**
 * Pick the variant whose role family best matches the vacancy, then fall back to
 * the user's default, then to no variant at all. Pure string matching: no model
 * decides which CV to use.
 */
export function resolveVariant(userId: string, jobTitle: string): ResumeVariant | null {
  const variants = listVariants(userId);
  if (!variants.length) return null;
  const title = ` ${jobTitle.toLowerCase()} `;
  const scored = variants
    .map((variant) => {
      const family = variant.roleFamily.toLowerCase().trim();
      if (!family) return { variant, score: 0 };
      const words = family.split(/[\s,/&]+/).filter((word) => word.length > 2);
      const score = words.reduce((total, word) => (title.includes(word) ? total + 1 : total), 0);
      return { variant, score };
    })
    .sort((a, b) => b.score - a.score);
  if (scored[0].score > 0) return scored[0].variant;
  return variants.find((variant) => variant.isDefault) ?? null;
}
