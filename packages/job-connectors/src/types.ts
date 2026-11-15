/** Re-exported connector contracts plus engine-only types. */

import type { RawJob } from '@job-hunter/shared-types';

export type {
  ConnectorContext,
  ConnectorPageResult,
  ConnectorSearchQuery,
  JobConnector,
} from '@job-hunter/shared-types';

export type {
  JobSourceId,
  SourceAccessMethod,
  SourceFamily,
  SourceHealthState,
  RawJob,
} from '@job-hunter/shared-types';

export interface ConnectorRunOptions {
  limitPerSource: number;
  maxPagesPerSource?: number | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  userAgent?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
}

export interface SourceRunOutcome {
  source: string;
  status: 'succeeded' | 'failed' | 'skipped';
  fetched: number;
  durationMs: number;
  error?: string | undefined;
  note?: string | undefined;
  jobs: RawJob[];
}
