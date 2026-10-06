// Runs tests/questions.json against the API, prints a pass/fail table and saves tests/results.json.
// Usage: node tests/run.ts [baseUrl]   (default http://localhost:3000)

import { readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "../src/lib/corpus.ts";
import type { AskResult, PipelineEvent } from "../src/lib/pipeline.ts";

interface TestQuestion {
  id: string;
  category: string;
  question: string;
  expect: "answer" | "abstain";
  must_retrieve: string[][];
}

const baseUrl = (process.argv[2] || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const { questions } = JSON.parse(readFileSync("tests/questions.json", "utf8")) as { questions: TestQuestion[] };

async function run(question: string): Promise<{ result: AskResult | null; error: string | null; stages: string[]; ms: number }> {
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text();
    return { result: null, error: `HTTP ${res.status}: ${body.slice(0, 200)}`, stages: [], ms: Date.now() - started };
  }
  const stages: string[] = [];
  let result: AskResult | null = null;
  let error: string | null = null;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const e = JSON.parse(line) as PipelineEvent;
      if (e.type === "stage" && e.state === "done") stages.push(e.stage);
      if (e.type === "result") result = e.result;
      if (e.type === "error") error = e.message;
    }
  }
  return { result, error, stages, ms: Date.now() - started };
}

let models: AskResult["models"] | null = null;
const rows = [];
for (const q of questions) {
  process.stdout.write(`${q.id} … `);
  const { result, error, stages, ms } = await run(q.question);
  if (result) models = result.models;
  const retrieved = new Set(result?.passages.map((p) => p.id) ?? []);
  const groupsHit = q.must_retrieve.map((g) => g.some((id) => retrieved.has(id)));
  const retrievalHit = q.must_retrieve.length ? groupsHit.every(Boolean) : null;
  const statusOk = result?.status === q.expect;
  // Answers must be fully verified; abstentions must show no claims at all.
  const verificationOk = result
    ? result.status === "answer"
      ? result.verified && result.claims.every((c) => c.codeCheck === "pass" && c.modelCheck.verdict === "supported")
      : result.claims.length === 0
    : false;
  const expectedIds = new Set(q.must_retrieve.flat());
  const citesExpected = result?.status === "answer" ? result.claims.some((c) => c.passage_ids.some((id) => expectedIds.has(id))) : null;
  const pass = !error && statusOk && verificationOk && retrievalHit !== false;
  console.log(pass ? "PASS" : "FAIL", `${(ms / 1000).toFixed(1)}s`);
  rows.push({
    id: q.id,
    category: q.category,
    question: q.question,
    expect: q.expect,
    status: result?.status ?? "error",
    error,
    checks: { status: statusOk, retrieval: retrievalHit, verification: verificationOk, citesExpected },
    pass,
    attempts: result?.attempts.length ?? 0,
    abstainCause: result?.abstainCause ?? null,
    stages,
    seconds: Number((ms / 1000).toFixed(1)),
    queries: result?.queries ?? [],
    retrieved: result?.passages.map((p) => p.id) ?? [],
    claims: result?.claims.map((c) => ({ text: c.text, passage_ids: c.passage_ids, verifier: c.modelCheck.reason })) ?? [],
    abstain_reason: result?.abstain_reason ?? "",
    missing: result?.missing ?? "",
  });
}

const withRetrieval = rows.filter((r) => r.checks.retrieval !== null);
const answered = rows.filter((r) => r.status === "answer");
const summary = {
  passed: rows.filter((r) => r.pass).length,
  total: rows.length,
  retrievalHitRate: withRetrieval.filter((r) => r.checks.retrieval).length / Math.max(1, withRetrieval.length),
  abstentionAccuracy: rows.filter((r) => r.checks.status).length / rows.length,
  verifiedAnswerRate: answered.filter((r) => r.checks.verification).length / Math.max(1, answered.length),
  medianSeconds: [...rows.map((r) => r.seconds)].sort((a, b) => a - b)[Math.floor(rows.length / 2)],
};
const output = {
  runAt: new Date().toISOString(),
  baseUrl,
  models,
  summary,
  questions: rows,
};
writeFileSync("tests/results.json", JSON.stringify(output, null, 2) + "\n");

const yes = (v: boolean | null) => (v === null ? "  —  " : v ? " ✓  " : " ✗  ");
console.log("\n id   expect   got      status retrieval verified cites  result");
for (const r of rows) {
  console.log(
    ` ${r.id}  ${r.expect.padEnd(8)} ${r.status.padEnd(8)} ${yes(r.checks.status)}  ${yes(r.checks.retrieval)}    ${yes(r.checks.verification)}   ${yes(r.checks.citesExpected)} ${r.pass ? "PASS" : "FAIL"}  ${r.category}`
  );
}
console.log(
  `\nPassed ${summary.passed}/${summary.total} · retrieval hit rate ${(summary.retrievalHitRate * 100).toFixed(0)}% · abstention accuracy ${(summary.abstentionAccuracy * 100).toFixed(0)}% · verified answers ${(summary.verifiedAnswerRate * 100).toFixed(0)}% · median ${summary.medianSeconds}s`
);
console.log("Saved tests/results.json");

const nahl = loadCorpus().passages.find((p) => p.kind === "quran" && p.surah === 16 && p.ayah === 125);
if (nahl) console.log(`\nSurah An-Nahl 16:125, exact stored text (${nahl.sourceLabel}):\n${nahl.text}`);
else console.log("\nNo Quran source with 16:125 in sources/manifest.json.");
