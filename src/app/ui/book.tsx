"use client";

// A drawn book that opens and turns its pages while the real stages run. Pages carry only
// ruled lines, never text. Remount it (change its key) to open a new source's book.
// The motion is CSS keyframes that start on mount (see globals.css).

import type { PassageKind } from "@/lib/corpus";
import { StarMark } from "./icons";

function Emblem({ kind }: { kind: PassageKind | null }) {
  if (kind === "hadith") {
    // Four interlaced circles.
    return (
      <svg width="38" height="38" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
        <circle cx="11" cy="16" r="5" />
        <circle cx="21" cy="16" r="5" />
        <circle cx="16" cy="11" r="5" />
        <circle cx="16" cy="21" r="5" />
      </svg>
    );
  }
  if (kind === "text") {
    // A framed panel of ruled lines.
    return (
      <svg width="34" height="34" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
        <rect x="6" y="5" width="20" height="22" rx="1.5" />
        <path d="M10 11h12M10 16h12M10 21h8" />
      </svg>
    );
  }
  return <StarMark size={38} />;
}

export function Book({ kind }: { kind: PassageKind | null }) {
  return (
    <div className="book-stage" aria-hidden="true">
      <div className="book" data-kind={kind ?? "quran"}>
        <div className="book-half book-page" />
        <div className="book-half book-leaf" />
        <div className="book-half book-leaf" />
        <div className="book-half book-leaf" />
        <div className="book-half book-cover">
          <div className="book-face book-face-front">
            <Emblem kind={kind} />
          </div>
          <div className="book-face book-face-back" />
        </div>
      </div>
      {/* Shown instead of the moving book when reduced motion is preferred. */}
      <svg className="book-static text-primary" width="72" height="56" viewBox="0 0 72 56" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M36 12c-6-5-16-6-28-5v38c12-1 22 0 28 5 6-5 16-6 28-5V7c-12-1-22 0-28 5z" />
        <path d="M36 12v38" />
        <path d="M14 18h14M14 25h14M14 32h10M44 18h14M44 25h14M44 32h10" stroke="var(--line)" />
      </svg>
    </div>
  );
}
