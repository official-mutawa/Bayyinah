import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { arabicDigits } from "@/lib/arabic";
import { SiteFooter } from "../ui/site-chrome";
import { SiteHeader } from "../ui/site-header";

export const metadata: Metadata = { title: "نتائج التقييم — بيّنة" };

interface ResultRow {
  id: string;
  category: string;
  question: string;
  expect: "answer" | "abstain";
  status: "answer" | "abstain" | "error";
  checks: { status: boolean; retrieval: boolean | null; verification: boolean; citesExpected: boolean | null };
  pass: boolean;
  seconds: number;
  attempts: number;
}

interface Results {
  runAt: string;
  baseUrl: string;
  models: { chat: string; embed: string } | null;
  summary: {
    passed: number;
    total: number;
    retrievalHitRate: number;
    abstentionAccuracy: number;
    verifiedAnswerRate: number;
    medianSeconds: number;
  };
  questions: ResultRow[];
}

function loadResults(): Results | null {
  const file = path.join(process.cwd(), "tests", "results.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Results;
}

const STATUS = { answer: "أجاب", abstain: "امتنع", error: "خطأ" } as const;

const CATEGORY: Record<string, string> = {
  direct: "سؤال مباشر",
  "direct (hadith)": "سؤال مباشر (حديث)",
  "different wording from the source": "صياغة تختلف عن لفظ النص",
  "needs two sources": "يحتاج مصدرين",
  compound: "سؤال مركّب",
  "no evidence in our library": "لا دليل عليه في المكتبة",
  "asks for a personal fatwa": "طلب فتوى في حالة شخصية",
  "asks to judge a group": "طلب حكم على جماعة",
};
const pct = (v: number) => `${arabicDigits(Math.round(v * 100))}٪`;

function Mark({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return value ? (
    <span className="font-semibold text-primary">✓<span className="sr-only"> ناجح</span></span>
  ) : (
    <span className="font-semibold text-gold-ink">✗<span className="sr-only"> فاشل</span></span>
  );
}

export default function EvaluationPage() {
  const r = loadResults();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-4">
        <h1 className="mt-2 text-3xl font-bold text-primary">نتائج التقييم</h1>
        <p className="mt-2 text-muted text-pretty">
          عشرة أسئلة عربية لكل منها توقّع صريح: أن يجيب أو أن يمتنع، ومراجع يجب أن تظهر في نتائج البحث. تُشغَّل على الواجهة البرمجية نفسها التي تستعملها الأداة.
        </p>

        {!r ? (
          <p className="mt-6 rounded-2xl bg-surface p-5 border border-line shadow-[0_1px_2px_var(--shadow)]">
            لم تُشغَّل الاختبارات بعد على المصادر المعتمدة. ستظهر النتائج هنا بعد تشغيلها.
          </p>
        ) : (
          <>
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["الأسئلة الناجحة", `${arabicDigits(r.summary.passed)} / ${arabicDigits(r.summary.total)}`],
                ["إصابة البحث", pct(r.summary.retrievalHitRate)],
                ["دقة الامتناع", pct(r.summary.abstentionAccuracy)],
                ["إجابات متحقَّق منها", pct(r.summary.verifiedAnswerRate)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-surface p-4 border border-line shadow-[0_1px_2px_var(--shadow)]">
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-muted">
              تاريخ التشغيل: <time dateTime={r.runAt}>{new Date(r.runAt).toLocaleString("ar-SA-u-nu-arab", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Riyadh" })}</time>
              {r.models && (
                <>
                  {" "}· النموذج <bdi>{r.models.chat}</bdi>
                </>
              )}{" "}
              · الزمن الوسيط {arabicDigits(r.summary.medianSeconds)} ث
            </p>

            <ol className="mt-6 flex flex-col gap-3">
              {r.questions.map((q) => (
                <li key={q.id} className="rounded-2xl bg-surface p-4 border border-line shadow-[0_1px_2px_var(--shadow)]">
                  <div className="flex items-start gap-3">
                    <p className="min-w-0 flex-1 font-medium text-pretty">{q.question}</p>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold ${q.pass ? "bg-primary text-on-primary" : "border border-gold-ink bg-paper text-gold-ink"}`}
                    >
                      {q.pass ? "ناجح" : "فاشل"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {CATEGORY[q.category] ?? q.category} · المتوقّع: {STATUS[q.expect]} · الفعلي: {STATUS[q.status]} · {arabicDigits(q.seconds)} ث
                  </p>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-lg border border-line bg-paper p-2">
                      <dt className="text-muted">القرار</dt>
                      <dd>
                        <Mark value={q.checks.status} />
                      </dd>
                    </div>
                    <div className="rounded-lg border border-line bg-paper p-2">
                      <dt className="text-muted">البحث</dt>
                      <dd>
                        <Mark value={q.checks.retrieval} />
                      </dd>
                    </div>
                    <div className="rounded-lg border border-line bg-paper p-2">
                      <dt className="text-muted">التحقق</dt>
                      <dd>
                        <Mark value={q.checks.verification} />
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
