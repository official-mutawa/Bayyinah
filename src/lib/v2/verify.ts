// Stage 6: verification and repair, fail-closed.
// 6.1 mechanical checks (ids resolve, sentence ids belong to the cited evidence, speaker is the
//     author, verses and hadith are valid, no Quran wording or consensus claim in the writer's text);
// 6.2 semantic support review per claim-citation pair by the reviewer model (another family when
//     configured); 6.3 one targeted retrieval + one narrowed rewrite for failing claims;
// 6.5 whole-answer review. Passing mechanical checks never counts as proof of support.

import { normalizeMapped } from "../arabic.ts";
import { reviewerIsCrossFamily, V2_LIMITS, V2_MODELS } from "./config.ts";
import { anthropicStructured, geminiStructured, openaiStructured, type CallMeta, type StructuredCall } from "./llm.ts";
import { SPEAKER_AR, type Card } from "./evidence.ts";
import type { HadithEvidence } from "./hadith.ts";
import type { V2Index } from "./corpus-v2.ts";
import type { Cite, DraftItem } from "./writer.ts";

export interface ResolvedCite {
  evidence: string;
  type: Card["type"];
  recordId: string;
  sentenceIds: string[];
  verse?: { surah: number; from: number; to: number };
  dorarId?: string;
}

export interface CheckedItem {
  kind: DraftItem["kind"];
  text: string;
  cites: ResolvedCite[];
  mechanical: string[];
  review: PairVerdict[];
  passed: boolean;
  repaired?: boolean;
}

export interface PairVerdict {
  evidence: string;
  verdict: "supported" | "partial" | "unsupported" | "contradicted" | "irrelevant" | "error";
  supporting_span: number[];
  attribution_ok: boolean;
  context_ok: boolean;
  issues: string[];
  reason: string;
}

// ---------- 6.1 Mechanical ----------

const words = (t: string) => normalizeMapped(t, true).text.split(" ").filter(Boolean);
function windows(t: string, n: number): Set<string> {
  const w = words(t);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

const quranWindowsByIndex = new WeakMap<V2Index, Set<string>>();
function allQuranWindows(index: V2Index): Set<string> {
  const hit = quranWindowsByIndex.get(index);
  if (hit) return hit;
  const set = new Set<string>();
  for (const r of index.corpus.records) if (r.kind === "quran") for (const w of windows(r.text, 5)) set.add(w);
  quranWindowsByIndex.set(index, set);
  return set;
}

const CONSENSUS = /أجمع\s*(ال)?علماء|بالإجماع|بإجماع|إجماع\s*(ال)?(أمة|علماء|المسلمين)|اتفق\s*(ال)?علماء/;
const HADITH_CLAIM = /(نصوص|أحاديث)\s*(من\s*)?السنة|(وردت|تبيّن|تبين|تدل|جاءت|ورد)\s*(في\s*)?(السنة|الأحاديث|أحاديث)|في\s*الحديث\s*(أن|الشريف)|الحديث\s*الشريف|(قال|يقول|أخبر|أمر|نهى)\s*(النبي|رسول\s*الله)/;
const AUTHOR_REPORT = /(يذكر|ذكر|يروي|روى|أورد|يورد|ينقل|نقل|يحكي|حكى)\s*(ال)?(مؤلف|كتاب|نص|مصدر|شارح)/;

export function mechanicalCheck(item: DraftItem, cards: Map<string, Card>, index: V2Index, hadith: Map<string, HadithEvidence>): { cites: ResolvedCite[]; issues: string[] } {
  const issues: string[] = [];
  const cites: ResolvedCite[] = [];
  if (item.kind === "claim" && !item.text.trim()) issues.push("empty claim");
  if (!item.cites.length) issues.push("no citation");
  // The same evidence cited twice in one item is one citation (sentence numbers merged).
  const merged = new Map<string, Cite>();
  for (const c of item.cites as Cite[]) {
    const m = merged.get(c.evidence);
    if (m) m.sentences = [...new Set([...m.sentences, ...c.sentences])];
    else merged.set(c.evidence, { evidence: c.evidence, sentences: [...c.sentences] });
  }
  for (const c of merged.values()) {
    const card = cards.get(c.evidence);
    if (!card) {
      issues.push(`cites unknown evidence ${c.evidence}`);
      continue;
    }
    if (!card.usable) {
      issues.push(`cites evidence that may not be used (${card.rejectReason})`);
      continue;
    }
    const rc: ResolvedCite = { evidence: card.id, type: card.type, recordId: card.recordId, sentenceIds: [], verse: card.verse, dorarId: card.dorarId };
    if (card.type === "quran") {
      const tafsirIds = new Set(card.tafsirSentenceIds ?? []);
      const picked = (card.tafsirSentenceIds ?? []).filter((sid) => c.sentences.includes(Number(sid.split(":s").pop())));
      if (c.sentences.some((n) => ![...tafsirIds].some((sid) => sid.endsWith(`:s${n}`)))) issues.push(`${c.evidence}: tafsir sentence numbers not in the evidence`);
      rc.sentenceIds = picked;
      if (!index.records.has(`quran:${card.verse!.surah}:${card.verse!.from}`) || !index.records.has(`quran:${card.verse!.surah}:${card.verse!.to}`)) issues.push(`${c.evidence}: verse not in the Quran data`);
    } else if (card.type === "hadith") {
      const h = hadith.get(card.dorarId!);
      if (!h) issues.push(`${c.evidence}: hadith not among whitelisted Dorar results`);
    } else {
      const own = new Set(card.sentenceIds);
      const ids = c.sentences.map((n) => `${card.recordId}:s${n}`);
      if (!ids.length) issues.push(`${c.evidence}: no sentence numbers`);
      for (const id of ids) if (!own.has(id)) issues.push(`${c.evidence}: sentence ${id.split(":s").pop()} is not part of the evidence`);
      rc.sentenceIds = ids.filter((id) => own.has(id));
      const rec = index.records.get(card.recordId)!;
      for (const id of rc.sentenceIds) {
        const s = rec.sentences.find((x) => x.id === id)!;
        if (s.speaker !== "author") issues.push(`${c.evidence}: sentence ${s.n} is ${s.speaker}, not the author's own words`);
      }
      if (item.kind === "quote" && !rec.quotable) issues.push(`${c.evidence}: OCR text may not be shown as a verbatim quotation`);
    }
    cites.push(rc);
  }
  if (item.kind === "claim") {
    const claimWin = windows(item.text, 5);
    if ([...claimWin].some((w) => allQuranWindows(index).has(w))) issues.push("claim text contains Quran wording; refer to the verse instead");
    for (const rc of cites.filter((x) => x.verse)) {
      for (let a = rc.verse!.from; a <= rc.verse!.to; a++) {
        const v = index.records.get(`quran:${rc.verse!.surah}:${a}`);
        const vw = windows(v?.text ?? "", 4);
        if ([...windows(item.text, 4)].some((w) => vw.has(w))) issues.push("claim text repeats wording of the cited verse");
      }
    }
    if (CONSENSUS.test(item.text)) issues.push("claims consensus");
    // What a hadith or the Sunnah says needs a whitelisted Dorar record; otherwise the claim may only
    // report what the author says (a hadith quoted inside a book is not hadith evidence).
    const hadithy = HADITH_CLAIM.test(item.text);
    const framed = AUTHOR_REPORT.test(item.text);
    if (hadithy && !cites.some((x) => x.type === "hadith") && !framed) issues.push("states what a hadith or the Sunnah says without a whitelisted Dorar hadith; report only what the author says");
    if (cites.some((x) => x.type === "quran") && !cites.some((x) => (x.type === "quran" && x.sentenceIds.length) || x.type === "book")) issues.push("a verse's meaning is stated without citing its tafsir sentences or a book that explains it");
  }
  if (item.kind === "quran" && !cites.some((x) => x.type === "quran")) issues.push("verse block without a verse");
  if (item.kind === "hadith" && !cites.some((x) => x.type === "hadith")) issues.push("hadith block without a hadith");
  if (item.kind === "quote" && !cites.some((x) => x.type === "book" || x.type === "tafsir")) issues.push("quote block without a book passage");
  return { cites, issues };
}

// ---------- 6.2 Semantic review ----------

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pair", "verdict", "supporting_span", "attribution_ok", "context_ok", "issues", "reason"],
        properties: {
          pair: { type: "string" },
          verdict: { type: "string", enum: ["supported", "partial", "unsupported", "contradicted", "irrelevant"] },
          supporting_span: { type: "array", items: { type: "integer" } },
          attribution_ok: { type: "boolean" },
          context_ok: { type: "boolean" },
          issues: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
      },
    },
  },
};

const REVIEW_INSTRUCTIONS = `You are a strict, independent reviewer of citations in Arabic answers about Islam. For each PAIR you get a claim and ONE cited source span, with two sentences of context on each side and who is speaking in each sentence. Judge only that span; you do not know why it was cited.

verdict:
- supported: the cited sentences state the claim or directly entail it, with no outside knowledge, no added detail, no broader scope.
- partial: they support only part of the claim.
- unsupported: they do not support it (shared words or the same topic are NOT support).
- contradicted: they say the opposite (e.g. the claim states an objection that the author refutes).
- irrelevant: about something else.
supporting_span: the sentence numbers that support it ([] if none).
attribution_ok: false if the claim presents as the author's (or the Prophet's ﷺ, or a scholar's) position words that are the asker's question, an objection being answered, or someone else being quoted, or attributes words to someone the span does not.
context_ok: false if using this span (especially a verse) for this claim changes its meaning given the context.
issues: any of: scope, negation, conditions, overgeneralization, attribution, verse wording in claim, fiqh ruling, consensus claim — each as a short Arabic note.
reason: one short Arabic sentence.`;

async function reviewerCall<T>(c: Omit<StructuredCall, "model">): Promise<{ data: T; meta: CallMeta }> {
  const r = V2_MODELS.reviewer();
  const call = { ...c, model: r.model };
  if (r.provider === "anthropic") return anthropicStructured<T>(call);
  if (r.provider === "google") return geminiStructured<T>(call);
  return openaiStructured<T>({ ...call, effort: "low" });
}

function spanBlock(index: V2Index, rc: ResolvedCite, hadith: Map<string, HadithEvidence>): string {
  if (rc.type === "hadith") {
    const h = hadith.get(rc.dorarId!)!;
    return `حديث — ${h.book}${h.locator ? `، ${h.locator}` : ""} — الحكم كما في الدرر: ${h.grade} (${h.muhaddith})\nS1 (نص الحديث): ${h.text}`;
  }
  const parts: string[] = [];
  if (rc.verse) {
    for (let a = rc.verse.from; a <= rc.verse.to; a++) {
      const v = index.records.get(`quran:${rc.verse.surah}:${a}`)!;
      parts.push(`آية (${v.refLabel}): ${v.text.replace(/﻿/g, "")}`);
    }
  }
  const byRec = new Map<string, string[]>();
  for (const sid of rc.sentenceIds) {
    const rid = sid.replace(/:s\d+$/, "");
    byRec.set(rid, [...(byRec.get(rid) ?? []), sid]);
  }
  for (const [rid, sids] of byRec) {
    const rec = index.records.get(rid)!;
    const idx = sids.map((sid) => rec.sentences.findIndex((s) => s.id === sid)).filter((i) => i >= 0);
    const lo = Math.max(0, Math.min(...idx) - V2_LIMITS.reviewContext);
    const hi = Math.min(rec.sentences.length - 1, Math.max(...idx) + V2_LIMITS.reviewContext);
    const lines = [];
    for (let i = lo; i <= hi; i++) {
      const s = rec.sentences[i];
      const cited = sids.includes(s.id) ? "◀ مستشهد به" : "سياق";
      lines.push(`S${s.n} [${cited}؛ ${SPEAKER_AR[s.speaker]}]: ${rec.text.slice(s.start, s.end)}`);
    }
    parts.push(`${rec.refLabel}\n${lines.join("\n")}`);
  }
  return parts.join("\n");
}

/** Review every claim-citation pair of the given items. Errors fail closed (verdict "error"). */
export async function semanticReview(question: string, items: CheckedItem[], index: V2Index, hadith: Map<string, HadithEvidence>): Promise<{ metas: CallMeta[]; error: string | null }> {
  const pairs: { item: CheckedItem; cite: ResolvedCite; label: string }[] = [];
  items.forEach((it, i) => {
    if (it.kind !== "claim" || it.mechanical.length) return;
    it.cites.forEach((c, j) => pairs.push({ item: it, cite: c, label: `P${i + 1}.${j + 1}` }));
  });
  if (!pairs.length) return { metas: [], error: null };
  const input = `QUESTION: ${question}\n\n${pairs.map((p) => `[${p.label}]\nCLAIM: ${p.item.text}\nCITED SPAN:\n${spanBlock(index, p.cite, hadith)}`).join("\n\n")}`;
  try {
    const { data, meta } = await reviewerCall<{ results: (Omit<PairVerdict, "evidence"> & { pair: string })[] }>({
      name: "support_review",
      schema: REVIEW_SCHEMA,
      instructions: REVIEW_INSTRUCTIONS,
      input,
      maxOutputTokens: 8000,
      timeoutMs: 120000,
    });
    for (const p of pairs) {
      const r = data.results.find((x) => x.pair === p.label);
      p.item.review.push(
        r
          ? { evidence: p.cite.evidence, verdict: r.verdict, supporting_span: r.supporting_span, attribution_ok: r.attribution_ok, context_ok: r.context_ok, issues: r.issues, reason: r.reason }
          : { evidence: p.cite.evidence, verdict: "error", supporting_span: [], attribution_ok: false, context_ok: false, issues: ["no verdict returned"], reason: "" }
      );
    }
    return { metas: [meta], error: null };
  } catch (e) {
    for (const p of pairs) p.item.review.push({ evidence: p.cite.evidence, verdict: "error", supporting_span: [], attribution_ok: false, context_ok: false, issues: ["review failed"], reason: (e as Error).message.slice(0, 120) });
    return { metas: [], error: (e as Error).message };
  }
}

const pairPasses = (v: PairVerdict) => v.verdict === "supported" && v.attribution_ok && v.context_ok && !v.issues.length;

/** A claim passes when it has no mechanical issue, no contradicted pair, and at least one fully passing pair; failing pairs are removed from its citations. */
export function settle(item: CheckedItem): void {
  if (item.kind !== "claim") {
    item.passed = !item.mechanical.length;
    return;
  }
  if (item.mechanical.length || !item.review.length) {
    item.passed = false;
    return;
  }
  const good = item.review.filter(pairPasses).map((v) => v.evidence);
  const contradicted = item.review.some((v) => v.verdict === "contradicted" || v.verdict === "error");
  item.passed = !contradicted && good.length > 0;
  if (item.passed) item.cites = item.cites.filter((c) => good.includes(c.evidence));
}

// ---------- 6.5 Whole-answer review ----------

const WHOLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issues", "uncovered"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claims", "type", "severity", "note"],
        properties: {
          claims: { type: "array", items: { type: "string" } },
          type: { type: "string", enum: ["emergent_claim", "forced_verse", "fiqh_ruling", "fatwa", "consensus", "weak_hadith", "unfair_disagreement", "judgment_on_fate", "other"] },
          severity: { type: "string", enum: ["block", "note"] },
          note: { type: "string" },
        },
      },
    },
    uncovered: { type: "array", items: { type: "string" } },
  },
};

const WHOLE_INSTRUCTIONS = `You review a complete draft answer (already checked claim by claim) as a whole. Report:
- emergent_claim: two or more claims that together imply something no single cited source says;
- fiqh_ruling or fatwa: any new ruling, or a ruling for a personal case;
- consensus: any claim of scholarly consensus;
- weak_hadith: any hadith shown without an accepted ruling;
- unfair_disagreement: sources that differ but are presented unfairly or reconciled without a source;
- judgment_on_fate: any judgment on a person's or group's fate.
- forced_verse: a verse used for a point that its cited tafsir does not directly address for THIS question (a general principle or another situation applied here); severity block, naming the claim that uses it.
claims: the SMALLEST set of claim ids whose removal fixes the issue (e.g. ["q2:C3"]); for emergent_claim name only the claim that adds the unsupported link, not every claim involved; never empty for a block. severity: block only when the answer must not be shown with those claims; otherwise note.
uncovered: checklist points the answer does not address (short Arabic).`;

export async function wholeReview(question: string, checklist: string[], claims: { id: string; text: string; sources: string }[]): Promise<{ result: { issues: { claims: string[]; type: string; severity: "block" | "note"; note: string }[]; uncovered: string[] } | null; meta: CallMeta | null; error: string | null }> {
  if (!claims.length) return { result: { issues: [], uncovered: [] }, meta: null, error: null };
  try {
    const { data, meta } = await reviewerCall<{ issues: { claims: string[]; type: string; severity: "block" | "note"; note: string }[]; uncovered: string[] }>({
      name: "whole_review",
      schema: WHOLE_SCHEMA,
      instructions: WHOLE_INSTRUCTIONS,
      input: `QUESTION: ${question}\nCHECKLIST:\n${checklist.map((x) => `- ${x}`).join("\n")}\n\nANSWER:\n${claims.map((c) => `[${c.id}] ${c.text} (${c.sources})`).join("\n")}`,
      maxOutputTokens: 4000,
      timeoutMs: 90000,
    });
    return { result: data, meta, error: null };
  } catch (e) {
    return { result: null, meta: null, error: (e as Error).message };
  }
}

export const crossFamily = reviewerIsCrossFamily;
