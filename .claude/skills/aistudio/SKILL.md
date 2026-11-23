---
name: aistudio
description: Controls Google AI Studio Playground chat (/prompts) and History (/library) through a logged-in off-screen Chrome window. Pure multimodal transport and browser-CLI layer for asking Gemini questions (default gemini-4-neon, free under Pro/Ultra without API spend), attaching files (video, images, PDFs, audio, text), configuring models, thinking levels, media resolution, video FPS/ranges, tools, and system instructions, continuing or collecting saved chats, running parallel tabs, and searching History. Triggers include "ask gemini", "send file to ai studio", "read ai studio chat", "switch ai studio model", "aistudio", or Vietnamese equivalents ("hỏi gemini", "gửi file lên ai studio", "đọc chat ai studio"). For structured video production workflows built on top of this CLI, use analyze-ref-video, compare-video, or channel-dna.
---

# aistudio

Pure CLI transport for Google AI Studio Playground chat (`/prompts`) and History (`/library`): `ask.ts` sends prompts (`0..n` attachments, optional `--system-file`) and collects markdown replies; `studio.ts` manages off-screen tabs, model/run settings, history, and UI health checks. Run all commands from the repo root with `bun`.

Shorthand:
- `ASK = bun .claude/skills/aistudio/scripts/ask.ts`
- `STUDIO = bun .claude/skills/aistudio/scripts/studio.ts`

For full flag/subcommand syntax, run `ASK --help` and `STUDIO --help`. For browser infrastructure maintenance read [references/development.md](references/development.md); when AI Studio UI changes break locators read [references/ui-changes.md](references/ui-changes.md). Specialized domain workflows that use `aistudio` as their default runner live in `.claude/skills/analyze-ref-video/`, `.claude/skills/compare-video/`, and `.claude/skills/channel-dna/`.

## Scope

| Allowed | Off-Limits |
| --- | --- |
| Playground chat (`/prompts`) and History (`/library`) only. | Build apps, API keys, Dashboard, usage, billing, and every other AI Studio area — including via `STUDIO ab`. |

## Quick Start & Core Recipes

| Job | Command |
| --- | --- |
| Full CLI options & subcommands | `ASK --help` and `STUDIO --help` |
| Ask text or multimodal (video/image/PDF/audio/text) | `ASK [file ...] "prompt" [--model <id>] [--thinking <level>] [--media <level>] [--fps <n>] [--tool search=off] [--system-file <path>] --out answer.md` (prompt goes last; use `--prompt-file <file>` for long prompts, or `-- "-..."` if prompt starts with `-`) |
| Continue or collect a chat | `ASK --chat <url-or-id> [file ...] "follow-up"` / `ASK --chat <url-or-id> --out ans.md` / `ASK --collect --out ans.md` (unsaved open chat) |
| Parallel tasks across windows | Use distinct `--tab <label>` per job (e.g. `--tab work1`, `--tab work2`); never run two commands on the same tab at once. Close temp tabs afterward with `STUDIO tab close <label>`. |
| Search & read saved History | `STUDIO history --search <query>`, then `STUDIO read <url-or-id> [--thoughts] --out chat.md` |
| Inspect state, settings, or UI health | `STUDIO status`, `STUDIO models`, `STUDIO map`, `STUDIO --tab doctor doctor [--quick]`, `STUDIO --tab smoke smoke` |

Add `--json` to data-printing `STUDIO` commands (`status`, `tabs`, `models`, `history`, `read`, `system`, `doctor`) for structured JSON. When no dedicated command exists inside `/prompts` or `/library`, inspect via `STUDIO map` and `STUDIO ab snapshot -i`, then act via `STUDIO ab click/fill`.

## Model, Thinking & Tool Defaults

- `ASK` defaults to `gemini-4-neon` and auto-applies `--thinking "Extra High"` only on `gemini-4-neon`; any other `--model` keeps the page default unless `--thinking` is passed explicitly.
- AI Studio persists the **Grounding with Google Search** switch across future new chats in the profile; always pass `--tool search=on` or `--tool search=off` explicitly when grounding behavior matters.
- Video attachments default to 24 FPS when `--fps` is omitted (or pass `--start`/`--end` to clip inside AI Studio; `--agentic` cannot be combined with `--fps`/`--start`/`--end`).

## Reading Logs & Exit Codes

| Prefix | Meaning |
| --- | --- |
| `→ [n/N] step` | Step started. |
| `✓ [n/N] step: ...` | Step verified by reading back live page state. |
| `… still ...` | Waiting (heartbeat every 30s). |
| `⚠ warning: answer may be truncated (...)` | Copied markdown ended inside an unclosed code fence, incomplete markdown table row, unclosed bold span, or trailing mid-clause punctuation (the `copy answer` step also appends `⚠ may be truncated: ...`); send a `--chat` follow-up to retrieve the tail. |
| `✗ [n/N] step failed: ...` | Failure with reason and screenshot at `%TEMP%\aistudio-failed-<tab>-stepN.png`. |

Exit `0`: verified success. Exit `1`: step/runtime failure. Exit `2`: invalid CLI input (browser untouched).

## Off-Screen Chrome & Focus Safety

Chrome runs on port `9333` with an isolated profile; each `--tab` gets its own off-screen background window so it never steals mouse, keyboard, screen, focus, or Windows clipboard. Never use `--headless` (exposes `HeadlessChrome` UA and risks Google sign-out) and never minimize windows manually (minimized pages become hidden and break dropdowns). Run `STUDIO chrome --show` when a human needs to sign in manually; the next command on that tab returns it off-screen.

## Common Errors & Recovery

| Error | Fix |
| --- | --- |
| `signed out` | Ask the user to run `STUDIO chrome --show`, sign in manually, then retry. |
| `AI Studio cannot open that chat` | Wrong ID, deleted chat, or signed into a different Google account. |
| `still generating` | That tab/chat is busy; collect it with `ASK --collect` (same `--tab`) or use a different `--tab`. |
| `stopped after Thoughts with no answer text` | Hit the 65k output-length cap during Extra High thinking; reduce input size/tokens or lower `--thinking High`. |
| `warning: answer may be truncated` | Send a `--chat <url>` follow-up asking Gemini to continue verbatim from the last completed line/row. |
| `the last prompt in this chat has no answer` | Check `STUDIO tabs` (may be running in another tab); otherwise the previous run stopped — re-send via `--chat`. |
| `has no ... on this model; it offers: ...` | Pick a thinking/media level from the printed model list. |
| `no ... switch on the page` / `is disabled right now` | Tool unavailable on this model (e.g., `maps`); switch models or omit the tool. |
| `already holds N attachment(s)` | Previous run left attachments in that tab; use another `--tab` or `STUDIO open new`. |
| `tab_locked` | Another `agent-browser` session holds that window; pick another `--tab`. |
| `only a saved chat can be renamed` | Wait ~1 min after the first reply until AI Studio assigns a chat URL. |
| `AI Studio says: ...` | Live AI Studio banner alert (quota, server error, rejected video range); read verbatim. |
| Missing locator / button not found | UI may have changed — run `STUDIO --tab doctor doctor` and follow [references/ui-changes.md](references/ui-changes.md). |

## Usage Laws

- Stay strictly inside `/prompts` and `/library`; never pass empty files to `--system-file` (rejected with exit `2`).
- Run at most one command per `--tab` at a time; never reload or navigate away from a generating chat.
- Never run `agent-browser close` or `tab new` on this Chrome instance (`close` kills shared Chrome; `tab new` hides existing tabs in that window).
- Keep the Google account UI in English (ARIA locators expect English labels).
- Verify critical answers independently (Gemini audio is 1Kbps mono and can hallucinate fine audio details).
- `ASK` copies only the final Model turn (use `STUDIO read` for multi-turn answers); `history` reads only page 1 (use `--search` for older chats).
