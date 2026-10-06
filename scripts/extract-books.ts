// Extract approved books from their PDF text layer into passage chunks (sources/<id>.chunks.json).
// Rules only, no language model: pdftotext output, bidi-control removal, presentation-form
// normalization, dropping reversed running headers and stray diacritic-only lines.
// Usage: node scripts/extract-books.ts "<folder with the PDFs>"

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { arabicDigits } from "../src/lib/arabic.ts";

const folder = process.argv[2];
if (!folder) throw new Error("Pass the folder that holds the PDFs");

function pdfPages(file: string): string[] {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "bk-")), "out.txt");
  execFileSync("pdftotext", ["-enc", "UTF-8", path.join(folder, file), out]);
  return readFileSync(out, "utf8").split("\f");
}

const BIDI = /[‪-‮‎‏⁦-⁩]/g;
const MARKS_ONLY = /^[\sً-ٰٟۖ-ۭ]*$/;

/** Presentation forms to their standard letters (ﷲ -> الله), keeping ﷺ as the proper sign. */
function normalizeForms(s: string): string {
  // "اﷲ" in these PDFs is alef + the ﷲ ligature for one word: الله.
  return s.replace(/اﷲ/g, "ﷲ").replace(/[ﭐ-ﷹ﷼-﷿ﹰ-﻿]/g, (c) => c.normalize("NFKC"));
}

/** A line extracted in reversed order: many words end with "لا" (reversed "ال"). */
function looksReversed(line: string): boolean {
  const words = line.replace(/[ً-ٟ]/g, "").split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return false;
  const rev = words.filter((w) => w.endsWith("لا")).length;
  const fwd = words.filter((w) => w.startsWith("ال")).length;
  return rev >= 1 && rev > fwd;
}

function cleanLines(page: string, dropTitles: RegExp): string[] {
  const lines = normalizeForms(page.replace(BIDI, ""))
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !MARKS_ONLY.test(l));
  // Running header area: page number, book title, reversed section header.
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (i < 4 && (/^\d{1,4}$/.test(l) || dropTitles.test(l) || (looksReversed(l) && l.length < 60))) return;
    out.push(l);
  });
  return out;
}

function printedPage(page: string, fallback: number): number {
  const m = page.replace(BIDI, "").split(/\r?\n/).slice(0, 6).map((l) => l.trim()).find((l) => /^\d{1,4}$/.test(l));
  return m ? Number(m) : fallback;
}

interface Chunk {
  key: string;
  text: string;
  refLabel: string;
  number?: string;
  page: number;
  authorStart?: number;
}

// ---------- Bayyinat: one passage per question ----------

function bayyinat(file: string): Chunk[] {
  const pages = pdfPages(file);
  // "- (130)ةسألالم<title>": number, the reversed word المسألة, then the title. Table-of-contents
  // lines look like ") -)130<title>" and are skipped.
  const header = /-\s*\((\d+)\)\s*([اأملسة]{6,8})\s*(.*)$/;
  const chunks: Chunk[] = [];
  let cur: { n: string; title: string; page: number; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    let text = cur.lines.join("\n");
    // Paragraph structure: keep the section markers on their own lines.
    text = text.replace(/\n(?!(السؤال|الجواب|مضمون السؤال|مضمونُ السؤال|خاتمة الجواب|خاتِم ُة الجواب|خاتمةُ الجواب))/g, " ");
    const answerAt = text.search(/(^|\n)الجواب/);
    chunks.push({
      key: cur.n,
      number: cur.n,
      page: cur.page,
      text,
      refLabel: `بينات، المسألة ${arabicDigits(cur.n)}: ${cur.title.length > 70 ? `${cur.title.slice(0, 70)}…` : cur.title}`,
      authorStart: answerAt >= 0 ? answerAt : undefined,
    });
  };
  pages.forEach((page, i) => {
    const pageNo = printedPage(page, i + 1);
    for (const line of cleanLines(page, /^بينات - أسئلة منتقاة حول الإسلام$/)) {
      const m = line.startsWith(")") ? null : header.exec(line);
      if (m && m[2].includes("ة")) {
        flush();
        cur = { n: m[1], title: m[3].trim(), page: pageNo, lines: [m[3].trim()] };
        continue;
      }
      if (cur) cur.lines.push(line);
    }
  });
  flush();
  return chunks;
}

// ---------- Page-based books: one passage per page, chapter carried forward ----------

function byPage(file: string, short: string, titleLine: RegExp): Chunk[] {
  const pages = pdfPages(file);
  const chunks: Chunk[] = [];
  let chapter = "";
  pages.forEach((page, i) => {
    const lines = cleanLines(page, titleLine);
    if (!lines.length) return;
    for (const l of lines.slice(0, 6)) {
      if (/^(الباب|الفصل|المبحث|المطلب)\s/.test(l) && l.length < 60) chapter = l;
    }
    const text = lines.join(" ");
    if (text.replace(/[^ء-ي]/g, "").length < 120) return; // title or near-empty page
    const pageNo = printedPage(page, i + 1);
    chunks.push({
      key: String(i + 1),
      number: String(pageNo),
      page: pageNo,
      text,
      refLabel: `${short}${chapter ? `، ${chapter}` : ""}، ص ${arabicDigits(pageNo)}`,
    });
  });
  return chunks;
}

const jobs: [string, string, () => Chunk[]][] = [
  ["bayyinat", "بينات-اسئله واجوبه عن الاسلام.pdf", () => bayyinat("بينات-اسئله واجوبه عن الاسلام.pdf")],
  ["usoul-eman", "UsoulEman-Arabic.pdf", () => byPage("UsoulEman-Arabic.pdf", "أصول الإيمان", /^أصول الإيمان في ضوء الكتاب والسنة$/)],
];

for (const [id, file, run] of jobs) {
  const chunks = run();
  writeFileSync(path.join("sources", `${id}.chunks.json`), JSON.stringify({ source: file, extractedWith: "pdftotext (text layer)", chunks }));
  const lens = chunks.map((c) => c.text.length).sort((a, b) => a - b);
  console.log(`${id}: ${chunks.length} passages, median ${lens[lens.length >> 1]} chars, max ${lens[lens.length - 1]}`);
}
