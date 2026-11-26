# Developing the `aistudio` Skill

Maintainer guide for extending, debugging, or refactoring `.claude/skills/aistudio/`. For normal usage read [SKILL.md](../SKILL.md); when AI Studio UI changes break locators read [ui-changes.md](ui-changes.md). Run commands from the repo root (`STUDIO = bun .claude/skills/aistudio/scripts/studio.ts`).

## Scope

Strictly Playground chat (`/prompts`) and History (`/library`). Never touch Build apps, API keys, Dashboard, usage, or billing in code, `doctor`, or documentation.

## Architecture

| Path | Responsibility |
| --- | --- |
| `scripts/page-map.ts` | Single source of truth for AI Studio UI structure: `URLS`, named element `MAP`, readable `TEXT`, tools, thinking/media levels, and video extensions. |
| `scripts/lib.ts` | Shared infrastructure: Chrome lifecycle, tab/window manager, `agent-browser` bridge, live DOM finder, AI Studio actions, and verified step runner. |
| `scripts/win32.ts` | Calls `user32.dll` via `bun:ffi` so off-screen Chrome windows stay invisible and never steal focus (`guardWindows`, `withForegroundLocked`). |
| `scripts/ask.ts` | Sends one prompt (`0..n` attachments) and collects the reply; supports `--chat` follow-up, `--collect`, `--batch` (all non-video files uploaded at once), and `--files-from` (attachment paths from a list file). |
| `scripts/studio.ts` | Tab, chat, settings, History, health (`doctor`, `smoke`), and low-level (`map`, `screenshot`, `ab`, `chrome`) commands. |
| `scripts/lib.test.ts` | Pure unit tests that require no browser (`toSeconds`, `formatStoppedRunError`, `formatCopyFailureError`, `detectPossibleTruncation`, `parseTokenCount`, `verifyDeliveredVideoTokens`, `planUploads`, `chipNameClashes`) plus `ask.ts` exit-`2` input checks. |
| `assets/doctor-2s.mp4` | 2-second test video with audio used by `doctor` and `smoke`. |
| `references/ui-changes.md` | UI locator recovery procedure, `MAP` conventions, and `doctor` diagnostics. |

Command flow: parse & validate inputs (exit `2` on usage errors) -> ensure Chrome -> prepare tab -> run verified steps -> print output. Every step must read back live page evidence rather than assuming a click succeeded.

## Engineering Principles

| Principle | Implementation |
| --- | --- |
| Selectors live only in `page-map.ts` | Other modules query named keys via `all`/`one`/`has` (or `dynamic` for data-driven items). Known exceptions: `Run`/`Stop` (`RUN_STATE`), `Google Account:` (`accountName`), `data-turn-role="Model"`, chip parent lookup (`parentElement` + `innerText`), `closest('button')` around `modelName`, `img[alt]`, and `ms-*-chunk` tags in `read`. |
| Stable locators first | `data-test-id` -> ARIA `role` + accessible `name` -> Angular CSS selector (Playwright stability order). |
| Real browser input events | `lib.ts` tags targets with `data-aistudio-target` and drives `agent-browser` click/fill instead of calling `element.click()` in page JS. |
| No hidden state | Only `aistudio-tabs.json` (`tab -> window/slot`) and the Chrome login profile persist under `%USERPROFILE%\.agent-browser\profiles`. Everything else is ephemeral (per-tab daemon, `window.__aistudio*`, `data-aistudio-target`, `%TEMP%` screenshots, Win32 window styles). |
| Shared logic in `lib.ts` | `ask.ts` and `studio.ts` never duplicate automation logic. |
| Actionable errors | `StepError` carries user-actionable diagnosis; unexpected exceptions remain bugs with stack traces. |
| Long text over stdin | `fill` uses `batch --bail` JSON on stdin to avoid the ~32k-char Windows command-line limit. |
| Verification after every edit | From repo root: `bun fmt --no-script .claude/skills/aistudio/scripts`, `bunx oxlint .claude/skills/aistudio/scripts --format json`, `bunx tsc --noEmit --strict --skipLibCheck --types bun --lib ES2023,DOM --target ES2023 --module ESNext --moduleResolution bundler .claude/skills/aistudio/scripts/*.ts`, `bun test ./.claude/skills/aistudio/scripts/lib.test.ts`, then live `STUDIO --tab doctor doctor`, `STUDIO --tab smoke smoke`, and the changed command. |

## Tabs, Windows, and Focus Shield

| Mechanism | Detail |
| --- | --- |
| 1 tab = 1 window | Only the active tab in a Chrome window is visible; background tabs become `hidden` and break Material dropdowns. Each `--tab` owns its own window (`tab close` closes that window). |
| 1 tab = 1 `agent-browser` session | Session `aistudio-<label>` always runs with `--pin-tab` so daemon restarts remember the pinned target instead of jumping to newly opened tabs. |
| Daemon auto-shutdown | `--idle-timeout 10m` shuts down idle `--cdp` daemons cleanly while leaving Chrome tabs intact for later commands. |
| Suppressing `about:blank` | The first command of a new session spawns an `about:blank` tab covering the most recent window; `prepareTab` closes every `about:blank` page on this Chrome instance. |
| Non-overlapping slots | Windows sit at `left = -10000`, `top = slot * 1200` (skipping occupied slots) because overlapping windows make Chrome treat obscured pages as `hidden`. |
| Background creation & pre-bind placement | `startChrome` passes `--window-position=-10000,0 --window-size=1920,1080`; `Target.createTarget` passes `newWindow: true`, `background: true`, `focus: false`, and `prepareTab` immediately applies `Browser.setWindowBounds` + `guardWindows` on the same CDP connection before `agent-browser` ever touches the tab. |
| Win32 click-through Z-bottom shield | `guardWindows` (`win32.ts`) enforces `WS_EX_TOOLWINDOW \| WS_EX_NOACTIVATE \| WS_EX_TRANSPARENT` (no taskbar button, no Alt+Tab, ignored by Win+M, no keyboard activation, 100% mouse click-through) and pushes frames to `HWND_BOTTOM` (`SetWindowPos`). During non-`--show` runs, any frame that drifts on-screen is shoved straight back to `left = -10000`; only `--show` lifts the shield. |
| Isolated desktop auto-migration | `startChrome` records `{ pid, desktop }` in `aistudio-chrome.json`. When an automated run starts on an isolated non-`"Default"` desktop (e.g., Antigravity `exebox-*`) while Chrome is stranded idle on `"Default"`, `startChrome` gracefully closes (`Browser.close`) and relaunches Chrome on the isolated desktop (zero visibility on `"Default"`), without disrupting peer hidden sessions; `chrome --show` migrates back to `"Default"` when needed for manual login. |
| Focus-free tab close & generating check | `studio.ts tab close` and migration idle checks inspect `GENERATING` over a per-target CDP WebSocket (`isTargetGeneratingCdp`) without activating the tab through `agent-browser`. |
| Restoring minimized hidden windows | `guardWindows` restores Win+D-minimized off-screen windows with `ShowWindow(SW_SHOWNOACTIVATE)` before CDP sees `minimized`. User-minimized `--show` windows are left alone. |
| Foreground lock | `prepareTab` wraps tab switches inside `withForegroundLocked` (`LockSetForegroundWindow`, serialized via named mutex `Local\aistudio-prepare-tab`) so Chrome cannot steal keyboard focus. User clicks or `Alt` naturally unlock it. |
| Minimal tab switches | `prepareTab` checks `tab list --json` and only calls `tab <id>` when the session is pinned elsewhere or another tab covered the window. |
| Persistent Chrome launch | Launched via PowerShell `Start-Process` (survives shell exit) with `--no-startup-window` and `--disable-backgrounding-occluded-windows`. |

## Hard-Won Traps & Fixes

| Trap | Resolution |
| --- | --- |
| Google blocks login in automation-flagged Chrome; Windows cookies use App-Bound Encryption / DBSC. | Plain Chrome on port `9333` with an isolated profile; user signs in once manually (port `9222` is reserved for Tab Out). |
| Minimizing a window hides the page, breaks dropdowns, and can abort generation mid-stream. | Keep windows off-screen (`left = -10000`) and run `guardWindows` every second while waiting. |
| Narrow windows (e.g., 929px) collapse the Run Settings panel. | Force `1920x1080`. |
| On new chats, clicking a dropdown loses focus back to the prompt box. | Focus the combobox and press `Enter`, then wait for options before selecting. |
| Thinking levels and tools vary by model (`flash-lite` stops at `High`; `maps` is model-specific). | `selectOption` lists the active model's valid values; `TOOLS_SOME_MODELS` marks optional tools for `doctor`. |
| Combobox text mixes display value with option labels. | Read `.mat-mdc-select-value-text` inside the combobox. |
| Video options button is clickable while the chip still says `Loading`; saving re-triggers `Loading`. | Wait until chip shows `N tokens` (or `Agentic`), with retry. |
| Matching chips by filename collides `a.mp4` with `x a.mp4`. | Serial uploads index chips by upload order (`Remove` button index `n`) and verify filename; `ask.ts` ensures an empty prompt before upload 1. `--batch` chips land in upload-finish order, so they are found by name (`chipTextsByName`) and `chipNameClashes` rejects such name pairs with exit `2`. |
| One upload call per file waits ~15–20 s for each chip to show `N tokens`; pipelining single-file calls without that wait still took >10 min for 61 images. | One `upload` call with every file (`input[type=file]` is `multiple`) readies 61 images in ~12–46 s, but chips land in upload-finish order, not argument order. So `--batch` is opt-in (callers relying on order, e.g. "first image is REF", stay correct), batches only non-video files, and keeps videos serial after it so each video chip keeps a known index for its settings dialog. |
| Windows caps a command line near 32K chars: ~250 long scratchpad paths fail with `ENAMETOOLONG` both when a caller passes them to `ask.ts` and when `ask.ts` passes them to `agent-browser upload`. | `--files-from <list>` reads attachment paths from a file, and `upload` sends its paths over stdin (`agent-browser batch`, like `fill`): 300 images land as 300 chips from one call in ~7 s. |
| Reading each name's chip text by walking up from every chip (`innerText` per name per chip) cost ~2.6 s of page time per name at 300 chips, so the `--batch` readiness poll outlived agent-browser's eval timeout (`Failed to read ... os error 10060`) from ~150 files on. | `chipTextsByName` reads every chip's text once (16–30 ms in page for 300 chips). On a shared Chrome even `eval 1` can take 3–9 s round trip; that is load, not page work. |
| Hundreds of image chips slow every page command: 600 stills (690,600 tokens) froze the tab past agent-browser's per-command wait at upload or Run in 3 of 3 tries, and `AGENT_BROWSER_DEFAULT_TIMEOUT=120000` did not help. | Keep one prompt at or below ~450 images. 150/300/450 stills (1444x1414, 1,151 tokens each) uploaded in 63/109/154 s, delivered ~95% of chip tokens, and `gemini-4-hydrogen` read back 100% of the burned frame counters. Split longer frame sets into windows. |
| Later single-tab Hydrogen High probes completed at 500 and 550 stills of the same size. The 550-image request showed 633,050 chip tokens and delivered 600,000 `IN`; the short answer reported the correct range `0–549`. | Treat 450 as the review workflow cap. The 550-image result measures short-answer capacity; neither the provider's absolute limit nor full audit quality at that count was measured. |
| In the 180-image probe the Playground displayed a daily quota error in a Model turn. The CLI logged `answered`, accepted the page total, then failed to copy a report. | Use the live alert or failure screenshot to identify the quota card. Exclude the page total from delivered-input and review-quality results. |
| Agentic video understanding is downgraded too: on a 30.5 s clip `gemini-4-hydrogen` said it received only 31 frames (`f14`, `f44`, ... `f914`) and refused a frame-level audit. | Sub-second checks (cuts, pops, caption timing) go through burned-timecode stills with `--batch`; images keep full resolution. |
| Hydrogen offered Low, Medium, High, and Extra High. At Extra High, two detailed 305-still audits (acting and fast events) stopped after Thoughts without an answer. | Use `--thinking High` for detailed reviews. The observed Output length was 65,536. The internal reasoning budget and the effect of increasing the setting were unmeasured. |
| Enabling Agentic hides FPS/Start/End and shows `Agentic` instead of token counts. | `ask.ts` rejects combining `--agentic` with `--fps`/`--start`/`--end`; chip readiness accepts `Agentic`. |
| AI Studio normalizes timestamps on save (`0m2s` -> `2s`). | Compare via `toSeconds` (unit-tested in `lib.test.ts`). |
| Rejected video bounds keep the dialog open with text in `p.dialog-error`. | On timeout, `closeDialog` surfaces `dialogError` verbatim. |
| Dialog container lacks `role="dialog"`. | Target `mat-dialog-container`; wait for the `Save` button. |
| While running, `Run` becomes `progress_activity Stop` and loses `.run-button-label`; misreading copies thoughts instead of the answer. | Require button text `Run`, final `Model` turn text outside `ms-thought-chunk`, and increased turn count. |
| Stopping mid-thought leaves a thought-only final turn. | Do not treat thought-only turns as answers; report `has no answer` or thought-cap exhaustion. |
| Virtualized chat turns only render `ms-prompt-chunk` near the viewport. | `showTurn` scrolls the turn into view and waits for `turnBody`. |
| Turn options button only activates on turn hover and can be obscured by the `Copied` toast. | `openTurnMenu` probes a visible turn point via `elementFromPoint`, moves the mouse there, and verifies button clickability at its center. |
| Video-only turns lack `Copy as markdown` in their menu. | `read` records attachment filenames for those turns. |
| `Copy as markdown` invokes `execCommand` and clobbers the Windows clipboard. | Capture copied text in a capture-phase `copy` listener and call `preventDefault()`. |
| New chats receive a saved URL ~1 minute after the first reply. | Poll up to 2 minutes post-reply; fall back to printing `ASK --collect`. |
| AI Studio persists the Google Search switch across all future new chats in the profile. | Always pass `ASK --tool search=on\|off`; `run` logs the active search state. |
| Reloading a generating chat discards the in-progress reply. | `openChat` skips reload if already open; navigation refuses while generating. |
| Invalid or cross-account chat IDs redirect to `/prompt-access-restricted`. | `waitForPromptBox` detects both access-restricted and Google login redirects clearly. |
| Model picker auto-closes with animation; clicking `Close` immediately misses. | Wait 3s for auto-close before clicking the adjacent `Close` button if still open. |
| Alias models (e.g., `latest`) contain real model IDs inside their label. | `pickerItemFor` matches the first ID token in each item label. |
| New chats have no rename button (`Playground` heading); page title is the sole `h1`. | Scope `renameButton` to saved chats and bind `title` to `h1`. |
| System instructions edited in the panel do not persist until Run. | `ask.ts --system` / `--system-file` applies right before sending. |
| CRLF prompts read back as LF, failing equality checks. | Normalize prompts to LF before typing. |
| Chrome spawned via `Bun.spawn` dies when the agent shell exits. | Spawn via PowerShell `Start-Process`. |
| Separate parallel shell commands under Windows job-object sandboxes (e.g., Antigravity `exebox-*`) terminate Chrome when the spawning shell exits, failing peer tabs with CDP timeouts. | Launch concurrent `--tab` runs from one shared parent process (`studio.ts chrome`, then `Promise.all` / background jobs), or keep `studio.ts chrome` alive in a dedicated daemon session. |
| Running >= 4 heavy AI Studio tabs simultaneously on shared Chrome port `9333` (e.g., multiple concurrent AI sessions) saturates CDP and causes `/json/version` timeouts mid-upload. | Check `STUDIO tabs --json` first and keep total active tabs `<= 3` across all sessions (run 1 tab sequentially per session whenever peer tabs are active). |
| Injected JS regex strings need double escapes (`\\d`, `\\b`); sed/heredoc edits corrupt them. | Edit injected JS with `edit_file` and grep afterward. |
| `agent-browser close` on `--cdp` closes the entire shared browser. | Never call `close`; close individual tabs via CDP `Target.closeTarget`. |
| Off-screen windows previously stole focus via CDP `windowState: normal` or `agent-browser tab <id>` / `about:blank`. | Fixed via Win32 shield (`SW_SHOWNOACTIVATE`), minimal tab switches, and `LockSetForegroundWindow` around `prepareTab`. Never use `SetWindowPlacement` (Microsoft docs confirm it drags off-screen windows to `0,0`). |
| Gemini hallucinated synthetic audio tones (claimed 1000 Hz beeps on a continuous 440 Hz tone). | Always verify critical claims independently. |
| Sending two 55s videos separately (753k tokens) at Extra High exhausted the 65,536 Output length cap inside Thoughts. | Reduce input size/tokens (e.g., shorten or pre-tile dual streams externally into one clip) or lower `--thinking`; `waitForAnswer` checks `LAST_IS_THOUGHT_ONLY` to report cap exhaustion explicitly. |
| Daily quota banners left an error turn matching `LAST_IS_ANSWER`, causing generic `copied nothing` errors. | `copyTurnMarkdown` retries once on empty copy when no alert exists and always appends `AI Studio says: <pageAlerts()>` on failure. |
| Dense long responses can hit output-length cutoff mid-table or mid-code-fence without an AI Studio error banner. | `detectPossibleTruncation` (`lib.ts`) checks copied markdown for unclosed fences, truncated trailing table rows, unclosed bold spans, or trailing mid-clause punctuation and prints `⚠ warning: answer may be truncated (...)` in `ask.ts` alongside the `--chat` follow-up command. |
| AI Studio `CreateInteraction` rollout (`2026-11-24`) displayed high-FPS/High-res chip token counts (`209,131 tokens`) yet dropped `videoMetadata.fps` and `mediaResolution` in the request payload, silently delivering `1 FPS / Low` (`~9.5k IN`) without any UI error. | After `wait for answer` and before saving `--out`, `ask.ts` runs `verify video delivery` (`readDeliveredTokensWithRetry` + `verifyDeliveredVideoTokens` in `lib.ts`), rejecting runs whose delivered `IN`/total tokens (or pre-upload `--chat` follow-up baseline deltas, failing closed if the prior baseline is unreadable) fall below `max(45% of confirmed video chip tokens, --min-in-tokens)` (exit `1`, no degraded file saved). |

## Experiments & Verified Test Matrix (2026-11-21 Baseline)

- **Rejected approaches:** `--headless=new` (leaks `HeadlessChrome` UA, login/sign-out risk), minimized windows (`hidden` state), `Start-Process -WindowStyle Minimized` (still steals focus), `SetWindowPlacement` (drags slot `>=1` to `0,0`), `AttachThreadInput` (unsafe hack), `SetForegroundWindow` return-focus (refused by Windows when Chrome owns foreground), 5s lock-retry loop (error 5 means no permission too; replaced by named mutex), CLI-arg fill for >32k chars (`ENAMETOOLONG`; moved to stdin JSON batch).
- **Verified live scenarios:** `doctor` (51 checks: 47 first-candidate hits, 4 valid optional absences, 0 fallbacks), `smoke` (2s clip, Low/Low, 24fps), dual clipped videos (`1s–3s` 24fps), colliding filenames (`x a.mp4` + `a.mp4`), `--batch` 61 JPEG stills on `gemini-4-hydrogen` (70,211 chip tokens, all 61 timecodes read back), `--batch --files-from` 150/300/450 stills on `gemini-4-hydrogen` (all frame counters read back), `--batch` 3 stills + 1 trailing 24fps video on `gemini-3.8-flash` (video delivery check passed), normalized `--end 0m2s`, rejected video bounds error surfacing, 40k-char `--prompt-file`, follow-up + `--chat` + `--collect` recovery after 6s timeout on 105s run, multi-turn `read` preserving Windows clipboard, 2 parallel tabs, persistent Search toggle in both directions, `models`/`model`/`set`/`tool`/`rename`/`system`/`history`/`tabs`/`tab close`/`chrome --show`, `GetForegroundWindow` focus-safety suite (Win+D, `--show`, `target=_blank` cover, 3-tab mutex queue), and `--system-file` (valid, CRLF, empty/missing/conflict exit `2`).

## Known Limitations

- **No per-tab lock:** Two simultaneous commands on the same `--tab` collide (confirm with the user before adding lock complexity).
- **Foreground lock covers `prepareTab` only:** Subsequent actions use non-activating commands; if Windows refuses foreground lock (error 5 when caller lacks foreground rights), `lib.ts` logs `foreground not locked` and proceeds.
- **Win+D edge case:** Can briefly show a small bar near Start until the next `guardWindows` tick restores it off-screen.
- **Single-turn copy & page-1 history:** `ASK` copies the last Model turn (`STUDIO read` fetches all turns); `history` reads page 1 (`--search` finds older chats).
- **Duplicate attachment basenames:** Rejected by `ask.ts` because AI Studio chips display basenames only.
- **Intentionally absent destructive commands:** Delete chat, branch, UI presets, and structured-output schemas are not wrapped (deleting chats is irreversible; confirm before adding).
- **Windows-oriented launcher:** Uses PowerShell `Start-Process`; override binary paths with `AGENT_BROWSER_EXE`, `AGENT_BROWSER_CONFIG`, and `CHROME_EXE` (top of `scripts/lib.ts`).

## Extending `studio.ts` or `ask.ts`

1. Verify the feature stays strictly inside `/prompts` and `/library`; inspect in a separate tab (`STUDIO --tab dev ab snapshot -i`).
2. Add `MAP` entries to `scripts/page-map.ts` (see [ui-changes.md](ui-changes.md)), adding any new `Where` state to `doctor`.
3. Put shared actions in `scripts/lib.ts`; wire strict `parseArgs` options (exit `2` on unknown flags), `USAGE`, verified `add(...)` steps with `StepError`, and `emit(data, () => text)` in `studio.ts` (or both `--collect` rejection guards + `USAGE` in `ask.ts`).
4. Add unit tests in `scripts/lib.test.ts` for pure logic, run the verification suite above, verify live on AI Studio, update [SKILL.md](../SKILL.md) if top-level usage changed, and close test tabs.
