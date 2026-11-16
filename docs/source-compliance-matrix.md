# Source compliance matrix

_Last reviewed: 12 November 2026. Re-review before adding a source or changing rate
limits. This document is a build artefact, not legal advice._

| Source | Type | Access method | Endpoint | Terms / attribution | Rate limit in code | Markets | Fields used | Enabled |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Remotive | Public API | Unauthenticated JSON `GET` | `https://remotive.com/api/remote-jobs?limit=100` | Public API, attribution to Remotive + link to original listing | 4 req/hour, 8s timeout | Global remote | id, url, title, company_name, description, job_type, publication_date, candidate_required_location, salary | Yes |
| Arbeitnow | Public feed | Unauthenticated JSON `GET` | `https://www.arbeitnow.com/api/job-board-api` | Free public job-board API intended for aggregation | 6 req/hour, 8s timeout | Europe + global remote | slug, url, title, company_name, description, remote, tags, job_types, location, created_at | Yes |
| Remote OK | Public feed | Unauthenticated JSON `GET` | `https://remoteok.com/api` | Requires visible attribution and a link back to the listing | 4 req/hour, 8s timeout | Global remote | id, slug, position, company, description, location, salary_min/max, tags, date, url, apply_url | Yes |

## Rules applied to every adapter

1. **Access:** official API or documented feed first; public pages only where
   automated access is permitted. Never bypass a login, CAPTCHA, paywall or rate
   limit.
2. **Isolation:** one adapter per source, behind `JobSourceAdapter`. A failing or
   disabled source cannot break ingestion of the others.
3. **Attribution:** the job detail screen always shows the source name, the original
   canonical URL, the source id, first-seen and last-checked timestamps.
4. **Fallback:** when the network is unavailable, saved fixtures are used and every
   surface labels the run as fixture-backed. Fixture data is never presented as a
   live result.
5. **Disable path:** a source can be turned off in Settings, and `enabled=0` in
   `job_sources` removes it from the next run immediately.
6. **Retention:** only the fields needed for matching and provenance are stored;
   raw payloads are truncated to 20 KB.

## Not supported (deliberately)

- Sites whose terms prohibit automated collection.
- Any source requiring account credentials, CAPTCHA solving or anti-bot evasion.
- Automated form submission on employer sites. Applications use a manual handoff to
  the official application page.

## Review checklist for a new source

- [ ] Documented API or explicit permission for automated access
- [ ] Terms review date recorded in `job_sources.terms_reviewed_at`
- [ ] Rate limit and timeout configured
- [ ] Supported markets noted
- [ ] Field mapping implemented in the adapter's `parse()`
- [ ] Fixture captured for tests and offline preview
- [ ] Attribution requirements surfaced in the UI
- [ ] Failure mode verified (error surfaced, other sources unaffected)
