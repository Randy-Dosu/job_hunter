/** Matching, document and application models. */

import type { ApplicationStatus, DocumentKind, DocumentStatus, ExportFormat } from './enums.js';
import type { NormalizedJob } from './job.js';

/** Dimension keys of the explainable score. Weights live in the matching package. */
export const MATCH_DIMENSIONS = [
  'skills',
  'experience',
  'role',
  'education',
  'location',
  'preferences',
] as const;
export type MatchDimension = (typeof MATCH_DIMENSIONS)[number];

export interface ScoreComponent {
  dimension: MatchDimension;
  /** Documented weight as a fraction of 1 (e.g. 0.3 for skills). */
  weight: number;
  /**
   * Weight actually used after renormalising across dimensions that could be
   * scored. Unknown dimensions are excluded so missing data never lowers the
   * score. Equal to `weight` when nothing is unknown.
   */
  effectiveWeight: number;
  /** 0..1 normalised dimension score, null when there is not enough evidence. */
  score: number | null;
  /** Contribution to the final score: effectiveWeight * score * 100. */
  points: number;
  /** Human-readable reason for the dimension score. */
  rationale: string;
  /** What we could not determine (must never be treated as a deficiency). */
  unknowns: string[];
}

export interface MatchEvidence {
  dimension: MatchDimension;
  /**
   * Id of the verified profile fact that supports this match. Present whenever a
   * specific fact was found, so the UI can deep-link to the exact claim; absent
   * for whole-document judgements (e.g. semantic themes).
   */
  factId?: string | undefined;
  /** Verified fact label that supports this match. */
  factLabel: string;
  /** The requirement/term from the job that it satisfies. */
  requirement: string;
  strength: 'strong' | 'moderate' | 'weak';
}

export interface MatchGap {
  dimension: MatchDimension;
  requirement: string;
  /** `missing_evidence` = we looked and found nothing; `unknown` = we could not tell. */
  kind: 'missing_evidence' | 'unknown';
  detail: string;
}

export interface MatchResult {
  jobId: string;
  profileVersion: string;
  scoringVersion: string;
  /** 0-100 integer. Deterministic given the same inputs. */
  score: number;
  band: 'strong' | 'good' | 'fair' | 'weak';
  components: ScoreComponent[];
  evidence: MatchEvidence[];
  gaps: MatchGap[];
  /** True when a hard filter rejected the job (score then reflects eligibility). */
  excluded: boolean;
  exclusionReason?: string | undefined;
  computedAt: string;
  /** Which parts were produced by AI (semantic) vs deterministic code. */
  usedSemantic: boolean;
}

export interface EligibilityExplanation {
  eligible: boolean;
  reasons: string[];
}

export interface EvidenceRef {
  factId: string;
  factLabel: string;
  quote?: string | undefined;
}

export interface GeneratedDocumentSection {
  heading: string;
  /** Structured bullets so the renderer controls layout/formatting. */
  bullets: string[];
  /** Fact ids each bullet is grounded in. */
  evidenceIds: string[];
}

export interface GeneratedDocumentContent {
  kind: DocumentKind;
  headline: string;
  summary?: string | undefined;
  sections: GeneratedDocumentSection[];
  /** Unsupported claims detected post-generation; must be resolved before approval. */
  warnings: string[];
  wordCount: number;
}

export interface GeneratedDocument {
  id: string;
  jobId: string;
  kind: DocumentKind;
  version: number;
  status: DocumentStatus;
  content: GeneratedDocumentContent;
  providerId?: string | undefined;
  model?: string | undefined;
  promptVersion?: string | undefined;
  createdAt: string;
  approvedAt?: string | undefined;
}

export interface ApplicationRecord {
  id: string;
  jobId: string;
  job?: NormalizedJob | undefined;
  status: ApplicationStatus;
  resumeDocumentId?: string | undefined;
  coverLetterDocumentId?: string | undefined;
  notes?: string | undefined;
  nextActionAt?: string | undefined;
  appliedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationEventRecord {
  id: string;
  applicationId: string;
  type: 'status_change' | 'note' | 'created' | 'document_attached';
  fromStatus?: ApplicationStatus | undefined;
  toStatus?: ApplicationStatus | undefined;
  message?: string | undefined;
  createdAt: string;
}

export type { ExportFormat };
