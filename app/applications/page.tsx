import Link from "next/link";
import { CalendarClock, KanbanSquare } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ApplicationRow } from "@/components/application-row";
import { EmptyState, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";

const GROUPS: { key: string[]; label: string; hint: string }[] = [
  { key: ["saved", "reviewing", "preparing", "approved"], label: "In preparation", hint: "Saved, reviewed or assembled — not yet sent" },
  { key: ["awaiting_manual_completion", "confirmation_pending"], label: "Awaiting your manual action", hint: "Finish on the employer page, then record the reference" },
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
    awaiting: applications.filter((app) => ["awaiting_manual_completion", "confirmation_pending"].includes(app.status)).length,
    preparing: applications.filter((app) => ["saved", "reviewing", "preparing", "approved"].includes(app.status)).length,
  };

  return (
    <AppShell>
      <PageHeader
        title="Tracker"
        description="What you prepared, what you sent, and what happened next. You always control the record."
        meta={
          <>
            <span>{applications.length} applications</span>
            <span className="text-line-strong">/</span>
            <span className="text-muted">manual outcomes allowed at every stage</span>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-3 divide-x divide-line rounded-[10px] border border-line bg-surface py-3">
        <Stat label="Active" value={counts.active} hint="Submitted or interviewing" />
        <Stat label="Awaiting you" value={counts.awaiting} hint="Finish on the employer site" />
        <Stat label="In preparation" value={counts.preparing} hint="Approved, not yet sent" />
      </div>

      {applications.length ? (
        <div className="space-y-6">
          {GROUPS.map((group) => {
            const rows = applications.filter((app) => group.key.includes(app.status));
            if (!rows.length) return null;
            return (
              <section key={group.label}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 className="text-[13px] font-semibold text-ink">
                    {group.label}
                    <span className="ml-1.5 font-normal text-muted">{rows.length}</span>
                  </h2>
                  <p className="text-[11px] text-muted">{group.hint}</p>
                </div>
                <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
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
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<KanbanSquare size={16} />}
          title="No applications yet"
          description="Approving a package creates a tracker entry here. Nothing is logged as submitted until you confirm it happened."
          action={{ href: "/jobs", label: "Browse matches" }}
        />
      )}

      <section className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-[#fbfaf8] px-4 py-3 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock size={13} /> Reminders are opt-in — set a next action on any application to keep it visible.
        </span>
        <Link href="/settings#notifications" className="font-medium text-ink hover:underline">
          Notification settings
        </Link>
      </section>
    </AppShell>
  );
}
