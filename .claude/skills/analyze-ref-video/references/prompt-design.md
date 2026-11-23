# Reference Video Breakdown Prompt Design (`analyze-ref-video` v1 to v4)

Canonical record of architectural rationale, trade-offs, the `N=60` baseline matrix, and controlled A/B evaluation results for `system/analyze-ref-video.md` (official v4, 100 lines). For the step-by-step upgrade workflow see [eval-guide.md](eval-guide.md); raw numbers live in [eval-baseline.json](eval-baseline.json).

## Shared Reusable Craft Taxonomy

The `## Reusable Film & Motion Craft Taxonomy` section in `system/analyze-ref-video.md` is strictly mode-agnostic (zero mentions of `reference`, `Claude`, `Three.js`, `draw(t)`, or CLI flags) and spans 3D CG, 2D flat-vector, and live-action video. Copy this 8-category block **byte-identically** into `.claude/skills/compare-video/system/compare-2-video.md`, `.claude/skills/channel-dna/system/learn-channel-video.md`, and any future single-video review prompt (enforced by automated unit test in `.claude/skills/channel-dna/scripts/channel-dna.test.ts`).

## Division of Labor: Gemini 24fps vs Local CLI

| Capability | Best Owner | Why |
| --- | --- | --- |
| Edit boundaries (`Hard Cut`, `Hidden Cut`, `Transition`, `Continuous`) | Gemini 24fps | 1–4fps static frame checks misclassify continuous camera whips as Hard Cuts |
| Qualitative lens feel, shadow hardness, atmosphere, motion weight/easing, `<0.5s` micro-beats, prop lifecycles, rack focus, motion blur | Gemini 24fps | 1-sample static stills miss temporal motion, blur direction, and dynamic lighting |
| Continuous BGM, mood shifts, audible `J/L-cuts`, pre-impact silence, VO pauses | Gemini 24fps | Local pixel checks are deaf; note Gemini audio is 1Kbps mono so subtle SFX must never be fabricated |
| Static subtitle wording, pixel coordinates, exact RGB hex, LUFS loudness, SFX waveforms | Local CLI (`media ocr`, `sheet`, `at`, `qc`, `earshot`) | Deterministic local measurement beats VLM visual estimation |

## Video Prep & Standard AI Studio Settings

| Step | Standard Setting | Measured Result |
| --- | --- | --- |
| Burn timecode strip | `bun run reference timecode <video>` (default 720p short-edge, CRF 22) | ~3.2x smaller files (52 MB -> 10–25 MB), upload drops from ~420s to 20–45s |
| AI Studio run | `gemini-4-neon` or `gemini-4-hydrogen`, `Thinking: Extra High`, `Media: High`, `FPS: 24`, `Search: off` | Preserves detail at ~280 tok/frame; prefer Shorts to stay well under the 1M token window |

## Evolution History (v1 -> v4)

| Version | Defects Surfaced by Evals & Critics | Core Upgrade |
| --- | --- | --- |
| v1 -> v2 | Binary `Hard Cut` vs `Continuous` missed `Hidden Cut`; fixed `food-eat-more` example introduced channel bias; 1Kbps audio triggered hallucinated SFX | 4-state boundary enum, bracketed 24fps frame skips (`fA->fB`), removed channel bias, split reliable vs unreliable 1Kbps audio cues |
| v2 -> v3 | Missing `Transition` slot for 3D card flips and cross-dissolves; hallucinated motion inside heavy blur; missed brand logos | 5-state boundary enum (`Transition fA-fB`), pre- vs post-smear geometric continuity test, explicit `ON -> change -> OFF` lifecycles, 100% logo capture |
| v3 -> v4 | Quantitative mining of `N=40` revealed 5 blind spots: qualitative lens/angle (`0%` Sec 2), baseline lighting/shadow hardness/haze/reflections (`0%` contact/vignette), motion weight/cadence/hit-stop (`0.3%` Sec 2), `J/L-cut`/silence (`0–10%`), and closed-list tunnel vision (`95%` leaked `draw(t)`, `0/40` used `Other`) | Kept compact at 100 lines (+1 vs v3): generalized to 3D, 2D flat ortho/unlit, and live-action; added Secret-Sauce open discovery; banned hallucinating film grain/flare on clean renders; anchored `dip-to-white/black` to `fA`; barred false Hard Cuts on continuous pull-backs; enforced ascending Sec 3 + bare `Other` |

## `N=60` Zack D. Films Visual Baseline (v3, 2026-11-22)

Sixty Minecraft-friendly Zack D. Films Shorts (all 60 overview sheets visually screened to exclude anatomy/X-ray) ran live on `gemini-4-neon` (`60/60` completed, `0` errors). Three independent critics (`critic-a`, `critic-b`, `critic-c`) audited `696` 30fps ground-truth frames (from Wave 5 onward, 4/12 frames per clip were fixed random Recall slots at `5%`/`35%`/`68%`/`94%`).

| Wave | Scope | 3-Critic 30fps GT Result |
| --- | --- | --- |
| Wave 0–3 (`N=20`) | `01_food` .. `20_walking_city` (up to `92.1s` / `641k` tok `12_chatgpt` & 39 beats `07_everest`) | `214/216` GT frames accurate (`99.1%`), `0` Critical, `0` Required, zero late-clip degradation |
| Wave 4 (`N=30`) | `21_etch_a_sketch` .. `30_lightbulb` | `3/3` PASS (`119/120`, `117/120`, `120/120` +48 frames), `0` Critical/Required; exposed `#24` dip-to-white anchor edge case |
| Wave 5 (`N=40`) | `31_pencil_sharpener` .. `40_google_earth` (+40 Recall slots) | `3/3` PASS (`120/120` across all 3 critics), `0` missed cuts on Recall slots |
| Wave 6 (`N=50`) | `41_venice_poles` .. `50_car_sinks` (+40 Recall slots) | `119/120`, `117/120`, `117/120`; surfaced `#48 f390` false Hard Cut on continuous pull-back (fixed in v4) |
| Wave 7 (`N=60`) | `51_car_differential` .. `60_waddle_shape` (+40 Recall slots) | `120/120`, `120/120`, `115/120` (+84 frames); overall `N=60` reached `98.9%–99.4%` GT accuracy across `696` panels |

## Controlled v3 vs v4 A/B Evaluation (8 Pairs, 2 Models)

Evaluated head-to-head on the 6 hardest Zack D. Films clips (`gemini-4-neon`, 72 GT panels) plus 2 out-of-distribution clips: 2D flat-vector `78.3s` (`ood1_kurzgesagt`) and live-action Edgar Wright commercial `52.4s` (`ood2_apple_cinema`) on `gemini-4-hydrogen` (22 GT panels).

| Metric | v3 | v4 | Delta |
| --- | --- | --- | --- |
| Mean 3-critic score (8 pairs, max 240) | `173.2 / 240` (`72.2%`) | `231.3 / 240` (`96.4%`) | `+58.2` pts (`24/24` critic sweeps won) |
| `critic-a` (6 ZDF + 2 OOD) | `170.0 / 240` (`129.0 + 41.0`) | `233.0 / 240` (`174.5 + 58.5`) | `+63.0`, `0` Critical/Required, SHIP v4 + OOD PASS |
| `critic-b` (6 ZDF + 2 OOD) | `175.5 / 240` (`137.0 + 38.5`) | `228.5 / 240` (`172.5 + 56.0`) | `+53.0`, `0` Critical/Required, SHIP v4 + OOD PASS |
| `critic-c` (6 ZDF + 2 OOD) | `174.0 / 240` (`132.0 + 42.0`) | `232.5 / 240` (`174.5 + 58.0`) | `+58.5`, `0` Critical/Required, SHIP v4 + OOD PASS |
| Sec 2 rows with qualitative lens/angle | `9.3%` | `47.0%` | `5.1x` |
| Sec 2 rows with easing/weight curves | `9.6%` | `20.6%` | `2.1x` |
| Clips capturing shadow hardness / post-finishing / `J-L-cut` | `0/8` / `3/8` / `1/8` | `6/8` / `8/8` / `7/8` | Closed all 5 blind spots; `0/8` hallucinated grain/flare |
| Engine keyword leaks (`draw(t)`) & schema lint errors | `8/8` leaks, `8` lint errs | `0/8` leaks, `1` Nit | `-87.5%` lint errors; mean length `+11.4%` |

## `N=60` Verified Craft Frequencies & 80/20 Engine Gate (2026-11-22 Engine Milestone)

Three critics audited `861` shot rows (`801` non-opening boundaries) across 60 Zack D. Films Shorts to prioritize lean, high-leverage engine additions:

| Craft Technique | Verified Frequency (`N=60`) | Engine Decision |
| --- | --- | --- |
| `Continuous [NO CUT]` camera moves | `60/60` (`540/801` boundaries = `67.4%`) | Already covered by `film-stage/camera` |
| Brand logos / watermarks to replace | `59/60` (`98.3%`) | Mandatory capture locked in `analyze-ref-video.md` |
| Motion blur (translational / turn / object-only) | `49/60` (`81.7%`) trans, `45/60` (`75.0%`) turn, `31/60` (`51.7%`) obj | Shipped per-shot `shutter.samples` (`1–64`, commit `3fc274a1`) |
| Whole-mesh emissive highlight pulse | `47–52/60` (`78%–87%`) | Shipped pure TS `film-stage/highlight` without touching `onBeforeCompile` (`f10ce851`, `1e2cad00`); rejected Fresnel shader (breaks on cubes & collides with `player.ts`) |
| 3D Y-axis `cardFlip` transition | `18/60` (`30.0%`, 25 uses, #2 transition) | Shipped built-in GLSL `cardFlip` in `transitions-meta.ts` (`72ad0030`) |
| Vertical `pushUp` (+ blur) transition | `12/60` (`20.0%`, 14 uses, #3 transition) | Shipped built-in GLSL `pushUp` in `transitions-meta.ts` (`72ad0030`) |
| Architectural & shell cutaways | `36–46/60` (`60%–77%`) | Enabled `renderer.localClippingEnabled = true` in `templates/film/src/scene.ts` + alpha/clipping recipe in `film.md` (rejected heavy cutaway framework) |
| Diegetic screens (phones, LCDs, TVs) | `18/60` (`30.0%`) | Documented `CanvasTexture` + `openfilm.json` recipe in `film.md` (kept `mc-assets/screen` scoped to `gohans:computer*`) |
| `Hidden Cut` & `Hard Cut` | `Hidden Cut` `27/60` (`8.2%`); `Hard Cut` `16/60` (`2.9%`) | Already supported |
| PiP, VHS, split-screen, dip-to-white hold | PiP `8/60` (`13.3%`), VHS `5–9/60`, split `2/60` (`3.3%`), dip `2/60` | Rejected custom engine wrappers to stay lean |
