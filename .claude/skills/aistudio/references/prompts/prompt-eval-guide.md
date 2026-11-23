# Prompt Evaluation & Upgrade Guide (`analyze-ref-video` & `compare-2-video`)

Standard operating guide for future AI sessions upgrading `system/analyze-ref-video.md` (v4 -> v5+) or `system/compare-2-video.md` (v2 -> v3+) with measured A/B evidence instead of guesswork.

## Mandatory Pre-Edit Principles

Every change must pass head-to-head live A/B testing on AI Studio before replacing an official prompt.

| Rule | Requirement | Why |
| --- | --- | --- |
| Hold variables constant | Compare old vs new on the exact same model, `Thinking: Extra High`, `Media: High`, `24fps`, `Search: off`, and identical 720p CRF 22 timecode clip | Prevents model or resolution drift from confounding scores |
| Guard prompt length | Keep system prompts around 95–115 lines; do not add a 5th section or extra columns without proven lift | Bloated prompts dilute attention across 300k–650k video tokens |
| Never create a closed list | Every Taxonomy parenthetical is an open hint; keep Secret-Sauce discovery active | Closed lists cause Gemini to ignore novel unlisted craft |
| Zero engine/channel leaks | Ban fixed channel names, Three.js syntax, `draw(t)`, CLI flags, or auto-shutter assumptions | Keeps prompts universal across 3D, 2D vector, live-action, and commercials |
| Keep Taxonomy mode-agnostic | `## Reusable Film & Motion Craft Taxonomy` must remain byte-identical across `analyze-ref-video.md`, `compare-2-video.md`, and `channel-dna/system/learn-channel-video.md` (enforced by unit test) | Guarantees one shared vocabulary across breakdown, comparison, and channel learning |
| Ban optical finishing fabrication | Always require pixel evidence before logging grain, flare, halation, CA, or vignette | Stops Gemini from inventing film-stock grit on clean CG renders |

## 5-Step Upgrade Loop

Execute Steps 1–5 sequentially; overwrite the official system prompt only after clearing Step 5.

| Step | Action | Artifact |
| --- | --- | --- |
| 1 | Prepare 720p timecode clips via `bun run reference timecode` across 6–8 diverse regression clips (3D CG, 2D vector, live-action) | Temp timecode files in `%TEMP%` (cleaned after GT extraction) |
| 2 | Save draft prompt separately and run 2–3 independent subagents to critique wording before live AI Studio runs | Pre-A/B wording fixes |
| 3 | Run old vs new live on AI Studio (max 2 parallel off-screen tabs, per-clip timeouts + checkpoints), then extract 30fps GT sheets (12 frames/clip: 8 from tables + 4 fixed Recall slots at `5%`/`35%`/`68%`/`94%`) | A/B outputs + 30fps GT sheets |
| 4 | Run automated structure lint (4 sections, 5-state boundary enum, 8 Taxonomy categories with bare `Other`, `Transition` anchored at `fA`, ascending frames in Sec 2 & 3, zero `draw(t)` leaks, length delta <= 20–25%) | Quantitative A/B JSON summary |
| 5 | Hand paired blind outputs + 30fps GT sheets to 2–3 independent subagents on the 6-axis 30-point rubric; ship only on unanimous PASS (`0 Critical`, `0 Required`) with zero Axis-1 regression | Updated system prompt, design doc, and `eval-baseline.json` |

## 6-Axis A/B Rubric for `analyze-ref-video.md` (30 Points / Clip)

Score each axis `0–5` strictly against raw 30fps GT frames:

| Axis | Criteria | Hard Gate |
| --- | --- | --- |
| 1. Boundary & Frame Precision | Accurate 5-state boundaries, bracketed `fA->fB` 24fps skips, `Transition` anchored at `fA` (incl. dip-to-white/black), Sec 1 counts match Sec 2, zero false Hard Cuts on continuous whips/pull-backs | New prompt must be `>=` baseline on every clip |
| 2. Camera, Lens & Geometry | Qualitative lens class (`ultra-wide` to `macro` or `flat 2D ortho`), angle, framing scale, headroom, gaze, and match-cut eye-trace | Reject guessed numeric `mm` values |
| 3. Lighting, Shadows, Wear & Finishing | Key direction, shadow hardness (`hard`/`soft`/`flat unlit`), contact shadows, haze, floor reflections, surface wear, and real post-finishing | Never miss baseline lighting because of bright emissive props |
| 4. Animation Weight, Curves & Timing | Motion feel (`snap`, `ease-out`, `overshoot`, weight), cadence (`on-1s`/`on-2s`), time remaps (`slow-mo`/`timelapse`/`hit-stop`), eye-leads-head, full prop lifecycles | Describe *how* things move, not merely *what* moves |
| 5. Audio Glue & Anti-Hallucination | Audible BGM, VO pauses, `J/L-cuts`, pre-impact silence; zero fabricated 1Kbps SFX and zero hallucinated grain/flare/halation on clean renders | Heavy penalty for fabricated optical grit or masked SFX |
| 6. Secret-Sauce, Hygiene & Concision | Captures unlisted craft, 100% visible logos/brands to replace, chronological Sec 3, zero schema errors, tight density | No repetitive negative boilerplate across Sec 3 rows |

## Stratified Regression Set (`analyze-ref-video.md`)

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

Store all new A/B score blocks by appending to [eval-baseline.json](eval-baseline.json) — never overwrite historical v3/v4 or compare v2 baselines.

## Dedicated Evaluation Suite for `compare-2-video.md` (v2 -> v3+)

Run the same 5-step A/B loop on one model (`Extra High`, `Media: High`, `24fps`, `Search: off`) using `bun run reference sidebyside` composites and blind scoring by `>=2` independent subagents across these 4 controls:

| Control Clip | Source / Construction | What It Tests | Hard Gate |
| --- | --- | --- | --- |
| `food_sbs` (`54.8s`, `hstack`) | `bun run reference sidebyside films/food-eat-more/references/ref.mp4 films/food-eat-more/renders/draft.mp4` | Real Minecraft vs 3D CG remake: cuts, 1f pop, clipping, floating, bloom, blur, acting, `audio:ours` | Zero truncation (all 4 sections), zero Minecraft/brand false positives, no recall regression |
| `synth_ident_sbs` (`10.0s`, `hstack`) | Tile first 10s of `ref.mp4` beside itself | Anti-hallucination gate (ViDiC) | Must output `PASS` with `0` Blocker / `0` Major / `0` Minor |
| `synth_sbs` (`12.0s`, `hstack`) | 12s `ref.mp4` with 5 zones: `f0–f104` clean, `f105–f179` dark/desat, `f180–f254` `1.35x` zoom + `f210–f211` 2f black flash, `f255–f344` `+10f` lag, `f345–f359` 15f black tail | Exact Precision (`0` false positives in `f0–f104`) and Recall (`5/5` planted faults) | `0` false positives in `f0–f104` and `5/5` faults caught |
| `synth_drift_vstack` (`14.0s`, `vstack`) | 16:9 crop (`2s–16s`) with 6fps judder `f90–f149`, 30f freeze `f150–f179` + Hard Cut `f180`, cumulative `+12f` lag `f180–f419` | Landscape `vstack`, true judder detection, single drift diagnosis, anti-confounding guard | Detects 6fps judder, 30f freeze, `+11..12f` lag, and `0` false framing bugs from drift |

## 6-Axis Rubric for `compare-2-video.md` (30 Points / Clip)

| Axis | Criteria | Hard Gate |
| --- | --- | --- |
| 1. Ground-Truth Precision & Anti-Hallucination | Every defect backed by true 30fps `REF` + `OURS` evidence; zero fabricated flaws on clean `Match` spans | Mandatory `PASS 0/0/0` on `synth_ident_sbs` and `0` false positives on clean spans |
| 2. Defect Recall & Single-Frame Rigor | Catches critical gaps: broken `Continuous`/`Hidden Cut`, 1f pop, clipping, floating, z-fighting, bloom blowout, missing blur, freezes, judder, black tail `>=6f` | No recall regression vs v2 baseline in `eval-baseline.json` |
| 3. Intentional Adaptation Discipline | Ignores Minecraft cubes, pixel textures, wider block heads, proportional held props, and swapped brands | Heavy penalty for complaining about intentional style or brand replacement |
| 4. Drift Diagnosis & Anti-Confounding | Diagnoses cumulative drift once in Sec 1 and compares `REF(t-delta)` vs `OURS(t)` before logging framing flaws | No spam drift rows or drift-confounded fake crop bugs |
| 5. Triage, Actionable Fix & Calibration | Severity reflects visual impact (never downgraded for `Conf=Med`), 1 crisp sentence + concrete fix per Sec 3 row, honest `Conf` (never fabricate 1Kbps SFX or unsupplied `REF` audio) | Sec 1 totals match Sec 3 counts 100%; every Sec 3 row includes an actionable fix |
| 6. Schema Hygiene & Zero Truncation | Complete 4 sections within 65k cap, 5-state Sec 2 boundaries, 8 Taxonomy categories in Sec 3, strict `Blocker -> Major -> Minor` + ascending frame order, zero engine leaks | Zero truncation on dense 55s remakes like `food_sbs` |
