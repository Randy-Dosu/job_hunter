import { z } from "zod";
import { approvePackage } from "@/lib/approvals";
import { fail, json, withUser } from "@/lib/api";

const schema = z.object({
  confirm: z.literal(true),
  method: z.enum(["explicit_click", "typed_confirmation"]).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Approval must be explicit.", 422);
    const result = approvePackage(user.id, id, parsed.data.method ?? "explicit_click");
    if (!result.ok) return fail(result.error ?? "Could not approve", result.code === "not_found" ? 404 : 409, { code: result.code });
    return json({ ok: true });
  });
}
