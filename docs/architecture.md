# Architecture

## Shape

A single Next.js 15 deployment (App Router) with a SQLite database accessed through
Node's built-in `node:sqlite`. No microservices, no Redis, no external queue: search
runs are explicit and idempotent, which is enough for a focused MVP and keeps the
operational surface small.

```
Browser
  │  server components (data reads, ownership-scoped)      client islands (actions)
  ▼
Next.js route handlers  ──────────────►  domain modules (pure-ish)
  │  session cookie → user               matching/requirements.ts, matching/score.ts
  │  zod validation                      resume/generate.ts, resume/grounding.ts
  ▼                                      resume/parse.ts, resume/render.ts
SQLite (data/job-hunter.db)              sources/adapters.ts, sources/normalize.ts
  users, profiles, evidence,             approvals.ts (hash + state machine)
  preferences, sources, runs,            search.ts (ingest → dedupe → score → digest)
  jobs, matches, resumes,
  packages, approvals, applications,
  notifications, audit_events
```

## Why these choices

| Decision | Reason |
| --- | --- |
| SQLite via `node:sqlite` | Zero install friction, no native build, real SQL and transactions, one file to reset. Schema maps 1:1 to Postgres. |
| Server components for reads | A user can never fetch another user's row: every query takes `user_id` from the resolved session. |
| Deterministic scoring | PRD §7.3 — code decides; the LLM may only reword. Scores are reproducible and unit-tested. |
| Deterministic resume assembly | Guarantees the "no invented claims" invariant even with no provider configured. |
| Manual handoff only | The only universally safe submission route in the MVP; approval logic is still fully modelled. |
| Fixtures for sources | Previews and tests stay deterministic when a board is unreachable; UI labels the fallback explicitly. |

## Data flow: one daily run

1. An external cron calls `POST /api/cron/search` (bearer `CRON_SECRET`). The tick runs
   every user whose local schedule window is open, re-checks vacancy liveness and sends
   due alerts. `POST /api/search-runs` remains the manual, user-initiated path.
2. Run key `${userId}:scheduled:${YYYY-MM-DD}` is inserted; a unique index makes a
   duplicate scheduled run a no-op (idempotency).
3. Enabled adapters run in parallel (`Promise.all`), each with an 8s timeout.
4. Every raw record is normalized (`lib/sources/normalize.ts`): HTML → text, remote
   policy, seniority, employment type, salary, posted date, deadline detection.
5. Dedupe order: `(source_id, external_id)` → canonical URL → employer/title/location
   fingerprint within 30 days → insert.
6. `rescanMatches()` re-scores every job for this user (bounded, deterministic).
7. Counts, per-source status and errors are stored on the run; a digest notification
   is written; an audit event records the run.

## Score model (`lib/matching/score.ts`)

| Dimension | Weight |
| --- | --- |
| Role / title relevance | 20 |
| Required skills | 25 |
| Seniority & experience | 15 |
| Location / remote eligibility | 15 |
| Education & certifications | 10 |
| Salary & employment preferences | 5 |
| Industry & company fit | 5 |
| Posting freshness & deadline | 5 |

Each dimension returns a 0–1 score, a confidence and a human-readable note. The
weighted total is rounded to 100; confidence is the weighted mean of each
dimension's confidence, so unknown fields lower confidence instead of counting as a
match. Verdicts: `excluded` (any hard filter), `strong` (≥75 and ≥60% of required
skills evidenced), `possible` (≥55), `low`.

Hard filters: closed vacancy, excluded employer/keyword/location, on-site when
remote-only, and "no sponsorship" when sponsorship is required. They are explained
in the UI and overridable only by adjusting preferences.

## Resume pipeline (`lib/resume/*`)

1. **Parse** TXT/MD/PDF/DOCX into facts. PDF text comes from content streams
   (`FlateDecode`); DOCX is read from `word/document.xml`. If text cannot be
   extracted, the import fails loudly and asks for pasted text — it never guesses.
2. **Verify** extracted facts with the user; only `verified` facts are usable.
3. **Extract requirements** deterministically (skill dictionary + section detection +
   years/education/sponsorship detection + scam red flags).
4. **Select and order** experience by overlap with the job's requirement tokens,
   reorder bullets, and log every omission.
5. **Compose** a summary from verified facts only; numeric claims must already exist
   in evidence.
6. **Validate** the finished draft (`grounding.ts`): evidence ids exist and are
   verified, skills are held, numbers appear in evidence, employers match history.
7. **Render** ATS-friendly PDF (pdf-lib, single column, real text) and DOCX (docx).
8. **Log** every change with evidence ids and show it in the workspace.

LLM use is optional and confined to step 5; anything it returns is validated before
acceptance, with an automatic fallback to the deterministic text.

## Approval state machine (`lib/approvals.ts`)

```
PENDING_APPROVAL ──approve──► APPROVED ──handoff──► SUBMISSION_PENDING
       ▲                          │                        │
       └──── revoke / edit ───────┘                 user confirms
                                                          ▼
                                                      SUBMITTED
```

Immediately before handoff: package belongs to the user, a non-revoked approval
exists, its hash equals the recomputed package hash, the vacancy is open, and no
submission already exists. Manual handoff records `awaiting_manual_completion`;
a confirmed submission requires a reference from the employer.

## Security and privacy

- Sessions: random token in an httpOnly, sameSite=lax cookie; 14-day expiry.
- Passwords: scrypt with a per-user salt.
- Authorization: `user_id` in every query; ownership re-checked before actions.
- Validation: zod schemas on every mutating endpoint.
- Secrets: server-side env only; `.env` is git-ignored.
- Audit: append-only `audit_events` for searches, generation, approvals, handoffs,
  submissions, exports and deletions.
- Privacy: full JSON export and hard account deletion (cascades).

## Scaling path

- Swap `lib/db` for a Postgres-backed implementation (same SQL shape).
- Move search runs to a queue/worker (per user + source); the cron entry point already
  exists, and the
  idempotent run key already prevents duplicate windows.
- Add source adapters behind the existing `JobSourceAdapter` interface.
- Keep approval, grounding and handoff logic unchanged — they are the product.
