# The film contract: what the studio needs from a film

The studio, `bun run check` and every render read a film through this contract. `templates/film/src/scene.ts` keeps every part of it working: copy from there, not from another film (`sealed-room` is a test film; never copy its scene or `timing.json` into a new one).

## What a film must have

| Part                           | Rule                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/scene.ts` exports         | `SHOTS`, `SHOTS_OUT` (the shots as heard), `DURATION`, and `buildScene(canvas, W, H, draft)` returning `draw(t)`. `applyEdit` is required unless the `timingTimeline` wrapper supplies it |
| `draw(t)`                      | Draws any `t` on its own, never from the frame before: renders split the film into chunks and jump straight to any second                                                                                                            |
| `src/edit.ts` and data         | `setEdit` merges `src/edit.json` (narration takes and script, `voice.warp`, beats) with the files in `src/timeline/` (cam, shots, keys, text, adjust, audio, timing)                                                                 |
| `package.json` `"live-studio"` | Names each timeline file (`soundTimeline`, `camTimeline`, `shotsTimeline`, `textTimeline`, `adjustmentTimeline`, `timingTimeline`, `keyFiles`), the `sound` folders and `ratio`. `bun run help` in a film prints this film's own map |
| Open schemas                   | Every schema is a `looseObject`: a film's own fields are kept. Transitions, text voices, callout shapes, eases and velocity effects are named by strings, so a film may add its own                                                  |

## Which clock each file uses

| Clock                                | Files                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Narration seconds                    | `t` in `shots.json`, beats in `src/edit.json`; `fromSource` turns them into scene seconds through `voice.warp` |
| Scene seconds (before Speed, Freeze) | `cam.json`, key files, `audio.json`, `text.json`, `adjust.json`                                                |

Word and mouth timestamps index native audio samples; narration clips place them on the scene clock, then Speed/Freeze produces heard seconds. voice.warp moves narrative anchors, never stretches sample timings.

To slow, speed or hold a stretch, change `timing.json` (Speed, Freeze); never shift every key by hand. `bun run at <heard second>` converts between the clocks.

## Optional hooks on draw

Each hook turns on one part of the studio. The template sets all of these:

| Hook                                                             | Turns on                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `draw.describe(t)`                                               | The list over a draft frame (`LIST=1`): what plays at `t` and which file holds it                                                      |
| `draw.tools.titles`, `textTimeline`                              | On-screen text and its voices                                                                                                          |
| `draw.tools.camera`, `free`, `objects`, `bones`, `rig`, `optics` | The free camera, targets `CHECK=motion/seen/touch` can name, and live camera/DOF/look telemetry (`OpticsTelemetry`) for the studio HUD |
| `draw.tools.placed` with a placed key file                       | The Objects panel: placing props                                                                                                       |
| `draw.tools.targets[].transform`                                 | Moving a character or prop in the viewport, written back to its keyed rows                                                             |
| `draw.tools.renderer`, `composer`                                | The final render's motion blur (sub-frames in the film's own GL)                                                                       |
| Lưu camera | cameraSample trả góc trước hiệu ứng. moveCameraAnchor đổi offset của neo khi lưu góc mới. |
| `draw.eases`, `draw.keyEases`                                    | Ease names on camera and key rows                                                                                                      |
| `draw.anims`, film-stage transitions                             | The Animation tab and the shots' `transition` and `anim`                                                                               |
| `draw.adjustments.prepare`, `adjustmentTimeline`                 | Colour and look layers                                                                                                                 |
| `draw.velocity = true`, `draw.velocityEffects`                   | Speed-ramp effects on `timing.json` velocity                                                                                           |
| `draw.checks`                                                    | The film's own `CHECK=<name>:...` lines (`bun run render --help`)                                                                      |

A film without a hook still plays; the studio says what is missing and which hook adds it.

## Your own work, past the built-ins

The built-ins are a starting kit, not the limit: anything Three.js can draw belongs in `src/scene.ts`. These are the doors the tools see it through:

| You make                     | Where it goes                                                                                                                                                                                                                                                                    | How you see it                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| An object, effect or rig     | Built in `buildScene`, moved in `draw(t)` from `t` alone                                                                                                                                                                                                                         | `AT=12 bun run render stills`                                                     |
| A name the checks can target | `[mesh, "Name"]` in `draw.tools.objects` (or set `.name`); dot-paths like `Steve.head` or `desk.handle` descend cleanly                                                                                                                                                          | `CHECK=motion:Name,12,14 bun run render stills`; also `seen`, `touch`             |
| A line in the draft's list   | A row from `draw.describe(t)`: `LIST=1` shows only what it returns                                                                                                                                                                                                               | `AT=12 LIST=1 bun run render stills`                                              |
| A transition                 | `{ id, title, tip, category, glsl }`, the GLSL defining `vec4 transition(vec2 uv)` from `getFromColor`, `getToColor` and `progress`; the list goes as `makeTransitions`' last argument                                                                                           | Its id in a shot's `transition.fx`; a render warns of an id the film lacks        |
| A shot anim                  | `{ id, title, cat, tip, len, apply(cam, u, t, k) }` added to the `anims` the scene passes to `animate` (`in`, `out` or `combo`); `apply` moves `cam.p`, `cam.l`, `cam.fov` at progress `u` and returns how black the frame goes                                                  | Its id in a shot's `anim`; `bun run check` names a near miss of a built-in        |
| A font                       | `{ id, title, css }` in `fonts` of `makeTitles`' 4th argument, its face loaded in `src/scene.ts` (`@font-face` or `FontFace`; `draw.ready` waits on it)                                                                                                                          | `text.json` items[].font; the Text panel lists it                                 |
| A check of its own           | `draw.checks.name = (...args) => lines, or { still, canvas }`                                                                                                                                                                                                                    | `CHECK=name:a,b bun run render stills`                                            |
| A close look from set spots  | A page in `lab/` importing `live-studio/lab` (copy `templates/film/lab/showcase.ts`)                                                                                                                                                                                             | `ENTRY=lab/x.ts bun run render stills`; `LAB_VIEW=v` reaches it as `cfg.lab.view` |
| A kind of your own           | A list of `{ id, title, tip, ...anything }` on `draw` or `draw.tools` under a name of yours (`draw.weather = [{ id: "rain", ... }]`)                                                                                                                                             | The studio's Film tab lists it as its own kind, named after the key               |
| A field of your own on a row | Any key the studio doesn't read on a shot (beside `anim`, `transition`, `hits`, `adjust`), a camera key (beside `mm`, `fov`, `fstop`, `focus`, `handheld`), a text row, sound row, or adjustment (beside `grade.look`); typos 1 letter off built-in keys warn in `bun run check` | Film tab, Custom fields: each name with its values and the seconds it is set at   |
| Rigid-body physics (Rapier)  | Pre-bake offline in Bun with `@dimforge/rapier3d-compat` to `src/timeline/*.json`; sample in `draw(t)`                                                                                                                                                                           | Deterministic scrub & render via `draw(t)`                                        |
| AO & post-processing         | Wired in `src/scene.ts` via `n8ao` (`N8AOPostPass`) and `postprocessing` (`EffectComposer`, AgX)                                                                                                                                                                                 | Every scrub and render passes through the composer chain                          |
| Volumetric godrays           | Pre-installed `three-good-godrays` (`GodraysPass`); `PointLight`/`DirectionalLight` only (not `SpotLight`), before `ToneMappingEffect`                                                                                                                                           | Shadow-mapped light shafts in `EffectComposer`                                    |

The creator sees all of the above in the studio's Film tab, view only, under CapCut's kinds (Audio, Text, Stickers, Effects, Transitions, Animation), then 3D, Custom fields, A/B choices, Checks, your own kinds and Other. A `title` and a one-line `tip` on each is what they read there; nothing you hand over is refused or dropped.

`src/scene.ts` is plain JS under `// @ts-nocheck`, and `bun run check` reads only the JSON: a mistake in the code shows as an `ERROR` when a render builds the scene, so look at a still after every code change.

## Sound the studio finds

| Where                                | What                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `vault/sound/bgm`, `vault/sound/sfx` | The vault's music and sounds, each with `SOURCES.json`                                                                   |
| `sound/sfx` in the film              | The film's own, fetched by `bun run sfx:get`                                                                             |
| `vault/mc-sound/mc/<category>`       | Minecraft `.ogg`; takes of one sound share a family with numbered variants. Music with a contentId is claimed by YouTube |

`audio.json` names a sound only by name; `bun run find <words>` gives the names, `bun run check` catches a wrong one.

## Rules

| Rule                                                                                                                                      | Why                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Never edit `notes/notes.jsonl` by hand                                                                                                    | The creator's notes and their states go only through `bun run note`                                   |
| Never draw a fake waveform for a missing WAV or a silence                                                                                 | The creator would trust a sound that is not there                                                     |
| Dragging or copying a whole shot, and colour keyframes, are unfinished in the studio                                                      | Do them in the JSON, then `bun run check`                                                             |
| Blocks and textures from `prepareAssets([...], { cache: true })`, made once; a file of the jar by `readFile(path, assets)`                | A raw zip handed to `createScene` unpacks the 5 MB jar again on every call                            |
| Mocap through one `loadClips(refs, steve)` in `buildScene`                                                                                | It keeps each bake between loads; `loadClip` bakes every time                                         |
| A loop over many poses that reads only his bones: `steve.updateBones()` and `steve.soleNow()`, then one `g.updateMatrixWorld(true)` after | A full update or `getWorldPosition` per pose walks his whole tree; this was seconds of a phone's load |
| A change to how the film loads: `bun run eval:load` at the repo root, before and after                                                    | Desk and phone, first visit and reload; phone runs swing ~30%, so repeat one                          |

## Effects library and custom pages

`bun run find` discovers and inspects the shared catalogue; `bun run asset --help` places and edits assets with JSON output and heard seconds. Audio uses `audio.json`, transitions use `shots.json`, grades use `adjust.json`, native text/shapes use `text.json`, and HTML/CSS/canvas layers use `openfilm.json` with undo, trim/drag and Linkage in the studio.

| Task | Command and result |
| --- | --- |
| Discover | `bun run find --kind transition` includes native and imported transitions; use words to search, or filter, text, sticker, effect, template or sound as kinds. Code helpers, camera and mocap remain in the same catalogue |
| Select source or group | `--source builtin` selects native presets; `--source openfilm` selects that provider, including audio. Bare `--source` or `--group` lists values; `--group fade` narrows one visual group |
| Read controls | `bun run find --show <id>` includes the placement ID, full recipe, selectors/vars, defaults, units and exampleProps. Use the full ID and `--source` if a short alias is ambiguous |
| Continue a page | Follow the next-page command with the same filters and `--offset N`; `-n N` sets page size, up to 200. Pagination applies to offline lists and word searches |
| Place | `bun run asset use <id> --film films/<name> --from 2 --to 5 --props-file controls.json`; cut placement also needs `--shot N`. Native text needs a text string; HTML text uses a selector map, as show/help describe |
| Read or revise | `asset timeline --lane <lane>` returns heard times and targets; pass the returned target to `asset edit` with a props file, or `asset remove`. Lanes are effects, text, adjustment, transitions and audio; effects is the default |
| Keep identity | New items have UUID targets; older native rows without IDs use their current row index. Read timeline again after reordering those rows; removing a transition preserves its shot |
| Duration in code | If a film has no edit.end, pass `--duration <scene seconds>` from its exported DURATION for retiming or cuts. Use the same value for placement, timeline, edit and remove; unknown retiming clocks are rejected before writing |
| Templates | `asset plan <id>` previews camera slots, overlays and music without writes; `asset use` places overlays/music. Camera slots guide custom 3D staging; they do not replace the scene |
| Verify | `asset validate` checks configured lane shapes and overlay IDs; use `bun run check` for film checks, then view a still or clip. Data validation does not prove the rendered look or sound |
| Linked audio holds | A heard interval may have no source-time equivalent inside Freeze or a removed/reordered span; asset rejects an inexact audio edit before writing. Use an independent audio/SFX history in timing.json or a custom output-time mix for that cue |

Creative controls stay editable JSON; native text/shapes retain custom fields, while HTML text uses selectors and CSS vars exposed by the source page. Build custom Three.js code or pages whenever useful; the catalogue and Studio are starting tools, not creative constraints.

`find --show` returns exampleProps and units: x/y are 0-1, native text/shape size is pixels at a 1080px short side, and HTML overlay size is a scale. Put the example in a UTF-8 JSON file and pass `--props-file`; this avoids PowerShell quote escaping and accepts a BOM.

`asset list/info` are compatibility aliases to find's text output; action commands keep JSON output and share find's catalogue. `bun run openfilm` selects the OpenFilm source; `fetch:openfilm` imports it, and runtime file/config names remain compatible with existing films.

The studio groups pickers by use under Audio, Text, Transitions, Adjustment and Effects; OpenFilm is a source filter. Source, fonts, WAVs and licenses stay in the vault; `pack:sound` preserves their structure for another machine.

`film-stage/openfilm-page` exports `loadOpenFilmPage(url, width, height, props, { timeoutMs })` for same-origin HTML/CSS/canvas/WebGL; `await page.seek(t)` returns a canvas and `page.dispose()` removes the iframe. The page exposes `window.film.frame(t)` and optional `ready` as a promise or function; the host awaits both, serializes seeks, reports the URL/phase/time, and times out each phase after 15 seconds by default.

WebGL needs `preserveDrawingBuffer: true` for capture, and resources must allow reading/capture. Custom `draw.renderFrame(t)` is preserved and awaited during rendering; the host's real clock stays untouched.

The async hook receives the same scene seconds and layer clocks after Speed/Freeze as `draw`. `resetCanvasState` is only for library compatibility: it tracks contexts the page creates, resets only 2D canvases still in the DOM, and leaves untouched canvases, offscreen sprite caches and WebGL alone.
