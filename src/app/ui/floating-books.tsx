"use client";

// The floating library behind the home hero: generic drawn books (no text, never a Mushaf)
// drifting very slowly. Transform-only motion, paused when the tab is hidden or the layer is
// faded out; reduced motion shows the same composition standing still.

import { useEffect } from "react";
import type { CSSProperties } from "react";

type Variant = "cover" | "spine" | "lying";
type Color = "green" | "burgundy" | "navy" | "brown";

interface FloatingBook {
  v: Variant;
  c: Color;
  /** Width in px; height follows the variant's proportions */
  w: number;
  top: string;
  left: string;
  r: number;
  dr: number;
  dx: number;
  dy: number;
  d: number;
  o: number;
  b: number;
}

// Positions are physical on purpose: this is a picture, not reading-order layout.
const BOOKS: FloatingBook[] = [
  { v: "cover", c: "green", w: 62, top: "5%", left: "3%", r: -8, dr: 4, dx: 14, dy: 22, d: 46, o: 0.17, b: 1 },
  { v: "spine", c: "burgundy", w: 22, top: "12%", left: "88%", r: 6, dr: -3, dx: -10, dy: 26, d: 38, o: 0.15, b: 1.2 },
  { v: "lying", c: "navy", w: 112, top: "36%", left: "-4%", r: 4, dr: -2, dx: 18, dy: -14, d: 52, o: 0.13, b: 1.8 },
  { v: "cover", c: "brown", w: 50, top: "44%", left: "84%", r: 10, dr: -5, dx: -16, dy: 18, d: 41, o: 0.16, b: 1 },
  { v: "spine", c: "green", w: 18, top: "2%", left: "60%", r: -4, dr: 3, dx: 8, dy: 20, d: 57, o: 0.11, b: 2.2 },
  { v: "cover", c: "navy", w: 40, top: "63%", left: "6%", r: 7, dr: -4, dx: 12, dy: -18, d: 34, o: 0.14, b: 1.4 },
  { v: "lying", c: "burgundy", w: 96, top: "72%", left: "72%", r: -5, dr: 3, dx: -14, dy: -12, d: 49, o: 0.12, b: 1.8 },
  { v: "cover", c: "burgundy", w: 54, top: "22%", left: "24%", r: 3, dr: -3, dx: 10, dy: 16, d: 60, o: 0.1, b: 2.6 },
  { v: "spine", c: "brown", w: 20, top: "55%", left: "42%", r: -9, dr: 4, dx: -8, dy: 14, d: 44, o: 0.1, b: 2.6 },
  { v: "cover", c: "green", w: 36, top: "84%", left: "46%", r: 5, dr: -3, dx: 10, dy: -16, d: 36, o: 0.15, b: 1.4 },
];

function BookShape({ v, c }: { v: Variant; c: Color }) {
  const fill = `var(--book-${c})`;
  const gold = "var(--gold)";
  if (v === "spine") {
    return (
      <svg viewBox="0 0 20 92" className="block w-full">
        <rect x="0.5" y="0.5" width="19" height="91" rx="2" fill={fill} />
        <path d="M2 10H18M2 13H18M2 79H18M2 82H18" stroke={gold} strokeWidth="1" />
        <path d="M10 40l4 6-4 6-4-6z" fill="none" stroke={gold} strokeWidth="1" />
      </svg>
    );
  }
  if (v === "lying") {
    return (
      <svg viewBox="0 0 110 26" className="block w-full">
        <rect x="0.5" y="0.5" width="109" height="6" rx="2" fill={fill} />
        <rect x="3" y="6.5" width="104" height="13" fill="var(--paper)" />
        <path d="M5 10H105M5 13H105M5 16H105" stroke="var(--line)" strokeWidth="1" />
        <rect x="0.5" y="19.5" width="109" height="6" rx="2" fill={fill} />
        <path d="M8 0.5V6.5M8 19.5V25.5" stroke={gold} strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 88" className="block w-full">
      <rect x="0.5" y="0.5" width="63" height="87" rx="3" fill={fill} />
      {/* Spine on the right: Arabic books open from the right. */}
      <path d="M55 1V87" stroke={gold} strokeWidth="1" opacity="0.8" />
      <rect x="6" y="7" width="44" height="74" rx="1.5" fill="none" stroke={gold} strokeWidth="1" />
      <path d="M28 34l6 10-6 10-6-10z" fill="none" stroke={gold} strokeWidth="1.2" />
    </svg>
  );
}

export function FloatingBooks({ visible }: { visible: boolean }) {
  // Pause the drift whenever the tab is not visible.
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      root.dataset.tabHidden = document.hidden ? "true" : "false";
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return (
    <div className="library" data-visible={visible} aria-hidden="true">
      {BOOKS.map((bk, i) => (
        <div
          key={i}
          className="float-book"
          style={
            {
              top: bk.top,
              left: bk.left,
              width: bk.w,
              "--r": `${bk.r}deg`,
              "--dr": `${bk.dr}deg`,
              "--dx": `${bk.dx}px`,
              "--dy": `${bk.dy}px`,
              "--d": `${bk.d}s`,
              "--delay": `${-((i * 7) % bk.d)}s`,
              "--o": bk.o,
              "--b": `${bk.b}px`,
            } as CSSProperties
          }
        >
          <BookShape v={bk.v} c={bk.c} />
        </div>
      ))}
    </div>
  );
}
