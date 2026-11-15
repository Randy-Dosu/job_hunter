/**
 * Dashboard: what needs your attention today.
 *
 * Each card answers one question — what is new, what fits, what is waiting on
 * you, when the next scan runs — and links to the screen that can act on it.
 */

import { Link } from 'react-router-dom';
import { request } from '../lib/api.js';
import { useAsync } from '../lib/use-async.js';
import type { DashboardResponse } from '../lib/types.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Progress,
  cx,
} from '../components/ui.js';
import { APPLICATION_STATUS_LABELS, formatRelativeTime, scoreTone } from '../lib/format.js';

export default function DashboardPage() {
  const { data, error, loading, reload } = useAsync<DashboardResponse>(
    (signal) => request<DashboardResponse>('/dashboard', { signal }),
    [],
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Loading your latest matches…" />
        <LoadingRows rows={4} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Dashboard"
          description="We could not load your summary. Your data is safe — this is a read failure."
        />
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  }

  if (!data) return null;

  const needsReview = data.documents.awaitingReview;
  const unverified = data.profile.unverifiedFacts;
  const setupIncomplete = !data.profile.ready || unverified > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Your daily scan runs automatically. Everything below is ready for your review."
        action={
          <Button variant="secondary" onClick={reload}>
            Refresh
          </Button>
        }
      />

      {setupIncomplete ? (
        <Alert
          tone="warning"
          title="Finish setting up your profile"
          action={
            <Link to="/profile">
              <Button size="sm" variant="secondary">
                Review profile
              </Button>
            </Link>
          }
        >
          <p>
            {data.profile.resumes === 0
              ? 'Upload a CV so we can extract your experience.'
              : `${unverified} extracted fact${unverified === 1 ? '' : 's'} still need your confirmation.`}{' '}
            Matches and documents stay limited until your facts are verified.
          </p>
        </Alert>
      ) : null}

      {needsReview > 0 ? (
        <Alert
          tone="info"
          title={`${needsReview} document${needsReview === 1 ? '' : 's'} waiting for you`}
          action={
            <Link to="/documents">
              <Button size="sm">Review</Button>
            </Link>
          }
        >
          <p>Drafts cannot be exported or attached to an application until you approve them.</p>
        </Alert>
      ) : null}

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="New in the last 24h"
          value={data.jobs.newLast24h}
          hint={`${data.jobs.total} active listings tracked`}
          to="/jobs"
        />
        <StatCard
          label="Strong matches"
          value={data.jobs.highMatches}
          hint="Scored 75 or higher"
          to="/jobs?minScore=75"
          tone="success"
        />
        <StatCard
          label="Active applications"
          value={data.applications.total}
          hint={nextApplicationHint(data)}
          to="/applications"
        />
        <ScanCard scan={data.scan} schedule={data.schedule} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Your strongest matches"
            description="Ranked by fit against your verified profile."
            action={
              <Link
                to="/jobs"
                className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                See all jobs
              </Link>
            }
          />
          {data.jobs.topMatches.length === 0 ? (
            <EmptyState
              title="No matches yet"
              description="Once a scan finds listings that fit your preferences, they will appear here."
              action={
                <Link to="/settings">
                  <Button variant="secondary">Check your sources</Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.jobs.topMatches.map((match) => {
                const tone = scoreTone(match.score);
                return (
                  <li key={match.jobId}>
                    <Link
                      to={`/jobs/${match.jobId}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <span
                        className={cx(
                          'grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold ring-2',
                          tone.bg,
                          tone.text,
                          tone.ring,
                        )}
                        aria-label={`${match.score} percent match`}
                      >
                        {match.score}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900 dark:text-white">
                          {match.title}
                        </p>
                        <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                          {match.company}
                          {match.location ? ` · ${match.location}` : ''}
                        </p>
                      </div>
                      <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                        {match.remote ? <Badge tone="info">Remote</Badge> : null}
                        {match.freshness === 'new' ? <Badge tone="success">New</Badge> : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Needs your attention"
            description="Next actions across your applications."
          />
          {data.applications.upcoming.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              description="Set a next action on an application to see reminders here."
              action={
                <Link to="/applications">
                  <Button variant="secondary" size="sm">
                    Open tracker
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.applications.upcoming.map((item) => (
                <li key={item.id} className="px-5 py-3">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {item.job?.title ?? 'Application'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{item.job?.company}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge tone="brand">
                      {APPLICATION_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {item.nextActionAt ? formatRelativeTime(item.nextActionAt) : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ProfileReadinessCard profile={data.profile} />
    </div>
  );
}

function nextApplicationHint(data: DashboardResponse): string {
  const byStatus = data.applications.byStatus;
  const applied = (byStatus.applied ?? 0) + (byStatus.assessment ?? 0) + (byStatus.interview ?? 0);
  if (applied === 0) return 'Nothing sent yet — you submit every application yourself';
  return `${applied} awaiting a response`;
}

function StatCard({
  label,
  value,
  hint,
  to,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  hint: string;
  to: string;
  tone?: 'neutral' | 'success';
}) {
  return (
    <Link to={to} className="block">
      <Card className="h-full p-5 transition-shadow hover:shadow-md">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <p
          className={cx(
            'mt-1 text-3xl font-semibold tracking-tight',
            tone === 'success'
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-slate-900 dark:text-white',
          )}
        >
          {value}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      </Card>
    </Link>
  );
}

function ScanCard({
  scan,
  schedule,
}: {
  scan: DashboardResponse['scan'];
  schedule: DashboardResponse['schedule'];
}) {
  const tone =
    scan?.status === 'failed'
      ? 'danger'
      : scan?.status === 'partial'
        ? 'warning'
        : scan?.status === 'succeeded'
          ? 'success'
          : 'neutral';

  return (
    <Card className="h-full p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Daily scan</p>
        <Badge tone={tone}>{scan ? scan.status : 'not run yet'}</Badge>
      </div>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
        {scan?.jobsNew ?? 0}
        <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">
          new last run
        </span>
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {schedule?.nextRunAt
          ? `Next scan ${formatRelativeTime(schedule.nextRunAt).toLowerCase()}`
          : 'No schedule configured'}
        {schedule && !schedule.enabled ? ' (paused)' : ''}
      </p>
      {scan?.errorSummary ? (
        <p className="mt-2 line-clamp-2 text-xs text-amber-700 dark:text-amber-400">
          {scan.errorSummary}
        </p>
      ) : null}
      <Link
        to="/settings#sources"
        className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
      >
        Manage sources
      </Link>
    </Card>
  );
}

function ProfileReadinessCard({ profile }: { profile: DashboardResponse['profile'] }) {
  const total = profile.verifiedFacts + profile.unverifiedFacts;
  const percent = total === 0 ? 0 : (profile.verifiedFacts / total) * 100;

  return (
    <Card>
      <CardHeader
        title="Profile readiness"
        description="Documents and match explanations are only as good as your verified facts."
        action={
          <Link to="/profile">
            <Button variant="secondary" size="sm">
              Manage profile
            </Button>
          </Link>
        }
      />
      <div className="space-y-3 p-5">
        <Progress value={percent} label="Verified facts" />
        <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
          <span>
            <strong className="text-slate-900 dark:text-white">{profile.verifiedFacts}</strong>{' '}
            verified
          </span>
          <span>
            <strong className="text-slate-900 dark:text-white">{profile.unverifiedFacts}</strong>{' '}
            awaiting confirmation
          </span>
          <span>
            <strong className="text-slate-900 dark:text-white">{profile.resumes}</strong> CV
            {profile.resumes === 1 ? '' : 's'} on file
          </span>
        </div>
      </div>
    </Card>
  );
}
