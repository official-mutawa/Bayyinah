// Plain-text answer for pasting into a chat (v2). Verses come from the Quran data exactly as stored;
// hadith with ruling and muhaddith exactly as returned; books are cited by reference. OCR text is
// never pasted as a quotation.

import type { AskResultV2, V2Part } from "@/lib/v2/pipeline-v2";
import { arabicDigits } from "@/lib/arabic";

function verseLine(r: AskResultV2, s: number, a: number, b: number): string {
  const parts: string[] = [];
  for (let k = a; k <= b; k++) if (r.verses[`${s}:${k}`]) parts.push(r.verses[`${s}:${k}`].text);
  const name = r.verses[`${s}:${a}`]?.surahName ?? "";
  return `﴿${parts.join(" ")}﴾ [سورة ${name}، ${a === b ? `الآية ${arabicDigits(a)}` : `الآيات ${arabicDigits(a)}–${arabicDigits(b)}`}]`;
}

function partText(r: AskResultV2, p: V2Part): string[] {
  const lines: string[] = [];
  for (const b of p.blocks) {
    if (b.kind === "claim") {
      const refs = [...new Set(b.cites.map((c) => (c.type === "quran" && c.verse ? `سورة ${r.verses[`${c.verse.surah}:${c.verse.from}`]?.surahName ?? ""} ${arabicDigits(c.verse.from)}` : c.type === "hadith" && c.dorarId ? r.hadith[c.dorarId]?.book ?? "" : r.records[c.recordId]?.refLabel ?? "")))].filter(Boolean);
      lines.push(`${b.text}${refs.length ? ` (${refs.join("؛ ")})` : ""}`);
    } else if (b.kind === "quran") {
      for (const c of b.cites) if (c.verse) lines.push(verseLine(r, c.verse.surah, c.verse.from, c.verse.to));
    } else if (b.kind === "hadith") {
      for (const c of b.cites) {
        const h = c.dorarId ? r.hadith[c.dorarId] : undefined;
        if (h) lines.push(`«${h.text}» (${h.book}${h.locator ? `، ${h.locator}` : ""} — ${h.grade}، ${h.muhaddith})`);
      }
    } else if (b.kind === "quote") {
      for (const c of b.cites) {
        const rec = r.records[c.recordId];
        if (!rec || !rec.quotable) continue;
        const text = rec.sentences.filter((s) => c.sentenceIds.includes(s.id)).map((s) => rec.text.slice(s.start, s.end)).join(" ");
        lines.push(`«${text}» (${rec.refLabel})`);
      }
    }
  }
  return lines;
}

export function buildCopyTextV2(r: AskResultV2): string {
  const out: string[] = [];
  if (r.summary) out.push(...partText(r, r.summary), "");
  for (const s of r.sections) out.push(s.heading, ...partText(r, s), "");
  for (const g of r.gaps) out.push(g.text);
  return out.join("\n").trim();
}
