# Animation, Acting, Look-Dev, Optics & VFX (Zone 1: Use)

Empirical visual medium, protagonist staging, bounded-set architecture, dominant craft pillar mix, acting directing, lighting & color-script craft, 4-way motion blur, depth-of-field, protected-hue emissive choreography, and VFX playbook for Zack D. Films (`statsVersion: 4`). All core metrics come from `N=62` clean 24 FPS `schema_version: 2` dossiers (`25 W / 18 M / 19 F`, `945/945` pillar-tagged shots), with Fisher exact `p` and BH-FDR `q`. Reliability tiers: `stable >=8`, `tentative 5–7`, `directional <5`. Optional renderer/engine implementations live strictly in **Section 7**.

## 1. Visual Medium, Protagonist Staging & Craft Pillar Mix (`N=62`, `945` Tagged Shots)

| Dimension / Value (`N=62`) | Videos | Share (%) | Median Outlier | Winner Share (%) | Flop Share (%) | Lift (W/F) | Delta W-F (pp) | `p (q)` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `medium:3d_stylized_cgi` | 55 (`stable`) | 88.7% | 1.05x | 92% | 78.9% | 1.17 | +13.1 | 0.378 (0.638) |
| `medium:3d_photoreal_cgi` / `mixed_hybrid` | 6 / 1 | 9.7% / 1.6% | 0.61x / 0.35x | 8% / 0% | 15.8% / 5.3% | 0.51 / 0 | -7.8 / -5.3 | >=0.432 |
| **`protagonist:third_person_characters`** | 48 (`stable`) | 77.4% | 1.21x | **88%** | **57.9%** | 1.52 | **+30.1** | **0.035** (0.088) |
| `protagonist:first_person_pov` | 3 (`directional`) | 4.8% | 5.31x | 12% | 0% | - | +12 | 0.247 (0.411) |
| **`protagonist:faceless_objects_diagrams`** | 9 (`stable`) | 14.5% | **0.29x** | **0%** | **31.6%** | 0 | **-31.6** | **0.004 (0.019 ★)** |
| `easing:smooth_damped` / `snappy_overshoot` | 56 / 6 | 90.3% / 9.7% | 0.98x / 1.06x | 92% / 8% | 100% / 0% | 0.92 / - | -8 / +8 | 0.498 (0.498) |

| Section 3 Dominant Craft Pillar (`945/945` Shots; Equal-Weight Per-Video MW-U) | Shots | Mean Video (%) | Winner Video (%) | Flop Video (%) | Delta W-F (pp) | Video Prev (%) | `MW-U p (q)` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Camera, Framing & Staging` | 217 | 23.1% | 21.3% | 25.4% | -4.1 | 100% | 0.129 (0.344) |
| `VFX, Cutaways & Graphics` | 204 | 21.9% | **23.2%** | 21.8% | +1.4 | 98.4% | 0.635 (0.847) |
| `Motion, Acting & Prop State` | 157 | 16.6% | 16.3% | 16% | +0.3 | 96.8% | 0.905 (0.905) |
| **`Transitions & Continuity`** | 132 | 13.3% | **16.4%** | **9.2%** | **+7.2** | 87.1% | **0.002 (0.017 ★)** |
| `Lighting, Color & Materials` | 109 | 11.8% | 10.6% | 12.9% | -2.3 | 93.5% | 0.213 (0.426) |
| `Optics: Blur, DOF & Temporal` | 105 | 11.2% | 11% | 11% | 0 | 85.5% | 0.849 (0.905) |
| `Audio-Visual Sync & Soundscape` | 19 | 1.9% | 1.1% | 3.4% | -2.3 | 25.8% | 0.051 (0.203) |
| `Other` | 2 | 0.2% | 0% | 0.2% | -0.2 | 3.2% | 0.271 (0.433) |

- **Protagonist & bounded-world mandate (`q=0.019 ★`):** `100%` of Winners (`25/25`) anchor the drama in a character (`88%`) or POV hands (`12%`) inside a **full bounded environment** (room, street, cockpit, field). Pure `faceless_objects_diagrams` sits at `0% W` vs `31.6% F` (`q=0.019`), and inside `explainer_how_it_works` (`W=4/F=6`), floating vignetted voids score `25% W` vs `100% F` (`p=0.033, q=0.812`).

## 2. Style-Agnostic Character Acting & Mechanical Directing Playbook

1. **Moving Holds & Cadence (`on-1s` Fluidity):** Animate on continuous `on-1s` smooth-damped motion (`90.3%` `smooth_damped`, `92% W`) — never choppy `on-2s` smears or dead 3D statue freezes. Even on pause beats, maintain living micro-motion (chest breathing, subtle weight shift, natural blinks).
2. **Arcs, Weight Curves, `10–15%` Overshoot & `1–3f` Hit-Stops:** Move limbs, levers, and flung props along natural curved **arcs** (never robotic linear point-to-point interpolation). Communicate mass via spacing curves (heavy lifts slow-out -> fast drop -> short damped settle; snappy mechanical throws carry a clean `10–15%` overshoot + `1–3f` hit-stop on hard physical locks).
3. **1-Pose-Per-Beat Asymmetry, Drag & Eye-Leads-Head (`PL-002`):** Give every story beat ONE clear asymmetric hero pose (offset shoulders/hips, never mirrored T-pose symmetry) with `2–4f` secondary drag on arms, coats, or carried props. On curiosity/glances, **eyes dart `2–3f` ahead of the head** (ramped smoothly over **`~0.10s`**); on startle/recoil, **torso/shoulders react first** with head/arms trailing.
4. **Weight, Contact, Mechanical Linkages & Deadpan Break (`FN-003`):** Plant feet with grounded contact AO/shadows (zero skate/float like `CN1mw2c0w4c`). Stage every interaction as `anticipation -> contact -> reaction -> settle`, tracking full prop lifecycles (`entry/ON -> state change -> exit/reset`) and explicit **mechanical linkages** (hand pulls handle -> latch rotates -> linkage releases -> consequence fires — readable on Mute!). Verify readable grayscale silhouette, lock wardrobe across shots (`LjHDUQ7Htvk`), and reserve `0.8–1.2s` deadpan eye-contact breaks (`FN-003`) strictly for mischief/irony beats.

## 3. Lighting, Shadows, Material Register & Protected Semantic Hues (`N=62`)

| Dimension / Value (`N=62`) | Videos | Share (%) | Median Outlier | Winner (%) | Flop (%) | Lift (W/F) | Delta W-F (pp) | `p (q)` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `lighting:clean_studio_soft` | 28 (`stable`) | 45.2% | 1.04x | 48% | 47.4% | 1.01 | +0.6 | 1.000 (1.000) |
| `lighting:mixed` / `natural_daylight` | 19 / 11 (`stable`) | 30.6% / 17.7% | 0.97x / **4.07x** | 24% / 24% | 26.3% / 15.8% | 0.91 / 1.52 | -2.3 / +8.2 | >=0.710 |
| `lighting:dramatic_low_key` | 2 (`directional`) | 3.2% | **0.27x** | **0%** | 10.5% | 0 | -10.5 | 0.181 (0.904) |
| `shadows:soft_diffuse` / `mixed` / `crisp_hard` | 41 / 12 / 9 | 66.1% / 19.4% / 14.5% | 1.08x / 0.95x / 0.99x | **76%** / 12% / 12% | 63.2% / 15.8% / 21.1% | 1.2 / 0.76 / 0.57 | **+12.8** / -3.8 / -9.1 | >=0.443 |
| `palette:clean_bright_saturated` | 48 (`stable`) | 77.4% | 1.03x | **80%** | 68.4% | 1.17 | +11.6 | 0.488 (0.949) |
| `palette:cool_moody_teal` / `dark_high_contrast` | 3 / 1 (`directional`) | 4.8% / 1.6% | 0.3x / 0.29x | 4% / 0% | 10.5% / 5.3% | 0.38 / 0 | -6.5 / -5.3 | >=0.432 |

- **Topic-conditioned lighting (`lightingByTopic` & `withinBucketContrasts`):** Outdoor survival/nature Winners thrive in `clean_studio_soft` (`W:4/F:0`) or `mixed`/`natural_daylight` (`4.07x`); inside `cold_open_crisis`, `shadows:soft_diffuse` hits **`83.3% W` (`5/6`) vs `0% F` (`0/3`, `p=0.048, q=0.857`)**. Inside `explainer_how_it_works`, `clean_studio_soft` flips to `W:1/F:5` when paired with empty vignetted studio backdrops — always put soft diffuse lighting inside a real room/world.
- **Key/Fill/Rim Hierarchy, 60-30-10 Value Separation & Material Register:**
  - **Key/Fill/Rim (`~2:1–3:1`):** Light subjects with a soft overhead/45° key, clean fill (no crushed black cavities), and a subtle rim light carving character shoulders/heads off the background.
  - **60-30-10 Saturation & Grayscale Value Gap:** Keep **`60%`** of the frame calm low-saturation bounded architecture (mid-value neutrals), **`30%`** clean secondary props/wardrobe, and **`10%`** high-saturation hero subject or active mechanism — maintaining a clear **grayscale luminance gap (`>=20%` value separation)** between hero silhouette and background at mobile scale.
  - **Material Surface Register:** Separate functional materials visibly by roughness — **matte** architecture/asphalt/fabric (`roughness 0.75–0.95`) vs **semi-gloss** plastics/painted metal (`0.30–0.50`) vs **specular/glass** reflectors (`0.05–0.18`) — so light bounces naturally without muddy plastic uniformity. Never add fake film grain, chromatic aberration, or heavy lens dirt on clean digital frames.
- **3-Beat Color Script & Protected Semantic Hues (`FN-005`, `PL-008`):** Plan lighting/color contrast across **3 acts** (Clean Bright Baseline -> Escalation Contrast Shift -> Payoff/Twist Reset). **Protected Semantic Hue Law:** Never let background props, shop neon, or UI chrome share the same hue as your `FN-005` emissive highlight language (yellow/gold = attention/quantity spotlight, red/orange = hazard/failure, cyan/green = lock-in/state swap).

## 4. Four-Way Motion Blur, Shallow DOF & Optical Craft Signals (`N=62`)

| Craft Signal (`N=62`) | Videos | Share (%) | Winner (%) | Flop (%) | Delta W-F (pp) | `p (q)` | Directing Rule |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `uses_motion_blur` (any) | 60 (`stable`) | 96.8% | **100%** | 94.7% | +5.3 | 0.432 (0.678) | Universal baseline (`100% W`): crisp static whips look amateur |
| **`uses_camera_turn_blur`** | 53 (`stable`) | 85.5% | **96%** | 68.4% | **+27.6** | **0.032** (0.221) | Full-frame directional smear during `whip_pan` & fast `orbit_arc` turns |
| `uses_translation_or_radial_blur` | 52 (`stable`) | 83.9% | **96%** | 73.7% | **+22.3** | 0.070 (0.221) | Radial zoom streak on fast `push_in`, `pull_back`, and `fpv_dive` moves |
| `uses_object_motion_blur` | 52 (`stable`) | 83.9% | 88% | 73.7% | +14.3 | 0.262 (0.337) | Moving limb, lever, or projectile streaks against a sharper room |
| `uses_subject_tracking_blur` | 17 (`stable`) | 27.4% | **12%** | **36.8%** | **-24.8** | 0.074 (0.221) | **Use sparingly:** heavy blurred BG behind locked subject hurts mobile readability |
| `uses_shallow_dof` / `uses_rack_focus` | 58 / 43 | 93.5% / 69.4% | **100% / 80%** | 94.7% / 57.9% | +5.3 / **+22.1** | 0.432 / 0.182 | **Scale-gated DOF:** keep `EW/W` geography deep & legible; apply stronger bokeh on `MCU/CU/ECU/INSERT` + `0.30–0.45s` `rack_focus` starting `0.15–0.25s` ahead of spoken reveal |
| `uses_backdrop_vignette` | 28 (`stable`) | 45.2% | 40% | 57.9% | -17.9 | 0.361 (0.678) | Flop proxy in explainers (`25% W` vs `100% F`, `p=0.033`): avoid floating voids |

## 5. VFX, Cutaways, Emissive Flashes & 3-Tier Graphics Hierarchy (`N=62` + `[Field Note]`)

| Visual Device (`N=62`) | Videos | Share (%) | Winner (%) | Flop (%) | Delta W-F (pp) | `p (q)` | Directing Standard |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `has_emissive_highlight_pulse` | 59 (`stable`) | 95.2% | 96% | 89.5% | +6.5 | 0.570 (0.783) | Synced ON->OFF protected-hue outline/rim pulse on exact spoken noun (`FN-001`, `FN-002`, `FN-005`) |
| `has_diegetic_channel_branding` | 49 (`stable`) | 79% | 88% | 73.7% | +14.3 | 0.262 (0.337) | In-world shirt/clock/sign branding — always replace with the user's own mark |
| `has_particles_or_fluid` | 47 (`stable`) | 75.8% | 80% | 68.4% | +11.6 | 0.488 (0.488) | Tactile sparks, dust puffs, splashes, or streams proving physical force without occluding hero faces or mechanism contact |
| `has_motion_graphics_or_arrows` | 43 (`stable`) | 69.4% | 76% | 73.7% | +2.3 | 1.000 (1.000) | Clean world-space rulers, vector arrows, dashed trajectories, force lines |
| `has_diegetic_text_or_labels` | 40 (`stable`) | 64.5% | 68% | 42.1% | **+25.9** | 0.126 (0.678) | World-space calipers, timers, counters, or signs anchored to geometry (spell-check every word!) |
| `has_cutaway_or_xray` | 30 (`stable`) | 48.4% | 60% | 36.8% | **+23.2** | 0.223 (0.678) | 3-phase cutaway staging (exterior anchor -> clean slice + dedicated interior light -> clear cutaway rim) |
| `has_time_remap_or_hit_stop` | 30 (`stable`) | 48.4% | 52% | 36.8% | +15.2 | 0.371 (0.678) | Impact slow-mo, speed-ramped timelapses, or `1–3f` hit-stops |
| `has_pip_or_split_screen` | 12 (`stable`) | 19.4% | 28% | 5.3% | +22.7 | 0.111 (0.250) | Circular memory PiP bubbles or twin contrast stages |

- **3-Phase Cutaway Staging & Particle Non-Occlusion:** Stage every `has_cutaway_or_xray` in 3 crisp beats: **(1) Exterior Anchor** (`0.4–0.8s` intact shell so viewers know *where* we are), **(2) Slice / Transparency Reveal** (clean cross-section rim + dedicated **interior fill light** so internal components never fall into dark shadow), and **(3) Mechanism Action** (keep sparks/smoke/fluid offset or semi-transparent so particles prove force without ever occluding the contact joint or face).
- **3-Tier Graphics, Captions & PiP Hierarchy (`>=0.8–1.0s` Dwell):** Never let text layers fight inside the 9:16 Safe Box: **(Tier 1) Spoken Captions** (`phrase_chunked_static` `91.9%`, 2–4 crisp words in `y ≈ 52–64%`), **(Tier 2) Diegetic Labels / Counters** (`1–3` words anchored in 3D space with `>=0.8–1.0s` readable dwell & spell-checked copy), **(Tier 3) Force Arrows / Circular PiP** (high-contrast clean strokes strictly inside `x: 4.4–82.2%`, `y: 15–65%`).
- **Emissive Spotlight Choreography (`FN-001`, `FN-002`, `PL-003`):**
  - **Pattern 1 (`FN-001`, `KNUvtyqbqDc` `00:03.00–00:03.84`):** Pull back to expose the full group, fire a crisp yellow outline pulse right as VO speaks the count/noun, then deactivate cleanly before moving on.
  - **Pattern 2 (`FN-002`, `KNUvtyqbqDc` `00:12.35–00:12.75`):** Old prop exits frame -> replacement props lock in -> fire a tight `~0.40s` cyan rim snap flash around silhouette/edge at lock-in -> return cleanly to base lighting.
  - **Gate 3 Visual Budget Rule:** Limit each shot to **1 hero VFX/cutaway/emissive event at a time** (never stack particles + X-ray + arrows + flash simultaneously); inspect pre-ON, peak-ON, and post-OFF frames (`PL-003`).

## 6. Invariant vs Adapted Style-Transfer Matrix

| Channel Soul Invariants (Keep Identical in Any Medium) | Medium-Adapted Choices (Translate Per Chosen Style) |
| --- | --- |
| Title (`<=6w`, `<=50` chars + 1 emoji), Frame-0 visual anomaly, Dual-Path confirmation | Character silhouette/art style (`stylized 3D`, `photoreal 3D`, `Minecraft`, `2D/anime`, `live-action`) |
| Bursty `6`-sentence Grade `6.7` Saxon prose (`CV ~0.36`), `145–165` WPM, `But/Therefore`, `0` 4th-wall leaks | Rendering pipeline, shaders, and surface materials (preserving clean bright readability + soft shadows) |
| `5.46s W` unbroken takes, `<=1` Hard Cut, `0.17s` `card_flip`/`dissolve`, `0.23s` `push_up`, `0.82x` tighten, `MCU/eye` close | Technical execution of 180° shutter blur, rack focus, cutaways, and `FN-001`/`FN-002` protected-hue flashes |
| Clinical VO, continuous emotion-matched BGM, `0f/-1f` SFX sync, `0.7s` tail, EBU R128 Shorts master | Rig acting vocabulary (full facial blendshapes vs blocky body/head tilt + `0.10s` eye-leads-head ramps) |

---

## 7. Optional Pluggable Target-Style and Engine Adapters

**Sections 1–6 above are 100% engine-agnostic.** Apply ONLY the adapter matching the user's chosen visual engine:

| Target Style / Engine | Conceptual Translation (Core Remains Engine-Agnostic) |
| --- | --- |
| **Minecraft 3D / `mc-films` Monorepo (Active Local Engine)** | See **Section 7.1** below for verbatim-verified workspace packages, CLI workflow, and Studio shortcuts. |
| **Other 3D Engines** *(Blender Cycles/EEVEE, Unreal, Cinema 4D, Houdini, vanilla Three.js)* | Use bounded set geometry, soft diffuse area/IBL lighting, physical 180° shutter motion blur (`camera_turn` + `radial` + `object`), real focal-distance rack focus, boolean/clip-plane cutaways, protected-hue per-object emission pulses keyed `0 -> peak -> 0`, `5f`/`7f` transitions, and two-pass linear FFmpeg `loudnorm`. |
| **2D / Anime / Motion Graphics** *(After Effects, Spine, Moho, OpenFilm)* | Multi-plane parallax & perspective morphs for pushes/orbits; painted directional speed smears on whips; layered DOF blur planes; silhouette rim-glow mattes for `FN-001`/`FN-002`. |
| **Live-Action / Practical Tabletop** | Wide-angle gimbal pushes/pull-backs and physical whip-pan transitions (`180°` shutter); practical softboxes in real locations; rotoscoped rim glow or practical accent lights preserving skin tones. |

### 7.1 Optional Local Adapter: Minecraft 3D / `mc-films` Monorepo

All imports, JSON fields, CLI commands, and Studio shortcuts below are verified verbatim against [templates/film/CAPABILITIES.md](../../../../templates/film/CAPABILITIES.md), workspace package source (`packages/film-stage/src/highlight.ts`, `packages/mc-actor/src/{player,carry}.ts`, `templates/film/src/{scene.ts,edit.json,timeline/lights.json}`), and `skill-data/core/references/{contract,film,render,review,sound,voice}.md`:

**New-Film ZDF Override Checklist (Apply Immediately After `bun run new-film <slug>`):**
1. **Enable Soft Cast Shadows (`src/timeline/lights.json`):** Template ships `key.castShadow: false` — flip **`key.castShadow: true`** and raise **`shadowRadius: 3–5`** so characters and props ground cleanly (`76% W` `soft_diffuse`).
2. **Strip Default Vignette & Raise Bloom Threshold (`src/scene.ts`):** Template ships `new VignetteEffect({ offset: 0.3, darkness: 0.45 })` and `new BloomEffect({ intensity: 0.4, luminanceThreshold: 1.0, mipmapBlur: true })` — zero/remove `VignetteEffect` (`darkness: 0`, avoiding the `100% F` explainer vignette trap) and raise `BloomEffect` **`luminanceThreshold: 3.8–4.0`** so bright lit white shirts/hair never bloom into halos (`PL-008`).
3. **Neutral/ACES Color Fidelity (`src/edit.json`):** Template omits `look.toneMapping` (defaulting to AgX, which desaturates bright highlights) — set **`"look": { "toneMapping": "neutral" }`** (or `"aces"`) to hold `clean_bright_saturated` (`80% W`) punch.
4. **Physical Blur & Timecode Renders (`shots.json` + CLI):** Set **`shutter: { angle: 180, samples: 8..64, apertureSamples: 8..16 }`** on moving/DOF shots, pass **`--samples 8`** on BOTH `bun run render stills --samples 8 --at ...` AND `bun run render clip --span <a>,<b> --samples 8`, and burn 720p timecode review copies via **`bun run reference timecode <video>`**.

| Production Layer | Verified `mc-films` Modules, Configs & Commands | Zack D. Films Execution Notes |
| --- | --- | --- |
| **Project & 9:16 Shorts Setup** | `bun run new-film <slug>`; set `"ratio": "9:16"` under `"live-studio"` in `package.json` (`720x1280` draft / `1080x1920` final); `bun run check`; `bun run studio --detach` | Never copy `sealed-room`; start from `templates/film/` and apply the 4-Point Override Checklist above. Check `bun run help` inside the film dir for the film's exact timeline map. |
| **Characters, Mobs, Skins & Props** | `mc-actor/player` **exports:** `makePlayer`, `loadRig`, `blendPose`, `mouthAt`, `FACES`, `MOODS`; **instance methods on returned `player`:** `player.armTo`, `player.legTo`, `player.headTo`, `player.holdProp`, `player.tintParts`, `player.showParts`, `player.face`, `player.setFace`, `player.setSkin`; `mc-actor/skin-paint` (`paint`, `shade`, `jacket`, `tie`, `belt`); `mc-actor/mob` (`loadMob`); `mc-actor/feet` (`makeFeet`); `mc-actor/checks` (`footChecks`); `mc-actor/carry` (`makeCarry` — strictly for loose paper sheets/folders); `mc-actor/clips` (`loadClips`, `loadClip`); `mc-actor/mocap` (`slerpPose`); `mc-assets/model` (`blockModel`, `itemModel`, `texture`, `modelBounds`); `mc-assets/placed` (`makePlaced`); `mc-assets/screen` (`buildScreen` strictly for `gohans:computer*`; use `CanvasTexture` for phones/TVs/LCDs); `mc-assets/gamefont` (`loadFont`) | Lock consistent protagonist skin/wardrobe via `skin-paint`; prefer `slerpPose` over `blendPose` on multi-axis blends to avoid Euler flips; use `makeFeet` + `footChecks` to eliminate foot-slip; use `player.holdProp("R"\|"L", mesh, { pos, rot })` (attaching to `handR`/`handL`) for general 3D props and reserve `makeCarry` strictly for loose paper sheets/folders. |
| **Procedural Acting & Camera Physics** | `film-kit/<name>` (`idle`, `blinks`, `gaze`, `express`, `startle`, `overlap`, `cartoon`, `reach`, `handeye`, `steady`, `posture`, `lean`, `balance`, `spring`, `arc`, `hash`, `lens`, `handheld`, `shake`, `safe`), `film-stage/camera` (`makeCameraRail`, `cameraAt`, `EASES`, `shakeAt`), `src/timeline/timing.json` + per-shot `cameraClock: "output"` on `shots.json` | Ramp eye-leads-head turns (`gaze`) and hand switches over `~0.10s` (`PL-002`); use `film-kit/hash` + scratch `Object3D`/`Matrix4` (`frustumCulled = false`) for stateless `InstancedMesh` particles; use `cameraClock: "output"` across Speed/Freeze ramps. **Shutter Cut Gotcha (`PL-009`):** extend moving camera/object keyframes right up to `cut - 0.001s` before `cut: true` so the final pre-cut frame never pops sharp! |
| **Optics, Blur, Lighting, Flashes & Cutaways** | `film-stage/dof` (`makeDof`, `blurPx`, `shots.json` `optics.focus`, `tools.apertureSampling`), `shots.json` `shutter: { angle: 180, samples: 1..64, apertureSamples: 1..16 }`, `film-stage/lights` + `src/timeline/lights.json` (`createLightingRig`, `LIGHT_PRESETS`, `KELVIN_CHIPS`, `createEnvironment`, `ENVIRONMENT_PRESETS`), `film-stage/flicker` (`flickerAt`), `film-stage/grade` + `film-stage/looks` (`LOOKS`), `film-stage/tone` (`toneMappingMode`) + `src/edit.json` `look.toneMapping` (`neutral`/`aces`/`agx`), `n8ao` (`N8AOPostPass`), `film-stage/highlight` (`createHighlight` + `pulseEnvelope`), `renderer.localClippingEnabled = true` (`material.clippingPlanes`, `clipShadows: true`, `THREE.DoubleSide`), `film-stage/transitions` (`makeTransitions`, `TRANSITIONS`: `dissolve`, `cardFlip`, `pushUp`, `irisOpen`, `whipStreak`), `@dimforge/rapier3d-compat` (offline pre-bake) | **Emissive vs Outline vs Character Rim Split (`highlight.ts` + `player.ts` + `PL-007`):** `createHighlight(root)` lerps **whole-mesh emissive** on cloned materials — use it ONLY for whole-surface prop/block pulses, and **NEVER pass `steve.g`** (cloning `mesh.material` detaches `player.ts`'s closure-captured `inner`/`outer` materials, silently breaking `steve.showParts()`, `steve.red()`, and `steve.setSkin()`, while whole-mesh emissive blows out facial features into bloom!). Build **`FN-001` outlines** via `THREE.EdgesGeometry` + `THREE.LineSegments` or an inverted-hull `THREE.BackSide` shell kept below `BloomEffect` `luminanceThreshold` (`3.8–4.0`); build **`FN-002` character rim snaps** via a dedicated cyan rim light (`lights.json` `rim` / accent `SpotLight`) or a face-excluding `THREE.BackSide` silhouette shell so the face stays 100% crisp (`PL-003`). **Alpha-Shell Cutaways (`film.md`):** clone shared materials once and in `draw(t)` set `transparent = k < 0.999`, `depthWrite = k >= 0.999`, `opacity = baseOpacity * k`, `alphaTest = baseAlphaTest * k`, `visible = k > 0.005`. |
| **Audio-First Voice, Core Sound Kit & Overlays** | `bun run voice:gen [--yes]`, `bun run voice:align`, `bun run voice:lips`, `bun run voice:assemble`, `bun run voice:cues`, `bun run at <heard-sec>`, `bun run sound:kit recommend --category <cat> --q "<words>" --top 5` (check Core Sound Kit BEFORE raw `bun run find`), `bun run mix`, `bun run listen`, `earshot`, `film-stage/titles` (`makeTitles`, `FONTS`), `film-stage/openfilm` (`src/timeline/openfilm.json`) | Generate & align real VO FIRST (`Audio-First Re-Timing`), read exact word timestamps via `voice:cues` & `at <heard-sec>`, then lock shots/flashes/SFX to heard audio timestamps (`PL-006`). |
| **Original-Video Local QA & Studio Director's Eye** | `bun run render stills --samples 8 --at ... --check "motion\|seen\|touch:<target>,<from>,<to>;probe:<t>;text;order"`, `bun run render clip --span <a>,<b> --samples 8`, `bun run reference timecode <video>`, `bun run framecheck`, `bun run qc`, `bun run pace`, `bun run sheet <video> frames <times>`, `bun run deliver --youtube`; Studio shortcuts: `Shift+V` (B&W silhouette/value), `Shift+O` (cut-boundary ghost), `Shift+C` (Color Script), `Alt+M` (Mute Test), `Shift+H` (Blind Audio Test) | **Safe-Box Caveat (`review.md`):** `--check text` validates Google's looser Shorts ad floor (`10%` right, `25%` bottom, `10%` top, `5%` left) — still verify stricter organic Safe Box clearance (`17.8%` right, `35%` bottom, `15%` top: `x: 4.4–82.2%`, `y: 15–65%`, `PL-004`) visually. **Never run `bun run sweep` on original Shorts** (`sweep` ranks a remake against a `REF` video; use `framecheck`/`qc`/`pace` + Stage B Original-Video QA instead). |
