import { inflateRawSync, inflateSync } from "node:zlib";
import { cleanLine, htmlToText } from "@/lib/text";

export type ParsedFact = {
  factType: "experience" | "education" | "skill" | "certification" | "achievement";
  title: string;
  organization: string;
  location: string;
  startDate: string | null;
  endDate: string | null;
  bullets: string[];
  skills: string[];
  state: "professional" | "learning" | "none";
  confidence: number;
};

export type ParsedResume = {
  text: string;
  facts: ParsedFact[];
  summary: string;
  headline: string;
  warnings: string[];
};

/* -------------------------------------------------------------------------- */
/* File text extraction                                                       */
/* -------------------------------------------------------------------------- */

/** Best-effort PDF text extraction using the content streams (FlateDecode). */
export function extractPdfText(buffer: Buffer): { text: string; ok: boolean } {
  const chunks: string[] = [];
  const raw = buffer.toString("latin1");
  const streamRegex = /stream\r?\n?([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(raw))) {
    const body = match[1];
    let content = "";
    try {
      content = inflateSync(Buffer.from(body, "latin1")).toString("latin1");
    } catch {
      content = body;
    }
    if (!/(Tj|TJ)/.test(content)) continue;
    // Collect text-showing operators, including TJ arrays split by kerning.
    const textParts: string[] = [];
    const showRegex = /\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\]\\]|\\.)*\]\s*TJ/g;
    for (const show of content.match(showRegex) ?? []) {
      const literals = show.match(/\((?:\\.|[^\\()])*\)/g) ?? [];
      const joined = literals
        .map((literal) =>
          literal
            .slice(1, -1)
            .replace(/\\([nrtbf()\\])/g, (_m, char: string) =>
              char === "n" ? "\n" : char === "r" ? "" : char === "t" ? "\t" : char,
            )
            .replace(/\\([0-7]{1,3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8))),
        )
        .join("");
      if (joined.trim()) textParts.push(joined);
    }
    if (textParts.length) chunks.push(textParts.join("\n"));
  }
  const text = chunks
    .join("\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { text, ok: text.length > 40 };
}

/** Minimal ZIP reader (enough for DOCX: stored + deflated entries). */
export function extractDocxText(buffer: Buffer): { text: string; ok: boolean } {
  try {
    const signature = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (signature < 0) return { text: "", ok: false };
    // Walk local file headers.
    let offset = signature;
    let documentXml = "";
    while (offset < buffer.length - 30) {
      if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
      const method = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const nameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
      const dataStart = offset + 30 + nameLength + extraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (name === "word/document.xml") {
        documentXml = method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8");
        break;
      }
      offset = dataStart + compressedSize;
    }
    if (!documentXml) return { text: "", ok: false };
    const withBreaks = documentXml
      .replace(/<w:br\s*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab\s*\/>/g, "\t");
    const text = htmlToText(withBreaks);
    return { text, ok: text.length > 40 };
  } catch {
    return { text: "", ok: false };
  }
}

/* -------------------------------------------------------------------------- */
/* Resume text → structured facts                                             */
/* -------------------------------------------------------------------------- */

const SECTION_ALIASES: Record<string, string[]> = {
  summary: ["summary", "profile", "objective", "about me", "professional summary"],
  experience: ["experience", "work experience", "employment", "professional experience", "work history"],
  education: ["education", "academic background", "qualifications"],
  skills: ["skills", "technical skills", "core skills", "toolkit", "technologies"],
  certifications: ["certifications", "certificates", "licenses"],
  achievements: ["projects", "achievements", "awards", "projects & achievements", "portfolio"],
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function normalizeDateToken(token: string): string | null {
  const cleaned = token.trim().toLowerCase().replace(/[.,]/g, "");
  if (!cleaned) return null;
  if (/present|current|now|today/.test(cleaned)) return null;
  const yearMatch = cleaned.match(/(19|20)\d{2}/);
  if (!yearMatch) return null;
  const year = yearMatch[0];
  const monthIndex = MONTHS.findIndex((month) => cleaned.startsWith(month));
  const slash = cleaned.match(/^(\d{1,2})\/(\d{4})$/);
  const numericMonth = slash ? Number(slash[1]) : monthIndex >= 0 ? monthIndex + 1 : null;
  if (numericMonth && numericMonth >= 1 && numericMonth <= 12) {
    return `${year}-${String(numericMonth).padStart(2, "0")}`;
  }
  return year;
}

export function parseDates(segment: string): { start: string | null; end: string | null; isCurrent: boolean } {
  const range = segment.match(/([A-Za-z]{3,9}\.?\s*(?:19|20)\d{2}|\d{1,2}\/(?:19|20)\d{2}|(?:19|20)\d{2})\s*(?:–|-|—|to)\s*([A-Za-z]{3,9}\.?\s*(?:19|20)\d{2}|\d{1,2}\/(?:19|20)\d{2}|(?:19|20)\d{2}|present|current|now)/i);
  if (range) {
    return {
      start: normalizeDateToken(range[1]),
      end: normalizeDateToken(range[2]),
      isCurrent: /present|current|now/i.test(range[2]),
    };
  }
  const single = segment.match(/([A-Za-z]{3,9}\.?\s*(?:19|20)\d{2}|(?:19|20)\d{2})/);
  return { start: single ? normalizeDateToken(single[1]) : null, end: null, isCurrent: false };
}

function stripDates(line: string): string {
  return line
    .replace(/\(?\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?:19|20)\d{2}\s*(?:–|-|—|to)\s*(?:present|current|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?:19|20)\d{2}|(?:19|20)\d{2})\)?/gi, "")
    .replace(/\(?\b(?:19|20)\d{2}\s*(?:–|-|—|to)\s*(?:present|current|(?:19|20)\d{2})\)?/gi, "")
    .replace(/\(?\b\d{1,2}\/(?:19|20)\d{2}\s*(?:–|-|—|to)\s*(?:\d{1,2}\/(?:19|20)\d{2}|present)\)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[|·,–—-]\s*$/, "")
    .trim();
}

function splitTitleOrg(header: string): { title: string; organization: string; location: string } {
  const separators = [" — ", " – ", " - ", " at ", " | ", ", "];
  let title = header;
  let rest = "";
  for (const separator of separators) {
    if (header.includes(separator)) {
      const [first, ...others] = header.split(separator);
      title = first.trim();
      rest = others.join(separator).trim();
      break;
    }
  }
  let organization = rest;
  let location = "";
  const comma = rest.split(",");
  if (comma.length > 1 && /(ghana|uk|usa|us|canada|germany|kenya|nigeria|remote|city|online|berlin|london|accra|kumasi)/i.test(rest)) {
    location = comma.slice(-1)[0].trim();
    organization = comma.slice(0, -1).join(",").trim();
  }
  return { title: cleanLine(title), organization: cleanLine(organization), location: cleanLine(location) };
}

function detectSection(line: string): string | null {
  const normalized = line.toLowerCase().replace(/[:\s]+$/g, "").trim();
  if (!normalized || normalized.length > 40) return null;
  for (const [section, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(normalized)) return section;
  }
  return null;
}

export function parseResumeText(rawText: string): ParsedResume {
  const text = rawText.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
  const warnings: string[] = [];
  const lines = text.split("\n").map((line) => line.trimEnd());
  const facts: ParsedFact[] = [];
  let summary = "";
  let headline = "";
  let section = "header";
  let current: ParsedFact | null = null;
  const skillLines: string[] = [];

  const pushCurrent = () => {
    if (current && current.title) facts.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current && current.bullets.length) pushCurrent();
      continue;
    }
    const detected = detectSection(line);
    if (detected) {
      pushCurrent();
      section = detected;
      continue;
    }

    const bulletMatch = line.match(/^([-•*·▪]|\d+[.)])\s+(.*)$/);
    if (section === "experience" || section === "education" || section === "certifications" || section === "achievements") {
      if (bulletMatch) {
        if (!current) {
          current = {
            factType: section === "experience" ? "experience" : section === "education" ? "education" : section === "certifications" ? "certification" : "achievement",
            title: "",
            organization: "",
            location: "",
            startDate: null,
            endDate: null,
            bullets: [],
            skills: [],
            state: "none",
            confidence: 0.7,
          };
        }
        current.bullets.push(bulletMatch[2].trim());
        continue;
      }
      pushCurrent();
      const dates = parseDates(line);
      const header = stripDates(line);
      const parts = splitTitleOrg(header);
      current = {
        factType: section === "experience" ? "experience" : section === "education" ? "education" : section === "certifications" ? "certification" : "achievement",
        title: parts.title,
        organization: parts.organization,
        location: parts.location,
        startDate: dates.start,
        endDate: dates.end,
        bullets: [],
        skills: [],
        state: "none",
        confidence: dates.start ? 0.85 : 0.65,
      };
      if (!dates.start && !dates.end) warnings.push(`No dates detected for “${parts.title || line.slice(0, 40)}” — please add them.`);
      continue;
    }

    if (section === "skills") {
      skillLines.push(line.replace(/^(learning|currently learning)\s*:/i, ""));
      continue;
    }
    if (section === "summary") {
      summary = `${summary} ${line}`.trim();
      continue;
    }
    if (section === "header") {
      if (!headline) {
        const candidate = /(developer|engineer|designer|analyst|manager|intern|graduate|scientist|consultant|specialist|assistant)/i.test(line)
          ? line
          : "";
        if (candidate && line.length < 120) headline = candidate;
      }
    }
  }
  pushCurrent();

  // Skills: split comma/slash/pipe lists, ignore prose sentences.
  const skillTokens = skillLines
    .join(", ")
    .split(/[,;|/•·]+|\s{3,}/)
    .map((token) => cleanLine(token.replace(/^(and|with|including)\s+/i, "")))
    .filter((token) => token.length > 1 && token.length < 32 && token.split(" ").length <= 3);
  const seenSkills = new Set<string>();
  for (const token of skillTokens) {
    const key = token.toLowerCase();
    if (seenSkills.has(key)) continue;
    seenSkills.add(key);
    facts.push({
      factType: "skill",
      title: token,
      organization: "",
      location: "",
      startDate: null,
      endDate: null,
      bullets: [],
      skills: [],
      state: /^learning:/i.test(token) ? "learning" : "professional",
      confidence: 0.6,
    });
  }

  // Link skills mentioned in a role's bullets back to that role.
  for (const fact of facts) {
    if (fact.factType !== "experience") continue;
    const corpus = `${fact.title} ${fact.bullets.join(" ")}`.toLowerCase();
    for (const skill of facts.filter((candidate) => candidate.factType === "skill")) {
      if (corpus.includes(skill.title.toLowerCase())) fact.skills.push(skill.title);
    }
  }

  if (!summary) {
    const firstParagraph = text
      .split("\n\n")
      .map((block) => cleanLine(block))
      .find((block) => block.length > 120 && block.split(" ").length > 18);
    if (firstParagraph) summary = firstParagraph.slice(0, 500);
  }

  if (!facts.some((fact) => fact.factType === "experience")) {
    warnings.push("We could not detect any work experience. You can add entries manually after import.");
  }

  return { text, facts, summary: cleanLine(summary), headline: cleanLine(headline), warnings };
}
