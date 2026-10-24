// Scoring of one pipeline run against the (draft) curated expectations of a golden question,
// and the aggregate metrics used to compare v1 and v2. Pure functions, no I/O.

import { excerptAround } from "../../src/app/ui/excerpt.ts";

export interface GoldenQuestion {
  id: string;
  question: string;
  category: string;
  tags: string[];
  dorar?: "unavailable";
  expect: "answer" | "partial" | "abstain" | "out_of_scope";
  oos?: string;
  ayah: { expected: string[][]; required: boolean };
  books: Record<string, string[]>;
  hadith_expected: boolean;
  relevant: string[];
  not_relevant: string[];
  notes?: string;
}

interface PassageLike {
  id: string;
  sourceId: string;
  kind: string;
  text: string;
  grade?: string | null;
  authorStart?: number;
}
interface ClaimLike {
  text: string;
  passage_ids: string[];
  match?: { passage_id: string; start: number; end: number };
}
export interface ResultLike {
  status: "answer" | "abstain";
  verified: boolean;
  claims: ClaimLike[];
  passages: PassageLike[];
  attempts: { issues: string[] }[];
  abstainCause: string | null;
  /** v2 only: per-source status for every approved source */
  sourceStatus?: Record<string, string>;
}

export interface QuestionRun {
  id: string;
  question: string;
  pipeline: string;
  dorar: string;
  ms: number;
  error: string | null;
  result: ResultLike | null;
  events: { t: number; e: unknown }[];
  usage: { calls: number; input: number; cached: number; output: number; usd: number };
  score?: Score;
}

export const APPROVED_SOURCES = ["quran", "muyassar", "bayyinat", "usoul-eman", "shumoo-nahar", "raheeq", "dorar"];
/** Exact rulings counted as evidence until a qualified reviewer approves a wider whitelist. */
export const PROVISIONAL_WHITELIST = new Set(["صحيح", "حسن"]);

const EMPTY_ORNATE = /﴿[\s-]*﴾|[-]/;
const verseKey = (id: string) => id.replace(/^(quran|muyassar):/, "");

export interface Score {
  statusOk: boolean;
  falseAbstention: boolean;
  verified: boolean;
  claims: number;
  attempts: number;
  sourceStatusRecorded: boolean;
  bookRecall: Record<string, boolean>;
  ayahGroups: number;
  ayahGroupsInCandidates: number;
  ayahInAnswer: boolean | null;
  unexpectedAyahCited: string[];
  sourcesCited: string[];
  relevantCited: string[];
  notRelevantCited: string[];
  hadithCited: { id: string; grade: string | null; whitelisted: boolean }[];
  displayedEmptyMarkers: number;
  citedPassagesWithEmptyMarkers: number;
  timeToDraftMs: number | null;
}

export function scoreQuestion(q: GoldenQuestion, run: QuestionRun): Score {
  const r = run.result;
  const retrieved = new Set(r?.passages.map((p) => p.id) ?? []);
  const byId = new Map(r?.passages.map((p) => [p.id, p]) ?? []);
  const cited = new Set(r?.claims.flatMap((c) => c.passage_ids) ?? []);
  const wantAnswer = q.expect === "answer";
  const wantAbstain = q.expect === "abstain" || q.expect === "out_of_scope";
  const status = r?.status ?? null;

  const bookRecall: Record<string, boolean> = {};
  for (const [src, keys] of Object.entries(q.books)) if (keys.length) bookRecall[src] = keys.some((k) => retrieved.has(`${src}:${k}`));

  const groups = q.ayah.expected;
  const inCandidates = groups.filter((g) => g.some((k) => retrieved.has(`quran:${k}`) || retrieved.has(`muyassar:${k}`))).length;
  const expectedVerses = new Set(groups.flat());
  const citedVerses = [...cited].filter((id) => id.startsWith("quran:")).map(verseKey);

  const sourcesCited = [...new Set([...cited].map((id) => byId.get(id)?.sourceId ?? id.split(":")[0]))];

  let displayedEmptyMarkers = 0;
  for (const c of r?.claims ?? []) {
    if (!c.match) continue;
    const p = byId.get(c.match.passage_id);
    if (!p || p.kind === "quran") continue;
    const x = excerptAround(p.text, c.match.start, c.match.end);
    if (EMPTY_ORNATE.test(`${x.before}${x.quote}${x.after}`)) displayedEmptyMarkers++;
  }

  const drafting = run.events.find((ev) => (ev.e as { stage?: string }).stage === "drafting");
  return {
    statusOk: status !== null && (wantAnswer ? status === "answer" : wantAbstain ? status === "abstain" : true),
    falseAbstention: wantAnswer && status === "abstain",
    verified: !!r?.verified,
    claims: r?.claims.length ?? 0,
    attempts: r?.attempts.length ?? 0,
    sourceStatusRecorded: !!r?.sourceStatus && APPROVED_SOURCES.every((s) => s in r.sourceStatus!),
    bookRecall,
    ayahGroups: groups.length,
    ayahGroupsInCandidates: inCandidates,
    ayahInAnswer: q.ayah.required && status === "answer" ? citedVerses.some((v) => expectedVerses.has(v)) : null,
    unexpectedAyahCited: citedVerses.filter((v) => !expectedVerses.has(v)),
    sourcesCited,
    relevantCited: q.relevant.filter((s) => sourcesCited.includes(s)),
    notRelevantCited: q.not_relevant.filter((s) => sourcesCited.includes(s)),
    hadithCited: [...cited]
      .filter((id) => byId.get(id)?.kind === "hadith")
      .map((id) => {
        const grade = byId.get(id)?.grade ?? null;
        const ruling = grade?.split(" — ")[0].trim() ?? null;
        return { id, grade, whitelisted: !!ruling && PROVISIONAL_WHITELIST.has(ruling) };
      }),
    displayedEmptyMarkers,
    citedPassagesWithEmptyMarkers: [...cited].filter((id) => EMPTY_ORNATE.test(byId.get(id)?.text ?? "")).length,
    timeToDraftMs: drafting ? drafting.t : null,
  };
}

// ---------- v2 ----------

interface V2ResultLike {
  version: "v2";
  status: "answer" | "partial" | "abstain" | "out_of_scope";
  verified: boolean;
  summary: { blocks: V2BlockLike[]; verified: boolean } | null;
  sections: { blocks: V2BlockLike[]; verified: boolean }[];
  sources: { id: string; status: string }[];
  records: Record<string, { id: string; sourceId: string; kind: string; text: string; sentences: { id: string; start: number; end: number }[]; verseRefs: { start: number; end: number }[] }>;
  hadith: Record<string, { grade: string }>;
}
interface V2BlockLike {
  kind: string;
  text: string;
  cites: { type: string; recordId: string; sentenceIds: string[]; verse?: { surah: number; from: number; to: number }; dorarId?: string }[];
}

/** Score a v2 run with the same measures as v1, from its result and its local trace. */
export function scoreQuestionV2(q: GoldenQuestion, run: QuestionRun, trace: { candidates?: Record<string, { id: string }[]> } | null): Score & { statusV2: string; checksPassed: boolean; unresolvedMarkersInDisplayedSpans: number } {
  const r = run.result as unknown as V2ResultLike | null;
  const parts = r ? [...(r.summary ? [r.summary] : []), ...r.sections] : [];
  const claimBlocks = parts.flatMap((p) => p.blocks.filter((b) => b.kind === "claim"));
  const idsOf = (c: V2BlockLike["cites"][number]) => {
    if (c.type === "quran" && c.verse) {
      const out: string[] = [];
      for (let a = c.verse.from; a <= c.verse.to; a++) out.push(`quran:${c.verse.surah}:${a}`, ...(c.sentenceIds.length ? [`muyassar:${c.verse.surah}:${a}`] : []));
      return out;
    }
    if (c.type === "hadith") return [c.dorarId!];
    return [c.recordId];
  };
  const passages: PassageLike[] = [];
  for (const list of Object.values(trace?.candidates ?? {})) for (const c of list) passages.push({ id: c.id, sourceId: c.id.split(":")[0], kind: c.id.startsWith("quran:") ? "quran" : "text", text: "" });
  for (const rec of Object.values(r?.records ?? {})) if (!passages.some((p) => p.id === rec.id)) passages.push({ id: rec.id, sourceId: rec.sourceId, kind: rec.kind, text: rec.text });
  for (const [id, h] of Object.entries(r?.hadith ?? {})) passages.push({ id, sourceId: "dorar", kind: "hadith", text: "", grade: h.grade });
  const like: ResultLike = {
    status: r && (r.status === "answer" || r.status === "partial") ? "answer" : "abstain",
    verified: !!r?.verified,
    claims: claimBlocks.map((b) => ({ text: b.text, passage_ids: [...new Set(b.cites.flatMap(idsOf))] })),
    passages,
    attempts: [],
    abstainCause: null,
    sourceStatus: r ? Object.fromEntries(r.sources.map((s) => [s.id, s.status])) : undefined,
  };
  const base = scoreQuestion(q, { ...run, result: like });
  let unresolved = 0;
  for (const b of parts.flatMap((p) => p.blocks)) {
    for (const c of b.cites) {
      const rec = r?.records[c.recordId];
      if (!rec) continue;
      for (const sid of c.sentenceIds) {
        const s = rec.sentences.find((x) => x.id === sid);
        if (!s) continue;
        for (const m of rec.text.slice(s.start, s.end).matchAll(/﴿[\s-]*﴾/g)) {
          const at = s.start + m.index!;
          if (!rec.verseRefs.some((v) => at >= v.start && at < v.end)) unresolved++;
        }
      }
    }
  }
  // The v2 view replaces resolved markers with the verse and unresolved ones with a labelled placeholder.

  return {
    ...base,
    displayedEmptyMarkers: 0,
    statusV2: r?.status ?? "error",
    checksPassed: parts.length > 0 && parts.every((p) => p.verified),
    unresolvedMarkersInDisplayedSpans: unresolved,
    timeToDraftMs: run.events.find((ev) => (ev.e as { stage?: string; state?: string }).stage === "writing" && (ev.e as { state?: string }).state === "active")?.t ?? null,
  };
}

const pct = (n: number, d: number) => (d ? Number(((100 * n) / d).toFixed(1)) : null);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : null;
};

export function summarize(questions: GoldenQuestion[], runs: QuestionRun[]) {
  const qById = new Map(questions.map((q) => [q.id, q]));
  const scored = runs.filter((r) => r.score);
  const s = (r: QuestionRun) => r.score!;
  const answers = scored.filter((r) => r.result?.status === "answer");
  const expectAnswer = scored.filter((r) => qById.get(r.id)?.expect === "answer");
  const expectAbstain = scored.filter((r) => ["abstain", "out_of_scope"].includes(qById.get(r.id)?.expect ?? ""));
  const withAyah = scored.filter((r) => s(r).ayahGroups > 0);
  const ayahRequired = scored.filter((r) => qById.get(r.id)?.ayah.required && r.result?.status === "answer");
  const noAyahExpected = answers.filter((r) => (qById.get(r.id)?.ayah.expected.length ?? 0) === 0);

  const perSource: Record<string, { hits: number; total: number; recall: number | null }> = {};
  for (const r of scored)
    for (const [src, hit] of Object.entries(s(r).bookRecall)) {
      perSource[src] ??= { hits: 0, total: 0, recall: null };
      perSource[src].total++;
      if (hit) perSource[src].hits++;
    }
  const quranGroups = withAyah.reduce((n, r) => n + s(r).ayahGroups, 0);
  perSource["quran+muyassar (verse groups)"] = { hits: withAyah.reduce((n, r) => n + s(r).ayahGroupsInCandidates, 0), total: quranGroups, recall: null };
  for (const v of Object.values(perSource)) v.recall = pct(v.hits, v.total);
  const recalls = Object.values(perSource).filter((v) => v.total > 0).map((v) => v.recall ?? 0);

  const multiRelevant = answers.filter((r) => (qById.get(r.id)?.relevant.length ?? 0) >= 2);
  const lat = scored.map((r) => r.ms);
  const hadith = scored.flatMap((r) => s(r).hadithCited);
  return {
    questions: scored.length,
    errors: scored.filter((r) => r.error).length,
    decisionAccuracy: pct(scored.filter((r) => s(r).statusOk).length, scored.length),
    correctAbstention: pct(expectAbstain.filter((r) => ["abstain", "out_of_scope"].includes(String(r.result?.status))).length, expectAbstain.length),
    outOfScopeRecognized: pct(scored.filter((r) => qById.get(r.id)?.expect === "out_of_scope" && String(r.result?.status) === "out_of_scope").length, scored.filter((r) => qById.get(r.id)?.expect === "out_of_scope").length),
    falseAbstentions: expectAnswer.filter((r) => s(r).falseAbstention).map((r) => r.id),
    answered: answers.length,
    verifiedAnswers: pct(answers.filter((r) => r.result?.verified).length, answers.length),
    answersPassingAllChecks: pct(answers.filter((r) => (r.score as { checksPassed?: boolean }).checksPassed ?? r.result?.verified).length, answers.length),
    sourceStatusCoverage: pct(scored.filter((r) => s(r).sourceStatusRecorded).length, scored.length),
    retrievalRecallPerSource: perSource,
    retrievalRecallMacro: recalls.length ? Number((recalls.reduce((a, b) => a + b, 0) / recalls.length).toFixed(1)) : null,
    expectedAyahRecallInCandidates: pct(withAyah.filter((r) => s(r).ayahGroupsInCandidates === s(r).ayahGroups).length, withAyah.length),
    ayahInAnswerWhenRequired: pct(ayahRequired.filter((r) => s(r).ayahInAnswer).length, ayahRequired.length),
    answersWithAyahWhereNoneExpected: noAyahExpected.filter((r) => s(r).unexpectedAyahCited.length).map((r) => r.id),
    unexpectedAyahCitations: answers.flatMap((r) => s(r).unexpectedAyahCited.map((v) => `${r.id}:${v}`)),
    drawsOnTwoRelevantSources: pct(multiRelevant.filter((r) => s(r).relevantCited.length >= 2).length, multiRelevant.length),
    notRelevantSourceAppearances: answers.flatMap((r) => s(r).notRelevantCited.map((x) => `${r.id}:${x}`)),
    claimsPerAnswer: answers.length ? Number((answers.reduce((n, r) => n + s(r).claims, 0) / answers.length).toFixed(2)) : null,
    hadithCited: hadith.length,
    hadithNotWhitelisted: hadith.filter((h) => !h.whitelisted).length,
    displayedEmptyMarkers: scored.reduce((n, r) => n + s(r).displayedEmptyMarkers, 0),
    citedPassagesWithEmptyMarkers: scored.reduce((n, r) => n + s(r).citedPassagesWithEmptyMarkers, 0),
    latencyMedianS: median(lat) !== null ? Number((median(lat)! / 1000).toFixed(1)) : null,
    latencyP95S: p95(lat) !== null ? Number((p95(lat)! / 1000).toFixed(1)) : null,
    timeToVerifiedSummaryMedianS: (() => {
      const t = answers.map((r) => ((r.result as unknown as { timings?: { summaryReady?: number } })?.timings?.summaryReady ?? r.ms));
      return median(t) !== null ? Number((median(t)! / 1000).toFixed(1)) : null;
    })(),
    usd: Number(scored.reduce((n, r) => n + r.usage.usd, 0).toFixed(4)),
    usdPerQuestion: scored.length ? Number((scored.reduce((n, r) => n + r.usage.usd, 0) / scored.length).toFixed(4)) : null,
    tokens: {
      input: scored.reduce((n, r) => n + r.usage.input, 0),
      cached: scored.reduce((n, r) => n + r.usage.cached, 0),
      output: scored.reduce((n, r) => n + r.usage.output, 0),
    },
  };
}
