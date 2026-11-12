/**
 * Optional LLM provider (OpenAI-compatible). The product works fully without
 * it: matching, filtering, approvals and resume assembly are deterministic.
 * The model may only *reword* supplied evidence, never add facts.
 */
export function isLlmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_PROVIDER);
}

const PROVIDER_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
};

export async function rewriteSummaryWithLlm(input: {
  jobTitle: string;
  jobCompany: string;
  facts: { id: string; label: string; detail: string }[];
  draft: string;
}): Promise<{ text: string | null; model?: string; error?: string }> {
  const provider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  const base = PROVIDER_BASE[provider];
  if (!base) return { text: null, error: `unsupported provider "${provider}"` };
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";

  const system = [
    "You rewrite a resume summary for a job application.",
    "You may only use the VERIFIED FACTS provided.",
    "Never invent skills, employers, dates, metrics, certifications or degrees.",
    "Do not add numbers that are not present in the facts.",
    "Do not name the target company as a past employer.",
    "Write 3 sentences, first person, plain professional English.",
    "Return JSON of the form {\"summary\": \"...\"} and nothing else.",
  ].join(" ");

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              targetRole: input.jobTitle,
              targetCompany: input.jobCompany,
              verifiedFacts: input.facts,
              currentDraft: input.draft,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { text: null, error: `HTTP ${res.status}` };
    const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return { text: null, error: "empty response" };
    const parsed = JSON.parse(raw) as { summary?: string };
    const text = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    return text ? { text, model } : { text: null, error: "missing summary field" };
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : "request failed" };
  }
}
