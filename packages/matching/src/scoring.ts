/**
 * Weighted, explainable compatibility scoring.
 *
 * Design rules from the plan:
 *  - Deterministic components produce repeatable scores.
 *  - Every score has a breakdown, evidence and gaps.
 *  - Missing information is labelled `unknown`, never scored as a deficiency.
 *  - Semantic (AI) comparison is optional and clearly labelled.
 */

import type {
  CandidateProfileContent,
  JobPreferences,
  MatchDimension,
  MatchEvidence,
  MatchGap,
  MatchResult,
  NormalizedJob,
  ProfileFact,
  ScoreComponent,
} from '@job-hunter/shared-types';
import { MATCH_DIMENSIONS } from '@job-hunter/shared-types';
import { annualize, canonicalSkill, containsTerm, normalizeText, tokenize } from './text.js';
import {
  extractCandidateSkills,
  extractRequirements,
  type JobRequirementProfile,
} from './requirements.js';

/** Bump when weights or formulas change so old scores stay traceable. */
export const SCORING_VERSION = '2026-11-13.1';

/** Initial weights from the plan (percentages, sum to 100). */
export const DEFAULT_WEIGHTS: Record<MatchDimension, number> = {
  skills: 30,
  experience: 25,
  role: 15,
  education: 10,
  location: 10,
  preferences: 10,
};

export interface SemanticAssessment {
  /** 0..1 similarity judgement from the AI provider. */
  score: number;
  rationale: string;
  matchedThemes: string[];
  /** Terms the AI believes are missing, grounded in the posting. */
  gaps: string[];
}

export interface ScoringInput {
  job: Pick<
    NormalizedJob,
    | 'id'
    | 'title'
    | 'company'
    | 'description'
    | 'tags'
    | 'location'
    | 'employmentType'
    | 'seniority'
    | 'salary'
    | 'postedAt'
  >;
  profile: CandidateProfileContent;
  /** Only verified facts may be passed here. Unverified facts are ignored by design. */
  verifiedFacts: ProfileFact[];
  preferences: JobPreferences;
  semantic?: SemanticAssessment | undefined;
  weights?: Partial<Record<MatchDimension, number>> | undefined;
}

export interface ScoringOutput extends MatchResult {
  requirementProfile: JobRequirementProfile;
  componentDetails: ScoreComponent[];
}

interface SkillMatchOutcome {
  score: number;
  matched: string[];
  missing: string[];
  rationale: string;
}

/** Compute per-dimension outcomes, then assemble the weighted result. */
export function scoreJob(input: ScoringInput): ScoringOutput {
  const { job, profile, preferences, semantic } = input;
  // Defence in depth: even if a caller passes unverified facts, they are ignored.
  // Only confirmed claims may ever support a score or appear as evidence.
  const verifiedFacts = input.verifiedFacts.filter((fact) => fact.verified);
  const weights = normalizeWeights({ ...DEFAULT_WEIGHTS, ...input.weights });

  const requirementProfile = extractRequirements({
    title: job.title,
    description: job.description,
    tags: job.tags,
  });

  const candidateSkills = extractCandidateSkills({
    skills: profile.skills,
    factLabels: verifiedFacts.map((fact) => fact.label),
    experienceText: verifiedFacts
      .filter((fact) => fact.kind === 'experience')
      .map((fact) => `${fact.label} ${fact.detail ?? ''}`)
      .join(' '),
  });

  const evidence: MatchEvidence[] = [];
  const gaps: MatchGap[] = [];
  const components: ScoreComponent[] = [];

  // ---------------------------------------------------------------- skills
  const skillOutcome = scoreSkills(requirementProfile.skills, candidateSkills, verifiedFacts);
  components.push(
    buildComponent('skills', weights.skills, skillOutcome.score, skillOutcome.rationale, []),
  );
  for (const skill of skillOutcome.matched) {
    const fact = verifiedFacts.find((candidate) => {
      const label = normalizeText(`${candidate.label} ${candidate.keywords.join(' ')}`);
      return label.includes(normalizeText(skill)) || label.includes(canonicalSkill(skill));
    });
    evidence.push({
      dimension: 'skills',
      ...(fact ? { factId: fact.id } : {}),
      factLabel: fact?.label ?? skill,
      requirement: skill,
      strength: fact ? 'strong' : 'moderate',
    });
  }
  for (const skill of skillOutcome.missing) {
    gaps.push({
      dimension: 'skills',
      requirement: skill,
      kind: 'missing_evidence',
      detail: `The posting mentions ${skill}, which does not appear in your verified profile.`,
    });
  }

  // ------------------------------------------------------------ experience
  const experienceOutcome = scoreExperience({
    requirementProfile,
    verifiedFacts,
    profile,
  });
  components.push(
    buildComponent(
      'experience',
      weights.experience,
      experienceOutcome.score,
      experienceOutcome.rationale,
      experienceOutcome.unknowns,
    ),
  );
  gaps.push(...experienceOutcome.gaps);

  // ------------------------------------------------------------------ role
  const roleOutcome = scoreRole(job.title, preferences, profile);
  components.push(
    buildComponent(
      'role',
      weights.role,
      roleOutcome.score,
      roleOutcome.rationale,
      roleOutcome.unknowns,
    ),
  );

  // ------------------------------------------------------------- education
  const educationOutcome = scoreEducation({ requirementProfile, profile, verifiedFacts });
  components.push(
    buildComponent(
      'education',
      weights.education,
      educationOutcome.score,
      educationOutcome.rationale,
      educationOutcome.unknowns,
    ),
  );
  if (educationOutcome.gap) gaps.push(educationOutcome.gap);

  // -------------------------------------------------------------- location
  const locationOutcome = scoreLocation({ job, preferences });
  components.push(
    buildComponent(
      'location',
      weights.location,
      locationOutcome.score,
      locationOutcome.rationale,
      locationOutcome.unknowns,
    ),
  );

  // ----------------------------------------------------------- preferences
  const preferenceOutcome = scorePreferences({ job, preferences });
  components.push(
    buildComponent(
      'preferences',
      weights.preferences,
      preferenceOutcome.score,
      preferenceOutcome.rationale,
      preferenceOutcome.unknowns,
    ),
  );
  gaps.push(...preferenceOutcome.gaps);

  // --------------------------------------------------------- semantic blend
  let usedSemantic = false;
  if (semantic) {
    usedSemantic = true;
    // Semantic comparison refines the two judgement-heavy dimensions rather
    // than replacing deterministic checks. Blend 60/40 deterministic/semantic.
    for (const dimension of ['skills', 'experience'] as const) {
      const component = components.find((item) => item.dimension === dimension);
      if (!component || component.score === null) continue;
      const blended = clamp01(component.score * 0.6 + clamp01(semantic.score) * 0.4);
      component.rationale = `${component.rationale} Semantic review: ${semantic.rationale}`;
      component.score = Number(blended.toFixed(4));
      component.points = Number((component.weight * blended).toFixed(2));
    }
    for (const theme of semantic.matchedThemes.slice(0, 6)) {
      evidence.push({
        dimension: 'experience',
        factLabel: theme,
        requirement: theme,
        strength: 'moderate',
      });
    }
    for (const gap of semantic.gaps.slice(0, 6)) {
      gaps.push({
        dimension: 'skills',
        requirement: gap,
        kind: 'missing_evidence',
        detail: 'Semantic review did not find this requirement in your verified profile.',
      });
    }
  }

  // ------------------------------------------------------------- aggregate
  // Renormalise over dimensions that could actually be scored: missing profile
  // information must never lower a score. The published breakdown then adds up
  // exactly to the final score, which is what makes it explainable.
  const known = components.filter((component) => component.score !== null);
  const totalKnownWeight = known.reduce((sum, component) => sum + component.weight, 0);

  for (const component of components) {
    if (component.score === null || totalKnownWeight === 0) {
      // Unknown dimensions carry no weight in the final score: they are neither
      // rewarded nor penalised.
      component.effectiveWeight = 0;
      component.points = 0;
      continue;
    }
    const effective = component.weight / totalKnownWeight;
    component.effectiveWeight = Number(effective.toFixed(4));
    component.points = Number((effective * component.score * 100).toFixed(2));
  }

  const rawScore = known.reduce((sum, component) => sum + component.points, 0);
  const score = Math.round(clamp(rawScore, 0, 100));

  const eligibilityFindings = gaps.length;

  return {
    jobId: job.id,
    profileVersion: buildProfileVersion(verifiedFacts, profile),
    scoringVersion: SCORING_VERSION,
    score,
    band: toBand(score),
    components,
    evidence: dedupeEvidence(evidence),
    gaps: dedupeGaps(gaps),
    excluded: false,
    computedAt: new Date().toISOString(),
    usedSemantic,
    requirementProfile,
    componentDetails: components,
    ...(eligibilityFindings === 0 ? { note: 'No gaps found against verified facts.' } : {}),
  } as ScoringOutput;
}

export function toBand(score: number): MatchResult['band'] {
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  return 'weak';
}

function buildComponent(
  dimension: MatchDimension,
  weight: number,
  score: number | null,
  rationale: string,
  unknowns: string[],
): ScoreComponent {
  const normalizedWeight = weight / 100;
  return {
    dimension,
    weight: Number(normalizedWeight.toFixed(4)),
    effectiveWeight: Number(normalizedWeight.toFixed(4)),
    score: score === null ? null : Number(score.toFixed(4)),
    points: score === null ? 0 : Number((normalizedWeight * score * 100).toFixed(2)),
    rationale,
    unknowns,
  };
}

/** Weights must sum to 1; tolerate partial overrides by renormalising. */
export function normalizeWeights(
  weights: Record<MatchDimension, number>,
): Record<MatchDimension, number> {
  const total = MATCH_DIMENSIONS.reduce((sum, dimension) => sum + (weights[dimension] ?? 0), 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  const result = {} as Record<MatchDimension, number>;
  for (const dimension of MATCH_DIMENSIONS) {
    result[dimension] = ((weights[dimension] ?? 0) / total) * 100;
  }
  return result;
}

function scoreSkills(
  required: string[],
  candidate: string[],
  verifiedFacts: ProfileFact[],
): SkillMatchOutcome {
  if (required.length === 0) {
    return {
      score: 0.5,
      matched: [],
      missing: [],
      rationale:
        'The posting does not name specific technologies or skills, so skill fit is unknown rather than assumed.',
    };
  }
  const candidateSet = new Set(candidate.map(canonicalSkill));
  const factText = normalizeText(
    verifiedFacts
      .map((fact) => `${fact.label} ${fact.keywords.join(' ')} ${fact.detail ?? ''}`)
      .join(' '),
  );

  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of required) {
    const key = canonicalSkill(skill);
    const inProfile = candidateSet.has(key) || [...candidateSet].some((item) => item.includes(key));
    const inFacts = key.length > 1 && (factText.includes(` ${key} `) || factText.includes(key));
    if (inProfile || inFacts) matched.push(skill);
    else missing.push(skill);
  }

  // Coverage ratio, but never collapse to 0 just because a posting lists many
  // "nice to have" tools: award a partial floor once half the asks are met.
  const coverage = matched.length / required.length;
  const score = coverage >= 0.5 ? 0.5 + coverage * 0.5 : coverage;
  return {
    score: clamp01(score),
    matched,
    missing,
    rationale:
      matched.length === 0
        ? `None of the ${required.length} named requirements appear in your verified profile.`
        : `You match ${matched.length} of ${required.length} named requirements (${matched
            .slice(0, 6)
            .join(', ')}${matched.length > 6 ? '…' : ''}).`,
  };
}

function scoreExperience(input: {
  requirementProfile: JobRequirementProfile;
  verifiedFacts: ProfileFact[];
  profile: CandidateProfileContent;
}): {
  score: number | null;
  rationale: string;
  unknowns: string[];
  gaps: MatchGap[];
} {
  const { requirementProfile, verifiedFacts, profile } = input;
  const experienceFacts = verifiedFacts.filter((fact) => fact.kind === 'experience');
  const unknowns: string[] = [];
  const gaps: MatchGap[] = [];

  const totalYears = estimateYears(experienceFacts, profile);
  const required = requirementProfile.yearsRequired;

  const relevantText = [
    ...experienceFacts.map(
      (fact) => `${fact.role ?? ''} ${fact.organisation ?? ''} ${fact.label} ${fact.detail ?? ''}`,
    ),
    ...profile.experience.map(
      (entry) =>
        `${entry.title} ${entry.company} ${entry.bullets.join(' ')} ${(entry.keywords ?? []).join(' ')}`,
    ),
  ].join(' ');

  const overlap = requirementProfile.skills.filter(
    (skill) =>
      containsTerm(relevantText, skill) || containsTerm(relevantText, canonicalSkill(skill)),
  );
  const overlapRatio =
    requirementProfile.skills.length > 0 ? overlap.length / requirementProfile.skills.length : null;

  if (totalYears === undefined && experienceFacts.length === 0 && profile.experience.length === 0) {
    unknowns.push(
      'No work history found in your verified profile, so experience fit cannot be judged yet.',
    );
    return {
      score: null,
      rationale: 'Experience is unknown: there is no verified work history to compare.',
      unknowns,
      gaps: [
        {
          dimension: 'experience',
          requirement: 'Work history',
          kind: 'unknown',
          detail: 'Add and verify your experience so this dimension can be scored.',
        },
      ],
    };
  }

  let score: number;
  const parts: string[] = [];

  if (required === undefined) {
    unknowns.push('The posting does not state a years-of-experience requirement.');
    score = overlapRatio === null ? 0.6 : 0.5 + overlapRatio * 0.5;
    parts.push('The posting does not state a minimum number of years.');
  } else if (totalYears === undefined) {
    unknowns.push('Your years of experience could not be calculated from the dates provided.');
    score = 0.55;
    parts.push(`The posting asks for ${required}+ years; your total experience is unknown.`);
    gaps.push({
      dimension: 'experience',
      requirement: `${required}+ years experience`,
      kind: 'unknown',
      detail: 'Add start/end dates to your experience entries so tenure can be calculated.',
    });
  } else {
    const ratio = required === 0 ? 1 : Math.min(totalYears / required, 1);
    score = 0.4 + ratio * 0.6;
    parts.push(
      `The posting asks for ${required}+ years; your verified history spans about ${totalYears} year${
        totalYears === 1 ? '' : 's'
      }.`,
    );
    if (ratio < 1) {
      gaps.push({
        dimension: 'experience',
        requirement: `${required}+ years experience`,
        kind: 'missing_evidence',
        detail: `Your verified history shows about ${totalYears} years against the requested ${required}.`,
      });
    }
  }

  if (overlapRatio !== null && requirementProfile.skills.length > 0) {
    const adjusted = score * 0.75 + (0.5 + overlapRatio * 0.5) * 0.25;
    score = adjusted;
    parts.push(
      `${overlap.length} of ${requirementProfile.skills.length} named skills appear in your work history.`,
    );
  }

  return { score: clamp01(score), rationale: parts.join(' '), unknowns, gaps };
}

/** Estimate total professional years from verified experience facts. */
export function estimateYears(
  experienceFacts: ProfileFact[],
  profile: CandidateProfileContent,
): number | undefined {
  const now = new Date();
  const nowMonths = now.getUTCFullYear() * 12 + now.getUTCMonth();

  let earliest: number | undefined;
  const ranges: Array<{ start: number | undefined; end: number | undefined }> = [];

  for (const fact of experienceFacts) {
    const start = parseMonth(fact.startDate);
    const end = parseMonth(fact.endDate) ?? (start !== undefined ? nowMonths : undefined);
    ranges.push({ start, end });
    if (start !== undefined && (earliest === undefined || start < earliest)) earliest = start;
  }

  for (const entry of profile.experience) {
    const start = parseMonth(entry.startDate);
    const end = entry.current
      ? nowMonths
      : (parseMonth(entry.endDate) ?? (start !== undefined ? nowMonths : undefined));
    ranges.push({ start, end });
    if (start !== undefined && (earliest === undefined || start < earliest)) earliest = start;
  }

  const withDates = ranges.filter((range) => range.start !== undefined && range.end !== undefined);
  if (withDates.length === 0) return undefined;

  // Sum of non-overlapping tenures: merge intervals then total their length.
  const intervals = withDates
    .map((range) => ({
      start: range.start as number,
      end: Math.max(range.start as number, range.end as number),
    }))
    .filter((interval) => interval.end >= interval.start)
    .sort((a, b) => a.start - b.start);

  let totalMonths = 0;
  let currentStart = intervals[0]?.start;
  let currentEnd = intervals[0]?.end;
  for (const interval of intervals.slice(1)) {
    if (currentEnd !== undefined && interval.start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else if (currentStart !== undefined && currentEnd !== undefined) {
      totalMonths += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  if (currentStart !== undefined && currentEnd !== undefined) {
    totalMonths += currentEnd - currentStart;
  }

  const years = totalMonths / 12;
  return Math.max(0, Math.round(years * 10) / 10);
}

function parseMonth(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})/);
  if (!match) return undefined;
  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12)
    return undefined;
  return year * 12 + (month - 1);
}

function scoreRole(
  title: string,
  preferences: JobPreferences,
  profile: CandidateProfileContent,
): { score: number | null; rationale: string; unknowns: string[] } {
  const targets = preferences.targetTitles.filter((target) => target.trim().length > 0);
  const headline = profile.headline ?? '';
  const unknowns: string[] = [];

  if (targets.length === 0) {
    unknowns.push('You have not set target job titles yet.');
    if (!headline) {
      return {
        score: null,
        rationale: 'Role alignment is unknown: no target titles or headline to compare.',
        unknowns,
      };
    }
  }

  const jobTitleTokens = new Set(tokenize(title));
  let best = 0;
  for (const target of [...targets, headline].filter(Boolean)) {
    const targetTokens = tokenize(target);
    if (targetTokens.length === 0) continue;
    const intersection = targetTokens.filter((token) => jobTitleTokens.has(token)).length;
    best = Math.max(best, intersection / targetTokens.length);
  }

  if (targets.length === 0) {
    return {
      score: best > 0 ? 0.5 + best * 0.5 : 0.4,
      rationale:
        best > 0
          ? `The job title overlaps with your headline "${headline}".`
          : 'The job title shows limited overlap with your headline; set target titles for a sharper comparison.',
      unknowns,
    };
  }

  return {
    score: best === 0 ? 0.2 : 0.4 + best * 0.6,
    rationale:
      best === 0
        ? `"${title}" does not overlap with any of your target titles.`
        : `"${title}" overlaps with your target titles (${Math.round(best * 100)}% of the target's key words).`,
    unknowns,
  };
}

function scoreEducation(input: {
  requirementProfile: JobRequirementProfile;
  profile: CandidateProfileContent;
  verifiedFacts: ProfileFact[];
}): { score: number | null; rationale: string; unknowns: string[]; gap?: MatchGap } {
  const { requirementProfile, profile, verifiedFacts } = input;
  const hasEducation = profile.education.length > 0;
  const educationFacts = verifiedFacts.filter((fact) => fact.kind === 'education');
  const unknowns: string[] = [];

  if (!requirementProfile.educationHint && requirementProfile.certifications.length === 0) {
    return {
      score: hasEducation || educationFacts.length > 0 ? 0.75 : 0.6,
      rationale:
        'The posting names no specific education or certification requirement, so only presence of education is considered.',
      unknowns: ['No education requirement stated in the posting.'],
    };
  }

  if (!hasEducation && educationFacts.length === 0) {
    unknowns.push('No verified education entries found in your profile.');
    return {
      score: null,
      rationale: 'Education fit is unknown: your profile has no verified education yet.',
      unknowns,
      gap: {
        dimension: 'education',
        requirement: requirementProfile.educationHint ?? 'Education',
        kind: 'unknown',
        detail: 'Add and verify your education to compare against this posting.',
      },
    };
  }

  const levelRank = (level: string | undefined): number => {
    switch (level) {
      case 'phd':
        return 4;
      case 'master':
        return 3;
      case 'bachelor':
        return 2;
      case 'associate':
        return 1;
      case 'degree':
        return 2;
      default:
        return 0;
    }
  };

  const candidateText = normalizeText(
    [
      ...profile.education.map((entry) => `${entry.degree ?? ''} ${entry.field ?? ''}`),
      ...educationFacts.map((fact) => fact.label),
    ].join(' '),
  );
  const candidateLevel = /\bphd\b|doctorate/.test(candidateText)
    ? 'phd'
    : /\bmaster|\bmsc|\bmba/.test(candidateText)
      ? 'master'
      : /\bbachelor|\bbsc|\bb\.?s\.?|\bundergraduate|\bdegree/.test(candidateText)
        ? 'bachelor'
        : /\bassociate|\bdiploma|\bhnd/.test(candidateText)
          ? 'associate'
          : undefined;

  const requiredLevel = levelRank(requirementProfile.educationHint);
  const candidateRank = levelRank(candidateLevel);
  const met = requiredLevel === 0 || candidateRank >= requiredLevel;

  const certText = normalizeText(
    [
      ...profile.certifications.map((cert) => cert.name),
      ...verifiedFacts.filter((f) => f.kind === 'certification').map((f) => f.label),
    ].join(' '),
  );
  const certMatches = requirementProfile.certifications.filter((cert) =>
    certText.includes(normalizeText(cert)),
  );
  const certMissing = requirementProfile.certifications.filter(
    (cert) => !certText.includes(normalizeText(cert)),
  );

  let score = met ? (requiredLevel === 0 ? 0.8 : 1) : 0.5;
  if (requirementProfile.certifications.length > 0) {
    const certRatio = certMatches.length / requirementProfile.certifications.length;
    score = score * 0.7 + (0.4 + certRatio * 0.6) * 0.3;
  }

  const parts: string[] = [];
  if (requiredLevel > 0) {
    parts.push(
      met
        ? `Your verified education meets the posted ${requirementProfile.educationHint}-level expectation.`
        : `The posting expects ${requirementProfile.educationHint}-level education; yours is recorded as ${candidateLevel ?? 'unclear'}.`,
    );
  } else {
    parts.push('The posting states no specific education level.');
  }
  if (requirementProfile.certifications.length > 0) {
    parts.push(
      certMatches.length > 0
        ? `${certMatches.length} of ${requirementProfile.certifications.length} named certifications are on your profile.`
        : 'None of the named certifications appear on your profile.',
    );
  }

  const gap: MatchGap | undefined =
    certMissing.length > 0
      ? {
          dimension: 'education',
          requirement: certMissing[0] as string,
          kind: 'missing_evidence',
          detail: `Named certification(s) not on your profile: ${certMissing.join(', ')}.`,
        }
      : !met
        ? {
            dimension: 'education',
            requirement: requirementProfile.educationHint ?? 'Education',
            kind: 'missing_evidence',
            detail: `Posting expects ${requirementProfile.educationHint}-level education.`,
          }
        : undefined;

  return { score: clamp01(score), rationale: parts.join(' '), unknowns, ...(gap ? { gap } : {}) };
}

function scoreLocation(input: {
  job: Pick<NormalizedJob, 'location' | 'salary'>;
  preferences: JobPreferences;
}): { score: number | null; rationale: string; unknowns: string[] } {
  const { job, preferences } = input;
  const { location } = job;
  const unknowns: string[] = [];
  const workplace = location.workplace ?? (location.remote ? 'remote' : 'unknown');

  if (
    preferences.locations.length === 0 &&
    preferences.countryCodes.length === 0 &&
    !preferences.remoteOnly
  ) {
    unknowns.push('You have not set location preferences, so location fit is not a constraint.');
    return {
      score: null,
      rationale: 'No location preferences set: location does not reduce your score.',
      unknowns,
    };
  }

  if (workplace === 'remote') {
    // Remote listings satisfy almost every location preference set.
    return {
      score: 1,
      rationale: 'The listing states remote eligibility, which matches a remote-friendly search.',
      unknowns: [],
    };
  }

  if (!location.countryCode && preferences.locations.length === 0) {
    return {
      score: null,
      rationale: 'The listing location is unknown, so location fit cannot be judged.',
      unknowns: ['Job location could not be resolved.'],
    };
  }

  const countryOk =
    preferences.countryCodes.length === 0 ||
    (location.countryCode
      ? preferences.countryCodes.includes(location.countryCode.toUpperCase())
      : true);

  const locationText = normalizeText(
    location.raw ?? [location.city, location.region, location.country].filter(Boolean).join(' '),
  );
  const cityOk =
    preferences.locations.length === 0 ||
    preferences.locations.some((pref) => {
      const needle = normalizeText(pref);
      return needle.length > 0 && (locationText.includes(needle) || needle.includes(locationText));
    });

  if (countryOk && cityOk) {
    return {
      score: 0.95,
      rationale: 'The listing location matches your selected locations.',
      unknowns: [],
    };
  }
  if (countryOk) {
    return {
      score: 0.7,
      rationale: 'The listing is in a country you accept but not one of your preferred cities.',
      unknowns: [],
    };
  }
  return {
    score: 0.15,
    rationale: `The listing is located in ${location.country ?? location.raw ?? 'an unknown country'}, outside your selected countries.`,
    unknowns: [],
  };
}

function scorePreferences(input: {
  job: Pick<NormalizedJob, 'employmentType' | 'seniority' | 'salary'>;
  preferences: JobPreferences;
}): { score: number | null; rationale: string; unknowns: string[]; gaps: MatchGap[] } {
  const { job, preferences } = input;
  const unknowns: string[] = [];
  const gaps: MatchGap[] = [];
  const parts: string[] = [];
  const scores: number[] = [];

  if (preferences.employmentTypes.length > 0 && job.employmentType !== 'unknown') {
    scores.push(preferences.employmentTypes.includes(job.employmentType) ? 1 : 0.2);
    parts.push(
      preferences.employmentTypes.includes(job.employmentType)
        ? 'Employment type matches your selection.'
        : `Employment type "${job.employmentType.replace('_', ' ')}" is outside your selection.`,
    );
  } else if (job.employmentType === 'unknown') {
    unknowns.push('The posting does not state an employment type.');
  }

  if (preferences.seniorityLevels.length > 0 && job.seniority !== 'unknown') {
    scores.push(preferences.seniorityLevels.includes(job.seniority) ? 1 : 0.3);
    parts.push(
      preferences.seniorityLevels.includes(job.seniority)
        ? `Seniority "${job.seniority}" matches your selection.`
        : `Seniority "${job.seniority}" is outside your selection.`,
    );
  } else if (job.seniority === 'unknown') {
    unknowns.push('The posting does not state a seniority level.');
  }

  if (preferences.minSalary !== undefined) {
    const salaryMin = job.salary?.min
      ? annualize(job.salary.min, job.salary.period === 'unknown' ? 'year' : job.salary.period)
      : undefined;
    if (salaryMin === undefined) {
      unknowns.push('The posting does not list a salary.');
    } else {
      const meets = salaryMin >= preferences.minSalary;
      scores.push(meets ? 1 : 0.2);
      parts.push(
        meets
          ? 'The listed salary meets your minimum.'
          : 'The listed salary starts below your minimum.',
      );
      if (!meets) {
        gaps.push({
          dimension: 'preferences',
          requirement: `Minimum salary ${preferences.minSalary.toLocaleString()}`,
          kind: 'missing_evidence',
          detail: 'The advertised range starts below your stated minimum.',
        });
      }
    }
  }

  if (scores.length === 0) {
    return {
      score: null,
      rationale:
        'No employment-type, seniority or salary preferences set, so this dimension is not constrained.',
      unknowns,
      gaps,
    };
  }

  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return { score: clamp01(average), rationale: parts.join(' '), unknowns, gaps };
}

function dedupeEvidence(evidence: MatchEvidence[]): MatchEvidence[] {
  const seen = new Set<string>();
  const result: MatchEvidence[] = [];
  for (const item of evidence) {
    const key = `${item.dimension}:${item.requirement.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function dedupeGaps(gaps: MatchGap[]): MatchGap[] {
  const seen = new Set<string>();
  const result: MatchGap[] = [];
  for (const item of gaps) {
    const key = `${item.dimension}:${item.requirement.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function buildProfileVersion(
  facts: ProfileFact[],
  profile: CandidateProfileContent,
): string {
  const payload = JSON.stringify({
    facts: facts
      .map((fact) => [fact.id, fact.label, fact.verified, fact.updatedAt])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    skills: [...profile.skills].sort(),
    experience: profile.experience.map((entry) => [
      entry.company,
      entry.title,
      entry.startDate,
      entry.endDate,
    ]),
  });
  return `pf_${hashString(payload)}`;
}

/** Small, stable non-cryptographic hash (FNV-1a) for version stamps. */
export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
