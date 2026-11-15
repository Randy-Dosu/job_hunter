/** Browser-assisted form filling contracts (no-submit by construction). */

import type { BrowserPauseReason, BrowserSessionStatus } from './enums.js';

/** A field the assistant wants to fill, after semantic mapping. */
export interface FormFieldDescriptor {
  /** Stable selector used by the adapter, e.g. `[name="first_name"]`. */
  selector: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file';
  required: boolean;
  options?: string[] | undefined;
  /** Value from the approved profile, or null when we do not know it. */
  value: string | null;
  /** Which verified profile fact supplies the value. */
  source?: 'contact' | 'experience' | 'education' | 'skills' | 'answer_bank' | undefined;
  /** Never guess legal declarations/eligibility answers. */
  sensitive: boolean;
  confidence: 'high' | 'low';
  /** Reason it was skipped, when value is null. */
  skippedReason?: string | undefined;
}

export interface FormDescriptor {
  /** Adapter id that understands this form. */
  adapterId: string;
  fields: FormFieldDescriptor[];
  /** Fields needing a human answer before the form can be considered complete. */
  unresolvedFieldCount: number;
  /** True if a CAPTCHA / login wall / anti-bot challenge is present. */
  challengeDetected: boolean;
  challengeKind?: 'captcha' | 'login' | 'unsupported' | 'access_restriction' | undefined;
}

export interface BrowserSessionPlan {
  sessionId: string;
  jobId: string;
  applicationUrl: string;
  adapterId: string;
  fields: FormFieldDescriptor[];
  status: BrowserSessionStatus;
  pauseReason?: BrowserPauseReason | undefined;
}

/**
 * The assistant's capability surface intentionally has NO submit method.
 * `pauseForUser` is terminal for the agent: the human takes over from here.
 */
export interface ApplicationAssistant {
  readonly adapterId: string;
  canHandle(url: string): boolean;
  describeForm(html: string, profile: ApprovedProfileData): FormDescriptor;
  /** Always returns a paused-for-user plan: the agent never submits. */
  planSession(input: {
    sessionId: string;
    jobId: string;
    applicationUrl: string;
    form: FormDescriptor;
  }): BrowserSessionPlan;
}

/** Approved data the assistant is permitted to use. Never raw/unverified facts. */
export interface ApprovedProfileData {
  contact: {
    fullName: string;
    firstName?: string | undefined;
    lastName?: string | undefined;
    email: string;
    phone?: string | undefined;
    location?: string | undefined;
    website?: string | undefined;
    linkedin?: string | undefined;
    github?: string | undefined;
  };
  headline?: string | undefined;
  summary?: string | undefined;
  skills: string[];
  mostRecentRole?: { title: string; company: string } | undefined;
  answers: Record<string, string>;
}

/** Hosts the assistant may ever be pointed at (empty until a site is reviewed). */
export const DEFAULT_SITE_ALLOWLIST: readonly string[] = [];

/** Adapter registry entries. Adding a site is a deliberate, reviewed act. */
export interface SiteAdapterMeta {
  adapterId: string;
  displayName: string;
  hosts: string[];
  permitted: boolean;
  complianceNote: string;
}
