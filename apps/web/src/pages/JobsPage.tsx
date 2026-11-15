/**
 * Job feed.
 *
 * Filters are explicit and reversible; every job shows where it came from and how
 * fresh it is. Scoring order is by score, because the product's whole premise is
 * that relevance should be explained rather than discovered by scrolling.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, request } from '../lib/api.js';
import { useAsync } from '../lib/use-async.js';
import type { JobListResponse, JobListItem, SourcesResponse } from '../lib/types.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
  PageHeader,
  Select,
  TextInput,
  cx,
} from '../components/ui.js';
import { bandLabel, formatRelativeTime, formatSalary, scoreTone } from '../lib/format.js';

const PAGE_SIZE = 20;

interface Filters {
  search: string;
  minScore: string;
  remote: boolean;
  source: string;
  countryCode: string;
  sort: string;
  savedOnly: boolean;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  minScore: '',
  remote: false,
  source: '',
  countryCode: '',
  sort: 'score',
  savedOnly: false,
};

export default function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMinScore = searchParams.get('minScore') ?? '';
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, minScore: initialMinScore });
  const [page, setPage] = useState(1);
  const [busyJob, setBusyJob] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.minScore) params.set('minScore', filters.minScore);
    if (filters.remote) params.set('remote', 'true');
    if (filters.source) params.set('sources', filters.source);
    if (filters.countryCode) params.set('countryCode', filters.countryCode);
    if (filters.savedOnly) params.set('saved', 'true');
    if (filters.sort === 'company') params.set('sort', 'company');
    return params.toString();
  }, [filters, page]);

  const jobs = useAsync<JobListResponse>(
    (signal) => request<JobListResponse>(`/jobs?${query}`, { signal }),
    [query],
  );
  const sources = useAsync<SourcesResponse>(
    (signal) => request<SourcesResponse>('/sources', { signal }),
    [],
  );

  const totalPages = jobs.data ? Math.max(1, Math.ceil(jobs.data.total / PAGE_SIZE)) : 1;

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const clearFilters = (): void => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setSearchParams({}, { replace: true });
  };

  const toggleSaved = async (job: JobListItem, saved: boolean): Promise<void> => {
    setBusyJob(job.id);
    setActionError(undefined);
    try {
      await request(`/jobs/${job.id}/state`, { method: 'PUT', body: { saved } });
      jobs.setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === job.id ? { ...item, saved } : item)),
            }
          : current,
      );
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not update that job.');
    } finally {
      setBusyJob(undefined);
    }
  };

  const dismiss = async (job: JobListItem): Promise<void> => {
    setBusyJob(job.id);
    setActionError(undefined);
    try {
      await request(`/jobs/${job.id}/state`, { method: 'PUT', body: { dismissed: true } });
      jobs.setData((current) =>
        current
          ? { ...current, items: current.items.filter((item) => item.id !== job.id) }
          : current,
      );
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not dismiss that job.');
    } finally {
      setBusyJob(undefined);
    }
  };

  const hasFilters =
    filters.search !== '' ||
    filters.minScore !== '' ||
    filters.remote ||
    filters.source !== '' ||
    filters.countryCode !== '' ||
    filters.savedOnly;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Jobs"
        description="Every listing is matched against your verified profile. Nothing here has been applied to."
        action={
          <Button variant="secondary" onClick={jobs.reload} loading={jobs.refreshing}>
            Refresh
          </Button>
        }
      />

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2">
            <Field label="Search">
              {(id) => (
                <TextInput
                  id={id}
                  type="search"
                  placeholder="Title, company or skill"
                  value={filters.search}
                  onChange={(event) => updateFilter('search', event.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label="Minimum score">
            {(id) => (
              <Select
                id={id}
                value={filters.minScore}
                onChange={(event) => updateFilter('minScore', event.target.value)}
              >
                <option value="">Any score</option>
                <option value="80">Strong (80+)</option>
                <option value="65">Good (65+)</option>
                <option value="45">Fair (45+)</option>
              </Select>
            )}
          </Field>
          <Field label="Source">
            {(id) => (
              <Select
                id={id}
                value={filters.source}
                onChange={(event) => updateFilter('source', event.target.value)}
              >
                <option value="">All sources</option>
                {sources.data?.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Country">
            {(id) => (
              <TextInput
                id={id}
                placeholder="e.g. GH"
                maxLength={2}
                value={filters.countryCode}
                onChange={(event) => updateFilter('countryCode', event.target.value.toUpperCase())}
              />
            )}
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-600"
              checked={filters.remote}
              onChange={(event) => updateFilter('remote', event.target.checked)}
            />
            Remote only
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-600"
              checked={filters.savedOnly}
              onChange={(event) => updateFilter('savedOnly', event.target.checked)}
            />
            Saved only
          </label>
          <Field label="">
            {(id) => (
              <Select
                id={id}
                aria-label="Sort order"
                value={filters.sort}
                onChange={(event) => updateFilter('sort', event.target.value)}
              >
                <option value="score">Newest first</option>
                <option value="company">Company A–Z</option>
              </Select>
            )}
          </Field>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
          <span className="ml-auto text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
            {jobs.data ? `${jobs.data.total} listing${jobs.data.total === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </Card>

      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      {jobs.loading && !jobs.data ? <LoadingRows rows={5} /> : null}
      {jobs.error ? <ErrorState error={jobs.error} onRetry={jobs.reload} /> : null}

      {jobs.data && jobs.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title={hasFilters ? 'No jobs match those filters' : 'No jobs yet'}
            description={
              hasFilters
                ? 'Try widening the score range or clearing the source filter.'
                : 'Your daily scan will fill this feed. You can also run a scan now from Settings.'
            }
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/settings#sources">
                  <Button>Set up sources</Button>
                </Link>
              )
            }
          />
        </Card>
      ) : null}

      {jobs.data && jobs.data.items.length > 0 ? (
        <>
          <ul className="space-y-3">
            {jobs.data.items.map((job) => (
              <li key={job.id}>
                <JobCard
                  job={job}
                  busy={busyJob === job.id}
                  onToggleSaved={() => void toggleSaved(job, !job.saved)}
                  onDismiss={() => void dismiss(job)}
                />
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-2" aria-label="Pagination">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function JobCard({
  job,
  busy,
  onToggleSaved,
  onDismiss,
}: {
  job: JobListItem;
  busy: boolean;
  onToggleSaved: () => void;
  onDismiss: () => void;
}) {
  const tone = scoreTone(job.match?.score);
  // A score is only meaningful when the profile carried verified evidence.
  const unscoreable = job.match?.scoreable === false;
  const salary = formatSalary({
    salaryMin: job.salary?.min,
    salaryMax: job.salary?.max,
    salaryCurrency: job.salary?.currency,
    salaryPeriod: job.salary?.period,
  });

  return (
    <Card className="p-4 transition-shadow hover:shadow-md sm:p-5">
      <div className="flex gap-4">
        <div className="shrink-0">
          <div
            className={cx(
              'grid size-12 place-items-center rounded-xl text-sm font-semibold ring-2',
              tone.bg,
              tone.text,
              tone.ring,
            )}
            aria-label={
              unscoreable
                ? 'Not enough verified information to score'
                : job.match
                  ? `Match score ${job.match.score}`
                  : 'Not yet scored'
            }
          >
            {unscoreable ? '?' : job.match ? job.match.score : '—'}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">
                <Link to={`/jobs/${job.id}`} className="hover:underline">
                  {job.title}
                </Link>
              </h2>
              <p className="truncate text-sm text-slate-600 dark:text-slate-400">
                {job.company}
                {job.location.raw ? ` · ${job.location.raw}` : ''}
              </p>
            </div>
            {unscoreable ? (
              <Badge tone="neutral">Not enough information</Badge>
            ) : job.match ? (
              <Badge
                tone={
                  job.match.band === 'strong'
                    ? 'success'
                    : job.match.band === 'good'
                      ? 'info'
                      : 'neutral'
                }
              >
                {bandLabel(job.match.band)} fit
              </Badge>
            ) : null}
          </div>

          {job.match?.summary ? (
            <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
              {job.match.summary}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {job.location.remote ? <Badge tone="info">Remote</Badge> : null}
            {job.freshness === 'new' ? <Badge tone="success">New</Badge> : null}
            {salary ? <Badge tone="neutral">{salary}</Badge> : null}
            <Badge tone="neutral">{job.source.replace(/_/g, ' ')}</Badge>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Posted {formatRelativeTime(job.postedAt ?? job.firstSeenAt)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Button
            variant={job.saved ? 'primary' : 'secondary'}
            size="sm"
            loading={busy}
            onClick={onToggleSaved}
            aria-pressed={job.saved}
          >
            {job.saved ? 'Saved' : 'Save'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>
            Not for me
          </Button>
        </div>
      </div>
    </Card>
  );
}
