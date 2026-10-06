// Inline icons: 1.5px stroke, currentColor. Directional icons are drawn for RTL.

type IconProps = { className?: string };

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Outline of an eight-pointed star (khatam): two squares, one turned 45°. */
function khatamPath(cx: number, cy: number, outer: number): string {
  // Inner vertices sit where the two squares' edges cross.
  const inner = outer / Math.SQRT2 / Math.cos(Math.PI / 8);
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

const KHATAM_32 = khatamPath(16, 16, 14);
const KHATAM_INNER_32 = khatamPath(16, 16, 6.5);

/** The project mark and verification seal: an eight-pointed star with a smaller star inside. */
export function StarMark({ className, size = 28 }: IconProps & { size?: number }) {
  return (
    <svg {...base} className={className} viewBox="0 0 32 32" width={size} height={size}>
      <path d={KHATAM_32} />
      <path d={KHATAM_INNER_32} strokeWidth={1.25} />
    </svg>
  );
}

/** Small star used in dividers and ornaments. */
export function SmallStar({ className, size = 12 }: IconProps & { size?: number }) {
  return (
    <svg {...base} className={className} viewBox="0 0 32 32" width={size} height={size} strokeWidth={2.5}>
      <path d={KHATAM_32} />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  );
}

export function ShieldCheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6l7-3z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Chevron pointing toward inline-end in RTL (left); rotated when its <details> opens. */
export function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} width={18} height={18}>
      <path d="M14.5 6l-6 6 6 6" />
    </svg>
  );
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}
