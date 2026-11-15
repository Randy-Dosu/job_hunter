/**
 * Remote OK — public JSON API (https://remoteok.com/api).
 *
 * Access: documented public endpoint, no authentication. We send a descriptive
 * User-Agent that links back to the project, keep the request rate low (one
 * request per scan) and always link users back to the original posting.
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

interface RemoteOkJob {
  id?: string | number;
  slug?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  title?: string;
  tags?: string[];
  logo?: string;
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  apply_url?: string;
  url?: string;
}

export const remoteOkConnector: JobConnector = {
  id: 'remoteok',
  name: 'Remote OK',
  family: 'board',
  accessMethod: 'public_api',
  docsUrl: 'https://remoteok.com/api',
  notes:
    'Public JSON API. One request per scan; results are remote-only by definition. Always links back to the original post.',
  supports: {
    keywordSearch: false,
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
    const payload = await fetchJson<RemoteOkJob[]>('https://remoteok.com/api', context, {
      headers: { accept: 'application/json' },
    });
    if (!Array.isArray(payload)) {
      throw new Error('Remote OK returned an unexpected payload (expected an array)');
    }
    // The first element is a legal/attribution notice, not a job.
    const entries = payload.filter((entry) => entry && typeof entry === 'object' && entry.position);

    const jobs = entries.flatMap((entry) => {
      const title = cleanText(String(entry.position ?? '')).slice(0, 200);
      const company = cleanText(String(entry.company ?? '')).slice(0, 160);
      if (!title || !company) return [];
      const url =
        safeUrl(entry.apply_url ?? entry.url, 'remoteok.com') ??
        safeUrl(
          entry.slug ? `https://remoteok.com/remote-jobs/${entry.slug}` : undefined,
          'remoteok.com',
        );
      if (!url) return [];
      const locationRaw = cleanText(String(entry.location ?? 'Remote')).slice(0, 160) || 'Remote';
      const description = truncateDescription(htmlToText(entry.description ?? ''));
      const tags = Array.isArray(entry.tags)
        ? entry.tags
            .filter((tag): tag is string => typeof tag === 'string')
            .map((tag) => cleanText(tag))
            .slice(0, 25)
        : [];
      const postedAt = entry.date
        ? new Date(entry.date).toISOString()
        : typeof entry.epoch === 'number'
          ? new Date(entry.epoch * 1000).toISOString()
          : undefined;
      const externalId = String(entry.id ?? entry.slug ?? url);

      return [
        {
          title,
          company,
          companyLogoUrl: safeUrl(entry.logo, 'remoteok.com'),
          description,
          descriptionHtml:
            typeof entry.description === 'string' ? entry.description.slice(0, 60_000) : undefined,
          url,
          externalId,
          locationRaw,
          remote: true,
          employmentTypeHint: normalizeEmploymentType(tags.join(' '), description.slice(0, 400)),
          seniorityHint: inferSeniority(title),
          salaryMin: typeof entry.salary_min === 'number' ? entry.salary_min : undefined,
          salaryMax: typeof entry.salary_max === 'number' ? entry.salary_max : undefined,
          salaryCurrency: typeof entry.salary_min === 'number' ? 'USD' : undefined,
          salaryPeriod: 'year' as const,
          postedAt,
          tags,
          countryHint: resolveCountryCode({ locationRaw }),
        },
      ];
    });

    // Post-filter client-side because the API cannot filter by keyword.
    return {
      jobs: jobs.filter((job) => matchesQuery(job.title, job.tags ?? [], query)),
      note: `${jobs.length} listings returned by the API`,
    };
  },
};

/** Shared client-side keyword matching for APIs without server-side search. */
export function matchesQuery(title: string, tags: string[], query: ConnectorSearchQuery): boolean {
  const haystack = `${title} ${tags.join(' ')}`.toLowerCase();
  const wanted = [...query.titles, ...query.keywords]
    .map((term) => term.toLowerCase().trim())
    .filter((term) => term.length > 0);
  if (wanted.length === 0) return true;

  return wanted.some((term) => {
    // A multi-word target like "Backend Engineer" must match in full, otherwise
    // a single shared seniority word would let every listing through.
    if (haystack.includes(term)) return true;
    const words = term.split(/\s+/).filter(Boolean);
    if (words.length > 1) return words.every((word) => haystack.includes(word));
    // For a single word, also accept its presence as a substring of a compound
    // ("engineer" in "engineering"), which is how job boards title roles.
    return (
      words.length === 1 &&
      words[0] !== undefined &&
      words[0].length >= 4 &&
      haystack.includes(words[0])
    );
  });
}
