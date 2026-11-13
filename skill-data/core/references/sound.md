# Sound: place, mix, and hear it in numbers

An AI cannot hear, so its ears are `bun run listen`: the narration measured against everything else in LU (EBU R128), each fault with its heard second.

## The sound loop

Inside a film:

```bash
bun run find rain --kind sfx                 # also bgm, mc (Minecraft) or sound (all three)
bun run sfx:get find "cat meow"              # a Freesound CC0 sound the vault lacks: pin its id in sound/sfx_list.json
bun run sfx:get                              # then fetch every pinned sound
                                             # place rows in src/timeline/audio.json (beds, sfx; scene seconds, gain in dB)
bun run check                                # wrong sound names, misspelt keys (gian for gain), lufs outside -20..-12, drive over +12
bun run mix renders/draft_video.mp4          # sound/mix.wav, and renders/draft.mp4 with it
bun run listen                               # every fault, also in renders/listen.json with what plays there
bun run at 12.4                              # the rows playing at a fault; change a gain, then:
bun run listen --at 12.4                     # the 2 s around it, next to the last listen
```

The first `listen` renders two stems at about a second per film second; later runs reuse `renders/listen_stems/` until `src/` or the film's sounds change. After a vault sound changes, run `bun run listen --fresh`.

In `audio.json`, `tracks[].gain` is a whole track and a clip's `filters` is an ffmpeg EQ chain (the studio's Inspector writes it).

A sound edit never needs a new picture: `bun run mix renders/draft_video.mp4` puts it on the draft, and `render clip` keeps every chunk (the sound timeline is not in a chunk's stamp).

## How mix sets the loudness

The mix goes through `drive` dB into a limiter, then one linear gain brings it to `lufs` (-14), or only as far as its true peak stays under -1.5 dBTP (room for the AAC encode). Never a dynamic loudness pass: it lifts every quiet stretch, room tone up to the voice (AES TD1004).

When mix says it stopped short, it names the `drive` value to set: the limiter takes the peaks and each dB of drive buys a third to a half of one. Raising the narration barely helps, its own limiter holds it. Past +12 the hits flatten into the bed, so `bun run check` warns; listen whether they still land. A film 2 LU under -14 only plays a little quieter on YouTube.

## Targets

| Measure                 | Target                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Narration over the rest | 15 LU or more is clear; 8-15 thin; under 8 words get lost (AES TD1009)             |
| Beds under narration    | Narrated documentaries keep beds 24-31 LU under the voice                          |
| A sound effect          | Close to the voice, about 10 LU under, never over it                               |
| A hit you should hear   | About +6 dB over the second before it, or it is `BURIED`                           |
| Level at a cut          | A jump over 6 LU is flagged; fine when the story calls for it                      |
| One speaker (a phone)   | The narration loses at most 1.5 dB, the rest 6 dB, or it is `MONO`                 |
| The upload              | -14 LUFS, true peak -1 dBTP or under (YouTube turns louder down, never quieter up) |

## listen's faults and their fixes

| Line                           | Fix                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `LOST`, `THIN`                 | Lower the bed or sound playing there (listen names the rows), or duck the bed under the voice                         |
| `LOUDER`, `LOUD with no voice` | Lower the rest in that stretch; the voice is not the problem                                                          |
| `BURIED`                       | Raise that sound's gain, or lower the bed under it                                                                    |
| `MONO`                         | Drop a stereowiden or extrastereo filter, swap a recording with a flipped side, or lower stems driven far over 0 dBFS |
| `near silence`                 | Dead air; keep it only when meant                                                                                     |
| `abrupt end`                   | Fade the beds out before the end                                                                                      |

Every vault sound is cleared for YouTube; a row tagged credit needs the author in the video description. Minecraft music with a contentId gets claimed. `bun run listen --sheet` also draws a spectrogram and loudness picture (needs earshot: `INSTALL.md`).
