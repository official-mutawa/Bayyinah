// Self-test for the source adapters and ingest checks, using placeholder fixtures only.
// Usage: npm run test:adapters

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus } from "../src/lib/corpus.ts";

const fixtures = path.resolve("tests/fixtures/sources");
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

/** Run loadCorpus inside a temp project whose sources/ is a copy of the fixtures, optionally changed. */
function withSources(edit: (dir: string) => void): { error: string | null; corpus: ReturnType<typeof loadCorpus> | null } {
  const root = mkdtempSync(path.join(tmpdir(), "bayyinah-"));
  const dir = path.join(root, "sources");
  cpSync(fixtures, dir, { recursive: true });
  edit(dir);
  const cwd = process.cwd();
  process.chdir(root);
  try {
    return { error: null, corpus: loadCorpus({ verifyHashes: true }) };
  } catch (e) {
    return { error: (e as Error).message, corpus: null };
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
}

function editManifest(dir: string, fn: (m: { sources: Record<string, unknown>[] }) => void) {
  const file = path.join(dir, "manifest.json");
  const m = JSON.parse(readFileSync(file, "utf8"));
  fn(m);
  writeFileSync(file, JSON.stringify(m));
}

// Valid fixtures load through every adapter.
const ok = withSources(() => {});
check("valid fixtures load", ok.error === null, ok.error ?? "");
const ids = ok.corpus?.passages.map((p) => p.id) ?? [];
check("tanzil-txt adapter (license lines skipped)", ids.includes("t-txt:1:2") && ok.corpus!.report[0].count === 2);
const json2 = ok.corpus?.passages.find((p) => p.id === "t-json:2");
check("json adapter with field mapping and grade", json2?.grade === "درجة تجريبية" && json2.refLabel === "مصدر تجريبي ٢، رقم ٢");
check("json adapter: empty grade becomes null", ok.corpus?.passages.find((p) => p.id === "t-json:1")?.grade === null);
const csv2 = ok.corpus?.passages.find((p) => p.id === "t-csv:2");
check("csv adapter with quotes and reference template", csv2?.text === 'نص تجريبي فيه "علامة اقتباس"' && csv2.refLabel === "مصدر تجريبي ٣، باب تجريبي، رقم ٢");
check("text adapter splits on blank lines", ok.corpus?.passages.filter((p) => p.sourceId === "t-book").length === 3);
check("text is passed through unchanged", ok.corpus?.passages.find((p) => p.id === "t-txt:1:1")?.text === "نص تجريبي أول");

// Each failure case must be rejected with a clear message.
const cases: [string, (dir: string) => void, RegExp][] = [
  ["duplicate ids", (d) => writeFileSync(path.join(d, "sample.txt"), "1|1|أ\n1|1|ب\n"), /Duplicate id/],
  ["missing text", (d) => writeFileSync(path.join(d, "sample.txt"), "1|1|نص\n1|2|\n"), /Missing text: t-txt:1:2/],
  ["wrong count", (d) => writeFileSync(path.join(d, "sample.txt"), "1|1|نص\n"), /expected 2 passages, found 1/],
  ["changed file vs recorded sha256", (d) => editManifest(d, (m) => (m.sources[0].sha256 = "0".repeat(64))), /does not match its recorded SHA-256/],
  ["missing file", (d) => editManifest(d, (m) => (m.sources[1].file = "absent.json")), /file not found/],
  ["unknown format", (d) => editManifest(d, (m) => (m.sources[2].format = "pdf")), /unknown format/],
  ["missing attribution", (d) => editManifest(d, (m) => delete m.sources[3].attribution), /attribution and license are required/],
  [
    "quran source must have 6236 verses",
    (d) => editManifest(d, (m) => {
      m.sources[0].kind = "quran";
      delete m.sources[0].expectedCount;
    }),
    /expected 6236 passages/,
  ],
];
for (const [name, edit, expected] of cases) {
  const r = withSources(edit);
  check(`rejects ${name}`, !!r.error && expected.test(r.error), r.error ?? "no error raised");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll adapter and ingest checks passed");
process.exit(failures ? 1 : 0);
