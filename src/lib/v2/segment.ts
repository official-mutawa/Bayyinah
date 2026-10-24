// Sentence segmentation with exact character offsets into the stored text, so any span can be
// rendered, highlighted and verified deterministically. The stored text is never modified.

export interface Sentence {
  /** 1-based index within the record */
  n: number;
  start: number;
  end: number;
}

const END = /[.!؟?]/;
const MAX_SENTENCE = 420;

/** True when the character at i ends a sentence (punctuation followed by space, newline or end). */
function isBoundary(text: string, i: number): boolean {
  const ch = text[i];
  if (ch === "\n") return true;
  if (!END.test(ch)) return false;
  const next = text[i + 1];
  // Decimal points and numbered lists ("1.2", "3.") are not sentence ends.
  if (ch === "." && /[0-9٠-٩]/.test(text[i - 1] ?? "") && /[0-9٠-٩]/.test(next ?? "")) return false;
  return next === undefined || /[\s»"”)\]﴾]/.test(next);
}

/** Split an over-long sentence at clause marks (؛ then ،) near the middle, keeping offsets exact. */
function splitLong(text: string, start: number, end: number, out: [number, number][]): void {
  if (end - start <= MAX_SENTENCE) {
    out.push([start, end]);
    return;
  }
  const mid = start + Math.floor((end - start) / 2);
  let cut = -1;
  for (const mark of ["؛", "،", " "]) {
    let best = -1;
    for (let i = start + 80; i < end - 40; i++) if (text[i] === mark && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    if (best >= 0) {
      cut = best + 1;
      break;
    }
  }
  if (cut < 0) {
    out.push([start, end]);
    return;
  }
  splitLong(text, start, cut, out);
  splitLong(text, cut, end, out);
}

/** Segment text into sentences; offsets exclude leading and trailing whitespace. */
export function segment(text: string): Sentence[] {
  const raw: [number, number][] = [];
  let s = 0;
  for (let i = 0; i < text.length; i++) {
    if (!isBoundary(text, i)) continue;
    // Keep a closing quote or bracket with the sentence it ends.
    let e = i + 1;
    while (e < text.length && /[»"”)\]﴾]/.test(text[e])) e++;
    raw.push([s, e]);
    s = e;
    i = e - 1;
  }
  if (s < text.length) raw.push([s, text.length]);
  const trimmed: [number, number][] = [];
  for (const [a, b] of raw) {
    let x = a;
    let y = b;
    while (x < y && /\s/.test(text[x])) x++;
    while (y > x && /\s/.test(text[y - 1])) y--;
    if (y > x && /[\p{L}\p{N}]/u.test(text.slice(x, y))) splitLong(text, x, y, trimmed);
  }
  return trimmed.map(([start, end], k) => ({ n: k + 1, start, end }));
}
