---
name: compare-video
description: Compares a reference video (REF) against a remake render (OURS) at 24 FPS to surface frame-accurate camera, boundary, motion, acting, VFX, lighting, caption, and 3D render defects in a prioritized Blocker/Major/Minor ledger, driving an iterative verify-and-fix QA loop until pass. Backend-agnostic multimodal workflow (defaults today to the aistudio CLI). Use when asked to compare two videos, audit a remake against its reference, or iterate compare-and-fix until pass. Triggers include "compare video", "compare 2 videos", "compare ref vs ours", "audit remake", or Vietnamese equivalents ("so sánh 2 video", "so sánh video ref", "compare video đến khi pass").
---

# compare-video

Backend-agnostic `REF` vs `OURS` comparison and remake QA skill: tiles both videos into one synced 720p side-by-side composite, runs the calibrated 4-section comparison prompt [system/compare-2-video.md](system/compare-2-video.md) through any 24 FPS multimodal runner (defaulting today to `.claude/skills/aistudio/scripts/ask.ts`), and enforces native 30fps local ground-truth verification before every fix round.

## Review Gate & Iterative QA Loop

Never invoke external multimodal video runs unsolicited — confirm with the user unless explicitly delegated.

| Step | Action | Output / Verification |
| --- | --- | --- |
| 1. Render blur-accurate remake | Inside `films/<name>/`, render with `--samples 8` or `--samples 16` when camera whips or fast motion blur matter (a `--samples 1` draft triggers a blur warning in `sidebyside`) | `renders/draft.mp4`, `renders/span_<a>-<b>.mp4`, or `renders/final.mp4` |
| 2. Build synced `REF\|OURS` composite | Inside `films/<name>/`: `bun run reference sidebyside references/ref.mp4 renders/draft.mp4 --out renders/reference/vN_sbs.mp4` | Single synced 720p composite (`hstack` for portrait, `vstack` for landscape; auto-strips draft bar, auto-aligns spans/chunks, keeps `audio:ours`, cuts token usage by ~50% to avoid 65k Thoughts cap) |
| 3. Run multimodal comparison | Pass `vN_sbs.mp4` + [system/compare-2-video.md](system/compare-2-video.md) through the configured runner (default `aistudio` recipe below); append any known Creator Notes as `Intentional overrides (do NOT flag): ...` in the user prompt | Saves 4-section defect report (`renders/reference/vN_compare.md`) |
| 4. Check for truncation | Watch for truncation warnings (`⚠ warning: answer may be truncated (...)` / `may be truncated:`) or missing Section 4; if truncated, send a follow-up continuation (e.g., `ASK --chat <url>`) from the last completed row | Complete 4 sections: Verdict & Drift, Shot-by-Shot Diff, Prioritized Defect Ledger (`Blocker -> Major -> Minor`), Local Verification Watchlist |
| 5. Mandatory local 30fps verify | **Never trust any VLM claim blindly.** Inspect every flagged `Blocker` / `Major` on native 30fps frames (`bun run sheet renders/reference/vN_sbs.mp4 frames ...` or `bun run render stills --samples 16 --ref references/ref.mp4 --at ...`), confirm intentional creator notes, and discard false positives | Verified root-cause fix list (`Verified Blocker` / `Verified Major`; fix monorepo engine/CLI bugs upstream when uncovered) |
| 6. Fix full, re-render full, stop by brakes | Apply all verified fixes across the film, run deterministic checks (`check`, `--check order`, `framecheck`, `sweep`), re-render the full draft/final, and run a fresh full-video comparison round under the stopping rules below | Verified pass or escalated stall report |

**Direct 2-file audio comparison fallback:** Because `reference sidebyside` carries one audio track (`audio:ours` by default), pass two separate files (`ref_timecode.mp4` + `draft.mp4`) with `--start`/`--end` **only on `< 20s` clips** (or lower `--thinking High`) when you explicitly need Gemini to compare both audio streams simultaneously.

## Stopping Rules & Anti-Loop Brakes

Never hardcode an arbitrary round ceiling (stopping early while `Verified Blocker`s are still dropping leaves broken video shipped), and never chase raw VLM `0/0/0` on cross-style remakes (e.g., Minecraft vs realistic 3D):

| Rule | Condition | Action |
| --- | --- | --- |
| **Verified PASS** | `0 Verified Blocker` AND `< 2 Verified Major` (`0` or `1` genuine Major remaining after 30fps ground-truth verification, excluding VLM false positives and intentional creator overrides) | **PASS & STOP** immediately |
| **Monotonic Progress (`Fix Full -> Compare Full`)** | `>= 1 Verified Blocker` OR `>= 2 Verified Major` remain, AND verified defect counts are dropping across rounds | Fix all verified issues across the film, re-render the full video, and run a fresh full-video comparison round (no arbitrary round cap while progress continues) |
| **Stall Circuit Breaker** | **2 consecutive rounds** fail to reduce `Verified Blocker` count (flat or regressed) OR the same verified defect in the same shot survives 2 consecutive fix attempts | **STOP & REPORT** to the user with 30fps `sheet`/`stills` evidence and root cause instead of burning quota in circles |

## Default Runner Recipe (`aistudio` CLI)

Run from the repo root (`ASK = bun .claude/skills/aistudio/scripts/ask.ts`):

```bash
ASK --tab cmp-qa --model gemini-4-hydrogen --thinking "Extra High" --media High --fps 24 --tool search=off --system-file .claude/skills/compare-video/system/compare-2-video.md films/<name>/renders/reference/vN_sbs.mp4 "Compare REF (left) vs OURS (right) across the full video." --out films/<name>/renders/reference/vN_compare.md
```

When intentional Creator Notes diverge from `REF` (e.g. a custom glow pulse or modified prop), append `" Intentional overrides (do NOT flag): <brief list>."` to the user prompt. Always pass `--model gemini-4-hydrogen --thinking "Extra High" --tool search=off` for high-precision defect recall, and close temporary tabs afterward via `bun .claude/skills/aistudio/scripts/studio.ts tab close cmp-qa`.

## Backend-Agnostic Runner Contract

This skill owns the **comparison QA workflow, system prompt, design rationale, and eval baselines** — never the transport. Swap the default `aistudio` runner for Gemini API, Vertex AI, or another 24 FPS multimodal CLI by honoring this contract without editing [system/compare-2-video.md](system/compare-2-video.md):

| Input / Output | Contract |
| --- | --- |
| `files` | `[vN_sbs.mp4]` (synced `REF\|OURS` composite; or `[ref, ours]` on `< 20s` dual-audio checks) |
| `systemFile` | `.claude/skills/compare-video/system/compare-2-video.md` |
| `prompt` | Concise directive naming panel layout (`"Compare REF (left) vs OURS (right) across the full video."` or top/bottom for `vstack`), plus optional `Intentional overrides (do NOT flag): ...` |
| `model` & `thinking` | High-precision multimodal video model (`gemini-4-hydrogen` / equivalent) with Extra High reasoning; web search / grounding **OFF** |
| `mediaResolution` & `fps` | High resolution at `24 fps` |
| `range` *(optional)* | `{ startSec, endSec }` — reserved seam for future long-form windowing |
| Return value | Raw UTF-8 markdown containing all 4 sections of `compare-2-video.md` |

## Scope & Future Long-Form Extensibility Seam (`> 3 min`, Not Yet Implemented)

- **Current production scope (`<= 3 min`):** Single-pass 24 FPS `reference sidebyside` composites of Shorts, scenes, and `span_`/`chunks/cNN` renders (`~375k` tokens for 55s at 24fps Media High).
- **Reserved long-form seam (`15+ min`, planned — NOT yet implemented):** Do not pass a single 15-minute side-by-side render into one call (exceeds context/65k output limits). Future automation should slice `REF` and `OURS` into aligned windows (`bun run reference sidebyside` with film-clock start/end offsets), run the exact same [system/compare-2-video.md](system/compare-2-video.md) per window, and aggregate per-window findings into one global film-clock Defect Ledger.

## Reference Index (1 Level Deep From SKILL.md)

| Path | Purpose |
| --- | --- |
| [system/compare-2-video.md](system/compare-2-video.md) | Official v2 system prompt (94 lines, 4 sections, intentional-adaptation guard, 3-way byte-identical Craft Taxonomy) |
| [references/prompt-design.md](references/prompt-design.md) | v2 engineering log, 7 documented VLM comparison traps, 10-arm `food-eat-more` + synthetic eval matrix, and `sidebyside` rationale |
| [references/eval-guide.md](references/eval-guide.md) | Mandatory pre-edit rules, 5-step upgrade loop, 4-clip real+synthetic control suite, and 6-axis 30-point rubric |
| [references/eval-baseline.json](references/eval-baseline.json) | Machine-readable JSON storing the 10-arm `comparePromptEval` benchmark results and ground-truth metrics |
