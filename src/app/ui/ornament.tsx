import { SmallStar } from "./icons";

/** Small star divider between answer sections: two hairlines and a gold star. Decorative only. */
export function StarDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 text-gold ${className}`} aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      <SmallStar />
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
