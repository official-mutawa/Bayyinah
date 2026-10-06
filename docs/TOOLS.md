Used for its polish and audit guidance only (reference files `polish.md` and `audit.md`, read directly; launcher, scripts and hooks not used): token contrast check in both themes, 44px touch targets, no overflow at 320px, long-reference chip wrapping. |Used for a review pass on the working UI (mock data): merged a duplicated "draft" label into the heading, removed a card around the stage list, removed a nested card in the abstain state. |Used while building the UI: native `<dialog>` and `<details>`, visible focus, labelled textarea with described errors, polite live region for stages, focus return, 44px targets, reduced-motion guards. |Used while building the UI: concentric radii, 1.5px currentColor icons, transitions only on the changing property, scale 0.96 on press. |Used while building the UI: small type scale, 16px input, line-height by role, balanced and pretty wrapping, tabular numbers, `<bdi>` for model names. |Used while building the UI: grouping by space, logical properties for RTL, inset full-width buttons, mobile-first widths. |# AI tools, skills and models

Every AI tool, skill and model used in this project, as required by the challenge rules.

## Tools and models

| Name | Source | License | Used for |
| --- | --- | --- | --- |
| Claude Code (desktop app, Code tab) | https://claude.com/claude-code | Anthropic Commercial Terms | Coding agent: cloned the repo, scaffolded the Next.js app, set up the Arabic RTL layout, wrote project rules and this file |
| Claude Opus 5.5 (`claude-opus-5-5`) | https://www.anthropic.com/claude | Anthropic Commercial Terms | Model behind Claude Code for all of the above |

## Models inside the app (runtime)

Called through the OpenAI REST API with `fetch` (no SDK). Model names come from `OPENAI_MODEL` and `OPENAI_EMBED_MODEL`; the defaults below were checked against the OpenAI models endpoint on 2026-10-06.

| Name | Source | License | Used for |
| --- | --- | --- | --- |
| OpenAI `gpt-5.4-mini` (default `OPENAI_MODEL`) | https://platform.openai.com/docs/models | OpenAI Services Agreement | Rewriting the question into 2-3 Arabic search queries; drafting the answer from retrieved passages only (strict JSON Schema); the second, independent check of every claim against its cited passages |
| OpenAI `text-embedding-3-small`, 256 dimensions (default `OPENAI_EMBED_MODEL`) | https://platform.openai.com/docs/guides/embeddings | OpenAI Services Agreement | Meaning search: passage embeddings precomputed by the ingest script, query embeddings at request time |

## Planning and research tools

Used while planning and building the project. None of these are part of the running app.

| Name | Source | License | Used for |
| --- | --- | --- | --- |
| Claude (claude.ai chat, Claude Opus 5.5) | https://claude.ai | Anthropic Consumer Terms | Project management, decisions, architecture review, source review, presentation |
| ChatGPT (OpenAI) | https://chatgpt.com | OpenAI Terms of Use | Independent advisor reviewing decisions and plans |
| Gemini (Google) | https://gemini.google.com | Google Gemini Apps Terms | Deep research reports on sources, licenses and infrastructure |

No AI output is presented as original human work. All research claims were checked before use.

## Skills

Installed at user level (`~/.claude/skills`) on 2026-10-04, not inside this repo. Only Markdown instruction files were copied; no scripts, hooks or `agents/openai.yaml` files. The commit shows the upstream version that was copied.

| Name | Source | License | Used for |
| --- | --- | --- | --- |
| impeccable | https://github.com/pbakaus/impeccable (`.claude/skills/impeccable/SKILL.md` + `reference/`, commit `6e802bd`) | Apache-2.0 | Reference files only, read directly (launcher, scripts and hooks not installed or used). `polish.md` and `audit.md`: palette contrast check, 44px touch targets, no overflow at 320px, long-reference chip wrapping. `bolder.md` and `delight.md`: the home redesign (one decisive move, the arch, built from the identity's own khatam, gold hairlines and Amiri; waiting kept truthful; decorative loops stop when the tab is hidden). |
| better-typography | https://github.com/jakubkrehel/skills (`skills/better-typography`, commit `267330e`) | MIT | Used while building the UI: small type scale, 16px input, line-height by role, balanced and pretty wrapping, tabular numbers, `<bdi>` for mixed-direction values. |
| better-layout | https://github.com/jakubkrehel/skills (`skills/better-layout`, commit `267330e`) | MIT | Used while building the UI: grouping by space, logical properties for RTL, inset full-width buttons, mobile-first widths. |
| better-accessibility | https://github.com/jakubkrehel/skills (`skills/better-accessibility`, commit `267330e`) | MIT | Used while building the UI: native `<dialog>` and `<details>`, visible focus, labelled textarea with described errors, polite live region for progress, focus return, 44px targets, reduced-motion guards. |
| better-ui | https://github.com/jakubkrehel/skills (`skills/better-ui`, commit `267330e`) | MIT | Used while building the UI: concentric radii, 1.5px currentColor icons, transitions only on the changing property, scale 0.96 on press. |
| interface-review | https://github.com/jakubkrehel/skills (`skills/interface-review`, commit `267330e`) | MIT | Not used: it can only be started by the user (`/interface-review`). |
| no-ai-design-slop | https://github.com/MengTo/Skills (`agent-skills/ui/no-ai-design-slop`, commit `944d578`) | MIT | Two review passes on the working UI (mock data). First: merged a duplicated "draft" label into the heading, removed the card around the stage list, removed a nested card in the abstain state. Second (home redesign): kept the arch, lattice and floating library as product-specific; removed the leftover footer band. |
| review-animations | https://github.com/emilkowalski/skills (`skills/review-animations`, commit `e8a175d`) | MIT | Not used: it can only be started by the user (`/review-animations`). |
| improve-animations | https://github.com/emilkowalski/skills (`skills/improve-animations`, commit `e8a175d`) | MIT | Improving motion within the project's calm-motion rule. Installed, not used yet. |
