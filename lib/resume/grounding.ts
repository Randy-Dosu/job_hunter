import type { EvidenceFact } from "@/lib/matching/score";
import { canonicalSkill, knownSkills, skillLabel } from "@/lib/matching/requirements";
import { tokenSet } from "@/lib/text";
import type { ChangeLogEntry, TailoredResumeContent, UnsupportedClaim } from "./types";

const SKILL_ALIASES: Record<string, string[]> = {
  typescript: ["typescript", "ts"],
  javascript: ["javascript", "js"],
  react: ["react"],
  "next.js": ["next.js", "nextjs"],
  "node.js": ["node.js", "nodejs"],
  sql: ["sql"],
  postgresql: ["postgresql", "postgres"],
  tailwind: ["tailwind"],
  git: ["git"],
  docker: ["docker"],
  python: ["python"],
  linux: ["linux"],
  java: ["java"],
  kubernetes: ["kubernetes"],
  aws: ["aws"],
  graphql: ["graphql"],
  "ci/cd": ["ci/cd", "continuous integration"],
  testing: ["testing", "unit test", "vitest", "jest", "playwright"],
};

/** Every skill-like term that appears in a piece of text. */
export function mentionedSkills(text: string): string[] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9+#./ ]/g, " ").replace(/\s+/g, " ")} `;
  const found: string[] = [];
  const entries: Record<string, string[]> = { ...SKILL_ALIASES };
  for (const skill of knownSkills()) if (!entries[skill]) entries[skill] = [skill];
  for (const [skill, aliases] of Object.entries(entries)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`(^|[^a-z0-9+#])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9+#]|$)`, "i");
      if (pattern.test(haystack)) {
        found.push(skill);
        break;
      }
    }
  }
  return found;
}

function numericTokens(text: string): string[] {
  return [...text.matchAll(/\b\d+(?:[.,]\d+)?%?\b/g)].map((match) => match[0]);
}

function flattenClaims(content: TailoredResumeContent): { text: string; evidenceIds: string[]; where: string }[] {
  const claims: { text: string; evidenceIds: string[]; where: string }[] = [
    { ...content.headline, where: "Headline" },
    { ...content.summary, where: "Summary" },
    { ...content.skills.core, where: "Skills" },
  ];
  if (content.skills.learning) claims.push({ ...content.skills.learning, where: "Skills (learning)" });
  for (const entry of [...content.experience, ...content.education, ...content.certifications, ...content.achievements]) {
    for (const bullet of entry.bullets) {
      claims.push({ text: bullet.text, evidenceIds: bullet.evidenceIds, where: `${entry.title} bullet` });
    }
  }
  return claims;
}

/**
 * Deterministic guard: every generated statement must map to verified
 * evidence, and may not introduce skills, numbers, or employers that the
 * user has not supplied. Runs on every draft, independent of how it was
 * produced (rules engine or LLM).
 */
export function validateResume(
  content: TailoredResumeContent,
  facts: EvidenceFact[],
): UnsupportedClaim[] {
  const verified = new Map(facts.filter((fact) => fact.verificationStatus === "verified").map((fact) => [fact.id, fact]));
  const unsupported: UnsupportedClaim[] = [];

  const evidenceCorpus = facts
    .filter((fact) => fact.verificationStatus === "verified")
    .map((fact) => [fact.title, fact.organization, fact.evidenceNote, ...fact.bullets, ...fact.skills].join(" "))
    .join(" \n ")
    .toLowerCase();

  const heldSkills = new Set<string>();
  for (const fact of facts) {
    if (fact.verificationStatus !== "verified") continue;
    if (fact.factType === "skill") heldSkills.add(canonicalSkill(fact.title) ?? normalizeSkill(fact.title));
    for (const skill of fact.skills) heldSkills.add(canonicalSkill(skill) ?? normalizeSkill(skill));
    for (const skill of mentionedSkills(fact.bullets.join(" "))) heldSkills.add(skill);
  }

  for (const claim of flattenClaims(content)) {
    const ids = claim.evidenceIds ?? [];
    if (!ids.length) {
      unsupported.push({ text: claim.text, reason: "no_evidence", detail: `${claim.where} is not linked to any profile fact.` });
      continue;
    }
    const missing = ids.filter((id) => !verified.has(id));
    if (missing.length) {
      unsupported.push({
        text: claim.text,
        reason: "unverified_evidence",
        detail: `${claim.where} cites profile facts that are missing or unverified (${missing.join(", ")}).`,
      });
    }

    for (const skill of mentionedSkills(claim.text)) {
      if (!heldSkills.has(skill)) {
        unsupported.push({
          text: claim.text,
          reason: "unsupported_skill",
          detail: `${claim.where} mentions ${skillLabel(skill)} but your profile has no verified evidence for it.`,
        });
      }
    }

    for (const number of numericTokens(claim.text)) {
      if (!evidenceCorpus.includes(number.toLowerCase())) {
        unsupported.push({
          text: claim.text,
          reason: "unsupported_metric",
          detail: `${claim.where} states "${number}", which does not appear in any verified fact.`,
        });
      }
    }

    const claimEmployers = [...claim.text.matchAll(/\bat ([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)/g)].map((m) => m[1]);
    for (const employer of claimEmployers) {
      if (!evidenceCorpus.includes(employer.toLowerCase())) {
        unsupported.push({
          text: claim.text,
          reason: "unsupported_employer",
          detail: `${claim.where} references "${employer}", which is not in your verified history.`,
        });
      }
    }
  }

  return dedupe(unsupported);
}

function normalizeSkill(value: string): string {
  return canonicalSkill(value) ?? value.toLowerCase().trim();
}

function dedupe(items: UnsupportedClaim[]): UnsupportedClaim[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.reason}:${item.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resumeToText(content: TailoredResumeContent): string {
  const lines: string[] = [];
  lines.push(content.header.name.toUpperCase());
  if (content.header.contactLines.length) lines.push(content.header.contactLines.join(" · "));
  if (content.headline.text) lines.push("", content.headline.text);
  if (content.summary.text) lines.push("", "SUMMARY", content.summary.text);

  const renderEntries = (heading: string, entries: TailoredResumeContent["experience"]) => {
    if (!entries.length) return;
    lines.push("", heading);
    for (const entry of entries) {
      const meta = [entry.organization, entry.location].filter(Boolean).join(" — ");
      lines.push(`${entry.title}${meta ? ` — ${meta}` : ""}${entry.dates ? ` (${entry.dates})` : ""}`);
      for (const bullet of entry.bullets) lines.push(`- ${bullet.text}`);
    }
  };

  renderEntries("EXPERIENCE", content.experience);
  renderEntries("EDUCATION", content.education);
  renderEntries("CERTIFICATIONS", content.certifications);
  renderEntries("PROJECTS & ACHIEVEMENTS", content.achievements);

  if (content.skills.core.text) {
    lines.push("", "SKILLS", content.skills.core.text);
    if (content.skills.learning?.text) lines.push(content.skills.learning.text);
  }
  return lines.join("\n");
}

export type { ChangeLogEntry };
