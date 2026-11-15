/**
 * Greenhouse job boards — public board API.
 *
 * Company career pages hosted on Greenhouse expose a documented public endpoint:
 *   GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
 * This is the "company career pages" source family in its most standards-compliant
 * form: no scraping of the marketing site, no authentication, official JSON.
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
  decodeEntities,
  htmlToText,
  inferSeniority,
  normalizeEmploymentType,
  resolveCountryCode,
  safeUrl,
  truncateDescription,
} from './normalize.js';
import { matchesQuery } from './remoteok.js';

interface GreenhouseJob {
  id?: number;
  title?: string;
  content?: string;
  absolute_url?: string;
  updated_at?: string;
  location?: { name?: string };
  metadata?: Array<{ name?: string; value?: unknown }>;
  departments?: Array<{ name?: string }>;
  offices?: Array<{ name?: string }>;
}

export interface CompanyBoardConfig {
  /** Greenhouse board token, e.g. "stripe". */
  board: string;
  displayName: string;
}

/**
 * Board tokens are configuration, not data: the operator adds only companies
 * they intend to follow. Empty by default so no scanning happens without an
 * explicit, reviewed configuration entry.
 */
export const GREENHOUSE_BOARDS: CompanyBoardConfig[] = [];

export const greenhouseConnector: JobConnector = {
  id: 'greenhouse',
  name: 'Greenhouse job boards',
  family: 'company_careers',
  accessMethod: 'public_api',
  docsUrl: 'https://developers.greenhouse.io/job-board.html',
  notes:
    'Official public job-board API for company career pages. Requires an explicit list of board tokens; no scraping.',
  supports: {
    keywordSearch: false,
    locationSearch: false,
    remoteOnly: true,
    pagination: false,
    postedSince: false,
  },

  isConfigured() {
    return GREENHOUSE_BOARDS.length > 0;
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
    const boards = GREENHOUSE_BOARDS.slice(0, 10);
    if (boards.length === 0) {
      return { jobs: [], note: 'No Greenhouse boards configured' };
    }

    const jobs: ConnectorPageResult['jobs'] = [];
    const failures: string[] = [];

    for (const board of boards) {
      const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.board)}/jobs?content=true`;
      try {
        const payload = await fetchJson<{ jobs?: GreenhouseJob[] }>(endpoint, context, {
          timeoutMs: 12_000,
        });
        for (const entry of payload?.jobs ?? []) {
          const title = cleanText(String(entry.title ?? '')).slice(0, 200);
          const link = safeUrl(entry.absolute_url, 'greenhouse.io');
          if (!title || !link) continue;
          const locationRaw = cleanText(String(entry.location?.name ?? '')) || 'Unspecified';
          const remote = /remote/i.test(locationRaw);
          if (query.remoteOnly && !remote) continue;
          const description = truncateDescription(htmlToText(decodeEntities(entry.content ?? '')));
          const tags = [
            ...(entry.departments ?? []).map((dept) => dept.name ?? ''),
            ...(entry.offices ?? []).map((office) => office.name ?? ''),
          ]
            .filter((tag) => tag.length > 0)
            .map((tag) => cleanText(tag));
          if (!matchesQuery(title, tags, query)) continue;

          jobs.push({
            title,
            company: board.displayName,
            description,
            descriptionHtml:
              typeof entry.content === 'string' ? entry.content.slice(0, 60_000) : undefined,
            url: link,
            externalId: String(entry.id ?? link),
            locationRaw,
            remote,
            employmentTypeHint: normalizeEmploymentType(title, description.slice(0, 400)),
            seniorityHint: inferSeniority(title),
            postedAt: entry.updated_at ? safeDate(entry.updated_at) : undefined,
            tags: tags.slice(0, 25),
            countryHint: resolveCountryCode({ locationRaw }),
          });
          if (jobs.length >= query.limit) break;
        }
      } catch (error) {
        failures.push(
          `${board.board}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
      if (jobs.length >= query.limit) break;
    }

    if (jobs.length === 0 && failures.length === boards.length) {
      throw new Error(`All Greenhouse boards failed: ${failures.join('; ')}`);
    }
    return {
      jobs: jobs.slice(0, query.limit),
      ...(failures.length > 0 ? { note: `Partial board read: ${failures.length} failed` } : {}),
    };
  },
};

function safeDate(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
