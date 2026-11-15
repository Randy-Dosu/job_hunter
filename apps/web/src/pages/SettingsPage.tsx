/**
 * Settings (plan §12.9): preferences, schedule, sources, privacy, export, deletion.
 *
 * Privacy actions are deliberately heavy-handed: export is one click, deletion
 * requires the password and a typed confirmation. That asymmetry is intentional.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.js';
import { ApiError, download, request } from '../lib/api.js';
import { useAsync } from '../lib/use-async.js';
import type {
  AuditEvent,
  JobPreferences,
  PreferencesResponse,
  ScanSchedule,
  PrivacySummary,
  SourcesResponse,
} from '../lib/types.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ErrorState,
  Field,
  LoadingRows,
  PageHeader,
  Select,
  TextInput,
  cx,
} from '../components/ui.js';

const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'temporary',
  'internship',
  'freelance',
] as const;
const SENIORITY_LEVELS = [
  'intern',
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'executive',
] as const;
const WORKPLACE_TYPES = ['remote', 'hybrid', 'onsite'] as const;

type Tab = 'search' | 'sources' | 'privacy';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('search');
  const { user, signOut } = useAuth();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description={user ? `Signed in as ${user.email}` : 'Manage your search, sources and data.'}
        action={
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Settings sections">
        {(
          [
            ['search', 'Search & schedule'],
            ['sources', 'Sources'],
            ['privacy', 'Privacy & data'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cx(
              'rounded-lg px-3 py-1.5 text-sm font-medium',
              tab === value
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'search' ? <SearchSettings /> : null}
      {tab === 'sources' ? <SourceSettings /> : null}
      {tab === 'privacy' ? <PrivacySettings /> : null}
    </div>
  );
}

// ------------------------------------------------------------- search settings

function SearchSettings() {
  const data = useAsync<PreferencesResponse>(
    (signal) => request<PreferencesResponse>('/preferences', { signal }),
    [],
  );
  const [form, setForm] = useState<JobPreferences | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    if (data.data?.preferences) setForm(data.data.preferences);
  }, [data.data]);

  if (data.loading && !data.data) return <LoadingRows rows={3} />;
  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} />;
  if (!form) {
    return (
      <Alert tone="warning" title="No preferences yet">
        <p>Your preferences are created when you finish onboarding.</p>
      </Alert>
    );
  }

  const update = <K extends keyof JobPreferences>(key: K, value: JobPreferences[K]): void => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await request('/preferences', {
        method: 'PUT',
        body: {
          ...form,
          minSalary: form.minSalary ?? undefined,
          salaryCurrency: form.salaryCurrency ?? undefined,
        },
      });
      setNotice('Preferences saved.');
      data.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save your preferences.');
    } finally {
      setSaving(false);
    }
  };

  const schedule = data.data?.schedule;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="What you are looking for"
          description="Hard filters run before scoring: excluded roles never appear in your feed."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {error ? (
            <div className="sm:col-span-2">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
          {notice ? (
            <div className="sm:col-span-2">
              <Alert tone="success">{notice}</Alert>
            </div>
          ) : null}

          <Field label="Job titles" hint="Comma separated">
            {(id) => (
              <TextInput
                id={id}
                value={form.targetTitles.join(', ')}
                onChange={(event) => update('targetTitles', split(event.target.value))}
              />
            )}
          </Field>
          <Field label="Key skills" hint="Comma separated">
            {(id) => (
              <TextInput
                id={id}
                value={form.targetKeywords.join(', ')}
                onChange={(event) => update('targetKeywords', split(event.target.value))}
              />
            )}
          </Field>
          <Field label="Exclude keywords" hint="Any listing containing these is hidden">
            {(id) => (
              <TextInput
                id={id}
                value={form.excludedKeywords.join(', ')}
                onChange={(event) => update('excludedKeywords', split(event.target.value))}
              />
            )}
          </Field>
          <Field label="Exclude companies">
            {(id) => (
              <TextInput
                id={id}
                value={form.excludedCompanies.join(', ')}
                onChange={(event) => update('excludedCompanies', split(event.target.value))}
              />
            )}
          </Field>
          <Field label="Countries" hint="Two-letter codes; blank means worldwide">
            {(id) => (
              <TextInput
                id={id}
                value={form.countryCodes.join(', ')}
                onChange={(event) =>
                  update(
                    'countryCodes',
                    split(event.target.value).map((code) => code.toUpperCase()),
                  )
                }
              />
            )}
          </Field>
          <Field label="Minimum annual salary" hint="Leave blank to ignore salary">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min={0}
                value={form.minSalary ?? ''}
                onChange={(event) =>
                  update('minSalary', event.target.value === '' ? null : Number(event.target.value))
                }
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Work arrangement
            </p>
            <div className="mt-1.5 flex flex-wrap gap-3">
              <Checkbox
                label="Remote only"
                checked={form.remoteOnly}
                onChange={(event) => update('remoteOnly', event.target.checked)}
              />
              {WORKPLACE_TYPES.map((type) => (
                <Checkbox
                  key={type}
                  label={type}
                  checked={form.workplaceTypes.includes(type)}
                  onChange={(event) =>
                    update(
                      'workplaceTypes',
                      toggle(form.workplaceTypes, type, event.target.checked),
                    )
                  }
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Employment type
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {EMPLOYMENT_TYPES.map((type) => (
                <FilterChip
                  key={type}
                  label={type.replace(/_/g, ' ')}
                  active={form.employmentTypes.includes(type)}
                  onClick={() =>
                    update(
                      'employmentTypes',
                      toggle(form.employmentTypes, type, !form.employmentTypes.includes(type)),
                    )
                  }
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Seniority</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {SENIORITY_LEVELS.map((level) => (
                <FilterChip
                  key={level}
                  label={level}
                  active={form.seniorityLevels.includes(level)}
                  onClick={() =>
                    update(
                      'seniorityLevels',
                      toggle(form.seniorityLevels, level, !form.seniorityLevels.includes(level)),
                    )
                  }
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end sm:col-span-2">
            <Button loading={saving} onClick={() => void save()}>
              Save preferences
            </Button>
          </div>
        </div>
      </Card>

      <ScheduleCard schedule={schedule} onSaved={data.reload} />
    </div>
  );
}

function ScheduleCard({
  schedule,
  onSaved,
}: {
  schedule: ScanSchedule | null | undefined;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [hour, setHour] = useState(schedule?.scanHourLocal ?? 8);
  const [timeZone, setTimeZone] = useState(
    schedule?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    if (!schedule) return;
    setEnabled(schedule.enabled);
    setHour(schedule.scanHourLocal);
    setTimeZone(schedule.timeZone);
  }, [schedule]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await request('/preferences/schedule', {
        method: 'PUT',
        body: { enabled, timeZone, scanHourLocal: hour },
      });
      setNotice('Schedule updated.');
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update the schedule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Daily scan"
        description="Runs once a day in your time zone. Pausing stops new jobs from being fetched."
        action={
          <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Active' : 'Paused'}</Badge>
        }
      />
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        {error ? (
          <div className="sm:col-span-3">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
        {notice ? (
          <div className="sm:col-span-3">
            <Alert tone="success">{notice}</Alert>
          </div>
        ) : null}

        <div className="sm:col-span-3">
          <Checkbox
            label="Run the daily scan"
            description="Missed runs catch up automatically the next time the worker runs."
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </div>

        <Field label="Run at" hint="Local time">
          {(id) => (
            <Select id={id} value={hour} onChange={(event) => setHour(Number(event.target.value))}>
              {Array.from({ length: 24 }, (_, value) => (
                <option key={value} value={value}>
                  {String(value).padStart(2, '0')}:00
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Time zone">
          {(id) => (
            <TextInput
              id={id}
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
            />
          )}
        </Field>

        <div className="flex items-end">
          <Button loading={saving} onClick={() => void save()}>
            Save schedule
          </Button>
        </div>

        <p className="text-xs text-slate-500 sm:col-span-3 dark:text-slate-400">
          {schedule?.nextRunAt
            ? `Next run: ${new Date(schedule.nextRunAt).toLocaleString()}`
            : 'No run scheduled yet.'}
        </p>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------- source settings

function SourceSettings() {
  const sources = useAsync<SourcesResponse>(
    (signal) => request<SourcesResponse>('/sources', { signal }),
    [],
  );
  const preferences = useAsync<PreferencesResponse>(
    (signal) => request<PreferencesResponse>('/preferences', { signal }),
    [],
  );
  const [enabledSources, setEnabledSources] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    if (preferences.data?.preferences)
      setEnabledSources(preferences.data.preferences.enabledSources);
  }, [preferences.data]);

  const save = async (): Promise<void> => {
    const prefs = preferences.data?.preferences;
    if (!prefs) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await request('/preferences', {
        method: 'PUT',
        body: { ...prefs, enabledSources, minSalary: prefs.minSalary ?? undefined },
      });
      setNotice('Sources updated. The next scan uses these.');
      preferences.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update your sources.');
    } finally {
      setSaving(false);
    }
  };

  if (sources.loading && !sources.data) return <LoadingRows rows={4} />;
  if (sources.error) return <ErrorState error={sources.error} onRetry={sources.reload} />;
  if (!sources.data) return null;

  const automated = sources.data.sources.filter((source) => source.automated);
  const manual = sources.data.sources.filter((source) => !source.automated);

  return (
    <div className="space-y-5" id="sources">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Alert tone="info" title="How we access sources">
        <p>
          We only fetch sources that publish a permitted, documented feed. Sites that forbid
          automated access are offered as manual search links instead — we never scrape them or
          bypass their protections.
        </p>
      </Alert>

      <Card>
        <CardHeader
          title="Automated sources"
          description="Fetched during your daily scan."
          action={
            <Button size="sm" loading={saving} onClick={() => void save()}>
              Save sources
            </Button>
          }
        />
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {automated.map((source) => (
            <li
              key={source.id}
              className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                  {source.name}
                  {!source.configured ? <Badge tone="warning">Not configured</Badge> : null}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {source.complianceNote}
                </p>
              </div>
              <Checkbox
                label={`Use ${source.name}`}
                checked={enabledSources.includes(source.id)}
                onChange={(event) =>
                  setEnabledSources((current) =>
                    event.target.checked
                      ? [...current, source.id]
                      : current.filter((id) => id !== source.id),
                  )
                }
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Manual sources"
          description="Open these to search yourself. You can still track what you find."
        />
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {manual.map((source) => (
            <li
              key={source.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium text-slate-900 dark:text-white">{source.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {source.complianceNote}
                </p>
              </div>
              <Badge tone="neutral">Manual only</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Pre-filled searches
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Your titles and locations are pre-applied, so a manual search takes one click.
        </p>
        <ManualLinks />
      </Card>
    </div>
  );
}

function ManualLinks() {
  const links = useAsync<{ links: Array<{ id: string; name: string; url: string }> }>(
    (signal) =>
      request<{ links: Array<{ id: string; name: string; url: string }> }>(
        '/sources/manual-links',
        { signal },
      ),
    [],
  );

  if (links.loading && !links.data) return <LoadingRows rows={1} />;
  if (!links.data || links.data.links.length === 0) {
    return (
      <p className="mt-2 text-sm text-slate-500">Add target titles to generate search links.</p>
    );
  }

  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {links.data.links.map((link) => (
        <li key={link.id}>
          <a href={link.url} target="_blank" rel="noreferrer noopener">
            <Button variant="secondary" size="sm">
              {link.name} ↗
            </Button>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------- privacy settings

function PrivacySettings() {
  const summary = useAsync<PrivacySummary>(
    (signal) => request<PrivacySummary>('/privacy/summary', { signal }),
    [],
  );
  const audit = useAsync<{ events: AuditEvent[]; retentionDays: number }>(
    (signal) =>
      request<{ events: AuditEvent[]; retentionDays: number }>('/privacy/audit', { signal }),
    [],
  );

  const [exporting, setExporting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const exportData = async (): Promise<void> => {
    setExporting(true);
    setError(undefined);
    try {
      await download(
        '/privacy/export',
        `job-hunter-export-${new Date().toISOString().slice(0, 10)}.json`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async (): Promise<void> => {
    setDeleting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await request('/privacy/delete', {
        method: 'POST',
        body: { password, confirm: confirmation },
      });
      window.location.href = '/signin';
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete your account.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <CardHeader
          title="What we store"
          description="A summary of the data attached to your account."
        />
        <div className="p-5">
          {summary.loading && !summary.data ? (
            <LoadingRows rows={2} />
          ) : summary.data ? (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(summary.data.counts).map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <dt className="text-xs text-slate-500 capitalize dark:text-slate-400">
                      {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </dt>
                    <dd className="text-lg font-semibold text-slate-900 dark:text-white">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{summary.data.note}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Audit events are kept for {summary.data.retention.auditEventDays} days, browser
                sessions for {summary.data.retention.browserSessionDays} days.
              </p>
            </>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Export your data"
          description="A single JSON file with everything we hold."
        />
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Includes your profile, facts, matches, documents and application history.
          </p>
          <Button variant="secondary" loading={exporting} onClick={() => void exportData()}>
            Download export
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Recent account activity"
          description={`The last ${audit.data?.events.length ?? 0} events recorded for your account.`}
        />
        <div className="max-h-72 overflow-y-auto p-5">
          {audit.data && audit.data.events.length > 0 ? (
            <ul className="space-y-1.5 text-sm">
              {audit.data.events.map((event) => (
                <li key={event.id} className="flex justify-between gap-3">
                  <span className="text-slate-700 dark:text-slate-300">
                    {event.action.replace(/\./g, ' ')}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No activity recorded yet.</p>
          )}
        </div>
      </Card>

      <Card className="border-rose-200 dark:border-rose-900">
        <CardHeader
          title="Delete your account"
          description="Permanently removes your data after a 7-day grace period."
        />
        <div className="space-y-4 p-5">
          <Alert tone="danger" title="This cannot be undone after the grace period">
            <p>
              Your profile, facts, documents, applications and sessions are deleted. Jobs you saved
              are removed with the account.
            </p>
          </Alert>
          <Field label="Your password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <Field label="Type DELETE to confirm" required>
            {(id) => (
              <TextInput
                id={id}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button
              variant="danger"
              loading={deleting}
              disabled={password.length === 0 || confirmation !== 'DELETE'}
              onClick={() => void deleteAccount()}
            >
              Delete my account
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------- helpers

function split(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggle(list: string[], value: string, include: boolean): string[] {
  if (include) return list.includes(value) ? list : [...list, value];
  return list.filter((item) => item !== value);
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'rounded-full px-3 py-1 text-xs font-medium capitalize',
        active
          ? 'bg-brand-600 text-white'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
      )}
    >
      {label}
    </button>
  );
}
