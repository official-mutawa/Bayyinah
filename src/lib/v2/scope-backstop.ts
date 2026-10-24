// Scope backstop: a fixed phrase list checked before the planner, with no model call. When it fires,
// the question gets the referral for its kind and nothing is searched. It is deliberately narrow:
// whole phrases only, and a judgment needs both a verdict and a named target. Everything else is
// decided by the planner.
//
// Rules, checked in this order:
//   disputed                         a major disputed issue (List A)
//   fate-of-person                   FATE + a named person
//   label-person-or-muslim-group     LABEL + a named person or a Muslim group (takfir)
//   INTERIM-afterlife-fate-of-group  FATE + a Muslim group, another religion or a general class,
//                                    unless the question asks why, or about wisdom or justice
// "Is religion X disbelief" (LABEL + another religion or class) is doctrinal and goes to the planner.

export type BackstopKind = "major_disputed_issue" | "judgment_on_person_or_group";
export type BackstopRule = "disputed" | "fate-of-person" | "label-person-or-muslim-group" | "INTERIM-afterlife-fate-of-group";

export interface BackstopHit {
  kind: BackstopKind;
  rule: BackstopRule;
  /** The phrases that matched, for traces and tests (never shown to users) */
  why: string;
}

/** Normalize for matching: diacritics and tatweel removed, alef/hamza forms, ta marbuta and alef maqsura unified, punctuation to spaces. */
export function normalizeForScope(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AR_PREFIX = "(?:و|ف|ب|ل|ك|وب|ول|فب|فل)?";
/** Whole Arabic phrase with one attached prefix; after ل the alef of ال drops (للمسيحيين). */
const ar = (p: string): RegExp => {
  const n = normalizeForScope(p);
  const lil = n.startsWith("ال") ? `|(?:و|ف)?لل${n.slice(2)}` : "";
  return new RegExp(`(?:^| )(?:${AR_PREFIX}${n}${lil})(?= |$)`);
};
/** Whole English phrase (a regex fragment over normalized, lowercased text). */
const en = (p: string): RegExp => new RegExp(`(?:^| )${p}(?= |$)`);
const re = (p: string): RegExp => new RegExp(`(?:^| )${p}(?= |$)`);

const RULERS_OPT = "(?:(?:the|a|an|our|their|muslim|unjust|tyrannical|oppressive) )*";

// ---------- List A: major disputed issues (the phrase alone is enough) ----------

export const DISPUTED: Record<string, RegExp[]> = {
  "العذر بالجهل": [
    ...["العذر بالجهل", "عذر الجاهل", "يعذر الجاهل", "يعذر بالجهل", "يعذر بجهله", "معذور بجهله", "معذورا بجهله", "الإعذار بالجهل"].map(ar),
    ...["excused (?:by|for|because of|due to) (?:his |her |their )?ignorance", "ignorance (?:as )?an excuse", "excuse of ignorance", "excused if (?:he|she|they) (?:is|are|was|were) ignorant"].map(en),
  ],
  "التكفير": [
    ...["تكفير المسلم", "تكفير المسلمين", "تكفير المعين", "تكفير الحاكم", "تكفير الحكام", "تكفير أهل القبلة", "حكم التكفير", "ضوابط التكفير", "موانع التكفير", "شروط التكفير", "مسألة التكفير", "مسائل التكفير"].map(ar),
    ...["takfir", "declar(?:e|ing) (?:a |other |fellow )?muslims? (?:a |as )?(?:kafirs?|kuffar|disbelievers?|apostates?|unbelievers?)"].map(en),
  ],
  "الخروج على الحاكم": [
    ...["الخروج على الحاكم", "الخروج على الحكام", "الخروج على ولي الأمر", "الخروج على ولاة الأمر", "الخروج على الأئمة", "الخروج على السلطان", "الثورة على الحاكم", "الثورة على الحكام"].map(ar),
    ...[`rebel(?:ling|lion|s)? against ${RULERS_OPT}(?:rulers?|governments?|leaders?)`, `revolt(?:ing|s)? against ${RULERS_OPT}(?:rulers?|governments?|leaders?)`, `overthrow(?:ing)? ${RULERS_OPT}(?:rulers?|governments?)`].map(en),
  ],
};

// ---------- List B: judgments on people ----------

/** Paradise, Hell, salvation or punishment in the afterlife. */
export const FATE: RegExp[] = [
  ...["في النار", "إلى النار", "يدخلون النار", "يدخل النار", "سيدخلون النار", "سيدخل النار", "من أهل النار", "مخلدون في النار", "مخلد في النار", "مصير", "مصيرهم", "مصيره", "مصيرها",
    "في الجنة", "يدخلون الجنة", "يدخل الجنة", "سيدخلون الجنة", "سيدخل الجنة", "من أهل الجنة",
    "يعذب", "يعذبون", "سيعذب", "سيعذبون", "معذبون", "معذبين", "عذاب", "العذاب", "ينجو", "ينجون", "سينجو", "النجاة", "ناجون", "ناجين", "الخلاص", "يخلد", "يخلدون", "يغفر له", "يغفر لهم", "يغفر الله"].map(ar),
  // A verb of entering, then up to two words, then Paradise or Hell: «هل يدخل المسيحيون الجنة».
  re("(?:و|ف)?(?:س)?(?:ي|ت)دخل(?:ون|ان)?(?: [^ ]+){0,2} (?:ال)?(?:جنه|نار)"),
  // "What happens to …" counts only for the afterlife, or for people the message never reached
  // ("what happens to Christians in a Muslim country" is about this life).
  re("(?:ماذا|ما الذي) (?:س)?يحدث ل[^ ]*(?: [^ ]+){0,8} (?:بعد الموت|يوم القيامه|في الاخره)"),
  re("(?:ماذا|ما الذي) (?:س)?يحدث لمن لم"),
  re("ما حال من لم"),
  ...["go(?:es|ing)? to (?:hell|heaven|paradise)", "(?:be|is|are|end up|ends up|burn|burns|burning) in (?:hell|hellfire|the fire|heaven|paradise)", "enters? (?:paradise|heaven|hell)", "fate of", "damned",
    "(?:be|is|are|get|gets|been) (?:saved|punished|forgiven|tormented)", "salvation", "punish(?:es|ing)?(?: [a-z]+){0,2} (?:forever|eternally|in hell)", "punish (?:non muslims?|disbelievers?|unbelievers?|infidels?|kafirs?|pagans?)",
    "(?:are|is|will|can|could) (?:[a-z]+ ){1,3}(?:be )?(?:saved|forgiven|punished)",
    "what (?:happens|will happen|would happen) to (?:[a-z]+ ){1,8}(?:after (?:death|they die|he dies|she dies)|in the afterlife|in the hereafter|on the day of judge?ment)",
    "what (?:happens|will happen|would happen) to (?:people|those|someone|anyone|a person|children) who (?:never|did not|didn t|have not|haven t|has not|hasn t)",
    "what becomes of"].map(en),
];

/** Disbeliever or apostate. */
export const LABEL: RegExp[] = [
  ...["كفار", "كافر", "كافرة", "كافرون", "كافرين", "مرتد", "مرتدون", "مرتدين", "خارج من الملة", "خارجون من الملة"].map(ar),
  ...["kafirs?", "kuffar", "disbelievers?", "unbelievers?", "infidels?", "apostates?", "out of islam", "outside islam"].map(en),
];

export const PERSONS: RegExp[] = [
  ...["أبي", "أمي", "والدي", "والدتي", "والداي", "أبواي", "جدي", "جدتي", "أخي", "أختي", "ابني", "ابنتي", "صديقي", "صديقتي", "زوجي", "زوجتي", "جاري", "عمي", "خالي", "زميلي", "البابا"].map(ar),
  ...["my (?:[a-z]+ ){0,2}(?:father|mother|dad|mom|mum|parents|grandfather|grandmother|grandparents|brother|sister|son|daughter|friend|husband|wife|neighbou?r|uncle|aunt|colleague)", "the pope"].map(en),
];

export const MUSLIM_GROUPS: RegExp[] = [
  ...["الشيعة", "الشيعي", "الرافضة", "الصوفية", "الصوفي", "الأشاعرة", "الماتريدية", "القاديانية", "الأحمدية", "الإباضية"].map(ar),
  ...["shias?", "shiites?", "sufis?", "ash aris?", "asharis?", "ahmadis?", "qadianis?", "ibadis?"].map(en),
];

export const OTHER_RELIGIONS: RegExp[] = [
  ...["المسيحيين", "المسيحيون", "المسيحي", "النصارى", "النصراني", "اليهود", "اليهودي", "الهندوس", "الهندوسي", "البوذيين", "البوذيون", "البوذي", "الملحدين", "الملحدون", "الملحد"].map(ar),
  ...["christians?", "jews?", "jewish people", "hindus?", "buddhists?", "atheists?"].map(en),
];

// ---------- INTERIM: until the sharia reviewer sets the answering policy ----------
// The afterlife fate of any group is not answered. To relax it, change these two lists and the
// INTERIM rule in scopeBackstop (and INTERIM_PLANNER_POLICY); nothing else depends on them.

export const INTERIM_AFTERLIFE_CLASSES: RegExp[] = [
  ...["غير المسلمين", "غير المسلم", "غير مسلم", "الكفار", "الكافر", "الكافرين", "الكافرون", "المشركين", "المشركون", "المشرك", "غير المؤمنين",
    "أهل الكتاب", "أصحاب الأديان", "أتباع الأديان", "الأديان الأخرى", "الديانات الأخرى", "من لم تبلغه", "لم تبلغه", "لم تبلغهم", "لم تصله", "لم تصلهم",
    "لم يسمع بالإسلام", "لم يسمعوا بالإسلام", "لم يسمع عن الإسلام", "لم يسمعوا عن الإسلام", "أهل الفترة", "أطفال غير المسلمين", "أطفال المشركين", "أطفال الكفار", "أولاد الكفار",
    "ليس مسلمًا", "ليسوا مسلمين", "على غير الإسلام"].map(ar),
  ...["non muslims?", "disbelievers?", "unbelievers?", "infidels?", "kafirs?", "kuffar", "pagans?", "polytheists?", "people of (?:other|different) (?:religions|faiths)", "followers of other (?:religions|faiths)", "other religions",
    "people of the book", "(?:never|not) heard (?:of|about) islam", "never received the message", "(?:not|never) reached by the message", "children of non muslims", "(?:is|are|was|were) not (?:a )?muslims?", "isn t (?:a )?muslim", "aren t muslims?"].map(en),
];

/** Why, wisdom or justice questions pass the INTERIM rule (it blocks only whether / who questions). */
export const INTERIM_WHY_EXCEPTION: RegExp[] = [
  ...["لماذا", "ما الحكمة", "ما حكمة", "حكمة الله", "كيف يتفق", "كيف يتوافق", "كيف ينسجم", "كيف يجتمع", "كيف يكون عدلا", "كيف يكون هذا عدلا", "أين العدل", "أين الرحمة", "أليس ظلما", "أليس هذا ظلما", "أليس ذلك ظلما", "أليس من الظلم"].map(ar),
  ...["why", "what is the wisdom", "how is (?:it|this|that) (?:fair|just)", "how can (?:a |an )?(?:merciful|just|loving|fair|good) god", "how does (?:it|this|that) fit with", "how is (?:it|this|that) compatible with",
    "reconcile", "isn t (?:it|this|that) (?:unfair|unjust|cruel)", "is (?:it|this|that) (?:fair|just)"].map(en),
];

/** The same interim policy, stated for the planner. */
export const INTERIM_PLANNER_POLICY = `  * Interim policy: the afterlife fate (Paradise, Hell, salvation or punishment) of ANY group or class of people is judgment_on_person_or_group: a named religion, a Muslim group, non-Muslims, disbelievers, people of other religions, those the message never reached, children of non-Muslims. Exception: a question asking WHY, or about the wisdom or justice of the punishment (e.g. "Why would God punish disbelievers forever?"), is in scope. The afterlife in general, with no group (what Paradise is, the Day of Judgment), is in scope.`;

// ---------- The check ----------

const first = (list: RegExp[], t: string) => list.find((r) => r.test(t));
const shown = (r: RegExp) => r.source.replace(/\(\?:\^\| \)(?:\(\?:[^)]*\)\?)?|\(\?= \|\$\)/g, "");

export function scopeBackstop(question: string): BackstopHit | null {
  const t = normalizeForScope(question);
  for (const [issue, list] of Object.entries(DISPUTED)) if (first(list, t)) return { kind: "major_disputed_issue", rule: "disputed", why: issue };
  const fate = first(FATE, t);
  const label = first(LABEL, t);
  const person = first(PERSONS, t);
  const group = first(MUSLIM_GROUPS, t);
  if (fate && person) return { kind: "judgment_on_person_or_group", rule: "fate-of-person", why: `${shown(fate)} + ${shown(person)}` };
  if (label && (person || group)) return { kind: "judgment_on_person_or_group", rule: "label-person-or-muslim-group", why: `${shown(label)} + ${shown((person || group)!)}` };
  const any = group || first(OTHER_RELIGIONS, t) || first(INTERIM_AFTERLIFE_CLASSES, t);
  if (fate && any && !first(INTERIM_WHY_EXCEPTION, t)) return { kind: "judgment_on_person_or_group", rule: "INTERIM-afterlife-fate-of-group", why: `${shown(fate)} + ${shown(any)}` };
  return null;
}
