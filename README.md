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
`node:sqlite`), applies the schema and seeds a demo account:

| Email | Password |
| --- | --- |
| `demo@jobhunter.app` | `hunter1234` |

The demo account ships with a verified early-career profile, three reviewed job
sources, a daily 07:00 search schedule and a base resume.

```bash
npm test          # 45 unit + integration tests
npm run db:reset  # delete the database; it is reseeded on the next request
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
| Resume workspace | `/resumes/[id]` | Tailored draft, change log, evidence check, PDF/DOCX export |
| Approval centre | `/approvals` | Package review, hash integrity, consent gate |
| Tracker | `/applications` | Statuses, notes, next actions, manual outcomes |
| Settings | `/settings` | Sources, schedule, privacy, export, deletion, audit trail |

### The full loop

1. **Configure** a market (countries, remote regions, titles, seniority, salary floor, exclusions).
2. **Search** — three public sources are queried, normalized, de-duplicated and freshness-checked.
3. **Score** — a transparent weighted model produces a score, confidence, reasons and gaps.
4. **Tailor** — the generator selects and reorders verified facts for one vacancy and logs every change.
5. **Validate** — each claim is traced to evidence; unsupported skills, numbers or employers are blocked.
6. **Approve** — you approve the resume, then the exact package (hash-bound).
7. **Hand off** — you are taken to the employer's official page; we never claim a submission we cannot confirm.
8. **Track** — status, confirmation reference, notes and an append-only audit trail.

---

## Architecture

```
app/                     Next.js 15 App Router (server components + route handlers)
  api/…                  REST endpoints (auth, profile, evidence, search, resumes, packages)
  dashboard|jobs|…       Screens
components/              UI (server components + a few client islands)
lib/
  db/                    node:sqlite connection, schema, seed
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
- **Scheduling:** the scheduler is represented by `runSearch(..., 'scheduled')` with
  an idempotent per-user/per-day run key. Call it from a cron job
  (`POST /api/search-runs {"trigger":"scheduled"}`). Keep scheduled runs out of
  short-lived serverless functions.
- Secrets belong in `.env` (never committed). `.env.example` documents every key.

---

## API surface

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/signup` · `/login` · `/demo` · `/logout` | Sessions |
| GET/PUT | `/api/profile` | Candidate profile |
| GET/PUT | `/api/preferences` | Market and schedule |
| GET/POST | `/api/resumes` | Base resume upload (TXT/MD/PDF/DOCX) + parsing |
| GET/POST | `/api/evidence` · PATCH/DELETE `/api/evidence/[id]` | Verified facts |
| GET/POST | `/api/search-runs` | Search history / manual trigger |
| GET | `/api/jobs` · `/api/jobs/[id]` | Ranked feed and match evidence |
| POST | `/api/jobs/[id]/tailor-resume` | Generate a grounded draft |
| POST | `/api/jobs/[id]/feedback` | Relevance feedback |
| GET/PATCH | `/api/tailored-resumes/[id]` | Draft, edits, resume approval |
| GET | `/api/tailored-resumes/[id]/export?format=pdf\|docx\|txt` | Export |
| GET/POST | `/api/application-packages` | Assemble packages |
| POST | `/api/application-packages/[id]/approve` · `/revoke` · `/handoff` | Consent gate |
| GET | `/api/applications` · PATCH `/api/applications/[id]` | Tracker |
| POST | `/api/applications/[id]/submit` | Record a confirmed submission |
| GET/POST | `/api/notifications` | Digest list / mark read |
| GET | `/api/export` · POST `/api/account/delete` | Portability and erasure |
| GET | `/api/sources` | Source catalogue with terms review |

All endpoints resolve the caller from the session cookie and return 401 otherwise.

---

## Tests

```
tests/text.test.ts       URL canonicalisation, fingerprints, title similarity
tests/scoring.test.ts    hard filters, missing-skill gaps, confidence, red flags
tests/grounding.test.ts  fabrication, metrics, employers, learning skills, prompt injection
tests/approval.test.ts   hash binding, revocation, stale approvals, idempotent submission
tests/parse.test.ts      resume parsing (sections, dates, skills, warnings)
tests/search.test.ts     ingestion, dedupe, scoring, idempotent scheduled runs
```

`npm test` → 45 passing.

## Known limits (intentional for this MVP)

- Manual handoff is the only application route; there is no automated submission, by design.
- Scheduling is exposed as an idempotent API call rather than an in-process cron.
- Email delivery is represented by `notifyEmail`; in-app notifications are implemented.
- No multi-language UI yet; English only.
- SQLite is single-node. The schema is portable to Postgres when you need horizontal scale.
