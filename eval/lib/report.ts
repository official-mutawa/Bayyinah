// Markdown report for one eval run (written next to summary.json, in gitignored local/).

import type { QuestionRun } from "./score.ts";

type Summary = ReturnType<typeof import("./score.ts").summarize>;

export function renderReport(meta: Record<string, unknown>, s: Summary, runs: QuestionRun[]): string {
  const yes = (v: boolean | null | undefined) => (v === null || v === undefined ? "—" : v ? "✓" : "✗");
  const lines = [
    `# Eval run ${meta.label}`,
    "",
    `Pipeline ${meta.pipeline} · set ${meta.setFile} · Dorar ${meta.dorarMode} · models ${JSON.stringify(meta.models)} · ${meta.runAt}`,
    `Cost of this run: $${meta.usd}${meta.rateLimited ? " · STOPPED ON RATE LIMIT" : ""}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    ...Object.entries(s)
      .filter(([k]) => k !== "retrievalRecallPerSource")
      .map(([k, v]) => `| ${k} | ${Array.isArray(v) ? (v.length ? v.join(", ") : "none") : typeof v === "object" ? JSON.stringify(v) : v} |`),
    "",
    "## Retrieval recall per source (expected locations found among retrieved passages)",
    "",
    "| Source | Hits | Total | Recall % |",
    "| --- | --- | --- | --- |",
    ...Object.entries(s.retrievalRecallPerSource).map(([k, v]) => `| ${k} | ${v.hits} | ${v.total} | ${v.recall} |`),
    "",
    "## Per question",
    "",
    "| id | status | ok | verified | claims | ayah groups in candidates | ayah in answer | sources cited | not-relevant cited | s | $ |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...runs.map((r) => {
      const sc = r.score!;
      return `| ${r.id} | ${r.result?.status ?? "error"} | ${yes(sc.statusOk)} | ${yes(sc.verified)} | ${sc.claims} | ${sc.ayahGroupsInCandidates}/${sc.ayahGroups} | ${yes(sc.ayahInAnswer)} | ${sc.sourcesCited.join(" ")} | ${sc.notRelevantCited.join(" ") || "—"} | ${(r.ms / 1000).toFixed(1)} | ${r.usage.usd.toFixed(4)} |`;
    }),
    "",
  ];
  return lines.join("\n");
}
