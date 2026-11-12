export type RemotePolicy = "remote" | "hybrid" | "onsite" | "unknown";

export type SearchCriteria = {
  roleTitles: string[];
  keywords: string[];
  countries: string[];
  remotePreference: string;
  limitPerSource: number;
};

export type SourceHealth = {
  ok: boolean;
  checkedAt: string;
  detail: string;
  usedFixture: boolean;
};

export type NormalizedJob = {
  sourceSlug: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  remotePolicy: RemotePolicy;
  description: string;
  responsibilities: string;
  requirements: string;
  salary: string | null;
  employmentType: string;
  seniority: string;
  postedAt: string | null;
  deadline: string | null;
  url: string;
  applicationUrl: string;
  raw: unknown;
};

export type FetchOutcome = {
  jobs: NormalizedJob[];
  usedFixture: boolean;
  error?: string;
};

export interface JobSourceAdapter {
  readonly slug: string;
  readonly name: string;
  readonly sourceType: string;
  readonly accessMethod: string;
  readonly termsUrl: string;
  readonly supportedMarkets: string;
  search(criteria: SearchCriteria): Promise<FetchOutcome>;
  healthCheck(): Promise<SourceHealth>;
}
