// Home hero: the «بيّنة» wordmark (IBM Plex Sans Arabic Bold, as in the first version of the
// site) framed by two faint minarets, then the tagline, over the floating library.
// The minaret's white background disappears into the page colour through mix-blend-mode: multiply.

import Image from "next/image";
import { StarMark } from "./icons";

function Minaret() {
  return (
    <Image
      src="/minaret.webp"
      alt=""
      aria-hidden="true"
      width={559}
      height={1000}
      className="h-[132px] w-auto shrink-0 select-none opacity-[0.22] mix-blend-multiply sm:h-[200px]"
      draggable={false}
    />
  );
}

export function HomeHero() {
  return (
    <div className="mx-auto flex max-w-[34rem] flex-col items-center pb-8 pt-4 text-center sm:pb-10 sm:pt-8">
      <div className="flex items-end justify-center gap-2 sm:gap-8">
        <Minaret />
        <div className="flex flex-col items-center">
          <StarMark size={40} className="text-gold" />
          <h1 className="mt-3 font-sans text-[clamp(3.5rem,16vw,5rem)] font-bold leading-[1.2] text-primary">بيّنة</h1>
        </div>
        <Minaret />
      </div>
      <p className="mt-3 font-heading text-[clamp(1.125rem,4.8vw,1.375rem)] leading-[1.7] text-ink-2 text-balance">
        مسودة إجابة لسؤال المحاوِر، كل جملة فيها مسندة إلى نصها ومُتحقَّق منها.
      </p>
    </div>
  );
}
