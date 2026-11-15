/** Formatting helpers shared by the UI. Pure functions only. */

export function formatRelativeTime(value: string | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const seconds = Math.abs(diffMs) / 1000;

  if (seconds < 45) return future ? 'in a moment' : 'just now';
  if (seconds < 90) return future ? 'in a minute' : 'a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return future ? `in ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours} h` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return future ? 'tomorrow' : 'yesterday';
  if (days < 30) return future ? `in ${days} days` : `${days} days ago`;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatSalary(job: {
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
}): string | undefined {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = job;
  if (!salaryMin && !salaryMax) return undefined;

  const currency = salaryCurrency ?? 'USD';
  const period = salaryPeriod ?? 'year';
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    notation: 'compact',
  });

  const range =
    salaryMin && salaryMax && salaryMin !== salaryMax
      ? `${formatter.format(salaryMin)} – ${formatter.format(salaryMax)}`
      : formatter.format(salaryMin ?? salaryMax ?? 0);

  const suffix =
    period === 'year' ? '/yr' : period === 'month' ? '/mo' : period === 'hour' ? '/hr' : '';
  return `${range}${suffix}`;
}

export function bandLabel(band: string): string {
  return band.charAt(0).toUpperCase() + band.slice(1);
}

/** Tone classes for a match score, kept in one place so the UI is consistent. */
export function scoreTone(score: number | null | undefined): {
  text: string;
  bg: string;
  border: string;
  ring: string;
} {
  if (score === null || score === undefined) {
    return {
      text: 'text-slate-500 dark:text-slate-400',
      bg: 'bg-slate-100 dark:bg-slate-800',
      border: 'border-slate-200 dark:border-slate-700',
      ring: 'ring-slate-300',
    };
  }
  if (score >= 80) {
    return {
      text: 'text-emerald-700 dark:text-emerald-300',
      bg: 'bg-emerald-50 dark:bg-emerald-950',
      border: 'border-emerald-200 dark:border-emerald-800',
      ring: 'ring-emerald-400',
    };
  }
  if (score >= 65) {
    return {
      text: 'text-teal-700 dark:text-teal-300',
      bg: 'bg-teal-50 dark:bg-teal-950',
      border: 'border-teal-200 dark:border-teal-800',
      ring: 'ring-teal-400',
    };
  }
  if (score >= 45) {
    return {
      text: 'text-amber-700 dark:text-amber-300',
      bg: 'bg-amber-50 dark:bg-amber-950',
      border: 'border-amber-200 dark:border-amber-800',
      ring: 'ring-amber-400',
    };
  }
  return {
    text: 'text-slate-600 dark:text-slate-300',
    bg: 'bg-slate-100 dark:bg-slate-800',
    border: 'border-slate-200 dark:border-slate-700',
    ring: 'ring-slate-300',
  };
}

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  saved: 'Saved',
  preparing: 'Preparing',
  ready_for_user: 'Ready for you',
  applied: 'Applied',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
};

export const APPLICATION_STATUS_ORDER = [
  'saved',
  'preparing',
  'ready_for_user',
  'applied',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'closed',
] as const;

/**
 * Statuses an application can move to, copied from
 * `APPLICATION_STATUS_TRANSITIONS` in @job-hunter/shared-types.
 *
 * The server remains the authority (it rejects anything else with 409); this copy
 * only decides which options the dropdown offers. Keep the two in sync.
 */
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  saved: ['preparing', 'ready_for_user', 'withdrawn', 'closed'],
  preparing: ['ready_for_user', 'applied', 'saved', 'withdrawn', 'closed'],
  ready_for_user: ['applied', 'preparing', 'withdrawn', 'closed'],
  applied: ['assessment', 'interview', 'rejected', 'offer', 'withdrawn', 'closed'],
  assessment: ['interview', 'rejected', 'withdrawn', 'closed'],
  interview: ['offer', 'rejected', 'withdrawn', 'closed'],
  offer: ['closed', 'withdrawn'],
  rejected: ['closed'],
  withdrawn: ['closed'],
  closed: [],
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
