import { describe, expect, it, vi } from 'vitest';
import {
  canonicalUrl,
  dedupeKeyOf,
  evaluateSchedule,
  freshnessOf,
  isLikelyClosed,
  localDateKey,
  nextRunAt,
  processQueueOnce,
  runScan,
  sanitizeError,
  scheduledScanKey,
  sourceKeyOf,
  zonedTimeToUtc,
} from '../src/index.js';
import { InMemoryQueue } from '@job-hunter/test-utils';
import type { JobConnector } from '@job-hunter/job-connectors';
import { makePreferences } from '../../matching/test/fixtures.js';

const at = (iso: string) => new Date(iso);

describe('scheduler — local-day semantics', () => {
  it('computes the local date in the user’s zone, not UTC', () => {
    // 23:30 UTC on the 12th is already the 13th in Tokyo (UTC+9).
    expect(localDateKey('UTC', at('2026-11-12T23:30:00Z'))).toBe('2026-11-12');
    expect(localDateKey('Asia/Tokyo', at('2026-11-12T23:30:00Z'))).toBe('2026-11-13');
  });

  it('converts local wall-clock time to UTC', () => {
    expect(zonedTimeToUtc('Africa/Accra', at('2026-11-13T12:00:00Z'), 8).toISOString()).toBe(
      '2026-11-13T08:00:00.000Z',
    );
    // Nairobi is UTC+3 year round.
    expect(zonedTimeToUtc('Africa/Nairobi', at('2026-11-13T12:00:00Z'), 8).toISOString()).toBe(
      '2026-11-13T05:00:00.000Z',
    );
  });

  it('keeps 08:00 local across a DST change', () => {
    // America/New_York: 08:00 EST = 13:00Z, 08:00 EDT = 12:00Z.
    expect(zonedTimeToUtc('America/New_York', at('2026-03-07T12:00:00Z'), 8).toISOString()).toBe(
      '2026-03-07T13:00:00.000Z',
    );
    expect(zonedTimeToUtc('America/New_York', at('2026-03-09T12:00:00Z'), 8).toISOString()).toBe(
      '2026-03-09T12:00:00.000Z',
    );
  });

  it('finds the next occurrence, rolling to tomorrow when today has passed', () => {
    expect(
      nextRunAt({
        timeZone: 'Africa/Accra',
        hourLocal: 8,
        from: at('2026-11-13T06:00:00Z'),
      }).toISOString(),
    ).toBe('2026-11-13T08:00:00.000Z');
    expect(
      nextRunAt({
        timeZone: 'Africa/Accra',
        hourLocal: 8,
        from: at('2026-11-13T09:00:00Z'),
      }).toISOString(),
    ).toBe('2026-11-14T08:00:00.000Z');
  });

  it('is not due before the scheduled hour', () => {
    const decision = evaluateSchedule({
      enabled: true,
      timeZone: 'Africa/Accra',
      hourLocal: 8,
      now: at('2026-11-13T06:00:00Z'),
    });
    expect(decision.due).toBe(false);
    expect(decision.reason).toBe('not_yet');
    expect(decision.nextRunAt.toISOString()).toBe('2026-11-13T08:00:00.000Z');
  });

  it('is due once the hour passes with no run today', () => {
    const decision = evaluateSchedule({
      enabled: true,
      timeZone: 'Africa/Accra',
      hourLocal: 8,
      now: at('2026-11-13T09:30:00Z'),
    });
    expect(decision.due).toBe(true);
    expect(decision.reason).toBe('due');
  });

  it('does not run twice on the same local day', () => {
    const decision = evaluateSchedule({
      enabled: true,
      timeZone: 'Africa/Accra',
      hourLocal: 8,
      lastRunAt: at('2026-11-13T08:01:00Z'),
      now: at('2026-11-13T22:00:00Z'),
    });
    expect(decision.due).toBe(false);
    expect(decision.reason).toBe('already_ran_today');
  });

  it('runs immediately when the previous day was missed', () => {
    const decision = evaluateSchedule({
      enabled: true,
      timeZone: 'Africa/Accra',
      hourLocal: 8,
      // Yesterday's run happened, so today is due as soon as the local hour passes.
      lastRunAt: at('2026-11-12T08:00:00Z'),
      now: at('2026-11-13T09:00:00Z'),
    });
    expect(decision.due).toBe(true);
    expect(decision.reason).toBe('missed_previous_day');
  });

  it('never runs a disabled schedule', () => {
    const decision = evaluateSchedule({
      enabled: false,
      timeZone: 'Africa/Accra',
      hourLocal: 8,
      now: at('2026-11-13T09:00:00Z'),
    });
    expect(decision.due).toBe(false);
    expect(decision.reason).toBe('disabled');
  });

  it('produces a one-per-local-day idempotency key', () => {
    const first = scheduledScanKey('user-1', 'Africa/Accra', at('2026-11-13T08:05:00Z'));
    const later = scheduledScanKey('user-1', 'Africa/Accra', at('2026-11-13T23:05:00Z'));
    expect(first).toBe(later);
    // Same instant, different user/local day → different key.
    expect(scheduledScanKey('user-2', 'Africa/Accra', at('2026-11-13T08:05:00Z'))).not.toBe(first);
    expect(scheduledScanKey('user-1', 'Africa/Accra', at('2026-11-14T08:05:00Z'))).not.toBe(first);
  });
});

describe('fingerprints', () => {
  it('is stable for the same listing and ignores tracking params', () => {
    const a = sourceKeyOf({
      source: 'remoteok',
      externalId: '123',
      url: 'https://x.test/j/1?utm_source=a',
    });
    const b = sourceKeyOf({ source: 'remoteok', externalId: '123', url: 'https://x.test/j/1' });
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it('falls back to the canonical URL when no external id exists', () => {
    const key = sourceKeyOf({
      source: 'company_careers',
      externalId: '',
      url: 'https://x.test/j/1#top',
    });
    expect(key).toBe(
      sourceKeyOf({ source: 'company_careers', externalId: '', url: 'https://x.test/j/1' }),
    );
  });

  it('differs between sources for the same external id', () => {
    expect(
      sourceKeyOf({ source: 'remoteok', externalId: '1', url: 'https://x.test/j/1' }),
    ).not.toBe(sourceKeyOf({ source: 'remotive', externalId: '1', url: 'https://x.test/j/1' }));
  });

  it('groups the same role advertised by two boards', () => {
    const base = { source: 'remoteok', externalId: '1', url: 'https://x.test/1' };
    const a = dedupeKeyOf({
      ...base,
      company: 'Zola Systems',
      title: 'Senior Backend Engineer',
      locationRaw: 'Remote',
    });
    const b = dedupeKeyOf({
      source: 'remotive',
      externalId: '9',
      url: 'https://y.test/9',
      company: 'zola  systems',
      title: 'Senior Backend Engineer!',
      locationRaw: 'remote',
    });
    expect(a).toBe(b);
  });

  it('keeps distinct roles in the same company apart', () => {
    const common = {
      source: 'remoteok',
      externalId: '1',
      url: 'https://x.test/1',
      company: 'Zola',
    };
    expect(dedupeKeyOf({ ...common, title: 'Backend Engineer' })).not.toBe(
      dedupeKeyOf({ ...common, title: 'Frontend Engineer' }),
    );
  });

  it('canonicalises URLs by dropping fragments and tracking params', () => {
    expect(canonicalUrl('https://X.test/job/1/?utm_source=newsletter&ref=abc#apply')).toBe(
      'https://x.test/job/1/',
    );
    expect(canonicalUrl('https://x.test/job/1#apply')).toBe('https://x.test/job/1');
  });

  it('classifies freshness by age', () => {
    const now = at('2026-11-13T12:00:00Z');
    const seen = '2026-01-01T00:00:00Z';
    expect(freshnessOf({ firstSeenAt: seen, postedAt: '2026-11-13T02:00:00Z', now })).toBe('new');
    expect(freshnessOf({ firstSeenAt: seen, postedAt: '2026-11-09T12:00:00Z', now })).toBe('fresh');
    expect(freshnessOf({ firstSeenAt: seen, postedAt: '2026-10-28T12:00:00Z', now })).toBe('aging');
    expect(freshnessOf({ firstSeenAt: seen, postedAt: '2026-10-20T12:00:00Z', now })).toBe('stale');
    expect(freshnessOf({ firstSeenAt: seen, postedAt: '2026-09-01T12:00:00Z', now })).toBe(
      'expired',
    );
    // With no posting date, the first-seen date is the reference.
    expect(freshnessOf({ firstSeenAt: '2026-11-13T06:00:00Z', now })).toBe('new');
    // An explicit past expiry always wins.
    expect(
      freshnessOf({ firstSeenAt: '2026-11-13T00:00:00Z', expiresAt: '2026-11-12T00:00:00Z', now }),
    ).toBe('expired');
    expect(freshnessOf({ firstSeenAt: 'not-a-date', now })).toBe('unknown');
  });

  it('detects likely-closed listings that have not been seen for two weeks', () => {
    const now = at('2026-11-13T12:00:00Z');
    expect(isLikelyClosed('2026-11-20T12:00:00Z', now)).toBe(false);
    expect(isLikelyClosed('2026-10-01T12:00:00Z', now)).toBe(true);
  });
});

describe('queue — idempotency and retries', () => {
  it('deduplicates a repeated enqueue by idempotency key', async () => {
    const queue = new InMemoryQueue();
    const first = await queue.enqueue({
      kind: 'scan.user',
      payload: { userId: 'u1' },
      runAt: at('2026-11-13T10:00:00Z'),
      maxAttempts: 3,
      idempotencyKey: 'scan:u1:2026-11-13',
    });
    const second = await queue.enqueue({
      kind: 'scan.user',
      payload: { userId: 'u1' },
      runAt: at('2026-11-13T10:00:00Z'),
      maxAttempts: 3,
      idempotencyKey: 'scan:u1:2026-11-13',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect((await queue.stats()).queued).toBe(1);
  });

  it('completes a job and reports the result', async () => {
    const queue = new InMemoryQueue();
    await queue.enqueue({
      kind: 'maintenance.retention',
      payload: {},
      runAt: at('2026-11-13T10:00:00Z'),
      maxAttempts: 3,
    });
    const result = await processQueueOnce({
      store: queue,
      workerId: 'w1',
      handlers: { 'maintenance.retention': async () => undefined },
      now: () => at('2026-11-13T10:00:01Z'),
    });
    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect((await queue.stats()).succeeded).toBe(1);
  });

  it('retries transient failures with exponential backoff, then gives up', async () => {
    const queue = new InMemoryQueue();
    await queue.enqueue({
      kind: 'scan.user',
      payload: {},
      runAt: at('2026-11-13T10:00:00Z'),
      maxAttempts: 3,
    });

    const failing = async () => {
      throw new Error('upstream timeout');
    };

    // Attempt 1 fails and schedules a retry; repeat until the queue gives up.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = (await queue.list())[0]!;
      if (before.status === 'dead') break;
      await queue.forceDue();
      await processQueueOnce({
        store: queue,
        workerId: 'w1',
        handlers: { 'scan.user': failing },
        now: () => at('2026-11-13T12:00:00Z'),
      });
    }

    const [job] = await queue.list();
    expect(job?.status).toBe('dead');
    expect(job?.attempts).toBeLessThanOrEqual(3);
    expect(job?.lastError).toContain('upstream timeout');
    // A dead job is never claimed again.
    const after = await processQueueOnce({
      store: queue,
      workerId: 'w1',
      handlers: { 'scan.user': async () => undefined },
      now: () => at('2026-11-13T13:00:00Z'),
    });
    expect(after.processed).toBe(0);
  });

  it('does not pick up a job before its retry time', async () => {
    const queue = new InMemoryQueue();
    await queue.enqueue({
      kind: 'scan.user',
      payload: {},
      runAt: at('2026-11-13T10:00:00Z'),
      maxAttempts: 3,
    });
    await processQueueOnce({
      store: queue,
      workerId: 'w1',
      handlers: {
        'scan.user': async () => {
          throw new Error('boom');
        },
      },
      now: () => at('2026-11-13T10:00:00Z'),
    });

    const early = await processQueueOnce({
      store: queue,
      workerId: 'w1',
      handlers: { 'scan.user': async () => undefined },
      now: () => at('2026-11-13T10:00:05Z'),
    });
    expect(early.processed).toBe(0);
  });

  it('leaves a job queued when no worker handles its kind', async () => {
    const queue = new InMemoryQueue();
    await queue.enqueue({
      kind: 'unknown.kind',
      payload: {},
      runAt: at('2026-11-13T10:00:00Z'),
      maxAttempts: 3,
    });
    const result = await processQueueOnce({
      store: queue,
      workerId: 'w1',
      handlers: { 'scan.user': async () => undefined },
      now: () => at('2026-11-13T10:00:00Z'),
    });
    expect(result.processed).toBe(0);
    const [job] = await queue.list();
    // Still queued: another worker with the right handler may pick it up.
    expect(job?.status).toBe('queued');
    expect(job?.attempts).toBe(0);
  });

  it('never runs two workers on the same job', async () => {
    const queue = new InMemoryQueue();
    await queue.enqueue({
      kind: 'scan.user',
      payload: {},
      runAt: at('2026-11-13T10:00:00Z'),
      maxAttempts: 3,
    });
    const handler = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const run = (workerId: string) =>
      processQueueOnce({
        store: queue,
        workerId,
        handlers: { 'scan.user': handler },
        now: () => at('2026-11-13T10:00:00Z'),
      });

    const [a, b] = await Promise.all([run('w1'), run('w2')]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(a.processed + b.processed).toBe(1);
  });
});

describe('scan engine — source isolation', () => {
  const connector = (
    id: string,
    impl: () => Promise<unknown>,
    accessMethod = 'public_api',
  ): JobConnector =>
    ({
      id,
      displayName: id,
      accessMethod,
      isConfigured: () => true,
      buildQuery: () => ({ titles: ['Backend Engineer'], keywords: ['typescript'], limit: 10 }),
      fetchPage: impl,
    }) as unknown as JobConnector;

  const rawJob = (id: string) => ({
    externalId: id,
    title: 'Backend Engineer',
    company: 'Zola Systems',
    description: 'TypeScript role.',
    url: `https://zola.test/jobs/${id}`,
    remote: true,
    location: 'Remote',
    tags: ['typescript'],
    source: 'remoteok',
  });

  it('returns results from a healthy source and isolates a failing one', async () => {
    const result = await runScan({
      connectors: [
        connector('good', async () => ({ jobs: [rawJob('1')], hasMore: false })),
        connector('bad', async () => {
          throw new Error('403 Forbidden for https://bad.test/api?api_key=secret123');
        }),
      ],
      preferences: makePreferences(),
      limitPerSource: 10,
      now: () => at('2026-11-13T10:00:00Z'),
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.summary.sourcesSucceeded).toBe(1);
    expect(result.summary.sourcesFailed).toBe(1);
    expect(result.status).toBe('partial');

    const failed = result.outcomes.find((outcome) => outcome.source === 'bad');
    expect(failed?.status).toBe('failed');
    // Secrets and raw query strings must not be logged.
    expect(failed?.error ?? '').not.toContain('secret123');
  });

  it('reports failed when every source fails', async () => {
    const result = await runScan({
      connectors: [
        connector('a', async () => {
          throw new Error('network down');
        }),
      ],
      preferences: makePreferences(),
      limitPerSource: 10,
      now: () => at('2026-11-13T10:00:00Z'),
    });
    expect(result.status).toBe('failed');
    expect(result.jobs).toEqual([]);
  });

  it('marks manual-handoff sources as skipped, not failed', async () => {
    const result = await runScan({
      connectors: [
        connector('linkedin', async () => ({ jobs: [], hasMore: false }), 'manual_handoff'),
      ],
      preferences: makePreferences(),
      limitPerSource: 10,
      now: () => at('2026-11-13T10:00:00Z'),
    });
    expect(result.outcomes[0]?.status).toBe('skipped');
    expect(result.summary.sourcesFailed).toBe(0);
  });

  it('never lets one malformed listing abort the source', async () => {
    // The engine passes listings through and ingestion validates them;
    // what matters here is that a bad entry does not fail the whole source.
    const result = await runScan({
      connectors: [
        connector('mixed', async () => ({
          jobs: [rawJob('ok'), { title: '', company: '', description: '', url: '' }],
          hasMore: false,
        })),
      ],
      preferences: makePreferences(),
      limitPerSource: 10,
      now: () => at('2026-11-13T10:00:00Z'),
    });
    expect(result.summary.sourcesSucceeded).toBe(1);
    expect(result.summary.sourcesFailed).toBe(0);
    expect(result.jobs.map((job) => job.externalId)).toContain('ok');
  });

  it('respects the per-source limit', async () => {
    const many = Array.from({ length: 50 }, (_, index) => rawJob(String(index)));
    const result = await runScan({
      connectors: [connector('big', async () => ({ jobs: many, hasMore: true }))],
      preferences: makePreferences(),
      limitPerSource: 5,
      now: () => at('2026-11-13T10:00:00Z'),
    });
    expect(result.jobs.length).toBeLessThanOrEqual(5);
  });

  it('aborts promptly when the signal is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runScan({
      connectors: [connector('slow', async () => ({ jobs: [rawJob('1')], hasMore: false }))],
      preferences: makePreferences(),
      limitPerSource: 10,
      signal: controller.signal,
      now: () => at('2026-11-13T10:00:00Z'),
    });
    expect(result.jobs).toEqual([]);
  });

  it('sanitises error messages: URLs, keys and length', () => {
    const message = sanitizeError(
      `Request to https://api.test/v1/jobs?token=abcdef failed with api_key=xyz123 ${'x'.repeat(1000)}`,
    );
    expect(message).not.toContain('xyz123');
    expect(message).not.toContain('abcdef');
    expect(message.length).toBeLessThanOrEqual(500);
  });
});
