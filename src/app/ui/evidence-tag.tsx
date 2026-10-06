import type { PassageKind } from "@/lib/corpus";

const LABEL: Record<PassageKind, string> = { quran: "آية", tafsir: "تفسير", hadith: "حديث", text: "نص" };

/** Evidence status: آية / حديث (with its grade exactly as given in the data) / نص. */
export function EvidenceTag({ kind, grade }: { kind: PassageKind; grade: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-2.5 py-0.5 text-sm font-medium text-primary">
      {LABEL[kind]}
      {kind === "hadith" && grade && (
        <>
          <span aria-hidden="true" className="text-gold">
            ·
          </span>
          <span className="font-normal text-ink-2">{grade}</span>
        </>
      )}
    </span>
  );
}
