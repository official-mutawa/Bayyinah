# Bayyinah · بيّنة

**Cited, verified answer drafts for daʿis.** A daʿi in a live conversation with a non-Muslim gets a hard question, types it (usually in Arabic), and Bayyinah drafts a short Arabic answer **only from approved sources**. Every sentence carries its own citation, checked by code and by a second model. When the evidence is not enough, it abstains and says what is missing.

It is a draft for the daʿi to review, never a fatwa.

Live: https://bayyinah-henna.vercel.app

## How it works

1. **Query rewriting.** An OpenAI model turns the question into 2–3 Arabic search queries, without adding assumptions the user did not state.
2. **Hybrid retrieval**, per source:
   - keyword search: BM25 over normalized, lightly stemmed Arabic (built in memory at runtime; stored text is never changed);
   - meaning search: OpenAI embeddings (`text-embedding-3-small`, 256 dimensions), precomputed by the ingest script and stored as int8;
   - the lists are merged with reciprocal rank fusion into about 10 passages.
3. **Grounded draft.** The Responses API with a strict JSON Schema returns `status` (answer or abstain), `claims` (one Arabic sentence each, with `passage_ids` and the exact `supporting_quote`), `abstain_reason` and `missing`. The model may use only the retrieved passages, never writes Quran text itself, gives no fatwa, claims no consensus, and attributes words to no one unless the passage does.
4. **Verification.**
   - Code: every cited id must be among the retrieved passages, and the supporting quote must appear in the cited passage after normalizing diacritics and spacing. Quoting verse wording inside a claim is rejected.
   - A second model call judges each claim against the full text of its cited passages only: supported or not.
   - Any failure: one redraft with the feedback. If it still fails, Bayyinah abstains and shows why. An unsupported claim is never displayed.
5. **Streaming.** `POST /api/ask` streams newline-delimited JSON: the real stages (rewriting, searching each source with the number of passages found, drafting, verifying), then the result.

The UI shows each claim with its evidence (آية، حديث with its grade as given in the data, or نص). Tapping a citation opens the stored passage with the supporting quote highlighted. "تم التحقق من الإسناد" appears only when every claim passed both checks. "انسخ للمحادثة" copies a clean text for chat apps, with Quran text exactly as stored.

## Trust rules

- Quran text is displayed exactly as stored in the approved source. A model never generates, paraphrases or restyles verse wording.
- Source files are kept byte-for-byte as delivered; ingest verifies their SHA-256 when recorded.
- No user questions are stored or logged. The API has a length limit and a per-IP rate limit.

## Sources

Sources come only from the approved source plan (the challenge's official scientific package and sources approved by the author). They are placed in `sources/` and described in `sources/manifest.json`; see [sources/README.md](sources/README.md) for the format and the adapters (Quran XML or text, JSON, JSONL, CSV, TSV, plain text).

| Source | Origin and version | Used as | In this repo |
| --- | --- | --- | --- |
| القرآن الكريم (Hafs, matching the King Fahd Complex print) | «الموسوعة القرآنية quranpedia.net», `mushafs-1.json.gz`, version 2026-10-06, https://quranpedia.net/dumps | The only source of verse text, shown exactly as stored (6236 verses) | Yes, with attribution |
| التفسير الميسر (King Fahd Complex) | «الموسوعة القرآنية quranpedia.net», `tafsir-book-2012.json.gz`, version 2026-08-10 | One passage per verse, linked to that verse | Yes, with attribution |
| الدرر السنية: الموسوعة الحديثية | Official public API, https://dorar.net/article/389 | Live hadith search with the muhaddith ruling and source as returned (8 s timeout, cached) | No data stored |
| بينات: أسئلة وأجوبة عن الإسلام (Osoul Center) | Official challenge package, PDF text layer | One passage per question (236 of 263 questions detected); quotes must come from the author's answer, not the question | No: encrypted bundle only |
| أصول الإيمان في ضوء الكتاب والسنة | Official challenge package, PDF text layer | One passage per page, with chapter and page | No: encrypted bundle only |

Not included yet because they need OCR, which has not been run: تفسير اللطيف المنان and شموع النهار (broken font encoding in the PDF text layer), الرحيق المختوم and براهين وجود الله (scanned pages).

**Private books on the live site.** Copyrighted book texts are never committed. The ingest script encrypts their passages (AES-256-GCM) into `data/private.enc`; the key is `BAYYINAH_INDEX_KEY`, kept only in `.env.local` and in the Vercel environment variables. Without the key the site still works on the Quran, tafsir and hadith.

**Dorar from the server.** Dorar's Cloudflare protection currently rejects server-side requests from Node.js. When that happens the UI shows «تعذر الوصول لمصدر الحديث» and the answer continues from the other sources. The planned fix is to query Dorar from the browser through its documented JSONP interface.

## Setup

Requirements: Node.js 24 or later.

```bash
npm install
```

Create `.env.local` in the project root with your OpenAI API key (create one at https://platform.openai.com/api-keys) and a 64-hex-character key for the private book bundle:

```
OPENAI_API_KEY=sk-...
BAYYINAH_INDEX_KEY=<64 hex characters>
```

Optional: `OPENAI_MODEL` (default `gpt-5.4-mini`) and `OPENAI_EMBED_MODEL` (default `text-embedding-3-small`). Never commit `.env.local`; it is gitignored.

Add the approved files to `sources/` and write `sources/manifest.json`, then:

```bash
npm run ingest:check
```

```bash
npm run ingest
```

`ingest:check` runs every check without calling any API: valid manifest, files unchanged, unique ids, text and reference present, expected counts (the Quran must have 6236 verses). `ingest` then computes the embeddings into `data/`.

Run the app:

```bash
npm run dev
```

To work on the UI without sources or API calls, put `BAYYINAH_MOCK=1` in `.env.development.local`: the dev server then streams clearly labelled placeholder data.

## Tests

```bash
npm run test:adapters
```

Self-test of every source adapter and every ingest failure case, using placeholder fixtures.

```bash
npm run test:questions
```

Runs the 10 Arabic questions in `tests/questions.json` against the API (default `http://localhost:3000`; pass another base URL as an argument, e.g. the deployed site). Each question states whether Bayyinah should answer or abstain and which references must be retrieved. The script prints a pass/fail table, saves `tests/results.json` (shown on `/evaluation`), and prints the exact stored text of Surah An-Nahl 16:125.

## Deployment

Vercel, from the `main` branch. Set `OPENAI_API_KEY` and `BAYYINAH_INDEX_KEY` in the project's environment variables. The API route reads `sources/` and `data/` at runtime; `next.config.ts` includes them in the function bundle with `outputFileTracingIncludes`.

## Licenses

- Fonts: IBM Plex Sans Arabic, Amiri and Amiri Quran, all under the SIL Open Font License 1.1, downloaded at build time by `next/font` and served from this site.
- Sources: each under its own license, listed above once confirmed.
- AI tools, skills and models used to build Bayyinah: [docs/TOOLS.md](docs/TOOLS.md).
