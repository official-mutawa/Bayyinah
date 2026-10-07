"use client";

// Citation panel for v2, in this order: the supporting sentence(s) first and highlighted; the
// source line; short surrounding context; then the full parent passage behind a toggle, with the
// span highlighted and scrolled into view. Verse markers render the verse from the Quran data;
// unresolved ones render a labelled placeholder, never empty brackets.

import { useEffect, useRef, useState } from "react";
import type { AskResultV2, RecordView } from "@/lib/v2/pipeline-v2";
import type { ResolvedCite } from "@/lib/v2/verify";
import { arabicDigits } from "@/lib/arabic";
import { CloseIcon } from "../icons";
import { citationPanel, type Segment } from "./panel-model";

export interface OpenCite {
  cite: ResolvedCite;
}

const verseLabel = (s: number, a: number, b: number, verses: AskResultV2["verses"]) => {
  const name = verses[`${s}:${a}`]?.surahName ?? "";
  return a === b ? `سورة ${name}، الآية ${arabicDigits(a)}` : `سورة ${name}، الآيات ${arabicDigits(a)}–${arabicDigits(b)}`;
};

export function VerseText({ surah, from, to, verses, size = "md" }: { surah: number; from: number; to: number; verses: AskResultV2["verses"]; size?: "md" | "sm" }) {
  const parts: string[] = [];
  for (let a = from; a <= to; a++) if (verses[`${surah}:${a}`]) parts.push(`${verses[`${surah}:${a}`].text} ﴿${arabicDigits(a)}﴾`);
  return <span className={`quran-text ${size === "sm" ? "!text-[1.125rem] !leading-[2]" : "!text-[1.25rem] !leading-[2.1]"}`}>{parts.join(" ")}</span>;
}

function Segments({ segments, verses }: { segments: Segment[]; verses: AskResultV2["verses"] }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.verse) {
          // The resolved reference covers the marker and its reference text: show the verse once.
          const first = i === 0 || segments[i - 1].verse?.from !== seg.verse.from || segments[i - 1].verse?.surah !== seg.verse.surah;
          return first ? (
            <span key={i} className="mx-1 inline rounded-md bg-paper px-1.5 py-0.5" title={verseLabel(seg.verse.surah, seg.verse.from, seg.verse.to, verses)}>
              ﴿<VerseText surah={seg.verse.surah} from={seg.verse.from} to={seg.verse.to} verses={verses} size="sm" />﴾
              <span className="ms-1 text-sm text-ink-2">[{verseLabel(seg.verse.surah, seg.verse.from, seg.verse.to, verses)}]</span>
            </span>
          ) : null;
        }
        if (seg.unresolvedVerse)
          return (
            <span key={i} className="mx-1 text-sm text-muted">
              [آية لم يُحدَّد موضعها في المصحف]
            </span>
          );
        return seg.highlight ? (
          <mark key={i} className="quote" data-highlight="">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        );
      })}
    </>
  );
}

export function SourceDialogV2({ open, result, onClose }: { open: OpenCite | null; result: AskResultV2; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fullRef = useRef<HTMLDivElement>(null);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setShowFull(false);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (showFull) fullRef.current?.querySelector("[data-highlight]")?.scrollIntoView({ block: "center" });
  }, [showFull]);

  const c = open?.cite;
  let body: React.ReactNode = null;
  if (c?.type === "quran" && c.verse) {
    const tafsirIds = new Set(c.sentenceIds);
    const tafsirRecords = [];
    for (let a = c.verse.from; a <= c.verse.to; a++) {
      const t = result.records[`muyassar:${c.verse.surah}:${a}`];
      if (t) tafsirRecords.push(t);
    }
    body = (
      <>
        <figure className="ornate-corners rounded-xl bg-paper px-4 py-3">
          <blockquote>
            <VerseText surah={c.verse.surah} from={c.verse.from} to={c.verse.to} verses={result.verses} />
          </blockquote>
          <figcaption className="mt-1 text-sm text-ink-2">{verseLabel(c.verse.surah, c.verse.from, c.verse.to, result.verses)}</figcaption>
        </figure>
        <section className="mt-4">
          <h3 className="text-base font-bold text-ink-2">التفسير الميسر</h3>
          {tafsirRecords.length ? (
            tafsirRecords.map((t) => (
              <p key={t.id} className="mt-2 text-[1.0625rem] leading-[1.9]">
                <Segments segments={t.sentences.map((s) => ({ text: t.text.slice(s.start, s.end) + " ", highlight: tafsirIds.has(s.id) }))} verses={result.verses} />
              </p>
            ))
          ) : (
            <p className="mt-2 text-[1.0625rem] leading-[1.9]">{result.verses[`${c.verse.surah}:${c.verse.from}`]?.tafsir}</p>
          )}
        </section>
      </>
    );
  } else if (c?.type === "hadith" && c.dorarId) {
    const h = result.hadith[c.dorarId];
    body = h ? (
      <>
        <blockquote className="text-[1.0625rem] leading-[1.9]">{h.text}</blockquote>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-2">الحكم</dt>
          <dd>{h.grade}</dd>
          <dt className="text-ink-2">المحدِّث</dt>
          <dd>{h.muhaddith}</dd>
          <dt className="text-ink-2">المصدر</dt>
          <dd>
            {h.book}
            {h.locator ? `، ${h.locator}` : ""}
          </dd>
          <dt className="text-ink-2">الراوي</dt>
          <dd>{h.narrator}</dd>
        </dl>
        {h.alsoGraded.length > 0 && (
          <ul className="mt-2 text-sm text-ink-2">
            {h.alsoGraded.map((g, i) => (
              <li key={i}>
                {g.grade} — {g.muhaddith} ({g.book}
                {g.locator ? `، ${g.locator}` : ""})
              </li>
            ))}
          </ul>
        )}
        <a className="mt-3 inline-block text-sm font-medium text-primary underline" href={`https://dorar.net/hadith/search?q=${encodeURIComponent(h.text.split(/\s+/).slice(0, 8).join(" "))}`} target="_blank" rel="noopener noreferrer">
          ابحث عنه في الموسوعة الحديثية (الدرر السنية)
        </a>
      </>
    ) : null;
  } else if (c) {
    const rec: RecordView | undefined = result.records[c.recordId];
    if (rec) {
      const panel = citationPanel(rec, c.sentenceIds, result.verses);
      body = (
        <>
          <section aria-label="الجملة الشاهدة">
            <p className="text-[1.125rem] leading-[1.95]">
              {panel.supporting.map((s) => (
                <mark key={s.id} className="quote">
                  <Segments segments={s.segments} verses={result.verses} />{" "}
                </mark>
              ))}
            </p>
            {panel.ocrNote && <p className="mt-2 text-sm text-gold-ink">{panel.ocrNote}</p>}
          </section>
          <p className="mt-3 text-sm text-ink-2">{panel.sourceLine}</p>
          {(panel.context.before || panel.context.after) && (
            <section className="mt-4 rounded-xl border border-line bg-paper px-4 py-3">
              <h3 className="text-sm font-bold text-ink-2">السياق</h3>
              <p className="mt-1 text-[0.9375rem] leading-[1.9] text-ink-2">
                {panel.context.before && <span>… {panel.context.before} </span>}
                <span className="font-medium text-ink">[الجملة الشاهدة]</span>
                {panel.context.after && <span> {panel.context.after} …</span>}
              </p>
            </section>
          )}
          <button type="button" onClick={() => setShowFull((v) => !v)} aria-expanded={showFull} className="press mt-4 min-h-11 rounded-xl border border-line bg-paper px-4 font-medium text-primary hover:border-gold">
            {showFull ? "أخفِ النص الكامل" : "اعرض النص الكامل"}
          </button>
          {showFull && (
            <div ref={fullRef} className="mt-3 max-h-[50dvh] overflow-y-auto rounded-xl border border-line px-4 py-3 text-[1.0625rem] leading-[1.9] [white-space:pre-line]">
              <Segments segments={panel.full.segments} verses={result.verses} />
            </div>
          )}
        </>
      );
    }
  }

  const title = c?.type === "quran" && c.verse ? verseLabel(c.verse.surah, c.verse.from, c.verse.to, result.verses) : c?.type === "hadith" && c.dorarId ? result.hadith[c.dorarId]?.book ?? "حديث" : c ? result.records[c.recordId]?.refLabel ?? "" : "";

  return (
    <dialog
      ref={ref}
      className="sheet m-0 mt-auto w-full max-w-none rounded-t-2xl border border-line bg-surface p-0 text-ink shadow-2xl sm:m-auto sm:max-w-xl sm:rounded-2xl"
      aria-labelledby="source-title-v2"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {c && (
        <div className="flex max-h-[85dvh] flex-col">
          <header className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
            <h2 id="source-title-v2" className="min-w-0 flex-1 text-xl font-bold text-balance">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="press -me-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-paper hover:text-ink" aria-label="إغلاق">
              <CloseIcon />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{body}</div>
        </div>
      )}
    </dialog>
  );
}
