// POST /api/queries: step 1 only, so the browser can search Dorar before the main request.
// v1: question -> 2-3 Arabic search queries. v2 (BAYYINAH_PIPELINE=v2): the full question plan,
// whose hadith queries the browser uses. User questions are never stored or logged.

import { rewriteQuestion } from "@/lib/pipeline";
import { MAX_QUESTION_LENGTH } from "@/lib/limits";
import { loadManifest } from "@/lib/corpus";
import { clientIp, rateLimited } from "@/lib/ratelimit";
import { pipelineVersion } from "@/lib/v2/config";
import { plan } from "@/lib/v2/planner";

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
    if (pipelineVersion() === "v2") {
      const r = await plan(question);
      return Response.json({ version: "v2", plan: r.plan, queries: r.plan.queries.hadith });
    }
    return Response.json({ queries: await rewriteQuestion(question) });
  } catch (e) {
    console.error("queries failed", e instanceof Error ? e.name : "unknown");
    return Response.json({ message: "حدث خطأ أثناء إعداد البحث. أعد المحاولة بعد قليل." }, { status: 500 });
  }
}
