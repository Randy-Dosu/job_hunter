import { savePackageForLater } from "@/lib/approvals";
import { fail, json, withUser } from "@/lib/api";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const result = savePackageForLater(user.id, id);
    if (!result.ok) return fail(result.error ?? "Could not save this package", result.code === "not_found" ? 404 : 409, { code: result.code });
    return json({ ok: true });
  });
}
