/**
 * Onboarding: three steps that end with a verified profile.
 *
 * The order matters. We ask for preferences before uploading a CV so the very
 * first scan is relevant, and we require explicit verification of extracted
 * facts because nothing unverified may ever support a generated claim.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, request } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useAsync } from '../lib/use-async.js';
import type {
  FactsResponse,
  PreferencesResponse,
  ProfileResponse,
  ResumeRecord,
} from '../lib/types.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Progress,
  TextInput,
  cx,
} from '../components/ui.js';
import { ResumeUploader } from '../components/ResumeUploader.js';
import { FactVerifier } from '../components/FactVerifier.js';

const STEPS = ['Preferences', 'Upload your CV', 'Verify your facts'] as const;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [step, setStep] = useState(0);

  const profile = useAsync<ProfileResponse>(
    (signal) => request<ProfileResponse>('/profile', { signal }),
    [],
  );
  const facts = useAsync<FactsResponse>(
    (signal) => request<FactsResponse>('/profile/facts', { signal }),
    [],
  );
  const preferences = useAsync<PreferencesResponse>(
    (signal) => request<PreferencesResponse>('/preferences', { signal }),
    [],
  );

  const [titles, setTitles] = useState('');
  const [keywords, setKeywords] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(true);
  const [countries, setCountries] = useState('');
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | undefined>();
  const [uploadedResumes, setUploadedResumes] = useState<ResumeRecord[]>([]);

  const verified = facts.data?.summary.verified ?? 0;
  const total = facts.data?.summary.total ?? 0;
  const percent = total === 0 ? 0 : Math.round((verified / total) * 100);

  const savePreferences = async (): Promise<void> => {
    setSavingPreferences(true);
    setPreferenceError(undefined);
    try {
      await request('/preferences', {
        method: 'PUT',
        body: {
          targetTitles: splitList(titles),
          targetKeywords: splitList(keywords),
          remoteOnly,
          countryCodes: splitList(countries).map((code) => code.toUpperCase()),
        },
      });
      setStep(1);
    } catch (caught) {
      setPreferenceError(
        caught instanceof ApiError ? caught.message : 'Could not save your preferences.',
      );
    } finally {
      setSavingPreferences(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-1">
          <p className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Welcome{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Set up your job search
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Three short steps. After this, your daily scan runs on its own.
          </p>
        </header>

        <ol className="flex flex-wrap gap-2" aria-label="Onboarding steps">
          {STEPS.map((label, index) => {
            const state = index < step ? 'done' : index === step ? 'current' : 'upcoming';
            return (
              <li key={label} className="flex-1">
                <div
                  className={cx(
                    'rounded-lg border px-3 py-2 text-sm',
                    state === 'current' &&
                      'border-brand-300 bg-brand-50 font-medium text-brand-800 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200',
                    state === 'done' &&
                      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
                    state === 'upcoming' &&
                      'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
                  )}
                  aria-current={state === 'current' ? 'step' : undefined}
                >
                  <span className="mr-1.5 font-mono text-xs">{index + 1}</span>
                  {label}
                  {state === 'done' ? <span className="ml-1.5">✓</span> : null}
                </div>
              </li>
            );
          })}
        </ol>

        {step === 0 ? (
          <Card>
            <CardHeader
              title="What are you looking for?"
              description="These choices decide which jobs we fetch and how they are scored."
            />
            <div className="space-y-4 p-5">
              {preferenceError ? <Alert tone="danger">{preferenceError}</Alert> : null}

              <Field
                label="Job titles"
                required
                hint="Separate with commas. e.g. Backend Engineer, Data Analyst"
              >
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    value={titles}
                    aria-describedby={describedBy}
                    placeholder="Backend Engineer"
                    onChange={(event) => setTitles(event.target.value)}
                  />
                )}
              </Field>

              <Field
                label="Key skills"
                hint="Used to match job descriptions. Separate with commas."
              >
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    value={keywords}
                    aria-describedby={describedBy}
                    placeholder="typescript, postgresql, aws"
                    onChange={(event) => setKeywords(event.target.value)}
                  />
                )}
              </Field>

              <Field label="Countries" hint="Two-letter codes, or leave blank for worldwide.">
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    value={countries}
                    aria-describedby={describedBy}
                    placeholder="GH, NG, GB"
                    onChange={(event) => setCountries(event.target.value)}
                  />
                )}
              </Field>

              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-slate-300 text-brand-600"
                  checked={remoteOnly}
                  onChange={(event) => setRemoteOnly(event.target.checked)}
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                    Remote roles only
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    You can change this later in Settings.
                  </span>
                </span>
              </label>

              <div className="flex justify-end">
                <Button
                  onClick={() => void savePreferences()}
                  loading={savingPreferences}
                  disabled={titles.trim().length === 0}
                >
                  Continue
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {step === 1 ? (
          <Card>
            <CardHeader
              title="Upload your CV"
              description="PDF or DOCX. We extract facts, then you confirm each one before it is ever used."
            />
            <div className="space-y-4 p-5">
              <ResumeUploader
                onUploaded={(resume) => {
                  setUploadedResumes((current) => [resume, ...current]);
                  void facts.reload();
                }}
              />
              {uploadedResumes.length > 0 ? (
                <Alert tone="success" title="CV processed">
                  <p>
                    We found facts in <strong>{uploadedResumes[0]?.fileName}</strong>. Review and
                    verify them in the next step.
                  </p>
                </Alert>
              ) : null}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button onClick={() => setStep(2)} disabled={uploadedResumes.length === 0}>
                  Review facts
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card>
            <CardHeader
              title="Verify your facts"
              description="Only verified facts can appear in a match explanation or a tailored document."
              action={
                <Badge tone={verified > 0 ? 'success' : 'warning'}>
                  {verified} of {total} verified
                </Badge>
              }
            />
            <div className="space-y-4 p-5">
              <Progress value={percent} label="Profile verification progress" />
              {profile.loading ? (
                <p className="text-sm text-slate-500">Loading your facts…</p>
              ) : (
                <FactVerifier
                  facts={facts.data?.facts ?? []}
                  onChanged={() => {
                    void facts.reload();
                    void refresh();
                  }}
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => navigate('/jobs')}>
                    Skip for now
                  </Button>
                  <Button onClick={() => navigate('/')} disabled={verified === 0}>
                    Go to dashboard
                  </Button>
                </div>
              </div>
              {verified === 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Verify at least one fact to enable matching and document generation.
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {preferences.error ? <Alert tone="danger">{preferences.error.message}</Alert> : null}
      </div>
    </div>
  );
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
