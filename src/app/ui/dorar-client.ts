// Hadith search from the user's browser through Dorar's documented JSONP interface
// (dorar.net/article/389). Results are passed on exactly as Dorar returns them.

import { parseDorar } from "@/lib/dorar-parse";
import type { DorarItem } from "@/lib/dorar-parse";

const TIMEOUT_MS = 8000;
const MAX_ITEMS = 3;
const cache = new Map<string, DorarItem[]>();
let seq = 0;

function jsonp(query: string): Promise<DorarItem[]> {
  const hit = cache.get(query);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const name = `__dorar_cb_${Date.now()}_${seq++}`;
    const script = document.createElement("script");
    const w = window as unknown as Record<string, unknown>;
    const done = () => {
      clearTimeout(timer);
      delete w[name];
      script.remove();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("timeout"));
    }, TIMEOUT_MS);
    w[name] = (data: { ahadith?: { result?: string } }) => {
      done();
      const items = parseDorar(data?.ahadith?.result ?? "");
      cache.set(query, items);
      resolve(items);
    };
    script.onerror = () => {
      done();
      reject(new Error("network"));
    };
    script.src = `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(query)}&callback=${name}`;
    document.head.appendChild(script);
  });
}

/** Search the first two queries; returns up to 3 distinct hadith, or failed=true if Dorar was unreachable. */
export async function searchDorarInBrowser(queries: string[]): Promise<{ items: DorarItem[]; failed: boolean }> {
  const results = await Promise.allSettled(queries.slice(0, 2).map(jsonp));
  const ok = results.filter((r): r is PromiseFulfilledResult<DorarItem[]> => r.status === "fulfilled");
  const items: DorarItem[] = [];
  for (const r of ok) {
    for (const h of r.value) {
      if (items.length >= MAX_ITEMS) break;
      if (!items.some((x) => x.text === h.text)) items.push(h);
    }
  }
  return { items, failed: ok.length === 0 };
}
