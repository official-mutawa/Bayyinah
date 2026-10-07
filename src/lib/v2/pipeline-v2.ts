// v2 pipeline: understand -> search every source on its own -> grade -> per-source analysis ->
// evidence map and outline -> write by reference -> verify (mechanical, semantic, repair, whole) ->
// deliver verified parts progressively. Selected with BAYYINAH_PIPELINE=v2; v1 stays the default.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { embed, embedModel } from "../openai.ts";
import { normalizeArabic, normalizeMapped, standardSpelling } from "../arabic.ts";
import type { DorarItem } from "../dorar-parse.ts";
import { V2_MODELS, reviewerIsCrossFamily } from "./config.ts";
import { loadV2Index, vectorSearch, type V2Index } from "./corpus-v2.ts";
import { analyseSource, buildEvidenceMap, buildOutline, excerptSentences, gradeSource, type Card, type EvidenceMap } from "./evidence.ts";
import { filterHadith, type HadithEvidence } from "./hadith.ts";
import { openaiStructured, type CallMeta } from "./llm.ts";
import { plan as makePlan, type Plan } from "./planner.ts";
import { APPROVED_SOURCES, BOOK_SOURCES, retrieveAll, type SourceStatus } from "./retrieve.ts";
import type { Speaker, V2Record } from "./types.ts";
import { mechanicalCheck, semanticReview, settle, wholeReview, type CheckedItem, type ResolvedCite } from "./verify.ts";
import { DRAFT_SCHEMA, renderEvidence, writeDraft, WRITER_RULES, type Draft, type DraftItem } from "./writer.ts";

// ---------- Types shared with the UI ----------

export type StageV2 = "understanding" | "search-quran" | "search-books" | "search-hadith" | "analysing" | "writing" | "verifying";

export interface RecordView {
  id: string;
  sourceId: string;
  kind: V2Record["kind"];
  refLabel: string;
  title: string;
  text: string;
  sentences: { id: string; n: number; start: number; end: number; speaker: Speaker }[];
  quotable: boolean;
  ocr: boolean;
  page: number | null;
  surah?: number;
  ayah?: number;
  /** Resolved verse references inside the text (rendered from the Quran data in place of empty markers) */
  verseRefs: { start: number; end: number; surah: number; from: number; to: number }[];
}

export interface V2Block {
  kind: DraftItem["kind"];
  text: string;
  cites: ResolvedCite[];
}

export interface V2Part {
  id: string;
  heading: string;
  blocks: V2Block[];
  verified: boolean;
}

export interface V2SourceStatus {
  id: string;
  label: string;
  status: SourceStatus;
  /** What it contributed (Arabic), or null */
  contributed: string | null;
}

export interface AskResultV2 {
  version: "v2";
  status: "answer" | "partial" | "abstain" | "out_of_scope";
  language: Plan["answer_language"];
  summary: V2Part | null;
  sections: V2Part[];
  gaps: { subQuestion: string; text: string }[];
  abstain_reason: string;
  missing: string;
  sources: V2SourceStatus[];
  records: Record<string, RecordView>;
  /** Canonical verse text for every verse shown or referenced, keyed "s:a" */
  verses: Record<string, { text: string; refLabel: string; surahName: string; tafsir: string }>;
  hadith: Record<string, HadithEvidence>;
  /** True only when every shown part passed every check and the reviewer is another model family */
  verified: boolean;
  reviewer: { provider: string; model: string; crossFamily: boolean };
  notes: string[];
  models: Record<string, string>;
  ms: number;
  timings: Record<string, number>;
  traceId: string | null;
}

export type PipelineEventV2 =
  | { type: "stage"; stage: StageV2; state: "active" | "done"; note?: string; count?: number }
  | { type: "part"; part: V2Part; records: Record<string, RecordView>; verses: AskResultV2["verses"]; hadith: Record<string, HadithEvidence> }
  | { type: "result"; result: AskResultV2 }
  | { type: "error"; message: string };

export interface AskOptionsV2 {
  /** A plan already made by /api/queries (so the browser could search Dorar with its hadith queries) */
  plan?: Plan;
  /** Hadith the user's browser found on Dorar, exactly as returned */
  hadith?: DorarItem[];
  /** The browser could not reach Dorar */
  hadithFailed?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  quran: "القرآن الكريم",
  muyassar: "التفسير الميسر",
  bayyinat: "بينات: أسئلة وأجوبة عن الإسلام",
  "usoul-eman": "أصول الإيمان في ضوء الكتاب والسنة",
  "shumoo-nahar": "شموع النهار",
  raheeq: "الرحيق المختوم",
  dorar: "الدرر السنية: الموسوعة الحديثية",
};

const OOS_TEXT: Record<string, string> = {
  personal_fatwa: "هذا سؤال عن حكم لحالة شخصية بعينها، والحكم فيها يحتاج إلى مفتٍ يسمع تفاصيلها. ننصح بعرضه على أهل العلم.",
  disputed_fiqh: "هذه مسألة فقهية دقيقة اختلف فيها أهل العلم، فلا نقدّم فيها مسودة. ننصح بالرجوع إلى أهل العلم.",
  major_disputed_issue: "هذه مسألة كبيرة اختلف فيها أهل العلم، ولا تكفي فيها مسودة آلية. ننصح بالرجوع إلى أهل العلم.",
  judgment_on_person_or_group: "هذا سؤال عن الحكم على شخص أو جماعة بعينها، وليس هذا مما تقدّم فيه الأداة مسودة. ننصح بالرجوع إلى أهل العلم.",
  current_events: "هذا سؤال عن أحداث جارية، والمصادر المعتمدة هنا لا تتناولها. ننصح بالرجوع إلى أهل العلم.",
};

// ---------- Helpers ----------

function recordView(index: V2Index, id: string): RecordView | null {
  const r = index.records.get(id);
  if (!r) return null;
  return {
    id: r.id,
    sourceId: r.sourceId,
    kind: r.kind,
    refLabel: r.refLabel,
    title: r.title,
    text: r.text,
    sentences: r.sentences.map((s) => ({ id: s.id, n: s.n, start: s.start, end: s.end, speaker: s.speaker })),
    quotable: r.quotable,
    ocr: !!r.ocr,
    page: r.page ?? null,
    surah: r.surah,
    ayah: r.ayah,
    verseRefs: r.verseRefs.filter((v) => v.status === "resolved" && !v.digitAlternative && v.surah && v.from && v.to && v.marker).map((v) => ({ start: v.start, end: v.end, surah: v.surah!, from: v.from!, to: v.to! })),
  };
}

function collectPayload(index: V2Index, parts: V2Part[], hadithAll: Map<string, HadithEvidence>) {
  const records: Record<string, RecordView> = {};
  const verses: AskResultV2["verses"] = {};
  const hadith: Record<string, HadithEvidence> = {};
  const addVerse = (s: number, a: number) => {
    const v = index.records.get(`quran:${s}:${a}`);
    if (!v) return;
    verses[`${s}:${a}`] = { text: v.text, refLabel: v.refLabel, surahName: v.title, tafsir: index.tafsirOf.get(v.id)?.text ?? "" };
  };
  for (const p of parts)
    for (const b of p.blocks)
      for (const c of b.cites) {
        if (c.verse) for (let a = c.verse.from; a <= c.verse.to; a++) addVerse(c.verse.surah, a);
        if (c.dorarId && hadithAll.has(c.dorarId)) hadith[c.dorarId] = hadithAll.get(c.dorarId)!;
        for (const sid of c.sentenceIds) {
          const rid = sid.replace(/:s\d+$/, "");
          if (!records[rid]) {
            const rv = recordView(index, rid);
            if (rv) {
              records[rid] = rv;
              for (const v of rv.verseRefs) for (let a = v.from; a <= v.to; a++) addVerse(v.surah, a);
            }
          }
        }
        if (c.type !== "quran" && c.type !== "hadith" && !records[c.recordId]) {
          const rv = recordView(index, c.recordId);
          if (rv) records[c.recordId] = rv;
        }
      }
  return { records, verses, hadith };
}

// ---------- 6.3 Repair ----------

const REPAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["repairs"],
  properties: {
    repairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "action", "text", "cites"],
        properties: {
          claim: { type: "string" },
          action: { type: "string", enum: ["rewrite", "drop"] },
          text: { type: "string" },
          cites: (DRAFT_SCHEMA.properties.summary.items as { properties: { cites: unknown } }).properties.cites,
        },
      },
    },
  },
};

async function repairClaims(
  question: string,
  failing: { key: string; item: CheckedItem; original: DraftItem }[],
  cards: Map<string, Card>,
  index: V2Index,
  hadith: Map<string, HadithEvidence>,
  nextId: () => string,
  metas: CallMeta[]
): Promise<Map<string, DraftItem | null>> {
  const out = new Map<string, DraftItem | null>();
  if (!failing.length) return out;
  // One targeted retrieval per failing claim: books and verses, outside the evidence already used.
  const vecs = await embed(failing.map((f) => f.item.text), 30000);
  const extra: Card[] = [];
  failing.forEach((f, i) => {
    const units = [...index.units.values()].filter((u) => u.sourceId !== "quran" || true);
    const top = vectorSearch(index, vecs[i], units.map((u) => u.id), 6);
    let added = 0;
    for (const [uid] of top) {
      const u = index.units.get(uid)!;
      if ([...cards.values()].some((c) => c.recordId === u.recordId) || extra.some((c) => c.recordId === u.recordId)) continue;
      const rec = index.records.get(u.recordId)!;
      if (rec.kind === "quran") {
        const t = index.tafsirOf.get(rec.id);
        if (!t) continue;
        extra.push({ id: nextId(), source: "quran", type: "quran", recordId: rec.id, sentenceIds: [`${rec.id}:s1`], verse: { surah: rec.surah!, from: rec.ayah!, to: rec.ayah! }, tafsirSentenceIds: t.sentences.map((s) => s.id), role: "sharh", subQuestion: "", speaker: "author", strength: "partial", note: "targeted retrieval", usable: true });
      } else {
        const sents = excerptSentences(rec, [u], 1, 900).filter((s) => s.speaker === "author");
        if (!sents.length) continue;
        extra.push({ id: nextId(), source: rec.sourceId, type: rec.kind === "tafsir" ? "tafsir" : "book", recordId: rec.id, sentenceIds: sents.map((s) => s.id), role: "sharh", subQuestion: "", speaker: "author", strength: "partial", note: "targeted retrieval", usable: true });
      }
      if (++added >= 2) break;
    }
  });
  for (const c of extra) cards.set(c.id, c);
  const sections = failing.map((f) => {
    const ownIds = f.original.cites.map((c) => c.evidence).filter((id) => cards.has(id));
    const own = ownIds.map((id) => cards.get(id)!);
    const reasons = [...f.item.mechanical, ...f.item.review.filter((v) => v.verdict !== "supported" || !v.attribution_ok || !v.context_ok || v.issues.length).map((v) => `${v.evidence}: ${v.verdict}${v.issues.length ? ` (${v.issues.join("، ")})` : ""} ${v.reason}`)];
    return { subQuestion: f.key, text: `CLAIM ${f.key}: ${f.item.text}\nWHY IT FAILED: ${reasons.join(" | ")}`, cards: [...own, ...extra] };
  });
  try {
    const { data, meta } = await openaiStructured<{ repairs: { claim: string; action: "rewrite" | "drop"; text: string; cites: { evidence: string; sentences: number[] }[] }[] }>({
      name: "claim_repair",
      schema: REPAIR_SCHEMA,
      instructions: `${WRITER_RULES}\n\nYou are now repairing claims that failed verification. For each CLAIM, either rewrite it narrowed to exactly what the cited sentences say (one atomic claim with cites), or drop it. Use only the evidence shown under it.`,
      input: `QUESTION: ${question}\n\n${renderEvidence(sections, index, hadith)}`,
      model: V2_MODELS.writer(),
      effort: "low",
      maxOutputTokens: 6000,
      timeoutMs: 90000,
    });
    metas.push(meta);
    for (const f of failing) {
      const r = data.repairs.find((x) => x.claim === f.key || x.claim === `CLAIM ${f.key}`);
      out.set(f.key, r && r.action === "rewrite" && r.text.trim() ? { kind: "claim", text: r.text, cites: r.cites } : null);
    }
  } catch {
    for (const f of failing) out.set(f.key, null);
  }
  return out;
}

// ---------- Orchestration ----------

function saveTrace(trace: Record<string, unknown>): string | null {
  // Local development only: never on the deployed site.
  if (process.env.VERCEL || process.env.BAYYINAH_TRACE === "0") return null;
  try {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
    const dir = path.join(process.cwd(), "local", "traces");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, ...trace }, null, 1));
    return id;
  } catch {
    return null;
  }
}

export async function askV2(question: string, emit: (e: PipelineEventV2) => void, opts: AskOptionsV2 = {}): Promise<AskResultV2> {
  const started = Date.now();
  const timings: Record<string, number> = {};
  const mark = (k: string, t0: number) => (timings[k] = Date.now() - t0);
  const metas: CallMeta[] = [];
  const trace: Record<string, unknown> = { question, startedAt: new Date().toISOString() };
  const reviewer = V2_MODELS.reviewer();
  const crossFamily = reviewerIsCrossFamily();
  const index = loadV2Index();
  let counter = 0;
  const nextId = () => `E${++counter}`;

  const base = (): Omit<AskResultV2, "status" | "summary" | "sections" | "gaps" | "abstain_reason" | "missing" | "sources" | "records" | "verses" | "hadith" | "verified" | "language" | "notes"> => ({
    version: "v2",
    reviewer: { provider: reviewer.provider, model: reviewer.model, crossFamily },
    models: { planner: V2_MODELS.planner(), grader: V2_MODELS.grader(), analyst: V2_MODELS.analyst(), writer: V2_MODELS.writer(), reviewer: reviewer.model, embed: embedModel() },
    ms: Date.now() - started,
    timings,
    traceId: null,
  });

  // Stage 1: understand the question.
  let t0 = Date.now();
  emit({ type: "stage", stage: "understanding", state: "active" });
  let plan = opts.plan;
  if (!plan) {
    const r = await makePlan(question);
    plan = r.plan;
    metas.push(r.meta);
  }
  emit({ type: "stage", stage: "understanding", state: "done" });
  mark("understanding", t0);
  trace.plan = plan;

  const statuses: Record<string, SourceStatus> = Object.fromEntries(APPROVED_SOURCES.map((s) => [s, "not_indexed" as SourceStatus]));
  if (plan.category === "out_of_scope" || plan.out_of_scope_kind !== "none") {
    const result: AskResultV2 = {
      ...base(),
      status: "out_of_scope",
      language: plan.answer_language,
      summary: null,
      sections: [],
      gaps: [],
      abstain_reason: OOS_TEXT[plan.out_of_scope_kind] ?? "هذا السؤال خارج ما تقدّم فيه الأداة مسودة. ننصح بالرجوع إلى أهل العلم.",
      missing: "مراجعة أهل العلم المختصين.",
      sources: APPROVED_SOURCES.map((id) => ({ id, label: SOURCE_LABEL[id], status: "not_searched" as SourceStatus, contributed: null })),
      records: {},
      verses: {},
      hadith: {},
      verified: false,
      notes: ["لم يُبحث في المصادر لأن السؤال خارج النطاق."],
    };
    result.traceId = saveTrace({ ...trace, result, metas });
    return result;
  }

  // Stage 2: search every source on its own.
  t0 = Date.now();
  emit({ type: "stage", stage: "search-quran", state: "active" });
  emit({ type: "stage", stage: "search-books", state: "active" });
  const allQueries = [...plan.queries.quran, question, ...plan.queries.books];
  const vectors = await embed(allQueries, 30000);
  const retrieval = retrieveAll(index, {
    question,
    queries: { quran: plan.queries.quran, books: plan.queries.books },
    vectors,
    quotedWording: plan.quoted_verse_wording,
  });
  for (const [sid, r] of Object.entries(retrieval)) statuses[sid] = r.status;
  // A verse the asker quoted is the subject: matched only when the quoted wording occurs in it.
  const subjectVerses: string[] = [];
  const quranPart = index.bySource.get("quran")!;
  for (const w of plan.quoted_verse_wording) {
    const key = normalizeMapped(standardSpelling(w), true).text;
    for (const [d] of quranPart.bm25.search(w, 5)) {
      const rec = index.records.get(quranPart.units[d].recordId)!;
      if (key.length >= 8 && normalizeMapped(standardSpelling(rec.text), true).text.includes(key)) {
        if (!subjectVerses.includes(rec.id)) subjectVerses.push(rec.id);
        if (!retrieval.quran.candidates.some((c) => c.recordId === rec.id)) retrieval.quran.candidates.unshift({ recordId: rec.id, sourceId: "quran", score: 1, units: [{ id: rec.id, start: 0, end: rec.text.length, score: 1 }], via: ["quoted by the asker"] });
        break;
      }
    }
  }
  trace.subjectVerses = subjectVerses;
  mark("retrieval", t0);

  // Hadith: searched by the user's browser on Dorar; only whitelisted rulings become evidence.
  emit({ type: "stage", stage: "search-hadith", state: "active" });
  const { evidence: hadithEvidence, excluded: hadithExcluded } = filterHadith(opts.hadith ?? []);
  const hadithMap = new Map(hadithEvidence.map((h) => [h.id, h]));
  statuses.dorar = opts.hadithFailed || !opts.hadith ? "unavailable" : "found";
  emit({ type: "stage", stage: "search-hadith", state: "done", count: hadithEvidence.length, note: statuses.dorar === "unavailable" ? "تعذر البحث في الحديث الآن" : undefined });
  trace.hadith = { received: opts.hadith?.length ?? 0, failed: !!opts.hadithFailed, approved: hadithEvidence.length, excluded: hadithExcluded.map((x) => ({ grade: x.item.grade, muhaddith: x.item.muhaddith, reason: x.reason })) };

  // Grade inside each source (parallel), then analyse each source (parallel).
  t0 = Date.now();
  const graded = await Promise.all(
    ["quran", ...BOOK_SOURCES].map(async (sid) => {
      try {
        const g = await gradeSource(question, plan!, retrieval[sid], index);
        if (g.meta) metas.push(g.meta);
        return [sid, g.shortlist] as const;
      } catch (e) {
        statuses[sid] = "unavailable";
        trace[`grade-error-${sid}`] = (e as Error).message;
        return [sid, []] as const;
      }
    })
  );
  const shortlists: Record<string, import("./retrieve.ts").Candidate[]> = Object.fromEntries(graded.map(([k, v]) => [k, [...v]]));
  emit({ type: "stage", stage: "search-quran", state: "done", count: shortlists.quran.length });
  emit({ type: "stage", stage: "search-books", state: "done", count: BOOK_SOURCES.reduce((n, s) => n + shortlists[s].length, 0) });
  mark("grading", t0);
  trace.candidates = Object.fromEntries(Object.entries(retrieval).map(([k, v]) => [k, v.candidates.map((c) => ({ id: c.recordId, score: Number(c.score.toFixed(4)), via: c.via }))]));
  trace.shortlists = Object.fromEntries(Object.entries(shortlists).map(([k, v]) => [k, v.map((c) => c.recordId)]));

  t0 = Date.now();
  emit({ type: "stage", stage: "analysing", state: "active" });
  const analysed = await Promise.all(
    [...["quran", ...BOOK_SOURCES].map((sid) => ({ sid, list: shortlists[sid] })), { sid: "dorar", list: [] }].map(async ({ sid, list }) => {
      if (sid === "dorar" ? !hadithEvidence.length : !list.length) return [];
      try {
        const r = await analyseSource(question, plan!, sid, list, index, hadithEvidence, nextId, sid === "quran" ? subjectVerses : []);
        if (r.meta) metas.push(r.meta);
        return r.cards;
      } catch (e) {
        statuses[sid] = "unavailable";
        trace[`analyst-error-${sid}`] = (e as Error).message;
        return [];
      }
    })
  );
  const cards = analysed.flat();
  const cardMap = new Map(cards.map((c) => [c.id, c]));
  if (statuses.muyassar === "found") statuses.muyassar = statuses.quran;
  const map: EvidenceMap = buildEvidenceMap(plan, statuses, cards);
  const outline = buildOutline(plan, cards, subjectVerses);
  emit({ type: "stage", stage: "analysing", state: "done", count: cards.filter((c) => c.usable).length });
  mark("analysis", t0);
  trace.cards = cards;
  trace.evidenceMap = map;
  trace.outline = outline.map((s) => ({ subQuestion: s.subQuestion, cards: s.cards.map((c) => c.id) }));

  const sourcesView = (): V2SourceStatus[] =>
    APPROVED_SOURCES.map((id) => {
      const used = cards.filter((c) => c.usable && (c.source === id || (id === "muyassar" && c.type === "quran")));
      const st: SourceStatus = statuses[id] === "found" ? (used.length ? "found" : "no_relevant_evidence") : statuses[id];
      return { id, label: SOURCE_LABEL[id], status: st, contributed: null };
    });

  if (!cards.some((c) => c.usable)) {
    const result: AskResultV2 = {
      ...base(),
      status: "abstain",
      language: plan.answer_language,
      summary: null,
      sections: [],
      gaps: plan.sub_questions.map((q) => ({ subQuestion: q.id, text: q.text })),
      abstain_reason: "لم أجد في المصادر المعتمدة نصوصًا تجيب عن هذا السؤال إجابة واضحة، فلم أكتب مسودة.",
      missing: "نصوص من المصادر المعتمدة تتناول السؤال مباشرة، أو مراجعة مختص.",
      sources: sourcesView(),
      records: {},
      verses: {},
      hadith: {},
      verified: false,
      notes: statuses.dorar === "unavailable" ? ["تعذر البحث في الحديث الآن، فلم يُنظر فيه."] : [],
    };
    result.ms = Date.now() - started;
    result.traceId = saveTrace({ ...trace, result, metas });
    return result;
  }

  // Stage 5: write by reference.
  t0 = Date.now();
  emit({ type: "stage", stage: "writing", state: "active" });
  const { draft, meta: wmeta } = await writeDraft(question, plan, outline, index, hadithMap);
  metas.push(wmeta);
  emit({ type: "stage", stage: "writing", state: "done" });
  mark("writing", t0);
  trace.draft = draft;

  // Stage 6: verify every item; summary first so it can be released as soon as it passes.
  t0 = Date.now();
  emit({ type: "stage", stage: "verifying", state: "active" });
  const check = (it: DraftItem): CheckedItem => {
    const m = mechanicalCheck(it, cardMap, index, hadithMap);
    return { kind: it.kind, text: it.text, cites: m.cites, mechanical: m.issues, review: [], passed: false };
  };
  const partsRaw: { id: string; heading: string; items: DraftItem[] }[] = [
    { id: "summary", heading: "", items: draft.summary },
    ...draft.sections.filter((s) => plan!.sub_questions.some((q) => q.id === s.sub_question)).map((s) => ({ id: s.sub_question, heading: s.heading, items: s.items })),
  ];
  const checked = partsRaw.map((p) => ({ ...p, checked: p.items.map(check) }));
  const reviewErrors: string[] = [];
  const reviewPart = async (p: (typeof checked)[number]) => {
    const r = await semanticReview(question, p.checked, index, hadithMap);
    metas.push(...r.metas);
    if (r.error) reviewErrors.push(r.error);
    p.checked.forEach(settle);
  };
  // All parts are reviewed at once; the summary is the shortest, so it settles first.
  await Promise.all(checked.map(reviewPart));

  // 6.5 Whole-answer review of the claims that passed, run alongside 6.3 repair.
  const firstPass = checked.flatMap((p) => p.checked.filter((it) => it.kind === "claim" && it.passed).map((it, k) => ({ id: `${p.id}:C${k + 1}`, item: it })));
  const wholePromise = wholeReview(
    question,
    plan.coverage_checklist,
    firstPass.map(({ id, item }) => ({ id, text: item.text, sources: item.cites.map((c) => c.recordId).join(", ") }))
  );

  // 6.3 Repair failing claims once.
  const failing = checked.flatMap((p) => p.checked.map((it, i) => ({ p, it, i }))).filter(({ it }) => it.kind === "claim" && !it.passed);
  if (failing.length && !reviewErrors.length) {
    const fixes = await repairClaims(
      question,
      failing.map(({ p, it, i }) => ({ key: `${p.id}#${i}`, item: it, original: p.items[i] })),
      cardMap,
      index,
      hadithMap,
      nextId,
      metas
    );
    const rechecks: { p: (typeof checked)[number]; i: number; item: CheckedItem }[] = [];
    for (const { p, i } of failing) {
      const fix = fixes.get(`${p.id}#${i}`);
      if (fix) rechecks.push({ p, i, item: check(fix) });
    }
    if (rechecks.length) {
      const r = await semanticReview(question, rechecks.map((x) => x.item), index, hadithMap);
      metas.push(...r.metas);
      for (const x of rechecks) {
        settle(x.item);
        if (x.item.passed) {
          x.item.repaired = true;
          x.p.checked[x.i] = x.item;
        }
      }
    }
    trace.repairs = failing.map(({ p, i }) => ({ part: p.id, index: i, fixed: p.checked[i].passed }));
  }

  const whole = await wholePromise;
  if (whole.meta) metas.push(whole.meta);
  const notes: string[] = [];
  let blockedAll = !!whole.error;
  if (whole.error) notes.push("تعذرت المراجعة الكلية للإجابة، فلا تُعرض على أنها متحقَّق منها.");
  for (const issue of whole.result?.issues ?? []) {
    if (issue.severity !== "block") continue;
    const targets = firstPass.filter((c) => issue.claims.includes(c.id));
    // Claims named by a blocking issue are removed; a block that names none withholds verification.
    if (targets.length) for (const t of targets) t.item.passed = false;
    else blockedAll = true;
  }
  trace.wholeReview = whole;

  // Keep only passing claims; keep a verse, hadith or quote block only when a passing claim in the same part cites that evidence.
  const parts: V2Part[] = [];
  const dropped: unknown[] = [];
  for (const p of checked) {
    const claimEvidence = new Set(p.checked.filter((it) => it.kind === "claim" && it.passed).flatMap((it) => it.cites.map((c) => c.evidence)));
    const blocks: V2Block[] = [];
    for (const it of p.checked) {
      const keep = it.kind === "claim" ? it.passed : it.passed && it.cites.some((c) => claimEvidence.has(c.evidence));
      if (keep) blocks.push({ kind: it.kind, text: it.text, cites: it.cites });
      else dropped.push({ part: p.id, kind: it.kind, text: it.text, mechanical: it.mechanical, review: it.review });
    }
    if (blocks.some((b) => b.kind === "claim")) parts.push({ id: p.id, heading: p.heading, blocks, verified: !reviewErrors.length });
  }
  trace.verification = checked.map((p) => ({ part: p.id, items: p.checked.map((it) => ({ kind: it.kind, text: it.text, passed: it.passed, mechanical: it.mechanical, review: it.review })) }));
  trace.dropped = dropped;

  const finalParts = parts.filter((p) => p.blocks.some((b) => b.kind === "claim"));
  emit({ type: "stage", stage: "verifying", state: "done", count: finalParts.reduce((n, p) => n + p.blocks.filter((b) => b.kind === "claim").length, 0) });
  mark("verification", t0);

  const summary = finalParts.find((p) => p.id === "summary") ?? null;
  const sections = finalParts.filter((p) => p.id !== "summary");
  const answeredSubs = new Set(sections.map((s) => s.id));
  const gaps = [
    ...draft.gaps.filter((g) => plan!.sub_questions.some((q) => q.id === g.sub_question) && !answeredSubs.has(g.sub_question)).map((g) => ({ subQuestion: g.sub_question, text: g.text })),
    ...plan.sub_questions.filter((q) => !answeredSubs.has(q.id) && !draft.gaps.some((g) => g.sub_question === q.id)).map((q) => ({ subQuestion: q.id, text: `لم أجد في المصادر المعتمدة ما يجيب عن: ${q.text}` })),
  ];
  const payload = collectPayload(index, finalParts, hadithMap);
  if (summary && summary.verified) emit({ type: "part", part: summary, ...payload });
  for (const s of sections) if (s.verified) emit({ type: "part", part: s, ...payload });

  const sources = sourcesView().map((s) => {
    const cited = finalParts.flatMap((p) => p.blocks.flatMap((b) => b.cites)).filter((c) => (s.id === "muyassar" ? c.type === "quran" && c.sentenceIds.length : (index.records.get(c.recordId)?.sourceId ?? (c.dorarId ? "dorar" : "")) === s.id));
    return { ...s, contributed: cited.length ? `استُشهد به في ${cited.length} ${cited.length === 1 ? "موضع" : "مواضع"}` : null };
  });
  if (statuses.dorar === "unavailable") notes.push("تعذر البحث في الحديث الآن، فلم يُنظر فيه.");
  if (!crossFamily) notes.push("المراجِع الثاني من عائلة النموذج الكاتب نفسها (بديل مؤقت للتطوير)، فلا تُعرض الإجابة على أنها متحقَّق منها.");

  const anyClaims = !!summary || sections.length > 0;
  const result: AskResultV2 = {
    ...base(),
    status: !anyClaims ? "abstain" : gaps.length ? "partial" : "answer",
    language: plan.answer_language,
    summary,
    sections,
    gaps,
    abstain_reason: anyClaims ? "" : "كُتبت مسودة، لكن لم تجتز جملها التحقق، فلم نعرضها.",
    missing: anyClaims ? "" : "نصوص أوضح دلالة على السؤال، أو مراجعة مختص.",
    sources,
    ...payload,
    verified: anyClaims && crossFamily && !blockedAll && !reviewErrors.length && finalParts.every((p) => p.verified),
    notes,
  };
  result.ms = Date.now() - started;
  trace.result = { status: result.status, verified: result.verified, ms: result.ms };
  trace.metas = metas;
  trace.timings = timings;
  result.traceId = saveTrace(trace);
  void normalizeArabic;
  return result;
}

export { type Plan };
export type { Draft };
