# The film contract: what the studio needs from a film

The studio, `bun run check` and every render read a film through this contract. `templates/film/src/scene.ts` keeps every part of it working: copy from there, not from another film (`sealed-room` is a test film; never copy its scene or `timing.json` into a new one).

## What a film must have

| Part                           | Rule                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/scene.ts` exports         | `SHOTS`, `SHOTS_OUT` (the shots as heard), `DURATION`, `applyEdit`, and `buildScene(canvas, W, H, draft)` returning `draw(t)`                                                                                                        |
| `draw(t)`                      | Draws any `t` on its own, never from the frame before: renders split the film into chunks and jump straight to any second                                                                                                            |
| `src/edit.ts` and data         | `setEdit` merges `src/edit.json` (narration takes and script, `voice.warp`, beats) with the files in `src/timeline/` (cam, shots, keys, text, adjust, audio, timing)                                                                 |
| `package.json` `"live-studio"` | Names each timeline file (`soundTimeline`, `camTimeline`, `shotsTimeline`, `textTimeline`, `adjustmentTimeline`, `timingTimeline`, `keyFiles`), the `sound` folders and `ratio`. `bun run help` in a film prints this film's own map |
| Open schemas                   | Every schema is a `looseObject`: a film's own fields are kept. Transitions, text voices, callout shapes, eases and velocity effects are named by strings, so a film may add its own                                                  |

## Which clock each file uses

| Clock                                | Files                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Narration seconds                    | `t` in `shots.json`, beats in `src/edit.json`; `fromSource` turns them into scene seconds through `voice.warp` |
| Scene seconds (before Speed, Freeze) | `cam.json`, key files, `audio.json`, `text.json`, `adjust.json`                                                |

To slow, speed or hold a stretch, change `timing.json` (Speed, Freeze); never shift every key by hand. `bun run at <heard second>` converts between the clocks.

## Optional hooks on draw

Each hook turns on one part of the studio. The template sets all of these:

| Hook                                                   | Turns on                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `draw.describe(t)`                                     | The list over a draft frame (`LIST=1`): what plays at `t` and which file holds it |
| `draw.tools.titles`, `textTimeline`                    | On-screen text and its voices                                                     |
| `draw.tools.camera`, `free`, `objects`, `bones`, `rig` | The free camera and the targets `CHECK=motion/seen/touch` can name                |
| `draw.tools.placed` with a placed key file             | The Objects panel: placing props                                                  |
| `draw.tools.targets[].transform`                       | Moving a character or prop in the viewport, written back to its keyed rows        |
| `draw.tools.renderer`, `composer`                      | The final render's motion blur (sub-frames in the film's own GL)                  |
| `draw.eases`, `draw.keyEases`                          | Ease names on camera and key rows                                                 |
| `draw.anims`, film-stage transitions                   | The Animation tab and the shots' `transition` and `anim`                          |
| `draw.adjustments.prepare`, `adjustmentTimeline`       | Colour and look layers                                                            |
| `draw.velocity = true`, `draw.velocityEffects`         | Speed-ramp effects on `timing.json` velocity                                      |
| `draw.checks`                                          | The film's own `CHECK=<name>:...` lines (`bun run render --help`)                 |

A film without a hook still plays; the studio says what is missing and which hook adds it.

## Your own work, past the built-ins

The built-ins are a starting kit, not the limit: anything Three.js can draw belongs in `src/scene.ts`. These are the doors the tools see it through:

| You make                     | Where it goes                                                                                                                                                                                                                   | How you see it                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| An object, effect or rig     | Built in `buildScene`, moved in `draw(t)` from `t` alone                                                                                                                                                                        | `AT=12 bun run render stills`                                                     |
| A name the checks can target | `[mesh, "Name"]` in `draw.tools.objects` (or set the object's `.name`)                                                                                                                                                          | `CHECK=motion:Name,12,14 bun run render stills`; also `seen`, `touch`             |
| A line in the draft's list   | A row from `draw.describe(t)`: `LIST=1` shows only what it returns                                                                                                                                                              | `AT=12 LIST=1 bun run render stills`                                              |
| A transition                 | `{ id, title, tip, category, glsl }`, the GLSL defining `vec4 transition(vec2 uv)` from `getFromColor`, `getToColor` and `progress`; the list goes as `makeTransitions`' last argument                                          | Its id in a shot's `transition.fx`; a render warns of an id the film lacks        |
| A shot anim                  | `{ id, title, cat, tip, len, apply(cam, u, t, k) }` added to the `anims` the scene passes to `animate` (`in`, `out` or `combo`); `apply` moves `cam.p`, `cam.l`, `cam.fov` at progress `u` and returns how black the frame goes | Its id in a shot's `anim`; `bun run check` names a near miss of a built-in        |
| A check of its own           | `draw.checks.name = (...args) => lines, or { still, canvas }`                                                                                                                                                                   | `CHECK=name:a,b bun run render stills`                                            |
| A close look from set spots  | A page in `lab/` importing `live-studio/lab` (copy `templates/film/lab/showcase.ts`)                                                                                                                                            | `ENTRY=lab/x.ts bun run render stills`; `LAB_VIEW=v` reaches it as `cfg.lab.view` |

`src/scene.ts` is plain JS under `// @ts-nocheck`, and `bun run check` reads only the JSON: a mistake in the code shows as an `ERROR` when a render builds the scene, so look at a still after every code change.

## Sound the studio finds

| Where                                | What                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `vault/sound/bgm`, `vault/sound/sfx` | The vault's music and sounds, each with `SOURCES.json`                                                                   |
| `sound/sfx` in the film              | The film's own, fetched by `bun run sfx:get`                                                                             |
| `vault/mc-sound/mc/<category>`       | Minecraft `.ogg`; takes of one sound share a family with numbered variants. Music with a contentId is claimed by YouTube |

`audio.json` names a sound only by name; `bun run find <words>` gives the names, `bun run check` catches a wrong one.

## Rules

| Rule                                                                                 | Why                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Never edit `notes/notes.jsonl` by hand                                               | The creator's notes and their states go only through `bun run note` |
| Never draw a fake waveform for a missing WAV or a silence                            | The creator would trust a sound that is not there                   |
| Dragging or copying a whole shot, and colour keyframes, are unfinished in the studio | Do them in the JSON, then `bun run check`                           |
