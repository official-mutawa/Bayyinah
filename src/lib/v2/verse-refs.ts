// Verse references inside book text. The PDF text layers lose the verse wording (Quran fonts map
// to private-use glyphs, or the text is dropped), leaving «﴿ ﴾» plus a reference such as
// "[الذاريات: 56-58]", which the RTL text layer often mirrors to "الذاريات: .]58 -56".
// This module finds those references and decides, conservatively, whether each one points to an
// unambiguous verse range in the approved Quran data. Raw book text is never modified: results are
// separate records that point back into the text by offsets.

export interface QuranInfo {
  /** Surah id for a name or alias (diacritics ignored), or null */
  surahId(name: string): number | null;
  ayahCount(surah: number): number;
  /** Glyph units of a verse in the approved text: words plus pause marks */
  words(surah: number, ayah: number): number;
  /** All names and aliases, longest first (for the reference pattern) */
  names: string[];
}

const MARKS = /[ً-ٰٟـ]/g;
const stripMarks = (s: string) => s.replace(MARKS, "");

/** Surah aliases used in books, mapped to the canonical name in the approved data. */
export const SURAH_ALIASES: Record<string, string> = {
  "بني إسرائيل": "الإسراء",
  "براءة": "التوبة",
  "المؤمن": "غافر",
  "حم السجدة": "فصلت",
  "السجدة حم": "فصلت",
  "الدهر": "الإنسان",
  "القتال": "محمد",
  "الملائكة": "فاطر",
  "سبحان": "الإسراء",
};

/** Names of one or two letters collide with other uses (ص = صفحة): require a nearby verse marker. */
const SHORT_NAMES = new Set(["ص", "ق", "طه", "يس"]);

export function buildQuranInfo(verses: { surah: number; ayah: number; surahName: string; text: string }[]): QuranInfo {
  const byName = new Map<string, number>();
  const counts = new Map<number, number>();
  const words = new Map<string, number>();
  for (const v of verses) {
    byName.set(stripMarks(v.surahName.replace(/^سورة\s+/, "")).trim(), v.surah);
    counts.set(v.surah, Math.max(counts.get(v.surah) ?? 0, v.ayah));
    // Quran fonts draw each word and each pause mark (U+06D6..U+06DC) as its own glyph.
    const t = v.text.replace(/﻿/g, "").trim();
    words.set(`${v.surah}:${v.ayah}`, t.split(/\s+/).filter((w) => /[ء-ي]/.test(w)).length + (t.match(/[ۖ-ۜ]/g) ?? []).length);
  }
  for (const [alias, canonical] of Object.entries(SURAH_ALIASES)) {
    const id = byName.get(canonical);
    if (id) byName.set(alias, id);
  }
  return {
    surahId: (name) => byName.get(stripMarks(name).replace(/\s+/g, " ").trim()) ?? null,
    ayahCount: (s) => counts.get(s) ?? 0,
    words: (s, a) => words.get(`${s}:${a}`) ?? 0,
    names: [...byName.keys()].sort((a, b) => b.length - a.length),
  };
}

export type RefStatus = "resolved" | "ambiguous" | "failed";

export interface VerseRef {
  /** Offsets in the original text: from the verse marker (or the reference) to the end of the reference */
  start: number;
  end: number;
  /** The «﴿…﴾» marker before the reference, when there is one */
  marker: { start: number; end: number; glyphs: number; readableLetters: number } | null;
  /** Reference text exactly as stored */
  refText: string;
  surah: number | null;
  from: number | null;
  to: number | null;
  status: RefStatus;
  reason: string;
  /** In-range reading with the digits reversed (text layers sometimes mirror numbers) */
  digitAlternative: { from: number; to: number } | null;
}

interface Mapped {
  text: string;
  map: number[];
}

/** Remove diacritics for matching while keeping a map back to original offsets. */
function mapped(text: string): Mapped {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/[ً-ٰٟـ]/.test(text[i])) continue;
    out += text[i];
    map.push(i);
  }
  map.push(text.length);
  return { text: out, map };
}

const toNum = (s: string) => Number(s.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))));
const reverseDigits = (n: number) => Number(String(n).split("").reverse().join(""));

let cachedPattern: { names: string[]; re: RegExp } | null = null;
function pattern(info: QuranInfo): RegExp {
  if (cachedPattern?.names === info.names) return cachedPattern.re;
  const alt = info.names.map((n) => n.replace(/ /g, "\\s+")).join("|");
  // name : [punct] [bracket] number [- number]
  const re = new RegExp(`(?<![\\u0621-\\u064A])(${alt})\\s*:\\s*[.،,]?\\s*[\\]\\[(]?\\s*([0-9٠-٩]{1,3})(?:\\s*[-–]\\s*([0-9٠-٩]{1,3}))?`, "g");
  cachedPattern = { names: info.names, re };
  return re;
}

function rangeWords(info: QuranInfo, s: number, a: number, b: number): number {
  let w = 0;
  for (let k = a; k <= b; k++) w += info.words(s, k);
  return w;
}

/** Glyphs can never exceed the words of the cited range plus one end mark per verse (and one slack). */
function glyphsFit(info: QuranInfo, s: number, a: number, b: number, glyphs: number): boolean {
  return glyphs <= rangeWords(info, s, a, b) + (b - a + 1) + 1;
}

export function findVerseRefs(text: string, info: QuranInfo): VerseRef[] {
  const m = mapped(text);
  const out: VerseRef[] = [];
  const re = pattern(info);
  re.lastIndex = 0;
  let prevEnd = 0;
  for (const hit of m.text.matchAll(re)) {
    const startN = hit.index!;
    const endN = startN + hit[0].length;
    const start = m.map[startN];
    const end = m.map[endN] ?? text.length;
    const name = hit[1];
    // Nearest verse marker before the reference, not crossing an earlier reference.
    const windowStart = Math.max(prevEnd, start - 1500);
    const open = text.lastIndexOf("﴿", start);
    let marker: VerseRef["marker"] = null;
    if (open >= windowStart && open >= 0) {
      const seg = text.slice(open, start);
      marker = {
        start: open,
        end: start,
        glyphs: (seg.match(/[-]/g) ?? []).length,
        readableLetters: (stripMarks(seg).match(/[ء-ي]/g) ?? []).length,
      };
    }
    prevEnd = end;
    const base = { start: marker?.start ?? start, end, marker, refText: text.slice(start, end), digitAlternative: null };
    const surah = info.surahId(name);
    if (SHORT_NAMES.has(stripMarks(name)) && (!marker || start - marker.start > 400)) {
      out.push({ ...base, surah, from: null, to: null, status: "failed", reason: `short name "${name}" without a nearby verse marker (could be a page abbreviation)` });
      continue;
    }
    if (!surah) {
      out.push({ ...base, surah: null, from: null, to: null, status: "failed", reason: `unknown surah name "${name}"` });
      continue;
    }
    let a = toNum(hit[2]);
    let b = hit[3] ? toNum(hit[3]) : a;
    if (b < a) [a, b] = [b, a]; // mirrored ranges come out as "58 -56"
    // "]177 -1" is a verse followed by the number of the next list item, not a range.
    if (b - a > 20) a = b = toNum(hit[2]);
    const count = info.ayahCount(surah);
    const inRange = (x: number, y: number) => x >= 1 && y <= count && y - x <= 40;
    const glyphs = marker?.glyphs ?? 0;
    const fits = (x: number, y: number) => !glyphs || glyphsFit(info, surah, x, y, glyphs);
    // Reversed-digit reading of a single verse number (ranges are left as read).
    const ra = reverseDigits(a);
    const altOk = a === b && a >= 10 && ra !== a && inRange(ra, ra) && fits(ra, ra);
    if (!inRange(a, b)) {
      out.push({ ...base, surah, from: a, to: b, status: "failed", reason: `ayah ${a}${b !== a ? `-${b}` : ""} is out of range for surah ${surah} (${count} verses)`, digitAlternative: altOk ? { from: ra, to: ra } : null });
      continue;
    }
    if (!fits(a, b)) {
      out.push({ ...base, surah, from: a, to: b, status: altOk ? "ambiguous" : "failed", reason: `${glyphs} verse glyphs do not fit ${surah}:${a}${b !== a ? `-${b}` : ""}`, digitAlternative: altOk ? { from: ra, to: ra } : null });
      continue;
    }
    out.push({
      ...base,
      surah,
      from: a,
      to: b,
      status: "resolved",
      reason: glyphs ? `in range; ${glyphs} glyphs fit` : "in range",
      digitAlternative: altOk ? { from: ra, to: ra } : null,
    });
  }
  return out;
}

/** Verse markers with no readable verse text inside (empty or private-use glyphs only). */
export function emptyMarkers(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(/﴿([^﴾]{0,1200})﴾/g)) {
    const inner = stripMarks(m[1]).replace(/[-]/g, "");
    if (!/[ء-ي]{2}/.test(inner)) out.push({ start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}
