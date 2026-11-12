import Link from "next/link";
import { Bell, LogOut, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { dashboardCounts } from "@/lib/search";
import { getProfileContext } from "@/lib/profile";
import { Brand, MobileNav, TopNav } from "./nav";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const counts = dashboardCounts(user.id);
  const { prefsRow } = getProfileContext(user.id);
  const paused = prefsRow.schedule_enabled === 0;
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-7 px-4 sm:px-6">
          <Brand href="/dashboard" />
          <TopNav pendingApprovals={counts.pendingApprovals} />

          <div className="ml-auto flex items-center gap-1.5">
            <Link
              href="/jobs"
              className="hidden h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[12px] text-muted hover:border-[#bdb8b0] sm:flex"
            >
              <Search size={13} />
              <span>Search jobs</span>
              <kbd className="ml-2 rounded border border-line px-1 font-mono text-[10px] text-muted">/</kbd>
            </Link>
            <Link
              href="/dashboard#activity"
              className="relative grid h-8 w-8 place-items-center rounded-md text-ink-soft hover:bg-[#f1eee9]"
              aria-label={`Activity${counts.unread ? `, ${counts.unread} unread` : ""}`}
            >
              <Bell size={15} />
              {counts.unread ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-clay-600" /> : null}
            </Link>
            <div className="ml-1 flex items-center gap-2 border-l border-line pl-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#e8e3da] text-[11px] font-semibold text-ink">{initials}</span>
              <span className="hidden text-[12px] font-medium text-ink sm:block">{user.name.split(" ")[0]}</span>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-[#f1eee9] hover:text-ink" aria-label="Sign out">
                  <LogOut size={14} />
                </button>
              </form>
            </div>
          </div>
        </div>
        <MobileNav pendingApprovals={counts.pendingApprovals} />
      </header>

      {paused ? (
        <div className="border-b border-clay-100 bg-clay-50">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[12px] text-clay-700 sm:px-6">
            <span className="font-semibold">Daily search paused.</span>
            <span className="text-clay-700/80">You can still run one manually.</span>
            <Link href="/settings#schedule" className="ml-auto font-semibold underline">
              Resume automation
            </Link>
          </div>
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:py-9">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({
  title,
  count,
  action,
}: {
  title: string;
  count?: number | string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold text-ink">
        {title}
        {count !== undefined ? <span className="ml-1.5 font-normal text-muted">{count}</span> : null}
      </h2>
      {action}
    </div>
  );
}
