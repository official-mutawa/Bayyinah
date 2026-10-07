// Human review material from local eval runs (all outputs gitignored, they contain book text):
//   local/eval/sheets/labelling-v2.csv   claim-citation pairs from v2 for human support labels
//   local/eval/sheets/ab.html            blind side-by-side of v1 and v2 answers (A/B order random)
//   local/eval/sheets/ab-key.json        which side is v1 or v2 for each question (open after judging)
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON eval/sheets.ts --v1 baseline-v1-dev,v1-heldout --v2 v2-dev1,v2-heldout [--pairs 48] [--ab 20]

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const v1Runs = (args.get("v1") ?? "").split(",").filter(Boolean);
const v2Runs = (args.get("v2") ?? "").split(",").filter(Boolean);
const nPairs = Number(args.get("pairs") ?? 48);
const nAB = Number(args.get("ab") ?? 20);
const out = path.join("local", "eval", "sheets");
mkdirSync(out, { recursive: true });

const load = (label: string) => {
  const dir = path.join("local", "eval", "runs", label);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^g\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
};
const v1 = new Map(v1Runs.flatMap(load).map((r) => [r.id, r]));
const v2 = new Map(v2Runs.flatMap(load).map((r) => [r.id, r]));
const h = (s: string) => createHash("sha256").update(`bayyinah-sheets:${s}`).digest("hex");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const csvCell = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;

// ---------- Labelling sheet ----------

type Cite = { type: string; recordId: string; sentenceIds: string[]; verse?: { surah: number; from: number; to: number }; dorarId?: string };
const pairs: string[][] = [];
for (const r of v2.values()) {
  const res = r.result;
  if (!res || res.version !== "v2") continue;
  const tf = res.traceId ? path.join("local", "traces", `${res.traceId}.json`) : "";
  const trace = tf && existsSync(tf) ? JSON.parse(readFileSync(tf, "utf8")) : {};
  const reviews = new Map<string, { verdict: string; reason: string }>();
  for (const p of trace.verification ?? []) for (const it of p.items) for (const v of it.review ?? []) reviews.set(`${it.text}#${v.evidence}`, v);
  for (const p of [...(res.summary ? [res.summary] : []), ...res.sections]) {
    for (const b of p.blocks.filter((x: { kind: string }) => x.kind === "claim")) {
      for (const c of b.cites as (Cite & { evidence: string })[]) {
        let ref = "";
        let text = "";
        let speaker = "";
        if (c.verse) {
          const v = res.verses[`${c.verse.surah}:${c.verse.from}`];
          ref = `${v?.refLabel ?? ""}${c.verse.to > c.verse.from ? `–${c.verse.to}` : ""}`;
          text = `[الآية] ${v?.text ?? ""}\n[التفسير الميسر] ${c.sentenceIds.map((sid) => { const rec = res.records[sid.replace(/:s\d+$/, "")]; const s = rec?.sentences.find((x: { id: string }) => x.id === sid); return s ? rec.text.slice(s.start, s.end) : ""; }).join(" ")}`;
          speaker = "آية وتفسير";
        } else if (c.dorarId) {
          const hd = res.hadith[c.dorarId];
          ref = `${hd?.book ?? ""} — ${hd?.grade ?? ""} (${hd?.muhaddith ?? ""})`;
          text = hd?.text ?? "";
          speaker = "حديث";
        } else {
          const rec = res.records[c.recordId];
          ref = rec?.refLabel ?? c.recordId;
          const ss = (rec?.sentences ?? []).filter((s: { id: string }) => c.sentenceIds.includes(s.id));
          text = ss.map((s: { start: number; end: number }) => rec.text.slice(s.start, s.end)).join(" ");
          speaker = [...new Set(ss.map((s: { speaker: string }) => s.speaker))].join("+");
        }
        const rv = reviews.get(`${b.text}#${c.evidence}`);
        pairs.push([`${r.id}-${h(b.text + c.recordId).slice(0, 6)}`, r.question, b.text, ref, text, speaker, rv?.verdict ?? "", rv?.reason ?? "", "", ""]);
      }
    }
  }
}
pairs.sort((a, b) => h(a[0]).localeCompare(h(b[0])));
const picked = pairs.slice(0, nPairs);
writeFileSync(
  path.join(out, "labelling-v2.csv"),
  "﻿" + [["pair_id", "question", "claim", "cited_source", "cited_text", "speaker", "model_verdict", "model_reason", "human_verdict (supported/partial/unsupported/contradicted)", "human_notes"], ...picked].map((row) => row.map(csvCell).join(",")).join("\n")
);

// ---------- Blind A/B ----------

function renderV1(res: { status: string; claims: { text: string; passage_ids: string[] }[]; passages: { id: string; refLabel: string; kind: string; text: string }[]; abstain_reason: string }): string {
  if (!res) return "<p>(لا نتيجة)</p>";
  if (res.status !== "answer") return `<p class="abstain">امتناع: ${esc(res.abstain_reason)}</p>`;
  const byId = new Map(res.passages.map((p) => [p.id, p]));
  return `<ol>${res.claims.map((c) => `<li>${esc(c.text)}<div class="cites">${c.passage_ids.map((id) => { const p = byId.get(id); return p ? (p.kind === "quran" ? `<div class="verse">﴿${esc(p.text)}﴾ [${esc(p.refLabel)}]</div>` : `<span>(${esc(p.refLabel)})</span>`) : ""; }).join(" ")}</div></li>`).join("")}</ol>`;
}

function renderV2(res: { status: string; summary: unknown; sections: unknown[]; gaps: { text: string }[]; abstain_reason: string; verses: Record<string, { text: string; refLabel: string; tafsir: string }>; records: Record<string, { refLabel: string }>; hadith: Record<string, { text: string; book: string; grade: string; muhaddith: string }> }): string {
  if (!res) return "<p>(لا نتيجة)</p>";
  if (res.status === "abstain" || res.status === "out_of_scope") return `<p class="abstain">${res.status === "out_of_scope" ? "خارج النطاق" : "امتناع"}: ${esc(res.abstain_reason)}</p>`;
  const part = (p: { heading: string; blocks: { kind: string; text: string; cites: Cite[] }[] }, title: string) =>
    `<h4>${esc(title)}</h4>${p.blocks
      .map((b) => {
        if (b.kind === "quran") return b.cites.filter((c) => c.verse).map((c) => { const lines = []; for (let a = c.verse!.from; a <= c.verse!.to; a++) { const v = res.verses[`${c.verse!.surah}:${a}`]; if (v) lines.push(`<div class="verse">﴿${esc(v.text)}﴾ [${esc(v.refLabel)}]</div><div class="tafsir">التفسير الميسر: ${esc(v.tafsir)}</div>`); } return lines.join(""); }).join("");
        if (b.kind === "hadith") return b.cites.map((c) => { const hd = c.dorarId ? res.hadith[c.dorarId] : null; return hd ? `<div class="hadith">«${esc(hd.text)}» (${esc(hd.book)} — ${esc(hd.grade)}، ${esc(hd.muhaddith)})</div>` : ""; }).join("");
        if (b.kind === "quote") return "";
        const refs = b.cites.map((c) => (c.verse ? res.verses[`${c.verse.surah}:${c.verse.from}`]?.refLabel : c.dorarId ? res.hadith[c.dorarId]?.book : res.records[c.recordId]?.refLabel) ?? "").filter(Boolean);
        return `<p>${esc(b.text)} <span class="cites">(${esc(refs.join("؛ "))})</span></p>`;
      })
      .join("")}`;
  const s = res.summary as { heading: string; blocks: { kind: string; text: string; cites: Cite[] }[] } | null;
  return `${s ? part(s, "الخلاصة") : ""}${(res.sections as { heading: string; blocks: { kind: string; text: string; cites: Cite[] }[] }[]).map((p) => part(p, p.heading)).join("")}${res.gaps.length ? `<p class="gaps">${res.gaps.map((g) => esc(g.text)).join("<br>")}</p>` : ""}`;
}

const both = [...v1.keys()].filter((id) => v2.has(id)).sort((a, b) => h(a).localeCompare(h(b))).slice(0, nAB).sort();
const key: Record<string, { A: string; B: string }> = {};
const blocks = both.map((id) => {
  const flip = parseInt(h(`ab:${id}`).slice(0, 2), 16) % 2 === 1;
  key[id] = flip ? { A: "v2", B: "v1" } : { A: "v1", B: "v2" };
  const a = flip ? renderV2(v2.get(id)!.result) : renderV1(v1.get(id)!.result);
  const b = flip ? renderV1(v1.get(id)!.result) : renderV2(v2.get(id)!.result);
  return `<section><h3>${esc(id)} — ${esc(v1.get(id)!.question)}</h3><div class="pair"><div class="ans"><h4 class="lbl">الإجابة أ</h4>${a}</div><div class="ans"><h4 class="lbl">الإجابة ب</h4>${b}</div></div><p class="judge">أيهما أفضل؟ ☐ أ ☐ ب ☐ متساويتان — ملاحظات: ____________</p></section>`;
});
writeFileSync(
  path.join(out, "ab.html"),
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مقارنة عمياء</title><style>body{font-family:system-ui,"Segoe UI",Tahoma,sans-serif;margin:16px;line-height:1.8;background:#fbf8f2;color:#1f2a24}section{border:1px solid #d9d2c3;border-radius:12px;padding:12px 16px;margin:16px 0;background:#fff}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:800px){.pair{grid-template-columns:1fr}}.ans{border-inline-start:3px solid #b08a3e;padding-inline-start:12px}.verse{font-size:1.15em;margin:6px 0}.tafsir,.cites,.gaps{color:#555;font-size:.92em}.abstain{color:#7a5f2a}.lbl{margin:0}.judge{margin-top:8px;font-weight:600}</style></head><body><h1>مقارنة عمياء بين نسختين (${both.length} سؤالًا)</h1><p>لا تفتح ملف المفتاح ab-key.json قبل الانتهاء من الحكم.</p>${blocks.join("")}</body></html>`
);
writeFileSync(path.join(out, "ab-key.json"), JSON.stringify(key, null, 1));
console.log(`labelling pairs: ${picked.length} of ${pairs.length}; A/B questions: ${both.length}; written to ${out}`);
