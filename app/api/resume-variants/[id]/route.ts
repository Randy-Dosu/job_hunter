import { fail, json, withUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteVariant } from "@/lib/resume/variants";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    const result = deleteVariant(user.id, id);
    if (!result.ok) return fail(result.error ?? "Variant not found.", 404);
    audit(user.id, "resume_variant.deleted", "resume_variant", id);
    return json({ ok: true });
  });
}
