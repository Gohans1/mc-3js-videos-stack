# Worked Production Blueprint: GTA 6 vs GTA 5 Realistic Details & NPC Behavior

Complete end-to-end proof-of-use demonstrating the `zack-d-films` skill on an unseen prompt (*"How GTA 6 differs from GTA 5 in realistic details and NPC behavior"*), built natively for **Minecraft 3D (`mc-films`)** execution and grounded in verified 2026 Rockstar interviews and showcase coverage (Rob Nelson via Edge/GamesRadar/TGG, Aaron Garbut via NYT, Mark Tennant & Valmor Garcia via Creative Bloq, and the *GTA 6: An Extended Look* showcase).

## 1. Concept Lock & Packaging Specification

| Field | Locked Decision | Empirical Justification |
| --- | --- | --- |
| **Title** | `Why GTA 6 NPCs Won't Run 😱` | **`6` words + `1` trailing `😱`** (`N=734`: Winners median `6` words; `😱` achieves `1.29x` median outlier, `26.8%` W vs `9.8%` F) |
| **Topic Category** | `pop_culture_media_tech` (`gta6_vs_gta5_npc_realism`) | 100% Minecraft-friendly street, crowd, shop, and police staging (zero anatomy/clockwork) |
| **Hook Archetype** | `hypothetical_premise` (`"If you pull a shotgun..."`) | `N=17`: Top-performing hook (`4.92x` median outlier, `1.71x` W/F lift); `N=43`: `hypothetical_if_you` = `50%` W / `0%` F |
| **Story Structure** | `problem_solution_irony` | `N=17`: `2.88x` median outlier, **`0%` Flops** (`28.6%` Winners) |
| **Connector & Ending** | `but_therefore` -> `ironic_twist_punchline` | `N=17`: `70.6%` `but_therefore`; `ironic_twist_punchline` = `47.1%` (`1.71x` W/F lift); zero forced seamless loop |
| **Target Runtime & WPM** | **`42.0s`**, **`108` words**, **`154.3 WPM`** | `N=270`: `35–44s` sweet spot (`44.1%` W, `1.25x`); `N=43`: MC-friendly Winners median **`150.9 WPM`** (`150–164 WPM` = `20.5M` median views) |
| **Lighting & Easing** | `natural_daylight` -> `clean_studio_soft` cutaway; `smooth_damped` | `N=17`: `smooth_damped` = `100%` Winners; clean bright lighting prevents dark silhouette muddiness |

## 2. Beat-Budgeted Voiceover Script (`42.0s` | `108` Words | `154.3 WPM`)

| Beat Role | Time | Sec (`%`) | Words (`Beat WPM`) | Verbatim Spoken VO Script |
| --- | --- | --- | --- | --- |
| `hook` | `00:00.0–00:05.0` | `5.0s` (`11.9%`) | `14` (`168.0`) | *"If you pull a shotgun beside a GTA 5 NPC, they won't even flinch."* |
| `setup` | `00:05.0–00:11.0` | `6.0s` (`14.3%`) | `15` (`150.0`) | *"GTA 5 ran on 55,000 animations, so crowds looped stiff walks and forgot dropped objects."* |
| `escalation` | `00:11.0–00:23.0` | `12.0s` (`28.6%`) | `31` (`155.0`) | *"But GTA 6 ditches magic pockets and adds over 600,000 handcrafted animations across nearly 1,000 daily routines. A rifle on your back gets ignored, but grip a gun and crowds scatter."* |
| `visual_proof` | `00:23.0–00:31.0` | `8.0s` (`19.0%`) | `19` (`142.5`) | *"Even police stopped magically knowing you. Witnesses now feed your clothes, car, and partner into a six-star suspect profile."* |
| `twist` (`73.8%`) | `00:31.0–00:37.0` | `6.0s` (`14.3%`) | `16` (`160.0`) | *"Worse yet, crowds no longer just flee. Push the wrong shopkeeper, and they actually fight back."* |
| `resolution` | `00:37.0–00:42.0` | `5.0s` (`11.9%`) | `13` (`156.0`) | *"So in GTA 6, escaping cops isn't the hard part. Surviving NPCs is."* *(last word ends `41.4s`; `0.6s` clean settle)* |

- **Fact Grounding Note:** Every factual contrast (`~55,000` vs `600,000+` handcrafted animations, GTA 5 NPCs forgetting dropped objects vs GTA 6 persistence, nearly `1,000` ambient activity sets, visible slung rifle tolerated vs gripped gun triggering retreat, witness-fed 6-star Heat / suspect profile icons tracking clothes, car, and partner, and NPCs escalating/fighting back) comes from verified 2026 Rockstar interviews and showcase reports, with zero speculative machine-learning claims.

## 3. Continuous 3D Shot, Boundary & Camera Spine (`16` Beats | `0` Hard Cuts)

- **Boundary Mix (`15` non-opening):** **`12` `Continuous [NO CUT]` (`80.0%`)**, **`2` `Transition` (`13.3%`)**, **`1` `Hidden Cut` (`6.7%`)**, **`0` `Hard Cut` (`0.0%`)**.
- **`shots.json` Row Mapping (`4` rows total):** `Shot 1` (`00:00.0`, beats `S01–S02c`), `Shot 2` (`00:11.0` `cardFlip`, beats `S03–S04c`), `Shot 3` (`00:23.0` `dissolve`, beats `S05–S06b`), `Shot 4` (`00:31.0` whip Hidden Cut, beats `S07–S08d`). Every `Continuous [NO CUT]` beat is a `cam.json` keyframe move inside its parent `shots.json` row, never an extra `shots.json` cut.
- **Cadence:** **`4.3` edit cuts/min** (`3 / 0.70 min`, inside Winner median `4.9`), **`21.4` camera beats/min** (`15 / 0.70 min`), **`2.2s` opening shot** (`>1.5s` Winner hold).

| ID | Time | Boundary | Scale / Angle | Camera Move, Staging & Craft Device |
| --- | --- | --- | --- | --- |
| S01 | `00:00.0–00:02.2` | `Opening` | `M / eye` | Damped push-in on sunny Minecraft sidewalk (`GTA 5` diegetic street sign); player pops oversized voxel shotgun from thin air while NPC beside them keeps staring blankly (`film-stage/highlight` red pulse on shotgun `0.8–1.4s`) |
| S02a | `00:02.2–00:05.0` | `Continuous [NO CUT]` | `MCU / eye` | Smooth orbit onto blank NPC face giving one slow deadpan blink (`film-kit/blinks`) without flinching at the gun; rack focus (`optics.focus`) from barrel to eyes |
| S02b | `00:05.0–00:08.0` | `Continuous [NO CUT]` | `W / high` | Crane up `35°` revealing 3 identical cloned sidewalk NPCs marching in robotic sync; floating 3D counter `55,000` (`film-stage/titles` `counted`) pops above street |
| S02c | `00:08.0–00:11.0` | `Continuous [NO CUT]` | `M / ground` | Boom down as NPC drops a coffee cup and walks right over it without turning back; red `X` callout pulses over cup on *"forgot dropped objects"* |
| S03 | `00:11.0–00:13.8` | `Transition (cardFlip)` | `W / high` | **3D `cardFlip` (`0.45s`)** flips blocky flat sidewalk into lush vibrant Leonida boulevard (`createEnvironment(renderer, { preset: "outdoor" })`, palm blocks, unique NPC skins & outfits, protagonist stepping in with visible carried rifle slung on back as *"ditches magic pockets"* lands, diegetic channel brand on corner cafe awning) |
| S04a | `00:13.8–00:16.8` | `Continuous [NO CUT]` | `M / eye` | Damped dolly gliding past 4 distinct ambient NPCs (beach towel chat, car stereo bobbing, dog walker, street vendor) while floating counter surges `55,000 -> 600,000+` (`counted("600,000+", p)`, `p: 0.0917 -> 1.0`) and `1,000 SETS` badge slides in |
| S04b | `00:16.8–00:19.6` | `Continuous [NO CUT]` | `MCU / eye` | Arc behind protagonist showing visible rifle slung diagonally on back (`film-stage/highlight` amber pulse `17.2–17.8s`); passing NPC glances (`film-kit/gaze`) and calmly keeps walking |
| S04c | `00:19.6–00:23.0` | `Continuous [NO CUT]` | `W / high` | Pull-back + rack focus as protagonist grips handgun in hand (`film-stage/highlight` red pulse `20.2–20.8s`); nearby NPCs trigger `film-kit/startle`, `hesitate`, and smoothly back away down the block |
| S05 | `00:23.0–00:26.0` | `Transition (dissolve)` | `M / eye` | **Graphic-matched `dissolve` (`0.4s`)** from fleeing witness raising phone into clean studio-lit cutaway (`renderer.localClippingEnabled = true`) showing a glowing cyan witness cone linking witness to protagonist |
| S06a | `00:26.0–00:28.5` | `Continuous [NO CUT]` | `INSERT / eye` | Tight push onto floating 3D holographic Heat / suspect profile card (`film-stage/openfilm`): highlights `SHIRT`, `CAR`, `PARTNER` icons with emissive cyan pulses synced to spoken nouns (`"clothes"`, `"car"`, `"partner"`) |
| S06b | `00:28.5–00:31.0` | `Continuous [NO CUT]` | `W / low` | Whip-tilt upward as `6` golden wanted stars lock in across the skyline while police cruisers roll around the corner |
| S07 | `00:31.0–00:33.5` | `Hidden Cut (whip door)` | `M / eye` | Smeared whip-pan (Shot 4 `shutter: { samples: 14 }`) across convenience store door pillar seamlessly enters shop interior; protagonist leans over counter (`film-kit/lean`) demanding cash |
| S08a | `00:33.5–00:37.0` | `Continuous [NO CUT]` | `MCU / low` | Smooth push-in on shopkeeper: brief `0.3s` `film-kit/freeze`, eyes narrow (`MOODS`), then slams hidden bat onto counter (`film-stage/highlight` red pulse + `timing.json` `0.25s` micro hit-stop!) |
| S08b | `00:37.0–00:39.5` | `Continuous [NO CUT]` | `W / high` | Crane pull-back through clipped store roof (`localClippingEnabled`) showing police car stuck in dense narrow traffic outside while angry shopkeeper + two street bystanders corner protagonist inside |
| S08c | `00:39.5–00:41.4` | `Continuous [NO CUT]` | `MCU / eye` | Fast damped 180° whip-orbit (same continuous Shot 4 `shutter: { samples: 14 }`, zero cut) onto protagonist backing into shelf as bat swings into foreground |
| S08d | `00:41.4–00:42.0` | `Continuous [NO CUT]` | `CU / eye` | Tight continuous push-in (`0.6s`) settling on protagonist's wide-eyed stunned blink immediately after final punchline lands—clean cut to end with zero dead outro card |

## 4. Minecraft 3D (`mc-films`) Implementation Mapping

- **Project Scaffolding:** `bun run new-film gta6-vs-gta5 --ratio 9:16` -> read generated `CAPABILITIES.md` and run `bun run skills get core`.
- **Lighting & Grade:** Pre-allocate both `createEnvironment(renderer, { preset: "outdoor" })` (for bright Leonida daylight `S01–S04` plus exterior/window daylight and warm store interior fill on `S07–S08`) and `createEnvironment(renderer, { preset: "studio" })` (paired with `createLightingRig` soft 3-point on the `S05–S06` Heat / suspect profile cutaway) once at scene init and swap `scene.environment` inside `draw(t)`; set `look.toneMapping: "neutral"` in `src/edit.json` (parsed by `film-stage/tone` `toneMappingMode`) so sunny blues and neon cyan/red highlight pulses stay vivid.
- **Actors & Crowd Variety:** `mc-actor/player` (`makePlayer` -> `player.holdProp`, `MOODS`) + `mc-actor/skin-paint` (`paint`, `jacket`, `torso`) to generate 8 unique street NPCs (zero cloned extras in GTA 6 vs intentionally cloned identical skins in GTA 5 `S02b` for visual contrast!). Drive continuous crowd life via `film-kit/{idle,blinks,gaze,startle,hesitate,freeze,lean,steps}`.
- **Emissive Pulses & Cutaways:** `film-stage/highlight` (`createHighlight(root)` + `pulseEnvelope`) on the 4 Three.js mesh props: shotgun (`0.8–1.4s`), slung rifle (`17.2–17.8s`), gripped handgun (`20.2–20.8s`), and counter bat (`35.2–35.8s`). Use `renderer.localClippingEnabled = true` with two `THREE.Plane` slices: a vertical exterior wall-slice `THREE.Plane` on the `S05` studio witness cutaway and a horizontal `new THREE.Plane(new THREE.Vector3(0, -1, 0), roofY)` on the `S08b` store roof so the crane pulls cleanly through the ceiling.
- **Graphics, Blur & Transitions:** `film-stage/titles` (`makeTitles`, `counted("600,000+", p)` ramping `p` from `0.0917 -> 1.0`, `FONTS` Inter/Geist) for the `55,000 -> 600,000+` counter, `1,000 SETS` badge, `S02c` red `X` callout, and `6 STARS`; `mc-assets/ink` / `CanvasTexture` for the `GTA 5` street sign (`S01`) and corner cafe awning channel brand (`S03`); `src/timeline/openfilm.json` for the `S06a` Heat / suspect profile glass card, animating its synced cyan `SHIRT` / `CAR` / `PARTNER` badge pulses (`26.2–28.2s`, anchored to `"clothes"`, `"car"`, `"partner"` in `voice:cues`) inside `window.film.frame(t)` (reusing `pulseEnvelope` easing math); set one unified `shutter: { samples: 14 }` and `cameraClock: "output"` on Shot 4 (`S07–S08d`, `00:31.0–00:42.0`) in `shots.json` so both `S07` and `S08c` whips plus `S08a`'s `0.25s` `timing.json` hit-stop run cleanly inside one unbroken shot row (pass `--samples 8` for blurred draft stills); use `optics.focus` for rack focuses and `TRANSITIONS` `cardFlip` (`S03`) / `dissolve` (`S05`).
- **Audio Scoring (`audio-voice-and-pacing.md`):** `shifting_bgm_plus_vo` — dry playful pluck groove (`0–11s` GTA 5) -> warm rhythmic synth pulse (`11–31s` GTA 6) -> tense bass pulse (`31–42s` shopkeeper reversal). Zero pre-impact dead silence; crisp foley (`bun run sfx:get` + `earshot`) on shotgun pop, card flip paper snap, footsteps, police chime, and bat slam.

## 5. Self-Audit Against All 12 Zack D. Films QA Gates

| Gate | Blueprint Value | Required Target | Status |
| --- | --- | --- | --- |
| 1. Title Packaging | `Why GTA 6 NPCs Won't Run 😱` (`6` words + `😱`) | `<=7` words + `1` trailing emoji | **PASS** |
| 2. Opening Line | `"If you pull a shotgun..."` (zero cliché) | In-action / hypothetical, zero clichés | **PASS** |
| 3. Spoken WPM | **`154.3 WPM`** (`108` words / `42.0s`; `156.5` over `41.4s` heard) | `148–162 WPM` (`<170` ceiling) | **PASS** |
| 4. Runtime Band | **`42.0s`** | `35–44s` or `55s+` (`55–73s` typical target) | **PASS** |
| 5. Connector | `but_therefore` throughout | `but_therefore` or `causal_chain` | **PASS** |
| 6. Beat Budget & Twist | Twist at **`73.8%`**, `ironic_twist_punchline`, `0` loop gimmick | `68%–85%` twist window | **PASS** |
| 7. Opening Shot Hold | **`2.2s`** | `1.5s–3.0s` (`~2.0s` ideal) | **PASS** |
| 8. Continuous Camera Ratio | **`80.0%`** Continuous, **`4.3`** cuts/min, **`0`** Hard Cuts, **`21.4`** beats/min | `>=65%` Cont, `<=5.5` cuts/min, `<=2` Hard Cuts | **PASS** |
| 9. Craft Stack | Shot 4 `shutter.samples: 14` (`--samples 8` blurred drafts), DOF racks, `4` 3D emissive prop pulses + `1` synced OpenFilm HUD pulse, `7` diegetic/HUD graphic elements (`GTA 5` street sign, `55,000 -> 600,000+` counter, red `X` callout, cafe awning brand, `1,000 SETS` badge, `S06a` Heat card, `6 STARS`), `2` cutaways (`S05` + `S08b`), `1` hit-stop | Full mandatory craft stack | **PASS** |
| 10. Clean Transitions & Easing | `cardFlip` + `dissolve` + whip Hidden Cut; `smooth_damped` | Zero `flash_white` / `snappy_overshoot` | **PASS** |
| 11. Asset & Spatial Integrity | Unique NPC skins, `0.6s` outro settle, verified Rockstar stats | Zero clones / dead outro / drift | **PASS** |
| 12. Audio Cadence & Mix | `shifting_bgm_plus_vo`, zero dead silence, `voice:cues` + `earshot` QA | Matches `audio-voice-and-pacing.md` | **PASS** |
