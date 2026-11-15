/**
 * Postgres-backed job queue.
 *
 * The plan asks for a managed/Postgres-backed queue (or BullMQ+Redis) and warns
 * against adding Redis unless a measured requirement justifies it. A Postgres
 * queue keeps the free-tier footprint at zero extra services, gives us durable
 * retries and idempotency, and works identically on Supabase.
 */

export interface QueueJobRecord<TPayload = unknown> {
  id: string;
  kind: string;
  payload: TPayload;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead';
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedAt?: string | undefined;
  lockedBy?: string | undefined;
  lastError?: string | undefined;
  /** Idempotency key: a repeat enqueue with the same key is ignored. */
  idempotencyKey?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/** Storage port — implemented by Prisma in apps/api, by an in-memory store in tests. */
export interface QueueStore {
  /** Insert; returns the existing job when the idempotency key is already present. */
  enqueue(input: {
    kind: string;
    payload: unknown;
    runAt: Date;
    maxAttempts: number;
    idempotencyKey?: string | undefined;
  }): Promise<{ job: QueueJobRecord; created: boolean }>;
  /** Atomically claim the next due job (SKIP LOCKED semantics). */
  claimNext(input: {
    workerId: string;
    now: Date;
    kinds?: string[];
  }): Promise<QueueJobRecord | undefined>;
  complete(input: { id: string; now: Date }): Promise<void>;
  fail(input: {
    id: string;
    now: Date;
    error: string;
    retryAt?: Date | undefined;
    dead: boolean;
  }): Promise<void>;
  /** Re-queue jobs whose worker died mid-flight. */
  requeueStale(input: { now: Date; staleBefore: Date }): Promise<number>;
  stats(): Promise<Record<QueueJobRecord['status'], number>>;
}

export type JobHandler<TPayload = unknown> = (
  payload: TPayload,
  meta: {
    jobId: string;
    attempt: number;
    signal: AbortSignal;
  },
) => Promise<void>;

export interface WorkerRunOptions {
  store: QueueStore;
  handlers: Record<string, JobHandler>;
  workerId: string;
  pollIntervalMs?: number | undefined;
  /** Max jobs to process before returning (useful for tests and one-shot runs). */
  maxJobs?: number | undefined;
  signal?: AbortSignal | undefined;
  now?: (() => Date) | undefined;
  logger?:
    | { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void }
    | undefined;
  /** Called after each processed job; lets the loop stop between jobs. */
  onProcessed?: ((result: { jobId: string; kind: string; ok: boolean }) => void) | undefined;
}

/**
 * Single-tick processor: claims and runs up to `maxJobs` jobs. Returns counts so
 * the worker entrypoint can log and decide whether to sleep.
 */
export async function processQueueOnce(options: WorkerRunOptions): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const now = options.now ?? (() => new Date());
  const maxJobs = options.maxJobs ?? 10;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  while (processed < maxJobs) {
    if (options.signal?.aborted) break;
    const job = await options.store.claimNext({
      workerId: options.workerId,
      now: now(),
      kinds: Object.keys(options.handlers),
    });
    if (!job) break;

    const handler = options.handlers[job.kind];
    processed += 1;

    if (!handler) {
      await options.store.fail({
        id: job.id,
        now: now(),
        error: `No handler registered for job kind "${job.kind}"`,
        dead: true,
      });
      failed += 1;
      options.onProcessed?.({ jobId: job.id, kind: job.kind, ok: false });
      continue;
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await handler(job.payload, {
        jobId: job.id,
        attempt: job.attempts + 1,
        signal: controller.signal,
      });
      await options.store.complete({ id: job.id, now: now() });
      succeeded += 1;
      options.onProcessed?.({ jobId: job.id, kind: job.kind, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown job failure';
      const attempt = job.attempts + 1;
      const willRetry = attempt < job.maxAttempts;
      // Exponential backoff with a cap: 30s, 60s, 120s ... max 30min.
      const delayMs = Math.min(30_000 * 2 ** (attempt - 1), 30 * 60_000);
      await options.store.fail({
        id: job.id,
        now: now(),
        error: message.slice(0, 500),
        ...(willRetry ? { retryAt: new Date(now().getTime() + delayMs) } : {}),
        dead: !willRetry,
      });
      failed += 1;
      options.logger?.warn('job failed', { jobId: job.id, kind: job.kind, attempt, willRetry });
      options.onProcessed?.({ jobId: job.id, kind: job.kind, ok: false });
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  return { processed, succeeded, failed };
}

/** Long-running worker loop used by the worker entrypoint. */
export async function runWorkerLoop(options: WorkerRunOptions): Promise<void> {
  const interval = options.pollIntervalMs ?? 5000;
  const now = options.now ?? (() => new Date());
  options.logger?.info('worker started', { workerId: options.workerId });

  while (!options.signal?.aborted) {
    const result = await processQueueOnce({ ...options, maxJobs: options.maxJobs ?? 5 });
    // Recover jobs abandoned by crashed workers at the start of each idle cycle.
    if (result.processed === 0) {
      const requeued = await options.store.requeueStale({
        now: now(),
        staleBefore: new Date(now().getTime() - 10 * 60_000),
      });
      if (requeued > 0) options.logger?.warn('requeued stale jobs', { count: requeued });
      await sleep(interval, options.signal);
    }
  }
  options.logger?.info('worker stopped', { workerId: options.workerId });
}

export function sleep(ms: number, signal?: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });
}
