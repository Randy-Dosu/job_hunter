import { fail, json } from "@/lib/api";
import { runDueSearches } from "@/lib/schedule";
import { recheckJobLiveness } from "@/lib/search";
import { runAlertSweep } from "@/lib/notify";

/**
 * Cron entry point. Call every 5–15 minutes:
 *   curl -X POST https://host/api/cron/search -H "authorization: Bearer $CRON_SECRET"
 *
 * A user's own schedule decides whether anything actually runs; `runSearch`
 * keeps it to one scheduled run per local day. The same tick re-checks vacancy
 * liveness and sends due alerts, so a single cron covers the whole day.
 */
function authorised(request: Request): { ok: true } | { ok: false; response: Response } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, response: fail("CRON_SECRET is not configured on this deployment.", 503) };
    }
    return { ok: true };
  }
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = new URL(request.url).searchParams.get("secret") ?? "";
  const provided = bearer || query;
  if (provided !== secret) return { ok: false, response: fail("Invalid cron credentials.", 401) };
  return { ok: true };
}

async function tick(request: Request) {
  const auth = authorised(request);
  if (!auth.ok) return auth.response;
  const startedAt = new Date();
  const liveness = await recheckJobLiveness(startedAt);
  const runs = await runDueSearches(startedAt);
  const alerts = await runAlertSweep();
  return json({
    ok: true,
    checkedAt: startedAt.toISOString(),
    liveness,
    runs,
    alerts,
  });
}

export async function POST(request: Request) {
  return tick(request);
}

export async function GET(request: Request) {
  return tick(request);
}
