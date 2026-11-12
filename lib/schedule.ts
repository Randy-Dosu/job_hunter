import { all, get, nowIso } from "@/lib/db";
import { runSearch } from "@/lib/search";

/**
 * Scheduling is deliberately boring: the configured wall-clock time is
 * interpreted in the user's timezone, and a search is "due" once that time has
 * passed on a selected day and no scheduled run exists for that local date.
 * `runSearch` enforces the same window with a unique run key, so a cron that
 * fires every ten minutes still produces exactly one run per day.
 */

export type SchedulePrefs = {
  userId: string;
  timezone: string;
  searchTime: string; // HH:MM
  daysOfWeek: number[]; // 0 = Sunday
  scheduleEnabled: boolean;
};

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, timeZone: string): { date: string; weekday: number; minutes: number } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY_INDEX[parts.weekday ?? "Sun"] ?? 0,
    minutes: hour * 60 + Number(parts.minute),
  };
}

export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Is a scheduled run due right now for this user? */
export function isDue(prefs: SchedulePrefs, now: Date): boolean {
  if (!prefs.scheduleEnabled) return false;
  const target = parseClock(prefs.searchTime);
  if (target === null) return false;
  const days = prefs.daysOfWeek.length ? prefs.daysOfWeek : [1, 2, 3, 4, 5];
  const local = zonedParts(now, prefs.timezone);
  if (!days.includes(local.weekday)) return false;
  if (local.minutes < target) return false;
  const alreadyRan = get<{ id: string }>(
    "SELECT id FROM search_runs WHERE run_key = ?",
    `${prefs.userId}:scheduled:${local.date}`,
  );
  return !alreadyRan;
}

function zonedTimeToUtc(year: number, month: number, day: number, minutes: number, timeZone: string): Date {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const guess = Date.UTC(year, month - 1, day, hours, mins, 0, 0);
  // Two passes settle the offset, including across a DST boundary.
  let instant = guess;
  for (let index = 0; index < 2; index++) {
    const local = zonedParts(new Date(instant), timeZone);
    const [localYear, localMonth, localDay] = local.date.split("-").map(Number);
    const localMinutes = local.minutes;
    const drift =
      Date.UTC(localYear, localMonth - 1, localDay, Math.floor(localMinutes / 60), localMinutes % 60) -
      Date.UTC(year, month - 1, day, hours, mins);
    instant = instant - drift;
  }
  return new Date(instant);
}

/** Next wall-clock run for display in settings and on the dashboard. */
export function nextScheduledRun(prefs: SchedulePrefs, now: Date = new Date()): { at: string; label: string } | null {
  if (!prefs.scheduleEnabled) return null;
  const target = parseClock(prefs.searchTime);
  if (target === null) return null;
  const days = prefs.daysOfWeek.length ? prefs.daysOfWeek : [1, 2, 3, 4, 5];
  const local = zonedParts(now, prefs.timezone);
  const [year, month, day] = local.date.split("-").map(Number);

  for (let offset = 0; offset <= 14; offset++) {
    const probe = new Date(Date.UTC(year, month - 1, day + offset));
    const probeLocal = zonedParts(probe, prefs.timezone);
    // Recompute the weekday in the target zone for the candidate date.
    const candidateParts = zonedParts(
      zonedTimeToUtc(
        Number(probeLocal.date.slice(0, 4)),
        Number(probeLocal.date.slice(5, 7)),
        Number(probeLocal.date.slice(8, 10)),
        target,
        prefs.timezone,
      ),
      prefs.timezone,
    );
    if (!days.includes(candidateParts.weekday)) continue;
    const candidate = zonedTimeToUtc(
      Number(probeLocal.date.slice(0, 4)),
      Number(probeLocal.date.slice(5, 7)),
      Number(probeLocal.date.slice(8, 10)),
      target,
      prefs.timezone,
    );
    if (candidate.getTime() <= now.getTime()) continue;
    return {
      at: candidate.toISOString(),
      label: candidate.toLocaleString("en-GB", {
        timeZone: prefs.timezone,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }
  return null;
}

export function scheduleForUser(userId: string): SchedulePrefs {
  const row = get<{
    timezone: string;
    search_time: string;
    days_of_week_json: string;
    schedule_enabled: number;
  }>("SELECT timezone, search_time, days_of_week_json, schedule_enabled FROM job_preferences WHERE user_id = ?", userId);
  const days = row ? (JSON.parse(row.days_of_week_json || "[]") as number[]) : [];
  return {
    userId,
    timezone: row?.timezone ?? "UTC",
    searchTime: row?.search_time ?? "07:00",
    daysOfWeek: days,
    scheduleEnabled: (row?.schedule_enabled ?? 0) === 1,
  };
}

export type DueRunResult = { userId: string; runId: string; duplicate: boolean; error?: string };

/** Entry point for an external cron: runs every user whose window is open. */
export async function runDueSearches(now: Date = new Date()): Promise<DueRunResult[]> {
  const users = all<{ id: string }>("SELECT id FROM users ORDER BY created_at");
  const results: DueRunResult[] = [];
  for (const user of users) {
    const prefs = scheduleForUser(user.id);
    if (!isDue(prefs, now)) continue;
    try {
      const run = await runSearch(user.id, "scheduled");
      results.push({ userId: user.id, runId: run.runId, duplicate: run.duplicateRun });
    } catch (error) {
      results.push({
        userId: user.id,
        runId: "",
        duplicate: false,
        error: error instanceof Error ? error.message : "scheduled run failed",
      });
    }
  }
  return results;
}

/** Exposed for diagnostics: how the server sees a user's window right now. */
export function scheduleSnapshot(userId: string, now: Date = new Date()) {
  const prefs = scheduleForUser(userId);
  const local = zonedParts(now, prefs.timezone);
  return {
    prefs,
    local,
    due: isDue(prefs, now),
    next: nextScheduledRun(prefs, now),
    checkedAt: nowIso(),
  };
}
