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
bun run framecheck                           # black, one-frame flashes, jumps away from cuts (a mob teleporting, an item snapping), shimmer, freezes
bun run pace                                 # shot lengths, and every stretch where the picture holds still
CHECK=text bun run render stills             # each line of text: inside the safe area, readable over the picture
bun run deliver                              # the upload against YouTube's spec
```

## Reference footage

| Need | Use |
| --- | --- |
| Suggest cuts | bun run scenes reference.mp4; optional CPU PySceneDetect, no models or services |
| Change detector | --method adaptive for cuts amid motion, content for picture changes, threshold for fades through darkness; --threshold adjusts sensitivity |
| Limit range | --from 0:10 --to 0:30 uses input-file seconds, without film speed or span/chunk offsets |
| Read evidence | Each run-* keeps result.json for AI, native scenes.csv and metrics.csv, three images per scene and scenes.html |
| Judge cuts | Look around each boundary; more detected cuts do not mean greater accuracy, and suggestions never replace renders/cuts.json |
| Deadline or failure | --minutes defaults to 5, at most 60; logs and finished artifacts survive, unfinished detection does not resume at the last frame |
| Setup and more options | bun run scenes --help; INSTALL.md covers optional Python setup, upstream CLI offers crop, more detectors and timeline exports |

## Read reference text

| Need | Use |
| --- | --- |
| Discover/install | bun run media list; media doctor ocr; media setup ocr installs an independent CPU environment with uv |
| Read images or video | bun run media ocr image.png; media ocr video.mp4 --at 5,10; --frames samples a range, all times belong to the input file |
| Choose model/language | --language vi; --config native.yaml keeps upstream model/engine configuration, --score overrides only when explicitly passed |
| Keep evidence | Fresh run-* keeps job.json/process.log, original frames, frames.jsonl and result.json; model cache survives interruptions |
| Verify | Compare text and polygons against retained frames; scores are estimates and Vietnamese diacritics/small game text can be wrong |
| Stop or inspect | --minutes bounds the whole worker process tree; --dry-run validates without loading models or writing files, job.json is authoritative if a worker was interrupted |

## Measure a move

`CHECK` runs a built-in check between two heard seconds and writes charts to `renders/`:

```bash
CHECK=motion:cam,40,48 bun run render stills     # speed graph, peaks, pops, dead stops; for cam also turn and zoom in °/s against the 7-second panning rule, plus hit/impulse spans
CHECK=motion:handR,40,48 bun run render stills   # the same for a bone, with an onion skin of the move
CHECK=seen:Steve,40,48 bun run render stills     # frame share, hidden behind what, cut off, too dark, BLURRED by shallow DOF
CHECK=touch:handR,81,83 bun run render stills    # sinking into things, hanging just off them (one shot, not a whole film)
```

A target is `cam`, a bone, an object's `.name`, a `draw.tools.objects` label, or a dot-path (`Steve.head`, `desk.drawer.handle`). `seen` and `touch` look at objects, not the camera. A wrong name gets the nearest names back.

## Words on the picture

Subtitle standards are the published rules for words over moving pictures, so the checks borrow them. `bun run check` warns of a line shown too briefly to read (Netflix: up to 20 characters a second, at least 5/6 s on screen; half the In and half the Out count) and of one too small for a phone (under size 36, 3.3% of the frame height; BBC authors subtitles at 7-8% and lets a player shrink them about half).

```bash
CHECK=text bun run render stills             # every line, at the second it is fully on screen
CHECK=text:20,45 bun run render stills       # the lines between two heard seconds
```

`CHECK=text` draws each line alone and the frame without it, so it measures what is really drawn, wherever the line is anchored and however it animates. `OUTSIDE`: closer than 5% to an edge (EBU R95's graphics-safe area); in a Short, under what YouTube's player draws over it: 10% on the right (like and share), 25% at the bottom (title, channel, sound), 10% at the top, 5% on the left (Google's Shorts ad guidance). A size is a share of the frame's short side, a Short's width, so the same 36 floor holds for both: full screen, that side is the phone's. `LOW`: the letters against what is just around them, the worst tenth, under 4.5:1, or 3:1 from size 67.5 up (WCAG 1.4.3). A stroke or a shadow counts, since it is around the letters. Each fault writes `renders/text_<i>.jpg`, the line boxed in yellow and the safe area dashed. A line not meant to be read (a sign in the world, a glitch) takes `"read": false` and is never judged.

## Pace

```bash
bun run pace                                 # shot lengths, and every stretch the picture holds still, with the narration over it
bun run pace --hold 12                       # call a hold from 12 s (default 8, 5 in a Short)
```

A new picture is a cut, or a third of the frame looking different from the last new picture, so a slow pan adds up to one. Read the numbers against these, never as rules: popular films since 2000 average about 4 s a shot, open on longer shots and shorten into the climax (Cutting 2016). Shots all one length read flat, so mix short, medium and long. YouTube judges an intro by who still watches at 30 s. A Short (ratio 9:16) is read against Shorts instead: popular ones average about 2.5 s a shot, viral ones a median 4.7 s with the picture changing within about 2 s, they open at full pace rather than building, and YouTube counts who stays past a Short's first seconds, so the report shows its first 3 s. A `HOLD` with narration running over it is where a viewer's eyes have nothing new: cut to what the words say, move the camera, or keep it when the stillness is the point. A measured film exits 0 whatever it finds: the calls are yours.

## Rules

| Rule                                        | Why                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `AT` and `CHECK` take heard seconds         | As notes and `at` print them; `bun run at` converts to the scene seconds of the row to edit                |
| Render without `LIST=1` before `framecheck` | The text over the picture skews the measures                                                               |
| A cut is never a `JUMP`                     | `framecheck` reads `renders/cuts.json` from the last `render clip`                                         |
| `STALE`                                     | The video predates `src/`; render it again as the line says (`clip`, or `final` for the upload), then look |
| Trying a move or a fix                      | `SPAN=40,44 bun run render clip` draws just those seconds: `renders/span_40-44.mp4`                        |
| One stretch changed                         | `CHUNKS=3 bun run render clip` re-renders only that 30 s chunk (3 is 1:30-2:00)                            |
| Commands only print paths                   | Open the pictures with your image viewer and look                                                          |

Render nhanh, GPU, thông số xuất và mô phỏng nén local: bun run skills get core --ref render. deliver --youtube không quan sát bản encode thật từ YouTube; chỉ dùng nó như phép thử gần đúng về banding.
