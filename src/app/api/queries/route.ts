// POST /api/queries: step 1 only (question -> 2-3 Arabic search queries), so the browser can
// search Dorar before the main request. User questions are never stored or logged.

import { rewriteQuestion } from "@/lib/pipeline";
import { MAX_QUESTION_LENGTH } from "@/lib/limits";
import { loadManifest } from "@/lib/corpus";
import { clientIp, rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let question = "";
  try {
    const body = (await req.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch {
    return Response.json({ message: "تعذّرت قراءة الطلب." }, { status: 400 });
  }
  if (question.length < 4) return Response.json({ message: "اكتب السؤال أولًا." }, { status: 400 });
  if (question.length > MAX_QUESTION_LENGTH)
    return Response.json({ message: `السؤال أطول من ${MAX_QUESTION_LENGTH} حرف. اختصره من فضلك.` }, { status: 400 });
  if (rateLimited(clientIp(req))) return Response.json({ message: "أسئلة كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة." }, { status: 429 });
  if (loadManifest().length === 0) return Response.json({ message: "لم تُضف المصادر المعتمدة بعد، فلا يمكن البحث الآن." }, { status: 503 });
  try {
    return Response.json({ queries: await rewriteQuestion(question) });
  } catch (e) {
    console.error("queries failed", e instanceof Error ? e.name : "unknown");
    return Response.json({ message: "حدث خطأ أثناء إعداد البحث. أعد المحاولة بعد قليل." }, { status: 500 });
  }
}
