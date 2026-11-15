# Repository audit — reference projects

**Audit date:** 13 November 2026
**Auditor:** engineering (implementation phase)
**Method:** both repositories were cloned into a separate research workspace and read
directly. Every claim below was checked in the source at the commit shown; nothing
is taken from a README without a matching implementation. Where a capability could
not be verified (for example because it needs third-party credentials or a browser),
it is marked **unverified** rather than assumed.

| Repository | Commit audited | Licence | Size |
| --- | --- | --- | --- |
| [career-ops](https://github.com/career-ops-hq/career-ops) | `2aac4fc5794cbda4a91fdff05cd109721592b0b1` | MIT (© 2026 Santiago Fernández de Valderrama) | 3,583 tracked files; ~2,338 `.mjs`, 114 Go, 143 `.tsx` |
| [roleflow](https://github.com/deveshu04/roleflow) | `efa575778fa64014fa3922bcf7430fe6229b407f` | MIT (© 2026 Deveshu Pathak) | 133 tracked files; 51 `.ts`, 28 `.tsx` |

Both licences are permissive (MIT), so **code may be reused with attribution**. That
covers the repositories' own source only. It does not cover their npm dependencies,
the job content they fetch, or the terms of any site they automate — see
[Licence decisions](#licence-decisions).

---

## 1. career-ops

### What it actually is

A local-first, agent-driven job-search toolkit. There is no server application: it is
a large collection of Node ESM scripts (~2,338 `.mjs` files at the top level and in
`cops/`, `lib/`, `scripts/`) plus 114 Go files that implement a local dashboard, and it
is designed to be driven by an AI coding CLI (Claude Code, Codex, Gemini CLI, Cursor,
and others — see `CLAUDE.md`, `CODEX.md`, `GEMINI.md`, `OPENCODE.md`, `KIMI.md`).
State lives in files under a user "data root" (`cv.md`, `tracker.md`, `jds/`, `output/`).

### Verified capabilities

| Area | Finding |
| --- | --- |
| Setup | `npm run doctor` is the documented self-check; `npm run ui` starts a local server (`scripts/ui-server.mjs`). Node `^22.13.0 \|\| >=23.4.0`. No database, no build step for the scripts. |
| Job discovery | Site-specific scanners exist as separate modules (`scan-ats-full.mjs`, `scan-dayforce.mjs`, `scan-hn.mjs`, `scan-interamt.mjs`, `scan-seek.mjs`, `scan-topdev.mjs`) plus `scan.mjs` (6,030 lines). Breadth is real but each source is bespoke. |
| Compliance | `robots-check.mjs` implements RFC 9309 matching with documented, deliberately cautious rules (longest match, ties to `Disallow`, percent-decoded, fail-closed) and is used to gate the *most aggressive* fetch path (a headed-browser retry). The module comments are explicit that the first request is not gated and that this is not a compliance claim. |
| Matching | Deterministic keyword/similarity helpers (`jd-similarity.mjs`, `keyword-match.mjs`, `role-matcher.mjs`, `jd-skill-gap.mjs`, `jd-years.mjs`) and LLM evaluations (`openrouter-runner.mjs`, `gemini-eval.mjs`, `openai-eval.mjs`, `ollama-eval.mjs`, `batch-evaluate-gemini.mjs`). Output is a structured A–H report with a 1–5 score. There is a test-eval harness (`eval-golden.mjs`, `evals/`) — a good idea we adopted as fixtures rather than code. |
| Documents | LaTeX/HTML CV generation (`build-cv-latex.mjs`, `build-cv-html.mjs`, `cv-templates.mjs`), PDF export (`generate-pdf.mjs`), cover letters (`generate-cover-letter.mjs`). ATS linting exists (`verify-ats.mjs`) alongside a fact gate (`verify-cv-facts.mjs`). |
| Truthfulness gate | `verify-cv-facts.mjs` compares generated documents against source files and fails loudly when sources are missing. Its header documents a real bug class — resolving user-layer files from the code root caused every true claim to be reported as unsupported — which is precisely the failure mode we guarded against when building `checkEvidence`. |
| Tracking | Markdown/JSON tracker with status normalisation, dedup, merge and reconcile scripts (`tracker.mjs`, `trailer-*`, `merge-tracker.mjs`, `reconcile-pipeline.mjs`, `normalize-statuses.mjs`). |
| Security posture | `SIGNATURES.md`, `SECURITY.md`, `LEGAL_DISCLAIMER.md`; a CI test (`validate-untrusted-content-coverage.test.mjs`) enforces that prompts handling untrusted text include the guard clause. |
| Tests | ~1,065 files in `tests/` (Node's built-in test runner, `*.test.mjs`), plus Go tests under `dashboard/`. This is a genuinely tested codebase, not a demo. |
| Maintenance | Release-please and Renovate configured; `CHANGELOG.md` maintained; 1,065 test files implies active, reviewed development. |

### Unverified claims / limitations

- **Browser automation depth is unverified.** Playwright is used for CV visual tests
  (`playwright.cv.config.mjs`); the README's broader automation claims were not
  exercised (no browsers in the audit environment).
- **Cross-source dedup quality is unverified.** `dedup-tracker.mjs` and
  `listing-fingerprint.mjs` exist; their accuracy against live boards was not measured.
- **Model quality claims (score calibration) are unverified.** `calibrate.mjs` exists but
  the underlying evals depend on paid providers.
- **Operational complexity is high for our context.** Driving it requires an AI CLI,
  a writable data root, LaTeX for PDFs and (optionally) Go for the dashboard. That is a
  poor fit for a multi-user web product.

### Reuse recommendation

| Capability | Decision | Rationale |
| --- | --- | --- |
| Product ideas (A–H report, evidence gate, robots policy) | **Adapt (concepts only)** | The ideas are strong; the code is single-user and file-based. We re-implemented them behind our own abstractions. |
| `robots-check.mjs` logic | **Adapt (reimplemented)** | We needed the same cautious semantics with our own source registry and tests; porting a 600-line module with its own data root was riskier than a focused implementation. |
| LaTeX/HTML CV generation | **Replace** | LaTeX adds a large runtime dependency and produces output that ATS parsers handle worse than DOCX. We generate PDF and DOCX directly (`packages/document-engine/src/export.ts`). |
| Scanner scripts | **Exclude** | Each is bespoke and unauthenticated scraping of specific boards; our source register only includes boards with documented public APIs (see §3). |
| Dashboard (Go) | **Exclude** | Single-user local tool; we ship a React SPA over a multi-tenant API. |
| Tracker format | **Replace** | Markdown files cannot support concurrent users, history and audit. We use a relational model (20 tables). |

---

## 2. roleflow

### What it actually is

A Next.js 16 (App Router) application with React 19, Tailwind 3 and a small `lib/`
layer (`agent/`, `jobs/`, `resume/`). It presents itself as an "AI job application
agent": search, per-job resume tailoring, and an OpenAI-driven browser agent that fills
real applications **for the user's approval**. Storage is a local `store.ts` (no
database). Tests are Playwright specs.

### Verified capabilities

| Area | Finding |
| --- | --- |
| Setup | `npm run dev` / `build` / `start` (`next dev -H 127.0.0.1`), plus `npm run check` = lint + typecheck + Playwright. Small, understandable codebase. |
| Job discovery | `lib/jobs/`: LinkedIn search (`linkedin.ts`), a generic web search (`web.ts`), and ATS-specific detail fetchers for **Greenhouse, Lever, Ashby** (`ats.ts`), plus `match.ts` for quick fit scoring. |
| Resume handling | `lib/resume/parse.ts` reads PDFs with `unpdf` and DOCX with `mammoth`, including embedded links. Tailoring in `tailor.ts`, rendering in `render.ts`. |
| Browser agent | `lib/agent/`: `browser.ts` (Playwright), `snapshot.ts` (accessible-tree capture), `actions.ts`, `prompts.ts`, `runner.ts`, `autopilot.ts`. Crucially, `actions.ts` exports `isSubmitLike()` matching `/submit|send application|finish application/i`, and `prompts.ts` instructs the model to call `ready_to_submit` and *not* click the final button until approval is granted. |
| SSRF defence | `lib/url-safety.ts` rejects non-http(s) schemes, literal private/loopback/link-local/CGNAT addresses, IPv4-mapped IPv6, `.local`-style names, **and** re-checks after DNS resolution. `lib/request-guard.ts` rejects cross-origin and `sec-fetch-site` violations on the local API. Both are covered by `tests/url-safety.spec.ts`. |
| Tracking/state | `store.ts` with an in-process store; `autopilot.ts` defines the state machine `queued → preparing → tailoring → applying → submitted/skipped/failed/stopped`. |
| Security | Local-only binding, request guard, URL safety. No authentication (single local user), no encryption at rest, no multi-tenancy. |
| Tests | Two Playwright spec files (`agent-engine.spec.ts`, `url-safety.spec.ts`). They require browsers, so they cannot run in our CI without a browser download. |

### Unverified claims / limitations

- **"Fills real applications" is unverified end-to-end.** The submit guard is present in
  the prompt and in `isSubmitLike`, but whether a real site is filled correctly depends
  on selectors and was not exercised here.
- **No persistence guarantee.** `store.ts` is process-local; restarting loses state.
- **No authentication or tenancy.** Binding to `127.0.0.1` is the only access control.
- **Test coverage is narrow** (2 spec files) relative to the surface area.

### Reuse recommendation

| Capability | Decision | Rationale |
| --- | --- | --- |
| `url-safety.ts` (SSRF defence) | **Adapt** | Directly applicable to any agent that fetches user-supplied URLs. We implemented the same rules (scheme allowlist, private/loopback/link-local/CGNAT, IPv4-mapped IPv6, post-DNS re-check) for the browser-assistant allowlist and covered them with unit tests. |
| Request guard (origin/`Sec-Fetch-Site`) | **Adapt** | Our equivalent is the API's CORS + SameSite cookie policy plus explicit origin checks on state-changing routes. |
| Submit guard concept (`isSubmitLike`) | **Adopt as a rule** | This is the single most important safety property in the domain. Our design goes further: there is **no code path that can submit at all**, so the guard is structural rather than prompt-based. |
| ATS fetchers (Greenhouse/Lever/Ashby) | **Adapt** | These three have documented public job-board APIs, so they meet our source-register bar. We implemented them as first-class connectors with attribution preserved. |
| LinkedIn search | **Exclude** | Automated access conflicts with LinkedIn's terms; we offer manual hand-off links instead. |
| Resume parsing (`unpdf` + `mammoth`) | **Adapt** | Confirms the format choices (PDF/DOCX). We parse on the server with explicit size/magic-byte validation and never expose stored files. |
| `store.ts` / Next.js app shell | **Replace** | No database, no auth, no tenancy. We built a Fastify API + Postgres + React SPA. |

---

## 3. What we deliberately did not copy, and why

1. **Scraped job sources.** Neither project's scrapers are reused. Our source register
   (`packages/job-connectors/src/source-registry.ts`) admits only sources with a
   documented public API or feed, states the compliance rationale per source, and treats
   everything else as a manual hand-off link. A source's presence in a reference repo is
   not evidence of permission.
2. **Prompt-only safety.** roleflow's "do not click submit" is an instruction to a model.
   Instructions can be overridden by adversarial page content. Our browser assistant
   cannot submit because no submission capability is implemented, and the domain model
   has no column that could record a system submission.
3. **Single-user file state.** Both projects store state in files/process memory. Neither
   supports two users on one instance, history, or deletion guarantees. We model
   ownership explicitly and test cross-account isolation.
4. **LaTeX document generation.** Heavy toolchain, weaker ATS compatibility. Direct
   PDF/DOCX generation is deterministic and testable byte-for-byte.

---

## 4. Licence decisions

- Both repositories are **MIT**. Reused *concepts* need no licence action; any reused
  *code* would require retaining the copyright notice and permission text.
- **No source file was copied verbatim.** The implementations in this repository were
  written against the documented behaviour of the reference modules, with our own tests.
  Where behaviour is intentionally identical (URL safety rules, submit prohibition), a
  comment in our code names the source of the requirement.
- **Dependency licences are separate.** Notably `unpdf` (roleflow) and Playwright carry
  their own terms; we chose not to depend on either.
- **Job content is not ours to redistribute.** Listings are fetched at runtime, stored
  per user, attributed to the source, and always link back to the original posting.
- **Trademarks.** Source names appear only as factual attribution.

---

## 5. Security concerns carried forward

| Concern | Where it came from | How this repository addresses it |
| --- | --- | --- |
| SSRF through user-supplied URLs | roleflow `url-safety.ts` | Same address families rejected, plus post-DNS re-check, plus an explicit host allowlist for the browser assistant. |
| Cross-site requests against a local API | roleflow `request-guard.ts` | HttpOnly + SameSite=Lax session cookie, CORS allowlist of exactly one origin, `credentials: same-origin` in the client. |
| Prompt injection from job descriptions | both | Job text is wrapped in delimiters, declared data-not-instructions in every prompt, and every generated claim is re-checked against verified facts before the user can export it. |
| Fabricated claims in documents | career-ops `verify-cv-facts.mjs` | `checkEvidence` blocks export until approval, and approval of warnings requires an explicit acknowledgement. |
| Robots/terms violations | career-ops `robots-check.mjs` | Sources are reviewed and registered with a stated access method; non-permitted sources are manual hand-off only. |
| Unbounded scraping | both | Per-scan job caps, per-page caps, per-source timeouts, per-user rate limits, and a daily schedule. |

---

## 6. Summary

Both reference projects are worth reading and neither should be adopted wholesale.
career-ops is a deep, well-tested single-user toolkit whose **ideas** (evidence gating,
cautious robots policy, ATS linting) are excellent and whose **form** (AI-CLI-driven
scripts, LaTeX, files on disk) does not fit a multi-user service. roleflow is a compact
demonstration of the same domain whose **safety thinking** (URL validation, submit
prohibition) is its most valuable asset and whose **architecture** (process-local store,
no auth) cannot support more than one user.

The audit's main contribution to the implementation was negative: it showed which
shortcuts are unsafe — prompt-level submit guards, indiscriminate scraping, unverified
facts in documents — and each of those became an explicit, tested constraint here.
