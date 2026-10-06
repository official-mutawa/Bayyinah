// Question -> retrieval -> grounded draft -> verification. Emits real stage events.

import { BM25 } from "./bm25.ts";
import { findQuote, normalizeMapped } from "./arabic.ts";
import { loadCorpus, loadManifest, sourceGroup } from "./corpus.ts";
import { dorarId } from "./dorar-parse.ts";
import type { DorarItem } from "./dorar-parse.ts";
import type { Passage, PassageKind } from "./corpus.ts";
import { chatModel, embed, embedModel, structuredResponse } from "./openai.ts";
import { VectorStore } from "./vectors.ts";

// ---------- Types shared with the UI ----------

export type StageId = "rewriting" | "search" | "drafting" | "verifying" | "redrafting";

export interface StageSource {
  id: string;
  label: string;
  kind: PassageKind;
}

export type PipelineEvent =
  | {
      type: "stage";
      stage: StageId;
      state: "active" | "done";
      /** For "search": which source group is being searched */
      source?: StageSource;
      /** Shown instead of a count when a source could not be reached */
      note?: string;
      queries?: string[];
      count?: number;
      passed?: number;
      total?: number;
    }
  | { type: "result"; result: AskResult }
  | { type: "error"; message: string };

export interface RetrievedPassage extends Passage {
  /** Which searches found it: keyword (BM25) and/or meaning (embeddings) */
  via: ("keyword" | "meaning")[];
}

export interface ClaimResult {
  text: string;
  passage_ids: string[];
  supporting_quote: string;
  /** Span of the quote inside the stored text of `passage_id` */
  match: { passage_id: string; start: number; end: number };
  codeCheck: "pass";
  modelCheck: { verdict: "supported"; reason: string };
}

export interface AttemptLog {
  attempt: number;
  status: "answer" | "abstain";
  claims: number;
  issues: string[];
  verdicts: { claim: string; verdict: "supported" | "not_supported"; reason: string }[];
}

export interface AskResult {
  status: "answer" | "abstain";
  claims: ClaimResult[];
  abstain_reason: string;
  missing: string;
  /** True only when every claim passed both the code check and the model check */
  verified: boolean;
  /** Why we abstained: the model chose to, or verification failed twice */
  abstainCause: "model" | "verification" | null;
  queries: string[];
  passages: RetrievedPassage[];
  attempts: AttemptLog[];
  models: { chat: string; embed: string };
  ms: number;
}

// ---------- Index (built once per server instance) ----------

interface SourceIndex extends StageSource {
  ids: string[];
  bm25: BM25;
}

interface Index {
  byId: Map<string, Passage>;
  /** 5-word skeleton windows of every Quran verse */
  quranWindows: Set<string>;
  hasDorar: boolean;
  /** One searchable part per source, Quran first, then hadith, then other texts */
  sources: SourceIndex[];
  vectors: VectorStore;
}

const KIND_ORDER: Record<PassageKind, number> = { quran: 0, tafsir: 1, hadith: 2, text: 3 };

let indexPromise: Promise<Index> | null = null;

export function getIndex(): Promise<Index> {
  indexPromise ??= Promise.resolve().then(() => {
    const { passages, sources } = loadCorpus();
    const quranWindows = new Set<string>();
    for (const p of passages) if (p.kind === "quran") for (const w of wordWindows(p.text, 5)) quranWindows.add(w);
    const vectors = new VectorStore();
    const missing = passages.filter((p) => !vectors.has(p.id)).length;
    if (missing) throw new Error(`${missing} passages have no embedding; run the ingest script`);
    return {
      byId: new Map(passages.map((p) => [p.id, p])),
      quranWindows,
      hasDorar: loadManifest().some((m) => m.live && m.kind === "hadith"),
      sources: [...sources]
        .filter((s) => !s.live && !s.excluded)
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
        .map((s) => {
          const own = passages.filter((p) => p.sourceId === s.id);
          // Book passages are long: let the question title weigh in keyword search (index only, display unchanged).
          const searchText = (p: Passage) => (p.kind === "text" ? `${p.refLabel} ${p.refLabel} ${p.text.slice(0, 5000)}` : p.text);
          return { id: s.id, label: s.label, kind: s.kind, ids: own.map((p) => p.id), bm25: new BM25(own.map(searchText)) };
        }),
      vectors,
    };
  });
  indexPromise.catch(() => (indexPromise = null));
  return indexPromise;
}

// ---------- Step 1: query rewriting ----------

function rewriteInstructions(sources: StageSource[]): string {
  return `You turn a question into Arabic search queries for a library containing: ${sources.map((s) => s.label).join("، ")}.
Return 2 or 3 short queries (2 to 8 words each) in Arabic. Use words likely to appear in those texts, including classical synonyms of the question's key terms.
Do not add assumptions, positions, people, places or facts the user did not state. Do not answer the question.`;
}

async function rewrite(question: string, sources: StageSource[]): Promise<string[]> {
  const out = await structuredResponse<{ queries: string[] }>({
    name: "search_queries",
    instructions: rewriteInstructions(sources),
    input: question,
    maxOutputTokens: 2000,
    timeoutMs: 30000,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["queries"],
      properties: { queries: { type: "array", items: { type: "string" } } },
    },
  });
  return out.queries.map((q) => q.trim()).filter(Boolean).slice(0, 3);
}

// ---------- Step 2: hybrid retrieval ----------

const RRF_K = 60;
const LIST_DEPTH = 20;
const FINAL_COUNT = 10;
const DORAR_COUNT = 3;
const MIN_PER_SOURCE = 2;

type Ranked = { scores: Map<string, number>; via: Map<string, Set<"keyword" | "meaning">> };

function fuse(lists: { ids: string[]; via: "keyword" | "meaning" }[]): Ranked {
  const scores = new Map<string, number>();
  const via = new Map<string, Set<"keyword" | "meaning">>();
  for (const list of lists) {
    list.ids.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
      if (!via.has(id)) via.set(id, new Set());
      via.get(id)!.add(list.via);
    });
  }
  return { scores, via };
}

function searchCorpus(
  part: { ids: string[]; bm25: BM25 },
  vectors: VectorStore,
  queries: string[],
  queryVectors: Float32Array[]
): Ranked {
  const lists: { ids: string[]; via: "keyword" | "meaning" }[] = [];
  queries.forEach((q, i) => {
    lists.push({ ids: part.bm25.search(q, LIST_DEPTH).map(([d]) => part.ids[d]), via: "keyword" });
    lists.push({ ids: vectors.search(queryVectors[i], part.ids, LIST_DEPTH).map(([id]) => id), via: "meaning" });
  });
  return fuse(lists);
}

function select(index: Index, ranked: Ranked[]): RetrievedPassage[] {
  const score = new Map<string, number>();
  const via = new Map<string, Set<"keyword" | "meaning">>();
  for (const r of ranked) {
    r.scores.forEach((s, id) => score.set(id, s));
    r.via.forEach((v, id) => via.set(id, v));
  }
  const byScore = (a: string, b: string) => (score.get(b) ?? 0) - (score.get(a) ?? 0);
  const picked: string[] = [];
  // Reserve a few places for each source, then fill by fused score across sources.
  const reserve = Math.max(1, Math.min(MIN_PER_SOURCE, Math.floor(FINAL_COUNT / Math.max(1, ranked.length))));
  for (const r of ranked) picked.push(...[...r.scores.keys()].sort(byScore).slice(0, reserve));
  for (const id of [...score.keys()].sort(byScore)) {
    if (picked.length >= FINAL_COUNT) break;
    if (!picked.includes(id)) picked.push(id);
  }
  const out: RetrievedPassage[] = picked.sort(byScore).map((id) => ({
    ...index.byId.get(id)!,
    via: [...(via.get(id) ?? [])].sort() as ("keyword" | "meaning")[],
  }));
  // A tafsir passage brings the verse it explains (Quran text always from the Quran source).
  for (const p of [...out]) {
    for (const v of p.kind === "tafsir" ? (p.verses ?? []) : []) {
      const q = index.byId.get(`quran:${v}`);
      if (q && !out.some((x) => x.id === q.id)) out.push({ ...q, via: p.via });
    }
  }
  return out;
}

// ---------- Step 3: grounded draft ----------

interface Draft {
  status: "answer" | "abstain";
  claims: { text: string; passage_ids: string[]; supporting_quote: string }[];
  abstain_reason: string;
  missing: string;
}

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "claims", "abstain_reason", "missing"],
  properties: {
    status: { type: "string", enum: ["answer", "abstain"] },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "passage_ids", "supporting_quote"],
        properties: {
          text: { type: "string" },
          passage_ids: { type: "array", items: { type: "string" } },
          supporting_quote: { type: "string" },
        },
      },
    },
    abstain_reason: { type: "string" },
    missing: { type: "string" },
  },
};

const DRAFT_INSTRUCTIONS = `You draft short Arabic answers for a Muslim daʿi (caller to Islam) who is in a live conversation with a non-Muslim and was asked a hard question. The daʿi reviews your draft before using it. You are not a mufti and this is never a fatwa.

You receive the QUESTION and PASSAGES from the approved library (Quran verses, hadith, and other approved texts), each with an id and its type. Use ONLY these passages. Do not use outside knowledge, tafsir, history, or scholars' opinions that the passages do not state.

To answer, set status "answer":
- Write 1 to 5 claims. Each claim is ONE short sentence in calm, clear Modern Standard Arabic that the daʿi can relay.
- passage_ids: only ids from PASSAGES that directly support the claim. Prefer one passage per claim; list the passage containing the quote first.
- supporting_quote: copy character for character a contiguous span of 3 to 20 words from the first cited passage that supports the claim. Keep its spelling and diacritics exactly; do not join separate places; do not add words.
- Quran wording comes only from passages of type آية; hadith only from passages of type حديث. In تفسير and نص passages, quote the author's own explanatory words, never a verse or hadith quoted inside them.
- In نص passages, text before the line "[[ما سبق عرض للسؤال أو الشبهة، وليس قول المؤلف]]" states a question or an opponent's claim: never present it as the author's position and never quote it as support.
- Never write Quran text inside a claim: do not quote, paraphrase or restate the wording of a verse. Refer to it instead, for example "تبيّن الآية أن ..." or "تنهى الآية عن ...". The app shows the stored verse text itself.
- Attribute words to the Prophet ﷺ, a companion, a scholar or an author only when the passage itself attributes them.
- No fatwa, no ruling for a personal case, no claim of consensus (never say أجمع العلماء), no statements about what scholars hold, no judgment on anyone's fate.
- abstain_reason must be "". missing is "" unless part of the question is not covered by the passages; then name that part briefly.

Abstain (status "abstain", claims []) when:
- the passages do not clearly and directly answer the question, or only touch it loosely;
- answering needs interpretation, a fiqh ruling, or historical context that the passages do not state;
- the asker wants a fatwa for a specific personal situation;
- the question is a major issue that scholars dispute;
- the question asks for a judgment on a specific person or group (for example who is in Paradise or Hell).
When abstaining: abstain_reason is one or two calm Arabic sentences explaining why; missing says in Arabic what evidence or expertise would be needed. Never accuse the asker of bad intent.`;

function formatPassages(passages: RetrievedPassage[]): string {
  return passages
    .map((p) => {
      const type = p.kind === "quran" ? "آية" : p.kind === "tafsir" ? "تفسير" : p.kind === "hadith" ? "حديث" : "نص";
      const label = `${type} — ${p.refLabel}${p.grade ? ` — ${p.grade}` : ""}`;
      let body = p.text;
      if (p.authorStart !== undefined && p.authorStart > 0)
        body = `${body.slice(0, p.authorStart)}\n[[ما سبق عرض للسؤال أو الشبهة، وليس قول المؤلف]]\n${body.slice(p.authorStart)}`;
      const text = body.length > 6000 ? `${body.slice(0, 6000)} …` : body;
      return `[${p.id}] (${label})\n${text}`;
    })
    .join("\n\n");
}

async function draft(question: string, passages: RetrievedPassage[], feedback: string | null): Promise<Draft> {
  let input = `QUESTION:\n${question}\n\nPASSAGES:\n${formatPassages(passages)}`;
  if (feedback) input += `\n\nYOUR PREVIOUS DRAFT FAILED THESE CHECKS. Fix every issue, drop claims you cannot support exactly, or abstain:\n${feedback}`;
  return structuredResponse<Draft>({
    name: "grounded_answer",
    instructions: DRAFT_INSTRUCTIONS,
    input,
    schema: DRAFT_SCHEMA,
    effort: "medium",
    maxOutputTokens: 12000,
    timeoutMs: 90000,
  });
}

// ---------- Step 4: code checks ----------

interface CheckedClaim {
  claim: Draft["claims"][number];
  issues: string[];
  match: ClaimResult["match"] | null;
}

function wordWindows(text: string, size: number): Set<string> {
  const words = normalizeMapped(text, true).text.split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

function codeCheck(d: Draft, passages: RetrievedPassage[], quranWindows: Set<string>): CheckedClaim[] {
  const byId = new Map(passages.map((p) => [p.id, p]));
  return d.claims.map((claim) => {
    const issues: string[] = [];
    let match: CheckedClaim["match"] = null;
    if (!claim.text.trim()) issues.push("empty claim text");
    if (!claim.passage_ids.length) issues.push("no passage cited");
    const unknown = claim.passage_ids.filter((id) => !byId.has(id));
    if (unknown.length) issues.push(`cites passages that were not retrieved: ${unknown.join(", ")}`);
    for (const id of claim.passage_ids) {
      const p = byId.get(id);
      if (!p) continue;
      const span = findQuote(p.text, claim.supporting_quote);
      if (span && !match) match = { passage_id: id, ...span };
    }
    if (!match) issues.push("supporting_quote does not appear in any cited passage; copy it exactly");
    const mp = match ? byId.get(match.passage_id) : undefined;
    if (match && mp?.authorStart !== undefined && match.start < mp.authorStart)
      issues.push("supporting_quote is taken from the question or opponent's claim, not from the author's answer");
    if (mp && mp.kind !== "quran" && [...wordWindows(claim.supporting_quote, 5)].some((w) => quranWindows.has(w)))
      issues.push("supporting_quote is Quran wording taken from a non-Quran passage; cite the verse from an آية passage instead");
    // The model must not write verse wording itself.
    const claimWindows = wordWindows(claim.text, 4);
    for (const id of claim.passage_ids) {
      const p = byId.get(id);
      if (p?.kind !== "quran") continue;
      if ([...wordWindows(p.text, 4)].some((w) => claimWindows.has(w))) {
        issues.push(`claim text repeats wording of ${id}; refer to the verse instead of quoting it`);
      }
    }
    return { claim, issues, match };
  });
}

// ---------- Step 5: second model check ----------

const VERIFY_INSTRUCTIONS = `You are a strict verifier. Each item has one claim (Arabic) and the full text of the passages it cites.
For each item decide only whether those passages, read on their own, support the claim.
"supported": the passages state it or directly entail it, without outside knowledge, interpretation or added detail.
"not_supported": anything else, including claims that go beyond, generalize, or add to what the passages say.
Give a short reason in Arabic (one sentence). Return one result per item, in the same order, with its claim_index.`;

async function verify(
  claims: Draft["claims"],
  byId: Map<string, Passage>
): Promise<{ claim_index: number; verdict: "supported" | "not_supported"; reason: string }[]> {
  const items = claims.map((c, i) => ({
    claim_index: i,
    claim: c.text,
    passages: c.passage_ids.map((id) => byId.get(id)).filter(Boolean).map((p) => ({ id: p!.id, reference: p!.refLabel, text: p!.text })),
  }));
  const out = await structuredResponse<{ results: { claim_index: number; verdict: "supported" | "not_supported"; reason: string }[] }>({
    name: "claim_verification",
    instructions: VERIFY_INSTRUCTIONS,
    input: JSON.stringify(items),
    effort: "low",
    maxOutputTokens: 6000,
    timeoutMs: 60000,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["claim_index", "verdict", "reason"],
            properties: {
              claim_index: { type: "integer" },
              verdict: { type: "string", enum: ["supported", "not_supported"] },
              reason: { type: "string" },
            },
          },
        },
      },
    },
  });
  return out.results;
}

// ---------- Orchestration ----------

function stageSources(index: Index): StageSource[] {
  const info: StageSource[] = index.sources.map(({ id, label, kind }) => ({ id, label, kind }));
  if (index.hasDorar) info.push({ id: "dorar", label: "الدرر السنية", kind: "hadith" });
  return info;
}

/** Step 1 on its own, for /api/queries. */
export async function rewriteQuestion(question: string): Promise<string[]> {
  return rewrite(question, stageSources(await getIndex()));
}

export interface AskOptions {
  /** Queries already produced by /api/queries (skips the rewriting call) */
  queries?: string[];
  /** Hadith found by the user's browser on Dorar, exactly as returned */
  hadith?: DorarItem[];
  /** The browser could not reach Dorar */
  hadithFailed?: boolean;
}

function hadithPassage(h: DorarItem): RetrievedPassage {
  return {
    id: dorarId(h),
    sourceId: "dorar",
    kind: "hadith",
    sourceLabel: "الدرر السنية — الموسوعة الحديثية",
    refLabel: [h.book, h.locator].filter(Boolean).join("، ") || "الدرر السنية",
    text: h.text,
    grade: h.grade ? `${h.grade}${h.muhaddith ? ` — ${h.muhaddith}` : ""}` : null,
    via: ["keyword"],
  };
}

export async function ask(question: string, emit: (e: PipelineEvent) => void, opts: AskOptions = {}): Promise<AskResult> {
  const started = Date.now();
  const index = await getIndex();

  let rewritten: string[];
  if (opts.queries?.length) {
    rewritten = opts.queries;
  } else {
    emit({ type: "stage", stage: "rewriting", state: "active" });
    rewritten = await rewrite(question, stageSources(index));
    emit({ type: "stage", stage: "rewriting", state: "done", queries: rewritten });
  }
  const queries = [question, ...rewritten.filter((q) => q !== question)];

  const queryVectors = await embed(queries, 30000);

  // Search every source (fast, in memory), choose the evidence set, then report per source
  // how many of its passages were kept, so "found 4 verses" is literally true.
  const ranked = index.sources.map((part) => searchCorpus(part, index.vectors, queries, queryVectors));
  const local = select(index, ranked);
  const groupOf = new Map(index.sources.map((p) => [p.id, sourceGroup(p)]));

  // 1. Quran and tafsir: count the verses covered (directly or through their tafsir).
  const quranStage: StageSource = { id: "quran", label: "القرآن والتفسير", kind: "quran" };
  emit({ type: "stage", stage: "search", state: "active", source: quranStage });
  const verses = new Set<string>();
  for (const p of local) {
    if (groupOf.get(p.sourceId) !== "quran") continue;
    if (p.kind === "quran") verses.add(`${p.surah}:${p.ayah}`);
    for (const v of p.verses ?? []) verses.add(v);
  }
  emit({ type: "stage", stage: "search", state: "done", source: quranStage, count: verses.size });

  // 2. Hadith: searched on Dorar by the user's browser (JSONP), passed in exactly as returned.
  const hadith: RetrievedPassage[] = (opts.hadith ?? []).slice(0, DORAR_COUNT).map(hadithPassage);
  if (index.hasDorar && (opts.hadith || opts.hadithFailed)) {
    const hadithStage: StageSource = { id: "dorar", label: "الحديث (الدرر السنية)", kind: "hadith" };
    emit({ type: "stage", stage: "search", state: "active", source: hadithStage });
    if (opts.hadithFailed && !hadith.length)
      emit({ type: "stage", stage: "search", state: "done", source: hadithStage, count: 0, note: "تعذر الوصول لمصدر الحديث" });
    else emit({ type: "stage", stage: "search", state: "done", source: hadithStage, count: hadith.length });
  }

  // 3. Books on doubts and creed.
  if (index.sources.some((p) => sourceGroup(p) === "books")) {
    const booksStage: StageSource = { id: "books", label: "كتب الشبهات والعقيدة", kind: "text" };
    emit({ type: "stage", stage: "search", state: "active", source: booksStage });
    emit({ type: "stage", stage: "search", state: "done", source: booksStage, count: local.filter((p) => groupOf.get(p.sourceId) === "books").length });
  }

  const passages = [...local, ...hadith];
  const attempts: AttemptLog[] = [];
  let feedback: string | null = null;

  const base = {
    queries: rewritten,
    passages,
    attempts,
    models: { chat: chatModel(), embed: embedModel() },
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const stage: StageId = attempt === 1 ? "drafting" : "redrafting";
    emit({ type: "stage", stage, state: "active" });
    const d = await draft(question, passages, feedback);
    emit({ type: "stage", stage, state: "done" });

    if (d.status === "abstain" || d.claims.length === 0) {
      attempts.push({ attempt, status: "abstain", claims: 0, issues: [], verdicts: [] });
      return {
        ...base,
        status: "abstain",
        claims: [],
        abstain_reason: d.abstain_reason || "لا تكفي النصوص المسترجعة للإجابة عن هذا السؤال.",
        missing: d.missing,
        verified: false,
        abstainCause: "model",
        ms: Date.now() - started,
      };
    }

    emit({ type: "stage", stage: "verifying", state: "active" });
    const checked = codeCheck(d, passages, index.quranWindows);
    const verdicts = await verify(d.claims, new Map(passages.map((p) => [p.id, p])));
    const log: AttemptLog = { attempt, status: "answer", claims: d.claims.length, issues: [], verdicts: [] };
    const problems: string[] = [];
    checked.forEach((c, i) => {
      const v = verdicts.find((r) => r.claim_index === i);
      log.verdicts.push({ claim: c.claim.text, verdict: v?.verdict ?? "not_supported", reason: v?.reason ?? "لم يُرجِع المدقق حكمًا" });
      for (const issue of c.issues) problems.push(`Claim ${i + 1}: ${issue}`);
      if (v?.verdict !== "supported") problems.push(`Claim ${i + 1}: verifier says not supported by its passages (${v?.reason ?? "no verdict"})`);
    });
    log.issues = problems;
    attempts.push(log);
    const passed = checked.filter((c, i) => !c.issues.length && log.verdicts[i].verdict === "supported").length;
    emit({ type: "stage", stage: "verifying", state: "done", passed, total: checked.length });

    if (!problems.length) {
      return {
        ...base,
        status: "answer",
        claims: checked.map((c, i) => ({
          ...c.claim,
          match: c.match!,
          codeCheck: "pass",
          modelCheck: { verdict: "supported", reason: log.verdicts[i].reason },
        })),
        abstain_reason: "",
        missing: d.missing,
        verified: true,
        abstainCause: null,
        ms: Date.now() - started,
      };
    }
    feedback = problems.join("\n");
  }

  return {
    ...base,
    status: "abstain",
    claims: [],
    abstain_reason: "لم نتمكن من التحقق من أن كل جملة في المسودة مدعومة بنصها، فلم نعرض إجابة.",
    missing: "نصوص أوضح دلالة على السؤال، أو مراجعة مختص.",
    verified: false,
    abstainCause: "verification",
    ms: Date.now() - started,
  };
}
