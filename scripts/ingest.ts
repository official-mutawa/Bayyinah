// Ingest: run the source checks and precompute embeddings for every passage.
// Sources come only from sources/manifest.json (approved files in sources/).
// Usage: npm run ingest:check   (checks only, no API calls)
//        npm run ingest         (checks, then embeddings; add -- --force to rebuild)

import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { loadCorpus, PRIVATE_BUNDLE } from "../src/lib/corpus.ts";
import { embed, embedModel, EMBED_DIMS, modelExists } from "../src/lib/openai.ts";
import { embeddingText, quantize, saveVectors, VECTORS_BIN, VECTORS_META } from "../src/lib/vectors.ts";
import type { VectorMeta } from "../src/lib/vectors.ts";

const args = new Set(process.argv.slice(2));
try {
  process.loadEnvFile(".env.local");
} catch {
  // No local env file; rely on the environment.
}

function fail(message: string): never {
  console.error(`\nINGEST FAILED: ${message}`);
  process.exit(1);
}

// 1. Checks: manifest valid, files present and unchanged, unique ids, text and reference present, counts.
let corpus: ReturnType<typeof loadCorpus>;
try {
  corpus = loadCorpus({ verifyHashes: true });
} catch (e) {
  fail((e as Error).message);
}

console.log("Sources (all checks passed):");
for (const r of corpus.report) {
  console.log(`  ✓ ${r.id.padEnd(12)} ${String(r.count).padStart(6)} passages  ${r.kind.padEnd(6)}  ${r.label}`);
  console.log(`    version: ${r.version ?? "not recorded"}  sha256: ${r.sha256}`);
}
console.log(`  Total ${corpus.passages.length} passages, all ids unique, no missing text or reference`);

mkdirSync("data", { recursive: true });
writeFileSync(
  "data/ingest-log.json",
  JSON.stringify({ checkedAt: new Date().toISOString(), total: corpus.passages.length, sources: corpus.report }, null, 2) + "\n"
);

// Private (copyrighted) sources: encrypted bundle for the deployed site; never committed in clear.
const privateIds = corpus.sources.filter((x) => x.private && corpus.records[x.id]).map((x) => x.id);
if (privateIds.length) {
  const key = process.env.BAYYINAH_INDEX_KEY;
  if (!key || key.length !== 64) fail("BAYYINAH_INDEX_KEY (64 hex chars) is required in .env.local to build the private bundle");
  const payload = gzipSync(JSON.stringify(Object.fromEntries(privateIds.map((id) => [id, corpus.records[id]]))));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
  writeFileSync(PRIVATE_BUNDLE(), Buffer.concat([iv, cipher.getAuthTag(), enc]));
  console.log(`
Encrypted bundle for private sources (${privateIds.join(", ")}): data/private.enc`);
}

if (args.has("--checks-only")) process.exit(0);

// 2. Embeddings. Incremental: vectors of passages already embedded with the same model are kept;
// only new passages are embedded (sequentially, to stay under the tokens-per-minute limit).
const model = embedModel();
const ids = corpus.passages.map((p) => p.id);
let old: { meta: VectorMeta; bin: Int8Array; index: Map<string, number> } | null = null;
if (!args.has("--force") && existsSync(VECTORS_META) && existsSync(VECTORS_BIN)) {
  const meta = JSON.parse(readFileSync(VECTORS_META, "utf8")) as VectorMeta;
  if (meta.model === model && meta.dims === EMBED_DIMS) {
    const buf = readFileSync(VECTORS_BIN);
    old = { meta, bin: new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength), index: new Map(meta.ids.map((id, i) => [id, i])) };
    if (meta.ids.join("|") === ids.join("|")) {
      console.log(`\nEmbeddings up to date (${meta.model}, ${meta.dims} dims, ${meta.count} vectors). Use --force to rebuild.`);
      process.exit(0);
    }
  }
}
const todo = corpus.passages.map((p, i) => i).filter((i) => !old?.index.has(ids[i]));
if (!process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY is not set (add it to .env.local)");
if (todo.length && !(await modelExists(model))) fail(`Embedding model "${model}" not found via the models endpoint`);
console.log(`\nEmbedding ${todo.length} new passages with ${model} (${EMBED_DIMS} dims); keeping ${ids.length - todo.length} existing vectors…`);

const texts = new Map(todo.map((i) => [i, embeddingText(corpus.passages[i])]));
const batches: number[][] = [];
let current: number[] = [];
let chars = 0;
for (const i of todo) {
  const t = texts.get(i)!;
  if (current.length && (current.length >= 200 || chars + t.length > 60000)) {
    batches.push(current);
    current = [];
    chars = 0;
  }
  current.push(i);
  chars += t.length;
}
if (current.length) batches.push(current);

const fresh = new Map<number, Float32Array>();
let done = 0;
for (const b of batches) {
  let out: Float32Array[] | null = null;
  for (let attempt = 0; attempt < 6 && !out; attempt++) {
    try {
      out = await embed(b.map((i) => texts.get(i)!), 120000);
    } catch (e) {
      if (attempt === 5) fail((e as Error).message);
      await new Promise((r) => setTimeout(r, 20000)); // let the per-minute token window refill
    }
  }
  b.forEach((i, j) => fresh.set(i, out![j]));
  done += b.length;
  process.stdout.write(`\r  ${done}/${todo.length}`);
}
console.log();

// Assemble: old rows copied as they are, new rows quantized.
const q = quantize([...fresh.values()], EMBED_DIMS);
const freshRow = new Map([...fresh.keys()].map((i, k) => [i, k]));
const bin = new Int8Array(ids.length * EMBED_DIMS);
const scales: number[] = [];
ids.forEach((id, i) => {
  const o = old?.index.get(id);
  if (o !== undefined) {
    bin.set(old!.bin.subarray(o * EMBED_DIMS, (o + 1) * EMBED_DIMS), i * EMBED_DIMS);
    scales.push(old!.meta.scales[o]);
  } else {
    const k = freshRow.get(i)!;
    bin.set(q.bin.subarray(k * EMBED_DIMS, (k + 1) * EMBED_DIMS), i * EMBED_DIMS);
    scales.push(q.scales[k]);
  }
});
saveVectors({ model, dims: EMBED_DIMS, count: ids.length, createdAt: new Date().toISOString(), ids, scales }, bin);
console.log(`Saved data/embeddings.json and data/embeddings.i8.bin (${(bin.byteLength / 1e6).toFixed(1)} MB)`);
