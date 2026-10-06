// BM25 keyword index over normalized, lightly stemmed Arabic tokens. Built in memory.

import { searchTokens } from "./arabic.ts";

export class BM25 {
  private postings = new Map<string, { doc: Int32Array; tf: Uint16Array }>();
  private docLen: Uint32Array;
  private avgLen: number;
  private n: number;
  private k1 = 1.2;
  private b = 0.75;

  constructor(texts: string[]) {
    this.n = texts.length;
    this.docLen = new Uint32Array(texts.length);
    const build = new Map<string, number[]>();
    let total = 0;
    texts.forEach((text, d) => {
      const tokens = searchTokens(text);
      this.docLen[d] = tokens.length;
      total += tokens.length;
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [t, c] of counts) {
        let list = build.get(t);
        if (!list) build.set(t, (list = []));
        list.push(d, c);
      }
    });
    this.avgLen = total / Math.max(1, texts.length);
    for (const [t, list] of build) {
      const doc = new Int32Array(list.length / 2);
      const tf = new Uint16Array(list.length / 2);
      for (let i = 0; i < doc.length; i++) {
        doc[i] = list[2 * i];
        tf[i] = Math.min(65535, list[2 * i + 1]);
      }
      this.postings.set(t, { doc, tf });
    }
  }

  /** Top-k documents as [docIndex, score], highest first. */
  search(query: string, k: number): [number, number][] {
    const scores = new Map<number, number>();
    for (const t of new Set(searchTokens(query))) {
      const p = this.postings.get(t);
      if (!p) continue;
      const df = p.doc.length;
      const idf = Math.log(1 + (this.n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < p.doc.length; i++) {
        const d = p.doc[i];
        const tf = p.tf[i];
        const norm = tf + this.k1 * (1 - this.b + (this.b * this.docLen[d]) / this.avgLen);
        scores.set(d, (scores.get(d) ?? 0) + (idf * tf * (this.k1 + 1)) / norm);
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  }
}
