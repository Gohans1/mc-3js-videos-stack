# Sound: discover, place, mix and verify

Choose steps for the current change; reuse available sounds instead of searching/downloading again. The default workflow uses the film's audio timeline and bun run mix so Studio, checks and preview share data.

## Choose the right tool

| Task | Tool and scope |
| --- | --- |
| Find sounds and inspect sources | bun run find; --kind sfx, bgm, mc or sound; --show <id> includes file, license and recipe |
| Find/download missing CC0 Freesound audio | bun run sfx:get in a film; find searches online, then pin selected IDs in sound/sfx_list.json and download |
| Place, read, edit or remove cues | bun run asset; use find IDs to place, and the returned target to edit that cue |
| Judge candidates, clean regions or differences | earshot is a separate CLI; read earshot <command> -h |
| Build soundtrack or mux video | bun run mix in a film; outputs sound/mix.wav and a video with sound |
| Measure masking, gain, mono and silence | bun run listen in a film; level measurements do not identify a sound |
| Create/edit narration | bun run skills get core --ref voice; voice:playground for casting/archive, voice:gen for edit.json takes |
| Cue design, sources and licenses | bun run skills path real-sound; open SKILL.md in that directory |

find discovers assets; earshot find locates a region in a selected file. asset edits timelines, mix renders output and listen measures the mix; each has a separate role.

## Film workflow

| Step | Command and result |
| --- | --- |
| Find candidates | bun run find rain --kind sfx; --kind sound also includes music and Minecraft sounds |
| Inspect a candidate | bun run find --show <id>; read file, license, placement ID and exampleProps |
| Choose/trim the source | earshot rank "rain on a metal roof" <file1> <file2> --top 3; earshot find <file> "a clean rain texture" --top 3 for a specific region |
| Place | bun run asset use <id> --from 12 --to 15 --props-file controls.json; JSON identifies the written file, data and cue target |
| Read/revise | bun run asset timeline --lane audio; bun run asset edit <target> --props-file changes.json; bun run asset remove <target> removes the cue and keeps its source file |
| Check data | bun run check validates names/schema; it does not prove the sound fits |
| Make a draft with sound | bun run mix renders/draft_video.mp4; open renders/draft.mp4, since draft_video.mp4 has no soundtrack |
| Measure/locate | bun run listen; read renders/listen.json, then bun run at 12.4 to locate active rows |
| Preserve source tracks | Mix creates a video from the picture tracks and new AAC audio. It reports subtitle, data, and other tracks and leaves them in the source file. |
| Measure a short window | Below 400 ms, check true peak (dBTP) and onset. Mix and deliver report LUFS as unavailable when the signal does not pass the EBU gate. |
| Recheck a changed span | Run bun run listen --at 12.4 to measure stems and get an Earshot command when the draft audio is current. Use earshot timeline on the exported file for a delivery or preview. |
| Check an excerpt | Mix reads the start time from standard chunk and span filenames. Pass --start 40 for other files. Use file seconds when inspecting renders/mixed_*/preview.mp4. |

find and asset also run at the root; asset needs --film films/<name> for film actions. bun run help <command> names the working directory; the command's --help gives syntax.

## Search by the scene

bun run find "<words>" shows filtered keyword matches, then independent OpenFilm semantic candidates; each block keeps its order and at most -n results (default 12). --source is an explicit provider filter; --kind sound includes sfx, bgm and mc, while mc-only searches do not call OpenFilm.

Filters apply to both blocks; similarity is not confidence, so listen/view before choosing. --json keeps keyword.results and semantic.results separate; --offline reads saved lookups without network and remote failures keep keyword matches.

--show identifies files, licenses, controls and placement; source-only pages still need integration and verification in the scene. --origin real is the existing Real / Studio grouping and does not establish recording provenance; retain explicit unknown origin from source metadata.

## Clocks and editable data

| Data | Meaning |
| --- | --- |
| asset --from, --to and edit times | Heard seconds after Speed/Freeze; --to is exclusive |
| Hand-edited audio.json | Scene seconds before Speed/Freeze; use the configured soundTimeline file |
| gain | dB; find --show exampleProps are a starting point, not a universal level |
| Music and ambience | Music uses beds; bed: true in controls.json places ambience in beds |
| Không gian âm thanh | audio.json có reverb mặc định, spaces theo khoảng giây nguồn và reverb riêng từng clip. Preset phòng được tạo sẵn, custom IR đọc từ phim hoặc vault. |
| Neo 3D | spatial.target bám vật thể placed hoặc vật thể có tên trong scene. spatial.at đặt XYZ hoặc làm tọa độ dự phòng, spatial.offset cộng theo tọa độ thế giới. |
| Cắt lệch tiếng | J-Cut và L-Cut ở menu clip kéo mép tiếng qua ranh hình khi file nguồn và track còn chỗ. Có Undo. |
| Source trim | start is source-file seconds; length is cue playback duration in audio.json. At constant rate without other retiming, an earshot start/end region uses length = (end - start) / rate; rate defaults to 1 |
| Track gain and EQ | tracks[].gain affects the track; clip filters contain the Inspector's FFmpeg EQ chain |
| Edit target | Keep the returned target; older index-based rows require rereading timeline after reordering |
| Duration defined in code | Read asset --help about --duration when edit.end is absent and clock conversion is needed |
| Film-local pinned sounds | sound/sfx_list.json selects Freesound IDs; sound/sfx holds files/SOURCES.json. Run find inside the film to include them |

Cue --to is playback end, separate from source trim. Linked holds may have no exact source-time equivalent; asset rejects such edits before writing, while --ref contract explains independent audio clocks or output-time mixing.

Custom JSON edits and other mixers/mastering/mux tools remain valid; connect their output to preview and verify parts the built-ins cannot inspect. Gain/bed/SFX changes can reuse pictures; narration, lip sync or pacing changes that affect pictures need rerendering.

## Load earshot when needed

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

## Local sound library and metadata

| Need | Optional command |
| --- | --- |
| Build a searchable sound library | bun run media foley index --config library.toml --limit 20 --workers 1; native TOML explicitly selects [library] root and [storage] data_dir outside it |
| Search by meaning | bun run media foley search "a man speaking" --config library.toml; JSON preserves candidate scores and license fields, not a verdict of correctness or permission |
| Inspect an asset / progress | media foley describe 2 --config library.toml; media foley status --config library.toml reports errors and pending model stages |
| Choose local models | In native TOML use [models] enabled=true, device="cpu", clap=["htsat-unfused"] for this PC; first CLAP use downloads the upstream pinned checkpoint |
| Resume indexing | Reuse the same TOML/data_dir and rerun index; SQLite/cache survive timeout, --limit caps analyses rather than the library scan |
| Read Broadcast WAV fields | bun run media metadata recording.wav; BWF MetaEdit exports XML and verifies that the input hash remains unchanged |

Foley is an optional young alpha project, supplementing earshot with a persistent catalog. The adapter exposes index/search/status/describe; its native CLI/MCP remains available, and PANNs CC-BY-4.0, CLAP Apache-2.0 and AudioSet notices stay separate from Foley's MIT code license.

## Mix loudness processing
bun run skills path earshot returns the skill directory; open SKILL.md and its relevant reference. earshot doctor checks the environment; read INSTALL.md if the executable is missing.

| Goal | Command |
| --- | --- |
| Rank candidates | earshot rank "<sound description>" <file1> <file2> --top 3 |
| Identify sound | earshot describe <file> |
| Find a clean region | earshot find <file> "<sound description>" --top 3 |
| Assess recording versus synthesis | earshot realness <file>; supporting evidence, not proof of provenance or license |
| Inspect timing and cuts | earshot timeline renders/draft.mp4 --cues renders/cuts.json --from 25 --to 40 --detail low; omit --cues if absent |
| Inspect sound with pictures | earshot sheet renders/draft.mp4 -o renders/ear_sheet.png --from 25 --to 40; open the PNG |
| Compare before/after | Keep renders/before.mp4 before remixing; earshot ab renders/before.mp4 renders/draft.mp4 --query "<sound description>" --a-start 30 --a-end 36 --b-start 30 --b-end 36 |
| Synthesize when appropriate | earshot sfx list --kind hit, then earshot sfx render <id> -o sound/sfx/<name>.wav; label this synthesized audio |

Describe sound in English, such as "a heavy iron door slamming in a stone room", rather than its story role. Rank candidates together to avoid repeated model loads; file caching does not imply the model stays loaded between CLI calls.

Base audio judgments on measured results and relevant numbers; similarity scores support creative intent. earshot llm uploads audio externally and requires the creator's agreement to that transfer.

## Mixing, cache and diagnosis

| Situation | Action |
| --- | --- |
| First listen or changed data | Builds whole-film stems under renders/listen_stems; read --help before running a long film |
| listen --at <s> | Focuses the report while reusing whole-film stems. Each row averages rolling 400 ms LUFS readings, so use the encoded file for exact onset and peak timing. |
| Replace a sound asset | Listen and mix track the selected audio file, including vault files and subfolders. Use listen --fresh to rebuild stems. Processing errors keep the previous stems. Mix pads short audio with silence and checks decoded picture tracks before replacing output. A failed write keeps the previous MP4, WAV, and sidecar. |
| Inspect spectrum and levels | listen --sheet uses stems before mastering. Add --at to narrow the window. Use earshot sheet FILE to measure the exported MP4. |
| Voice LOST or THIN | Lower masking beds/SFX or duck the bed; listen and at identify cues |
| LOUDER or LOUD with no voice | Inspect the remaining mix levels instead of automatically raising narration |
| BURIED | Raise the hit or lower its surrounding bed, then inspect the mix |
| MONO | Check widening, phase and oversized stems |
| near silence or abrupt end | Check the intended silence/fade; retain deliberate choices |
| Small A/B difference | mix normalizes the whole film to lufs; compare the same region and hit-to-bed relationship |

mix limits drive then applies linear gain toward lufs, default -14 LUFS, with a pre-encode ceiling of -1.5 dBTP. If the target is unreachable, read the drive advice; above +12 warns because limiting can flatten hits.

Aim for 15 LU of separation. Below 8 LU, check for masking. Listen to the export to confirm that the words remain audible and that each sound fits the scene.

## Sources and licenses

Vault availability does not prove permission: read the asset's SOURCES.json/license and provide required credit before release. Minecraft music with contentId can be claimed; real-sound guides source/license checks without replacing asset evidence.

fetch:sfx downloads Mixkit; fetch:sound-raw preserves raw packs; setup:sound builds the library/metadata; fetch:openfilm imports its library and pack:sound includes sources/licenses. These are preparation tools, not steps to repeat per cue; openfilm and asset list/info are compatibility aliases, while find discovers and asset edits.

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
| Evidence extent | Read audioCoverage in the CLI and result.json for the requested and analyzed ranges. If audio ends early, partial/empty exposes the uncovered tail so silence and time outside the audio are visible separately. |
| Music beats and bar starts | bun run media beat bgm.wav --from 0 --to 25 estimates beats/downbeats in file seconds. Verify model estimates against the evidence WAV, which keeps track offsets through resampling and may absorb timestamp gaps up to 2 ms. |
| Speech intervals | bun run media vad reference.mp4 --from 5 --to 15; Silero returns start/end, without words or speaker identity; --config is native Silero settings JSON |
| Melody to editable MIDI | bun run media melody melody.wav; Basic Pitch keeps melody.mid, model-output.npz and source-timed notes; repeated notes or whole mixes can be misread, MIDI remains local to the selected excerpt |
| Custom sound processing | bun run media effects voice.wav --config effects.json --tail 2; config is an array of objects with name and parameters, e.g. Gain/gain_db or Reverb/room_size, using native Pedalboard classes. Plugins receive float PCM headroom, effect.wav exports PCM24, and saved decodeCommand replays the input PCM and speaker labels. |
| Vocals and backing | bun run media separate clip.mp4 --from 0 --to 8; Kim Vocal 2 is a small CPU starting model, --config forwards Separator parameters except owned paths/device, --model selects a licensed cached model; upstream ONNX chooses CPU threads and has no supported SDK thread limit |
| Find a described sound | bun run media locate clip.wav --query "a man speaking" --query "a dog barking"; PE-A Small preserves raw logits every 40 ms, --threshold groups suggested spans and is not a calibrated probability or accuracy guarantee |
| Model/config choices | media <tool> --help; --model accepts a file, or a local Transformers directory for locate; --config forwards backend JSON where advertised and cannot redirect artifact paths, including Basic Pitch debug_file |
| Inspect a timeline handoff | bun run media timeline edit.otio; read/write roundtrip verifies references, ranges and metadata, without modifying the film |
| Create a timeline handoff | media timeline edit.json accepts fps and tracks of kind Video/Audio, each with clips; clip url/start/duration or gap:true/duration use frame units, metadata stays intact |

OTIO core writes .otio; NLE-specific formats need their own supported adapter or baked media. These tools do not translate draw(t), scene speed curves or shader effects automatically, and model output never becomes an artistic gate.

Native regression checks require the optional effects, separate and timeline setups: bun test ./scripts/test/media-sdk.native.mjs. They verify PitchShift frequency/duration, failure on an unavailable stem and OTIO fields with generated fixtures; they do not download models and retain their temporary evidence paths.

## Local sound library and metadata

| External audio and loops | Commands and checks |
| --- | --- |
| Match the sample count | Run media ffmpeg audio -- track.wav --tempo 1.1 --sample-rate 48000 --length-samples 96000 -o exact.wav, then read the decoded verification results. |
| Sync a recording | Use schema sync to find offset, confidence, and drift. These measurements apply to file alignment. Check lip sync and the three film clocks separately. |
| Inspect a loop seam | Run media qc request.json with rules.audio.loop_seam to measure clicks, level, and spectrum at the wrap or listed seams. Set thresholds for the project and listen to the result. |
| Preserve the mix | Keep mix, listen, and Earshot for film audio. Check the native schema for loudness fallback and whether a video operation re-encodes audio. |

| Need | Optional command |
| --- | --- |
| Build a searchable sound library | bun run media foley index --config library.toml --limit 20 --workers 1; native TOML explicitly selects [library] root and [storage] data_dir outside it |
| Search by meaning | bun run media foley search "a man speaking" --config library.toml; JSON preserves candidate scores and license fields, not a verdict of correctness or permission |
| Inspect an asset / progress | media foley describe 2 --config library.toml; media foley status --config library.toml reports errors and pending model stages |
| Choose local models | In native TOML use [models] enabled=true, device="cpu", clap=["htsat-unfused"] for this PC; first CLAP use downloads the upstream pinned checkpoint |
| Resume indexing | Reuse the same TOML/data_dir and rerun index; SQLite/cache survive timeout, --limit caps analyses rather than the library scan |
| Read Broadcast WAV fields | bun run media metadata recording.wav; BWF MetaEdit exports XML and verifies that the input hash remains unchanged |

Foley is an optional young alpha project, supplementing earshot with a persistent catalog. The adapter exposes index/search/status/describe; its native CLI/MCP remains available, and PANNs CC-BY-4.0, CLAP Apache-2.0 and AudioSet notices stay separate from Foley's MIT code license.

Ordinary --json uses schemaVersion 2: keyword.results holds full records; semantic hits with alsoKeyword:true reference them by key and keep their own rank and similarity. Other semantic hits hold full records; --semantic keeps its existing schema.
