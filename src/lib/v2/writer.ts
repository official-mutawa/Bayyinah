// Stage 5: writing by reference. The writer composes its own calm Arabic sentences from evidence
// cards and cites them by evidence id and sentence number. It never pastes source text: verses,
// hadith and quotations are structured blocks the system renders from the stored records.

import { normalizeMapped, standardSpelling } from "../arabic.ts";
import { V2_MODELS } from "./config.ts";
import { openaiStructured, type CallMeta } from "./llm.ts";
import type { Card, OutlineSection } from "./evidence.ts";
import type { HadithEvidence } from "./hadith.ts";
import type { V2Index } from "./corpus-v2.ts";
import type { Plan } from "./planner.ts";

export interface Cite {
  evidence: string;
  sentences: number[];
}

export interface DraftItem {
  kind: "claim" | "quran" | "hadith" | "quote";
  text: string;
  cites: Cite[];
}

export interface Draft {
  summary: DraftItem[];
  sections: { sub_question: string; heading: string; items: DraftItem[] }[];
  gaps: { sub_question: string; text: string }[];
}

const ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text", "cites"],
  properties: {
    kind: { type: "string", enum: ["claim", "quran", "hadith", "quote"] },
    text: { type: "string" },
    cites: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["evidence", "sentences"], properties: { evidence: { type: "string" }, sentences: { type: "array", items: { type: "integer" } } } },
    },
  },
};

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sections", "gaps"],
  properties: {
    summary: { type: "array", items: ITEM },
    sections: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["sub_question", "heading", "items"], properties: { sub_question: { type: "string" }, heading: { type: "string" }, items: { type: "array", items: ITEM } } },
    },
    gaps: { type: "array", items: { type: "object", additionalProperties: false, required: ["sub_question", "text"], properties: { sub_question: { type: "string" }, text: { type: "string" } } } },
  },
};

export const WRITER_RULES = `You draft an answer for a Muslim daʿi in a live conversation with a non-Muslim. It is a draft the daʿi reviews; never a fatwa. Use ONLY the EVIDENCE given. No outside knowledge, tafsir, history or scholars' opinions.

Output:
- summary: 2 to 4 claims a daʿi can say at once.
- sections: one per sub-question that has evidence, in the outline's order, each with a short heading and items.
- gaps: for each sub-question without adequate evidence, one calm sentence saying the approved sources reviewed do not answer it (e.g. «لم أجد في المصادر المعتمدة ما يجيب عن: …»).

Items:
- kind "claim": text is ONE atomic statement in your own calm Modern Standard Arabic (split compound sentences), faithful to what the cited sentences say, no more. cites: the evidence ids and the exact S/T sentence numbers that support it. Every claim needs at least one cite.
- kind "quran": a block that shows a verse; text ""; cites: [{evidence: the quran evidence id, sentences: []}]. Put it at the start of its section when the outline marks the verse as strong direct evidence.
- kind "hadith": a block that shows a hadith with its ruling; text ""; cites the hadith evidence id.
- kind "quote": a block that shows the author's exact sentences; text ""; cites one book evidence id with the sentence numbers. Only for evidence marked quotable, and only when the wording itself is valuable.

Hard rules:
- Never write Quran wording inside a claim: do not quote, paraphrase or restate a verse; refer to it ("تبيّن الآية أن …") using what its tafsir sentences say. Never write hadith text yourself; use a hadith block.
- Never attribute words to the Prophet ﷺ, a companion, a scholar or an author unless the cited sentence attributes them.
- A hadith quoted inside a book or tafsir is not hadith evidence: never write "the Sunnah/hadith states …" from it. Say what the author says («يذكر المؤلف أن …»). Only a hadith evidence item (from Dorar, with its ruling) may be presented as a hadith.
- Never present a question or objection as the author's view. Never combine two sources into a statement neither makes alone.
- No fatwa, no ruling for a personal case, no claim of consensus (never «أجمع العلماء» or «بالإجماع»), no statement about what scholars hold unless a cited sentence states it, no judgment on anyone's fate. Never accuse the asker of bad intent.
- If approved sources differ in scope or appear to disagree, present each with its citation; do not reconcile them yourself.
- Words between ⟦ ⟧ in tafsir sentences are the verse's own wording: never repeat them in a claim.
- Each claim must stand on its own (do not start it with «و» or «ثم», and do not refer to an earlier claim), because a claim that fails verification is removed.
- Do not pad. Do not fill gaps with general knowledge.
- Write in the answer language given (Arabic unless told otherwise); evidence stays as cited.`;

/** Wrap runs of three or more tafsir words that repeat the verse's own wording in ⟦ ⟧ (writer view only). */
export function markVerseWords(tafsir: string, verse: string): string {
  const key = (w: string) => normalizeMapped(standardSpelling(w), true).text;
  const verseWords = verse.split(/\s+/).map(key).filter(Boolean);
  const tokens = tafsir.split(/(\s+)/);
  const words = tokens.map((t, i) => ({ t, i, k: /\S/.test(t) ? key(t) : "" })).filter((x) => x.k);
  const inVerse = (from: number, len: number) => {
    const seq = words.slice(from, from + len).map((x) => x.k).join(" ");
    for (let j = 0; j + len <= verseWords.length; j++) if (verseWords.slice(j, j + len).join(" ") === seq) return true;
    return false;
  };
  const mark = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    let len = 0;
    while (i + len < words.length && inVerse(i, len + 1)) len++;
    if (len >= 3) for (let k = i; k < i + len; k++) mark.add(words[k].i);
  }
  let out = "";
  let open = false;
  tokens.forEach((t, i) => {
    if (mark.has(i) && !open) {
      out += "⟦";
      open = true;
    }
    if (!mark.has(i) && open && /\S/.test(t)) {
      out = out.replace(/\s+$/, (s) => `⟧${s}`);
      open = false;
    }
    out += t;
  });
  return open ? `${out}⟧` : out;
}

function renderCard(c: Card, index: V2Index, hadith: Map<string, HadithEvidence>): string {
  const role = { dalil: "دليل مباشر", sharh: "شرح", mithal: "مثال أو سياق تاريخي", radd: "رد على شبهة", none: "" }[c.role];
  const head = `[${c.id}] (${role}، ${c.strength === "strong" ? "قوي" : "جزئي"})`;
  if (c.type === "quran" && c.verse) {
    const ref = index.records.get(`quran:${c.verse.surah}:${c.verse.from}`)!.refLabel + (c.verse.to > c.verse.from ? ` إلى ${c.verse.to}` : "");
    let verseText = "";
    for (let a = c.verse.from; a <= c.verse.to; a++) verseText += ` ${index.records.get(`quran:${c.verse.surah}:${a}`)?.text ?? ""}`;
    const lines = (c.tafsirSentenceIds ?? []).map((sid) => {
      const recId = sid.replace(/:s\d+$/, "");
      const t = index.records.get(recId)!;
      const s = t.sentences.find((x) => x.id === sid)!;
      return `  T${s.n}: ${markVerseWords(t.text.slice(s.start, s.end), verseText)}`;
    });
    return `${head} آية: ${ref} — معناها من التفسير الميسر (ما بين ⟦ ⟧ ألفاظ الآية نفسها: لا تكررها):\n${lines.join("\n")}`;
  }
  if (c.type === "hadith") {
    const h = hadith.get(c.dorarId!)!;
    return `${head} حديث — ${h.book}${h.locator ? `، ${h.locator}` : ""} — الحكم: ${h.grade} (${h.muhaddith})\n  S1: ${h.text}`;
  }
  const rec = index.records.get(c.recordId)!;
  const lines = c.sentenceIds.map((sid) => {
    const s = rec.sentences.find((x) => x.id === sid)!;
    return `  S${s.n}: ${rec.text.slice(s.start, s.end)}`;
  });
  return `${head} ${rec.refLabel}${rec.quotable ? "" : " (نص مستخرج ضوئيًا: لا يُقتبس حرفيًا)"}\n${lines.join("\n")}`;
}

export function renderEvidence(outline: OutlineSection[], index: V2Index, hadith: Map<string, HadithEvidence>): string {
  return outline
    .map((sec) => `## ${sec.subQuestion}: ${sec.text}\n${sec.cards.length ? sec.cards.map((c) => renderCard(c, index, hadith)).join("\n\n") : "(لا أدلة كافية)"}`)
    .join("\n\n");
}

export async function writeDraft(question: string, plan: Plan, outline: OutlineSection[], index: V2Index, hadith: Map<string, HadithEvidence>): Promise<{ draft: Draft; meta: CallMeta }> {
  const lang = plan.answer_language === "en" ? "English" : plan.answer_language === "ar" ? "Arabic" : "the language of the question";
  const input = `QUESTION: ${question}\nANSWER LANGUAGE: ${lang}\nCOVERAGE CHECKLIST:\n${plan.coverage_checklist.map((x) => `- ${x}`).join("\n")}\n\nOUTLINE AND EVIDENCE:\n${renderEvidence(outline, index, hadith)}`;
  // Restrict sub-question fields to the plan's ids.
  const ids = plan.sub_questions.map((q) => q.id);
  const schema = JSON.parse(JSON.stringify(DRAFT_SCHEMA));
  schema.properties.sections.items.properties.sub_question = { type: "string", enum: ids };
  schema.properties.gaps.items.properties.sub_question = { type: "string", enum: ids };
  const evidenceIds = [...new Set(outline.flatMap((s) => s.cards.map((c) => c.id)))];
  if (evidenceIds.length) {
    const citeEnum = { type: "string", enum: evidenceIds };
    schema.properties.summary.items.properties.cites.items.properties.evidence = citeEnum;
    schema.properties.sections.items.properties.items.items.properties.cites.items.properties.evidence = citeEnum;
  }
  const { data, meta } = await openaiStructured<Draft>({
    name: "answer_draft",
    schema,
    instructions: WRITER_RULES,
    input,
    model: V2_MODELS.writer(),
    effort: "low",
    maxOutputTokens: 12000,
    timeoutMs: 120000,
  });
  return { draft: data, meta };
}
