// Side-by-side metrics of eval runs (reads summary.json files; prints Markdown).
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON eval/compare.ts baseline-v1-dev v2-dev2 [more runs…]

import { readFileSync } from "node:fs";
import path from "node:path";

const labels = process.argv.slice(2);
const runs = labels.map((l) => JSON.parse(readFileSync(path.join("local", "eval", "runs", l, "summary.json"), "utf8")) as { meta: Record<string, unknown>; summary: Record<string, unknown> });
const keys = [
  "questions",
  "errors",
  "decisionAccuracy",
  "correctAbstention",
  "outOfScopeRecognized",
  "falseAbstentions",
  "answered",
  "verifiedAnswers",
  "answersPassingAllChecks",
  "sourceStatusCoverage",
  "retrievalRecallMacro",
  "expectedAyahRecallInCandidates",
  "ayahInAnswerWhenRequired",
  "answersWithAyahWhereNoneExpected",
  "drawsOnTwoRelevantSources",
  "notRelevantSourceAppearances",
  "claimsPerAnswer",
  "hadithCited",
  "hadithNotWhitelisted",
  "displayedEmptyMarkers",
  "latencyMedianS",
  "latencyP95S",
  "timeToVerifiedSummaryMedianS",
  "usd",
  "usdPerQuestion",
];
const fmt = (v: unknown) => (Array.isArray(v) ? (v.length ? `${v.length}: ${v.join(", ")}` : "0") : v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
console.log(`| Metric | ${labels.join(" | ")} |`);
console.log(`| --- | ${labels.map(() => "---").join(" | ")} |`);
for (const k of keys) console.log(`| ${k} | ${runs.map((r) => fmt(r.summary[k])).join(" | ")} |`);
const per = runs.map((r) => r.summary.retrievalRecallPerSource as Record<string, { recall: number | null; hits: number; total: number }>);
const srcs = [...new Set(per.flatMap((p) => Object.keys(p ?? {})))];
for (const s of srcs) console.log(`| recall ${s} | ${per.map((p) => (p?.[s] ? `${p[s].recall}% (${p[s].hits}/${p[s].total})` : "—")).join(" | ")} |`);
