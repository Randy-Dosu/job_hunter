import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "@/components/auth-forms";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; q?: string }> }) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  const { mode, q } = await searchParams;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-ink text-[10px] font-bold text-white">jh</span>
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">job hunter</span>
          </Link>
          <span className="ml-auto text-[12px] text-muted">
            New here?{" "}
            <Link href="/login?mode=signup" className="font-medium text-ink hover:underline">
              Create an account
            </Link>
          </span>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:py-16">
        <div className="max-w-md">
          <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">Sign in to your job hunt.</h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
            {q ? (
              <>
                Continue searching for <span className="font-medium text-ink">“{q}”</span> — your saved market, filters and verified
                profile are waiting inside.
              </>
            ) : (
              "Your searches, verified facts, tailored resumes and approvals all live in one place, with a full audit trail."
            )}
          </p>

          <dl className="mt-8 space-y-4 border-t border-line pt-6">
            {[
              ["Approval is per vacancy", "Approval is bound to one job and one exact package hash. Edit anything and it expires."],
              ["Every claim is traceable", "Resume lines link back to verified profile facts, never to a model's imagination."],
              ["You choose the sources", "Three reviewed public sources today. Disable any of them at any time."],
            ].map(([title, body]) => (
              <div key={title}>
                <dt className="text-[12.5px] font-semibold text-ink">{title}</dt>
                <dd className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{body}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <div className="rounded-[10px] border border-line bg-surface p-5">
            <LoginForm mode={mode === "signup" ? "signup" : "login"} />
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            Generated material is yours to review. Job Hunter never submits an application, and never contacts an employer on your
            behalf.
          </p>
        </div>
      </div>
    </div>
  );
}
