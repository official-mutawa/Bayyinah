// Minimal OpenAI REST client (no SDK). Never logs the API key or user questions.

// Defaults verified against the models endpoint on 2026-10-06.
export const DEFAULT_MODEL = "gpt-5.4-mini";
export const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 256;

export function chatModel(): string {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

export function embedModel(): string {
  return process.env.OPENAI_EMBED_MODEL || DEFAULT_EMBED_MODEL;
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new OpenAIError("OPENAI_API_KEY is not set", 0);
  return key;
}

export class OpenAIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function post<T>(endpoint: string, body: unknown, timeoutMs: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.openai.com/v1/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      const detail = await res.text();
      // Retry only on rate limits and server errors; an empty balance is not retryable.
      if (detail.includes("insufficient_quota")) throw new OpenAIError("OpenAI account has no credits (insufficient_quota)", 402);
      if (res.status !== 429 && res.status < 500) {
        throw new OpenAIError(`OpenAI ${endpoint} ${res.status}: ${detail.slice(0, 300)}`, res.status);
      }
      lastError = new OpenAIError(`OpenAI ${endpoint} ${res.status}`, res.status);
    } catch (e) {
      // Non-retryable API errors (bad request, auth, no credits, missing key) propagate at once.
      if (e instanceof OpenAIError && e.status !== 429 && e.status < 500) throw e;
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1) ** 2));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model);
}

interface ResponsesOutput {
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Call the Responses API with a strict JSON Schema and return the parsed object.
 */
export async function structuredResponse<T>(opts: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
  effort?: "low" | "medium";
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<T> {
  const model = chatModel();
  const body: Record<string, unknown> = {
    model,
    instructions: opts.instructions,
    input: opts.input,
    store: false,
    max_output_tokens: opts.maxOutputTokens ?? 8000,
    text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
  };
  if (isReasoningModel(model)) body.reasoning = { effort: opts.effort ?? "low" };
  const data = await post<ResponsesOutput>("responses", body, opts.timeoutMs ?? 60000);
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "refusal") throw new OpenAIError(`Model refused: ${c.refusal ?? ""}`, 200);
      if (c.type === "output_text" && c.text) return JSON.parse(c.text) as T;
    }
  }
  throw new OpenAIError("No structured output in response", 200);
}

/** Embed texts with reduced dimensions. Returns unit-length vectors. */
export async function embed(texts: string[], timeoutMs = 60000): Promise<Float32Array[]> {
  const data = await post<{ data: { index: number; embedding: number[] }[] }>(
    "embeddings",
    { model: embedModel(), input: texts, dimensions: EMBED_DIMS, encoding_format: "float" },
    timeoutMs
  );
  const out: Float32Array[] = new Array(texts.length);
  for (const d of data.data) {
    const v = Float32Array.from(d.embedding);
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= n;
    out[d.index] = v;
  }
  return out;
}

/** Check that a model id exists for this key, via the models endpoint. */
export async function modelExists(model: string): Promise<boolean> {
  const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(15000),
  });
  return res.ok;
}
