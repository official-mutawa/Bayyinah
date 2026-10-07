// v2 tests with synthetic text only (no real Quran, hadith or book passages) and mocked services.
// Run: npm run test:v2

import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuote, normalizeArabic } from "../src/lib/arabic.ts";
import { buildQuranInfo, emptyMarkers, findVerseRefs } from "../src/lib/v2/verse-refs.ts";
import { segment } from "../src/lib/v2/segment.ts";
import { filterHadith, rulingApproved } from "../src/lib/v2/hadith.ts";
import { findQuotedHadith } from "../src/lib/v2/hadith-in-books.ts";
import { recordChildren, recordSentences } from "../src/lib/v2/records.ts";
import { buildV2Index, type V2Index } from "../src/lib/v2/corpus-v2.ts";
import { buildEvidenceMap, buildOutline, type Card } from "../src/lib/v2/evidence.ts";
import { mechanicalCheck, semanticReview, settle, type CheckedItem } from "../src/lib/v2/verify.ts";
import { BOOK_SOURCES, retrieveAll } from "../src/lib/v2/retrieve.ts";
import type { Plan } from "../src/lib/v2/planner.ts";
import type { V2Corpus, V2Record } from "../src/lib/v2/types.ts";
import { citationPanel } from "../src/app/ui/v2/panel-model.ts";

process.env.BAYYINAH_TRACE = "0";

// ---------- Synthetic Quran data (placeholder words; surah names and counts only) ----------

const W = (n: number) => Array.from({ length: n }, (_, i) => `كلمة${"ابتثجحخدذرزسشصضطظعغفقكلمنهوي"[i % 28]}`).join(" ");
const synthVerses: { surah: number; ayah: number; surahName: string; text: string }[] = [];
for (const [surah, name, count] of [
  [51, "الذاريات", 60],
  [6, "الأنعام", 165],
  [9, "التوبة", 129],
  [38, "ص", 88],
  [2, "البقرة", 286],
  [29, "العنكبوت", 69],
] as const) {
  for (let a = 1; a <= count; a++) synthVerses.push({ surah, ayah: a, surahName: name, text: `﻿${W(5)}` });
}
const info = buildQuranInfo(synthVerses);
const PUA = (n: number) => Array.from({ length: n }, () => "").join(" ");

test("verse refs: mirrored range from the RTL text layer", () => {
  const [r] = findVerseRefs(`قال تعالى: ﴿ ${PUA(3)} [ ﴾ ${PUA(2)} الذاريات: .]58 -56 وبعده كلام`, info);
  assert.equal(r.status, "resolved");
  assert.deepEqual([r.surah, r.from, r.to], [51, 56, 58]);
  assert.ok(r.marker && r.marker.glyphs === 5);
});

test("verse refs: Arabic-Indic digits and aliases", () => {
  const [a] = findVerseRefs("﴿ ﴾ ]الأنعام: .]١٥١", info);
  assert.deepEqual([a.status, a.surah, a.from], ["resolved", 6, 151]);
  const [b] = findVerseRefs("﴿ ﴾ ]براءة: 5[", info);
  assert.deepEqual([b.status, b.surah, b.from], ["resolved", 9, 5]);
});

test("verse refs: a list number after the reference is not a range", () => {
  const [r] = findVerseRefs("﴿ ﴾ ]البقرة: .]177 -1كلام", info);
  assert.deepEqual([r.status, r.from, r.to], ["resolved", 177, 177]);
});

test("verse refs: short surah names need a nearby verse marker (ص = صفحة)", () => {
  const [page] = findVerseRefs("انظر المرجع )ص: 95( من الكتاب", info);
  assert.equal(page.status, "failed");
  const [sad] = findVerseRefs("﴿ ﴾ ص: 27 والكلام", info);
  assert.deepEqual([sad.status, sad.surah, sad.from], ["resolved", 38, 27]);
});

test("verse refs: out-of-range, glyph overflow and reversed-digit alternatives", () => {
  const [out] = findVerseRefs("﴿ ﴾ العنكبوت: .]96", info);
  assert.equal(out.status, "failed");
  assert.deepEqual(out.digitAlternative, { from: 69, to: 69 });
  const [over] = findVerseRefs(`﴿ ${PUA(30)} ﴾ الذاريات: 5`, info);
  assert.notEqual(over.status, "resolved");
  const [risk] = findVerseRefs("﴿ ﴾ البقرة: 12", info);
  assert.equal(risk.status, "resolved");
  assert.deepEqual(risk.digitAlternative, { from: 21, to: 21 });
});

test("empty verse markers are detected; readable ones are not", () => {
  assert.equal(emptyMarkers(`أ ﴿   ﴾ ب ﴿${PUA(4)}﴾ ج ﴿نص مقروء هنا﴾`).length, 2);
});

test("sentences have exact offsets", () => {
  const text = "الجملة الأولى هنا. الجملة الثانية؟ والثالثة بلا نقطة";
  const s = segment(text);
  assert.equal(s.length, 3);
  assert.equal(text.slice(s[0].start, s[0].end), "الجملة الأولى هنا.");
  assert.equal(text.slice(s[2].start, s[2].end), "والثالثة بلا نقطة");
});

test("BOM: matching ignores it, display keeps the stored text", () => {
  const stored = `﻿${W(6)}`;
  assert.ok(findQuote(stored, W(3)));
  assert.equal(normalizeArabic(stored).startsWith("﻿"), false);
  assert.equal(stored.charCodeAt(0), 0xfeff); // never altered for display
});

test("hadith whitelist: exact approved rulings only; differing rulings exclude the hadith", () => {
  assert.equal(rulingApproved("صحيح"), true);
  assert.equal(rulingApproved(" حسن "), true);
  assert.equal(rulingApproved("[صحيح]"), false); // pending the reviewer's decision
  assert.equal(rulingApproved("إسناده صحيح"), false);
  assert.equal(rulingApproved(""), false);
  const h = (grade: string, muhaddith: string) => ({ text: "نص حديث تجريبي للاختبار فقط", narrator: "راو", muhaddith, book: "كتاب", locator: "1", grade });
  const r = filterHadith([h("صحيح", "أ"), h("ضعيف", "ب"), { ...h("حسن", "ج"), text: "نص آخر تجريبي" }]);
  assert.equal(r.evidence.length, 1);
  assert.equal(r.evidence[0].grade, "حسن");
  assert.equal(r.excluded.length, 2);
});

test("hadith quoted inside a book is detected (and is never evidence by itself)", () => {
  const text = "قال المؤلف كلامًا. قال رسول الله ﷺ: «نص منقول تجريبي طويل بما يكفي» رواه فلان. ثم «عبارة عادية للمؤلف هنا» انتهى.";
  const q = findQuotedHadith(text);
  assert.equal(q.length, 1);
  assert.ok(text.slice(q[0].start, q[0].end).includes("نص منقول"));
});

// ---------- Synthetic v2 index ----------

function bookRecord(id: string, sourceId: string, parts: [string, V2Record["sections"][number]["speaker"], string][], extra: Partial<V2Record> = {}): V2Record {
  let text = "";
  const sections: V2Record["sections"] = [];
  for (const [label, speaker, body] of parts) {
    if (text) text += "\n";
    const start = text.length;
    text += `${label} ${body}`;
    sections.push({ start, end: text.length, speaker, label });
  }
  const r: V2Record = { id, sourceId, kind: "book", title: `عنوان ${id}`, refLabel: `مرجع ${id}`, text, quotable: true, sections, sentences: [], verseRefs: [], quotedHadith: [], emptyMarkers: [], ...extra };
  r.sentences = recordSentences(id, text, sections, []);
  return r;
}

function synthIndex(): V2Index {
  const records: V2Record[] = [];
  for (let a = 1; a <= 3; a++) {
    const v = `﻿كلمةا كلمةب كلمةت كلمةث كلمةج كلمةح${a}`;
    records.push({ id: `quran:1:${a}`, sourceId: "quran", kind: "quran", title: "الفاتحة", refLabel: `سورة الفاتحة، الآية ${a}`, surah: 1, ayah: a, text: v, quotable: true, sections: [{ start: 0, end: v.length, speaker: "author", label: "آية" }], sentences: [{ id: `quran:1:${a}:s1`, n: 1, start: 0, end: v.length, speaker: "author" }], verseRefs: [], quotedHadith: [], emptyMarkers: [] });
    const t = `معنى تجريبي للآية ${a} يذكر الرحمة والغاية. جملة ثانية للتفسير.`;
    const tr: V2Record = { id: `muyassar:1:${a}`, sourceId: "muyassar", kind: "tafsir", title: `1:${a}`, refLabel: `التفسير الميسر 1:${a}`, surah: 1, ayah: a, verses: [`1:${a}`], text: t, quotable: true, sections: [{ start: 0, end: t.length, speaker: "author", label: "تفسير" }], sentences: [], verseRefs: [], quotedHadith: [], emptyMarkers: [] };
    tr.sentences = recordSentences(tr.id, t, tr.sections, []);
    records.push(tr);
  }
  records.push(
    bookRecord("bayyinat:1", "bayyinat", [
      ["السؤال", "quoted_question", "هل الغاية من الخلق مفقودة؟ هذا سؤال تجريبي."],
      ["مضمون السؤال", "quoted_objection", "يدعي السائل أن الخلق بلا غاية. وهذا ادعاء تجريبي."],
      ["الجواب", "author", "الغاية من الخلق مذكورة في الجواب التجريبي. والمؤلف يرد على الادعاء ردًّا تجريبيًّا."],
    ])
  );
  records.push(bookRecord("usoul-eman:1", "usoul-eman", [["نص", "author", "كلام تجريبي عن الغاية والرحمة في كتاب آخر. جملة ثانية."]]));
  records.push(bookRecord("raheeq:1", "raheeq", [["نص", "author", "صفحة سيرة تجريبية مستخرجة ضوئيا. جملة ثانية."]], { ocr: true, quotable: false }));
  const children = records.filter((r) => r.kind !== "quran").flatMap(recordChildren);
  const corpus: V2Corpus = { version: "test", builtAt: "", sources: [], records, children, verseGraph: { "bayyinat:1": ["1:2"] } };
  return buildV2Index(corpus);
}

const plan2: Plan = {
  answer_language: "ar",
  intent: "",
  category: "عقيدة",
  out_of_scope_kind: "none",
  ambiguity: "",
  sub_questions: [
    { id: "q1", text: "ما الغاية؟" },
    { id: "q2", text: "ما الرحمة؟" },
  ],
  coverage_checklist: ["الغاية"],
  quoted_verse_wording: [],
  queries: { quran: ["الغاية"], hadith: ["الغاية"], books: ["الغاية من الخلق"] },
};

test("retrieval: every source is searched on its own; absent sources are not_indexed", () => {
  const index = synthIndex();
  const r = retrieveAll(index, { question: "الغاية من الخلق", queries: { quran: ["الغاية"], books: ["الغاية من الخلق"] }, vectors: [], quotedWording: [] });
  assert.ok(r.bayyinat.candidates.length > 0);
  assert.ok(r["usoul-eman"].candidates.length > 0, "a weaker source still returns its own candidates");
  for (const sid of BOOK_SOURCES) assert.ok(["found", "not_indexed"].includes(r[sid].status));
  assert.equal(r["shumoo-nahar"].status, "not_indexed");
  assert.ok(r.quran.candidates.some((c) => c.recordId === "quran:1:2" && c.via.some((v) => v.startsWith("cited by"))), "verse-citation graph adds the cited verse");
});

function card(partial: Partial<Card> & Pick<Card, "id" | "recordId">): Card {
  return { source: partial.recordId.split(":")[0], type: "book", sentenceIds: [], role: "dalil", subQuestion: "q1", speaker: "author", strength: "strong", note: "", usable: true, ...partial };
}

test("evidence map: statuses per sub-question and source, gaps", () => {
  const cards = [card({ id: "E1", recordId: "bayyinat:1", sentenceIds: ["bayyinat:1:s5"] })];
  const map = buildEvidenceMap(plan2, { quran: "found", muyassar: "found", bayyinat: "found", "usoul-eman": "found", "shumoo-nahar": "not_indexed", raheeq: "found", dorar: "unavailable" }, cards);
  assert.equal(map.cells.q1.bayyinat.status, "found");
  assert.equal(map.cells.q1["usoul-eman"].status, "no_relevant_evidence");
  assert.equal(map.cells.q1.dorar.status, "unavailable");
  assert.equal(map.cells.q1["shumoo-nahar"].status, "not_indexed");
  assert.deepEqual(map.gaps, ["q2"]);
  const outline = buildOutline(plan2, cards);
  assert.equal(outline[0].cards.length, 1);
  assert.equal(outline[1].cards.length, 0);
});

test("mechanical checks: speaker, unknown ids, OCR quotes, Quran wording, consensus, hadith claims", () => {
  const index = synthIndex();
  const bay = index.records.get("bayyinat:1")!;
  const objection = bay.sentences.find((s) => s.speaker === "quoted_objection")!;
  const author = bay.sentences.find((s) => s.speaker === "author" && s.n > objection.n)!;
  const cards = new Map<string, Card>([
    ["E1", card({ id: "E1", recordId: "bayyinat:1", sentenceIds: [objection.id, author.id] })],
    ["E2", card({ id: "E2", recordId: "raheeq:1", sentenceIds: ["raheeq:1:s1"], source: "raheeq" })],
    ["E3", card({ id: "E3", type: "quran", recordId: "quran:1:1", source: "quran", verse: { surah: 1, from: 1, to: 1 }, sentenceIds: ["quran:1:1:s1"], tafsirSentenceIds: ["muyassar:1:1:s1"] })],
  ]);
  const hadith = new Map();
  const chk = (text: string, cites: { evidence: string; sentences: number[] }[], kind: "claim" | "quote" = "claim") => mechanicalCheck({ kind, text, cites }, cards, index, hadith).issues;
  assert.ok(chk("المؤلف يقرر شيئًا.", [{ evidence: "E1", sentences: [objection.n] }]).some((i) => i.includes("not the author's own words")));
  assert.deepEqual(chk("المؤلف يقرر شيئًا تجريبيًّا.", [{ evidence: "E1", sentences: [author.n] }]), []);
  assert.ok(chk("جملة", [{ evidence: "E9", sentences: [1] }]).some((i) => i.includes("unknown evidence")));
  assert.ok(chk("جملة", [{ evidence: "E1", sentences: [99] }]).some((i) => i.includes("not part of the evidence")));
  assert.ok(chk("", [{ evidence: "E2", sentences: [1] }], "quote").some((i) => i.includes("OCR")));
  assert.ok(chk("تقول الآية كلمةا كلمةب كلمةت كلمةث كلمةج كما هي.", [{ evidence: "E3", sentences: [1] }]).some((i) => i.includes("Quran wording")));
  assert.ok(chk("أجمع العلماء على هذا.", [{ evidence: "E1", sentences: [author.n] }]).includes("claims consensus"));
  assert.ok(chk("قال النبي ﷺ إن الأمر كذا.", [{ evidence: "E1", sentences: [author.n] }]).some((i) => i.includes("Dorar")));
  assert.ok(!chk("يذكر المؤلف أن النبي ﷺ قال كذا.", [{ evidence: "E1", sentences: [author.n] }]).some((i) => i.includes("Dorar")));
});

function item(text: string): CheckedItem {
  return { kind: "claim", text, cites: [{ evidence: "E1", type: "book", recordId: "bayyinat:1", sentenceIds: ["bayyinat:1:s5"] }], mechanical: [], review: [], passed: false };
}

test("fail closed: reviewer error or timeout never yields a passed claim", async () => {
  const index = synthIndex();
  process.env.OPENAI_API_KEY = "test-key-not-real";
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("simulated timeout");
  }) as typeof fetch;
  try {
    const it = item("جملة تجريبية.");
    const r = await semanticReview("سؤال", [it], index, new Map());
    assert.ok(r.error);
    settle(it);
    assert.equal(it.passed, false);
    assert.equal(it.review[0].verdict, "error");
  } finally {
    globalThis.fetch = real;
  }
});

test("semantic review: only supported with both flags and no issues passes", () => {
  const ok = item("أ");
  ok.review = [{ evidence: "E1", verdict: "supported", supporting_span: [5], attribution_ok: true, context_ok: true, issues: [], reason: "" }];
  settle(ok);
  assert.equal(ok.passed, true);
  for (const bad of [
    { verdict: "partial" as const, attribution_ok: true, context_ok: true, issues: [] },
    { verdict: "supported" as const, attribution_ok: false, context_ok: true, issues: [] },
    { verdict: "supported" as const, attribution_ok: true, context_ok: false, issues: [] },
    { verdict: "supported" as const, attribution_ok: true, context_ok: true, issues: ["تعميم"] },
    { verdict: "contradicted" as const, attribution_ok: true, context_ok: true, issues: [] },
  ]) {
    const it = item("ب");
    it.review = [{ evidence: "E1", supporting_span: [], reason: "", ...bad }];
    settle(it);
    assert.equal(it.passed, false, JSON.stringify(bad));
  }
});

// ---------- End to end with mocked model calls ----------

type Route = (body: Record<string, unknown>) => unknown;
function mockFetch(routes: Record<string, Route>, failReviewer = false) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (u.includes("/embeddings")) {
      const n = (body.input as string[]).length;
      return new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: Array.from({ length: 256 }, (_, j) => (j === i % 256 ? 1 : 0)) })), usage: { prompt_tokens: 1 } }), { status: 200 });
    }
    const name = (body.text as { format: { name: string } } | undefined)?.format.name ?? (body.tools as { name: string }[] | undefined)?.[0].name ?? "";
    calls.push(name);
    if (failReviewer && (name === "support_review" || name === "whole_review")) return new Response("server error", { status: 503 });
    // Anthropic requests carry the input in messages; give routes the same shape.
    const input = body.input ?? (body.messages as { content: string }[] | undefined)?.[0]?.content;
    const data = routes[name]?.({ ...body, input });
    if (u.includes("anthropic")) return new Response(JSON.stringify({ content: [{ type: "tool_use", name, input: data }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(data) }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const plan1: Plan = { ...plan2, sub_questions: [{ id: "q1", text: "ما الغاية؟" }, { id: "q2", text: "سؤال بلا دليل؟" }] };

function routes(): Record<string, Route> {
  return {
    question_plan: () => plan1,
    relevance_grades: (b) => ({ grades: [...String(b.input).matchAll(/\[I(\d+)\]/g)].map((m) => ({ item: `I${m[1]}`, relevance: 3 })) }),
    evidence_cards: (b) => {
      const input = String(b.input);
      if (!input.includes("SOURCE: bayyinat")) return { cards: [] };
      const n = Number(/S(\d+) \(المؤلف\): (?:الجواب )?الغاية من الخلق مذكورة/.exec(input)?.[1] ?? 0);
      return { cards: [{ item: "I1", through_item: "", sentences: [n], role: "dalil", sub_question: "q1", strength: "strong", note: "" }] };
    },
    answer_draft: (b) => {
      const ev = /\[(E\d+)\]/.exec(String(b.input))?.[1] ?? "E1";
      const n = Number(/S(\d+): (?:الجواب )?الغاية من الخلق مذكورة/.exec(String(b.input))?.[1] ?? 0);
      const claim = { kind: "claim", text: "يقرر المؤلف أن للخلق غاية مذكورة.", cites: [{ evidence: ev, sentences: [n] }] };
      return { summary: [claim], sections: [{ sub_question: "q1", heading: "الغاية", items: [claim] }], gaps: [{ sub_question: "q2", text: "لم أجد في المصادر المعتمدة ما يجيب عن السؤال الثاني." }] };
    },
    support_review: (b) => ({ results: [...String(b.input).matchAll(/\[(P[\d.]+)\]/g)].map((m) => ({ pair: m[1], verdict: "supported", supporting_span: [1], attribution_ok: true, context_ok: true, issues: [], reason: "مدعومة" })) }),
    whole_review: () => ({ issues: [], uncovered: [] }),
    claim_repair: () => ({ repairs: [] }),
  };
}

test("end to end: partial answer, statuses, progressive summary, verified only with another family", async () => {
  const { askV2 } = await import("../src/lib/v2/pipeline-v2.ts");
  const real = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-real";
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  try {
    mockFetch(routes());
    const events: string[] = [];
    const r = await askV2("ما الغاية من الخلق؟ وسؤال آخر؟", (e) => events.push(e.type === "part" ? `part:${e.part.id}` : e.type), { hadithFailed: true }, { index: synthIndex() });
    assert.equal(r.status, "partial");
    assert.ok(r.summary && r.summary.blocks.length === 1);
    assert.equal(r.gaps.length, 1);
    assert.equal(r.sources.find((s) => s.id === "dorar")?.status, "unavailable");
    assert.equal(r.sources.find((s) => s.id === "shumoo-nahar")?.status, "not_indexed");
    assert.equal(r.verified, true, "cross-family reviewer and every check passed");
    assert.ok(events.indexOf("part:summary") >= 0 && events.indexOf("part:summary") < events.length);
    // Same run with the reviewer failing: nothing may be presented as verified.
    mockFetch(routes(), true);
    const r2 = await askV2("ما الغاية من الخلق؟", () => {}, { hadithFailed: true }, { index: synthIndex() });
    assert.equal(r2.verified, false);
    assert.ok(!r2.summary || r2.summary.blocks.every((b) => b.kind !== "claim") || r2.status === "abstain");
  } finally {
    globalThis.fetch = real;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("end to end: the same-family stand-in reviewer never yields verified", async () => {
  const { askV2 } = await import("../src/lib/v2/pipeline-v2.ts");
  const real = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-real";
  try {
    mockFetch(routes());
    const r = await askV2("ما الغاية من الخلق؟", () => {}, { hadithFailed: true }, { index: synthIndex() });
    assert.ok(r.summary);
    assert.equal(r.verified, false);
    assert.equal(r.reviewer.crossFamily, false);
  } finally {
    globalThis.fetch = real;
  }
});

test("end to end: out-of-scope questions get a referral and no search", async () => {
  const { askV2 } = await import("../src/lib/v2/pipeline-v2.ts");
  const real = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-real";
  try {
    const calls = mockFetch({ ...routes(), question_plan: () => ({ ...plan1, category: "out_of_scope", out_of_scope_kind: "personal_fatwa" }) });
    const r = await askV2("سؤال شخصي تجريبي", () => {}, {}, { index: synthIndex() });
    assert.equal(r.status, "out_of_scope");
    assert.ok(r.abstain_reason.includes("أهل العلم"));
    assert.ok(r.sources.every((s) => s.status === "not_searched"));
    assert.deepEqual(calls, ["question_plan"]);
  } finally {
    globalThis.fetch = real;
  }
});

test("end to end: no usable evidence means abstention with a calm reason", async () => {
  const { askV2 } = await import("../src/lib/v2/pipeline-v2.ts");
  const real = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-real";
  try {
    mockFetch({ ...routes(), evidence_cards: () => ({ cards: [] }) });
    const r = await askV2("سؤال لا دليل له", () => {}, { hadithFailed: true }, { index: synthIndex() });
    assert.equal(r.status, "abstain");
    assert.ok(r.abstain_reason.length > 10);
    assert.equal(r.verified, false);
  } finally {
    globalThis.fetch = real;
  }
});

test("citation panel: supporting sentence first, then source line, context, and the full parent", () => {
  const index = synthIndex();
  const rec = index.records.get("bayyinat:1")!;
  const s = rec.sentences.find((x) => x.speaker === "author")!;
  const panel = citationPanel({ ...rec, ocr: !!rec.ocr, page: null, verseRefs: [] }, [s.id], {});
  assert.equal(panel.supporting[0].text, rec.text.slice(s.start, s.end));
  assert.ok(panel.sourceLine.includes(rec.refLabel));
  assert.ok(panel.context.before.length + panel.context.after.length > 0);
  assert.equal(panel.full.segments.map((x) => x.text).join(""), rec.text);
  assert.ok(panel.full.segments.some((x) => x.highlight));
});
