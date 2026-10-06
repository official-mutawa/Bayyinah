// Sources and method, generated from sources/manifest.json and data/ingest-log.json.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { loadManifest } from "@/lib/corpus";
import type { SourceInfo } from "@/lib/corpus";
import { arabicDigits } from "@/lib/arabic";
import { SiteFooter } from "../ui/site-chrome";
import { SiteHeader } from "../ui/site-header";
import { StarDivider } from "../ui/ornament";

export const metadata: Metadata = { title: "المصادر ومنهجنا — بيّنة" };

function counts(): Record<string, number> {
  const file = path.join(process.cwd(), "data", "ingest-log.json");
  if (!existsSync(file)) return {};
  const log = JSON.parse(readFileSync(file, "utf8")) as { sources: { id: string; count: number }[] };
  return Object.fromEntries(log.sources.map((s) => [s.id, s.count]));
}

function usage(s: SourceInfo): string {
  if (s.live) return "يُستعلم من متصفح المستخدم مباشرة وقت السؤال عبر الواجهة الرسمية للدرر السنية (JSONP)، ويُعرض كل حديث مع حكم المحدث ومصدره كما تعيدهما الواجهة دون تعديل.";
  if (s.kind === "quran") return "مصدر نص الآيات الوحيد: تُعرض الآيات كما هي مخزنة حرفيًّا، ولا يكتب النموذج نص آية أبدًا.";
  if (s.ocr)
    return `مقطع لكل صفحة، نصه مستخرج آليًا من صورة الصفحة (OCR) دون أي تعديل بنموذج لغوي، وقد يحوي أخطاء قراءة؛ أرقام الصفحات هي صفحات ملف PDF. ${s.kind === "tafsir" ? "لا يُعرض منه نص آية على أنه استشهاد قرآني." : "ما يعرض فيه المؤلف سؤالًا أو شبهة لا يُستشهد به على أنه قوله، ولا يُعرض منه نص آية على أنه استشهاد قرآني."}`;
  if (s.kind === "tafsir") return "مقطع لكل آية مربوط برقمها، يُسترجع مع الآية التي يشرحها.";
  return "مقاطع للبحث والاستشهاد بكلام المؤلف؛ ما يعرض فيه المؤلف سؤالًا أو شبهة لا يُستشهد به على أنه قوله.";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 font-semibold text-ink sm:w-28">{label}</dt>
      <dd className="text-ink-2 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

export default function SourcesPage() {
  const sources = loadManifest();
  const n = counts();
  const used = sources.filter((s) => !s.excluded);
  const excluded = sources.filter((s) => s.excluded);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-4">
        <h1 className="mt-2 text-3xl font-bold text-primary">المصادر ومنهجنا</h1>
        <p className="mt-3 leading-[1.9] text-ink-2 text-pretty">
          المصادر من الحقيبة العلمية الرسمية للتحدي ومصادر معتمدة. نص القرآن من مصدر القرآن وحده، والحديث من الدرر السنية وحدها، ولا يُؤخذ نص آية
          أو حديث من الكتب. لا يكتب نموذج لغوي نصًّا دينيًّا ولا «ينظّفه»: النصوص مستخرجة آليًّا بقواعد ثابتة، وتُعرض كما خُزّنت.
        </p>

        <StarDivider className="my-6" />

        <ul className="flex flex-col gap-4">
          {used.map((s) => (
            <li key={s.id} className="manuscript rounded-2xl px-5 py-5 sm:px-7">
              <h2 className="text-xl font-bold">{s.label}</h2>
              <dl className="mt-3 flex flex-col gap-2 text-[0.9375rem] leading-relaxed">
                <Row label="المصدر" value={s.attribution} />
                {s.version && <Row label="الإصدار" value={s.version} />}
                <Row label="الاستعمال" value={usage(s)} />
                {n[s.id] !== undefined && <Row label="عدد المقاطع" value={arabicDigits(n[s.id])} />}
                <Row
                  label="طريقة الاستخراج"
                  value={s.live ? "اتصال مباشر بالواجهة البرمجية" : s.ocr ? "استخراج ضوئي (OCR) من صور الصفحات" : s.url?.includes("quranpedia") ? "ملف بيانات رسمي منشور" : "طبقة النص في ملف PDF (دون OCR)"}
                />
                <Row label="الترخيص" value={s.license} />
                {s.url && (
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                    <dt className="shrink-0 font-semibold text-ink sm:w-28">الرابط</dt>
                    <dd>
                      <a href={s.url} rel="noopener" className="text-primary underline decoration-from-font underline-offset-2 [overflow-wrap:anywhere]">
                        <bdi>{s.url}</bdi>
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>

        {excluded.length > 0 && (
          <section aria-labelledby="pending" className="mt-8">
            <h2 id="pending" className="text-2xl font-bold">مصادر معتمدة لم تُدرج بعد</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {excluded.map((s) => (
                <li key={s.id} className="rounded-xl border border-line bg-paper p-4">
                  <p className="font-semibold">{s.label}</p>
                  <p className="mt-1 text-[0.9375rem] text-ink-2">{s.excluded}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
