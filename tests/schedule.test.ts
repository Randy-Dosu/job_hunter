import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTempDatabase } from "./helpers";

const temp = useTempDatabase();

let db: typeof import("@/lib/db");
let schedule: typeof import("@/lib/schedule");

const USER = "77777777-7777-4777-8777-777777777777";

beforeAll(async () => {
  db = await import("@/lib/db");
  schedule = await import("@/lib/schedule");
  const now = new Date().toISOString();
  db.insert("users", { id: USER, email: "schedule@test.local", name: "Schedule", password_hash: "x", created_at: now });
  db.insert("job_preferences", {
    id: crypto.randomUUID(),
    user_id: USER,
    timezone: "Africa/Accra",
    search_time: "07:00",
    days_of_week_json: "[1,2,3,4,5]",
    schedule_enabled: 1,
    updated_at: now,
  });
});

afterAll(() => temp.cleanup());

describe("schedule windows", () => {
  it("reads the wall clock in the user's timezone", () => {
    const parts = schedule.zonedParts(new Date("2026-11-12T07:30:00Z"), "Africa/Accra");
    expect(parts.date).toBe("2026-11-12");
    expect(parts.weekday).toBe(4); // Thursday
    expect(parts.minutes).toBe(7 * 60 + 30);
  });

  it("resolves a non-UTC offset correctly", () => {
    const parts = schedule.zonedParts(new Date("2026-11-12T02:00:00Z"), "Asia/Tokyo");
    expect(parts.date).toBe("2026-11-12");
    expect(parts.minutes).toBe(11 * 60);
  });

  it("is not due before the configured time", () => {
    const prefs = { userId: USER, timezone: "Africa/Accra", searchTime: "07:00", daysOfWeek: [4], scheduleEnabled: true };
    expect(schedule.isDue(prefs, new Date("2026-11-12T06:59:00Z"))).toBe(false);
    expect(schedule.isDue(prefs, new Date("2026-11-12T07:00:00Z"))).toBe(true);
  });

  it("respects the selected days and the pause switch", () => {
    const saturday = new Date("2026-11-14T09:00:00Z");
    const prefs = { userId: USER, timezone: "Africa/Accra", searchTime: "07:00", daysOfWeek: [1, 2, 3, 4, 5], scheduleEnabled: true };
    expect(schedule.isDue(prefs, saturday)).toBe(false);
    expect(schedule.isDue({ ...prefs, daysOfWeek: [6] }, saturday)).toBe(true);
    expect(schedule.isDue({ ...prefs, scheduleEnabled: false }, saturday)).toBe(false);
  });

  it("stops being due once that local day's scheduled run exists", () => {
    const prefs = { userId: USER, timezone: "Africa/Accra", searchTime: "07:00", daysOfWeek: [4, 5], scheduleEnabled: true };
    const now = new Date("2026-11-12T09:00:00Z");
    expect(schedule.isDue(prefs, now)).toBe(true);
    db.insert("search_runs", {
      id: crypto.randomUUID(),
      user_id: USER,
      trigger: "scheduled",
      run_key: `${USER}:scheduled:2026-11-12`,
      started_at: now.toISOString(),
      status: "completed",
      query_config_json: "{}",
      counts_json: "{}",
      error_summary: "",
    });
    expect(schedule.isDue(prefs, now)).toBe(false);
    // Tomorrow is a new window: the same schedule is due again.
    expect(schedule.isDue(prefs, new Date("2026-11-13T09:00:00Z"))).toBe(true);
  });

  it("computes the next run in the user's timezone", () => {
    const prefs = { userId: USER, timezone: "Africa/Accra", searchTime: "07:00", daysOfWeek: [1, 2, 3, 4, 5], scheduleEnabled: true };
    // Thursday 08:00 local: next window is Friday 07:00 local (07:00 UTC in Accra).
    const next = schedule.nextScheduledRun(prefs, new Date("2026-11-12T08:00:00Z"));
    expect(next?.at).toBe("2026-11-13T07:00:00.000Z");
    expect(next?.label).toContain("Fri");
    // Friday evening: next window skips the weekend to Monday.
    const monday = schedule.nextScheduledRun(prefs, new Date("2026-11-13T20:00:00Z"));
    expect(monday?.at).toBe("2026-11-16T07:00:00.000Z");
  });

  it("returns no next run when automation is paused", () => {
    const prefs = { userId: USER, timezone: "Africa/Accra", searchTime: "07:00", daysOfWeek: [1], scheduleEnabled: false };
    expect(schedule.nextScheduledRun(prefs, new Date("2026-11-12T08:00:00Z"))).toBeNull();
  });

  it("reads a user's schedule from preferences", () => {
    const prefs = schedule.scheduleForUser(USER);
    expect(prefs.timezone).toBe("Africa/Accra");
    expect(prefs.searchTime).toBe("07:00");
    expect(prefs.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(prefs.scheduleEnabled).toBe(true);
  });

  it("does not re-run a user whose scheduled window already ran", async () => {
    const results = await schedule.runDueSearches(new Date("2026-11-12T09:00:00Z"));
    expect(results.find((entry) => entry.userId === USER)).toBeUndefined();
  });
});
