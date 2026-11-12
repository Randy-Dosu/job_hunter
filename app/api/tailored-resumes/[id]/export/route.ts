import { get, parseJson } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { renderDocx, renderPdf } from "@/lib/resume/render";
import { resumeToText } from "@/lib/resume/grounding";
import type { TailoredResumeContent } from "@/lib/resume/types";

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "resume";
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return fail("Sign in to download.", 401);
  const { id } = await params;
  const row = get<{
    id: string;
    structured_content_json: string;
    status: string;
  }>("SELECT * FROM tailored_resumes WHERE id = ? AND user_id = ?", id, user.id);
  if (!row) return fail("Resume not found.", 404);

  const content = parseJson<TailoredResumeContent>(row.structured_content_json, {} as TailoredResumeContent);
  const format = new URL(request.url).searchParams.get("format") ?? "pdf";
  const filename = `${slug(content.header.name)}-${slug(content.target.company)}`;
  audit(user.id, "resume.exported", "tailored_resume", id, { format });

  if (format === "docx") {
    const buffer = await renderDocx(content);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${filename}.docx"`,
      },
    });
  }
  if (format === "txt") {
    return new Response(resumeToText(content), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}.txt"`,
      },
    });
  }
  const pdf = await renderPdf(content);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}.pdf"`,
    },
  });
}
