# Empirical Anti-Patterns (Flop Post-Mortems) & Vibe QA Gates

Every trap below is derived directly from Bottom-20% Flops (`<=0.57x` rolling outlier in snapshot) and verified `weaknesses_or_drag` notes across `N=17` deep dossiers, `N=43` MC-friendly transcripts, and `N=734` mature MC-friendly Shorts.

## 1. The 10 Verified Zack D. Films Flop Traps

| # | Flop Trap | Empirical Evidence (Exact Corpus & Video IDs) | Mandatory Fix |
| --- | --- | --- | --- |
| 1 | **Over-rushed VO (`175–185+ WPM`)** | `180+ WPM` (`n=7` in `N=43`): **`0%` Winners, `57.1%` Flops, `0.47x`**. Flops `lEXSVWGubLo` (`186.9 WPM`, `0.24x`) and `5puZlZQNArc` (`178.4 WPM`, `0.30x`) rushed narration past viewer comprehension | Lock script word count to **`148–162 WPM`** (`95–110` words per `40s`) and verify via `bun run voice:cues` |
| 2 | **Hard-cut montage choppiness (`>6` cuts/min)** | `N=17` Winners median **`4.9` cuts/min** (`6/7` had `0` Hard Cuts); Flops median **`8.1` cuts/min**. Flops `LjHDUQ7Htvk` (`16` Hard Cuts, `0.35x`) and `QXEr924US38` (`6` Hard Cuts, `0.33x`) shattered 3D spatial immersion | Keep `>=65%` `Continuous [NO CUT]` splines, `<=2` Hard Cuts max (`0` ideal), and bridge scenes with `cross_dissolve` / `cardFlip` / whip Hidden Cuts |
| 3 | **Flashy montage transitions (`flash_white` / `flash_whip`)** | Appeared exclusively in Flop `LjHDUQ7Htvk` (`0.35x`; `0%` Winners vs `25%` Flops in `N=17`) | Stick to `cross_dissolve`, `cardFlip`, `pushUp`, and physical occlusion/whip-blur Hidden Cuts |
| 4 | **Dry imperative DIY recipe opening (`"Lay..."`, `"Place..."`)** | `imperative_diy_command` (`n=4` in `N=43`): **`0%` Winners, `50%` Flops, `0.48x`**. Flop `lEXSVWGubLo` (`"Lay the cheese down on a bamboo mat"`, `0.24x`) paired dry steps with `chronological_and_then` | Open with stakes, contrast, or `"If you..."` / `"When..."` (`2.16x` / `1.67x`), and link every beat via `but_therefore` or `causal_chain` |
| 5 | **Click-below promo / dead static outro card** | Flop `LjHDUQ7Htvk` (`0.35x`) ended with `"Click down here"` (`S20` promo CTA) and a **`3.0s` silent static end-card hold**, plus omitted the trailing title emoji | End within `0.4–0.8s` of the final punchline; if using `question_cta`, keep it as an in-world dilemma (`SGgYDfeHYXA` `"What do you do?"`, `7.76x`) |
| 6 | **Drifting into abstract brain-chemistry cutaways instead of physical staging** | Flop `QXEr924US38` (`Why Gambling Becomes Addictive`, `0.33x`, `2.3M`) drifted into abstract skull/dopamine animation with jittery `snappy_overshoot` easing — vs Winner `7i6ok0llYUc` (`Happiness Experiment`, `5.94x`, `58.5M`) staging concrete humans + glowing props + 3D timers | Keep psychology/tech explainers **100% grounded in tangible Minecraft characters, buildings, props, and world-space counters** |
| 7 | **Linear chronological story with predictable safe payoff** | `chronological_escalation_twist` had **`0%` Winners** in `N=17`; Flop `5puZlZQNArc` (`0.30x`) escalated predictably into a standard rescue with a `2.0s` frozen mid-air splash hang | Reframe narratives as `problem_solution_irony` (`0%` Flops) or `what_if_chain_reaction` (`1.14x` W/F lift), and land a genuine ironic twist near `~76%` |
| 8 | **Sub-25s undercooked runtime** | `<25s` (`n=13` in `N=270` MC-friendly): **`61.5%` Flops, `0.45x`, `4.2M` views** | Target **`35–44s`** (`44.1%` Winners, `1.25x`) or commit to a multi-act **`55s+`** story (`55–73s` typical target; `n=15`: `86.7%` Winners, `0%` Flops, `3.05x`) |
| 9 | **Cliché meta-openers & bloated wordy titles** | `0/43` Shorts used `"Did you know..."`; `8–9` word titles drop to `0.90x` vs `<=5` words (`1.20x`); `😢` emoji converts only `11.1%` Winners (`27.8%` Flops) | Start straight inside the action/premise; keep titles **`<=6–7` words + 1 high-arousal emoji (`😱`/`🤯`/`😏`/`🤨`)** |
| 10 | **Micro-continuity & asset-polish breaks** | Real `weaknesses_or_drag` logged even on hits: inconsistent cockpit numbers (`11303 FT -> 619 FT` in `SGgYDfeHYXA`), mismatched gravestone/newspaper dates (`Uzo10EjKC6w`), cloned passengers (`SGgYDfeHYXA`), frozen background extras (`UgP7_6_i1J4`, `7i6ok0llYUc`), prop clipping (`lEXSVWGubLo`, `7i6ok0llYUc`), and mirrored whip edge tiles (`QXEr924US38`) | Give every visible NPC a unique skin + offset `film-kit/idle` seed; cross-check every diegetic number/date; run `bun run render stills --check "touch:..."` + `bun run framecheck` |

## 2. Quantitative Vibe QA Gate Scorecard (Pre-Production & Post-Render)

Every Zack D. Films-style Short MUST clear all 12 quantitative gates before final render (`bun run deliver`):

### Stage A — Pre-Production Script & Packaging Gates
| Gate | Target Threshold | Pass Criteria |
| --- | --- | --- |
| 1. Title Packaging | `<=7` words (`<=6` ideal) + `1` trailing emoji | Zero missing emoji; matches high-arousal or explainer-workhorse tone (`😱`/`🤯`/`😏`/`🤨`/`🤔`) |
| 2. Opening Spoken Line | Zero cliché meta-phrases (`"Did you know"`, `"Today we"`) | Opens in-action (`When/As`), hypothetical (`If you/Imagine`), or concrete visual contrast |
| 3. Spoken Word Budget | **`148–162 WPM`** target (`<170 WPM` hard ceiling) | Exact `wordCount / (durationSec / 60)` verified before recording |
| 4. Runtime Band | **`35–44s`** OR **`55s+`** (`55–73s` typical target) | Reject `<25s` and unmotivated `45–54s` mid-band drag unless multi-act beats justify `55s+` |
| 5. Narrative Connector | `but_therefore` or `causal_chain` | Zero `"and then... next..."` sequential filler |
| 6. Beat Budget & Twist | Twist/reversal placed at **`68%–85%`** runtime (`~76%` ideal) | `hook ~12%`, `setup ~15%`, `escalation ~27%`, `proof ~14–21%`, `twist ~12%`, `resolution ~14%`; zero forced seamless-loop gimmick |

### Stage B — Timeline, Visual & Audio Render Gates (`mc-films`)
| Gate | Target Threshold | Verification Command / Method |
| --- | --- | --- |
| 7. Opening Shot Hold | **`1.5s – 3.0s`** (`~2.0s` ideal) | Check Shot 1 / Beat 1 duration in `src/timeline/cam.json` & `shots.json` |
| 8. Continuous Camera Ratio | **`>=65%`** `Continuous [NO CUT]`, **`<=5.5`** edit cuts/min (`<=5.0` ideal), **`<=2`** Hard Cuts (`0` ideal) | Count boundaries in `shots.json` + `cam.json`; keep camera beats **`20–25/min`** |
| 9. Mandatory Craft Stack | Motion blur (`--samples >= 8` on blurred drafts / `final` default `8`; `shutter.samples: 12..16` on whip shots in `shots.json`), shallow DOF (`optics.focus`), `>=2` emissive noun pulses (`film-stage/highlight`), `>=1` diegetic label/graphic (`titles`/`ink`/`openfilm`), `>=1` cutaway or scale proof | Inspect `src/scene.ts` + `bun run render stills --at ... --samples 8 --check text` |
| 10. Clean Transitions & Easing | Only `dissolve`, `cardFlip`, `pushUp`, or whip/occlusion Hidden Cuts; `smooth_damped` easing throughout | Verify `shots.json` transitions & `cam.json` eases; zero `flash_white` |
| 11. Asset & Spatial Integrity | Zero prop clipping, zero frozen background clones, consistent diegetic numbers, zero `>0.8s` dead outro hold | Run `bun run check`, `bun run framecheck`, `bun run sheet <video> overview`, and `--check "touch:..."` |
| 12. Audio Cadence & Mix | Heard WPM **`148–162`** (`voice:cues`), continuous/shifting BGM bed (`-14 LUFS` mastered), zero dead pre-impact silence vacuums | Run `bun run voice:cues`, `bun run mix`, `bun run listen`, and verify audibly via `earshot` |
