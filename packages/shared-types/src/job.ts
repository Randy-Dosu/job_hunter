/** Normalised job model shared by connectors, scanning, matching, API and UI. */

import type {
  EmploymentType,
  FreshnessState,
  JobSourceId,
  JobStatus,
  SeniorityLevel,
  WorkplaceType,
} from './enums.js';

export interface SalaryRange {
  min?: number | undefined;
  max?: number | undefined;
  currency?: string | undefined;
  period?: 'year' | 'month' | 'day' | 'hour' | 'unknown' | undefined;
}

export interface LocationInfo {
  /** Free-form location as published by the source, e.g. "Berlin, Germany". */
  raw?: string | undefined;
  city?: string | undefined;
  region?: string | undefined;
  /** ISO 3166-1 alpha-2 country code when confidently resolved. */
  countryCode?: string | undefined;
  country?: string | undefined;
  /** True only when the listing itself states remote eligibility. */
  remote?: boolean | undefined;
  workplace?: WorkplaceType | undefined;
}

/**
 * A normalised listing. `id` is Job Hunter's internal id; `sourceRecord` keeps
 * the source-specific identity so we never lose attribution.
 */
export interface NormalizedJob {
  id: string;
  title: string;
  company: string;
  companyLogoUrl?: string | undefined;
  description: string;
  descriptionHtml?: string | undefined;
  url: string;
  source: JobSourceId;
  externalId: string;
  location: LocationInfo;
  employmentType: EmploymentType;
  seniority: SeniorityLevel;
  salary?: SalaryRange | undefined;
  postedAt?: string | undefined;
  expiresAt?: string | undefined;
  tags: string[];
  status: JobStatus;
  freshness: FreshnessState;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt: string;
}

/** What the user is looking for. Persisted on the candidate profile. */
export interface JobPreferences {
  targetTitles: string[];
  targetKeywords: string[];
  excludedKeywords: string[];
  excludedCompanies: string[];
  locations: string[];
  /** ISO 3166-1 alpha-2 codes the user accepts; empty means "no country filter". */
  countryCodes: string[];
  remoteOnly: boolean;
  workplaceTypes: WorkplaceType[];
  employmentTypes: EmploymentType[];
  seniorityLevels: SeniorityLevel[];
  minSalary?: number | undefined;
  salaryCurrency?: string | undefined;
  enabledSources: JobSourceId[];
  /** IANA time zone, e.g. "Africa/Accra". */
  timeZone: string;
  /** Local hour (0-23) at which the daily scan should start. */
  scanHourLocal: number;
}

export const DEFAULT_JOB_PREFERENCES: JobPreferences = {
  targetTitles: [],
  targetKeywords: [],
  excludedKeywords: [],
  excludedCompanies: [],
  locations: [],
  countryCodes: [],
  remoteOnly: false,
  workplaceTypes: [],
  employmentTypes: [],
  seniorityLevels: [],
  enabledSources: ['remoteok', 'weworkremotely', 'remotive', 'jobicy', 'arbeitnow'],
  timeZone: 'UTC',
  scanHourLocal: 8,
};

/** A listing as returned by a connector, before normalisation/upsert. */
export interface RawJob {
  /** Set by the scan engine from the connector id; connectors do not set it. */
  source?: JobSourceId | undefined;
  title: string;
  company: string;
  companyLogoUrl?: string | undefined;
  description: string;
  descriptionHtml?: string | undefined;
  url: string;
  externalId: string;
  locationRaw?: string | undefined;
  remote?: boolean | undefined;
  employmentTypeHint?: string | undefined;
  seniorityHint?: string | undefined;
  salaryRaw?: string | undefined;
  salaryMin?: number | undefined;
  salaryMax?: number | undefined;
  salaryCurrency?: string | undefined;
  salaryPeriod?: SalaryRange['period'];
  postedAt?: string | undefined;
  expiresAt?: string | undefined;
  tags?: string[] | undefined;
  countryHint?: string | undefined;
  cityHint?: string | undefined;
}
