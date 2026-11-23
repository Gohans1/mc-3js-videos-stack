---
name: aistudio
description: Controls Google AI Studio Playground chat and History (aistudio.google.com) through a logged-in off-screen Chrome window. Use when asking Gemini questions (default gemini-4-neon, free under Pro/Ultra without API spend), attaching files (video, images, PDFs, audio, text), analyzing or comparing videos at 24 FPS, continuing or collecting saved chats, running parallel tabs, switching models/thinking/media/tools/system instructions, or searching History. Triggers include "ask gemini", "send video to ai studio", "compare 2 videos", "read ai studio chat", "switch ai studio model", "aistudio", or Vietnamese equivalents ("hỏi gemini", "gửi video lên ai studio", "so sánh 2 video").
---

# aistudio

CLI toolkit for Google AI Studio Playground chat (`/prompts`) and History (`/library`): `ask.ts` sends prompts and collects answers; `studio.ts` manages tabs, settings, history, and UI health checks. Run all commands from the repo root with `bun`.

Shorthand:
- `ASK = bun .claude/skills/aistudio/scripts/ask.ts`
- `STUDIO = bun .claude/skills/aistudio/scripts/studio.ts`

For full option/subcommand syntax, run `ASK --help` and `STUDIO --help`. For browser infrastructure maintenance read [references/browser/development.md](references/browser/development.md); when AI Studio UI changes break locators read [references/browser/ui-changes.md](references/browser/ui-changes.md); for prompt architecture & A/B evaluation read [references/prompts/prompt-eval-guide.md](references/prompts/prompt-eval-guide.md). To reverse-engineer an entire YouTube channel into a standalone skill, use `.claude/skills/channel-dna/`.

## Review Gate & Video Preparation Rules

- **Never invoke AI Studio video reviews unsolicited** — ask/confirm with the user unless explicitly delegated. Use Gemini's native 24fps multimodal video + audio vision specifically where static local frame sampling or deaf inspection falls short (motion curves, boundary continuity, whip-blur/DOF, BGM/VO rhythm).
- **1-video reference breakdown:** Inside `films/<name>/`, burn a 720p CRF 22 timecode strip via `bun run reference timecode references/ref.mp4` (writes `films/<name>/renders/reference/ref_timecode.mp4`), then run `ASK` from the repo root.
- **2-video comparison (`REF` vs `OURS`):** Inside `films/<name>/`, render moving 3D drafts with `--samples 8` when motion blur matters, then tile both into one synced 720p video via `bun run reference sidebyside references/ref.mp4 renders/draft.mp4` (writes `films/<name>/renders/reference/ref_vs_draft.mp4`; 50% fewer tokens, auto-strips draft bar, keeps `audio:ours`, avoids hitting the 65k Thoughts output cap on long dual uploads), then run `ASK` from the repo root.
- **Model & thinking selection:** `ASK` defaults to `gemini-4-neon` and only auto-applies `--thinking "Extra High"` on `gemini-4-neon`; any other `--model` keeps the page default unless `--thinking` is passed. For high-precision video comparison (`compare-2-video.md`) and `channel-dna` extraction, pass `--model gemini-4-hydrogen --thinking "Extra High"` explicitly. Always pass `--tool search=off` on video audits because AI Studio persists the Google Search toggle across future new chats.

## Scope

| Allowed | Off-Limits |
| --- | --- |
| Playground chat (`/prompts`) and History (`/library`) only. | Build apps, API keys, Dashboard, usage, billing, and every other AI Studio area — including via `STUDIO ab`. |

## Quick Start & Core Recipes

| Job | Command |
| --- | --- |
| Full CLI options & subcommands | `ASK --help` and `STUDIO --help` |
| Analyze 1 reference video | In `films/<name>/`: `bun run reference timecode references/ref.mp4`; then from repo root: `ASK films/<name>/renders/reference/ref_timecode.mp4 "Analyze this video..." --tool search=off --system-file .claude/skills/aistudio/system/analyze-ref-video.md --out ref-breakdown.md` |
| Compare `REF` vs `OURS` (default) | In `films/<name>/`: `bun run reference sidebyside references/ref.mp4 renders/draft.mp4`; then from repo root: `ASK films/<name>/renders/reference/ref_vs_draft.mp4 "Compare REF and OURS..." --model gemini-4-hydrogen --thinking "Extra High" --tool search=off --system-file .claude/skills/aistudio/system/compare-2-video.md --out cmp.md` (use 2 separate files with `--start`/`--end` only on `<20s` clips when directly comparing both audio streams, or lower `--thinking High`) |
| Ask text or multimodal (PDF/image/audio/text) | `ASK [file ...] "prompt" --out answer.md` (prompt goes last; use `--prompt-file <file>` for long prompts, or `-- "-..."` if prompt starts with `-`) |
| Continue or collect a chat | `ASK --chat <url-or-id> [file ...] "follow-up"` / `ASK --chat <url-or-id> --out ans.md` / `ASK --collect --out ans.md` (unsaved open chat) |
| Parallel tasks across windows | Use distinct `--tab <label>` per job (e.g. `--tab vid`, `--tab qa`); never run two commands on the same tab at once. Close temp tabs afterward with `STUDIO tab close <label>`. |
| Search & read saved History | `STUDIO history --search <query>`, then `STUDIO read <url-or-id> [--thoughts] --out chat.md` |
| Inspect state, settings, or UI health | `STUDIO status`, `STUDIO models`, `STUDIO map`, `STUDIO --tab doctor doctor [--quick]`, `STUDIO --tab smoke smoke` |

Add `--json` to data-printing `STUDIO` commands (`status`, `tabs`, `models`, `history`, `read`, `system`, `doctor`) for structured JSON. When no dedicated command exists inside `/prompts` or `/library`, inspect via `STUDIO map` and `STUDIO ab snapshot -i`, then act via `STUDIO ab click/fill`.

## Reading Logs & Exit Codes

| Prefix | Meaning |
| --- | --- |
| `→ [n/N] step` | Step started. |
| `✓ [n/N] step: ...` | Step verified by reading back live page state. |
| `… still ...` | Waiting (heartbeat every 30s). |
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
| `stopped after Thoughts with no answer text` | Hit the 65k output-length cap during Extra High thinking; shorten or tile video via `bun run reference sidebyside`, or lower `--thinking High`. |
| `the last prompt in this chat has no answer` | Check `STUDIO tabs` (may be running in another tab); otherwise the previous run stopped — re-send via `--chat`. |
| `has no ... on this model; it offers: ...` | Pick a thinking/media level from the printed model list. |
| `no ... switch on the page` / `is disabled right now` | Tool unavailable on this model (e.g., `maps`); switch models or omit the tool. |
| `already holds N attachment(s)` | Previous run left attachments in that tab; use another `--tab` or `STUDIO open new`. |
| `tab_locked` | Another `agent-browser` session holds that window; pick another `--tab`. |
| `only a saved chat can be renamed` | Wait ~1 min after the first reply until AI Studio assigns a chat URL. |
| `AI Studio says: ...` | Live AI Studio banner alert (quota, server error, rejected video range); read verbatim. |
| Missing locator / button not found | UI may have changed — run `STUDIO --tab doctor doctor` and follow [references/browser/ui-changes.md](references/browser/ui-changes.md). |

## Usage Laws

- Stay strictly inside `/prompts` and `/library`; never pass empty files to `--system-file` (rejected with exit `2`).
- Run at most one command per `--tab` at a time; never reload or navigate away from a generating chat.
- Never run `agent-browser close` or `tab new` on this Chrome instance (`close` kills shared Chrome; `tab new` hides existing tabs in that window).
- Keep the Google account UI in English (ARIA locators expect English labels).
- Verify critical answers independently (Gemini audio is 1Kbps mono and has hallucinated fine audio details).
- `ASK` copies only the final Model turn (use `STUDIO read` for multi-turn answers); `history` reads only page 1 (use `--search` for older chats).
