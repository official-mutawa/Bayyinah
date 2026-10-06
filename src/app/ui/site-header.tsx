import Link from "next/link";
import { StarMark } from "./icons";
import { SiteMenu } from "./site-menu";

/** Top bar. On the empty home state the arch carries the title, so the small brand is hidden. */
export function SiteHeader({ showBrand = true }: { current?: string; showBrand?: boolean }) {
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pb-2 pt-4 sm:pt-6">
      {showBrand && (
        <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-lg text-ink">
          <StarMark size={30} className="text-gold" />
          <span className="font-heading text-[1.75rem] font-bold leading-none text-primary">بيّنة</span>
        </Link>
      )}
      <div className="ms-auto">
        <SiteMenu />
      </div>
    </header>
  );
}
