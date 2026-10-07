// Re-score a saved eval run with the current scoring code (no model calls).
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON eval/rescore.ts <run label> <question set file>

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scoreQuestion, scoreQuestionV2, summarize, type GoldenQuestion, type QuestionRun } from "./lib/score.ts";
import { renderReport } from "./lib/report.ts";

const [label, setFile] = process.argv.slice(2);
const dir = path.join("local", "eval", "runs", label);
const { questions } = JSON.parse(readFileSync(setFile, "utf8")) as { questions: GoldenQuestion[] };
const byId = new Map(questions.map((q) => [q.id, q]));
const runs: QuestionRun[] = [];
for (const f of readdirSync(dir).filter((x) => /^g\d+\.json$/.test(x)).sort()) {
  const run = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as QuestionRun;
  const q = byId.get(run.id);
  if (!q) continue;
  const r = run.result as unknown as { version?: string; traceId?: string } | null;
  if (r?.version === "v2") {
    const tf = r.traceId ? path.join("local", "traces", `${r.traceId}.json`) : "";
    run.score = scoreQuestionV2(q, run, tf && existsSync(tf) ? JSON.parse(readFileSync(tf, "utf8")) : null);
  } else run.score = scoreQuestion(q, run);
  runs.push(run);
}
const old = JSON.parse(readFileSync(path.join(dir, "summary.json"), "utf8"));
const summary = summarize(questions.filter((q) => runs.some((r) => r.id === q.id)), runs);
writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ meta: { ...old.meta, rescoredAt: new Date().toISOString() }, summary }, null, 1));
writeFileSync(path.join(dir, "report.md"), renderReport(old.meta, summary, runs));
console.log(`rescored ${runs.length} questions in ${label}`);
