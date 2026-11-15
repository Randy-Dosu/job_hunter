/**
 * Arbeitnow — public JSON job board API (https://www.arbeitnow.com/api/job-board-api).
 *
 * Access: documented public endpoint, no authentication. Strong European
 * coverage; supports server-side pagination via a page parameter.
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

interface ArbeitnowJob {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
}

export const arbeitnowConnector: JobConnector = {
  id: 'arbeitnow',
  name: 'Arbeitnow',
  family: 'board',
  accessMethod: 'public_api',
  docsUrl: 'https://www.arbeitnow.com/api/job-board-api',
  notes:
    'Public JSON API covering European and remote roles. Paginated by page number; we cap pages per scan.',
  supports: {
    keywordSearch: false,
    locationSearch: false,
    remoteOnly: true,
    pagination: true,
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
      remoteOnly: prefs.remoteOnly,
      limit,
    };
  },

  async fetchPage(
    query: ConnectorSearchQuery,
    context: ConnectorContext,
  ): Promise<ConnectorPageResult> {
    const url = new URL('https://www.arbeitnow.com/api/job-board-api');
    const payload = await fetchJson<{ data?: ArbeitnowJob[]; links?: { next?: string | null } }>(
      url.toString(),
      context,
    );
    const entries = Array.isArray(payload?.data) ? payload.data : [];

    const jobs = entries.flatMap((entry) => {
      const title = cleanText(String(entry.title ?? '')).slice(0, 200);
      const company = cleanText(String(entry.company_name ?? '')).slice(0, 160);
      const link = safeUrl(entry.url, 'arbeitnow.com');
      if (!title || !company || !link) return [];
      const tags = (entry.tags ?? []).filter((tag): tag is string => typeof tag === 'string');
      if (!matchesQuery(title, tags, query)) return [];
      if (query.remoteOnly && !entry.remote) return [];

      const locationRaw =
        cleanText(String(entry.location ?? (entry.remote ? 'Remote' : ''))) || 'Remote';
      return [
        {
          title,
          company,
          description: truncateDescription(htmlToText(entry.description ?? '')),
          descriptionHtml:
            typeof entry.description === 'string' ? entry.description.slice(0, 60_000) : undefined,
          url: link,
          externalId: String(entry.slug ?? link),
          locationRaw,
          remote: entry.remote === true,
          employmentTypeHint: normalizeEmploymentType(...(entry.job_types ?? [])),
          seniorityHint: inferSeniority(title),
          postedAt:
            typeof entry.created_at === 'number'
              ? new Date(entry.created_at * 1000).toISOString()
              : undefined,
          tags: tags.map((tag) => cleanText(tag)).slice(0, 25),
          countryHint: resolveCountryCode({ locationRaw }),
        },
      ];
    });

    const next = payload?.links?.next;
    return {
      jobs: jobs.slice(0, query.limit),
      ...(typeof next === 'string' && next.length > 0 ? { nextCursor: 'page:2' } : {}),
    };
  },
};
