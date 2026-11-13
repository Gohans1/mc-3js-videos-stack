# Sound: place, mix, and hear it in numbers

An AI cannot hear, so it has two kinds of ears. `bun run listen` measures the mix: the narration against everything else in LU (EBU R128), each fault with its heard second. `earshot`, a CLI of its own, says what a sound is, how well it fits words, and where hits land on the picture (below).

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
bun run listen --at 12.4                     # the 2 s around it, next to the last listen (after a sound edit it renders the stems again first)
```

The first `listen` renders two stems at about a second per film second; later runs reuse `renders/listen_stems/` until `src/` or the film's sounds change. After a vault sound changes, run `bun run listen --fresh`.

In `audio.json`, `tracks[].gain` is a whole track and a clip's `filters` is an ffmpeg EQ chain (the studio's Inspector writes it).

A sound edit never needs a new picture: `bun run mix renders/draft_video.mp4` puts it on the draft, and `render clip` keeps every chunk (the sound timeline is not in a chunk's stamp).

## Ears: earshot

`earshot` runs locally on the CPU (`earshot -h`, `earshot <command> -h`). Every call loads its models first, about 20-40 s, so put every candidate in one call; a file it has heard before is cached, and the same call again takes about 2 s. Quote its numbers when you report ("z +3.1 strong", "p_real 0.96"). Its own manual, with every loop and how far to trust each number, is the earshot skill: `bun run skills get earshot` prints its path from where you stand.

| You want                                    | Run inside the film                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The best of several candidates              | `earshot rank "<what it sounds like>" <file> <file> ... --top 3`; `bun run find` prints this line with the paths                                                                                                                                                                                                                                                                                                                                                                           |
| What one sound is                           | `earshot describe <file>` (`bun run find --show <id>` prints its path)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The clean moment inside a long file         | `earshot find <file> "<what it sounds like>" --top 3`; its start and end become the row's `start` and `length`                                                                                                                                                                                                                                                                                                                                                                             |
| A real recording, or code-made              | `earshot realness <file>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| What plays when, and the hits on the cuts   | `earshot timeline renders/draft.mp4 --cues renders/cuts.json --from 25 --to 40 --detail low` (after `bun run mix renders/draft_video.mp4`; `draft_video.mp4` has no sound); `bun run listen --at <s>` prints it for `s`                                                                                                                                                                                                                                                                    |
| The same as a picture                       | `earshot sheet renders/draft.mp4 -o renders/ear_sheet.png --cues renders/cuts.json --from 25 --to 40`, then open the PNG                                                                                                                                                                                                                                                                                                                                                                   |
| Did a sound change help                     | Copy `renders/draft.mp4` to `renders/before.mp4`, `bun run mix renders/draft_video.mp4`, then `earshot ab renders/before.mp4 renders/draft.mp4 --query "<the sound you want>" --a-start 30 --a-end 36 --b-start 30 --b-end 36` (the stretch you changed: mix brings the whole film back to its `lufs`). "Nearly the same" with nothing measured means the change is small inside the mix: compare `over bed` of that hit in `earshot timeline` of both files, or `bun run listen --at <s>` |
| A sound neither the vault nor Freesound has | `earshot sfx list --kind hit`, then `earshot sfx render <id> -o sound/sfx/<name>.wav` (`--pitch E2` or Hz, `--dur` seconds): `<name>` is now this film's sound for `audio.json`. The file is written even when its `checks:` are not `clean`: then try `--dur` or another id                                                                                                                                                                                                               |
| Is earshot set up                           | `earshot doctor`; not on PATH: `INSTALL.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Describe the sound, not its job, and in English: "a heavy iron door slamming in a stone room", not "the door for the chase". Its models learnt from English captions; a query in another language ranks differently and earshot does not warn. earshot says what a sound is, never whether it is right for the story: that call is the creator's. Never run `earshot llm`: it uploads the audio to Google, and only the creator can agree to that.

The film's sound goes through `audio.json` and `bun run mix` only. The real-sound skill is worth reading for sourcing, licences and cue design, but its own mixer, master and mux never touch a film: the studio and `bun run check` would never see what they write.

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

Every vault sound is cleared for YouTube; a row tagged credit needs the author in the video description. Minecraft music with a contentId gets claimed. `bun run listen --sheet` also draws a spectrogram and loudness picture through `earshot sheet`.
