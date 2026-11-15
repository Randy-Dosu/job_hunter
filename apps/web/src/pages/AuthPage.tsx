/**
 * Sign in / sign up.
 *
 * Sign-up states plainly what the product does and does not do, and requires an
 * explicit terms + privacy acceptance (recorded server-side with a version).
 */

import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Button, Card, Checkbox, Field, TextInput } from '../components/ui.js';

const MIN_PASSWORD = 12;

function passwordProblem(password: string): string | undefined {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  return undefined;
}

export default function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isSignUp = mode === 'signup';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(undefined);
    setFieldErrors({});

    if (isSignUp) {
      const problem = passwordProblem(password);
      if (problem) {
        setFieldErrors({ password: problem });
        return;
      }
      if (!acceptedTerms) {
        setFieldErrors({ acceptedTerms: 'Please accept the terms to continue.' });
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isSignUp) {
        await signUp({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          acceptedTerms: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        navigate('/onboarding', { replace: true });
      } else {
        await signIn({ email: email.trim(), password });
        navigate(from, { replace: true });
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        const details = caught.fieldErrors();
        if (Object.keys(details).length > 0) setFieldErrors(details);
        else setFormError(caught.message);
      } else {
        setFormError(caught instanceof Error ? caught.message : 'Something went wrong.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-slate-50 lg:grid-cols-2 dark:bg-slate-950">
      {/* Product explanation — what we do and, just as importantly, what we don't. */}
      <aside className="hidden flex-col justify-between bg-brand-700 p-10 text-brand-50 lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold text-white">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-lg bg-white/15 text-sm font-bold"
          >
            JH
          </span>
          Job Hunter
        </div>

        <div className="max-w-md space-y-6">
          <h1 className="text-3xl leading-tight font-semibold text-white">
            Find the roles you can actually win. Apply with evidence, not guesswork.
          </h1>
          <ul className="space-y-3 text-sm text-brand-100">
            {[
              'Daily scans of permitted job sources, matched against your verified profile.',
              'Every match explains itself: evidence for what fits, honest gaps for what does not.',
              'Tailored resumes and cover letters that never claim anything you cannot back up.',
              'You review every field and submit every application yourself.',
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-0.5 text-brand-300">
                  ✓
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-brand-200">
          We never bypass CAPTCHAs, log in as you, or submit applications on your behalf.
        </p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1 lg:hidden">
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Job Hunter</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Evidence-based job applications. You stay in control.
            </p>
          </div>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              {isSignUp ? 'Create your account' : 'Sign in'}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {isSignUp
                ? 'Start with your profile. Nothing is shared until you approve it.'
                : 'Welcome back. Your scans keep running while you are away.'}
            </p>

            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => void handleSubmit(event)}
              noValidate
            >
              {formError ? (
                <Alert tone="danger" title="We could not continue">
                  {formError}
                </Alert>
              ) : null}

              {isSignUp ? (
                <Field label="Your name" required error={fieldErrors.displayName}>
                  {(id, describedBy) => (
                    <TextInput
                      id={id}
                      name="name"
                      autoComplete="name"
                      required
                      value={displayName}
                      aria-describedby={describedBy}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}

              <Field label="Email" required error={fieldErrors.email}>
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    required
                    value={email}
                    aria-describedby={describedBy}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                )}
              </Field>

              <Field
                label="Password"
                required
                error={fieldErrors.password}
                hint={
                  isSignUp
                    ? `At least ${MIN_PASSWORD} characters. A passphrase works well.`
                    : undefined
                }
              >
                {(id, describedBy) => (
                  <TextInput
                    id={id}
                    name="password"
                    type="password"
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    required
                    minLength={isSignUp ? MIN_PASSWORD : undefined}
                    value={password}
                    aria-describedby={describedBy}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}
              </Field>

              {isSignUp ? (
                <div className="space-y-1">
                  <Checkbox
                    label="I accept the terms and privacy policy"
                    description="Required to create an account. You can export or delete your data at any time."
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                  />
                  {fieldErrors.acceptedTerms ? (
                    <p className="text-xs font-medium text-rose-600" role="alert">
                      {fieldErrors.acceptedTerms}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <Button type="submit" className="w-full" loading={submitting} size="lg">
                {isSignUp ? 'Create account' : 'Sign in'}
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">
              {isSignUp ? 'Already have an account? ' : 'New here? '}
              <Link
                to={isSignUp ? '/signin' : '/signup'}
                className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
              >
                {isSignUp ? 'Sign in' : 'Create an account'}
              </Link>
            </p>
          </Card>
        </div>
      </main>
    </div>
  );
}
