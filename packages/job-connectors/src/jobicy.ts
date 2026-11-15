/**
 * Jobicy — public JSON API (https://jobicy.com/api/v2/remote-jobs).
 *
 * Access: documented public endpoint, no authentication. Remote-only.
 */

import type {
  JobConnector,
  ConnectorContext,
  ConnectorPageResult,
  ConnectorSearchQuery,
} from './types.js';
import { fetchJson } from './http.js';
import {
  cleanText,
  htmlToText,
  inferSeniority,
  normalizeEmploymentType,
  resolveCountryCode,
  safeUrl,
  truncateDescription,
} from './normalize.js';
import { matchesQuery } from './remoteok.js';

interface JobicyJob {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  companyLogo?: string;
  jobIndustry?: string[];
  jobType?: string[];
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  annualSalaryMin?: number;
  annualSalaryMax?: number;
  salaryCurrency?: string;
}

export const jobicyConnector: JobConnector = {
  id: 'jobicy',
  name: 'Jobicy',
  family: 'board',
  accessMethod: 'public_api',
  docsUrl: 'https://jobicy.com/api/v2/remote-jobs',
  notes: 'Public JSON API with title/industry filters. Remote-first listings worldwide.',
  supports: {
    keywordSearch: true,
    locationSearch: true,
    remoteOnly: true,
    pagination: false,
    postedSince: false,
  },

  isConfigured() {
    return true;
  },

  buildQuery(prefs, limit): ConnectorSearchQuery {
    return {
      titles: prefs.targetTitles,
      keywords: prefs.targetKeywords,
      locations: prefs.locations,
      countryCodes: prefs.countryCodes,
      remoteOnly: true,
      limit,
    };
  },

  async fetchPage(
    query: ConnectorSearchQuery,
    context: ConnectorContext,
  ): Promise<ConnectorPageResult> {
    const url = new URL('https://jobicy.com/api/v2/remote-jobs');
    url.searchParams.set('count', String(Math.min(Math.max(query.limit * 2, 10), 50)));
    const geo = query.locations[0] ?? query.countryCodes[0];
    if (geo) url.searchParams.set('geo', geo);

    const payload = await fetchJson<{ jobs?: JobicyJob[] }>(url.toString(), context);
    const entries = Array.isArray(payload?.jobs) ? payload.jobs : [];

    const jobs = entries.flatMap((entry) => {
      const title = cleanText(String(entry.jobTitle ?? '')).slice(0, 200);
      const company = cleanText(String(entry.companyName ?? '')).slice(0, 160);
      const link = safeUrl(entry.url, 'jobicy.com');
      if (!title || !company || !link) return [];
      const tags = [...(entry.jobIndustry ?? []), ...(entry.jobType ?? [])].filter(
        (tag): tag is string => typeof tag === 'string',
      );
      if (!matchesQuery(title, tags, query)) return [];

      const locationRaw = cleanText(String(entry.jobGeo ?? 'Remote')) || 'Remote';
      return [
        {
          title,
          company,
          companyLogoUrl: safeUrl(entry.companyLogo, 'jobicy.com'),
          description: truncateDescription(
            htmlToText(entry.jobDescription ?? entry.jobExcerpt ?? ''),
          ),
          descriptionHtml:
            typeof entry.jobDescription === 'string'
              ? entry.jobDescription.slice(0, 60_000)
              : undefined,
          url: link,
          externalId: String(entry.id ?? link),
          locationRaw,
          remote: true,
          employmentTypeHint: normalizeEmploymentType(...(entry.jobType ?? [])),
          seniorityHint: inferSeniority(title, entry.jobLevel),
          salaryMin: typeof entry.annualSalaryMin === 'number' ? entry.annualSalaryMin : undefined,
          salaryMax: typeof entry.annualSalaryMax === 'number' ? entry.annualSalaryMax : undefined,
          salaryCurrency: entry.salaryCurrency
            ? cleanText(entry.salaryCurrency).slice(0, 3).toUpperCase()
            : undefined,
          salaryPeriod: 'year' as const,
          postedAt: entry.pubDate ? safeDate(entry.pubDate) : undefined,
          tags: tags.map((tag) => cleanText(tag)).slice(0, 25),
          countryHint: resolveCountryCode({ locationRaw }),
        },
      ];
    });

    return { jobs: jobs.slice(0, query.limit) };
  },
};

function safeDate(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
