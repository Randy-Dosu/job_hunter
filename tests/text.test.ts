import { describe, expect, it } from "vitest";
import { canonicalUrl, fingerprint, htmlToText, titleSimilarity, truncate } from "@/lib/text";

describe("URL canonicalisation", () => {
  it("strips tracking parameters and fragments", () => {
    expect(canonicalUrl("https://boards.example.com/jobs/dev/?utm_source=news&utm_medium=email#apply")).toBe(
      "https://boards.example.com/jobs/dev",
    );
  });

  it("keeps meaningful query parameters and sorts them", () => {
    expect(canonicalUrl("http://example.com/job?b=2&a=1&ref=abc")).toBe("https://example.com/job?a=1&b=2");
  });

  it("treats the same listing with different tracking as identical", () => {
    const a = canonicalUrl("https://remotive.com/remote-jobs/dev/123?utm_campaign=x");
    const b = canonicalUrl("https://remotive.com/remote-jobs/dev/123");
    expect(a).toBe(b);
  });
});

describe("duplicate fingerprints", () => {
  it("normalises employer suffixes and seniority words", () => {
    expect(fingerprint("Acme Inc.", "Senior React Developer", "Remote")).toBe(
      fingerprint("Acme", "React Developer", "remote"),
    );
  });

  it("keeps genuinely different roles apart", () => {
    expect(fingerprint("Acme", "React Developer", "Remote")).not.toBe(fingerprint("Acme", "Data Analyst", "Remote"));
  });
});

describe("text helpers", () => {
  it("converts html descriptions to readable text", () => {
    const text = htmlToText("<p>Build <b>things</b></p><ul><li>Ship code</li></ul>");
    expect(text).toContain("Build things");
    expect(text).toContain("Ship code");
    expect(text).not.toContain("<");
  });

  it("scores similar titles higher than unrelated ones", () => {
    expect(titleSimilarity("Frontend Developer", "Frontend Developer")).toBe(1);
    expect(titleSimilarity("React Developer", "React Developer (Remote)")).toBeGreaterThan(0.6);
    expect(titleSimilarity("Civil Engineer", "Frontend Developer")).toBeLessThan(0.3);
  });

  it("truncates without breaking words mid-way", () => {
    expect(truncate("alpha beta gamma delta", 12)).toBe("alpha beta…");
  });
});
