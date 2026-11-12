import { getProfileContext } from "@/lib/profile";
import { savePreferences } from "@/lib/preferences";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";

export async function GET() {
  return withUser(async (user) => json({ preferences: getProfileContext(user.id).preferences }));
}

export async function PUT(request: Request) {
  return withUser(async (user) => {
    const body = await request.json().catch(() => ({}));
    const result = savePreferences(user.id, body);
    if (!result.ok) return fail(result.error, 422);
    audit(user.id, "preferences.updated", "job_preferences", user.id);
    return json({ ok: true });
  });
}
