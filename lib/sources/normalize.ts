import {
  canonicalUrl,
  cleanLine,
  contentHash,
  fingerprint,
  htmlToText,
  tokenize,
} from "@/lib/text";
import type { NormalizedJob, RemotePolicy, SearchCriteria } from "./types";

const DAY = 86_400_000;

export function inferRemotePolicy(location: string, remoteFlag: boolean, text = ""): RemotePolicy {
  const haystack = `${location} ${text.slice(0, 600)}`.toLowerCase();
  if (/hybrid/.test(haystack)) return "hybrid";
  // Explicit on-site wording outranks a board's blanket "remote" flag.
  if (/on-?site|in-?office|in person|office five days|office \d days/.test(haystack)) return "onsite";
  if (remoteFlag) return "remote";
  if (/remote|work from home|distributed|anywhere/.test(haystack)) return "remote";
  return "unknown";
}

export function inferEmploymentType(raw: string | string[] | undefined, title = ""): string {
  const text = `${Array.isArray(raw) ? raw.join(" ") : (raw ?? "")} ${title}`.toLowerCase();
  if (/intern|internship|placement/.test(text)) return "internship";
  if (/graduate|grad scheme|trainee/.test(text)) return "graduate";
  if (/part[- ]?time/.test(text)) return "part-time";
  if (/contract|freelance|temporary/.test(text)) return "contract";
  if (/full[- ]?time/.test(text)) return "full-time";
  return "unknown";
}

export function inferSeniority(title: string, description = ""): string {
  const text = `${title} ${description.slice(0, 300)}`.toLowerCase();
  if (/intern|internship/.test(text)) return "internship";
  if (/graduate|entry[- ]level|trainee/.test(text)) return "entry";
  if (/junior|jr\b/.test(text)) return "junior";
  if (/principal|staff engineer|distinguished/.test(text)) return "staff";
  if (/lead|head of/.test(text)) return "lead";
  if (/senior|sr\b/.test(text)) return "senior";
  if (/mid[- ]level|intermediate/.test(text)) return "mid";
  return "unknown";
}

const HEADING = /^(responsibilities|what you.ll do|the role|about the role|requirements|what we.re looking for|qualifications|you.ll need|requirements & skills|must have|about you)[:.]?$/i;

/** Pull responsibility / requirement blocks out of a description when headings exist. */
export function splitSections(description: string): { responsibilities: string; requirements: string } {
  const lines = description.split("\n").map((line) => line.trim());
  let mode: "none" | "resp" | "req" = "none";
  const resp: string[] = [];
  const req: string[] = [];
  for (const line of lines) {
    const bare = cleanLine(line.replace(/^[•\-*]\s*/, ""));
    if (!line) continue;
    if (/^(responsibilities|what you.ll do|the role|about the role|day to day|your role)/i.test(bare)) {
      mode = "resp";
      continue;
    }
    if (/^(requirements|what we.re looking for|qualifications|you.ll need|must have|about you|skills)/i.test(bare)) {
      mode = "req";
      continue;
    }
    if (HEADING.test(bare)) continue;
    if (mode === "resp") resp.push(bare);
    else if (mode === "req") req.push(bare);
  }
  return { responsibilities: resp.join("\n"), requirements: req.join("\n") };
}

export function parseDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && value.length <= 13) return parseDate(asNumber);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isStale(postedAt: string | null, maxDays = 45): boolean {
  if (!postedAt) return false;
  return Date.now() - new Date(postedAt).getTime() > maxDays * DAY;
}

export function finalizeJob(input: {
  sourceSlug: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  remotePolicy?: RemotePolicy;
  remoteFlag?: boolean;
  description: string;
  descriptionHtml?: boolean;
  salary?: string | null;
  employmentType?: string;
  seniority?: string;
  postedAt?: string | number | null;
  deadline?: string | number | null;
  url: string;
  applicationUrl?: string;
  raw: unknown;
  extraText?: string;
}): NormalizedJob {
  const description = input.descriptionHtml === false ? input.description : htmlToText(input.description);
  const title = cleanLine(input.title);
  const company = cleanLine(input.company);
  const location = cleanLine(input.location || "Not specified");
  const sections = splitSections(description);
  const remotePolicy =
    input.remotePolicy ?? inferRemotePolicy(location, Boolean(input.remoteFlag), `${title} ${description}`);
  return {
    sourceSlug: input.sourceSlug,
    externalId: String(input.externalId),
    title,
    company,
    location,
    remotePolicy,
    description: description.slice(0, 20_000),
    responsibilities: sections.responsibilities.slice(0, 6_000),
    requirements: sections.requirements.slice(0, 6_000),
    salary: input.salary?.toString().trim() || null,
    employmentType: input.employmentType ?? inferEmploymentType(undefined, title),
    seniority: input.seniority ?? inferSeniority(title, description),
    postedAt: parseDate(input.postedAt ?? null),
    deadline: parseDate(input.deadline ?? null),
    url: input.url,
    applicationUrl: input.applicationUrl ?? input.url,
    raw: input.raw,
  };
}

export function jobKeys(job: NormalizedJob): {
  canonicalUrl: string;
  fingerprint: string;
  contentHash: string;
  searchText: string;
} {
  const searchText = [job.title, job.company, job.location, job.description, job.requirements]
    .join(" ")
    .toLowerCase();
  return {
    canonicalUrl: canonicalUrl(job.url),
    fingerprint: fingerprint(job.company, job.title, job.location),
    contentHash: contentHash(`${job.title}|${job.company}|${job.description}`),
    searchText,
  };
}

/** Does this job pass the user's coarse query (roles/keywords/countries)? */
export function matchesCriteria(job: NormalizedJob, criteria: SearchCriteria): boolean {
  if (!criteria.roleTitles.length && !criteria.keywords.length) return true;
  const haystack = `${job.title} ${job.company} ${job.location} ${job.description.slice(0, 3000)}`.toLowerCase();
  const roleHit = criteria.roleTitles.some((role) => {
    const tokens = tokenize(role);
    if (!tokens.length) return false;
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    return hits / tokens.length >= 0.5;
  });
  if (roleHit) return true;
  return criteria.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}
