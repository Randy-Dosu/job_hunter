import { z } from "zod";
import { markSubmitted } from "@/lib/approvals";
import { fail, json, withUser } from "@/lib/api";

const schema = z.object({ confirmationReference: z.string().min(2).max(200) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Add the confirmation reference you received from the employer.", 422);
    const result = markSubmitted(user.id, id, parsed.data.confirmationReference);
    if (!result.ok) return fail(result.error ?? "Cannot record submission", 409, { code: result.code });
    return json({ ok: true });
  });
}
