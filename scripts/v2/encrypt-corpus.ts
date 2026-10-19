// Encrypt the local v2 corpus (data/v2/corpus.json, gitignored: it holds the private book texts)
// into data/v2/corpus.enc, the only form of it that may be committed. Same layout and key as v1's
// data/private.enc: AES-256-GCM with BAYYINAH_INDEX_KEY over the gzipped JSON. The bundle is
// decrypted again and compared before the script reports success. No API calls.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/v2/encrypt-corpus.ts

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { decryptV2Corpus, V2_CORPUS, V2_CORPUS_ENC } from "../../src/lib/v2/corpus-v2.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const key = process.env.BAYYINAH_INDEX_KEY;
if (!key || key.length !== 64) throw new Error("BAYYINAH_INDEX_KEY (64 hex chars) is required in .env.local");
if (!existsSync(V2_CORPUS())) throw new Error("data/v2/corpus.json is missing: run scripts/v2/build-records.ts first");

const json = readFileSync(V2_CORPUS(), "utf8");
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
const enc = Buffer.concat([cipher.update(gzipSync(json, { level: 9 })), cipher.final()]);
const bundle = Buffer.concat([iv, cipher.getAuthTag(), enc]);

// Round trip before writing: the decrypted corpus must equal the source exactly.
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
if (sha(JSON.stringify(decryptV2Corpus(bundle, key))) !== sha(JSON.stringify(JSON.parse(json)))) throw new Error("round trip mismatch");

writeFileSync(V2_CORPUS_ENC(), bundle);
console.log(`data/v2/corpus.enc: ${bundle.length} bytes (from ${Buffer.byteLength(json)} bytes of JSON), round trip verified`);
