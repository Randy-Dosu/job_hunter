/**
 * Daily scan scheduling.
 *
 * Pure functions: given a user's time zone and preferred local hour, compute the
 * next run instant and decide whether a scheduled run is due. All date maths uses
 * `Intl` so DST transitions and half-hour offsets behave correctly.
 *
 * The rule that matters most for the acceptance tests: a paused schedule never
 * reports as due, no matter how stale `nextRunAt` is.
 */

export interface ScheduleInput {
  enabled: boolean;
  timeZone: string;
  hourLocal: number;
  lastRunAt?: Date | undefined;
  now: Date;
}

/** Offset of a time zone from UTC, in minutes, at a given instant. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(at);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Local calendar date (YYYY-MM-DD) for a time zone. */
export function localDateKey(timeZone: string, at: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(at);
}

/**
 * The next instant at or after `from` where the local clock reads `hourLocal:00`
 * in `timeZone`. Handles DST by re-checking the offset for the candidate instant.
 */
export function nextRunAt(input: {
  timeZone: string;
  hourLocal: number;
  from?: Date | undefined;
}): Date {
  const from = input.from ?? new Date();
  const hour = Math.min(23, Math.max(0, Math.trunc(input.hourLocal)));

  // Start from the current local date, then search forward up to 3 days (covers
  // DST shifts and allows us to find the next occurrence safely).
  for (let dayOffset = 0; dayOffset <= 3; dayOffset += 1) {
    const probe = new Date(from.getTime() + dayOffset * 86_400_000);
    const candidate = zonedTimeToUtc(input.timeZone, probe, hour, 0);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  // Fallback: 24h from now (should be unreachable).
  return new Date(from.getTime() + 86_400_000);
}

/** Convert a wall-clock time in a zone to the corresponding UTC instant. */
export function zonedTimeToUtc(timeZone: string, reference: Date, hour: number, minute = 0): Date {
  const [year, month, day] = localDateKey(timeZone, reference).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  // First guess: interpret the wall clock as UTC.
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = zoneOffsetMinutes(timeZone, new Date(guess));
  const candidate = new Date(guess - offset1 * 60_000);
  // Re-check with the candidate instant (DST boundary correction).
  const offset2 = zoneOffsetMinutes(timeZone, candidate);
  return offset2 === offset1 ? candidate : new Date(guess - offset2 * 60_000);
}

export interface DueDecision {
  due: boolean;
  reason: 'disabled' | 'already_ran_today' | 'not_yet' | 'due' | 'missed_previous_day';
  nextRunAt: Date;
}

/**
 * Decide whether a scheduled scan should run now.
 *
 * Rules:
 *  1. Disabled schedules are never due (pause must be respected).
 *  2. At most one scheduled run per local calendar day.
 *  3. If the user was offline/asleep and the run time passed, the run is due
 *     immediately rather than skipped ("missed" catch-up).
 */
export function evaluateSchedule(input: ScheduleInput): DueDecision {
  const { enabled, timeZone, hourLocal, lastRunAt, now } = input;
  const todayKey = localDateKey(timeZone, now);
  const next = nextRunAt({ timeZone, hourLocal, from: now });

  if (!enabled) return { due: false, reason: 'disabled', nextRunAt: next };

  if (lastRunAt) {
    const lastKey = localDateKey(timeZone, lastRunAt);
    if (lastKey === todayKey) {
      return { due: false, reason: 'already_ran_today', nextRunAt: next };
    }
  }

  const todayRunInstant = zonedTimeToUtc(timeZone, now, hourLocal, 0);
  if (now.getTime() >= todayRunInstant.getTime()) {
    return {
      due: true,
      reason: lastRunAt ? 'missed_previous_day' : 'due',
      nextRunAt: nextRunAt({ timeZone, hourLocal, from: new Date(now.getTime() + 60_000) }),
    };
  }

  return { due: false, reason: 'not_yet', nextRunAt: next };
}

/** Idempotency key: one scheduled scan per user per local day. */
export function scheduledScanKey(userId: string, timeZone: string, now: Date): string {
  return `scan:${userId}:${localDateKey(timeZone, now)}`;
}
