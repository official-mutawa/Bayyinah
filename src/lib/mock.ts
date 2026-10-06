// Development-only mock of the /api/ask stream, for building the UI without sources or API calls.
// Enabled only when NODE_ENV is "development" and BAYYINAH_MOCK=1. All text is a labeled placeholder;
// nothing here is, or imitates, real Quran or hadith text.

import type { AskResult, PipelineEvent, RetrievedPassage } from "./pipeline.ts";

export function mockEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.BAYYINAH_MOCK === "1";
}

const PLACEHOLDER = "نص تجريبي لعرض الواجهة فقط، وليس نصًّا من المصادر.";

const passages: RetrievedPassage[] = [
  {
    id: "quran:1:1",
    sourceId: "quran",
    kind: "quran",
    sourceLabel: "مصدر تجريبي (قرآن)",
    refLabel: "سورة تجريبية ١",
    surah: 1,
    ayah: 1,
    text: `${PLACEHOLDER} هذه جملة الشاهد التجريبية داخل النص. ${PLACEHOLDER}`,
    grade: null,
    via: ["keyword", "meaning"],
  },
  {
    id: "demo-hadith:7",
    sourceId: "demo-hadith",
    kind: "hadith",
    sourceLabel: "مجموعة تجريبية",
    refLabel: "مجموعة تجريبية ٧",
    number: "7",
    text: `${PLACEHOLDER} ${PLACEHOLDER} وهنا موضع الاقتباس التجريبي الثاني في آخر النص.`,
    grade: "درجة تجريبية",
    via: ["meaning"],
  },
  {
    id: "demo-book:3",
    sourceId: "demo-book",
    kind: "text",
    sourceLabel: "كتاب تجريبي",
    refLabel: "كتاب تجريبي، مقطع ٣",
    number: "3",
    text: PLACEHOLDER,
    grade: null,
    via: ["keyword"],
  },
];

function span(p: RetrievedPassage, quote: string) {
  const start = p.text.indexOf(quote);
  return { passage_id: p.id, start, end: start + quote.length };
}

export async function mockAsk(question: string, emit: (e: PipelineEvent) => void): Promise<AskResult> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const abstain = question.includes("امتنع");
  const queries = ["عبارة بحث تجريبية أولى", "عبارة بحث تجريبية ثانية"];
  emit({ type: "stage", stage: "rewriting", state: "active" });
  await wait(700);
  emit({ type: "stage", stage: "rewriting", state: "done", queries });
  await wait(500);
  // Like the real pipeline: all sources are searched in memory, then reported back-to-back.
  for (const [id, label, kind, count] of [
    ["quran", "مصدر تجريبي (قرآن)", "quran", 4],
    ["demo-hadith", "مجموعة تجريبية", "hadith", 3],
    ["demo-book", "كتاب تجريبي", "text", 1],
  ] as const) {
    emit({ type: "stage", stage: "search", state: "active", source: { id, label, kind } });
    emit({ type: "stage", stage: "search", state: "done", source: { id, label, kind }, count });
  }
  emit({ type: "stage", stage: "drafting", state: "active" });
  await wait(7000);
  emit({ type: "stage", stage: "drafting", state: "done" });
  const base = {
    queries,
    passages,
    models: { chat: "mock", embed: "mock" },
    ms: 3200,
  };
  if (abstain) {
    return {
      ...base,
      status: "abstain",
      claims: [],
      abstain_reason: "هذا سبب امتناع تجريبي: النصوص المسترجعة لا تكفي للإجابة.",
      missing: "وصف تجريبي لما ينقص من أدلة.",
      verified: false,
      abstainCause: "model",
      attempts: [{ attempt: 1, status: "abstain", claims: 0, issues: [], verdicts: [] }],
    };
  }
  emit({ type: "stage", stage: "verifying", state: "active" });
  await wait(2500);
  emit({ type: "stage", stage: "verifying", state: "done", passed: 2, total: 2 });
  await wait(1200);
  const q1 = "هذه جملة الشاهد التجريبية داخل النص";
  const q2 = "وهنا موضع الاقتباس التجريبي الثاني";
  return {
    ...base,
    status: "answer",
    claims: [
      {
        text: "هذه جملة إجابة تجريبية أولى تستند إلى النص الأول، لعرض شكل الادعاء والاستشهاد.",
        passage_ids: ["quran:1:1"],
        supporting_quote: q1,
        match: span(passages[0], q1),
        codeCheck: "pass",
        modelCheck: { verdict: "supported", reason: "سبب تحقق تجريبي." },
      },
      {
        text: "وهذه جملة تجريبية ثانية تستند إلى نصين، لعرض أكثر من شارة استشهاد.",
        passage_ids: ["demo-hadith:7", "demo-book:3"],
        supporting_quote: q2,
        match: span(passages[1], q2),
        codeCheck: "pass",
        modelCheck: { verdict: "supported", reason: "سبب تحقق تجريبي." },
      },
    ],
    abstain_reason: "",
    missing: "",
    verified: true,
    abstainCause: null,
    attempts: [
      {
        attempt: 1,
        status: "answer",
        claims: 2,
        issues: [],
        verdicts: [
          { claim: "جملة تجريبية أولى", verdict: "supported", reason: "سبب تحقق تجريبي." },
          { claim: "جملة تجريبية ثانية", verdict: "supported", reason: "سبب تحقق تجريبي." },
        ],
      },
    ],
  };
}
