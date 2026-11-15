/**
 * Connector tests. All network traffic is replaced by an injected fetch that
 * returns fixtures — no real requests are made, so these tests are deterministic.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  arbeitnowConnector,
  decodeEntities,
  greenhouseConnector,
  htmlToText,
  inferSeniority,
  jobicyConnector,
  normalizeEmploymentType,
  parseRssItems,
  remoteOkConnector,
  remotiveConnector,
  resolveCountryCode,
  safeUrl,
  weWorkRemotelyConnector,
  getEnabledConnectors,
  getManualHandoffSources,
  SOURCE_REGISTER,
} from '../src/index.js';
import { makePreferences } from '../../matching/test/fixtures.js';

const REMOTEOK_FIXTURE = [
  { legal: 'Remote OK API terms' },
  {
    id: 'ro-1',
    slug: 'senior-typescript-engineer-zola',
    epoch: 1762800000,
    company: 'Zola Systems',
    position: 'Senior TypeScript Engineer',
    tags: ['typescript', 'node', 'remote'],
    description:
      '<p>Build <strong>payment</strong> services in TypeScript.</p><script>alert(1)</script>',
    location: 'Worldwide',
    salary_min: 90_000,
    salary_max: 130_000,
    apply_url: 'https://remoteok.com/remote-jobs/ro-1',
  },
  {
    id: 'ro-2',
    slug: 'nurse-cape-coast',
    company: 'Cape Coast Clinic',
    position: 'Registered Nurse',
    tags: ['nursing'],
    description: 'Clinical care role.',
    location: 'Ghana',
    url: 'https://remoteok.com/remote-jobs/ro-2',
  },
];

const WWR_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[Zola Systems: Senior Backend Engineer (TypeScript)]]></title>
    <region>Anywhere in the World</region>
    <link>https://weworkremotely.com/remote-jobs/zola-senior-backend</link>
    <pubDate>Mon, 10 Nov 2026 08:00:00 +0000</pubDate>
    <guid>https://weworkremotely.com/remote-jobs/zola-senior-backend</guid>
    <description><![CDATA[<p>TypeScript &amp; Node.js backend role.</p>]]></description>
  </item>
  <item>
    <title><![CDATA[Cape Coast Clinic: Theatre Nurse]]></title>
    <region>Ghana</region>
    <link>https://weworkremotely.com/remote-jobs/clinic-nurse</link>
    <guid>https://weworkremotely.com/remote-jobs/clinic-nurse</guid>
    <description>Nursing role.</description>
  </item>
</channel></rss>`;

function jsonFetch(payload: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof globalThis.fetch;
}

function textFetch(body: string, status = 200): typeof globalThis.fetch {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof globalThis.fetch;
}

const context = (fetchImpl: typeof globalThis.fetch) => ({ fetch: fetchImpl, timeoutMs: 5_000 });
const query = remoteOkConnector.buildQuery(makePreferences(), 10);

describe('Remote OK connector', () => {
  it('skips the legal notice element and maps real listings', async () => {
    const result = await remoteOkConnector.fetchPage(query, context(jsonFetch(REMOTEOK_FIXTURE)));
    expect(result.jobs).toHaveLength(1);
    const job = result.jobs[0]!;
    expect(job.title).toBe('Senior TypeScript Engineer');
    expect(job.company).toBe('Zola Systems');
    expect(job.remote).toBe(true);
    expect(job.salaryMin).toBe(90_000);
    expect(job.salaryCurrency).toBe('USD');
    expect(job.tags).toContain('typescript');
  });

  it('strips scripts and markup from descriptions', async () => {
    const result = await remoteOkConnector.fetchPage(query, context(jsonFetch(REMOTEOK_FIXTURE)));
    const description = result.jobs[0]!.description;
    expect(description).toContain('payment');
    expect(description).not.toContain('<script');
    expect(description).not.toContain('alert(1)');
  });

  it('filters out listings that do not match the user keywords', async () => {
    const result = await remoteOkConnector.fetchPage(
      // Both titles and keywords must miss, otherwise a keyword match is a
      // legitimate hit (keywords are matched independently of titles).
      remoteOkConnector.buildQuery(
        makePreferences({ targetTitles: ['Accountant'], targetKeywords: [] }),
        10,
      ),
      context(jsonFetch(REMOTEOK_FIXTURE)),
    );
    expect(result.jobs).toHaveLength(0);
  });

  it('throws on an unexpected payload shape so the engine can isolate it', async () => {
    await expect(
      remoteOkConnector.fetchPage(query, context(jsonFetch({ error: 'rate limited' }))),
    ).rejects.toThrow(/unexpected payload/i);
  });

  it('retries transient 5xx responses then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response('upstream error', { status: 503 });
      return new Response(JSON.stringify(REMOTEOK_FIXTURE), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const result = await remoteOkConnector.fetchPage(query, { ...context(fetchImpl) });
    expect(calls).toBe(2);
    expect(result.jobs).toHaveLength(1);
  });

  it('does not retry a permanent 404', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    await expect(remoteOkConnector.fetchPage(query, context(fetchImpl))).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });
});

describe('We Work Remotely RSS connector', () => {
  it('parses RSS items and splits "Company: Title"', () => {
    const items = parseRssItems(WWR_RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      company: 'Zola Systems',
      title: 'Senior Backend Engineer (TypeScript)',
    });
    expect(items[0]!.description).toContain('TypeScript & Node.js');
  });

  it('returns normalised, keyword-filtered listings', async () => {
    const result = await weWorkRemotelyConnector.fetchPage(
      weWorkRemotelyConnector.buildQuery(makePreferences(), 10),
      context(textFetch(WWR_RSS)),
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]!.remote).toBe(true);
    expect(result.jobs[0]!.url).toMatch(/^https:\/\/weworkremotely\.com\//);
    expect(result.jobs[0]!.externalId).toContain('zola');
  });

  it('reports a failure only when every feed fails', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof globalThis.fetch;
    await expect(
      weWorkRemotelyConnector.fetchPage(
        weWorkRemotelyConnector.buildQuery(makePreferences(), 10),
        context(failing),
      ),
    ).rejects.toThrow(/All We Work Remotely feeds failed/);
  });
});

describe('Remotive, Jobicy and Arbeitnow connectors', () => {
  it('maps Remotive listings with employment type and salary text', async () => {
    const payload = {
      jobs: [
        {
          id: 42,
          url: 'https://remotive.com/remote-jobs/software-dev/senior-backend-42',
          title: 'Senior Backend Engineer',
          company_name: 'Zola Systems',
          category: 'Software Development',
          tags: ['typescript', 'nodejs'],
          job_type: 'full_time',
          publication_date: '2026-11-10T08:00:00',
          candidate_required_location: 'Worldwide',
          salary: '$120,000 - $150,000',
          description: '<p>TypeScript microservices.</p>',
        },
      ],
    };
    const result = await remotiveConnector.fetchPage(
      remotiveConnector.buildQuery(makePreferences(), 10),
      context(jsonFetch(payload)),
    );
    expect(result.jobs[0]).toMatchObject({ company: 'Zola Systems', remote: true });
    expect(result.jobs[0]!.employmentTypeHint).toBe('full_time');
    expect(result.jobs[0]!.salaryRaw).toContain('120,000');
  });

  it('maps Jobicy listings and keeps annual salary numbers', async () => {
    const payload = {
      jobs: [
        {
          id: 7,
          url: 'https://jobicy.com/jobs/7-senior-typescript-engineer',
          jobTitle: 'Senior TypeScript Engineer',
          companyName: 'Zola Systems',
          jobIndustry: ['Engineering'],
          jobType: ['full-time'],
          jobGeo: 'Anywhere',
          jobLevel: 'Senior',
          annualSalaryMin: 100_000,
          annualSalaryMax: 140_000,
          salaryCurrency: 'USD',
          pubDate: '2026-11-11T10:00:00+00:00',
          jobDescription: '<div>Node.js &amp; TypeScript.</div>',
        },
      ],
    };
    const result = await jobicyConnector.fetchPage(
      jobicyConnector.buildQuery(makePreferences(), 10),
      context(jsonFetch(payload)),
    );
    expect(result.jobs[0]).toMatchObject({
      title: 'Senior TypeScript Engineer',
      salaryMin: 100_000,
      salaryMax: 140_000,
      salaryCurrency: 'USD',
    });
    expect(result.jobs[0]!.seniorityHint).toBe('senior');
  });

  it('honours remoteOnly for Arbeitnow listings that are onsite', async () => {
    const payload = {
      data: [
        {
          slug: 'backend-berlin',
          company_name: 'Zola Systems',
          title: 'Backend Engineer TypeScript',
          description: 'Node.js services.',
          remote: false,
          url: 'https://www.arbeitnow.com/view/backend-berlin',
          tags: ['typescript'],
          job_types: ['full_time'],
          location: 'Berlin',
          created_at: 1762800000,
        },
        {
          slug: 'backend-remote',
          company_name: 'Kilima Cloud',
          title: 'Backend Engineer Node',
          description: 'Remote TypeScript role.',
          remote: true,
          url: 'https://www.arbeitnow.com/view/backend-remote',
          tags: ['nodejs'],
          job_types: ['full_time'],
          location: 'Remote',
          created_at: 1762800000,
        },
      ],
      links: { next: null },
    };

    const remoteOnly = await arbeitnowConnector.fetchPage(
      arbeitnowConnector.buildQuery(makePreferences({ remoteOnly: true }), 10),
      context(jsonFetch(payload)),
    );
    expect(remoteOnly.jobs).toHaveLength(1);
    expect(remoteOnly.jobs[0]!.remote).toBe(true);

    const anyMode = await arbeitnowConnector.fetchPage(
      arbeitnowConnector.buildQuery(makePreferences({ remoteOnly: false }), 10),
      context(jsonFetch(payload)),
    );
    expect(anyMode.jobs).toHaveLength(2);
  });
});

describe('company career page connectors', () => {
  it('skip cleanly (not fail) when no boards are configured', async () => {
    await expect(greenhouseConnector.fetchPage(query, context(jsonFetch({})))).resolves.toEqual(
      expect.objectContaining({ jobs: [] }),
    );
    expect(greenhouseConnector.isConfigured()).toBe(false);
  });
});

describe('normalisation helpers', () => {
  it('converts HTML to clean text and decodes entities', () => {
    const html =
      '<div>Senior&nbsp;Engineer &amp; Team Lead</div><ul><li>TypeScript</li><li>Node.js</li></ul><style>.x{}</style>';
    const text = htmlToText(html);
    expect(text).toContain('Senior Engineer & Team Lead');
    expect(text).toContain('• TypeScript');
    expect(text).not.toContain('<');
    expect(decodeEntities('&lt;tag&gt; &quot;quoted&quot; &#39;apos&#39;')).toBe(
      '<tag> "quoted" \'apos\'',
    );
  });

  it('resolves country codes from location strings', () => {
    expect(resolveCountryCode({ locationRaw: 'Berlin, Germany' })).toBe('DE');
    expect(resolveCountryCode({ locationRaw: 'Accra, Ghana' })).toBe('GH');
    expect(resolveCountryCode({ locationRaw: 'Anywhere in the World' })).toBeUndefined();
    expect(resolveCountryCode({ countryHint: 'US' })).toBe('US');
    expect(resolveCountryCode({ locationRaw: 'Remote - Europe' })).toBeUndefined();
  });

  it('infers seniority and employment type from titles', () => {
    expect(inferSeniority('Senior Backend Engineer')).toBe('senior');
    expect(inferSeniority('Staff Engineer')).toBe('principal');
    expect(inferSeniority('Junior Developer')).toBe('junior');
    expect(inferSeniority('Backend Engineer')).toBe('unknown');
    expect(normalizeEmploymentType('full-time')).toBe('full_time');
    expect(normalizeEmploymentType('Contract')).toBe('contract');
    expect(normalizeEmploymentType('')).toBe('unknown');
  });

  it('rejects unsafe URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('data:text/html,<script>')).toBeUndefined();
    expect(safeUrl('http://example.test/job/1')).toBe('https://example.test/job/1');
    expect(safeUrl('/jobs/1', 'remoteok.com')).toBe('https://remoteok.com/jobs/1');
  });
});

describe('source register — compliance gating', () => {
  it('only enables connectors with a permitted automated access method', () => {
    const connectors = getEnabledConnectors(SOURCE_REGISTER.map((entry) => entry.id));
    expect(connectors.length).toBeGreaterThan(0);
    expect(connectors.every((connector) => connector.accessMethod === 'public_api')).toBe(true);
    // LinkedIn/Indeed/Wellfound/Google Jobs are never automated.
    const automatedIds = connectors.map((connector) => connector.id);
    expect(automatedIds).not.toContain('linkedin');
    expect(automatedIds).not.toContain('indeed');
    expect(automatedIds).not.toContain('wellfound');
    expect(automatedIds).not.toContain('google_jobs');
  });

  it('offers manual handoff links instead of scraping restricted sites', () => {
    const links = getManualHandoffSources(['linkedin', 'indeed', 'google_jobs', 'wellfound']);
    expect(links).toHaveLength(4);
    for (const entry of links) {
      const url = entry.manualSearchUrl?.({ titles: ['Backend Engineer'], locations: ['Accra'] });
      expect(url).toMatch(/^https:\/\//);
    }
    const linkedin = links.find((entry) => entry.id === 'linkedin');
    expect(
      linkedin?.manualSearchUrl?.({ titles: ['Backend Engineer'], locations: ['Accra'] }),
    ).toContain('keywords=Backend%20Engineer');
  });

  it('records a review note and access method for every registered source', () => {
    for (const entry of SOURCE_REGISTER) {
      expect(entry.complianceNote.length).toBeGreaterThan(20);
      expect(entry.review.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['public_api', 'manual_handoff', 'disabled']).toContain(entry.accessMethod);
    }
  });
});
