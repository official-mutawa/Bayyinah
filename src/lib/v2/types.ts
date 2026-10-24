// v2 data model: records (parents), sentences with exact offsets and speaker, child chunks for
// retrieval, and linked evidence (verse references, quoted hadith). Text is stored exactly as
// extracted; everything else points into it by offsets.

import type { VerseRef } from "./verse-refs.ts";

export type Speaker = "author" | "quoted_question" | "quoted_objection" | "quoted_other";
export type SourceKind = "quran" | "tafsir" | "hadith" | "book";

export interface Sentence {
  /** `${recordId}:s${n}` */
  id: string;
  n: number;
  start: number;
  end: number;
  speaker: Speaker;
}

export interface V2Record {
  id: string;
  sourceId: string;
  kind: SourceKind;
  /** Item title (Bayyinat question), section heading, or surah name */
  title: string;
  /** Citation line shown to users */
  refLabel: string;
  number?: number;
  page?: number | null;
  surah?: number;
  ayah?: number;
  /** Verse keys this record explains (tafsir) */
  verses?: string[];
  /** Exactly as stored or extracted */
  text: string;
  ocr?: boolean;
  /** False for OCR text until a human review of samples against page images passes */
  quotable: boolean;
  sections: { start: number; end: number; speaker: Speaker; label: string }[];
  sentences: Sentence[];
  verseRefs: VerseRef[];
  /** Hadith quoted by the author: never hadith evidence unless matched to a whitelisted Dorar record */
  quotedHadith: { start: number; end: number; matched: null }[];
  /** Verse markers with no readable verse text */
  emptyMarkers: { start: number; end: number }[];
}

export interface V2Child {
  /** `${recordId}:c${k}` */
  id: string;
  recordId: string;
  sourceId: string;
  start: number;
  end: number;
  sentenceIds: string[];
  speaker: Speaker | "mixed";
}

export interface V2Corpus {
  version: string;
  builtAt: string;
  sources: { id: string; kind: SourceKind; label: string; records: number; children: number; ocr?: boolean; quotable: boolean }[];
  records: V2Record[];
  children: V2Child[];
  /** recordId -> verse keys cited by resolved references */
  verseGraph: Record<string, string[]>;
}
