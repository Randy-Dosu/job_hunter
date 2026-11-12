/**
 * Relational schema for Job Hunter (SQLite).
 *
 * Every user-owned row carries `user_id`; all reads go through helpers that
 * take the authenticated user id, which keeps cross-user access impossible
 * by construction (see lib/db/index.ts).
 */
export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  headline TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  links_json TEXT NOT NULL DEFAULT '[]',
  work_authorization TEXT NOT NULL DEFAULT '',
  needs_sponsorship INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_evidence (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL,              -- experience | education | skill | certification | achievement
  title TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  end_date TEXT,
  bullets_json TEXT NOT NULL DEFAULT '[]',
  skills_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT '',       -- for skills: professional | learning | none
  verification_status TEXT NOT NULL DEFAULT 'unverified', -- verified | unverified | outdated
  source_document_id TEXT,
  evidence_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_user ON profile_evidence(user_id);

CREATE TABLE IF NOT EXISTS job_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  countries_json TEXT NOT NULL DEFAULT '[]',
  cities_json TEXT NOT NULL DEFAULT '[]',
  remote_preference TEXT NOT NULL DEFAULT 'remote',      -- remote | hybrid | onsite | any
  remote_regions_json TEXT NOT NULL DEFAULT '[]',
  role_titles_json TEXT NOT NULL DEFAULT '[]',
  role_families_json TEXT NOT NULL DEFAULT '[]',
  seniority_json TEXT NOT NULL DEFAULT '[]',
  job_types_json TEXT NOT NULL DEFAULT '[]',
  industries_json TEXT NOT NULL DEFAULT '[]',
  excluded_employers_json TEXT NOT NULL DEFAULT '[]',
  excluded_keywords_json TEXT NOT NULL DEFAULT '[]',
  excluded_locations_json TEXT NOT NULL DEFAULT '[]',
  salary_floor INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  language TEXT NOT NULL DEFAULT 'en',
  work_authorization TEXT NOT NULL DEFAULT '',
  needs_sponsorship INTEGER NOT NULL DEFAULT 0,
  days_of_week_json TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  search_time TEXT NOT NULL DEFAULT '07:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  notify_email INTEGER NOT NULL DEFAULT 1,
  notify_in_app INTEGER NOT NULL DEFAULT 1,
  schedule_enabled INTEGER NOT NULL DEFAULT 1,
  enabled_source_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resume_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  content_text TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_base INTEGER NOT NULL DEFAULT 1,
  parse_status TEXT NOT NULL DEFAULT 'parsed',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  access_method TEXT NOT NULL,
  terms_url TEXT NOT NULL,
  terms_reviewed_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  rate_limit_config_json TEXT NOT NULL DEFAULT '{}',
  supported_markets TEXT NOT NULL DEFAULT 'global',
  notes TEXT NOT NULL DEFAULT '',
  last_run_at TEXT,
  last_status TEXT
);

CREATE TABLE IF NOT EXISTS search_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'manual',    -- manual | scheduled
  run_key TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',    -- running | completed | partial | failed
  query_config_json TEXT NOT NULL DEFAULT '{}',
  counts_json TEXT NOT NULL DEFAULT '{}',
  error_summary TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_key ON search_runs(run_key) WHERE run_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runs_user ON search_runs(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES job_sources(id),
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  application_url TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  remote_policy TEXT NOT NULL DEFAULT 'unknown',  -- remote | hybrid | onsite | unknown
  description TEXT NOT NULL DEFAULT '',
  responsibilities TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  salary TEXT,
  employment_type TEXT NOT NULL DEFAULT 'unknown',
  seniority TEXT NOT NULL DEFAULT 'unknown',
  posted_at TEXT,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'open',            -- open | closed | uncertain
  status_checked_at TEXT,
  content_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs(fingerprint);
CREATE INDEX IF NOT EXISTS idx_jobs_posted ON jobs(posted_at DESC);

CREATE TABLE IF NOT EXISTS job_matches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'possible',  -- strong | possible | low | excluded
  reasons_json TEXT NOT NULL DEFAULT '[]',
  gaps_json TEXT NOT NULL DEFAULT '[]',
  components_json TEXT NOT NULL DEFAULT '[]',
  feedback TEXT,
  matched_at TEXT NOT NULL,
  UNIQUE(user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_user ON job_matches(user_id, score DESC);

CREATE TABLE IF NOT EXISTS tailored_resumes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  base_resume_id TEXT,
  structured_content_json TEXT NOT NULL,
  change_log_json TEXT NOT NULL DEFAULT '[]',
  unsupported_json TEXT NOT NULL DEFAULT '[]',
  model_metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | user_approved | superseded
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS application_packages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_id TEXT REFERENCES tailored_resumes(id),
  cover_letter TEXT NOT NULL DEFAULT '',
  answers_json TEXT NOT NULL DEFAULT '[]',
  destination_url TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS application_approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL REFERENCES application_packages(id) ON DELETE CASCADE,
  approval_hash TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  approval_method TEXT NOT NULL DEFAULT 'explicit_click',
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  package_id TEXT,
  status TEXT NOT NULL DEFAULT 'preparing',
  submitted_at TEXT,
  confirmation_reference TEXT,
  last_updated_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_at TEXT,
  UNIQUE(user_id, job_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id, created_at DESC);
`;
