/**
 * Evidence checks — the truthfulness gate for generated documents.
 *
 * Two independent checks:
 *  1. Provenance: every `evidenceId` must reference a fact that was supplied AND
 *     is verified. Unknown or unverified ids are stripped and reported.
 *  2. Claim checking: sentences asserting new numbers, employers or credentials
 *     that do not appear in the verified source material are flagged as
 *     unsupported. Flagged documents cannot be approved until the user resolves
 *     them (by editing or by removing the claim).
 */

import type {
  GeneratedDocumentContent,
  GeneratedDocumentSection,
  ProfileFact,
} from '@job-hunter/shared-types';

export interface EvidenceCheckResult {
  content: GeneratedDocumentContent;
  /** Human-readable warnings; empty means clean. */
  warnings: string[];
  /** Every warning belongs to a specific section index for inline highlighting. */
  issues: Array<{ sectionIndex: number; bulletIndex: number; message: string }>;
}

const CREDENTIAL_PATTERNS = [
  /\bcertified\b/i,
  /\bcertification\b/i,
  /\b(aws|azure|gcp|google cloud|cissp|pmp|cpa|cfa|scrum)\b\s+(certified|professional|associate|master)/i,
  /\bph\.?d\b/i,
  /\bmba\b/i,
];

const EMPLOYER_PATTERNS = [
  /\b(?:at|with|for)\s+([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,3})/,
];

export interface CheckEvidenceInput {
  content: GeneratedDocumentContent;
  /** Facts that were provided to the model (may include unverified ones). */
  providedFacts: ProfileFact[];
  /** Facts the user has verified — the only ones allowed to support claims. */
  verifiedFacts: ProfileFact[];
  /** Canonical facts from the base profile used to validate numbers/employers. */
  baseText?: string | undefined;
}

/**
 * Normalise a number found in prose so `1.4`, `1,4` and `1.4s` compare equal.
 *
 * Decimals matter: a verified fact that says "cut p95 latency from 1.4s to 180ms"
 * must support the same figures in a draft. Comparing only the digit characters
 * (`1.4` -> `14`) produced false "unverified figure" warnings on every decimal,
 * which trains users to approve real warnings without reading them.
 */
function normalizeNumber(raw: string): string {
  return raw.replace(/,/g, '').replace(/[.]+$/, '');
}

/** Numbers in `text` worth checking (two or more digits). */
function numbersIn(text: string): Array<{ raw: string; normalized: string }> {
  return (text.match(/\b\d[\d,.]*\s*(%|percent|k\b|m\b|\+)?/gi) ?? [])
    .map((raw) => ({ raw: raw.trim(), normalized: normalizeNumber(raw.trim()) }))
    .filter((entry) => entry.normalized.replace(/\D/g, '').length >= 2);
}

/** True when the verified source text contains this number. */
function isSupportedNumber(normalized: string, source: string): boolean {
  if (source.includes(normalized)) return true;
  // Tolerate unit suffixes attached in source ("180ms") and thousands grouping.
  return source.replace(/,/g, '').includes(normalized);
}

export function checkEvidence(input: CheckEvidenceInput): EvidenceCheckResult {
  const verifiedById = new Map(input.verifiedFacts.map((fact) => [fact.id, fact]));
  const sourceText = [
    ...input.verifiedFacts.map(
      (fact) => `${fact.label} ${fact.detail ?? ''} ${fact.organisation ?? ''}`,
    ),
    input.baseText ?? '',
  ]
    .join(' \n ')
    .toLowerCase();

  const issues: EvidenceCheckResult['issues'] = [];
  const warnings = new Set<string>();

  const sections: GeneratedDocumentSection[] = input.content.sections.map(
    (section, sectionIndex) => {
      const bullets = section.bullets.map((bullet, bulletIndex) => {
        const trimmed = bullet.trim();
        if (!trimmed) return trimmed;

        // --- numbers must exist in verified source text -------------------------
        for (const { raw, normalized } of numbersIn(trimmed)) {
          if (!isSupportedNumber(normalized, sourceText)) {
            const message = `Unverified figure "${raw}" in "${truncate(trimmed, 60)}" — confirm it or remove it.`;
            issues.push({ sectionIndex, bulletIndex, message });
            warnings.add(message);
          }
        }

        // --- credentials must be evidenced ------------------------------------
        for (const pattern of CREDENTIAL_PATTERNS) {
          if (pattern.test(trimmed)) {
            const credential = (trimmed.match(pattern)?.[0] ?? '').toLowerCase();
            if (!sourceText.includes(credential.replace(/\s+/g, ' '))) {
              const message = `Credential "${truncate(credential, 40)}" is not in your verified profile — confirm it or remove it.`;
              issues.push({ sectionIndex, bulletIndex, message });
              warnings.add(message);
            }
            break;
          }
        }

        // --- named employers must be real -------------------------------------
        for (const pattern of EMPLOYER_PATTERNS) {
          const match = trimmed.match(pattern);
          // Trim trailing sentence punctuation: "at Kente Pay." must compare as
          // "Kente Pay", otherwise every sentence-final employer looks invented.
          const employer = match?.[1]?.replace(/[.,;:'’-]+$/, '');
          if (
            employer &&
            employer.length > 2 &&
            !isStopWordEmployer(employer) &&
            !sourceText.includes(employer.toLowerCase())
          ) {
            const message = `Company name "${employer}" is not in your verified history — confirm it or remove it.`;
            issues.push({ sectionIndex, bulletIndex, message });
            warnings.add(message);
          }
        }

        return trimmed;
      });

      // Provenance: keep only verified fact ids.
      const evidenceIds = section.evidenceIds.filter((id) => verifiedById.has(id));
      const droppedCount = section.evidenceIds.length - evidenceIds.length;
      if (droppedCount > 0 && bullets.length > 0) {
        const message = `${droppedCount} claim${droppedCount === 1 ? '' : 's'} in "${section.heading}" cited facts that are missing or unverified; the citation was removed.`;
        issues.push({ sectionIndex, bulletIndex: -1, message });
        warnings.add(message);
      }
      if (bullets.some((bullet) => bullet.length > 0) && evidenceIds.length === 0) {
        const message = `Section "${section.heading}" has no verified evidence attached. Add a verified fact or remove the section.`;
        issues.push({ sectionIndex, bulletIndex: -1, message });
        warnings.add(message);
      }

      return { heading: section.heading, bullets, evidenceIds };
    },
  );

  // Summary/headline checks are paragraph-level: require support too.
  const summaryText = input.content.summary ?? '';
  for (const { raw, normalized } of numbersIn(summaryText)) {
    if (!isSupportedNumber(normalized, sourceText)) {
      warnings.add(`Unverified figure "${raw}" in the summary — confirm it or remove it.`);
    }
  }

  const content: GeneratedDocumentContent = {
    ...input.content,
    sections,
    warnings: [...new Set([...input.content.warnings, ...warnings])],
    wordCount: countWords(sections, input.content.summary),
  };

  return { content, warnings: [...warnings], issues };
}

export function countWords(
  sections: GeneratedDocumentSection[],
  summary?: string | undefined,
): number {
  const text = [
    summary ?? '',
    ...sections.flatMap((section) => [section.heading, ...section.bullets]),
  ].join(' ');
  return text.split(/\s+/).filter(Boolean).length;
}

/** Number/provenance check only — used for edited documents before approval. */
export function hasUnresolvedWarnings(content: GeneratedDocumentContent): boolean {
  return content.warnings.length > 0;
}

function isStopWordEmployer(value: string): boolean {
  const stop = new Set([
    'The',
    'A',
    'An',
    'This',
    'Our',
    'Your',
    'My',
    'We',
    'They',
    'It',
    'I',
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
    'Present',
    'Remote',
    'Hybrid',
  ]);
  return stop.has(value);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
