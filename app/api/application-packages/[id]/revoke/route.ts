import { revokeApproval } from "@/lib/approvals";
import { json, withUser } from "@/lib/api";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const { id } = await params;
    revokeApproval(user.id, id);
    return json({ ok: true });
  });
}
