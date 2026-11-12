import { all, get, insert, nowIso, run, uid } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, json, withUser } from "@/lib/api";
import { extractDocxText, extractPdfText, parseResumeText } from "@/lib/resume/parse";

const MAX_BYTES = 6 * 1024 * 1024;

export async function GET() {
  return withUser(async (user) =>
    json({
      resumes: all(
        "SELECT id, filename, file_type, version, is_base, parse_status, created_at FROM resume_documents WHERE user_id = ? ORDER BY created_at DESC",
        user.id,
      ),
    }),
  );
}

export async function POST(request: Request) {
  return withUser(async (user) => {
    const contentType = request.headers.get("content-type") ?? "";
    let text = "";
    let filename = "pasted-resume.txt";
    let fileType = "text/plain";
    const warnings: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return fail("Attach a resume file.", 422);
      if (file.size > MAX_BYTES) return fail("That file is larger than 6 MB.", 413);
      filename = file.name || "resume";
      const buffer = Buffer.from(await file.arrayBuffer());
      const lower = filename.toLowerCase();

      if (lower.endsWith(".pdf")) {
        const result = extractPdfText(buffer);
        text = result.text;
        fileType = "application/pdf";
        if (!result.ok) {
          return fail(
            "This PDF is image-based or uses an unsupported encoding, so we could not read its text. Paste your resume text instead — we will never guess at your experience.",
            422,
          );
        }
      } else if (lower.endsWith(".docx")) {
        const result = extractDocxText(buffer);
        text = result.text;
        fileType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (!result.ok) return fail("We could not read that DOCX file. Paste your resume text instead.", 422);
      } else {
        text = buffer.toString("utf8");
        fileType = lower.endsWith(".md") ? "text/markdown" : "text/plain";
      }
    } else {
      const body = (await request.json().catch(() => ({}))) as { text?: string; filename?: string };
      text = (body.text ?? "").trim();
      filename = body.filename ?? filename;
      if (text.length < 40) return fail("Add a little more resume text so we can extract something useful.", 422);
    }

    text = text.replace(/\u0000/g, "").trim();
    if (text.length < 40) return fail("That file did not contain readable text. Paste your resume text instead.", 422);

    const parsed = parseResumeText(text);
    const previousBase = get<{ id: string; version: number }>(
      "SELECT id, version FROM resume_documents WHERE user_id = ? AND is_base = 1 ORDER BY version DESC LIMIT 1",
      user.id,
    );
    const version = (previousBase?.version ?? 0) + 1;
    const documentId = uid();
    if (previousBase) run("UPDATE resume_documents SET is_base = 0 WHERE user_id = ? AND is_base = 1", user.id);
    insert("resume_documents", {
      id: documentId,
      user_id: user.id,
      filename,
      file_type: fileType,
      content_text: text.slice(0, 60_000),
      version,
      is_base: 1,
      parse_status: parsed.facts.length ? "parsed" : "needs_review",
      created_at: nowIso(),
    });
    audit(user.id, "resume.uploaded", "resume_document", documentId, { filename, version, facts: parsed.facts.length });
    return json({ documentId, version, parsed: { ...parsed, warnings: [...parsed.warnings, ...warnings] } });
  });
}
