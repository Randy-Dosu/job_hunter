import Link from "next/link";
import { CalendarClock, KanbanSquare } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ApplicationRow } from "@/components/application-row";
import { EmptyState, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";

const GROUPS: { key: string[]; label: string; hint: string }[] = [
  { key: ["preparing", "approved"], label: "In preparation", hint: "Assembled but not yet sent" },
  { key: ["awaiting_manual_completion"], label: "Awaiting your manual action", hint: "Open the employer page and finish the form" },
  { key: ["submitted", "interview", "offer"], label: "Active", hint: "Submitted or in conversation" },
  { key: ["rejected", "withdrawn", "closed"], label: "Closed", hint: "No further action" },
];

export default async function ApplicationsPage() {
  const user = await requireUser();
  const applications = all<{
    id: string;
    job_id: string;
    package_id: string | null;
    status: string;
    notes: string;
    next_action: string;
    next_action_at: string | null;
    submitted_at: string | null;
    confirmation_reference: string | null;
    last_updated_at: string;
    title: string;
    company: string;
    location: string;
    canonical_url: string;
  }>(
    `SELECT a.*, j.title, j.company, j.location, j.canonical_url
     FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = ? ORDER BY a.last_updated_at DESC`,
    user.id,
  );

  const counts = {
    active: applications.filter((app) => ["submitted", "interview", "offer"].includes(app.status)).length,
    awaiting: applications.filter((app) => app.status === "awaiting_manual_completion").length,
    preparing: applications.filter((app) => ["preparing", "approved"].includes(app.status)).length,
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Tracking"
        title="Application tracker"
        description="A record of what you prepared, what you sent, and what happened next. Manual outcomes are always allowed."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Active" value={counts.active} hint="Submitted or interviewing" />
        <Stat label="Awaiting you" value={counts.awaiting} hint="Finish on the employer site" />
        <Stat label="In preparation" value={counts.preparing} hint="Approved, not yet sent" />
      </div>

      <div className="mt-6 space-y-6">
        {GROUPS.map((group) => {
          const rows = applications.filter((app) => group.key.includes(app.status));
          return (
            <section key={group.label}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{group.label}</h2>
                <p className="text-[11px] text-slate-500">{group.hint}</p>
              </div>
              {rows.length ? (
                <div className="space-y-2.5">
                  {rows.map((app) => (
                    <ApplicationRow
                      key={app.id}
                      id={app.id}
                      title={app.title}
                      company={app.company}
                      location={app.location}
                      status={app.status}
                      notes={app.notes}
                      nextAction={app.next_action}
                      submittedAt={app.submitted_at}
                      confirmationReference={app.confirmation_reference}
                      lastUpdatedAt={app.last_updated_at}
                      packageId={app.package_id}
                      jobId={app.job_id}
                      sourceUrl={app.canonical_url}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-xs text-slate-500">
                  Nothing here yet.
                </p>
              )}
            </section>
          );
        })}
      </div>

      {!applications.length ? (
        <div className="mt-6">
          <EmptyState
            icon={<KanbanSquare size={20} />}
            title="No applications yet"
            description="Approving a package creates a tracker entry. Nothing is logged as submitted until you confirm it happened."
            action={{ href: "/jobs", label: "Browse matches" }}
          />
        </div>
      ) : null}

      <section className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 px-4 py-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock size={13} /> Reminders are opt-in. Set a next action on any application to keep it visible.
        </span>
        <Link href="/settings" className="font-semibold text-brand-600 hover:underline">
          Notification settings
        </Link>
      </section>
    </AppShell>
  );
}
