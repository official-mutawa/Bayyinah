// Structured-output calls for v2 stages (REST through fetch, no SDK). Never logs keys or questions.
// OpenAI for planning, grading, analysis and writing; the support reviewer may be Anthropic or
// Google (another model family) when its key is configured.

import { OpenAIError } from "../openai.ts";

export interface CallMeta {
  provider: string;
  model: string;
  ms: number;
  input: number;
  output: number;
}

export interface StructuredCall {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
  model: string;
  effort?: "low" | "medium" | "high";
  maxOutputTokens?: number;
  timeoutMs?: number;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.json();
      const detail = await res.text();
      if (detail.includes("insufficient_quota")) throw new OpenAIError("No credits (insufficient_quota)", 402);
      // A rate limit is never retried here: the caller fails closed and the eval stops.
      if (res.status === 429) throw new OpenAIError("Rate limited (429)", 429);
      if (res.status < 500) throw new OpenAIError(`${new URL(url).host} ${res.status}: ${detail.slice(0, 300)}`, res.status);
      last = new OpenAIError(`${new URL(url).host} ${res.status}`, res.status);
    } catch (e) {
      if (e instanceof OpenAIError && e.status < 500) throw e;
      last = e;
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1) ** 2));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function openaiStructured<T>(c: StructuredCall): Promise<{ data: T; meta: CallMeta }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new OpenAIError("OPENAI_API_KEY is not set", 0);
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: c.model,
    instructions: c.instructions,
    input: c.input,
    store: false,
    max_output_tokens: c.maxOutputTokens ?? 8000,
    text: { format: { type: "json_schema", name: c.name, schema: c.schema, strict: true } },
  };
  if (/^(gpt-5|o\d)/.test(c.model)) body.reasoning = { effort: c.effort ?? "low" };
  const data = (await postJson("https://api.openai.com/v1/responses", { Authorization: `Bearer ${key}` }, body, c.timeoutMs ?? 90000)) as {
    output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
    usage?: { input_tokens: number; output_tokens: number };
    status?: string;
    incomplete_details?: { reason?: string };
  };
  const meta = { provider: "openai", model: c.model, ms: Date.now() - started, input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 };
  if (data.status === "incomplete") throw new OpenAIError(`Incomplete response (${data.incomplete_details?.reason ?? "unknown"})`, 200);
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "refusal") throw new OpenAIError(`Model refused: ${part.refusal ?? ""}`, 200);
      if (part.type === "output_text" && part.text) return { data: JSON.parse(part.text) as T, meta };
    }
  }
  throw new OpenAIError("No structured output in response", 200);
}

/** Anthropic Messages API with a single forced tool whose input schema is the output schema. */
export async function anthropicStructured<T>(c: StructuredCall): Promise<{ data: T; meta: CallMeta }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new OpenAIError("ANTHROPIC_API_KEY is not set", 0);
  const started = Date.now();
  const data = (await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    {
      model: c.model,
      max_tokens: c.maxOutputTokens ?? 4000,
      system: c.instructions,
      messages: [{ role: "user", content: c.input }],
      tools: [{ name: c.name, description: "Return the result in this exact structure.", input_schema: c.schema }],
      tool_choice: { type: "tool", name: c.name },
    },
    c.timeoutMs ?? 90000
  )) as { content?: { type: string; name?: string; input?: unknown }[]; usage?: { input_tokens: number; output_tokens: number } };
  const meta = { provider: "anthropic", model: c.model, ms: Date.now() - started, input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 };
  const tool = data.content?.find((x) => x.type === "tool_use" && x.name === c.name);
  if (!tool) throw new OpenAIError("No tool output from reviewer", 200);
  return { data: tool.input as T, meta };
}

/** Google Gemini generateContent with a JSON response schema. */
export async function geminiStructured<T>(c: StructuredCall): Promise<{ data: T; meta: CallMeta }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new OpenAIError("GEMINI_API_KEY is not set", 0);
  const started = Date.now();
  const strip = (s: unknown): unknown => {
    // Gemini's schema subset has no additionalProperties.
    if (Array.isArray(s)) return s.map(strip);
    if (s && typeof s === "object") return Object.fromEntries(Object.entries(s).filter(([k]) => k !== "additionalProperties").map(([k, v]) => [k, strip(v)]));
    return s;
  };
  const data = (await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`,
    { "x-goog-api-key": key },
    {
      systemInstruction: { parts: [{ text: c.instructions }] },
      contents: [{ role: "user", parts: [{ text: c.input }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: strip(c.schema), maxOutputTokens: c.maxOutputTokens ?? 4000 },
    },
    c.timeoutMs ?? 90000
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const meta = { provider: "google", model: c.model, ms: Date.now() - started, input: data.usageMetadata?.promptTokenCount ?? 0, output: data.usageMetadata?.candidatesTokenCount ?? 0 };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new OpenAIError("No output from reviewer", 200);
  return { data: JSON.parse(text) as T, meta };
}
