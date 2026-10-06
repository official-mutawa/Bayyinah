// Home hero: the khatam, the «بيّنة» wordmark (IBM Plex Sans Arabic Bold, as in the first
// version of the site) and the tagline, centred over the floating library.

import { StarMark } from "./icons";

export function HomeHero() {
  return (
    <div className="mx-auto flex max-w-[30rem] flex-col items-center pb-8 pt-6 text-center sm:pb-10 sm:pt-10">
      <StarMark size={40} className="text-gold" />
      <h1 className="mt-3 font-sans text-[clamp(3.5rem,16vw,5rem)] font-bold leading-[1.2] text-primary">بيّنة</h1>
      <p className="mt-3 font-heading text-[clamp(1.125rem,4.8vw,1.375rem)] leading-[1.7] text-ink-2 text-balance">
        مسودة إجابة لسؤال المحاوِر، كل جملة فيها مسندة إلى نصها ومُتحقَّق منها.
      </p>
    </div>
  );
}
