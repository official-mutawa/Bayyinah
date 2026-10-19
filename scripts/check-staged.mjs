// Pre-commit safety check (run by hand before every commit; not a git hook):
// blocks staged secrets, env files, local work folders, plaintext book data, and any staged text
// that contains a 12-word run from a book passage. Prints file names and reasons only, never
// the matching text or a key.
// Usage: node scripts/check-staged.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const problems = [];

const BLOCKED_PATHS = [
  [/^\.env/, "env file"],
  [/(^|\/)\.env/, "env file"],
  [/^local\//, "local work folder (eval runs, traces, golden set, decrypted text)"],
  [/^sources\/(?!README\.md$|manifest\.json$|manifest\.example\.json$|mushafs-1\.json\.gz$|tafsir-book-2012\.json\.gz$)/, "source file that is not approved for the repo"],
  [/\.chunks\.json$/, "book chunks"],
  [/^sources\/ocr\//, "OCR page text"],
  [/^data\/v2\/(?!corpus\.enc$|vectors\.i8\.bin$|vectors\.json$)/, "unencrypted v2 index data"],
];
for (const f of staged) for (const [re, why] of BLOCKED_PATHS) if (re.test(f)) problems.push(`${f}: ${why}`);

const SECRET_PATTERNS = [
  [/sk-(proj-)?[A-Za-z0-9_-]{20,}/, "looks like an OpenAI key"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "looks like an Anthropic key"],
  [/AIza[0-9A-Za-z_-]{30,}/, "looks like a Google API key"],
  // Env-file style assignment at line start (code that sets a fake test value is allowed).
  [/^\s*(export\s+)?(OPENAI_API_KEY|BAYYINAH_INDEX_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY)\s*=\s*\S{8,}/m, "assigns a secret variable"],
  [/(OPENAI_API_KEY|BAYYINAH_INDEX_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY)\s*=\s*["'](sk-|AIza|[0-9a-f]{32})/, "assigns a key-like value to a secret variable"],
  [/\b[0-9a-f]{64}\b/, "64-hex string (could be the index key; SHA-256 hashes also match, check by hand)"],
];

// 12-word windows of normalized book text, to catch pasted passages.
const norm = (s) => s.replace(/[ً-ٰٟـ]/g, "").replace(/[^ء-ي\s]/g, " ").replace(/\s+/g, " ").trim();
const windows = new Set();
const bookFiles = existsSync("sources") ? readdirSync("sources").filter((f) => f.endsWith(".chunks.json")) : [];
for (const f of bookFiles) {
  for (const c of JSON.parse(readFileSync(path.join("sources", f), "utf8")).chunks) {
    const w = norm(c.text).split(" ");
    for (let i = 0; i + 12 <= w.length; i += 6) windows.add(w.slice(i, i + 12).join(" "));
  }
}

for (const f of staged) {
  if (!existsSync(f) || /\.(png|jpe?g|webp|webm|mp4|ico|gz|bin|enc)$/.test(f)) continue;
  const text = execFileSync("git", ["show", `:${f}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const [re, why] of SECRET_PATTERNS) {
    if (!re.test(text)) continue;
    // Recorded source hashes in the manifest and ingest log are expected.
    if (why.startsWith("64-hex") && /(^|\/)(manifest\.json|ingest-log\.json|embeddings\.json)$/.test(f)) continue;
    problems.push(`${f}: ${why}`);
  }
  if (windows.size) {
    const w = norm(text).split(" ");
    let hit = false;
    for (let i = 0; i + 12 <= w.length && !hit; i++) if (windows.has(w.slice(i, i + 12).join(" "))) hit = true;
    if (hit) problems.push(`${f}: contains a 12-word run from a book passage`);
  }
}

if (problems.length) {
  console.error(`check-staged: ${problems.length} problem(s); do not commit:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`check-staged: ${staged.length} staged file(s) checked against ${windows.size} book windows; no problems.`);
