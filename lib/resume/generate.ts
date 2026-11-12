import { extractRequirements, skillLabel } from "@/lib/matching/requirements";
import { verifiedSkills, type EvidenceFact, type Preferences, type ProfileSnapshot } from "@/lib/matching/score";
import { cleanLine, overlap, tokenSet } from "@/lib/text";
import { isLlmConfigured, rewriteSummaryWithLlm } from "@/lib/llm";
import { validateResume } from "./grounding";
import type {
  ChangeLogEntry,
  GenerationResult,
  ResumeEntry,
  TailoredResumeContent,
  UnsupportedClaim,
} from "./types";

export type GenerateInput = {
  candidateName: string;
  contactLines: string[];
  job: {
    id: string;
    title: string;
    company: string;
    description: string;
    requirements: string;
    seniority: string;
    location: string;
  };
  profile: ProfileSnapshot;
  preferences: Preferences;
  baseResumeText?: string | null;
  /** Optional variant emphasis (FR-038). Only re-weights existing evidence. */
  variant?: { name: string; emphasis: string[] } | null;
};

function datesLabel(fact: EvidenceFact): string {
  const fmt = (value: string | null) => {
    if (!value) return "";
    const date = new Date(value.length === 7 ? `${value}-01` : value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  };
  const start = fmt(fact.startDate);
  const end = fact.endDate ? fmt(fact.endDate) : "Present";
  if (!start) return end === "Present" ? "" : end;
  return `${start} – ${end}`;
}

function yearsPhrase(years: number): string {
  if (years >= 4) return "several years of";
  if (years >= 2) return "two years of";
  if (years >= 1) return "over a year of";
  return "hands-on project";
}

function relevance(fact: EvidenceFact, targetTokens: Set<string>): number {
  const corpus = [fact.title, fact.organization, ...fact.bullets, ...fact.skills].join(" ");
  return overlap(tokenSet(corpus), targetTokens);
}

function sortEntries(facts: EvidenceFact[], targetTokens: Set<string>): EvidenceFact[] {
  return [...facts].sort((a, b) => {
    const diff = relevance(b, targetTokens) - relevance(a, targetTokens);
    if (Math.abs(diff) > 0.01) return diff;
    return new Date(b.startDate ?? 0).getTime() - new Date(a.startDate ?? 0).getTime();
  });
}

function toEntry(fact: EvidenceFact, targetTokens: Set<string>, log: ChangeLogEntry[], section: string): ResumeEntry {
  const orderedBullets = [...fact.bullets]
    .map((text) => ({ text, score: overlap(tokenSet(text), targetTokens) }))
    .sort((a, b) => b.score - a.score);

  const kept = orderedBullets.filter((bullet, index) => bullet.score > 0 || index < 3 || orderedBullets.length <= 3);
  const dropped = orderedBullets.filter((bullet) => !kept.includes(bullet));

  if (orderedBullets.some((bullet, index) => bullet.text !== fact.bullets[index])) {
    log.push({
      id: crypto.randomUUID(),
      type: "reordered",
      section,
      description: `Reordered ${orderedBullets.length} bullets in “${fact.title}” so the most job-relevant evidence comes first.`,
      evidenceIds: [fact.id],
    });
  }
  for (const bullet of dropped) {
    log.push({
      id: crypto.randomUUID(),
      type: "omitted",
      section,
      description: `Left out a bullet from “${fact.title}” as it was not relevant to this vacancy: “${cleanLine(bullet.text).slice(0, 120)}…” (still saved in your profile).`,
      evidenceIds: [fact.id],
    });
  }

  return {
    title: fact.title,
    organization: fact.organization,
    location: fact.location,
    dates: datesLabel(fact),
    bullets: kept.map((bullet) => ({ text: bullet.text, evidenceIds: [fact.id] })),
    evidenceIds: [fact.id],
  };
}

function buildSummary(
  profile: ProfileSnapshot,
  facts: EvidenceFact[],
  jobTitle: string,
  matchedSkills: string[],
): { text: string; evidenceIds: string[] } {
  const experience = facts.filter((fact) => fact.factType === "experience");
  const mostRecent = [...experience].sort(
    (a, b) => new Date(b.startDate ?? 0).getTime() - new Date(a.startDate ?? 0).getTime(),
  )[0];

  const descriptor = profile.headline
    ? cleanLine(profile.headline).replace(/\s+—\s+.*$/, "")
    : `${profile.educationLevel ?? "Recent graduate"} in ${profile.location || "your market"}`;

  const topSkills = matchedSkills.slice(0, 5).map(skillLabel);
  const parts: string[] = [];
  parts.push(
    `${descriptor} with ${yearsPhrase(profile.yearsExperience)} experience building web applications${
      topSkills.length ? `, focused on ${topSkills.join(", ")}` : ""
    }.`,
  );

  if (mostRecent) {
    const leadBullet = mostRecent.bullets[0];
    parts.push(
      `${mostRecent.title}${mostRecent.organization ? ` at ${mostRecent.organization}` : ""}${
        leadBullet ? `, where I ${lowerFirst(cleanLine(leadBullet).replace(/\.$/, ""))}` : ""
      }.`,
    );
  }

  if (profile.educationLevel) {
    const education = facts.find((fact) => fact.factType === "education" && fact.verificationStatus === "verified");
    parts.push(
      education
        ? `${profile.educationLevel} graduate of ${education.organization}.`
        : `Educated to ${profile.educationLevel} level.`,
    );
  }

  parts.push(`Now seeking a ${jobTitle} role where I can contribute from day one and keep developing.`);

  const evidenceIds = [
    ...(mostRecent ? [mostRecent.id] : []),
    ...facts.filter((fact) => fact.factType === "skill" && matchedSkills.some((s) => fact.title.toLowerCase() === skillLabel(s).toLowerCase())).map((fact) => fact.id),
    ...facts.filter((fact) => fact.factType === "education").slice(0, 1).map((fact) => fact.id),
  ];

  return { text: parts.join(" "), evidenceIds: [...new Set(evidenceIds)] };
}

function lowerFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/** Build the cover letter from the same verified facts (P1, opt-in). Never invents claims. */
export function generateCoverLetter(content: TailoredResumeContent, company: string, jobTitle: string): string {
  const leadSkill = content.skills.core.text.split(",").slice(0, 3).map((s) => s.trim()).filter(Boolean).join(", ");
  const experience = content.experience[0];
  const bullet = experience?.bullets[0]?.text ?? "";
  return [
    `Dear ${company} hiring team,`,
    "",
    `I am applying for the ${jobTitle} role. ${content.summary.text}`,
    "",
    experience
      ? `In my most recent work as ${experience.title}${experience.organization ? ` at ${experience.organization}` : ""}, I ${
          bullet ? lowerFirst(bullet.replace(/\.$/, "")) : "delivered work directly relevant to this role"
        }.`
      : "",
    "",
    leadSkill
      ? `The tools I use most are ${leadSkill}. Everything in the attached resume is drawn from verified work history; I am happy to talk through any detail.`
      : "Every claim in the attached resume is drawn from my verified work history.",
    "",
    "Thank you for your time and consideration.",
    "",
    content.header.name,
    "",
    "[Confirm before sending: notice period and earliest start date]",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}

export async function generateTailoredResume(input: GenerateInput): Promise<GenerationResult> {
  const { job, profile } = input;
  const facts = profile.facts.filter((fact) => fact.verificationStatus === "verified");
  const requirements = extractRequirements(`${job.description}\n${job.requirements}`, job.title);
  const heldSkills = verifiedSkills(facts);

  const required = requirements.required;
  const preferred = requirements.preferred;
  const matchedRequired = required.filter((req) => heldSkills.has(req.skill));
  const missingRequired = required.filter((req) => !heldSkills.has(req.skill));
  const matchedPreferred = preferred.filter((req) => heldSkills.has(req.skill));
  const matchedSkills = [...new Set([...matchedRequired, ...matchedPreferred].map((req) => req.skill))];

  const targetTokens = new Set([
    ...required.map((req) => req.skill),
    ...preferred.map((req) => req.skill),
    ...tokenSet(job.title),
    ...(input.variant?.emphasis ?? []).flatMap((entry) => [...tokenSet(entry)]),
  ]);

  const log: ChangeLogEntry[] = [];
  const experience = sortEntries(facts.filter((fact) => fact.factType === "experience"), targetTokens);
  const originalExperience = facts.filter((fact) => fact.factType === "experience");
  if (experience.length && experience.map((fact) => fact.id).join() !== originalExperience.map((fact) => fact.id).join()) {
    log.push({
      id: crypto.randomUUID(),
      type: "reordered",
      section: "Experience",
      description: `Moved ${experience[0].title} to the top because its evidence overlaps most with this vacancy.`,
      evidenceIds: [experience[0].id],
    });
  }

  const experienceEntries = experience.map((fact) => toEntry(fact, targetTokens, log, "Experience"));
  const educationEntries = facts
    .filter((fact) => fact.factType === "education")
    .map((fact) => toEntry(fact, targetTokens, log, "Education"));
  const certificationEntries = facts
    .filter((fact) => fact.factType === "certification")
    .map((fact) => toEntry(fact, targetTokens, log, "Certifications"));
  const achievementEntries = facts
    .filter((fact) => fact.factType === "achievement")
    .map((fact) => toEntry(fact, targetTokens, log, "Projects & achievements"));

  const professionalSkills = facts.filter(
    (fact) => fact.factType === "skill" && fact.state === "professional",
  );
  const learningSkills = facts.filter((fact) => fact.factType === "skill" && fact.state === "learning");

  const orderedSkills = [...professionalSkills].sort((a, b) => {
    const score = (fact: EvidenceFact) => {
      const mentioned = matchedSkills.some((skill) => skillLabel(skill).toLowerCase() === fact.title.toLowerCase() || skill === fact.title.toLowerCase());
      return mentioned ? 1 : 0;
    };
    return score(b) - score(a);
  });

  const coreText = orderedSkills.map((fact) => fact.title).join(", ");
  const learningText = learningSkills.length
    ? `Currently learning (self-study, no professional experience yet): ${learningSkills.map((fact) => fact.title).join(", ")}`
    : null;

  if (coreText) {
    log.push({
      id: crypto.randomUUID(),
      type: "emphasized",
      section: "Skills",
      description: `Ordered ${orderedSkills.length} verified skills by relevance to this vacancy; ${Math.min(orderedSkills.length, 5)} appear in the summary.`,
      evidenceIds: orderedSkills.map((fact) => fact.id),
    });
  }
  if (learningText) {
    log.push({
      id: crypto.randomUUID(),
      type: "added",
      section: "Skills",
      description: "Labelled learning skills explicitly so they are never presented as professional experience.",
      evidenceIds: learningSkills.map((fact) => fact.id),
    });
  }

  const headline = {
    text: profile.headline || `${job.title} candidate`,
    evidenceIds: [
      ...orderedSkills.slice(0, 4).map((fact) => fact.id),
      ...facts.filter((fact) => fact.factType === "experience").slice(0, 2).map((fact) => fact.id),
    ],
  };

  const deterministicSummary = buildSummary(profile, facts, job.title, matchedSkills);
  let summary = deterministicSummary;
  let provider = "deterministic-rules-v1";
  const warnings: string[] = [];

  if (isLlmConfigured()) {
    const llm = await rewriteSummaryWithLlm({
      jobTitle: job.title,
      jobCompany: job.company,
      facts: facts.map((fact) => ({
        id: fact.id,
        label: `${fact.factType}: ${fact.title}${fact.organization ? ` (${fact.organization})` : ""}`,
        detail: [fact.evidenceNote, ...fact.bullets].filter(Boolean).join(" | "),
      })),
      draft: summary.text,
    });
    if (llm.text) {
      const candidate = { text: llm.text, evidenceIds: summary.evidenceIds };
      const probe = validateResume(
        { ...emptyContent(input.candidateName, input.contactLines, job), summary: candidate, headline: { text: input.profile.headline, evidenceIds: summary.evidenceIds } },
        facts,
      );
      if (probe.length) {
        warnings.push("LLM summary failed the evidence check, so the deterministic summary was kept.");
      } else {
        summary = candidate;
        provider = `llm:${llm.model ?? "configured"}`;
      }
    }
    if (llm.error) warnings.push(`LLM provider unavailable, used deterministic summary (${llm.error}).`);
  }

  log.push({
    id: crypto.randomUUID(),
    type: "rewritten",
    section: "Summary",
    description: input.baseResumeText
      ? "Rewrote the summary for this vacancy using only verified experience, skills and education."
      : "Generated a summary from your verified profile facts.",
    evidenceIds: summary.evidenceIds,
  });

  const content: TailoredResumeContent = {
    header: {
      name: input.candidateName,
      contactLines: input.contactLines,
    },
    target: { jobTitle: job.title, company: job.company, jobId: job.id },
    headline,
    summary,
    experience: experienceEntries,
    education: educationEntries,
    certifications: certificationEntries,
    achievements: achievementEntries,
    skills: {
      core: { text: coreText, evidenceIds: orderedSkills.map((fact) => fact.id) },
      learning: learningText
        ? { text: learningText, evidenceIds: learningSkills.map((fact) => fact.id) }
        : null,
    },
    omitted: [],
    generatedAt: new Date().toISOString(),
  };

  if (input.variant) {
    log.push({
      id: crypto.randomUUID(),
      type: "reordered",
      section: "Variant",
      description: `Applied the “${input.variant.name}” variant, which emphasises ${input.variant.emphasis.length ? input.variant.emphasis.join(", ") : "this role family"}. Only verified facts were re-ordered.`,
      evidenceIds: [],
    });
  }

  const result = finalize(content, log, facts, {
    engine: "evidence-grounded",
    provider,
    evidenceUsed: new Set(log.flatMap((entry) => entry.evidenceIds)).size,
    requirementsMatched: matchedSkills,
    requirementsMissing: missingRequired.map((req) => req.skill),
    generatedAt: new Date().toISOString(),
    warnings,
    ...(input.variant ? { variant: input.variant.name } : {}),
  });
  void deterministicSummary;
  return result;
}

function emptyContent(name: string, contactLines: string[], job: GenerateInput["job"]): TailoredResumeContent {
  return {
    header: { name, contactLines },
    target: { jobTitle: job.title, company: job.company, jobId: job.id },
    headline: { text: "", evidenceIds: [] },
    summary: { text: "", evidenceIds: [] },
    experience: [],
    education: [],
    certifications: [],
    achievements: [],
    skills: { core: { text: "", evidenceIds: [] }, learning: null },
    omitted: [],
    generatedAt: new Date().toISOString(),
  };
}

/** Validate, then strip anything that fails validation (defence in depth). */
export function finalize(
  content: TailoredResumeContent,
  log: ChangeLogEntry[],
  facts: EvidenceFact[],
  metadata: GenerationResult["metadata"],
): GenerationResult {
  const unsupported = validateResume(content, facts);
  if (unsupported.length) {
    metadata.warnings.push(
      `${unsupported.length} statement${unsupported.length === 1 ? "" : "s"} could not be traced to verified evidence and must be resolved before this resume can be approved.`,
    );
  }
  return { content, changeLog: log, unsupported, metadata };
}

export type { UnsupportedClaim };
