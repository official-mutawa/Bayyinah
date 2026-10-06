// Compact embedding store: int8 vectors with one float scale per vector.
// Files: data/embeddings.i8.bin (count x dims int8) and data/embeddings.json (ids, scales, metadata).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeArabic, standardSpelling } from "./arabic.ts";
import type { Passage } from "./corpus.ts";

export const VECTORS_BIN = path.join(process.cwd(), "data", "embeddings.i8.bin");
export const VECTORS_META = path.join(process.cwd(), "data", "embeddings.json");

export interface VectorMeta {
  model: string;
  dims: number;
  count: number;
  createdAt: string;
  ids: string[];
  scales: number[];
}

/** The text that gets embedded for a passage (derived in memory, never stored). */
export function embeddingText(p: Passage): string {
  if (p.kind === "quran") {
    // Read superscript alef the standard way so Uthmani spelling resembles standard spelling.
    return normalizeArabic(standardSpelling(p.text));
  }
  const t = normalizeArabic(p.text);
  if (t.length <= 3000) return t;
  // In a hadith the matn sits after the chain of narrators, so keep the tail; elsewhere keep the head.
  return p.kind === "hadith" ? t.slice(-3000) : t.slice(0, 3000);
}

export function quantize(vectors: Float32Array[], dims: number): { bin: Int8Array; scales: number[] } {
  const bin = new Int8Array(vectors.length * dims);
  const scales: number[] = [];
  vectors.forEach((v, i) => {
    let max = 0;
    for (const x of v) max = Math.max(max, Math.abs(x));
    const scale = max / 127 || 1;
    scales.push(Number(scale.toPrecision(7)));
    for (let j = 0; j < dims; j++) bin[i * dims + j] = Math.round(v[j] / scale);
  });
  return { bin, scales };
}

export function saveVectors(meta: VectorMeta, bin: Int8Array): void {
  writeFileSync(VECTORS_BIN, Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength));
  writeFileSync(VECTORS_META, JSON.stringify(meta));
}

export class VectorStore {
  readonly meta: VectorMeta;
  private bin: Int8Array;
  private index = new Map<string, number>();

  constructor() {
    this.meta = JSON.parse(readFileSync(VECTORS_META, "utf8")) as VectorMeta;
    const buf = readFileSync(VECTORS_BIN);
    this.bin = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    if (this.bin.length !== this.meta.count * this.meta.dims) throw new Error("Embedding file size mismatch");
    this.meta.ids.forEach((id, i) => this.index.set(id, i));
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  /** Cosine similarity of a unit query vector against the given passage ids. */
  search(query: Float32Array, ids: string[], k: number): [string, number][] {
    const dims = this.meta.dims;
    const out: [string, number][] = [];
    for (const id of ids) {
      const i = this.index.get(id);
      if (i === undefined) continue;
      let dot = 0;
      const off = i * dims;
      for (let j = 0; j < dims; j++) dot += query[j] * this.bin[off + j];
      out.push([id, dot * this.meta.scales[i]]);
    }
    return out.sort((a, b) => b[1] - a[1]).slice(0, k);
  }
}
