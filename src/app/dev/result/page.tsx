// Development-only: render a saved eval run's answer in the real v1 or v2 view (for screenshots,
// side-by-side review and the blind A/B). Returns 404 outside local development.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { DevResult } from "./dev-result";

export const dynamic = "force-dynamic";

export default async function DevResultPage({ searchParams }: { searchParams: Promise<{ run?: string; id?: string }> }) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) notFound();
  const { run, id } = await searchParams;
  const runsDir = path.join(process.cwd(), "local", "eval", "runs");
  const ok = (s?: string) => !!s && /^[A-Za-z0-9-]+$/.test(s);
  if (!ok(run)) {
    const runs = existsSync(runsDir) ? readdirSync(runsDir).sort() : [];
    return (
      <main dir="ltr" className="mx-auto max-w-3xl px-4 py-6 font-mono text-sm">
        <h1 className="font-bold">Saved runs (development only)</h1>
        <ul className="mt-2">
          {runs.map((r) => (
            <li key={r}>
              <a className="text-primary underline" href={`/dev/result?run=${r}`}>
                {r}
              </a>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  const dir = path.join(runsDir, run!);
  if (!existsSync(dir)) notFound();
  if (!ok(id)) {
    const files = readdirSync(dir).filter((f) => /^g\d+\.json$/.test(f)).sort();
    return (
      <main dir="ltr" className="mx-auto max-w-3xl px-4 py-6 font-mono text-sm">
        <h1 className="font-bold">{run}</h1>
        <ul className="mt-2">
          {files.map((f) => (
            <li key={f}>
              <a className="text-primary underline" href={`/dev/result?run=${run}&id=${f.replace(".json", "")}`}>
                {f}
              </a>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  const file = path.join(dir, `${id}.json`);
  if (!existsSync(file)) notFound();
  const saved = JSON.parse(readFileSync(file, "utf8")) as { question: string; result: unknown };
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <p className="mb-4 rounded-xl border border-line bg-paper p-3 text-[1.0625rem]">{saved.question}</p>
      <DevResult result={saved.result} />
    </main>
  );
}
