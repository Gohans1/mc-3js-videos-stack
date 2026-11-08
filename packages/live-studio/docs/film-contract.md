# The film contract

What the studio reads from a film: the schemas in [`src/contract.mjs`](../src/contract.mjs) are the truth, [`demo/`](../demo) is a working film, and the studio checks every film on start and save (terminal + **PHIM SAI QUY ƯỚC** on the picture).

## Rules

- One studio linked into every film (`node live-studio/init.mjs FILM`): a feature a film needs becomes an optional hook here plus one line on this page, never a patch inside one film.
- `draw(t)` draws any heard second straight away, remembering nothing from earlier frames.
- Whatever the schemas don't name (camera keys, props, audio, lighting) is the film's own and passes through untouched.

## Film files

- `src/scene.ts`: `SHOTS`, `SHOTS_OUT`, `DURATION`, `applyEdit`, `buildScene(canvas, W, H, draft)` → `draw(t)` with `draw.tools` (scene, camera, look, `free` camera it must obey when `on`: it changes the viewpoint only, so the frame is the same moment as the keyed camera sees it, less the fade and the camera's own moves (keys, roll, a shot's animation); optional `home` {p, l, fov?}: where the first free camera after a reload starts; optional `objects`/`materials`/`rig`/`bones` name what a tap hit).
- `src/edit.ts`: `setEdit(data)` then `export * from "live-studio/edit"`; the place to merge the film's own timeline files.
- `src/edit.json`: `voice {edits, warp}` + `beats`, all times in the voice's source seconds; the studio never writes it, and saving it (like any code) rebuilds the page, which shows **New version** instead of reloading.
- `package.json`: scripts `studio PORT`/`notes`/`note`/`render` (from `init.mjs`), `"live-studio": { "sound": [the mix's inputs, never its outputs], "chrome": headless Chrome path, "ratio": "9:16" for a Shorts film (default 16:9) }`. The ratio sets the W and H `buildScene` gets everywhere (studio, drafts, checks), so the scene takes its camera aspect from W / H and never assumes 16:9; Settings > Aspect ratio writes it.
- `sound.py OUT.wav` (the studio mix), `voice_map.py` (word times once there is a voice), optional `voice_edit.py`/`make_lite.py`, `assets/public/` served as `/`, `.live_hosts` (host names allowed in, e.g. Tailscale's).

## Optional hooks

- `draw.describe(t)`: the list over the picture of a draft render with `LIST=1` (the studio no longer shows it); name every technique and its source file, `fresh` shows NEW.
- `draw.checks`: `{ name(...args) → lines }`, printed by `CHECK=name:args bun run render`, for what a picture cannot show (feet sliding). Built in for every film, target `cam`, a bone, an object name or label: `CHECK=motion:handR,81,83` (speed graph, onion skin, pops, dead stops), `seen:Steve,0,108` (in frame, hidden behind what, cut off, too dark), `touch:Steve,40,45` (sinks into or hovers off surfaces; for one shot in question, a whole film lists every small limb clip). The encoded video: `bun run framecheck` (black, flash, jump, shimmer, frozen).
- `draw.variants`: looks to switch (build all once, `set(id)` toggles, chip near `ranges`); **Use** writes `choices.json`, which the film's own renders and final mix must apply. `off: true` on a variant adds an Off chip: `set("off")` hides the prop.
- `"live-studio": { "soundTimeline": "src/timeline/audio.json", "sfx": "sound/sfx" }`: sound lanes under the timeline and a library tab of the folder's WAVs; the studio rewrites that file (`beds {name, from, to, gain dB, fadeIn, fadeOut}`, `sfx {at, name, gain, start?, length?, fadeOut?}`, output seconds, keys it doesn't know kept), so the film's mix must read it and list it in `sound`. `SOURCES.json` beside the WAVs gives each file `{title, license, url, for, kind?}`; the library's BGM tab takes files 10 s or longer, SFX the rest, unless `kind` says `"bgm"` or `"sfx"`.
- Add `"liveLanes": true` and the page plays the lanes itself through mix.py's drive and limiter, so an edit is heard at once with no remix; sound.py then gets `--live-lanes` and must mix only what is not on the lanes, without drive or limiter (scripts/sound/mix.py `--raw OUT --live-lanes`).
- The lanes are CapCut-style tracks: `tracks` lists `{id, name, mute?, lock?}` top to bottom and each bed or one-shot names its `track`; both are optional (the page adds them on its next save), two clips never overlap on one track, and a muted track is left out of every mix, so a film's own mixer must drop it too (mix.py does).
- `"camTimeline": "src/timeline/cam.json"` (keys as film-stage/camera.ts reads them, `t` in the seconds draw(t) gets): a camera row under the timeline and a Camera tab; the studio rewrites that file (retimed keys, `ease` as a name or a cubic-bezier `[x1, y1, x2, y2]`, keys from the free camera) and puts a fresh copy in `EDIT.cam` on each edit, so the film must draw from `EDIT.cam` and cache on that array. Set `draw.eases` (film-stage `EASES`) so the row and the tab can draw the named eases. A cut key stays where it is unless the film keeps its shots as data (`shotsTimeline`, below): cuts belong to SHOTS too.
- `"shotsTimeline": "src/timeline/shots.json"` (`[{t, name?, ...}]`, `t` in the voice's source seconds like `SHOTS`, each after the one before): dragging a cut on the camera row moves that shot's start with the cut key in cam.json (and the key just before it), and the Camera tab renames a shot. Each edit puts a fresh copy in `EDIT.shots` and calls `applyEdit`, so the film rebuilds `SHOTS`/`SHOTS_OUT` from `EDIT.shots` there, in place. A shot's `anim` (`{in?, out?, combo?}`, each `{fx, len?, k?}`) is the Animation tab's In / Out / Combo: draw it with film-stage/animate.ts `animate(cam, t, SHOTS_OUT, DURATION)` right after the camera keys (it moves the camera and returns a black level for the fade below), and set `draw.anims = ANIMS` so the tab lists the effects.
- `"keyFiles": { "src/timeline/steve.json": "steve" }` (file -> the `EDIT` key the film reads it from): every list of `{t, ...}` in each file, at any depth, becomes a key row under the camera row with a Key tab that edits each field by its type. Each edit puts a fresh copy in `EDIT[key]`, so the film reads it every frame and caches on that object; keys only move between their neighbours, and `t` is in the seconds draw(t) gets.
- `draw.tools.placed` (mc-assets/placed.ts `makePlaced(scene, sources, EDIT, key)`, drawn with `placed.draw(t)` each frame) plus its file in `keyFiles`: an Objects tab whose library drops game blocks, props and mobs onto the picture, a click selects one, and a gizmo (W E R) moves, turns and sizes it, keyed at the playhead like Unreal's Auto Key; a key's `ease` takes the camera's names or a cubic-bezier (film-stage `easeOf`), and the selected object's path is drawn from `placed.pathOf`. The studio also needs `draw.tools.renderer` to draw the gizmo.
- A key file in `keyFiles` holding a `"black"` list (the template's `src/timeline/fx.json`: `{"black": []}`), drawn last in draw with film-stage/fade.ts `makeFade(renderer)(Math.max(blackAt(EDIT.fx.black, t), animBlack))`: `{t, black}` keys (0 the picture, 1 all black) on their own key row, for a fade that is not a shot's In or Out (those come from `anim`); drafts and the final video carry both. Skip it while `free.on`.
- `renders/live/trials.json` (from `sound.py`): sound options per group, each one stem at film level, the film's own first; picked into `choices.json` the same way; every sound group also gets Off, `set: "off"`, which the final mix must leave out.

## Draft renders

`bun run render stills|clip` inside the film; its options (AT, LIST, CHUNKS, INSPECT, CHECK, ENTRY + LAB_*) are in the header of [`render.mjs`](../render.mjs), and lab pages import `live-studio/lab`.

## Notes

`bun run notes` then `bun run notes ID`, read in written order (#1 first, later ones may take back earlier ones), fix and verify, then `bun run note done ID "what changed, plain Vietnamese"`; one you can't fix stays open with the reason in your reply, and nobody edits `notes.jsonl` by hand. A drawn note carries `marks` (pen, arrow, box, or a path of one point per second), `range` and a `frames` picture per drawn second, all printed by `bun run notes ID`.

## Load weight

Over 10 MB on a phone's first load the terminal names the biggest files: load only the part of an archive the page reads, give phones `make_lite.py` copies (`/lite/` via `window.__assets`), then pixel-compare frames against the old build.

## New film

`init.mjs FILM` → replace `src/scene.ts` and `src/edit.json` → `bun run studio` prints both `film contract ... ok` lines → point the film's `AGENTS.md` here.
