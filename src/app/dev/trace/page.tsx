// Development-only viewer for local v2 traces (local/traces, gitignored). Not available on the
// deployed site: it returns 404 unless NODE_ENV is "development".

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TracePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) notFound();
  const dir = path.join(process.cwd(), "local", "traces");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 50) : [];
  const { id } = await searchParams;
  const safe = id && /^[A-Za-z0-9-]+$/.test(id) ? id : null;
  const trace = safe && existsSync(path.join(dir, `${safe}.json`)) ? JSON.parse(readFileSync(path.join(dir, `${safe}.json`), "utf8")) : null;
  return (
    <main dir="ltr" className="mx-auto max-w-5xl px-4 py-6 font-mono text-sm">
      <h1 className="text-lg font-bold">Local traces (development only)</h1>
      <ul className="mt-3 flex flex-col gap-1">
        {files.map((f) => (
          <li key={f}>
            <a className="text-primary underline" href={`/dev/trace?id=${f.replace(/\.json$/, "")}`}>
              {f}
            </a>
          </li>
        ))}
      </ul>
      {trace && (
        <section className="mt-6">
          <h2 className="font-bold">{safe}</h2>
          <p className="mt-1">
            {JSON.stringify(trace.result)} · timings {JSON.stringify(trace.timings)}
          </p>
          <pre dir="auto" className="mt-3 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-line p-3">
            {JSON.stringify({ plan: trace.plan, shortlists: trace.shortlists, evidenceMap: trace.evidenceMap, verification: trace.verification, wholeReview: trace.wholeReview, repairs: trace.repairs, metas: trace.metas }, null, 1)}
          </pre>
        </section>
      )}
    </main>
  );
}
