# AI tools, skills and models

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
| impeccable | https://github.com/pbakaus/impeccable (`.claude/skills/impeccable/SKILL.md` + `reference/`, commit `6e802bd`) | Apache-2.0 | Design guidance and critique for the UI. Installed, not used yet. Its bundled `scripts/` CLI and hooks were deliberately not installed. |
| better-typography | https://github.com/jakubkrehel/skills (`skills/better-typography`, commit `267330e`) | MIT | Typography guidance. Installed, not used yet. |
| better-layout | https://github.com/jakubkrehel/skills (`skills/better-layout`, commit `267330e`) | MIT | Layout and spacing guidance. Installed, not used yet. |
| better-accessibility | https://github.com/jakubkrehel/skills (`skills/better-accessibility`, commit `267330e`) | MIT | Accessibility guidance. Installed, not used yet. |
| better-ui | https://github.com/jakubkrehel/skills (`skills/better-ui`, commit `267330e`) | MIT | General UI polish guidance. Installed, not used yet. |
| interface-review | https://github.com/jakubkrehel/skills (`skills/interface-review`, commit `267330e`) | MIT | Interface review checklist. Installed, not used yet. |
| no-ai-design-slop | https://github.com/MengTo/Skills (`agent-skills/ui/no-ai-design-slop`, commit `944d578`) | MIT | Avoiding generic AI-looking design. Installed, not used yet. |
| review-animations | https://github.com/emilkowalski/skills (`skills/review-animations`, commit `e8a175d`) | MIT | Reviewing motion against the project's calm-motion rule. Installed, not used yet. |
| improve-animations | https://github.com/emilkowalski/skills (`skills/improve-animations`, commit `e8a175d`) | MIT | Improving motion within the project's calm-motion rule. Installed, not used yet. |
