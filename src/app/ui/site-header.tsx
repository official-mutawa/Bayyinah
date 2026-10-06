import Link from "next/link";
import { StarMark } from "./icons";

/** Top bar. On the empty home state the arch carries the title, so the small brand is hidden. */
export function SiteHeader({ current, showBrand = true }: { current: "home" | "evaluation"; showBrand?: boolean }) {
  return (
    <header className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pb-2 pt-4 sm:pt-6">
      {showBrand && (
        <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-lg text-ink" aria-current={current === "home" ? "page" : undefined}>
          <StarMark size={30} className="text-gold" />
          <span className="font-heading text-[1.75rem] font-bold leading-none text-primary">بيّنة</span>
        </Link>
      )}
      <nav aria-label="الأقسام" className="ms-auto">
        <Link
          href={current === "home" ? "/evaluation" : "/"}
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] font-medium text-primary hover:bg-surface"
        >
          {current === "home" ? "نتائج التقييم" : "العودة إلى الأداة"}
        </Link>
      </nav>
    </header>
  );
}
