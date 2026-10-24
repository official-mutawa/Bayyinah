// Hadith evidence rules for v2. A hadith may be evidence only if its ruling, exactly as Dorar
// returned it, is on the approved whitelist. When muhaddiths differ on the same hadith, it is used
// only if every ruling is approved (all are then shown); otherwise it is excluded. Rulings are never
// inferred, upgraded or rephrased. Excluded items stay in the trace.

import { normalizeArabic } from "../arabic.ts";
import { dorarId, type DorarItem } from "../dorar-parse.ts";
import rulings from "./hadith-rulings.json" with { type: "json" };

export interface HadithEvidence extends DorarItem {
  id: string;
  /** Other gradings of the same hadith text (all approved), shown with it */
  alsoGraded: { grade: string; muhaddith: string; book: string; locator: string }[];
}

export function rulingApproved(grade: string | null | undefined): boolean {
  if (!grade) return false;
  return (rulings.approved as string[]).includes(grade.trim());
}

export function filterHadith(items: DorarItem[]): { evidence: HadithEvidence[]; excluded: { item: DorarItem; reason: string }[] } {
  const groups = new Map<string, DorarItem[]>();
  for (const h of items) {
    const key = normalizeArabic(h.text).slice(0, 120);
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const evidence: HadithEvidence[] = [];
  const excluded: { item: DorarItem; reason: string }[] = [];
  for (const list of groups.values()) {
    const bad = list.filter((h) => !rulingApproved(h.grade));
    if (bad.length) {
      const differ = bad.length < list.length;
      for (const h of list) excluded.push({ item: h, reason: differ ? "muhaddiths differ and not every ruling is approved" : `ruling not on the approved list: ${h.grade || "(none)"}` });
      continue;
    }
    const [first, ...rest] = list;
    evidence.push({ ...first, id: dorarId(first), alsoGraded: rest.map((h) => ({ grade: h.grade, muhaddith: h.muhaddith, book: h.book, locator: h.locator })) });
  }
  return { evidence, excluded };
}
