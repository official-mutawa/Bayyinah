// Parse Dorar API results (shared by the browser client and the server's input validation).
// Text, ruling and source are kept exactly as Dorar returns them; only HTML tags are removed.

export interface DorarItem {
  text: string;
  narrator: string;
  muhaddith: string;
  book: string;
  locator: string;
  grade: string;
}

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

export function parseDorar(html: string): DorarItem[] {
  const out: DorarItem[] = [];
  const re = /<div class="hadith"[^>]*>([\s\S]*?)<\/div>\s*<div class="hadith-info">([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(re)) {
    const text = stripTags(m[1]).replace(/^\d+\s*-\s*/, "");
    if (!text) continue;
    const info = m[2] + "</div>";
    out.push({
      text,
      narrator: field(info, "الراوي"),
      muhaddith: field(info, "المحدث"),
      book: field(info, "المصدر"),
      locator: field(info, "الصفحة أو الرقم"),
      grade: field(info, "خلاصة حكم المحدث"),
    });
  }
  return out;
}

/** Small stable id for a hadith (no Node crypto, so it also runs in the browser). */
export function dorarId(item: Pick<DorarItem, "text" | "book" | "locator">): string {
  let h = 0x811c9dc5;
  for (const ch of item.text + item.book + item.locator) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `dorar:${h.toString(16).padStart(8, "0")}`;
}
