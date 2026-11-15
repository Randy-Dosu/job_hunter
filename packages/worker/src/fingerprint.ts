/**
 * Listing identity and deduplication.
 *
 * Two listings are the same job when they describe the same role at the same
 * company in the same place — even across different sources. We therefore keep:
 *   - `sourceKey`: deterministic identity within one source (URL/id).
 *   - `dedupeKey`: cross-source identity (company + normalised title + location).
 */

import { createHash } from 'node:crypto';

const COMPANY_SUFFIXES =
  /\b(inc|llc|ltd|limited|gmbh|ag|sa|sas|bv|nv|plc|corp|corporation|co|company|group|holdings|technologies|technology|labs|studio|studios)\b\.?/gi;

const TITLE_NOISE =
  /\b(senior|sr|junior|jr|lead|principal|staff|ii|iii|iv|i|remote|contract|full[- ]time|part[- ]time|urgent|hiring|new)\b/gi;

export function normalizeCompany(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9+# ]+/g, ' ')
    .replace(TITLE_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLocation(value: string | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(remote|anywhere|worldwide|global)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type FingerprintJob = {
  source: string;
  externalId: string;
  url: string;
  company: string;
  title: string;
  locationRaw?: string | undefined;
};

/** Stable identity of a listing *within* its source. */
export function sourceKeyOf(job: Pick<FingerprintJob, 'source' | 'externalId' | 'url'>): string {
  const basis = `${job.source}:${job.externalId || canonicalUrl(job.url)}`;
  return sha1(basis).slice(0, 32);
}

/** Cross-source identity so the same role from two boards groups once. */
export function dedupeKeyOf(job: FingerprintJob): string {
  const basis = [
    normalizeCompany(job.company),
    normalizeTitle(job.title),
    normalizeLocation(job.locationRaw),
  ].join('|');
  return sha1(basis).slice(0, 32);
}

/** Remove tracking parameters and fragments so the same URL compares equal. */
export function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    const allowed = new URLSearchParams();
    for (const [key, paramValue] of url.searchParams) {
      if (/^(utm_|gh_src|lever-|ref|referrer|source|src|trk|tracking|campaign)/i.test(key))
        continue;
      allowed.set(key, paramValue);
    }
    url.search = allowed.toString();
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return url.toString();
  } catch {
    return value.trim();
  }
}

export interface DuplicateCandidate {
  id: string;
  source: string;
  sourceKey: string;
  dedupeKey: string;
  firstSeenAt: string;
  url: string;
}

export interface DedupeDecision {
  /** The canonical job id this listing belongs to (existing or new). */
  canonicalId?: string | undefined;
  /** True when this listing should become a new canonical job. */
  isNew: boolean;
  reason: 'source_key' | 'dedupe_key' | 'none';
}

/**
 * Decide whether an incoming listing duplicates an existing job.
 * Exact source key wins; otherwise a cross-source dedupe key match is used.
 */
export function decideDuplicate(
  incoming: { sourceKey: string; dedupeKey: string },
  existing: DuplicateCandidate[],
): DedupeDecision {
  const bySourceKey = existing.find((candidate) => candidate.sourceKey === incoming.sourceKey);
  if (bySourceKey) return { canonicalId: bySourceKey.id, isNew: false, reason: 'source_key' };

  const byDedupeKey = existing
    .filter((candidate) => candidate.dedupeKey === incoming.dedupeKey)
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))[0];
  if (byDedupeKey) return { canonicalId: byDedupeKey.id, isNew: false, reason: 'dedupe_key' };

  return { isNew: true, reason: 'none' };
}

/**
 * Freshness states from the plan: new (<24h), fresh (<7d), aging (<21d),
 * stale (<45d), expired (>45d or explicit expiry passed). Time is injected so
 * tests are deterministic.
 */
export function freshnessOf(input: {
  firstSeenAt: string;
  postedAt?: string | undefined;
  expiresAt?: string | undefined;
  lastSeenAt?: string | undefined;
  now?: Date | undefined;
}): 'new' | 'fresh' | 'aging' | 'stale' | 'expired' | 'unknown' {
  const now = input.now ?? new Date();
  if (input.expiresAt) {
    const expiry = new Date(input.expiresAt);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < now.getTime()) return 'expired';
  }
  const reference = input.postedAt ? new Date(input.postedAt) : new Date(input.firstSeenAt);
  if (Number.isNaN(reference.getTime())) return 'unknown';

  const ageMs = now.getTime() - reference.getTime();
  const day = 86_400_000;
  if (ageMs < day) return 'new';
  if (ageMs < 7 * day) return 'fresh';
  if (ageMs < 21 * day) return 'aging';
  if (ageMs < 45 * day) return 'stale';
  return 'expired';
}

/** A listing not seen for N consecutive days is treated as closed. */
export function isLikelyClosed(lastSeenAt: string, now = new Date(), thresholdDays = 14): boolean {
  const lastSeen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(lastSeen)) return false;
  return now.getTime() - lastSeen > thresholdDays * 86_400_000;
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
