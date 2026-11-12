import { AppShell, PageHeader } from "@/components/app-shell";
import { SettingsForm } from "@/components/settings-form";
import { SearchTrigger } from "@/components/search-trigger";
import { requireUser } from "@/lib/auth";
import { all, parseJson } from "@/lib/db";
import { getProfileContext } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const context = getProfileContext(user.id);
  const prefs = context.preferences;
  const enabledIds = parseJson<string[]>(context.prefsRow.enabled_source_ids_json, []);
  const sources = all<{
    id: string;
    name: string;
    slug: string;
    access_method: string;
    terms_url: string;
    terms_reviewed_at: string | null;
    supported_markets: string;
    notes: string;
    last_status: string | null;
    last_run_at: string | null;
  }>("SELECT * FROM job_sources ORDER BY name");
  const auditEvents = all<{ id: string; action: string; entity_type: string; created_at: string; actor: string; metadata_json: string }>(
    "SELECT * FROM audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 12",
    user.id,
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Control"
        title="Settings & privacy"
        description="Sources, schedule, automation level and data controls. Everything here is reversible except account deletion."
        actions={<SearchTrigger label="Run a search" variant="secondary" />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <SettingsForm
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
              daysOfWeek: parseJson<number[]>(context.prefsRow.days_of_week_json, [1, 2, 3, 4, 5]),
              notifyEmail: Boolean(context.prefsRow.notify_email),
              notifyInApp: Boolean(context.prefsRow.notify_in_app),
              scheduleEnabled: Boolean(context.prefsRow.schedule_enabled),
            }}
            sources={sources.map((source) => ({
              id: source.id,
              name: source.name,
              slug: source.slug,
              accessMethod: source.access_method,
              termsUrl: source.terms_url,
              termsReviewedAt: source.terms_reviewed_at,
              supportedMarkets: source.supported_markets,
              notes: source.notes,
              lastStatus: source.last_status,
              lastRunAt: source.last_run_at,
            }))}
            enabledSourceIds={enabledIds.length ? enabledIds : sources.map((source) => source.id)}
          />
        </div>

        <div className="space-y-5">
          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Audit trail</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">Every search, generation, approval and submission attempt is recorded.</p>
            <ol className="mt-2.5 space-y-2">
              {auditEvents.map((event) => (
                <li key={event.id} className="border-l-2 border-slate-200 pl-2.5">
                  <p className="text-[11px] font-medium capitalize text-slate-700">
                    {event.action.replaceAll(".", " · ").replaceAll("_", " ")}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {event.actor} · {new Date(event.created_at).toLocaleString("en-GB")}
                  </p>
                </li>
              ))}
              {!auditEvents.length ? <li className="text-[11px] text-slate-500">No activity yet.</li> : null}
            </ol>
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Data handling</h2>
            <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-slate-600">
              <li>
                <span className="font-semibold text-slate-800">Storage:</span> SQLite on the server, one row per user with ownership
                checks on every read.
              </li>
              <li>
                <span className="font-semibold text-slate-800">LLM:</span>{" "}
                {process.env.LLM_API_KEY ? "a provider is configured for summary rewrites only; validated afterwards." : "no provider is configured, so nothing leaves the server for generation."}
              </li>
              <li>
                <span className="font-semibold text-slate-800">Sources:</span> only the adapters you enable, fetched server-side with
                timeouts and bounded retries.
              </li>
              <li>
                <span className="font-semibold text-slate-800">Retention:</span> your data stays until you delete it; exports include the
                full audit history.
              </li>
            </ul>
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold text-slate-900">Account</h2>
            <p className="mt-1 text-xs text-slate-600">{user.name}</p>
            <p className="text-[11px] text-slate-500">{user.email}</p>
            <form action="/api/auth/logout" method="post" className="mt-3">
              <button type="submit" className="btn-secondary btn-sm">
                Sign out
              </button>
            </form>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
