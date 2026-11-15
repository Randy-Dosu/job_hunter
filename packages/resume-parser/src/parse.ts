/**
 * Deterministic resume parser.
 *
 * Every extracted item becomes a *parsed fact* with `verified: false`. The user
 * confirms facts in the verification UI; only then can they be used as evidence
 * in matching or document generation. Nothing here invents information: if a
 * value cannot be found, it is left empty and a warning explains what to add.
 */

import type {
  CandidateProfileContent,
  ParsedFact,
  ParsedResumeResult,
} from '@job-hunter/shared-types';
import { EMPTY_PROFILE_CONTENT } from '@job-hunter/shared-types';

const SECTION_ALIASES: Record<string, string[]> = {
  summary: ['summary', 'profile', 'objective', 'about me', 'about', 'professional summary'],
  experience: [
    'experience',
    'work experience',
    'employment',
    'professional experience',
    'career history',
    'work history',
  ],
  education: ['education', 'academic background', 'qualifications', 'academic qualifications'],
  skills: [
    'skills',
    'technical skills',
    'core skills',
    'core competencies',
    'technologies',
    'tech stack',
    'expertise',
  ],
  projects: ['projects', 'personal projects', 'selected projects', 'portfolio'],
  certifications: [
    'certifications',
    'certificates',
    'licenses',
    'licences',
    'certifications & licenses',
  ],
  languages: ['languages', 'language skills'],
  awards: ['awards', 'achievements', 'honors', 'honours', 'accomplishments'],
  interests: ['interests', 'hobbies'],
  references: ['references'],
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const URL_RE = /https?:\/\/[^\s)<>]+/gi;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s)<>]+/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s)<>]+/i;
const DATE_RANGE_RE =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4}|\d{1,2}\/\d{4})\s*(?:-|–|—|to|until)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4}|\d{1,2}\/\d{4}|present|current|now|ongoing)/i;

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  sept: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** Max characters treated as the header (name/contact block). */
const HEADER_LINES = 12;

export interface ParseOptions {
  /** Used when the resume does not state a name/email. */
  fallbackName?: string | undefined;
  fallbackEmail?: string | undefined;
}

export function parseResumeText(text: string, options: ParseOptions = {}): ParsedResumeResult {
  const warnings: string[] = [];
  const facts: ParsedFact[] = [];
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, array) => !(line === '' && array[index - 1] === ''));

  const header = lines.slice(0, HEADER_LINES).join('\n');
  const fullName = findName(lines) ?? options.fallbackName ?? '';
  const email = header.match(EMAIL_RE)?.[0] ?? options.fallbackEmail ?? '';
  const phone = header.match(PHONE_RE)?.[0]?.trim();
  const linkedin = header.match(LINKEDIN_RE)?.[0];
  const github = header.match(GITHUB_RE)?.[0];
  const website = (header.match(URL_RE) ?? []).find(
    (url) => !/linkedin\.com|github\.com/i.test(url),
  );

  if (!fullName)
    warnings.push('We could not find your name at the top of the resume. Please add it.');
  if (!email)
    warnings.push(
      'We could not find an email address. Please add one so applications can be sent.',
    );
  if (!phone) warnings.push('No phone number was found. Add one if you want it on applications.');

  const sections = splitSections(lines);

  const summary = sections.summary?.join('\n').trim() || undefined;
  const skills = extractSkills(sections.skills ?? []);
  const experience = extractExperience(sections.experience ?? []);
  const education = extractEducation(sections.education ?? []);
  const projects = extractProjects(sections.projects ?? []);
  const certifications = extractCertifications(sections.certifications ?? []);
  const languages = extractLanguages(sections.languages ?? []);

  if (skills.length === 0)
    warnings.push('No skills section was detected. Add your key skills to improve matching.');
  if (experience.length === 0)
    warnings.push('No work experience was detected. Add roles so your experience can be scored.');

  const content: CandidateProfileContent = {
    ...EMPTY_PROFILE_CONTENT,
    contact: {
      fullName,
      email,
      ...(phone ? { phone } : {}),
      ...(linkedin ? { linkedin: normaliseUrl(linkedin) } : {}),
      ...(github ? { github: normaliseUrl(github) } : {}),
      ...(website ? { website: website.replace(/[.,;]$/, '') } : {}),
    },
    ...(summary ? { summary } : {}),
    skills,
    experience,
    education,
    projects,
    certifications,
    languages,
  };

  // ------------------------------------------------------------- facts
  // Contact facts are not "claims" and are not verified as skills; we record
  // them so the assistant can map form fields without touching anything else.
  for (const skill of skills) {
    facts.push({
      kind: 'skill',
      label: skill,
      keywords: [skill.toLowerCase()],
      evidenceRef: 'resume:skills',
    });
  }
  for (const role of experience) {
    facts.push({
      kind: 'experience',
      label: `${role.title} at ${role.company}`,
      detail: role.bullets.join(' '),
      keywords: (role.keywords ?? []).map((keyword) => keyword.toLowerCase()),
      organisation: role.company,
      role: role.title,
      ...(role.startDate ? { startDate: role.startDate } : {}),
      ...(role.endDate ? { endDate: role.endDate } : {}),
      evidenceRef: `resume:experience:${role.company}`,
    });
  }
  for (const entry of education) {
    facts.push({
      kind: 'education',
      label: [entry.degree, entry.field, entry.institution].filter(Boolean).join(', '),
      ...(entry.institution ? { organisation: entry.institution } : {}),
      keywords: [entry.institution, entry.degree, entry.field].filter((value): value is string =>
        Boolean(value),
      ),
      ...(entry.endDate ? { endDate: entry.endDate } : {}),
      evidenceRef: 'resume:education',
    });
  }
  for (const project of projects) {
    facts.push({
      kind: 'project',
      label: project.name,
      detail: project.description,
      keywords: (project.keywords ?? []).map((keyword) => keyword.toLowerCase()),
      evidenceRef: `resume:project:${project.name}`,
    });
  }
  for (const cert of certifications) {
    facts.push({
      kind: 'certification',
      label: cert.name,
      ...(cert.issuer ? { organisation: cert.issuer } : {}),
      keywords: [cert.name, cert.issuer].filter((value): value is string => Boolean(value)),
      evidenceRef: 'resume:certifications',
    });
  }
  for (const language of languages) {
    facts.push({
      kind: 'language',
      label: language,
      keywords: [language.toLowerCase()],
      evidenceRef: 'resume:languages',
    });
  }
  if (summary) {
    facts.push({
      kind: 'summary',
      label: 'Professional summary',
      detail: summary,
      keywords: [],
      evidenceRef: 'resume:summary',
    });
  }

  if (facts.length === 0) {
    warnings.push('No verifiable facts were found. You can add them manually in your profile.');
  }

  return { content, facts, warnings, textLength: text.length };
}

/** Identify section boundaries by matching heading-like lines. */
export function splitSections(lines: string[]): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current = 'header';
  sections[current] = [];

  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading) {
      current = heading;
      sections[current] = sections[current] ?? [];
      continue;
    }
    sections[current]?.push(line);
  }
  return sections;
}

function matchHeading(line: string): string | undefined {
  const cleaned = line.replace(/[:•●▪|]+$/g, '').trim();
  if (cleaned.length === 0 || cleaned.length > 40) return undefined;
  const lower = cleaned.toLowerCase();
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(lower)) return key;
  }
  // Allow "SKILLS & TOOLS", "TECHNICAL SKILLS:" style headings.
  const withoutDecor = lower
    .replace(/[^a-z& ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (
      aliases.some(
        (alias) =>
          withoutDecor === alias ||
          withoutDecor.startsWith(`${alias} `) ||
          withoutDecor.endsWith(` ${alias}`),
      )
    ) {
      return key;
    }
  }
  return undefined;
}

function findName(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 4)) {
    const candidate = line.trim();
    if (!candidate) continue;
    if (EMAIL_RE.test(candidate) || PHONE_RE.test(candidate) || /https?:\/\//i.test(candidate))
      continue;
    // A name is 2-4 capitalised/latin words, no digits, no section keyword.
    const words = candidate.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (/\d/.test(candidate) || candidate.length > 60) continue;
    if (matchHeading(candidate)) continue;
    if (words.every((word) => /^[A-Z][A-Za-z'’.-]{0,24}$/.test(word) || /^[A-Z]{2,}$/.test(word))) {
      return candidate;
    }
    // Accept "AKOSUA MENSAH" (already upper) and "Akosua Mensah".
    if (/^[A-Za-z'’.-]+(\s+[A-Za-z'’.-]+){1,3}$/.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Split a line into skills, handling "A • B", "A, B", "A; B", "A | B". */
export function extractSkills(sectionLines: string[]): string[] {
  const skills = new Set<string>();
  for (const line of sectionLines) {
    const withoutLabel = line.replace(/^[A-Za-z /&]{2,30}:\s*/, '');
    for (const raw of withoutLabel.split(/[,;•●|]/)) {
      const skill = raw.replace(/^[-–—\s]+|[-.\s]+$/g, '').trim();
      if (skill.length < 2 || skill.length > 40) continue;
      if (/^\d+(\.\d+)?$/.test(skill)) continue;
      skills.add(skill);
    }
  }
  return [...skills].slice(0, 80);
}

export function extractExperience(sectionLines: string[]): CandidateProfileContent['experience'] {
  const entries: CandidateProfileContent['experience'] = [];
  let current: CandidateProfileContent['experience'][number] | undefined;

  for (const line of sectionLines) {
    const bullets = splitBullets(line);
    if (bullets.length > 0) {
      if (current) current.bullets.push(...bullets);
      continue;
    }
    if (!line.trim()) continue;

    const range = line.match(DATE_RANGE_RE);
    if (range) {
      const startDate = parseDateToIsoMonth(range[1] ?? '');
      const endRaw = (range[2] ?? '').toLowerCase();
      const current_role = /present|current|now|ongoing/.test(endRaw);
      const endDate = current_role ? undefined : parseDateToIsoMonth(range[2] ?? '');
      const titlePart = line
        .slice(0, range.index)
        .replace(/[|@,–—-]+\s*$/, '')
        .trim();
      const afterRange = line
        .slice((range.index ?? 0) + range[0].length)
        .replace(/^[|\-–—,\s]+/, '')
        .trim();

      const parsed = parseTitleCompany(titlePart, afterRange);
      if (current) entries.push(current);
      current = {
        company: parsed.company ?? afterRange ?? 'Unknown company',
        title: parsed.title ?? titlePart ?? 'Unknown role',
        ...(startDate ? { startDate } : {}),
        ...(endRaw ? (current_role ? { current: true } : endDate ? { endDate } : {}) : {}),
        bullets: [],
        keywords: [],
      };
      continue;
    }

    // "Title at Company" or "Title, Company"
    const atMatch = line.match(/^(.{2,80}?)\s+(?:at|@)\s+(.{2,80})$/i);
    if (atMatch && !current) {
      current = {
        title: cleanInline(atMatch[1] ?? ''),
        company: cleanInline(atMatch[2] ?? ''),
        bullets: [],
        keywords: [],
      };
      continue;
    }

    if (current) {
      // Continuation line: treat as an extra bullet.
      current.bullets.push(cleanInline(line));
    }
  }
  if (current) entries.push(current);

  return entries
    .filter((entry) => entry.title !== 'Unknown role' || entry.bullets.length > 0)
    .map((entry) => ({
      ...entry,
      company: entry.company === 'Unknown company' ? '' : entry.company,
      bullets: entry.bullets.filter((bullet) => bullet.length > 3).slice(0, 12),
      keywords: deriveKeywords(entry.bullets.join(' ')),
    }))
    .filter((entry) => entry.company.length > 0 || entry.bullets.length > 0)
    .slice(0, 15);
}

function parseTitleCompany(
  titlePart: string,
  afterRange: string,
): { title?: string; company?: string } {
  const atMatch = titlePart.match(/^(.{2,80}?)\s+(?:at|@|,)\s+(.{2,80})$/i);
  if (atMatch) {
    return { title: cleanInline(atMatch[1] ?? ''), company: cleanInline(atMatch[2] ?? '') };
  }
  // Common layout: "Company — Title"
  const dashSplit = titlePart.split(/\s*[—–|]\s*/);
  if (dashSplit.length === 2) {
    return { title: cleanInline(dashSplit[1] ?? ''), company: cleanInline(dashSplit[0] ?? '') };
  }
  return {
    ...(titlePart.length > 0 ? { title: cleanInline(titlePart) } : {}),
    ...(afterRange.length > 0 && afterRange.length < 60
      ? { company: cleanInline(afterRange) }
      : {}),
  };
}

export function extractEducation(sectionLines: string[]): CandidateProfileContent['education'] {
  const entries: CandidateProfileContent['education'] = [];
  for (const line of sectionLines) {
    if (!line.trim()) continue;
    const range = line.match(/(\d{4})\s*(?:-|–|—|to)\s*(\d{4}|present)/i);
    const year = line.match(/\b(19|20)\d{2}\b/);
    const parts = line
      .split(/\s*[,|—–]\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    const institution =
      parts.find((part) => /universit|college|institute|school|polytechnic|academy/i.test(part)) ??
      parts[0] ??
      '';
    if (!institution) continue;
    const degreePart = parts.find((part) =>
      /bachelor|master|b\.?sc|m\.?sc|phd|mba|diploma|hnd|degree|associate/i.test(part),
    );
    const endDate =
      range?.[2] && !/present/i.test(range[2])
        ? `${range[2]}-01`
        : year?.[0]
          ? `${year[0]}-01`
          : undefined;
    entries.push({
      institution: cleanInline(institution),
      ...(degreePart ? { degree: cleanInline(degreePart) } : {}),
      ...(endDate ? { endDate } : {}),
    });
  }
  return entries.slice(0, 10);
}

export function extractProjects(sectionLines: string[]): CandidateProfileContent['projects'] {
  const projects: CandidateProfileContent['projects'] = [];
  let current: CandidateProfileContent['projects'][number] | undefined;

  for (const line of sectionLines) {
    if (!line.trim()) continue;
    const bullets = splitBullets(line);
    if (bullets.length > 0) {
      if (current) current.description = `${current.description} ${bullets.join(' ')}`.trim();
      continue;
    }
    // A new project starts when the line is a heading-ish line without a bullet.
    if (line.length <= 80 && !/^[-–—]/.test(line)) {
      if (current) projects.push(current);
      const [name, ...rest] = line.split(/\s*[—–:|]\s*/);
      current = {
        name: cleanInline(name ?? line).slice(0, 120),
        description: rest.join(' ').trim(),
        keywords: [],
      };
      continue;
    }
    if (current) current.description = `${current.description} ${line}`.trim();
  }
  if (current) projects.push(current);

  return projects
    .filter((project) => project.name.length > 1)
    .map((project) => ({
      ...project,
      description: project.description.slice(0, 1200),
      keywords: deriveKeywords(project.description),
    }))
    .slice(0, 10);
}

export function extractCertifications(
  sectionLines: string[],
): CandidateProfileContent['certifications'] {
  return sectionLines
    .flatMap((line) => line.split(/[,;•●|]/))
    .map((value) => cleanInline(value))
    .filter((value) => value.length > 2 && value.length < 160)
    .slice(0, 20)
    .map((name) => {
      const issuerMatch = name.match(
        /\b(aws|google|microsoft|azure|cisco|comptia|oracle|pmi|scrum\.?org|linux foundation|coursera|udemy)\b/i,
      );
      return { name, ...(issuerMatch?.[0] ? { issuer: issuerMatch[0] } : {}) };
    });
}

export function extractLanguages(sectionLines: string[]): string[] {
  return sectionLines
    .flatMap((line) => line.split(/[,;•●|]/))
    .map((value) =>
      cleanInline(value)
        .replace(/\s*[-–(].*$/, '')
        .trim(),
    )
    .filter((value) => value.length > 1 && value.length < 40)
    .slice(0, 10);
}

function splitBullets(line: string): string[] {
  if (/^\s*[•●▪◦‣*\-–—]\s+/.test(line)) {
    return [cleanInline(line.replace(/^\s*[•●▪◦‣*\-–—]\s+/, ''))].filter(
      (value) => value.length > 2,
    );
  }
  return [];
}

function cleanInline(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[•●▪◦‣*\-–—\s]+/, '')
    .replace(/[;,]\s*$/, '')
    .trim();
}

/** Convert "Jan 2020" / "03/2021" / "2022" into YYYY-MM. */
export function parseDateToIsoMonth(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  const monthYear = text.match(/([a-z]{3,9})\.?\s+(\d{4})/);
  if (monthYear?.[1] && monthYear[2]) {
    const key = monthYear[1].slice(0, 4) === 'sept' ? 'sept' : monthYear[1].slice(0, 3);
    const month = MONTHS[key];
    if (month) return `${monthYear[2]}-${month}`;
  }
  const slash = text.match(/(\d{1,2})\/(\d{4})/);
  if (slash?.[1] && slash[2]) {
    const month = slash[1].padStart(2, '0');
    if (Number(month) >= 1 && Number(month) <= 12) return `${slash[2]}-${month}`;
  }
  const yearOnly = text.match(/\b(19|20)\d{2}\b/);
  if (yearOnly?.[0]) return `${yearOnly[0]}-01`;
  return undefined;
}

function normaliseUrl(value: string): string {
  const trimmed = value.trim().replace(/[.,;]$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
}

/** Extract technology/domain keywords from bullet text for matching support. */
function deriveKeywords(text: string): string[] {
  const KNOWN = [
    'javascript',
    'typescript',
    'python',
    'java',
    'go',
    'rust',
    'c++',
    'c#',
    'php',
    'ruby',
    'kotlin',
    'swift',
    'react',
    'next.js',
    'vue',
    'angular',
    'node.js',
    'django',
    'flask',
    'fastapi',
    'spring',
    'laravel',
    'postgresql',
    'mysql',
    'mongodb',
    'redis',
    'graphql',
    'rest',
    'grpc',
    'kafka',
    'rabbitmq',
    'aws',
    'azure',
    'gcp',
    'docker',
    'kubernetes',
    'terraform',
    'ci/cd',
    'github actions',
    'jenkins',
    'sql',
    'excel',
    'tableau',
    'power bi',
    'pandas',
    'numpy',
    'pytorch',
    'tensorflow',
    'scikit-learn',
    'figma',
    'jira',
    'agile',
    'scrum',
    'seo',
    'salesforce',
    'quickbooks',
    'sap',
    'pmp',
  ];
  const lower = text.toLowerCase();
  return KNOWN.filter((keyword) => lower.includes(keyword));
}
