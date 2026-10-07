// Stage 1: question analysis. Structured output only; the planner adds no religious claims and no
// assumptions the user did not state.

import { V2_LIMITS, V2_MODELS } from "./config.ts";
import { openaiStructured, type CallMeta } from "./llm.ts";

export const CATEGORIES = ["عقيدة", "شبهة", "سيرة", "أخلاق", "عبادات عامة", "out_of_scope"] as const;
export const OOS_KINDS = ["none", "personal_fatwa", "disputed_fiqh", "major_disputed_issue", "judgment_on_person_or_group", "current_events"] as const;

export interface Plan {
  answer_language: "ar" | "en" | "other";
  intent: string;
  category: (typeof CATEGORIES)[number];
  out_of_scope_kind: (typeof OOS_KINDS)[number];
  ambiguity: string;
  sub_questions: { id: string; text: string }[];
  coverage_checklist: string[];
  /** Verse wording the user quoted, copied character for character from the question */
  quoted_verse_wording: string[];
  queries: { quran: string[]; hadith: string[]; books: string[] };
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer_language", "intent", "category", "out_of_scope_kind", "ambiguity", "sub_questions", "coverage_checklist", "quoted_verse_wording", "queries"],
  properties: {
    answer_language: { type: "string", enum: ["ar", "en", "other"] },
    intent: { type: "string" },
    category: { type: "string", enum: [...CATEGORIES] },
    out_of_scope_kind: { type: "string", enum: [...OOS_KINDS] },
    ambiguity: { type: "string" },
    sub_questions: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } },
    },
    coverage_checklist: { type: "array", items: { type: "string" } },
    quoted_verse_wording: { type: "array", items: { type: "string" } },
    queries: {
      type: "object",
      additionalProperties: false,
      required: ["quran", "hadith", "books"],
      properties: {
        quran: { type: "array", items: { type: "string" } },
        hadith: { type: "array", items: { type: "string" } },
        books: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const INSTRUCTIONS = `You analyse a question that a Muslim daʿi was asked by a non-Muslim, before any source is searched. You do NOT answer it. Output Arabic for every field except answer_language and ids.

- answer_language: the language the question is written in ("ar", "en", or "other").
- intent: one short Arabic sentence saying what the asker wants to know.
- category: one of عقيدة، شبهة، سيرة، أخلاق، عبادات عامة، or out_of_scope.
- out_of_scope and out_of_scope_kind (otherwise "none"):
  * personal_fatwa: a ruling or fatwa for a specific personal situation (marriage, divorce, money, worship of a named person).
  * disputed_fiqh: a fine-grained fiqh ruling on which scholars differ (e.g. the ruling on music, covering the face).
  * major_disputed_issue: a major issue that scholars dispute.
  * judgment_on_person_or_group: whether a specific person or group is in Paradise or Hell, is a disbeliever, etc.
  * current_events: news or events happening now.
  General questions about Islam's teachings, worship in general, ethics, history (sīrah), creed and common objections are in scope.
- ambiguity: "" unless the question can be read in clearly different ways; then say so briefly.
- sub_questions: 1 to ${V2_LIMITS.maxSubQuestions} answerable sub-questions or claims needing evidence, ids "q1", "q2"… A simple question has one.
- coverage_checklist: 2 to 6 short points a complete answer must address, taken only from the question itself.
- quoted_verse_wording: if the asker quotes Quran wording, copy that quoted wording exactly as it appears in the question; otherwise [].
- queries (Arabic):
  * quran: 3 to 5 queries: modern-Arabic paraphrases in the style of a simplified tafsir, plus likely Quranic wording of the key ideas.
  * hadith: 2 to 4 short keyword queries in classical hadith diction (words likely to appear in the hadith text itself).
  * books: 3 to 5 reformulations as an Arabic book on creed and common objections would phrase them, including classical synonyms of key terms.
Do not add religious claims, positions, people, places or facts the user did not state. Do not judge the asker's intent.`;

/** Validate a plan that came back from the browser; returns null when anything is off (then the server plans again). */
export function sanitizePlan(raw: unknown, question: string): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : null);
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => str(x)).filter((x): x is string => !!x && x.trim().length > 0) : null);
  const q = p.queries as Record<string, unknown> | undefined;
  const subs = Array.isArray(p.sub_questions) ? p.sub_questions.slice(0, V2_LIMITS.maxSubQuestions) : null;
  if (!subs || !subs.length || !q) return null;
  const out: Plan = {
    answer_language: (["ar", "en", "other"] as const).find((x) => x === p.answer_language) ?? "ar",
    intent: str(p.intent) ?? "",
    category: CATEGORIES.find((x) => x === p.category) ?? "عقيدة",
    out_of_scope_kind: OOS_KINDS.find((x) => x === p.out_of_scope_kind) ?? "none",
    ambiguity: str(p.ambiguity) ?? "",
    sub_questions: subs.map((s, i) => ({ id: `q${i + 1}`, text: str((s as { text?: unknown })?.text) ?? "" })).filter((s) => s.text),
    coverage_checklist: strs(p.coverage_checklist, 6) ?? [],
    quoted_verse_wording: (strs(p.quoted_verse_wording, 3) ?? []).filter((w) => question.includes(w.trim())),
    queries: { quran: strs(q.quran, 5) ?? [], hadith: strs(q.hadith, 4) ?? [], books: strs(q.books, 5) ?? [] },
  };
  return out.sub_questions.length ? out : null;
}

export async function plan(question: string): Promise<{ plan: Plan; meta: CallMeta }> {
  const { data, meta } = await openaiStructured<Plan>({
    name: "question_plan",
    schema: SCHEMA,
    instructions: INSTRUCTIONS,
    input: question,
    model: V2_MODELS.planner(),
    effort: "low",
    maxOutputTokens: 4000,
    timeoutMs: 45000,
  });
  data.sub_questions = data.sub_questions.slice(0, V2_LIMITS.maxSubQuestions);
  if (!data.sub_questions.length) data.sub_questions = [{ id: "q1", text: question }];
  // Quoted wording must literally occur in the question (never model-written verse text).
  data.quoted_verse_wording = data.quoted_verse_wording.filter((w) => w.trim().length >= 6 && question.includes(w.trim()));
  data.queries.quran = data.queries.quran.slice(0, 5);
  data.queries.hadith = data.queries.hadith.slice(0, 4);
  data.queries.books = data.queries.books.slice(0, 5);
  return { plan: data, meta };
}
