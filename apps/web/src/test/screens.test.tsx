/**
 * Web UI tests.
 *
 * These are contract tests, not snapshot tests: they assert that the screens
 * read the *actual* API shapes (nested location/salary, `state.saved`, nested
 * `application.events`) and that the product's safety rules survive in the UI:
 *
 *   - nothing unapproved can be exported or attached;
 *   - a warning-bearing document cannot be approved without acknowledgement;
 *   - "applied" is never implied — the tracker only records what the user did.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardPage from '../pages/DashboardPage.js';
import JobsPage from '../pages/JobsPage.js';
import JobDetailPage from '../pages/JobDetailPage.js';
import ApplicationsPage from '../pages/ApplicationsPage.js';
import StudioPage from '../pages/StudioPage.js';
import type { JobDetailResponse } from '../lib/types.js';

/** Minimal JSON response helper for the stubbed fetch. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Routes = Record<string, () => Response>;

function stubFetch(routes: Routes): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const [base, search] = url.replace('/api/v1', '').split('?');
      const path = search ? `${base ?? ''}?${search}` : (base ?? '');
      const key = Object.keys(routes)
        .filter((candidate) => path === candidate || (base ?? '').startsWith(candidate))
        .sort((a, b) => b.length - a.length)[0];

      // A route may declare its own failure so the error state can be exercised.
      if (!key) {
        return json(
          { error: { code: 'not_found', message: `no stub for ${init?.method ?? 'GET'} ${path}` } },
          404,
        );
      }
      return routes[key]!();
    }),
  );
}

/**
 * Render a page at a route pattern with a concrete URL (params are only
 * substituted when the router matches a real path, not a `:param` literal).
 */
function renderAt(pattern: string, element: React.ReactElement, url = pattern): void {
  const router = createMemoryRouter([{ path: pattern, element }], { initialEntries: [url] });
  render(<RouterProvider router={router} />);
}

const DOCUMENT_ID = '55555555-5555-5555-5555-555555555555';

const DASHBOARD = {
  jobs: {
    total: 42,
    newLast24h: 7,
    highMatches: 3,
    topMatches: [
      {
        jobId: '11111111-1111-1111-1111-111111111111',
        score: 88,
        band: 'strong',
        title: 'Senior Backend Engineer',
        company: 'Acme',
        location: 'Accra, GH',
        remote: true,
        source: 'remotive',
        freshness: 'new',
      },
    ],
  },
  applications: {
    total: 2,
    byStatus: { applied: 2 },
    upcoming: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        status: 'applied',
        nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
        job: { title: 'Platform Engineer', company: 'Globex' },
      },
    ],
  },
  scan: {
    id: '33333333-3333-3333-3333-333333333333',
    status: 'partial',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    jobsFound: 12,
    jobsNew: 7,
    errorSummary: 'One source timed out',
    sources: [],
  },
  schedule: {
    enabled: true,
    timeZone: 'Africa/Accra',
    scanHourLocal: 8,
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
    dueNow: false,
  },
  profile: { verifiedFacts: 3, unverifiedFacts: 4, resumes: 1, ready: false },
  documents: { awaitingReview: 2 },
  notifications: { unread: 0 },
};

const JOB_DETAIL: JobDetailResponse = {
  job: {
    id: '44444444-4444-4444-4444-444444444444',
    title: 'Backend Engineer',
    company: 'Initech',
    companyLogoUrl: null,
    url: 'https://example.com/jobs/1',
    source: 'remotive',
    sources: ['remotive'],
    location: { raw: 'Remote (Worldwide)', countryCode: null, remote: true, workplace: 'remote' },
    employmentType: 'full_time',
    seniority: 'senior',
    salary: { min: 90000, max: 120000, currency: 'USD', period: 'year' },
    tags: ['typescript', 'postgres'],
    freshness: 'fresh',
    postedAt: new Date(Date.now() - 3_600_000).toISOString(),
    firstSeenAt: new Date(Date.now() - 3_600_000).toISOString(),
    description: 'Build and operate the payments platform.',
    lastCheckedAt: new Date().toISOString(),
  },
  match: {
    score: 72,
    band: 'good',
    scoringVersion: '2026-11-13.1',
    profileVersion: '3',
    usedSemantic: false,
    computedAt: new Date().toISOString(),
    excluded: false,
    exclusionReason: null,
    breakdown: [
      {
        label: 'Skills',
        scorePercent: 80,
        weightPercent: 30,
        points: 24,
        rationale: 'Matched 4 of 5 required skills.',
        unknowns: [],
        status: 'match',
      },
      {
        label: 'Experience',
        scorePercent: null,
        weightPercent: 25,
        points: 0,
        rationale: 'No dated roles matched the seniority requirement.',
        unknowns: ['Years of experience is unknown'],
        status: 'unknown',
      },
    ],
    evidence: [
      {
        dimension: 'skills',
        factId: 'fact-1',
        factLabel: 'TypeScript',
        requirement: 'TypeScript',
        strength: 'strong',
      },
    ],
    gaps: [
      {
        dimension: 'skills',
        requirement: 'Kubernetes',
        kind: 'missing_evidence',
        detail: 'No verified fact mentions Kubernetes.',
      },
    ],
    unknowns: [
      {
        dimension: 'experience',
        requirement: 'Years of experience',
        kind: 'unknown',
        detail: 'No dated role covers this period.',
      },
    ],
  },
  state: { saved: true, dismissed: false, feedback: null },
  application: null,
  documents: [
    {
      id: '55555555-5555-5555-5555-555555555555',
      kind: 'resume',
      version: 1,
      status: 'needs_review',
      createdAt: new Date().toISOString(),
      warnings: ['Claim not in your verified facts: "led a team of 9"'],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  // Auto-cleanup needs Vitest globals, which this repo does not enable.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('dashboard', () => {
  it('renders the real summary shape and flags unfinished verification', async () => {
    stubFetch({ '/dashboard': () => json(DASHBOARD) });
    renderAt('/', <DashboardPage />);

    expect(await screen.findByText('Senior Backend Engineer')).toBeDefined();
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    expect(screen.getByText('42 active listings tracked')).toBeDefined();
    // Unverified facts must surface as a warning, not silently pass.
    expect(screen.getByText(/Finish setting up your profile/)).toBeDefined();
    // Draft documents awaiting review are called out with a link.
    expect(screen.getByText(/2 documents waiting for you/)).toBeDefined();
    // A partially failed scan is not reported as success.
    expect(screen.getByText('partial')).toBeDefined();
  });

  it('surfaces a load failure with a retry affordance', async () => {
    stubFetch({
      '/dashboard': () =>
        json({ error: { code: 'internal', message: 'The scan service is unavailable.' } }, 500),
    });
    renderAt('/', <DashboardPage />);
    expect(await screen.findByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('The scan service is unavailable.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });
});

describe('job feed', () => {
  it('uses the nested location/salary shape and top-level saved flag', async () => {
    stubFetch({
      '/jobs': () =>
        json({
          items: [
            {
              id: '44444444-4444-4444-4444-444444444444',
              title: 'Backend Engineer',
              company: 'Initech',
              companyLogoUrl: null,
              url: 'https://example.com/jobs/1',
              source: 'remotive',
              sources: ['remotive'],
              location: {
                raw: 'Remote (Worldwide)',
                countryCode: null,
                remote: true,
                workplace: 'remote',
              },
              employmentType: 'full_time',
              seniority: 'senior',
              salary: { min: 90000, max: 120000, currency: 'USD', period: 'year' },
              tags: [],
              freshness: 'new',
              postedAt: null,
              firstSeenAt: new Date().toISOString(),
              match: {
                score: 72,
                band: 'good',
                summary: 'Strong on skills · 1 requirement not evidenced',
              },
              saved: true,
              dismissed: false,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      '/sources': () => json({ sources: [], automatedCount: 0, manualHandoff: [] }),
    });

    renderAt('/jobs', <JobsPage />);

    expect(await screen.findByText('Backend Engineer')).toBeDefined();
    expect(screen.getByText(/Remote \(Worldwide\)/)).toBeDefined();
    // Saved state comes from the item, so the button reflects "Saved".
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDefined();
    expect(screen.getByText(/1 listing/)).toBeDefined();
  });

  it('shows "not enough information" instead of a number when nothing is verified', async () => {
    stubFetch({
      '/jobs': () =>
        json({
          items: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              title: 'Platform Engineer',
              company: 'Umbrella',
              companyLogoUrl: null,
              url: 'https://example.com/jobs/2',
              source: 'remotive',
              sources: ['remotive'],
              location: { raw: 'Remote', countryCode: null, remote: true, workplace: 'remote' },
              employmentType: 'full_time',
              seniority: 'senior',
              salary: null,
              tags: [],
              freshness: 'new',
              postedAt: null,
              firstSeenAt: new Date().toISOString(),
              match: { score: 33, band: 'weak', scoreable: false },
              saved: false,
              dismissed: false,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      '/sources': () => json({ sources: [], automatedCount: 0, manualHandoff: [] }),
    });

    renderAt('/jobs', <JobsPage />);

    expect(await screen.findByText('Platform Engineer')).toBeDefined();
    // The meaningless 33 must not be presented as a judgement of fit.
    expect(screen.getByText('Not enough information')).toBeDefined();
    expect(screen.queryByText('33')).toBeNull();
    expect(screen.queryByText(/weak fit/i)).toBeNull();
  });

  it('shows an empty state instead of a blank page', async () => {
    stubFetch({
      '/jobs': () => json({ items: [], total: 0, page: 1, pageSize: 20 }),
      '/sources': () => json({ sources: [], automatedCount: 0, manualHandoff: [] }),
    });
    renderAt('/jobs', <JobsPage />);
    expect(await screen.findByText('No jobs yet')).toBeDefined();
  });
});

describe('job detail', () => {
  it('explains the score, separates gaps from unknowns, and never offers to apply', async () => {
    stubFetch({ '/jobs/44444444-4444-4444-4444-444444444444': () => json(JOB_DETAIL) });
    renderAt('/jobs/:jobId', <JobDetailPage />, `/jobs/${JOB_DETAIL.job.id}`);

    expect(await screen.findByText('Why this scored what it scored')).toBeDefined();
    expect(screen.getByText('Matched 4 of 5 required skills.')).toBeDefined();
    // An unknown dimension is labelled as unknown, not as a zero score.
    expect(screen.getByText('Unknown')).toBeDefined();
    expect(screen.getByText('Gaps we found')).toBeDefined();
    expect(screen.getByText('We could not determine')).toBeDefined();

    // The product prepares applications but never submits them.
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start application' })).toBeDefined();
    expect(screen.getByText(/never submits an application/)).toBeDefined();
  });

  it('does not headline a score for an unscoreable match', async () => {
    const unscoreable = {
      ...JOB_DETAIL,
      match: { ...JOB_DETAIL.match, score: 33, band: 'weak' as const, scoreable: false },
    };
    stubFetch({ '/jobs/44444444-4444-4444-4444-444444444444': () => json(unscoreable) });
    renderAt('/jobs/:jobId', <JobDetailPage />, `/jobs/${JOB_DETAIL.job.id}`);

    expect(await screen.findByText('Not enough information')).toBeDefined();
    expect(screen.getByText(/Add verified facts to your profile/)).toBeDefined();
  });

  it('records feedback with an allowed relevance value', async () => {
    const user = userEvent.setup();
    const seen: Array<{ method: string; body: unknown }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/feedback')) {
          seen.push({ method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) });
          return new Response(null, { status: 204 });
        }
        return json(JOB_DETAIL);
      }),
    );

    renderAt('/jobs/:jobId', <JobDetailPage />, `/jobs/${JOB_DETAIL.job.id}`);
    await screen.findByText('Why this scored what it scored');

    await user.click(screen.getByRole('button', { name: 'Give feedback' }));
    await user.click(screen.getByRole('button', { name: 'Not relevant' }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.body).toEqual({ relevance: 'not_relevant' });
  });
});

describe('document studio', () => {
  it('blocks approval until warnings are acknowledged', async () => {
    const user = userEvent.setup();
    let approveBody: unknown;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/approve')) {
          approveBody = JSON.parse(String(init?.body));
          return json({ id: 'doc-1', status: 'approved' });
        }
        return json({
          document: {
            id: DOCUMENT_ID,
            jobId: JOB_DETAIL.job.id,
            kind: 'resume',
            version: 1,
            status: 'needs_review',
            content: {
              kind: 'resume',
              headline: 'Backend Engineer',
              summary: 'Payments and platform work.',
              sections: [
                { heading: 'Experience', bullets: ['Led a team of 9 engineers'], evidenceIds: [] },
              ],
              warnings: ['Claim not in your verified facts: "led a team of 9"'],
              wordCount: 12,
            },
            warnings: ['Claim not in your verified facts: "led a team of 9"'],
            words: 12,
            providerId: null,
            model: null,
            createdAt: new Date().toISOString(),
            approvedAt: null,
          },
          job: { title: 'Backend Engineer', company: 'Initech', url: 'https://example.com' },
          plainText: 'Backend Engineer',
          atsIssues: [],
        });
      }),
    );

    renderAt('/documents/:documentId', <StudioPage />, `/documents/${DOCUMENT_ID}`);

    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: /reviewed these warnings/i }));
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
    await user.click(approve);

    await waitFor(() => expect(approveBody).toEqual({ acknowledgeWarnings: true }));
  });

  it('disables export until the document is approved', async () => {
    stubFetch({
      [`/documents/${DOCUMENT_ID}`]: () =>
        json({
          document: {
            id: DOCUMENT_ID,
            jobId: JOB_DETAIL.job.id,
            kind: 'resume',
            version: 1,
            status: 'draft',
            content: {
              kind: 'resume',
              headline: 'Backend Engineer',
              summary: '',
              sections: [],
              warnings: [],
              wordCount: 2,
            },
            warnings: [],
            words: 2,
            providerId: null,
            model: null,
            createdAt: new Date().toISOString(),
            approvedAt: null,
          },
          job: null,
          plainText: '',
          atsIssues: [],
        }),
    });

    renderAt('/documents/:documentId', <StudioPage />, `/documents/${DOCUMENT_ID}`);
    expect(await screen.findByText('Every claim checks out')).toBeDefined();
    for (const format of ['PDF', 'DOCX', 'TXT']) {
      const button = screen.getByRole('button', { name: `Download ${format}` });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('application tracker', () => {
  it('reads counts and the status filter from the server payload', async () => {
    stubFetch({
      '/applications': () =>
        json({
          items: [
            {
              id: '66666666-6666-6666-6666-666666666666',
              status: 'applied',
              statusLabel: 'Applied',
              notes: null,
              nextActionAt: null,
              appliedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              resumeDocumentId: null,
              coverLetterDocumentId: null,
              job: {
                id: '44444444-4444-4444-4444-444444444444',
                title: 'Backend Engineer',
                company: 'Initech',
                url: 'https://example.com/jobs/1',
                source: 'remotive',
                locationRaw: 'Remote',
              },
              lastEvent: {
                type: 'status_change',
                message: 'Status changed to Applied',
                createdAt: new Date().toISOString(),
              },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 100,
          counts: { applied: 1 },
          statuses: [{ value: 'applied', label: 'Applied' }],
        }),
    });

    renderAt('/applications', <ApplicationsPage />);

    expect(await screen.findByText('Backend Engineer')).toBeDefined();
    expect(screen.getByText('Status changed to Applied')).toBeDefined();
    // The filter chip is driven by `counts`, not by client-side grouping.
    expect(screen.getByRole('button', { name: 'Applied (1)' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'All (1)' })).toBeDefined();
    // The screen states plainly that the user submits, not the system.
    expect(screen.getByText(/never submit anything/i)).toBeDefined();
  });

  it('offers only transitions the server allows', async () => {
    stubFetch({
      '/applications': () =>
        json({
          items: [
            {
              id: '66666666-6666-6666-6666-666666666666',
              status: 'offer',
              statusLabel: 'Offer',
              notes: null,
              nextActionAt: null,
              appliedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              resumeDocumentId: null,
              coverLetterDocumentId: null,
              job: {
                id: 'j',
                title: 'Backend Engineer',
                company: 'Initech',
                url: 'u',
                source: 'remotive',
                locationRaw: null,
              },
              lastEvent: null,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 100,
          counts: { offer: 1 },
          statuses: [],
        }),
    });

    renderAt('/applications', <ApplicationsPage />);
    const select = await screen.findByLabelText('Change status for Backend Engineer');
    const values = within(select as HTMLElement)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);

    // offer -> closed | withdrawn, plus the placeholder. Never back to "saved".
    expect(values).toEqual(['', 'closed', 'withdrawn']);
  });
});
