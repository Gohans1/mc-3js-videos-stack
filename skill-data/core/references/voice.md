# Narration

## Playground and region editing

Voice Playground stores takes and templates in the repo's or film's voice/playground; each film sees its current Project and Global archive. Edits keep prior versions; moving to Global carries retained history and reports missing predecessors.

| Task                   | Usage                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover               | bun run voice:playground --help, then schema generate tts or schema region edit for fields and limits                                                     |
| Existing Studio        | Pass --server URL for that Studio and --scope project or global; the CLI does not guess ports                                                             |
| Standalone             | At the root pass --project films/<name>; older films without a script can run bun ../../scripts/voice/playground.mjs                                      |
| Complete configuration | --input-file FILE accepts JSON; --json returns structured results; each command's --help points onward                                                    |
| Generate voice         | generate tts, generate dialogue, generate voice-changer and transcribe send only with --yes; unavailable price information remains unknown                |
| Edit audio regions     | region info gives waveform/actual word times; region preview exports a free preview, region edit saves a new version                                      |
| UI word selection      | Word range selects first then last word; Adjust these edits restores source parameters and the timeline names the active version                          |
| Regenerate a sentence  | region edit in regenerate mode generates only replacement speech; realign with transcribe or voice:align because prior word/subtitle timing is removed    |
| Choose/revert          | versions list reads history; film use selects any version, preserves old audio and updates the Phrase Brick, while film alternatives only adds candidates |
| Disconnected request   | --checkpoint FILE saves progress; resume FILE tracks/imports the existing task, and region resume assembles replacementItemId without generating again    |
| Transcripts/subtitles  | transcribe also checkpoints; resume continues the submitted Scribe task, and items export with format srt exports text-only subtitles too                 |
| Waiting                | --wait accepts 1–1800 seconds, default 900; inspect checkpoints and Cloud history before retrying a paid request                                          |

Local tempo, pitch, volume and gap edits use FFmpeg/Rubber Band without credits; audio outside the region retains its content. Templates store generation settings, while audio edits live in version history.

## Browse the library from the CLI

| Task | Command |
| --- | --- |
| Find a take | Use items find with voiceId, creatorId, batchId, tag, project, minRating, maxRating, after, or before. Pass --project PATH to open an older film's own archive. |
| See which voices you use | voices usage counts saved recordings and placements in the film. film usage lists the takes currently in use. |
| Reuse generation settings | items recipe ID returns the repeat command and original settings when available. items media ID reports the saved file's codec, sample rate, and bitrate. |
| Estimate the cost | Pass the same JSON to generate quote as to generate batch. It returns the balance and model cost by voice. totalCredits is null if any charge remains unverified. |
| Audition several voices | Use generate batch with text and voices to share a script, or entries for separate lines. Submit up to 12 takes. The label appears in Audio > Recordings. |
| Resume a batch | resume shares one --wait budget across the batch and keeps completed takes. Open the same Project in Studio before resuming a checkpoint through --server. |
| Listen to a voice sample | voices search filters English and Vietnamese voices and returns previewUrl and available provider metrics. Download a sample with voices preview --out FILE. |
| Filter by creator | voices search returns creatorId when GenVoice provides it. Use creatorId or favoriteCreatorsOnly with scanPages, then continue from nextPage when present. |
| Star voices and creators | favorites voices combines Audio and Playground stars and filters by creator or profile rating. Use favorites voices-set to update multiple voices and favorites creator to star a creator. |
| Manage creator profiles | creators save sets a name and description for a creatorId. Read profiles with creators list. Set both minRating and maxRating to 1 to find rated entries below two stars. |
| Browse the Audio catalog | voices cached uses the English Audio catalog's filters and sort order. voices search queries GenVoice directly. |
| Read and export captions | items captions ID returns the transcript with word or sentence timing when saved. Use items export to write a subtitle file. |
| Find a cast voice | profiles list filters selected voice profiles by rating, tag, and voice metadata. Use profiles save and profiles copy to store separate aliases in Project or Global. |
| Update several takes | Pass ids and a patch to items bulk to update tags, stars, color, or archive status. Read the result for IDs it could not find. |
| Find and edit templates | templates find filters by name, prompt, mode, tag, or stars. Use templates info ID to read the full draft and templates update to change metadata. |
| Save and replay a recipe | templates from-recording ID saves a Speech, Dialogue, or Voice Changer take as a template. templates recipe ID returns the command and input for a new take. |
| Update several templates | Pass ids and a patch to templates bulk to change metadata, archive, or restore several templates. Read the result for IDs it could not find. |
| Restore an archived item | items delete moves takes to Archive. List them with items find and archived true, then run items restore ID. Restore a template with templates update and archived false. |
| Preview expired takes | Studio cleans up eligible takes after 30 days. items expired lists candidates and counts Global takes kept because they are linked or have no usage history. |
| Choose a storage scope | Pass --project PATH to select the default Project. Add --scope global for the shared archive. Use --server when Studio is writing to the same project. |

## GenVoice providers

For connection credentials, provider capabilities and implementation status, see [Voice Playground API research](voice-providers.md).

Sources selects ElevenLabs, MiniMax or CapCut; favorites, templates, takes and dialogue roles retain their own provider. Voice Changer accepts ElevenLabs; Swap Voice selects a compatible model and keeps the old version.

English and Vietnamese desktop workflows are prioritized; a chosen language persists when the model supports it. Catalog language labels are hints and do not override that selection during voice changes or sentence edits.

| Provider        | Parameters and CLI                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MiniMax         | voices search with provider minimax accepts language names, gender, age, accent and useCase; generate tts accepts speech-* models, speed 0.5–2, pitch -12–12 and vol 0.01–10 |
| CapCut          | voices search with provider capcut accepts language, gender, age, accent and emotion; generate tts uses model capcut, speed 0.5–2 and pitch -12–12                           |
| Dialogue        | GenVoice uses model and language per speaker. ElevenLabs direct uses one scene model and Gemini uses two presets with per-role direction. See schema generate dialogue. |
| Cost and rights | A zero model multiplier differs from unknown total price; inspect creditsDeducted and verify commercial rights separately                                                    |

For MiniMax and CapCut through GenVoice, use auto text normalization. These engines reject on, off, seed, context, and custom output formats. Use an ElevenLabs model that supports bracketed Audio Tags when you need them.

## Private voice clones

My voices creates MiniMax voices from samples the creator has permission to use, prioritizing English and Vietnamese; samples must be 10 seconds–5 minutes and at most 80 MB. Project/Global archives keep source files, settings, favorites and demos; local storage guarantees neither cloud retention nor commercial rights.

| Task            | UI and CLI                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Create/track    | My voices or clones create with file and permissionConfirmed; schema clones create lists fields, and --yes submits the paid request       |
| Recover         | resume tracks a submitted clone; if its ID is lost, use clones cloud then clones link instead of creating another request                 |
| Use/save        | Use voice opens TTS; Template loads the voice for editing/saving all settings, and Add to Global shares it across films                   |
| Keep the sample | clones export-source ID --out FILE exports the original; cloud imports may have no local source                                           |
| Retry/delete    | clones retry and clones delete require --yes and affect the same ID in Project/Global; retry costs money while previous recordings remain |

Library names are local labels; retry reuses the original submitted sample and settings. Unknown GenVoice fees remain unknown; while Studio stays open, readiness notifications continue after My voices closes.

## Dubbing

Save and probe an audio/video source before approving GenVoice's 50 credits per source second; source limits are 2 GB and 2.5 hours. English/Vietnamese are the primary workflow, while the CLI accepts documented provider languages.

| Task          | CLI                                                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save source   | dubbing source-add accepts file, itemId with asset audio/source, or sourceId with sourceScope to copy a staged Global/Project source into --scope; --checkpoint/resume continues the same copy without generating |
| Quote         | dubbing prepare with sourceId, sourceLanguage, targetLanguage, provider and voiceId; inspect estimatedCredits before submit JOB_ID --yes                                                                          |
| Choose voice  | MiniMax requires its official uniq_id or clone UUID; ttsVoiceId retains the separate numeric TTS identity when known, and CapCut's voice language must match the target                                           |
| Recover       | dubbing list/info/refresh or resume checks existing progress; an uncertain final submission needs cloud/link, never a blind paid repeat                                                                           |
| Archive cloud | dubbing cloud/import retains original source when available, dubbed video/audio and translated subtitles; Project/Global copies own their media                                                                   |
| Retry/delete  | dubbing retry repeats the original charge and keeps prior local versions; delete-cloud removes the shared provider task/files, keeping local recordings and sources                                               |
| Export        | dubbing export-source SOURCE_ID --out FILE exports staged uploads; items export ITEM_ID with format source/result/audio/srt streams archived media, including Cloud imports and Global copies                     |

A final native upload session is consumed even if completion fails; review the saved attempt and cloud history before paying again. API access does not establish commercial rights or cloud retention.

## Studio playground

Audio → Voices → Open Workbench opens the task sidebar: Speech, Dialogue, Voice changer, Transcribe and Dubbing; Voices, Recordings, Templates and Favorites share the same Project/Global archive. Jobs and Cloud recovery track existing requests; switching tools preserves their drafts, and Details & versions edits a section without replacing its original.

## Transcription archive

Scribe v2 saves each transcript with its original audio, requested settings and reported credit cost in Project/Global; Recordings reopens it after reload. A transcription template retains its own source for another project, and items export uses audio for that original or txt/srt/additional provider formats for the transcript.

Choosing an upload saves its source for free before generating or saving a template; sources add accepts up to 90 MB, while Voice Changer generation remains limited to 50 MB. Transcription checkpoints retain the staged source and full Scribe request, so resume observes the existing paid task after a timeout without submitting again.

## The voice loop

For free Gemini 3.8 Flash TTS narration and two-speaker dialogue via the logged-in Google AI Studio speech playground (exporting WAV takes directly into `voice/takes/`), see `.claude/skills/aistudio-tts/SKILL.md` (`speak` / `batch`), then run `voice:align`, `voice:lips`, `voice:assemble`, and `voice:cues` below.

Inside a film, after writing the takes in `src/edit.json` `"takes"` (English Audio Tags in brackets, such as `[tense, hushed]`):

```bash
bun run voice:gen                            # a preview: which takes, the files they write, characters, voice; sends nothing
bun run voice:gen --yes                      # every take with no audio yet, into voice/takes (spends credits)
bun run voice:gen intro_2 --yes              # that take again, replacing its audio
bun run voice:gen --try intro_2 --takes 3 --yes   # three new tries in voice/try/intro_2_<n>.mp3, the take kept
bun run voice:align                          # word timings (whisperX, free) for takes without them; voice:gen runs it itself
bun run voice:lips                           # lip sync for takes a character says on screen ("by": "steve"); voice:gen runs it itself
bun run voice:assemble                       # full_voice.wav, voice.lines, one Phrase Brick per take in audio.json
bun run voice:cues                           # the heard second of every line, word and gap, and the pace
```

Without `--yes` every run is a preview, and its `next:` line is the command that spends. Takes of one voice are generated in story order so neighbours share prosody. Which voice suits which film: the `gohans-3js-videos-skills` skill.

A Phrase Brick moved by hand in the studio is kept by `voice:assemble`; `--clips` rewrites it.

## Reading pace

| `voice:cues` shows        | Meaning                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pace` about 120-160 wpm  | A narrated documentary's pace                                                                                            |
| An `x` after a line's wpm | The narration follows the picture's Speed or Freeze there (`timing.json` `layerKinds.voice`); over about 1.1x words blur |
| A word's seconds          | Heard seconds: where to put a cut, a sound or a title on that word; `bun run at` converts to scene seconds               |

## Production and sync notes

- **AI Studio TTS (`gemini-3.8-flash-tts`)**: For audited voices, `style`/pace levers, `<...>` vocal tags, `/IPA/` pronunciation, and audition traps, read `.claude/skills/aistudio-tts/references/voice-casting-and-direction.md`.
- **Contiguous vs multi-take**: For short films (`<= 60s`), generate the full script in one contiguous pass to keep timbre and pitch floor uniform, then slice into scene-anchored Phrase Bricks at true silent troughs (`<= -70 dBFS`) with `10–15ms` fades. For long-form (`> 60s`), use beat-anchored takes with one frozen `style` and `temperature`.
- **Keep Phrase Bricks natural**: Run `bun run voice:align` and `bun run voice:assemble --clips` once before splitting Phrase Bricks manually in `audio.json` (`--clips` resets manual brick splits and clip filters). Aim for `rate: 1.0`; keep formant-preserving Rubber Band R3 adjustments within `<= ±5%`, otherwise tighten the script and regenerate.
- **Listen directly and protect tails**: Always listen directly to generated takes and `sound/mix.wav` (`read_file` on WAV)—metrics and WhisperX alone miss subtle slurs and truncated final syllables. Avoid aggressive tail silence-cropping (`trimTail`) without checking the last ~300ms RMS.
- **WhisperX low-RAM fallback (Windows)**: If `bun run voice:align` fails on CPU with `mkl_malloc: failed to allocate memory`, run it with `WHISPER_DEVICE=cuda` and `WHISPER_COMPUTE_TYPE=int8`.
- **Mix headroom**: Avoid stacking high `voiceGain` with high `drive` (which crushes master `PLR`); pull down and duck beds (`duck: 3–5`) to keep voice separation cleanly above 15 LU with healthy dynamics.
