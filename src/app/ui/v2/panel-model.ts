// Citation panel model (pure, testable): the supporting sentence(s) first, then the source line,
// then short surrounding context, then the full parent passage as segments for a toggle. Text is
// always cut from the stored record by offsets. Verse markers are flagged so the view renders the
// verse from the Quran data (resolved) or a labelled placeholder (unresolved); the stored text is
// never altered and never shown as empty brackets.

import type { RecordView } from "@/lib/v2/pipeline-v2";

export interface Segment {
  text: string;
  highlight: boolean;
  /** Render this verse range from the Quran data instead of the segment text */
  verse?: { surah: number; from: number; to: number };
  /** An empty verse marker whose reference could not be resolved: render a placeholder */
  unresolvedVerse?: boolean;
}

export interface CitationPanel {
  supporting: { id: string; text: string; segments: Segment[] }[];
  sourceLine: string;
  ocrNote: string | null;
  context: { before: string; after: string };
  full: { segments: Segment[] };
}

const EMPTY_MARKER = /﴿[\s-]*﴾/g;

/** Split [start, end) of the record into segments with verse and highlight flags. */
export function segmentsOf(rec: Pick<RecordView, "text" | "verseRefs">, start: number, end: number, highlight: { start: number; end: number }[]): Segment[] {
  const cuts = new Set<number>([start, end]);
  const verses = rec.verseRefs.filter((v) => v.end > start && v.start < end);
  const empties: { start: number; end: number }[] = [];
  for (const m of rec.text.slice(start, end).matchAll(EMPTY_MARKER)) {
    const s = start + m.index!;
    if (!verses.some((v) => s >= v.start && s < v.end)) empties.push({ start: s, end: s + m[0].length });
  }
  for (const r of [...verses, ...empties, ...highlight]) {
    if (r.start > start && r.start < end) cuts.add(r.start);
    if (r.end > start && r.end < end) cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const v = verses.find((x) => a >= x.start && b <= x.end);
    const seg: Segment = { text: rec.text.slice(a, b), highlight: highlight.some((h) => a >= h.start && b <= h.end) };
    if (v) seg.verse = { surah: v.surah, from: v.from, to: v.to };
    if (empties.some((x) => a >= x.start && b <= x.end)) seg.unresolvedVerse = true;
    out.push(seg);
  }
  return out;
}

export function citationPanel(rec: RecordView, sentenceIds: string[], verses: Record<string, { text: string; refLabel: string }>, contextSentences = 1): CitationPanel {
  void verses;
  const cited = rec.sentences.filter((s) => sentenceIds.includes(s.id));
  const idx = cited.map((s) => rec.sentences.indexOf(s));
  const lo = idx.length ? Math.max(0, Math.min(...idx) - contextSentences) : 0;
  const hi = idx.length ? Math.min(rec.sentences.length - 1, Math.max(...idx) + contextSentences) : -1;
  const before = rec.sentences.slice(lo, idx.length ? Math.min(...idx) : 0).map((s) => rec.text.slice(s.start, s.end)).join(" ");
  const after = rec.sentences.slice(idx.length ? Math.max(...idx) + 1 : 0, hi + 1).map((s) => rec.text.slice(s.start, s.end)).join(" ");
  const highlight = cited.map((s) => ({ start: s.start, end: s.end }));
  return {
    supporting: cited.map((s) => ({ id: s.id, text: rec.text.slice(s.start, s.end), segments: segmentsOf(rec, s.start, s.end, []) })),
    sourceLine: [rec.refLabel, rec.page && !rec.refLabel.includes("صفحة") && !rec.refLabel.includes("ص ") ? `صفحة ${rec.page}` : ""].filter(Boolean).join("، "),
    ocrNote: rec.ocr ? "نص مستخرج آليًا من صورة الصفحة، ولم يُراجَع بعد مقابلةً بالأصل، فلا يُعرض اقتباسًا حرفيًّا." : null,
    context: { before, after },
    full: { segments: segmentsOf(rec, 0, rec.text.length, highlight) },
  };
}
