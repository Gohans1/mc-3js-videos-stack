# A film: making one, what each file holds, the vault

## Create and connect

At the repo root:

```bash
bun run new-film cave-escape 47920           # templates/film -> films/cave-escape, studio port optional
bun run setup:vault                          # a new machine: the light vault, every file verified
bun run link                                 # connect the vault to every film (or: bun run link sealed-room)
```

A Shorts film sets `"ratio": "9:16"` under `"live-studio"` in its `package.json`: drafts at 720x1280, the final at 1080x1920.

## What each file holds

`bun run help` inside a film prints this film's own map (its timeline file names come from `package.json` `"live-studio"`).

| File                                    | Holds                                                                               | Clock     |
| --------------------------------------- | ----------------------------------------------------------------------------------- | --------- |
| `src/scene.ts`                          | The film's code: `buildScene` returns `draw(t)`, which must draw any `t` on its own | Scene     |
| `src/edit.json`                         | Narration takes and script, `voice.warp`, beats, the film's own settings            | Narration |
| `src/timeline/shots.json`               | Shots: start `t`, name, framing, `transition` into the shot, `anim`                 | Narration |
| `src/timeline/cam.json`                 | Camera keys and cuts                                                                | Scene     |
| `src/timeline/audio.json`               | Beds, sound effects, the narration's place, gains, tracks, filters                  | Scene     |
| `src/timeline/text.json`, `adjust.json` | On-screen text, colour and look layers                                              | Scene     |
| `src/timeline/timing.json`              | Speed, Freeze, velocity: what turns scene seconds into heard seconds                | Scene     |
| Key files (`"live-studio".keyFiles`)    | Keyed rows for characters and props                                                 | Scene     |
| `renders/`                              | Everything render, sheet, framecheck and listen write (ignored by git)              |           |
| `notes/`                                | The creator's notes; read them with `bun run notes`                                 |           |

After every JSON edit run `bun run check`: the studio's own schemas, every sound name, misspelt keys, an off-target `lufs` or a runaway `drive`. The full contract: `packages/live-studio/docs/film-contract.md`.

## What a film can name

```bash
bun run find impact --kind sfx -n 20         # by words: free, offline, instant
bun run find --show dissolve                 # one entry in full, with a line to paste
bun run find --jev --kind transition "a memory slipping away"   # by meaning, when words miss
bun run find sit --from stand --to sitFloor  # mocap by posture
```

Every schema is open (`looseObject`): a film may define its own transitions, anims and text voices in its `draw`.

## Try a command on a copy, never on a real film

On Windows, from the repo root:

```bash
robocopy films/sealed-room films/_try /E /XD node_modules renders   # then copy renders/draft_video.mp4 and cuts.json if needed
cmd /c mklink /J films\_try\node_modules films\sealed-room\node_modules
cmd /c rmdir films\_try\node_modules         # when done: unlink the junction first, so the real modules stay
rm -rf films/_try
```
