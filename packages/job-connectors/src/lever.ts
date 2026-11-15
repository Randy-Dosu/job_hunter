/**
 * Lever postings — official public postings API.
 *
 *   GET https://api.lever.co/v0/postings/{site}?mode=json
 * Public, documented and unauthenticated. Supports the company career pages
 * source family without scraping.
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
import type { CompanyBoardConfig } from './greenhouse.js';

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: { team?: string; location?: string; commitment?: string; department?: string };
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
}

export const LEVER_SITES: CompanyBoardConfig[] = [];

export const leverConnector: JobConnector = {
  id: 'lever',
  name: 'Lever postings',
  family: 'company_careers',
  accessMethod: 'public_api',
  docsUrl: 'https://api.lever.co/v0/postings/{site}?mode=json',
  notes:
    'Official public postings API for companies using Lever. Requires an explicit site list; no scraping.',
  supports: {
    keywordSearch: false,
    locationSearch: false,
    remoteOnly: true,
    pagination: false,
    postedSince: false,
  },

  isConfigured() {
    return LEVER_SITES.length > 0;
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
    const sites = LEVER_SITES.slice(0, 10);
    if (sites.length === 0) return { jobs: [], note: 'No Lever sites configured' };

    const jobs: ConnectorPageResult['jobs'] = [];
    const failures: string[] = [];

    for (const site of sites) {
      const endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(site.board)}?mode=json`;
      try {
        const payload = await fetchJson<LeverPosting[]>(endpoint, context, { timeoutMs: 12_000 });
        for (const entry of Array.isArray(payload) ? payload : []) {
          const title = cleanText(String(entry.text ?? '')).slice(0, 200);
          const link = safeUrl(entry.hostedUrl ?? entry.applyUrl, 'lever.co');
          if (!title || !link) continue;

          const locationRaw = cleanText(String(entry.categories?.location ?? '')) || 'Unspecified';
          const remote = /remote/i.test(locationRaw);
          if (query.remoteOnly && !remote) continue;

          const body = [
            entry.descriptionPlain ?? htmlToText(entry.description ?? ''),
            ...(entry.lists ?? []).map(
              (list) => `${list.text ?? ''}\n${htmlToText(list.content ?? '')}`,
            ),
          ].join('\n');
          const description = truncateDescription(cleanText(body));
          const tags = [
            entry.categories?.team,
            entry.categories?.department,
            entry.categories?.commitment,
          ].filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
          if (!matchesQuery(title, tags, query)) continue;

          jobs.push({
            title,
            company: site.displayName,
            description,
            url: link,
            externalId: String(entry.id ?? link),
            locationRaw,
            remote,
            employmentTypeHint: normalizeEmploymentType(entry.categories?.commitment ?? ''),
            seniorityHint: inferSeniority(title),
            postedAt:
              typeof entry.createdAt === 'number'
                ? new Date(entry.createdAt).toISOString()
                : undefined,
            tags: tags.map((tag) => cleanText(tag)).slice(0, 25),
            countryHint: resolveCountryCode({ locationRaw }),
          });
          if (jobs.length >= query.limit) break;
        }
      } catch (error) {
        failures.push(`${site.board}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
      if (jobs.length >= query.limit) break;
    }

    if (jobs.length === 0 && failures.length === sites.length) {
      throw new Error(`All Lever sites failed: ${failures.join('; ')}`);
    }
    return {
      jobs: jobs.slice(0, query.limit),
      ...(failures.length > 0 ? { note: `Partial site read: ${failures.length} failed` } : {}),
    };
  },
};
