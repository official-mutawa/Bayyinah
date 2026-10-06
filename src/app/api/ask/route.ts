// POST /api/ask: streams newline-delimited JSON events (stages, then the result).
// User questions are never stored or logged.

import { ask } from "@/lib/pipeline";
import type { PipelineEvent } from "@/lib/pipeline";
import { OpenAIError } from "@/lib/openai";
import { MAX_QUESTION_LENGTH } from "@/lib/limits";
import { mockAsk, mockEnabled } from "@/lib/mock";
import { loadManifest } from "@/lib/corpus";

export const runtime = "nodejs";
export const maxDuration = 120;

const MIN_QUESTION_LENGTH = 4;

// Simple per-instance sliding-window rate limit per IP.
const WINDOWS = [
  { ms: 60_000, max: 8 },
  { ms: 3_600_000, max: 40 },
];
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOWS[WINDOWS.length - 1].ms);
  const blocked = WINDOWS.some((w) => list.filter((t) => now - t < w.ms).length >= w.max);
  if (!blocked) list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return blocked;
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

function errorResponse(status: number, message: string) {
  return Response.json({ type: "error", message }, { status });
}

export async function POST(req: Request) {
  let question = "";
  try {
    const body = (await req.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch {
    return errorResponse(400, "تعذّرت قراءة الطلب.");
  }
  if (question.length < MIN_QUESTION_LENGTH) return errorResponse(400, "اكتب السؤال أولًا.");
  if (question.length > MAX_QUESTION_LENGTH)
    return errorResponse(400, `السؤال أطول من ${MAX_QUESTION_LENGTH} حرف. اختصره من فضلك.`);
  if (rateLimited(clientIp(req))) return errorResponse(429, "أسئلة كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.");
  if (!mockEnabled() && loadManifest().length === 0)
    return errorResponse(503, "لم تُضف المصادر المعتمدة بعد، فلا يمكن البحث الآن.");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: PipelineEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        const result = mockEnabled() ? await mockAsk(question, send) : await ask(question, send);
        send({ type: "result", result });
      } catch (e) {
        // Log only the error kind, never the question.
        const status = e instanceof OpenAIError ? e.status : 0;
        console.error("ask failed", e instanceof Error ? e.name : "unknown", status);
        send({
          type: "error",
          message:
            status === 402
              ? "الخدمة متوقفة مؤقتًا. حاول لاحقًا."
              : status === 429
                ? "الخدمة مشغولة الآن. انتظر قليلًا ثم أعد المحاولة."
                : "حدث خطأ أثناء إعداد الإجابة. أعد المحاولة بعد قليل.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
