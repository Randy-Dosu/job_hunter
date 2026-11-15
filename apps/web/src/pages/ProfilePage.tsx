/**
 * Profile (plan §12.1).
 *
 * Facts are the product's evidence base, so this screen is organised around them:
 * verification progress first, then the facts themselves, then the base profile
 * fields that feed document headers.
 */

import { useEffect, useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { useAsync } from '../lib/use-async.js';
import type {
  FactsResponse,
  ProfileContent,
  ProfileResponse,
  ResumeListResponse,
} from '../lib/types.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  LoadingRows,
  PageHeader,
  Progress,
  TextArea,
  TextInput,
} from '../components/ui.js';
import { ErrorState } from '../components/ui.js';
import { FactVerifier } from '../components/FactVerifier.js';
import { ResumeUploader } from '../components/ResumeUploader.js';

export default function ProfilePage() {
  const profile = useAsync<ProfileResponse>(
    (signal) => request<ProfileResponse>('/profile', { signal }),
    [],
  );
  const facts = useAsync<FactsResponse>(
    (signal) => request<FactsResponse>('/profile/facts', { signal }),
    [],
  );
  const resumes = useAsync<ResumeListResponse>(
    (signal) => request<ResumeListResponse>('/resumes', { signal }),
    [],
  );

  const [content, setContent] = useState<ProfileContent | undefined>();
  const [fullName, setFullName] = useState('');
  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const record = profile.data?.profile;
    if (!record) return;
    setContent(record.content);
    setFullName(record.content.contact.fullName ?? '');
    setHeadline(record.headline ?? '');
    setSummary(record.summary ?? '');
  }, [profile.data]);

  const saveProfile = async (): Promise<void> => {
    if (!content) return;
    setSaving(true);
    setSaveError(undefined);
    setSaved(false);
    try {
      // The endpoint replaces the whole profile document, so send it back intact.
      await request('/profile', {
        method: 'PUT',
        body: {
          content: {
            ...content,
            headline,
            summary,
            contact: { ...content.contact, fullName },
          },
          headline,
          summary,
        },
      });
      setSaved(true);
      profile.reload();
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  if (profile.loading && !profile.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Profile" />
        <LoadingRows rows={4} />
      </div>
    );
  }
  if (profile.error) return <ErrorState error={profile.error} onRetry={profile.reload} />;
  if (!profile.data) return null;

  const completeness = facts.data?.summary ?? { total: 0, verified: 0, unverified: 0, byKind: {} };
  const percent =
    completeness.total === 0 ? 0 : Math.round((completeness.verified / completeness.total) * 100);
  const unverified = completeness.unverified;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Profile"
        description="Your verified facts are the only source for match explanations and generated documents."
        action={
          <Badge tone={unverified === 0 && completeness.total > 0 ? 'success' : 'warning'}>
            {percent}% verified
          </Badge>
        }
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              Verification progress
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {completeness.verified} of {completeness.total} facts confirmed
              {unverified > 0 ? ` · ${unverified} still need you` : ''}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void profile.reload();
              void facts.reload();
            }}
            loading={facts.refreshing}
          >
            Refresh
          </Button>
        </div>
        <div className="mt-3">
          <Progress value={percent} label="Facts verified" />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Add or replace your CV"
          description="We extract facts from PDF or DOCX and never publish the file."
        />
        <div className="space-y-3 p-5">
          <ResumeUploader
            compact
            onUploaded={() => {
              void facts.reload();
              void resumes.reload();
            }}
          />
          {resumes.data && resumes.data.resumes.length > 0 ? (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {resumes.data.resumes.map((resume) => (
                <li key={resume.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="truncate text-slate-800 dark:text-slate-200">
                    {resume.fileName}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {resume.parseStatus === 'parsed' ? 'parsed' : resume.parseStatus}
                    {resume.isPrimary ? ' · primary' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="How you appear on documents"
          description="Used for the header of every generated resume and cover letter."
        />
        <div className="space-y-4 p-5">
          {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
          {saved ? <Alert tone="success">Profile saved.</Alert> : null}
          <Field label="Full name" required>
            {(id) => (
              <TextInput
                id={id}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Headline" hint="One line, e.g. Senior Backend Engineer">
            {(id) => (
              <TextInput
                id={id}
                value={headline}
                onChange={(event) => setHeadline(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Summary"
            hint="Two or three sentences. Facts only — you will verify anything we extract."
          >
            {(id) => (
              <TextArea
                id={id}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button loading={saving} disabled={!content} onClick={() => void saveProfile()}>
              Save profile
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Facts"
          description="Confirm each statement. Unverified facts are never used as evidence."
          action={<Badge tone="neutral">{completeness.total} total</Badge>}
        />
        <div className="p-5">
          <FactVerifier
            facts={facts.data?.facts ?? []}
            onChanged={() => {
              void facts.reload();
            }}
          />
        </div>
      </Card>
    </div>
  );
}
