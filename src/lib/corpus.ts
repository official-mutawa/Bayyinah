// Loads passages from the approved sources listed in sources/manifest.json.
// Source files are read exactly as stored; nothing here writes to them.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ADAPTERS } from "./adapters.ts";
import type { FieldMap, SourceFormat } from "./adapters.ts";

export type PassageKind = "quran" | "hadith" | "text";

export interface SourceInfo {
  /** Id prefix for passages, lowercase letters, digits and dashes */
  id: string;
  kind: PassageKind;
  /** Arabic display name, e.g. "القرآن الكريم" */
  label: string;
  format: SourceFormat;
  /** File name inside sources/ */
  file: string;
  /** Optional SHA-256 of the file; verified when present */
  sha256?: string;
  /** Expected passage count; for kind "quran" it defaults to 6236 */
  expectedCount?: number;
  /** Attribution line shown in the UI footer and README */
  attribution: string;
  /** Notice that must accompany the text, if the license requires one */
  notice?: string;
  license: string;
  url?: string;
  /** Version, edition, commit or date of the copy used */
  version?: string;
  fields?: FieldMap;
  split?: string;
}

export interface Passage {
  /** `${sourceId}:${key}`, e.g. quran:16:125 */
  id: string;
  sourceId: string;
  kind: PassageKind;
  sourceLabel: string;
  refLabel: string;
  surah?: number;
  surahName?: string;
  ayah?: number;
  number?: string;
  /** Display text exactly as stored in the source file */
  text: string;
  /** Grade as given in the data, or null when the data has none */
  grade: string | null;
}

export const QURAN_VERSES = 6236;

export function manifestPath(): string {
  return path.join(process.cwd(), "sources", "manifest.json");
}

export function loadManifest(): SourceInfo[] {
  const file = manifestPath();
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8")) as { sources?: SourceInfo[] };
  return data.sources ?? [];
}

function readSource(file: string): Buffer {
  return readFileSync(path.join(process.cwd(), "sources", file));
}

export interface SourceReport {
  id: string;
  label: string;
  kind: PassageKind;
  count: number;
  sha256: string;
  version?: string;
}

/** Load all passages and run the integrity checks. Throws with every problem found. */
export function loadCorpus(options: { verifyHashes?: boolean } = {}): { passages: Passage[]; sources: SourceInfo[]; report: SourceReport[] } {
  const sources = loadManifest();
  if (!sources.length) throw new Error("No sources: add approved files and sources/manifest.json (see sources/README.md)");
  const errors: string[] = [];
  const passages: Passage[] = [];
  const report: SourceReport[] = [];
  const sourceIds = new Set<string>();

  for (const s of sources) {
    const where = `source "${s.id}"`;
    if (!/^[a-z0-9-]+$/.test(s.id ?? "")) errors.push(`${where}: id must be lowercase letters, digits or dashes`);
    if (sourceIds.has(s.id)) errors.push(`${where}: duplicate source id`);
    sourceIds.add(s.id);
    if (!["quran", "hadith", "text"].includes(s.kind)) errors.push(`${where}: kind must be quran, hadith or text`);
    if (!(s.format in ADAPTERS)) errors.push(`${where}: unknown format "${s.format}"`);
    if (!s.label || !s.attribution || !s.license) errors.push(`${where}: label, attribution and license are required`);
    if (!s.file || !existsSync(path.join(process.cwd(), "sources", s.file))) {
      errors.push(`${where}: file not found in sources/: ${s.file}`);
      continue;
    }
    if (!(s.format in ADAPTERS)) continue;

    const bytes = readSource(s.file);
    const sha256 = options.verifyHashes || s.sha256 ? createHash("sha256").update(bytes).digest("hex") : "";
    if (s.sha256 && sha256 !== s.sha256) errors.push(`${where}: ${s.file} does not match its recorded SHA-256 (file changed?)`);

    let records;
    try {
      records = ADAPTERS[s.format](bytes.toString("utf8"), { sourceLabel: s.label, fields: s.fields, split: s.split });
    } catch (e) {
      errors.push(`${where}: could not parse ${s.file}: ${(e as Error).message}`);
      continue;
    }

    const expected = s.expectedCount ?? (s.kind === "quran" ? QURAN_VERSES : undefined);
    if (expected !== undefined && records.length !== expected)
      errors.push(`${where}: expected ${expected} passages, found ${records.length}`);
    if (!records.length) errors.push(`${where}: no passages found`);

    for (const r of records) {
      const id = `${s.id}:${r.key}`;
      if (!r.key) errors.push(`${where}: record without id`);
      if (!r.text || !r.text.trim()) errors.push(`Missing text: ${id}`);
      if (!r.refLabel || !r.refLabel.trim()) errors.push(`Missing reference: ${id}`);
      if (s.kind === "quran" && !(r.surah && r.ayah)) errors.push(`Missing surah/ayah: ${id}`);
      passages.push({
        id,
        sourceId: s.id,
        kind: s.kind,
        sourceLabel: s.label,
        refLabel: r.refLabel,
        surah: r.surah,
        surahName: r.surahName,
        ayah: r.ayah,
        number: r.number,
        text: r.text,
        grade: r.grade ?? null,
      });
    }
    report.push({ id: s.id, label: s.label, kind: s.kind, count: records.length, sha256, version: s.version });
  }

  const seen = new Set<string>();
  for (const p of passages) {
    if (seen.has(p.id)) errors.push(`Duplicate id: ${p.id}`);
    seen.add(p.id);
  }

  if (errors.length) {
    const shown = errors.slice(0, 25);
    if (errors.length > shown.length) shown.push(`…and ${errors.length - shown.length} more`);
    throw new Error(`Source checks failed:\n- ${shown.join("\n- ")}`);
  }
  return { passages, sources, report };
}
