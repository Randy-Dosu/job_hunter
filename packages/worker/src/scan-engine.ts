/**
 * Scan engine: orchestrates connectors with per-source isolation.
 *
 * Contract (from the plan): one failing source must never stop the others, and
 * every run records a status, duration and safe error summary per source.
 */

import type { JobConnector, ConnectorContext } from '@job-hunter/job-connectors';
import type { JobPreferences, RawJob, ScanStatus } from '@job-hunter/shared-types';
import type { SourceRunOutcome } from '@job-hunter/job-connectors';

export interface ScanEngineOptions {
  connectors: JobConnector[];
  preferences: JobPreferences;
  limitPerSource: number;
  maxPagesPerSource?: number | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
  userAgent?: string | undefined;
  logger?:
    | { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void }
    | undefined;
  signal?: AbortSignal | undefined;
  /** Injected clock for deterministic tests. */
  now?: (() => Date) | undefined;
}

export interface ScanEngineResult {
  status: ScanStatus;
  outcomes: SourceRunOutcome[];
  jobs: RawJob[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Counts used by the dashboard/scan history UI. */
  summary: {
    sourcesAttempted: number;
    sourcesSucceeded: number;
    sourcesFailed: number;
    sourcesSkipped: number;
    listingsFetched: number;
  };
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_PAGES_DEFAULT = 1;

/**
 * Run all configured connectors. Never throws for source-level failures; only a
 * truly invalid configuration surfaces as an error before any source runs.
 */
export async function runScan(options: ScanEngineOptions): Promise<ScanEngineResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const started = Date.now();

  const outcomes: SourceRunOutcome[] = [];
  const collected: RawJob[] = [];

  for (const connector of options.connectors) {
    const sourceStarted = Date.now();

    if (options.signal?.aborted) {
      outcomes.push({
        source: connector.id,
        status: 'skipped',
        fetched: 0,
        durationMs: 0,
        error: 'Run cancelled before this source started',
        jobs: [],
      });
      continue;
    }

    if (connector.accessMethod !== 'public_api') {
      outcomes.push({
        source: connector.id,
        status: 'skipped',
        fetched: 0,
        durationMs: 0,
        note: `Access method "${connector.accessMethod}" is not automated`,
        jobs: [],
      });
      continue;
    }

    if (!connector.isConfigured()) {
      outcomes.push({
        source: connector.id,
        status: 'skipped',
        fetched: 0,
        durationMs: 0,
        note: 'Source is not configured',
        jobs: [],
      });
      continue;
    }

    try {
      const query = connector.buildQuery(options.preferences, options.limitPerSource);
      const context: ConnectorContext = {
        fetch: options.fetchImpl ?? globalThis.fetch,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        logger: options.logger
          ? { debug: (message: string, meta?: unknown) => options.logger?.info(message, meta) }
          : undefined,
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      };

      const jobs: RawJob[] = [];
      let pages = 0;
      let cursor: string | undefined;
      const maxPages = Math.max(1, options.maxPagesPerSource ?? MAX_PAGES_DEFAULT);

      do {
        const page = await connector.fetchPage(query, context);
        jobs.push(...page.jobs);
        cursor = page.nextCursor;
        pages += 1;
        if (jobs.length >= options.limitPerSource) break;
        if (cursor && pages >= maxPages) break;
      } while (cursor);

      // Tag every listing with its connector id so ingestion keeps attribution.
      const trimmed = jobs.slice(0, options.limitPerSource).map((job) => ({
        ...job,
        source: connector.id,
      }));
      collected.push(...trimmed);
      outcomes.push({
        source: connector.id,
        status: 'succeeded',
        fetched: trimmed.length,
        durationMs: Date.now() - sourceStarted,
        jobs: trimmed,
      });
      options.logger?.info('connector succeeded', {
        source: connector.id,
        fetched: trimmed.length,
        durationMs: Date.now() - sourceStarted,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown connector failure';
      outcomes.push({
        source: connector.id,
        status: 'failed',
        fetched: 0,
        durationMs: Date.now() - sourceStarted,
        error: sanitizeError(message),
        jobs: [],
      });
      options.logger?.warn('connector failed', {
        source: connector.id,
        error: sanitizeError(message),
      });
    }
  }

  const attempted = outcomes.filter((outcome) => outcome.status !== 'skipped');
  const succeeded = outcomes.filter((outcome) => outcome.status === 'succeeded');
  const failed = outcomes.filter((outcome) => outcome.status === 'failed');
  const skipped = outcomes.filter((outcome) => outcome.status === 'skipped');

  const status: ScanStatus =
    attempted.length === 0
      ? 'failed'
      : failed.length === 0
        ? 'succeeded'
        : succeeded.length === 0
          ? 'failed'
          : 'partial';

  return {
    status,
    outcomes,
    jobs: collected,
    startedAt,
    finishedAt: now().toISOString(),
    durationMs: Date.now() - started,
    summary: {
      sourcesAttempted: attempted.length,
      sourcesSucceeded: succeeded.length,
      sourcesFailed: failed.length,
      sourcesSkipped: skipped.length,
      listingsFetched: collected.length,
    },
  };
}

/**
 * Error summaries must never leak credentials or full URLs with tokens. We keep
 * the error class/status and strip query strings.
 */
export function sanitizeError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s)]+/g, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/[0-9a-f]{16,}$/i, '/…')}`;
      } catch {
        return '<url>';
      }
    })
    .replace(/(api[_-]?key|token|secret|password)=[^\s&]+/gi, '$1=<redacted>')
    .slice(0, 500);
}
