// OCR approved scanned books with Tesseract (Arabic). Output: one raw text file per PDF page in
// sources/ocr/<id>/pNNNN.txt (gitignored). No language model touches the text.
// Pages are rendered with Windows' built-in PDF renderer (scripts/render-pages.ps1), downscaled to
// 2600 px grayscale, read by Tesseract as one text block (--psm 6, which keeps every paragraph;
// automatic layout mode 3 dropped blocks), then deleted. Resumable: existing page files are skipped.
// Usage: node scripts/ocr-books.ts "<folder with the PDFs>" [id ...]

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const folder = process.argv[2];
if (!folder) throw new Error("Pass the folder that holds the PDFs");
const only = new Set(process.argv.slice(3));

const TESSERACT = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
const TESSDATA = path.join(process.env.LOCALAPPDATA ?? "", "tessdata");
const RENDER = path.resolve("scripts/render-pages.ps1");
const WORKERS = 10;
const BATCH = 4;

export const OCR_BOOKS: { id: string; file: string }[] = [
  { id: "shumoo-nahar", file: "شموع-النهار.pdf" },
  { id: "raheeq", file: "الرحيق المختوم .pdf" },
  { id: "barahin", file: "براهين وجود الله.pdf" },
];

async function pageCount(pdf: string): Promise<number> {
  const { stdout } = await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", RENDER, "-Pdf", pdf, "-Out", tmpdir(), "-CountOnly"]);
  return Number(stdout.trim());
}

async function ocrBatch(pdf: string, outDir: string, from: number, to: number) {
  const tmp = mkdtempSync(path.join(tmpdir(), "ocr-"));
  try {
    await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", RENDER, "-Pdf", pdf, "-Out", tmp, "-From", String(from), "-To", String(to)], { maxBuffer: 1 << 20 });
    for (const name of readdirSync(tmp).filter((n) => n.endsWith(".png")).sort()) {
      const full = path.join(tmp, name);
      const small = full.replace(/\.png$/, "s.png");
      await sharp(full).resize({ width: 2600 }).grayscale().png().toFile(small);
      rmSync(full);
      const base = path.join(tmp, name.replace(/\.png$/, ""));
      await run(TESSERACT, ["--tessdata-dir", TESSDATA, small, base, "-l", "ara", "--psm", "6"], { env: { ...process.env, OMP_THREAD_LIMIT: "1" } });
      rmSync(small);
      writeFileSync(path.join(outDir, `${name.replace(/\.png$/, "")}.txt`), readFileSync(`${base}.txt`, "utf8"));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

for (const book of OCR_BOOKS) {
  if (only.size && !only.has(book.id)) continue;
  const pdf = path.join(folder, book.file);
  const outDir = path.join("sources", "ocr", book.id);
  mkdirSync(outDir, { recursive: true });
  const pages = await pageCount(pdf);
  const todo: [number, number][] = [];
  for (let p = 1; p <= pages; p += BATCH) {
    const to = Math.min(pages, p + BATCH - 1);
    let missing = false;
    for (let q = p; q <= to; q++) if (!existsSync(path.join(outDir, `p${String(q).padStart(4, "0")}.txt`))) missing = true;
    if (missing) todo.push([p, to]);
  }
  const started = Date.now();
  let done = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          await ocrBatch(pdf, outDir, job[0], job[1]);
        } catch (e) {
          console.error(`${book.id} pages ${job[0]}-${job[1]} failed: ${(e as Error).message.slice(0, 200)}`);
        }
        done++;
        if (done % 10 === 0 || done === todo.length)
          console.log(`${book.id}: ${done}/${todo.length} batches, ${Math.round((Date.now() - started) / 1000)}s`);
      }
    })
  );
  console.log(`${book.id}: done, ${readdirSync(outDir).length}/${pages} pages`);
}
