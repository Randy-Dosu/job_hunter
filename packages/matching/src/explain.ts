/** Turn a match result into UI-ready explanations (pure formatting helpers). */

import type { MatchDimension, MatchGap, MatchResult } from '@job-hunter/shared-types';

export const DIMENSION_LABELS: Record<MatchDimension, string> = {
  skills: 'Skills & technologies',
  experience: 'Relevant experience',
  role: 'Role alignment',
  education: 'Education & certifications',
  location: 'Location & work eligibility',
  preferences: 'Preferences & job type',
};

export interface ExplanationRow {
  label: string;
  scorePercent: number | null;
  weightPercent: number;
  points: number;
  rationale: string;
  unknowns: string[];
  status: 'match' | 'partial' | 'gap' | 'unknown';
}

export function explainMatch(result: MatchResult): ExplanationRow[] {
  return result.components.map((component) => ({
    label: DIMENSION_LABELS[component.dimension],
    scorePercent: component.score === null ? null : Math.round(component.score * 100),
    weightPercent: Math.round(component.weight * 100),
    points: component.points,
    rationale: component.rationale,
    unknowns: component.unknowns,
    status:
      component.score === null
        ? 'unknown'
        : component.score >= 0.75
          ? 'match'
          : component.score >= 0.45
            ? 'partial'
            : 'gap',
  }));
}

export function splitGaps(gaps: MatchGap[]): { confirmed: MatchGap[]; unknown: MatchGap[] } {
  return {
    confirmed: gaps.filter((gap) => gap.kind === 'missing_evidence'),
    unknown: gaps.filter((gap) => gap.kind === 'unknown'),
  };
}

/** Short one-line summary for job cards. */
export function summarizeMatch(result: MatchResult): string {
  const strong = result.components
    .filter((component) => component.score !== null && component.score >= 0.75)
    .map((component) => DIMENSION_LABELS[component.dimension].split(' ')[0]?.toLowerCase())
    .filter(Boolean);
  const gapCount = result.gaps.filter((gap) => gap.kind === 'missing_evidence').length;
  const unknownCount = result.gaps.filter((gap) => gap.kind === 'unknown').length;

  const parts: string[] = [];
  if (strong.length > 0) parts.push(`Strong on ${strong.slice(0, 2).join(' & ')}`);
  if (gapCount > 0) parts.push(`${gapCount} requirement${gapCount === 1 ? '' : 's'} not evidenced`);
  if (unknownCount > 0)
    parts.push(`${unknownCount} unknown${unknownCount === 1 ? '' : 's'} to confirm`);
  if (parts.length === 0) parts.push('Even match with no obvious gaps');
  return parts.join(' · ');
}
