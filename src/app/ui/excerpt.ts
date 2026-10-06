// Excerpt of a stored passage around the span that verification matched: the supporting quote
// plus its surrounding sentence (about 2-4 lines). Text always comes from the stored passage,
// never from the model's output.

export interface Excerpt {
  before: string;
  quote: string;
  after: string;
  cutStart: boolean;
  cutEnd: boolean;
}

const BOUNDARY = /[.!?؟؛\n]/;

export function excerptAround(text: string, start: number, end: number, side = 170): Excerpt {
  let s = start;
  const minS = Math.max(0, start - side);
  while (s > minS && !BOUNDARY.test(text[s - 1])) s--;
  if (s === minS && s > 0) {
    // No sentence boundary nearby: start at a word boundary instead of mid-word.
    const sp = text.indexOf(" ", s);
    if (sp !== -1 && sp < start) s = sp + 1;
  }
  let e = end;
  const maxE = Math.min(text.length, end + side);
  while (e < maxE && !BOUNDARY.test(text[e])) e++;
  if (e < text.length && BOUNDARY.test(text[e])) e++;
  else if (e === maxE && e < text.length) {
    const sp = text.lastIndexOf(" ", e);
    if (sp > end) e = sp;
  }
  return {
    before: text.slice(s, start).trimStart(),
    quote: text.slice(start, end),
    after: text.slice(end, e).trimEnd(),
    cutStart: s > 0,
    cutEnd: e < text.length,
  };
}

export function excerptText(x: Excerpt): string {
  return `${x.cutStart ? "… " : ""}${x.before}${x.quote}${x.after}${x.cutEnd ? " …" : ""}`;
}
