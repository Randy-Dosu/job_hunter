import { z } from "zod";
import { fail, json, withUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createVariant, listVariants } from "@/lib/resume/variants";

const schema = z.object({
  name: z.string().min(2).max(60),
  roleFamily: z.string().max(60).optional(),
  emphasis: z.array(z.string().max(40)).max(12).optional(),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  return withUser(async (user) => json({ variants: listVariants(user.id) }));
}

export async function POST(request: Request) {
  return withUser(async (user) => {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("Check the variant name and emphasis words.", 422);
    const result = createVariant(user.id, parsed.data);
    if (!result.ok) return fail(result.error, 409);
    audit(user.id, "resume_variant.created", "resume_variant", result.variant.id, { name: result.variant.name });
    return json({ ok: true, variant: result.variant }, 201);
  });
}
