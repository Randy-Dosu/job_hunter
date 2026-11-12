import { clamp, overlap, titleSimilarity, tokenSet } from "@/lib/text";
import { canonicalSkill, extractRequirements, skillLabel, type Requirement } from "./requirements";

export type Preferences = {
  countries: string[];
  cities: string[];
  remotePreference: string; // remote | hybrid | onsite | any
  remoteRegions: string[];
  roleTitles: string[];
  roleFamilies: string[];
  seniority: string[];
  jobTypes: string[];
  industries: string[];
  excludedEmployers: string[];
  excludedKeywords: string[];
  excludedLocations: string[];
  salaryFloor: number | null;
  currency: string;
  workAuthorization: string;
  needsSponsorship: boolean;
};

export type EvidenceFact = {
  id: string;
  factType: string;
  title: string;
  organization: string;
  location: string;
  startDate: string | null;
  endDate: string | null;
  bullets: string[];
  skills: string[];
  state: string; // professional | learning | none (skills only)
  verificationStatus: string;
  evidenceNote: string;
};

export type ProfileSnapshot = {
  headline: string;
  summary: string;
  location: string;
  workAuthorization: string;
  facts: EvidenceFact[];
  yearsExperience: number;
  educationLevel: string | null;
};

export type ScoreComponent = {
  key: string;
  label: string;
  weight: number;
  score: number; // 0..1
  points: number;
  confidence: number; // 0..1
  note: string;
};

export type MatchReason = { dimension: string; text: string; strength: "strong" | "supporting" | "warning" };

export type MatchGap = {
  kind: "skill" | "seniority" | "location" | "authorization" | "salary" | "education" | "status" | "other";
  text: string;
  required: boolean;
};

export type HardFilter = { code: string; label: string };

export type MatchResult = {
  score: number;
  confidence: number;
  verdict: "strong" | "possible" | "low" | "excluded";
  reasons: MatchReason[];
  gaps: MatchGap[];
  components: ScoreComponent[];
  requirements: { required: Requirement[]; preferred: Requirement[] };
  missingRequired: string[];
  hardFilters: HardFilter[];
  matchedSkills: string[];
  redFlags: string[];
};

export type MatchableJob = {
  title: string;
  company: string;
  location: string;
  remotePolicy: string;
  description: string;
  salary: string | null;
  employmentType: string;
  seniority: string;
  postedAt: string | null;
  deadline: string | null;
  status: string;
};

/** Soft skills are useful signal but never count as a hard qualification gap. */
const SOFT_SKILLS = new Set(["communication", "leadership", "agile"]);

const WEIGHTS = {
  role: 20,
  skills: 25,
  seniority: 15,
  location: 15,
  education: 10,
  salary: 5,
  industry: 5,
  freshness: 5,
} as const;

const SENIORITY_YEARS: Record<string, number> = {
  internship: 0,
  entry: 0,
  graduate: 0,
  junior: 1,
  mid: 2.5,
  senior: 5,
  lead: 7,
  staff: 9,
  unknown: 0,
};

const SENIORITY_LABEL: Record<string, string> = {
  internship: "Internship",
  entry: "Entry level",
  graduate: "Graduate",
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  staff: "Staff",
  unknown: "Unspecified level",
};

const EDUCATION_RANK: Record<string, number> = {
  "High school": 1,
  Diploma: 2,
  "Bachelor's": 3,
  "Master's": 4,
  PhD: 5,
};

export function totalYearsExperience(facts: EvidenceFact[]): number {
  let months = 0;
  for (const fact of facts) {
    if (fact.factType !== "experience" || !fact.startDate) continue;
    const start = new Date(fact.startDate);
    const end = fact.endDate ? new Date(fact.endDate) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const diff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    if (diff > 0) months += Math.min(diff, 240);
  }
  return Math.round((months / 12) * 10) / 10;
}

export function verifiedSkills(facts: EvidenceFact[]): Map<string, number> {
  const skills = new Map<string, number>();
  for (const fact of facts) {
    if (fact.verificationStatus !== "verified") continue;
    if (fact.factType !== "skill") continue;
    const weight = fact.state === "professional" ? 1 : fact.state === "learning" ? 0.35 : 0.6;
    const key = canonicalSkill(fact.title) ?? fact.title.toLowerCase().trim();
    if (!key) continue;
    skills.set(key, Math.max(skills.get(key) ?? 0, weight));
  }
  return skills;
}

export function highestEducation(facts: EvidenceFact[]): string | null {
  let best: string | null = null;
  for (const fact of facts) {
    if (fact.factType !== "education" || fact.verificationStatus !== "verified") continue;
    const text = `${fact.title} ${fact.bullets.join(" ")}`;
    const level = /phd|doctorate/i.test(text)
      ? "PhD"
      : /master|msc|mba/i.test(text)
        ? "Master's"
        : /bachelor|bsc|ba\b|degree/i.test(text)
          ? "Bachelor's"
          : /diploma|hnd/i.test(text)
            ? "Diploma"
            : null;
    if (level && (!best || EDUCATION_RANK[level] > EDUCATION_RANK[best])) best = level;
  }
  return best;
}

function parseSalary(text: string | null): { min: number | null; max: number | null; currency: string } {
  if (!text) return { min: null, max: null, currency: "USD" };
  const currency = /£/.test(text) ? "GBP" : /€/.test(text) ? "EUR" : /₵|ghs/i.test(text) ? "GHS" : "USD";
  const numbers = [...text.matchAll(/(\d[\d,.]*)/g)]
    .map((m) => Number(m[1].replace(/[,]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 100)
    .map((n) => (n < 1000 ? n * 1000 : n)); // handle "45k" style values already stripped elsewhere
  if (!numbers.length) return { min: null, max: null, currency };
  return { min: numbers[0], max: numbers[numbers.length - 1], currency };
}

function locationScore(job: MatchableJob, prefs: Preferences): { score: number; confidence: number; note: string } {
  const loc = `${job.location} ${job.description.slice(0, 500)}`.toLowerCase();
  const worldwide = /worldwide|anywhere|global|remote \(global\)/.test(loc);
  const policy = job.remotePolicy;

  if (prefs.remotePreference === "remote" && policy === "onsite") {
    return { score: 0, confidence: 1, note: "On-site role, but you require remote work" };
  }
  if (prefs.remotePreference === "any" || policy === "unknown") {
    return { score: 0.6, confidence: 0.4, note: "Location policy not stated in the listing" };
  }

  const countryHit = [...prefs.countries, ...prefs.remoteRegions, ...prefs.cities].some((place) => {
    const token = place.toLowerCase();
    return token.length > 2 && loc.includes(token);
  });

  if (worldwide) {
    return prefs.remoteRegions.some((r) => /worldwide|global/i.test(r))
      ? { score: 1, confidence: 1, note: "Remote worldwide — eligible from your location" }
      : { score: 0.75, confidence: 0.7, note: "Remote worldwide; confirm your region is acceptable" };
  }
  if (countryHit) return { score: 1, confidence: 1, note: "Location falls inside your selected market" };
  if (prefs.remoteRegions.length === 0 && prefs.countries.length === 0) {
    return { score: 0.7, confidence: 0.4, note: "No location preference set" };
  }
  return {
    score: 0.35,
    confidence: 0.8,
    note: `Listing is restricted to "${job.location}", outside your selected locations`,
  };
}

/**
 * Transparent weighted score (PRD §7.1). Deterministic: no LLM decides
 * whether a user has a skill. Missing data lowers confidence instead of
 * being counted as a match.
 */
export function scoreJob(job: MatchableJob, prefs: Preferences, profile: ProfileSnapshot): MatchResult {
  const requirements = extractRequirements(job.description, job.title);
  const skills = verifiedSkills(profile.facts);
  const hardFilters: HardFilter[] = [];
  const gaps: MatchGap[] = [];
  const reasons: MatchReason[] = [];
  const components: ScoreComponent[] = [];
  const haystack = `${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase();

  // --- hard filters -------------------------------------------------------
  if (job.status === "closed") {
    hardFilters.push({ code: "closed", label: "This vacancy is confirmed closed" });
  }
  for (const employer of prefs.excludedEmployers) {
    if (employer && job.company.toLowerCase().includes(employer.toLowerCase())) {
      hardFilters.push({ code: "excluded_employer", label: `You excluded ${employer}` });
    }
  }
  for (const keyword of prefs.excludedKeywords) {
    if (keyword && haystack.includes(keyword.toLowerCase())) {
      hardFilters.push({ code: "excluded_keyword", label: `Listing contains your excluded keyword "${keyword}"` });
    }
  }
  for (const place of prefs.excludedLocations) {
    if (place && job.location.toLowerCase().includes(place.toLowerCase())) {
      hardFilters.push({ code: "excluded_location", label: `Location "${job.location}" is on your exclusion list` });
    }
  }
  if (prefs.remotePreference === "remote" && job.remotePolicy === "onsite") {
    hardFilters.push({ code: "onsite", label: "On-site role, but your preference is remote-only" });
  }
  if (prefs.needsSponsorship && requirements.sponsorshipOffered === false) {
    hardFilters.push({ code: "no_sponsorship", label: "Employer states it cannot sponsor a work visa" });
  }

  // --- role relevance -----------------------------------------------------
  const targets = [...prefs.roleTitles, ...prefs.roleFamilies].filter(Boolean);
  const roleSim = targets.length
    ? Math.max(...targets.map((role) => titleSimilarity(role, job.title)))
    : Math.max(titleSimilarity(profile.headline, job.title), 0.4);
  const roleConfidence = targets.length ? 1 : 0.3;
  components.push({
    key: "role",
    label: "Role & title relevance",
    weight: WEIGHTS.role,
    score: roleSim,
    points: roleSim * WEIGHTS.role,
    confidence: roleConfidence,
    note: targets.length
      ? `Closest target title: “${targets.reduce((best, r) => (titleSimilarity(r, job.title) > titleSimilarity(best, job.title) ? r : best), targets[0])}”`
      : "No target titles configured; compared against your headline",
  });
  if (roleSim >= 0.75) reasons.push({ dimension: "role", text: `Title closely matches your target roles: ${job.title}`, strength: "strong" });
  else if (roleSim >= 0.4) reasons.push({ dimension: "role", text: `Adjacent to your target roles (${job.title})`, strength: "supporting" });
  else if (targets.length) gaps.push({ kind: "other", text: "Job title is outside your stated role families", required: false });

  // --- required skills ----------------------------------------------------
  const allSkills = [...requirements.required, ...requirements.preferred];
  let matchedPoints = 0;
  let possiblePoints = 0;
  const matchedSkills: string[] = [];
  const missingRequired: string[] = [];
  for (const req of allSkills) {
    const weight = req.required ? 1 : 0.4;
    possiblePoints += weight;
    const held = skills.get(req.skill);
    if (held !== undefined) {
      matchedPoints += weight * held;
      matchedSkills.push(req.skill);
    } else if (req.required && !SOFT_SKILLS.has(req.skill)) {
      missingRequired.push(req.skill);
    }
  }
  const skillScore = allSkills.length ? (possiblePoints ? matchedPoints / possiblePoints : 0) : 0.5;
  const skillConfidence = allSkills.length ? 1 : 0.2;
  components.push({
    key: "skills",
    label: "Required skills",
    weight: WEIGHTS.skills,
    score: skillScore,
    points: skillScore * WEIGHTS.skills,
    confidence: skillConfidence,
    note: allSkills.length
      ? `${matchedSkills.filter((s) => requirements.required.some((r) => r.skill === s)).length}/${requirements.required.length} required skills evidenced`
      : "No specific skills detectable in the listing",
  });
  if (matchedSkills.length) {
    reasons.push({
      dimension: "skills",
      text: `Your verified skills cover ${matchedSkills.slice(0, 6).map(skillLabel).join(", ")}${
        matchedSkills.length > 6 ? ` and ${matchedSkills.length - 6} more` : ""
      }`,
      strength: missingRequired.length ? "supporting" : "strong",
    });
  }
  for (const skill of missingRequired) {
    gaps.push({ kind: "skill", text: `Requires ${skillLabel(skill)} — no verified evidence in your profile`, required: true });
  }
  const learningRequired = requirements.required.filter((req) => {
    const held = skills.get(req.skill);
    return held !== undefined && held < 1;
  });
  if (learningRequired.length) {
    reasons.push({
      dimension: "skills",
      text: "Some requested skills appear in your profile as “learning”, not professional experience",
      strength: "warning",
    });
  }

  // --- seniority / experience --------------------------------------------
  const requiredYears = requirements.requiredYears ?? SENIORITY_YEARS[job.seniority] ?? 0;
  const years = profile.yearsExperience;
  let seniorityScore: number;
  if (requiredYears <= 0) seniorityScore = 1;
  else if (years >= requiredYears) seniorityScore = 1;
  else seniorityScore = clamp(years / requiredYears, 0.15, 0.95);
  if (prefs.seniority.length && job.seniority !== "unknown" && !prefs.seniority.includes(job.seniority)) {
    seniorityScore *= 0.7;
    gaps.push({
      kind: "seniority",
      text: `Listing is ${SENIORITY_LABEL[job.seniority] ?? job.seniority}, outside your selected seniority levels`,
      required: false,
    });
  }
  components.push({
    key: "seniority",
    label: "Seniority & experience",
    weight: WEIGHTS.seniority,
    score: seniorityScore,
    points: seniorityScore * WEIGHTS.seniority,
    confidence: job.seniority === "unknown" && !requirements.requiredYears ? 0.4 : 1,
    note:
      requiredYears > 0
        ? `Asks for ~${requiredYears} yr${requiredYears === 1 ? "" : "s"}; your verified experience is ${years} yr${years === 1 ? "" : "s"}`
        : "No explicit experience requirement",
  });
  if (requiredYears > 0 && years < requiredYears) {
    gaps.push({
      kind: "seniority",
      text: `Employer asks for ${requiredYears}+ years of experience; your verified history covers ${years}`,
      required: false,
    });
  } else if (requiredYears > 0) {
    reasons.push({ dimension: "seniority", text: `You meet the experience bar (${years} yrs vs ${requiredYears}+ requested)`, strength: "strong" });
  }

  // --- location -----------------------------------------------------------
  const location = locationScore(job, prefs);
  components.push({
    key: "location",
    label: "Location / remote eligibility",
    weight: WEIGHTS.location,
    score: location.score,
    points: location.score * WEIGHTS.location,
    confidence: location.confidence,
    note: location.note,
  });
  if (location.score >= 0.9) reasons.push({ dimension: "location", text: location.note, strength: "strong" });
  else if (location.score < 0.5) gaps.push({ kind: "location", text: location.note, required: false });

  // --- education ----------------------------------------------------------
  const userEducation = profile.educationLevel;
  let educationScore = 0.7;
  let educationConfidence = 0.3;
  let educationNote = "No education requirement stated";
  if (requirements.educationLevel) {
    if (!userEducation) {
      educationScore = 0.35;
      educationConfidence = 0.9;
      educationNote = `Asks for ${requirements.educationLevel}; no verified education in your profile`;
      gaps.push({ kind: "education", text: `Requires ${requirements.educationLevel}`, required: true });
    } else if (EDUCATION_RANK[userEducation] >= EDUCATION_RANK[requirements.educationLevel]) {
      educationScore = 1;
      educationConfidence = 1;
      educationNote = `Your ${userEducation} meets the requested ${requirements.educationLevel}`;
      reasons.push({ dimension: "education", text: educationNote, strength: "supporting" });
    } else {
      educationScore = 0.4;
      educationConfidence = 1;
      educationNote = `Asks for ${requirements.educationLevel}; your highest verified level is ${userEducation}`;
      gaps.push({ kind: "education", text: `Requires ${requirements.educationLevel}`, required: true });
    }
  }
  components.push({
    key: "education",
    label: "Education & certifications",
    weight: WEIGHTS.education,
    score: educationScore,
    points: educationScore * WEIGHTS.education,
    confidence: educationConfidence,
    note: educationNote,
  });

  // --- salary & employment type ------------------------------------------
  const salary = parseSalary(job.salary);
  let salaryScore = 0.65;
  let salaryConfidence = 0.25;
 let salaryNote = "Salary not disclosed — confirm before applying";
  if (salary.min !== null && prefs.salaryFloor) {
    const sameCurrency = salary.currency === prefs.currency;
    if (!sameCurrency) {
      salaryScore = 0.6;
      salaryConfidence = 0.4;
      salaryNote = `Salary is in ${salary.currency}; your floor is in ${prefs.currency}`;
    } else if (salary.max !== null && salary.max < prefs.salaryFloor) {
      salaryScore = 0.15;
      salaryConfidence = 1;
      salaryNote = `Top of range is below your ${prefs.currency} ${prefs.salaryFloor.toLocaleString()} floor`;
      gaps.push({ kind: "salary", text: salaryNote, required: false });
    } else {
      salaryScore = 1;
      salaryConfidence = 1;
      salaryNote = "Salary range meets your floor";
    }
  } else if (salary.min !== null) {
    salaryScore = 0.8;
    salaryConfidence = 0.5;
    salaryNote = "Salary stated; no personal floor configured";
  }
  if (prefs.jobTypes.length && job.employmentType !== "unknown" && !prefs.jobTypes.includes(job.employmentType)) {
    salaryScore *= 0.5;
    salaryConfidence = Math.max(salaryConfidence, 0.9);
    gaps.push({
      kind: "other",
      text: `${job.employmentType} role is outside your selected job types`,
      required: false,
    });
  }
  components.push({
    key: "salary",
    label: "Salary & employment preferences",
    weight: WEIGHTS.salary,
    score: salaryScore,
    points: salaryScore * WEIGHTS.salary,
    confidence: salaryConfidence,
    note: salaryNote,
  });

  // --- industry -----------------------------------------------------------
  const industryHit = prefs.industries.find((industry) => {
    const metric = overlap(tokenSet(industry), tokenSet(`${job.company} ${job.description.slice(0, 1200)}`));
    return metric >= 0.4;
  });
  const industryScore = prefs.industries.length ? (industryHit ? 1 : 0.4) : 0.6;
  components.push({
    key: "industry",
    label: "Industry & company fit",
    weight: WEIGHTS.industry,
    score: industryScore,
    points: industryScore * WEIGHTS.industry,
    confidence: prefs.industries.length ? 0.7 : 0.2,
    note: prefs.industries.length
      ? industryHit
        ? `Matches your industry preference: ${industryHit}`
        : "Company description does not clearly match your industries"
      : "No industry preference set",
  });
  if (industryHit) reasons.push({ dimension: "industry", text: `Industry fit: ${industryHit}`, strength: "supporting" });

  // --- freshness ----------------------------------------------------------
  let freshnessScore = 0.6;
  let freshnessNote = "Posting date unknown";
  const posted = job.postedAt ? new Date(job.postedAt).getTime() : null;
  if (posted && !Number.isNaN(posted)) {
    const days = Math.floor((Date.now() - posted) / 86_400_000);
    freshnessScore = days <= 7 ? 1 : days <= 14 ? 0.9 : days <= 30 ? 0.7 : 0.45;
    freshnessNote = `Posted ${days <= 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`;
  }
  if (job.deadline) {
    const deadline = new Date(job.deadline).getTime();
    const daysLeft = Math.ceil((deadline - Date.now()) / 86_400_000);
    if (daysLeft < 0) freshnessScore = 0;
    else if (daysLeft <= 5) {
      freshnessNote += ` · closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
      reasons.push({ dimension: "deadline", text: `Deadline approaching: ${new Date(job.deadline).toLocaleDateString("en-GB")}`, strength: "warning" });
    }
  }
  components.push({
    key: "freshness",
    label: "Posting freshness & deadline",
    weight: WEIGHTS.freshness,
    score: freshnessScore,
    points: freshnessScore * WEIGHTS.freshness,
    confidence: posted ? 1 : 0.3,
    note: freshnessNote,
  });

  // --- aggregate ----------------------------------------------------------
  const rawScore = components.reduce((sum, c) => sum + c.points, 0);
  const score = Math.round(clamp(rawScore, 0, 100));
  const confidence = Math.round(
    (components.reduce((sum, c) => sum + c.weight * c.confidence, 0) / Object.values(WEIGHTS).reduce((a, b) => a + b, 0)) * 100,
  );

  const hardRequirements = requirements.required.filter((req) => !SOFT_SKILLS.has(req.skill));
  const requiredCoverage = hardRequirements.length
    ? hardRequirements.filter((req) => skills.has(req.skill)).length / hardRequirements.length
    : 1;

  let verdict: MatchResult["verdict"];
  if (hardFilters.length) verdict = "excluded";
  else if (score >= 75 && requiredCoverage >= 0.6) verdict = "strong";
  else if (score >= 55) verdict = "possible";
  else verdict = "low";

  if (requirements.redFlags.length) {
    reasons.push({
      dimension: "safety",
      text: `Listing shows warning signs: ${requirements.redFlags.join("; ")}`,
      strength: "warning",
    });
  }

  return {
    score,
    confidence,
    verdict,
    reasons,
    gaps,
    components,
    requirements: { required: requirements.required, preferred: requirements.preferred },
    missingRequired,
    hardFilters,
    matchedSkills,
    redFlags: requirements.redFlags,
  };
}
