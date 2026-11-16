/**
 * FR-037: cover letter and application-question drafts.
 *
 * Two rules hold for every string produced here:
 *  1. It only restates verified profile facts (each answer carries the evidence ids
 *     that justify it), or it is an explicit placeholder that the user must fill in.
 *  2. Anything that depends on a commitment we cannot know — salary, notice period,
 *     right to work, sponsorship — is marked `needs_confirmation` and blocks approval
 *     until the user has read and confirmed it.
 *
 * Questions come from the listing itself when it asks them outright, plus a small set
 * of standard form prompts. Nothing is invented about the employer.
 */
import { canonicalSkill, extractRequirements, knownSkills, skillLabel } from "@/lib/matching/requirements";
import { verifiedSkills, type EvidenceFact, type Preferences, type ProfileSnapshot } from "@/lib/matching/score";
import { cleanLine } from "@/lib/text";
import { generateCoverLetter } from "./generate";
import type { TailoredResumeContent } from "./types";

export type AnswerStatus = "grounded" | "needs_confirmation";
export type AnswerSource = "listing" | "standard";

export type AnswerDraft = {
  question: string;
  answer: string;
  status: AnswerStatus;
  source: AnswerSource;
  evidenceIds: string[];
  confirmationNote: string;
  confirmed: boolean;
};

export type ApplicationMaterials = {
  coverLetter: string;
  coverLetterEvidenceIds: string[];
  answers: AnswerDraft[];
  warnings: string[];
  requirements: { matched: string[]; missing: string[] };
  generatedAt: string;
};

export type MaterialsJob = {
  title: string;
  company: string;
  location: string;
  description: string;
  requirements: string;
};

/** Placeholder prefix. A confirmed answer may never still contain it. */
export const PLACEHOLDER_MARKER = "[Confirm";

const MAX_LISTING_QUESTIONS = 5;
const MAX_QUESTIONS = 8;

type Intent = "why" | "experience" | "skills" | "salary" | "start" | "authorization" | "sponsorship" | "generic";

const INTENT_PATTERNS: { intent: Intent; pattern: RegExp }[] = [
  { intent: "sponsorship", pattern: /\bsponsor/i },
  { intent: "authorization", pattern: /(authori[sz]ed|right to work|work permit|visa|eligible to work|work authori[sz]ation)/i },
  { intent: "salary", pattern: /(salary|compensation|remuneration|pay expectation|expected pay|desired pay)/i },
  { intent: "start", pattern: /(when (could|can|would) you (start|begin)|start date|notice period|available to start|availability to start)/i },
  { intent: "why", pattern: /(why (do|are|would|should) you|why (this|our|the) (role|company|team|position))/i },
  { intent: "experience", pattern: /(experience|background|track record|worked on|built)/i },
  { intent: "skills", pattern: /(skill|technolog|tools|stack|proficien|familiar with)/i },
];

export function answerIntent(question: string): Intent {
  for (const entry of INTENT_PATTERNS) {
    if (entry.pattern.test(question)) return entry.intent;
  }
  return "generic";
}

function normalizeQuestion(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase().replace(/[?!.,;:]+$/g, "");
}

function isPlaceholder(answer: string): boolean {
  return answer.toLowerCase().includes(PLACEHOLDER_MARKER.toLowerCase());
}

function evidenceIdsOf(facts: EvidenceFact[]): string[] {
  return [...new Set(facts.map((fact) => fact.id))];
}

function datesLabel(fact: EvidenceFact): string {
  const fmt = (value: string | null) => {
    if (!value) return "";
    const date = new Date(value.length === 7 ? `${value}-01` : value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  };
  const start = fmt(fact.startDate);
  const end = fact.endDate ? fmt(fact.endDate) : "Present";
  if (!start) return end === "Present" ? "" : `until ${end}`;
  return `${start} – ${end}`;
}

function quoteBullet(bullet: string): string {
  const text = cleanLine(bullet).replace(/[.;]\s*$/, "");
  if (!text) return "";
  const lower = text.charAt(0).toLowerCase() + text.slice(1);
  return `one example from that work: “${lower}”.`;
}

function listPhrase(items: string[], max = 4): string {
  const trimmed = items.slice(0, max).map((item) => cleanLine(item));
  if (!trimmed.length) return "";
  if (trimmed.length === 1) return trimmed[0];
  return `${trimmed.slice(0, -1).join(", ")} and ${trimmed[trimmed.length - 1]}`;
}

function professionalSkills(facts: EvidenceFact[]): string[] {
  return [...verifiedSkills(facts)]
    .filter(([, weight]) => weight >= 1)
    .map(([skill]) => skillLabel(canonicalSkill(skill) ?? skill));
}

type DraftContext = {
  job: MaterialsJob;
  profile: ProfileSnapshot;
  preferences: Preferences;
  facts: EvidenceFact[];
  skills: string[];
  requirements: { matched: string[]; missing: string[] };
  mostRecent: EvidenceFact | null;
};

function groundedExperienceAnswer(ctx: DraftContext): AnswerDraft {
  const { mostRecent, skills, job } = ctx;
  const parts: string[] = [];
  const evidence: EvidenceFact[] = [];

  if (mostRecent) {
    const dates = datesLabel(mostRecent);
    parts.push(
      `Most recently I worked as ${mostRecent.title}${mostRecent.organization ? ` at ${mostRecent.organization}` : ""}${
        dates ? ` (${dates})` : ""
      }.`,
    );
    const bullet = mostRecent.bullets[0];
    if (bullet) parts.push(`For this kind of role, ${quoteBullet(bullet)}`);
    evidence.push(mostRecent);
  }

  if (skills.length) {
    parts.push(
      mostRecent
        ? `The tools I used there included ${listPhrase(skills, 5)}.`
        : `My verified work covers ${listPhrase(skills, 5)}.`,
    );
    evidence.push(...ctx.facts.filter((fact) => fact.factType === "skill" && fact.verificationStatus === "verified").slice(0, 5));
  }

  if (!parts.length) {
    return {
      question: "What experience do you have that is relevant to this role?",
      answer: `${PLACEHOLDER_MARKER}: write two sentences about the work you want ${job.company} to see — nothing in your verified profile describes it yet.]`,
      status: "needs_confirmation",
      source: "standard",
      evidenceIds: [],
      confirmationNote: "No verified experience facts are saved yet, so this answer cannot be drafted.",
      confirmed: false,
    };
  }

  const coverage = ctx.requirements.matched.length
    ? `The listing asks for ${listPhrase(ctx.requirements.matched.map(skillLabel), 4)}; that is the part of my work this answer is drawn from.`
    : "";

  return {
    question: "Which of your past work best prepares you for this role?",
    answer: [...parts, coverage].filter(Boolean).join(" "),
    status: "grounded",
    source: "standard",
    evidenceIds: evidenceIdsOf(evidence),
    confirmationNote: "",
    confirmed: true,
  };
}

function groundedWhyAnswer(ctx: DraftContext): AnswerDraft {
  const { job, requirements, mostRecent, skills } = ctx;
  const matched = requirements.matched;
  const parts: string[] = [];

  if (matched.length) {
    parts.push(`The ${job.title} role calls for ${listPhrase(matched.map(skillLabel), 4)}.`);
  } else {
    parts.push(`I am applying for the ${job.title} role at ${job.company}.`);
  }

  if (skills.length) {
    parts.push(`In my verified experience I have used ${listPhrase(skills, 4)}.`);
  }
  if (mostRecent) {
    const dates = datesLabel(mostRecent);
    parts.push(
      `As ${mostRecent.title}${mostRecent.organization ? ` at ${mostRecent.organization}` : ""}${
        dates ? ` (${dates})` : ""
      }${mostRecent.bullets[0] ? `, ${quoteBullet(mostRecent.bullets[0])}` : "."}`,
    );
  }

  return {
    question: `Why are you interested in the ${job.title} role at ${job.company}?`,
    answer: `${parts.join(" ")} Everything here is taken from my verified work history.`.replace(/\s+/g, " "),
    status: "grounded",
    source: "standard",
    evidenceIds: evidenceIdsOf(mostRecent ? [mostRecent] : ctx.facts.filter((fact) => fact.factType === "skill")),
    confirmationNote: "",
    confirmed: true,
  };
}

function groundedSkillsAnswer(ctx: DraftContext): AnswerDraft {
  const { skills, job, requirements, mostRecent } = ctx;
  const answer = skills.length
    ? `I have verified, hands-on experience with ${listPhrase(skills, 6)}.${mostRecent ? ` Most of it comes from my work as ${mostRecent.title}${mostRecent.organization ? ` at ${mostRecent.organization}` : ""}.` : ""}`
    : `${PLACEHOLDER_MARKER}: list the tools you can demonstrate — no verified skills are saved yet.]`;
  return {
    question: `Which skills would you bring to the ${job.title} role?`,
    answer,
    status: skills.length ? "grounded" : "needs_confirmation",
    source: "standard",
    evidenceIds: evidenceIdsOf(ctx.facts.filter((fact) => fact.factType === "skill")),
    confirmationNote: skills.length ? "" : "No verified skill facts are saved yet.",
    confirmed: skills.length > 0,
  };
}

function salaryAnswer(ctx: DraftContext): AnswerDraft {
  const { preferences } = ctx;
  const floor = preferences.salaryFloor;
  const answer =
    floor && floor > 0
      ? `My target is ${preferences.currency} ${floor.toLocaleString("en-GB")} or more per year. I am happy to discuss the full package.`
      : `${PLACEHOLDER_MARKER}: state the salary you want — your profile does not record one yet.]`;
  return {
    question: "What are your salary expectations?",
    answer,
    status: "needs_confirmation",
    source: "standard",
    evidenceIds: [],
    confirmationNote:
      floor && floor > 0
        ? `Prefilled from your market preference (minimum ${preferences.currency} ${floor.toLocaleString("en-GB")}). Confirm or edit before it is included.`
        : "No salary preference is saved. Write the figure you are willing to state, or remove this question.",
    confirmed: false,
  };
}

function startAnswer(): AnswerDraft {
  return {
    question: "When would you be able to start?",
    answer: `${PLACEHOLDER_MARKER}: replace with your notice period and earliest start date.]`,
    status: "needs_confirmation",
    source: "standard",
    evidenceIds: [],
    confirmationNote: "Notice period and start date are commitments only you can make.",
    confirmed: false,
  };
}

const GENERIC_LOCATIONS = /^(worldwide|anywhere|global|remote|remote \(worldwide\)|not specified|unknown|n\/a)$/i;

function authorizationAnswer(ctx: DraftContext): AnswerDraft {
  const { profile, preferences, job } = ctx;
  const stated = cleanLine(profile.workAuthorization || preferences.workAuthorization);
  const place = GENERIC_LOCATIONS.test(cleanLine(job.location)) ? "" : cleanLine(job.location);
  const answer = stated
    ? `${stated}.`
    : `${PLACEHOLDER_MARKER}: confirm your right to work in ${place || "the country where you would be based"}.]`;
  return {
    question: place ? `Are you authorised to work in ${place}?` : "Are you authorised to work in the country where this role is based?",
    answer,
    status: "needs_confirmation",
    source: "standard",
    evidenceIds: [],
    confirmationNote: stated
      ? "Prefilled from your profile. Right-to-work statements are legal commitments — confirm the wording."
      : "Your profile does not record a right-to-work status.",
    confirmed: false,
  };
}

function sponsorshipAnswer(ctx: DraftContext): AnswerDraft {
  const needs = ctx.preferences.needsSponsorship;
  return {
    question: "Will you now or in the future require visa sponsorship?",
    answer: needs
      ? "Yes — I require visa sponsorship to take up this role."
      : "No — I do not require visa sponsorship.",
    status: "needs_confirmation",
    source: "standard",
    evidenceIds: [],
    confirmationNote: "Taken from your market preference. Sponsorship answers are commitments — confirm before they are included.",
    confirmed: false,
  };
}

function namedSkillIn(question: string): string | null {
  const tokens = question.toLowerCase().match(/[a-z0-9+#.]{2,}/g) ?? [];
  for (const token of tokens) {
    const canonical = canonicalSkill(token);
    if (canonical && knownSkills().includes(canonical)) return canonical;
  }
  return null;
}

function listingAnswer(question: string, ctx: DraftContext): AnswerDraft {
  const intent = answerIntent(question);

  // A question naming a specific tool is about that tool, not about "experience" in
  // general. If the skill is not verified, say so instead of answering something else.
  const named = namedSkillIn(question);
  if (named) {
    const weight = verifiedSkills(ctx.facts).get(named) ?? 0;
    const held = weight >= 1 ? skillLabel(named) : null;
    if (!held) {
      return {
        question,
        answer: `${PLACEHOLDER_MARKER}: answer this in your own words — ${skillLabel(named)} is not a verified skill in your profile.]`,
        status: "needs_confirmation",
        source: "listing",
        evidenceIds: [],
        confirmationNote: `The listing asks about ${skillLabel(named)}, which you have not verified. Do not claim it unless it is true.`,
        confirmed: false,
      };
    }
    const fact = ctx.facts.find(
      (entry) => entry.verificationStatus === "verified" && entry.skills.some((skill) => (canonicalSkill(skill) ?? "") === named),
    ) ?? ctx.mostRecent;
    return {
      question,
      answer: fact
        ? `I have used ${held} in my work as ${fact.title}${fact.organization ? ` at ${fact.organization}` : ""}. ${fact.bullets[0] ? quoteBullet(fact.bullets[0]) : ""}`.trim()
        : `I have verified experience with ${held}.`,
      status: "grounded",
      source: "listing",
      evidenceIds: fact ? [fact.id] : [],
      confirmationNote: "",
      confirmed: true,
    };
  }
  const base = (() => {
    switch (intent) {
      case "why":
        return groundedWhyAnswer(ctx);
      case "experience":
        return groundedExperienceAnswer(ctx);
      case "skills":
        return groundedSkillsAnswer(ctx);
      case "salary":
        return salaryAnswer(ctx);
      case "start":
        return startAnswer();
      case "authorization":
        return authorizationAnswer(ctx);
      case "sponsorship":
        return sponsorshipAnswer(ctx);
      default:
        return null;
    }
  })();

  if (base) return { ...base, question, source: "listing" };

  // A question we cannot answer from verified facts — say so instead of guessing.
  return {
    question,
    answer: `${PLACEHOLDER_MARKER}: answer this in your own words — the listing asks something that is not recorded in your verified profile.]`,
    status: "needs_confirmation",
    source: "listing",
    evidenceIds: [],
    confirmationNote: "The employer wrote this question; only you can answer it.",
    confirmed: false,
  };
}

/** Pull questions the listing itself asks. Never paraphrased, never fabricated. */
export function questionsFromListing(job: MaterialsJob): string[] {
  const text = `${job.description}\n${job.requirements}`;
  const sentences = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => cleanLine(line).replace(/^[-•*\d.)\s]+/, "").trim())
    .filter((line) => line.endsWith("?"));

  const seen = new Set<string>();
  const questions: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length < 12 || sentence.length > 220) continue;
    const key = normalizeQuestion(sentence);
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(sentence);
    if (questions.length >= MAX_LISTING_QUESTIONS) break;
  }
  return questions;
}

export function draftApplicationMaterials(input: {
  job: MaterialsJob;
  profile: ProfileSnapshot;
  preferences: Preferences;
  resume: TailoredResumeContent;
  /** Used to explain the fit; derived from the listing if omitted. */
  requirements?: { matched: string[]; missing: string[] };
}): ApplicationMaterials {
  const { job, profile, preferences, resume } = input;
  const facts = profile.facts.filter((fact) => fact.verificationStatus === "verified");
  const held = professionalSkills(facts);
  const extracted = extractRequirements(`${job.description}\n${job.requirements}`, job.title);
  const required = extracted.required.map((req) => req.skill);
  const preferred = extracted.preferred.map((req) => req.skill);
  const heldSet = new Set([...verifiedSkills(facts)].filter(([, weight]) => weight >= 1).map(([skill]) => skill));
  const requirements =
    input.requirements ?? {
      matched: [...required, ...preferred].filter((skill) => heldSet.has(skill)),
      missing: required.filter((skill) => !heldSet.has(skill)),
    };

  const mostRecent = [...facts.filter((fact) => fact.factType === "experience")].sort(
    (a, b) => new Date(b.startDate ?? 0).getTime() - new Date(a.startDate ?? 0).getTime(),
  )[0] ?? null;

  const ctx: DraftContext = {
    job,
    profile,
    preferences,
    facts,
    skills: held,
    requirements,
    mostRecent,
  };

  const answers: AnswerDraft[] = [];
  const seenIntents = new Set<Intent>();

  for (const question of questionsFromListing(job)) {
    if (answers.length >= MAX_QUESTIONS) break;
    const draft = listingAnswer(question, ctx);
    if (answers.some((answer) => normalizeQuestion(answer.question) === normalizeQuestion(question))) continue;
    answers.push(draft);
    seenIntents.add(answerIntent(question));
  }

  const standard: AnswerDraft[] = [groundedWhyAnswer(ctx), groundedExperienceAnswer(ctx), groundedSkillsAnswer(ctx)];
  if (preferences.needsSponsorship) standard.push(sponsorshipAnswer(ctx));
  standard.push(authorizationAnswer(ctx), salaryAnswer(ctx), startAnswer());

  const standardIntents: Record<number, Intent> = { 0: "why", 1: "experience", 2: "skills", 3: "sponsorship" };
  standard.forEach((draft, index) => {
    if (answers.length >= MAX_QUESTIONS) return;
    const intent = standardIntents[index] ?? answerIntent(draft.question);
    if (seenIntents.has(intent)) return;
    if (answers.some((answer) => normalizeQuestion(answer.question) === normalizeQuestion(draft.question))) return;
    answers.push(draft);
    seenIntents.add(intent);
  });

  const coverLetter = generateCoverLetter(resume, job.company, job.title);
  const warnings: string[] = [];
  if (!facts.length) warnings.push("No verified profile facts yet — every answer is a placeholder.");
  if (!mostRecent) warnings.push("No verified employment history. Answers use skills and education only.");
  if (requirements.missing.length) {
    warnings.push(
      `Not evidenced: ${requirements.missing.slice(0, 4).map(skillLabel).join(", ")}. The drafts never claim these.`,
    );
  }
  const unconfirmed = answers.filter((answer) => answer.status === "needs_confirmation").length;
  if (unconfirmed) warnings.push(`${unconfirmed} answer${unconfirmed === 1 ? "" : "s"} need your confirmation before approval.`);

  return {
    coverLetter,
    coverLetterEvidenceIds: [
      ...new Set([
        ...resume.summary.evidenceIds,
        ...resume.experience.flatMap((entry) => entry.evidenceIds),
        ...(resume.skills.core.evidenceIds ?? []),
      ]),
    ],
    answers,
    warnings,
    requirements,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Canonical answer shape. The package hash is computed over this, so the same
 * material always produces the same hash regardless of how it was submitted.
 */
export function canonicalAnswers(value: unknown): AnswerDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => {
      const status: AnswerStatus = entry.status === "needs_confirmation" ? "needs_confirmation" : "grounded";
      const source: AnswerSource = entry.source === "listing" ? "listing" : "standard";
      return {
        question: String(entry.question ?? "").trim(),
        answer: String(entry.answer ?? "").trim(),
        status,
        source,
        evidenceIds: Array.isArray(entry.evidenceIds)
          ? [...new Set(entry.evidenceIds.filter((id): id is string => typeof id === "string" && Boolean(id)))]
          : [],
        confirmationNote: String(entry.confirmationNote ?? "").trim(),
        confirmed: entry.confirmed === true,
      };
    })
    .filter((entry) => entry.question.length > 0);
}

/** Human-readable problems with a set of answers; empty means the package may be approved. */
export function answerProblems(value: unknown): string[] {
  const answers = canonicalAnswers(value);
  const problems: string[] = [];
  answers.forEach((answer, index) => {
    const label = `Q${index + 1} “${answer.question.slice(0, 60)}${answer.question.length > 60 ? "…" : ""}”`;
    if (!answer.answer) {
      problems.push(`${label} has no answer.`);
      return;
    }
    if (answer.answer.length > 2000) problems.push(`${label} is longer than 2000 characters.`);
    if (answer.status === "needs_confirmation" && !answer.confirmed) {
      problems.push(`${label} needs your confirmation: ${answer.confirmationNote || "review the wording before it is submitted."}`);
    }
    if (answer.confirmed && isPlaceholder(answer.answer)) {
      problems.push(`${label} still contains a bracketed placeholder — replace it with your own wording.`);
    }
  });
  return problems;
}
