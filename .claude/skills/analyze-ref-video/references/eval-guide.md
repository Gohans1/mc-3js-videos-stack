# Prompt Evaluation & Upgrade Guide (`analyze-ref-video`)

Standard operating guide for future AI sessions upgrading `system/analyze-ref-video.md` (v4 -> v5+) with measured A/B evidence instead of guesswork.

## Mandatory Pre-Edit Principles

Every change must pass head-to-head live A/B testing on the same multimodal backend before replacing the official system prompt.

| Rule | Requirement | Why |
| --- | --- | --- |
| Hold variables constant | Compare old vs new on the exact same backend, model, `Thinking: Extra High`, `Media: High`, `24fps`, `Search: off`, and identical 720p CRF 22 timecode clip | Prevents model or resolution drift from confounding scores |
| Guard prompt length | Keep system prompts around 95–115 lines; do not add a 5th section or extra columns without proven lift | Bloated prompts dilute attention across 300k–650k video tokens |
| Never create a closed list | Every Taxonomy parenthetical is an open hint; keep Secret-Sauce discovery active | Closed lists cause the model to ignore novel unlisted craft |
| Zero engine/channel leaks | Ban fixed channel names, Three.js syntax, `draw(t)`, CLI flags, or auto-shutter assumptions | Keeps prompts universal across 3D, 2D vector, live-action, and commercials |
| Keep Taxonomy mode-agnostic | `## Reusable Film & Motion Craft Taxonomy` must remain byte-identical across `.claude/skills/analyze-ref-video/system/analyze-ref-video.md`, `.claude/skills/compare-video/system/compare-2-video.md`, and `.claude/skills/channel-dna/system/learn-channel-video.md` (enforced by unit test) | Guarantees one shared vocabulary across breakdown, comparison, and channel learning |
| Ban optical finishing fabrication | Always require pixel evidence before logging grain, flare, halation, CA, or vignette | Stops the model from inventing film-stock grit on clean CG renders |
| Enforce active audio listening | Explicitly require listening to the attached audio stream even when burnt-in captions appear | Prevents models from falsely assuming captioned videos are silent/frame-only |

## Quantitative 100-Point Open Eval System (`>= 95%` Ship Gate)

Because breakdowns do not emit `Blocker`/`Major` counts, score every open multi-medium candidate on one objective 100-point scale combining deterministic code linting (`scripts/score-breakdown.ts`) and 30fps pixel verification across diverse mediums (2D flat-vector, live-action cinema, 3D VFX, 3D explainer):

| Pillar | Points | Method & Hard Gate |
| --- | --- | --- |
| Pillar 1: Deterministic Contract & Hygiene | `25` | `bun .claude/skills/analyze-ref-video/scripts/score-breakdown.ts <md> --duration <sec> --json` — 4 complete sections (`4`), zero engine/style leaks or unattributed `mm` guesses (`5`), valid 5-state boundaries + exact Sec 1/2 count parity (`6`), valid 8-category Taxonomy + ascending Sec 3 order + zero audio catch-alls (`6`), qualitative lens/curve/shadow/finishing/Secret-Sauce signal density (`4`) |
| Pillar 2: Automated Cut-Map Alignment | `25` | Pass `--scenes <scenes.py result.json>` to `score-breakdown.ts` — measures exact boundary recall (`±5f` tolerance) against deterministic PySceneDetect cuts |
| Pillar 3: 12-Frame 30fps Visual & Audio GT Audit | `50` | Inspect 12 native frames per clip (`8` claim-targeted + `4` blind recall slots at `5%`/`35%`/`68%`/`94%` printed by `gtSamplingPlan`): factual claim precision (`15`), blind recall & Secret-Sauce capture (`15`), medium-agnostic vocabulary & zero fabricated grit/SFX (`10`), actionable buildability + genuine audio listening (`10`) |

**Ship Gate:** Mean score `>= 95.0 / 100` (`95–99%`) across all tested visual mediums with `0` engine/style leaks and `>= 97%` verified 30fps claim precision.

## 5-Step Upgrade Loop

Execute Steps 1–5 sequentially; overwrite `system/analyze-ref-video.md` only after clearing Step 5.

| Step | Action | Artifact |
| --- | --- | --- |
| 1 | Prepare 720p timecode clips via `bun run reference timecode` across 6–8 diverse regression clips (3D CG, 2D vector, live-action) | Temp timecode files in `%TEMP%` (cleaned after GT extraction) |
| 2 | Save draft prompt separately and run 2–3 independent subagents to critique wording before live runs | Pre-A/B wording fixes |
| 3 | Run old vs new live on the configured runner (default: `aistudio`, max 2 parallel off-screen tabs, per-clip timeouts + checkpoints), then extract 30fps GT sheets (12 frames/clip: 8 from tables + 4 fixed Recall slots at `5%`/`35%`/`68%`/`94%`) | A/B outputs + 30fps GT sheets |
| 4 | Run automated structure lint (4 sections, 5-state boundary enum, 8 Taxonomy categories with bare `Other`, `Transition` anchored at `fA`, ascending frames in Sec 2 & 3, zero `draw(t)` leaks, length delta <= 20–25%) | Quantitative A/B JSON summary |
| 5 | Hand paired blind outputs + 30fps GT sheets to 2–3 independent subagents on the 6-axis 30-point rubric; ship only on unanimous PASS (`0 Critical`, `0 Required`) with zero Axis-1 regression | Updated `system/analyze-ref-video.md`, [prompt-design.md](prompt-design.md), and [eval-baseline.json](eval-baseline.json) |

## 6-Axis A/B Rubric (30 Points / Clip)

Score each axis `0–5` strictly against raw 30fps GT frames:

| Axis | Criteria | Hard Gate |
| --- | --- | --- |
| 1. Boundary & Frame Precision | Accurate 5-state boundaries, bracketed `fA->fB` 24fps skips, `Transition` anchored at `fA` (incl. dip-to-white/black), Sec 1 counts match Sec 2, zero false Hard Cuts on continuous whips/pull-backs | New prompt must be `>=` baseline on every clip |
| 2. Camera, Lens & Geometry | Qualitative lens class (`ultra-wide` to `macro` or `flat 2D ortho`), angle, framing scale, headroom, gaze, and match-cut eye-trace | Reject guessed numeric `mm` values |
| 3. Lighting, Shadows, Wear & Finishing | Key direction, shadow hardness (`hard`/`soft`/`flat unlit`), contact shadows, haze, floor reflections, surface wear, and real post-finishing | Never miss baseline lighting because of bright emissive props |
| 4. Animation Weight, Curves & Timing | Motion feel (`snap`, `ease-out`, `overshoot`, weight), cadence (`on-1s`/`on-2s`), time remaps (`slow-mo`/`timelapse`/`hit-stop`), eye-leads-head, full prop lifecycles | Describe *how* things move, not merely *what* moves |
| 5. Audio Glue & Anti-Hallucination | Audible BGM, VO pauses, `J/L-cuts`, pre-impact silence; zero fabricated 1Kbps SFX and zero hallucinated grain/flare/halation on clean renders | Heavy penalty for fabricated optical grit or masked SFX |
| 6. Secret-Sauce, Hygiene & Concision | Captures unlisted craft, 100% visible logos/brands to replace, chronological Sec 3, zero schema errors, tight density | No repetitive negative boilerplate across Sec 3 rows |

## Stratified Regression Set

Reuse these IDs (preferring Shorts to stay inside the 1M token window at 24fps Media High) for apples-to-apples comparison against v3 and v4 in [eval-baseline.json](eval-baseline.json):

| Label | YouTube ID | Genre | Key Stress Tests |
| --- | --- | --- | --- |
| `24_edge_universe` | `hbeuMnpAak4` | 3D sci-fi (`68.4s`) | Long `474k`-token context, dip-to-white `fA` anchor, hard shadows on paper wall, Chinese signage |
| `28_grape_plasma` | `cjQBP0Sg7mo` | 3D macro VFX (`28.4s`) | Anti-hallucination inside `f176` blur, caustics, Sec 3 ordering, 1-frame artifact |
| `29_humpty_dumpty` | `uBUMTlXdS2I` | Low-key dark 3D (`55.9s`) | 13 cross-dissolves, red-eye match across dissolve, night haze, wide dragon `f1575` |
| `31_pencil_sharpener` | `RQ6-QBj-tYE` | Silent 3D (`0` VO / `0` BGM, `35.1s`) | Zero fabricated VO/BGM, metallic/wall wear, crank blur, studio contact shadows |
| `33_outlet` | `0BZ1C83I2R4` | Reflective interior 3D (`24.3s`) | Wheel rotation direction, glossy tile reflections, reversed phone-glass reflection |
| `39_naruto_run` | `E147qAF-ze8` | Ultra-wide + slow-mo 3D (`30.1s`) | Low wide-angle, sky vignette, reflective grid floor, distorted slow-mo face, 180° occlusion Hidden Cut |
| `ood1_kurzgesagt` | `35No369rmq0` | 2D flat-vector (`78.3s`) | Non-3D generalization: `flat 2D ortho` & `flat unlit`, zero forced 3D lighting jargon |
| `ood2_apple_cinema` | `Hz64WOtsT4Y` | Live-action commercial (`52.4s`) | Real camera grain/fluorescents, handheld, split-screen, audible `J/L-cuts` |

## Baseline Storage

Store all new A/B score blocks by appending to [eval-baseline.json](eval-baseline.json) — never overwrite historical v3/v4 baselines.
