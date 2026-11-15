/**
 * Job details.
 *
 * This screen is where explainability becomes concrete: every dimension shows its
 * weight, its score, the reason it scored that way, and (where we looked and found
 * nothing) a concrete gap. Unknowns are shown as unknowns — never as failures.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, request } from '../lib/api.js';
import { useAsync } from '../lib/use-async.js';
import type { JobDetailResponse } from '../lib/types.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingRows,
  Modal,
  PageHeader,
  TextArea,
  cx,
} from '../components/ui.js';
import { bandLabel, formatRelativeTime, formatSalary, scoreTone } from '../lib/format.js';

type Feedback = 'relevant' | 'not_relevant';

export default function JobDetailPage() {
  const { jobId = '' } = useParams();
  const [busy, setBusy] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [creatingApplication, setCreatingApplication] = useState(false);

  const detail = useAsync<JobDetailResponse>(
    (signal) => request<JobDetailResponse>(`/jobs/${jobId}`, { signal }),
    [jobId],
  );

  if (detail.loading && !detail.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Loading job…" />
        <LoadingRows rows={4} />
      </div>
    );
  }

  if (detail.error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Job" />
        <ErrorState error={detail.error} onRetry={detail.reload} />
        <Link to="/jobs" className="text-sm text-brand-700 hover:underline dark:text-brand-300">
          ← Back to jobs
        </Link>
      </div>
    );
  }

  if (!detail.data) return null;

  const { job, match, state, application, documents } = detail.data;
  const tone = scoreTone(match?.score);
  // Never present a number as a verdict when nothing was verified to score.
  const unscoreable = match?.scoreable === false;
  const salary = formatSalary({
    salaryMin: job.salary?.min,
    salaryMax: job.salary?.max,
    salaryCurrency: job.salary?.currency,
    salaryPeriod: job.salary?.period,
  });

  const recomputeMatch = async (): Promise<void> => {
    setBusy('match');
    setActionError(undefined);
    try {
      await request(`/jobs/${jobId}/match`, { method: 'POST', body: {} });
      detail.reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not rescan this match.');
    } finally {
      setBusy(undefined);
    }
  };

  const toggleSaved = async (): Promise<void> => {
    setBusy('save');
    setActionError(undefined);
    try {
      await request(`/jobs/${jobId}/state`, { method: 'PUT', body: { saved: !state.saved } });
      detail.reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not update this job.');
    } finally {
      setBusy(undefined);
    }
  };

  const sendFeedback = async (relevance: Feedback): Promise<void> => {
    setBusy('feedback');
    setActionError(undefined);
    try {
      await request(`/jobs/${jobId}/feedback`, {
        method: 'POST',
        body: { relevance, ...(feedbackReason.trim() ? { reason: feedbackReason.trim() } : {}) },
      });
      setFeedbackOpen(false);
      setFeedbackReason('');
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not save your feedback.');
    } finally {
      setBusy(undefined);
    }
  };

  const startApplication = async (): Promise<void> => {
    setCreatingApplication(true);
    setActionError(undefined);
    try {
      await request('/applications', { method: 'POST', body: { jobId } });
      detail.reload();
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : 'Could not start an application.',
      );
    } finally {
      setCreatingApplication(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Link to="/jobs" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
          ← Back to jobs
        </Link>
      </div>

      <PageHeader
        title={job.title}
        description={`${job.company}${job.location.raw ? ` · ${job.location.raw}` : ''}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant={state.saved ? 'primary' : 'secondary'}
              loading={busy === 'save'}
              onClick={() => void toggleSaved()}
            >
              {state.saved ? 'Saved' : 'Save'}
            </Button>
            <a href={job.url} target="_blank" rel="noreferrer noopener">
              <Button variant="secondary">Open original ↗</Button>
            </a>
          </div>
        }
      />

      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
              {job.location.remote ? (
                <Badge tone="info">Remote</Badge>
              ) : (
                <Badge>{job.location.workplace}</Badge>
              )}
              <Badge>{job.employmentType.replace(/_/g, ' ')}</Badge>
              <Badge>{job.seniority}</Badge>
              {salary ? <Badge tone="neutral">{salary}</Badge> : null}
              <Badge tone="neutral">via {job.source.replace(/_/g, ' ')}</Badge>
              <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                Posted {formatRelativeTime(job.postedAt ?? job.firstSeenAt)} · checked{' '}
                {formatRelativeTime(job.lastCheckedAt)}
              </span>
            </div>
            <div className="space-y-4 p-5">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Job description
              </h2>
              <div className="space-y-3 text-sm leading-relaxed whitespace-pre-line text-slate-700 dark:text-slate-300">
                {job.description}
              </div>
              {job.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {job.tags.map((tag) => (
                    <Badge key={tag} tone="neutral">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </Card>

          {match ? (
            <Card>
              <CardHeader
                title="Why this scored what it scored"
                description="Deterministic checks against your verified facts. No guesswork is hidden from you."
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === 'match'}
                    onClick={() => void recomputeMatch()}
                  >
                    Recalculate
                  </Button>
                }
              />
              <div className="space-y-3 p-5">
                {match.excluded ? (
                  <Alert tone="warning" title="This role is excluded by your preferences">
                    <p>
                      {match.exclusionReason ?? 'It does not meet one of your hard requirements.'}
                    </p>
                  </Alert>
                ) : null}

                <ul className="space-y-3">
                  {match.breakdown.map((row) => (
                    <li key={row.label} className="space-y-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {row.label}
                          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                            {row.weightPercent}% of score
                          </span>
                        </span>
                        <span
                          className={cx(
                            'text-sm font-semibold',
                            row.status === 'match' && 'text-emerald-700 dark:text-emerald-300',
                            row.status === 'partial' && 'text-amber-700 dark:text-amber-300',
                            row.status === 'gap' && 'text-rose-700 dark:text-rose-300',
                            row.status === 'unknown' && 'text-slate-500 dark:text-slate-400',
                          )}
                        >
                          {row.scorePercent === null ? 'Unknown' : `${row.scorePercent}%`}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                          className={cx(
                            'h-full rounded-full',
                            row.status === 'match' && 'bg-emerald-500',
                            row.status === 'partial' && 'bg-amber-500',
                            row.status === 'gap' && 'bg-rose-500',
                            row.status === 'unknown' && 'bg-slate-400',
                          )}
                          style={{ width: `${row.scorePercent ?? 0}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{row.rationale}</p>
                      {row.unknowns.length > 0 ? (
                        <ul className="ml-4 list-disc text-xs text-slate-500 dark:text-slate-500">
                          {row.unknowns.map((unknown) => (
                            <li key={unknown}>{unknown}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>

                {match.evidence.length > 0 ? (
                  <div className="space-y-2 pt-3">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Evidence from your profile
                    </h3>
                    <ul className="space-y-1.5">
                      {match.evidence.slice(0, 8).map((item, index) => (
                        <li
                          key={`${item.factLabel}-${index}`}
                          className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                        >
                          <span aria-hidden="true">✓</span>
                          <span>
                            <strong>{item.factLabel}</strong> supports <em>{item.requirement}</em>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {match.gaps.length > 0 ? (
                  <div className="space-y-2 pt-3">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Gaps we found
                    </h3>
                    <ul className="space-y-1.5">
                      {match.gaps.map((gap, index) => (
                        <li
                          key={`${gap.requirement}-${index}`}
                          className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:bg-rose-950 dark:text-rose-200"
                        >
                          <span aria-hidden="true">✗</span>
                          <span>
                            <strong>{gap.requirement}</strong>
                            {gap.detail ? ` — ${gap.detail}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {match.unknowns.length > 0 ? (
                  <div className="space-y-2 pt-3">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      We could not determine
                    </h3>
                    <ul className="space-y-1.5">
                      {match.unknowns.map((unknown, index) => (
                        <li
                          key={`${unknown.requirement}-${index}`}
                          className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {unknown.detail ?? unknown.requirement}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                title="Not scored yet"
                description="Score this job against your verified profile to see exactly what fits and what does not."
                action={
                  <Button loading={busy === 'match'} onClick={() => void recomputeMatch()}>
                    Score this job
                  </Button>
                }
              />
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Compatibility</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={cx('text-4xl font-semibold tracking-tight', tone.text)}>
                {unscoreable ? '—' : match ? match.score : '—'}
              </span>
              {unscoreable ? (
                <Badge tone="neutral">Not enough information</Badge>
              ) : match ? (
                <Badge
                  tone={
                    match.band === 'strong' ? 'success' : match.band === 'good' ? 'info' : 'neutral'
                  }
                >
                  {bandLabel(match.band)}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {unscoreable
                ? 'Add verified facts to your profile to get a real score'
                : match
                  ? `${match.evidence.length} supporting fact${match.evidence.length === 1 ? '' : 's'}, ${match.gaps.length} gap${match.gaps.length === 1 ? '' : 's'}`
                  : 'Not scored yet'}
            </p>

            <div className="mt-4 space-y-2">
              {application ? (
                <Link to="/applications" className="block">
                  <Button variant="secondary" className="w-full">
                    View application
                  </Button>
                </Link>
              ) : (
                <Button
                  className="w-full"
                  loading={creatingApplication}
                  onClick={() => void startApplication()}
                >
                  Start application
                </Button>
              )}
              <Link to={`/jobs/${jobId}/studio`} className="block">
                <Button variant="secondary" className="w-full">
                  Prepare documents
                </Button>
              </Link>
              <Button variant="ghost" className="w-full" onClick={() => setFeedbackOpen(true)}>
                Give feedback
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Documents"
              description="Tailored for this role."
              action={undefined}
            />
            {documents.length === 0 ? (
              <p className="p-5 text-sm text-slate-500 dark:text-slate-400">
                No documents yet. Prepare a tailored resume or cover letter from the studio.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {documents.map((document) => (
                  <li
                    key={document.id}
                    className="flex items-center justify-between gap-2 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {document.kind === 'resume' ? 'Resume' : 'Cover letter'} v{document.version}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatRelativeTime(document.createdAt)}
                      </p>
                    </div>
                    <Badge
                      tone={
                        document.status === 'approved'
                          ? 'success'
                          : document.status === 'draft'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {document.status === 'draft' ? 'Needs review' : document.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5 text-xs text-slate-600 dark:text-slate-400">
            <p className="font-medium text-slate-800 dark:text-slate-200">You apply, always</p>
            <p className="mt-1">
              Job Hunter prepares your materials and can help you fill a form, but it never submits
              an application. You review every answer and send it yourself.
            </p>
          </Card>
        </aside>
      </div>

      <Modal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        title="Was this match useful?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFeedbackOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              loading={busy === 'feedback'}
              onClick={() => void sendFeedback('not_relevant')}
            >
              Not relevant
            </Button>
            <Button loading={busy === 'feedback'} onClick={() => void sendFeedback('relevant')}>
              Relevant
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Your feedback tunes future rankings. It never changes facts about your experience.
        </p>
        <label
          className="block text-sm font-medium text-slate-700 dark:text-slate-200"
          htmlFor="feedback-reason"
        >
          Anything specific? (optional)
        </label>
        <TextArea
          id="feedback-reason"
          value={feedbackReason}
          maxLength={300}
          onChange={(event) => setFeedbackReason(event.target.value)}
          placeholder="e.g. This is a management role, not hands-on engineering."
        />
      </Modal>
    </div>
  );
}
