"use client";

import { useRef, useState } from "react";
import type { AskResult, AttemptLog, RetrievedPassage } from "@/lib/pipeline";
import { arabicDigits } from "@/lib/arabic";
import { buildCopyText } from "./copy-text";
import { EvidenceTag } from "./evidence-tag";
import { AlertIcon, CheckIcon, ChevronIcon, CopyIcon, InfoIcon, StarMark } from "./icons";
import { StarDivider } from "./ornament";
import { SourceDialog } from "./source-dialog";
import type { OpenSource } from "./source-dialog";

const KIND_SHORT = { quran: "آية", tafsir: "تفسير", hadith: "حديث", text: "نص" } as const;

/** Map internal check messages to Arabic for the explanation panel. */
function issueLabel(issue: string): string {
  if (issue.includes("supporting_quote")) return "الاقتباس لم يُوجد حرفيًّا في النص المستشهد به";
  if (issue.includes("not retrieved")) return "استشهد بنص لم يكن ضمن النصوص المسترجعة";
  if (issue.includes("repeats wording")) return "نقل لفظ الآية بدل الإحالة إليها";
  if (issue.includes("verifier")) return "المدقق الثاني: الجملة غير مدعومة بنصها";
  if (issue.includes("no passage")) return "جملة بلا استشهاد";
  return "لم تجتز فحصًا آليًّا";
}

const CARD = "rounded-2xl border border-line bg-surface shadow-[0_1px_2px_var(--shadow)]";

function CitationChip({ passage, onOpen }: { passage: RetrievedPassage; onOpen: (trigger: HTMLElement) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      className="press inline-block min-h-11 max-w-full rounded-[1.375rem] border border-line bg-paper px-3.5 py-2.5 text-start text-[0.9375rem] leading-snug text-primary hover:border-gold"
      aria-label={`عرض نص ${KIND_SHORT[passage.kind]}: ${passage.refLabel}`}
    >
      <span className="font-semibold">{KIND_SHORT[passage.kind]}</span>
      <span aria-hidden="true" className="mx-1.5 text-gold">
        ·
      </span>
      {passage.refLabel}
      {passage.kind === "hadith" && passage.grade && <span className="ms-1.5 whitespace-nowrap text-sm text-ink-2">({passage.grade})</span>}
    </button>
  );
}

function HowPanel({ result, open }: { result: AskResult; open: (s: OpenSource, trigger: HTMLElement) => void }) {
  const failed = result.attempts.filter((a) => a.issues.length);
  return (
    <details className={CARD}>
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl px-4 font-heading text-lg font-bold sm:px-5">
        <ChevronIcon className="chevron text-gold-ink" />
        كيف وصلنا لهذا
      </summary>
      <div className="flex flex-col gap-5 border-t border-line px-4 py-4 sm:px-5">
        <section>
          <h3 className="text-base font-bold text-ink-2">عبارات البحث</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {result.queries.map((q) => (
              <li key={q} className="rounded-lg border border-line bg-paper px-2.5 py-1 text-[0.9375rem]">
                {q}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-base font-bold text-ink-2">
            النصوص المسترجعة ({arabicDigits(result.passages.length)}) — بحث بالكلمات وبالمعنى معًا
          </h3>
          <ol className="mt-2 flex flex-col divide-y divide-line">
            {result.passages.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={(e) => open({ passage: p, highlight: null }, e.currentTarget)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-start hover:text-primary"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <EvidenceTag kind={p.kind} grade={null} />
                    <span className="truncate">{p.refLabel}</span>
                  </span>
                  <span className="shrink-0 text-sm text-muted">{p.via.map((v) => (v === "keyword" ? "كلمات" : "معنى")).join(" + ")}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        {result.status === "answer" && (
          <section>
            <h3 className="text-base font-bold text-ink-2">التحقق من كل جملة</h3>
            <ol className="mt-2 flex flex-col gap-3">
              {result.claims.map((c, i) => (
                <li key={i} className="rounded-xl border border-line bg-paper p-3">
                  <p className="text-[0.9375rem]">
                    <span className="font-semibold">الجملة {arabicDigits(i + 1)}: </span>
                    {c.text}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-2">
                    <li className="flex items-start gap-1.5">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                      فحص آلي: الاقتباس موجود حرفيًّا في النص، والنص من المسترجَع
                    </li>
                    <li className="flex items-start gap-1.5">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>
                        المدقق الثاني: مدعومة — <span className="text-ink">{c.modelCheck.reason}</span>
                      </span>
                    </li>
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}

        {failed.length > 0 && (
          <section>
            <h3 className="text-base font-bold text-ink-2">ملاحظات التحقق على المسودات السابقة</h3>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {failed.map((a: AttemptLog) => (
                <li key={a.attempt} className="rounded-xl border border-line bg-paper p-3">
                  <p className="font-semibold text-gold-ink">المسودة {arabicDigits(a.attempt)}: لم تُعرض</p>
                  <ul className="mt-1 list-disc ps-5 text-ink-2">
                    {[...new Set(a.issues.map(issueLabel))].map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                    {a.verdicts
                      .filter((v) => v.verdict === "not_supported")
                      .map((v, i) => (
                        <li key={`v${i}`}>{v.reason}</li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-sm text-muted">
          النموذج: <bdi>{result.models.chat}</bdi> · التضمين: <bdi>{result.models.embed}</bdi> · المدة{" "}
          <span className="tabular-nums">{arabicDigits((result.ms / 1000).toFixed(1))}</span> ث
        </p>
      </div>
    </details>
  );
}

export function ResultView({ result, onNew }: { result: AskResult; onNew: () => void }) {
  const [source, setSource] = useState<OpenSource | null>(null);
  const [copied, setCopied] = useState(false);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const byId = new Map(result.passages.map((p) => [p.id, p]));

  // Remember the trigger explicitly: Safari does not focus buttons on click.
  function open(s: OpenSource, trigger: HTMLElement) {
    lastTrigger.current = trigger;
    setSource(s);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildCopyText(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {result.status === "answer" ? (
        <section aria-labelledby="answer-title" className={`${CARD} p-4 sm:p-5`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 id="answer-title" className="me-auto inline-flex items-center gap-2 text-xl font-bold">
              <InfoIcon className="size-[18px] text-gold-ink" />
              مسودة تحتاج مراجعة الداعية
            </h2>
            {result.verified && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary py-1 ps-1.5 pe-3 text-sm font-semibold text-on-primary">
                <StarMark size={22} className="text-gold" />
                تم التحقق من الإسناد
              </span>
            )}
          </div>

          <StarDivider className="mt-4" />

          <ol className="mt-4 flex flex-col gap-5">
            {result.claims.map((c, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-line bg-paper text-sm font-semibold tabular-nums text-ink-2"
                  aria-hidden="true"
                >
                  {arabicDigits(i + 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[1.0625rem] leading-[1.85] text-pretty">{c.text}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.passage_ids.map((id) => {
                      const p = byId.get(id);
                      if (!p) return null;
                      return (
                        <CitationChip
                          key={id}
                          passage={p}
                          onOpen={(trigger) => open({ passage: p, highlight: c.match.passage_id === id ? c.match : null }, trigger)}
                        />
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {result.missing && (
            <p className="mt-5 rounded-xl border border-line bg-paper p-3 text-[0.9375rem]">
              <span className="font-semibold">لم تغطِّه النصوص: </span>
              {result.missing}
            </p>
          )}

          <StarDivider className="mt-5" />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void copy()}
              className="press inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-on-primary hover:brightness-110"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "نُسخت الإجابة" : "انسخ للمحادثة"}
            </button>
            <button
              type="button"
              onClick={onNew}
              className="press inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-paper px-5 font-semibold text-primary hover:border-gold"
            >
              سؤال جديد
            </button>
          </div>
          <p className="sr-only" role="status">
            {copied ? "نُسخت الإجابة مع مراجعها" : ""}
          </p>
        </section>
      ) : (
        <section aria-labelledby="abstain-title" className={`${CARD} border-s-4 border-s-gold p-4 sm:p-5`}>
          <h2 id="abstain-title" className="flex items-center gap-2 text-xl font-bold text-gold-ink">
            <AlertIcon />
            لا نقدّم إجابة لهذا السؤال
          </h2>
          <p className="mt-3 text-[1.0625rem] leading-[1.85]">{result.abstain_reason}</p>
          {result.missing && (
            <p className="mt-3 text-[0.9375rem] leading-relaxed">
              <span className="font-semibold">ما الذي ينقص: </span>
              {result.missing}
            </p>
          )}
          {result.abstainCause === "verification" && (
            <p className="mt-3 text-sm text-ink-2">كُتبت مسودة، لكنها لم تجتز التحقق مرتين، فلم نعرضها. التفاصيل في «كيف وصلنا لهذا».</p>
          )}
          <StarDivider className="mt-4" />
          <p className="mt-4 text-[0.9375rem] font-medium">
            ننصح بعرض السؤال على مختص من أهل العلم، وإخبار المحاوِر بأنك ستعود إليه بجواب موثّق.
          </p>
          <button
            type="button"
            onClick={onNew}
            className="press mt-4 inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-paper px-5 font-semibold text-primary hover:border-gold"
          >
            سؤال جديد
          </button>
        </section>
      )}

      <HowPanel result={result} open={open} />

      <SourceDialog
        open={source}
        onClose={() => {
          setSource(null);
          lastTrigger.current?.focus();
        }}
      />
    </div>
  );
}
