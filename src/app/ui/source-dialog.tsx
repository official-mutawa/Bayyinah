"use client";

// Full source passage in a native modal <dialog> (focus trap, Escape, inert background),
// with the verified supporting quote highlighted inside the stored text.

import { useEffect, useRef } from "react";
import type { RetrievedPassage } from "@/lib/pipeline";
import { CloseIcon } from "./icons";
import { EvidenceTag } from "./evidence-tag";

export interface OpenSource {
  passage: RetrievedPassage;
  highlight: { start: number; end: number } | null;
}

/** Quran and tafsir passages get light ornamental corners. */
function isOrnate(p: RetrievedPassage): boolean {
  return p.kind === "quran" || p.sourceLabel.includes("تفسير");
}

export function SourceDialog({ open, onClose }: { open: OpenSource | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const p = open?.passage;
  const h = open?.highlight;

  return (
    <dialog
      ref={ref}
      className="sheet m-0 mt-auto w-full max-w-none rounded-t-2xl border border-line bg-surface p-0 text-ink shadow-2xl sm:m-auto sm:max-w-xl sm:rounded-2xl"
      aria-labelledby="source-title"
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop closes the dialog.
        if (e.target === ref.current) onClose();
      }}
    >
      {p && (
        <div className="flex max-h-[85dvh] flex-col">
          <header className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-2">{p.sourceLabel}</p>
              <h2 id="source-title" className="mt-0.5 text-xl font-bold text-balance">
                {p.refLabel}
              </h2>
              <div className="mt-2">
                <EvidenceTag kind={p.kind} grade={p.grade} />
              </div>
              {p.ocr && <p className="mt-2 text-sm text-gold-ink">نص مستخرج آليًا من صورة الصفحة (صفحة الملف {p.page})، وقد يحوي أخطاء قراءة.</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="press -me-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-paper hover:text-ink"
              aria-label="إغلاق"
            >
              <CloseIcon />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">
            <div className={isOrnate(p) ? "ornate-corners rounded-xl bg-paper" : ""}>
              <p className={p.kind === "quran" ? "quran-text" : "text-[1.0625rem] leading-[1.9]"}>
                {h && h.start >= 0 ? (
                  <>
                    {p.text.slice(0, h.start)}
                    <mark className="quote">{p.text.slice(h.start, h.end)}</mark>
                    {p.text.slice(h.end)}
                  </>
                ) : (
                  p.text
                )}
              </p>
            </div>
            {h && (
              <p className="mt-4 text-sm text-ink-2">الجزء المظلَّل هو موضع الشاهد كما ورد في النص المخزَّن، وقد طابقه البرنامج حرفيًّا.</p>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
