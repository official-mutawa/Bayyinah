// Embed every v2 retrieval unit (book/tafsir child chunks and Quran verse+tafsir pairs) into
// data/v2/vectors.i8.bin + vectors.json (gitignored). Incremental: units already embedded with the
// same model and the same text hash are kept. Sequential, paced batches so the shared key's
// tokens-per-minute limit is never approached; any 429 stops the run.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/v2/build-index.ts [--tpm 250000]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { installUsageTracking, loadLocalEnv, usage } from "../../eval/lib/usage.ts";

loadLocalEnv();
installUsageTracking("v2-build-index");
const { embed, embedModel, EMBED_DIMS } = await import("../../src/lib/openai.ts");
const { quantize } = await import("../../src/lib/vectors.ts");
const V = await import("../../src/lib/v2/corpus-v2.ts");

const tpmArg = process.argv.indexOf("--tpm");
const TPM = tpmArg > 0 ? Number(process.argv[tpmArg + 1]) : 250000;
const corpus = JSON.parse(readFileSync(V.V2_CORPUS(), "utf8")) as import("../../src/lib/v2/types.ts").V2Corpus;
const records = new Map(corpus.records.map((r) => [r.id, r]));
const tafsirOf = new Map<string, (typeof corpus.records)[number]>();
for (const r of corpus.records) if (r.sourceId === "muyassar") tafsirOf.set(`quran:${r.surah}:${r.ayah}`, r);
const units = V.unitsOf(corpus);
const texts = units.map((u) => V.unitEmbeddingText(u, records.get(u.recordId)!, tafsirOf.get(u.recordId)));
const hashes = texts.map((t) => createHash("sha1").update(t).digest("hex").slice(0, 16));
const model = embedModel();

type Meta = { model: string; dims: number; ids: string[]; hashes: string[]; scales: number[]; builtAt: string };
let old: { meta: Meta; bin: Int8Array; at: Map<string, number> } | null = null;
if (existsSync(V.V2_VECTORS_META()) && existsSync(V.V2_VECTORS_BIN())) {
  const meta = JSON.parse(readFileSync(V.V2_VECTORS_META(), "utf8")) as Meta;
  if (meta.model === model && meta.dims === EMBED_DIMS) {
    const buf = readFileSync(V.V2_VECTORS_BIN());
    old = { meta, bin: new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength), at: new Map(meta.ids.map((id, i) => [`${id}#${meta.hashes[i]}`, i])) };
  }
}
const todo = units.map((_, i) => i).filter((i) => !old?.at.has(`${units[i].id}#${hashes[i]}`));
const approxTokens = (s: string) => Math.ceil(s.length / 2.5);
console.log(`${units.length} units; ${units.length - todo.length} kept; embedding ${todo.length} (~${todo.reduce((n, i) => n + approxTokens(texts[i]), 0)} tokens est.) at <= ${TPM} tokens/min`);

const fresh = new Map<number, Float32Array>();
let windowStart = Date.now();
let windowTokens = 0;
for (let k = 0; k < todo.length; ) {
  const batch: number[] = [];
  let chars = 0;
  while (k < todo.length && batch.length < 256 && chars + texts[todo[k]].length < 120000) {
    chars += texts[todo[k]].length;
    batch.push(todo[k++]);
  }
  const est = batch.reduce((n, i) => n + approxTokens(texts[i]), 0);
  if (Date.now() - windowStart > 60000) {
    windowStart = Date.now();
    windowTokens = 0;
  }
  if (windowTokens + est > TPM) {
    const wait = 60000 - (Date.now() - windowStart) + 500;
    await new Promise((r) => setTimeout(r, wait));
    windowStart = Date.now();
    windowTokens = 0;
  }
  const mark = usage.calls.length;
  const vecs = await embed(batch.map((i) => texts[i]), 120000);
  const real = usage.since(mark).input || est;
  windowTokens += real;
  batch.forEach((i, j) => fresh.set(i, vecs[j]));
  if (usage.rateLimited) throw new Error("Rate limit hit: stopping so the live site is not affected");
  process.stdout.write(`\r  ${fresh.size}/${todo.length}  $${usage.usd.toFixed(4)}  `);
}
console.log();

const q = quantize([...fresh.values()], EMBED_DIMS);
const freshRow = new Map([...fresh.keys()].map((i, r) => [i, r]));
const bin = new Int8Array(units.length * EMBED_DIMS);
const scales: number[] = [];
units.forEach((u, i) => {
  const o = old?.at.get(`${u.id}#${hashes[i]}`);
  if (o !== undefined) {
    bin.set(old!.bin.subarray(o * EMBED_DIMS, (o + 1) * EMBED_DIMS), i * EMBED_DIMS);
    scales.push(old!.meta.scales[o]);
  } else {
    const r = freshRow.get(i)!;
    bin.set(q.bin.subarray(r * EMBED_DIMS, (r + 1) * EMBED_DIMS), i * EMBED_DIMS);
    scales.push(q.scales[r]);
  }
});
writeFileSync(V.V2_VECTORS_BIN(), Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength));
writeFileSync(V.V2_VECTORS_META(), JSON.stringify({ model, dims: EMBED_DIMS, ids: units.map((u) => u.id), hashes, scales, builtAt: new Date().toISOString() } satisfies Meta));
console.log(`Saved ${units.length} vectors (${(bin.byteLength / 1e6).toFixed(1)} MB). Cost $${usage.usd.toFixed(4)}; tokens ${usage.since(0).input}`);
