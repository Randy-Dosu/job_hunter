import { z } from "zod";
import { rejectPackage } from "@/lib/approvals";
import { fail, json, withUser } from "@/lib/api";

const schema = z.object({ reason: z.string().max(300).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Use 300 characters or fewer for the reason.", 422);
    const result = rejectPackage(user.id, id, parsed.data.reason ?? "");
    if (!result.ok) return fail(result.error ?? "Could not reject this package", result.code === "not_found" ? 404 : 409, { code: result.code });
    return json({ ok: true });
  });
}
