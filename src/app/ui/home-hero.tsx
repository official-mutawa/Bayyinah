// Home hero: a pointed arch (mihrab-like silhouette) drawn in SVG. Its frame carries a fine
// mashrabiya lattice in gold; inside, on plain paper, the title and tagline. No calligraphy,
// no verses, no building imagery: only geometry.

import { StarMark } from "./icons";

const OUTER = "M14 430V196C14 104 98 48 200 8C302 48 386 104 386 196V430Z";
const INNER = "M44 430V202C44 124 116 78 200 42C284 78 356 124 356 202V430Z";
const HAIRLINE = "M54 430V204C54 130 122 87 200 54C278 87 346 130 346 204V430";

export function HomeHero() {
  return (
    <div className="relative mx-auto w-full max-w-[26rem] sm:max-w-[32rem]">
      <svg viewBox="0 0 400 430" className="block w-full" aria-hidden="true">
        <defs>
          <pattern id="mashrabiya" width="15" height="15" patternUnits="userSpaceOnUse">
            <g fill="none" stroke="var(--gold)" strokeWidth="0.8">
              <rect x="4.75" y="4.75" width="5.5" height="5.5" />
              <rect x="4.75" y="4.75" width="5.5" height="5.5" transform="rotate(45 7.5 7.5)" />
              <path d="M0 7.5H3.6M11.4 7.5H15M7.5 0V3.6M7.5 11.4V15" />
            </g>
          </pattern>
        </defs>
        {/* Opaque paper window: the floating books pass behind the arch, never through the text. */}
        <path d={OUTER} fill="var(--paper)" />
        <path d={`${OUTER} ${INNER}`} fillRule="evenodd" fill="url(#mashrabiya)" opacity="0.5" />
        <path d={OUTER} fill="none" stroke="var(--gold)" strokeWidth="1.6" />
        <path d={INNER} fill="none" stroke="var(--gold)" strokeWidth="1.1" />
        <path d={HAIRLINE} fill="none" stroke="var(--gold)" strokeWidth="0.7" opacity="0.6" />
      </svg>

      <div className="absolute inset-x-[14%] top-[17%] flex flex-col items-center text-center">
        <StarMark size={34} className="text-gold" />
        <h1 className="mt-3 text-[clamp(3.25rem,15vw,5.25rem)] font-bold leading-[1.15] text-primary">بيّنة</h1>
        <p className="mt-3 font-heading text-[clamp(1.0625rem,4.6vw,1.3rem)] leading-[1.7] text-ink-2 text-balance">
          مسودة إجابة لسؤال المحاوِر، كل جملة فيها مسندة إلى نصها ومُتحقَّق منها.
        </p>
      </div>
    </div>
  );
}
