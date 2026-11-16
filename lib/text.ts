/** Text utilities shared by ingestion, matching, and grounding. */

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "referrer", "source", "gh_src", "lever-source", "lever-origin",
  "trk", "trackingid", "src", "fbclid", "gclid",
]);

/** Strip HTML into readable plain text while keeping paragraph breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const stripDiacritics = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

/** Canonical URL: lowercase host, drop tracking query params, sort the rest. */
export function canonicalUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.protocol = "https:";
    const kept = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    url.search = "";
    for (const [k, v] of kept) url.searchParams.append(k, v);
    let pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname) pathname = "/";
    return `${url.origin}${pathname}${url.search}`;
  } catch {
    return input.trim().toLowerCase();
  }
}

/** Stable duplicate fingerprint: employer + title + location, punctuation-insensitive. */
export function fingerprint(company: string, title: string, location: string): string {
  const norm = (value: string) =>
    stripDiacritics(value.toLowerCase())
      .replace(/\b(inc|llc|ltd|limited|gmbh|plc|corp|corporation|co)\b\.?/g, "")
      .replace(/\b(senior|sr|junior|jr|lead|staff|principal)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return [norm(company), norm(title), norm(location)].filter(Boolean).join("|");
}

export function contentHash(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, "0");
}

const STOP_WORDS = new Set(
  ("a an and are as at be been but by can could do does for from had has have how i if in into is it its job may " +
    "more most must my no not of on or our out over own per role s so some such than that the their them then there " +
    "these they this those to too under up us use using very we what when where which while who why will with within " +
    "work working you your you'll we're it's role's years year experience team teams plus etc ability able across also " +
    "well including include includes strong good great new other others within role.").split(" "),
);

export function tokenize(text: string): string[] {
  return stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

/** Jaccard-ish overlap between two token sets, 0..1. */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.min(a.size, b.size);
}

/** Fuzzy title similarity that rewards phrase containment. */
export function titleSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  return overlap(tokenSet(na), tokenSet(nb));
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function truncate(text: string, max = 220): string {
  const clean = cleanLine(text);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diff = Date.now() - then;
  const day = 86_400_000;
  if (diff < 0) {
    const days = Math.ceil(-diff / day);
    return days <= 1 ? "in 1 day" : `in ${days} days`;
  }
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
  if (diff < day) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
