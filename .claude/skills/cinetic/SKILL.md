---
name: cinetic
description: Direct, build and render premium 3D motion films from code — Three.js cinema, Minecraft 3D films, launch films, feature shorts, looping 3D animations, logo stings, teasers and promo clips. Use whenever the user wants a 3D video, camera choreography, optical transitions, typography motion, audio scoring, colour grading, or film forensics — supplying Cinetic's 11-point cinematic standard, role-based eases, log-zoom camera physics, optical seams, rotating text voices, licensed music + recorded SFX mastering (-14 LUFS / -1.5 dBTP), TPDF anti-banding dither, and pixel-level QA gates.
license: MIT
compatibility: Works natively with Three.js + packages/film-stage + packages/live-studio (Bun 1.4+) and includes standalone Node/Python 3.11+ tools (numpy, scipy, soundfile, pyloudnorm, opencv-python, librosa, fonttools, pillow) plus earshot for audio verification.
---

# cinetic (3D Edition)

You are directing a 3D short film, not animating a flat web page. Camera, world lighting, optical seams, words and sound
are one system driven by a shared timeline; nothing is finished until rendered, measured and reviewed against the
standard below.

- **Engines.** Pure 3D cinema math, camera optics, lighting, shaders, audio mastering and forensics extracted for
  Three.js + Live Studio films ([three.md](references/three.md)).
- **Monorepo runtime.** `packages/film-stage` implements Cinetic's role-based `EASES`, 3D shot `ANIMS`, WebGL
  `TRANSITIONS`, typography `TEXT_IN`/`TEXT_OUT`/`SHAPE_IN`/`SHAPE_OUT` voices, directional shutter smear + velocity
  beat accents, and CAT16/LUT/Halation/TPDF-dither grading; `packages/live-studio` previews and edits timelines live
  without caging custom 3D code.
- **Paths.** Skill scripts work from `.claude/skills/cinetic`; each prints `--help`.
- **Brand.** A supplied brand or art direction wins over house defaults ([brand-and-color.md](references/brand-and-color.md));
  record intentional overrides in `BRIEF.md`.
- **Python.** Commands say `python3` with `scripts/requirements.txt`.

## The standard

Every film is held to these rules and numbers; the gates in brackets measure them.

1. **Words in the middle.** A statement is centred and sits in the middle band of the frame (its centre at 35-65 % of
   the height): centred for 80 % of the statement time or more, in the middle band for 85 % or more. Centred top or
   bottom only over a full-bleed 3D shot. Never flush left at the top or the bottom.
2. **One element carried, the text mixed in.** Every scene change hands one subject, vector or optical event on (it
   grows, orbits, dives, converges or carries momentum): never a dead cut between unrelated static shots, never an empty
   frame between scenes. (`grid-check.ts --part spine`, `forensics.py --spine`, `empty-frame`.)
3. **The picture tells the story.** Each 3D shot proves its beat visually without repeating the words on screen. With
   the words covered, every shot beat still reads: physical action in the 3D world, clear staging, readable silhouettes.
4. **Less text, every word chosen.** 1-5 words a line typically, 2-7 at most, one claim, plain words; 0.3-1.5 headline
   words a second; no text in 15 % of the frames or more; at most two text blocks on screen at once; no floating clutter
   beside a hero statement.
5. **Text with love: one face, voices that rotate, events.** Lines arrive in the film's one primary face, the voice
   turning line by line (`wordRise`, `clipRise`, `oversize`, `inkIn`, `hueSweepIn`, `scramble`, `easedType`, `popIn` —
   never every line identical, [technique-library.md](references/technique-library.md)), big (6.5-9.2 % cap height for
   standalone lines), whole or in 2-3 chunks. Emphasis is quiet: accent tint or annotation mark on at most two lines.
   Every line reads at 3:1 or higher against its backdrop (`forensics.py` legibility).
6. **Scene changes that flow.** Every hard cut hides itself: inside a defocus pulse, an anchor held within 10 px, an
   optical seam (`TRANSITIONS`), or a whip carrying velocity (`seam: true` paired `ANIMS`) with shutter smear; never an
   accidental slow cross-dissolve across unrelated shots; at most 10 % of hard cuts bare (`forensics.py --seams`,
   `carried-cut`, `ghost-cut`). Two or three seam kinds per film, none over 40 % of scene changes
   ([transitions.md](references/transitions.md)).
7. **Extruded 3D marks & clean geometry.** Brand marks and hero 3D geometry use clean bevelled extrusion (`trace-logo.py`,
   `outline-text.py`, `fx/three/geo.ts`, `logos.mjs`). The end card lands centred and keeps micro-creeping (`creepIn`)
   while the music rings out (`forensics.py` `end-drift`, `end-centre`, `audio-end`).
8. **Its own film, never a repetitive template.** Draw fresh camera moves, seams, world lighting and text voices per
   film with `python3 scripts/pick.py` ([technique-library.md](references/technique-library.md),
   [devices/INDEX.md](references/devices/INDEX.md)).
9. **Premium 3D habits in every shot.** One sharp focal plane and graded depth falloff; one motivated camera move per
   shot, front-loaded and landing (else locked: never aimless float or back-and-forth wander); motivated key + rim +
   fill lighting in one coherent world palette ([lighting.md](references/lighting.md), [three.md](references/three.md));
   scale contrast across cuts (wide to macro); directional shutter smear only on fast velocity peaks; transitions made
   of focus, light and geometry.
10. **Sound and picture locked to 1 frame.** Licensed music analysed for beat/bar grid (`scripts/music.mjs`,
    `scripts/audio/track.py`) plus real recorded Foley/SFX (`scripts/audio/sfx.mjs`, `plan.py`, `score.py`) mastered to
    -14 LUFS (-16 for a sting) and -1.5 dBTP, verified by `check-sync.py`, `av-audit.py` and `earshot` (`listen.py`).
11. **Film-grade finishing.** BT.709 tags, triangular TPDF dither (`grade.ts` / `dither-gradient.py`) so dark gradients
    never band at 8-bit, halation on specular highlights where motivated, and 0 pixel forensics failures
    ([finishing.md](references/finishing.md)).

## Hard bans

Unless explicitly requested by the user's brief or brand:

- **Words:** placeholder strings, vague hype words (unleash, reimagine, seamless, elevate, unlock, magic), keyword
  piles, two competing statements readable at once.
- **Type:** unmotivated serif/italic mixes; springy bounce/overshoot on typography; scaling text up from 0 (use
  `oversize` 1.38x settle or `clipRise` instead).
- **Colour:** unmotivated neon/rainbow washes, muddy midpoints, un-dithered 8-bit sky/backdrop gradients.
- **Camera:** linear mechanical pans without ease roles, aimless sinusoidal camera bobbing (`camera-wander`), cutting
  mid-brake without carrying velocity across the seam.
- **Sound:** silent renders where sound belongs, ducking music pump-style under every small SFX, clipping above -1 dBTP,
  or unverified copyrighted tracks.

## The workflow (3D + Live Studio)

1. **Scaffold or open the film.** Create a new film from `templates/film` (`bun run new-film <name>`) or open an
   existing film in `packages/live-studio`. Draw fresh devices with:
   ```bash
   python3 .claude/skills/cinetic/scripts/pick.py --format launch --seconds 25
   ```
2. **Music & beat grid first.** Pick or analyse the track (`node scripts/music.mjs`, `python3 scripts/audio/track.py
analyze`) so shots, velocity ramps and title beats land on real musical bars and hits ([music.md](references/music.md),
   [timing-grid.md](references/timing-grid.md)).
3. **3D world, lighting, camera & seams.** Build the 3D scene (`scene.ts`) with motivated key/rim/ambient lighting
   ([three.md](references/three.md), [lighting.md](references/lighting.md)), author camera keyframes on Cinetic role
   curves (`glideOut` to arrive, `stdInOut` to reposition, `buildIn` / `whipBuild` to leave into a cut), pair velocity
   seams in `shots.json` (`ANIMS` + `seam`), blend optical cuts in `transitions.ts`, and rotate title voices in
   `titles.ts` ([camera.md](references/camera.md), [transitions.md](references/transitions.md)).
4. **Soundtrack & Foley.** Place recorded SFX from the vault or `scripts/audio/sfx.mjs`, build and master the mix via
   `plan.py` / `score.py` ([sound.md](references/sound.md)), and listen with `earshot` (`scripts/audio/listen.py`).
5. **Render, measure & review.** Render preview/master MP4, build contact sheets (`python3 scripts/sheet.py`), run pixel
   and audio gates (`forensics.py`, `probe.py`, `check-sync.py`, `av-audit.py`, `look-audit.py`), and run the one-round
   director critique ([director.md](assets/critics/director.md), [review-loop.md](references/review-loop.md)).

## Craft essentials

- **Motion — never mechanical linear:** choose curves by role (`EASES` in `packages/film-stage/src/camera.ts` and
  `lib/anim.ts`: `glideOut` / `snapOut` / `xpArrive` to arrive, `stdInOut` / `strongInOut` to reposition,
  `buildIn` / `whipBuild` / `launchIn` to leave). Zooms run in log-FOV space; speed carries across velocity cuts
  ([motion-tokens.md](references/motion-tokens.md), [camera.md](references/camera.md)).
- **Determinism:** every frame in `scene.ts` and `film-stage` is a pure function of time `t` (seeded RNG only, never
  `Math.random()` or wall-clock timers) so scrubbing in Live Studio and frame-by-frame WebCodecs/headless rendering match
  identically ([chromium-rendering.md](references/chromium-rendering.md)).
- **Finishing:** TPDF dither in the final grade pass eliminates 8-bit banding; directional shutter smear fires only on
  high-velocity whip/dive peaks; BT.709 colour metadata verified via `probe.py` ([finishing.md](references/finishing.md)).

## Reference map

| When                                                                   | File                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Picking techniques, moves, seams, worlds (496 3D/cinema entries)       | [technique-library.md](references/technique-library.md), [devices/INDEX.md](references/devices/INDEX.md)                        |
| Concept, act structure, spine handovers                                | [concept-and-story.md](references/concept-and-story.md), [spine.md](references/spine.md)                                        |
| Colour, ground families, marks and lockups                             | [brand-and-color.md](references/brand-and-color.md)                                                                             |
| Matching a reference clip's grammar without copying                    | [clip-match.md](references/clip-match.md)                                                                                       |
| Music analysis, bar-line edits, cutting to beats                       | [music.md](references/music.md), [timing-grid.md](references/timing-grid.md)                                                    |
| Easing curves, springs, camera physics, optical seams                  | [motion-tokens.md](references/motion-tokens.md), [camera.md](references/camera.md), [transitions.md](references/transitions.md) |
| 3D hero objects, extruded SVG logos, glass, lighting                   | [three.md](references/three.md), [lighting.md](references/lighting.md)                                                          |
| Recipes with exact numbers (effects, animations, seams, camera, sound) | [motion-library/](references/motion-library/README.md)                                                                          |
| SFX kit, cues, placement, LUFS/dBTP mastering                          | [sound.md](references/sound.md)                                                                                                 |
| Render flags, shutter blur, TPDF dither, encoding                      | [finishing.md](references/finishing.md), [chromium-rendering.md](references/chromium-rendering.md)                              |
| Gate scripts, thresholds, review loop & critic lenses                  | [checks.md](references/checks.md), [review-loop.md](references/review-loop.md), [assets/critics/](assets/critics/)              |
| Avoiding cheap AI-video tells & 20 craft rules                         | [taste-and-slop.md](references/taste-and-slop.md), [craft-rules.md](references/craft-rules.md)                                  |

## Shipped CLI tools (`.claude/skills/cinetic/scripts/`)

| Need                                                                 | Tool                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draw techniques & regenerate library docs                            | `scripts/pick.py` (`--validate`, `--format`, `--category`, `--family`, `--show`)                                                                  |
| Spec, A/V sync lag, pixel forensics & look floors                    | `scripts/probe.py`, `scripts/check-sync.py`, `scripts/forensics.py`, `scripts/look-audit.py`                                                      |
| Contact sheets, exact frame grabs, 2x detail diff, clip grammar      | `scripts/sheet.py`, `scripts/grab.sh`, `scripts/detail-pair.py`, `scripts/like.py`                                                                |
| 16-bit shutter accumulation & optical-flow speed ceiling             | `scripts/accumulate.py`, `scripts/measure-speed.py`                                                                                               |
| Timeline beat/spine check, cue export, grammar score                 | `scripts/grid-check.ts`, `scripts/export-cues.ts`, `scripts/grammar-score.mjs`                                                                    |
| Music shortlist, track beat/bar edit, SFX kit, mix, earshot, credits | `scripts/music.mjs`, `scripts/sound.mjs`, `scripts/audio/{sfx.mjs,track.py,kit.py,plan.py,score.py,listen.py,master.py,credits.py}`               |
| TPDF dithered plates, OKLCH palettes, SVG/font 3D vector outlines    | `scripts/dither-gradient.py`, `scripts/palette.py`, `scripts/trace-logo.py`, `scripts/outline-text.py`, `scripts/logos.mjs`, `scripts/assets.mjs` |
