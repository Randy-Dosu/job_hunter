# Job Hunter

A user-controlled job-search assistant. It searches your chosen markets on a daily
schedule, explains why each vacancy matches, drafts a resume from **verified facts
only**, and waits for your explicit approval before anything leaves the app.

Built from the product requirements document in [`docs/PRD.md`](docs/PRD.md).

> **The two non-negotiable rules**
> 1. Nothing is ever invented — employers, dates, metrics, skills and certifications
>    must already exist as verified profile facts.
> 2. Nothing is submitted without an explicit, vacancy-specific, package-hash-bound
>    approval from you.

---

## Run it

```bash
npm install
cp .env.example .env      # optional: everything works with the defaults
npm run dev               # http://localhost:3000
```

The first request creates `data/job-hunter.db` (SQLite via Node's built-in
`node:sqlite`) and applies the schema. **Nothing is seeded**: no accounts, no sample
profile, no listings, no fixtures on screen. Create the first account at `/login` and
the setup wizard takes you through market, resume facts and schedule.

To give an account administrator rights over source governance, list it in
`ADMIN_EMAILS` (comma separated) before it registers — or restart after adding it and
the existing account is promoted on open:

```bash
ADMIN_EMAILS=you@example.com npm run dev
```

```bash
npm test          # 130 tests
npm run db:reset  # delete the database; a clean schema is recreated on the next request
npm run build     # production build
```

---

## What you can do in the app

| Screen | Route | What it proves |
| --- | --- | --- |
| Welcome | `/` | Plain-language boundaries: what the agent will and will not do |
| Onboarding | `/onboarding` | Market, roles, seniority, exclusions, resume import, schedule |
| Dashboard | `/dashboard` | Daily run counts, strong matches, deadlines, approval gate status |
| Job feed | `/jobs` | Strong / possible / low / excluded buckets with reasons |
| Job detail | `/jobs/[id]` | 100-point score broken down, evidence, gaps, red-flag warnings |
| Resume & facts | `/resume` | Every fact with provenance and a verification state |
| Resume workspace | `/resumes/[id]` | Tailored draft, change log, evidence check, cover letter + answers, PDF/DOCX export |
| Approval centre | `/approvals` | Package review, hash integrity, consent gate |
| Tracker | `/applications` | Statuses, notes, next actions, manual outcomes |
| Settings | `/settings` | Sources, schedule, privacy, export, deletion, audit trail |

### The full loop

1. **Configure** a market (countries, remote regions, titles, seniority, salary floor, exclusions).
2. **Search** — three public sources are queried, normalized, de-duplicated and freshness-checked.
3. **Score** — a transparent weighted model produces a score, confidence, reasons and gaps.
4. **Tailor** — the generator selects and reorders verified facts for one vacancy and logs every change.
5. **Validate** — each claim is traced to evidence; unsupported skills, numbers or employers are blocked.
6. **Draft the application material** — a cover letter and answers to the questions the listing
   asks (plus standard form prompts), each with its evidence, each commitment marked for you.
7. **Approve** — you confirm every answer that needs it, approve the resume, then the exact
   package (hash-bound).
8. **Hand off** — you are taken to the employer's official page; we never claim a submission we cannot confirm.
9. **Track** — status, confirmation reference, notes and an append-only audit trail.

---

## Architecture

```
app/                     Next.js 15 App Router (server components + route handlers)
  api/…                  REST endpoints (auth, profile, evidence, search, resumes, packages)
  dashboard|jobs|…       Screens
components/              UI (server components + a few client islands)
lib/
  db/                    node:sqlite connection, schema and additive migrations
  sources/               JobSourceAdapter implementations + normalization
  matching/              Requirement extraction + weighted scoring + hard filters
  resume/                Parsing (TXT/MD/PDF/DOCX), generation, grounding, PDF/DOCX render
  search.ts              Search-run pipeline (ingest → dedupe → score → digest)
  approvals.ts           Package hash, approval state machine, manual handoff
  profile.ts, auth.ts    Ownership-scoped data access, sessions, audit
data/fixtures/           Offline source fixtures (fallback + tests)
docs/                    PRD, architecture, source compliance matrix
tests/                   Vitest suites
```

More detail: [`docs/architecture.md`](docs/architecture.md).

**Stack:** Next.js 15 · React 19 · TypeScript · Tailwind CSS v4 · SQLite (`node:sqlite`)
· pdf-lib · docx · zod · Vitest. No native dependencies, no external services required.

---

## How the safety guarantees are enforced

**Evidence-grounded generation.** `lib/resume/generate.ts` only reads facts with
`verification_status = 'verified'`. `lib/resume/grounding.ts` then re-checks the
finished draft independently: every claim needs at least one verified evidence id,
skills must exist in your verified skill set, numeric tokens must appear in your
evidence, and employer mentions must match your history. Failures are surfaced in
the UI and block resume approval.

**Approval binding.** `computePackageHash()` hashes the resume text, cover letter,
answers and destination URL. `application_approvals` stores that hash. Handoff
re-computes the hash and refuses to proceed if it differs, if the approval was
revoked, if the vacancy closed, or if a submission already exists. Editing a resume
revokes related approvals automatically.

**Answer confirmation.** `lib/resume/application-materials.ts` drafts only from verified facts.
Anything that is a commitment — salary, notice period, right to work, sponsorship — is marked
`needs_confirmation` and the approval gate refuses the package until you confirm the exact wording
(`answerProblems()` in `lib/approvals.ts`). A confirmed answer that still contains a bracketed
placeholder is refused too. The confirmed answers are part of the package hash, so editing them
after approval invalidates it.

**Hard filters beat scores.** Excluded employers/keywords/locations, closed
vacancies, on-site roles when you require remote, and "no sponsorship" roles when
you need sponsorship are all excluded regardless of numeric score — with the reason
shown under the **Excluded** tab.

**Trust boundaries.** Job descriptions and uploaded files are treated as untrusted
content; no instructions inside them are executed (there is a prompt-injection test).
API keys stay server-side. Every query is scoped by `user_id`, and ownership is
re-checked immediately before any approval or handoff action.

---

## Job sources

| Source | Access | Terms reviewed | Markets |
| --- | --- | --- | --- |
| Remotive | Public JSON API, no key | 2026-11-12 | Global remote |
| Arbeitnow | Public job-board API, no key | 2026-11-12 | Europe, global remote |
| Remote OK | Public JSON feed with attribution | 2026-11-12 | Global remote |

Each adapter has an 8-second timeout, a documented rate limit, and falls back to
saved fixtures when a source is unreachable — clearly labelled in the dashboard so
you never mistake fixture data for a live result. See
[`docs/source-compliance-matrix.md`](docs/source-compliance-matrix.md).

We do not bypass logins, ticketing, CAPTCHAs, rate limits or anti-bot controls, and
we do not add a source unless its terms permit automated access.

---

## Optional LLM

The product is complete without any model provider: extraction, scoring, filtering,
assembly and validation are deterministic. If you set `LLM_PROVIDER` +
`LLM_API_KEY` + `LLM_MODEL`, the provider may **reword the summary only**, using the
supplied verified facts. Its output is validated exactly like generated text; if it
adds anything unsupported, the deterministic summary is kept instead.

---

## Deployment notes

- **Best fit:** a Node host with a persistent disk (Fly, Railway, Render, a VPS).
  SQLite lives at `DATABASE_PATH` and the app is a single Node process.
- **Vercel:** serverless functions have an ephemeral, read-only filesystem, so the
  current SQLite adapter is not suitable as-is. Either point `lib/db` at a managed
  Postgres instance (the schema in `lib/db/schema.ts` maps 1:1) or run the API on a
  host with a volume and keep Vercel for the UI.
- **Scheduling:** point any cron at `POST /api/cron/search` every 5–15 minutes with
  `authorization: Bearer $CRON_SECRET`. One tick runs every due user (their own
  timezone, days and search time decide), re-checks vacancy liveness and sends due
  alerts. `runSearch` keeps it to one scheduled run per local day, so firing often is
  safe. Without `CRON_SECRET` in production the endpoint returns 503 instead of
  running unauthenticated.
- Secrets belong in `.env` (never committed). `.env.example` documents every key.

---

## API surface

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/signup` · `/login` · `/logout` | Sessions |
| GET/PUT | `/api/profile` | Candidate profile |
| GET/PUT | `/api/preferences` | Market and schedule |
| GET/POST | `/api/resumes` | Base resume upload (TXT/MD/PDF/DOCX) + parsing |
| GET/POST | `/api/evidence` · PATCH/DELETE `/api/evidence/[id]` | Verified facts |
| GET/POST | `/api/search-runs` · GET `/api/search-runs/[id]` | Search history / manual trigger / one run |
| GET | `/api/jobs` · `/api/jobs/[id]` | Ranked feed and match evidence |
| POST | `/api/jobs/[id]/tailor-resume` | Generate a grounded draft |
| POST | `/api/jobs/[id]/application-materials` | Draft a cover letter + answers (nothing stored) |
| POST | `/api/jobs/[id]/feedback` | Relevance feedback |
| GET/PATCH | `/api/tailored-resumes/[id]` | Draft, edits, resume approval |
| GET | `/api/tailored-resumes/[id]/export?format=pdf\|docx\|txt` | Export |
| GET/POST | `/api/application-packages` | Assemble packages |
| POST | `/api/application-packages/[id]/approve` · `/revoke` · `/handoff` | Consent gate |
| GET | `/api/applications` · PATCH `/api/applications/[id]` | Tracker |
| POST | `/api/applications/[id]/submit` | Record a confirmed submission |
| GET/POST | `/api/notifications` | Digest list / mark read |
| GET | `/api/export` · POST `/api/account/delete` | Portability and erasure |
| GET | `/api/audit-events` | The caller's own activity trail |
| GET | `/api/sources` | Source catalogue with terms review |
| POST | `/api/jobs/import` | Add a job by URL (one polite fetch, SSRF guard, daily cap) |
| GET/POST | `/api/resume-variants` · DELETE `/api/resume-variants/[id]` | Role-family variants |
| POST | `/api/application-packages/[id]/save` · `/reject` | Save for later / reject |
| POST/GET | `/api/cron/search` | Scheduled runs, liveness sweep and alerts (cron) |
| GET/PATCH | `/api/admin/sources` | Source governance (administrator only) |

All endpoints resolve the caller from the session cookie and return 401 otherwise.

---

## Tests

```
tests/text.test.ts         URL canonicalisation, fingerprints, title similarity
tests/scoring.test.ts      hard filters, missing-skill gaps, confidence, red flags
tests/grounding.test.ts    fabrication, metrics, employers, learning skills, prompt injection
tests/approval.test.ts     hash binding, revocation, stale approvals, save/reject, idempotent submission
tests/parse.test.ts        resume parsing (sections, dates, skills, warnings)
tests/search.test.ts       ingestion, dedupe, scoring, idempotent scheduled runs
tests/schedule.test.ts     timezone windows, days, pause, next-run calculation
tests/notifications.test.ts delivery, suppression, dedupe, deadline/reminder alerts, liveness
tests/auth.test.ts         route-level 401/403 and cross-user isolation
tests/ratelimit.test.ts    sliding window and auth endpoint throttling
tests/manual-import.test.ts JobPosting parsing, SSRF guard, dedupe, daily cap
tests/variants.test.ts     variant CRUD, resolution by role family, grounded re-ordering
tests/migration.test.ts    legacy database upgrades in place, idempotently
tests/fresh-start.test.ts  no seeded accounts, jobs or sample profile; ADMIN_EMAILS only
tests/application-materials.test.ts  question detection, grounded answers, confirmation gate, hash binding
tests/adapters.test.ts     bounded retry/backoff on transient source failures, no retry on 4xx
```

Source budgets configured in the admin console are enforced: every fetch is logged and a
source that has spent its hourly or daily allowance is skipped for that run with the
reason recorded on the search run.

`npm test` → 130 passing.

## Cover letter and application answers

`POST /api/jobs/[id]/application-materials` drafts the material for one vacancy without storing
anything. Questions come from the listing itself (sentences it asks as questions) plus standard
form prompts — why this role, relevant experience, skills, right to work, sponsorship, salary,
start date — and are de-duplicated by intent. Answers are built from verified facts and carry their
evidence ids; a question naming a skill you have not verified is answered with an explicit
placeholder rather than a claim. In the resume workspace you edit both, tick the items marked
**needs your confirmation**, and only then assemble the package. The server re-checks the same rule
in `approvePackage()`, so a client cannot skip it, and the confirmation state is part of the hash
that binds the approval.

## Matching feedback

“Was this relevant?” on a job stores your verdict and immediately re-scores that vacancy:
`relevant` nudges the score up by 4 (bounded, only when no requirement is missing), `not relevant`
and `dismissed` drop it by 9 and cap the verdict below strong. Hard filters are never overridden,
and the evidence components themselves never change — the adjustment is shown as its own reason.

## Notifications, reminders and alerts

Every notification is written in-app and, when a provider is configured and the user
opted in, emailed through Resend (`RESEND_API_KEY`, `NOTIFY_FROM`). The stored row
records `channel`, `delivery_status` (`stored` / `sent` / `suppressed` / `failed`) and
the error, so "sent" is never claimed without a provider accepting it. Types: daily
digest, closing-deadline alerts (72h window), listing-change alerts, follow-up
reminders, and vacancy-closed/unverified warnings. All are deduplicated by key.

## Administration

Users carry a `role`; administrators get `/admin/sources` to enable or disable an
adapter, set its hourly/daily request budget (enforced per fetch), record the terms review and inspect
ingestion/parsing faults, negative match feedback and low-confidence matches. Every
change is audited. Administrators are granted by `ADMIN_EMAILS`, not by a seeded account.

## Manual job links

`POST /api/jobs/import {"url": "..."}` reads a single public page: schema.org
`JobPosting` JSON-LD first, Open Graph/title metadata as a fallback with explicit
warnings. One fetch, no retries, no login or CAPTCHA handling, 20 imports per user per
day, and an SSRF guard that refuses localhost/private ranges, non-HTTP schemes and
credentials in the URL.

## Resume variants

A variant is a named emphasis for a role family (for example "Frontend" with
accessibility/design-system keywords). When a vacancy title matches the variant's role
family it is applied automatically; only already-verified evidence is re-ordered or
re-weighted, and the change log records that a variant was used.

## PRD coverage

Every functional requirement in [`docs/PRD.md`](docs/PRD.md) §5 is implemented except one optional
capability, which is called out in the limits below.

| FR | Requirement | Where |
| --- | --- | --- |
| 001 | Account creation and secure sign-in | `app/api/auth/*`, `lib/auth.ts` |
| 002 | Market, remote/authorisation, titles, seniority, salary, exclusions, sources | `components/onboarding-wizard.tsx`, `lib/preferences.ts` |
| 003 | Search time, timezone, days, notification channel | `lib/schedule.ts`, `components/settings-form.tsx` |
| 004 | Pause, resume, run now | `schedule_enabled`, `POST /api/search-runs` |
| 005 | Facts with verified / unverified / outdated states | `app/resume/page.tsx`, `app/api/evidence/*` |
| 006 | Resume upload with review before saving | `lib/resume/parse.ts`, `app/api/resumes/route.ts` |
| 010 | Scheduled search runs | `app/api/cron/search/route.ts` |
| 011 | Only enabled sources; source, query, time, status recorded | `lib/search.ts`, `search_runs`, `source_fetch_log` |
| 012 | Normalised schema; missing fields stay unknown | `lib/sources/normalize.ts` |
| 013 | Dedupe by source id, canonical URL, fingerprint | `lib/search.ts`, `lib/text.ts` |
| 014 | Liveness check with an explicit uncertain state | `recheckJobLiveness`, `status` |
| 015 | Source attribution and retrieval timestamps | `jobs.source_id`, `first_seen_at`, `last_seen_at` |
| 016 | Vacancy-change detection and alerts | `lib/notify.ts`, `job_changed` notifications |
| 017 | Add a job by URL, bounded | `POST /api/jobs/import`, `lib/sources/manual.ts` |
| 020 | Score with a human-readable explanation | `lib/matching/score.ts`, job detail |
| 021 | All scoring dimensions | same, `components/job-card.tsx` |
| 022 | Hard constraints disqualify regardless of score | `hardFilters` |
| 023 | Strong / possible / low / excluded views | `app/jobs/page.tsx` |
| 024 | Missing vs required qualifications, required vs preferred | `match.gaps`, job detail |
| 025 | Feedback tunes ranking | `applyFeedback()`, `app/api/jobs/[id]/feedback` |
| 030 | Job-specific resume from approved base + verified facts | `lib/resume/generate.ts` |
| 031 | Reorder, summarise, emphasise truthfully | same, change log |
| 032 | Never invent skills, titles, employers, dates, degrees, numbers | `lib/resume/grounding.ts` |
| 033 | Every claim traceable to evidence | `Claim.evidenceIds` |
| 034 | Change summary (added / removed / rewritten) | resume workspace |
| 035 | Edit the draft, approve it | `PATCH /api/tailored-resumes/[id]` |
| 036 | ATS-readable PDF (and DOCX) | `lib/resume/render.ts` |
| 037 | Cover letter and application answers with confirmation markers | `lib/resume/application-materials.ts`, `app/api/jobs/[id]/application-materials` |
| 038 | Multiple resume variants per role family | `lib/resume/variants.ts` |
| 040 | No submission without a job- and package-specific approval | `approvePackage()`, `handoffPackage()` |
| 041 | Approval screen shows every material and the destination | `app/approvals/[id]/page.tsx` |
| 042 | Approval bound to vacancy + package version | `computePackageHash()` |
| 043 | Approve & hand off, open the page, save, reject | `components/approval-actions.tsx` |
| 044 | Approval time, version, destination, attempt, result recorded | `application_approvals`, `applications`, audit |
| 045 | CAPTCHA / unsupported auth stops and hands over | manual handoff only; no bypass anywhere |
| 046 | Never claims a submission without confirmation | `markSubmitted()` requires a reference |
| 047 | Browser-assisted form filling | **not built** — see limits |
| 050 | Daily digest | `lib/notify.ts`, `app/api/notifications` |
| 051 | Immediate alerts for high-fit / closing jobs | `lib/notify.ts`, cron tick |
| 052 | Saved → submitted → interview … statuses | `app/applications/page.tsx` |
| 053 | Record outcomes manually | `PATCH /api/applications/[id]` |
| 054 | Configurable follow-up reminders | `applications.next_action_at`, reminders |
| 060 | Admins enable sources, set limits, inspect failures | `app/admin/sources/page.tsx` |
| 061 | Access method, terms review, limits, markets per source | `lib/db/catalogue.ts`, compliance matrix |
| 062 | Respect robots, terms, quotas; no bypass | `docs/source-compliance-matrix.md`, budgets |
| 063 | Review match quality, parse errors, bad results | admin console quality panel |

## Known limits (intentional for this MVP)

- Manual handoff is the only application route; there is no automated submission, by design.
- **No browser form-filling (FR-047).** The PRD lists it as an optional P1 capability. Automating a
  browser means storing an employer session, defeating per-site access controls and keeping a
  headless browser next to the database — none of which this deployment can do safely, and the
  same outcome is reached by copying the confirmed answers into the employer's form yourself.
  The handoff screen links to the official page and the package stays open until you confirm.
- Email requires a provider; without one the row is stored and marked suppressed.
- The rate limiter is per process. Multi-instance deployments should enforce the same
  limits at the edge or move the store to Redis.
- No multi-language UI yet; English only.
- SQLite is single-node and cannot persist on Vercel's serverless filesystem. The schema
  maps 1:1 to Postgres when you need a managed host.
