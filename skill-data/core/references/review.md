# The eyes: look before you call it done

Never guess. Nothing is done until you have seen the new frames or video. Aim at the moments most likely to break: around cuts, where a character touches something, where the camera turns.

## Which command for what

```bash
bun run at 35.6                              # what plays at a heard second (also 00:35.633, or '#3' for note 3, quoted)
AT=12,30.5 bun run render stills             # frames, with the heard time and shot under each
bun run sheet                                # every still, six to a picture
bun run sheet renders/draft_video.mp4 shots  # the whole film at a glance: one frame from every shot
bun run sheet renders/draft_video.mp4 cut 4  # a transition up close: 0.25 s before cut 4 to 0.35 s after, naming shot 4 and 5 and the fx
bun run render clip                          # the draft video and renders/cuts.json
bun run framecheck                           # black, one-frame flashes, jumps away from cuts, shimmer, freezes
bun run jumps renders/draft_video.mp4        # frames far from their neighbours: a mob teleporting, an item snapping
bun run deliver                              # the upload against YouTube's spec
```

## Measure a move

`CHECK` runs a built-in check between two heard seconds and writes charts to `renders/`:

```bash
CHECK=motion:cam,40,48 bun run render stills     # speed graph and onion skin: peaks, pops, dead stops
CHECK=seen:Steve,40,48 bun run render stills     # frame share, hidden behind what, cut off, too dark
CHECK=touch:handR,81,83 bun run render stills    # sinking into things, hanging just off them (one shot, not a whole film)
```

A target is `cam`, a bone, an object's `.name`, or a `draw.tools.objects` label. `seen` and `touch` look at objects, not the camera. A wrong name gets the nearest names back.

## Rules

| Rule                                        | Why                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `AT` and `CHECK` take heard seconds         | As notes and `at` print them; `bun run at` converts to the scene seconds of the row to edit |
| Render without `LIST=1` before `framecheck` | The text over the picture skews the measures                                                |
| A cut is never a `JUMP`                     | `framecheck` and `jumps` read `renders/cuts.json` from the last `render clip`               |
| `STALE`                                     | The video predates `src/`; render the clip again, then look                                 |
| One stretch changed                         | `CHUNKS=3 bun run render clip` re-renders only that 30 s chunk (3 is 1:30-2:00)             |
| Commands only print paths                   | Open the pictures with your image viewer and look                                           |

Rendering fast, the GPU, YouTube's spec and banding: `packages/live-studio/RENDER.md`.
