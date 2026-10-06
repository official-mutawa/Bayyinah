// Live hadith search through the official Dorar API (dorar.net/article/389).
// Each hadith is shown with the muhaddith's ruling and the source exactly as Dorar returns them.

import { createHash } from "node:crypto";
import type { Passage } from "./corpus.ts";

export interface DorarHadith extends Passage {
  narrator: string;
  muhaddith: string;
  book: string;
  locator: string;
}

const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; items: DorarHadith[] }>();

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function field(info: string, name: string): string {
  const re = new RegExp(`<span class="info-subtitle">${name}:</span>([\\s\\S]*?)(?=<span class="info-subtitle">|</div>)`);
  const m = re.exec(info);
  return m ? stripTags(m[1]) : "";
}

export function parseDorar(html: string): DorarHadith[] {
  const out: DorarHadith[] = [];
  const re = /<div class="hadith"[^>]*>([\s\S]*?)<\/div>\s*<div class="hadith-info">([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(re)) {
    const text = stripTags(m[1]).replace(/^\d+\s*-\s*/, "");
    if (!text) continue;
    const info = m[2] + "</div>";
    const muhaddith = field(info, "المحدث");
    const book = field(info, "المصدر");
    const locator = field(info, "الصفحة أو الرقم");
    const grade = field(info, "خلاصة حكم المحدث");
    const id = `dorar:${createHash("sha1").update(text + book + locator).digest("hex").slice(0, 10)}`;
    out.push({
      id,
      sourceId: "dorar",
      kind: "hadith",
      sourceLabel: "الدرر السنية — الموسوعة الحديثية",
      refLabel: [book, locator].filter(Boolean).join("، ") || "الدرر السنية",
      text,
      grade: grade ? `${grade}${muhaddith ? ` — ${muhaddith}` : ""}` : null,
      narrator: field(info, "الراوي"),
      muhaddith,
      book,
      locator,
    });
  }
  return out;
}

/** Search Dorar. Throws on timeout or HTTP failure so the caller can report it and continue. */
export async function searchDorar(query: string): Promise<DorarHadith[]> {
  const key = query.trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;
  const res = await fetch(`https://dorar.net/dorar_api.json?skey=${encodeURIComponent(key)}`, {
    headers: { "User-Agent": "Bayyinah/1.0 (+https://bayyinah-henna.vercel.app)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Dorar HTTP ${res.status}`);
  const data = (await res.json()) as { ahadith?: { result?: string } };
  const items = parseDorar(data.ahadith?.result ?? "");
  cache.set(key, { at: Date.now(), items });
  if (cache.size > 500) cache.clear();
  return items;
}
