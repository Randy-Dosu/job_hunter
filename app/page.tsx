import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  ClipboardCheck,
  FileSearch,
  Fingerprint,
  Gauge,
  Lock,
  Mail,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { DemoLoginButton } from "@/components/auth-forms";

const steps = [
  {
    icon: ClipboardCheck,
    title: "1 · Define your market",
    body: "Countries, remote regions, role families, seniority, salary floor, exclusions and the sources you allow.",
  },
  {
    icon: Search,
    title: "2 · Daily discovery",
    body: "Compliant sources are searched on your schedule, then normalized, de-duplicated and freshness-checked.",
  },
  {
    icon: Gauge,
    title: "3 · Explainable ranking",
    body: "A transparent 100-point model shows what matched, what did not, and how confident the data is.",
  },
  {
    icon: Fingerprint,
    title: "4 · Grounded resumes",
    body: "Every line is traceable to a verified profile fact. You see a change log before anything is exported.",
  },
];

const guardrails = [
  { icon: ShieldCheck, title: "No approval, no application", body: "Approval is bound to one vacancy and one exact package hash. Edit anything and approval expires." },
  { icon: Fingerprint, title: "No invented claims", body: "The generator can only reorder and rephrase verified facts. Unsupported sentences are blocked and flagged." },
  { icon: Lock, title: "Your data stays yours", body: "Strict per-user ownership, server-side secrets, export and deletion controls, and a full audit trail." },
  { icon: FileSearch, title: "Sources you can audit", body: "Each adapter documents its access method, terms review, rate limits and last run status." },
];

export default async function WelcomePage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-6 sm:px-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            <Sparkles size={17} />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight text-slate-900">Job Hunter</span>
            <span className="block text-[11px] text-slate-500">careful by design</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login" className="btn-ghost text-sm">
            Sign in
          </Link>
          <Link href="/login?mode=signup" className="btn-primary text-sm">
            Get started
          </Link>
        </div>
      </header>

      <section className="mt-14 grid items-center gap-10 lg:mt-20 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <span className="badge-brand">
            <BadgeCheck size={12} /> User-controlled, evidence-first
          </span>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl">
            A job-search assistant that never
            <span className="bg-gradient-to-r from-brand-600 to-emerald-600 bg-clip-text text-transparent"> applies behind your back</span>.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
            Job Hunter searches your chosen markets every day, explains why each vacancy is relevant, drafts a resume from
            verified facts only, and waits for your explicit approval before anything leaves the app.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn-primary px-4 py-2.5">
              Start your search <ArrowRight size={15} />
            </Link>
            <div className="w-[15rem]">
              <DemoLoginButton className="btn-secondary w-full px-4 py-2.5" label="See the demo workspace" />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-emerald-600" /> Approval gate on every submission
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Fingerprint size={13} className="text-emerald-600" /> Evidence linked to every claim
            </span>
            <span className="inline-flex items-center gap-1.5">
              <TriangleAlert size={13} className="text-amber-500" /> Scam and red-flag warnings
            </span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-brand-100/70 via-white to-emerald-100/50 blur-2xl" />
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <p className="text-xs font-semibold text-slate-700">Today&apos;s digest</p>
              <span className="badge-neutral">illustrative</span>
            </div>
            <div className="divide-y divide-slate-100">
              {[
                { title: "Junior Frontend Developer", company: "Brightline Studio", score: 82, verdict: "Strong match", tone: "badge-strong" },
                { title: "Full Stack Developer", company: "Northwind Labs", score: 74, verdict: "Strong match", tone: "badge-strong" },
                { title: "React Developer", company: "Studio Mono", score: 68, verdict: "Possible", tone: "badge-possible" },
              ].map((job) => (
                <div key={job.title} className="flex items-center gap-3 px-5 py-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
                    {job.company.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{job.title}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {job.company} · remote worldwide
                    </p>
                  </div>
                  <span className={job.tone}>{job.score}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/60 text-center">
              {[
                { value: "18", label: "found" },
                { value: "7", label: "duplicates" },
                { value: "5", label: "relevant" },
              ].map((stat) => (
                <div key={stat.label} className="px-3 py-3">
                  <p className="text-sm font-semibold text-slate-900">{stat.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="absolute -bottom-6 -left-4 hidden w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg sm:block">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
              <BadgeCheck size={12} /> Approval required
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              “Submit application” stays disabled until you review this exact package and confirm.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-24">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">How a day works</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div key={step.title} className="card card-pad">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <step.icon size={17} />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16 rounded-3xl border border-slate-200 bg-white/70 p-6 sm:p-9">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Built around four guardrails</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          {guardrails.map((item) => (
            <div key={item.title} className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900/5 text-slate-700">
                <item.icon size={15} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16 grid gap-4 rounded-3xl bg-slate-900 p-7 text-white sm:p-9 lg:grid-cols-[1.3fr_0.7fr]">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">What it deliberately does not do</h2>
          <ul className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
            <li>· Apply to jobs without your per-vacancy approval</li>
            <li>· Invent experience, metrics or certifications</li>
            <li>· Bypass CAPTCHAs, logins or anti-bot controls</li>
            <li>· Scrape sources whose terms forbid automation</li>
            <li>· Contact recruiters on your behalf</li>
            <li>· Guess values it cannot verify — unknowns stay unknown</li>
          </ul>
        </div>
        <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <p className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Mail size={13} /> Daily digest at 07:00, Africa/Accra
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
            In-app by default. Email digests are opt-in, and every message only covers new or materially changed matches.
          </p>
          <div className="mt-3">
            <DemoLoginButton className="btn bg-white px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100" label="Open the demo" />
          </div>
        </div>
      </section>

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500">
        <span>© {new Date().getFullYear()} Job Hunter · MVP build from the product requirements document</span>
        <span className="flex gap-3">
          <Link href="/login" className="hover:underline">
            Sign in
          </Link>
          <span>Source policy · Privacy · Audit log</span>
        </span>
      </footer>
    </div>
  );
}
