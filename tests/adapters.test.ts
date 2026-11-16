import { afterEach, describe, expect, it, vi } from "vitest";
import { RemotiveAdapter } from "@/lib/sources/adapters";

const criteria = {
  roleTitles: ["Frontend Developer"],
  keywords: [],
  countries: [],
  remotePreference: "remote",
  limitPerSource: 10,
};

const payload = {
  jobs: [
    {
      id: 1,
      title: "Frontend Developer",
      company_name: "Acme",
      candidate_required_location: "Worldwide",
      description: "React and TypeScript role.",
      url: "https://remotive.com/jobs/1",
      publication_date: new Date().toISOString(),
      job_type: "full_time",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("source fetch reliability", () => {
  it("retries a transient failure once before falling back to fixtures", async () => {
    const calls: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls.push(1);
        if (calls.length === 1) throw new TypeError("network down");
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const outcome = await new RemotiveAdapter().search(criteria as never);
    expect(calls).toHaveLength(2);
    expect(outcome.usedFixture).toBe(false);
    expect(outcome.jobs.length).toBeGreaterThan(0);
  });

  it("does not retry a permanent 4xx", async () => {
    const calls: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls.push(1);
        return new Response("gone", { status: 404 });
      }),
    );
    const outcome = await new RemotiveAdapter().search(criteria as never);
    expect(calls).toHaveLength(1);
    expect(outcome.usedFixture).toBe(true);
    expect(outcome.error).toContain("404");
  });

  it("retries a 429 once and then gives up with the fixture, labelled", async () => {
    const calls: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls.push(1);
        return new Response("slow down", { status: 429 });
      }),
    );
    const outcome = await new RemotiveAdapter().search(criteria as never);
    expect(calls).toHaveLength(2);
    expect(outcome.usedFixture).toBe(true);
    expect(outcome.error).toContain("429");
  });
});
