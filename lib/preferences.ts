import { z } from "zod";
import { nowIso, run } from "@/lib/db";

const list = z.array(z.string().min(1).max(80)).max(60);

const schema = z.object({
  roleTitles: list.optional(),
  countries: list.optional(),
  cities: list.optional(),
  remoteRegions: list.optional(),
  remotePreference: z.enum(["remote", "hybrid", "onsite", "any"]).optional(),
  seniority: list.optional(),
  jobTypes: list.optional(),
  industries: list.optional(),
  excludedEmployers: list.optional(),
  excludedKeywords: list.optional(),
  excludedLocations: list.optional(),
  salaryFloor: z.number().int().min(0).max(10_000_000).nullable().optional(),
  currency: z.string().length(3).optional(),
  language: z.string().max(12).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  searchTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z.string().max(80).optional(),
  notifyEmail: z.boolean().optional(),
  notifyInApp: z.boolean().optional(),
  scheduleEnabled: z.boolean().optional(),
  enabledSourceIds: z.array(z.string().uuid()).max(30).optional(),
});

const COLUMNS: Record<string, string> = {
  roleTitles: "role_titles_json",
  countries: "countries_json",
  cities: "cities_json",
  remoteRegions: "remote_regions_json",
  seniority: "seniority_json",
  jobTypes: "job_types_json",
  industries: "industries_json",
  excludedEmployers: "excluded_employers_json",
  excludedKeywords: "excluded_keywords_json",
  excludedLocations: "excluded_locations_json",
  daysOfWeek: "days_of_week_json",
  enabledSourceIds: "enabled_source_ids_json",
};

export function savePreferences(userId: string, payload: unknown): { ok: true } | { ok: false; error: string } {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Invalid preferences: ${issue.path.join(".")} ${issue.message}` };
  }
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    if (key in COLUMNS) {
      updates.push(`${COLUMNS[key]} = ?`);
      values.push(JSON.stringify(value));
      continue;
    }
    switch (key) {
      case "remotePreference":
        updates.push("remote_preference = ?");
        values.push(value as string);
        break;
      case "salaryFloor":
        updates.push("salary_floor = ?");
        values.push((value as number | null) ?? null);
        break;
      case "currency":
        updates.push("currency = ?");
        values.push((value as string).toUpperCase());
        break;
      case "language":
        updates.push("language = ?");
        values.push(value as string);
        break;
      case "searchTime":
        updates.push("search_time = ?");
        values.push(value as string);
        break;
      case "timezone":
        updates.push("timezone = ?");
        values.push(value as string);
        break;
      case "notifyEmail":
        updates.push("notify_email = ?");
        values.push(value ? 1 : 0);
        break;
      case "notifyInApp":
        updates.push("notify_in_app = ?");
        values.push(value ? 1 : 0);
        break;
      case "scheduleEnabled":
        updates.push("schedule_enabled = ?");
        values.push(value ? 1 : 0);
        break;
      default:
        break;
    }
  }
  if (!updates.length) return { ok: true };
  updates.push("updated_at = ?");
  values.push(nowIso(), userId);
  run(`UPDATE job_preferences SET ${updates.join(", ")} WHERE user_id = ?`, ...values);
  return { ok: true };
}
