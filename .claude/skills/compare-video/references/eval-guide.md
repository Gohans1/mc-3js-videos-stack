# Prompt Evaluation & Upgrade Guide (`compare-2-video`)

## Current still-frame A/B

Use the [still-frame recipe](stills-field-audit.md#recipe) and freeze the JPEG lists, windows, and ground truth before sending either arm. Set Hydrogen High, High media, and Search off unless one of those settings is the variable under test. Use one fresh chat per pass. For grouped versus split comparisons, compare the same fields on the same images. Score matched, completed reports by visual evidence. Keep quota, transport, and Thoughts-only failures in the run log. See [measured results](prompt-design.md#batch-capacity-follow-up-2026-11-26).

## Archived video-input baseline

The settings and rubric below reproduce the archived evaluations of `system/compare-2-video.md`. Compare variants head to head on the same backend and inputs.

| Rule | Requirement | Why |
| --- | --- | --- |
| Hold variables constant | Compare old vs new on the exact same backend, model (`gemini-4-hydrogen`), `Thinking: Extra High`, `Media: High`, `24fps`, `Search: off`, and identical `reference sidebyside` composite | Prevents model or resolution drift from confounding scores |
| Guard prompt length | Keep system prompts around 90–115 lines; do not add a 5th section or extra columns without proven lift | Bloated prompts dilute attention across 375k–650k video tokens and risk 65k output-cap truncation |
| Never create a closed list | Every Taxonomy parenthetical is an open hint; keep novel defect & secret-sauce observation active | Closed lists cause the model to miss real unlisted defects |
| Ban optical finishing fabrication | Require visible pixel evidence before logging grain, flare, halation, CA, or vignette differences | Stops the model from inventing fake film-stock differences on clean CG renders |
| Keep Taxonomy mode-agnostic | `## Reusable Film & Motion Craft Taxonomy` must remain byte-identical across `.claude/skills/analyze-ref-video/system/analyze-ref-video.md`, `.claude/skills/compare-video/system/compare-2-video.md`, and `.claude/skills/channel-dna/system/learn-channel-video.md` (enforced by unit test) | Guarantees one shared vocabulary across breakdown, comparison, and channel learning |
| Zero engine/channel/style leaks | Ban fixed channel names, hardcoded target styles (e.g., Minecraft/voxel/anime), Three.js syntax, `draw(t)`, or CLI flags inside the system prompt | Keeps comparisons open and universal across any target medium (3D, 2D, voxel, claymation, vector, live-action, commercials) |
| Never fabricate unsupplied audio | Require `Conf=Low` / watchlist note for masked 1Kbps SFX or unattached `REF` audio in single-file composites | Eliminates hallucinated audio defects |

## 5-Step Upgrade Loop

Execute Steps 1–5 sequentially; overwrite `system/compare-2-video.md` only after clearing Step 5.

| Step | Action | Artifact |
| --- | --- | --- |
| 1 | Build the 4 control composites below via `bun run reference sidebyside` | Temp composite MP4s in `%TEMP%` |
| 2 | Save draft prompt separately and run 2–3 independent subagents to critique wording before live runs | Pre-A/B wording fixes |
| 3 | Run old vs new live on the configured runner (default: `aistudio`, `--model gemini-4-hydrogen --thinking "Extra High" --media High --fps 24 --tool search=off`) | Paired markdown outputs |
| 4 | Run automated structure & precision/recall checks (4 sections complete, zero truncation, `Blocker -> Major -> Minor` ascending order, Sec 1 counts = Sec 3 rows, `0/0/0` on identical control) | Quantitative A/B JSON summary |
| 5 | Hand paired blind outputs + 30fps GT frames to 2–3 independent subagents on the 6-axis 30-point rubric; ship only on unanimous PASS (`0 Critical`, `0 Required`) with zero precision/recall regression | Updated `system/compare-2-video.md`, [prompt-design.md](prompt-design.md), and [eval-baseline.json](eval-baseline.json) |

## Dedicated Evaluation Suite (v3 -> v4+)

| Control Clip | Source / Construction | What It Tests | Hard Gate |
| --- | --- | --- | --- |
| `food_sbs` (`54.8s`, `hstack`) | `bun run reference sidebyside films/food-eat-more/references/ref.mp4 films/food-eat-more/renders/draft.mp4` (add 2D/anime/live-action pairs when expanding suite) | Real cross-medium stylized remake vs photoreal 3D CG: cuts, 1f pop, clipping, floating, bloom, blur, acting, `audio:ours` | Zero truncation (all 4 sections), zero intentional-medium or brand false positives, no recall regression |
| `synth_ident_sbs` (`10.0s`, `hstack`) | Tile first 10s of `ref.mp4` beside itself | Anti-hallucination gate (ViDiC) | Must output `PASS` with `0` Blocker / `0` Major / `0` Minor |
| `synth_sbs` (`12.0s`, `hstack`) | 12s `ref.mp4` with 5 zones: `f0–f104` clean, `f105–f179` dark/desat, `f180–f254` `1.35x` zoom + `f210–f211` 2f black flash, `f255–f344` `+10f` lag, `f345–f359` 15f black tail | Exact Precision (`0` false positives in `f0–f104`) and Recall (`5/5` planted faults) | `0` false positives in `f0–f104` and `5/5` faults caught |
| `synth_drift_vstack` (`14.0s`, `vstack`) | 16:9 crop (`2s–16s`) with 6fps judder `f90–f149`, 30f freeze `f150–f179` + Hard Cut `f180`, cumulative `+12f` lag `f180–f419` | Landscape `vstack`, true judder detection, single drift diagnosis, anti-confounding guard | Detects 6fps judder, 30f freeze, `+11..12f` lag, and `0` false framing bugs from drift |

## 6-Axis Rubric (30 Points / Clip)

| Axis | Criteria | Hard Gate |
| --- | --- | --- |
| 1. Ground-Truth Precision & Anti-Hallucination | Every defect backed by true 30fps `REF` + `OURS` evidence; zero fabricated flaws on clean `Match` spans | Mandatory `PASS 0/0/0` on `synth_ident_sbs` and `0` false positives on clean spans |
| 2. Defect Recall & Single-Frame Rigor | Catches critical gaps: broken `Continuous`/`Hidden Cut`, 1f pop, clipping, floating, z-fighting, bloom blowout, missing blur, freezes, judder, black tail `>=6f` | No recall regression vs v2/v3 baselines in [eval-baseline.json](eval-baseline.json) |
| 3. Intentional Adaptation Discipline | Ignores target-medium visual style, proportions, simplified contact/rig conventions, translucent container interiors, and swapped brands (specific style filtering stays in Step 5 orchestrator) | Heavy penalty for complaining about intentional medium adaptation or brand replacement |
| 4. Drift Diagnosis & Anti-Confounding | Diagnoses cumulative drift once in Sec 1 and compares `REF(t-delta)` vs `OURS(t)` before logging framing flaws | No spam drift rows or drift-confounded fake crop bugs |
| 5. Triage, Actionable Fix & Calibration | Severity reflects visual impact (never downgraded for `Conf=Med`), 1 crisp sentence + concrete fix per Sec 3 row, honest `Conf` (never fabricate 1Kbps SFX or unsupplied `REF` audio) | Sec 1 totals match Sec 3 counts 100%; every Sec 3 row includes an actionable fix |
| 6. Schema Hygiene & Zero Truncation | Complete 4 sections within 65k cap, 5-state Sec 2 boundaries, 8 Taxonomy categories in Sec 3, strict `Blocker -> Major -> Minor` + ascending frame order, zero engine leaks | Zero truncation on dense 55s remakes like `food_sbs` |

## Baseline Storage

Store all new A/B score blocks by appending to [eval-baseline.json](eval-baseline.json) — never overwrite historical compare v2/v3 baselines.
