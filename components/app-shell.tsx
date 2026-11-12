import Link from "next/link";
import { Bell, LogOut, PauseCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { dashboardCounts } from "@/lib/search";
import { getProfileContext } from "@/lib/profile";
import { Brand, MobileNav, SidebarNav } from "./nav";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const counts = dashboardCounts(user.id);
  const { prefsRow } = getProfileContext(user.id);
  const paused = prefsRow.schedule_enabled === 0;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-slate-200/80 bg-white/65 px-4 py-6 backdrop-blur lg:flex">
        <Brand />
        <div className="mt-8 flex-1">
          <SidebarNav pendingApprovals={counts.pendingApprovals} />
          <div className="mt-6 rounded-xl border border-slate-200/80 bg-white/70 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Bell size={12} /> Daily search
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              {paused ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <PauseCircle size={12} /> Paused
                </span>
              ) : (
                <>
                  Runs at <span className="font-semibold text-slate-800">{prefsRow.search_time}</span> ·{" "}
                  {prefsRow.timezone}
                </>
              )}
            </p>
            <Link href="/settings#schedule" className="mt-2 inline-block text-[11px] font-semibold text-brand-600 hover:underline">
              Adjust schedule
            </Link>
          </div>
        </div>
        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-2.5 px-1">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-800">{user.name}</p>
              <p className="truncate text-[11px] text-slate-500">{user.email}</p>
            </div>
          </div>
          <form action="/api/auth/logout" method="post" className="mt-2">
            <button className="btn-ghost w-full justify-start px-2 py-1.5 text-xs" type="submit">
              <LogOut size={13} /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/75 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Brand />
            <form action="/api/auth/logout" method="post">
              <button className="btn-ghost px-2 py-1" aria-label="Sign out" type="submit">
                <LogOut size={16} />
              </button>
            </form>
          </div>
          <MobileNav pendingApprovals={counts.pendingApprovals} />
        </div>

        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {paused ? (
            <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <PauseCircle size={16} />
              <span className="font-medium">Daily search is paused.</span>
              <span className="text-amber-800/80">You can still run a search manually.</span>
              <Link href="/settings#schedule" className="ml-auto text-xs font-semibold underline">
                Resume automation
              </Link>
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow ? <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
