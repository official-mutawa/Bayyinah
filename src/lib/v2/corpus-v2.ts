// Loads the v2 corpus and its vectors, and builds per-source keyword indexes in memory.
// v2 artifacts live next to v1's: data/v2/corpus.json, data/v2/vectors.i8.bin, data/v2/vectors.json.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BM25 } from "../bm25.ts";
import { normalizeArabic, standardSpelling } from "../arabic.ts";
import type { V2Child, V2Corpus, V2Record } from "./types.ts";

export const V2_DIR = () => path.join(process.cwd(), "data", "v2");
export const V2_CORPUS = () => path.join(V2_DIR(), "corpus.json");
export const V2_VECTORS_BIN = () => path.join(V2_DIR(), "vectors.i8.bin");
export const V2_VECTORS_META = () => path.join(V2_DIR(), "vectors.json");

/** Retrieval unit: a book or tafsir child chunk, or a Quran verse paired with its Al-Muyassar tafsir. */
export interface Unit {
  id: string;
  sourceId: string;
  recordId: string;
  start: number;
  end: number;
}

/** Text embedded for a unit (derived in memory; display always uses the stored record text). */
export function unitEmbeddingText(u: Unit, rec: V2Record, tafsir?: V2Record): string {
  if (rec.kind === "quran") return `${normalizeArabic(standardSpelling(rec.text))} — ${normalizeArabic(tafsir?.text ?? "")}`.slice(0, 4000);
  const body = normalizeArabic(rec.text.slice(u.start, u.end));
  const head = rec.sourceId === "bayyinat" || rec.sourceId === "usoul-eman" ? `${normalizeArabic(rec.title)} | ` : "";
  return `${head}${body}`.slice(0, 4000);
}

/** Text indexed for keyword search: the unit text, plus the verse's tafsir for Quran units. */
export function unitSearchText(u: Unit, rec: V2Record, tafsir?: V2Record): string {
  if (rec.kind === "quran") return `${rec.text} ${tafsir?.text ?? ""}`;
  const head = rec.sourceId === "bayyinat" ? `${rec.title} ${rec.title} ` : "";
  return `${head}${rec.text.slice(u.start, u.end)}`;
}

export interface V2Index {
  corpus: V2Corpus;
  records: Map<string, V2Record>;
  /** quran:s:a -> muyassar:s:a */
  tafsirOf: Map<string, V2Record>;
  units: Map<string, Unit>;
  bySource: Map<string, { units: Unit[]; bm25: BM25 }>;
  vectors: { ids: string[]; index: Map<string, number>; scales: number[]; bin: Int8Array; dims: number; model: string } | null;
}

export function unitsOf(corpus: V2Corpus): Unit[] {
  const units: Unit[] = [];
  for (const r of corpus.records) if (r.kind === "quran") units.push({ id: r.id, sourceId: "quran", recordId: r.id, start: 0, end: r.text.length });
  for (const c of corpus.children as V2Child[]) if (c.sourceId !== "muyassar") units.push({ id: c.id, sourceId: c.sourceId, recordId: c.recordId, start: c.start, end: c.end });
  return units;
}

let cached: V2Index | null = null;

export function loadV2Index(): V2Index {
  if (cached) return cached;
  if (!existsSync(V2_CORPUS())) throw new Error("v2 corpus missing: run scripts/v2/build-records.ts");
  const corpus = JSON.parse(readFileSync(V2_CORPUS(), "utf8")) as V2Corpus;
  const records = new Map(corpus.records.map((r) => [r.id, r]));
  const tafsirOf = new Map<string, V2Record>();
  for (const r of corpus.records) if (r.sourceId === "muyassar") tafsirOf.set(`quran:${r.surah}:${r.ayah}`, r);
  const units = unitsOf(corpus);
  const bySource = new Map<string, { units: Unit[]; bm25: BM25 }>();
  for (const sid of new Set(units.map((u) => u.sourceId))) {
    const own = units.filter((u) => u.sourceId === sid);
    bySource.set(sid, { units: own, bm25: new BM25(own.map((u) => unitSearchText(u, records.get(u.recordId)!, tafsirOf.get(u.recordId)))) });
  }
  let vectors: V2Index["vectors"] = null;
  if (existsSync(V2_VECTORS_META()) && existsSync(V2_VECTORS_BIN())) {
    const meta = JSON.parse(readFileSync(V2_VECTORS_META(), "utf8")) as { ids: string[]; scales: number[]; dims: number; model: string };
    const buf = readFileSync(V2_VECTORS_BIN());
    vectors = { ...meta, index: new Map(meta.ids.map((id, i) => [id, i])), bin: new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
  }
  cached = { corpus, records, tafsirOf, units: new Map(units.map((u) => [u.id, u])), bySource, vectors };
  return cached;
}

/** Cosine similarity of a unit query vector against the given unit ids (int8 store). */
export function vectorSearch(index: V2Index, query: Float32Array, ids: string[], k: number): [string, number][] {
  const v = index.vectors;
  if (!v) return [];
  const out: [string, number][] = [];
  for (const id of ids) {
    const i = v.index.get(id);
    if (i === undefined) continue;
    let dot = 0;
    const off = i * v.dims;
    for (let j = 0; j < v.dims; j++) dot += query[j] * v.bin[off + j];
    out.push([id, dot * v.scales[i]]);
  }
  return out.sort((a, b) => b[1] - a[1]).slice(0, k);
}
