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

For REF/OURS review of any length, use the [Compare still-frame recipe](../compare-video/references/stills-field-audit.md#recipe). `bun run reference frames` prepares timecoded stills at 15 fps by default and caps each list at 450 images. Send each list separately with `--batch --files-from` and Hydrogen High. Reference-only and original-film review use the [single-source stills recipe](../compare-video/references/stills-field-audit.md#single-source-stills).

## Scope

For the Generate Speech playground, use [aistudio-tts](../aistudio-tts/SKILL.md) with the same logged-in Chrome profile.

| Allowed | Off-Limits |
| --- | --- |
| Playground chat (`/prompts`) and History (`/library`) only. | Build apps, API keys, Dashboard, usage, billing, and every other AI Studio area — including via `STUDIO ab`. |

## Quick Start & Core Recipes

| Job | Command |
| --- | --- |
| Full CLI options & subcommands | `ASK --help` and `STUDIO --help` |
| Ask text or multimodal (video/image/PDF/audio/text) | `ASK [file ...] "prompt" [--model <id>] [--thinking <level>] [--media <level>] [--fps <n>] [--tool search=off] [--system-file <path>] --out answer.md` (prompt goes last; use `--prompt-file <file>` for long prompts, or `-- "-..."` if prompt starts with `-`) |
| Many images or other non-video files fast | `ASK --batch a.jpg b.jpg ... "prompt"` uploads them in one call. AI Studio lists images in upload-finish order, so burn a label (e.g. timecode) into each image. Videos upload one by one after the batch. For hundreds of files pass `--files-from list.txt` (one path per line) to fit within the Windows command-line limit. For scene review use at most 450 images per prompt. See [measured capacity and browser failures](../compare-video/references/prompt-design.md#batch-capacity-follow-up-2026-11-26). |
| Continue or collect a chat | `ASK --chat <url-or-id> [file ...] "follow-up"` / `ASK --chat <url-or-id> --out ans.md` / `ASK --collect --out ans.md` (unsaved open chat) |
| Parallel tasks across windows | Use distinct `--tab <label>` per job (e.g. `--tab work1`, `--tab work2`); never run two commands on the same tab at once. Under Windows `exebox-*` job-object shells, start `STUDIO chrome --keepalive` as a background daemon first so Chrome does not exit when a spawning shell ends. Close temp tabs afterward with `STUDIO tab close <label> [--if-open]`. |
| Search & read saved History | `STUDIO history --search <query>`, then `STUDIO read <url-or-id> [--thoughts] --out chat.md` |
| Inspect state, settings, or UI health | `STUDIO status`, `STUDIO open new` then `STUDIO models` (requires a chat tab), `STUDIO map`, `STUDIO --tab doctor doctor [--quick]`, `STUDIO --tab smoke smoke` |

Add `--json` to data-printing `STUDIO` commands (`status`, `tabs`, `models`, `history`, `read`, `system`, `doctor`) for structured JSON. When no dedicated command exists inside `/prompts` or `/library`, inspect via `STUDIO map` and `STUDIO ab snapshot -i`, then act via `STUDIO ab click/fill`.

## Model, Thinking & Tool Defaults

- `ASK` defaults to `gemini-4-neon` and auto-applies `--thinking "Extra High"` only on `gemini-4-neon`; any other `--model` keeps the page default unless `--thinking` is passed explicitly.
- Hydrogen's observed menu offers Low, Medium, High, and Extra High. Pass `--thinking High` explicitly for scene review. Two detailed Extra High audits at 305 stills stopped after Thoughts without a report.
- AI Studio persists the **Grounding with Google Search** switch across future new chats in the profile; always pass `--tool search=on` or `--tool search=off` explicitly when grounding behavior matters.
- Static video attachments default to 24 FPS. `ASK` checks the saved chip count against an independent floor from ffprobe, the selected `--start`/`--end` window, requested FPS, and media resolution before Generate. If the chip is too low, upload the window as a separate file or use the standalone Gemini API runner.
- The delivery check requires the largest of the source floor, 45% of chip tokens, and `--min-in-tokens`. It exits 1 before writing `--out` if delivery cannot be verified. Follow-ups measure the increase from the prior turn. Use the printed resume command to preserve the floor and previous token counts. `--agentic` excludes `--fps`/`--start`/`--end` and skips the static video check. AI Studio still feeds an agentic video at 1 frame per second (hydrogen read only 31 frames of a 30.5 s clip), so it cannot see cuts, pops or caption timing under a second; send burned-timecode stills with `--batch` for that.

## Reading Logs & Exit Codes

| Prefix | Meaning |
| --- | --- |
| `→ [n/N] step` | Step started. |
| `✓ [n/N] step: ...` | Step verified by reading back live page state. |
| `… still ...` | Waiting (heartbeat every 30s). |
| `⚠ warning: answer may be truncated (...)` | Copied markdown ended inside an unclosed code fence, incomplete markdown table row, unclosed bold span, or trailing mid-clause punctuation (the `copy answer` step also appends `⚠ may be truncated: ...`); send a `--chat` follow-up to retrieve the tail. |
| `✗ [n/N] step failed: ...` | Failure with reason and timestamped screenshot at `%TEMP%\aistudio-failed-<tab>-stepN-<ts>.png` (skipped for non-page commands or pre-tab failures). |

Exit `0`: verified success. Exit `1`: step/runtime failure. Exit `2`: invalid CLI input (browser untouched).

## Off-Screen Chrome & Focus Safety

Chrome runs on port `9333` with an isolated profile; each `--tab` gets its own off-screen background window so it never steals mouse, keyboard, screen, focus, or Windows clipboard. Never use `--headless` (exposes `HeadlessChrome` UA and risks Google sign-out) and never minimize windows manually (minimized pages become hidden and break dropdowns). Run `STUDIO chrome --show` when a human needs to sign in manually; the next command on that tab returns it off-screen.

## Common Errors & Recovery

| Error | Fix |
| --- | --- |
| `signed out` | Ask the user to run `STUDIO chrome --show`, sign in manually, then retry. |
| `AI Studio cannot open that chat` | Wrong ID, deleted chat, or signed into a different Google account. |
| `still generating` | That tab/chat is busy; collect it with `ASK --collect` (same `--tab`) or use a different `--tab`. |
| `stopped after Thoughts with no answer text` | Extra High produced this symptom in detailed audits at the configured output length. Retry the audit with `--thinking High` or shorten the window and narrow the scope. |
| `You've reached your rate limit` / daily quota card | Preserve completed reports and attachment lists. Resume pending passes after the daily quota recovers. The CLI may surface the card under `AI Studio says: ...` or fail to copy the Model turn. Read the failure screenshot when the reason is unclear. |
| `warning: answer may be truncated` | Send a `--chat <url>` follow-up asking Gemini to continue verbatim from the last completed line/row. |
| `the last prompt in this chat has no answer` | Check `STUDIO tabs` (may be running in another tab); otherwise the previous run stopped — re-send via `--chat`. |
| `has no ... on this model; it offers: ...` | Pick a thinking/media level from the printed model list. |
| `no ... switch on the page` / `is disabled right now` | Tool unavailable on this model (e.g., `maps`); switch models or omit the tool. |
| `already holds N attachment(s)` | Previous run left attachments in that tab; use another `--tab` or `STUDIO open new`. |
| `tab_locked` | Another `agent-browser` session holds that window; pick another `--tab`. |
| `only a saved chat can be renamed` | Wait ~1 min after the first reply until AI Studio assigns a chat URL. |
| `video sampling silently downgraded by AI Studio` | AI Studio confirmed high-FPS/High-res tokens on the chip, but `CreateInteraction` delivered <45% of expected tokens (e.g. silent 1 FPS / Low fallback). Wait for AI Studio UI fix, switch to a verified Gemini API backend, or send the video as burned-timecode stills with `--batch` (images are not downgraded: ~1.1k tokens each). |
| `agent-browser ...: Failed to read ... (os error 10060)` | A browser command timed out. For heavy image jobs, reduce concurrent tabs and shorten the batch. If the run already started, recover the answer with `--chat <url>` or `--collect`. |
| `AI Studio says: ...` | Live AI Studio banner alert (quota, server error, rejected video range); read verbatim. |
| Missing locator / button not found | UI may have changed — run `STUDIO --tab doctor doctor` and follow [references/ui-changes.md](references/ui-changes.md). |

## Usage Laws

- Stay strictly inside `/prompts` and `/library`; never pass empty files to `--system-file` (rejected with exit `2`).
- Run at most one command per `--tab` at a time; never reload or navigate away from a generating chat.
- Never run `agent-browser close` or `tab new` on this Chrome instance (`close` kills shared Chrome; `tab new` hides existing tabs in that window).
- Keep the Google account UI in English (ARIA locators expect English labels).
- Verify critical answers independently (Gemini audio is 1Kbps mono and can hallucinate fine audio details).
- `ASK` copies only the final Model turn (use `STUDIO read` for multi-turn answers); `history` reads only page 1 (use `--search` for older chats).
