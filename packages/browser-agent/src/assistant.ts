/**
 * The application assistant.
 *
 * Architectural guarantee: this module has no submit capability. There is no
 * `submit()`, no keyboard-event helper, and the session state machine terminates
 * in `paused_for_user`. The E2E tests assert the API surface, not just behaviour.
 */

import type {
  ApplicationAssistant,
  ApprovedProfileData,
  BrowserSessionPlan,
  FormDescriptor,
} from '@job-hunter/shared-types';
import { isUrlAllowed, type AllowedSite } from './allowlist.js';
import { extractFormFields, mapFormFields } from './field-map.js';

export interface AssistantDependencies {
  allowlist: readonly AllowedSite[];
  featureEnabled: boolean;
}

export class FeatureDisabledError extends Error {
  constructor() {
    super('Browser assistance is disabled. Enable it in settings and accept the consent notice.');
    this.name = 'FeatureDisabledError';
  }
}

export class SiteNotAllowedError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'SiteNotAllowedError';
  }
}

export interface SessionStartRequest {
  sessionId: string;
  jobId: string;
  applicationUrl: string;
  /** Explicit consent, must be true. */
  consent: boolean;
  html?: string | undefined;
  profile: ApprovedProfileData;
}

/**
 * Validate everything *before* any browser work happens. All checks are
 * server-side; the UI copy is not a security control.
 */
export function preflightSession(
  request: SessionStartRequest,
  dependencies: AssistantDependencies,
):
  | { ok: true; site: AllowedSite }
  | { ok: false; error: FeatureDisabledError | SiteNotAllowedError } {
  if (!dependencies.featureEnabled) {
    return { ok: false, error: new FeatureDisabledError() };
  }
  if (request.consent !== true) {
    return {
      ok: false,
      error: new SiteNotAllowedError(
        'consent_required',
        'You must explicitly confirm you want the assistant to start.',
      ),
    };
  }
  const decision = isUrlAllowed(request.applicationUrl, dependencies.allowlist);
  if (!decision.allowed) {
    return {
      ok: false,
      error: new SiteNotAllowedError(
        decision.reason,
        decision.reason === 'not_allowlisted'
          ? 'This site is not on the assisted-filling allowlist. Apply manually and track it here.'
          : `This page cannot be assisted (${decision.reason}).`,
      ),
    };
  }
  return { ok: true, site: decision.site };
}

/**
 * Prepare a plan for the user to review. The returned plan is ALWAYS
 * `paused_for_user`: filling is a proposal, not an action.
 */
export function buildSessionPlan(input: {
  sessionId: string;
  jobId: string;
  applicationUrl: string;
  html: string;
  profile: ApprovedProfileData;
  adapterId?: string | undefined;
}): BrowserSessionPlan {
  const parsed = extractFormFields(input.html);
  const mapped = mapFormFields(parsed, input.profile);
  const challengeDetected = detectChallenge(input.html);

  const fields = mapped.fields;
  const unresolved = fields.filter((field) => field.value === null).length;
  const form: FormDescriptor = {
    ...mapped,
    ...(input.adapterId ? { adapterId: input.adapterId } : {}),
    fields,
    unresolvedFieldCount: unresolved,
    challengeDetected: challengeDetected !== undefined,
    ...(challengeDetected ? { challengeKind: challengeDetected } : {}),
  };

  const pauseReason = challengeDetected
    ? challengeDetected === 'login'
      ? 'login_required'
      : challengeDetected === 'captcha'
        ? 'captcha'
        : challengeDetected === 'access_restriction'
          ? 'access_restriction'
          : 'unsupported_form'
    : 'user_review';

  return {
    sessionId: input.sessionId,
    jobId: input.jobId,
    applicationUrl: input.applicationUrl,
    adapterId: form.adapterId,
    fields: form.fields,
    status: 'paused_for_user',
    pauseReason,
  };
}

/** Detect challenge/interstitial markers that must stop the assistant. */
export function detectChallenge(
  html: string,
): 'captcha' | 'login' | 'unsupported' | 'access_restriction' | undefined {
  const normalized = html.toLowerCase();
  if (
    /g-recaptcha|hcaptcha|cf-turnstile|captcha|i'?m not a robot|are you a robot/.test(normalized)
  ) {
    return 'captcha';
  }
  // A login wall needs positive evidence. Some application forms ask the
  // candidate to *create* an account password; treating every password input as
  // a sign-in wall would block legitimate applications.
  if (
    /sign in to (continue|apply)|log ?in required|please (sign|log) in|existing account/i.test(
      normalized,
    )
  ) {
    return 'login';
  }
  const passwordInputs = (normalized.match(/<input[^>]+type=["']password["']/g) ?? []).length;
  if (passwordInputs > 0 && !/<textarea\b/i.test(normalized)) {
    const otherFields =
      (normalized.match(/<(input|select|textarea)\b/g) ?? []).length - passwordInputs;
    if (otherFields <= 2) return 'login';
  }
  if (
    /access denied|403 forbidden|not available in your (region|country)|blocked by/.test(normalized)
  ) {
    return 'access_restriction';
  }
  if (!/<form\b/i.test(normalized)) {
    return 'unsupported';
  }
  return undefined;
}

/** Concrete assistant object. Note the absence of any submit method. */
export class NoSubmitAssistant implements ApplicationAssistant {
  constructor(
    readonly adapterId: string,
    private readonly dependencies: AssistantDependencies,
  ) {}

  canHandle(url: string): boolean {
    if (!this.dependencies.featureEnabled) return false;
    return isUrlAllowed(url, this.dependencies.allowlist).allowed;
  }

  describeForm(html: string, profile: ApprovedProfileData): FormDescriptor {
    const parsed = extractFormFields(html);
    const mapped = mapFormFields(parsed, profile);
    const challenge = detectChallenge(html);
    return {
      ...mapped,
      adapterId: this.adapterId,
      challengeDetected: challenge !== undefined,
      ...(challenge ? { challengeKind: challenge } : {}),
    };
  }

  planSession(input: {
    sessionId: string;
    jobId: string;
    applicationUrl: string;
    form: FormDescriptor;
  }): BrowserSessionPlan {
    return {
      sessionId: input.sessionId,
      jobId: input.jobId,
      applicationUrl: input.applicationUrl,
      adapterId: this.adapterId,
      fields: input.form.fields,
      status: 'paused_for_user',
      pauseReason: input.form.challengeDetected
        ? input.form.challengeKind === 'login'
          ? 'login_required'
          : input.form.challengeKind === 'captcha'
            ? 'captcha'
            : input.form.challengeKind === 'access_restriction'
              ? 'access_restriction'
              : 'unsupported_form'
        : 'user_review',
    };
  }
}

/** Guard used by the E2E tests: proves the agent has no submission surface. */
export function assertNoSubmitCapability(assistant: object): void {
  const forbidden = [
    'submit',
    'submitForm',
    'pressEnter',
    'clickSubmit',
    'sendKey',
    'finalize',
    'apply',
  ];
  for (const name of forbidden) {
    if (name in assistant) {
      throw new Error(`Assistant exposes a forbidden submission capability: ${name}`);
    }
  }
  const prototype = Object.getPrototypeOf(assistant) as object;
  for (const name of forbidden) {
    if (name in prototype) {
      throw new Error(`Assistant prototype exposes a forbidden submission capability: ${name}`);
    }
  }
}
