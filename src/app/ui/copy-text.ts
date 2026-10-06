// Builds the plain-text answer for pasting into a chat (e.g. WhatsApp).
// Quran citations carry the full verse exactly as stored; tafsir, book and hadith citations carry
// the verified quote with its surrounding sentence from the stored passage. No text written by the
// model is presented as source text.

import type { AskResult } from "@/lib/pipeline";
import { arabicDigits } from "@/lib/arabic";
import { excerptAround, excerptText } from "./excerpt";

export function buildCopyText(result: AskResult): string {
  const byId = new Map(result.passages.map((p) => [p.id, p]));
  const blocks = result.claims.map((claim) => {
    const lines = [claim.text];
    for (const id of claim.passage_ids) {
      const p = byId.get(id);
      if (!p) continue;
      if (p.kind === "quran") {
        const ref = p.surahName ? `سورة ${p.surahName}، الآية ${arabicDigits(p.ayah ?? 0)}` : p.refLabel;
        lines.push(`﴿${p.text}﴾ [${ref}]`);
      } else if (claim.match.passage_id === id) {
        const quote = excerptText(excerptAround(p.text, claim.match.start, claim.match.end));
        const grade = p.kind === "hadith" && p.grade ? ` — ${p.grade}` : "";
        const ocr = p.ocr ? "، نص مستخرج آليًا من صورة الصفحة" : "";
        lines.push(`«${quote}» (${p.refLabel}${grade}${ocr})`);
      } else {
        lines.push(`(${p.refLabel})`);
      }
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}
