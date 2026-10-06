// Cost and rate-limit guard for local eval runs. Wraps global fetch for api.openai.com only:
// reads the `usage` block of each response, prices it, appends one line to a local ledger
// (gitignored), and raises a stop flag on any 429 so expensive runs halt before they can
// affect the live site that shares the same key. Never reads, logs or stores the API key.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** USD per 1M tokens, from https://developers.openai.com/api/docs/pricing (checked 2026-10-07). */
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4": { input: 2.5, cached: 0.25, output: 15 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
  "text-embedding-3-small": { input: 0.02, cached: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, cached: 0.13, output: 0 },
};

export const LEDGER = path.join(process.cwd(), "local", "eval", "spend-ledger.jsonl");

export interface CallRecord {
  t: string;
  run: string;
  endpoint: string;
  model: string;
  status: number;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  usd: number;
  ms: number;
}

export const usage = {
  run: "unnamed",
  calls: [] as CallRecord[],
  rateLimited: false,
  /** Abort further model calls once this many USD were spent in this process. */
  budgetUsd: Number(process.env.EVAL_BUDGET_USD ?? 10),
  get usd() {
    return this.calls.reduce((s, c) => s + c.usd, 0);
  },
  since(mark: number) {
    const c = this.calls.slice(mark);
    return {
      calls: c.length,
      input: c.reduce((s, x) => s + x.input, 0),
      cached: c.reduce((s, x) => s + x.cached, 0),
      output: c.reduce((s, x) => s + x.output, 0),
      usd: Number(c.reduce((s, x) => s + x.usd, 0).toFixed(5)),
    };
  },
};

export class BudgetError extends Error {}

function price(model: string, input: number, cached: number, output: number): number {
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  const p = key ? PRICES[key] : PRICES["gpt-5.4"]; // unknown model: price conservatively
  return ((input - cached) * p.input + cached * p.cached + output * p.output) / 1e6;
}

let installed = false;

/** Install the fetch wrapper once per process. */
export function installUsageTracking(run: string): void {
  usage.run = run;
  if (installed) return;
  installed = true;
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.openai.com/")) return original(input, init);
    if (usage.rateLimited) throw new BudgetError("Stopped: a rate limit was hit earlier in this run");
    if (usage.usd >= usage.budgetUsd) throw new BudgetError(`Stopped: run budget of $${usage.budgetUsd} reached`);
    const started = Date.now();
    const res = await original(input, init);
    const endpoint = url.replace("https://api.openai.com/v1/", "").split("?")[0];
    let model = "";
    try {
      model = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "";
    } catch {
      model = "";
    }
    const rec: CallRecord = { t: new Date().toISOString(), run: usage.run, endpoint, model, status: res.status, input: 0, cached: 0, output: 0, reasoning: 0, usd: 0, ms: Date.now() - started };
    if (res.status === 429) usage.rateLimited = true;
    if (res.ok && endpoint !== "models" && !endpoint.startsWith("models/")) {
      try {
        const data = (await res.clone().json()) as {
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            prompt_tokens?: number;
            input_tokens_details?: { cached_tokens?: number };
            output_tokens_details?: { reasoning_tokens?: number };
          };
        };
        const u = data.usage ?? {};
        rec.input = u.input_tokens ?? u.prompt_tokens ?? 0;
        rec.cached = u.input_tokens_details?.cached_tokens ?? 0;
        rec.output = u.output_tokens ?? 0;
        rec.reasoning = u.output_tokens_details?.reasoning_tokens ?? 0;
        rec.usd = Number(price(model, rec.input, rec.cached, rec.output).toFixed(6));
      } catch {
        // Unreadable body: keep the zero-cost record so the call is still counted.
      }
    }
    usage.calls.push(rec);
    appendFileSync(LEDGER, JSON.stringify(rec) + "\n");
    return res;
  };
}

/** Total spent across every local run so far, from the ledger. */
export function ledgerTotal(): { calls: number; usd: number; rateLimits: number } {
  if (!existsSync(LEDGER)) return { calls: 0, usd: 0, rateLimits: 0 };
  const rows = readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CallRecord);
  return { calls: rows.length, usd: Number(rows.reduce((s, r) => s + r.usd, 0).toFixed(4)), rateLimits: rows.filter((r) => r.status === 429).length };
}

/** Load .env.local into process.env without printing anything. */
export function loadLocalEnv(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set in .env.local");
}
