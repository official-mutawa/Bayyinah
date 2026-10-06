// Builds the plain-text answer for pasting into a chat (e.g. WhatsApp).
// Quran citations carry the verse exactly as stored; other sources carry the stored span that
// supports the claim. No text written by the model is presented as source text.

import type { AskResult } from "@/lib/pipeline";

export function buildCopyText(result: AskResult): string {
  const byId = new Map(result.passages.map((p) => [p.id, p]));
  const blocks = result.claims.map((claim) => {
    const lines = [claim.text];
    for (const id of claim.passage_ids) {
      const p = byId.get(id);
      if (!p) continue;
      if (p.kind === "quran") {
        lines.push(`﴿${p.text}﴾ [${p.refLabel}]`);
      } else if (claim.match.passage_id === id) {
        lines.push(`«${p.text.slice(claim.match.start, claim.match.end)}» (${p.refLabel})`);
      } else {
        lines.push(`(${p.refLabel})`);
      }
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}
