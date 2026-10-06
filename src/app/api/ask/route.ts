// POST /api/ask: streams newline-delimited JSON events (stages, then the result).
// User questions are never stored or logged.

import { ask } from "@/lib/pipeline";
import type { PipelineEvent } from "@/lib/pipeline";
import { OpenAIError } from "@/lib/openai";
import { MAX_QUESTION_LENGTH } from "@/lib/limits";
import { mockAsk, mockEnabled } from "@/lib/mock";
import { loadManifest } from "@/lib/corpus";
import { clientIp, rateLimited } from "@/lib/ratelimit";
import type { AskOptions } from "@/lib/pipeline";
import type { DorarItem } from "@/lib/dorar-parse";

export const runtime = "nodejs";
export const maxDuration = 120;

const MIN_QUESTION_LENGTH = 4;

function errorResponse(status: number, message: string) {
  return Response.json({ type: "error", message }, { status });
}

export async function POST(req: Request) {
  let question = "";
  const opts: AskOptions = {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  try {
    const body = (await req.json()) as { question?: unknown; queries?: unknown; hadith?: unknown; hadithFailed?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
    if (Array.isArray(body.queries)) opts.queries = body.queries.map((q) => str(q, 200).trim()).filter(Boolean).slice(0, 3);
    if (Array.isArray(body.hadith))
      opts.hadith = body.hadith.slice(0, 3).map((h: Record<string, unknown>): DorarItem => ({
        text: str(h?.text, 4000),
        narrator: str(h?.narrator, 200),
        muhaddith: str(h?.muhaddith, 200),
        book: str(h?.book, 200),
        locator: str(h?.locator, 100),
        grade: str(h?.grade, 300),
      })).filter((h) => h.text);
    opts.hadithFailed = body.hadithFailed === true;
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
        const result = mockEnabled() ? await mockAsk(question, send) : await ask(question, send, opts);
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
