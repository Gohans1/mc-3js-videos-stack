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

Pipeline mặc định dùng audio.json và bun run mix để studio và check đọc cùng dữ liệu; real-sound vẫn hữu ích cho nguồn âm, giấy phép và thiết kế cue. Có thể dùng mixer, master hoặc mux riêng, nhưng phải nối đầu ra vào cách preview của phim và tự xem/nghe, kiểm chứng phần công cụ tích hợp không đọc được.

## Optional local media tools

Discover with bun run media list, check with media doctor, and install only the needed backend with media setup <tool>. Each run has a deadline, a fresh evidence folder and cached models; these tools never change audio.json or replace creative decisions.

| Need | Use and limits |
| --- | --- |
| Clean noisy speech | bun run media denoise recording.mp4 --from 5 --to 13; DeepFilterNet CPU, output WAV at 48 kHz, keep the original because ambience or consonants may disappear |
| Lightweight sound labels | bun run media ced recording.wav --top-k 5; CED Tiny CPU gives independent AudioSet scores, not event times or verified probabilities |
| Draft a voice locally | bun run media tts --text "The door opens."; Kokoro CPU, --voice/--language choose supported voices, no Vietnamese preset and no forced word alignment |
| Compose editable notes | bun run media midi sting.mid; FluidSynth CPU renders MIDI with a licensed SoundFont, --soundfont selects another file with its own terms |
| Fingerprint music | bun run media fingerprint bgm.wav --length 30; Chromaprint emits raw fingerprints for comparison, without a title database or copyright judgement |
| Ask about recorded sound | bun run media caption recording.mp4 --from 5 --to 13 --prompt "Describe the sounds."; experimental MiDashengLM CPU, response.json and source audio stay beside result.json |
| Trust model text | Caption and vision outputs are unverified hypotheses; small models have hallucinated in local trials, so check retained evidence and use earshot for independent sound comparison |
| Native options and setup | media <tool> --help; pinned Windows binaries and model hashes live in scripts/media/tools.json, caption setup also needs CMake and MinGW and may need --minutes 20 on a cold build |

The runtime, weights and bundled dependencies have separate licenses: Kokoro uses eSpeak-ng GPL notices, FluidR3 GM retains its MIT grant, and third-party SoundFonts/voices keep their own terms. setup downloads retained assets; inference remains local and a short-lived model server binds only to 127.0.0.1.

## Optional SDK tools

These commands use independent CPU environments, source-file seconds and fresh evidence folders. setup pins the tested packages; beat/separate/locate install CPU Torch from its official index, while Basic Pitch keeps Python 3.10 and its legacy resampy dependency isolated.

| Need | Use and limits |
| --- | --- |
| Music beats and bar starts | bun run media beat bgm.wav --from 0 --to 25; beats/downbeats suggest cut points, keep intentional off-beat edits and verify the grid on the music |
| Speech intervals | bun run media vad reference.mp4 --from 5 --to 15; Silero returns start/end, without words or speaker identity; --config is native Silero settings JSON |
| Melody to editable MIDI | bun run media melody melody.wav; Basic Pitch keeps melody.mid, model-output.npz and source-timed notes; repeated notes or whole mixes can be misread, MIDI remains local to the selected excerpt |
| Custom sound processing | bun run media effects voice.wav --config effects.json --tail 2; config is an array of objects with name and parameters, e.g. Gain/gain_db or Reverb/room_size, using native Pedalboard classes |
| Vocals and backing | bun run media separate clip.mp4 --from 0 --to 8; Kim Vocal 2 is a small CPU starting model, --config forwards Separator parameters except owned paths/device, --model selects a licensed cached model; upstream ONNX chooses CPU threads and has no supported SDK thread limit |
| Find a described sound | bun run media locate clip.wav --query "a man speaking" --query "a dog barking"; PE-A Small preserves raw logits every 40 ms, --threshold groups suggested spans and is not a calibrated probability or accuracy guarantee |
| Model/config choices | media <tool> --help; --model accepts a file, or a local Transformers directory for locate; --config forwards backend JSON where advertised and cannot redirect artifact paths, including Basic Pitch debug_file |
| Inspect a timeline handoff | bun run media timeline edit.otio; read/write roundtrip verifies references, ranges and metadata, without modifying the film |
| Create a timeline handoff | media timeline edit.json accepts fps and tracks of kind Video/Audio, each with clips; clip url/start/duration or gap:true/duration use frame units, metadata stays intact |

OTIO core writes .otio; NLE-specific formats need their own supported adapter or baked media. These tools do not translate draw(t), scene speed curves or shader effects automatically, and model output never becomes an artistic gate.

Native regression checks require the optional effects, separate and timeline setups: bun test ./scripts/test/media-sdk.native.mjs. They verify PitchShift frequency/duration, failure on an unavailable stem and OTIO fields with generated fixtures; they do not download models and retain their temporary evidence paths.

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

Âm nằm trong vault chưa đủ chứng minh quyền dùng: đọc SOURCES.json và giấy phép của đúng asset trước khi phát hành, ghi credit khi cần. Minecraft music có contentId có thể bị claim; bun run listen --sheet vẽ spectrogram và mức âm qua earshot sheet.
