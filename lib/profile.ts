import { all, get, parseJson, run, uid, nowIso } from "@/lib/db";
import type { EvidenceFact, Preferences, ProfileSnapshot } from "@/lib/matching/score";
import { highestEducation, totalYearsExperience } from "@/lib/matching/score";

export type ProfileRow = {
  id: string;
  user_id: string;
  headline: string;
  summary: string;
  location: string;
  phone: string;
  links_json: string;
  work_authorization: string;
  needs_sponsorship: number;
  timezone: string;
};

export type PrefsRow = {
  id: string;
  user_id: string;
  countries_json: string;
  cities_json: string;
  remote_preference: string;
  remote_regions_json: string;
  role_titles_json: string;
  role_families_json: string;
  seniority_json: string;
  job_types_json: string;
  industries_json: string;
  excluded_employers_json: string;
  excluded_keywords_json: string;
  excluded_locations_json: string;
  salary_floor: number | null;
  currency: string;
  language: string;
  work_authorization: string;
  needs_sponsorship: number;
  days_of_week_json: string;
  search_time: string;
  timezone: string;
  notify_email: number;
  notify_in_app: number;
  schedule_enabled: number;
  enabled_source_ids_json: string;
  updated_at: string;
};

export type EvidenceRow = {
  id: string;
  user_id: string;
  fact_type: string;
  title: string;
  organization: string;
  location: string;
  start_date: string | null;
  end_date: string | null;
  bullets_json: string;
  skills_json: string;
  state: string;
  verification_status: string;
  source_document_id: string | null;
  evidence_note: string;
  created_at: string;
  updated_at: string;
};

export function toPreferences(row: PrefsRow | undefined): Preferences {
  if (!row) {
    return {
      countries: [],
      cities: [],
      remotePreference: "remote",
      remoteRegions: [],
      roleTitles: [],
      roleFamilies: [],
      seniority: [],
      jobTypes: [],
      industries: [],
      excludedEmployers: [],
      excludedKeywords: [],
      excludedLocations: [],
      salaryFloor: null,
      currency: "USD",
      workAuthorization: "",
      needsSponsorship: false,
    };
  }
  return {
    countries: parseJson<string[]>(row.countries_json, []),
    cities: parseJson<string[]>(row.cities_json, []),
    remotePreference: row.remote_preference,
    remoteRegions: parseJson<string[]>(row.remote_regions_json, []),
    roleTitles: parseJson<string[]>(row.role_titles_json, []),
    roleFamilies: parseJson<string[]>(row.role_families_json, []),
    seniority: parseJson<string[]>(row.seniority_json, []),
    jobTypes: parseJson<string[]>(row.job_types_json, []),
    industries: parseJson<string[]>(row.industries_json, []),
    excludedEmployers: parseJson<string[]>(row.excluded_employers_json, []),
    excludedKeywords: parseJson<string[]>(row.excluded_keywords_json, []),
    excludedLocations: parseJson<string[]>(row.excluded_locations_json, []),
    salaryFloor: row.salary_floor,
    currency: row.currency,
    workAuthorization: row.work_authorization,
    needsSponsorship: Boolean(row.needs_sponsorship),
  };
}

export function toEvidenceFact(row: EvidenceRow): EvidenceFact {
  return {
    id: row.id,
    factType: row.fact_type,
    title: row.title,
    organization: row.organization,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    bullets: parseJson<string[]>(row.bullets_json, []),
    skills: parseJson<string[]>(row.skills_json, []),
    state: row.state,
    verificationStatus: row.verification_status,
    evidenceNote: row.evidence_note,
  };
}

export type ProfileContext = {
  profile: ProfileRow;
  prefsRow: PrefsRow;
  preferences: Preferences;
  evidence: EvidenceRow[];
  snapshot: ProfileSnapshot;
  baseResume: { id: string; filename: string; content_text: string } | null;
};

export function getProfileContext(userId: string): ProfileContext {
  const profile =
    get<ProfileRow>("SELECT * FROM candidate_profiles WHERE user_id = ?", userId) ??
    (() => {
      const now = nowIso();
      run(
        `INSERT INTO candidate_profiles (id, user_id, headline, summary, location, phone, links_json, work_authorization, needs_sponsorship, timezone, created_at, updated_at)
         VALUES (?, ?, '', '', '', '', '[]', '', 0, 'UTC', ?, ?)`,
        uid(),
        userId,
        now,
        now,
      );
      return get<ProfileRow>("SELECT * FROM candidate_profiles WHERE user_id = ?", userId)!;
    })();

  const prefsRow =
    get<PrefsRow>("SELECT * FROM job_preferences WHERE user_id = ?", userId) ??
    (() => {
      const now = nowIso();
      run(
        `INSERT INTO job_preferences (id, user_id) VALUES (?, ?)`,
        uid(),
        userId,
      );
      const created = get<PrefsRow>("SELECT * FROM job_preferences WHERE user_id = ?", userId)!;
      return { ...created, updated_at: now };
    })();

  const evidence = all<EvidenceRow>(
    "SELECT * FROM profile_evidence WHERE user_id = ? ORDER BY fact_type, start_date DESC",
    userId,
  );
  const facts = evidence.map(toEvidenceFact);
  const preferences = toPreferences(prefsRow);

  const snapshot: ProfileSnapshot = {
    headline: profile.headline,
    summary: profile.summary,
    location: profile.location,
    workAuthorization: profile.work_authorization,
    facts,
    yearsExperience: totalYearsExperience(facts),
    educationLevel: highestEducation(facts),
  };

  const baseResume = get<{ id: string; filename: string; content_text: string }>(
    "SELECT id, filename, content_text FROM resume_documents WHERE user_id = ? AND is_base = 1 ORDER BY created_at DESC LIMIT 1",
    userId,
  );

  return { profile, prefsRow, preferences, evidence, snapshot, baseResume: baseResume ?? null };
}

export function setPreferenceList(
  userId: string,
  column:
    | "countries_json"
    | "cities_json"
    | "remote_regions_json"
    | "role_titles_json"
    | "role_families_json"
    | "seniority_json"
    | "job_types_json"
    | "industries_json"
    | "excluded_employers_json"
    | "excluded_keywords_json"
    | "excluded_locations_json"
    | "days_of_week_json"
    | "enabled_source_ids_json",
  values: (string | number)[],
) {
  run(`UPDATE job_preferences SET ${column} = ?, updated_at = ? WHERE user_id = ?`, JSON.stringify(values), nowIso(), userId);
}
