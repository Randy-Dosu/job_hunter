import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, ArrowRight, MapPin } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { CompanyMark } from "@/components/ui";
import { formatRelative } from "@/lib/text";

type PreviewJob = {
  id?: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  remotePolicy: string;
  employmentType: string;
  postedAt: string | null;
  source: string;
};

const POPULAR = ["Frontend Developer", "React Developer", "Data Analyst", "Customer Support", "Product Designer"];

const STEPS = [
  { title: "Set your market", body: "Countries, remote regions, titles, seniority, salary floor and the employers you never want to see." },
  { title: "Get a daily list", body: "We search the sources you approved, remove duplicates, drop closed roles and explain every score." },
  { title: "Tailor, then decide", body: "A resume built from verified facts only. You approve the exact package before anything is sent." },
];

export default async function HomePage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const stored = all<{
    id: string;
    title: string;
    company: string;
    location: string;
    remote_policy: string;
    salary: string | null;
    employment_type: string;
    posted_at: string | null;
    source_name: string;
  }>(
    `SELECT j.id, j.title, j.company, j.location, j.remote_policy, j.salary, j.employment_type, j.posted_at, s.name AS source_name
     FROM jobs j JOIN job_sources s ON s.id = j.source_id
     WHERE j.status = 'open' ORDER BY j.posted_at DESC LIMIT 5`,
  );

  const preview: PreviewJob[] = stored.map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    remotePolicy: job.remote_policy,
    employmentType: job.employment_type,
    postedAt: job.posted_at,
    source: job.source_name,
  }));

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-ink text-[10px] font-bold text-white">jh</span>
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">job hunter</span>
          </div>
          <nav className="hidden items-center gap-6 text-[13px] text-ink-soft sm:flex">
            <a href="#how" className="hover:text-ink">
              How it works
            </a>
            <a href="#jobs" className="hover:text-ink">
              Recent roles
            </a>
            <a href="#sources" className="hover:text-ink">
              Sources
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="btn-ghost">
              Sign in
            </Link>
            <Link href="/login?mode=signup" className="btn-primary">
              Create account
            </Link>
          </div>
        </div>
      </header>

      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 pb-9 pt-12 sm:px-6 lg:pt-16">
          <div className="max-w-2xl">
            <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink sm:text-[42px]">
              The job search that shows its working.
            </h1>
            <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-soft">
              Remote roles from public job boards, scored against the experience you can prove. Every recommendation shows what
              matched and what did not — and nothing is sent without your approval.
            </p>
          </div>

          <form action="/login" className="mt-7 flex max-w-3xl flex-col gap-2 rounded-md border border-line-strong bg-surface p-2 shadow-[0_1px_2px_rgba(20,23,31,0.04)] sm:flex-row">
            <label className="flex flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 focus-within:bg-[#fbfaf8]">
              <Search size={15} className="text-muted" />
              <span className="sr-only">Job title, keyword or company</span>
              <input
                name="q"
                placeholder="Job title, keyword or company"
                className="h-7 w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-[#9aa0a8]"
              />
            </label>
            <span className="hidden w-px self-stretch bg-line sm:block" />
            <label className="flex items-center gap-2 rounded-md px-2.5 py-1.5 focus-within:bg-[#fbfaf8] sm:w-[240px]">
              <MapPin size={15} className="text-muted" />
              <span className="sr-only">Location or remote region</span>
              <input
                name="l"
                placeholder="Location or remote region"
                className="h-7 w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-[#9aa0a8]"
              />
            </label>
            <button type="submit" className="btn-primary h-9 shrink-0 px-4">
              Search jobs
            </button>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <span>Popular:</span>
            {POPULAR.map((term) => (
              <Link key={term} href={`/login?q=${encodeURIComponent(term)}`} className="text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink">
                {term}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:py-12">
        <div id="jobs">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold text-ink">Recently discovered roles</h2>
            <span className="text-[11.5px] text-muted">{stored.length ? `${stored.length} open` : "Nothing ingested yet"}</span>
          </div>

          <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
            {preview.map((job) => (
              <div key={`${job.company}-${job.title}`} className="flex items-start gap-3.5 border-b border-line p-4 last:border-b-0 hover:bg-[#fcfbf9]">
                <CompanyMark name={job.company} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[14px] font-semibold text-ink">{job.title}</p>
                    {job.salary ? <p className="shrink-0 text-[12.5px] font-semibold text-moss-700">{job.salary}</p> : null}
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">
                    {job.company}
                    <span className="text-muted"> · {job.location}</span>
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
                    <span className="capitalize">{job.remotePolicy === "remote" ? "Remote" : job.remotePolicy}</span>
                    <span>·</span>
                    <span className="capitalize">{job.employmentType}</span>
                    <span>·</span>
                    <span>Posted {formatRelative(job.postedAt)}</span>
                    <span>·</span>
                    <span>{job.source}</span>
                  </p>
                </div>
              </div>
            ))}
            {!preview.length ? (
              <div className="px-5 py-10 text-center">
                <p className="text-[13px] font-semibold text-ink">No listings yet</p>
                <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted">
                  Listings appear here after a signed-in search. Create an account, set your market and run the first search — nothing is
                  pre-filled or invented.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Link href="/login?mode=signup" className="btn-primary">
                    Create an account
                  </Link>
                  <Link href="/login" className="btn-secondary">
                    Sign in
                  </Link>
                </div>
              </div>
            ) : null}
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            {stored.length
              ? "Normalized listings from the enabled sources, shown before sign-in without any personal data."
              : "No seeded or sample data is shipped. Every listing in this product comes from a real search against a reviewed source."}
          </p>
        </div>

        <aside className="space-y-6">
          <div id="how" className="rounded-[10px] border border-line bg-surface p-5">
            <h2 className="text-[13px] font-semibold text-ink">How it works</h2>
            <ol className="mt-3 space-y-3.5">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="number mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line-strong text-[10.5px] font-semibold text-ink-soft">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-[12.5px] font-semibold text-ink">{step.title}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-[10px] border border-line bg-[#fbfaf8] p-5">
            <h2 className="text-[13px] font-semibold text-ink">Start your own search</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              Your market, verified facts and approvals are yours alone. Nothing is pre-filled from a sample profile.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Link href="/login?mode=signup" className="btn-primary w-full">
                Create an account
              </Link>
              <Link href="/login" className="btn-secondary w-full">
                Sign in
              </Link>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              First search takes about a minute once your resume facts are confirmed.
            </p>
          </div>

          <div className="rounded-[10px] border border-line px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Boundaries</p>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-ink-soft">
              <li>No application without your per-vacancy approval.</li>
              <li>No invented experience, metrics or certificates.</li>
              <li>No CAPTCHA, login or rate-limit bypassing.</li>
            </ul>
          </div>
        </aside>
      </div>

      <section id="sources" className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-[12px] text-muted sm:px-6">
          <p>
            Searching <span className="font-medium text-ink">Remotive</span> · <span className="font-medium text-ink">Arbeitnow</span> ·{" "}
            <span className="font-medium text-ink">Remote OK</span> — public APIs and feeds, terms reviewed.
          </p>
          <Link href="/login" className="inline-flex items-center gap-1 font-medium text-ink hover:underline">
            Start with your profile <ArrowRight size={12} />
          </Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-[11.5px] text-muted sm:px-6">
        <span>© {new Date().getFullYear()} Job Hunter — a user-controlled job-search assistant.</span>
        <span className="flex gap-4">
          <Link href="/login" className="hover:text-ink">
            Sign in
          </Link>
          <span>Source policy</span>
          <span>Privacy</span>
        </span>
      </footer>
    </div>
  );
}
