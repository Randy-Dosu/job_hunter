/**
 * Resume and cover-letter studio (plan §12.5 and §12.6).
 *
 * Two rules drive this screen:
 *   1. Nothing is exportable until the user approves it.
 *   2. Every warning is shown next to the claim it belongs to, and approval of a
 *      document with warnings requires an explicit, worded acknowledgement.
 *
 * Editing re-runs the evidence check server-side, so the warnings shown here are
 * always the ones the server would block on.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, download, request } from '../lib/api.js';
import { useAsync } from '../lib/use-async.js';
import type { DocumentDetailResponse, GeneratedDocument, JobDetailResponse } from '../lib/types.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  TextArea,
  TextInput,
} from '../components/ui.js';
import { formatRelativeTime } from '../lib/format.js';

interface DocumentListResponse {
  documents: Array<GeneratedDocument & { job: { title: string; company: string } | null }>;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  needs_review: 'Needs review',
  approved: 'Approved',
  superseded: 'Superseded',
};

type ExportFormat = 'pdf' | 'docx' | 'txt' | 'json';

export default function StudioPage() {
  const { jobId, documentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  if (jobId) return <JobStudio jobId={jobId} />;

  if (documentId) {
    return <DocumentView documentId={documentId} />;
  }

  // The plan's flow is job-first; without a job we show the document library.
  const preselected = searchParams.get('jobId') ?? '';
  return (
    <DocumentLibrary
      preselectedJobId={preselected}
      onSelect={(id) => setSearchParams({ jobId: id })}
    />
  );
}

// ---------------------------------------------------------------- job studio

function JobStudio({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const detail = useAsync<JobDetailResponse>(
    (signal) => request<JobDetailResponse>(`/jobs/${jobId}`, { signal }),
    [jobId],
  );
  const [generating, setGenerating] = useState<'resume' | 'cover_letter' | undefined>();
  const [error, setError] = useState<string | undefined>();

  const generate = async (kind: 'resume' | 'cover_letter'): Promise<void> => {
    setGenerating(kind);
    setError(undefined);
    try {
      const result = await request<{ document: GeneratedDocument }>(`/jobs/${jobId}/documents`, {
        method: 'POST',
        body: { kind },
      });
      detail.reload();
      navigate(`/documents/${result.document.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not generate that document.');
    } finally {
      setGenerating(undefined);
    }
  };

  if (detail.loading && !detail.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Document studio" />
        <LoadingRows rows={3} />
      </div>
    );
  }
  if (detail.error) return <ErrorState error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return null;

  const { job, documents, match } = detail.data;
  const ready = (match?.score ?? 0) >= 45;

  return (
    <div className="space-y-5">
      <Link
        to={`/jobs/${jobId}`}
        className="text-sm text-slate-600 hover:underline dark:text-slate-400"
      >
        ← Back to job
      </Link>

      <PageHeader title="Document studio" description={`${job.title} at ${job.company}`} />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!ready ? (
        <Alert tone="warning" title="This role is a weak fit">
          <p>
            You are {match ? match.score : 'not'}% matched. You can still prepare documents, but
            your time may be better spent on the roles above.
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Tailored resume
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Reorders and rewrites your verified experience to match this posting. It cannot invent
            employers, dates or numbers.
          </p>
          <Button
            className="mt-4"
            loading={generating === 'resume'}
            onClick={() => void generate('resume')}
          >
            Generate resume
          </Button>
        </Card>
        <Card className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Cover letter</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            A short letter grounded in your verified facts and this job&apos;s requirements.
          </p>
          <Button
            className="mt-4"
            variant="secondary"
            loading={generating === 'cover_letter'}
            onClick={() => void generate('cover_letter')}
          >
            Generate cover letter
          </Button>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Documents for this job"
          description="Older versions are kept so you can compare."
        />
        {documents.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Generate a resume or cover letter to get started. Nothing leaves this page until you approve and export it."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white">
                    {document.kind === 'resume' ? 'Resume' : 'Cover letter'} · v{document.version}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatRelativeTime(document.createdAt)} ·{' '}
                    {document.warnings.length === 0
                      ? 'no warnings'
                      : `${document.warnings.length} warning${document.warnings.length === 1 ? '' : 's'}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      document.status === 'approved'
                        ? 'success'
                        : document.status === 'needs_review'
                          ? 'danger'
                          : document.status === 'draft'
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {STATUS_LABELS[document.status] ?? document.status}
                  </Badge>
                  <Link to={`/documents/${document.id}`}>
                    <Button variant="secondary" size="sm">
                      Open
                    </Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ document viewer

function DocumentView({ documentId }: { documentId: string }) {
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [editing, setEditing] = useState(false);

  const document = useAsync<DocumentDetailResponse>(
    (signal) => request<DocumentDetailResponse>(`/documents/${documentId}`, { signal }),
    [documentId],
  );

  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [sections, setSections] = useState<
    Array<{ heading: string; bullets: string[]; evidenceIds: string[] }>
  >([]);

  useEffect(() => {
    const content = document.data?.document.content;
    if (!content) return;
    setHeadline(content.headline);
    setSummary(content.summary ?? '');
    setSections(content.sections);
  }, [document.data]);

  const warnings = document.data?.document.warnings ?? [];
  const isApproved = document.data?.document.status === 'approved';

  const dirty = useMemo(() => {
    const content = document.data?.document.content;
    if (!content) return false;
    return (
      headline !== content.headline ||
      summary !== (content.summary ?? '') ||
      JSON.stringify(sections) !== JSON.stringify(content.sections)
    );
  }, [document.data, headline, summary, sections]);

  const save = async (): Promise<void> => {
    setBusy('save');
    setError(undefined);
    setNotice(undefined);
    try {
      await request(`/documents/${documentId}`, {
        method: 'PATCH',
        body: { content: { headline, summary, sections } },
      });
      document.reload();
      setEditing(false);
      setNotice('Saved. Warnings were re-checked against your verified profile.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save your edits.');
    } finally {
      setBusy(undefined);
    }
  };

  const approve = async (): Promise<void> => {
    setBusy('approve');
    setError(undefined);
    setNotice(undefined);
    try {
      await request(`/documents/${documentId}/approve`, {
        method: 'POST',
        body: { acknowledgeWarnings: warnings.length > 0 ? acknowledged : false },
      });
      document.reload();
      setNotice('Approved. You can now export it or attach it to an application.');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not approve this document. Resolve the warnings first.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  const exportAs = async (format: ExportFormat): Promise<void> => {
    setBusy(`export-${format}`);
    setError(undefined);
    try {
      const kind = document.data?.document.kind === 'cover_letter' ? 'cover-letter' : 'resume';
      const version = document.data?.document.version ?? 1;
      await download(
        `/documents/${documentId}/export?format=${format}`,
        `${kind}-v${version}.${format}`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Export failed.');
    } finally {
      setBusy(undefined);
    }
  };

  if (document.loading && !document.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Document" />
        <LoadingRows rows={4} />
      </div>
    );
  }
  if (document.error) return <ErrorState error={document.error} onRetry={document.reload} />;
  if (!document.data) return null;

  const { document: doc } = document.data;

  return (
    <div className="space-y-5">
      <Link
        to={`/jobs/${doc.jobId}/studio`}
        className="text-sm text-slate-600 hover:underline dark:text-slate-400"
      >
        ← Back to studio
      </Link>

      <PageHeader
        title={`${doc.kind === 'resume' ? 'Resume' : 'Cover letter'} · v${doc.version}`}
        description={`Generated ${formatRelativeTime(doc.createdAt)} · ${doc.content.sections.length} sections · ${doc.content.wordCount} words`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
              {editing ? 'Stop editing' : 'Edit'}
            </Button>
            {!isApproved ? (
              <Button
                variant="success"
                loading={busy === 'approve'}
                onClick={() => void approve()}
                disabled={warnings.length > 0 && !acknowledged}
              >
                Approve
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {warnings.length > 0 ? (
        <Alert
          tone="warning"
          title={`${warnings.length} claim${warnings.length === 1 ? '' : 's'} need your attention`}
        >
          <ul className="list-disc space-y-1 pl-4">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          {!isApproved ? (
            <div className="pt-2">
              <Checkbox
                label="I have reviewed these warnings and want to approve anyway"
                description="Only do this if every statement is genuinely true about your experience."
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
            </div>
          ) : null}
        </Alert>
      ) : (
        <Alert tone="success" title="Every claim checks out">
          <p>Each statement traces back to a verified fact in your profile.</p>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Preview"
            description="This is exactly what an employer or ATS will see."
            action={undefined}
          />
          <div className="space-y-5 p-6">
            {editing ? (
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Headline
                  </span>
                  <TextInput
                    value={headline}
                    onChange={(event) => setHeadline(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Summary
                  </span>
                  <TextArea value={summary} onChange={(event) => setSummary(event.target.value)} />
                </label>
                {sections.map((section, sectionIndex) => (
                  <div
                    key={`${section.heading}-${sectionIndex}`}
                    className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <TextInput
                      aria-label={`Section ${sectionIndex + 1} heading`}
                      value={section.heading}
                      onChange={(event) =>
                        setSections((current) =>
                          current.map((item, index) =>
                            index === sectionIndex
                              ? { ...item, heading: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <TextArea
                      aria-label={`Section ${sectionIndex + 1} bullets`}
                      value={section.bullets.join('\n')}
                      onChange={(event) =>
                        setSections((current) =>
                          current.map((item, index) =>
                            index === sectionIndex
                              ? { ...item, bullets: event.target.value.split('\n') }
                              : item,
                          ),
                        )
                      }
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      One bullet per line. Evidence links are preserved from the original draft.
                    </p>
                  </div>
                ))}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>
                    Save changes
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <header className="space-y-1 border-b border-slate-200 pb-4 dark:border-slate-800">
                  <p className="text-xl font-semibold text-slate-900 dark:text-white">
                    {doc.content.headline}
                  </p>
                  {doc.content.summary ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {doc.content.summary}
                    </p>
                  ) : null}
                </header>
                {doc.content.sections.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    This document has no sections. Edit it to add content, or regenerate it.
                  </p>
                ) : (
                  doc.content.sections.map((section, index) => (
                    <section key={`${section.heading}-${index}`} className="space-y-2">
                      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                        {section.heading}
                      </h3>
                      <ul className="space-y-1.5">
                        {section.bullets.map((bullet, bulletIndex) => (
                          <li
                            key={`${bulletIndex}-${bullet.slice(0, 12)}`}
                            className="flex gap-2 text-sm text-slate-700 dark:text-slate-300"
                          >
                            <span aria-hidden="true" className="text-slate-400">
                              •
                            </span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                      {section.evidenceIds.length > 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-500">
                          Grounded in {section.evidenceIds.length} verified fact
                          {section.evidenceIds.length === 1 ? '' : 's'}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          No verified evidence attached to this section.
                        </p>
                      )}
                    </section>
                  ))
                )}
              </>
            )}
          </div>
        </Card>

        <aside className="space-y-5">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Export</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isApproved
                ? 'Approved documents export as ATS-safe files.'
                : 'Approve the document to unlock PDF and DOCX export.'}
            </p>
            <div className="mt-3 space-y-2">
              {(['pdf', 'docx', 'txt'] as const).map((format) => (
                <Button
                  key={format}
                  variant="secondary"
                  className="w-full"
                  disabled={!isApproved}
                  loading={busy === `export-${format}`}
                  onClick={() => void exportAs(format)}
                >
                  Download {format.toUpperCase()}
                </Button>
              ))}
              <Button
                variant="ghost"
                className="w-full"
                loading={busy === 'export-json'}
                onClick={() => void exportAs('json')}
              >
                Download JSON (inspect)
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Provenance</h2>
            <dl className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex justify-between gap-2">
                <dt>Status</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-200">{doc.status}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Provider</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-200">
                  {doc.providerId ?? 'deterministic fallback'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Model</dt>
                <dd className="truncate font-medium text-slate-900 dark:text-slate-200">
                  {doc.model ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Approved</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-200">
                  {doc.approvedAt ? formatRelativeTime(doc.approvedAt) : 'not yet'}
                </dd>
              </div>
            </dl>
          </Card>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
            <span className="text-slate-600 dark:text-slate-400">Attach to the application</span>
            <Link to="/applications">
              <Button size="sm" variant="secondary">
                Tracker
              </Button>
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

// --------------------------------------------------------- document library

function DocumentLibrary({
  preselectedJobId,
  onSelect,
}: {
  preselectedJobId: string;
  onSelect: (jobId: string) => void;
}) {
  const documents = useAsync<DocumentListResponse>(
    (signal) => request<DocumentListResponse>('/documents', { signal }),
    [],
  );

  const [jobId, setJobId] = useState(preselectedJobId);

  if (documents.loading && !documents.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Documents" />
        <LoadingRows rows={4} />
      </div>
    );
  }
  if (documents.error) return <ErrorState error={documents.error} onRetry={documents.reload} />;

  const items = documents.data?.documents ?? [];
  const awaiting = items.filter(
    (item) => item.status === 'draft' || item.status === 'needs_review',
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Documents"
        description="Tailored resumes and cover letters. Nothing unapproved can be exported or attached."
        action={
          <Link to="/jobs">
            <Button variant="secondary">Choose a job</Button>
          </Link>
        }
      />

      {awaiting > 0 ? (
        <Alert
          tone="info"
          title={`${awaiting} document${awaiting === 1 ? '' : 's'} awaiting review`}
        >
          <p>Open a draft, check its warnings, and approve it when you are satisfied.</p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Open a job studio"
          description="Documents are always tailored to a specific listing."
        />
        <div className="flex flex-wrap items-end gap-3 p-5">
          <div className="min-w-48 flex-1">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Job ID</span>
              <TextInput
                placeholder="Paste a job id from the feed"
                value={jobId}
                onChange={(event) => setJobId(event.target.value)}
              />
            </label>
          </div>
          <Button disabled={jobId.trim().length === 0} onClick={() => onSelect(jobId.trim())}>
            Open studio
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="All documents" description={`${items.length} total`} />
        {items.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Pick a job from your feed and generate a tailored resume or cover letter."
            action={
              <Link to="/jobs">
                <Button>Browse jobs</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900 dark:text-white">
                    {item.kind === 'resume' ? 'Resume' : 'Cover letter'} · v{item.version}
                    {item.job ? (
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        {' '}
                        — {item.job.title} at {item.job.company}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatRelativeTime(item.createdAt)}
                    {item.warnings.length > 0 ? ` · ${item.warnings.length} warnings` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      item.status === 'approved'
                        ? 'success'
                        : item.status === 'needs_review'
                          ? 'danger'
                          : item.status === 'draft'
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {STATUS_LABELS[item.status] ?? item.status}
                  </Badge>
                  <Link to={`/documents/${item.id}`}>
                    <Button variant="secondary" size="sm">
                      Open
                    </Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
