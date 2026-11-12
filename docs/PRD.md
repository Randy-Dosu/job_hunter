# Job Hunter

## Product Requirements Document and Comprehensive Implementation Plan

**Document version:** 1.0\
**Date:** 12 November 2026\
**Status:** Proposed / ready for technical discovery\
**Working product name:** Job Hunter

---

# 1. Executive Summary

Job Hunter is a user-controlled job-search assistant that discovers
relevant vacancies on a recurring daily schedule, ranks them against a
user's job-hunt profile, prepares a truthful job-specific resume and
supporting application material, and asks the user for explicit
permission before submitting any application.

The product reduces repetitive job-search work without taking away the
candidate's control. It should behave like a careful career assistant,
not an indiscriminate application bot. It must explain why a vacancy is
relevant, show the source and deadline where available, identify missing
qualifications, disclose every resume change, and make the final
application action dependent on a clear approval from the user.

The system is designed for multiple job markets. During onboarding, a
user defines their preferred market: countries, cities, remote-work
regions, job boards, languages, time zones, work authorization, salary
expectations, role types, seniority, industries, and exclusions. The
first useful release should support a focused set of markets and sources
rather than promise universal coverage.

**Core workflow:** configure profile → search daily → normalize and
deduplicate vacancies → assess fit → notify user → tailor resume from
verified facts → user reviews → user approves → submit through an
allowed application route → track outcome.

**Non-negotiable principle:** the system must never invent
qualifications, employment history, projects, dates, metrics,
certifications, or skills. It must never submit an application without
explicit, vacancy-specific user approval.

# 2. Product Vision and Goals

## 2.1 Vision

Help job seekers spend less time finding and preparing applications and
more time improving their skills, interviewing, and making informed
career decisions.

## 2.2 Product goals

1.  Find new and still-open jobs matching a user's defined job-hunt
    market.
2.  Run searches automatically on a daily schedule, with
    user-configurable frequency.
3.  Explain match scores and show evidence for each recommendation.
4.  Generate a job-specific resume using only user-approved, verified
    profile facts.
5.  Prepare optional cover letters and application-question drafts.
6.  Present a review screen where users can compare the tailored resume
    with their base resume.
7.  Require explicit approval before any external application is
    submitted.
8.  Track applications, deadlines, statuses, and follow-up reminders.
9.  Give users control over their data, sources, schedule, and
    automation level.
10. Make the system auditable: users can see what it searched,
    generated, changed, and submitted.

## 2.3 Non-goals for the first release

- Guaranteeing interviews, employment, or vacancy availability.
- Applying to every job automatically.
- Bypassing CAPTCHAs, login protections, paywalls, rate limits, or
  anti-bot controls.
- Scraping sites where automated access is prohibited.
- Fabricating experience or optimizing resumes through deception.
- Sending messages to recruiters without review and approval.
- Replacing a human career adviser or legal advice on work
  authorization.
- Supporting every job board, country, language, and
  applicant-tracking system at launch.

# 3. Target Users and Use Cases

## 3.1 Primary users

- Students and recent graduates looking for internships, graduate
  programmes, and entry-level roles.
- Early-career professionals seeking junior or associate positions.
- Experienced professionals changing roles or industries.
- Remote-first candidates searching across selected countries or
  regions.

## 3.2 Main user stories

**Profile and preferences** - As a job seeker, I want to define the
countries, cities, remote regions, roles, seniority, industries, salary
range, and work arrangements I will consider. - As a job seeker, I want
to upload a base resume and maintain a verified profile so generated
resumes remain accurate. - As a job seeker, I want to specify skills I
have, skills I am learning, and skills I do not have.

**Discovery** - As a job seeker, I want the agent to search my selected
sources every day. - As a job seeker, I want to see only new or
materially changed vacancies, not repeated listings. - As a job seeker,
I want to know why a role matches and what gaps I have.

**Resume preparation** - As a job seeker, I want a resume tailored to a
specific vacancy. - As a job seeker, I want to review every meaningful
change and reject unsupported claims. - As a job seeker, I want the
resume exported in a recruiter-friendly PDF and/or DOCX format.

**Application control** - As a job seeker, I want to review the
application package and destination before submission. - As a job
seeker, I want to approve or reject each application individually. - As
a job seeker, I want to know whether an application was submitted,
failed, or still requires manual action.

**Tracking** - As a job seeker, I want to track application status and
deadlines. - As a job seeker, I want reminders for follow-ups and
interviews.

# 4. Product Scope and Release Strategy

## 4.1 MVP scope

The MVP should prove the complete value loop with a small number of
reliable sources.

- Account creation and secure authentication.
- Job-hunt profile and preference setup.
- Base resume upload and structured profile extraction.
- Manual search plus scheduled daily search.
- A small, approved source catalogue using official APIs, feeds,
  partner integrations, or permitted public pages.
- Job normalization, deduplication, and expiry checks.
- Explainable job-fit scoring.
- Job dashboard and email/in-app notifications.
- Tailored resume generation from verified facts.
- Resume preview, edit, download, and comparison with base resume.
- Application approval gate.
- Application tracking with manual fallback where submission
  automation is not permitted.
- Audit log and user data deletion/export.

## 4.2 Later releases

**Release 1.1** - Cover letter and short-answer drafting. - More job
sources and market-specific source packs. - Calendar reminders and
interview preparation. - Resume templates and multiple base resumes.

**Release 2** - Browser-assisted application workflow for sites where it
is permitted. - User-approved recruiter outreach drafts. - Application
analytics: response rate by role, source, resume version, and market. -
Optional integrations with email and calendar providers.

**Release 3** - Team or career-centre workspace. - Multi-language
support. - Advanced market intelligence and salary insights, where
trustworthy data exists.

# 5. Functional Requirements

Priority definitions: **P0 = required for MVP**, **P1 = important
next**, **P2 = later enhancement**.

## 5.1 Onboarding and job-hunt profile

**FR-001 (P0):** Users can create an account and securely sign in.

**FR-002 (P0):** Users can define a job-hunt market with: - Country and
city preferences. - Remote, hybrid, and on-site preferences. - Remote
eligibility regions (for example, remote within a country, continent, or
worldwide). - Work authorization / sponsorship needs. - Job titles, role
families, and alternative titles. - Internship, graduate, junior,
contract, part-time, or full-time preferences. - Industries and company
types. - Minimum salary and currency, if desired. - Preferred
language. - Excluded employers, industries, keywords, or locations. -
Preferred and excluded job sources.

**FR-003 (P0):** Users can set daily search time, time zone, days of
week, and notification channel.

**FR-004 (P0):** Users can pause, resume, or run a search immediately.

**FR-005 (P0):** Users can edit profile facts and mark each fact as
verified, unverified, or outdated.

**FR-006 (P0):** Users can upload a base resume in supported formats and
review extracted details before saving.

## 5.2 Job discovery and ingestion

**FR-010 (P0):** The scheduler starts a search according to the user's
configured schedule.

**FR-011 (P0):** The system searches only enabled sources and records
the source, query, search time, and retrieval status.

**FR-012 (P0):** The system normalizes each vacancy into a common
schema: - Title, employer, location, remote policy, description,
responsibilities, requirements, salary, employment type, seniority, date
posted, deadline, source URL, application URL, and source identifier. -
Fields that are unavailable remain unknown; they are not guessed.

**FR-013 (P0):** The system detects duplicates using source IDs,
canonical URLs, employer/title/location similarity, and content
fingerprints.

**FR-014 (P0):** The system checks whether a vacancy is still open when
possible and marks uncertain status clearly.

**FR-015 (P0):** The system stores source attribution and retrieval
timestamps for each job.

**FR-016 (P1):** The system detects meaningful changes to a vacancy and
alerts the user.

**FR-017 (P1):** Users can add a job URL manually, subject to access and
parsing limits.

## 5.3 Matching and ranking

**FR-020 (P0):** Each vacancy receives a match score and a
human-readable explanation.

**FR-021 (P0):** The score considers role relevance, skills, seniority,
location/remote eligibility, work authorization, experience, education,
salary, and user preferences.

**FR-022 (P0):** Hard constraints (such as excluded locations or
required work authorization) can disqualify a job regardless of its
numeric score.

**FR-023 (P0):** The UI separates: - Strong matches. - Possible matches
with gaps. - Low matches / excluded jobs.

**FR-024 (P0):** The system identifies missing or uncertain
qualifications and distinguishes required from preferred qualifications.

**FR-025 (P1):** Users can give feedback (relevant, not relevant,
applied, dismissed) to tune future ranking.

## 5.4 Resume and application material generation

**FR-030 (P0):** The system generates a job-specific resume from a
user-approved base resume and verified profile facts.

**FR-031 (P0):** The generator may reorder, summarize, and emphasize
truthful content to improve relevance.

**FR-032 (P0):** The generator must not create unsupported skills, job
titles, employers, dates, degrees, certificates, achievements, or
numerical outcomes.

**FR-033 (P0):** Every generated claim must be traceable to a source
fact in the user's profile or base resume.

**FR-034 (P0):** The system displays a change summary showing additions,
removals, and rewrites.

**FR-035 (P0):** Users can edit the draft and approve the final resume.

**FR-036 (P0):** The system exports a clean, ATS-readable PDF. DOCX
export is strongly recommended.

**FR-037 (P1):** The system drafts a cover letter and answers to
application questions, clearly marking items that need user
confirmation.

**FR-038 (P1):** The system can maintain multiple resume variants for
different role families.

## 5.5 Approval and application

**FR-040 (P0):** No application can be submitted until the user
explicitly approves that specific job and the exact application package.

**FR-041 (P0):** The approval screen shows employer, job title, source,
destination URL, resume version, cover letter, answers, and any
requested personal information.

**FR-042 (P0):** Approval is bound to a specific vacancy and package
version. If the package changes after approval, approval becomes invalid
and must be requested again.

**FR-043 (P0):** The user can choose: - Approve and submit (only if a
supported, permitted submission method exists). - Open application page
and apply manually. - Save for later. - Reject / dismiss.

**FR-044 (P0):** The system records approval time, package version,
destination, submission attempt, and result.

**FR-045 (P0):** If the site requires a CAPTCHA, unsupported
authentication, or manual attestation, the system stops and hands
control to the user.

**FR-046 (P0):** The system must not claim an application was submitted
unless it receives reliable confirmation.

**FR-047 (P1):** The system can use browser-assisted form filling on
supported sites, but the user must review and approve the final
submission action.

## 5.6 Notifications and application tracking

**FR-050 (P0):** Users receive a daily digest of newly discovered jobs
and high-priority matches.

**FR-051 (P0):** Users can receive immediate alerts for high-fit jobs or
closing deadlines.

**FR-052 (P0):** Users can track statuses such as saved, reviewing,
ready for approval, approved, submitted, confirmation pending,
interview, rejected, withdrawn, and closed.

**FR-053 (P0):** Users can record outcomes manually when an external
site does not provide status data.

**FR-054 (P1):** The system sends configurable follow-up reminders.

## 5.7 Administration and source governance

**FR-060 (P0):** Administrators can enable/disable sources, set rate
limits, and inspect source failures.

**FR-061 (P0):** Each source has documented access method, terms review,
rate limits, supported markets, and data fields.

**FR-062 (P0):** The system respects robots directives where applicable,
source terms, API quotas, and privacy requirements. It must not bypass
access controls.

**FR-063 (P1):** Admins can review matching quality, parsing errors, and
user-reported bad results.

# 6. User Experience and Key Screens

1.  **Welcome / onboarding:** concise explanation of what the agent can
    and cannot do.
2.  **Job-hunt profile:** market, role, seniority, remote eligibility,
    work authorization, salary, exclusions, schedule.
3.  **Resume profile:** upload, extraction review, verified facts,
    skills and evidence.
4.  **Dashboard:** daily search status, new jobs, strong matches,
    application pipeline, upcoming deadlines.
5.  **Job detail:** complete description, source link, match score,
    reasons, gaps, date found, vacancy status.
6.  **Resume tailoring workspace:** base-versus-tailored comparison,
    highlighted edits, unsupported-claim warnings, preview and export.
7.  **Approval centre:** exact job, destination, package preview,
    consent checkbox/button, submit or manual handoff.
8.  **Application tracker:** statuses, dates, notes, resume version,
    next action.
9.  **Settings and privacy:** sources, schedule, notifications, data
    export/deletion, connected accounts.

## 6.1 Example daily experience

At the scheduled time, the agent searches the user's selected markets
and sources. The dashboard shows 18 listings discovered, 7 duplicates
removed, 6 closed or stale listings excluded, and 5 relevant
opportunities. These numbers are illustrative, not guaranteed.

A user opens a vacancy and sees: - Match: 84/100. - Strong evidence:
Java, SQL, web development, internship-level role. - Potential gap:
employer requests one year of commercial experience. - Location: remote
within a specified region; user eligibility must be confirmed. - Source:
named job board and original listing URL.

The user chooses **Tailor resume**. The system produces a draft with a
change log. The user edits and approves the document. The application
centre then asks for a separate approval to submit or opens the official
application page for manual completion.

# 7. Matching and Ranking Design

A transparent weighted score is preferable to an opaque LLM-only
decision.

## 7.1 Suggested initial scoring model

Dimension Weight

---

Role/title relevance 20
Required skills match 25
Seniority and experience fit 15
Location / remote eligibility 15
Education / certifications 10
Salary and employment preferences 5
Industry / company preference 5
Posting freshness / deadline 5
**Total** **100**

Weights should be configurable and validated with real user feedback. A
missing data field should reduce confidence, not silently count as a
match.

## 7.2 Hard filters

Examples: - User excludes a country or employer. - On-site only, when
the user requires remote work. - Role requires work authorization the
user does not have and sponsorship is unavailable. - Vacancy is
confirmed closed. - Role is outside the selected seniority or job type.

Hard filters should have an explanation and be overridable only when the
user explicitly chooses to review excluded jobs.

## 7.3 LLM responsibilities and limits

Use an LLM to extract structured requirements, summarize job
descriptions, explain match evidence, and draft resume language. Use
deterministic code for scoring, filtering, deduplication, approval
checks, and state transitions. The LLM must not decide that a user has a
skill or qualification without evidence.

# 8. System Architecture

## 8.1 Recommended architecture

A modular web application with a background worker is sufficient for the
first release. Avoid microservices until scale or team boundaries
justify them.

**Frontend** - React + TypeScript (or Next.js if server-rendered routes
are useful). - Responsive dashboard and review workflows. - Tailwind CSS
or a consistent component library. - Secure session handling.

**Backend** - Node.js + TypeScript using Express or Fastify. - REST API
with validation and typed request/response contracts. - Background job
queue for scheduled search and resume-generation tasks. - Separate
worker process for source ingestion and scheduled jobs.

**Database** - PostgreSQL (Supabase is a practical managed option). -
Row-level security or equivalent authorization checks. - Object storage
for resumes and generated documents.

**Supporting services** - Scheduler / queue: pg-boss, BullMQ + Redis, or
a managed scheduled-job service. Select one; do not add Redis unless
needed. - LLM provider abstraction: allow configured providers and model
changes. - Email: transactional email provider; in-app notifications
first. - File generation: DOCX and PDF generation libraries. -
Observability: structured logs, error tracking, job-run metrics.

## 8.2 High-level component flow

```text
Web Client
   |
   v
Node.js API -------- Authentication / Authorization
   |                         |
   v                         v
PostgreSQL <------------ User Profile / Preferences
   |
   +---- Scheduler / Queue ----> Search Worker
   |                                 |
   |                                 v
   |                         Source Adapters
   |                                 |
   |                                 v
   |                         Normalize / Deduplicate
   |                                 |
   |                                 v
   +<-------------------------- Job Store
   |
   +----> Matching Service ----> Ranked Job Feed
   |
   +----> Resume Service ------> LLM + Verified Facts
   |                                 |
   |                                 v
   |                           Draft / Change Log
   |
   +----> Approval Service ----> Submission Adapter / Manual Handoff
   |
   +----> Notification Service -> Email / In-app
```

## 8.3 Source integration strategy

Use this order of preference: 1. Official job-board APIs or partner
feeds. 2. Public RSS/Atom feeds and employer career-site feeds. 3.
Licensed aggregators with documented terms. 4. Permitted public pages
with conservative rate limits and source-specific compliance checks. 5.
User-submitted job links.

Do not assume a website is scrapeable because it is publicly viewable.
Job boards may prohibit automated collection or automated applications.
Keep source adapters isolated so one source can be disabled without
breaking the system.

## 8.4 Application submission strategy

Submission is a separate subsystem from job discovery. Prefer official
APIs or documented integrations. If no permitted integration exists,
provide a manual handoff: open the employer's application page, provide
the approved resume and drafts, and let the user complete the
application. Do not automate around CAPTCHA or anti-bot protections.

# 9. Data Model

Suggested initial relational entities:

- **users:** id, email, password/auth provider reference, created_at.
- **candidate_profiles:** user_id, headline, summary, education,
  experience, skills, certifications, portfolio links, work
  authorization, updated_at.
- **profile_evidence:** id, user_id, fact_type, fact_value,
  source_document_id, verification_status, verified_at.
- **job_preferences:** user_id, markets, locations, remote_regions,
  role_titles, seniority, job_types, industries, salary_floor,
  currency, exclusions, schedule, timezone.
- **resume_documents:** id, user_id, storage_key, file_type, version,
  is_base, created_at.
- **job_sources:** id, name, source_type, access_method,
  terms_reviewed_at, enabled, rate_limit_config.
- **search_runs:** id, user_id, started_at, finished_at, status,
  query_config, result_counts, error_summary.
- **jobs:** id, source_id, external_id, canonical_url, title, company,
  location, description, requirements, salary, posted_at, deadline,
  status, content_hash, last_seen_at.
- **job_matches:** id, user_id, job_id, score, confidence,
  reasons_json, gaps_json, matched_at, feedback.
- **tailored_resumes:** id, user_id, job_id, base_resume_id,
  generated_document_id, structured_content, change_log,
  model_metadata, status.
- **application_packages:** id, user_id, job_id, resume_id,
  cover_letter, answers_json, package_hash, status.
- **application_approvals:** id, user_id, package_id, approved_at,
  approval_method, revoked_at.
- **applications:** id, user_id, job_id, package_id, status,
  submitted_at, confirmation_reference, last_updated_at.
- **notifications:** id, user_id, type, payload, read_at, sent_at.
- **audit_events:** id, user_id, actor, action, entity_type,
  entity_id, timestamp, metadata_json.

Use UUIDs, timestamps in UTC, and explicit user ownership. Store
original source URLs and provenance. Avoid retaining unnecessary
personal data.

# 10. API Design (Illustrative)

---

Method Endpoint Purpose

---

POST `/api/profile` Create/update candidate
profile

GET `/api/profile` Read candidate profile

POST `/api/resumes` Upload base resume

POST `/api/preferences` Save market and search
preferences

POST `/api/search-runs` Trigger a manual search

GET `/api/search-runs/:id` Read search-run status

GET `/api/jobs` List/filter discovered
jobs

GET `/api/jobs/:id` View vacancy and match
evidence

POST `/api/jobs/:id/tailor-resume` Generate a tailored
resume draft

GET `/api/tailored-resumes/:id` Read draft and change
log

PATCH `/api/tailored-resumes/:id` Edit draft

POST `/api/application-packages` Assemble approved
materials

POST `/api/application-packages/:id/approve` Record explicit
approval

POST `/api/applications/:id/submit` Submit through
supported adapter

GET `/api/applications` Application tracker

PATCH `/api/applications/:id` Update status/notes

GET `/api/audit-events` View user activity
history

---

All endpoints require authentication and authorization. Validate input
on the server. Rate-limit sensitive endpoints. Use idempotency keys for
submission attempts.

# 11. Security, Privacy, Trust, and Compliance

## 11.1 Personal data protection

Resumes contain personal information. Apply data minimization,
encryption in transit and at rest, strict access controls, secure object
storage, and limited retention. Never expose one user's resume or
job-search activity to another user.

## 11.2 LLM privacy

- Do not send more personal data to an LLM than necessary.
- Use provider settings that avoid training on submitted data where
  available and appropriate.
- Document which provider receives data and for what purpose.
- Redact sensitive fields when they are not needed for the task.
- Keep API keys on the server; never expose provider keys in frontend
  code.

## 11.3 Consent and approval

- Consent to create a tailored resume is not consent to submit an
  application.
- Approval must be per vacancy and per exact package version.
- The user must see the destination and all materials before approval.
- Approval expires if material content changes or the vacancy
  destination changes.
- Provide a clear cancel/revoke action before submission begins.

## 11.4 Accuracy safeguards

- Every resume claim must map to verified user evidence.
- If evidence is missing, ask the user or omit the claim.
- Never convert "learning Python" into "professional Python
  experience".
- Never invent metrics; ask the user for real numbers or use
  qualitative wording.
- Warn when the job description appears suspicious, requests payment,
  or asks for unusually sensitive information.

## 11.5 Legal and platform compliance

Review the terms and applicable law for each job source and application
destination. Comply with privacy, copyright/database rights, anti-spam,
and employment-related requirements in each operating market. The
product should provide a source review record and a takedown/disable
mechanism.

# 12. Non-Functional Requirements

- **Reliability:** scheduled runs should retry transient failures with
  bounded backoff and avoid duplicate runs.
- **Performance:** dashboard's first meaningful view should generally
  load within 2--3 seconds under normal MVP load.
- **Scalability:** queue search tasks per user/source; avoid running
  all users' searches in one synchronous request.
- **Availability:** target 99.5% monthly uptime for MVP, excluding
  third-party outages.
- **Security:** authentication, authorization, encryption, secret
  management, input validation, rate limiting, audit logging.
- **Accessibility:** keyboard navigation, clear labels, sufficient
  contrast, readable document previews.
- **Explainability:** every match score and resume change should have
  a human-readable reason.
- **Portability:** export user profile, resumes, and application
  history in practical formats.
- **Maintainability:** source adapters and LLM prompts should be
  versioned and tested independently.

# 13. Success Metrics

## 13.1 Product metrics

- Daily search completion rate.
- Number of new, unique, open jobs discovered per active user.
- Percentage of recommendations rated relevant.
- Duplicate rate.
- Percentage of generated resumes accepted with minor edits.
- Time from job discovery to application-ready package.
- Approval-to-submission success rate.
- Percentage of submissions with confirmed outcomes.
- Weekly active users and user retention.

## 13.2 Quality and safety metrics

- Unsupported resume-claim rate: target **0**.
- Applications submitted without valid approval: target **0**.
- Duplicate application attempts: target **0**.
- Incorrect closed-job recommendations.
- Source policy violations: target **0**.
- Failed or uncertain submission rate.
- User-reported privacy/security incidents.

Do not optimize only for number of applications. Optimize for relevant
opportunities and high-quality, user-approved applications.

# 14. Acceptance Criteria for MVP

The MVP is acceptable when all of the following are true:

1.  A user can register, configure at least one job market, and set a
    daily schedule.
2.  A user can upload a resume and correct extracted profile
    information.
3.  The system can search at least three compliant sources or source
    types in the selected launch market.
4.  Search results are normalized, deduplicated, and linked to original
    sources.
5.  Jobs are ranked with an explanation and visible qualification gaps.
6.  A daily search run completes and creates a digest.
7.  A tailored resume can be generated from verified facts.
8.  Every generated claim can be traced to user-provided evidence.
9.  The user can inspect and edit the tailored resume and download it.
10. The application workflow cannot submit without a valid, job-specific
    approval.
11. Unsupported destinations lead to manual handoff rather than unsafe
    automation.
12. Application status and audit history are visible to the user.
13. Users can pause automation and delete/export their data.
14. Automated tests cover authorization, matching, deduplication, resume
    grounding, approval expiry, and submission idempotency.

# 15. Risks and Mitigations

---

Risk Impact Mitigation

---

Job-board blocks or Missing data / legal Official APIs, feeds,
prohibits scraping exposure source review, disable
unsupported sources

Low-quality or stale Wasted user time Freshness checks,
listings source timestamps,
closed-job detection

Resume hallucination Candidate Evidence-backed claims,
misrepresentation validation, diff
review, user approval

Incorrect job matching Poor recommendations Explainable scoring,
feedback loop, hard
filters

Application submission Missed opportunity Manual fallback,
failure confirmation state,
idempotency

LLM/provider outage Draft generation Provider abstraction,
unavailable retries, clear fallback

Sensitive resume data Severe privacy harm Encryption, access
exposure controls, least
privilege, retention
policy

Scope creep Delayed MVP Limit initial markets,
sources, and submission
methods

---

# 16. Comprehensive Implementation Plan

## Phase 0 --- Product discovery and validation (Week 1)

**Objectives** - Select the first target user segment and launch
market. - Confirm what users consider a good job match. - Validate
source availability and permitted access. - Decide the MVP's supported
application method.

**Tasks** 1. Interview 5--10 job seekers in the intended segment. 2.
Collect 20--30 representative job listings from the target market. 3.
Review the terms and access options for 5--8 potential job sources. 4.
Define initial role families, seniority labels, and hard filters. 5.
Create low-fidelity flows for onboarding, job detail, resume review, and
approval. 6. Write a data/privacy notice and threat-model the resume
workflow.

**Deliverables:** launch-market decision, source matrix, user flows,
initial scoring rubric, MVP backlog.

**Exit gate:** at least three viable source integrations or source types
are identified with acceptable access conditions.

## Phase 1 --- Foundation and user profile (Weeks 2--3)

**Tasks** 1. Create repository structure and development environments. 2. Set up React + TypeScript frontend and Node.js + TypeScript API. 3.
Configure PostgreSQL, migrations, and object storage. 4. Implement
authentication and per-user authorization. 5. Build onboarding and
job-hunt preference forms. 6. Implement resume upload and extraction
review. 7. Store profile facts with evidence and verification state. 8.
Add audit-event infrastructure.

**Deliverables:** authenticated app, profile editor, preference
settings, base resume upload.

**Exit gate:** users can create and edit a profile without cross-user
data access.

## Phase 2 --- Job source ingestion (Weeks 4--5)

**Tasks** 1. Define a `JobSourceAdapter` interface. 2. Implement three
compliant sources or source types for the chosen market. 3. Build a
parser/normalizer into the common job schema. 4. Implement URL
canonicalization and duplicate detection. 5. Add job status and
freshness checks. 6. Add bounded retries, rate limits, and per-source
error logs. 7. Build manual search trigger and search-run history. 8.
Create fixtures from real sample listings for regression tests.

**Deliverables:** source adapters, normalized job store, deduplication,
manual search.

**Exit gate:** repeated searches do not create duplicate jobs and source
failures are visible.

## Phase 3 --- Matching and daily automation (Weeks 6--7)

**Tasks** 1. Implement hard filters. 2. Implement weighted score with
configurable weights. 3. Use an LLM only for structured extraction and
explanation where useful. 4. Store score components, confidence,
evidence, and gaps. 5. Build ranked job feed and job-detail page. 6. Add
scheduler and queue worker. 7. Add timezone-aware daily schedules and
pause/resume controls. 8. Generate daily digest and high-fit alerts.

**Deliverables:** ranked job feed, daily search worker, notifications.

**Exit gate:** a user can receive a daily digest with understandable
reasons for each recommendation.

## Phase 4 --- Evidence-grounded resume generation (Weeks 8--9)

**Tasks** 1. Convert the base resume into structured, editable sections. 2. Create a fact-evidence store for experience, education, skills, and
achievements. 3. Extract job requirements into structured fields. 4.
Build prompt templates with strict grounding instructions. 5. Generate a
tailored resume by selecting and rewriting supported facts. 6. Validate
every generated claim against evidence IDs. 7. Create a change log and
base-versus-tailored comparison. 8. Add editing and PDF/DOCX export. 9.
Test adversarial cases where the job description asks for skills the
user does not have.

**Deliverables:** resume tailoring workspace, evidence validation,
export.

**Exit gate:** no unsupported claims pass validation in the test suite.

## Phase 5 --- Approval and application tracking (Weeks 10--11)

**Tasks** 1. Build application package entity and review screen. 2. Bind
approval to exact job ID, destination URL, and package hash. 3.
Invalidate approval whenever material package content changes. 4.
Implement manual application handoff as the default safe path. 5. Add
one supported submission integration only if its official terms permit
it. 6. Add idempotency and submission-result states. 7. Build
application tracker and audit history. 8. Add cancellation and failure
handling.

**Deliverables:** approval centre, manual handoff, application tracker.

**Exit gate:** automated tests prove that no submission can occur
without valid approval.

## Phase 6 --- Hardening, pilot, and launch (Weeks 12--13)

**Tasks** 1. Run end-to-end tests across onboarding, search, tailoring,
approval, and tracking. 2. Test access control and file permissions. 3.
Test provider outage, source outage, retries, duplicate events, and
expired approvals. 4. Conduct a small pilot with 5--10 users. 5. Review
match feedback and false positives. 6. Fix critical UX and reliability
issues. 7. Publish privacy policy, source policy, and user guide. 8. Set
up monitoring, backups, and incident response.

**Deliverables:** MVP release, pilot report, prioritized post-launch
backlog.

**Exit gate:** no critical security or consent defects; pilot users can
complete the full workflow.

## Suggested schedule

Phase Duration Main outcome

---

Discovery 1 week Market, users, sources validated
Foundation 2 weeks Auth, profile, resume upload
Ingestion 2 weeks Compliant job search
Matching & automation 2 weeks Daily ranked digest
Resume generation 2 weeks Grounded tailored resume
Approval & tracking 2 weeks Consent-gated applications
Hardening & pilot 2 weeks MVP release
**Total** **13 weeks** **Working MVP**

This is a focused small-team estimate, not a guarantee. A solo beginner
developer should expect a longer schedule, particularly for reliable
source integrations and document generation.

# 17. Repository and Code Organization

Suggested monorepo:

```text
job-hunt-agent/
├── apps/
│   ├── web/                  # React + TypeScript UI
│   └── api/                  # Node.js API
├── workers/
│   └── search-worker/        # Scheduled ingestion and queue jobs
├── packages/
│   ├── shared/               # Types, schemas, validation
│   ├── matching/             # Filters and scoring
│   ├── resume/               # Resume parsing and generation
│   └── source-adapters/      # Job-source integrations
├── database/
│   ├── migrations/
│   └── seeds/
├── docs/
│   ├── PRD.md
│   ├── architecture.md
│   └── source-compliance-matrix.md
├── tests/
│   ├── integration/
│   └── e2e/
├── .env.example
└── README.md
```

Keep provider keys and database secrets in server-side environment
variables. Commit `.env.example`, never real `.env` files.

# 18. Core Engineering Design Details

## 18.1 Job source adapter contract

Each adapter should implement a common contract such as:

```ts
interface JobSourceAdapter {
  sourceName: string;
  search(criteria: SearchCriteria): Promise<RawJob[]>;
  normalize(raw: RawJob): NormalizedJob;
  healthCheck(): Promise<SourceHealth>;
}
```

Adapters should also expose rate-limit configuration, terms-review
status, supported markets, and last successful run. Keep source-specific
parsing out of the matching service.

## 18.2 Resume generation pipeline

1.  Parse the base resume.
2.  Ask the user to verify extracted facts.
3.  Store facts with evidence references.
4.  Parse job requirements into required/preferred criteria.
5.  Select relevant verified facts.
6.  Ask the LLM to rewrite and order only those facts.
7.  Validate generated claims against evidence.
8.  Reject or flag unsupported claims.
9.  Render document.
10. Show diff and ask the user to approve the resume.

Use structured JSON output and schema validation. Treat job descriptions
and uploaded files as untrusted content; ignore any instructions
embedded in them that attempt to change system behavior.

## 18.3 Approval state machine

```text
DRAFT
  |
  v
READY_FOR_REVIEW
  |
  +---- user edits ----> DRAFT (new package version)
  |
  v
PENDING_APPROVAL
  |
  +---- reject -------> REJECTED
  |
  +---- approve ------> APPROVED
                           |
                           v
                    SUBMISSION_PENDING
                       /       \
                      v         v
                 SUBMITTED   FAILED
                      |
                      v
                CONFIRMATION_PENDING
```

A submission service must check, immediately before acting: -
authenticated user owns the package; - approval exists and is not
revoked; - approval hash equals current package hash; - job and
destination still match; - destination adapter is enabled and
permitted; - no successful submission already exists for the same
application.

## 18.4 Daily search execution

A scheduled run should: 1. Load active user preferences. 2. Build
source-specific search criteria. 3. Enqueue work per source to avoid
long blocking requests. 4. Respect source rate limits and backoff. 5.
Normalize and deduplicate results. 6. Recheck freshness/status where
supported. 7. Match and rank jobs. 8. Store a run summary. 9. Notify the
user only about new or materially changed matches.

Make scheduled jobs idempotent. Use a unique key based on user, source,
schedule window, and query version to prevent duplicate runs.

# 19. Testing Strategy

**Unit tests** - Hard filters and weighted score. - URL canonicalization
and duplicate detection. - Resume evidence validation. - Approval hash
and state transitions. - Timezone and schedule calculations.

**Integration tests** - Each source adapter using saved fixtures. -
Database authorization and ownership. - Queue retry and idempotency
behavior. - Document export. - Notification delivery.

**End-to-end tests** - New user onboarding. - Upload resume and verify
facts. - Run search and view ranked jobs. - Generate and edit tailored
resume. - Reject an application. - Approve a package and verify
submission path. - Pause daily search and delete account data.

**Safety tests** - Job description contains prompt-injection
instructions. - Resume parser extracts incorrect dates or skills. - LLM
invents metrics or certifications. - Package changes after approval. -
User clicks submit twice. - Job closes between discovery and
application. - Submission adapter returns an ambiguous response.

# 20. Deployment and Operations

For a cost-conscious MVP: - Frontend: Vercel or another managed
static/web host. - API: managed Node.js hosting with background-worker
support. - Database and object storage: managed PostgreSQL/Supabase. -
Scheduler/queue: managed scheduled jobs or PostgreSQL-backed queue
initially. - Email: transactional email provider. - Monitoring: error
tracking plus structured application logs.

Do not rely on a serverless function with a short execution limit for
long-running source searches. Use a worker or queue. Keep secrets
server-side, configure database backups, and test restore procedures
before public launch.

# 21. Initial Backlog and Build Order

**Sprint 1** - \[ \] Repo, frontend, API, database, migrations. - \[ \]
Authentication and user ownership. - \[ \] Candidate profile and
preference schema. - \[ \] Basic onboarding UI.

**Sprint 2** - \[ \] Resume upload and parsing. - \[ \] Fact
verification UI. - \[ \] Job source adapter interface. - \[ \] First
compliant source integration.

**Sprint 3** - \[ \] Additional source integrations. - \[ \]
Normalization and deduplication. - \[ \] Search-run history. - \[ \] Job
feed and detail page.

**Sprint 4** - \[ \] Hard filters and match scoring. - \[ \] Daily
scheduler and worker. - \[ \] Digest notifications. - \[ \] Feedback
controls.

**Sprint 5** - \[ \] Job requirement extraction. - \[ \]
Evidence-grounded resume generation. - \[ \] Claim validation and change
log. - \[ \] Resume preview and export.

**Sprint 6** - \[ \] Application package and review. - \[ \] Approval
state machine. - \[ \] Manual application handoff. - \[ \] Application
tracker and audit log.

**Sprint 7** - \[ \] End-to-end and safety tests. - \[ \] Pilot feedback
and fixes. - \[ \] Monitoring, backups, privacy controls. - \[ \] MVP
launch.

# 22. Decisions Required Before Development

These choices affect source integrations, scoring, and launch scope. The
product should make them configurable, but the first build needs
defaults.

1.  **Launch market:** Which country/countries and cities should be
    supported first? Should remote roles be worldwide or limited to
    specified regions?
2.  **Target roles:** Which job families and seniority levels are in
    scope?
3.  **Sources:** Which job boards, company career pages, and
    public-sector portals matter most?
4.  **Application mode:** Should the MVP only prepare documents and hand
    the user to the official application page, or include selected
    permitted submission integrations?
5.  **Notifications:** In-app, email, or both?
6.  **Resume format:** PDF only, or PDF and DOCX?
7.  **Hosting and budget:** Which services and monthly budget are
    acceptable?

## Recommended first-build defaults

For a student/early-career launch, start with one clearly defined market
and a narrow role set (internships, graduate programmes, and junior
roles). Include remote roles only where the listing explicitly states
eligible regions. Start with three compliant sources, daily email/in-app
digest, PDF + DOCX resume export, and manual application handoff. Add
automated submission only after the source's rules and technical
reliability are confirmed.

# 23. Definition of Done

The product is done for MVP when a real user can configure a market,
receive a daily list of relevant and deduplicated vacancies, understand
why each job was recommended, generate a truthful job-specific resume,
review all changes, explicitly approve an exact application package, and
either submit through a permitted integration or complete the
application manually. Every step must be visible, reversible where
practical, and recorded in an audit trail.

---

**End of document**
