import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "@/components/auth-forms";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  const { mode } = await searchParams;

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
      <div>
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft size={13} /> Back to overview
        </Link>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">Your job hunt, with a paper trail.</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-600">
          Sign in to run today&apos;s search, review explainable matches, tailor a grounded resume, and approve — or
          reject — each application individually.
        </p>

        <ul className="mt-7 space-y-3 text-sm text-slate-600">
          {[
            "Approval is bound to a specific vacancy and package version",
            "Every resume line links back to verified evidence",
            "You choose which sources are allowed to run",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-600" />
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white/70 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Demo account</p>
          <p className="mt-1 text-sm text-slate-700">
            <span className="font-medium">demo@jobhunter.app</span> · <span className="font-medium">hunter1234</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Seeded with a verified early-career profile, three reviewed sources and a scheduled daily search.
          </p>
        </div>
      </div>

      <div className="w-full">
        <LoginForm mode={mode === "signup" ? "signup" : "login"} />
        <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
          By continuing you agree that generated material must be reviewed before you send it. Job Hunter never submits an
          application on its own.
        </p>
      </div>
    </div>
  );
}
