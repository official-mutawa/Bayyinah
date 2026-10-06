# sources/

Approved source files go here, exactly as delivered, plus `manifest.json` describing them.
Nothing in this folder except this README and `manifest.example.json` is committed until the sources are approved.

## manifest.json

Copy `manifest.example.json` to `manifest.json` and add one entry per source:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Id prefix for passages: lowercase letters, digits, dashes. Use `quran` for the Quran so references read `quran:16:125`. |
| `kind` | yes | `quran`, `hadith` or `text` (books and other approved texts). Controls the evidence label in the UI: آية، حديث، نص. |
| `label` | yes | Arabic display name, e.g. `القرآن الكريم`. |
| `format` | yes | One of the adapters below. |
| `file` | yes | File name inside `sources/`. |
| `attribution` | yes | Shown in the UI footer and README. |
| `license` | yes | License or terms of use. |
| `notice` | no | Notice the license requires to be shown (e.g. Tanzil's). |
| `url`, `version` | no | Where it came from and which edition, commit or date. Logged by ingest. |
| `sha256` | no | Ingest fails if the file no longer matches. |
| `expectedCount` | no | Ingest fails if the passage count differs. A `quran` source must have 6236 verses. |
| `fields` | for json, jsonl, csv, tsv | Field mapping, see below. |
| `split` | no | `text` format only: regex that separates passages (default: blank lines). |

## Formats (adapters)

| `format` | Reads | Passage id | Reference |
| --- | --- | --- | --- |
| `tanzil-xml` | Tanzil XML (`<sura index name><aya index text/>`) | `surah:ayah` | surah name + ayah |
| `tanzil-txt` | Tanzil text with aya numbers (`sura\|aya\|text`, `#` lines ignored) | `surah:ayah` | surah + ayah numbers |
| `json` | JSON array of records, or `fields.records` dot path to one | `fields.id` or position | `fields.ref` template |
| `jsonl` | one JSON record per line | same | same |
| `csv` / `tsv` | header row + records | same | same |
| `text` | plain text, passages separated by blank lines | position | `label، مقطع N` |

`fields` for record formats: `text` (required), `id`, `grade`, `records` (JSON only), and `ref`, a template with
`{field}` placeholders and `{source}` for the label, e.g. `"{source}، {book}، رقم {number}"`.

Text is never changed: adapters only read and map fields. Search-normalized text is built in memory at runtime.

## Commands

```bash
npm run ingest:check
```

Runs every check without calling any API: manifest valid, files present and unchanged, unique ids,
text and reference present, expected counts. Writes `data/ingest-log.json` with each source's version and hash.

```bash
npm run ingest
```

Runs the checks, then computes embeddings into `data/` (needs `OPENAI_API_KEY` in `.env.local`).
