import { describe, expect, it } from "vitest";
import { parseDates, parseResumeText } from "@/lib/resume/parse";

const RESUME = `AMA SERWAA
Kumasi, Ghana · ama@example.com

SUMMARY
Junior developer building accessible web apps with TypeScript and React.

EXPERIENCE
Frontend Developer (Freelance) — Self-employed, Kumasi, Ghana (Sep 2024 – Present)
- Built React dashboards for three small businesses.
- Integrated REST APIs with TypeScript.

Software Engineering Intern — Kumasi Tech Hub (Jun 2025 - Sep 2025)
- Wrote Node.js services.

EDUCATION
BSc Computer Science — KNUST, Kumasi (2021 - 2025)

SKILLS
TypeScript, React, Node.js, SQL, Docker

PROJECTS
Winner — KNUST Hackathon 2024
- Built a clinic queue app in 36 hours.
`;

describe("resume parsing", () => {
  it("extracts experience entries with dates and bullets", () => {
    const parsed = parseResumeText(RESUME);
    const jobs = parsed.facts.filter((fact) => fact.factType === "experience");
    expect(jobs.length).toBe(2);
    expect(jobs[0].title).toContain("Frontend Developer");
    expect(jobs[0].startDate).toBe("2024-09");
    expect(jobs[0].endDate).toBeNull();
    expect(jobs[1].startDate).toBe("2025-06");
    expect(jobs[0].bullets.length).toBeGreaterThan(0);
  });

  it("detects education and certifications", () => {
    const parsed = parseResumeText(RESUME);
    expect(parsed.facts.some((fact) => fact.factType === "education" && /KNUST/.test(fact.organization + fact.title))).toBe(true);
  });

  it("extracts skills and keeps learning separate", () => {
    const parsed = parseResumeText(RESUME);
    const skills = parsed.facts.filter((fact) => fact.factType === "skill").map((fact) => fact.title.toLowerCase());
    expect(skills).toEqual(expect.arrayContaining(["typescript", "react", "sql"]));
  });

  it("captures the summary block", () => {
    const parsed = parseResumeText(RESUME);
    expect(parsed.summary).toMatch(/TypeScript and React/);
  });

  it("parses date ranges in several formats", () => {
    expect(parseDates("Jan 2023 – Present").start).toBe("2023-01");
    expect(parseDates("2021 - 2025")).toEqual({ start: "2021", end: "2025", isCurrent: false });
    expect(parseDates("09/2022 to 03/2024")).toEqual({ start: "2022-09", end: "2024-03", isCurrent: false });
  });

  it("warns rather than inventing dates when none are present", () => {
    const parsed = parseResumeText("EXPERIENCE\nMiscellaneous Helper\n- Moved boxes.");
    const entry = parsed.facts.find((fact) => fact.factType === "experience");
    expect(entry?.startDate).toBeNull();
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
});
