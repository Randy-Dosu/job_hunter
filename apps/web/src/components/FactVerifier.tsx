/**
 * Fact verification.
 *
 * The single most important screen in the product: every claim the system may
 * later use must be confirmed by the person it is about. Grouped by kind, with
 * bulk actions per group, and an explicit "this came from your CV" marker.
 */

import { useMemo, useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import type { ProfileFact } from '../lib/types.js';
import { Alert, Badge, Button, EmptyState, cx } from './ui.js';

const KIND_LABELS: Record<string, string> = {
  experience: 'Experience',
  skill: 'Skills',
  education: 'Education',
  certification: 'Certifications',
  project: 'Projects',
  language: 'Languages',
  summary: 'Summary',
};

const KIND_ORDER = [
  'experience',
  'skill',
  'education',
  'certification',
  'project',
  'language',
  'summary',
];

interface FactVerifierProps {
  facts: ProfileFact[];
  onChanged: () => void;
  /** Restrict to a subset (used when reviewing a fresh upload). */
  filterKinds?: string[];
}

export function FactVerifier({ facts, onChanged, filterKinds }: FactVerifierProps) {
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const grouped = useMemo(() => {
    const visible = filterKinds ? facts.filter((fact) => filterKinds.includes(fact.kind)) : facts;
    const groups = new Map<string, ProfileFact[]>();
    for (const fact of visible) {
      const bucket = groups.get(fact.kind) ?? [];
      bucket.push(fact);
      groups.set(fact.kind, bucket);
    }
    return [...groups.entries()].sort(
      (a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]),
    );
  }, [facts, filterKinds]);

  const setVerified = async (ids: string[], verified: boolean): Promise<void> => {
    if (ids.length === 0) return;
    setBusy(ids.join(','));
    setError(undefined);
    try {
      await request('/profile/facts/verify', { method: 'POST', body: { factIds: ids, verified } });
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update those facts.');
    } finally {
      setBusy(undefined);
    }
  };

  if (facts.length === 0) {
    return (
      <EmptyState
        title="No facts yet"
        description="Upload a CV or add facts by hand. Facts you add are unverified until you confirm them."
      />
    );
  }

  return (
    <div className="space-y-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {grouped.map(([kind, items]) => {
        const unverified = items.filter((fact) => !fact.verified);
        return (
          <section key={kind} aria-label={KIND_LABELS[kind] ?? kind} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {KIND_LABELS[kind] ?? kind}
                <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                  {items.length - unverified.length}/{items.length} verified
                </span>
              </h3>
              {unverified.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy === unverified.map((fact) => fact.id).join(',')}
                  onClick={() =>
                    void setVerified(
                      unverified.map((fact) => fact.id),
                      true,
                    )
                  }
                >
                  Verify all
                </Button>
              ) : null}
            </div>

            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {items.map((fact) => (
                <li
                  key={fact.id}
                  className={cx(
                    'flex flex-wrap items-start justify-between gap-3 p-3.5',
                    fact.verified
                      ? 'bg-white dark:bg-slate-900'
                      : 'bg-amber-50/60 dark:bg-amber-950/20',
                  )}
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {fact.label}
                      {fact.role && fact.organisation ? (
                        <span className="font-normal text-slate-500 dark:text-slate-400">
                          {' '}
                          · {fact.organisation}
                        </span>
                      ) : null}
                    </p>
                    {fact.detail ? (
                      <p className="line-clamp-3 text-sm text-slate-600 dark:text-slate-400">
                        {fact.detail}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {fact.startDate ? (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(fact.startDate)} –{' '}
                          {fact.endDate ? formatDate(fact.endDate) : 'present'}
                        </span>
                      ) : null}
                      <Badge tone={fact.source === 'resume' ? 'info' : 'neutral'}>
                        {fact.source === 'resume' ? 'From your CV' : 'Added by you'}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {fact.verified ? (
                      <>
                        <Badge tone="success">✓ Verified</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busy === fact.id}
                          onClick={() => void setVerified([fact.id], false)}
                        >
                          Unverify
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="success"
                        loading={busy === fact.id}
                        onClick={() => void setVerified([fact.id], true)}
                      >
                        This is accurate
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function formatDate(value: string): string {
  // Dates arrive as YYYY-MM or YYYY-MM-DD.
  const [year, month] = value.split('-');
  if (!month) return year ?? value;
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
