import { cleanLine } from "@/lib/text";

export type Requirement = {
  skill: string;
  label: string;
  required: boolean;
  evidence: string;
};

const SKILL_DICTIONARY: Record<string, string[]> = {
  javascript: ["javascript", "js", "ecmascript"],
  typescript: ["typescript", "ts"],
  react: ["react", "react.js", "reactjs"],
  "next.js": ["next.js", "nextjs", "next js"],
  vue: ["vue", "vue.js", "vuejs"],
  angular: ["angular"],
  "node.js": ["node.js", "nodejs", "node js", "node"],
  python: ["python"],
  java: ["java"],
  go: ["golang", "go lang", "go"],
  rust: ["rust"],
  php: ["php"],
  ruby: ["ruby", "rails"],
  sql: ["sql", "t-sql", "plsql"],
  postgresql: ["postgres", "postgresql"],
  mysql: ["mysql"],
  mongodb: ["mongodb", "mongo"],
  redis: ["redis"],
  graphql: ["graphql"],
  rest: ["rest api", "restful", "rest apis"],
  "html/css": ["html", "css", "html5", "css3"],
  tailwind: ["tailwind", "tailwindcss"],
  docker: ["docker", "containers"],
  kubernetes: ["kubernetes", "k8s"],
  aws: ["aws", "amazon web services"],
  gcp: ["gcp", "google cloud"],
  azure: ["azure"],
  "ci/cd": ["ci/cd", "continuous integration", "github actions", "gitlab ci"],
  git: ["git", "version control"],
  linux: ["linux", "unix", "bash", "shell scripting"],
  testing: ["unit test", "unit testing", "jest", "vitest", "pytest", "cypress", "playwright", "test automation", "automated testing", "testing"],
  agile: ["agile", "scrum", "kanban"],
  figma: ["figma"],
  "ui/ux": ["ui/ux", "user experience", "usability"],
  "data analysis": ["data analysis", "data analytics", "analytics"],
  excel: ["excel", "spreadsheets"],
  powerbi: ["power bi", "powerbi"],
  tableau: ["tableau"],
  pandas: ["pandas"],
  numpy: ["numpy"],
  "machine learning": ["machine learning", "ml models", "scikit-learn", "sklearn"],
  tensorflow: ["tensorflow"],
  pytorch: ["pytorch"],
  "data engineering": ["data pipeline", "etl", "airflow", "data engineering"],
  "product management": ["product management", "roadmap", "product owner"],
  "project management": ["project management", "stakeholder management"],
  communication: ["communication skills", "written communication", "communicate"],
  leadership: ["leadership", "mentoring", "line management"],
  "customer support": ["customer support", "customer service", "helpdesk"],
  "digital marketing": ["digital marketing", "seo", "social media marketing", "google ads"],
  salesforce: ["salesforce", "crm"],
  accounting: ["accounting", "bookkeeping", "reconciliation"],
  nursing: ["nursing", "patient care"],
  teaching: ["teaching", "curriculum"],
};

const REQUIRED_MARKERS = /(require|must[- ]have|essential|minimum|qualification|you have|what you.ll need|you.ll bring|skills?:)/i;
const PREFERRED_MARKERS = /(preferred|nice[- ]to[- ]have|bonus|desirable|plus|advantage|would be great)/i;

function normalize(value: string) {
  return ` ${value.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").replace(/\s+/g, " ")} `;
}

function matchSkills(sentence: string): string[] {
  const haystack = normalize(sentence);
  const found: string[] = [];
  for (const [skill, aliases] of Object.entries(SKILL_DICTIONARY)) {
    for (const alias of aliases) {
      const needle = alias.toLowerCase();
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, "i");
      if (pattern.test(haystack)) {
        found.push(skill);
        break;
      }
    }
  }
  return found;
}

export type ExtractedRequirements = {
  required: Requirement[];
  preferred: Requirement[];
  requiredYears: number | null;
  educationLevel: string | null;
  sponsorshipOffered: boolean | null;
  remoteMentioned: boolean;
  redFlags: string[];
};

/**
 * Turn a free-text job description into structured criteria.
 * Deterministic and conservative: absence of evidence stays "unknown".
 */
export function extractRequirements(description: string, title = ""): ExtractedRequirements {
  const sentences = description
    .split(/\n|(?<=[.!?])\s+/)
    .map(cleanLine)
    .filter((s) => s.length > 2);

  const required = new Map<string, Requirement>();
  const preferred = new Map<string, Requirement>();
  let section: "required" | "preferred" | "unknown" = "unknown";

  for (const sentence of sentences) {
    if (sentence.length < 120) {
      if (PREFERRED_MARKERS.test(sentence)) section = "preferred";
      else if (REQUIRED_MARKERS.test(sentence)) section = "required";
    }
    const skills = matchSkills(sentence);
    if (!skills.length) continue;
    const isPreferred = section === "preferred" || PREFERRED_MARKERS.test(sentence);
    const bucket = isPreferred ? preferred : required;
    for (const skill of skills) {
      if (!bucket.has(skill) && !required.has(skill)) {
        bucket.set(skill, { skill, label: skill, required: !isPreferred, evidence: sentence.slice(0, 180) });
      }
    }
  }

  // Skills absent from a clearly structured requirements section still matter:
  // promote everything found anywhere to "required" only when no section was detected.
  if (!required.size && preferred.size) {
    for (const [key, value] of preferred) {
      required.set(key, { ...value, required: true });
      preferred.delete(key);
    }
  }

  const yearsMatch = description.match(/(\d+)\+?\s*(?:-|to)?\s*(\d+)?\s*(?:\+)?\s*years?[^.]{0,40}experience/i);
  const requiredYears = yearsMatch ? Number(yearsMatch[1]) : null;

  const educationLevel = /phd|doctorate/i.test(description)
    ? "PhD"
    : /master'?s|msc|mba/i.test(description)
      ? "Master's"
      : /bachelor|bsc|degree|undergraduate/i.test(description)
        ? "Bachelor's"
        : /diploma|hnd/i.test(description)
          ? "Diploma"
          : null;

  const noSponsorship = /(no|not able to|cannot|unable to|we do not)\s+(offer\s+)?(visa\s+)?sponsor/i.test(description);
  const sponsorshipOffered = noSponsorship ? false : /visa sponsorship|we sponsor|sponsorship available/i.test(description) ? true : null;

  const redFlags: string[] = [];
  if (/(pay|send|transfer)[^.]{0,40}(fee|deposit|money)/i.test(description)) redFlags.push("Asks for a payment or deposit");
  if (/(bank details|bank account|routing number|credit card)/i.test(description)) redFlags.push("Requests sensitive financial information");
  if (/western union|moneygram|bitcoin|crypto payment/i.test(description)) redFlags.push("Uses unusual payment channels");
  if (/(whatsapp|telegram)\s*(only|immediately|to apply)/i.test(description)) redFlags.push("Directs applicants to informal messaging channels");

  return {
    required: [...required.values()],
    preferred: [...preferred.values()],
    requiredYears,
    educationLevel,
    sponsorshipOffered,
    remoteMentioned: /remote|work from home|distributed team|anywhere/i.test(`${title} ${description.slice(0, 400)}`),
    redFlags,
  };
}

export function skillLabel(skill: string): string {
  const map: Record<string, string> = {
    javascript: "JavaScript",
    typescript: "TypeScript",
    react: "React",
    "next.js": "Next.js",
    vue: "Vue",
    angular: "Angular",
    "node.js": "Node.js",
    python: "Python",
    java: "Java",
    go: "Go",
    rust: "Rust",
    php: "PHP",
    ruby: "Ruby",
    sql: "SQL",
    postgresql: "PostgreSQL",
    mysql: "MySQL",
    mongodb: "MongoDB",
    redis: "Redis",
    graphql: "GraphQL",
    rest: "REST APIs",
    "html/css": "HTML/CSS",
    tailwind: "Tailwind CSS",
    docker: "Docker",
    kubernetes: "Kubernetes",
    aws: "AWS",
    gcp: "GCP",
    azure: "Azure",
    "ci/cd": "CI/CD",
    git: " Git",
    linux: "Linux",
    testing: "Automated testing",
    "ui/ux": "UI/UX",
    "data analysis": "Data analysis",
    excel: "Excel",
    powerbi: "Power BI",
    tableau: "Tableau",
    pandas: "pandas",
    numpy: "NumPy",
    "machine learning": "Machine learning",
    tensorflow: "TensorFlow",
    pytorch: "PyTorch",
    "data engineering": "Data engineering",
    "product management": "Product management",
    "project management": "Project management",
    communication: "Communication",
    leadership: "Leadership",
    "customer support": "Customer support",
    "digital marketing": "Digital marketing",
    salesforce: "Salesforce",
    accounting: "Accounting",
    nursing: "Nursing",
    teaching: "Teaching",
    agile: "Agile delivery",
    figma: "Figma",
  };
  return map[skill] ?? skill;
}

export function knownSkills(): string[] {
  return Object.keys(SKILL_DICTIONARY);
}

const ALIAS_INDEX: { alias: string; skill: string }[] = Object.entries(SKILL_DICTIONARY)
  .flatMap(([skill, aliases]) => aliases.map((alias) => ({ alias: alias.toLowerCase(), skill })))
  .sort((a, b) => b.alias.length - a.alias.length);

/**
 * Map a label from either a job description or a user profile to one canonical
 * skill key, so "PostgreSQL", "postgres" and "postgresql" compare equal.
 */
export function canonicalSkill(value: string): string | null {
  const lower = value.toLowerCase().trim();
  if (!lower) return null;
  if (SKILL_DICTIONARY[lower]) return lower;
  const exactAlias = ALIAS_INDEX.find((entry) => entry.alias === lower);
  if (exactAlias) return exactAlias.skill;
  const padded = ` ${lower.replace(/[^a-z0-9+#./ -]/g, " ").replace(/\s+/g, " ")} `;
  for (const entry of ALIAS_INDEX) {
    const escaped = entry.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, "i").test(padded)) return entry.skill;
  }
  return null;
}
