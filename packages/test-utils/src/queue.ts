/**
 * In-memory implementation of the worker's `QueueStore` port.
 *
 * Mirrors the Postgres queue's contract, including idempotency keys and
 * `SKIP LOCKED` claiming semantics, so worker logic can be tested without a
 * database. It is intentionally *not* exported from production packages.
 */

import type { QueueJobRecord, QueueStore } from '@job-hunter/worker';

export class InMemoryQueue implements QueueStore {
  private readonly jobs = new Map<string, QueueJobRecord>();
  private readonly idempotency = new Map<string, string>();
  private sequence = 0;

  async enqueue(input: {
    kind: string;
    payload: unknown;
    runAt: Date;
    maxAttempts: number;
    idempotencyKey?: string | undefined;
  }): Promise<{ job: QueueJobRecord; created: boolean }> {
    if (input.idempotencyKey) {
      const existingId = this.idempotency.get(input.idempotencyKey);
      if (existingId) {
        const existing = this.jobs.get(existingId);
        if (existing) return { job: { ...existing }, created: false };
      }
    }

    this.sequence += 1;
    const id = `job-${String(this.sequence).padStart(4, '0')}`;
    const timestamp = input.runAt.toISOString();
    const job: QueueJobRecord = {
      id,
      kind: input.kind,
      payload: input.payload,
      status: 'queued',
      attempts: 0,
      maxAttempts: input.maxAttempts,
      runAt: timestamp,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.jobs.set(id, job);
    if (input.idempotencyKey) this.idempotency.set(input.idempotencyKey, id);
    return { job: { ...job }, created: true };
  }

  async claimNext(input: {
    workerId: string;
    now: Date;
    kinds?: string[];
  }): Promise<QueueJobRecord | undefined> {
    const candidates = [...this.jobs.values()]
      .filter((job) => job.status === 'queued' || job.status === 'failed')
      .filter((job) => new Date(job.runAt).getTime() <= input.now.getTime())
      .filter((job) => !input.kinds || input.kinds.includes(job.kind))
      .sort(
        (a, b) =>
          new Date(a.runAt).getTime() - new Date(b.runAt).getTime() || a.id.localeCompare(b.id),
      );

    const job = candidates[0];
    if (!job) return undefined;

    const claimed: QueueJobRecord = {
      ...job,
      status: 'running',
      attempts: job.attempts + 1,
      lockedAt: input.now.toISOString(),
      lockedBy: input.workerId,
      updatedAt: input.now.toISOString(),
    };
    this.jobs.set(job.id, claimed);
    return { ...claimed };
  }

  async complete(input: { id: string; now: Date }): Promise<void> {
    const job = this.jobs.get(input.id);
    if (!job) return;
    this.jobs.set(input.id, { ...job, status: 'succeeded', updatedAt: input.now.toISOString() });
  }

  async fail(input: {
    id: string;
    now: Date;
    error: string;
    retryAt?: Date | undefined;
    dead: boolean;
  }): Promise<void> {
    const job = this.jobs.get(input.id);
    if (!job) return;
    this.jobs.set(input.id, {
      ...job,
      status: input.dead ? 'dead' : 'failed',
      lastError: input.error,
      ...(input.retryAt ? { runAt: input.retryAt.toISOString() } : {}),
      updatedAt: input.now.toISOString(),
    });
  }

  async requeueStale(input: { now: Date; staleBefore: Date }): Promise<number> {
    let requeued = 0;
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running') continue;
      if (!job.lockedAt || new Date(job.lockedAt).getTime() > input.staleBefore.getTime()) continue;
      this.jobs.set(id, { ...job, status: 'failed', updatedAt: input.now.toISOString() });
      requeued += 1;
    }
    return requeued;
  }

  async stats(): Promise<Record<QueueJobRecord['status'], number>> {
    const counts: Record<QueueJobRecord['status'], number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };
    for (const job of this.jobs.values()) counts[job.status] += 1;
    return counts;
  }

  // ------------------------------------------------------------------ helpers

  /** All jobs, in insertion order (inspection helper for assertions). */
  async list(): Promise<QueueJobRecord[]> {
    return [...this.jobs.values()].map((job) => ({ ...job }));
  }

  /** Make every queued/failed job due immediately, skipping backoff waits. */
  async forceDue(): Promise<void> {
    for (const [id, job] of this.jobs) {
      if (job.status === 'queued' || job.status === 'failed') {
        this.jobs.set(id, { ...job, runAt: new Date(0).toISOString() });
      }
    }
  }
}
