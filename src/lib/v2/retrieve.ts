// Stage 2: per-source retrieval. Every approved source is searched on its own (no competition for a
// shared top-10), with hybrid BM25 + embeddings fused by RRF inside the source only. Quran
// candidates also come from the verses that top book records cite (verse-citation graph), from
// verse wording the user quoted, and from named verses (آية الكرسي).

import { normalizeArabic } from "../arabic.ts";
import { V2_LIMITS } from "./config.ts";
import { vectorSearch, type Unit, type V2Index } from "./corpus-v2.ts";

/** not_searched: the question was out of scope, so no source was searched (by design). */
export type SourceStatus = "found" | "no_relevant_evidence" | "unavailable" | "not_indexed" | "not_searched";

export const BOOK_SOURCES = ["bayyinat", "usoul-eman", "shumoo-nahar", "raheeq"] as const;
export const APPROVED_SOURCES = ["quran", "muyassar", "bayyinat", "usoul-eman", "shumoo-nahar", "raheeq", "dorar"] as const;

const RRF_K = 60;
const LIST_DEPTH = 30;

/** Named verses that users refer to by name (canonical keys; text always from the Quran data). */
export const NAMED_VERSES: [RegExp, string, number, number][] = [
  [/آية\s*الكرسي/, "آية الكرسي", 2, 255],
  [/آية\s*الدين|آية\s*الدَّين/, "آية الدين", 2, 282],
  [/آية\s*النور(?!\S)/, "آية النور", 24, 35],
  [/آيات?\s*الحجاب/, "آية الحجاب", 33, 53],
  [/سورة\s*الإخلاص|سورة\s*الاخلاص/, "سورة الإخلاص", 112, 1],
  [/سورة\s*الفاتحة|أم\s*الكتاب/, "سورة الفاتحة", 1, 1],
];

export interface Candidate {
  recordId: string;
  sourceId: string;
  score: number;
  /** Best matching units (child chunks or the verse unit) inside the record */
  units: { id: string; start: number; end: number; score: number }[];
  /** Why it is a candidate: search hits, cited by a book record, quoted wording, named verse */
  via: string[];
}

export interface SourceResult {
  sourceId: string;
  status: SourceStatus;
  candidates: Candidate[];
  note?: string;
}

function fuse(lists: string[][]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));
  return scores;
}

/** Hybrid search inside one source; returns units with fused scores. */
function searchSource(index: V2Index, sourceId: string, queries: string[], vectors: Float32Array[]): Map<string, number> {
  const part = index.bySource.get(sourceId);
  if (!part) return new Map();
  const ids = part.units.map((u) => u.id);
  const lists: string[][] = [];
  queries.forEach((q, i) => {
    lists.push(part.bm25.search(q, LIST_DEPTH).map(([d]) => part.units[d].id));
    if (vectors[i]) lists.push(vectorSearch(index, vectors[i], ids, LIST_DEPTH).map(([id]) => id));
  });
  return fuse(lists);
}

/** Group unit scores into record candidates (a record's score is its best unit plus a small bonus per extra unit). */
function toCandidates(index: V2Index, sourceId: string, unitScores: Map<string, number>, limit: number): Candidate[] {
  const byRecord = new Map<string, Candidate>();
  for (const [id, score] of [...unitScores.entries()].sort((a, b) => b[1] - a[1])) {
    const u = index.units.get(id) as Unit | undefined;
    if (!u) continue;
    const c = byRecord.get(u.recordId) ?? { recordId: u.recordId, sourceId, score: 0, units: [], via: ["search"] };
    c.units.push({ id, start: u.start, end: u.end, score });
    c.score = Math.max(c.score, score) + (c.units.length > 1 ? score * 0.15 : 0);
    byRecord.set(u.recordId, c);
  }
  return [...byRecord.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface RetrievalInput {
  question: string;
  queries: { quran: string[]; books: string[] };
  /** Embeddings for queries.quran then queries.books, in that order */
  vectors: Float32Array[];
  /** Verse wording the user quoted, copied from the question by the planner */
  quotedWording: string[];
}

export function retrieveAll(index: V2Index, input: RetrievalInput): Record<string, SourceResult> {
  const out: Record<string, SourceResult> = {};
  const nq = input.queries.quran.length;
  const bookVectors = input.vectors.slice(nq);
  const quranVectors = input.vectors.slice(0, nq);

  for (const sid of BOOK_SOURCES) {
    if (!index.bySource.has(sid)) {
      out[sid] = { sourceId: sid, status: "not_indexed", candidates: [] };
      continue;
    }
    const scores = searchSource(index, sid, [input.question, ...input.queries.books], [bookVectors[0] ?? new Float32Array(), ...bookVectors]);
    out[sid] = { sourceId: sid, status: "found", candidates: toCandidates(index, sid, scores, V2_LIMITS.candidatesPerSource) };
  }

  // Quran: ayah+tafsir units, plus verses cited by top book records, quoted wording and named verses.
  const quranScores = searchSource(index, "quran", input.queries.quran, quranVectors);
  for (const w of input.quotedWording) {
    const part = index.bySource.get("quran")!;
    for (const [d, s] of part.bm25.search(w, 5)) quranScores.set(part.units[d].id, (quranScores.get(part.units[d].id) ?? 0) + 0.05 * (s > 0 ? 1 : 0));
  }
  const quran = toCandidates(index, "quran", quranScores, V2_LIMITS.candidatesPerSource);
  const add = (key: string, why: string, weight: number) => {
    const id = `quran:${key}`;
    if (!index.records.has(id)) return;
    const c = quran.find((x) => x.recordId === id);
    if (c) {
      if (!c.via.includes(why)) c.via.push(why);
      c.score += weight;
    } else quran.push({ recordId: id, sourceId: "quran", score: weight, units: [{ id, start: 0, end: index.records.get(id)!.text.length, score: weight }], via: [why] });
  };
  for (const sid of BOOK_SOURCES) {
    for (const c of out[sid].candidates.slice(0, 6)) for (const key of index.corpus.verseGraph[c.recordId] ?? []) add(key, `cited by ${c.recordId}`, 0.012);
  }
  for (const [re, , s, a] of NAMED_VERSES) if (re.test(input.question)) add(`${s}:${a}`, "named verse", 0.05);
  quran.sort((a, b) => b.score - a.score);
  out.quran = { sourceId: "quran", status: "found", candidates: quran.slice(0, V2_LIMITS.candidatesPerSource + 8) };
  // Al-Muyassar is reached through the verses (one tafsir per verse).
  out.muyassar = { sourceId: "muyassar", status: "found", candidates: [] };
  return out;
}

/** Normalized text for comparing a quoted wording against verses (matching only). */
export function matchKey(s: string): string {
  return normalizeArabic(s);
}
