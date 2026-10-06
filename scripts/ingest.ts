// Ingest: run the source checks and precompute embeddings for every passage.
// Sources come only from sources/manifest.json (approved files in sources/).
// Usage: npm run ingest:check   (checks only, no API calls)
//        npm run ingest         (checks, then embeddings; add -- --force to rebuild)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "../src/lib/corpus.ts";
import { embed, embedModel, EMBED_DIMS, modelExists } from "../src/lib/openai.ts";
import { embeddingText, quantize, saveVectors, VECTORS_META } from "../src/lib/vectors.ts";
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

if (args.has("--checks-only")) process.exit(0);

// 2. Embeddings.
const model = embedModel();
const ids = corpus.passages.map((p) => p.id);
if (!args.has("--force") && existsSync(VECTORS_META)) {
  const meta = JSON.parse(readFileSync(VECTORS_META, "utf8")) as VectorMeta;
  if (meta.model === model && meta.dims === EMBED_DIMS && meta.ids.join("|") === ids.join("|")) {
    console.log(`\nEmbeddings up to date (${meta.model}, ${meta.dims} dims, ${meta.count} vectors). Use --force to rebuild.`);
    process.exit(0);
  }
}
if (!process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY is not set (add it to .env.local)");
if (!(await modelExists(model))) fail(`Embedding model "${model}" not found via the models endpoint`);
console.log(`\nEmbedding ${ids.length} passages with ${model} (${EMBED_DIMS} dims)…`);

const texts = corpus.passages.map(embeddingText);
const batches: number[][] = [];
let current: number[] = [];
let chars = 0;
texts.forEach((t, i) => {
  if (current.length && (current.length >= 500 || chars + t.length > 120000)) {
    batches.push(current);
    current = [];
    chars = 0;
  }
  current.push(i);
  chars += t.length;
});
if (current.length) batches.push(current);

const vectors: Float32Array[] = new Array(texts.length);
let done = 0;
const queue = [...batches];
async function worker() {
  for (let b = queue.shift(); b; b = queue.shift()) {
    const out = await embed(b.map((i) => texts[i]), 120000);
    b.forEach((i, j) => (vectors[i] = out[j]));
    done += b.length;
    process.stdout.write(`\r  ${done}/${texts.length}`);
  }
}
try {
  await Promise.all([worker(), worker()]);
} catch (e) {
  fail((e as Error).message);
}
console.log();

const { bin, scales } = quantize(vectors, EMBED_DIMS);
saveVectors({ model, dims: EMBED_DIMS, count: ids.length, createdAt: new Date().toISOString(), ids, scales }, bin);
console.log(`Saved data/embeddings.json and data/embeddings.i8.bin (${(bin.byteLength / 1e6).toFixed(1)} MB)`);
