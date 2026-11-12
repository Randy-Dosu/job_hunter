import { inferEmploymentType, inferRemotePolicy, inferSeniority, splitSections } from "./normalize";
import { htmlToText } from "@/lib/text";
import type { NormalizedJob } from "./types";

/**
 * User-supplied job link (FR-017).
 *
 * One polite fetch of a public page, parsed for schema.org/JobPosting or Open
 * Graph data. No login, no CAPTCHA solving, no retries against a block page and
 * no crawling: if the page does not expose the vacancy in its markup, the user
 * is told to add it manually rather than guessing at fields.
 */

export type ParsedManualJob = {
  job: Omit<NormalizedJob, "sourceSlug" | "raw"> & { raw: Record<string, unknown> };
  warnings: string[];
};

type JsonLd = Record<string, unknown>;

const MAX_HTML_BYTES = 2_000_000;

function jsonLdBlocks(html: string): JsonLd[] {
  const blocks: JsonLd[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    try {
      const parsed = JSON.parse(raw) as unknown;
      const queue = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of queue) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as JsonLd;
        const graph = record["@graph"];
        if (Array.isArray(graph)) {
          for (const node of graph) if (node && typeof node === "object") blocks.push(node as JsonLd);
        } else {
          blocks.push(record);
        }
      }
    } catch {
      // Malformed JSON-LD is common; fall through to other blocks or meta tags.
    }
  }
  return blocks;
}

function hasType(node: JsonLd, type: string): boolean {
  const value = node["@type"];
  if (typeof value === "string") return value.toLowerCase() === type.toLowerCase();
  if (Array.isArray(value)) return value.some((entry) => String(entry).toLowerCase() === type.toLowerCase());
  return false;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstString(entry);
      if (found) return found;
    }
  }
  return null;
}

function metaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    const match = pattern.exec(html);
    if (match?.[1]?.trim()) return match[1].trim();
    const reversed = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      "i",
    );
    const reverseMatch = reversed.exec(html);
    if (reverseMatch?.[1]?.trim()) return reverseMatch[1].trim();
  }
  return null;
}

function salaryFrom(node: JsonLd): string | null {
  const salary = node.baseSalary as JsonLd | undefined;
  if (!salary) return null;
  const value = (salary.value ?? salary) as JsonLd;
  const currency = firstString(salary.currency) ?? firstString(value.currency);
  const min = typeof value.minValue === "number" ? value.minValue : Number(firstString(value.minValue) ?? NaN);
  const max = typeof value.maxValue === "number" ? value.maxValue : Number(firstString(value.maxValue) ?? NaN);
  const unit = firstString(value.unitText);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return null;
  const symbol = currency ?? "";
  const range =
    Number.isFinite(min) && Number.isFinite(max)
      ? `${symbol} ${min.toLocaleString()} – ${max.toLocaleString()}`
      : `${symbol} ${(Number.isFinite(min) ? min : max).toLocaleString()}`;
  return `${range.trim()}${unit ? ` / ${unit.toLowerCase()}` : ""}`;
}

function locationFrom(node: JsonLd): { location: string; remote: boolean } {
  if (String(node.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE") {
    return { location: "Remote", remote: true };
  }
  const raw = node.jobLocation;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const place = entry as JsonLd;
    const address = (place.address ?? place) as JsonLd;
    if (typeof address === "string") return { location: address, remote: false };
    const parts = [
      firstString(address.addressLocality),
      firstString(address.addressRegion),
      firstString(address.addressCountry),
    ].filter(Boolean) as string[];
    if (parts.length) return { location: parts.join(", "), remote: false };
  }
  return { location: "", remote: false };
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseJobPage(html: string, url: string): { ok: true; parsed: ParsedManualJob } | { ok: false; error: string } {
  if (html.length > MAX_HTML_BYTES) return { ok: false, error: "That page is too large to read safely." };
  const warnings: string[] = [];
  const posting = jsonLdBlocks(html).find((node) => hasType(node, "JobPosting"));

  let title = "";
  let company = "";
  let location = "";
  let remoteFlag = false;
  let descriptionText = "";
  let salary: string | null = null;
  let employmentType = "";
  let postedAt: string | null = null;
  let deadline: string | null = null;
  let applicationUrl = url;
  let raw: Record<string, unknown> = { parser: "meta" };

  if (posting) {
    title = firstString(posting.title) ?? "";
    const org = posting.hiringOrganization as JsonLd | string | undefined;
    company = typeof org === "string" ? org : (firstString((org as JsonLd)?.name) ?? "");
    const place = locationFrom(posting);
    location = place.location;
    remoteFlag = place.remote;
    descriptionText = htmlToText(firstString(posting.description) ?? "");
    salary = salaryFrom(posting);
    // schema.org uses FULL_TIME / PART_TIME; the shared inferrer expects words.
    employmentType = (firstString(posting.employmentType) ?? "").replace(/_/g, " ");
    postedAt = isoDate(firstString(posting.datePosted));
    deadline = isoDate(firstString(posting.validThrough));
    applicationUrl = firstString(posting.directApplyTo) ?? firstString(posting.url) ?? url;
    raw = { parser: "jsonld", node: posting } as Record<string, unknown>;
  }

  if (!title) {
    title = metaContent(html, ["og:title", "twitter:title"]) ?? "";
    if (/<title[^>]*>([\s\S]*?)<\/title>/i.test(html)) {
      title = title || htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)![1]);
    }
    if (!title) return { ok: false, error: "No job title could be read from that page." };
    warnings.push("The page has no JobPosting markup, so fields come from its title and description tags. Check them before saving.");
  }
  if (!company) {
    company = metaContent(html, ["og:site_name"]) ?? new URL(url).hostname.replace(/^www\./, "");
    warnings.push("Employer name was inferred from the site, not the listing.");
  }
  if (!descriptionText) {
    const metaDescription = metaContent(html, ["og:description", "description"]) ?? "";
    descriptionText = htmlToText(metaDescription);
    if (!descriptionText) warnings.push("No description could be extracted; the listing will score with low confidence.");
  }
  if (!location) {
    location = remoteFlag ? "Remote" : "";
    if (!location) warnings.push("Location is unknown for this listing.");
  }
  if (!postedAt) warnings.push("Posting date is unknown.");
  if (applicationUrl && !/^https?:/i.test(applicationUrl)) applicationUrl = url;

  const remotePolicy = inferRemotePolicy(location, remoteFlag, descriptionText);
  const sections = splitSections(descriptionText);
  const canonical = new URL(url);

  const job = {
    externalId: `manual-${canonical.hostname}-${Buffer.from(canonical.pathname).toString("base64url").slice(0, 40)}`,
    title: title.slice(0, 200),
    company: company.slice(0, 160),
    location: location.slice(0, 160),
    remotePolicy,
    description: descriptionText.slice(0, 12_000),
    responsibilities: sections.responsibilities,
    requirements: sections.requirements,
    salary,
    employmentType: inferEmploymentType(employmentType, title),
    seniority: inferSeniority(title, descriptionText),
    postedAt,
    deadline,
    url,
    applicationUrl,
    raw,
  };

  return { ok: true, parsed: { job, warnings } };
}

const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\])/i;

/** SSRF guard: only public http(s) hosts, never the app's own network. */
export function assertPublicUrl(input: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, error: "Only http and https links are supported." };
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.test(host)) return { ok: false, error: "That address is not reachable from the server." };
  if (/\.(local|internal|localhost)$/.test(host)) return { ok: false, error: "That address is not reachable from the server." };
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return { ok: false, error: "That address is not reachable from the server." };
  if (url.username || url.password) return { ok: false, error: "Links with embedded credentials are not allowed." };
  return { ok: true, url };
}
