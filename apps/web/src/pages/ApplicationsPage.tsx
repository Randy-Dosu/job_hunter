/**
 * Application tracker (plan §12.7 and §12.8).
 *
 * The tracker records what *you* did. "Applied" is only ever set because the user
 * confirmed they sent it — there is no system path to that state, and the UI says
 * so in the one place it matters.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, request } from '../lib/api.js';
import { formatRelativeTime } from '../lib/format.js';
import { useAsync } from '../lib/use-async.js';
import type {
  ApplicationDetailResponse,
  ApplicationListResponse,
  PrepareQueueResponse,
} from '../lib/types.js';
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
  Select,
  TextArea,
  cx,
} from '../components/ui.js';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_ORDER,
  STATUS_TRANSITIONS,
} from '../lib/format.js';

export default function ApplicationsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [noteFor, setNoteFor] = useState<string | undefined>();
  const [noteText, setNoteText] = useState('');
  const [detailId, setDetailId] = useState<string | undefined>();

  const applications = useAsync<ApplicationListResponse>(
    (signal) =>
      request<ApplicationListResponse>(
        `/applications?pageSize=100${statusFilter ? `&status=${statusFilter}` : ''}`,
        { signal },
      ),
    [statusFilter],
  );

  const counts = applications.data?.counts ?? {};

  const queue = useAsync<PrepareQueueResponse>(
    (signal) => request<PrepareQueueResponse>('/applications/prepare-queue', { signal }),
    [],
  );
  const [accepting, setAccepting] = useState(false);
  const acceptReady = (queue.data?.items ?? []).filter(
    (item) => item.status !== 'ready_for_user' && (item.checklist ?? []).length === 0,
  ).length;
  const [queueNotice, setQueueNotice] = useState<string | undefined>();
  const [queueError, setQueueError] = useState<string | undefined>();

  const prepareNow = async (): Promise<void> => {
    setAccepting(true);
    setQueueError(undefined);
    setQueueNotice(undefined);
    try {
      const result = await request<{ prepared: number; skipped: number }>('/applications/prepare', {
        method: 'POST',
        body: {},
      });
      setQueueNotice(
        result.prepared > 0
          ? `Prepared ${result.prepared} application${result.prepared === 1 ? '' : 's'}. Nothing has been sent — review each one below.`
          : 'Nothing new to prepare right now. Check your minimum match score and daily limit.',
      );
      queue.reload();
      applications.reload();
    } catch (caught) {
      setQueueError(
        caught instanceof ApiError ? caught.message : 'Could not prepare applications.',
      );
    } finally {
      setAccepting(false);
    }
  };

  const acceptAllReady = async (): Promise<void> => {
    const ready = (queue.data?.items ?? []).filter(
      (item) => item.status !== 'ready_for_user' && (item.checklist ?? []).length === 0,
    );
    if (ready.length === 0) return;
    setAccepting(true);
    setQueueError(undefined);
    setQueueNotice(undefined);
    try {
      const result = await request<{ accepted: number }>('/applications/accept-prepared', {
        method: 'POST',
        body: { applicationIds: ready.map((item) => item.applicationId) },
      });
      setQueueNotice(
        `Accepted ${result.accepted}. They are yours to send whenever you are ready — we never send them.`,
      );
      queue.reload();
      applications.reload();
    } catch (caught) {
      setQueueError(
        caught instanceof ApiError ? caught.message : 'Could not accept these packages.',
      );
    } finally {
      setAccepting(false);
    }
  };

  const changeStatus = async (id: string, status: string): Promise<void> => {
    setBusy(`${id}:${status}`);
    setError(undefined);
    try {
      await request(`/applications/${id}`, { method: 'PATCH', body: { status } });
      applications.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update that application.');
    } finally {
      setBusy(undefined);
    }
  };

  const addNote = async (): Promise<void> => {
    if (!noteFor || noteText.trim().length === 0) return;
    setBusy(`note:${noteFor}`);
    setError(undefined);
    try {
      await request(`/applications/${noteFor}/notes`, {
        method: 'POST',
        body: { message: noteText.trim() },
      });
      setNoteFor(undefined);
      setNoteText('');
      applications.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save that note.');
    } finally {
      setBusy(undefined);
    }
  };

  const archive = async (id: string): Promise<void> => {
    setBusy(`archive:${id}`);
    setError(undefined);
    try {
      await request(`/applications/${id}`, { method: 'DELETE' });
      applications.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not archive that application.');
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Applications"
        description="Everything you have saved or sent. You record what happened; we never submit anything."
        action={
          <Link to="/jobs">
            <Button variant="secondary">Find jobs</Button>
          </Link>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {queue.data && queue.data.items.length > 0 ? (
        <Card>
          <CardHeader
            title="Prepared for you"
            description="We drafted these from your verified facts. Accepting approves the documents; sending is still yours to do — nothing is submitted for you."
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">{queue.data.counts.ready} ready</Badge>
                {queue.data.counts.needsReview > 0 ? (
                  <Badge tone="warning">{queue.data.counts.needsReview} to approve</Badge>
                ) : null}
              </div>
            }
          />
          <div className="space-y-3 p-5">
            {queueError ? <Alert tone="danger">{queueError}</Alert> : null}
            {queueNotice ? <Alert tone="success">{queueNotice}</Alert> : null}

            <ul className="space-y-3">
              {queue.data.items.slice(0, 8).map((item) => (
                <li
                  key={item.applicationId ?? `${item.jobId}:${item.title}`}
                  className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {item.title}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {item.company}
                        {item.preparedAt
                          ? ` · prepared ${formatRelativeTime(item.preparedAt)}`
                          : ''}
                      </p>
                    </div>
                    <Badge tone={item.status === 'ready_for_user' ? 'success' : 'warning'}>
                      {item.status === 'ready_for_user'
                        ? 'Ready to send'
                        : 'Draft — needs approval'}
                    </Badge>
                  </div>
                  {(item.checklist ?? []).length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
                      {(item.checklist ?? []).map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={accepting}
                onClick={() => void acceptAllReady()}
                disabled={acceptReady === 0}
              >
                Accept {acceptReady} draft{acceptReady === 1 ? '' : 's'}
              </Button>
              <Button variant="ghost" loading={accepting} onClick={() => void prepareNow()}>
                Prepare more now
              </Button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {queue.data.remainingToday} more can be prepared today. Accepting a package does not
              send it.
            </p>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStatusFilter('')}
          aria-pressed={statusFilter === ''}
          className={cx(
            'rounded-full px-3 py-1 text-xs font-medium',
            statusFilter === ''
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
          )}
        >
          All ({Object.values(counts).reduce((sum, value) => sum + value, 0)})
        </button>
        {APPLICATION_STATUS_ORDER.map((status) => {
          const count = counts[status] ?? 0;
          if (count === 0 && statusFilter !== status) return null;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              aria-pressed={statusFilter === status}
              className={cx(
                'rounded-full px-3 py-1 text-xs font-medium',
                statusFilter === status
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
              )}
            >
              {APPLICATION_STATUS_LABELS[status]} ({count})
            </button>
          );
        })}
      </div>

      {applications.loading && !applications.data ? <LoadingRows rows={4} /> : null}
      {applications.error ? (
        <ErrorState error={applications.error} onRetry={applications.reload} />
      ) : null}

      {applications.data && applications.data.items.length === 0 ? (
        <Card>
          <EmptyState
            title={statusFilter ? 'Nothing in this stage' : 'No applications yet'}
            description={
              statusFilter
                ? 'Try another stage, or clear the filter.'
                : 'Start an application from any job you have scored. You will always submit it yourself.'
            }
            action={
              <Link to="/jobs">
                <Button>Browse jobs</Button>
              </Link>
            }
          />
        </Card>
      ) : null}

      {applications.data && applications.data.items.length > 0 ? (
        <div className="space-y-3">
          {applications.data.items.map((application) => {
            const allowed = STATUS_TRANSITIONS[application.status] ?? [];
            return (
              <Card key={application.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">
                      {application.job ? (
                        <Link to={`/jobs/${application.job.id}`} className="hover:underline">
                          {application.job.title}
                        </Link>
                      ) : (
                        'Application'
                      )}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {application.job?.company}
                      {application.job?.locationRaw ? ` · ${application.job.locationRaw}` : ''}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <Badge tone="brand">{APPLICATION_STATUS_LABELS[application.status]}</Badge>
                      <span>Started {formatRelativeTime(application.createdAt)}</span>
                      {application.appliedAt ? (
                        <span>· Applied {formatRelativeTime(application.appliedAt)}</span>
                      ) : null}
                      {application.nextActionAt ? (
                        <span>· Next action {formatRelativeTime(application.nextActionAt)}</span>
                      ) : null}
                    </div>
                    {application.lastEvent?.message ? (
                      <p className="mt-2 line-clamp-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                        {application.lastEvent.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {allowed.length > 0 ? (
                      <Select
                        aria-label={`Change status for ${application.job?.title ?? 'application'}`}
                        value=""
                        disabled={busy?.startsWith(application.id)}
                        onChange={(event) => {
                          const next = event.target.value;
                          if (next) void changeStatus(application.id, next);
                        }}
                      >
                        <option value="">Move to…</option>
                        {allowed.map((status) => (
                          <option key={status} value={status}>
                            {APPLICATION_STATUS_LABELS[status] ?? status}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone="neutral">Final stage</Badge>
                    )}
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => setDetailId(application.id)}>
                        Details
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setNoteFor(application.id);
                          setNoteText('');
                        }}
                      >
                        Add note
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}

      <Modal
        open={noteFor !== undefined}
        onClose={() => setNoteFor(undefined)}
        title="Add a note"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoteFor(undefined)}>
              Cancel
            </Button>
            <Button
              loading={busy?.startsWith('note:')}
              disabled={noteText.trim().length === 0}
              onClick={() => void addNote()}
            >
              Save note
            </Button>
          </>
        }
      >
        <TextArea
          aria-label="Note"
          value={noteText}
          maxLength={2000}
          placeholder="Recruiter call booked for Tuesday. Asked for salary expectations."
          onChange={(event) => setNoteText(event.target.value)}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Notes are private to you and included in your data export.
        </p>
      </Modal>

      {detailId ? (
        <ApplicationDetail
          id={detailId}
          onClose={() => setDetailId(undefined)}
          onArchive={() => {
            void archive(detailId);
            setDetailId(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function ApplicationDetail({
  id,
  onClose,
  onArchive,
}: {
  id: string;
  onClose: () => void;
  onArchive: () => void;
}) {
  const detail = useAsync<ApplicationDetailResponse>(
    (signal) => request<ApplicationDetailResponse>(`/applications/${id}`, { signal }),
    [id],
  );

  // The server returns exactly the documents attached to this application.
  const attached = useMemo(() => detail.data?.application.documents ?? [], [detail.data]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Application details"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="danger" onClick={onArchive}>
            Archive
          </Button>
        </>
      }
    >
      {detail.loading && !detail.data ? <LoadingRows rows={2} /> : null}
      {detail.error ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
      {detail.data ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Status</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {detail.data.application.statusLabel}
              {detail.data.application.allowedTransitions.length > 0
                ? ` · next: ${detail.data.application.allowedTransitions
                    .map((status) => APPLICATION_STATUS_LABELS[status] ?? status)
                    .join(', ')}`
                : ' · final stage'}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Timeline</h3>
            <ol className="mt-2 space-y-2 border-l border-slate-200 pl-4 dark:border-slate-700">
              {detail.data.application.events.map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-brand-500" />
                  <p className="text-sm text-slate-800 dark:text-slate-200">
                    {event.type.replace(/_/g, ' ')}
                    {event.message ? ` — ${event.message}` : ''}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatRelativeTime(event.createdAt)}
                  </p>
                </li>
              ))}
              {detail.data.application.events.length === 0 ? (
                <li className="text-sm text-slate-500">No activity recorded yet.</li>
              ) : null}
            </ol>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Attached documents
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {attached.length} approved document{attached.length === 1 ? '' : 's'} attached to this
              application.
            </p>
            {attached.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {attached.slice(0, 5).map((document) => (
                  <li key={document.id}>
                    <Link
                      to={`/documents/${document.id}`}
                      className="text-sm text-brand-700 hover:underline dark:text-brand-300"
                    >
                      {document.kind === 'resume' ? 'Resume' : 'Cover letter'} v{document.version}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Link
                to="/documents"
                className="mt-1 inline-block text-sm text-brand-700 hover:underline dark:text-brand-300"
              >
                Prepare documents →
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
