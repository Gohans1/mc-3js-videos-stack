---
name: aistudio-tts
description: Direct and export speech in Google AI Studio's Generate Speech playground. Use for Gemini 3.8 Flash TTS narration and two-speaker dialogue for video, speech blocks, delivery styles, expressions, browsing and auditioning voices, favorites, voice design, remix and replication controls. Use aistudio for chat and History.
---

# aistudio-tts

Run `bun .claude/skills/aistudio-tts/scripts/cli.ts --help` from the repo root. In the examples, `TTS` stands for `bun .claude/skills/aistudio-tts/scripts/cli.ts`.

For the audited voice roster, `style`/pace levers, `<tag>`/`|backchannel|`/`/IPA/` rules, long-form documentary blueprint (`Cruz`), and production pitfalls, read [the voice casting and direction guide](references/voice-casting-and-direction.md). For the empirically benchmarked Zack D. Films Shorts voice recipes, templates, and broadcast post-processing chain, read [the Zack D. Films voice system](references/zack-d-films/README.md).

Use a distinct `--tab tts-<job>` per job and the same label for every step on that job. Tab labels must start with `tts-`, use only letters, numbers, and hyphens (no underscores), and be 5–31 characters total. The CLI reuses the existing [AI Studio Chrome profile](../aistudio/SKILL.md). Default model is `gemini-3.8-flash-tts`. **`gemini-3.8-flash-lite-tts` is banned and rejected by the CLI** (noticeably flatter inflection/acting); never use or fall back to it. If the AI Studio web playground hits its daily free-tier RPD quota, switch to **`--backend api`** (uses Gemini API `/v1beta/interactions` and `/v1beta/voices` with automatic `~/.config/gmn` key-pool rotation, falling back to `GEMINI_API_KEY` / `GOOGLE_API_KEY`, with no Chrome needed); if all API keys are also exhausted, **STOP and report the quota limit to the user**. `--model <id>` selects another allowed TTS model only when explicitly requested. An explicit `--account <slot>` (`--backend web` only) is checked against the browser's actual destination. Omit the slot to use the profile's default account.

## Gemini API key-pool backend (`--backend api`)

Add `--backend api` to `speak`, `batch`, or `voices` to run the exact same `scene.json` / `manifest.json` files directly against `generativelanguage.googleapis.com/v1beta` with automatic `~/.config/gmn/config.json` key rotation (handling 3 RPM free-tier limits via per-key cooldowns and dead-key marking; falls back to `GEMINI_API_KEY` / `GOOGLE_API_KEY` if no pool exists). Optional flags: `--key-pool-dir <dir>` (or `GMN_CONFIG_DIR`) and `--rounds <1-10>` (default `2`).

- `TTS --backend api speak scene.json --out voice/takes/take-01.wav [--force]`
- `TTS --backend api batch manifest.json [--force]`
- `TTS --backend api --json voices [query]`
- Requires explicit `voices` in `scene.json` / `manifest.json` (for single-narrator multi-block scenes, repeat the same voice: `"voices": ["Cruz", "Cruz"]`). `--account` and `--keep-open` are web-only. To audition a voice over `--backend api`, run a short `speak` take (`/v1beta/voices` does not expose prebuilt preview WAV URLs).

## Windows lifetime & concurrency

- Under Windows job-object sandboxes (`exebox-*`), Chrome terminates when the shell that spawned it exits. Prefer `speak` or `batch` so the entire run executes in one Bun process, OR run `bun .claude/skills/aistudio/scripts/studio.ts chrome --keepalive` as a background daemon before running separate commands.
- When chaining commands in PowerShell 5.1, never use `&&` (syntax error); use `; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }` or put loops in a Bun script.
- Port `9333` is shared across sessions. Check `TTS tabs` before opening parallel jobs, keep total active Chrome tabs at `<= 2` across all sessions, and run **one `batch`/`speak` tab at a time** (concurrent TTS batches serialize over CDP and degrade step latency from `~2s` to `400s+`).

## Make a take

1. **Single take (recommended):** Save `scene.json` and run `TTS --tab tts-scene speak scene.json --out voice/takes/take-01.wav --timeout 180` (opens tab, applies scene, runs, exports WAV, and closes the tab; pass `--keep-open` to inspect or keep editing, `--force` to overwrite an existing file).
2. **Multiple takes on one voice (recommended):** Save `manifest.json` (`{ "temperature": 0.8, "voices": ["Cruz"], "takes": [{ "out": "voice/takes/01.wav", "text": "...", "style": "..." }, ...] }`) and run `TTS --tab tts-batch batch manifest.json --timeout 180`. It reuses one tab and voice setup in a single process.
3. **Interactive / step-by-step:** Run `TTS --tab tts-scene open`, then `TTS --tab tts-scene apply scene.json`, then `TTS --tab tts-scene run --out voice/takes/take-01.wav --timeout 180`, and finally `TTS --tab tts-scene close`. To edit an open tab interactively or reuse one tab across takes without `apply`, use `start`, `block-add`, `block-remove`, `text <block> <file|->`, `style <block> <direction>`, `preset <block> <name>`, and `expression <block> [name]`. `status` reads the live editor. `collect --out <new-path.wav>` exports completed audio from that same tab without submitting again.
4. Listen directly to the WAV (`read_file` on audio) before using it in the film. Check pronunciation, intact word endings, pause length, speaker changes, expression timing, and delivery against the screenplay. Keep each block's `style` concise and place `<...>` vocal tags in the text only where a non-verbal sound belongs.

`scene.json` can specify `temperature` and up to two `voices` by their displayed names. `blocks` are ordered and use `text`, optional `style`, and optional `speaker` to assert the UI's alternating speaker slots. For a multi-block single-narrator screenplay with per-block style changes, assign the same voice to both slots (`"voices": ["Cruz", "Cruz"]`).

```json
{
  "temperature": 0.8,
  "voices": ["Fola", "Rami"],
  "blocks": [
    {"speaker": 1, "style": "Quiet, tense, with a deliberate pause", "text": "Đừng mở cửa. <short pause> Nghe đi."},
    {"speaker": 2, "style": "A sudden whisper", "text": "<gasp> Có ai ở bên ngoài."}
  ]
}
```

## Work with voices

- `gemini-3.8-flash-tts` exposes **both** its new 3.8 catalog (`Fola`, `Rami`, `Cruz`, `Enzo`, `Koda`, `Zeno`, `Riko`, `Ludo`, `Bodi`, etc.) **and** the classic Gemini studio voices (`Rasalgethi`, `Achird`, `Puck`, `Orus`, `Schedar`, `Iapetus`, `Fenrir`, `Charon`, etc. — e.g., `filter "Language" "English (US)"` reveals 70 US voices: 40 new 3.8 + 30 classic).
- Open `library 1` or `library 2` for a speaker, or `library 3 --block` for the voice used by block 3. The second speaker appears after adding a second block.
- Use `voices` to inspect visible groups and `collapsedGroups` (by default each Use case group shows 3 preview voices behind `View all N`; filter by a facet or search with `voices "Fola"` to inspect all matching voices — `voices` has no `--all` flag).
- Always list facet choices first before filtering: `filter "Use case"` lists live options (do not guess `"Male"` or `"English"` — live labels are `"Masculine"`/`"Feminine"`/`"Neutral"` and `"English (US)"`), and `filter "Use case" "Storyteller"` picks one (case-insensitive; mismatches print the live options). The same syntax applies to Language, Gender, Pitch, and Style. Use the live `All …` option to clear a filter.
- Use `sample "Fola"` to play a catalog sample in the browser, `favorite "Fola" on` to save a favorite, and `voice "Fola"` to assign it. Add `--out fola-sample.wav` (and `--force` to overwrite) to save a public catalog sample locally for listening. Note: `--out` works on new 3.8 catalog voices, whereas classic voices play in the browser without exposing a downloadable catalog WAV — audition classic voices via a short `speak` take instead. Use `library-close` to return to the editor.
- Use `voice-create design`, `voice-create replication` or `voice-create remix "Fola"` to enter the available forms. A paid-key gate is reported as a failed step and stays open for inspection. Use `snapshot` and `ui` for controls the account exposes. Replicate a voice only with the rights and consent to do so. Complete Google's microphone and consent prompts in the browser.

## Inspect and recover

Progress and errors go to stderr. `--json` puts successful structured results on stdout. Exit `2` means invalid input. Exit `1` names the failed step and attempts to capture a timestamped screenshot. Use `tabs` to inspect open shared-Chrome tabs without launching Chrome, and `close` to close a dedicated tab cleanly (safe even when already closed). After an interrupted apply, keep the source JSON and inspect `status` to see what reached the editor. The `audioPhase` field distinguishes generation, streaming, and a ready take.

Use `snapshot` for changing or model-specific UI such as starter templates, playback, voice forms, catalog group expansion, and Get code language selection. `code` prints the active generated snippet. `ui click e42` and `ui fill e43 "text"` use references from a fresh snapshot of the same tab. Read the returned snapshot before the next action. The browser must complete microphone, permission, and consent prompts that live outside the page.

If Google changes a label or page layout, use `map` and `doctor` and follow [the UI repair guide](references/ui-changes.md).
