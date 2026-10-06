// One small adapter per source format. Each turns a stored file into raw records.
// Adapters only read and map fields; text is passed through exactly as stored.

import { arabicDigits } from "./arabic.ts";

export interface RawRecord {
  /** Local key, unique within the source (becomes `${sourceId}:${key}`) */
  key: string;
  text: string;
  /** Reference shown to users, e.g. "النحل ١٢٥" or "كتاب الإيمان، رقم ٥" */
  refLabel: string;
  surah?: number;
  surahName?: string;
  ayah?: number;
  number?: string;
  grade?: string | null;
}

/** Field mapping for record formats (json, jsonl, csv, tsv). Values are field/column names. */
export interface FieldMap {
  /** Dot path to the array of records in a JSON file; omit when the file is an array */
  records?: string;
  /** Field holding a unique id or number; defaults to the record's position (1-based) */
  id?: string;
  text: string;
  grade?: string;
  /**
   * Reference template using {field} placeholders and {source} for the source label,
   * e.g. "{source}، {book}، رقم {number}". Defaults to "{source} {id}".
   */
  ref?: string;
}

export interface AdapterContext {
  sourceLabel: string;
  fields?: FieldMap;
  /** text format: split passages on this regex (default: blank lines) */
  split?: string;
}

function getPath(obj: unknown, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function asText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join("، ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Common grade shape: { name, grade }
    if ("grade" in o) return o.name ? `${asText(o.grade)} (${asText(o.name)})` : asText(o.grade);
    return JSON.stringify(v);
  }
  return String(v);
}

function fillTemplate(template: string, rec: Record<string, unknown>, extra: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (name in extra) return extra[name];
    const v = asText(getPath(rec, name));
    return /^[0-9.]+$/.test(v) ? arabicDigits(v) : v;
  });
}

function decodeXml(s: string): string {
  return s
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Quran XML: <sura index name><aya index text/></sura>. Basmala attributes are not verse text. */
function quranXml(content: string): RawRecord[] {
  const out: RawRecord[] = [];
  for (const s of content.matchAll(/<sura index="(\d+)" name="([^"]*)"[^>]*>([\s\S]*?)<\/sura>/g)) {
    const surah = Number(s[1]);
    const surahName = decodeXml(s[2]);
    for (const a of s[3].matchAll(/<aya index="(\d+)" text="([^"]*)"/g)) {
      const ayah = Number(a[1]);
      out.push({ key: `${surah}:${ayah}`, text: decodeXml(a[2]), refLabel: `${surahName} ${arabicDigits(ayah)}`, surah, surahName, ayah });
    }
  }
  return out;
}

/** Quran text with aya numbers: "sura|aya|text" per line; other lines (e.g. a "#" license block) are skipped. */
function quranTxt(content: string): RawRecord[] {
  const out: RawRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const m = /^(\d+)\|(\d+)\|(.*)$/.exec(line);
    if (!m) continue;
    const surah = Number(m[1]);
    const ayah = Number(m[2]);
    out.push({ key: `${surah}:${ayah}`, text: m[3], refLabel: `سورة ${arabicDigits(surah)}، آية ${arabicDigits(ayah)}`, surah, ayah });
  }
  return out;
}

function fromRecords(records: Record<string, unknown>[], ctx: AdapterContext): RawRecord[] {
  const f = ctx.fields;
  if (!f?.text) throw new Error("fields.text is required for record formats");
  return records.map((rec, i) => {
    const id = f.id ? asText(getPath(rec, f.id)).trim() : String(i + 1);
    const extra = { source: ctx.sourceLabel, id: /^[0-9.]+$/.test(id) ? arabicDigits(id) : id };
    const grade = f.grade ? asText(getPath(rec, f.grade)).trim() : "";
    return {
      key: id,
      text: asText(getPath(rec, f.text)),
      refLabel: fillTemplate(f.ref ?? "{source} {id}", rec, extra).trim(),
      number: id,
      grade: grade || null,
    };
  });
}

function json(content: string, ctx: AdapterContext): RawRecord[] {
  const data = JSON.parse(content) as unknown;
  const records = ctx.fields?.records ? getPath(data, ctx.fields.records) : data;
  if (!Array.isArray(records)) throw new Error("JSON records not found (check fields.records)");
  return fromRecords(records as Record<string, unknown>[], ctx);
}

function jsonl(content: string, ctx: AdapterContext): RawRecord[] {
  const records = content
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return fromRecords(records, ctx);
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseDelimited(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = content.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function delimited(content: string, ctx: AdapterContext, delimiter: string): RawRecord[] {
  const [header, ...rows] = parseDelimited(content, delimiter);
  if (!header) return [];
  const records = rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
  return fromRecords(records, ctx);
}

/** Plain text: passages split on blank lines (or a custom regex), numbered in order. */
function plainText(content: string, ctx: AdapterContext): RawRecord[] {
  const parts = content.replace(/^﻿/, "").split(new RegExp(ctx.split ?? "\\r?\\n\\s*\\r?\\n"));
  return parts
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text, i) => ({ key: String(i + 1), text, refLabel: `${ctx.sourceLabel}، مقطع ${arabicDigits(i + 1)}`, number: String(i + 1) }));
}

export const ADAPTERS = {
  "quran-xml": (c: string) => quranXml(c),
  "quran-txt": (c: string) => quranTxt(c),
  json,
  jsonl,
  csv: (c: string, ctx: AdapterContext) => delimited(c, ctx, ","),
  tsv: (c: string, ctx: AdapterContext) => delimited(c, ctx, "\t"),
  text: plainText,
} satisfies Record<string, (content: string, ctx: AdapterContext) => RawRecord[]>;

export type SourceFormat = keyof typeof ADAPTERS;
