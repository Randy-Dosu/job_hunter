import { requireUser } from "@/lib/auth";
import { getProfileContext } from "@/lib/profile";
import { all } from "@/lib/db";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { parseJson } from "@/lib/db";

export default async function OnboardingPage() {
  const user = await requireUser();
  const context = getProfileContext(user.id);
  const sources = all<{ id: string; name: string; slug: string; access_method: string; enabled: number }>(
    "SELECT id, name, slug, access_method, enabled FROM job_sources ORDER BY name",
  );
  const prefs = context.preferences;
  const enabledIds = parseJson<string[]>(context.prefsRow.enabled_source_ids_json, []);
  const days = parseJson<number[]>(context.prefsRow.days_of_week_json, [1, 2, 3, 4, 5]);

  return (
    <OnboardingWizard
      name={user.name}
      initialProfile={{
        headline: context.profile.headline,
        summary: context.profile.summary,
        location: context.profile.location,
        workAuthorization: context.profile.work_authorization,
        needsSponsorship: Boolean(context.profile.needs_sponsorship),
        timezone: context.profile.timezone,
      }}
      initialPrefs={{
        roleTitles: prefs.roleTitles,
        countries: prefs.countries,
        remoteRegions: prefs.remoteRegions,
        remotePreference: prefs.remotePreference,
        seniority: prefs.seniority,
        jobTypes: prefs.jobTypes,
        industries: prefs.industries,
        salaryFloor: prefs.salaryFloor,
        currency: prefs.currency,
        excludedEmployers: prefs.excludedEmployers,
        excludedKeywords: prefs.excludedKeywords,
        excludedLocations: prefs.excludedLocations,
        searchTime: context.prefsRow.search_time,
        timezone: context.prefsRow.timezone,
        daysOfWeek: days,
        notifyEmail: Boolean(context.prefsRow.notify_email),
        notifyInApp: Boolean(context.prefsRow.notify_in_app),
        scheduleEnabled: Boolean(context.prefsRow.schedule_enabled),
        enabledSourceIds: enabledIds.length ? enabledIds : sources.filter((source) => source.enabled).map((source) => source.id),
      }}
      sources={sources.map((source) => ({
        id: source.id,
        name: source.name,
        slug: source.slug,
        accessMethod: source.access_method,
        enabled: Boolean(source.enabled),
      }))}
      baseResumeText={context.baseResume?.content_text ?? null}
    />
  );
}
