"use client";

// v2 answer: a short summary first (usable at once in a live conversation), then one section per
// sub-question, verse/hadith/quote blocks rendered from the sources by reference, the gaps, and the
// list of every approved source with what it contributed. Always a draft for the daʿi to review.

import { useRef, useState } from "react";
import type { AskResultV2, V2Block, V2Part, V2SourceStatus } from "@/lib/v2/pipeline-v2";
import type { ResolvedCite } from "@/lib/v2/verify";
import { arabicDigits } from "@/lib/arabic";
import { AlertIcon, CheckIcon, CopyIcon, InfoIcon, StarMark } from "../icons";
import { StarDivider } from "../ornament";
import { buildCopyTextV2 } from "./copy-text-v2";
import { SourceDialogV2, VerseText, type OpenCite } from "./source-dialog-v2";

const CARD = "rounded-2xl border border-line bg-surface shadow-[0_1px_2px_var(--shadow)]";

const STATUS_TEXT: Record<string, string> = {
  no_relevant_evidence: "لم يرد فيه ما يخص السؤال",
  unavailable: "تعذر البحث فيه الآن",
  not_indexed: "لم يُضف إلى الفهرس بعد",
  not_searched: "لم يُبحث فيه، لأن السؤال خارج نطاق الأداة",
};

function sourceStatusText(s: V2SourceStatus): string {
  if (s.status === "found") return s.contributed ?? "نُظر فيه، ولم يُستشهد به في هذه المسودة";
  return STATUS_TEXT[s.status] ?? s.status;
}

function citeLabel(c: ResolvedCite, r: AskResultV2): string {
  if (c.type === "quran" && c.verse) {
    const name = r.verses[`${c.verse.surah}:${c.verse.from}`]?.surahName ?? "";
    return `آية · ${name} ${arabicDigits(c.verse.from)}${c.verse.to > c.verse.from ? `–${arabicDigits(c.verse.to)}` : ""}`;
  }
  if (c.type === "hadith" && c.dorarId) return `حديث · ${r.hadith[c.dorarId]?.book ?? ""}`;
  const rec = r.records[c.recordId];
  return `${c.type === "tafsir" ? "تفسير" : "كتاب"} · ${rec?.refLabel ?? c.recordId}`;
}

function CiteButton({ cite, result, onOpen }: { cite: ResolvedCite; result: AskResultV2; onOpen: (c: ResolvedCite, t: HTMLElement) => void }) {
  const label = citeLabel(cite, result);
  return (
    <button
      type="button"
      onClick={(e) => onOpen(cite, e.currentTarget)}
      className="press inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-[1.375rem] border border-line bg-paper px-3.5 py-2 text-start text-[0.9375rem] leading-snug text-primary hover:border-gold"
      aria-label={`اعرض المصدر والسياق: ${label}`}
    >
      <span className="font-semibold">اعرض المصدر والسياق</span>
      <span aria-hidden="true" className="text-gold">
        ·
      </span>
      <span className="text-ink-2">{label}</span>
    </button>
  );
}

function Block({ b, result, onOpen }: { b: V2Block; result: AskResultV2; onOpen: (c: ResolvedCite, t: HTMLElement) => void }) {
  if (b.kind === "quran") {
    return (
      <>
        {b.cites
          .filter((c) => c.verse)
          .map((c, i) => (
            <figure key={i} className="rounded-xl border border-line bg-paper px-4 py-3">
              <blockquote>
                <VerseText surah={c.verse!.surah} from={c.verse!.from} to={c.verse!.to} verses={result.verses} />
              </blockquote>
              <figcaption className="mt-1 text-sm text-ink-2">
                سورة {result.verses[`${c.verse!.surah}:${c.verse!.from}`]?.surahName}، {c.verse!.from === c.verse!.to ? `الآية ${arabicDigits(c.verse!.from)}` : `الآيات ${arabicDigits(c.verse!.from)}–${arabicDigits(c.verse!.to)}`}
              </figcaption>
              <div className="mt-3 border-t border-line pt-2">
                <p className="text-sm font-bold text-ink-2">التفسير الميسر</p>
                {Array.from({ length: c.verse!.to - c.verse!.from + 1 }, (_, k) => c.verse!.from + k).map((a) => (
                  <p key={a} className="mt-1 text-[0.9375rem] leading-[1.9] text-ink-2">
                    {result.verses[`${c.verse!.surah}:${a}`]?.tafsir}
                  </p>
                ))}
              </div>
            </figure>
          ))}
      </>
    );
  }
  if (b.kind === "hadith") {
    return (
      <>
        {b.cites.map((c, i) => {
          const h = c.dorarId ? result.hadith[c.dorarId] : undefined;
          if (!h) return null;
          return (
            <figure key={i} className="rounded-xl border-s-2 border-gold bg-paper px-4 py-3">
              <blockquote className="text-[1rem] leading-[1.9]">{h.text}</blockquote>
              <figcaption className="mt-2 text-sm text-ink-2">
                {h.book}
                {h.locator ? `، ${h.locator}` : ""} — الحكم: {h.grade} ({h.muhaddith})
              </figcaption>
            </figure>
          );
        })}
      </>
    );
  }
  if (b.kind === "quote") {
    return (
      <>
        {b.cites.map((c, i) => {
          const rec = result.records[c.recordId];
          if (!rec || !rec.quotable) return null;
          const text = rec.sentences.filter((s) => c.sentenceIds.includes(s.id)).map((s) => rec.text.slice(s.start, s.end)).join(" ");
          return (
            <figure key={i} className="rounded-xl border-s-2 border-gold bg-paper px-4 py-3">
              <blockquote className="text-[0.9375rem] leading-[1.9] text-ink-2">«{text}»</blockquote>
              <figcaption className="mt-1 text-sm text-muted">{rec.refLabel}</figcaption>
            </figure>
          );
        })}
      </>
    );
  }
  return (
    <div>
      <p className="text-[1.0625rem] leading-[1.85] text-pretty">{b.text}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {b.cites.map((c, i) => (
          <CiteButton key={i} cite={c} result={result} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function Part({ p, result, onOpen, summary }: { p: V2Part; result: AskResultV2; onOpen: (c: ResolvedCite, t: HTMLElement) => void; summary?: boolean }) {
  return (
    <section className={summary ? "" : "mt-6"}>
      {summary ? <h3 className="font-heading text-lg font-bold text-primary">الخلاصة</h3> : <h3 className="font-heading text-lg font-bold">{p.heading}</h3>}
      <div className="mt-3 flex flex-col gap-4">
        {p.blocks.map((b, i) => (
          <Block key={i} b={b} result={result} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

export function ResultViewV2({ result, onNew }: { result: AskResultV2; onNew: () => void }) {
  const [open, setOpen] = useState<OpenCite | null>(null);
  const [copied, setCopied] = useState(false);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const onOpen = (cite: ResolvedCite, t: HTMLElement) => {
    lastTrigger.current = t;
    setOpen({ cite });
  };
  const hasAnswer = !!result.summary || result.sections.length > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildCopyTextV2(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {hasAnswer ? (
        <section aria-labelledby="answer-title-v2" className={`${CARD} p-4 sm:p-5`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 id="answer-title-v2" className="me-auto inline-flex items-center gap-2 text-xl font-bold">
              <InfoIcon className="size-[18px] text-gold-ink" />
              مسودة تحتاج مراجعة الداعية
            </h2>
            {result.verified ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary py-1 ps-1.5 pe-3 text-sm font-semibold text-on-primary">
                <StarMark size={22} className="text-gold" />
                تم التحقق من الإسناد
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-gold py-1 px-3 text-sm font-semibold text-gold-ink">لم يكتمل التحقق المستقل</span>
            )}
          </div>
          <StarDivider className="mt-4" />
          <div className="mt-4">
            {result.summary && <Part p={result.summary} result={result} onOpen={onOpen} summary />}
            {result.sections.map((s) => (
              <Part key={s.id} p={s} result={result} onOpen={onOpen} />
            ))}
          </div>
          {result.gaps.length > 0 && (
            <div className="mt-5 rounded-xl border border-line bg-paper p-3 text-[0.9375rem]">
              <p className="font-semibold">ما لم تُجب عنه المصادر المعتمدة</p>
              <ul className="mt-1 list-disc ps-5">
                {result.gaps.map((g) => (
                  <li key={g.subQuestion}>{g.text}</li>
                ))}
              </ul>
            </div>
          )}
          <StarDivider className="mt-5" />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => void copy()} className="press inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-on-primary hover:brightness-110">
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "نُسخت الإجابة" : "انسخ للمحادثة"}
            </button>
            <button type="button" onClick={onNew} className="press inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-paper px-5 font-semibold text-primary hover:border-gold">
              سؤال جديد
            </button>
          </div>
          <p className="sr-only" role="status">
            {copied ? "نُسخت الإجابة مع مراجعها" : ""}
          </p>
        </section>
      ) : (
        <section aria-labelledby="abstain-title-v2" className={`${CARD} border-s-4 border-s-gold p-4 sm:p-5`}>
          <h2 id="abstain-title-v2" className="flex items-center gap-2 text-xl font-bold text-gold-ink">
            <AlertIcon />
            {result.status === "out_of_scope" ? "هذا السؤال يُعرض على أهل العلم" : "لا نقدّم مسودة لهذا السؤال"}
          </h2>
          <p className="mt-3 text-[1.0625rem] leading-[1.85]">{result.abstain_reason}</p>
          {result.missing && (
            <p className="mt-3 text-[0.9375rem] leading-relaxed">
              <span className="font-semibold">ما الذي يلزم: </span>
              {result.missing}
            </p>
          )}
          <button type="button" onClick={onNew} className="press mt-4 inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-paper px-5 font-semibold text-primary hover:border-gold">
            سؤال جديد
          </button>
        </section>
      )}

      {result.sources.length > 0 && (
      <section aria-labelledby="sources-consulted" className={`${CARD} p-4 sm:p-5`}>
        <h2 id="sources-consulted" className="font-heading text-lg font-bold">
          المصادر التي نُظر فيها
        </h2>
        <ul className="mt-3 flex flex-col divide-y divide-line">
          {result.sources.map((s) => (
            <li key={s.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <span className="font-medium">{s.label}</span>
              <span className={`text-sm ${s.status === "found" && s.contributed ? "text-primary" : "text-ink-2"}`}>{sourceStatusText(s)}</span>
            </li>
          ))}
        </ul>
        {result.notes.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
            {result.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-ink-2">المسودة لمراجعة الداعية قبل استعمالها، وليست فتوى.</p>
      </section>
      )}

      <SourceDialogV2
        open={open}
        result={result}
        onClose={() => {
          setOpen(null);
          lastTrigger.current?.focus();
        }}
      />
    </div>
  );
}
