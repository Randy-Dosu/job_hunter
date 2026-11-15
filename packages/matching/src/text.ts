/**
 * Deterministic text utilities for matching. No I/O, no randomness, no AI —
 * everything here must produce identical output for identical input so scores
 * are reproducible and testable.
 */

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'to',
  'was',
  'were',
  'will',
  'with',
  'you',
  'your',
  'we',
  'our',
  'this',
  'these',
  'those',
  'they',
  'them',
  'i',
  'me',
  'my',
  'about',
  'across',
  'also',
  'using',
  'use',
  'used',
  'ability',
  'able',
  'work',
  'working',
  'role',
  'job',
  'team',
  'teams',
  'experience',
  'experienced',
  'years',
  'year',
  'strong',
  'good',
  'great',
  'excellent',
  'including',
  'etc',
  'plus',
  'other',
  'more',
  'most',
  'new',
  'required',
  'requirements',
  'responsibilities',
  'preferred',
  'nice',
  'have',
  'must',
  'should',
  'would',
]);

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokenise into meaningful terms. Keeps C++, C#, .NET, node.js style tokens. */
export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized
    .split(/[\s,;|/]+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Turn technology spellings into one comparable key.
 * Order matters: product-specific "*.js" names are rewritten before the generic
 * "js" -> "javascript" rule, otherwise "node.js" would become "node.javascript".
 */
export function canonicalSkill(value: string): string {
  const base = normalizeText(value);
  return base
    .replace(/node\.?\s?js/g, 'nodejs')
    .replace(/react\.?\s?js/g, 'react')
    .replace(/vue\.?\s?js/g, 'vue')
    .replace(/next\.?\s?js/g, 'nextjs')
    .replace(/express\.?\s?js/g, 'expressjs')
    .replace(/\bjs\b/g, 'javascript')
    .replace(/\.net\b/g, 'dotnet')
    .replace(/\bc\+\+/g, 'cpp')
    .replace(/\bc#/g, 'csharp')
    .replace(/\s+/g, '');
}

/** Simple deterministic stemmer for matching inflections (suffix stripping). */
export function stem(token: string): string {
  if (token.length <= 4) return token;
  for (const suffix of ['ing', 'ers', 'er', 'ies', 'ied', 'es', 's', 'ed', 'ly']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, token.length - suffix.length);
    }
  }
  return token;
}

/** Jaccard similarity over stemmed token sets. Range 0..1. */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a).map(stem));
  const setB = new Set(tokenize(b).map(stem));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/** True when `needle` appears as a token/word in `haystack` (not a substring of a word). */
export function containsTerm(haystack: string, needle: string): boolean {
  const hay = ` ${normalizeText(haystack)} `;
  const term = normalizeText(needle);
  if (!term) return false;
  return hay.includes(` ${term} `) || hay.includes(` ${term},`) || hay.includes(` ${term}.`);
}

/** Extract salary numbers such as "$120,000 - $150,000" or "€60k". */
export function parseSalaryRange(raw: string | undefined): {
  min?: number | undefined;
  max?: number | undefined;
  currency?: string | undefined;
  period?: 'year' | 'month' | 'day' | 'hour' | undefined;
} {
  if (!raw) return {};
  const text = raw.toLowerCase().replace(/\s+/g, ' ');
  const currency =
    /[$]/.test(text) || /\busd\b/.test(text)
      ? 'USD'
      : /€/.test(text) || /\beur\b/.test(text)
        ? 'EUR'
        : /£/.test(text) || /\bgbp\b/.test(text)
          ? 'GBP'
          : /\bngn\b|₦/.test(text)
            ? 'NGN'
            : /\bghs\b|₵/.test(text)
              ? 'GHS'
              : /\b(inr|₹)\b/.test(text)
                ? 'INR'
                : undefined;

  const period = /\b(hour|hourly|hr|per hour)\b/.test(text)
    ? ('hour' as const)
    : /\b(day|daily)\b/.test(text)
      ? ('day' as const)
      : /\b(month|monthly|per month)\b/.test(text)
        ? ('month' as const)
        : /\b(year|yearly|annual|annually|per annum|pa)\b/.test(text)
          ? ('year' as const)
          : undefined;

  const numbers: number[] = [];
  const regex = /(\d[\d,.]*)\s*(k|m)?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const rawNumber = match[1];
    if (!rawNumber) continue;
    const suffix = match[2];
    let value = Number.parseFloat(rawNumber.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    if (suffix === 'k') value *= 1000;
    if (suffix === 'm') value *= 1_000_000;
    if (value >= 1000) numbers.push(Math.round(value));
  }
  if (numbers.length === 0) return { currency, period };
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return {
    min,
    max: max === min ? undefined : max,
    currency,
    period,
  };
}

/** Convert a salary to an annual figure for like-for-like comparison. */
export function annualize(amount: number, period: string | undefined): number {
  switch (period) {
    case 'hour':
      return Math.round(amount * 2080);
    case 'day':
      return Math.round(amount * 260);
    case 'month':
      return Math.round(amount * 12);
    default:
      return amount;
  }
}
