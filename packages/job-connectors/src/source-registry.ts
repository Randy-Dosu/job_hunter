/**
 * The source register: every job source Job Hunter knows about, its permitted
 * access method and the compliance rationale.
 *
 * Per the plan: sources are enabled incrementally, and only after their access
 * method and terms have been reviewed. Sources without a permitted automated
 * access method are represented as `manual_handoff`: we build a deep search link
 * and the user does the searching themselves on the source's own site.
 */

import type { JobConnector, SourceAccessMethod, SourceFamily, JobSourceId } from './types.js';
import { remoteOkConnector } from './remoteok.js';
import { weWorkRemotelyConnector } from './weworkremotely.js';
import { remotiveConnector } from './remotive.js';
import { jobicyConnector } from './jobicy.js';
import { arbeitnowConnector } from './arbeitnow.js';
import { greenhouseConnector } from './greenhouse.js';
import { leverConnector } from './lever.js';

export interface SourceRegisterEntry {
  id: JobSourceId;
  name: string;
  family: SourceFamily;
  accessMethod: SourceAccessMethod;
  /** Why this access method (the compliance note shown in the UI). */
  complianceNote: string;
  /** Review status: `verified` means we checked the docs/terms at this date. */
  review: { reviewedAt: string; reviewer: string; notes: string };
  connector?: JobConnector | undefined;
  /** Deep-link template for manual handoff sources. */
  manualSearchUrl?: ((query: { titles: string[]; locations: string[] }) => string) | undefined;
}

const REVIEWED_AT = '2026-11-13';

/**
 * Automated connectors, in rollout order. Each has a public, documented access
 * method and was selected because it can be used without bypassing any barrier.
 */
export const AUTOMATED_CONNECTORS: JobConnector[] = [
  remoteOkConnector,
  weWorkRemotelyConnector,
  remotiveConnector,
  jobicyConnector,
  arbeitnowConnector,
  greenhouseConnector,
  leverConnector,
];

export const SOURCE_REGISTER: SourceRegisterEntry[] = [
  {
    id: 'remoteok',
    name: 'Remote OK',
    family: 'board',
    accessMethod: 'public_api',
    complianceNote:
      'Public JSON API intended for consumption. We send an identifying User-Agent, make one request per scan and link back to the original post. No authentication or CAPTCHA is bypassed.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'API documented at remoteok.com/api',
    },
    connector: remoteOkConnector,
  },
  {
    id: 'weworkremotely',
    name: 'We Work Remotely',
    family: 'board',
    accessMethod: 'public_api',
    complianceNote:
      'Public RSS category feeds. At most two feeds are read per scan, each once. Attribution and link-back preserved.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'RSS feeds public per category',
    },
    connector: weWorkRemotelyConnector,
  },
  {
    id: 'remotive',
    name: 'Remotive',
    family: 'board',
    accessMethod: 'public_api',
    complianceNote: 'Public JSON API with a documented search parameter. One request per scan.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'API documented at remotive.com/api',
    },
    connector: remotiveConnector,
  },
  {
    id: 'jobicy',
    name: 'Jobicy',
    family: 'board',
    accessMethod: 'public_api',
    complianceNote: 'Public JSON API. One request per scan with a bounded result count.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'API documented at jobicy.com/api',
    },
    connector: jobicyConnector,
  },
  {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    family: 'board',
    accessMethod: 'public_api',
    complianceNote: 'Public JSON job board API. Page-limited per scan.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'API documented at arbeitnow.com',
    },
    connector: arbeitnowConnector,
  },
  {
    id: 'greenhouse',
    name: 'Greenhouse job boards',
    family: 'company_careers',
    accessMethod: 'public_api',
    complianceNote:
      'Official public job-board API for company career pages. Only companies explicitly configured by the operator are read.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'Requires explicit board tokens; none configured by default',
    },
    connector: greenhouseConnector,
  },
  {
    id: 'lever',
    name: 'Lever postings',
    family: 'company_careers',
    accessMethod: 'public_api',
    complianceNote:
      'Official public postings API for company career pages. Only companies explicitly configured are read.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'Requires explicit site list; empty by default',
    },
    connector: leverConnector,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Jobs',
    family: 'marketplace',
    accessMethod: 'manual_handoff',
    complianceNote:
      "LinkedIn's terms and technical measures prohibit automated collection. Job Hunter does not access LinkedIn automatically: it builds a pre-filled search link you open yourself, and you can paste a listing URL you found to track it.",
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'Automated access not permitted; manual handoff only',
    },
    manualSearchUrl: ({ titles, locations }) => {
      const keywords = encodeURIComponent(titles.slice(0, 3).join(' ') || '');
      const location = encodeURIComponent(locations[0] ?? '');
      return `https://www.linkedin.com/jobs/search/?keywords=${keywords}&location=${location}`;
    },
  },
  {
    id: 'indeed',
    name: 'Indeed',
    family: 'marketplace',
    accessMethod: 'manual_handoff',
    complianceNote:
      "Indeed's terms and anti-bot measures prohibit automated collection. Job Hunter provides a pre-filled search link instead of scraping.",
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'Automated access not permitted; manual handoff only',
    },
    manualSearchUrl: ({ titles, locations }) => {
      const query = encodeURIComponent(titles.slice(0, 3).join(' ') || '');
      const where = encodeURIComponent(locations[0] ?? '');
      return `https://www.indeed.com/jobs?q=${query}&l=${where}`;
    },
  },
  {
    id: 'google_jobs',
    name: 'Google Jobs',
    family: 'aggregator',
    accessMethod: 'manual_handoff',
    complianceNote:
      'Google Jobs has no public jobs API for this use. Job Hunter opens a Google Jobs search in your browser instead of scraping results.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'No permitted automated API; manual handoff only',
    },
    manualSearchUrl: ({ titles, locations }) => {
      const query = encodeURIComponent(
        `${titles.slice(0, 3).join(' ')} jobs ${locations[0] ?? ''}`.trim(),
      );
      return `https://www.google.com/search?q=${query}&ibp=htl;jobs`;
    },
  },
  {
    id: 'wellfound',
    name: 'Wellfound',
    family: 'marketplace',
    accessMethod: 'manual_handoff',
    complianceNote:
      'Wellfound requires an authenticated account and does not offer a public jobs API. Job Hunter links you to a search you run yourself.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'No public API; login required — manual handoff only',
    },
    manualSearchUrl: ({ titles }) =>
      `https://wellfound.com/role/r/${encodeURIComponent(
        (titles[0] ?? 'software-engineer').toLowerCase().replace(/\s+/g, '-'),
      )}`,
  },
  {
    id: 'company_careers',
    name: 'Company career pages',
    family: 'company_careers',
    accessMethod: 'manual_handoff',
    complianceNote:
      'Generic career pages are not scraped. Configured Greenhouse/Lever boards are read through their official APIs; anything else is opened by you.',
    review: {
      reviewedAt: REVIEWED_AT,
      reviewer: 'engineering',
      notes: 'Only official ATS APIs are automated',
    },
  },
];

export function getSourceEntry(id: string): SourceRegisterEntry | undefined {
  return SOURCE_REGISTER.find((entry) => entry.id === id);
}

/** Connectors that may run automatically: permitted access AND usable config. */
export function getEnabledConnectors(enabledSourceIds: readonly string[]): JobConnector[] {
  return AUTOMATED_CONNECTORS.filter(
    (connector) =>
      enabledSourceIds.includes(connector.id) &&
      connector.accessMethod === 'public_api' &&
      connector.isConfigured(),
  );
}

/** Sources the UI should offer as "open this search yourself" links. */
export function getManualHandoffSources(
  enabledSourceIds: readonly string[],
): SourceRegisterEntry[] {
  return SOURCE_REGISTER.filter(
    (entry) =>
      enabledSourceIds.includes(entry.id) &&
      entry.accessMethod === 'manual_handoff' &&
      typeof entry.manualSearchUrl === 'function',
  );
}
