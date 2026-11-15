/** Connector contract implemented by every job source adapter. */

import type { JobPreferences, RawJob } from './job.js';
import type { JobSourceId, SourceAccessMethod, SourceFamily } from './enums.js';

export interface ConnectorSearchQuery {
  /** Titles/keywords derived from user preferences; connectors use what they support. */
  titles: string[];
  keywords: string[];
  locations: string[];
  countryCodes: string[];
  remoteOnly: boolean;
  /** Max listings the engine wants from this connector for this scan. */
  limit: number;
  /** Restrict to jobs posted at/after this ISO timestamp when supported. */
  since?: string | undefined;
}

export interface ConnectorPageResult {
  jobs: RawJob[];
  /** Opaque cursor for the next page; undefined means no more pages. */
  nextCursor?: string | undefined;
  /** Optional human-readable note (e.g. "API returned 0 results for filter"). */
  note?: string | undefined;
}

export interface ConnectorContext {
  /** Fetch implementation, injected so tests can run fully offline. */
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal | undefined;
  /** Per-request timeout in ms. */
  timeoutMs?: number | undefined;
  /** User agent string identifying Job Hunter, required by several sources. */
  userAgent?: string | undefined;
  logger?: { debug: (msg: string, meta?: unknown) => void } | undefined;
}

export interface JobConnector {
  readonly id: JobSourceId;
  readonly name: string;
  readonly family: SourceFamily;
  readonly accessMethod: SourceAccessMethod;
  /** Documented reasons/terms link for the compliance register. */
  readonly docsUrl?: string | undefined;
  readonly notes: string;
  /** Capability matrix, used to avoid sending unsupported filters. */
  readonly supports: {
    keywordSearch: boolean;
    locationSearch: boolean;
    remoteOnly: boolean;
    pagination: boolean;
    postedSince: boolean;
  };
  /** False when required configuration is missing (connector must be skipped). */
  isConfigured(): boolean;
  /** Build the query object from user preferences. */
  buildQuery(prefs: JobPreferences, limit: number): ConnectorSearchQuery;
  /** Fetch one page of raw jobs. Throws on transport errors; the engine isolates failures. */
  fetchPage(query: ConnectorSearchQuery, context: ConnectorContext): Promise<ConnectorPageResult>;
}

/** Health signal for the source register (used by the scheduler UI). */
export interface ConnectorHealth {
  source: JobSourceId;
  state: 'healthy' | 'degraded' | 'failing' | 'unknown';
  lastSuccessAt?: string | undefined;
  lastFailureAt?: string | undefined;
  consecutiveFailures: number;
  lastError?: string | undefined;
}
