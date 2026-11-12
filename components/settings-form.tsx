"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, PauseCircle, PlayCircle, Plus, Save, ShieldAlert, Trash2, X } from "lucide-react";

type Source = {
  id: string;
  name: string;
  slug: string;
  accessMethod: string;
  termsUrl: string;
  termsReviewedAt: string | null;
  supportedMarkets: string;
  notes: string;
  lastStatus: string | null;
  lastRunAt: string | null;
};

function Chips({ values, onChange, placeholder }: { values: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-1 rounded-full bg-[#f1eee9] px-2.5 py-1 text-[11px] font-medium text-ink ring-1 ring-line">
            {value}
            <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Remove ${value}`}>
              <X size={10} />
            </button>
          </span>
        ))}
        {!values.length ? <span className="text-[11px] text-muted">None</span> : null}
      </div>
      <div className="flex gap-1.5">
        <input
          className="field text-xs"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              const value = draft.trim();
              if (value && !values.includes(value)) onChange([...values, value]);
              setDraft("");
            }
          }}
        />
        <button
          type="button"
          className="btn-secondary btn-sm shrink-0"
          onClick={() => {
            const value = draft.trim();
            if (value && !values.includes(value)) onChange([...values, value]);
            setDraft("");
          }}
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

export function SettingsForm({
  initialProfile,
  initialPrefs,
  sources,
  enabledSourceIds,
}: {
  initialProfile: { headline: string; summary: string; location: string; workAuthorization: string; needsSponsorship: boolean; timezone: string };
  initialPrefs: {
    roleTitles: string[];
    countries: string[];
    remoteRegions: string[];
    remotePreference: string;
    seniority: string[];
    jobTypes: string[];
    industries: string[];
    salaryFloor: number | null;
    currency: string;
    excludedEmployers: string[];
    excludedKeywords: string[];
    excludedLocations: string[];
    searchTime: string;
    timezone: string;
    daysOfWeek: number[];
    notifyEmail: boolean;
    notifyInApp: boolean;
    scheduleEnabled: boolean;
  };
  sources: Source[];
  enabledSourceIds: string[];
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [enabled, setEnabled] = useState(enabledSourceIds);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const save = async (tag: string) => {
    setBusy(tag);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          headline: profile.headline,
          summary: profile.summary,
          location: profile.location,
          workAuthorization: profile.workAuthorization,
          needsSponsorship: profile.needsSponsorship,
          timezone: profile.timezone,
          preferences: { ...prefs, enabledSourceIds: enabled },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save settings");
      setMessage("Settings saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const toggleSource = async (id: string) => {
    const next = enabled.includes(id) ? enabled.filter((value) => value !== id) : [...enabled, id];
    setEnabled(next);
    setBusy(`source-${id}`);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabledSourceIds: next }),
      });
      if (!res.ok) throw new Error("Could not update sources");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: deleteConfirm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not delete account");
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deletion failed");
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <section id="market" className="card card-pad">
        <h2 className="text-sm font-semibold text-ink">Market &amp; role preferences</h2>
        <p className="mt-0.5 text-xs text-muted">Changes apply to the next search. Existing matches keep their stored reasoning.</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label">Target titles</label>
            <Chips values={prefs.roleTitles} onChange={(roleTitles) => setPrefs({ ...prefs, roleTitles })} placeholder="Software Engineer…" />
          </div>
          <div>
            <label className="field-label">Countries</label>
            <Chips values={prefs.countries} onChange={(countries) => setPrefs({ ...prefs, countries })} placeholder="Ghana…" />
          </div>
          <div>
            <label className="field-label">Remote regions</label>
            <Chips values={prefs.remoteRegions} onChange={(remoteRegions) => setPrefs({ ...prefs, remoteRegions })} placeholder="Worldwide…" />
          </div>
          <div>
            <label className="field-label">Remote preference</label>
            <select
              className="field text-xs"
              value={prefs.remotePreference}
              onChange={(event) => setPrefs({ ...prefs, remotePreference: event.target.value })}
            >
              <option value="remote">Remote only</option>
              <option value="hybrid">Remote or hybrid</option>
              <option value="onsite">On-site welcome</option>
              <option value="any">Any arrangement</option>
            </select>
          </div>
          <div>
            <label className="field-label">Excluded employers</label>
            <Chips
              values={prefs.excludedEmployers}
              onChange={(excludedEmployers) => setPrefs({ ...prefs, excludedEmployers })}
              placeholder="Company name…"
            />
          </div>
          <div>
            <label className="field-label">Excluded keywords</label>
            <Chips values={prefs.excludedKeywords} onChange={(excludedKeywords) => setPrefs({ ...prefs, excludedKeywords })} placeholder="unpaid…" />
          </div>
          <div>
            <label className="field-label">Excluded locations</label>
            <Chips
              values={prefs.excludedLocations}
              onChange={(excludedLocations) => setPrefs({ ...prefs, excludedLocations })}
              placeholder="City or country…"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">Salary floor</label>
              <input
                type="number"
                min={0}
                className="field text-xs"
                value={prefs.salaryFloor ?? ""}
                onChange={(event) => setPrefs({ ...prefs, salaryFloor: event.target.value ? Number(event.target.value) : null })}
              />
            </div>
            <div>
              <label className="field-label">Currency</label>
              <input
                className="field text-xs"
                value={prefs.currency}
                onChange={(event) => setPrefs({ ...prefs, currency: event.target.value.toUpperCase() })}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button type="button" className="btn-primary btn-sm" onClick={() => save("market")} disabled={busy === "market"}>
            {busy === "market" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save preferences
          </button>
          {message ? <span className="text-[11px] text-moss-700">{message}</span> : null}
          {error ? <span className="text-[11px] text-clay-700">{error}</span> : null}
        </div>
      </section>

      <section id="schedule" className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Daily schedule</h2>
            <p className="mt-0.5 text-xs text-muted">Timezone-aware, one run per scheduled window. Pause any time.</p>
          </div>
          <button
            type="button"
            className={`btn-sm btn ${prefs.scheduleEnabled ? "btn-secondary" : "btn-primary"}`}
            onClick={() => setPrefs({ ...prefs, scheduleEnabled: !prefs.scheduleEnabled })}
          >
            {prefs.scheduleEnabled ? <PauseCircle size={13} /> : <PlayCircle size={13} />}
            {prefs.scheduleEnabled ? "Pause automation" : "Resume automation"}
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="field-label" htmlFor="search-time">
              Search time
            </label>
            <input
              id="search-time"
              type="time"
              className="field text-xs"
              value={prefs.searchTime}
              onChange={(event) => setPrefs({ ...prefs, searchTime: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="settings-tz">
              Time zone
            </label>
            <input
              id="settings-tz"
              className="field text-xs"
              value={prefs.timezone}
              onChange={(event) => setPrefs({ ...prefs, timezone: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label">Days</label>
            <div className="flex gap-1">
              {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() =>
                    setPrefs({
                      ...prefs,
                      daysOfWeek: prefs.daysOfWeek.includes(index)
                        ? prefs.daysOfWeek.filter((value) => value !== index)
                        : [...prefs.daysOfWeek, index].sort(),
                    })
                  }
                  className={`grid h-7 w-7 place-items-center rounded-md text-[11px] font-semibold ring-1 ${
                    prefs.daysOfWeek.includes(index) ? "bg-ink text-white ring-ink" : "bg-surface text-muted ring-line"
                  }`}
                  aria-label={`Toggle day ${index + 1}`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-soft">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.notifyInApp} onChange={(event) => setPrefs({ ...prefs, notifyInApp: event.target.checked })} />
            In-app digest
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.notifyEmail} onChange={(event) => setPrefs({ ...prefs, notifyEmail: event.target.checked })} />
            Email digest
          </label>
        </div>
        <div className="mt-4">
          <button type="button" className="btn-primary btn-sm" onClick={() => save("schedule")} disabled={busy === "schedule"}>
            {busy === "schedule" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save schedule
          </button>
        </div>
      </section>

      <section id="sources" className="card card-pad">
        <h2 className="text-sm font-semibold text-ink">Approved sources</h2>
        <p className="mt-0.5 text-xs text-muted">
          Each adapter documents its access method and terms review. Disabling one takes effect on the next run.
        </p>
        <div className="mt-3 space-y-2">
          {sources.map((source) => (
            <div key={source.id} className="rounded-[10px] border border-line px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {source.name}
                    <span className="ml-1.5 text-[10px] font-normal text-muted">{source.supportedMarkets}</span>
                  </p>
                  <p className="text-[11px] text-muted">{source.accessMethod}</p>
                  <p className="text-[10px] text-muted">
                    Terms reviewed {source.termsReviewedAt ? new Date(source.termsReviewedAt).toLocaleDateString("en-GB") : "—"} · last run{" "}
                    {source.lastRunAt ? new Date(source.lastRunAt).toLocaleString("en-GB") : "never"}
                    {source.lastStatus ? ` · ${source.lastStatus}` : ""}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-[11px] font-medium text-ink-soft">
                  <input
                    type="checkbox"
                    checked={enabled.includes(source.id)}
                    onChange={() => toggleSource(source.id)}
                    disabled={busy === `source-${source.id}`}
                  />
                  Enabled
                </label>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted">{source.notes}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted">
          We never bypass logins, CAPTCHAs or rate limits. A source that blocks automated access is disabled, not worked around.
        </p>
      </section>

      <section className="card card-pad">
        <h2 className="text-sm font-semibold text-ink">Profile</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="set-headline">
              Headline
            </label>
            <input
              id="set-headline"
              className="field text-xs"
              value={profile.headline}
              onChange={(event) => setProfile({ ...profile, headline: event.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="set-summary">
              Summary
            </label>
            <textarea
              id="set-summary"
              className="field min-h-20 text-xs"
              value={profile.summary}
              onChange={(event) => setProfile({ ...profile, summary: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="set-location">
              Location
            </label>
            <input
              id="set-location"
              className="field text-xs"
              value={profile.location}
              onChange={(event) => setProfile({ ...profile, location: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="set-auth">
              Work authorization
            </label>
            <input
              id="set-auth"
              className="field text-xs"
              value={profile.workAuthorization}
              onChange={(event) => setProfile({ ...profile, workAuthorization: event.target.value })}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="flex items-center gap-2 text-[11px] text-ink-soft">
            <input
              type="checkbox"
              checked={profile.needsSponsorship}
              onChange={(event) => setProfile({ ...profile, needsSponsorship: event.target.checked })}
            />
            I need visa sponsorship
          </label>
          <button type="button" className="btn-primary btn-sm ml-auto" onClick={() => save("profile")} disabled={busy === "profile"}>
            {busy === "profile" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save profile
          </button>
        </div>
      </section>

      <section id="privacy" className="card card-pad">
        <h2 className="text-sm font-semibold text-ink">Privacy &amp; data</h2>
        <p className="mt-0.5 text-xs text-muted">
          Export everything we hold, or delete your account and all associated records. Resumes contain personal data, so we never
          share them between accounts.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/export" className="btn-secondary btn-sm">
            <Download size={12} /> Export my data (JSON)
          </a>
        </div>

        <div className="mt-4 rounded-[10px] border border-clay-100 bg-clay-50/50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-clay-700">
            <ShieldAlert size={13} /> Delete account
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-clay-700/80">
            This removes your profile, facts, resumes, matches, packages, approvals and audit trail. It cannot be undone.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="field max-w-40 text-xs"
              placeholder="Type DELETE"
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
            />
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={deleteAccount}
              disabled={deleteConfirm !== "DELETE" || busy === "delete"}
            >
              {busy === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete permanently
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
