// v2 extraction of «بينات» from the PDF text layer: one record per question (question + answer),
// never merging items, with speaker sections. Rules only, no language model; the text is kept as
// extracted (bidi controls removed, presentation forms normalized as in v1).
// Titles and printed pages come from the book's own table of contents.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/v2/extract-bayyinat.ts "<folder with the PDFs>"
// Output (gitignored): data/v2/books/bayyinat.records.json and data/v2/books/bayyinat.extract-log.json

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILE = "بينات-اسئله واجوبه عن الاسلام.pdf";
const EXPECTED = 263;

export type Speaker = "author" | "quoted_question" | "quoted_objection" | "quoted_other";

export interface Section {
  start: number;
  end: number;
  speaker: Speaker;
  /** The book's own section label, e.g. السؤال، الجواب، مضمون السؤال */
  label: string;
}

export interface BookRecord {
  id: string;
  sourceId: string;
  key: string;
  number: number;
  title: string;
  page: number | null;
  text: string;
  sections: Section[];
  /** How the item header was found (for the extraction log) */
  headerVariant: string;
}

const BIDI = /[‪-‮‎‏⁦-⁩]/g;
const MARKS_ONLY = /^[\sً-ٰٟۖ-ۭ]*$/;
const strip = (s: string) => s.replace(/[ً-ٰٟـ]/g, "").replace(/\s+/g, " ").trim();

/** Presentation forms to standard letters (ﷲ -> الله), keeping ﷺ, exactly as v1 does. */
function normalizeForms(s: string): string {
  return s.replace(/اﷲ/g, "ﷲ").replace(/[ﭐ-ﷹ﷼-﷿ﹰ-﻿]/g, (c) => c.normalize("NFKC"));
}

/** Reversed spellings of المسألة that the text layer produces after "(N)". */
const WORD = "(?:ةسألالم|ةلسأالم|ةألسالم|ةلأسالم)";
// Not anchored: a chapter subtitle can share the line ("-1شبهات حول أحوال القبر  - (168)ة…").
// The strict sequence check below keeps cross-references from being taken as headers.
const HEADER_STD = new RegExp(`-\\s*\\((\\d{1,3})\\)\\s*${WORD}(.*)$`);
const HEADER_COLON = new RegExp(`^:\\s*\\((\\d{1,3})\\)\\s*${WORD}(.*)$`);
const HEADER_NUMBER_ONLY = /^-\s*\((\d{1,3})\)$/;
const SPLIT_PREV = new RegExp(`^${WORD}(.*)$`);
const HEADER_BROKEN = /^-\s*\((\d{1,3})\)\s*ةل$/;

function pdfPages(folder: string): string[] {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "bk2-")), "out.txt");
  execFileSync("pdftotext", ["-enc", "UTF-8", path.join(folder, FILE), out]);
  return readFileSync(out, "utf8").split("\f");
}

/** A line extracted in reversed order: many words end with "لا" (reversed "ال"). */
function looksReversed(line: string): boolean {
  const words = line.replace(/[ً-ٟ]/g, "").split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return false;
  const rev = words.filter((w) => w.endsWith("لا")).length;
  const fwd = words.filter((w) => w.startsWith("ال")).length;
  return rev >= 1 && rev > fwd;
}

function cleanPage(page: string): string[] {
  const lines = normalizeForms(page.replace(BIDI, ""))
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !MARKS_ONLY.test(l));
  return lines.filter((l, i) => {
    if (/^\d{1,4}$/.test(l)) return false; // page number
    if (/^بينات - أسئلة منتقاة حول الإسلام$/.test(l)) return false; // running title
    if (i < 4 && looksReversed(l) && l.length < 60) return false; // reversed running section header
    return true;
  });
}

/** Table of contents: "( -)N<title><leader dots>\bPAGE", several entries per line, some wrapped. */
function parseToc(pages: string[]): Map<number, { title: string; page: number }> {
  // The table of contents runs until the first question header in the body.
  const firstBody = pages.findIndex((p) => new RegExp(`[-:]\\s*\\(1\\)\\s*${WORD}`).test(p.replace(BIDI, "")));
  const head = pages.slice(0, firstBody > 0 ? firstBody : 30).join("\n").replace(BIDI, "");
  const flat = normalizeForms(head).replace(/\r?\n/g, " ");
  const toc = new Map<number, { title: string; page: number }>();
  const re = /\)\s*[-:]\s*\)(\d{1,3})(.+?)�+\s*\u0008?\s*(\d{1,4})/g;
  for (const m of flat.matchAll(re)) {
    const n = Number(m[1]);
    if (n < 1 || n > EXPECTED || toc.has(n)) continue;
    toc.set(n, { title: m[2].replace(/\s+/g, " ").trim(), page: Number(m[3]) });
  }
  return toc;
}

/** Section markers at line start (diacritics and stray spaces ignored). */
// Matched with diacritics AND spaces removed: the text layer splits words around stray marks
// ("مختصَ ُر الإجابة", "خاتم ُة الجواب").
const SECTION_MARKERS: [RegExp, Speaker, string][] = [
  [/^عباراتمشابهةللسؤال/, "quoted_question", "عبارات مشابهة للسؤال"],
  [/^مضمونالسؤال/, "quoted_objection", "مضمون السؤال"],
  [/^مختصرالإجابة/, "author", "مختصر الإجابة"],
  [/^الجوابالتفصيلي/, "author", "الجواب التفصيلي"],
  [/^خاتمةالجواب/, "author", "خاتمة الجواب"],
  [/^السؤال/, "quoted_question", "السؤال"],
  [/^الجواب/, "author", "الجواب"],
];
const markerOf = (line: string) => {
  const s = strip(line).replace(/\s+/g, "");
  return SECTION_MARKERS.find(([re]) => re.test(s)) ?? null;
};

export function extractBayyinat(folder: string): { records: BookRecord[]; log: Record<string, unknown> } {
  const pages = pdfPages(folder);
  const toc = parseToc(pages);
  const stream: { line: string; page: number }[] = [];
  pages.forEach((p, i) => cleanPage(p).forEach((line) => stream.push({ line, page: i + 1 })));

  type Cur = { n: number; variant: string; lines: string[]; startPage: number };
  const items: Cur[] = [];
  let cur: Cur | null = null;
  const skipped: string[] = [];
  for (let i = 0; i < stream.length; i++) {
    // Stray combining marks can precede a header ("ُُُّ  - (2)…"); ignore them for detection only.
    const line = stream[i].line.replace(/^[\sً-ٰـ]+/, "");
    if (line.startsWith(")")) continue; // table-of-contents lines
    let n: number | null = null;
    let variant = "";
    let m: RegExpExecArray | null;
    if ((m = HEADER_STD.exec(line))) [n, variant] = [Number(m[1]), "standard"];
    else if ((m = HEADER_COLON.exec(line))) [n, variant] = [Number(m[1]), "colon instead of dash"];
    else if ((m = HEADER_NUMBER_ONLY.exec(line)) && SPLIT_PREV.test(stream[i - 1]?.line ?? "")) [n, variant] = [Number(m[1]), "header split over two lines"];
    else if ((m = HEADER_BROKEN.exec(line)) && /^سأ$/.test(stream[i - 1]?.line ?? "")) [n, variant] = [Number(m[1]), "word المسألة broken over three lines"];
    if (n !== null) {
      const expected = (items.at(-1)?.n ?? 0) + 1;
      if (n === expected) {
        // A split header leaves a title fragment on the previous line: take it out of the previous item.
        if (variant !== "standard" && variant !== "colon instead of dash" && cur?.lines.length) cur.lines.pop();
        cur = { n, variant, lines: [], startPage: stream[i].page };
        items.push(cur);
        continue;
      }
      skipped.push(`line ${i}: header-like (${n}) where ${expected} was expected`);
    }
    if (cur) cur.lines.push(line);
  }

  const records: BookRecord[] = [];
  for (const it of items) {
    // Drop title fragments before the first section marker; titles come from the table of contents.
    const first = it.lines.findIndex((l) => markerOf(l));
    const body = first >= 0 ? it.lines.slice(first) : it.lines;
    let text = "";
    const marks: { at: number; speaker: Speaker; label: string }[] = [];
    let answered = false;
    for (const l of body) {
      let mk = markerOf(l);
      // Once the answer has started, a line beginning with «السؤال» is the author's text, not a new question.
      if (mk && answered && mk[1] === "quoted_question") mk = null;
      if (mk && mk[2] === "الجواب") answered = true;
      if (mk) {
        if (text) text += "\n";
        marks.push({ at: text.length, speaker: mk[1], label: mk[2] });
        text += l;
      } else text += (text ? " " : "") + l;
    }
    const sections: Section[] = marks.map((mk, k) => ({ start: mk.at, end: marks[k + 1]?.at ?? text.length, speaker: mk.speaker, label: mk.label }));
    // Text after "الجواب" and before a nested marker is the author's.
    const t = toc.get(it.n);
    // Fallback title: the asker's question as the book states it (first sentence of «السؤال»).
    const q = sections.find((s) => s.label === "السؤال");
    const fallback = q ? text.slice(q.start, q.end).replace(/^السؤال\s*/, "").split(/[؟?.]/)[0].trim() + "؟" : "";
    records.push({
      id: `bayyinat:${it.n}`,
      sourceId: "bayyinat",
      key: String(it.n),
      number: it.n,
      title: t?.title ?? fallback,
      page: t?.page ?? null,
      text,
      sections,
      headerVariant: it.variant,
    });
  }
  const variants: Record<string, number[]> = {};
  for (const r of records) (variants[r.headerVariant] ??= []).push(r.number);
  const log = {
    expected: EXPECTED,
    found: records.length,
    missing: Array.from({ length: EXPECTED }, (_, k) => k + 1).filter((n) => !records.some((r) => r.number === n)),
    tocEntries: toc.size,
    withoutTocTitle: records.filter((r) => !r.title).map((r) => r.number),
    variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, k === "standard" ? v.length : v])),
    skippedHeaderLike: skipped,
    withoutAnswerSection: records.filter((r) => !r.sections.some((s) => s.label === "الجواب")).map((r) => r.number),
    lengths: (() => {
      const l = records.map((r) => r.text.length).sort((a, b) => a - b);
      return { min: l[0], median: l[l.length >> 1], max: l.at(-1) };
    })(),
  };
  return { records, log };
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const folder = process.argv[2];
  if (!folder) throw new Error("Pass the folder that holds the PDFs");
  const { records, log } = extractBayyinat(folder);
  mkdirSync("data/v2/books", { recursive: true });
  writeFileSync("data/v2/books/bayyinat.records.json", JSON.stringify({ source: FILE, extractedWith: "pdftotext (text layer), v2 rules", records }));
  writeFileSync("data/v2/books/bayyinat.extract-log.json", JSON.stringify(log, null, 1));
  console.log(JSON.stringify(log, null, 1));
}
