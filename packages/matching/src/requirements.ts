/** Extract structured requirements from a job description (deterministic). */

import type { RawJob } from '@job-hunter/shared-types';
import { normalizeText, tokenize } from './text.js';

export interface JobRequirementProfile {
  title: string;
  /** Canonicalised skill terms mentioned in the description/tags. */
  skills: string[];
  /** Phrases describing years of experience, e.g. "5+ years". */
  yearsRequired?: number | undefined;
  /** Education level keyword ("bachelor", "master", "phd") if present. */
  educationHint?: string | undefined;
  /** Certifications explicitly named. */
  certifications: string[];
  /** Full searchable text: title + tags + description. */
  text: string;
}

/**
 * Curated skill vocabulary. Kept intentionally explicit so that matching is
 * explainable and testable rather than relying on whatever an LLM noticed.
 * Terms are canonical keys after `canonicalSkill`-style normalisation.
 */
const SKILL_VOCABULARY: Record<string, string[]> = {
  javascript: ['javascript', 'js', 'ecmascript'],
  typescript: ['typescript', 'ts'],
  react: ['react', 'reactjs', 'react.js'],
  'next.js': ['nextjs', 'next.js'],
  'node.js': ['node', 'nodejs', 'node.js'],
  python: ['python', 'py'],
  django: ['django'],
  flask: ['flask'],
  fastapi: ['fastapi'],
  java: ['java', 'jvm', 'spring boot', 'spring'],
  kotlin: ['kotlin'],
  swift: ['swift', 'swiftui'],
  'c#': ['c#', 'csharp', '.net', 'dotnet', 'asp.net'],
  'c++': ['c++', 'cpp'],
  c: ['ansi c'],
  go: ['golang', 'go lang'],
  rust: ['rust'],
  ruby: ['ruby', 'rails', 'ruby on rails'],
  php: ['php', 'laravel'],
  sql: ['sql', 'mysql', 'postgresql', 'postgres', 'sqlite', 'mssql', 'oracle'],
  nosql: ['nosql', 'mongodb', 'dynamodb', 'cassandra', 'couchbase', 'firebase'],
  redis: ['redis'],
  graphql: ['graphql', 'apollo'],
  rest: ['rest', 'restful', 'rest api', 'rest apis'],
  grpc: ['grpc', 'protobuf'],
  aws: ['aws', 'amazon web services', 'ec2', 's3', 'lambda', 'eks', 'ecs'],
  azure: ['azure', 'microsoft azure'],
  gcp: ['gcp', 'google cloud', 'google cloud platform', 'bigquery'],
  docker: ['docker', 'containers', 'containerisation', 'containerization'],
  kubernetes: ['kubernetes', 'k8s', 'helm', 'eks', 'aks', 'gke'],
  terraform: ['terraform', 'pulumi', 'cloudformation', 'infrastructure as code', 'iac'],
  cicd: [
    'ci/cd',
    'cicd',
    'continuous integration',
    'github actions',
    'jenkins',
    'gitlab ci',
    'circleci',
  ],
  linux: ['linux', 'unix', 'bash', 'shell scripting'],
  git: ['git', 'github', 'gitlab', 'bitbucket', 'version control'],
  'html/css': ['html', 'html5', 'css', 'css3', 'sass', 'scss', 'tailwind', 'tailwindcss'],
  'machine learning': [
    'machine learning',
    'ml',
    'deep learning',
    'scikit-learn',
    'sklearn',
    'xgboost',
    'neural network',
    'neural networks',
  ],
  'ai/llm': [
    'llm',
    'llms',
    'large language model',
    'large language models',
    'genai',
    'generative ai',
    'openai',
    'langchain',
    'prompt engineering',
    'rag',
    'transformers',
  ],
  pytorch: ['pytorch', 'torch'],
  tensorflow: ['tensorflow', 'keras'],
  nlp: ['nlp', 'natural language processing', 'spacy', 'nltk'],
  'computer vision': ['computer vision', 'opencv', 'yolo', 'image segmentation'],
  'data analysis': ['data analysis', 'pandas', 'numpy', 'excel', 'spreadsheets', 'data analytics'],
  'data engineering': [
    'data engineering',
    'etl',
    'elt',
    'airflow',
    'dbt',
    'spark',
    'pyspark',
    'kafka',
    'databricks',
  ],
  'data visualization': [
    'tableau',
    'power bi',
    'powerbi',
    'looker',
    'data visualization',
    'data visualisation',
    'metabase',
  ],
  statistics: [
    'statistics',
    'statistical',
    'a/b testing',
    'ab testing',
    'hypothesis testing',
    'regression',
  ],
  cybersecurity: [
    'cybersecurity',
    'cyber security',
    'infosec',
    'security engineering',
    'penetration testing',
    'pentest',
    'soc',
    'siem',
    'vulnerability',
    'threat modeling',
    'threat modelling',
    'zero trust',
  ],
  'cloud security': ['cloud security', 'aws security', 'iam', 'identity and access management'],
  appsec: ['appsec', 'application security', 'secure coding', 'owasp'],
  devops: [
    'devops',
    'sre',
    'site reliability',
    'platform engineering',
    'observability',
    'prometheus',
    'grafana',
  ],
  'mobile development': ['mobile', 'android', 'ios', 'react native', 'flutter'],
  'qa/testing': [
    'qa',
    'testing',
    'test automation',
    'selenium',
    'cypress',
    'playwright',
    'jest',
    'pytest',
  ],
  'ui/ux': [
    'ui',
    'ux',
    'user experience',
    'user interface',
    'figma',
    'wireframing',
    'prototyping',
    'design system',
  ],
  'product management': [
    'product management',
    'product manager',
    'product owner',
    'roadmap',
    'product strategy',
    'prd',
    'backlog grooming',
  ],
  'project management': [
    'project management',
    'pmp',
    'scrum',
    'agile',
    'kanban',
    'jira',
    'stakeholder management',
  ],
  'business analysis': [
    'business analysis',
    'business analyst',
    'requirements gathering',
    'process mapping',
  ],
  salesforce: ['salesforce', 'crm', 'hubspot'],
  erp: ['erp', 'sap', 'netsuite', 'oracle erp'],
  'finance/accounting': [
    'accounting',
    'bookkeeping',
    'financial modeling',
    'financial modelling',
    'forecasting',
    'gaap',
    'ifrs',
    'audit',
    'payroll',
    'quickbooks',
    'reconciliation',
  ],
  marketing: [
    'marketing',
    'seo',
    'sem',
    'content marketing',
    'email marketing',
    'google analytics',
    'digital marketing',
    'social media',
    'copywriting',
    'growth marketing',
  ],
  sales: [
    'sales',
    'account executive',
    'business development',
    'lead generation',
    'b2b sales',
    'quota',
  ],
  'hr/recruiting': [
    'recruiting',
    'recruitment',
    'talent acquisition',
    'hr',
    'human resources',
    'people operations',
    'onboarding',
  ],
  'customer success': [
    'customer success',
    'customer support',
    'account management',
    'client success',
  ],
  operations: ['operations', 'logistics', 'supply chain', 'procurement', 'inventory management'],
  'engineering (mechanical)': [
    'mechanical engineering',
    'solidworks',
    'autocad',
    'havc',
    'hvac',
    'cad',
  ],
  'engineering (civil)': ['civil engineering', 'structural engineering', 'construction management'],
  'engineering (electrical)': [
    'electrical engineering',
    'pcb',
    'embedded systems',
    'firmware',
    'arduino',
    'raspberry pi',
  ],
  healthcare: ['nursing', 'clinical', 'patient care', 'medical coding', 'emr', 'epic systems'],
  legal: ['legal', 'contract review', 'compliance', 'gdpr', 'regulatory'],
  'education/training': ['teaching', 'curriculum', 'instructional design', 'training', 'tutoring'],
  'writing/editing': [
    'technical writing',
    'copy editing',
    'editing',
    'documentation',
    'content writing',
  ],
  communication: ['communication', 'presentation', 'public speaking', 'written communication'],
  leadership: ['leadership', 'mentoring', 'line management', 'people management', 'coaching'],
};

/** Flat lookup: canonical term -> the phrases that map to it. */
const SKILL_ALIASES: Array<{ canonical: string; alias: string }> = Object.entries(
  SKILL_VOCABULARY,
).flatMap(([canonical, aliases]) => [
  { canonical, alias: canonical },
  ...aliases.map((alias) => ({ canonical, alias })),
]);

const CERTIFICATION_PATTERNS = [
  'aws certified',
  'azure certified',
  'google cloud certified',
  'cissp',
  'cism',
  'cisa',
  'comptia security+',
  'security+',
  'ccna',
  'ccnp',
  'pmp',
  'prince2',
  'cfa',
  'cpa',
  'acca',
  'cima',
  'scrum master',
  'psm',
  'itil',
  'six sigma',
  'ceh',
  'oscp',
  'terraform associate',
  'cka',
  'ckad',
];

/** Pull explicit skill terms out of free text using the curated vocabulary. */
export function extractSkills(text: string): string[] {
  const normalized = ` ${normalizeText(text)} `;
  const found = new Set<string>();
  for (const { canonical, alias } of SKILL_ALIASES) {
    const needle = normalizeText(alias);
    if (!needle) continue;
    // Word-boundary match so "go" doesn't match "algorithms" and "ai" doesn't
    // match "email". Multi-word aliases are matched as phrases.
    const pattern = new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(needle)}([^a-z0-9+#]|$)`, 'i');
    if (pattern.test(normalized)) found.add(canonical);
  }
  return [...found].sort();
}

export function extractCertifications(text: string): string[] {
  const normalized = normalizeText(text);
  return CERTIFICATION_PATTERNS.filter((cert) => normalized.includes(normalizeText(cert))).sort();
}

/** Detect "5+ years", "3-5 years", "minimum of 4 years" style requirements. */
export function extractYearsRequired(text: string): number | undefined {
  const normalized = normalizeText(text);
  const patterns = [
    /(\d{1,2})\s*\+\s*(?:years?|yrs?)/,
    /(?:minimum(?: of)?|at least|min\.?)\s*(\d{1,2})\s*(?:years?|yrs?)/,
    /(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:years?|yrs?)/,
    /(\d{1,2})\s*(?:years?|yrs?)\s*(?:of\s*)?(?:experience|exp)\b/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value) && value >= 0 && value <= 30) return value;
    }
  }
  return undefined;
}

export function extractEducationHint(text: string): string | undefined {
  const normalized = normalizeText(text);
  if (/\bphd\b|doctorate/.test(normalized)) return 'phd';
  if (/\bmaster'?s?\b|\bmsc\b|\bmba\b|\bm\.?s\.?\b/.test(normalized)) return 'master';
  if (/\bbachelor'?s?\b|\bbsc\b|\bb\.?s\.?\b|\bundergraduate degree\b/.test(normalized))
    return 'bachelor';
  if (/\bassociate degree\b|\bdiploma\b|\bhnd\b/.test(normalized)) return 'associate';
  if (/\bdegree\b/.test(normalized)) return 'degree';
  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the requirement profile for a job (deterministic, cached by caller). */
export function extractRequirements(job: {
  title: string;
  description: string;
  tags?: string[] | undefined;
}): JobRequirementProfile {
  const combined = [job.title, job.tags?.join(' ') ?? '', job.description].join('\n');
  return {
    title: job.title,
    skills: extractSkills(combined),
    yearsRequired: extractYearsRequired(job.description),
    educationHint: extractEducationHint(job.description),
    certifications: extractCertifications(combined),
    text: normalizeText(combined),
  };
}

/** Convenience wrapper for a normalised job. */
export function extractJobRequirements(job: {
  title: string;
  description: string;
  tags: string[];
}): JobRequirementProfile {
  return extractRequirements(job);
}

/** Candidate-side skill set derived from verified facts and profile content. */
export function extractCandidateSkills(input: {
  skills: string[];
  factLabels: string[];
  experienceText?: string | undefined;
}): string[] {
  const text = [
    input.skills.join(' '),
    input.factLabels.join(' '),
    input.experienceText ?? '',
  ].join(' ');
  const explicit = new Set(input.skills.map((skill) => normalizeText(skill)));
  const canonical = new Set<string>();
  for (const { canonical: term, alias } of SKILL_ALIASES) {
    const needle = normalizeText(alias);
    if (explicit.has(needle) || explicit.has(normalizeText(term))) canonical.add(term);
  }
  for (const term of extractSkills(text)) canonical.add(term);
  return [...canonical].sort();
}

/** Tokenise a job title into comparable role terms. */
export function roleTerms(title: string): string[] {
  return tokenize(title);
}

/** Used by the raw connector pipeline to keep `RawJob` typing honest. */
export type { RawJob };
