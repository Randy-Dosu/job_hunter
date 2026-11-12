export type Claim = {
  text: string;
  /** Profile evidence rows that justify this exact statement. */
  evidenceIds: string[];
};

export type ResumeEntry = {
  title: string;
  organization: string;
  location: string;
  dates: string;
  bullets: Claim[];
  evidenceIds: string[];
};

export type TailoredResumeContent = {
  header: { name: string; contactLines: string[] };
  target: { jobTitle: string; company: string; jobId: string };
  headline: Claim;
  summary: Claim;
  experience: ResumeEntry[];
  education: ResumeEntry[];
  certifications: ResumeEntry[];
  achievements: ResumeEntry[];
  skills: { core: Claim; learning: Claim | null };
  omitted: string[];
  generatedAt: string;
};

export type ChangeLogEntry = {
  id: string;
  type: "reordered" | "emphasized" | "omitted" | "rewritten" | "added" | "unchanged";
  section: string;
  description: string;
  evidenceIds: string[];
};

export type UnsupportedClaim = {
  text: string;
  reason: string;
  detail: string;
};

export type GenerationResult = {
  content: TailoredResumeContent;
  changeLog: ChangeLogEntry[];
  unsupported: UnsupportedClaim[];
  metadata: {
    engine: string;
    provider: string;
    evidenceUsed: number;
    requirementsMatched: string[];
    requirementsMissing: string[];
    generatedAt: string;
    warnings: string[];
  };
};
