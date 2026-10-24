// Mutation test for the v2 support reviewer: takes claims that passed in a v2 eval run, attaches
// wrong citations on purpose, and measures how many the semantic review rejects. Passing claims
// with their own citations are re-reviewed as a control. Output: local/eval/runs/<run>/mutation-v2.json.
//
// Mutations:
//   cross       a claim cited with a passing citation from a different question (clearly unrelated)
//   swap        a claim cited with another claim's citation in the same answer (different evidence)
//   objection   the asker's question or objection sentence asserted as a claim, cited to the author's answer
//   neighbour   a Bayyinat citation moved to the next Q&A item
//   related     a claim cited with a shortlisted record of the same question that no claim cites
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON eval/mutation-v2.ts <run label>

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installUsageTracking, loadLocalEnv, usage } from "./lib/usage.ts";

const label = process.argv[2];
if (!label) throw new Error("pass the v2 run label");
const dir = path.join("local", "eval", "runs", label);
loadLocalEnv();
installUsageTracking(`${label}-mutation-v2`);
const { loadV2Index } = await import("../src/lib/v2/corpus-v2.ts");
const { semanticReview, settle } = await import("../src/lib/v2/verify.ts");
type CheckedItem = import("../src/lib/v2/verify.ts").CheckedItem;
type ResolvedCite = import("../src/lib/v2/verify.ts").ResolvedCite;
const index = loadV2Index();

interface Q {
  id: string;
  question: string;
  claims: { text: string; cites: ResolvedCite[] }[];
  shortlist: string[];
}
const qs: Q[] = [];
for (const f of readdirSync(dir).filter((x) => /^g\d+\.json$/.test(x)).sort()) {
  const run = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  const r = run.result;
  if (!r || r.version !== "v2") continue;
  const parts = [...(r.summary ? [r.summary] : []), ...r.sections];
  const claims = parts.flatMap((p: { blocks: { kind: string; text: string; cites: ResolvedCite[] }[] }) => p.blocks.filter((b) => b.kind === "claim").map((b) => ({ text: b.text, cites: b.cites })));
  const tf = r.traceId ? path.join("local", "traces", `${r.traceId}.json`) : "";
  const trace = tf && existsSync(tf) ? JSON.parse(readFileSync(tf, "utf8")) : {};
  const shortlist = Object.values((trace.shortlists ?? {}) as Record<string, string[]>).flat();
  if (claims.length) qs.push({ id: run.id, question: run.question, claims, shortlist });
}

const authorSentences = (recordId: string, n = 3) => (index.records.get(recordId)?.sentences ?? []).filter((s) => s.speaker === "author").slice(0, n).map((s) => s.id);
const mk = (text: string, cite: ResolvedCite): CheckedItem => ({ kind: "claim", text, cites: [cite], mechanical: [], review: [], passed: false });

type Item = { qid: string; type: string; item: CheckedItem };
const items: Item[] = [];
qs.forEach((q, qi) => {
  const other = qs[(qi + Math.ceil(qs.length / 2)) % qs.length];
  q.claims.forEach((c, i) => {
    items.push({ qid: q.id, type: "control", item: { kind: "claim", text: c.text, cites: c.cites, mechanical: [], review: [], passed: false } });
    const oc = other.claims[i % other.claims.length]?.cites[0];
    if (oc && other.id !== q.id) items.push({ qid: q.id, type: "cross", item: mk(c.text, oc) });
    const j = q.claims.findIndex((x, k) => k !== i && !x.cites.some((y) => c.cites.some((z) => z.recordId === y.recordId)));
    if (j >= 0) items.push({ qid: q.id, type: "swap", item: mk(c.text, q.claims[j].cites[0]) });
    const bay = c.cites.find((x) => x.recordId.startsWith("bayyinat:"));
    if (bay) {
      const rec = index.records.get(bay.recordId)!;
      const obj = rec.sentences.find((s) => s.speaker === "quoted_objection" && s.end - s.start > 40) ?? rec.sentences.find((s) => s.speaker === "quoted_question" && s.end - s.start > 40);
      // Asserted as plain fact (without "the asker holds that …"), cited to the author's answer.
      if (obj) {
        const asserted = rec.text
          .slice(obj.start, obj.end)
          .replace(/^(السؤال|مضمونُ? ?السؤال:?)\s*/, "")
          .replace(/^صاحبُ? هذا السؤالِ? (يَرَى|يرى|يزعم|يدَّعي|يدعي) (أنه|أن)\s*/, "");
        items.push({ qid: q.id, type: "objection", item: mk(asserted, bay) });
      }
      const n = Number(bay.recordId.split(":")[1]) + 1;
      const next = `bayyinat:${n}`;
      if (index.records.has(next)) items.push({ qid: q.id, type: "neighbour", item: mk(c.text, { ...bay, recordId: next, sentenceIds: authorSentences(next) }) });
    }
    const used = new Set(q.claims.flatMap((x) => x.cites.map((y) => y.recordId)));
    const rel = q.shortlist.find((id) => !used.has(id) && !id.startsWith("quran:") && index.records.get(id)?.kind === "book");
    if (rel && i % 2 === 0) items.push({ qid: q.id, type: "related", item: mk(c.text, { evidence: "R", type: "book", recordId: rel, sentenceIds: authorSentences(rel) }) });
  });
});

// Review per question (with that question's text), in batches of about 12 pairs, as the pipeline
// reviews one answer part at a time.
let done = 0;
for (const q of qs) {
  const own = items.filter((x) => x.qid === q.id);
  for (let k = 0; k < own.length; k += 12) {
    if (usage.rateLimited) break;
    const batch = own.slice(k, k + 12);
    await semanticReview(q.question, batch.map((b) => b.item), index, new Map());
    batch.forEach((b) => settle(b.item));
    done += batch.length;
    process.stdout.write(`${done}/${items.length} `);
  }
}

const stats: Record<string, { n: number; rejected: number; rate: number | null }> = {};
for (const it of items) {
  stats[it.type] ??= { n: 0, rejected: 0, rate: null };
  stats[it.type].n++;
  if (!it.item.passed) stats[it.type].rejected++;
}
for (const s of Object.values(stats)) s.rate = s.n ? Number(((100 * s.rejected) / s.n).toFixed(1)) : null;
const mutated = items.filter((x) => x.type !== "control");
const summary = {
  mutations: mutated.length,
  rejectionRate: mutated.length ? Number(((100 * mutated.filter((x) => !x.item.passed).length) / mutated.length).toFixed(1)) : null,
  byType: stats,
  usd: Number(usage.usd.toFixed(4)),
};
writeFileSync(path.join(dir, "mutation-v2.json"), JSON.stringify({ summary, items: items.map((x) => ({ qid: x.qid, type: x.type, text: x.item.text, cites: x.item.cites.map((c) => c.recordId), passed: x.item.passed, review: x.item.review })) }, null, 1));
console.log("\n" + JSON.stringify(summary, null, 1));
