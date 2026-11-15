/**
 * HTML/text cleaning and shared parsing used by all connectors. Jobs descriptions
 * are treated as untrusted input: we strip tags/scripts before the text ever
 * reaches the database, the UI or an AI provider.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  eacute: '\u00e9',
  egrave: '\u00e8',
  uuml: '\u00fc',
  ouml: '\u00f6',
  auml: '\u00e4',
  ccedil: '\u00e7',
  ntilde: '\u00f1',
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Convert untrusted HTML to readable plain text.
 * - removes script/style/iframe/object/embed entirely (including contents)
 * - converts block tags and <br> to newlines, <li> to bullet lines
 * - strips all remaining tags, decodes entities, normalises whitespace
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  let value = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<object\b[\s\S]*?<\/object>/gi, ' ')
    .replace(/<embed\b[\s\S]*?>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  value = value
    .replace(/<li\b[^>]*>/gi, '\n\u2022 ')
    .replace(/<\/(p|div|h[1-6]|tr|section|article|ul|ol|table|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '')
    .replace(/<[^>]+>/g, ' ');

  return (
    decodeEntities(value)
      // Strip remaining control chars and zero-width characters.
      // eslint-disable-next-line no-control-regex -- deliberately stripping control characters
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Strip control characters and cap length (defence against huge payloads). */
export function cleanText(value: string, maxLength = 60_000): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- deliberately stripping control characters
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength)
      .trim()
  );
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'united states': 'US',
  usa: 'US',
  'united states of america': 'US',
  canada: 'CA',
  'united kingdom': 'GB',
  uk: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  ireland: 'IE',
  germany: 'DE',
  france: 'FR',
  spain: 'ES',
  portugal: 'PT',
  italy: 'IT',
  netherlands: 'NL',
  belgium: 'BE',
  switzerland: 'CH',
  austria: 'AT',
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
  finland: 'FI',
  poland: 'PL',
  czechia: 'CZ',
  'czech republic': 'CZ',
  hungary: 'HU',
  romania: 'RO',
  bulgaria: 'BG',
  greece: 'GR',
  ukraine: 'UA',
  estonia: 'EE',
  latvia: 'LV',
  lithuania: 'LT',
  croatia: 'HR',
  serbia: 'RS',
  slovakia: 'SK',
  slovenia: 'SI',
  russia: 'RU',
  turkey: 'TR',
  israel: 'IL',
  'united arab emirates': 'AE',
  uae: 'AE',
  'saudi arabia': 'SA',
  qatar: 'QA',
  egypt: 'EG',
  morocco: 'MA',
  nigeria: 'NG',
  ghana: 'GH',
  kenya: 'KE',
  'south africa': 'ZA',
  ethiopia: 'ET',
  tanzania: 'TZ',
  uganda: 'UG',
  rwanda: 'RW',
  senegal: 'SN',
  cameroon: 'CM',
  'ivory coast': 'CI',
  tunisia: 'TN',
  algeria: 'DZ',
  india: 'IN',
  pakistan: 'PK',
  bangladesh: 'BD',
  'sri lanka': 'LK',
  nepal: 'NP',
  china: 'CN',
  'hong kong': 'HK',
  taiwan: 'TW',
  japan: 'JP',
  'south korea': 'KR',
  singapore: 'SG',
  malaysia: 'MY',
  indonesia: 'ID',
  philippines: 'PH',
  thailand: 'TH',
  vietnam: 'VN',
  australia: 'AU',
  'new zealand': 'NZ',
  brazil: 'BR',
  argentina: 'AR',
  chile: 'CL',
  colombia: 'CO',
  peru: 'PE',
  mexico: 'MX',
  uruguay: 'UY',
  ecuador: 'EC',
  'costa rica': 'CR',
  panama: 'PA',
  bolivia: 'BO',
  venezuela: 'VE',
  paraguay: 'PY',
};

const CODE_SET = new Set(Object.values(COUNTRY_NAME_TO_CODE));

/** Best-effort country code resolution; returns undefined when not confident. */
export function resolveCountryCode(input: {
  locationRaw?: string | undefined;
  countryHint?: string | undefined;
}): string | undefined {
  const candidates = [input.countryHint, input.locationRaw].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().trim();

    if (normalized.length === 2 && CODE_SET.has(normalized.toUpperCase())) {
      return normalized.toUpperCase();
    }
    // Prefer the last comma-separated segment: "Berlin, Germany" -> "Germany".
    const segments = normalized.split(',').map((segment) => segment.trim());
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (!segment) continue;
      const direct = COUNTRY_NAME_TO_CODE[segment];
      if (direct) return direct;
      const upper = segment.toUpperCase();
      if (segment.length === 2 && CODE_SET.has(upper)) return upper;
    }
    for (const [name, code] of Object.entries(COUNTRY_NAME_TO_CODE)) {
      if (name.length > 3 && normalized.includes(name)) return code;
    }
  }
  return undefined;
}

/** Cases like "Remote (EU only)" or "Worldwide" should not invent a country. */
export function isGlobalRemote(locationRaw: string | undefined): boolean {
  if (!locationRaw) return false;
  const normalized = locationRaw.toLowerCase();
  return /anywhere|worldwide|global/.test(normalized) && !/[a-z]{4,},/.test(normalized);
}

const EMPLOYMENT_PATTERNS: Array<{ type: string; patterns: RegExp[] }> = [
  {
    type: 'internship',
    patterns: [/\bintern\b/i, /\binternship\b/i, /\bgraduate scheme\b/i, /\bplacement\b/i],
  },
  // Underscore variants ("part_time") come straight from source APIs.
  { type: 'part_time', patterns: [/\bpart[-_ ]time\b/i] },
  { type: 'contract', patterns: [/\bcontract\b/i, /\bcontractor\b/i, /\bfixed[- ]term\b/i] },
  { type: 'temporary', patterns: [/\btemporary\b/i, /\bseasonal\b/i] },
  { type: 'freelance', patterns: [/\bfreelance\b/i] },
  { type: 'full_time', patterns: [/\bfull[-_ ]time\b/i, /\bpermanent\b/i] },
];

export function normalizeEmploymentType(...hints: Array<string | undefined>): string {
  const text = hints.filter(Boolean).join(' ');
  if (!text.trim()) return 'unknown';
  for (const { type, patterns } of EMPLOYMENT_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) return type;
  }
  return 'unknown';
}

const SENIORITY_PATTERNS: Array<{ level: string; patterns: RegExp[] }> = [
  { level: 'executive', patterns: [/\b(chief|cto|ceo|cfo|coo|vp|vice president|head of)\b/i] },
  { level: 'director', patterns: [/\bdirector\b/i] },
  { level: 'principal', patterns: [/\bprincipal\b/i, /\bstaff\b/i, /\bdistinguished\b/i] },
  { level: 'lead', patterns: [/\blead\b/i, /\bmanager\b/i] },
  { level: 'senior', patterns: [/\bsenior\b/i, /\bsr\.?\b/i] },
  { level: 'mid', patterns: [/\bmid[- ]?level\b/i, /\bintermediate\b/i] },
  {
    level: 'junior',
    patterns: [/\bjunior\b/i, /\bjr\.?\b/i, /\bentry[- ]level\b/i, /\bgraduate\b/i],
  },
  { level: 'internship', patterns: [/\bintern\b/i, /\binternship\b/i] },
];

export function inferSeniority(title: string, hint?: string | undefined): string {
  const text = `${hint ?? ''} ${title}`;
  for (const { level, patterns } of SENIORITY_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) return level;
  }
  if (hint) {
    if (/senior/i.test(hint)) return 'senior';
    if (/associate|mid/i.test(hint)) return 'mid';
    if (/entry|intern/i.test(hint)) return 'entry';
  }
  return 'unknown';
}

/** Sanitise and validate a URL from a source. Rejects javascript:/data: schemes. */
export function safeUrl(
  candidate: string | undefined,
  fallbackHost?: string | undefined,
): string | undefined {
  if (!candidate) return undefined;
  let value = candidate.trim();
  if (!value) return undefined;
  if (value.startsWith('//')) value = `https:${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.protocol = 'https:';
    return url.toString();
  } catch {
    if (fallbackHost && /^[\w./-]+$/.test(value)) {
      return `https://${fallbackHost}${value.startsWith('/') ? '' : '/'}${value}`;
    }
    return undefined;
  }
}

/** Truncate a description to a sensible storage cap without cutting mid-word. */
export function truncateDescription(text: string, maxLength = 40_000): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxLength * 0.8 ? cut.slice(0, lastSpace) : cut}\n\n[Description truncated]`;
}
