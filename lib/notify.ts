import { all, get, insert, nowIso, run, uid } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Notification delivery.
 *
 * In-app rows are always written (they are the audit-friendly record). Email is
 * attempted only when a provider is configured and the user opted in; when it
 * is not configured the row is stored with `delivery_status = 'suppressed'` and
 * a human-readable reason, never silently dropped and never faked as sent.
 */

export type NotificationType = "digest" | "deadline" | "job_changed" | "reminder" | "vacancy_closed";
export type Channel = "in_app" | "email" | "both";

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  channel?: Channel;
  dedupeKey?: string;
};

export type NotifyResult = {
  id: string;
  deduped: boolean;
  channel: string;
  deliveryStatus: string;
  deliveryError?: string;
};

type EmailResult = { ok: true } | { ok: false; suppressed: boolean; error: string };

const EMAIL_TIMEOUT_MS = 8000;

/** Provider call. Kept isolated so tests can stub `fetch` instead of the network. */
async function sendEmail(input: { to: string; subject: string; text: string }): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM;
  if (!apiKey || !from) {
    return { ok: false, suppressed: true, error: "No email provider configured (RESEND_API_KEY / NOTIFY_FROM)." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, suppressed: false, error: `Provider responded ${response.status} ${detail.slice(0, 160)}`.trim() };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      suppressed: false,
      error: error instanceof Error ? error.message.slice(0, 160) : "Email delivery failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const key = input.dedupeKey ?? null;
  if (key) {
    const existing = get<{ id: string; channel: string; delivery_status: string; delivery_error: string }>(
      "SELECT id, channel, delivery_status, delivery_error FROM notifications WHERE user_id = ? AND dedupe_key = ?",
      input.userId,
      key,
    );
    if (existing) {
      return {
        id: existing.id,
        deduped: true,
        channel: existing.channel,
        deliveryStatus: existing.delivery_status,
        deliveryError: existing.delivery_error || undefined,
      };
    }
  }

  const prefs = get<{ notify_email: number; notify_in_app: number }>(
    "SELECT notify_email, notify_in_app FROM job_preferences WHERE user_id = ?",
    input.userId,
  );
  const inAppWanted = input.channel !== "email" && (prefs?.notify_in_app ?? 1) === 1;
  const emailWanted = input.channel === "email" || input.channel === "both";

  const channel: Channel = emailWanted && inAppWanted ? "both" : emailWanted ? "email" : "in_app";
  let deliveryStatus = "stored";
  let deliveryError = "";

  if (emailWanted) {
    if ((prefs?.notify_email ?? 0) !== 1) {
      deliveryStatus = "suppressed";
      deliveryError = "Email notifications are turned off in settings.";
    } else {
      const user = get<{ email: string }>("SELECT email FROM users WHERE id = ?", input.userId);
      if (!user) {
        deliveryStatus = "suppressed";
        deliveryError = "No email address on file.";
      } else {
        const result = await sendEmail({
          to: user.email,
          subject: `Job Hunter — ${input.title}`,
          text: `${input.title}\n\n${input.body ?? ""}\n\nOpen Job Hunter to review and act. Nothing is submitted without your approval.`,
        });
        if (result.ok) {
          deliveryStatus = "sent";
        } else {
          deliveryStatus = result.suppressed ? "suppressed" : "failed";
          deliveryError = result.error;
        }
      }
    }
  }

  const id = uid();
  try {
    insert("notifications", {
      id,
      user_id: input.userId,
      type: input.type,
      title: input.title.slice(0, 200),
      body: (input.body ?? "").slice(0, 2000),
      payload_json: JSON.stringify(input.payload ?? {}),
      channel,
      delivery_status: deliveryStatus,
      delivery_error: deliveryError.slice(0, 300),
      delivered_at: deliveryStatus === "sent" ? nowIso() : null,
      dedupe_key: key,
      read_at: null,
      created_at: nowIso(),
    });
  } catch {
    // A concurrent tick created the same dedupe key first; use that row.
    const existing = key
      ? get<{ id: string; channel: string; delivery_status: string; delivery_error: string }>(
          "SELECT id, channel, delivery_status, delivery_error FROM notifications WHERE user_id = ? AND dedupe_key = ?",
          input.userId,
          key,
        )
      : undefined;
    if (existing) {
      return {
        id: existing.id,
        deduped: true,
        channel: existing.channel,
        deliveryStatus: existing.delivery_status,
        deliveryError: existing.delivery_error || undefined,
      };
    }
    throw new Error("Could not record notification");
  }

  audit(input.userId, `notification.${input.type}`, "notification", id, {
    channel,
    deliveryStatus,
    ...(deliveryError ? { deliveryError } : {}),
  });
  return { id, deduped: false, channel, deliveryStatus, deliveryError: deliveryError || undefined };
}

const DEADLINE_WINDOW_MS = 72 * 3_600_000;

/** Closing deadlines for strong/possible matches (FR-051). */
async function deadlineAlerts(userId: string, now: Date) {
  const horizon = new Date(now.getTime() + DEADLINE_WINDOW_MS).toISOString();
  const rows = all<{ job_id: string; title: string; company: string; deadline: string; score: number; verdict: string }>(
    `SELECT m.job_id, j.title, j.company, j.deadline, m.score, m.verdict
     FROM job_matches m JOIN jobs j ON j.id = m.job_id
     WHERE m.user_id = ? AND j.status = 'open' AND j.deadline IS NOT NULL
       AND m.verdict IN ('strong','possible')
     ORDER BY j.deadline ASC`,
    userId,
  );
  let sent = 0;
  for (const row of rows) {
    const deadline = new Date(row.deadline);
    if (Number.isNaN(deadline.getTime())) continue;
    if (deadline.getTime() < now.getTime() || deadline.toISOString() > horizon) continue;
    const when = deadline.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const result = await notify({
      userId,
      type: "deadline",
      title: `Closing ${when}: ${row.title} at ${row.company}`,
      body: `This ${Math.round(row.score)}% match closes in under three days. Decide whether to tailor an application now.`,
      payload: { jobId: row.job_id, deadline: row.deadline },
      channel: "both",
      dedupeKey: `deadline:${userId}:${row.job_id}:${deadline.toISOString().slice(0, 10)}`,
    });
    if (!result.deduped) sent += 1;
  }
  return sent;
}

/** Follow-up reminders the user scheduled with a next action (FR-054). */
async function followUpReminders(userId: string, now: Date) {
  const due = all<{ id: string; job_id: string; next_action: string; next_action_at: string; title: string; company: string }>(
    `SELECT a.id, a.job_id, a.next_action, a.next_action_at, j.title, j.company
     FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = ? AND a.next_action_at IS NOT NULL AND a.next_action_at <= ?
       AND a.reminder_sent_at IS NULL
       AND a.status NOT IN ('submitted','interview','offer','rejected','withdrawn','closed')`,
    userId,
    now.toISOString(),
  );
  let sent = 0;
  for (const row of due) {
    const result = await notify({
      userId,
      type: "reminder",
      title: `Follow up: ${row.title} at ${row.company}`,
      body: row.next_action || "Your next step is due.",
      payload: { applicationId: row.id, jobId: row.job_id },
      channel: "both",
      dedupeKey: `reminder:${row.id}:${row.next_action_at}`,
    });
    if (!result.deduped) sent += 1;
    // The prompt was raised in-app, so record it even if email delivery failed.
    run("UPDATE applications SET reminder_sent_at = ? WHERE id = ?", nowIso(), row.id);
  }
  return sent;
}

export type AlertSweepResult = { deadlines: number; reminders: number };

export async function runAlertSweep(now: Date = new Date(), userId?: string): Promise<AlertSweepResult> {
  const users = userId ? [{ id: userId }] : all<{ id: string }>("SELECT id FROM users");
  let deadlines = 0;
  let reminders = 0;
  for (const user of users) {
    deadlines += await deadlineAlerts(user.id, now);
    reminders += await followUpReminders(user.id, now);
  }
  return { deadlines, reminders };
}
