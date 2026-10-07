"use client";

import type { AskResult } from "@/lib/pipeline";
import type { AskResultV2 } from "@/lib/v2/pipeline-v2";
import { ResultView } from "../../ui/result-view";
import { ResultViewV2 } from "../../ui/v2/result-view-v2";

export function DevResult({ result }: { result: unknown }) {
  if (!result) return <p>No result (error in this run).</p>;
  const r = result as AskResult | AskResultV2;
  return "version" in r && r.version === "v2" ? <ResultViewV2 result={r} onNew={() => history.back()} /> : <ResultView result={r as AskResult} onNew={() => history.back()} />;
}
