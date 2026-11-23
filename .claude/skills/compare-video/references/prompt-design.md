# Two-Video Comparison Prompt Design (`compare-2-video` v2)

Canonical engineering log of design rationale, 7 documented VLM comparison traps, the 10-arm evaluation matrix on `gemini-4-hydrogen`, and trade-offs for `system/compare-2-video.md` (official v2, 94 lines). For the upgrade loop see [eval-guide.md](eval-guide.md); raw scores live under `comparePromptEval` in [eval-baseline.json](eval-baseline.json).

## Inherited Taxonomy & 7 VLM Video-Comparison Traps

The 8-category `## Reusable Film & Motion Craft Taxonomy` block is copied verbatim from `.claude/skills/analyze-ref-video/system/analyze-ref-video.md` for identical vocabulary. The role, rules, and 4-section layout target 7 failure modes documented across 2025–2026 benchmarks and live AI Studio testing:

| VLM Comparison Trap | Evidence & Root Cause | Mitigation in `compare-2-video` v2 & CLI |
| --- | --- | --- |
| Dual separate uploads desync frames and double token cost | CrossVid & SYNCR report steep drops across dual unaligned streams; on 54.8s `food-eat-more`, 2 files cost `752,822` tokens and exhausted the `65,536` Thoughts cap | Added `bun run reference sidebyside` producing one synced `REF\|OURS` (portrait) or `REF/OURS` (landscape) file with shared timecode, auto-stripped draft bar, cutting tokens 50% to `376,411` |
| Confirmation prompts induce sycophancy & missed flaws | ViDiC measured `50.6%` missed diffs and `28.3%` self-contradictions; VISE showed confirmation framing triggers sycophancy | Default VFX Dailies Supervisor defect-first stance requiring paired `REF` + `OURS` evidence on every row |
| Hallucinating defects on identical footage | ViDiC measured `16.7%` false diffs on identical clips | Explicit clean `Match` rule requiring `PASS` with `0` defects on faithful/identical footage (`0%` false positives verified on 10s identical control) |
| Flagging intentional Minecraft styling or replaced brands | Copying `analyze-ref-video` wasted rows complaining about blocky heads, brand swaps, and draft bars | Explicit ignore list (Minecraft cubes, wider block heads, proportional held props, swapped brands) vs strict craft/3D render QC list |
| Cumulative timing drift spawning duplicate false crop bugs | When `OURS` lagged `+10f` on a pull-back in v1, the model misreported a static `1.2x` crop error | Diagnose global drift once in Section 1 and enforce story-aligned `REF(t-delta)` vs `OURS(t)` comparison before logging framing bugs |
| Missing remake-only 3D render faults & downgrading `Blocker` when `Conf=Med` | Reference prompts forbid critique; v1 dual-file downgraded all 12 `Blocker`s to `Major` | Explicitly target `clipping`, `floating`, 1-frame `pop`, `z-fighting`, `shutter stepping`, `judder`, `shimmer`, black tail `>=6f`; decouple Severity strictly from `Conf` |
| Output truncation at the 65,536 token cap | v1 composite (`20,410` chars) truncated mid-row 63 and lost Section 4 | Tight 1-sentence Sec 3 rows with concrete fixes, deduplicated global issues, and max `5` `Minor` rows guarantee complete 4-section outputs |

## 10-Arm Evaluation on `food-eat-more` (54.8s Minecraft Remake vs Zack D. Films)

All arms ran identically on `gemini-4-hydrogen`, `Thinking: Extra High`, `Media: High`, `24fps`, `Search: off` over `films/food-eat-more/references/ref.mp4` and `renders/draft.mp4`. Thirty-six 30fps ground-truth panels (`12+12+12`) verified `24/24` claims on v1 and `34/34` claims on v2 (`f1562` pre-disappearance frame verified at `f1563` where the brain vanishes completely). Recall below measures exact Section 3 coverage of 13 verified ground-truth defects:

| Test Arm | Tokens | Elapsed | Chars | Truncated | Verdict & B/M/m | Ground-Truth Recall (13) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Old `compare-2-video` (13L, 2 files) | `752,822` | `326.0s` | `4,157` | No | None | `5/13` (`38.5%`) | No frame numbers, no severity triage, no fixes, fabricated audio |
| Naive copy `analyze-ref-video` (2 files) | `752,822` | `370.1s` | `7,888` | No | `3/5` | `6/13` (`46.2%`) | 3 style/bar false positives, missed audio, no actionable fixes |
| Compare v1 (2 separate files) | `752,822` | `671.5s` | `9,331` | No | `NEEDS POLISH` (`0/12/0`) | `9/13` (`69.2%`) | Downgraded every Blocker to Major due to `Conf=Med`; missed audio |
| Compare v1 (1 `sidebyside` file) | `376,411` | `689.1s` | `20,410` | Yes (lost Sec 4) | `FAIL` (`12/13/0`) | `13/13` (`100%`) | `24/24` GT verified, heard `audio:ours`, but exceeded 65k cap |
| Compare v2 (2 separate files) | `752,822` | `475.5s` (run 2) | `2,647` | Yes (hit 65k) | `FAIL` (Sec 1 `14/12/5`, Sec 3 `0` rows) | `0/13` in Sec 3 (cut at `S04`) | Run 1 exhausted 65k inside Thoughts (`0` chars); confirms dual-file is for short clips only |
| **Compare v2 (1 `sidebyside` file)** | **`376,411`** | **`432.0s`** | **`21,812`** | **No (all 4 secs)** | **`FAIL` (`15/11/5`)** | **`12/13` (`92.3%`) + 8 new real flaws** | 37% faster than v1, `34/34` GT verified (`100%`), caught deeper `f121–f123` cut, wrong focus `f1235`, 3 new Hard Cuts, clipping, 2D plate `f1074`, vanishing brain `f1561–f1563`; 0 count drift, 0 style noise |

## Synthetic Ground-Truth Suite (Precision, Recall & 0% Hallucination)

Three synthetic clips built from `food-eat-more` with frame-exact planted faults (12 GT panels verified) measured precision and layout generalization across portrait `hstack` and landscape `vstack`:

| Synthetic Clip | Layout & Tokens | Planted Ground Truth | Observed v2 Result |
| --- | --- | --- | --- |
| `synth_ident_sbs` (`10.0s`) | Portrait `hstack`, `69,731` tok | 100% identical halves (`PASS`, `0/0/0`) | `PASS` `0/0/0`, `0` false positives, `7/7` shots `Match`, complete 4 sections |
| `synth_sbs` (`12.0s`) | Portrait `hstack`, `83,671` tok | 5 zones: `f0–f104` clean; `f105–f179` dark/desat; `f180–f254` `1.35x` zoom + `f210–f211` 2f black flash; `f255–f344` `+10f` lag; `f345–f359` 15f black tail | `FAIL` `4/2/0`: `0` false positives in `f0–f104`, caught `5/5` faults to exact frames + `+0.333s` VO desync; minor boundary bleed of `f180–f254` crop label into `f255–f344` (logged as v3 target) |
| `synth_drift_vstack` (`14.0s`) | Landscape `vstack`, `97,611` tok | `f0–f89` clean; `f90–f149` 6fps `5f`-hold judder; `f150–f179` 30f freeze + `f180` Hard Cut; `f180–f419` `+12f` cumulative drift | `FAIL` `5/1/0`: detected `vstack` layout, measured `5f` (`~6fps`) judder (`f110–f149`; `f90–f109` static jar had tiny motion), exact 30f freeze `f150–f179`, VO desync, `+11f` lag (`-1f` at 24fps; Sec 4 noted `+11f/+12f`), `0` false framing bugs at `f255` |

## Independent Blind Scores & v3 Target

Six independent reviewers across 3 rounds (Round 1 fixed 3 Required, Round 2 fixed 2 Required, Round 3 `2/2 PASS` with `0 Critical`, `0 Required`) scored all arms blind on a 30-point 6-axis rubric:

| Blind-Scored Arm (max 30) | Round 1 (R1 / R2) | Round 2 (R1 / R2) | Round 3 PASS (R1 / R2) | Verdict |
| --- | --- | --- | --- | --- |
| `arm_a_old_2file` | `9.5 / 9.0` | `9.5 / 9.5` | `9.5 / 9.5` | Deprecated baseline |
| `arm_b_naive_copy_2file` | `13.5 / 14.5` | `12.5 / 13.5` | `12.5 / 13.0` | Rejected naive copy |
| `arm_c1_v1_sbs` (truncated) | `24.5 / 24.5` | `24.5 / 24.5` | `24.5 / 24.5` | Superseded by v2 |
| **`v2_food_sbs`** | `29.2 / 29.2` | `29.2 / 29.3` | **`29.3 / 29.3`** | Official production benchmark |
| **`v2_synth_ident`** | `30.0 / 30.0` | `30.0 / 30.0` | **`30.0 / 30.0`** | Zero hallucinations |
| **`v2_synth_drift_vstack`** | `29.0 / 28.5` | `28.5 / 28.9` | **`28.9 / 28.8`** | Verified landscape `vstack` + drift guard |
| `v2_synth_4defects` | `26.5 / 25.5` | `26.0 / 26.5` | `26.0 / 26.3` | Caught `5/5` faults; crop end-span bled into `f255–f344` — only upgrade to v3 if A/B proves no regression on `food_sbs` |

## Evolution & Paired CLI Upgrades

| Component | Shipped Change | Verification |
| --- | --- | --- |
| Prompt v1 -> v2 | Added concision budget (1 sentence/row Sec 3, deduplicated globals, max `5` Minors), drift-confounding guard `REF(t-delta)`, Minecraft block-head exemption, Severity decoupled from `Conf`, `>=6f` black-tail threshold, and clean `PASS` template | `4/4` composite runs had `0` truncations, `0` count mismatches, `0` enum/order errors, `0` engine leaks, `0` style noise, `100%` `PASS` on identical clip |
| CLI `reference sidebyside` | Added `bun run reference sidebyside`, extracted video helpers to `scripts/review/reference_video.mjs`, moved `process.exit(1)` outside `try/finally` in `runAtomicFfmpeg` to avoid temp leaks on FFmpeg timeout, added `exclusiveGroup` for `--short-edge`/`--full` in `cli-catalog.ts` | `53/53` tests pass (`1,556` assertions) covering draft-bar crop pixels, `vstack` frame pixels, audio hash, and timeout cleanup; `bun run verify` 0 warnings/errors |
| CLI `aistudio/scripts/lib.ts` | Updated `waitForAnswer` (including `--collect`) to surface 65k Thoughts exhaustion & AI Studio alerts; updated `openTurnMenu` & `copyTurnMarkdown` (1 retry + safe listener cleanup in `finally`) | `4/4` `lib.test.ts` pass, `tsc --strict` exit `0`, `oxlint` 0 errors, `doctor --quick` `41/41` checks |
