/** Candidate profile, verified facts and resume models. */

import type { FactKind, FactSource, ResumeParseStatus } from './enums.js';

export interface ContactInfo {
  fullName: string;
  email: string;
  phone?: string | undefined;
  location?: string | undefined;
  website?: string | undefined;
  linkedin?: string | undefined;
  github?: string | undefined;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  startDate?: string | undefined;
  endDate?: string | undefined;
  current?: boolean | undefined;
  location?: string | undefined;
  bullets: string[];
  /** Technology/domain keywords mentioned in this role. */
  keywords?: string[] | undefined;
}

export interface EducationEntry {
  institution: string;
  degree?: string | undefined;
  field?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  grade?: string | undefined;
}

export interface ProjectEntry {
  name: string;
  description: string;
  url?: string | undefined;
  keywords?: string[] | undefined;
}

export interface CertificationEntry {
  name: string;
  issuer?: string | undefined;
  issuedAt?: string | undefined;
  expiresAt?: string | undefined;
  credentialUrl?: string | undefined;
}

/** Structured view of the candidate's master profile (one per user). */
export interface CandidateProfileContent {
  contact: ContactInfo;
  headline?: string | undefined;
  summary?: string | undefined;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  languages: string[];
}

export const EMPTY_PROFILE_CONTENT: CandidateProfileContent = {
  contact: { fullName: '', email: '' },
  skills: [],
  experience: [],
  education: [],
  projects: [],
  certifications: [],
  languages: [],
};

/**
 * A single verifiable claim. Only `verified` facts may be used as evidence in
 * generated documents or match scoring — this is the core truthfulness rule.
 */
export interface ProfileFact {
  id: string;
  kind: FactKind;
  /** Short label, e.g. "TypeScript" or "Led migration of 40 services". */
  label: string;
  detail?: string | undefined;
  /** Keywords used for matching against job requirements. */
  keywords: string[];
  /** ISO-ish date (YYYY-MM or YYYY-MM-DD) for experience/education ordering. */
  startDate?: string | undefined;
  endDate?: string | undefined;
  organisation?: string | undefined;
  role?: string | undefined;
  source: FactSource;
  /** True only after the user confirms the fact in the verification UI. */
  verified: boolean;
  /** Where the fact came from, e.g. "resume.pdf#page1:line12" — kept for audit. */
  evidenceRef?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeSummary {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parseStatus: ResumeParseStatus;
  parseError?: string | undefined;
  isPrimary: boolean;
  uploadedAt: string;
}

export interface ParsedResumeResult {
  content: CandidateProfileContent;
  /** Facts extracted from the resume, all `verified: false` until confirmed. */
  facts: ParsedFact[];
  warnings: string[];
  textLength: number;
}

export interface ParsedFact {
  kind: FactKind;
  label: string;
  detail?: string | undefined;
  keywords: string[];
  organisation?: string | undefined;
  role?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  evidenceRef?: string | undefined;
}
