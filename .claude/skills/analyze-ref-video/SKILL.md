---
name: analyze-ref-video
description: Produces a frame-accurate, engine-agnostic deep breakdown blueprint of a reference video (macro pacing, 5-state cut/transition boundaries, camera/lens/lighting, motion weight, audio glue, brand logos to replace, and secret-sauce craft) so an AI or director can recreate or copy it faithfully. Backend-agnostic multimodal workflow (defaults today to the aistudio CLI). Use when asked to analyze a reference video, break down a video shot-by-shot, copy or remake a video, or extract visual/motion craft from a reference clip. Triggers include "analyze ref video", "copy video", "break down reference video", "remake this video", or Vietnamese equivalents ("phân tích video ref", "copy video", "bóc tách video mẫu", "làm giống video").
---

# analyze-ref-video

Backend-agnostic, style-agnostic reference video breakdown workflow: prepares a clean 720p timecoded review copy, runs the calibrated 4-section system prompt [system/analyze-ref-video.md](system/analyze-ref-video.md) through any 24 FPS multimodal runner (defaulting today to `.claude/skills/aistudio/scripts/ask.ts`), and pairs the output with local 30fps ground-truth verification before production. Target visual-style adaptation (e.g., 3D stylized, 2D anime, voxel, claymation, vector, live-action) always belongs at the filmmaking-agent layer — never hardcode a specific style into this skill.

## Review Gate & Workflow

Never invoke external multimodal video runs unsolicited — confirm with the user unless explicitly delegated.

| Step | Action | Output / Verification |
| --- | --- | --- |
| 1. Prepare clean timecoded copy | Inside `films/<name>/`: `bun run reference timecode references/ref.mp4` | Writes `renders/reference/ref_timecode.mp4` (720p CRF 22, burned bottom timecode strip `HH:MM:SS.mmm` + frame; keeps `references/ref.mp4` untouched) |
| 2. Run multimodal breakdown | Pass `ref_timecode.mp4` + [system/analyze-ref-video.md](system/analyze-ref-video.md) through the configured runner (default `aistudio` recipe below) | Saves 4-section markdown blueprint (`renders/reference/ref_breakdown.md`) |
| 3. Check completeness | Watch for truncation warnings (`⚠ warning: answer may be truncated (...)` / `may be truncated:`) or missing Section 4; send a follow-up continuation if truncated | Complete 4 sections: `1. Global Craft DNA`, `2. Shot & Beat Spine` (5-state boundaries), `3. Craft & Blind-Spot Delta Ledger` (chronological, 8 Taxonomy categories), `4. Pre-Build Traps & Local Verification Watchlist` |
| 4. Ground-truth local verify | Spot-check ambiguous boundaries, fine text/logos, exact camera framing, and quiet SFX locally using `bun run sheet`, `bun run reference inspect`, `bun run scenes`, `bun run media ocr`, and `earshot` | Verified shot list ready to build in code/timelines |

## Default Runner Recipe (`aistudio` CLI)

Run from the repo root (`ASK = bun .claude/skills/aistudio/scripts/ask.ts`):

```bash
ASK --tab ref-analyze --model gemini-4-neon --thinking "Extra High" --media High --fps 24 --tool search=off --system-file .claude/skills/analyze-ref-video/system/analyze-ref-video.md films/<name>/renders/reference/ref_timecode.mp4 "Analyze this reference video in full detail." --out films/<name>/renders/reference/ref_breakdown.md
```

Close temporary tabs afterward via `bun .claude/skills/aistudio/scripts/studio.ts tab close ref-analyze`. For maximum visual-craft rigor on dense visual/VFX clips, you may pass `--model gemini-4-hydrogen --thinking "Extra High"`.

## Backend-Agnostic Runner Contract

This skill owns the **workflow, system prompt, design rationale, and eval baselines** — never the transport. Swap the default `aistudio` runner for Gemini API, Vertex AI, or another 24 FPS multimodal CLI by honoring this contract without editing [system/analyze-ref-video.md](system/analyze-ref-video.md):

| Input / Output | Contract |
| --- | --- |
| `files` | `[ref_timecode.mp4]` (1 video with burned timecode strip) |
| `systemFile` | `.claude/skills/analyze-ref-video/system/analyze-ref-video.md` |
| `prompt` | Concise directive (e.g. `"Analyze this reference video in full detail."`) |
| `model` & `thinking` | Frontier multimodal video model with high/extra-high reasoning; web search / grounding **OFF** |
| `mediaResolution` & `fps` | High resolution at `24 fps` |
| `range` *(optional)* | `{ startSec, endSec }` — reserved seam for future long-form windowing |
| Return value | Raw UTF-8 markdown containing all 4 sections of `analyze-ref-video.md` |

## Scope & Future Long-Form Extensibility Seam (`> 3 min`, Not Yet Implemented)

- **Current production scope (`<= 3 min`):** Single-pass 24 FPS analysis of Shorts and short clips fits comfortably inside the 1M-token context window (`~350k–650k` tokens).
- **Reserved long-form seam (`15+ min`, planned — NOT yet implemented):** Do not feed a raw 15-minute 24 FPS clip into a single call (exceeds context/output caps). Future automation should slice the source into overlapping timecoded windows with true film-clock timestamps, run the exact same [system/analyze-ref-video.md](system/analyze-ref-video.md) per window (passing a brief prior-window continuity handoff in the user prompt), and stitch per-window shot tables and blueprints into one unified ledger.

## Reference Index (1 Level Deep From SKILL.md)

| Path | Purpose |
| --- | --- |
| [system/analyze-ref-video.md](system/analyze-ref-video.md) | Official open, style-agnostic v4 system prompt (100 lines, 4 sections, 5-state boundaries, active audio listening guard, 3-way byte-identical Craft Taxonomy) |
| [scripts/score-breakdown.ts](scripts/score-breakdown.ts) | Deterministic quantitative scorer (Pillar 1 contract/hygiene `25 pts` + Pillar 2 `scenes.py` boundary alignment `25 pts` + 12-frame 30fps GT sampling plan; unit-tested in `score-breakdown.test.ts`) |
| [references/prompt-design.md](references/prompt-design.md) | v1->v4 engineering log, shared Taxonomy contract, `N=60` baseline, and controlled v3 vs v4 A/B scores |
| [references/eval-guide.md](references/eval-guide.md) | Mandatory pre-edit rules, 3-pillar 100-point quantitative eval rubric (`>=95%` ship gate), 5-step A/B upgrade loop, and multi-medium regression suite |
| [references/eval-baseline.json](references/eval-baseline.json) | Machine-readable JSON storing historical v3/v4 baselines and open multi-medium quantitative scores |
