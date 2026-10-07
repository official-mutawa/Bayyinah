// Hadith quoted inside book or tafsir text: «…» quotes attributed to the Prophet ﷺ or followed by
// a collection reference. These are never hadith evidence unless matched to a Dorar record with a
// whitelisted ruling; until then the book may be cited only for its author's own words.

export interface QuotedHadith {
  start: number;
  end: number;
  matched: null;
}

const ATTRIBUTED = /(قال|يقول|فقال)\s*(رسول\s*الله|النبي|نبي)\s*ﷺ?|ﷺ\s*(قال|:)|عن النبي|أن النبي|أن رسول الله/;
const SOURCED = /^[\s؛:،.)(-]*(رواه|أخرجه|متفق عليه|رواهما)/;

export function findQuotedHadith(text: string): QuotedHadith[] {
  const out: QuotedHadith[] = [];
  for (const m of text.matchAll(/«([^«»]{12,1500})»/g)) {
    // Attribution must sit right before the quote, in the same sentence (not an earlier quote's).
    const window = text.slice(Math.max(0, m.index! - 60), m.index!);
    const cut = Math.max(window.lastIndexOf("»"), window.search(/[.!؟?][^.!؟?]*$/));
    const before = cut >= 0 ? window.slice(cut + 1) : window;
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 80);
    if (ATTRIBUTED.test(before) || SOURCED.test(after)) out.push({ start: m.index!, end: m.index! + m[0].length, matched: null });
  }
  return out;
}
