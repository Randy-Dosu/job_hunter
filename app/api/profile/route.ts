import { z } from "zod";
import { bool, nowIso, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getProfileContext } from "@/lib/profile";
import { fail, json, withUser } from "@/lib/api";
import { savePreferences } from "@/lib/preferences";

const profileSchema = z.object({
  headline: z.string().max(160).optional(),
  summary: z.string().max(2000).optional(),
  location: z.string().max(120).optional(),
  phone: z.string().max(60).optional(),
  workAuthorization: z.string().max(400).optional(),
  needsSponsorship: z.boolean().optional(),
  timezone: z.string().max(80).optional(),
});

export async function GET() {
  return withUser(async (user) => {
    const context = getProfileContext(user.id);
    return json({ profile: context.profile, preferences: context.preferences, evidenceCount: context.evidence.length });
  });
}

export async function PUT(request: Request) {
  return withUser(async (user) => {
    const body = await request.json().catch(() => ({}));
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) return fail("Some profile fields are invalid.", 422, { issues: parsed.error.flatten() });
    const data = parsed.data;
    const context = getProfileContext(user.id);
    const profile = context.profile;
    run(
      `UPDATE candidate_profiles SET headline = ?, summary = ?, location = ?, phone = ?, work_authorization = ?, needs_sponsorship = ?, timezone = ?, updated_at = ? WHERE user_id = ?`,
      data.headline ?? profile.headline,
      data.summary ?? profile.summary,
      data.location ?? profile.location,
      data.phone ?? profile.phone,
      data.workAuthorization ?? profile.work_authorization,
      data.needsSponsorship !== undefined ? bool(data.needsSponsorship) : profile.needs_sponsorship,
      data.timezone ?? profile.timezone,
      nowIso(),
      user.id,
    );

    const preferences = (body as { preferences?: unknown }).preferences;

    if (preferences) {
      const result = savePreferences(user.id, preferences);
      if (!result.ok) return fail(result.error, 422);
    }
    audit(user.id, "profile.updated", "candidate_profile", profile.id, { fields: Object.keys(data) });
    return json({ ok: true });
  });
}
