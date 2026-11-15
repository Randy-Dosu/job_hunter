/**
 * Remotive — public JSON API (https://remotive.com/api/remote-jobs).
 *
 * Access: documented public endpoint intended for job distribution; requires no
 * authentication. Rate limits are modest; we make one search request per scan.
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

interface RemotiveJob {
  id?: number | string;
  url?: string;
  title?: string;
  company_name?: string;
  company_logo?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

export const remotiveConnector: JobConnector = {
  id: 'remotive',
  name: 'Remotive',
  family: 'board',
  accessMethod: 'public_api',
  docsUrl: 'https://remotive.com/api/remote-jobs',
  notes:
    'Public JSON API. Supports a server-side search parameter; we still post-filter to keep results tight. Remote-only.',
  supports: {
    keywordSearch: true,
    locationSearch: false,
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
    const search = [...query.titles, ...query.keywords][0];
    const url = new URL('https://remotive.com/api/remote-jobs');
    if (search) url.searchParams.set('search', search);
    url.searchParams.set('limit', String(Math.min(Math.max(query.limit * 3, 10), 100)));

    const payload = await fetchJson<{ jobs?: RemotiveJob[] }>(url.toString(), context);
    const entries = Array.isArray(payload?.jobs) ? payload.jobs : [];

    const jobs = entries.flatMap((entry) => {
      const title = cleanText(String(entry.title ?? '')).slice(0, 200);
      const company = cleanText(String(entry.company_name ?? '')).slice(0, 160);
      const link = safeUrl(entry.url, 'remotive.com');
      if (!title || !company || !link) return [];
      if (!matchesQuery(title, entry.tags ?? [], query)) return [];

      const locationRaw =
        cleanText(String(entry.candidate_required_location ?? 'Remote')) || 'Remote';
      const description = truncateDescription(htmlToText(entry.description ?? ''));
      const tags = [
        ...(Array.isArray(entry.tags) ? entry.tags : []),
        ...(entry.category ? [entry.category] : []),
      ]
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => cleanText(tag))
        .slice(0, 25);

      return [
        {
          title,
          company,
          companyLogoUrl: safeUrl(entry.company_logo, 'remotive.com'),
          description,
          descriptionHtml:
            typeof entry.description === 'string' ? entry.description.slice(0, 60_000) : undefined,
          url: link,
          externalId: String(entry.id ?? link),
          locationRaw,
          remote: true,
          employmentTypeHint: normalizeEmploymentType(entry.job_type ?? ''),
          seniorityHint: inferSeniority(title),
          salaryRaw: entry.salary ? cleanText(entry.salary).slice(0, 200) : undefined,
          postedAt: entry.publication_date ? safeDate(entry.publication_date) : undefined,
          tags,
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
