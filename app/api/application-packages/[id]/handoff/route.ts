import { handoffPackage } from "@/lib/approvals";
import { fail, json, withUser } from "@/lib/api";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const result = handoffPackage(user.id, id);
    if (!result.ok) return fail(result.error ?? "Cannot open application", 409, { code: result.code });
    return json({ ok: true, destinationUrl: result.destinationUrl });
  });
}
