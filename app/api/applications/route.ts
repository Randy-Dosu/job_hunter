import { all } from "@/lib/db";
import { json, withUser } from "@/lib/api";

export async function GET() {
  return withUser(async (user) =>
    json({
      applications: all(
        `SELECT a.*, j.title, j.company, j.canonical_url
         FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE a.user_id = ? ORDER BY a.last_updated_at DESC`,
        user.id,
      ),
    }),
  );
}
