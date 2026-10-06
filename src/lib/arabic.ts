// Arabic text normalization for search and quote matching.
// Stored source text is never modified; these functions build derived strings in memory.

const SUPERSCRIPT_ALEF = "ٰ";

// Diacritics, Quranic annotation marks and tatweel. Superscript alef is handled separately.
const MARKS =
  /[ؐ-ًؚ-ٟۖ-ۜ۞-ۭ࣓-ࣿـ]/g;

const LETTER_MAP: Record<string, string> = {
  "أ": "ا", // أ
  "إ": "ا", // إ
  "آ": "ا", // آ
  "ٱ": "ا", // ٱ alef wasla
  "ٲ": "ا",
  "ٳ": "ا",
  "ى": "ي", // ى -> ي
  "ة": "ه", // ة -> ه
  "ؤ": "و", // ؤ -> و
  "ئ": "ي", // ئ -> ي
  "ی": "ي", // Farsi yeh
  "ک": "ك", // keheh
};

const DIGITS_AR = "٠١٢٣٤٥٦٧٨٩";

function isWordChar(ch: string): boolean {
  return /[ء-يٮ-ۓۺ-ۿﷺa-zA-Z0-9]/.test(ch);
}

/**
 * Read Uthmani superscript-alef spellings the standard way, for search only:
 * صلوٰة -> صلاة, ينهىٰكم -> ينهاكم, كتٰب -> كتاب. Word-final ىٰ stays ى (على, موسى).
 */
export function standardSpelling(text: string): string {
  return text
    .replace(/و[ً-ٟ]*ٰ/g, "ا")
    .replace(/ىٰ(?=[ً-ٟ]*[ء-ي])/g, "ا")
    .replace(/ىٰ/g, "ى")
    .replaceAll(SUPERSCRIPT_ALEF, "ا");
}

/** Strip diacritics and unify letter variants. Superscript alef is removed. */
export function normalizeArabic(text: string): string {
  let out = "";
  for (const ch of text.replace(MARKS, "").replaceAll(SUPERSCRIPT_ALEF, "")) {
    const d = DIGITS_AR.indexOf(ch);
    if (d >= 0) out += String(d);
    else out += LETTER_MAP[ch] ?? (isWordChar(ch) ? ch : " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

export interface MappedText {
  text: string;
  /** map[i] = index in the original string of normalized character i */
  map: number[];
}

/**
 * Normalize for quote matching while keeping a map back to the original string,
 * so a match can be highlighted in the stored text. With `skeleton`, plain alef is
 * also dropped, which tolerates Uthmani vs. standard spelling (e.g. الكتب / الكتاب).
 */
export function normalizeMapped(text: string, skeleton = false): MappedText {
  let out = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === SUPERSCRIPT_ALEF || /[ؐ-ًؚ-ٟۖ-ۜ۞-ۭ࣓-ࣿـ]/.test(ch)) continue;
    const d = DIGITS_AR.indexOf(ch);
    let n = d >= 0 ? String(d) : LETTER_MAP[ch] ?? (isWordChar(ch) ? ch : " ");
    // Mid-word ىٰ is read as alef (ينهىٰكم = ينهاكم).
    if (ch === "ى" && text[i + 1] === SUPERSCRIPT_ALEF && /[ء-ي]/.test(text[i + 2] ?? "")) n = "ا";
    // وٰ is read as alef (صلوٰة = صلاة).
    if (ch === "و" && /^[ً-ٟ]*ٰ/.test(text.slice(i + 1, i + 4))) n = "ا";
    // The skeleton also ignores alef and bare hamza (ءاتوا = آتوا).
    if (skeleton && (n === "ا" || n === "ء")) continue;
    if (n === " ") {
      if (lastSpace) continue;
      lastSpace = true;
    } else {
      lastSpace = false;
    }
    out += n;
    map.push(i);
  }
  if (out.endsWith(" ")) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}

/**
 * Find `quote` inside `source` after normalization.
 * Returns the matched span in original `source` indices, or null.
 */
export function findQuote(source: string, quote: string): { start: number; end: number } | null {
  for (const skeleton of [false, true]) {
    const s = normalizeMapped(source, skeleton);
    const q = normalizeMapped(quote, skeleton).text;
    if (q.length < 4) return null;
    const at = s.text.indexOf(q);
    if (at < 0) continue;
    const start = s.map[at];
    let end = s.map[at + q.length - 1] + 1;
    // Extend over trailing combining marks so the highlight covers whole letters.
    while (end < source.length && /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]/.test(source[end])) end++;
    return { start, end };
  }
  return null;
}

const STOPWORDS = new Set(
  (
    "في من على الي الى عن ان او ما لا لم لن قد هو هي هم هما انت انا نحن هذا هذه ذلك تلك " +
    "التي الذي الذين اللذين كان كانت يكون ثم و يا اذا اذ حتي حتى كل بعض مع عند لكن بل ام " +
    "قال قالت فقال فقالت يقول حدثنا حدثني اخبرنا اخبرني انبانا سمعت عن بن ابن ابي ابو " +
    "رضي عنه عنها عنهم صلي صلى عليه وسلم ﷺ به بها له لها لهم منه منها فيه فيها اليه " +
    "هل كيف لماذا متي اين ماذا ما الا الا لو لولا اي ايها"
  )
    .split(" ")
    .map((w) => normalizeArabic(w))
);

const PROTECTED = new Set(["الله", "اللهم"]);

/** Light stemming in the spirit of Light10: strip common prefixes and suffixes. */
export function stem(word: string): string {
  if (PROTECTED.has(word)) return word;
  let w = word;
  if (w.length >= 4 && w.startsWith("و")) w = w.slice(1);
  for (const p of ["وال", "بال", "كال", "فال", "لل", "ال"]) {
    if (w.startsWith(p) && w.length - p.length >= 2) {
      w = w.slice(p.length);
      break;
    }
  }
  for (const s of ["ها", "ان", "ات", "ون", "ين", "يه", "ه", "ي"]) {
    if (w.endsWith(s) && w.length - s.length >= 2) {
      w = w.slice(0, -s.length);
    }
  }
  return w;
}

/**
 * Tokens for BM25. For words written with superscript alef (Uthmani spelling), both
 * the dropped-alef and the full-alef reading are indexed, so standard spelling matches.
 */
export function searchTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const forms = [raw];
    if (raw.includes(SUPERSCRIPT_ALEF)) {
      forms.push(standardSpelling(raw));
    }
    const seen = new Set<string>();
    for (const f of forms) {
      for (const n of normalizeArabic(f).split(" ")) {
        if (!n || STOPWORDS.has(n) || n.length < 2) continue;
        const s = stem(n);
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
      }
    }
  }
  return out;
}

/** Western digits to Arabic-Indic digits for display. */
export function arabicDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => DIGITS_AR[Number(d)]).replace(".", "٫");
}
