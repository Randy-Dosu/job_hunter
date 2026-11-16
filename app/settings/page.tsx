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
        title="Settings"
        description="Search market, sources, schedule and data controls. Everything here is reversible except account deletion."
        meta={<span>Signed in as {user.email}</span>}
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

        <aside className="min-w-0 space-y-4">
          <section className="rounded-[10px] border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold text-ink">Audit trail</h2>
              <span className="text-[10.5px] text-muted">last {auditEvents.length}</span>
            </div>
            <ol className="max-h-[420px] divide-y divide-line overflow-auto">
              {auditEvents.map((event) => (
                <li key={event.id} className="px-4 py-2">
                  <p className="text-[11.5px] font-medium capitalize text-ink-soft">
                    {event.action.replaceAll(".", " · ").replaceAll("_", " ")}
                  </p>
                  <p className="text-[10px] tabular-nums text-muted">
                    {event.actor} · {new Date(event.created_at).toLocaleString("en-GB")}
                  </p>
                </li>
              ))}
              {!auditEvents.length ? <li className="px-4 py-3 text-[11.5px] text-muted">No activity yet.</li> : null}
            </ol>
            <p className="border-t border-line px-4 py-2 text-[10.5px] leading-relaxed text-muted">
              Every search, generation, approval and submission attempt is recorded with who did it.
            </p>
          </section>

          <section className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-[13px] font-semibold text-ink">Data handling</h2>
            <dl className="mt-2 space-y-2 text-[11.5px] leading-relaxed">
              <div>
                <dt className="font-medium text-ink">Storage</dt>
                <dd className="text-muted">SQLite on the server, one row per user with ownership checks on every read.</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">Generation</dt>
                <dd className="text-muted">
                  {process.env.LLM_API_KEY
                    ? "A provider is configured for summary rewrites only; output is validated afterwards."
                    : "No provider configured, so nothing leaves the server for generation."}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-ink">Sources</dt>
                <dd className="text-muted">Only the adapters you enable, fetched server-side with timeouts and bounded retries.</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">Retention</dt>
                <dd className="text-muted">Your data stays until you delete it; exports include the full audit history.</dd>
              </div>
            </dl>
          </section>

          <section id="notifications" className="rounded-[10px] border border-line bg-surface p-4">
            <h2 className="text-[13px] font-semibold text-ink">Account</h2>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-ink">{user.name}</p>
                <p className="truncate text-[11px] text-muted">{user.email}</p>
              </div>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="btn-secondary btn-sm">
                  Sign out
                </button>
              </form>
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
