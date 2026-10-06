"use client";

// Site menu: a disclosure button with a panel of links. Closes on outside tap, Escape
// (returning focus to the button) and after choosing a link.

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

const REPO = "https://github.com/official-mutawa/Bayyinah";

export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] font-medium text-ink hover:bg-paper";

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "إغلاق القائمة" : "القائمة"}
        onClick={() => setOpen((v) => !v)}
        className="press grid size-11 place-items-center rounded-xl text-primary hover:bg-surface"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className="manuscript absolute end-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl p-3"
        >
          <nav aria-label="القائمة الرئيسية">
            <ul className="flex flex-col">
              <li>
                <Link href="/about" className={item} onClick={() => setOpen(false)}>
                  عن بيّنة
                </Link>
              </li>
              <li>
                <Link href="/sources" className={item} onClick={() => setOpen(false)}>
                  المصادر ومنهجنا
                </Link>
              </li>
              <li>
                <Link href="/evaluation" className={item} onClick={() => setOpen(false)}>
                  نتائج التقييم
                </Link>
              </li>
            </ul>
          </nav>
          <div className="mt-2 border-t border-line px-3 pb-1 pt-3">
            <p className="font-heading text-lg font-bold">تواصل معنا</p>
            <ul className="mt-1 flex flex-col">
              <li>
                <a href="mailto:official.mutawa@gmail.com" className="flex min-h-11 items-center text-[0.9375rem] text-primary underline decoration-from-font underline-offset-2">
                  <bdi>official.mutawa@gmail.com</bdi>
                </a>
              </li>
              <li>
                <a
                  href={`${REPO}/issues/new`}
                  className="flex min-h-11 items-center text-[0.9375rem] text-primary underline decoration-from-font underline-offset-2"
                  rel="noopener"
                >
                  الإبلاغ عن خطأ في استشهاد
                </a>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
