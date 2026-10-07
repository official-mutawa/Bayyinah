// Shared builders: sentences with speaker for a record, and retrieval child chunks.

import { segment } from "./segment.ts";
import type { Sentence, Speaker, V2Child, V2Record } from "./types.ts";

export const CHILD_MAX = 650;

/** Sentences of a record; the speaker comes from the section a sentence starts in. */
export function recordSentences(id: string, text: string, sections: V2Record["sections"], quotedHadith: V2Record["quotedHadith"]): Sentence[] {
  return segment(text).map((s) => {
    const sec = sections.find((x) => s.start >= x.start && s.start < x.end);
    let speaker: Speaker = sec?.speaker ?? "author";
    // A sentence that is mostly a quoted hadith is not the author's own words.
    const inside = quotedHadith.reduce((n, h) => n + Math.max(0, Math.min(s.end, h.end) - Math.max(s.start, h.start)), 0);
    if (speaker === "author" && inside >= 0.6 * (s.end - s.start)) speaker = "quoted_other";
    return { id: `${id}:s${s.n}`, n: s.n, start: s.start, end: s.end, speaker };
  });
}

/** Child chunks: consecutive sentences of one section, up to CHILD_MAX characters. */
export function recordChildren(r: V2Record): V2Child[] {
  const out: V2Child[] = [];
  let cur: Sentence[] = [];
  const sectionOf = (x: { start: number }) => r.sections.findIndex((sec) => x.start >= sec.start && x.start < sec.end);
  const flush = () => {
    if (!cur.length) return;
    const speakers = new Set(cur.map((s) => s.speaker));
    out.push({
      id: `${r.id}:c${out.length + 1}`,
      recordId: r.id,
      sourceId: r.sourceId,
      start: cur[0].start,
      end: cur.at(-1)!.end,
      sentenceIds: cur.map((s) => s.id),
      speaker: speakers.size === 1 ? cur[0].speaker : "mixed",
    });
    cur = [];
  };
  for (const s of r.sentences) {
    if ((cur.length && sectionOf(cur[0]) !== sectionOf(s)) || (cur.length && s.end - cur[0].start > CHILD_MAX)) flush();
    cur.push(s);
  }
  flush();
  return out;
}
