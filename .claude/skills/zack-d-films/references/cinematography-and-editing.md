# Cinematography, Camera Physics, Framing & Editing (Zone 1: Use)

Empirical boundary architecture, unbroken-take vs sub-beat shot-spine cadence, dominant craft pillar mix, measured transition spans, hidden-cut & continuous-bridge mechanisms, camera rig physics, 9:16 Shorts safe framing, spatial continuity, lens feel, and framing grammar for Zack D. Films (`statsVersion: 4`). All numbers come verbatim from `N=62` clean 24 FPS `schema_version: 2` dossiers (`25 W / 18 M / 19 F`, `883` non-opening boundaries, `945` parsed Section 3 shots with `945/945` pillar-tagged and `942 High / 3 Med / 0 Low` confidence, `298` unbroken editorial takes), with Fisher exact `p` and BH-FDR `q`. Treat Winner-vs-Flop spreads as observational prioritization signals, not causal proof.

## 1. Equal-Weight Edit Architecture & 5-State Boundary Ratios (`883` Boundaries, `N=62`)

**Cluster-Bias Proof:** Pooled Flop Hard Cuts (`9.5%` vs `2.1% W`) were skewed by one Flop (`LjHDUQ7Htvk`, `16` Hard Cuts). Equal-weight per-video analysis proves the real ZDF editing rule: **`100%` (`25/25`) of Winners use `<= 1` Hard Cut** (`0%` use `>= 2`), **`93.5%` of videos are Continuous-Dominant (`>=50%`)**, **Pure 1-Takes skew Flop (`8% W` vs `31.6% F`, `-23.6pp`)**, and **dynamic motion transitions (`56% W` vs `15.8% F`, `p=0.012, q=0.104`) — led by `card_flip` (`48% W / 5.3% F`, `p=0.003, q=0.025 ★`) and `push_up` (`36% W / 0% F`, `p=0.006, q=0.029 ★`) — drive the cluster-valid equal-weight Mann-Whitney U surge in Section 3's `Transitions & Continuity` pillar (`16.4% W` vs `9.2% F`, `+7.2pp, MW-U p=0.002, q=0.017 ★`)**.

| Video-Level Edit Architecture (`N=62`, Equal Weight) | Videos | Share (%) | Winner Share (%) | Flop Share (%) | Delta W-F (pp) | `p (q)` |
| --- | --- | --- | --- | --- | --- | --- |
| **Has Dynamic Motion Transition (non-dissolve)** | 24 | 38.7% | **56%** | **15.8%** | **+40.2** | **0.012** (0.104) |
| Has Styled Transition (`>=1`) | 40 | 64.5% | 72% | 47.4% | +24.6 | 0.125 (0.325) |
| Hard Cuts `<= 1` per Video | 59 | 95.2% | **100%** | 89.5% | +10.5 | 0.181 (0.325) |
| Hard Cuts `>= 2` per Video | 3 | 4.8% | **0%** | 10.5% | -10.5 | 0.181 (0.325) |
| Pure 1-Take (`0` cuts/transitions) | 12 | 19.4% | **8%** | **31.6%** | **-23.6** | 0.060 (0.268) |
| Continuous Dominant (`>=50%`) / Hard-Cut Dominant (`>=50%`) | 58 / 1 | 93.5% / 1.6% | 92% / 0% | 94.7% / 5.3% | -2.7 / -5.3 | 1.000 / 0.432 (`1.000`/`0.648`) |
| Deliberate Cut Pace (`<6` /min) / Fast Cut Pace (`>=15` /min) | 37 / 3 | 59.7% / 4.8% | 64% / 4% | 63.2% / 5.3% | +0.8 / -1.3 | 1.000 (1.000) |

| 5-State Boundary Type (`883` Non-Opening) | Count | Pooled All (%) | Pooled W (%) | Pooled F (%) | Video Prevalence (W vs F) | Mean Video Share (W vs F) |
| --- | --- | --- | --- | --- | --- | --- |
| `Continuous [NO CUT]` | 647 | 73.3% | 74.1% | 74.9% | `100%` vs `100%` | `75.6%` vs `80.6%` |
| `Transition` | 153 | 17.3% | 18.5% | 11.9% | `72%` vs `47.4%` | `16.8%` vs `10.4%` |
| `Hidden Cut` | 49 | 5.5% | 5.4% | 3.7% | `56%` vs `31.6%` | `5.6%` vs `3.7%` |
| `Hard Cut` | 34 | 3.9% | 2.1% | 9.5% | `32%` vs `15.8%` | `2.1%` vs `5.3%` |

- **Core continuity law `[Production Lesson PL-001]` & `[Field Note FN-004]`:** Hold unbroken `Continuous [NO CUT]` takes (`5.46s W` median, max streak `16.8s W`), bridging sub-beats via push/pull, orbit, whip-pan, tracking, and architectural/glass `pass_through` moves, then break spatial monotony on major story-beat pivots with `1–3` razor-snappy styled transitions (`card_flip`, `push_up`, `cross_dissolve`) or peak-smear `Hidden Cut`s. Never exceed `1` Hard Cut per Short.

## 2. Measured Transition Spans, Hidden Cuts & Continuous Bridge Taxonomy (`N=62`)

| Styled Transition (`N=62`) | Videos | Winner Share (%) | Flop Share (%) | Delta W-F (pp) | `p (q)` | Measured Span (Median / IQR) | Beat-Aligned (%) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cross_dissolve` | 31 (`50%`) | 56% | 36.8% | +19.2 | 0.239 (0.796) | **`5f` (`0.17s`)**, IQR `3f` (`98` inst.) | `52%` |
| **`card_flip`** | 19 (`30.6%`) | **48%** | **5.3%** | **+42.7** | **0.003 (0.025 ★)** | **`5f` (`0.17s`)**, IQR `3f` (`24` inst.) | `62.5%` |
| **`push_up`** | 11 (`17.7%`) | **36%** | **0%** | **+36** | **0.006 (0.029 ★)** | **`7f` (`0.23s`)**, IQR `2.25f` (`12` inst.) | **`91.7%`** |
| Rare accents (`whip_dissolve`, `vhs_rewind`, `iris_wipe`, `portal_wipe`, `zoom_dissolve`, `flash_whip`, `morph`, etc.) | `1–2` each | `0–8%` | `0–5.3%` | varies | `>=0.432` | `2–19f` (`0.07–0.63s`) | Use only when story-motivated |

| Hidden-Cut Mechanism (`49` Instances, `0` Other) | Instances | Videos | Video Share (`N=62`) | Execution Rule |
| --- | --- | --- | --- | --- |
| `whip_pan_smear` | 22 | 15 | 24.2% | Peak directional camera-turn smear conceals swap; outgoing & incoming whip directions MUST match |
| `radial_zoom_dive` | 14 | 11 | 17.7% | High-speed radial push-in into dark aperture/screen masks scale jump |
| `fg_or_env_occlusion` | 10 | 10 | **16.1%** | Foreground pillar, doorway, mullion, jacket, or water wipes lens to zero-visibility swap frame |
| `roll_spin` | 3 | 3 | 4.8% | Axial barrel-roll peak smear bridges orientation or location reset |

| `Continuous [NO CUT]` Bridge (`647` Instances; `other` = `3.2%`) | Instances | Videos | Video Share (`N=62`) | Winner (%) | Flop (%) |
| --- | --- | --- | --- | --- | --- |
| `push_in_or_pull_back` | 215 | 61 | **98.4%** | **100%** | 94.7% |
| `orbit_or_arc` | 150 | 52 | 83.9% | 88% | 94.7% |
| `whip_or_snap_pan` | 117 | 49 | 79% | **84%** | 78.9% |
| `tracking_or_follow` | 83 | 45 | 72.6% | **76%** | 63.2% |
| `pass_through_or_xray` (`FN-004`) | 40 | 26 | **41.9%** | **44%** | 31.6% |
| `staging_or_action_beat` | 23 | 18 | 29% | 16% | 36.8% |
| `time_remap_bridge` | 13 | 9 | 14.5% | **16%** | 5.3% |
| `roll_or_focus_shift` / `other` | 3 / 3 | 3 / 2 | 4.8% / **3.2%** | 4% / 4% | 0% / 5.3% |

## 3. Unbroken Editorial Takes (`298`) vs Visual Sub-Beats (`945`) & Pacing Curve

Always distinguish **true unbroken editorial take length** (merging consecutive `Continuous [NO CUT]` rows between real cuts/transitions) from **visual sub-beat cadence** (scale/angle/action pivots inside one continuous camera move):

| Pacing Metric (`N=62`, `945` Sub-Beats, `298` Unbroken Takes) | Overall | Winner | Flop | Practical Directing Target |
| --- | --- | --- | --- | --- |
| **Unbroken editorial take (`p10 / p25 / p50 / p75 / p90`)** | `1.71s / 2.8s / 5.15s / 9.48s / 16.81s` (`9.83x`) | **`2.2s / 3.13s / 5.46s / 10.37s / 16.85s` (`7.66x`)** | `1.32s / 2.19s / 4.46s / 9.3s / 18.6s` (`14.09x`) | Let continuous camera moves breathe **`3–10s` per unbroken take** (median **`5.46s W`**) rather than micro-cutting every 1.3s |
| **Sub-beat / shot pivot (`p10 / p25 / p50 / p75 / p90`)** | `1s / 1.47s / 2.17s / 3.1s / 4.1s` (`4.1x`) | **`0.97s / 1.44s / 2.23s / 3.1s / 4.1s` (`4.23x`)** | `0.96s / 1.47s / 2.18s / 3.1s / 4.04s` | Deliver a fresh scale, angle, or action sub-beat every **`1.4–3.1s`** (median **`2.23s W`**) inside those takes |
| Late-to-Mid shot duration ratio (`<1.0` = accelerates) | `0.83x` | **`0.82x`** | `0.82x` | Tighten sub-beats ~`15–20%` during `twist` (`2.09s`) & `resolution` (`2.0s`) vs `explanation_value` (`2.37s`) & `escalation` (`2.3s`) |
| Edit cuts/min vs Total camera beats/min | `4.6` / `22.2` | **`4.4` / `22.1`** | `2.0` / `22.1` | `~4–5` real edits/min (`2–3` transitions/hidden cuts per 37s Short) + `~18–26` visual beats/min |
| **Wide + Tight dynamic range** & **`>=3`-step scale jumps** | `72.6%` / `66.1%` | **`88%` / `76%`** | `57.9%` / `57.9%` | Pair `W`/`EW` geography with `CU`/`ECU`/`INSERT` proof and drop `>=3`-step dives on re-hooks |

## 4. Camera Rig Physics, Lens Feel, Blur Mechanics & Spatial Continuity (`N=62`)

| Profile / Move (`N=62`) | Videos | Share (%) | Winner (%) | Flop (%) | Delta W-F (pp) | `p (q)` / Directing Rule |
| --- | --- | --- | --- | --- | --- | --- |
| `camera:smooth_damped_continuous` | 54 (`stable`) | 87.1% | 92% | 94.7% | -2.7 | Universal smooth gimbal baseline (`snappy_whip_kinetic`: `8% W`, `2.79x`) |
| **`lens:wide`** | 19 (`stable`) | 30.6% | **48%** | **15.8%** | **+32.2** | `p=0.052 (0.104)`, **`4.16x` outlier** — opens spatial scale & FG/MG/BG depth |
| `lens:normal` | 34 (`stable`) | 54.8% | 40% | **78.9%** | **-38.9** | **`p=0.014` (0.058)** (`0.94x`) — avoid flat normal-only framing without wide depth |
| `push_in` / `pull_back` | 61 / 61 | 98.4% | 100% / 100% | 100% / 94.7% | 0 / +5.3 | Continuous breath of every ZDF shot |
| `orbit_arc` / `dolly_track` | 55 / 51 | 88.7% / 82.3% | 92% / 76% | 94.7% / 89.5% | -2.7 / -13.5 | Smooth 3D parallax around subjects |
| **`tilt_pan`** | 46 (`stable`) | 74.2% | **88%** | **57.9%** | **+30.1** | **`p=0.035` (0.388)** — sweeps vertical/horizontal cause-to-consequence reveals |
| **`whip_pan`** | 40 (`stable`) | 64.5% | **76%** | 52.6% | **+23.4** | `p=0.123 (0.679)` — pairs with `camera_turn_blur` (`96% W`) for pivots & hidden cuts |
| `crane_boom` / `roll_dutch` / `fpv_dive` | 38 / 8 / 4 | 61.3% / 12.9% / 6.5% | 60% / 20% / 12% | 68.4% / 5.3% / 5.3% | -8.4 / +14.7 / +6.7 | Diorama elevation, disorientation, and kinetic dives |
| `static_locked` / `impact_shake` | 10 / 3 | 16.1% / 4.8% | 8% / 4% | 10.5% / 5.3% | -2.5 / -1.3 | Rare micro-beat accent only (`<=1` per Short) |

- **Camera Rig Physics, Speed Contrast, Impact Recoil & Cut Timing:** Treat the camera as a **damped physical gimbal** (exponential ease-out settle, never linear ping-pong keyframes or dead-stop freezes). Motivate **speed contrast**: hold gentle `0.5–1.5%` continuous drift during explanatory beats, then burst over `3–5f` into peak velocity on whips/dives, carry `180°` shutter blur cleanly through the cut/swap frame (`cut - 0.001s` in multi-sample renderers), and damped-decelerate over `6–10f` into the next eye-line. Pair major mechanical hits with a crisp damped recoil (`impact_shake` `4.8%`, `<=1`/Short — never sloppy handheld drift). When using a rare `Hard Cut` (`<=1`) or `Hidden Cut`, cut **on peak kinetic action** (action cut) and shift camera angle **`>=30°` + scale jump** (never a `10–20°` jump cut on the same subject); use shape/geometry **match cuts** to snap between twin sets.
- **Time-Remapping Optics (`52% W`) & Scale-Gated DOF (`uses_rack_focus` `80% W`):**
  - **Time-Remap (`has_time_remap_or_hit_stop` `52% W`, `time_remap_bridge` `16% W` vs `5.3% F`):** On `0.15x–0.40x` slow-motion impacts, keep the camera gliding smoothly at real-time speed with crisp shutter clarity over the slowed physics; anchor speed-ramped timelapses on a steady or slow-drifting rig; reserve `1–3f` hit-stops for crisp mechanical locks/snaps.
  - **Scale-Gated DOF & Rack Focus:** Keep wide establishing shots (`EW`/`W`) deep enough that bounded-world geography reads cleanly (subtle background roll-off only), reserving strong foreground/background bokeh strictly for `MCU`/`CU`/`ECU`/`INSERT` beats. Start `rack_focus` `0.15–0.25s` **before** the VO names the new subject and settle sharp across **`0.30–0.45s`** (never dragging a slow `0.7–0.9s` pull). Keep **`subject_tracking_blur` rare (`12% W` vs `36.8% F`, `-24.8pp`)** unless conveying true high-speed chases.
- **Spatial Continuity, Eye-Trace & 180° Axis:**
  1. **Whip-Direction Matching:** Whenever exiting a shot via `whip_pan` or occlusion wipe (e.g., camera whips `screen-right -> screen-left`), enter the incoming shot moving in the **same screen direction** (`screen-right -> screen-left`) so the viewer's brain stitches one seamless space.
  2. **Eye-Trace Anchor:** Keep the viewer's focal anchor within `±15%` of the outgoing screen position across `card_flip`, `cross_dissolve`, or `Hidden Cut` boundaries so eyes never hunt on mobile.
  3. **180° Axis & FG/MG/BG Depth:** Maintain consistent screen-left/screen-right character facing across reactions unless crossing the axis visibly via a continuous `orbit_arc`. Stage every wide/medium shot with at least 2–3 depth planes (FG frame element + MG protagonist + BG bounded set) so `push_in`/`orbit_arc` generates unmistakable parallax.

## 5. Framing Ratios (`945` Shots), Compositional Framing, Elevation Psychology & 9:16 Safe Box

| Shot Scale | All (%) | Winner (%) | Flop (%) | Camera Angle | All (%) | Winner (%) | Flop (%) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `EW` / `W` | `1.2%` / `14.3%` | `1.7%` / **`16.9%`** | `0.4%` / `10.3%` | `aerial` / `overhead` | `0.3%` / `2.4%` | `0.5%` / `2.2%` | `0%` / `1.5%` |
| `M` | 32.8% | 29.2% | 34.7% | `high` | 25.5% | 21.4% | 28.2% |
| `MCU` | 21.7% | 22.2% | 21.8% | **`eye`** | 63.3% | **68.4%** | 61.8% |
| `CU` / `ECU` | `18.2%` / `5.2%` | `19%` / `4.1%` | `20.6%` / `6.1%` | `low` / `ground` | `6.2%` / `2.2%` | `5.3%` / `2.2%` | `5.7%` / `2.7%` |
| `INSERT` | 6.7% | 7% | 6.1% | — | — | — | — |

- **Google Asymmetric 9:16 Safe Box & Compositional Framing (`PL-004`):** YouTube Shorts UI chrome occupies **Top `15%`** (search/header), **Bottom `35%`** (title, handle, audio bar, captions), **Left `4.4%`**, and **Right `17.8%`** (like/comment/share/remix rail). Keep every hero face, gesture, diegetic sign, and `FN-001`/`FN-002` spotlight inside **`x: 4.4%–82.2%`, `y: 15%–65%`** — placing the true optical center at **`x ≈ 43%, y ≈ 40%`**:
  - **Headroom, Look-Room & Joint-Safe Crops:** Reserve **`10–15%` headroom** above the crown inside the safe box (never grazing the top `15%` bar); anchor eyes around `y ≈ 30–38%`; bias asymmetric **look-room** so right-facing gazes keep the subject left (`x ≈ 36–43%`) away from the `17.8%` right rail; crop `M`/`MCU` cleanly mid-torso or mid-thigh (**never slicing through neck, elbow, wrist, or knee joints** across any character proportion). Stage confrontations along the **Z-axis (depth)** rather than wide side-by-side blocking, and place `phrase_chunked_static` captions inside `y ≈ 52–64%`, `x ≈ 43%`.
- **Camera Elevation Psychology & Opening-vs-Closing Grammar (Section 3, `N=62`):**
  - **Elevation intent:** Use **`eye` (`68.4% W`, `76% W` close)** for direct human stakes and punchlines; **`high` (`21.4% W`)** for diorama geography, system overviews, or vulnerability; **`low`/`ground` (`7.5% W`)** to sell looming mechanical/architectural power.
  - **Opening Row 1:** Winners open on **`M` (`44%`)**, `CU` (`20%`), or `MCU` (`20%`) at **`eye` (`72% W`)** / `high` (`28% W`).
  - **Closing Final Row:** Winners close intimate on **`MCU` (`36%`) or `CU` (`20%`) — `56%` combined** at **`eye` level (`76% W` vs `52.6% F`, `+23.4pp`)**, whereas Flops drift out to detached `M` (`31.6%`) or `W` (`31.6%`) from a `high` angle (`31.6% F` vs `12% W`). Land the final punchline on an **eye-level `MCU`/`CU` character or consequence beat**.
