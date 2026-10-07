// Build the v2 corpus (gitignored, data/v2/corpus.json): records with sentences and speaker,
// child chunks for retrieval, verse references, quoted hadith, and the verse-citation graph.
// Inputs: the approved sources as v1 loads them, plus data/v2/books/bayyinat.records.json.
// No model is called and no source text is changed.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/v2/build-records.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "../../src/lib/corpus.ts";
import { arabicDigits } from "../../src/lib/arabic.ts";
import { buildQuranInfo, emptyMarkers, findVerseRefs } from "../../src/lib/v2/verse-refs.ts";
import type { Speaker, V2Child, V2Corpus, V2Record } from "../../src/lib/v2/types.ts";
import { findQuotedHadith } from "../../src/lib/v2/hadith-in-books.ts";
import { recordChildren, recordSentences } from "../../src/lib/v2/records.ts";

const BAYYINAT_V2 = "data/v2/books/bayyinat.records.json";
if (!existsSync(BAYYINAT_V2)) throw new Error(`Run scripts/v2/extract-bayyinat.ts first (${BAYYINAT_V2} missing)`);

const { passages, sources } = loadCorpus();
const quranPassages = passages.filter((p) => p.kind === "quran");
const info = buildQuranInfo(quranPassages.map((p) => ({ surah: p.surah!, ayah: p.ayah!, surahName: p.surahName ?? "", text: p.text })));

const quotedHadith = findQuotedHadith;

const sentencesFor = recordSentences;
const childrenFor = recordChildren;

const records: V2Record[] = [];
const label = new Map(sources.map((s) => [s.id, s]));

// Quran: one record per verse, text exactly as stored (including the BOM the source carries).
for (const p of quranPassages) {
  records.push({
    id: p.id,
    sourceId: "quran",
    kind: "quran",
    title: p.surahName ?? "",
    refLabel: `سورة ${p.surahName}، الآية ${arabicDigits(p.ayah!)}`,
    surah: p.surah,
    ayah: p.ayah,
    text: p.text,
    quotable: true,
    sections: [{ start: 0, end: p.text.length, speaker: "author", label: "آية" }],
    sentences: [{ id: `${p.id}:s1`, n: 1, start: 0, end: p.text.length, speaker: "author" }],
    verseRefs: [],
    quotedHadith: [],
    emptyMarkers: [],
  });
}

// Al-Muyassar: one record per verse, linked to it.
for (const p of passages.filter((x) => x.sourceId === "muyassar")) {
  const sections = [{ start: 0, end: p.text.length, speaker: "author" as Speaker, label: "تفسير" }];
  records.push({
    id: p.id,
    sourceId: "muyassar",
    kind: "tafsir",
    title: `${p.surah}:${p.ayah}`,
    refLabel: `التفسير الميسر، ${arabicDigits(p.surah!)}:${arabicDigits(p.ayah!)}`,
    surah: p.surah,
    ayah: p.ayah,
    verses: p.verses,
    text: p.text,
    quotable: true,
    sections,
    sentences: sentencesFor(p.id, p.text, sections, []),
    verseRefs: [],
    quotedHadith: [],
    emptyMarkers: [],
  });
}

// Bayyinat: v2 records (one per question, with speaker sections).
const bay = JSON.parse(readFileSync(BAYYINAT_V2, "utf8")) as { records: { id: string; number: number; title: string; page: number | null; text: string; sections: V2Record["sections"] }[] };
for (const b of bay.records) {
  const hadith = quotedHadith(b.text);
  records.push({
    id: b.id,
    sourceId: "bayyinat",
    kind: "book",
    title: b.title,
    refLabel: `بينات، المسألة ${arabicDigits(b.number)}: ${b.title}${b.page ? `، ص ${arabicDigits(b.page)}` : ""}`,
    number: b.number,
    page: b.page,
    text: b.text,
    quotable: true,
    sections: b.sections,
    sentences: sentencesFor(b.id, b.text, b.sections, hadith),
    verseRefs: findVerseRefs(b.text, info),
    quotedHadith: hadith,
    emptyMarkers: emptyMarkers(b.text),
  });
}

// Page-based books (text layer or OCR): one record per page, as v1 extracted them.
for (const sid of ["usoul-eman", "shumoo-nahar", "raheeq"]) {
  const s = label.get(sid);
  if (!s) continue;
  for (const p of passages.filter((x) => x.sourceId === sid)) {
    const sections = [{ start: 0, end: p.text.length, speaker: "author" as Speaker, label: "نص" }];
    const hadith = quotedHadith(p.text);
    records.push({
      id: p.id,
      sourceId: sid,
      kind: "book",
      title: p.refLabel,
      refLabel: p.refLabel,
      number: p.number ? Number(p.number) : undefined,
      page: p.page ?? null,
      text: p.text,
      ocr: s.ocr || undefined,
      quotable: !s.ocr,
      sections,
      sentences: sentencesFor(p.id, p.text, sections, hadith),
      verseRefs: findVerseRefs(p.text, info),
      quotedHadith: hadith,
      emptyMarkers: emptyMarkers(p.text),
    });
  }
}

const children: V2Child[] = records.filter((r) => r.kind === "book" || r.kind === "tafsir").flatMap(childrenFor);
const verseGraph: Record<string, string[]> = {};
for (const r of records) {
  const keys = new Set<string>();
  for (const v of r.verseRefs) if (v.status === "resolved" && v.surah && v.from && v.to) for (let a = v.from; a <= v.to; a++) keys.add(`${v.surah}:${a}`);
  if (keys.size) verseGraph[r.id] = [...keys];
}

const sourceIds = ["quran", "muyassar", "bayyinat", "usoul-eman", "shumoo-nahar", "raheeq"];
const corpus: V2Corpus = {
  version: "v2.0",
  builtAt: new Date().toISOString(),
  sources: sourceIds.map((id) => ({
    id,
    kind: records.find((r) => r.sourceId === id)?.kind ?? "book",
    label: label.get(id)?.label ?? id,
    records: records.filter((r) => r.sourceId === id).length,
    children: children.filter((c) => c.sourceId === id).length,
    ocr: label.get(id)?.ocr || undefined,
    quotable: !label.get(id)?.ocr,
  })),
  records,
  children,
  verseGraph,
};
mkdirSync("data/v2", { recursive: true });
writeFileSync("data/v2/corpus.json", JSON.stringify(corpus));

// Review log for verse references that were not resolved (local, gitignored).
mkdirSync("local/v2", { recursive: true });
const review = records.flatMap((r) =>
  r.verseRefs.filter((v) => v.status !== "resolved" || v.digitAlternative).map((v) => ({ record: r.id, status: v.status, digitAlternative: v.digitAlternative, reason: v.reason, ref: v.refText, surah: v.surah, from: v.from, to: v.to }))
);
writeFileSync("local/v2/verse-refs-review.jsonl", review.map((x) => JSON.stringify(x)).join("\n") + "\n");

const refs = records.flatMap((r) => r.verseRefs.map((v) => ({ ...v, sourceId: r.sourceId })));
const stat = (sid: string) => {
  const rs = refs.filter((v) => v.sourceId === sid);
  const recs = records.filter((r) => r.sourceId === sid);
  const markers = recs.reduce((n, r) => n + r.emptyMarkers.length, 0);
  const markersLinked = recs.reduce((n, r) => n + r.emptyMarkers.filter((m) => r.verseRefs.some((v) => v.status === "resolved" && v.marker && v.marker.start === m.start)).length, 0);
  return {
    references: rs.length,
    resolved: rs.filter((v) => v.status === "resolved").length,
    resolvedWithDigitAlternative: rs.filter((v) => v.status === "resolved" && v.digitAlternative).length,
    ambiguous: rs.filter((v) => v.status === "ambiguous").length,
    failed: rs.filter((v) => v.status === "failed").length,
    emptyMarkers: markers,
    emptyMarkersLinkedToResolvedRef: markersLinked,
    quotedHadith: recs.reduce((n, r) => n + r.quotedHadith.length, 0),
    sentences: recs.reduce((n, r) => n + r.sentences.length, 0),
    sentencesNotAuthor: recs.reduce((n, r) => n + r.sentences.filter((s) => s.speaker !== "author").length, 0),
  };
};
console.log(JSON.stringify({ sources: corpus.sources, bayyinat: stat("bayyinat"), usoul: stat("usoul-eman"), shumoo: stat("shumoo-nahar"), raheeq: stat("raheeq"), graphRecords: Object.keys(verseGraph).length, reviewLog: review.length }, null, 1));
