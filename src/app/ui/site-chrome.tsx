import { loadManifest } from "@/lib/corpus";

/** Footer: attribution for every approved source, from sources/manifest.json, plus the disclaimer. */
export function SiteFooter() {
  const sources = loadManifest();
  return (
    <footer className="mt-auto pt-12">
      <div className="mx-auto w-full max-w-2xl px-4 pb-8 text-sm leading-relaxed text-ink-2">
        <h2 className="text-lg font-bold text-ink">المصادر</h2>
        {sources.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {sources.map((s) => (
              <li key={s.id}>
                <span className="font-medium text-ink">{s.label}</span>: {s.attribution}
                {s.notice && <span className="block">{s.notice}</span>}
                <span className="block">
                  الترخيص: {s.license}
                  {s.url && (
                    <>
                      {" · "}
                      <a href={s.url} className="text-primary underline decoration-from-font underline-offset-2" rel="noopener">
                        المصدر
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2">المصادر المعتمدة قيد الإعداد، وستظهر هنا مع بيان نسبتها وترخيصها.</p>
        )}
        <p className="mt-5">بيّنة أداة مساعدة تكتب مسودات من نصوص المصادر لتراجعها قبل استعمالها، وليست فتوى ولا تُغني عن أهل العلم.</p>
      </div>
    </footer>
  );
}
