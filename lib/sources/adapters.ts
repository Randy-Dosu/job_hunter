import remotiveFixture from "@/data/fixtures/remotive.json";
import arbeitnowFixture from "@/data/fixtures/arbeitnow.json";
import remoteokFixture from "@/data/fixtures/remoteok.json";
import { finalizeJob, isStale, matchesCriteria } from "./normalize";
import type { FetchOutcome, JobSourceAdapter, NormalizedJob, SearchCriteria, SourceHealth } from "./types";

const FIXTURE_FALLBACK = process.env.SOURCE_FIXTURE_FALLBACK !== "false";
const TIMEOUT_MS = 8_000;

type Json = Record<string, unknown>;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "JobHunter/0.1 (+https://job-hunter.app/source-policy)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

export function extractDeadline(text: string): string | null {
  const match = text.match(/(?:applications? (?:close|closed)s?|deadline|apply by|closing date)[^0-9]{0,20}(\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (!match) return null;
  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function withDeadlines(jobs: NormalizedJob[]): NormalizedJob[] {
  return jobs.map((job) => {
    if (job.deadline) return job;
    const deadline = extractDeadline(job.description);
    return deadline ? { ...job, deadline } : job;
  });
}

function filterAndTrim(jobs: NormalizedJob[], criteria: SearchCriteria): NormalizedJob[] {
  return jobs
    .filter((job) => !isStale(job.postedAt, 60))
    .filter((job) => matchesCriteria(job, criteria))
    .slice(0, criteria.limitPerSource);
}

abstract class BaseAdapter implements JobSourceAdapter {
  abstract readonly slug: string;
  abstract readonly name: string;
  abstract readonly sourceType: string;
  abstract readonly accessMethod: string;
  abstract readonly termsUrl: string;
  abstract readonly supportedMarkets: string;
  protected abstract endpoint: string;
  protected abstract parse(payload: unknown): NormalizedJob[];
  protected abstract fixture: unknown;

  /** Exposed for the public landing preview and tests: parse the saved fixture. */
  parseFixturePayload(): NormalizedJob[] {
    return withDeadlines(this.parse(this.fixture));
  }

  async search(criteria: SearchCriteria): Promise<FetchOutcome> {
    try {
      const payload = await fetchJson(this.endpoint);
      const jobs = filterAndTrim(withDeadlines(this.parse(payload)), criteria);
      return { jobs, usedFixture: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown source error";
      if (!FIXTURE_FALLBACK) return { jobs: [], usedFixture: false, error: message };
      const jobs = filterAndTrim(withDeadlines(this.parse(this.fixture)), criteria);
      return { jobs, usedFixture: true, error: message };
    }
  }

  async healthCheck(): Promise<SourceHealth> {
    try {
      const res = await fetch(this.endpoint, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
        headers: { "User-Agent": "JobHunter/0.1" },
        cache: "no-store",
      });
      return {
        ok: res.ok,
        checkedAt: new Date().toISOString(),
        detail: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}`,
        usedFixture: false,
      };
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : "Unreachable",
        usedFixture: true,
      };
    }
  }
}

export class RemotiveAdapter extends BaseAdapter {
  readonly slug = "remotive";
  readonly name = "Remotive";
  readonly sourceType = "public_api";
  readonly accessMethod = "Public JSON API (no key)";
  readonly termsUrl = "https://remotive.com/api/remote-jobs";
  readonly supportedMarkets = "Global remote";
  protected endpoint = process.env.REMOTIVE_API_URL ?? "https://remotive.com/api/remote-jobs?limit=100";
  protected fixture = remotiveFixture;

  protected parse(payload: unknown): NormalizedJob[] {
    const jobs = (payload as { jobs?: Json[] })?.jobs ?? [];
    return jobs.map((raw) =>
      finalizeJob({
        sourceSlug: this.slug,
        externalId: String(raw.id ?? raw.url),
        title: String(raw.title ?? ""),
        company: String(raw.company_name ?? ""),
        location: String(raw.candidate_required_location ?? "Remote"),
        remotePolicy: "remote",
        remoteFlag: true,
        description: String(raw.description ?? ""),
        salary: (raw.salary as string) || null,
        employmentType: raw.job_type === "full_time" ? "full-time" : raw.job_type === "contract" ? "contract" : undefined,
        postedAt: (raw.publication_date as string) ?? null,
        url: String(raw.url ?? ""),
        raw,
      }),
    );
  }
}

export class ArbeitnowAdapter extends BaseAdapter {
  readonly slug = "arbeitnow";
  readonly name = "Arbeitnow";
  readonly sourceType = "public_feed";
  readonly accessMethod = "Public job-board API (no key)";
  readonly termsUrl = "https://www.arbeitnow.com/api/job-board-api";
  readonly supportedMarkets = "Europe, global remote";
  protected endpoint = process.env.ARBEITNOW_API_URL ?? "https://www.arbeitnow.com/api/job-board-api";
  protected fixture = arbeitnowFixture;

  protected parse(payload: unknown): NormalizedJob[] {
    const jobs = (payload as { data?: Json[] })?.data ?? [];
    return jobs.map((raw) =>
      finalizeJob({
        sourceSlug: this.slug,
        externalId: String(raw.slug ?? raw.url),
        title: String(raw.title ?? ""),
        company: String(raw.company_name ?? ""),
        location: String(raw.location ?? ""),
        remoteFlag: Boolean(raw.remote),
        description: String(raw.description ?? ""),
        employmentType: Array.isArray(raw.job_types) ? String(raw.job_types[0]) : undefined,
        postedAt: (raw.created_at as number) ?? null,
        url: String(raw.url ?? ""),
        raw,
      }),
    );
  }
}

export class RemoteOkAdapter extends BaseAdapter {
  readonly slug = "remoteok";
  readonly name = "Remote OK";
  readonly sourceType = "public_feed";
  readonly accessMethod = "Public RSS/JSON feed with attribution";
  readonly termsUrl = "https://remoteok.com/api";
  readonly supportedMarkets = "Global remote";
  protected endpoint = process.env.REMOTEOK_API_URL ?? "https://remoteok.com/api";
  protected fixture = remoteokFixture;

  protected parse(payload: unknown): NormalizedJob[] {
    const items = Array.isArray(payload) ? (payload as Json[]) : [];
    return items
      .filter((raw) => raw && (raw.position || raw.title) && raw.id)
      .map((raw) => {
        const min = raw.salary_min as number | undefined;
        const max = raw.salary_max as number | undefined;
        const salary = min || max ? `$${min ? min.toLocaleString() : "?"} - $${max ? max.toLocaleString() : "?"}` : null;
        return finalizeJob({
          sourceSlug: this.slug,
          externalId: String(raw.id ?? raw.slug),
          title: String(raw.position ?? raw.title ?? ""),
          company: String(raw.company ?? ""),
          location: String(raw.location ?? "Worldwide"),
          remoteFlag: true,
          description: String(raw.description ?? ""),
          salary,
          postedAt: (raw.date as string) ?? (raw.epoch as number) ?? null,
          url: String(raw.url ?? `https://remoteok.com/remote-jobs/${raw.id}`),
          applicationUrl: (raw.apply_url as string) ?? undefined,
          raw,
        });
      });
  }
}

export const adapters: JobSourceAdapter[] = [
  new RemotiveAdapter(),
  new ArbeitnowAdapter(),
  new RemoteOkAdapter(),
];

export function getAdapter(slug: string): JobSourceAdapter | undefined {
  return adapters.find((adapter) => adapter.slug === slug);
}

