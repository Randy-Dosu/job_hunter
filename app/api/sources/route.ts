import { all } from "@/lib/db";
import { json, withUser } from "@/lib/api";

export async function GET() {
  return withUser(async () =>
    json({
      sources: all(
        "SELECT id, name, slug, source_type, access_method, terms_url, terms_reviewed_at, enabled, supported_markets, notes, last_run_at, last_status FROM job_sources ORDER BY name",
      ),
    }),
  );
}
