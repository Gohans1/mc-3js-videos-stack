# Animation, Lighting, Lookdev, VFX, and Minecraft 3D Translation

Every frequency below cites its exact source denominator (`N=17` stratified deep DNA or `N=60` supplementary visual craft benchmark). Every Minecraft 3D (`mc-films`) package/export referenced in Section 5 is verified directly against `templates/film/CAPABILITIES.md`.

## 1. Easing & Acting Energy (`N=17` Deep DNA)

| Easing Profile | Videos | Share (%) | Median Outlier | Winner Share (`n=7`) | Flop Share (`n=4`) | Lift (W/F) |
| --- | --- | --- | --- | --- | --- | --- |
| `smooth_damped` | 16 | **`94.1%`** | `1.36x` | **`100.0%`** | `75.0%` | **`1.33x`** |
| `snappy_overshoot` | 1 | `5.9%` | `0.33x` | `0.0%` | `25.0%` | `0.00x` |

- **Acting Rules for Minecraft Characters (`mc-actor/player` + `film-kit`):**
  - Keep character locomotion and prop handling **readable, clean, and damped** (`smooth_damped`) rather than overly bouncy cartoon rubber (`snappy_overshoot` appeared only on Flop `QXEr924US38`).
  - Layer subtle continuous life (`film-kit/idle`, `blinks`, `gaze`, `attention`) on background NPCs so crowds never freeze like mannequins — static background extras were flagged as a drag in `7i6ok0llYUc` and `UgP7_6_i1J4`!
  - Emphasize **instant silhouette-readable emotions**: wide-eyed panic, head snap (`film-kit/startle` + `notice`), cautious step-back, raised brow, or sudden calm grin on twist punchlines.

## 2. Lighting & Color Signature (`N=17` Deep DNA)

| Lighting Style | Videos | Share (%) | Median Outlier | Winner Share (`n=7`) | Flop Share (`n=4`) | Lift (W/F) | Production Choice |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `clean_studio_soft` | 6 | `35.3%` | **`4.69x`** | **`57.1%`** | `25.0%` | **`2.29x`** | **#1 Winner look** — bright, evenly readable 3-point softbox staging + `createEnvironment(renderer, { preset: "studio" })` IBL so colors, props, and emissive pulses pop cleanly on mobile screens |
| `natural_daylight` | 4 | `23.5%` | `2.63x` | `28.6%` | `25.0%` | `1.14x` | Best for exterior survival, street scenes, castles, trenches, and beaches (`createEnvironment(renderer, { preset: "outdoor" })` + warm sun key + cool sky fill) |
| `mixed` | 7 | `41.2%` | `1.05x` | `14.3%` | `50.0%` | `0.29x` | Only shift lighting mid-Short for deliberate narrative contrast (e.g., Winner `UgP7_6_i1J4` shifting daytime build -> night castle beacon -> studio cutaway -> daylight) |

- **Backdrop & Contrast Rule:** Keep foreground hero action bright and high-contrast against simplified, clean backgrounds (`uses_backdrop_vignette`: `35.3%` in `N=17`). Avoid dark muddy exteriors where Minecraft silhouettes blend into the horizon.

## 3. Visual & Optical Craft Signal Frequency and Winner Lift (`N=17` vs `N=60`)

| Craft Signal | `N=17` All | `N=17` Winners (`n=7`) | `N=17` Flops (`n=4`) | `N=17` Delta (W-F) | `N=60` Craft Benchmark | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| `uses_motion_blur` | `100.0%` (`17/17`) | `100.0%` | `100.0%` | `0.0 pp` | `81.7%` radial/trans, `75.0%` cam-turn, `51.7%` obj-only | **Mandatory** |
| `has_emissive_highlight_pulse` | **`94.1%`** (`16/17`) | **`100.0%`** | `75.0%` | **`+25.0 pp`** | **`86.7%`** (`52/60`) | **Mandatory Winner signature** |
| `uses_shallow_dof` | `94.1%` (`16/17`) | `100.0%` | `100.0%` | `0.0 pp` | `58.3%` (`35/60` explicit rack focus) | **Mandatory** |
| `has_diegetic_text_or_labels` | **`82.4%`** (`14/17`) | **`85.7%`** | `50.0%` | **`+35.7 pp`** | `30.0%` strict screens; `98.3%` (`59/60`) brand logos | **High-Lift Winner lever** |
| `has_motion_graphics_or_arrows` | **`70.6%`** (`12/17`) | **`85.7%`** | `50.0%` | **`+35.7 pp`** | **`80.0%`** (`48/60`) | **High-Lift Winner lever** |
| `has_cutaway_or_xray` | **`58.8%`** (`10/17`) | **`71.4%`** | `50.0%` | **`+21.4 pp`** | **`60.0%`** (`36/60`) | **High-Lift Winner lever** |
| `has_time_remap_or_hit_stop` | **`58.8%`** (`10/17`) | **`57.1%`** | `25.0%` | **`+32.1 pp`** | Tracked in motion beats | **High-Lift Winner lever** |
| Particles / Fluid / Debris | Qualitative in `N=17` | High | Moderate | — | **`90.0%`** (`54/60`) | **High polish** (water, smoke, sparks, dust) |
| Thought Bubble / PiP / Split-Screen | Qualitative (`OXRzmyOMKVw`) | Used selectively | Rare | — | `13.3%` (`8/60`) PiP; `3.3%` (`2/60`) split-screen | Optional visual shorthand for mind-games / comparisons |

## 4. Diegetic Branding & Micro-Easter-Egg Habit

- **`59/60` (`98.3%`)** in the `N=60` craft benchmark and multiple `N=17` dossiers (`7i6ok0llYUc` Winner shirt/clock/balloon, `320fjAdEboQ` Winner shirt, `epP7TB8n3ZU` Median floor projection, `rPWvvcttpmk` Median shirt/gantry, `5puZlZQNArc` Flop truck decal) embed a subtle **creator brand watermark diegetically onto 3D props, shirts, signs, or packaging** instead of slapping an intrusive corner watermark on screen.
- **Rule for Your Channel:** Replace `"ZACK D. FILMS"` with your own channel brand (e.g., on an NPC shirt via `mc-actor/skin-paint`, a printed poster via `mc-assets/ink`, or a shop billboard) once per Short so it feels native to the 3D world.

## 5. Minecraft 3D (`mc-films`) Translation Matrix

Never try to sculpt squishy human organs or watchmaker gears in Minecraft. Translate every Zack D. Films signature cue cleanly into voxel-native `mc-films` cinema using verified exports from `templates/film/CAPABILITIES.md` and `bun run skills get core`:

| Zack D. Films Visual Cue | Empirical Frequency | Exact `mc-films` Implementation | Practical Craft Tip |
| --- | --- | --- | --- |
| Synchronized noun emissive highlight pulse (`0.4–0.6s` yellow/red/cyan glow) | `94.1%` (`N=17`), `100%` Winners; `86.7%` (`N=60`) | `film-stage/highlight`: `createHighlight(root)` + `pulseEnvelope(t, start, end)` | Color-code consistently (red = threat/error, amber/gold = hero prop, cyan = system/AI clue) |
| Architectural wall / dollhouse / room cutaway slice | `58.8%` (`N=17`), `71.4%` Winners; `60.0%` (`N=60`) | `renderer.localClippingEnabled = true` (`src/scene.ts`) + `THREE.Plane` on `material.clippingPlanes` | Slice exterior Minecraft brick/concrete walls cleanly as camera pushes inside without a hard cut |
| Multi-subframe motion blur on camera whips & fast props | `100%` (`N=17`); `75–81.7%` (`N=60`) | `shots.json` `shutter: { samples: 12..16 }` + `--samples 8` for draft motion blur + `film-stage/velocity` (`makeVelocity`) | Pass `--samples 8` on draft stills/clips to see shutter blur (1-sample drafts ignore per-shot `shutter.samples`); set `shutter: { samples: 12..16 }` in `shots.json` to boost whip-pan shots on multi-sample renders (`final`/`poster`) |
| Shallow DOF & timed rack focus | `94.1%` (`N=17`); `58.3%` rack focus (`N=60`) | `film-stage/dof` (`makeDof`) + `shots.json` `optics.focus` / `cam.json` `focus` | Rack from foreground prop to reacting Steve's face (`Steve.head`) to pivot beats without cutting |
| Classic editorial transitions (`cross_dissolve`, `card_flip`, `push_up`) | `71.4%` W dissolve, `35.3%` cardFlip, `17.6%` unique wipe/push (`N=17`); `30.0%` cardFlip, `20.0%` pushUp (`N=60`) | `film-stage/transitions` (`TRANSITIONS`: `dissolve`, `cardFlip`, `pushUp`) in `shots.json` | Match screen framing across `dissolve`; use `cardFlip` for GTA 5 vs GTA 6 or Before/After flips |
| Clean soft studio or daylight PBR look | `57.1%` W studio (`2.29x` W/F), `28.6%` W daylight (`N=17`) | `film-stage/lights` (`createEnvironment(renderer, { preset: "studio" \| "outdoor" })`, `createLightingRig`, `LIGHT_PRESETS`) + `N8AOPostPass` | Set `look.toneMapping: "neutral"` in `src/edit.json` (via `film-stage/tone` `toneMappingMode`) when exact saturated color match matters |
| Floating 3D timers, rulers, multiplier badges, callout arrows | `70.6%` (`N=17`), `85.7%` Winners (`+35.7 pp`); `80%` (`N=60`) | `film-stage/titles` (`makeTitles`, `counted`, `typed`, callout arrows/circles) + `film-stage/openfilm` (`src/timeline/openfilm.json`) | Keep labels `1–3` words (`"55,000"`, `"600,000+"`, `"6 STARS"`); validate Shorts UI clearance with `bun run render stills --check text` |
| Diegetic signs, papers, CRT screens, custom phone/HUD displays | `82.4%` (`N=17`), `85.7%` Winners (`+35.7 pp`) | `mc-assets/ink` (`printProps`), `mc-assets/gamefont` (`loadFont`), `mc-assets/screen` (`buildScreen` for `gohans:computer*`), custom `CanvasTexture` for phones/billboards | Double-check dates/numbers across props (inconsistent dates/altitudes broke immersion in `SGgYDfeHYXA` and `Uzo10EjKC6w`) |
| Speed ramps, timelapses, hit-stops, ghost trails | `58.8%` (`N=17`), `+32.1 pp` Winner lift | `src/timeline/timing.json` (speed ramps/freezes) + `shots.json` `cameraClock: "output"` | Keep `cameraClock: "output"` so camera glides smoothly across speed-ramped or frozen world time |
| Procedural NPC acting, crowd life, and instant emotional snaps | Core to every story Short | `mc-actor/player` (`makePlayer` -> `player.holdProp`, `FACES`, `MOODS`) + `mc-actor/skin-paint` + `film-kit/{idle,blinks,gaze,startle,notice,hesitate,reach,handeye,steps}` | Give every visible background NPC unique skin + offset `idle`/`gaze` seeds so crowds never look cloned or frozen |
| Real rigid-body drops, debris, knockbacks | `90.0%` particles/fluid/physics (`N=60`) | `@dimforge/rapier3d-compat` pre-baked offline in Bun -> `src/timeline/*.json` sampled purely inside `draw(t)` | Pre-bake physics to JSON so `draw(t)` remains 100% pure and scrub-safe |
