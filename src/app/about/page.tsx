import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../ui/site-chrome";
import { SiteHeader } from "../ui/site-header";
import { StarDivider } from "../ui/ornament";

export const metadata: Metadata = { title: "عن بيّنة" };

const STEPS = [
  ["يفهم السؤال", "يحوّل نموذج لغوي سؤالك إلى عبارات بحث عربية، دون أن يضيف افتراضًا لم تقله."],
  ["يبحث في المصادر", "يبحث بالكلمات وبالمعنى معًا في القرآن والتفسير وكتب الشبهات والعقيدة، ويستعلم متصفحك الحديث مباشرة من الدرر السنية."],
  ["يكتب المسودة", "يكتب جملًا قصيرة لا يستند فيها إلا إلى النصوص المسترجعة، ولا يكتب نص آية من عنده أبدًا."],
  ["يتحقق مرتين", "يتأكد البرنامج أن كل اقتباس موجود حرفيًّا في نصه، ثم يحكم نموذج ثانٍ على كل جملة: هل يدعمها نصها فعلًا؟"],
  ["يجيب أو يمتنع", "إذا اجتازت كل جملة التحقق عُرضت مع مصادرها، وإلا امتنع وبيّن ما الذي ينقص."],
];

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-4">
        <h1 className="mt-2 text-3xl font-bold text-primary">عن بيّنة</h1>
        <p className="mt-3 text-[1.0625rem] leading-[1.9] text-ink-2 text-pretty">
          بيّنة أداة للداعية في أثناء حواره مع غير المسلم: يكتب السؤال الصعب كما سمعه، فيحصل على مسودة إجابة عربية قصيرة، كل جملة فيها مسندة
          إلى نصها من المصادر المعتمدة ومُتحقَّق منها.
        </p>

        <StarDivider className="my-6" />

        <section aria-labelledby="how">
          <h2 id="how" className="text-2xl font-bold">كيف تعمل</h2>
          <ol className="mt-4 flex flex-col gap-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary font-semibold text-on-primary">
                  {(i + 1).toLocaleString("ar-SA-u-nu-arab")}
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="mt-0.5 leading-[1.85] text-ink-2">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <StarDivider className="my-6" />

        <section aria-labelledby="limits" className="manuscript rounded-2xl px-5 py-5 sm:px-7">
          <h2 id="limits" className="text-2xl font-bold">حدودها</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 ps-5 leading-[1.85]">
            <li>ليست فتوى ولا تُغني عن أهل العلم، ولا تجيب عن حالة شخصية تحتاج فتوى.</li>
            <li>تمتنع إذا لم تكفِ النصوص، أو احتاج الجواب اجتهادًا أو سياقًا لا تذكره النصوص، أو كان السؤال حكمًا على شخص أو جماعة.</li>
            <li>ما تكتبه مسودة تحتاج مراجعة الداعية قبل أن يستعملها.</li>
            <li>لا تحفظ أسئلتك ولا تسجّلها.</li>
          </ul>
        </section>

        <p className="mt-6 text-ink-2">
          تفاصيل كل مصدر في <Link href="/sources" className="text-primary underline decoration-from-font underline-offset-2">المصادر ومنهجنا</Link>، ونتائج الاختبار في{" "}
          <Link href="/evaluation" className="text-primary underline decoration-from-font underline-offset-2">نتائج التقييم</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
