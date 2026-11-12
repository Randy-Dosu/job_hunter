import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "@/lib/password";

const DEMO_EMAIL = "demo@jobhunter.app";
const DEMO_PASSWORD = "hunter1234";

const NOW = () => new Date().toISOString();

function demoEvidence(userId: string) {
  const facts = [
    {
      id: crypto.randomUUID(),
      user_id: userId,
      fact_type: "skill",
      title: "TypeScript",
      organization: "",
      location: "",
      start_date: null as string | null,
      end_date: null as string | null,
      bullets_json: JSON.stringify([]),
      skills_json: JSON.stringify([]),
      state: "professional",
      verification_status: "verified",
      source_document_id: null as string | null,
      evidence_note: "Used daily in the Kumasi Tech Hub internship and freelance client work.",
    },
    ...["JavaScript", "React", "Next.js", "Node.js", "REST APIs", "HTML", "CSS", "Tailwind CSS", "Git", "SQL", "PostgreSQL"].map((skill) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      fact_type: "skill",
      title: skill,
      organization: "",
      location: "",
      start_date: null as string | null,
      end_date: null as string | null,
      bullets_json: JSON.stringify([]),
      skills_json: JSON.stringify([]),
      state: "professional",
      verification_status: "verified",
      source_document_id: null as string | null,
      evidence_note: "Appears in your base resume and project work.",
    })),
    ...["Python", "Docker", "Linux", "Automated testing"].map((skill) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      fact_type: "skill",
      title: skill,
      organization: "",
      location: "",
      start_date: null as string | null,
      end_date: null as string | null,
      bullets_json: JSON.stringify([]),
      skills_json: JSON.stringify([]),
      state: "learning",
      verification_status: "verified",
      source_document_id: null as string | null,
      evidence_note: "Self-study only. Not used in a professional role — the agent must not present this as experience.",
    })),
    {
      id: crypto.randomUUID(),
      user_id: userId,
      fact_type: "experience",
      title: "Frontend Developer (Freelance)",
      organization: "Self-employed",
      location: "Kumasi, Ghana (remote)",
      start_date: "2024-09",
      end_date: null,
      bullets_json: JSON.stringify([
        "Built React and TypeScript dashboards for three small businesses, each with its own admin view.",
        "Turned Figma designs into responsive Tailwind CSS components with keyboard navigation.",
        "Integrated REST APIs and handled loading, empty and error states.",
        "Raised a client storefront's Lighthouse performance score from 68 to 94.",
      ]),
      skills_json: JSON.stringify(["TypeScript", "React", "Tailwind CSS", "REST APIs"]),
      state: "",
      verification_status: "verified",
      source_document_id: null,
      evidence_note: "Confirmed against your portfolio and client invoices.",
    },
    {
      id: crypto.randomUUID(),
      user_id: userId,
      fact_type: "experience",
      title: "Software Engineering Intern",
      organization: "Kumasi Tech Hub",
      location: "Kumasi, Ghana",
      start_date: "2025-06",
      end_date: "2025-09",
      bullets_json: JSON.stringify([
        "Wrote TypeScript services on Node.js that powered the hub's member portal.",
        "Added SQL reporting queries used in the weekly programme review.",
        "Fixed accessibility issues found in a WCAG audit of the booking flow.",
        "Wrote unit tests with Vitest for the membership renewal logic.",
      ]),
      skills_json: JSON.stringify(["TypeScript", "Node.js", "SQL", "PostgreSQL"]),
      state: "",
      verification_status: "verified",
      source_document_id: null,
      evidence_note: "Confirmed by your internship supervisor's reference letter.",
    },
    {
      id: crypto.randomUUID(),
      user_id: userId,
      fact_type: "education",
      title: "BSc Computer Science",
      organization: "Kwame Nkrumah University of Science and Technology",
      location: "Kumasi, Ghana",
      start_date: "2021-09",
      end_date: "2025-07",
      bullets_json: JSON.stringify([
        "Second Class Upper Honours.",
        "Coursework: databases, algorithms, human-computer interaction.",
      ]),
      skills_json: JSON.stringify([]),
      state: "",
      verification_status: "verified",
      source_document_id: null,
      evidence_note: "Transcript on file.",
    },
    {
      id: crypto.randomUUID(),
      user_id: userId,
      fact_type: "certification",
      title: "Meta Front-End Developer Certificate",
      organization: "Coursera",
      location: "Online",
      start_date: "2024-02",
      end_date: "2024-08",
      bullets_json: JSON.stringify(["Nine-course programme covering React, responsive design and version control."]),
      skills_json: JSON.stringify(["React", "JavaScript"]),
      state: "",
      verification_status: "verified",
      source_document_id: null,
      evidence_note: "Certificate credential link stored in your profile links.",
    },
    {
      id: crypto.randomUUID(),
      user_id: userId,
      fact_type: "achievement",
      title: "Winner — KNUST Hackathon 2024",
      organization: "KNUST Computer Science Society",
      location: "Kumasi, Ghana",
      start_date: "2024-11",
      end_date: null,
      bullets_json: JSON.stringify([
        "Built a clinic queue management app with a React frontend and Node.js API in 36 hours.",
      ]),
      skills_json: JSON.stringify(["React", "Node.js"]),
      state: "",
      verification_status: "verified",
      source_document_id: null,
      evidence_note: "Event certificate on file.",
    },
  ];
  return facts;
}

export const DEMO_CREDENTIALS = { email: DEMO_EMAIL, password: DEMO_PASSWORD };

const BASE_RESUME = `AMA SERWAA
Kumasi, Ghana · ama.serwaa@example.com · github.com/amaserwaa · linkedin.com/in/amaserwaa

SUMMARY
Computer science graduate building web applications with TypeScript, React and Node.js. Two years of
freelance delivery for small businesses plus a software engineering internship at Kumasi Tech Hub.

EXPERIENCE
Frontend Developer (Freelance) — Self-employed, Kumasi, Ghana (Sep 2024 – Present)
- Built React and TypeScript dashboards for three small businesses, each with its own admin view.
- Turned Figma designs into responsive Tailwind CSS components with keyboard navigation.
- Integrated REST APIs and handled loading, empty and error states.
- Raised a client storefront's Lighthouse performance score from 68 to 94.

Software Engineering Intern — Kumasi Tech Hub, Kumasi, Ghana (Jun 2025 – Sep 2025)
- Wrote TypeScript services on Node.js that powered the hub's member portal.
- Added SQL reporting queries used in the weekly programme review.
- Fixed accessibility issues found in a WCAG audit of the booking flow.
- Wrote unit tests with Vitest for the membership renewal logic.

EDUCATION
BSc Computer Science — Kwame Nkrumah University of Science and Technology, Kumasi (2021 – 2025)
Second Class Upper Honours. Coursework: databases, algorithms, human-computer interaction.

CERTIFICATION
Meta Front-End Developer Certificate — Coursera (Feb 2024 – Aug 2024)

PROJECTS & ACHIEVEMENTS
Winner, KNUST Hackathon 2024 — clinic queue management app (React + Node.js) built in 36 hours.

SKILLS
TypeScript, JavaScript, React, Next.js, Node.js, REST APIs, HTML, CSS, Tailwind CSS, Git, SQL, PostgreSQL
Learning: Python, Docker, Linux, automated testing`;

/** Idempotent seed: only runs when the database has no users yet. */
export function seedIfEmpty(db: DatabaseSync) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (existing.count > 0) return;

  const now = NOW();
  const userId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const prefsId = crypto.randomUUID();
  const resumeId = crypto.randomUUID();

  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      userId,
      DEMO_EMAIL,
      "Ama Serwaa",
      hashPassword(DEMO_PASSWORD),
      "admin",
      now,
    );

    db.prepare(
      `INSERT INTO candidate_profiles (id, user_id, headline, summary, location, phone, links_json, work_authorization, needs_sponsorship, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      profileId,
      userId,
      "Junior software developer — React, TypeScript, Node.js",
      "Computer science graduate from KNUST. I build accessible web applications with TypeScript, React and Node.js, and I am looking for a remote junior or graduate engineering role where I can keep learning.",
      "Kumasi, Ghana",
      "+233 24 000 0000",
      JSON.stringify([
        { label: "GitHub", url: "https://github.com/amaserwaa" },
        { label: "LinkedIn", url: "https://linkedin.com/in/amaserwaa" },
      ]),
      "Ghana — authorised to work remotely; requires sponsorship for on-site roles abroad",
      0,
      "Africa/Accra",
      now,
      now,
    );

    const insertEvidence = db.prepare(
      `INSERT INTO profile_evidence (id, user_id, fact_type, title, organization, location, start_date, end_date,
        bullets_json, skills_json, state, verification_status, source_document_id, evidence_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const fact of demoEvidence(userId)) {
      insertEvidence.run(
        fact.id,
        userId,
        fact.fact_type,
        fact.title,
        fact.organization,
        fact.location,
        fact.start_date,
        fact.end_date,
        fact.bullets_json,
        fact.skills_json,
        fact.state,
        fact.verification_status,
        resumeId,
        fact.evidence_note,
        now,
        now,
      );
    }

    db.prepare(
      `INSERT INTO job_preferences (id, user_id, countries_json, cities_json, remote_preference, remote_regions_json,
        role_titles_json, role_families_json, seniority_json, job_types_json, industries_json, excluded_employers_json,
        excluded_keywords_json, excluded_locations_json, salary_floor, currency, language, work_authorization,
        needs_sponsorship, days_of_week_json, search_time, timezone, notify_email, notify_in_app, schedule_enabled,
        enabled_source_ids_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      prefsId,
      userId,
      JSON.stringify(["Ghana", "Worldwide"]),
      JSON.stringify(["Kumasi", "Accra"]),
      "remote",
      JSON.stringify(["Worldwide"]),
      JSON.stringify(["Frontend Developer", "Full Stack Developer", "Software Engineer", "React Developer"]),
      JSON.stringify(["Software Development", "Web Development"]),
      JSON.stringify([]),
      JSON.stringify(["full-time", "contract", "internship"]),
      JSON.stringify(["Software", "Technology", "Design"]),
      JSON.stringify([]),
      JSON.stringify(["unpaid", "commission only"]),
      JSON.stringify([]),
      24000,
      "USD",
      "en",
      "Ghana",
      0,
      JSON.stringify([1, 2, 3, 4, 5]),
      "07:00",
      "Africa/Accra",
      1,
      1,
      1,
      JSON.stringify([]),
      now,
    );

    const insertSource = db.prepare(
      `INSERT INTO job_sources (id, name, slug, source_type, access_method, terms_url, terms_reviewed_at, enabled,
        rate_limit_config_json, supported_markets, notes, last_run_at, last_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const sources = [
      {
        name: "Remotive",
        slug: "remotive",
        type: "public_api",
        access: "Public JSON API (no key)",
        terms: "https://remotive.com/api/remote-jobs",
        markets: "Global remote",
        notes: "Attribution required. Rate limited to one request per hour per IP in our configuration.",
        rate: { maxRequestsPerHour: 4, timeoutMs: 8000 },
      },
      {
        name: "Arbeitnow",
        slug: "arbeitnow",
        type: "public_feed",
        access: "Public job-board API (no key)",
        terms: "https://www.arbeitnow.com/api/job-board-api",
        markets: "Europe, global remote",
        notes: "Free public API for job aggregation. Pagination supported.",
        rate: { maxRequestsPerHour: 6, timeoutMs: 8000 },
      },
      {
        name: "Manual import",
        slug: "manual",
        type: "user_supplied",
        access: "Single URL pasted by the user",
        terms: "https://jobhunter.app/terms/manual-import",
        markets: "Any",
        notes:
          "User-supplied link. Fetched once, politely, with no login, no CAPTCHA handling and no bypass of access controls. The user is responsible for the terms of the site they paste.",
        rate: { maxRequestsPerDay: 20, timeoutMs: 8000 },
      },
      {
        name: "Remote OK",
        slug: "remoteok",
        type: "public_feed",
        access: "Public RSS/JSON feed with attribution",
        terms: "https://remoteok.com/api",
        markets: "Global remote",
        notes: "Requires visible attribution and a link back to the original listing.",
        rate: { maxRequestsPerHour: 4, timeoutMs: 8000 },
      },
    ];
    for (const source of sources) {
      insertSource.run(
        crypto.randomUUID(),
        source.name,
        source.slug,
        source.type,
        source.access,
        source.terms,
        now,
        1,
        JSON.stringify(source.rate),
        source.markets,
        source.notes,
        null,
        null,
      );
    }

    db.prepare(
      `INSERT INTO resume_documents (id, user_id, filename, file_type, content_text, version, is_base, parse_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(resumeId, userId, "ama-serwaa-base-resume.txt", "text/plain", BASE_RESUME, 1, 1, "parsed", now);

    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, payload_json, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      userId,
      "welcome",
      "Your daily search is ready to run",
      "We found your verified profile facts. Run the first search to pull today's vacancies from Remotive, Arbeitnow and Remote OK.",
      JSON.stringify({ href: "/dashboard" }),
      null,
      now,
    );

    db.prepare(
      `INSERT INTO audit_events (id, user_id, actor, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      userId,
      "system",
      "account.seeded",
      "user",
      userId,
      JSON.stringify({ sources: sources.map((s) => s.slug), facts: 25 }),
      now,
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
