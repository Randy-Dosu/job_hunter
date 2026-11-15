/**
 * Hard eligibility filters.
 *
 * Per the plan: non-negotiable constraints filter jobs out *before* scoring, so
 * they can never be hidden inside a weighted average. Every rejection is
 * explained in plain language for the UI.
 */

import type { JobPreferences, NormalizedJob } from '@job-hunter/shared-types';
import { containsTerm, normalizeText } from './text.js';

export interface EligibilityInput {
  job: Pick<
    NormalizedJob,
    'title' | 'company' | 'location' | 'employmentType' | 'seniority' | 'tags' | 'description'
  >;
  preferences: JobPreferences;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  /** Which rule fired, useful for tests and analytics. */
  failedRules: string[];
}

export const EXCLUDE_RULE = 'excluded_keyword';
export const EXCLUDED_COMPANY_RULE = 'excluded_company';
export const REMOTE_RULE = 'remote_required';
export const WORKPLACE_RULE = 'workplace_type';
export const EMPLOYMENT_RULE = 'employment_type';
export const SENIORITY_RULE = 'seniority';
export const COUNTRY_RULE = 'country';
export const SALARY_RULE = 'salary_below_minimum';

/**
 * Rules are applied in order and every failing rule is reported (not just the
 * first) so the user can see exactly why a job was filtered.
 */
export function evaluateEligibility({ job, preferences }: EligibilityInput): EligibilityResult {
  const reasons: string[] = [];
  const failedRules: string[] = [];

  const titleAndTags = [job.title, job.company, ...(job.tags ?? [])].join(' ');

  // 1. User's excluded keywords (title/tags only: descriptions mention too much
  //    incidental text and would over-filter).
  for (const keyword of preferences.excludedKeywords) {
    if (containsTerm(titleAndTags, keyword)) {
      failedRules.push(EXCLUDE_RULE);
      reasons.push(`Title or tags contain your excluded keyword "${keyword}".`);
    }
  }

  // 2. Excluded companies.
  for (const company of preferences.excludedCompanies) {
    const needle = normalizeText(company);
    if (needle && normalizeText(job.company).includes(needle)) {
      failedRules.push(EXCLUDED_COMPANY_RULE);
      reasons.push(`You excluded the company "${job.company}".`);
      break;
    }
  }

  // 3. Remote requirement. A job is only treated as remote when the listing says
  //    so; we never *assume* remote eligibility.
  const workplace = job.location.workplace ?? (job.location.remote ? 'remote' : 'unknown');
  if (preferences.remoteOnly && workplace !== 'remote') {
    failedRules.push(REMOTE_RULE);
    reasons.push(
      workplace === 'onsite'
        ? 'You only want remote roles and this listing is onsite.'
        : 'You only want remote roles and this listing is not confirmed remote.',
    );
  }

  // 4. Workplace types (only applied when the job has a known workplace type).
  if (
    preferences.workplaceTypes.length > 0 &&
    workplace !== 'unknown' &&
    !preferences.workplaceTypes.includes(workplace)
  ) {
    failedRules.push(WORKPLACE_RULE);
    reasons.push(`Workplace type "${workplace}" is not in your selected types.`);
  }

  // 5. Employment type (only applied when the job states one).
  if (
    preferences.employmentTypes.length > 0 &&
    job.employmentType !== 'unknown' &&
    !preferences.employmentTypes.includes(job.employmentType)
  ) {
    failedRules.push(EMPLOYMENT_RULE);
    reasons.push(`Employment type "${job.employmentType.replace('_', ' ')}" is not selected.`);
  }

  // 6. Seniority (only applied when the job states a level we can map).
  if (
    preferences.seniorityLevels.length > 0 &&
    job.seniority !== 'unknown' &&
    !preferences.seniorityLevels.includes(job.seniority)
  ) {
    failedRules.push(SENIORITY_RULE);
    reasons.push(`Seniority "${job.seniority}" is outside your selected levels.`);
  }

  // 7. Country filter. Only applied when both sides are known — an unknown
  //    location must not silently exclude a possibly-relevant job.
  if (preferences.countryCodes.length > 0) {
    const jobCountry = job.location.countryCode?.toUpperCase();
    const isRemoteAnywhere = workplace === 'remote' && !jobCountry;
    if (jobCountry && !preferences.countryCodes.includes(jobCountry)) {
      failedRules.push(COUNTRY_RULE);
      reasons.push(`Located in ${job.location.country ?? jobCountry}, outside your countries.`);
    } else if (!jobCountry && !isRemoteAnywhere && job.location.remote !== true) {
      // Unknown country: flagged as a caution, not a hard exclusion.
    }
  }

  // 8. Minimum salary, only when both numbers are comparable.
  if (preferences.minSalary && job.location && 'salary' in job) {
    // Salary lives on the full job record; handled by caller via `evaluateSalaryRule`.
  }

  return { eligible: failedRules.length === 0, reasons, failedRules };
}

/** Salary rule kept separate: it needs the numeric salary range, not just labels. */
export function evaluateSalaryEligibility(input: {
  salaryMinAnnual?: number | undefined;
  preferences: JobPreferences;
}): { failed: boolean; reason?: string | undefined } {
  const { salaryMinAnnual, preferences } = input;
  if (!preferences.minSalary || salaryMinAnnual === undefined) return { failed: false };
  if (salaryMinAnnual >= preferences.minSalary) return { failed: false };
  return {
    failed: true,
    reason: `Listed salary starts below your minimum of ${preferences.minSalary.toLocaleString()}.`,
  };
}
