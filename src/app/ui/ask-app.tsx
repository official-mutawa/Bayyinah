"use client";

// Question box, the book with live stage labels from the NDJSON stream, then the result.

import { useRef, useState } from "react";
import type { PassageKind } from "@/lib/corpus";
import type { AskResult, PipelineEvent } from "@/lib/pipeline";
import { MAX_QUESTION_LENGTH } from "@/lib/limits";
import { arabicDigits } from "@/lib/arabic";
import { Book } from "./book";
import { FloatingBooks } from "./floating-books";
import { HomeHero } from "./home-hero";
import { SiteHeader } from "./site-header";
import { CheckIcon } from "./icons";
import { ResultView } from "./result-view";

type StageEvent = Extract<PipelineEvent, { type: "stage" }>;

interface StageRow {
  key: string;
  label: string;
  state: "active" | "done";
  detail?: string;
}

interface BookLabel {
  text: string;
  kind: PassageKind | null;
  phase: "searching" | "writing";
}

/** Each label stays up at least this long, so fast stages are still readable. */
const LABEL_MIN_MS = 1100;

const EXAMPLES = [
  "هل يُجبَر أحد على اعتناق الإسلام بالقوة؟",
  "لماذا خلق الله البشر؟ ما الغاية من وجودنا؟",
  "زوجي لا يصلي منذ سنة، هل يجب عليّ أن أطلب الطلاق؟",
];

/** "وجد ٤ آيات" with correct Arabic number agreement, per kind of source. */
export function foundLabel(kind: PassageKind, n: number): string {
  const forms = {
    quran: ["لم يجد آيات مناسبة", "وجد آية واحدة", "وجد آيتين", "آيات", "آية"],
    hadith: ["لم يجد أحاديث مناسبة", "وجد حديثًا واحدًا", "وجد حديثين", "أحاديث", "حديثًا"],
    text: ["لم يجد نصوصًا مناسبة", "وجد نصًّا واحدًا", "وجد نصّين", "نصوص", "نصًّا"],
  }[kind];
  if (n <= 2) return forms[n];
  return `وجد ${arabicDigits(n)} ${n <= 10 ? forms[3] : forms[4]}`;
}

function stageRow(e: StageEvent): Omit<StageRow, "state"> {
  switch (e.stage) {
    case "rewriting":
      return { key: "rewriting", label: "صياغة عبارات البحث", detail: e.queries?.length ? e.queries.join(" · ") : undefined };
    case "search":
      return {
        key: `search:${e.source?.id}`,
        label: `البحث في ${e.source?.label ?? "المصادر"}`,
        detail: e.count !== undefined && e.source ? foundLabel(e.source.kind, e.count) : undefined,
      };
    case "drafting":
      return { key: "drafting", label: "كتابة المسودة من النصوص المسترجعة" };
    case "verifying":
      return {
        key: "verifying",
        label: "التحقق من إسناد كل جملة",
        detail: e.total ? `اجتاز ${arabicDigits(e.passed ?? 0)} من ${arabicDigits(e.total)}` : undefined,
      };
    case "redrafting":
      return { key: "redrafting", label: "إعادة الكتابة بعد ملاحظات التحقق" };
  }
}

function bookLabel(e: StageEvent, lastKind: PassageKind | null): BookLabel | null {
  if (e.stage === "rewriting" && e.state === "active") return { text: "يصوغ عبارات البحث", kind: null, phase: "searching" };
  if (e.stage === "search" && e.source) {
    if (e.state === "active") return { text: `يبحث في ${e.source.label}`, kind: e.source.kind, phase: "searching" };
    if (e.count !== undefined) return { text: foundLabel(e.source.kind, e.count), kind: e.source.kind, phase: "searching" };
  }
  if (e.state !== "active") {
    if (e.stage === "verifying" && e.total)
      return { text: `اجتاز التحقق ${arabicDigits(e.passed ?? 0)} من ${arabicDigits(e.total)}`, kind: lastKind, phase: "writing" };
    return null;
  }
  if (e.stage === "drafting") return { text: "يكتب المسودة", kind: lastKind, phase: "writing" };
  if (e.stage === "verifying") return { text: "يتحقق من الإسناد", kind: lastKind, phase: "writing" };
  if (e.stage === "redrafting") return { text: "يعيد الكتابة بعد ملاحظات التحقق", kind: lastKind, phase: "writing" };
  return null;
}

export function AskApp() {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [stages, setStages] = useState<StageRow[]>([]);
  const [label, setLabel] = useState<BookLabel | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const queue = useRef<BookLabel[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKind = useRef<PassageKind | null>(null);

  function advanceLabel() {
    const next = queue.current.shift();
    if (!next) {
      timer.current = null;
      return;
    }
    setLabel(next);
    timer.current = setTimeout(advanceLabel, LABEL_MIN_MS);
  }

  function pushLabel(l: BookLabel) {
    queue.current.push(l);
    if (!timer.current) advanceLabel();
  }

  function clearLabels() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    queue.current = [];
    lastKind.current = null;
    setLabel(null);
  }

  function onStage(e: StageEvent) {
    const row = stageRow(e);
    setStages((prev) => {
      const i = prev.findIndex((r) => r.key === row.key);
      // Verification can run twice (after a redraft): show it as a new row.
      if (i >= 0 && !(e.state === "active" && prev[i].state === "done")) {
        const next = [...prev];
        next[i] = { ...next[i], ...row, detail: row.detail ?? next[i].detail, state: e.state };
        return next;
      }
      return [...prev, { ...row, key: i >= 0 ? `${row.key}:2` : row.key, state: e.state }];
    });
    if (e.source) lastKind.current = e.source.kind;
    const l = bookLabel(e, lastKind.current);
    if (l) pushLabel(l);
  }

  async function submit(text: string) {
    const q = text.trim();
    if (q.length < 4) {
      setInvalid("اكتب السؤال أولًا.");
      inputRef.current?.focus();
      return;
    }
    setInvalid(null);
    clearLabels();
    setPhase("running");
    setStages([]);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "تعذّر الاتصال بالخدمة. أعد المحاولة.");
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let final: AskResult | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as PipelineEvent;
          if (e.type === "stage") onStage(e);
          else if (e.type === "result") final = e.result;
          else if (e.type === "error") throw new Error(e.message);
        }
      }
      if (!final) throw new Error("انقطع الاتصال قبل اكتمال الإجابة. أعد المحاولة.");
      clearLabels();
      setResult(final);
      setPhase("done");
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ block: "start" });
        resultRef.current?.focus({ preventScroll: true });
      });
    } catch (e) {
      clearLabels();
      setError(e instanceof Error ? e.message : "حدث خطأ غير متوقع.");
      setPhase("error");
    }
  }

  function reset() {
    clearLabels();
    setQuestion("");
    setPhase("idle");
    setStages([]);
    setResult(null);
    setError(null);
    inputRef.current?.focus();
    window.scrollTo({ top: 0 });
  }

  const running = phase === "running";

  const idle = phase === "idle";

  return (
    <>
      <FloatingBooks visible={idle} />
      <SiteHeader current="home" showBrand={!idle} />
      <main className="mx-auto w-full max-w-2xl px-4">
        {idle ? <HomeHero /> : <h1 className="sr-only">بيّنة</h1>}
        <div className={`flex flex-col gap-6 ${idle ? "relative z-10 -mt-12 sm:-mt-16" : "mt-2"}`}>
          <div>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void submit(question);
              }}
              className="manuscript rounded-2xl px-5 py-6 sm:px-8 sm:py-8"
            >
              <label htmlFor="question" className="block font-heading text-xl font-bold">
                سؤال المحاوِر
              </label>
              <p id="question-hint" className="mt-1 text-sm text-ink-2">
                اكتبه كما سمعته. الإجابة مسودة من المصادر المعتمدة فقط، لتراجعها قبل استعمالها.
              </p>
              <textarea
                ref={inputRef}
                id="question"
                name="question"
                rows={3}
                dir="auto"
                value={question}
                maxLength={MAX_QUESTION_LENGTH}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void submit(question);
                  }
                }}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={invalid ? "question-hint question-error" : "question-hint"}
                className="mt-3 block w-full resize-y rounded-xl border border-line bg-paper px-3.5 py-3 text-base leading-relaxed text-ink placeholder:text-muted focus-visible:border-primary"
                placeholder="مثال: هل يُجبَر أحد على اعتناق الإسلام بالقوة؟"
              />
              <div className="mt-2 flex items-center justify-between gap-3 text-sm text-muted">
                {invalid ? (
                  <p id="question-error" className="font-medium text-gold-ink">
                    {invalid}
                  </p>
                ) : (
                  <span />
                )}
                <span className="tabular-nums" aria-hidden="true">
                  {arabicDigits(question.length)} / {arabicDigits(MAX_QUESTION_LENGTH)}
                </span>
              </div>
              <button
                type="submit"
                disabled={running}
                className="press mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-on-primary hover:brightness-110 disabled:opacity-75 sm:w-auto"
              >
                {running && <span className="stage-active-dot size-2 rounded-full bg-on-primary" aria-hidden="true" />}
                ابحث وأعدّ المسودة
              </button>

              {phase === "idle" && (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-sm text-ink-2">أمثلة:</p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {EXAMPLES.map((ex) => (
                      <li key={ex}>
                        <button
                          type="button"
                          onClick={() => {
                            setQuestion(ex);
                            inputRef.current?.focus();
                          }}
                          className="min-h-11 w-full rounded-xl border border-line bg-paper px-3.5 py-2 text-start text-[0.9375rem] text-ink hover:border-gold"
                        >
                          {ex}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </form>
          </div>

          {/* The book and its stage label. The label is the polite live region. */}
          {running && (
            <div className="fade-in flex flex-col items-center">
              <Book key={label?.kind ?? "quran"} kind={label?.kind ?? null} />
              <p role="status" aria-live="polite" className="mt-1 min-h-7 text-center font-heading text-lg font-bold text-primary">
                {label?.text ?? "يبدأ البحث"}
              </p>
            </div>
          )}

          {stages.length > 0 && (
            <section aria-label="مراحل العمل" className="px-1 sm:px-2">
              <ol className="flex flex-col gap-3">
                {stages.map((s) => (
                  <li key={s.key} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
                        s.state === "done" ? "bg-primary text-on-primary" : "border border-gold text-gold"
                      }`}
                      aria-hidden="true"
                    >
                      {s.state === "done" ? <CheckIcon className="size-4" /> : <span className="stage-active-dot size-2 rounded-full bg-current" />}
                    </span>
                    <div className="min-w-0">
                      <p className={s.state === "done" ? "text-ink" : "font-medium text-ink"}>
                        {s.label}
                        <span className="sr-only">{s.state === "done" ? " — اكتمل" : " — جارٍ"}</span>
                      </p>
                      {s.detail && <p className="mt-0.5 text-sm text-ink-2 [overflow-wrap:anywhere]">{s.detail}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {phase === "error" && error && (
            <div role="alert" className="rounded-2xl border border-gold-ink bg-surface p-4 sm:p-5">
              <p className="font-heading text-lg font-bold text-gold-ink">لم تكتمل الإجابة</p>
              <p className="mt-1 text-ink">{error}</p>
              <button
                type="button"
                onClick={() => void submit(question)}
                className="press mt-3 min-h-11 rounded-xl border border-primary px-4 font-medium text-primary"
              >
                أعد المحاولة
              </button>
            </div>
          )}

          {result && (
            <div ref={resultRef} tabIndex={-1} className="scroll-mt-4 outline-none">
              <ResultView result={result} onNew={reset} />
            </div>
          )}
        </div>
      </main>
    </>
  );
}
