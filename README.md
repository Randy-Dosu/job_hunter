# Job Hunter

Finds jobs, explains why each one fits, drafts a truthful CV or cover letter, and
keeps a record of what you actually sent. **You** review and submit every
application — there is no code path that can submit one for you.

```bash
npm install
npm run dev          # starts the database, migrates, then API :4000 + web :5173
npm run seed         # optional: a fictional demo account with data
```

`npm run dev` starts PGlite (a Postgres compiled to WebAssembly — no native build, no
Docker), waits for it to accept connections, applies pending migrations, then runs the
API and the web app together. To keep the three pieces separate:

```bash
npm run db:up        # database only, in the foreground
npm run db:migrate   # apply migrations
npm run dev:api      # API only
npm run dev:web      # web only
```

Sign in with `demo@job-hunter.dev` / `demo-password-please-change` after seeding.

---

## Why this exists

Job boards optimise for volume: hundreds of listings, opaque ranking, and "AI apply"
features that spray applications at employers. That wastes your time and quietly
damages your credibility. Job Hunter takes the opposite position:

1. **Explained, not ranked.** Every score is a weighted sum of six documented
   dimensions, each with a rationale, the evidence behind it, and its gaps.
2. **Unknowns are not failures.** If we cannot determine something, we say
   `unknown` and exclude it from the score rather than marking you down for it.
3. **Nothing is invented.** Generated documents may only restate facts you have
   explicitly verified, and the app refuses to export a document whose claims do
   not trace back to those facts.
4. **We prepare, you send.** The system can pick jobs from your preferences and
   assemble each application for you — but the send button is yours. It exists
   nowhere in the codebase, not as a hidden option.

## How it works

```
daily scan ─► normalise + dedupe ─► score against verified facts ─► explained feed
                                            │
                        verified facts ◄────┴────► document engine ─► your review
                                                                        │
                                                            approval gate + ATS lint
                                                                        │
                                                            you submit, we track
```

A scan pulls from sources with documented public APIs (Remote OK, Remotive, Jobicy,
Arbeitnow, We Work Remotely, Greenhouse, Lever and a few more), normalises them into a
single job model, fingerprints duplicates across sources, and scores each listing
against your **verified** profile facts. The score, its components, the evidence and
the gaps are all persisted, so the explanation you see later is the one that was
computed — not a re-derivation that might drift.

## The truthfulness gate

This is the part that matters most, so it is worth being precise about.

- Facts enter the profile either from a parsed CV or by hand, and both start
  **unverified**. Only verified facts may support a match score or appear in a document.
- When a document is generated, `checkEvidence` re-checks every claim: cited fact ids
  must exist and be verified, numbers must appear in the source text, and named
  employers must appear in your verified history.
- Anything unsupported becomes a warning attached to the exact claim.
- A document with warnings **cannot be exported** until you approve it, and approving
  warnings requires ticking an explicit acknowledgement.
- Generating a document never auto-approves it. Editing a document re-runs the check
  and resets approval, because your edit may have introduced a new claim.

The UI reflects the same rule: the Approve button is disabled until every warning is
acknowledged, and every export button is disabled until the document is approved. Both
behaviours are covered by tests.

## Explanations, concretely

Scores are deterministic functions of (job, verified facts, preferences), stamped with
a `scoringVersion` so old scores stay interpretable.

| Dimension | Weight | What it looks at |
| --- | --- | --- |
| Skills & technologies | 30 | Required and preferred skills matched against verified facts |
| Relevant experience | 25 | Dated roles, seniority and years |
| Role alignment | 15 | Title/seniority/track fit |
| Education & certifications | 10 | Required degrees or credentials |
| Location & work eligibility | 10 | Remote, country, workplace type |
| Preferences & job type | 10 | Employment type, salary floor, exclusions |

Bands: **≥80 strong**, **≥65 good**, **≥45 fair**, below that weak. When a dimension
cannot be scored it is marked `unknown`, renormalised out of the total (so absence of
data never lowers the score), and listed separately in the UI from real gaps.

A match also carries `scoreable`. Dimensions are judged only where the candidate has
verified evidence, so a brand-new profile scores nothing meaningful: rather than show
a number that reads as a verdict, `scoreable: false` makes the UI say *"not enough
information"* and the card summary declines to describe gaps. The invariant is
enforced in the engine (`packages/matching`) and persisted on `JobMatch.scoreable`,
so the API and every client tell the same story from the same stored verdict.

## Automatic application preparation

The expensive part of applying is not clicking *send* — it is reading a posting,
rewriting your CV for it, and writing a letter that does not lie. Job Hunter does
that part for you, automatically:

1. A scan scores new listings against your verified facts.
2. Jobs at or above **your** minimum score are selected — never ones you
   dismissed, never ones with an existing application record, never a score that
   rests on no evidence (`scoreable: false` is excluded even if the number is
   high).
3. For each, it generates the CV and cover letter from verified facts only, then
   attaches them and computes what still needs a human.
4. The package waits in a **review queue**. You accept packages in bulk, which
   runs the evidence check and approves the documents.

What "accept" does *not* do is apply. Accepting means the documents are approved
and the package is ready; sending it is a separate act that only you perform. The
settings screen says so, the API response says so on every call, and the tests
assert that no code path can set `applied`.

Guard rails: off by default; a score floor you choose; a daily cap; documents are
never auto-approved; and a run with no verified facts prepares nothing at all,
because a document with nothing true to say is worse than no document.

## Safety properties

- **No submission capability.** This held before automatic preparation and still
  holds after it. The application status `applied` is only ever set because you
  said you applied. No column records a system submission, and the API surface is
  tested for submit-shaped routes on every run.
- **Browser assistance is optional and allowlisted.** It fills fields for your review,
  refuses to touch sensitive answers it has no stored value for, and is off unless a
  host is explicitly allowlisted and configured.
- **SSRF defence.** Any URL the assistant or connectors fetch is checked for scheme,
  private/loopback/link-local/CGNAT addresses and IPv4-mapped IPv6, and re-checked
  after DNS resolution.
- **Prompt injection is assumed.** Job descriptions are untrusted input: wrapped in
  delimiters, declared data-not-instructions in every prompt, and never trusted to
  produce a claim that survives the evidence check.
- **Sessions** are opaque tokens in an HttpOnly, SameSite=Lax cookie, stored hashed.
  No token is ever readable by JavaScript.
- **Source compliance.** Only documented public APIs are fetched automatically;
  everything else is a manual hand-off link. Each source carries its compliance note
  into the UI so you can see why it is or is not automated.

## Repository layout

A modular monolith: one deployable API, with the domain logic in packages that have no
knowledge of HTTP.

```
apps/
  api/            Fastify API: routes → services → Prisma; 20-table schema
  web/            React 19 + Vite + Tailwind SPA (9 screens, code-split)
packages/
  shared-types/   Domain types, enums, DTO contracts
  config/         Zod-validated environment, limits, retention, consent versions
  validation/     Request schemas (one per endpoint family)
  matching/       Deterministic scoring, eligibility, explanations, text utils
  document-engine/Evidence checking, PDF/DOCX/TXT/JSON export, ATS linting
  job-connectors/ Source register, connectors, normalisation, dedupe fingerprints
  resume-parser/  PDF/DOCX extraction into candidate facts
  ai-gateway/     Provider abstraction with ordered fallback and a mock provider
  browser-agent/  Field mapping, answer bank, session state machine
  worker/         Scheduler, queue with backoff, scan engine, handlers
  test-utils/     Fixtures and assertion helpers
scripts/          dev-db, migrate, seed
docs/             repository-audit.md (reference-project audit)
```

Dependency rule: packages never import from `apps/`, and `apps/web` never imports
server code. The browser bundle is built from `apps/web` alone.

## API surface

`/api/v1`, cookie-authenticated, one error envelope
(`{ error: { code, message, details?, requestId } }`).

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/signup`, `/auth/signin`, `/auth/signout`, `GET /auth/me`, `POST /auth/consents` |
| Profile | `GET/PUT /profile`, `GET/POST /profile/facts`, `PATCH/DELETE /profile/facts/:id`, `POST /profile/facts/verify`, `GET/PUT /profile/answers` |
| Resumes | `GET/POST /resumes`, `POST /resumes/:id/parse`, `DELETE /resumes/:id` |
| Preferences | `GET/PUT /preferences`, `PUT /preferences/schedule`, `GET /sources`, `GET /sources/manual-links` |
| Discovery | `POST /scans`, `GET /scans`, `GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/match`, `PUT /jobs/:id/state`, `POST /jobs/:id/feedback` |
| Documents | `POST /jobs/:id/documents`, `GET /documents`, `GET/PATCH /documents/:id`, `POST /documents/:id/approve`, `GET /documents/:id/export?format=pdf\|docx\|txt\|json` |
| Applications | `GET/POST /applications`, `GET/PATCH/DELETE /applications/:id`, `POST /applications/:id/notes` |
| Browser | `GET /browser/capabilities`, `POST /browser/sessions`, `GET /browser/sessions/:id`, `POST /browser/sessions/:id/fields`, `/pause`, `/cancel` |
| Privacy | `GET /privacy/summary`, `GET /privacy/export`, `POST /privacy/delete`, `POST /privacy/password`, `GET /privacy/audit` |
| Dashboard | `GET /dashboard` |

Errors: `validation_failed` (422, with per-field `details`), `unauthorized` (401),
`forbidden` (403), `not_found` (404 — also used for other users' resources, so
existence is not leaked), `conflict` (409), `rate_limited` (429), `internal_error`.

## Development

```bash
npm run dev            # API + web, watches both
npm run dev:worker     # the scheduler/queue worker
npm run verify         # prettier + eslint + types + tests + build (what CI runs)
```

`npm run dev` starts PGlite and pins the connection pool to one, because PGlite serves
a single connection at a time. Against a real Postgres, leave `DATABASE_POOL_SIZE`
at its default.

### Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | no | `postgresql://postgres:postgres@127.0.0.1:5432/postgres` | Any Postgres |
| `JWT_SECRET` | production | dev placeholder | ≥32 chars; used to derive the token pepper |
| `DATABASE_POOL_SIZE` | no | `10` | Set to `1` for PGlite |
| `AI_MOCK` | no | `false` | Forces the deterministic mock provider |
| `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `HUGGINGFACE_API_KEY` | no | — | First configured provider wins, with ordered fallback |
| `STORAGE_DRIVER` | no | `local` | `local` or `supabase` |
| `FEATURE_BROWSER_ASSISTANT` | no | `false` | Off unless deliberately enabled |

There is no `.env` autoload: the environment is read once, validated with Zod, and the
process refuses to start if it is invalid.

### Database

Migrations are plain SQL applied by `scripts/migrate.ts` inside a transaction each and
recorded in `_job_hunter_migrations`. `npm run db:migrate -- --reset` rebuilds from
scratch in development only. Prisma is used as the query layer; `prisma migrate` is not
part of the workflow.

## Testing

```
npm test                      # everything
npx vitest run --project unit # packages
npx vitest run --project api  # HTTP, against a real PGlite instance
npx vitest run --project web  # jsdom + Testing Library
```

244 tests: 156 unit, 75 API, 13 web. The API suite is not mocked at the HTTP layer —
requests go through routing, auth, validation, services and Prisma against a real
Postgres (PGlite, migrations applied, database thrown away afterwards), so the tests
exercise the same code paths as production.

`apps/api/test/regressions.test.ts` is worth knowing about: it pins five defects found by
exercising the running API by hand — empty JSON bodies rejected before handlers ran,
preview origins trusted in production, malformed ids reported as 404 instead of 422,
`saved=true` resurrecting dismissed jobs, an empty profile scoring 48/"fair", a disabled
feature answering with a validation error, and personal responses arriving without
`cache-control`. Each one was silent, so each one gets a test that fails if the
behaviour returns.

The web tests are contract tests rather than snapshots: they pin that the screens read
the real API shapes and that the safety rules survive in the UI — approval blocked by
warnings, export blocked before approval, only server-allowed status transitions
offered, and no "submit" action anywhere.

What is *not* covered: real browser automation against live sites (no browsers in CI),
live third-party job APIs (no credentials), and email delivery. Those are listed as
release gaps rather than pretended to be tested.

## Design decisions worth knowing

- **Deterministic scoring, optional semantics.** The LLM may add a bounded semantic
  signal, clearly labelled, but it can never override the deterministic score or
  introduce arbitrary claims into the explanation.
- **Approval is a state transition, not a button.** Approval records who approved and
  when; superseding an older approved version is automatic; editing reverts it.
- **Retention is published, not implied.** Audit events 365 days, browser sessions 30,
  notifications 90, account deletion with a 7-day grace period. The privacy screen
  shows these numbers from the same constants the backend enforces.
- **Two ports, one origin in the browser.** The SPA talks only to `/api` on its own
  origin; Vite proxies in development. No CORS surface is exposed to the browser.

## Documentation

- [`docs/repository-audit.md`](docs/repository-audit.md) — audit of the two reference
  projects, with verified capabilities, unverified claims, licence decisions and a
  reuse/adapt/replace/exclude verdict per feature.
- `.github/workflows/ci.yml` — format, lint, types, tests, build, a from-scratch
  migration run, and dependency/secret hygiene.

## Licence

MIT.
