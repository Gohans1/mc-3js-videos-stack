# AI Studio TTS UI repair

## Triage a failing command

1. Keep the original tab open if it holds a draft or audio. Read the failed step and screenshot path. Inspect `status` and `snapshot` on the same tab. Use a new `tts-<label>` for reproduction.
2. Run `map --json`. Each entry reports which candidate matches (0 is the first choice, -1 is absent) and how many. `doctor` checks the expected baseline on the landing screen or editor. Close dialogs before checking an editor baseline. Look for successful fallbacks and accidental duplicate matches.
3. Inspect the live control in `snapshot` or the browser accessibility tree. Prefer a meaningful test ID when present, then role and accessible name, then a scoped selector. Put locator changes in `scripts/page-map.ts` and keep selectors scoped to their block, player, menu, or dialog. Avoid generated Angular class names, pixel coordinates, hidden application state, and private API calls.
4. Replay the smallest failing command and read the resulting live state. For editor changes, prepare two speakers with different voices plus at least two blocks. For run-related changes, submit a short fresh transcript, collect a new WAV, and check codec, duration, and playback.

## Observations from the speech playground

- The Google profile may redirect a requested `/u/N` to its actual default account. On a fresh tab, a mismatch blocks commands until the tab is closed or opened with the intended profile. On a tab with an existing speech workspace, a rejected account change preserves the previous binding and draft. Use a new tab to request a different slot.
- The page can open on an example carousel with no editor. `start` creates the blank editor. Current 3.8 Flash TTS alternates speaker slots when new blocks are added. The block's speaker chip opens voice settings for that slot, so a voice change affects the other blocks using it.
- Voice settings and Create voice are separate overlays. A close button or Escape can close just the top overlay. Close them before inspecting all screenplay fields with `status`. Inspect the next snapshot before clicking Run if Chrome reports its click point is covered.
- Style uses one visible menu anchored to a block. Verify the intended trigger is expanded before filling or selecting, then inspect the selected block's chip. The untouched chip can be titled `Style`. Its authored-state class distinguishes a custom style with that same text.
- Voice results are grouped and filtered by the site. Active filter chips show the chosen value in place of the facet name. Identify the facet by its live `All …` option before selecting, and always dismiss the menu (`Escape` until no `.cdk-overlay-transparent-backdrop` remains; do not match the side panel's `.dialog-backdrop-blur-overlay`) after listing or on error so the menu backdrop does not block later clicks. Clicking `View all N` drills into that single Use case group; `voices` exposes `collapsedGroups` so callers know when to filter by `Use case` or search. If a displayed name resolves to multiple distinct rows, narrow the filters or inspect the actual row before selecting it.
- The Run button can use the signed-in plan even when the UI displays `No API key selected`. Use its enabled state and the actual result or alert to diagnose failures. Ignore benign Material snackbars while `audioPhase` is `generating` or `streaming`, and fail fast if the page remains `idle` past the post-click grace window instead of waiting the full timeout.
- The final player exposes a WAV data URL on its hidden `audio` element. Run and Download can re-enable while the streaming transport still says Pause, its HTML audio is paused, and the seek range is longer than the provisional WAV. Wait for the settled media source and a matching playback timeline before exporting. Derive PCM duration from sample rate and frame size because AI Studio has emitted mono 24 kHz WAVs with a stereo byte rate. Export corrects that header field while preserving the samples.
- Keep locator inspection compact on Windows. `map` ships one query function with all locator definitions. Repeating the function for every entry can exceed the command-line limit. Read editable values as JSON so the transport's output trimming leaves leading and trailing whitespace intact.
- Send long transcripts from UTF-8 files (or `-` via stdin). Keep the comparison in Bun after reading the field from the page. Both writes and readback must avoid shipping the entire transcript inside a Windows command-line argument.
- Get code can place a live Download button under a disabled accordion heading. Inspect the full accessible dialog tree for its reference. Use `code` to read the snippet without using the OS clipboard or relying on Chrome's Downloads directory.
- A timeout leaves work in the original tab. Collect the finished result there. If the result never appears or the page was closed, read the saved screenplay and use a new tab. Never issue two commands against the same tab at once. Under Windows `exebox-*` job objects, run `speak` / `batch` in one process or keep `studio.ts chrome --keepalive` running in a dedicated daemon task so Chrome stays alive across turns.
- If `prepare tab` reports CDP discovery timeouts, let the other shared Chrome jobs finish and retry `status` before sending more input. A timeout can occur in the transport while the speech page still holds its draft or take.
- The tab registry is shared with the chat CLI and updated atomically under `Local\aistudio-chrome-state`. `close` inspects Chrome directly over CDP without booting Chrome or spawning `/library` windows, and non-`open` commands refuse missing tabs instead of creating stray windows. When repairing `stop`, `player`, `pause`, or `seek` selectors in `scripts/page-map.ts`, keep `TARGET_BUSY_EXPR` in `../../aistudio/scripts/lib.ts` aligned so focus-free CDP checks stay accurate.
- Preview, design, remix, and replication can vary with account or model. The tested profile required linking a paid API key for design, remix, and replication. Verify the active form from the snapshot before making account changes. Use real browser consent and any required human voice verification.

## Verification commands

```powershell
bun test ./.claude/skills/aistudio-tts/scripts
bun fmt --no-script --check .claude/skills/aistudio-tts/scripts
bunx oxlint .claude/skills/aistudio-tts/scripts
$ttsFiles = Get-ChildItem .claude/skills/aistudio-tts/scripts/*.ts | Select-Object -ExpandProperty FullName
bunx tsc --noEmit --strict --skipLibCheck --allowImportingTsExtensions --types bun --lib ES2023,DOM --target ES2023 --module ESNext --moduleResolution bundler @ttsFiles
```

## Regression probes

Use a scratch `tts-<label>`, two short speech blocks, and new output paths. Write the scene JSON before interacting with the editor.

| Surface | Probe and expected evidence |
| --- | --- |
| Draft and account | Run `open --account <wrong-slot>` on a scratch draft and compare `status` before and after. Repeat on a fresh tab and confirm `start` fails there. |
| Editor and style | Run `start` then `apply <scene.json>`. Check the exact text, both voices, both styles and Temperature in `status`. Inspect block 1's style, then choose a preset for block 2 and confirm only its chip changed. |
| Generic controls | Fill an editor textbox through `ui` with leading and trailing spaces. Confirm the CLI succeeds and `status` returns those spaces. |
| Windows input length | Load a 37,000-character scratch transcript through `text <block> <file>` and insert an expression. Verify both through `status`. Keep this probe in the editor because it exercises transport. |
| Catalog | Choose a use case, inspect the selected chip, then clear it with the live `All …` option. Favorite a known voice and restore its initial state. Export a public sample and check playback duration. |
| Audio and recovery | Generate a short take with an intentionally short wait, then collect from the same tab. Compare the resulting duration with `ffprobe`. Try exporting to the same path again and confirm the original file hash stays the same. |
| Get code | Run `code` with a scratch screenplay. Confirm it prints a snippet and `snapshot` includes the dialog's language controls and Download reference. |
| Maintenance | Run `doctor` on the landing screen, open editor, and voice library. When a locator changes, compare its candidate and count using `map --json`. |

- [Google's Gemini 3.8 TTS announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/) describes the playground and the available voice modes.
- [Google's 3.8 TTS prompting guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/text-to-speech/prompting-guide) explains acting directions and vocal tags. Verify actual controls in the live consumer playground.
- [W3C Resource Timing](https://www.w3.org/TR/resource-timing/) documents how browsers expose the public catalog audio the preview button loads.
- [Microsoft WAVEFORMATEX](https://learn.microsoft.com/en-us/windows/win32/api/mmeapi/ns-mmeapi-waveformatex) defines PCM frame size and byte rate.
- [Chat transport development guide](../../aistudio/references/development.md) documents the shared off-screen profile, tab registry, and step runner.
