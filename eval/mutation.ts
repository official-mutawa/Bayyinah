// Mutation test for the support reviewer: takes verified answers from an eval run, builds wrong
// citations on purpose, and measures how many the reviewer rejects. Unmutated claims are sent too
// as a control. Outputs go to local/eval/runs/<run>/mutation.json (gitignored).
//
// Mutations:
//   swap        claim i cited with claim j's passages (different first passage)
//   objection   the asker's question/objection from a Bayyinat item asserted as the author's view
//   neighbour   a Bayyinat citation moved to the next Q&A item
//   related     a claim cited with another retrieved passage of the same answer that no claim cites
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON eval/mutation.ts <run label> [--pipeline v1]

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installUsageTracking, loadLocalEnv, usage } from "./lib/usage.ts";
import type { QuestionRun } from "./lib/score.ts";

const label = process.argv[2];
if (!label) throw new Error("pass the run label, e.g. baseline-v1-dev");
const dir = path.join("local", "eval", "runs", label);
loadLocalEnv();
installUsageTracking(`${label}-mutation`);
const P = await import("../src/lib/pipeline.ts");
const index = await P.getIndex();
type Passage = import("../src/lib/corpus.ts").Passage;

interface Item {
  qid: string;
  type: "control" | "swap" | "objection" | "neighbour" | "related";
  claim: { text: string; passage_ids: string[]; supporting_quote: string };
}

/** First sentence of the question part of a Bayyinat item (the asker's wording, not the author's). */
function objectionSentence(p: Passage): string | null {
  if (p.sourceId !== "bayyinat" || !p.authorStart) return null;
  const q = p.text.slice(0, p.authorStart);
  const at = q.indexOf("السؤال");
  if (at < 0) return null;
  const s = q.slice(at + "السؤال".length).trim().split(/[.؟?!؛\n]/)[0].trim();
  return s.length >= 20 ? s : null;
}

const items: Item[] = [];
const runs = readdirSync(dir).filter((f) => /^g\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as QuestionRun);
for (const run of runs) {
  const r = run.result as unknown as { status: string; verified: boolean; claims: { text: string; passage_ids: string[]; supporting_quote: string }[]; passages: Passage[] } | null;
  if (!r || r.status !== "answer" || !r.verified) continue;
  const claims = r.claims;
  const cited = new Set(claims.flatMap((c) => c.passage_ids));
  claims.forEach((c) => items.push({ qid: run.id, type: "control", claim: c }));
  for (let i = 0; i < claims.length; i++) {
    const j = claims.findIndex((x, k) => k !== i && x.passage_ids[0] !== claims[i].passage_ids[0] && !x.passage_ids.some((id) => claims[i].passage_ids.includes(id)));
    if (j >= 0) items.push({ qid: run.id, type: "swap", claim: { ...claims[i], passage_ids: claims[j].passage_ids } });
  }
  for (const id of cited) {
    const p = index.byId.get(id);
    if (!p) continue;
    const obj = objectionSentence(p);
    if (obj) items.push({ qid: run.id, type: "objection", claim: { text: obj, passage_ids: [id], supporting_quote: "" } });
    if (p.sourceId === "bayyinat") {
      const next = index.sources.find((s) => s.id === "bayyinat")!.ids.find((x) => Number(index.byId.get(x)!.number) > Number(p.number));
      const c = claims.find((x) => x.passage_ids.includes(id));
      if (next && c) items.push({ qid: run.id, type: "neighbour", claim: { ...c, passage_ids: [next] } });
    }
  }
  const uncited = r.passages.filter((p) => !cited.has(p.id) && p.kind !== "quran");
  claims.forEach((c, i) => {
    const alt = uncited[i % Math.max(1, uncited.length)];
    if (alt) items.push({ qid: run.id, type: "related", claim: { ...c, passage_ids: [alt.id] } });
  });
}

// Review per question, as v1 does (one call per answer), with full passages from the index.
const verdicts: (Item & { verdict: string; reason: string })[] = [];
const byQ = new Map<string, Item[]>();
for (const it of items) byQ.set(it.qid, [...(byQ.get(it.qid) ?? []), it]);
for (const [qid, list] of byQ) {
  if (usage.rateLimited) break;
  const byId = new Map<string, Passage>();
  for (const it of list) for (const id of it.claim.passage_ids) if (index.byId.has(id)) byId.set(id, index.byId.get(id)!);
  try {
    const res = await P.verify(list.map((x) => x.claim), byId);
    list.forEach((it, i) => {
      const v = res.find((x) => x.claim_index === i);
      verdicts.push({ ...it, verdict: v?.verdict ?? "missing", reason: v?.reason ?? "" });
    });
  } catch (e) {
    list.forEach((it) => verdicts.push({ ...it, verdict: "error", reason: (e as Error).message.slice(0, 120) }));
  }
  process.stdout.write(`${qid} `);
}

const stats: Record<string, { n: number; rejected: number; rate: number | null }> = {};
for (const v of verdicts) {
  stats[v.type] ??= { n: 0, rejected: 0, rate: null };
  stats[v.type].n++;
  if (v.verdict !== "supported") stats[v.type].rejected++;
}
for (const s of Object.values(stats)) s.rate = s.n ? Number(((100 * s.rejected) / s.n).toFixed(1)) : null;
const mutated = verdicts.filter((v) => v.type !== "control");
const summary = {
  mutations: mutated.length,
  rejected: mutated.filter((v) => v.verdict !== "supported").length,
  rejectionRate: mutated.length ? Number(((100 * mutated.filter((v) => v.verdict !== "supported").length) / mutated.length).toFixed(1)) : null,
  byType: stats,
  usd: Number(usage.usd.toFixed(4)),
};
writeFileSync(path.join(dir, "mutation.json"), JSON.stringify({ summary, verdicts }, null, 1));
console.log("\n" + JSON.stringify(summary, null, 1));
