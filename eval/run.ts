// Eval harness: runs a frozen question set through a pipeline version, one question at a time,
// and writes per-question traces, summary.json and report.md under local/eval/runs/<label>/
// (gitignored: outputs contain book text). Tracks tokens and cost per question and stops on any
// rate limit, so runs cannot starve the live site that shares the key.
//
// Usage:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON eval/run.ts --set local/eval/golden/dev.json \
//     [--pipeline v1] [--label name] [--only g01,g02] [--dorar unavailable|cache|absent]
//
// --dorar: how hadith reach the pipeline. "unavailable" (default) matches the live site today, where
// the browser's JSONP call to Dorar fails; "cache" replays Dorar results saved by the browser under
// local/eval/dorar-cache/<id>.json; "absent" sends nothing (like the old tests/run.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installUsageTracking, ledgerTotal, loadLocalEnv, usage } from "./lib/usage.ts";
import { scoreQuestion, scoreQuestionV2, summarize, type GoldenQuestion, type QuestionRun } from "./lib/score.ts";
import { renderReport } from "./lib/report.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const setFile = args.get("set");
if (!setFile) throw new Error("--set <question file> is required");
const pipeline = args.get("pipeline") ?? "v1";
const dorarMode = (args.get("dorar") ?? "unavailable") as "unavailable" | "cache" | "absent";
const only = new Set((args.get("only") ?? "").split(",").filter(Boolean));
const label = args.get("label") ?? `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${pipeline}-${path.basename(setFile, ".json")}`;
const outDir = path.join("local", "eval", "runs", label);
mkdirSync(outDir, { recursive: true });

loadLocalEnv();
installUsageTracking(label);
const { ask } = await import("../src/lib/pipeline.ts");
const { chatModel, embedModel } = await import("../src/lib/openai.ts");
type DorarItem = import("../src/lib/dorar-parse.ts").DorarItem;

const { questions } = JSON.parse(readFileSync(setFile, "utf8")) as { questions: GoldenQuestion[] };
const runs: QuestionRun[] = [];

for (const q of questions) {
  if (only.size && !only.has(q.id)) continue;
  if (usage.rateLimited) {
    console.log("Stopped: rate limit hit; remaining questions skipped.");
    break;
  }
  const mark = usage.calls.length;
  const started = Date.now();
  const events: { t: number; e: unknown }[] = [];
  const opts: { hadith?: DorarItem[]; hadithFailed?: boolean; queries?: string[] } = {};
  const dorar = q.dorar === "unavailable" ? "unavailable" : dorarMode;
  if (dorar === "unavailable") opts.hadithFailed = true;
  if (dorar === "cache") {
    const f = path.join("local", "eval", "dorar-cache", `${q.id}.json`);
    if (existsSync(f)) {
      const c = JSON.parse(readFileSync(f, "utf8")) as { queries: string[]; items: DorarItem[]; failed: boolean };
      opts.queries = c.queries;
      opts.hadith = c.items;
      opts.hadithFailed = c.failed;
    } else opts.hadithFailed = true;
  }
  process.stdout.write(`${q.id} … `);
  let result = null;
  let error: string | null = null;
  let trace: { candidates?: Record<string, { id: string }[]> } | null = null;
  try {
    if (pipeline === "v2") {
      const { askV2 } = await import("../src/lib/v2/pipeline-v2.ts");
      const r = await askV2(q.question, (e) => events.push({ t: Date.now() - started, e: e.type === "part" ? { type: "part", id: e.part.id } : e }), { hadith: opts.hadith, hadithFailed: opts.hadithFailed });
      result = r as unknown as typeof result;
      const tf = r.traceId ? path.join("local", "traces", `${r.traceId}.json`) : "";
      trace = tf && existsSync(tf) ? JSON.parse(readFileSync(tf, "utf8")) : null;
    } else result = await ask(q.question, (e) => events.push({ t: Date.now() - started, e }), opts);
  } catch (e) {
    error = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 300);
  }
  const run: QuestionRun = {
    id: q.id,
    question: q.question,
    pipeline,
    dorar,
    ms: Date.now() - started,
    error,
    result,
    events,
    usage: usage.since(mark),
  };
  run.score = pipeline === "v2" ? scoreQuestionV2(q, run, trace) : scoreQuestion(q, run);
  runs.push(run);
  writeFileSync(path.join(outDir, `${q.id}.json`), JSON.stringify(run, null, 1));
  console.log(`${result?.status ?? "error"} ${(run.ms / 1000).toFixed(1)}s $${run.usage.usd.toFixed(4)}${error ? ` (${error})` : ""}`);
}

const summary = summarize(questions, runs);
const meta = {
  label,
  pipeline,
  setFile,
  dorarMode,
  models: { chat: chatModel(), embed: embedModel() },
  runAt: new Date().toISOString(),
  usd: Number(usage.usd.toFixed(4)),
  rateLimited: usage.rateLimited,
  ledgerTotal: ledgerTotal(),
};
writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ meta, summary }, null, 1));
writeFileSync(path.join(outDir, "report.md"), renderReport(meta, summary, runs));
console.log(`\nSaved ${outDir}. This run: $${meta.usd}. All local runs so far: $${meta.ledgerTotal.usd} in ${meta.ledgerTotal.calls} calls.`);
