// Stages 2b-4: grading candidates within each source, per-source analysis into evidence cards,
// the evidence map (sub-question x source), and the answer outline. Models only point at sentence
// numbers; every text shown later is cut from the stored records by offsets.

import { V2_LIMITS, V2_MODELS } from "./config.ts";
import { openaiStructured, type CallMeta } from "./llm.ts";
import type { HadithEvidence } from "./hadith.ts";
import type { Plan } from "./planner.ts";
import type { Candidate, SourceResult, SourceStatus } from "./retrieve.ts";
import type { V2Index } from "./corpus-v2.ts";
import type { Sentence, Speaker, V2Record } from "./types.ts";

export const SPEAKER_AR: Record<Speaker, string> = {
  author: "المؤلف",
  quoted_question: "سؤال السائل",
  quoted_objection: "عرض الشبهة",
  quoted_other: "منقول عن غيره (حديث أو قول)",
};

export type Role = "dalil" | "sharh" | "mithal" | "radd" | "none";
export type Strength = "strong" | "partial";

export interface Card {
  id: string;
  source: string;
  type: "quran" | "tafsir" | "hadith" | "book";
  recordId: string;
  sentenceIds: string[];
  /** Quran cards: the verse range, and the Al-Muyassar sentences that carry its meaning */
  verse?: { surah: number; from: number; to: number };
  tafsirSentenceIds?: string[];
  dorarId?: string;
  role: Role;
  subQuestion: string;
  speaker: Speaker;
  strength: Strength;
  note: string;
  /** False when a rule forbids using it (e.g. not the author's own words) */
  usable: boolean;
  rejectReason?: string;
}

// ---------- Excerpts ----------

/** Sentences of a record around the best-matching units, with neighbours for context. */
export function excerptSentences(rec: V2Record, units: { start: number; end: number }[], context = 2, maxChars = 1400): Sentence[] {
  const keep = new Set<number>();
  for (const u of units.slice(0, 2)) {
    rec.sentences.forEach((s, i) => {
      if (s.end > u.start && s.start < u.end) for (let k = i - context; k <= i + context; k++) if (k >= 0 && k < rec.sentences.length) keep.add(k);
    });
  }
  const out: Sentence[] = [];
  let chars = 0;
  for (const i of [...keep].sort((a, b) => a - b)) {
    const s = rec.sentences[i];
    if (chars + (s.end - s.start) > maxChars && out.length) break;
    out.push(s);
    chars += s.end - s.start;
  }
  return out;
}

const sentenceLine = (rec: V2Record, s: Sentence) => `  S${s.n} (${SPEAKER_AR[s.speaker]}): ${rec.text.slice(s.start, s.end).replace(/\s+/g, " ")}`;

// ---------- Grading (rerank inside one source) ----------

const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["grades"],
  properties: {
    grades: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "relevance"],
        properties: { item: { type: "string" }, relevance: { type: "integer", enum: [0, 1, 2, 3] } },
      },
    },
  },
};

const GRADE_INSTRUCTIONS = `You grade search results from ONE approved source for relevance to a question asked of a Muslim daʿi. Grade every item:
3 = directly answers the question or one of its sub-questions; 2 = clearly relevant evidence or explanation; 1 = loosely related topic only; 0 = unrelated.
Judge only what the text says. Text marked سؤال السائل or عرض الشبهة is the asker's or an opponent's words, not the author's position: an item is relevant only if the author's own words address the question.`;

export async function gradeSource(question: string, plan: Plan, source: SourceResult, index: V2Index): Promise<{ shortlist: Candidate[]; meta: CallMeta | null }> {
  const cands = source.candidates;
  if (!cands.length) return { shortlist: [], meta: null };
  const items = cands.map((c, i) => {
    const rec = index.records.get(c.recordId)!;
    if (rec.kind === "quran") {
      const t = index.tafsirOf.get(rec.id);
      return `[I${i + 1}] ${rec.refLabel} — التفسير الميسر: ${(t?.text ?? "").slice(0, 400)}`;
    }
    const ex = excerptSentences(rec, c.units, 1, 520);
    return `[I${i + 1}] ${rec.refLabel}\n${ex.map((s) => sentenceLine(rec, s)).join("\n")}`;
  });
  const input = `QUESTION: ${question}\nSUB-QUESTIONS:\n${plan.sub_questions.map((q) => `- ${q.id}: ${q.text}`).join("\n")}\n\nITEMS:\n${items.join("\n\n")}`;
  const { data, meta } = await openaiStructured<{ grades: { item: string; relevance: number }[] }>({
    name: "relevance_grades",
    schema: GRADE_SCHEMA,
    instructions: GRADE_INSTRUCTIONS,
    input,
    model: V2_MODELS.grader(),
    effort: "low",
    maxOutputTokens: 3000,
    timeoutMs: 60000,
  });
  const grade = new Map(data.grades.map((g) => [Number(g.item.replace(/\D/g, "")) - 1, g.relevance]));
  const limit = source.sourceId === "quran" ? V2_LIMITS.shortlistQuran : V2_LIMITS.shortlistPerSource;
  const ranked = cands
    .map((c, i) => ({ c, g: grade.get(i) ?? 0, i }))
    .filter((x) => x.g >= 2)
    .sort((a, b) => b.g - a.g || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
  return { shortlist: ranked, meta };
}

// ---------- Per-source analysis ----------

const CARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "through_item", "sentences", "role", "sub_question", "strength", "note"],
        properties: {
          item: { type: "string" },
          through_item: { type: "string" },
          sentences: { type: "array", items: { type: "integer" } },
          role: { type: "string", enum: ["dalil", "sharh", "mithal", "radd", "none"] },
          sub_question: { type: "string" },
          strength: { type: "string", enum: ["strong", "partial"] },
          note: { type: "string" },
        },
      },
    },
  },
};

const ANALYST_INSTRUCTIONS = `You analyse evidence from ONE approved source for a question asked of a Muslim daʿi. You do not write the answer. For each item that helps answer a sub-question, return evidence cards.

Each card: item (e.g. "I2"); through_item ("" unless a Quran card spans consecutive verse items, then the last one); sentences (the numbers of the exact S or T sentences that carry the point; for Quran items list the T sentences of the tafsir); role; sub_question (an id from SUB-QUESTIONS); strength; note (one short Arabic line on why).

Roles:
- dalil: direct textual evidence for the point (a verse whose tafsir states it, a hadith that states it, or the author's direct statement of it).
- sharh: explanation or interpretation of evidence.
- mithal: an example or historical context. A historical account is mithal, not dalil.
- radd: the author's rebuttal of an objection.
- none: relevant background only.
Strength: strong = states the point clearly; partial = supports part of it or only implicitly.

Rules:
- Only use what the sentences say. Never add knowledge, tafsir or history from outside them.
- Sentences marked سؤال السائل or عرض الشبهة are the asker's or an opponent's words: never cite them as dalil, sharh or radd for the author's position. Sentences marked منقول عن غيره are quotations (often a hadith): cite them only as what the author quotes, never as hadith evidence.
- A verse is relevant only when its tafsir sentences state the point; never pick a verse for variety.
- An item marked as the verse the asker quoted is the subject of the question: always return a card for it (role sharh) with the tafsir sentences that explain it, and cards for neighbouring verses whose tafsir gives its context or limits.
- Return no card for items that do not help. Returning no cards at all is a valid answer.`;

interface ItemRef {
  label: string;
  rec: V2Record;
  sentences: Sentence[];
  /** Quran items: the tafsir record and its sentences */
  tafsir?: V2Record;
  hadith?: HadithEvidence;
  /** The verse the asker quoted (the subject of the question) */
  subject?: boolean;
}

function analystItems(source: string, shortlist: Candidate[], index: V2Index, hadith: HadithEvidence[], subjectVerses: string[] = []): ItemRef[] {
  if (source === "dorar")
    return hadith.map((h, i) => ({ label: `I${i + 1}`, rec: { id: h.id, sourceId: "dorar", kind: "hadith", title: h.book, refLabel: `${h.book}${h.locator ? `، ${h.locator}` : ""}`, text: h.text, quotable: true, sections: [], sentences: [], verseRefs: [], quotedHadith: [], emptyMarkers: [] }, sentences: [], hadith: h }));
  if (source === "quran") {
    // Verse windows: the quoted verse and the top shortlisted verses get their neighbours as context.
    const keys = new Set<string>();
    const top = [...subjectVerses, ...shortlist.map((c) => c.recordId)];
    top.forEach((id, k) => {
      const r = index.records.get(id);
      if (!r) return;
      const span = subjectVerses.includes(id) ? [-2, -1, 0, 1, 2] : k < subjectVerses.length + 5 ? [-1, 0, 1] : [0];
      for (const d of span) if (index.records.has(`quran:${r.surah}:${r.ayah! + d}`)) keys.add(`quran:${r.surah}:${r.ayah! + d}`);
    });
    const sorted = [...keys].sort((a, b) => {
      const [, s1, a1] = a.split(":").map(Number);
      const [, s2, a2] = b.split(":").map(Number);
      return s1 - s2 || a1 - a2;
    });
    return sorted.map((id, i) => {
      const rec = index.records.get(id)!;
      const tafsir = index.tafsirOf.get(id);
      return { label: `I${i + 1}`, rec, sentences: tafsir?.sentences ?? [], tafsir, subject: subjectVerses.includes(id) };
    });
  }
  return shortlist.map((c, i) => {
    const rec = index.records.get(c.recordId)!;
    return { label: `I${i + 1}`, rec, sentences: excerptSentences(rec, c.units, 2, 1600) };
  });
}

function renderItems(items: ItemRef[]): string {
  return items
    .map((it) => {
      if (it.hadith) {
        const h = it.hadith;
        return `[${it.label}] حديث — ${h.book}${h.locator ? `، ${h.locator}` : ""} — الراوي: ${h.narrator} — الحكم كما في الدرر: ${h.grade} (${h.muhaddith})\n  S1: ${h.text}`;
      }
      if (it.rec.kind === "quran") {
        const t = it.tafsir!;
        return `[${it.label}] ${it.rec.refLabel}${it.subject ? " (الآية التي ذكرها السائل في سؤاله)" : ""} — التفسير الميسر:\n${t.sentences.map((s) => `  T${s.n}: ${t.text.slice(s.start, s.end)}`).join("\n")}`;
      }
      return `[${it.label}] ${it.rec.refLabel}${it.rec.ocr ? " (نص مستخرج ضوئيًا)" : ""}\n${it.sentences.map((s) => sentenceLine(it.rec, s)).join("\n")}`;
    })
    .join("\n\n");
}

export async function analyseSource(
  question: string,
  plan: Plan,
  source: string,
  shortlist: Candidate[],
  index: V2Index,
  hadith: HadithEvidence[],
  nextId: () => string,
  subjectVerses: string[] = []
): Promise<{ cards: Card[]; meta: CallMeta | null; items: number }> {
  const items = analystItems(source, shortlist, index, hadith, subjectVerses);
  if (!items.length) return { cards: [], meta: null, items: 0 };
  const input = `QUESTION: ${question}\nSUB-QUESTIONS:\n${plan.sub_questions.map((q) => `- ${q.id}: ${q.text}`).join("\n")}\n\nSOURCE: ${source}\nITEMS:\n${renderItems(items)}`;
  const schema = JSON.parse(JSON.stringify(CARD_SCHEMA));
  schema.properties.cards.items.properties.sub_question = { type: "string", enum: plan.sub_questions.map((q) => q.id) };
  schema.properties.cards.items.properties.item = { type: "string", enum: items.map((it) => it.label) };
  schema.properties.cards.items.properties.through_item = { type: "string", enum: ["", ...items.map((it) => it.label)] };
  const { data, meta } = await openaiStructured<{ cards: { item: string; through_item: string; sentences: number[]; role: Role; sub_question: string; strength: Strength; note: string }[] }>({
    name: "evidence_cards",
    schema,
    instructions: ANALYST_INSTRUCTIONS,
    input,
    model: V2_MODELS.analyst(),
    effort: "low",
    maxOutputTokens: 6000,
    timeoutMs: 90000,
  });
  const byLabel = new Map(items.map((it) => [it.label, it]));
  const subIds = new Set(plan.sub_questions.map((q) => q.id));
  const cards: Card[] = [];
  for (const c of data.cards) {
    const it = byLabel.get(c.item);
    if (!it || !subIds.has(c.sub_question) || c.role === "none") continue;
    const card: Card = { id: nextId(), source, type: "book", recordId: it.rec.id, sentenceIds: [], role: c.role, subQuestion: c.sub_question, speaker: "author", strength: c.strength, note: c.note, usable: true };
    if (it.hadith) {
      card.type = "hadith";
      card.dorarId = it.hadith.id;
      card.speaker = "quoted_other";
    } else if (it.rec.kind === "quran") {
      card.type = "quran";
      const last = byLabel.get(c.through_item) ?? it;
      const from = it.rec.ayah!;
      const to = last.rec.surah === it.rec.surah && last.rec.ayah! >= from && last.rec.ayah! - from <= 5 ? last.rec.ayah! : from;
      card.verse = { surah: it.rec.surah!, from, to };
      card.sentenceIds = [`${it.rec.id}:s1`];
      // Tafsir sentences may come from any verse of the window; keep only real ones.
      const tafsirSentences: string[] = [];
      for (let a = from; a <= to; a++) {
        const t = index.tafsirOf.get(`quran:${it.rec.surah}:${a}`);
        for (const n of c.sentences) if (t?.sentences.some((s) => s.n === n)) tafsirSentences.push(`${t.id}:s${n}`);
      }
      card.tafsirSentenceIds = [...new Set(tafsirSentences)];
      if (!card.tafsirSentenceIds.length) {
        card.usable = false;
        card.rejectReason = "Quran card without the Al-Muyassar sentences that carry its meaning";
      }
    } else {
      const shown = new Set(it.sentences.map((s) => s.n));
      const valid = c.sentences.filter((n) => shown.has(n));
      card.type = it.rec.kind === "tafsir" ? "tafsir" : "book";
      card.sentenceIds = valid.map((n) => `${it.rec.id}:s${n}`);
      const speakers = new Set(valid.map((n) => it.rec.sentences.find((s) => s.n === n)!.speaker));
      card.speaker = speakers.size === 1 ? [...speakers][0] : speakers.has("author") ? "author" : [...speakers][0];
      if (!valid.length) {
        card.usable = false;
        card.rejectReason = "cites sentences that were not shown";
      } else if ([...speakers].some((s) => s !== "author") && ["dalil", "sharh", "radd"].includes(c.role)) {
        card.usable = false;
        card.rejectReason = "cites words that are not the author's own (question, objection or quotation) as the author's position";
      }
    }
    cards.push(card);
  }
  return { cards, meta, items: items.length };
}

// ---------- Evidence map and outline ----------

export interface MapCell {
  status: SourceStatus | "not_searched";
  cards: string[];
}

export interface EvidenceMap {
  subQuestions: { id: string; text: string }[];
  cells: Record<string, Record<string, MapCell>>;
  gaps: string[];
}

export function buildEvidenceMap(plan: Plan, statuses: Record<string, SourceStatus>, cards: Card[]): EvidenceMap {
  const cells: EvidenceMap["cells"] = {};
  for (const q of plan.sub_questions) {
    cells[q.id] = {};
    for (const [sid, st] of Object.entries(statuses)) {
      const own = cards.filter((c) => c.usable && c.subQuestion === q.id && (c.source === sid || (sid === "muyassar" && c.type === "quran")));
      cells[q.id][sid] = { status: st === "found" ? (own.length ? "found" : "no_relevant_evidence") : st, cards: own.map((c) => c.id) };
    }
  }
  const gaps = plan.sub_questions.filter((q) => !cards.some((c) => c.usable && c.subQuestion === q.id)).map((q) => q.id);
  return { subQuestions: plan.sub_questions, cells, gaps };
}

export interface OutlineSection {
  subQuestion: string;
  text: string;
  cards: Card[];
}

/**
 * Deterministic outline: per sub-question, strongest cards first; a verse leads only when it is a
 * strong dalil; when several sources have strong cards, more than one source is kept (balance);
 * nothing is added just for diversity.
 */
export function buildOutline(plan: Plan, cards: Card[], subjectVerses: string[] = []): OutlineSection[] {
  const rank = (c: Card) => (c.strength === "strong" ? 0 : 2) + (c.role === "dalil" ? 0 : c.role === "radd" ? 0.3 : c.role === "sharh" ? 0.6 : 1);
  return plan.sub_questions.map((q) => {
    const own = cards.filter((c) => c.usable && c.subQuestion === q.id);
    // The verse the asker quoted leads (it is the subject), then strong direct-evidence verses.
    const subject = own.filter((c) => c.type === "quran" && subjectVerses.includes(c.recordId));
    const verses = [...subject, ...own.filter((c) => c.type === "quran" && !subject.includes(c) && c.role === "dalil" && c.strength === "strong").sort((a, b) => rank(a) - rank(b))].slice(0, 3);
    const others = own.filter((c) => c.type !== "quran").sort((a, b) => rank(a) - rank(b));
    // Balance: take the best card of each source first, then fill by rank.
    const picked: Card[] = [];
    const seen = new Set<string>();
    for (const c of others)
      if (!seen.has(c.source) && c.strength === "strong") {
        seen.add(c.source);
        picked.push(c);
      }
    for (const c of others) if (!picked.includes(c) && picked.length < 6) picked.push(c);
    const partialVerses = own.filter((c) => c.type === "quran" && !verses.includes(c) && c.strength === "strong" && c.role !== "dalil").slice(0, 1);
    return { subQuestion: q.id, text: q.text, cards: [...verses, ...picked.sort((a, b) => rank(a) - rank(b)), ...partialVerses] };
  });
}
